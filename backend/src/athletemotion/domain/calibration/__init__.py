"""Módulo de calibração espacial, escala dimensional e correção ótica."""

from athletemotion.domain.calibration.aruco import detect_aruco_scale
from athletemotion.domain.calibration.crank import (
    calibrate_from_crank_endpoints,
    calibrate_from_crank_trajectory,
)
from athletemotion.domain.calibration.lens import calibrate_lens, undistort_points
from athletemotion.domain.calibration.roll import (
    correct_roll_points,
    estimate_roll_from_line,
    generate_alignment_warnings,
)
from athletemotion.domain.calibration.scale import CoordinateTransformer
from athletemotion.domain.calibration.types import (
    CalibrationMethod,
    CalibrationWarning,
    LensProfile,
    ScaleCalibration,
    WarningSeverity,
)
from athletemotion.domain.calibration.wheel import (
    WHEEL_DIAMETERS_MM,
    calibrate_from_wheel_ellipse,
)

__all__ = [
    "WHEEL_DIAMETERS_MM",
    "CalibrationMethod",
    "CalibrationWarning",
    "CoordinateTransformer",
    "LensProfile",
    "ScaleCalibration",
    "WarningSeverity",
    "calibrate_from_crank_endpoints",
    "calibrate_from_crank_trajectory",
    "calibrate_from_wheel_ellipse",
    "calibrate_lens",
    "correct_roll_points",
    "detect_aruco_scale",
    "estimate_roll_from_line",
    "generate_alignment_warnings",
    "undistort_points",
]
