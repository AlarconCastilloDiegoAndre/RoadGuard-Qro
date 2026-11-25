import asyncio
import io
import logging
from pathlib import Path
from typing import List, Optional, Tuple
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


class ONNXModelRunner:
    def __init__(self, model_path: str = settings.MODEL_PATH):
        self.model_path = Path(model_path)
        self.session = None
        self.input_name = None
        self.output_name = None
        self.is_loaded = False
        self.semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT_INFERENCES)

    def load(self):
        """Initializes ONNX Runtime session with 2 threads."""
        target_path = self.model_path
        if not target_path.exists():
            fallback = Path(settings.FALLBACK_MODEL_PATH)
            if fallback.exists():
                target_path = fallback
            else:
                logger.warning(
                    f"Model not found at {self.model_path} or {fallback}. "
                    "Running in synthetic test mode for API verification."
                )
                self.is_loaded = False
                return

        try:
            import onnxruntime as ort
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 2
            opts.inter_op_num_threads = 1
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

            self.session = ort.InferenceSession(
                str(target_path),
                opts,
                providers=["CPUExecutionProvider"]
            )
            self.input_name = self.session.get_inputs()[0].name
            self.output_name = self.session.get_outputs()[0].name
            self.is_loaded = True
            logger.info(f"Loaded ONNX model from {target_path} (2 threads CPU)")
        except Exception as e:
            logger.error(f"Failed to load ONNX model: {e}")
            self.is_loaded = False

    def preprocess(self, pil_image: Image.Image) -> Tuple[np.ndarray, float, Tuple[int, int]]:
        """Letterbox resize to 640x640, convert to RGB, normalize to [0, 1]."""
        orig_w, orig_h = pil_image.size
        target_size = settings.INPUT_SIZE

        # Scale factor
        r = min(target_size / orig_w, target_size / orig_h)
        new_w, new_h = int(round(orig_w * r)), int(round(orig_h * r))

        # Letterbox pad
        dw = (target_size - new_w) / 2
        dh = (target_size - new_h) / 2
        top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
        left, right = int(round(dw - 0.1)), int(round(dw + 0.1))

        resized = pil_image.resize((new_w, new_h), Image.Resampling.BILINEAR)
        letterboxed = Image.new("RGB", (target_size, target_size), (114, 114, 114))
        letterboxed.paste(resized, (left, top))

        img_arr = np.array(letterboxed, dtype=np.float32) / 255.0
        # Transpose HWC to CHW and add batch dimension -> (1, 3, 640, 640)
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
        Runs full inference pipeline: preprocessing -> ONNX inference -> NMS -> severity.
        Protected by asyncio.Semaphore for concurrency limits.
        """
        async with self.semaphore:
            pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            orig_w, orig_h = pil_image.size

            if not self.is_loaded or self.session is None:
                # Synthetic mock detector for API/test validation if model weights not yet trained
                return self._mock_predict(pil_image)

            blob, r, (pad_x, pad_y) = self.preprocess(pil_image)
            outputs = self.session.run([self.output_name], {self.input_name: blob})[0]

            # YOLOv8 / YOLO11 output format: (1, 4 + num_classes, num_anchors) e.g. (1, 8, 8400)
            preds = np.squeeze(outputs, axis=0).T  # Shape: (8400, 8)
            boxes = preds[:, :4]  # cx, cy, w, h
            class_scores = preds[:, 4:]  # class probabilities

            class_ids = np.argmax(class_scores, axis=1)
            confidences = np.max(class_scores, axis=1)

            # Filter by confidence
            mask = confidences >= settings.CONFIDENCE_THRESHOLD
            boxes = boxes[mask]
            confidences = confidences[mask]
            class_ids = class_ids[mask]

            if len(boxes) == 0:
                return [], pil_image

            # Convert cx, cy, w, h in 640 coords to x1, y1, x2, y2 in original image coords
            cx, cy, bw, bh = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
            x1 = np.clip((cx - bw / 2 - pad_x) / r, 0, orig_w)
            y1 = np.clip((cy - bh / 2 - pad_y) / r, 0, orig_h)
            x2 = np.clip((cx + bw / 2 - pad_x) / r, 0, orig_w)
            y2 = np.clip((cy + bh / 2 - pad_y) / r, 0, orig_h)

            xyxy = np.stack([x1, y1, x2, y2], axis=1)
            keep_indices = self.run_nms(xyxy, confidences, settings.IOU_THRESHOLD)

            results = []
            for idx in keep_indices:
                cid = int(class_ids[idx])
                code = CLASS_ID_TO_CODE.get(cid, "D00")
                conf = float(confidences[idx])

                # Normalized coordinates relative to original frame
                norm_w = float((x2[idx] - x1[idx]) / orig_w)
                norm_h = float((y2[idx] - y1[idx]) / orig_h)
                norm_cx = float((x1[idx] + x2[idx]) / (2.0 * orig_w))
                norm_cy = float((y1[idx] + y2[idx]) / (2.0 * orig_h))

                score, level = compute_severity(code, norm_w, norm_h, y_center=norm_cy)

                results.append(DetectionResult(
                    damage_class=code,
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

    def _mock_predict(self, pil_image: Image.Image) -> Tuple[List[DetectionResult], Image.Image]:
        """Provides deterministic test responses when running without trained weights."""
        return [], pil_image


runner = ONNXModelRunner()
