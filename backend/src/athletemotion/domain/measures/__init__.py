"""Subdomínio de medidas biomecânicas avançadas, qualidade e vista frontal de BikeFit.

Sem qualquer dependência de frameworks web ou ORM.
"""

from __future__ import annotations

from .confidence import (
    GATING_THRESHOLD,
    MeasureConfidence,
    calculate_measure_confidence,
)
from .fatigue import (
    FatigueMetricDrift,
    FatigueReport,
    analyze_session_fatigue,
    evaluate_metric_drift,
)
from .frontal import (
    FrontalKneeDiagnostic,
    FrontalMeasuresReport,
    HipDropReport,
    KneeTrackingSummary,
    LateralSwayReport,
    calculate_knee_frontal_deviation_px,
    calculate_lateral_sway,
    calculate_pelvic_drop,
    compute_frontal_measures,
)
from .sagittal import (
    CycleCurvePoint,
    DerivedStaticMeasure,
    JointCycleCurve,
    SagittalCycleReport,
    build_joint_cycle_curve,
    calculate_kops_setback,
    calculate_reach,
    calculate_saddle_to_bar_drop,
    compute_sagittal_cycle_curves,
    resample_cycle_to_grid,
)
from .side_detection import detect_visible_side

__all__ = [
    "GATING_THRESHOLD",
    "CycleCurvePoint",
    "DerivedStaticMeasure",
    "FatigueMetricDrift",
    "FatigueReport",
    "FrontalKneeDiagnostic",
    "FrontalMeasuresReport",
    "HipDropReport",
    "JointCycleCurve",
    "KneeTrackingSummary",
    "LateralSwayReport",
    "MeasureConfidence",
    "SagittalCycleReport",
    "analyze_session_fatigue",
    "build_joint_cycle_curve",
    "calculate_knee_frontal_deviation_px",
    "calculate_kops_setback",
    "calculate_lateral_sway",
    "calculate_measure_confidence",
    "calculate_pelvic_drop",
    "calculate_reach",
    "calculate_saddle_to_bar_drop",
    "compute_frontal_measures",
    "compute_sagittal_cycle_curves",
    "detect_visible_side",
    "evaluate_metric_drift",
    "resample_cycle_to_grid",
]
