from contextlib import asynccontextmanager
import json
import logging
from typing import List, Optional
from uuid import UUID

from fastapi import (
    FastAPI, File, Form, HTTPException, Request, UploadFile,
    status, Depends
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from backend.app.auth import AuthUser, get_current_user
from backend.app.config import settings
from backend.app.db import record_detection_event, save_damage_crop
from backend.app.inference import runner
from backend.app.schemas import (
    BatchInferenceResponse, DetectionResult, FrameInferenceResponse,
    FrameMetadata, HealthResponse, SessionEndRequest,
    SessionResponse, SessionStartRequest
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("roadguard.main")

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing RoadGuard Qro Inference Engine...")
    runner.load()
    yield
    logger.info("Shutting down RoadGuard Qro Inference Engine.")


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        status="healthy",
        version=settings.VERSION,
        model_loaded=runner.is_loaded,
        model_path=str(runner.model_path) if runner.is_loaded else None,
        device="CPU (2 threads)",
        active_semaphore_slots=runner.semaphore._value
    )


@app.post("/v1/inference/frame", response_model=FrameInferenceResponse)
@limiter.limit("30/minute")
async def infer_single_frame(
    request: Request,
    file: UploadFile = File(...),
    metadata: str = Form(...),
    user: AuthUser = Depends(get_current_user)
):
    """Debug/Single-frame inference endpoint."""
    try:
        meta_dict = json.loads(metadata)
        frame_meta = FrameMetadata(**meta_dict)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid metadata JSON: {e}")

    content = await file.read()
    if len(content) > settings.MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image size exceeds limit of {settings.MAX_IMAGE_SIZE_BYTES} bytes."
        )

    detections, pil_img = await runner.predict(content)

    # Process and record detections
    processed_detections: List[DetectionResult] = []
    for d in detections:
        damage_id = await record_detection_event(
            municipality_id=user.municipality_id,
            vehicle_id=frame_meta.vehicle_id,
            session_id=frame_meta.session_id,
            frame_id=frame_meta.frame_id,
            damage_class=d.damage_class,
            confidence=d.confidence,
            severity_score=d.severity_score,
            severity_level=d.severity_level,
            lat=frame_meta.latitude,
            lon=frame_meta.longitude,
            gps_accuracy_m=frame_meta.gps_accuracy_m,
            speed_kmh=frame_meta.speed_kmh,
            heading_deg=frame_meta.heading_deg,
            crop_storage_path=None,
            bbox_dict=d.bbox.model_dump(),
            captured_at_iso=frame_meta.captured_at.isoformat()
        )
        d.damage_id = damage_id
        processed_detections.append(d)

    return FrameInferenceResponse(
        frame_id=frame_meta.frame_id,
        latitude=frame_meta.latitude,
        longitude=frame_meta.longitude,
        detections=processed_detections
    )


@app.post("/v1/inference/batch", response_model=BatchInferenceResponse)
@limiter.limit("12/minute")
async def infer_batch(
    request: Request,
    metadata_batch: str = Form(..., description="JSON array of FrameMetadata objects"),
    files: List[UploadFile] = File(...),
    user: AuthUser = Depends(get_current_user)
):
    """
    Production batch endpoint: receives a list of compressed road frames + GPS metadata.
    Idempotent by frame_id. Geo-deduplicates via PostGIS.
    """
    try:
        raw_list = json.loads(metadata_batch)
        frames_meta = [FrameMetadata(**item) for item in raw_list]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid batch metadata format: {e}"
        )

    if len(frames_meta) != len(files):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Metadata count ({len(frames_meta)}) does not match files count ({len(files)})."
        )

    if len(files) > settings.MAX_BATCH_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Batch size exceeds maximum of {settings.MAX_BATCH_SIZE} frames."
        )

    responses: List[FrameInferenceResponse] = []
    total_detections_count = 0

    for meta, upload_file in zip(frames_meta, files):
        content = await upload_file.read()
        if len(content) > settings.MAX_IMAGE_SIZE_BYTES:
            continue  # Skip oversized frame

        # GPS accuracy guard: reject unreliable GPS (> 25 m accuracy)
        if meta.gps_accuracy_m > 25.0:
            logger.info(f"Skipping frame {meta.frame_id}: low GPS accuracy ({meta.gps_accuracy_m} m)")
            continue

        detections, pil_img = await runner.predict(content)
        total_detections_count += len(detections)

        processed_detections: List[DetectionResult] = []
        for d in detections:
            # Crop damage patch around bbox for review
            w_orig, h_orig = pil_img.size
            x1 = max(0, int((d.bbox.cx - d.bbox.w / 2) * w_orig))
            y1 = max(0, int((d.bbox.cy - d.bbox.h / 2) * h_orig))
            x2 = min(w_orig, int((d.bbox.cx + d.bbox.w / 2) * w_orig))
            y2 = min(h_orig, int((d.bbox.cy + d.bbox.h / 2) * h_orig))

            crop_path = None
            if x2 > x1 and y2 > y1:
                crop = pil_img.crop((x1, y1, x2, y2))
                crop_path = await save_damage_crop(crop, meta.frame_id, meta.frame_id)
                d.crop_saved = crop_path is not None

            damage_id = await record_detection_event(
                municipality_id=user.municipality_id,
                vehicle_id=meta.vehicle_id,
                session_id=meta.session_id,
                frame_id=meta.frame_id,
                damage_class=d.damage_class,
                confidence=d.confidence,
                severity_score=d.severity_score,
                severity_level=d.severity_level,
                lat=meta.latitude,
                lon=meta.longitude,
                gps_accuracy_m=meta.gps_accuracy_m,
                speed_kmh=meta.speed_kmh,
                heading_deg=meta.heading_deg,
                crop_storage_path=crop_path,
                bbox_dict=d.bbox.model_dump(),
                captured_at_iso=meta.captured_at.isoformat()
            )
            d.damage_id = damage_id
            processed_detections.append(d)

        responses.append(FrameInferenceResponse(
            frame_id=meta.frame_id,
            latitude=meta.latitude,
            longitude=meta.longitude,
            detections=processed_detections
        ))

    return BatchInferenceResponse(
        total_frames=len(files),
        processed_frames=len(responses),
        total_detections=total_detections_count,
        results=responses
    )
