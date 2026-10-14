"""Treinador Biomecânico (AI Coach shim de compatibilidade).

Este módulo atua como fachada de retrocompatibilidade para o novo motor
determinístico em `athletemotion.services.coach`.
Garante que código existente receba respostas consistentes sem nunca
inventar valores padrão para ângulos em falta.
"""

from __future__ import annotations

from typing import Any

from athletemotion.domain.biomechanics.joints import JointId
from athletemotion.domain.biomechanics.thresholds import FlexibilityLevel, RidingStyle
from athletemotion.services.coach.narrative import CoachContext, build_coach_report
from athletemotion.services.coach.rules import assess_elbow, assess_knee, assess_torso


def generate_coaching_narrative(
    athlete_data: dict[str, Any],
    bike_data: dict[str, Any] | None,
    angles_summary: list[dict[str, Any]],
    kops_data: dict[str, Any] | None = None,
    symmetry_data: list[dict[str, Any]] | None = None,
    saddle_drop_data: dict[str, Any] | None = None,
    cadence_rpm: int | None = None,
    power_watts: int | None = None,
    language: str = "pt",
) -> dict[str, Any]:
    """Gera um parecer detalhado estruturado do Treinador Biomecânico em Português ou Inglês.

    Compatibilidade total com o contrato anterior, delegando para o motor determinístico.
    """
    name = athlete_data.get("name", "Ciclista")
    raw_flex = str(athlete_data.get("flexibility", "medium")).lower()
    try:
        flexibility = FlexibilityLevel(raw_flex)
    except ValueError:
        flexibility = FlexibilityLevel.MEDIUM

    raw_mod = str(bike_data.get("modality", "road")).lower() if bike_data else "road"
    try:
        modality = RidingStyle(raw_mod)
    except ValueError:
        modality = RidingStyle.ROAD

    # Extrair medições reais com identificação estável
    knee_angle: float | None = None
    torso_angle: float | None = None
    elbow_angle: float | None = None

    for item in angles_summary:
        raw_name = str(item.get("name", ""))
        resolved_id = JointId.from_name(raw_name)
        val = item.get("angle")
        if isinstance(val, (int, float)) and val > 0:
            if resolved_id == JointId.KNEE:
                knee_angle = float(val)
            elif resolved_id == JointId.TORSO:
                torso_angle = float(val)
            elif resolved_id == JointId.ELBOW:
                elbow_angle = float(val)

    findings = [
        assess_knee(knee_angle, modality),
        assess_torso(torso_angle, modality, flexibility),
        assess_elbow(elbow_angle, modality),
    ]

    # Resolver KOPS offset em mm
    kops_offset_mm: float | None = None
    if kops_data:
        raw_offset = kops_data.get("offset_mm")
        if isinstance(raw_offset, (int, float)):
            kops_offset_mm = float(raw_offset)

    ctx = CoachContext(
        athlete_name=name,
        modality=modality,
        flexibility=flexibility,
        cadence_rpm=cadence_rpm,
        power_watts=power_watts,
        kops_offset_mm=kops_offset_mm,
    )

    report = build_coach_report(
        findings=findings,
        context=ctx,
        language=language,
    )

    return report.model_dump()
