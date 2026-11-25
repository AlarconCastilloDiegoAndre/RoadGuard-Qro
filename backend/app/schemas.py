from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID
from pydantic import BaseModel, Field


DamageClass = Literal["D00", "D10", "D20", "D40"]
SeverityLevel = Literal["low", "medium", "high", "critical"]
DamageStatus = Literal["reported", "confirmed", "validated", "in_repair", "repaired", "dismissed"]


class NormalizedBBox(BaseModel):
    cx: float = Field(..., ge=0.0, le=1.0, description="Normalized center x coordinate")
    cy: float = Field(..., ge=0.0, le=1.0, description="Normalized center y coordinate")
    w: float = Field(..., ge=0.0, le=1.0, description="Normalized width")
    h: float = Field(..., ge=0.0, le=1.0, description="Normalized height")


class FrameMetadata(BaseModel):
    frame_id: UUID = Field(..., description="Unique client-generated idempotent UUID")
    session_id: Optional[UUID] = Field(None, description="Active route session UUID")
    vehicle_id: Optional[UUID] = Field(None, description="Assigned vehicle UUID")
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    gps_accuracy_m: float = Field(..., ge=0.0, description="GPS accuracy in meters")
    speed_kmh: Optional[float] = Field(None, ge=0.0, description="Vehicle speed in km/h")
    heading_deg: Optional[float] = Field(None, ge=0.0, le=360.0, description="Compass heading")
    captured_at: datetime = Field(default_factory=datetime.utcnow)


class DetectionResult(BaseModel):
    damage_class: DamageClass
    confidence: float = Field(..., ge=0.0, le=1.0)
    severity_score: float = Field(..., ge=0.0, le=1.0)
    severity_level: SeverityLevel
    bbox: NormalizedBBox
    crop_saved: bool = False
    damage_id: Optional[UUID] = None


class FrameInferenceResponse(BaseModel):
    frame_id: UUID
    latitude: float
    longitude: float
    detections: List[DetectionResult]
    processed_at: datetime = Field(default_factory=datetime.utcnow)


class BatchInferenceResponse(BaseModel):
    total_frames: int
    processed_frames: int
    total_detections: int
    results: List[FrameInferenceResponse]


class HealthResponse(BaseModel):
    status: str
    version: str
    model_loaded: bool
    model_path: Optional[str]
    device: str
    active_semaphore_slots: int


class SessionStartRequest(BaseModel):
    vehicle_id: Optional[UUID] = None


class SessionEndRequest(BaseModel):
    distance_km: float = Field(0.0, ge=0.0)
    frames_sent: int = Field(0, ge=0)
    frames_dropped: int = Field(0, ge=0)


class SessionResponse(BaseModel):
    session_id: UUID
    status: str
    started_at: datetime
    ended_at: Optional[datetime] = None
