"""Alinhamento horizontal KOPS e tracking frontal do joelho."""

from __future__ import annotations

from dataclasses import dataclass

from .symmetry import SymmetryReport, calculate_symmetry_index

__all__ = [
    "FrontalKneeDiagnostic",
    "KopsDiagnostic",
    "SymmetryReport",
    "calculate_symmetry_index",
    "evaluate_frontal_knee_tracking",
    "evaluate_kops_alignment",
]


@dataclass
class KopsDiagnostic:
    offset_mm: float
    is_aligned: bool
    status_label_pt: str
    status_label_en: str
    recommendation_pt: str
    recommendation_en: str
    suggested_action_pt: str
    suggested_action_en: str
    uncertainty_mm: float | None = None


def evaluate_kops_alignment(
    offset_mm: float,
    tolerance_mm: float = 5.0,
    uncertainty_mm: float | None = None,
) -> KopsDiagnostic:
    """Avalia o alinhamento KOPS (Knee Over Pedal Spindle) na posição horizontal das 3 horas."""
    offset_rounded = round(offset_mm, 1)
    abs_offset = abs(offset_rounded)
    unc_rounded = round(uncertainty_mm, 1) if uncertainty_mm is not None else None

    if abs_offset <= tolerance_mm:
        return KopsDiagnostic(
            offset_mm=offset_rounded,
            is_aligned=True,
            status_label_pt="Alinhamento KOPS Neutro e Perfeito",
            status_label_en="KOPS Alignment Neutral and Balanced",
            recommendation_pt="Manter a posição horizontal atual do selim nos carris.",
            recommendation_en="Maintain current saddle fore/aft position on rails.",
            suggested_action_pt="Sem alteração necessária",
            suggested_action_en="No adjustment needed",
            uncertainty_mm=unc_rounded,
        )
    elif offset_rounded > tolerance_mm:
        return KopsDiagnostic(
            offset_mm=offset_rounded,
            is_aligned=False,
            status_label_pt=f"Joelho adiantado face ao eixo (+{offset_rounded} mm)",
            status_label_en=f"Knee ahead of spindle (+{offset_rounded} mm)",
            recommendation_pt=f"Recuar o selim nos carris em aproximadamente {abs_offset} mm para proteger o tendão patelar.",
            recommendation_en=f"Slide saddle backward on rails by approximately {abs_offset} mm to protect patellar tendon.",
            suggested_action_pt=f"Recuar selim {abs_offset} mm",
            suggested_action_en=f"Slide saddle back {abs_offset} mm",
            uncertainty_mm=unc_rounded,
        )
    else:
        return KopsDiagnostic(
            offset_mm=offset_rounded,
            is_aligned=False,
            status_label_pt=f"Joelho atrasado face ao eixo ({offset_rounded} mm)",
            status_label_en=f"Knee behind spindle ({offset_rounded} mm)",
            recommendation_pt=f"Avançar o selim nos carris em aproximadamente {abs_offset} mm para otimizar quadríceps.",
            recommendation_en=f"Slide saddle forward on rails by approximately {abs_offset} mm to optimize quadriceps.",
            suggested_action_pt=f"Avançar selim {abs_offset} mm",
            suggested_action_en=f"Slide saddle forward {abs_offset} mm",
            uncertainty_mm=unc_rounded,
        )


@dataclass
class FrontalKneeDiagnostic:
    deviation_mm: float
    condition: str  # 'neutral', 'valgus', 'varus'
    is_compliant: bool
    label_pt: str
    label_en: str
    recommendation_pt: str
    recommendation_en: str


def evaluate_frontal_knee_tracking(
    deviation_mm: float,
    side: str = "right",
    tolerance_mm: float = 10.0,
) -> FrontalKneeDiagnostic:
    """Classifica o desvio do joelho no plano frontal durante a descida do pedal."""
    abs_dev = round(abs(deviation_mm), 1)

    if abs_dev <= tolerance_mm:
        return FrontalKneeDiagnostic(
            deviation_mm=round(deviation_mm, 1),
            condition="neutral",
            is_compliant=True,
            label_pt="Alinhamento Frontal Perfeito",
            label_en="Optimal Frontal Tracking",
            recommendation_pt="Trajetória linear exemplar sem sobrecarga colateral na patela.",
            recommendation_en="Exemplary linear knee tracking without patellar stress.",
        )

    is_valgus = (side.lower() == "right" and deviation_mm < 0) or (
        side.lower() == "left" and deviation_mm > 0
    )
    if is_valgus:
        return FrontalKneeDiagnostic(
            deviation_mm=round(deviation_mm, 1),
            condition="valgus",
            is_compliant=False,
            label_pt=f"Valgo Dinâmico ({abs_dev} mm)",
            label_en=f"Dynamic Valgus ({abs_dev} mm)",
            recommendation_pt=f"Joelho colapsa {abs_dev} mm para o interior. Aumentar Fator Q e verificar arco plantar.",
            recommendation_en=f"Knee collapses {abs_dev} mm inward. Increase Q-Factor and verify arch support.",
        )
    else:
        return FrontalKneeDiagnostic(
            deviation_mm=round(deviation_mm, 1),
            condition="varus",
            is_compliant=False,
            label_pt=f"Varo Dinâmico ({abs_dev} mm)",
            label_en=f"Dynamic Varus ({abs_dev} mm)",
            recommendation_pt=f"Joelho projeta-se {abs_dev} mm para o exterior. Reduzir Fator Q e verificar pronação.",
            recommendation_en=f"Knee flares {abs_dev} mm outward. Reduce Q-Factor and check pronation.",
        )
