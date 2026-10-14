"""Construtor unificado de diagnósticos e pacotes de relatório biomecânico (DRY).

Centraliza a resolução de modalidade de ciclismo, computação de diagnósticos articulares,
formatação de resumos para relatórios PDF / AI-Coach e cálculo de taxas de conformidade ergonómica.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from athletemotion.domain.biomechanics import (
    PostureDiagnostic,
    RidingStyle,
    evaluate_posture_angles,
)
from athletemotion.schemas.fit import DiagnosticItem

logger = logging.getLogger("athlete_motion.services.report_builder")


@dataclass(frozen=True)
class DiagnosticsBundle:
    """Conjunto consolidado de diagnósticos biomecânicos e conformidade global."""

    diagnostics_raw: list[PostureDiagnostic]
    diagnostics_pydantic: list[DiagnosticItem]
    compliance_percentage: float | None
    compliant_count: int
    total_count: int


def resolve_modality(bike_type: str | None) -> RidingStyle:
    """Resolve a modalidade biomecânica a partir do tipo de bicicleta registado.

    Se o valor for omisso ou desconhecido, emite um aviso no log e aplica
    o perfil ROAD como padrão ergonómico.
    """
    if not bike_type:
        logger.debug("Tipo de bicicleta omisso; a aplicar modalidade padrão ROAD.")
        return RidingStyle.ROAD

    clean = bike_type.strip().lower()
    try:
        return RidingStyle(clean)
    except ValueError:
        logger.warning(
            "Tipo de bicicleta desconhecido '%s'; a aplicar modalidade ergonómica padrão ROAD.",
            bike_type,
        )
        return RidingStyle.ROAD


def build_diagnostics(
    modality: RidingStyle,
    knee_angle: float | None,
    back_angle: float | None,
    arm_angle: float | None,
    ankle_angle: float | None,
    current_saddle_height_cm: float | None = None,
    theoretical_saddle_height_cm: float | None = None,
    knee_bdc: float | None = None,
    confidence_score: float = 1.0,
    withhold_reason: str | None = None,
) -> DiagnosticsBundle:
    """Executa a avaliação postural das articulações e constrói o pacote unificado de diagnósticos.

    Aplica portão de qualidade (gating): se confidence_score < 0.60, as medições são retidas
    (withheld=True) e nenhuma recomendação de ajuste é emitida para proteger o atleta.
    """
    diagnostics_raw = evaluate_posture_angles(
        modality=modality,
        knee_angle=knee_angle,
        back_angle=back_angle,
        arm_angle=arm_angle,
        ankle_angle=ankle_angle,
        current_saddle_height_cm=current_saddle_height_cm,
        theoretical_saddle_height_cm=theoretical_saddle_height_cm,
        knee_bdc=knee_bdc,
    )

    is_withheld = confidence_score < 0.60
    effective_reason = (
        withhold_reason
        if is_withheld and withhold_reason
        else (f"Confiança de medição ({confidence_score:.2f} < 0.60) abaixo do limiar clínico" if is_withheld else None)
    )

    diagnostics_pydantic = [
        DiagnosticItem(
            joint_name=d.joint_name,
            measured_angle=d.measured_angle,
            ideal_min=d.ideal_min,
            ideal_max=d.ideal_max,
            is_compliant=d.is_compliant if not is_withheld else False,
            status_label_pt=d.status_label_pt if not is_withheld else f"{d.status_label_pt} (Retido)",
            status_label_en=d.status_label_en if not is_withheld else f"{d.status_label_en} (Withheld)",
            recommendation_pt=(
                d.recommendation_pt
                if not is_withheld
                else "Diagnóstico retido por baixa confiança na captura/amostragem."
            ),
            recommendation_en=(
                d.recommendation_en
                if not is_withheld
                else "Diagnostic withheld due to low capture/sample confidence."
            ),
            adjustment_delta=d.adjustment_delta if not is_withheld else None,
            adjustment_unit=d.adjustment_unit,
            joint_id=d.joint_id.value if d.joint_id else None,
            withheld=is_withheld,
            confidence=round(confidence_score, 3),
            withhold_reason=effective_reason,
        )
        for d in diagnostics_raw
    ]

    total_count = len(diagnostics_pydantic)
    if total_count == 0 or is_withheld:
        return DiagnosticsBundle(
            diagnostics_raw=diagnostics_raw,
            diagnostics_pydantic=diagnostics_pydantic,
            compliance_percentage=None,
            compliant_count=0,
            total_count=total_count,
        )

    compliant_count = sum(1 for d in diagnostics_pydantic if d.is_compliant)
    compliance_pct = round((compliant_count / total_count) * 100.0, 1)

    return DiagnosticsBundle(
        diagnostics_raw=diagnostics_raw,
        diagnostics_pydantic=diagnostics_pydantic,
        compliance_percentage=compliance_pct,
        compliant_count=compliant_count,
        total_count=total_count,
    )


def format_angles_summary_for_report(
    diagnostics_raw: list[PostureDiagnostic],
    language: str = "pt",
) -> list[dict[str, Any]]:
    """Gera o sumário tabular de ângulos para inclusão nos geradores de PDF e parecer do AI Coach."""
    is_pt = language.lower() == "pt"
    return [
        {
            "name": d.joint_name.capitalize(),
            "angle": d.measured_angle,
            "range": f"{d.ideal_min:.0f}° - {d.ideal_max:.0f}°",
            "compliant": d.is_compliant,
            "recommendation": d.recommendation_pt if is_pt else d.recommendation_en,
        }
        for d in diagnostics_raw
    ]
