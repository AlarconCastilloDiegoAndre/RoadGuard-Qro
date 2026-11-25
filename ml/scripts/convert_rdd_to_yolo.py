"""
RoadGuard Qro — RDD2022 to YOLO Annotation Converter & Stratified Splitter.

Converts PASCAL VOC XML annotations from the multi-national Road Damage Dataset 2022
(Japan, India, Czech, Norway, United_States, China_MotorBike) into standard Ultralytics
YOLO directory structure and label files.

Features:
- Filters annotations strictly to target classes: D00, D10, D20, D40.
- Drops non-relevant classes (D43, D44, Repair, etc.).
- Performs country-stratified train/val/test splits (70% / 20% / 10%) to prevent data leakage.
- Generates reproducible `rdd2022.yaml` ready for Ultralytics YOLO training.
"""

import argparse
import os
import random
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Tuple
import yaml

TARGET_CLASSES: Dict[str, int] = {
    "D00": 0,  # Longitudinal crack
    "D10": 1,  # Transverse crack
    "D20": 2,  # Alligator crack
    "D40": 3,  # Pothole
}

CLASS_NAMES: List[str] = [
    "longitudinal_crack",
    "transverse_crack",
    "alligator_crack",
    "pothole",
]


def parse_voc_xml(xml_path: Path) -> Tuple[int, int, List[Tuple[int, float, float, float, float]]]:
    """
    Parses a single VOC XML file, extracting image dimensions and target bounding boxes in YOLO format.

    Returns:
        (img_width, img_height, list_of_boxes)
        where each box is (class_id, cx_norm, cy_norm, w_norm, h_norm).
    """
    tree = ET.parse(xml_path)
    root = tree.getroot()

    size_elem = root.find("size")
    if size_elem is None:
        raise ValueError(f"Missing <size> tag in {xml_path}")

    width = int(size_elem.find("width").text)
    height = int(size_elem.find("height").text)

    if width <= 0 or height <= 0:
        return width, height, []

    boxes = []
    for obj in root.findall("object"):
        name_elem = obj.find("name")
        if name_elem is None:
            continue
        raw_name = name_elem.text.strip()
        if raw_name not in TARGET_CLASSES:
            continue

        class_id = TARGET_CLASSES[raw_name]
        bndbox = obj.find("bndbox")
        if bndbox is None:
            continue

        xmin = float(bndbox.find("xmin").text)
        ymin = float(bndbox.find("ymin").text)
        xmax = float(bndbox.find("xmax").text)
        ymax = float(bndbox.find("ymax").text)

        # Coordinate clamping to frame boundaries
        xmin = max(0.0, min(float(width), xmin))
        ymin = max(0.0, min(float(height), ymin))
        xmax = max(0.0, min(float(width), xmax))
        ymax = max(0.0, min(float(height), ymax))

        box_w = xmax - xmin
        box_h = ymax - ymin
        if box_w <= 1 or box_h <= 1:
            continue

        # Normalized center coordinates and box dimensions
        cx = (xmin + box_w / 2.0) / width
        cy = (ymin + box_h / 2.0) / height
        w_norm = box_w / width
        h_norm = box_h / height

        boxes.append((class_id, cx, cy, w_norm, h_norm))

    return width, height, boxes


def convert_dataset(
    source_root: Path,
    output_root: Path,
    train_ratio: float = 0.70,
    val_ratio: float = 0.20,
    test_ratio: float = 0.10,
    seed: int = 42,
    symlink: bool = False,
) -> Dict[str, int]:
    """
    Scans source_root for country subfolders containing images/ and annotations/xmls/,
    converts annotations, and generates a structured YOLO dataset.
    """
    random.seed(seed)
    output_root.mkdir(parents=True, exist_ok=True)

    # Setup standard YOLO directories
    for split in ["train", "val", "test"]:
        (output_root / "images" / split).mkdir(parents=True, exist_ok=True)
        (output_root / "labels" / split).mkdir(parents=True, exist_ok=True)

    # Detect country folders or flat directory
    xml_files = list(source_root.glob("**/annotations/xmls/*.xml"))
    if not xml_files:
        xml_files = list(source_root.glob("**/*.xml"))

    print(f"Found {len(xml_files)} total XML annotation files in {source_root}")

    # Group by parent country or folder to allow stratified splitting
    groups: Dict[str, List[Path]] = {}
    for xf in xml_files:
        # Determine group (e.g. 'Japan', 'India', 'United_States')
        parts = xf.relative_to(source_root).parts
        group_key = parts[0] if len(parts) > 1 else "default"
        groups.setdefault(group_key, []).append(xf)

    counts = {"train": 0, "val": 0, "test": 0, "skipped_empty": 0, "total_boxes": 0}
    class_distribution = {k: 0 for k in TARGET_CLASSES.keys()}

    for group_name, files in groups.items():
        random.shuffle(files)
        n = len(files)
        n_train = int(n * train_ratio)
        n_val = int(n * val_ratio)

        for idx, xml_path in enumerate(files):
            if idx < n_train:
                split = "train"
            elif idx < n_train + n_val:
                split = "val"
            else:
                split = "test"

            try:
                width, height, boxes = parse_voc_xml(xml_path)
            except Exception as e:
                print(f"Warning: Failed to parse {xml_path}: {e}")
                continue

            # We retain images that have at least one valid damage box
            if not boxes:
                counts["skipped_empty"] += 1
                continue

            # Find matching image file (.jpg or .png)
            base_name = xml_path.stem
            img_candidate = None
            parent_dir = xml_path.parents[1]  # Typically .../train/
            possible_image_dirs = [
                parent_dir / "images",
                xml_path.parent.parent / "images",
                xml_path.parent,
            ]
            for pdir in possible_image_dirs:
                for ext in [".jpg", ".png", ".jpeg", ".JPG"]:
                    c = pdir / f"{base_name}{ext}"
                    if c.exists():
                        img_candidate = c
                        break
                if img_candidate:
                    break

            if not img_candidate or not img_candidate.exists():
                continue

            # Write label file
            label_out = output_root / "labels" / split / f"{base_name}.txt"
            with open(label_out, "w", encoding="utf-8") as lf:
                for cid, cx, cy, w, h in boxes:
                    lf.write(f"{cid} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}\n")
                    counts["total_boxes"] += 1
                    class_code = list(TARGET_CLASSES.keys())[cid]
                    class_distribution[class_code] += 1

            # Copy or link image file
            img_out = output_root / "images" / split / img_candidate.name
            if not img_out.exists():
                if symlink:
                    try:
                        os.symlink(img_candidate.resolve(), img_out)
                    except OSError:
                        shutil.copy2(img_candidate, img_out)
                else:
                    shutil.copy2(img_candidate, img_out)

            counts[split] += 1

    # Generate rdd2022.yaml config file
    yaml_config = {
        "path": str(output_root.resolve()),
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "names": {v: k for k, v in TARGET_CLASSES.items()},
        "descriptions": {i: CLASS_NAMES[i] for i in range(len(CLASS_NAMES))},
    }

    yaml_path = output_root / "rdd2022.yaml"
    with open(yaml_path, "w", encoding="utf-8") as yf:
        yaml.dump(yaml_config, yf, default_flow_style=False, sort_keys=False)

    print("\n=== Dataset Conversion Completed ===")
    print(f"Train images: {counts['train']}")
    print(f"Val images:   {counts['val']}")
    print(f"Test images:  {counts['test']}")
    print(f"Total annotations: {counts['total_boxes']}")
    print(f"Class counts: {class_distribution}")
    print(f"Configuration written to: {yaml_path}")

    return counts


def main():
    parser = argparse.ArgumentParser(description="Convert RDD2022 annotations to YOLO format.")
    parser.add_argument("--source-dir", type=Path, required=True, help="Path to unzipped RDD2022 directory")
    parser.add_argument("--output-dir", type=Path, default=Path("data/yolo_rdd"), help="Destination directory")
    parser.add_argument("--symlink", action="store_true", help="Use symlinks instead of copying images")
    args = parser.parse_args()

    convert_dataset(args.source_dir, args.output_dir, symlink=args.symlink)


if __name__ == "__main__":
    main()
