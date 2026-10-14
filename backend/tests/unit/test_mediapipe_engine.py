"""Testes unitários para o motor MediaPipe Pose e validação biomecânica."""

import numpy as np

from athletemotion.domain.inference.mediapipe_engine import MediaPipePoseEngine
from athletemotion.domain.inference.types import Landmark2D


def test_mediapipe_engine_instantiation_and_side():
    engine = MediaPipePoseEngine(side="right")
    assert engine.name == "mediapipe"
    assert engine.side == "right"
    assert engine.model_complexity == 2

    engine.set_side("left")
    assert engine.side == "left"


def test_mediapipe_rigid_segment_validation():
    engine = MediaPipePoseEngine(side="right")

    # Criar histórico de medições estáveis (femur = 0.3, tibia = 0.3)
    hip = Landmark2D(x=0.5, y=0.3, z=0.0, visibility=1.0)
    knee = Landmark2D(x=0.5, y=0.6, z=0.0, visibility=1.0)
    ankle = Landmark2D(x=0.5, y=0.9, z=0.0, visibility=1.0)

    for _ in range(6):
        val, is_valid = engine._validate_rigid_segments(hip, knee, ankle)
        assert is_valid is True
        assert val.femur_valid is True
        assert val.tibia_valid is True

    # Introduzir anomalia: salto súbito no joelho que encurta o fémur em > 20%
    anomalous_knee = Landmark2D(
        x=0.5, y=0.38, z=0.0, visibility=1.0
    )  # femur agora = 0.08 vs 0.30 (deformação > 70%)
    val_anomaly, is_valid_anomaly = engine._validate_rigid_segments(hip, anomalous_knee, ankle)

    assert is_valid_anomaly is False
    assert val_anomaly.femur_valid is False
    assert val_anomaly.segment_error_pct > 12.0


def test_mediapipe_synthetic_frame_processing():
    engine = MediaPipePoseEngine(side="right")
    # Frame preto sintético de 640x480
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    output = engine.process_frame(frame, timestamp_ms=100)

    assert output.engine_name == "mediapipe"
    assert output.side == "right"
    assert output.timestamp_ms == 100
    assert isinstance(output.landmarks, dict)
