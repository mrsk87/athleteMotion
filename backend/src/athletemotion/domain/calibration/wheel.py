"""Calibração métrica e deteção de perspectiva (yaw) através da geometria da roda da bicicleta."""

from __future__ import annotations

import math
from collections.abc import Sequence

import cv2
import numpy as np

from athletemotion.domain.calibration.types import (
    CalibrationMethod,
    CalibrationWarning,
    ScaleCalibration,
    WarningSeverity,
)

# Diâmetros nominais externos padrão de rodas + pneus em milímetros (ISO 5775 / ETRTO)
WHEEL_DIAMETERS_MM: dict[str, float] = {
    "700c": 670.0,  # Estrada padrão 700x25c/28c
    "road": 670.0,
    "700x25c": 668.0,
    "700x28c": 674.0,
    "700x32c": 682.0,
    "gravel": 690.0,  # 700x38c
    "29_mtb": 740.0,  # 29 x 2.25
    "mtb": 740.0,
    "27.5_mtb": 700.0,
    "tt": 670.0,
}


def calibrate_from_wheel_ellipse(
    wheel_contour_or_points: np.ndarray | Sequence[tuple[float, float]],
    wheel_type: str = "700c",
) -> tuple[ScaleCalibration | None, list[CalibrationWarning]]:
    """Calcula a escala dimensional e o yaw da câmara através do ajuste de elipse à roda da bicicleta.

    O eixo maior da elipse é invariante a projeções oblíquas em plano sagital, permitindo
    determinar mm_per_px. A razão entre o eixo menor e o eixo maior (b / a) fornece o cos(yaw).

    Args:
        wheel_contour_or_points: Pontos de contorno da roda ou aro da bicicleta.
        wheel_type: Chave de tipo de roda (ex: '700c', 'road', '29_mtb').

    Returns:
        Tuplo (ScaleCalibration ou None, lista de CalibrationWarning).
    """
    warnings: list[CalibrationWarning] = []
    nominal_diameter_mm = WHEEL_DIAMETERS_MM.get(wheel_type.lower(), 670.0)

    pts = np.asarray(wheel_contour_or_points, dtype=np.float32)
    if pts.ndim == 2 and pts.shape[1] == 2:
        pts = pts.reshape((-1, 1, 2))

    if len(pts) < 15:
        warnings.append(
            CalibrationWarning(
                code="INSUFFICIENT_WHEEL_POINTS",
                severity=WarningSeverity.ERROR,
                message_pt="Contorno da roda possui poucos pontos para ajuste de elipse (< 15).",
                message_en="Wheel contour contains too few points for ellipse fitting (< 15).",
            )
        )
        return None, warnings

    try:
        ellipse = cv2.fitEllipse(pts)
        (_center_x, _center_y), (dim_w, dim_h), _angle_deg = ellipse
    except cv2.error as err:
        warnings.append(
            CalibrationWarning(
                code="ELLIPSE_FIT_ERROR",
                severity=WarningSeverity.ERROR,
                message_pt=f"Falha matemática no ajuste de elipse: {err}",
                message_en=f"Mathematical error during ellipse fitting: {err}",
            )
        )
        return None, warnings

    major_axis_px = max(dim_w, dim_h)
    minor_axis_px = min(dim_w, dim_h)

    if major_axis_px < 50.0:
        warnings.append(
            CalibrationWarning(
                code="WHEEL_TOO_SMALL",
                severity=WarningSeverity.ERROR,
                message_pt="Diâmetro da roda detetado é demasiado reduzido no enquadramento (< 50 px).",
                message_en="Detected wheel diameter is too small (< 50 px).",
            )
        )
        return None, warnings

    # Escala métrica calculada pelo eixo maior invariante
    mm_per_px = nominal_diameter_mm / major_axis_px

    # Estimação do ângulo de Yaw através do rácio dos eixos: cos(yaw) ≈ minor / major
    aspect_ratio = min(1.0, max(0.0, minor_axis_px / major_axis_px))
    yaw_rad = math.acos(aspect_ratio)
    yaw_deg = math.degrees(yaw_rad)

    # Incerteza com base na deformação elíptica e espessura do pneu
    uncertainty = mm_per_px * (0.02 + 0.05 * math.sin(yaw_rad))

    if yaw_deg > 8.0:
        warnings.append(
            CalibrationWarning(
                code="HIGH_YAW",
                severity=WarningSeverity.WARNING,
                message_pt=f"Desalinhamento perpendicular detetado pelo rácio da roda (yaw estimado = {yaw_deg:.1f}° > 8.0°).",
                message_en=f"Non-perpendicular view detected via wheel ratio (estimated yaw = {yaw_deg:.1f}° > 8.0°).",
                details={"aspect_ratio": aspect_ratio, "yaw_deg": yaw_deg},
            )
        )

    calibration = ScaleCalibration(
        mm_per_px=mm_per_px,
        method=CalibrationMethod.WHEEL,
        uncertainty_mm_per_px=uncertainty,
        plane_yaw_deg=yaw_deg,
        plane_roll_deg=0.0,
        warnings=warnings,
    )
    return calibration, warnings
