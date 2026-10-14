"""Regras determinísticas puras de avaliação biomecânica para o Treinador.

Nenhum valor fictício ou padrão é injetado. Articulações sem medição válida
são rigorosamente marcadas com FindingStatus.INSUFFICIENT.
"""

from __future__ import annotations

from dataclasses import dataclass

from athletemotion.domain.biomechanics.joints import JointId
from athletemotion.domain.biomechanics.thresholds import (
    BIOMECHANIC_THRESHOLDS,
    FlexibilityLevel,
    RidingStyle,
)
from athletemotion.schemas.coach import FindingStatus


@dataclass(frozen=True)
class Finding:
    """Resultado da avaliação determinística de uma articulação."""

    joint_id: JointId
    status: FindingStatus
    measured_angle: float | None
    ideal_min: float
    ideal_max: float
    delta: float
    evidence: str


def assess_knee(
    measured: float | None,
    modality: RidingStyle = RidingStyle.ROAD,
) -> Finding:
    """Avalia o ângulo do joelho no Ponto Morto Inferior (BDC) face aos limiares da modalidade."""
    thresholds = BIOMECHANIC_THRESHOLDS.get(modality, BIOMECHANIC_THRESHOLDS[RidingStyle.ROAD])
    ideal_min = thresholds.knee_extension_min
    ideal_max = thresholds.knee_extension_max

    if measured is None or measured <= 0.0:
        return Finding(
            joint_id=JointId.KNEE,
            status=FindingStatus.INSUFFICIENT,
            measured_angle=None,
            ideal_min=ideal_min,
            ideal_max=ideal_max,
            delta=0.0,
            evidence="Medição ausente ou nula no ponto morto inferior.",
        )

    # Intervalo fechado: ideal_min <= measured <= ideal_max é considerado conforme
    if measured < ideal_min:
        delta = round(ideal_min - measured, 1)
        return Finding(
            joint_id=JointId.KNEE,
            status=FindingStatus.LOW,
            measured_angle=measured,
            ideal_min=ideal_min,
            ideal_max=ideal_max,
            delta=delta,
            evidence=f"Flexão excessiva de {delta}° abaixo do limite mínimo de {ideal_min}°.",
        )
    elif measured > ideal_max:
        delta = round(measured - ideal_max, 1)
        return Finding(
            joint_id=JointId.KNEE,
            status=FindingStatus.HIGH,
            measured_angle=measured,
            ideal_min=ideal_min,
            ideal_max=ideal_max,
            delta=delta,
            evidence=f"Extensão excessiva de {delta}° acima do limite máximo de {ideal_max}°.",
        )
    else:
        return Finding(
            joint_id=JointId.KNEE,
            status=FindingStatus.OK,
            measured_angle=measured,
            ideal_min=ideal_min,
            ideal_max=ideal_max,
            delta=0.0,
            evidence=f"Ângulo de {measured:.1f}° dentro da janela ótima ({ideal_min:.0f}°–{ideal_max:.0f}°).",
        )


def assess_torso(
    measured: float | None,
    modality: RidingStyle = RidingStyle.ROAD,
    flexibility: FlexibilityLevel = FlexibilityLevel.MEDIUM,
) -> Finding:
    """Avalia a inclinação do tronco/costas com sensibilidade à flexibilidade do ciclista."""
    thresholds = BIOMECHANIC_THRESHOLDS.get(modality, BIOMECHANIC_THRESHOLDS[RidingStyle.ROAD])
    ideal_min = thresholds.torso_inclination_min
    ideal_max = thresholds.torso_inclination_max

    if measured is None or measured <= 0.0:
        return Finding(
            joint_id=JointId.TORSO,
            status=FindingStatus.INSUFFICIENT,
            measured_angle=None,
            ideal_min=ideal_min,
            ideal_max=ideal_max,
            delta=0.0,
            evidence="Medição de inclinação de tronco ausente.",
        )

    if measured < ideal_min:
        delta = round(ideal_min - measured, 1)
        return Finding(
            joint_id=JointId.TORSO,
            status=FindingStatus.LOW,
            measured_angle=measured,
            ideal_min=ideal_min,
            ideal_max=ideal_max,
            delta=delta,
            evidence=f"Tronco muito agressivo/baixo ({delta}° abaixo do limite de {ideal_min}°).",
        )
    elif measured > ideal_max:
        delta = round(measured - ideal_max, 1)
        return Finding(
            joint_id=JointId.TORSO,
            status=FindingStatus.HIGH,
            measured_angle=measured,
            ideal_min=ideal_min,
            ideal_max=ideal_max,
            delta=delta,
            evidence=f"Tronco excessivamente ereto ({delta}° acima do limite de {ideal_max}°).",
        )
    else:
        return Finding(
            joint_id=JointId.TORSO,
            status=FindingStatus.OK,
            measured_angle=measured,
            ideal_min=ideal_min,
            ideal_max=ideal_max,
            delta=0.0,
            evidence=f"Inclinação de {measured:.1f}° dentro da referência de conforto ({ideal_min:.0f}°–{ideal_max:.0f}°).",
        )


def assess_elbow(
    measured: float | None,
    modality: RidingStyle = RidingStyle.ROAD,
) -> Finding:
    """Avalia a flexão dos membros superiores (cotovelo/braço)."""
    thresholds = BIOMECHANIC_THRESHOLDS.get(modality, BIOMECHANIC_THRESHOLDS[RidingStyle.ROAD])
    ideal_min = thresholds.elbow_flexion_min
    ideal_max = thresholds.elbow_flexion_max

    if measured is None or measured <= 0.0:
        return Finding(
            joint_id=JointId.ELBOW,
            status=FindingStatus.INSUFFICIENT,
            measured_angle=None,
            ideal_min=ideal_min,
            ideal_max=ideal_max,
            delta=0.0,
            evidence="Medição do ângulo do cotovelo ausente.",
        )

    if measured < ideal_min:
        delta = round(ideal_min - measured, 1)
        return Finding(
            joint_id=JointId.ELBOW,
            status=FindingStatus.LOW,
            measured_angle=measured,
            ideal_min=ideal_min,
            ideal_max=ideal_max,
            delta=delta,
            evidence=f"Braços excessivamente encolhidos ({delta}° abaixo do mínimo).",
        )
    elif measured > ideal_max:
        delta = round(measured - ideal_max, 1)
        return Finding(
            joint_id=JointId.ELBOW,
            status=FindingStatus.HIGH,
            measured_angle=measured,
            ideal_min=ideal_min,
            ideal_max=ideal_max,
            delta=delta,
            evidence=f"Cotovelos excessivamente travados ({delta}° acima do máximo).",
        )
    else:
        return Finding(
            joint_id=JointId.ELBOW,
            status=FindingStatus.OK,
            measured_angle=measured,
            ideal_min=ideal_min,
            ideal_max=ideal_max,
            delta=0.0,
            evidence=f"Flexão de {measured:.1f}° adequada para absorção de impacto.",
        )
