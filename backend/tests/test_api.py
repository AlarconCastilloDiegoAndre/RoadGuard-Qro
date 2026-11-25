import io
import json
from uuid import uuid4
from PIL import Image
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data
    assert "active_semaphore_slots" in data


def test_single_frame_inference_endpoint():
    # Create dummy 64x64 JPEG image in memory
    img = Image.new("RGB", (64, 64), color=(100, 100, 100))
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG")
    buffer.seek(0)

    meta = {
        "frame_id": str(uuid4()),
        "latitude": 20.5888,
        "longitude": -100.3899,
        "gps_accuracy_m": 5.0,
        "speed_kmh": 35.0
    }

    response = client.post(
        "/v1/inference/frame",
        files={"file": ("frame.jpg", buffer.getvalue(), "image/jpeg")},
        data={"metadata": json.dumps(meta)}
    )
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["frame_id"] == meta["frame_id"]
    assert "detections" in res_data


def test_batch_inference_endpoint():
    img = Image.new("RGB", (64, 64), color=(80, 80, 80))
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG")
    img_bytes = buffer.getvalue()

    meta_list = [
        {
            "frame_id": str(uuid4()),
            "latitude": 20.5888,
            "longitude": -100.3899,
            "gps_accuracy_m": 4.0,
            "speed_kmh": 30.0
        },
        {
            "frame_id": str(uuid4()),
            "latitude": 20.5890,
            "longitude": -100.3897,
            "gps_accuracy_m": 4.5,
            "speed_kmh": 32.0
        }
    ]

    response = client.post(
        "/v1/inference/batch",
        files=[
            ("files", ("f1.jpg", img_bytes, "image/jpeg")),
            ("files", ("f2.jpg", img_bytes, "image/jpeg"))
        ],
        data={"metadata_batch": json.dumps(meta_list)}
    )
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["total_frames"] == 2
    assert res_data["processed_frames"] == 2
