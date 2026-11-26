import asyncio
import io
import logging
from pathlib import Path
from typing import List, Tuple
import urllib.request
import numpy as np
from PIL import Image

from backend.app.config import settings
from backend.app.schemas import DamageClass, DetectionResult, NormalizedBBox
from backend.app.severity import compute_severity

logger = logging.getLogger("roadguard.inference")

CLASS_ID_TO_CODE = {
    0: "D00",
    1: "D10",
    2: "D20",
    3: "D40"
}

# Pre-trained YOLO11s RDD2022 ONNX model hosted on Hugging Face Hub (AGPL-3.0, 4 classes: D00, D10, D20, D40)
HF_RDD2022_ONNX_URL = "https://huggingface.co/Th3Samaritan/rdd2022-yolo11s/resolve/main/best.onnx"
CACHED_ONNX_PATH = Path("/tmp/rdd2022_yolo11s.onnx")


class ONNXModelRunner:
    def __init__(self, model_path: str = settings.MODEL_PATH):
        self.model_path = Path(model_path)
        self.session = None
        self.input_name = None
        self.output_name = None
        self.is_loaded = False
        self.semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT_INFERENCES)

    def _ensure_model_file(self) -> Path | None:
        """Finds local ONNX model or downloads pre-trained RDD2022 YOLO11 ONNX weights."""
        for candidate in [self.model_path, Path(settings.FALLBACK_MODEL_PATH), CACHED_ONNX_PATH]:
            if candidate.exists() and candidate.stat().st_size > 1_000_000:
                return candidate

        try:
            CACHED_ONNX_PATH.parent.mkdir(parents=True, exist_ok=True)
            logger.info(f"Downloading pre-trained RDD2022 YOLO11 ONNX model from {HF_RDD2022_ONNX_URL} ...")
            req = urllib.request.Request(
                HF_RDD2022_ONNX_URL,
                headers={"User-Agent": "RoadGuard-Qro/1.0"}
            )
            with urllib.request.urlopen(req, timeout=45) as resp, open(CACHED_ONNX_PATH, "wb") as out_file:
                while True:
                    chunk = resp.read(262144)
                    if not chunk:
                        break
                    out_file.write(chunk)
            if CACHED_ONNX_PATH.exists() and CACHED_ONNX_PATH.stat().st_size > 1_000_000:
                logger.info(f"Downloaded RDD2022 YOLO11 ONNX model ({CACHED_ONNX_PATH.stat().st_size} bytes)")
                return CACHED_ONNX_PATH
        except Exception as e:
            logger.warning(f"Could not download RDD2022 ONNX model: {e}")

        return None

    def load(self):
        """Initializes ONNX Runtime session with memory-efficient 2-thread CPU settings."""
        target_path = self._ensure_model_file()
        if target_path is None:
            logger.warning("ONNX model file unavailable. Running with strict asphalt CV verifier.")
            self.is_loaded = False
            return

        try:
            import onnxruntime as ort
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 2
            opts.inter_op_num_threads = 1
            # Memory optimization for 512 MB free tier containers
            opts.enable_cpu_mem_arena = False
            opts.enable_mem_pattern = False
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

            self.session = ort.InferenceSession(
                str(target_path),
                opts,
                providers=["CPUExecutionProvider"]
            )
            self.model_path = target_path
            self.input_name = self.session.get_inputs()[0].name
            self.output_name = self.session.get_outputs()[0].name
            self.is_loaded = True
            logger.info(f"Loaded RDD2022 YOLO11 ONNX model from {target_path} (2 threads CPU)")
        except Exception as e:
            logger.error(f"Failed to load ONNX model: {e}")
            self.is_loaded = False

    def is_road_pavement_surface(self, pil_image: Image.Image) -> Tuple[bool, float]:
        """
        Verifies whether the camera frame actually depicts asphalt/concrete road surface
        versus indoor floors, shoes, furniture, or non-road scenes.

        Asphalt and concrete road surfaces exhibit:
        - Low chromatic saturation (mostly neutral gray/charcoal/asphalt tones, low RGB channel divergence).
        - Absence of large bright indoor specular tiles or colorful objects.
        - Characteristic granular micro-texture across the road surface.

        Returns:
            (is_plausible_road, road_confidence_multiplier)
        """
        small = pil_image.resize((160, 100), Image.Resampling.BILINEAR)
        rgb = np.array(small, dtype=np.float32)

        r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
        max_c = np.maximum(np.maximum(r, g), b)
        min_c = np.minimum(np.minimum(r, g), b)
        chroma = max_c - min_c
        lum = 0.299 * r + 0.587 * g + 0.114 * b

        # Fraction of pixels that are neutral gray/asphalt (low color saturation: chroma < 32)
        neutral_gray_ratio = float(np.mean(chroma < 32.0))
        # Fraction of pixels that are very bright white/beige indoor tile (lum > 185)
        bright_tile_ratio = float(np.mean(lum > 185.0))
        # Fraction of strongly colored pixels (red/blue/green clothes, shoes, indoor objects)
        colorful_ratio = float(np.mean(chroma > 55.0))

        # Indoor tile floors or colorful indoor objects fail road surface criteria
        if bright_tile_ratio > 0.45 or colorful_ratio > 0.25 or neutral_gray_ratio < 0.55:
            return False, 0.65

        return True, 1.0

    def preprocess(self, pil_image: Image.Image) -> Tuple[np.ndarray, float, Tuple[int, int]]:
        """Letterbox resize to 640x640, convert to RGB, normalize to [0, 1]."""
        orig_w, orig_h = pil_image.size
        target_size = settings.INPUT_SIZE

        r = min(target_size / orig_w, target_size / orig_h)
        new_w, new_h = int(round(orig_w * r)), int(round(orig_h * r))

        dw = (target_size - new_w) / 2
        dh = (target_size - new_h) / 2
        top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
        left, right = int(round(dw - 0.1)), int(round(dw + 0.1))

        resized = pil_image.resize((new_w, new_h), Image.Resampling.BILINEAR)
        letterboxed = Image.new("RGB", (target_size, target_size), (114, 114, 114))
        letterboxed.paste(resized, (left, top))

        img_arr = np.array(letterboxed, dtype=np.float32) / 255.0
        img_arr = np.transpose(img_arr, (2, 0, 1))[np.newaxis, ...]
        return img_arr, r, (left, top)

    def run_nms(self, boxes: np.ndarray, scores: np.ndarray, iou_threshold: float = 0.45) -> List[int]:
        """Classic greedy Non-Maximum Suppression."""
        x1 = boxes[:, 0]
        y1 = boxes[:, 1]
        x2 = boxes[:, 2]
        y2 = boxes[:, 3]
        areas = (x2 - x1) * (y2 - y1)
        order = scores.argsort()[::-1]

        keep = []
        while order.size > 0:
            i = order[0]
            keep.append(i)
            xx1 = np.maximum(x1[i], x1[order[1:]])
            yy1 = np.maximum(y1[i], y1[order[1:]])
            xx2 = np.minimum(x2[i], x2[order[1:]])
            yy2 = np.minimum(y2[i], y2[order[1:]])

            w = np.maximum(0.0, xx2 - xx1)
            h = np.maximum(0.0, yy2 - yy1)
            inter = w * h
            ovr = inter / (areas[i] + areas[order[1:]] - inter)

            inds = np.where(ovr <= iou_threshold)[0]
            order = order[inds + 1]

        return keep

    async def predict(self, image_bytes: bytes) -> Tuple[List[DetectionResult], Image.Image]:
        """
        Runs full inference pipeline:
        1. Road surface verification
        2. YOLO11s RDD2022 ONNX neural network inference
        3. NMS & calibrated physical severity scoring
        """
        async with self.semaphore:
            pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            orig_w, orig_h = pil_image.size

            is_road, _ = self.is_road_pavement_surface(pil_image)

            if not self.is_loaded or self.session is None:
                return [], pil_image

            blob, r, (pad_x, pad_y) = self.preprocess(pil_image)
            outputs = self.session.run([self.output_name], {self.input_name: blob})[0]

            # YOLO11 output shape: (1, 8, 8400) -> transpose to (8400, 8)
            preds = np.squeeze(outputs, axis=0).T
            boxes = preds[:, :4]
            class_scores = preds[:, 4:]

            class_ids = np.argmax(class_scores, axis=1)
            confidences = np.max(class_scores, axis=1)

            # Use stricter confidence threshold if background does not look like typical road asphalt
            effective_conf_thresh = 0.28 if is_road else 0.58

            mask = confidences >= effective_conf_thresh
            boxes = boxes[mask]
            confidences = confidences[mask]
            class_ids = class_ids[mask]

            if len(boxes) == 0:
                return [], pil_image

            cx, cy, bw, bh = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
            x1 = np.clip((cx - bw / 2 - pad_x) / r, 0, orig_w)
            y1 = np.clip((cy - bh / 2 - pad_y) / r, 0, orig_h)
            x2 = np.clip((cx + bw / 2 - pad_x) / r, 0, orig_w)
            y2 = np.clip((cy + bh / 2 - pad_y) / r, 0, orig_h)

            xyxy = np.stack([x1, y1, x2, y2], axis=1)
            keep_indices = self.run_nms(xyxy, confidences, settings.IOU_THRESHOLD)

            results = []
            for idx in keep_indices[:5]:  # Cap at top 5 most confident damages per frame
                cid = int(class_ids[idx])
                code = CLASS_ID_TO_CODE.get(cid, "D00")
                conf = float(confidences[idx])

                norm_w = float((x2[idx] - x1[idx]) / orig_w)
                norm_h = float((y2[idx] - y1[idx]) / orig_h)
                norm_cx = float((x1[idx] + x2[idx]) / (2.0 * orig_w))
                norm_cy = float((y1[idx] + y2[idx]) / (2.0 * orig_h))

                # Reject degenerate boxes covering almost the entire image (>85% width & height)
                if norm_w > 0.85 and norm_h > 0.85:
                    continue

                score, level = compute_severity(code, norm_w, norm_h, y_center=norm_cy)

                results.append(DetectionResult(
                    damage_class=code,  # type: ignore
                    confidence=round(conf, 4),
                    severity_score=score,
                    severity_level=level,
                    bbox=NormalizedBBox(
                        cx=round(norm_cx, 4),
                        cy=round(norm_cy, 4),
                        w=round(norm_w, 4),
                        h=round(norm_h, 4)
                    )
                ))

            return results, pil_image


runner = ONNXModelRunner()
