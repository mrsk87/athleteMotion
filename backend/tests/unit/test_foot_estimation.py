"""Testes unitários para estimativa biomecânica de pés (foot_estimation.py)."""

from athletemotion.domain.calculator import Point2D, calculate_safe_angle
from athletemotion.domain.inference.foot_estimation import (
    determine_facing_direction,
    estimate_foot,
)
from athletemotion.domain.inference.types import Landmark2D


def test_foot_estimation_marks_estimated_and_scaled_visibility():
    """Garante que calcâneo e biqueira recebem flag estimated=True e visibilidade reduzida."""
    w, h = 1920, 1080
    ankle = Landmark2D(x=0.5, y=0.8, visibility=0.8)
    knee = Landmark2D(x=0.5, y=0.5, visibility=0.9)

    foot = estimate_foot(ankle, knee, facing_right=True, tibia_px=300.0, w=w, h=h)

    assert "heel" in foot and "toe" in foot
    assert foot["heel"].estimated is True
    assert foot["toe"].estimated is True
    # Visibilidade deve ser metade do tornozelo
    assert abs(foot["heel"].visibility - 0.4) < 1e-4
    assert abs(foot["toe"].visibility - 0.4) < 1e-4


def test_foot_estimation_facing_directions():
    """Garante que a biqueira aponta na direção correta do movimento."""
    w, h = 1920, 1080
    ankle = Landmark2D(x=0.5, y=0.8, visibility=1.0)
    knee = Landmark2D(x=0.5, y=0.5, visibility=1.0)

    # Virado para a direita: toe.x > ankle.x e heel.x < ankle.x
    foot_right = estimate_foot(ankle, knee, facing_right=True, tibia_px=300.0, w=w, h=h)
    assert foot_right["toe"].x > ankle.x
    assert foot_right["heel"].x < ankle.x

    # Virado para a esquerda: toe.x < ankle.x e heel.x > ankle.x
    foot_left = estimate_foot(ankle, knee, facing_right=False, tibia_px=300.0, w=w, h=h)
    assert foot_left["toe"].x < ankle.x
    assert foot_left["heel"].x > ankle.x


def test_foot_estimation_scale_invariance_for_ankle_angle():
    """Invariância de escala: mesma pose a distâncias diferentes produz mesmo ângulo de tornozelo (< 1°)."""
    w, h = 1920, 1080

    # Cenário A: Ciclista próximo (tíbia grande = 400 px)
    knee_px_a = (960.0, 300.0)
    ankle_px_a = (960.0, 700.0)
    tibia_px_a = 400.0

    knee_a = Landmark2D(x=knee_px_a[0] / w, y=knee_px_a[1] / h, visibility=1.0)
    ankle_a = Landmark2D(x=ankle_px_a[0] / w, y=ankle_px_a[1] / h, visibility=1.0)

    foot_a = estimate_foot(
        ankle_a, knee_a, facing_right=True, tibia_px=tibia_px_a, w=w, h=h
    )
    toe_px_a = (foot_a["toe"].x * w, foot_a["toe"].y * h)

    angle_a = calculate_safe_angle(
        Point2D(knee_px_a[0], knee_px_a[1]),
        Point2D(ankle_px_a[0], ankle_px_a[1]),
        Point2D(toe_px_a[0], toe_px_a[1]),
    )

    # Cenário B: Ciclista afastado (tíbia reduzida para metade = 200 px)
    knee_px_b = (960.0, 450.0)
    ankle_px_b = (960.0, 650.0)
    tibia_px_b = 200.0

    knee_b = Landmark2D(x=knee_px_b[0] / w, y=knee_px_b[1] / h, visibility=1.0)
    ankle_b = Landmark2D(x=ankle_px_b[0] / w, y=ankle_px_b[1] / h, visibility=1.0)

    foot_b = estimate_foot(
        ankle_b, knee_b, facing_right=True, tibia_px=tibia_px_b, w=w, h=h
    )
    toe_px_b = (foot_b["toe"].x * w, foot_b["toe"].y * h)

    angle_b = calculate_safe_angle(
        Point2D(knee_px_b[0], knee_px_b[1]),
        Point2D(ankle_px_b[0], ankle_px_b[1]),
        Point2D(toe_px_b[0], toe_px_b[1]),
    )

    # Variação deve ser praticamente nula (bem inferior a 1.0°)
    assert abs(angle_a - angle_b) < 0.1, f"Diferença de escala: {angle_a} vs {angle_b}"


def test_determine_facing_direction():
    """Garante que a deteção de sentido de movimento funciona com ombro e anca."""
    lms_right = {
        "shoulder": Landmark2D(x=0.6, y=0.3, visibility=0.9),
        "hip": Landmark2D(x=0.4, y=0.5, visibility=0.9),
    }
    assert determine_facing_direction(lms_right) is True

    lms_left = {
        "shoulder": Landmark2D(x=0.3, y=0.3, visibility=0.9),
        "hip": Landmark2D(x=0.5, y=0.5, visibility=0.9),
    }
    assert determine_facing_direction(lms_left) is False
