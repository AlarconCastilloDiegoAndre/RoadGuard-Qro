import pytest
from datetime import datetime
from uuid import uuid4
from backend.app.schemas import (
    FrameMetadata, NormalizedBBox, DetectionResult
)


def test_frame_metadata_validation():
    fid = uuid4()
    meta = FrameMetadata(
        frame_id=fid,
        latitude=20.5888,
        longitude=-100.3899,
        gps_accuracy_m=4.5,
        speed_kmh=42.0,
        heading_deg=180.0
    )
    assert meta.frame_id == fid
    assert meta.latitude == 20.5888
    assert meta.gps_accuracy_m == 4.5


def test_invalid_gps_coordinates():
    with pytest.raises(Exception):
        FrameMetadata(
            frame_id=uuid4(),
            latitude=120.0,  # Invalid latitude > 90
            longitude=-100.0,
            gps_accuracy_m=5.0
        )


def test_bbox_bounds():
    bbox = NormalizedBBox(cx=0.5, cy=0.5, w=0.2, h=0.2)
    assert bbox.cx == 0.5

    with pytest.raises(Exception):
        NormalizedBBox(cx=1.5, cy=0.5, w=0.2, h=0.2)  # Invalid cx > 1.0
