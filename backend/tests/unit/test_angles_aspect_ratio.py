"""Testes de regressão: cálculo de ângulos biomecânicos invariante ao aspect ratio.

Verifica que coordenadas de pose normalizadas [0, 1] são convertidas para
pixels antes do cálculo trigonométrico, eliminando a distorção introduzida
por resoluções não quadradas (ex.: 16:9, 1920x1080).
"""

import math

from athletemotion.domain.biomechanics.angles import (
    compute_joint_angles,
    to_pixels,
)
from athletemotion.domain.calculator import Point2D, calculate_safe_angle
from athletemotion.domain.inference.types import Landmark2D


def _make_150_deg_leg_pixels(
    w: int, h: int, knee_px: tuple[float, float] = (960.0, 540.0), length: float = 400.0
) -> dict[str, Landmark2D]:
    """Cria marcos normalizados onde o ângulo no joelho em pixels é exatamente 150.0 graus."""
    bx, by = knee_px
    # Vetor BA (fémur): 110 graus em relação à horizontal
    ax = bx + length * math.cos(math.radians(110))
    ay = by - length * math.sin(math.radians(110))

    # Vetor BC (tíbia): 110 - 150 = -40 graus
    cx = bx + length * math.cos(math.radians(-40))
    cy = by - length * math.sin(math.radians(-40))

    # Verificar que o ângulo puro em pixels é exatamente 150.0°
    p_knee = calculate_safe_angle(Point2D(ax, ay), Point2D(bx, by), Point2D(cx, cy))
    assert abs(p_knee - 150.0) < 0.05, f"Ângulo gerado deve ser 150°, obtido {p_knee}"

    # Retorna em coordenadas normalizadas [0, 1]
    return {
        "hip": Landmark2D(x=ax / w, y=ay / h, visibility=0.9),
        "knee": Landmark2D(x=bx / w, y=by / h, visibility=0.9),
        "ankle": Landmark2D(x=cx / w, y=cy / h, visibility=0.9),
    }


def test_legacy_mediapipe_normalized_coords_distorts_16_9():
    """Demonstra que o cálculo sobre coordenadas normalizadas falha em 16:9.

    Este teste documenta a falha do código legado antes da correção de R02.
    """
    w, h = 1920, 1080
    landmarks = _make_150_deg_leg_pixels(w, h)

    # Cálculo direto com pontos normalizados (método legado do mediapipe_engine.py)
    distorted_angle = calculate_safe_angle(
        Point2D(landmarks["hip"].x, landmarks["hip"].y),
        Point2D(landmarks["knee"].x, landmarks["knee"].y),
        Point2D(landmarks["ankle"].x, landmarks["ankle"].y),
    )

    # Em 16:9, a distorção é superior a 5 graus! (esperado ~157.7°)
    assert abs(distorted_angle - 150.0) > 5.0
    assert abs(distorted_angle - 157.7) < 0.5


def test_compute_joint_angles_aspect_ratio_invariance():
    """compute_joint_angles deve devolver 150.0° +- 0.1° tanto em 16:9 como em 1:1."""
    # 1. Resolução panorâmica 16:9 (1920x1080)
    w_16_9, h_16_9 = 1920, 1080
    lms_16_9 = _make_150_deg_leg_pixels(w_16_9, h_16_9)
    angles_16_9 = compute_joint_angles(lms_16_9, w_16_9, h_16_9)

    assert angles_16_9.knee is not None
    assert abs(angles_16_9.knee - 150.0) <= 0.1

    # 2. Resolução quadrada 1:1 (1080x1080)
    w_1_1, h_1_1 = 1080, 1080
    lms_1_1 = _make_150_deg_leg_pixels(
        w_1_1, h_1_1, knee_px=(540.0, 540.0), length=300.0
    )
    angles_1_1 = compute_joint_angles(lms_1_1, w_1_1, h_1_1)

    assert angles_1_1.knee is not None
    assert abs(angles_1_1.knee - 150.0) <= 0.1


def test_compute_joint_angles_returns_none_on_low_visibility():
    """Ângulos devem ser None quando a visibilidade de qualquer ponto é inferior ao limiar."""
    w, h = 1920, 1080
    lms = _make_150_deg_leg_pixels(w, h)
    # Baixar visibilidade do tornozelo para 0.15 (< 0.20)
    lms["ankle"].visibility = 0.15

    angles = compute_joint_angles(lms, w, h, min_visibility=0.20)
    assert angles.knee is None


def test_to_pixels_converts_correctly():
    """to_pixels deve converter corretamente normalizados para coordenadas de píxeis."""
    w, h = 1920, 1080
    lms = {
        "knee": Landmark2D(x=0.5, y=0.25, visibility=1.0),
    }
    pts = to_pixels(lms, w, h)
    assert pts["knee"].x == 960.0
    assert pts["knee"].y == 270.0
