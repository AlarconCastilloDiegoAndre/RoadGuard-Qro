# RoadGuard Qro — Machine Learning Pipeline

This directory contains the data preparation, classical baseline comparison, deep-learning
training, and ONNX export pipelines for road-damage detection and severity scoring.

## Structure

- **`scripts/convert_rdd_to_yolo.py`**: CLI script to convert RDD2022 PASCAL VOC XML annotations
  into standard Ultralytics YOLO format (`cls cx cy w h` normalized), stratified 70/20/10 split.
- **`scripts/severity.py`**: Deterministic severity scoring formula shared between ML evaluation
  and the production FastAPI backend.
- **`01_prepare_data.ipynb`**: Interactive notebook to download RDD2022 (Figshare / Kaggle),
  parse annotations, inspect class distributions, and generate `rdd2022.yaml`.
- **`02_classical_baseline.ipynb`**: Academic requirement benchmark comparing Logistic Regression,
  Random Forest, SVM (HOG features) vs. a Convolutional Neural Network on identical splits.
- **`03_train_yolo.ipynb`**: End-to-end YOLO11n training on Google Colab (T4 GPU) or Kaggle Notebooks
  with automatic checkpointing to Google Drive and domain-specific data augmentations.
- **`04_export_onnx.ipynb`**: Quantization to INT8, ONNX export, and CPU inference latency benchmarks
  under 2 vCPU constraints (matching the free Hugging Face Space tier).

## Target Damage Classes

| Class ID | Code | Description | Severity Weight |
|---|---|---|---|
| 0 | `D00` | Longitudinal crack | 0.4 |
| 1 | `D10` | Transverse crack | 0.5 |
| 2 | `D20` | Alligator / fatigue crack | 0.8 |
| 3 | `D40` | Pothole | 1.0 |

## Quickstart (Local / Colab)

```bash
pip install -r requirements.txt
```

To run data conversion locally or in a notebook:
```bash
python scripts/convert_rdd_to_yolo.py --source-dir /path/to/RDD2022 --output-dir data/yolo_rdd
```
