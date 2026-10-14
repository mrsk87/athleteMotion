"""Calibração métrica auxiliar baseada no raio de rotação da pedivela da bicicleta."""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np

from athletemotion.domain.calibration.types import (
    CalibrationMethod,
    CalibrationWarning,
    ScaleCalibration,
    WarningSeverity,
)


def calibrate_from_crank_endpoints(
    front_pos_px: tuple[float, float],
    rear_pos_px: tuple[float, float],
    crank_length_mm: float = 172.5,
) -> tuple[ScaleCalibration | None, list[CalibrationWarning]]:
    """Calcula a escala a partir de duas posições opostas da pedalada (ex.: 3h e 9h no mostrador).

    A distância entre o ponto mais avançado e o mais recuado equivale a 2 * crank_length_mm.

    Args:
        front_pos_px: Coordenadas (x, y) no ponto de avanço máximo (3h).
        rear_pos_px: Coordenadas (x, y) no ponto de recuo máximo (9h).
        crank_length_mm: Comprimento nominal do braço do pedivela em mm (padrão 172.5 mm).

    Returns:
        Tuplo (ScaleCalibration ou None, lista de CalibrationWarning).
    """
    warnings: list[CalibrationWarning] = []

    dx = front_pos_px[0] - rear_pos_px[0]
    dy = front_pos_px[1] - rear_pos_px[1]
    diameter_px = math.hypot(dx, dy)

    if diameter_px < 20.0:
        warnings.append(
            CalibrationWarning(
                code="CRANK_POINTS_TOO_CLOSE",
                severity=WarningSeverity.ERROR,
                message_pt="A distância entre os pontos de pedivela é insuficiente para calibração (< 20 px).",
                message_en="Distance between crank endpoints is too small for calibration (< 20 px).",
            )
        )
        return None, warnings

    nominal_diameter_mm = 2.0 * crank_length_mm
    mm_per_px = nominal_diameter_mm / diameter_px

    # Inclinação entre os dois pontos em relação à horizontal
    roll_deg = math.degrees(math.atan2(dy, dx))

    # O método de pedivela possui maior incerteza inerente (~6% devido à variabilidade de rotação do tornozelo)
    uncertainty = mm_per_px * 0.06

    warnings.append(
        CalibrationWarning(
            code="AUXILIARY_METHOD_WARNING",
            severity=WarningSeverity.INFO,
            message_pt="Calibração por pedivela tem incerteza superior (±6%). Para maior precisão utilize marcador ArUco.",
            message_en="Crank calibration carries higher uncertainty (±6%). Use ArUco for high precision.",
        )
    )

    if abs(roll_deg) > 10.0:
        warnings.append(
            CalibrationWarning(
                code="CRANK_AXIS_TILTED",
                severity=WarningSeverity.WARNING,
                message_pt=f"Eixo 3h-9h da pedivela com inclinação elevada ({roll_deg:.1f}°).",
                message_en=f"Crank 3h-9h axis has significant tilt ({roll_deg:.1f}°).",
                details={"tilt_deg": roll_deg},
            )
        )

    calibration = ScaleCalibration(
        mm_per_px=mm_per_px,
        method=CalibrationMethod.CRANK,
        uncertainty_mm_per_px=uncertainty,
        plane_roll_deg=roll_deg,
        warnings=warnings,
    )
    return calibration, warnings


def calibrate_from_crank_trajectory(
    pedal_samples_px: Sequence[tuple[float, float]],
    crank_length_mm: float = 172.5,
) -> tuple[ScaleCalibration | None, list[CalibrationWarning]]:
    """Calcula a escala ajustando um círculo à nuvem de pontos da trajetória circular do pedal."""
    warnings: list[CalibrationWarning] = []

    if len(pedal_samples_px) < 8:
        warnings.append(
            CalibrationWarning(
                code="INSUFFICIENT_CRANK_POINTS",
                severity=WarningSeverity.ERROR,
                message_pt="São necessários pelo menos 8 pontos ao longo da pedalada para estimar o círculo da pedivela.",
                message_en="At least 8 pedal path points are required to fit a crank circle.",
            )
        )
        return None, warnings

    pts = np.asarray(pedal_samples_px, dtype=np.float64)
    x = pts[:, 0]
    y = pts[:, 1]

    # Ajuste algébrico de círculo pelo método linear de mínimos quadrados
    # x^2 + y^2 + a*x + b*y + c = 0
    A = np.column_stack([x, y, np.ones_like(x)])
    f = -(x**2 + y**2)

    try:
        sol, _residuals, _, _ = np.linalg.lstsq(A, f, rcond=None)
        a, b, c = sol
        center_x = -a / 2.0
        center_y = -b / 2.0
        rad_sq = center_x**2 + center_y**2 - c
        if rad_sq <= 0:
            raise ValueError("Raio negativo no ajuste de círculo")
        radius_px = math.sqrt(rad_sq)
    except Exception:
        warnings.append(
            CalibrationWarning(
                code="CIRCLE_FIT_FAILED",
                severity=WarningSeverity.ERROR,
                message_pt="Falha ao ajustar trajetória circular aos pontos do pedal.",
                message_en="Failed to fit circular trajectory to pedal points.",
            )
        )
        return None, warnings

    if radius_px < 15.0:
        warnings.append(
            CalibrationWarning(
                code="RADIUS_TOO_SMALL",
                severity=WarningSeverity.ERROR,
                message_pt="Raio da pedivela calculado é demasiado pequeno (< 15 px).",
                message_en="Estimated crank radius is too small (< 15 px).",
            )
        )
        return None, warnings

    mm_per_px = crank_length_mm / radius_px
    uncertainty = mm_per_px * 0.05

    warnings.append(
        CalibrationWarning(
            code="AUXILIARY_METHOD_WARNING",
            severity=WarningSeverity.INFO,
            message_pt="Calibração por pedivela tem incerteza de ±5%.",
            message_en="Crank calibration carries ±5% uncertainty.",
        )
    )

    calibration = ScaleCalibration(
        mm_per_px=mm_per_px,
        method=CalibrationMethod.CRANK,
        uncertainty_mm_per_px=uncertainty,
        warnings=warnings,
    )
    return calibration, warnings
