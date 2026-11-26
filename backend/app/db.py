import base64
from datetime import datetime, timedelta
import io
import json
import logging
import math
from pathlib import Path
import struct
from typing import Dict, List, Optional, Tuple
from uuid import UUID, uuid4
import httpx
from PIL import Image
from backend.app.config import settings
from backend.app.schemas import DamageStatus, RoadDamageItem

logger = logging.getLogger("roadguard.db")

_supabase_client = None
LOCAL_STORE_PATH = Path("/tmp/roadguard_damages_store.json")

# In-memory store synchronized with local file and Supabase
_damages_cache: Dict[str, RoadDamageItem] = {}
_processed_frames: set[str] = set()
_initialized: bool = False


def _haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2.0 * r * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def _parse_ewkb_point(wkb_hex: str) -> Optional[Tuple[float, float]]:
    """
    Parses PostGIS EWKB Hex Point (e.g. 0101000020E6100000...) into (lat, lon).
    """
    try:
        raw = bytes.fromhex(wkb_hex)
        if len(raw) >= 25:
            endian = "<" if raw[0] == 1 else ">"
            lon, lat = struct.unpack(f"{endian}dd", raw[9:25])
            if -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0:
                return (round(lat, 6), round(lon, 6))
    except Exception:
        pass
    return None


def _seed_initial_damages():
    """Seeds default Querétaro benchmark damages if store is empty."""
    global _damages_cache, _initialized
    if _initialized:
        return
    _initialized = True

    if LOCAL_STORE_PATH.exists():
        try:
            raw = json.loads(LOCAL_STORE_PATH.read_text(encoding="utf-8"))
            for item in raw:
                d = RoadDamageItem(**item)
                _damages_cache[d.id] = d
            if _damages_cache:
                return
        except Exception as e:
            logger.warning(f"Could not load local store: {e}")

    now = datetime.utcnow()
    defaults = [
        RoadDamageItem(
            id="d0000000-0000-0000-0000-000000000001",
            damage_class="D40",
            severity_score=0.885,
            severity_level="critical",
            detection_count=4,
            distinct_vehicles_count=2,
            status="confirmed",
            first_detected_at=(now - timedelta(days=3)).isoformat(),
            last_detected_at=(now - timedelta(hours=2)).isoformat(),
            lat=20.5861,
            lon=-100.4082,
            is_live=False,
        ),
        RoadDamageItem(
            id="d0000000-0000-0000-0000-000000000002",
            damage_class="D20",
            severity_score=0.72,
            severity_level="high",
            detection_count=2,
            distinct_vehicles_count=1,
            status="validated",
            first_detected_at=(now - timedelta(days=5)).isoformat(),
            last_detected_at=(now - timedelta(days=1)).isoformat(),
            lat=20.5982,
            lon=-100.3755,
            is_live=False,
        ),
        RoadDamageItem(
            id="d0000000-0000-0000-0000-000000000003",
            damage_class="D10",
            severity_score=0.44,
            severity_level="medium",
            detection_count=1,
            distinct_vehicles_count=1,
            status="reported",
            first_detected_at=(now - timedelta(days=1)).isoformat(),
            last_detected_at=(now - timedelta(days=1)).isoformat(),
            lat=20.5835,
            lon=-100.3950,
            is_live=False,
        ),
        RoadDamageItem(
            id="d0000000-0000-0000-0000-000000000004",
            damage_class="D40",
            severity_score=0.795,
            severity_level="critical",
            detection_count=5,
            distinct_vehicles_count=3,
            status="in_repair",
            first_detected_at=(now - timedelta(days=7)).isoformat(),
            last_detected_at=(now - timedelta(hours=4)).isoformat(),
            lat=20.6920,
            lon=-100.4480,
            is_live=False,
        ),
    ]
    for d in defaults:
        _damages_cache[d.id] = d
    _persist_local_store()


def _persist_local_store():
    try:
        LOCAL_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        data = [d.model_dump() for d in _damages_cache.values()]
        LOCAL_STORE_PATH.write_text(json.dumps(data), encoding="utf-8")
    except Exception as e:
        logger.warning(f"Failed to persist local store: {e}")


def get_supabase_client():
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client

    if "placeholder" not in settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY:
        try:
            from supabase import create_client
            _supabase_client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
            return _supabase_client
        except Exception as e:
            logger.warning(f"Could not initialize supabase-py client: {e}")
    return None


def _supabase_headers() -> Dict[str, str]:
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    headers = {
        "apikey": key,
        "Content-Type": "application/json",
    }
    # Only attach Bearer token if it is a standard JWT (starts with eyJ)
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


def encode_crop_data_url(image: Image.Image) -> str:
    """
    Encodes a compact WebP thumbnail data URI (~4-8 KB) so the dashboard can render
    the exact road damage photo captured by the phone immediately.
    """
    thumb = image.copy()
    thumb.thumbnail((240, 240), Image.Resampling.BILINEAR)
    buf = io.BytesIO()
    thumb.save(buf, format="WEBP", quality=72)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/webp;base64,{b64}"


async def save_damage_crop(
    image: Image.Image,
    damage_id: UUID,
    frame_id: UUID
) -> Optional[str]:
    """
    Returns a compact inline WebP data URI thumbnail and optionally uploads to Supabase Storage.
    """
    data_url = encode_crop_data_url(image)

    client = get_supabase_client()
    if client:
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
        except Exception as e:
            logger.debug(f"Storage upload skipped/fallback to inline data URI: {e}")

    return data_url


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
    1. Performs 8-meter spatial deduplication in local persistent store.
    2. Invokes PostGIS `upsert_road_damage()` RPC in Supabase via REST API.
    """
    _seed_initial_damages()

    fid_str = str(frame_id)
    is_duplicate_frame = fid_str in _processed_frames
    _processed_frames.add(fid_str)

    # 1. Spatial deduplication within 8.0 meters in local cache
    matched_id: Optional[str] = None
    best_dist = 999999.0
    for existing in _damages_cache.values():
        if existing.damage_class == damage_class:
            dist = _haversine_meters(lat, lon, existing.lat, existing.lon)
            if dist <= 8.0 and dist < best_dist:
                best_dist = dist
                matched_id = existing.id

    if matched_id is not None:
        item = _damages_cache[matched_id]
        if not is_duplicate_frame:
            item.detection_count += 1
            if item.status == "reported" and item.detection_count >= 2:
                item.status = "confirmed"
        if severity_score > item.severity_score:
            item.severity_score = severity_score
            item.severity_level = severity_level  # type: ignore
        item.last_detected_at = captured_at_iso
        item.gps_accuracy_m = gps_accuracy_m
        item.speed_kmh = speed_kmh
        item.is_live = True
        if crop_storage_path:
            item.thumbnail_url = crop_storage_path
        damage_uuid = UUID(matched_id)
    else:
        damage_uuid = uuid4()
        new_item = RoadDamageItem(
            id=str(damage_uuid),
            damage_class=damage_class,  # type: ignore
            severity_score=severity_score,
            severity_level=severity_level,  # type: ignore
            detection_count=1,
            distinct_vehicles_count=1,
            status="reported",
            first_detected_at=captured_at_iso,
            last_detected_at=captured_at_iso,
            thumbnail_url=crop_storage_path,
            lat=round(lat, 6),
            lon=round(lon, 6),
            gps_accuracy_m=gps_accuracy_m,
            speed_kmh=speed_kmh,
            is_live=True,
        )
        _damages_cache[new_item.id] = new_item

    _persist_local_store()

    # 2. Sync with Supabase PostGIS RPC via direct HTTP (supports both sb_secret_ and eyJ keys)
    if "placeholder" not in settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY:
        rpc_url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/rpc/upsert_road_damage"
        payload = {
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
            "p_captured_at": captured_at_iso,
        }
        try:
            async with httpx.AsyncClient(timeout=8.0) as http_client:
                resp = await http_client.post(rpc_url, headers=_supabase_headers(), json=payload)
                if resp.status_code in (200, 201):
                    rpc_id = resp.json()
                    if isinstance(rpc_id, str) and len(rpc_id) == 36:
                        damage_uuid = UUID(rpc_id)
                else:
                    logger.warning(f"Supabase RPC status {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            logger.warning(f"Supabase HTTP RPC sync warning: {e}")

    return damage_uuid


async def list_road_damages() -> List[RoadDamageItem]:
    """
    Returns all deduplicated road damages sorted with live detections first, then by severity.
    Also merges rows from Supabase `road_damages` table decoding PostGIS WKB coordinates.
    """
    _seed_initial_damages()

    if "placeholder" not in settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY:
        rest_url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/road_damages?select=*&order=last_detected_at.desc&limit=100"
        try:
            async with httpx.AsyncClient(timeout=6.0) as http_client:
                resp = await http_client.get(rest_url, headers=_supabase_headers())
                if resp.status_code == 200:
                    rows = resp.json()
                    for r in rows:
                        rid = r.get("id")
                        if not rid or rid in _damages_cache:
                            continue
                        coords = None
                        loc = r.get("location")
                        if isinstance(loc, str):
                            coords = _parse_ewkb_point(loc)
                        elif isinstance(loc, dict) and "coordinates" in loc:
                            c = loc["coordinates"]
                            coords = (float(c[1]), float(c[0]))
                        if not coords:
                            continue
                        _damages_cache[rid] = RoadDamageItem(
                            id=rid,
                            damage_class=r.get("damage_class", "D40"),
                            severity_score=float(r.get("severity_score", 0.5)),
                            severity_level=r.get("severity_level", "medium"),
                            detection_count=int(r.get("detection_count", 1)),
                            distinct_vehicles_count=int(r.get("distinct_vehicles_count", 1)),
                            status=r.get("status", "reported"),
                            first_detected_at=r.get("first_detected_at", datetime.utcnow().isoformat()),
                            last_detected_at=r.get("last_detected_at", datetime.utcnow().isoformat()),
                            thumbnail_url=r.get("thumbnail_url"),
                            lat=coords[0],
                            lon=coords[1],
                            is_live=not rid.startswith("d0000000-"),
                        )
        except Exception as e:
            logger.debug(f"Supabase fetch merge skipped: {e}")

    items = list(_damages_cache.values())
    items.sort(key=lambda x: (x.is_live, x.last_detected_at, x.severity_score), reverse=True)
    return items


async def update_road_damage_status(damage_id: str, new_status: DamageStatus) -> Optional[RoadDamageItem]:
    _seed_initial_damages()
    item = _damages_cache.get(damage_id)
    if item:
        item.status = new_status
        _persist_local_store()

    if "placeholder" not in settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY:
        patch_url = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/road_damages?id=eq.{damage_id}"
        try:
            async with httpx.AsyncClient(timeout=6.0) as http_client:
                await http_client.patch(
                    patch_url,
                    headers=_supabase_headers(),
                    json={"status": new_status, "updated_at": datetime.utcnow().isoformat()},
                )
        except Exception as e:
            logger.debug(f"Supabase status update warning: {e}")

    return item


def get_tracked_damages_count() -> int:
    _seed_initial_damages()
    return len(_damages_cache)
