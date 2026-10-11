"""Diagnósticos de postura sagital (ângulos articulares de joelho, tronco e braço)."""
from __future__ import annotations

from dataclasses import dataclass
from .thresholds import BIOMECHANIC_THRESHOLDS, RidingStyle


@dataclass
class PostureDiagnostic:
    joint_name: str
    measured_angle: float
    ideal_min: float
    ideal_max: float
    is_compliant: bool
    status_label_pt: str
    status_label_en: str
    recommendation_pt: str
    recommendation_en: str
    adjustment_delta: float | None = None
    adjustment_unit: str = "cm"


def _diag(
    joint: str,
    measured: float,
    ideal_min: float,
    ideal_max: float,
    compliant: bool,
    status_pt: str,
    status_en: str,
    rec_pt: str,
    rec_en: str,
    delta: float | None = None,
    unit: str = "cm",
) -> PostureDiagnostic:
    """Helper conciso para instanciação de diagnósticos posturais."""
    return PostureDiagnostic(
        joint_name=joint,
        measured_angle=measured,
        ideal_min=ideal_min,
        ideal_max=ideal_max,
        is_compliant=compliant,
        status_label_pt=status_pt,
        status_label_en=status_en,
        recommendation_pt=rec_pt,
        recommendation_en=rec_en,
        adjustment_delta=delta,
        adjustment_unit=unit,
    )


def evaluate_posture_angles(
    modality: RidingStyle,
    knee_angle: float | None,
    back_angle: float | None,
    arm_angle: float | None,
    ankle_angle: float | None,
    current_saddle_height_cm: float | None = None,
    theoretical_saddle_height_cm: float | None = None,
) -> list[PostureDiagnostic]:
    """Avalia cada uma das articulações e gera recomendações quantificadas em Português e Inglês."""
    thresholds = BIOMECHANIC_THRESHOLDS.get(modality, BIOMECHANIC_THRESHOLDS[RidingStyle.ROAD])
    diagnostics: list[PostureDiagnostic] = []

    # 1. Joelho
    if knee_angle is not None and knee_angle > 0:
        if knee_angle < thresholds.knee_extension_min:
            delta = round((thresholds.knee_extension_min - knee_angle) * 0.23, 1)
            diagnostics.append(_diag(
                "joelho", knee_angle, thresholds.knee_extension_min, thresholds.knee_extension_max, False,
                "Joelho excessivamente fletido (Selim baixo)", "Knee over-flexed (Saddle too low)",
                f"Subir o selim em aproximadamente {delta} cm para evitar sobrecarga patelar.",
                f"Raise the saddle by approximately {delta} cm to reduce patellar load.", delta,
            ))
        elif knee_angle > thresholds.knee_extension_max:
            delta = round((knee_angle - thresholds.knee_extension_max) * 0.23, 1)
            diagnostics.append(_diag(
                "joelho", knee_angle, thresholds.knee_extension_min, thresholds.knee_extension_max, False,
                "Joelho hiperestendido (Selim alto)", "Knee hyperextended (Saddle too high)",
                f"Baixar o selim em aproximadamente {delta} cm para evitar oscilação da bacia.",
                f"Lower the saddle by approximately {delta} cm to prevent pelvis rocking.", -delta,
            ))
        else:
            diagnostics.append(_diag(
                "joelho", knee_angle, thresholds.knee_extension_min, thresholds.knee_extension_max, True,
                "Extensão do joelho correta e ergonómica", "Knee extension within optimal ergonomic range",
                "Manter a altura atual do selim.", "Maintain current saddle height.", 0.0,
            ))

    # 2. Costas / Tronco
    if back_angle is not None and back_angle > 0:
        if back_angle < thresholds.torso_inclination_min:
            diagnostics.append(_diag(
                "costas", back_angle, thresholds.torso_inclination_min, thresholds.torso_inclination_max, False,
                "Inclinação do tronco muito agressiva / baixa", "Torso angle overly aggressive / too low",
                "Subir o guiador ou encurtar o avanço em 10-20 mm para aliviar a tensão lombar.",
                "Raise handlebars or shorten stem by 10-20 mm to relieve lower back stress.",
            ))
        elif back_angle > thresholds.torso_inclination_max:
            diagnostics.append(_diag(
                "costas", back_angle, thresholds.torso_inclination_min, thresholds.torso_inclination_max, False,
                "Tronco muito ereto / pouca aerodinâmica", "Torso too upright / high aerodynamic drag",
                "Baixar o guiador retirando espaçadores ou alongar o avanço.",
                "Lower handlebars by removing spacers or increase stem reach.",
            ))
        else:
            diagnostics.append(_diag(
                "costas", back_angle, thresholds.torso_inclination_min, thresholds.torso_inclination_max, True,
                "Inclinação do tronco ideal para a modalidade", "Torso angle optimal for this riding style",
                "Postura lombar balanceada entre conforto e aerodinâmica.",
                "Balanced spinal posture between comfort and aerodynamics.",
            ))

    # 3. Braços / Cotovelos
    if arm_angle is not None and arm_angle > 0:
        if arm_angle > thresholds.elbow_flexion_max:
            diagnostics.append(_diag(
                "braço", arm_angle, thresholds.elbow_flexion_min, thresholds.elbow_flexion_max, False,
                "Cotovelos travados / hiperestendidos", "Elbows locked / hyperextended",
                "Encurtar o alcance do guiador ou aproximar manípulos para absorver impactos.",
                "Shorten handlebar reach or bring brake hoods closer for shock absorption.",
            ))
        elif arm_angle < thresholds.elbow_flexion_min:
            diagnostics.append(_diag(
                "braço", arm_angle, thresholds.elbow_flexion_min, thresholds.elbow_flexion_max, False,
                "Braços excessivamente encolhidos", "Arms excessively cramped",
                "Avançar o selim ou instalar um avanço ligeiramente mais longo.",
                "Consider a slightly longer stem to open up cockpit space.",
            ))
        else:
            diagnostics.append(_diag(
                "braço", arm_angle, thresholds.elbow_flexion_min, thresholds.elbow_flexion_max, True,
                "Flexão de cotovelos adequada para absorção de choque", "Elbow flexion adequate for shock absorption",
                "Alcance do guiador harmonioso.", "Cockpit reach is well proportioned.",
            ))

    return diagnostics
