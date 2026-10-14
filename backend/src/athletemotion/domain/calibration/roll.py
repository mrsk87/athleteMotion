"""Deteção e compensação de rotação (roll) da câmara em relação ao plano horizontal de referência."""

from __future__ import annotations

import math
from collections.abc import Sequence

from athletemotion.domain.calibration.types import (
    CalibrationWarning,
    WarningSeverity,
)


def estimate_roll_from_line(
    point_a: tuple[float, float],
    point_b: tuple[float, float],
) -> float:
    """Calcula o ângulo de roll (em graus) a partir de uma linha de referência horizontal (chão, trainer ou nível).

    Args:
        point_a: Coordenadas (x, y) do ponto esquerdo.
        point_b: Coordenadas (x, y) do ponto direito.

    Returns:
        Ângulo em graus. Ângulo positivo indica rotação horária.
    """
    dx = point_b[0] - point_a[0]
    dy = point_b[1] - point_a[1]
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return 0.0
    return math.degrees(math.atan2(dy, dx))


def correct_roll_points(
    points: Sequence[tuple[float, float]],
    roll_deg: float,
    origin: tuple[float, float] = (0.0, 0.0),
) -> list[tuple[float, float]]:
    """Aplica rotação inversa de compensação de roll a uma lista de pontos em torno da origem especificada.

    Args:
        points: Lista de coordenadas (x, y).
        roll_deg: Ângulo de inclinação em graus a compensar.
        origin: Centro de rotação (por padrão o canto superior esquerdo ou centro da imagem).

    Returns:
        Lista de coordenadas niveladas com a horizontal física.
    """
    if abs(roll_deg) < 1e-4 or not points:
        return list(points)

    rad = math.radians(-roll_deg)
    cos_a = math.cos(rad)
    sin_a = math.sin(rad)
    ox, oy = origin

    corrected: list[tuple[float, float]] = []
    for x, y in points:
        tx = x - ox
        ty = y - oy
        rx = tx * cos_a - ty * sin_a + ox
        ry = tx * sin_a + ty * cos_a + oy
        corrected.append((float(rx), float(ry)))

    return corrected


def generate_alignment_warnings(
    roll_deg: float,
    yaw_deg: float,
    has_marker: bool = True,
    has_lens_profile: bool = True,
) -> list[CalibrationWarning]:
    """Emite alertas estruturados caso os limiares de posicionamento e calibração sejam ultrapassados."""
    warnings: list[CalibrationWarning] = []

    if abs(roll_deg) > 3.0:
        warnings.append(
            CalibrationWarning(
                code="HIGH_ROLL",
                severity=WarningSeverity.WARNING,
                message_pt=f"A câmara apresenta inclinação de roll excessiva ({roll_deg:.1f}° > 3.0°). Nivele o tripé.",
                message_en=f"Excessive camera roll tilt detected ({roll_deg:.1f}° > 3.0°). Level the tripod.",
                details={"roll_deg": roll_deg},
            )
        )

    if abs(yaw_deg) > 8.0:
        warnings.append(
            CalibrationWarning(
                code="HIGH_YAW",
                severity=WarningSeverity.WARNING,
                message_pt=f"A câmara não se encontra perpendicular ao plano de pedalada ({yaw_deg:.1f}° > 8.0°).",
                message_en=f"Camera is not perpendicular to sagittal pedaling plane ({yaw_deg:.1f}° > 8.0°).",
                details={"yaw_deg": yaw_deg},
            )
        )

    if not has_marker:
        warnings.append(
            CalibrationWarning(
                code="MISSING_SCALE_CALIBRATION",
                severity=WarningSeverity.INFO,
                message_pt="Escala métrica ausente. Medidas milimétricas absolutas não poderão ser emitidas.",
                message_en="Metric scale missing. Absolute millimeter measurements cannot be emitted.",
            )
        )

    if not has_lens_profile:
        warnings.append(
            CalibrationWarning(
                code="MISSING_LENS_PROFILE",
                severity=WarningSeverity.INFO,
                message_pt="Perfil de lente ausente. Coordenadas não compensam distorção radial da lente.",
                message_en="Lens profile missing. Coordinates do not compensate for radial lens distortion.",
            )
        )

    return warnings
