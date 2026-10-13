"""Diagnósticos globais de BikeFit, desnível selim-guiador (saddle drop) e re-exportações."""
from __future__ import annotations

from dataclasses import dataclass
from .thresholds import FlexibilityLevel, RidingStyle
from .posture import PostureDiagnostic, evaluate_posture_angles
from .alignment import (
    FrontalKneeDiagnostic,
    KopsDiagnostic,
    SymmetryReport,
    calculate_symmetry_index,
    evaluate_frontal_knee_tracking,
    evaluate_kops_alignment,
)

__all__ = [
    "PostureDiagnostic",
    "evaluate_posture_angles",
    "SaddleDropDiagnostic",
    "evaluate_saddle_drop",
    "KopsDiagnostic",
    "evaluate_kops_alignment",
    "SymmetryReport",
    "calculate_symmetry_index",
    "FrontalKneeDiagnostic",
    "evaluate_frontal_knee_tracking",
]


@dataclass
class SaddleDropDiagnostic:
    measured_drop_cm: float
    ideal_min_cm: float
    ideal_max_cm: float
    is_compliant: bool
    status_pt: str
    status_en: str
    recommendation_pt: str
    recommendation_en: str


def evaluate_saddle_drop(
    drop_cm: float,
    modality: RidingStyle,
    flexibility: FlexibilityLevel = FlexibilityLevel.MEDIUM,
) -> SaddleDropDiagnostic:
    """Avalia o desnível vertical selim-guiador (Saddle-to-Handlebar Drop)."""
    ranges: dict[tuple[RidingStyle, FlexibilityLevel], tuple[float, float]] = {
        (RidingStyle.ROAD, FlexibilityLevel.LOW): (2.0, 5.0),
        (RidingStyle.ROAD, FlexibilityLevel.MEDIUM): (5.0, 8.5),
        (RidingStyle.ROAD, FlexibilityLevel.HIGH): (8.0, 12.0),
        (RidingStyle.MTB, FlexibilityLevel.LOW): (-1.0, 2.0),
        (RidingStyle.MTB, FlexibilityLevel.MEDIUM): (1.0, 4.5),
        (RidingStyle.MTB, FlexibilityLevel.HIGH): (3.0, 6.5),
        (RidingStyle.TT, FlexibilityLevel.LOW): (5.0, 8.0),
        (RidingStyle.TT, FlexibilityLevel.MEDIUM): (8.0, 12.0),
        (RidingStyle.TT, FlexibilityLevel.HIGH): (11.0, 15.0),
        (RidingStyle.GRAVEL, FlexibilityLevel.LOW): (1.0, 4.0),
        (RidingStyle.GRAVEL, FlexibilityLevel.MEDIUM): (3.0, 6.0),
        (RidingStyle.GRAVEL, FlexibilityLevel.HIGH): (5.0, 8.0),
    }

    ideal_min, ideal_max = ranges.get((modality, flexibility), (4.0, 7.0))
    measured = round(drop_cm, 1)

    if measured < ideal_min:
        return SaddleDropDiagnostic(
            measured_drop_cm=measured,
            ideal_min_cm=ideal_min,
            ideal_max_cm=ideal_max,
            is_compliant=False,
            status_pt="Guiador muito elevado face ao selim",
            status_en="Handlebars too high relative to saddle",
            recommendation_pt=f"Remover espaçadores sob o avanço para descer {round(ideal_min - measured, 1)} cm.",
            recommendation_en=f"Remove stem spacers to lower {round(ideal_min - measured, 1)} cm.",
        )
    elif measured > ideal_max:
        excess = round(measured - ideal_max, 1)
        return SaddleDropDiagnostic(
            measured_drop_cm=measured,
            ideal_min_cm=ideal_min,
            ideal_max_cm=ideal_max,
            is_compliant=False,
            status_pt="Desnível excessivo (Guiador muito baixo)",
            status_en="Excessive drop (Handlebars too low)",
            recommendation_pt=f"Adicionar {excess} cm de anilhas sob o avanço para aliviar tensão no pescoço e costas.",
            recommendation_en=f"Add {excess} cm of stem spacers to relieve strain on the neck and back.",
        )
    else:
        return SaddleDropDiagnostic(
            measured_drop_cm=measured,
            ideal_min_cm=ideal_min,
            ideal_max_cm=ideal_max,
            is_compliant=True,
            status_pt="Desnível selim-guiador ideal para a flexibilidade",
            status_en="Optimal saddle-to-handlebar drop for rider flexibility",
            recommendation_pt="Configuração de cockpit ergonómica e harmoniosa.",
            recommendation_en="Ergonomic and balanced cockpit setup.",
        )
