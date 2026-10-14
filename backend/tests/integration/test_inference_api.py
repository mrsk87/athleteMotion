"""Testes de integração para as rotas REST e WebSocket de inferência postural."""

import struct

import cv2
import numpy as np
from fastapi.testclient import TestClient

from athletemotion.api.app import app
from athletemotion.api.security.auth import get_or_create_api_token

client = TestClient(app, headers={"Authorization": f"Bearer {get_or_create_api_token()}"})


def test_list_inference_engines():
    response = client.get("/api/v1/inference/engines")
    assert response.status_code == 200
    data = response.json()
    assert "active_engine" in data
    assert "available_engines" in data
    assert "directml_available" in data

    engine_names = [e["name"] for e in data["available_engines"]]
    assert "mediapipe" in engine_names
    assert "yolo11_pose" in engine_names
    assert "rtmpose" in engine_names
    assert "opencv_markers" in engine_names

    # Validação R13 de metadados honestos
    rtm = next(e for e in data["available_engines"] if e["name"] == "rtmpose")
    assert rtm["available"] is True
    assert rtm["model_verified"] is True
    assert rtm["license"] == "Apache-2.0"
    assert "provider_actual" in rtm

    yolo = next(e for e in data["available_engines"] if e["name"] == "yolo11_pose")
    assert yolo["license"] == "AGPL-3.0"


def test_switch_inference_engine():
    # Trocar para mediapipe no lado esquerdo
    response = client.post(
        "/api/v1/inference/engine/switch",
        json={"engine": "mediapipe", "side": "left", "smoothing": "one_euro"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["active_engine"] == "mediapipe"
    assert data["active_side"] == "left"

    # Trocar para rtmpose no lado direito
    response3 = client.post(
        "/api/v1/inference/engine/switch",
        json={"engine": "rtmpose", "side": "right", "smoothing": "one_euro"},
    )
    assert response3.status_code == 200
    assert response3.json()["active_engine"] == "rtmpose"


def test_websocket_live_inference():
    # Gerar uma imagem JPEG de teste
    test_img = np.zeros((240, 320, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", test_img)
    jpeg_bytes = encoded.tobytes()

    timestamp_ms = 1500
    header = struct.pack(">I", timestamp_ms)
    payload = header + jpeg_bytes

    with client.websocket_connect("/ws/live-inference") as ws:
        # Enviar comando de texto para fixar o lado
        ws.send_text('{"type": "set_side", "side": "right"}')
        resp_text = ws.receive_json()
        assert resp_text["status"] == "ok"
        assert resp_text["side_updated"] == "right"

        # Enviar frame binário
        ws.send_bytes(payload)
        telemetry = ws.receive_json()

        assert "engine_name" in telemetry
        assert "timestamp_ms" in telemetry
        assert telemetry["timestamp_ms"] == 1500
        assert "landmarks" in telemetry
        assert "angles" in telemetry
        assert "validation" in telemetry
