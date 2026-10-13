"""Pacote modular de regras biomecânicas, fórmulas antropométricas e limiares ergonómicos."""
from .thresholds import (
    BIOMECHANIC_THRESHOLDS,
    FlexibilityLevel,
    ModalityThresholds,
    RidingStyle,
)
from .fitting import (
    calculate_109_saddle_height,
    calculate_lemond_saddle_height,
    estimate_frame_size,
    recommend_crank_length,
    recommend_handlebar_width,
)
from .posture import (
    PostureDiagnostic,
    evaluate_posture_angles,
)
from .alignment import (
    FrontalKneeDiagnostic,
    KopsDiagnostic,
    SymmetryReport,
    calculate_symmetry_index,
    evaluate_frontal_knee_tracking,
    evaluate_kops_alignment,
)
from .diagnostics import (
    SaddleDropDiagnostic,
    evaluate_saddle_drop,
)

__all__ = [
    "BIOMECHANIC_THRESHOLDS",
    "FlexibilityLevel",
    "ModalityThresholds",
    "RidingStyle",
    "calculate_109_saddle_height",
    "calculate_lemond_saddle_height",
    "estimate_frame_size",
    "recommend_crank_length",
    "recommend_handlebar_width",
    "PostureDiagnostic",
    "evaluate_posture_angles",
    "FrontalKneeDiagnostic",
    "KopsDiagnostic",
    "SymmetryReport",
    "calculate_symmetry_index",
    "evaluate_frontal_knee_tracking",
    "evaluate_kops_alignment",
    "SaddleDropDiagnostic",
    "evaluate_saddle_drop",
]
