"""Testes de integração REST para os endpoints de calibração espacial e ótica (R11)."""

from __future__ import annotations

import io

import cv2
from fastapi.testclient import TestClient

from athletemotion.domain.calibration.selftest import generate_synthetic_aruco_scene


def test_calibrate_scale_api_success(client: TestClient):
    """POST /api/v1/calibration/scale aceita frame com ArUco e devolve escala e avisos estruturados."""
    img = generate_synthetic_aruco_scene(marker_id=0, marker_side_px=200, rotation_deg=0.0)
    success, encoded = cv2.imencode(".jpg", img)
    assert success is True

    file_bytes = io.BytesIO(encoded.tobytes())
    files = {"file": ("calibration_frame.jpg", file_bytes, "image/jpeg")}

    response = client.post(
        "/api/v1/calibration/scale",
        files=files,
        params={"marker_length_mm": 100.0},
    )
    assert response.status_code == 200
    data = response.json()

    assert data["method"] == "aruco"
    # 100 mm / 200 px = 0.500 mm/px
    assert abs(data["mm_per_px"] - 0.50) / 0.50 < 0.01
    assert data["uncertainty_mm_per_px"] > 0.0
    assert data["is_perpendicular"] is True
    assert isinstance(data["warnings"], list)


def test_calibrate_scale_api_marker_not_found_422(client: TestClient):
    """POST /api/v1/calibration/scale falha com 422 caso o fotograma não contenha marcador."""
    blank = generate_synthetic_aruco_scene()
    # Pinta tudo de cinzento claro cobrindo o marcador
    blank[:] = 240
    success, encoded = cv2.imencode(".jpg", blank)
    assert success is True

    file_bytes = io.BytesIO(encoded.tobytes())
    files = {"file": ("blank_frame.jpg", file_bytes, "image/jpeg")}

    response = client.post("/api/v1/calibration/scale", files=files)
    assert response.status_code == 422
    assert "Não foi possível calibrar a escala" in response.json()["detail"]


def test_list_and_get_camera_profiles(client: TestClient):
    """Listagem e consulta de perfil de câmara inexistente devolve 404."""
    res_list = client.get("/api/v1/calibration/profiles")
    assert res_list.status_code == 200
    assert isinstance(res_list.json(), list)

    res_get = client.get(
        "/api/v1/calibration/profiles/non_existent_camera",
        params={"width": 1920, "height": 1080},
    )
    assert res_get.status_code == 404
