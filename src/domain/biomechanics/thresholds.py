"""Enums e limiares ergonómicos reconhecidos pela literatura de BikeFit (Holmes, Pruitt, Burke)."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class RidingStyle(str, Enum):
    ROAD = "road"
    MTB = "mtb"
    TT = "tt"
    GRAVEL = "gravel"


class FlexibilityLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


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
    ),
}
