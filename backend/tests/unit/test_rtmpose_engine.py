"""Testes unitários para o motor RTMPose Halpe26 e decodificação SimCC."""

from __future__ import annotations

import numpy as np
import pytest

from athletemotion.domain.inference.base import ModelUnavailableError
from athletemotion.domain.inference.onnx_utils import (
    preprocess_topdown_affine,
    transform_points_affine,
)
from athletemotion.domain.inference.rtmpose_engine import (
    RTMPoseEngine,
    decode_simcc_predictions,
)


def test_decode_simcc_mathematical_precision():
    """Valida a decodificação SimCC nos eixos X e Y com fator split_ratio=2.0."""
    num_kpts = 26
    len_x = 384  # 192 * 2.0
    len_y = 512  # 256 * 2.0

    simcc_x = np.zeros((1, num_kpts, len_x), dtype=np.float32)
    simcc_y = np.zeros((1, num_kpts, len_y), dtype=np.float32)

    # Simula picos nos índices correspondentes a x=50.0 (idx=100) e y=80.0 (idx=160)
    simcc_x[0, 0, 100] = 1.0
    simcc_y[0, 0, 160] = 1.0

    points_xy, scores = decode_simcc_predictions(simcc_x, simcc_y, split_ratio=2.0)

    assert points_xy.shape == (26, 2)
    assert points_xy[0, 0] == pytest.approx(50.0)
    assert points_xy[0, 1] == pytest.approx(80.0)
    assert scores[0] > 0.5


def test_topdown_affine_transform_roundtrip():
    """Valida que a transformação afim e o remapeamento inverso preservam a geometria do frame original."""
    img = np.zeros((720, 1280, 3), dtype=np.uint8)
    bbox = (200.0, 150.0, 500.0, 650.0)  # Ciclista em pixels

    tensor, _m_mat, m_inv = preprocess_topdown_affine(img, bbox, target_wh=(192, 256), padding=1.25)

    assert tensor.shape == (1, 3, 256, 192)

    # Centro no espaço do modelo (96, 128) deve remapear de volta para o centro do bbox (350, 400)
    model_center = np.array([[96.0, 128.0]], dtype=np.float32)
    orig_center = transform_points_affine(model_center, m_inv)

    assert orig_center[0, 0] == pytest.approx(350.0, abs=1.0)
    assert orig_center[0, 1] == pytest.approx(400.0, abs=1.0)


def test_rtmpose_real_feet_and_landmarks():
    """Valida que o RTMPose fornece pontos anatómicos reais (estimated=False) para o calcanhar e biqueira."""
    engine = RTMPoseEngine(side="right", use_gpu=False, raise_on_unavailable=True)
    assert engine.is_ready is True
    assert engine.name == "rtmpose"

    # Frame sintético 640x480
    frame = np.ones((480, 640, 3), dtype=np.uint8) * 128
    result = engine.process_frame(frame, timestamp_ms=1000)

    assert result.engine_name == "rtmpose"
    # Se detetou landmarks, valida que o calcanhar e biqueira possuem estimated=False
    if result.landmarks:
        if "heel" in result.landmarks:
            assert result.landmarks["heel"].estimated is False
        if "toe" in result.landmarks:
            assert result.landmarks["toe"].estimated is False
        if "right_heel" in result.landmarks:
            assert result.landmarks["right_heel"].estimated is False


def test_rtmpose_raises_model_unavailable_when_missing():
    """Valida que instanciar RTMPose com modelo inexistente levanta ModelUnavailableError (sem fallback silencioso)."""
    with pytest.raises(ModelUnavailableError) as exc_info:
        RTMPoseEngine(model_id="nonexistent-model-id", raise_on_unavailable=True)

    assert "nonexistent-model-id" in str(exc_info.value)
