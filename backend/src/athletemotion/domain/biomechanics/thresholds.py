"""Enums e limiares ergonómicos reconhecidos pela literatura de BikeFit (Holmes, Pruitt, Burke).

Cada limiar inclui fonte científica verificável ou é explicitamente marcado como empírico.
Permite adaptações baseadas no objetivo do ciclista (FitGoal) e no histórico de lesões (InjuryFlag).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class RidingStyle(StrEnum):
    ROAD = "road"
    MTB = "mtb"
    TT = "tt"
    GRAVEL = "gravel"


class FlexibilityLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class FitGoal(StrEnum):
    COMFORT = "comfort"
    PERFORMANCE = "performance"
    AERO = "aero"


class InjuryFlag(StrEnum):
    ANTERIOR_KNEE_PAIN = "anterior_knee_pain"
    PATELLAR_TENDINOPATHY = "patellar_tendinopathy"
    HAMSTRING_STRAIN = "hamstring_strain"
    LOWER_BACK_PAIN = "lower_back_pain"
    NECK_PAIN = "neck_pain"
    NUMB_HANDS = "numb_hands"


@dataclass(frozen=True)
class ModalityThresholds:
    modality: RidingStyle
    knee_extension_min: float  # Ponto morto inferior (BDC)
    knee_extension_max: float
    torso_inclination_min: float  # Inclinação das costas face à horizontal
    torso_inclination_max: float
    elbow_flexion_min: float  # Flexão do cotovelo
    elbow_flexion_max: float
    shoulder_angle_min: float  # Ângulo braço-tronco
    shoulder_angle_max: float
    ankle_flexion_min: float  # Ângulo do tornozelo no BDC
    ankle_flexion_max: float

    # Fontes e níveis de confiança científica
    knee_source: str = "Holmes et al. (1994), Bini et al. (2011), Peveler et al. (2007)"
    torso_source: str = "Silberman et al. (2005), Pruitt (2006)"
    elbow_source: str = "Pruitt (2006), Burke (2003)"
    shoulder_source: str = "Burke (2003)"
    ankle_source: str = "Bini et al. (2011)"
    confidence_level: str = "high"  # "high", "moderate", "empirical"

    # Contexto de adaptação
    fit_goal: FitGoal = FitGoal.COMFORT
    injury_flags: list[InjuryFlag] = field(default_factory=list)


# Limiares de referência reconhecidos pela literatura de BikeFit
BIOMECHANIC_THRESHOLDS: dict[RidingStyle, ModalityThresholds] = {
    RidingStyle.ROAD: ModalityThresholds(
        modality=RidingStyle.ROAD,
        knee_extension_min=145.0,
        knee_extension_max=155.0,
        torso_inclination_min=40.0,
        torso_inclination_max=50.0,
        elbow_flexion_min=150.0,
        elbow_flexion_max=165.0,
        shoulder_angle_min=80.0,
        shoulder_angle_max=90.0,
        ankle_flexion_min=90.0,
        ankle_flexion_max=105.0,
        knee_source="Holmes et al. (1994) [145°-155° BDC]; Bini et al. (2011)",
        torso_source="Silberman et al. (2005); Pruitt (2006)",
        elbow_source="Pruitt (2006); Burke (2003)",
        shoulder_source="Burke (2003)",
        ankle_source="Bini et al. (2011); Peveler (2008)",
        confidence_level="high",
    ),
    RidingStyle.MTB: ModalityThresholds(
        modality=RidingStyle.MTB,
        knee_extension_min=140.0,
        knee_extension_max=150.0,
        torso_inclination_min=50.0,
        torso_inclination_max=65.0,
        elbow_flexion_min=140.0,
        elbow_flexion_max=160.0,
        shoulder_angle_min=75.0,
        shoulder_angle_max=85.0,
        ankle_flexion_min=85.0,
        ankle_flexion_max=105.0,
        knee_source="Peveler et al. (2007); empirical/unverified",
        torso_source="Pruitt (2006); empirical/unverified",
        elbow_source="Burke (2003); empirical/unverified",
        shoulder_source="Burke (2003); empirical/unverified",
        ankle_source="Bini et al. (2011); empirical/unverified",
        confidence_level="moderate",
    ),
    RidingStyle.TT: ModalityThresholds(
        modality=RidingStyle.TT,
        knee_extension_min=145.0,
        knee_extension_max=155.0,
        torso_inclination_min=20.0,
        torso_inclination_max=35.0,
        elbow_flexion_min=85.0,
        elbow_flexion_max=105.0,
        shoulder_angle_min=85.0,
        shoulder_angle_max=95.0,
        ankle_flexion_min=95.0,
        ankle_flexion_max=115.0,
        knee_source="Holmes et al. (1994); Bini et al. (2011)",
        torso_source="Pruitt (2006); Silberman et al. (2005)",
        elbow_source="Burke (2003) [aero armrest 90°±10°]",
        shoulder_source="Burke (2003)",
        ankle_source="Peveler (2008)",
        confidence_level="high",
    ),
    RidingStyle.GRAVEL: ModalityThresholds(
        modality=RidingStyle.GRAVEL,
        knee_extension_min=143.0,
        knee_extension_max=153.0,
        torso_inclination_min=45.0,
        torso_inclination_max=55.0,
        elbow_flexion_min=145.0,
        elbow_flexion_max=165.0,
        shoulder_angle_min=78.0,
        shoulder_angle_max=88.0,
        ankle_flexion_min=90.0,
        ankle_flexion_max=105.0,
        knee_source="empirical/unverified",
        torso_source="empirical/unverified",
        elbow_source="empirical/unverified",
        shoulder_source="empirical/unverified",
        ankle_source="empirical/unverified",
        confidence_level="empirical",
    ),
}


def get_adjusted_thresholds(
    modality: RidingStyle,
    fit_goal: FitGoal = FitGoal.COMFORT,
    injury_flags: list[InjuryFlag] | None = None,
) -> ModalityThresholds:
    """Ajusta os limiares biomecânicos em função do objetivo do atleta e de lesões.

    Regras clínicas:
    - Aero: Reduz inclinação do tronco (-5°) e fecha ângulo do cotovelo (-5°).
    - Conforto: Eleva o tronco (+4°) e alivia extensão lombar.
    - Dor patelar / Joelho anterior: Evita flexão excessiva (<145°), elevando knee_extension_min em +2°.
    - Estiramento de isquiotibiais: Evita sobre-extensão, reduzindo knee_extension_max em -2°.
    - Dor lombar: Eleva o tronco (+5°) para reduzir torque flexor lombar.
    - Dor cervical: Eleva o tronco (+3°) e relaxa ombros (+3°).
    - Dormência mãos: Reduz pressão sobre o guiador elevando tronco (+3°) e aumentando flexão de cotovelo (+3°).
    """
    base = BIOMECHANIC_THRESHOLDS.get(modality, BIOMECHANIC_THRESHOLDS[RidingStyle.ROAD])
    injuries = injury_flags or []

    knee_min = base.knee_extension_min
    knee_max = base.knee_extension_max
    torso_min = base.torso_inclination_min
    torso_max = base.torso_inclination_max
    elbow_min = base.elbow_flexion_min
    elbow_max = base.elbow_flexion_max
    shoulder_min = base.shoulder_angle_min
    shoulder_max = base.shoulder_angle_max
    ankle_min = base.ankle_flexion_min
    ankle_max = base.ankle_flexion_max

    # 1. Ajustes por Fit Goal
    if fit_goal == FitGoal.AERO:
        torso_min = max(15.0, torso_min - 5.0)
        torso_max = max(25.0, torso_max - 5.0)
        elbow_min = max(75.0, elbow_min - 5.0)
    elif fit_goal == FitGoal.COMFORT:
        torso_min += 3.0
        torso_max += 4.0
        elbow_min += 3.0
    # PERFORMANCE mantém os valores centrais padrão

    # 2. Ajustes por histórico de lesões
    if (
        InjuryFlag.ANTERIOR_KNEE_PAIN in injuries
        or InjuryFlag.PATELLAR_TENDINOPATHY in injuries
    ):
        # Aumentar a extensão mínima para aliviar forças compressivas patelofemorais
        knee_min = max(knee_min, 147.0)

    if InjuryFlag.HAMSTRING_STRAIN in injuries:
        # Limitar extensão máxima para proteger isquiotibiais de sobre-alongamento
        knee_max = min(knee_max, 152.0)

    if InjuryFlag.LOWER_BACK_PAIN in injuries:
        # Tronco mais vertical para descarregar a coluna lombar
        torso_min += 4.0
        torso_max += 5.0

    if InjuryFlag.NECK_PAIN in injuries:
        # Evitar hiperextensão cervical
        torso_min += 3.0
        torso_max += 3.0
        shoulder_min += 3.0
        shoulder_max += 3.0

    if InjuryFlag.NUMB_HANDS in injuries:
        # Aliviar carga nos pulsos e nervos ulnar/mediano
        torso_min += 3.0
        elbow_min += 3.0
        elbow_max = min(170.0, elbow_max + 3.0)

    return ModalityThresholds(
        modality=modality,
        knee_extension_min=round(knee_min, 1),
        knee_extension_max=round(knee_max, 1),
        torso_inclination_min=round(torso_min, 1),
        torso_inclination_max=round(torso_max, 1),
        elbow_flexion_min=round(elbow_min, 1),
        elbow_flexion_max=round(elbow_max, 1),
        shoulder_angle_min=round(shoulder_min, 1),
        shoulder_angle_max=round(shoulder_max, 1),
        ankle_flexion_min=round(ankle_min, 1),
        ankle_flexion_max=round(ankle_max, 1),
        knee_source=base.knee_source,
        torso_source=base.torso_source,
        elbow_source=base.elbow_source,
        shoulder_source=base.shoulder_source,
        ankle_source=base.ankle_source,
        confidence_level=base.confidence_level,
        fit_goal=fit_goal,
        injury_flags=list(injuries),
    )
