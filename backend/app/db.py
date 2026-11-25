import io
import logging
from typing import Optional
from uuid import UUID
from PIL import Image
from backend.app.config import settings

logger = logging.getLogger("roadguard.db")

# Optional Supabase client initialization
_supabase_client = None

def get_supabase_client():
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client
    
    if "placeholder" not in settings.SUPABASE_URL:
        try:
            from supabase import create_client
            _supabase_client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
            return _supabase_client
        except Exception as e:
            logger.warning(f"Could not connect to Supabase: {e}")
    return None


async def save_damage_crop(
    image: Image.Image,
    damage_id: UUID,
    frame_id: UUID
) -> Optional[str]:
    """
    Encodes image patch to WebP (~15 KB) and uploads to 'damage-crops' private bucket.
    """
    client = get_supabase_client()
    if not client:
        return None

    try:
        buffer = io.BytesIO()
        image.save(buffer, format="WEBP", quality=80)
        buffer.seek(0)
        storage_path = f"{damage_id}/{frame_id}.webp"

        client.storage.from_("damage-crops").upload(
            path=storage_path,
            file=buffer.getvalue(),
            file_options={"content-type": "image/webp", "upsert": "true"}
        )
        return storage_path
    except Exception as e:
        logger.error(f"Failed to upload damage crop to storage: {e}")
        return None


async def record_detection_event(
    municipality_id: UUID,
    vehicle_id: Optional[UUID],
    session_id: Optional[UUID],
    frame_id: UUID,
    damage_class: str,
    confidence: float,
    severity_score: float,
    severity_level: str,
    lat: float,
    lon: float,
    gps_accuracy_m: float,
    speed_kmh: Optional[float],
    heading_deg: Optional[float],
    crop_storage_path: Optional[str],
    bbox_dict: dict,
    captured_at_iso: str
) -> Optional[UUID]:
    """
    Calls the PostGIS spatial deduplication procedure `upsert_road_damage()`.
    """
    client = get_supabase_client()
    if not client:
        return None

    try:
        response = client.rpc(
            "upsert_road_damage",
            {
                "p_municipality_id": str(municipality_id),
                "p_vehicle_id": str(vehicle_id) if vehicle_id else None,
                "p_session_id": str(session_id) if session_id else None,
                "p_frame_id": str(frame_id),
                "p_damage_class": damage_class,
                "p_confidence": float(confidence),
                "p_severity_score": float(severity_score),
                "p_severity_level": severity_level,
                "p_lat": float(lat),
                "p_lon": float(lon),
                "p_gps_accuracy_m": float(gps_accuracy_m),
                "p_speed_kmh": float(speed_kmh) if speed_kmh is not None else None,
                "p_heading_deg": float(heading_deg) if heading_deg is not None else None,
                "p_crop_storage_path": crop_storage_path,
                "p_bbox": bbox_dict,
                "p_captured_at": captured_at_iso
            }
        ).execute()
        if response.data:
            return UUID(response.data)
    except Exception as e:
        logger.error(f"Database upsert_road_damage RPC error: {e}")
    return None
