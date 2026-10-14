"""Gerador de narrativas determinísticas com suporte a i18n e fidelidade clínica."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from athletemotion.domain.biomechanics.joints import JointId
from athletemotion.domain.biomechanics.thresholds import FlexibilityLevel, RidingStyle
from athletemotion.schemas.coach import (
    CoachReport,
    DataQualityReport,
    FindingSchema,
    FindingStatus,
)
from athletemotion.services.coach.rewriter import NarrativeRewriter, NoopRewriter
from athletemotion.services.coach.rules import Finding

I18N_DIR = Path(__file__).parent / "i18n"


@lru_cache(maxsize=4)
def load_translations(language: str) -> dict[str, str]:
    """Carrega o catálogo de traduções para o idioma solicitado ('pt' ou 'en')."""
    normalized_lang = "pt" if language.lower().startswith("pt") else "en"
    catalog_path = I18N_DIR / f"{normalized_lang}.json"

    if not catalog_path.exists():
        # Fallback de segurança para português se ficheiro não existir
        catalog_path = I18N_DIR / "pt.json"

    with catalog_path.open("r", encoding="utf-8") as f:
        data: dict[str, str] = json.load(f)
        return data


@dataclass(frozen=True)
class CoachContext:
    """Contexto do ciclista, modalidade e medições secundárias da sessão."""

    athlete_name: str = "Ciclista"
    modality: RidingStyle = RidingStyle.ROAD
    flexibility: FlexibilityLevel = FlexibilityLevel.MEDIUM
    cadence_rpm: int | None = None
    power_watts: int | None = None
    kops_offset_mm: float | None = None


def build_coach_report(
    findings: list[Finding],
    context: CoachContext,
    language: str = "pt",
    rewriter: NarrativeRewriter | None = None,
) -> CoachReport:
    """Gera o relatório estruturado de parecer biomecânico a partir dos achados determinísticos."""
    strings = load_translations(language)
    active_rewriter = rewriter or NoopRewriter()

    findings_by_id = {f.joint_id: f for f in findings}
    available_joints = [
        f.joint_id.value for f in findings if f.status != FindingStatus.INSUFFICIENT
    ]
    missing_joints = [f.joint_id.value for f in findings if f.status == FindingStatus.INSUFFICIENT]

    all_insufficient = len(available_joints) == 0

    # Construção de schemas individuais
    findings_schemas: list[FindingSchema] = []
    for f in findings:
        message = ""
        if f.status == FindingStatus.INSUFFICIENT:
            message = strings.get(f"{f.joint_id.value}_missing", "Medição ausente.")
        elif f.joint_id == JointId.KNEE:
            if f.status == FindingStatus.LOW:
                message = strings["knee_low"].format(
                    measured=f.measured_angle or 0.0,
                    ideal_min=f.ideal_min,
                    ideal_max=f.ideal_max,
                )
            elif f.status == FindingStatus.HIGH:
                message = strings["knee_high"].format(
                    measured=f.measured_angle or 0.0,
                    ideal_min=f.ideal_min,
                    ideal_max=f.ideal_max,
                )
            else:
                message = strings["knee_ok"].format(
                    measured=f.measured_angle or 0.0,
                    ideal_min=f.ideal_min,
                    ideal_max=f.ideal_max,
                )
        elif f.joint_id == JointId.TORSO:
            if f.status == FindingStatus.LOW:
                if context.flexibility == FlexibilityLevel.LOW:
                    message = strings["torso_low_low_flex"].format(
                        measured=f.measured_angle or 0.0,
                        ideal_min=f.ideal_min,
                        ideal_max=f.ideal_max,
                    )
                else:
                    message = strings["torso_low"].format(
                        measured=f.measured_angle or 0.0,
                        ideal_min=f.ideal_min,
                        ideal_max=f.ideal_max,
                    )
            elif f.status == FindingStatus.HIGH:
                message = strings["torso_high"].format(
                    measured=f.measured_angle or 0.0,
                    ideal_min=f.ideal_min,
                    ideal_max=f.ideal_max,
                )
            else:
                message = strings["torso_ok"].format(
                    measured=f.measured_angle or 0.0,
                    ideal_min=f.ideal_min,
                    ideal_max=f.ideal_max,
                )
        elif f.joint_id == JointId.ELBOW:
            if f.status == FindingStatus.LOW:
                message = strings["elbow_low"].format(
                    measured=f.measured_angle or 0.0,
                    ideal_min=f.ideal_min,
                    ideal_max=f.ideal_max,
                )
            elif f.status == FindingStatus.HIGH:
                message = strings["elbow_high"].format(
                    measured=f.measured_angle or 0.0,
                    ideal_min=f.ideal_min,
                    ideal_max=f.ideal_max,
                )
            else:
                message = strings["elbow_ok"].format(
                    measured=f.measured_angle or 0.0,
                    ideal_min=f.ideal_min,
                    ideal_max=f.ideal_max,
                )

        findings_schemas.append(
            FindingSchema(
                joint_id=f.joint_id.value,
                status=f.status,
                measured_angle=f.measured_angle,
                ideal_min=f.ideal_min,
                ideal_max=f.ideal_max,
                delta=f.delta,
                message=message,
            )
        )

    # 1. Caso de dados completamente insuficientes
    if all_insufficient:
        report = CoachReport(
            title=strings["insufficient_data_title"],
            executive_summary=strings["insufficient_data_summary"],
            cockpit_analysis="",
            kops_insight="",
            cadence_power_insight=strings["cadence_power_format"].format(
                cadence=str(context.cadence_rpm) if context.cadence_rpm is not None else "--",
                power=str(context.power_watts) if context.power_watts is not None else "--",
            ),
            adaptation_plan=[],
            data_quality=DataQualityReport(
                available_joints=[],
                missing_joints=missing_joints,
                is_complete=False,
            ),
            disclaimer=strings["disclaimer"],
            generator="rules-v1",
            findings=findings_schemas,
        )
        return report

    # 2. Executive summary centrado no joelho
    knee_finding = findings_by_id.get(JointId.KNEE)
    if knee_finding and knee_finding.status != FindingStatus.INSUFFICIENT:
        if knee_finding.status == FindingStatus.LOW:
            executive_summary = strings["knee_low"].format(
                measured=knee_finding.measured_angle or 0.0,
                ideal_min=knee_finding.ideal_min,
                ideal_max=knee_finding.ideal_max,
            )
        elif knee_finding.status == FindingStatus.HIGH:
            executive_summary = strings["knee_high"].format(
                measured=knee_finding.measured_angle or 0.0,
                ideal_min=knee_finding.ideal_min,
                ideal_max=knee_finding.ideal_max,
            )
        else:
            executive_summary = strings["knee_ok"].format(
                measured=knee_finding.measured_angle or 0.0,
                ideal_min=knee_finding.ideal_min,
                ideal_max=knee_finding.ideal_max,
            )
    else:
        executive_summary = strings["knee_missing"]

    # 3. Cockpit Analysis (Tronco + Cotovelo)
    cockpit_parts: list[str] = []
    torso_finding = findings_by_id.get(JointId.TORSO)
    if torso_finding and torso_finding.status != FindingStatus.INSUFFICIENT:
        if torso_finding.status == FindingStatus.LOW:
            if context.flexibility == FlexibilityLevel.LOW:
                cockpit_parts.append(
                    strings["torso_low_low_flex"].format(
                        measured=torso_finding.measured_angle or 0.0,
                        ideal_min=torso_finding.ideal_min,
                        ideal_max=torso_finding.ideal_max,
                    )
                )
            else:
                cockpit_parts.append(
                    strings["torso_low"].format(
                        measured=torso_finding.measured_angle or 0.0,
                        ideal_min=torso_finding.ideal_min,
                        ideal_max=torso_finding.ideal_max,
                    )
                )
        elif torso_finding.status == FindingStatus.HIGH:
            cockpit_parts.append(
                strings["torso_high"].format(
                    measured=torso_finding.measured_angle or 0.0,
                    ideal_min=torso_finding.ideal_min,
                    ideal_max=torso_finding.ideal_max,
                )
            )
        else:
            cockpit_parts.append(
                strings["torso_ok"].format(
                    measured=torso_finding.measured_angle or 0.0,
                    ideal_min=torso_finding.ideal_min,
                    ideal_max=torso_finding.ideal_max,
                )
            )
    else:
        cockpit_parts.append(strings["torso_missing"])

    elbow_finding = findings_by_id.get(JointId.ELBOW)
    if elbow_finding and elbow_finding.status != FindingStatus.INSUFFICIENT:
        if elbow_finding.status == FindingStatus.LOW:
            cockpit_parts.append(
                strings["elbow_low"].format(
                    measured=elbow_finding.measured_angle or 0.0,
                    ideal_min=elbow_finding.ideal_min,
                    ideal_max=elbow_finding.ideal_max,
                )
            )
        elif elbow_finding.status == FindingStatus.HIGH:
            cockpit_parts.append(
                strings["elbow_high"].format(
                    measured=elbow_finding.measured_angle or 0.0,
                    ideal_min=elbow_finding.ideal_min,
                    ideal_max=elbow_finding.ideal_max,
                )
            )
        else:
            cockpit_parts.append(
                strings["elbow_ok"].format(
                    measured=elbow_finding.measured_angle or 0.0,
                    ideal_min=elbow_finding.ideal_min,
                    ideal_max=elbow_finding.ideal_max,
                )
            )

    cockpit_analysis = " ".join(cockpit_parts)

    # 4. KOPS Insight
    if context.kops_offset_mm is None:
        kops_insight = strings["kops_missing"]
    elif abs(context.kops_offset_mm) <= 5.0:
        kops_insight = strings["kops_aligned"]
    elif context.kops_offset_mm > 5.0:
        kops_insight = strings["kops_forward"].format(offset=context.kops_offset_mm)
    else:
        kops_insight = strings["kops_backward"].format(offset=abs(context.kops_offset_mm))

    # 5. Cadência e Potência
    cadence_str = str(context.cadence_rpm) if context.cadence_rpm is not None else "--"
    power_str = str(context.power_watts) if context.power_watts is not None else "--"
    cadence_power_insight = strings["cadence_power_format"].format(
        cadence=cadence_str,
        power=power_str,
    )

    # 6. Plano de Adaptação
    has_significant_deviations = any(
        f.status in (FindingStatus.LOW, FindingStatus.HIGH) and f.delta >= 2.0 for f in findings
    ) or (context.kops_offset_mm is not None and abs(context.kops_offset_mm) > 10.0)

    if has_significant_deviations:
        adaptation_plan = [
            strings["plan_step_acclimation"],
            strings["plan_step_progression"],
            strings["plan_step_consolidation"],
        ]
    else:
        adaptation_plan = [
            strings["plan_step_maintenance"],
        ]

    facts: dict[str, Any] = {
        "athlete_name": context.athlete_name,
        "modality": context.modality.value,
        "flexibility": context.flexibility.value,
        "cadence_rpm": context.cadence_rpm,
        "power_watts": context.power_watts,
        "kops_offset_mm": context.kops_offset_mm,
    }

    # Passagem opcional pelo rewriter mantendo fidelidade estrita
    rewritten_summary = active_rewriter.rewrite(executive_summary, facts)
    rewritten_cockpit = active_rewriter.rewrite(cockpit_analysis, facts)

    return CoachReport(
        title=strings["title"],
        executive_summary=rewritten_summary,
        cockpit_analysis=rewritten_cockpit,
        kops_insight=kops_insight,
        cadence_power_insight=cadence_power_insight,
        adaptation_plan=adaptation_plan,
        data_quality=DataQualityReport(
            available_joints=available_joints,
            missing_joints=missing_joints,
            is_complete=len(missing_joints) == 0,
        ),
        disclaimer=strings["disclaimer"],
        generator="rules-v1",
        findings=findings_schemas,
    )
