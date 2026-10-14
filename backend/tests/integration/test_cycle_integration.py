"""Testes de integração para deteção de ciclos de pedalada na API (R10).

Valida:
1. complete_fit_session com histórico de landmarks executa BatchCycleDetector e armazena métricas.
2. complete_fit_session com snapshots esparsos reverte graciosamente para manual_snapshots.
3. Sessão WS de inferência inclui is_bdc, is_tdc e clock_position no payload JSON retornado.
"""

from __future__ import annotations

import json
import uuid

import numpy as np
import pytest
from fastapi.testclient import TestClient

from athletemotion.api.app import app
from athletemotion.infrastructure.database import (
    AthleteModel,
    BikeModel,
    FitSessionModel,
    PostureSnapshotModel,
)
from athletemotion.infrastructure.uow import unit_of_work
from tests.fixtures.synthetic_pedaling import synthetic_pedaling


@pytest.fixture
def test_athlete_and_bike(client: TestClient):
    with unit_of_work() as session:
        athlete = AthleteModel(
            id=str(uuid.uuid4()),
            name="Ciclista Teste Ciclos",
            email=f"ciclos_{uuid.uuid4().hex[:6]}@example.com",
            height_cm=180.0,
            inseam_cm=84.0,
        )
        bike = BikeModel(
            id=str(uuid.uuid4()),
            athlete_id=athlete.id,
            brand_model="Specialized Tarmac",
            bike_type="road",
            current_saddle_height_cm=74.5,
        )
        session.add(athlete)
        session.add(bike)
        session.flush()
        return athlete.id, bike.id


def test_complete_fit_session_with_cycle_detection(client: TestClient, test_athlete_and_bike):
    athlete_id, bike_id = test_athlete_and_bike

    # Criar sessão
    res = client.post(
        "/api/v1/sessions",
        json={"athlete_id": athlete_id, "bike_id": bike_id},
    )
    assert res.status_code == 201
    session_id = res.json()["id"]

    # Gerar dados sintéticos de 10 segundos a 80 RPM (aprox 13 ciclos)
    synth = synthetic_pedaling(rpm=80.0, fps=60.0, duration_s=6.0, noise_std=0.5, knee_bdc=148.0)

    # Inserir snapshots com raw_landmarks_json
    with unit_of_work() as session:
        for i in range(0, len(synth.timestamps_ms), 2):  # Amostrar a cada 2 frames (~30 fps)
            lm_dict = {
                "ankle": {
                    "x": float(synth.ankle_points[i, 0]),
                    "y": float(synth.ankle_points[i, 1]),
                    "visibility": float(synth.visibilities[i]),
                },
                "knee": {
                    "x": float(synth.knee_points[i, 0]),
                    "y": float(synth.knee_points[i, 1]),
                    "visibility": 1.0,
                },
            }
            snap = PostureSnapshotModel(
                session_id=session_id,
                frame_index=i,
                knee_angle=float(synth.knee_angles[i]),
                back_angle=45.0,
                arm_angle=90.0,
                ankle_angle=100.0,
                is_compliant=True,
                raw_landmarks_json=json.dumps(lm_dict),
            )
            session.add(snap)

    # Finalizar sessão
    complete_res = client.post(f"/api/v1/sessions/{session_id}/complete")
    assert complete_res.status_code == 200
    data = complete_res.json()

    # Verificar que o ângulo médio de joelho reportado é próximo da verdade-terreno do BDC (~148 graus)
    assert data["measured_avg_knee_angle"] is not None
    assert abs(data["measured_avg_knee_angle"] - 148.0) <= 2.5

    # Verificar persistência de summary_json com métricas de ciclo
    with unit_of_work() as session:
        fit = session.query(FitSessionModel).filter_by(id=session_id).first()
        assert fit is not None
        assert fit.summary_json is not None
        summary = json.loads(fit.summary_json)
        assert summary["source"] == "cycle_detection"
        assert summary["cycle_detection"] is not None
        assert summary["cycle_detection"]["valid_cycles_count"] >= 5
        assert summary["cycle_detection"]["cadence_rpm_mean"] > 70.0


def test_complete_fit_session_sparse_fallback(client: TestClient, test_athlete_and_bike):
    athlete_id, bike_id = test_athlete_and_bike

    # Criar sessão
    res = client.post(
        "/api/v1/sessions",
        json={"athlete_id": athlete_id, "bike_id": bike_id},
    )
    session_id = res.json()["id"]

    # Inserir apenas 2 snapshots sem marcos suficientes
    with unit_of_work() as session:
        for i, angle in enumerate([142.0, 144.0]):
            snap = PostureSnapshotModel(
                session_id=session_id,
                frame_index=i,
                knee_angle=angle,
                back_angle=45.0,
                arm_angle=90.0,
                ankle_angle=100.0,
                is_compliant=True,
                raw_landmarks_json=None,
            )
            session.add(snap)

    complete_res = client.post(f"/api/v1/sessions/{session_id}/complete")
    assert complete_res.status_code == 200
    data = complete_res.json()

    assert data["measured_avg_knee_angle"] == 143.0

    with unit_of_work() as session:
        fit = session.query(FitSessionModel).filter_by(id=session_id).first()
        summary = json.loads(fit.summary_json)
        assert summary["source"] == "manual_snapshots"
        assert summary["cycle_detection"] is None


def test_ws_telemetry_includes_cycle_fields():
    """Valida que o WebSocket emite is_bdc, is_tdc e clock_position no payload JSON retornado."""
    import struct

    import cv2

    from athletemotion.api.security.auth import get_or_create_api_token

    client = TestClient(app)
    token = get_or_create_api_token()
    headers = {"Authorization": f"Bearer {token}"}

    with client.websocket_connect("/ws/live-inference", headers=headers) as ws:
        img = np.zeros((120, 120, 3), dtype=np.uint8)
        _, encoded = cv2.imencode(".jpg", img)
        header = struct.pack(">I", 100)
        raw_msg = header + encoded.tobytes()

        ws.send_bytes(raw_msg)
        telemetry = ws.receive_json()

        assert "is_bdc" in telemetry
        assert "is_tdc" in telemetry
        assert "clock_position" in telemetry
        assert isinstance(telemetry["is_bdc"], bool)
        assert isinstance(telemetry["is_tdc"], bool)
        assert isinstance(telemetry["clock_position"], str)

