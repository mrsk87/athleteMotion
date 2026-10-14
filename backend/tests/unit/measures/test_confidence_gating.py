"""Testes unitários de cálculo de confiança e portão de qualidade (gating)."""

from __future__ import annotations

from athletemotion.domain.biomechanics.thresholds import RidingStyle
from athletemotion.domain.measures.confidence import (
    GATING_THRESHOLD,
    calculate_measure_confidence,
)
from athletemotion.services.report_builder import build_diagnostics


def test_high_quality_passes_gating() -> None:
    """Amostra estável com visibilidade e ciclos plenos deve passar o portão."""
    conf = calculate_measure_confidence(
        visibility=0.95,
        cycles_count=10,
        periodicity_confidence=0.90,
    )
    assert conf.score >= GATING_THRESHOLD
    assert not conf.withheld
    assert conf.withhold_reason is None
    assert conf.factors["visibility"] == 0.95


def test_low_visibility_withheld() -> None:
    """Visibilidade muito baixa (<0.40) deve acionar a retenção e indicar motivo."""
    conf = calculate_measure_confidence(
        visibility=0.30,
        cycles_count=10,
        periodicity_confidence=0.90,
    )
    assert conf.score < GATING_THRESHOLD
    assert conf.withheld
    assert conf.withhold_reason is not None
    assert "baixa visibilidade" in conf.withhold_reason


def test_insufficient_cycles_withheld() -> None:
    """Apenas 1 ciclo gravado não satisfaz a amostragem clínica."""
    conf = calculate_measure_confidence(
        visibility=0.90,
        cycles_count=1,
        periodicity_confidence=0.40,
    )
    assert conf.score < GATING_THRESHOLD
    assert conf.withheld
    assert "amostragem insuficiente" in conf.withhold_reason or "cadência" in conf.withhold_reason


def test_metric_measure_without_calibration_is_zero() -> None:
    """Medidas dimensionais (mm) sem calibração têm pontuação 0.0 e retenção total."""
    conf = calculate_measure_confidence(
        visibility=0.95,
        cycles_count=10,
        periodicity_confidence=0.90,
        calibration_quality=0.0,
        metric_requires_calibration=True,
    )
    assert conf.score == 0.0
    assert conf.withheld
    assert "escala métrica não calibrada" in (conf.withhold_reason or "")


def test_build_diagnostics_gating_enforcement() -> None:
    """Quando o score de confiança for < 0.60, build_diagnostics retém os diagnósticos."""
    bundle = build_diagnostics(
        modality=RidingStyle.ROAD,
        knee_angle=130.0,  # ângulo fora do ideal
        back_angle=45.0,
        arm_angle=155.0,
        ankle_angle=95.0,
        confidence_score=0.45,  # abaixo de 0.60
        withhold_reason="Visibilidade precária",
    )

    assert bundle.compliance_percentage is None
    assert bundle.compliant_count == 0
    assert len(bundle.diagnostics_pydantic) > 0

    for item in bundle.diagnostics_pydantic:
        assert item.withheld is True
        assert item.adjustment_delta is None
        assert "retido" in item.status_label_pt.lower() or "retido" in item.recommendation_pt.lower()
        assert item.withhold_reason == "Visibilidade precária"
