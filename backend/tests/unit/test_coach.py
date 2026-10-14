"""Testes unitários para o Treinador Biomecânico determinístico (R09)."""

from __future__ import annotations

import json
from pathlib import Path

from athletemotion.domain.biomechanics.thresholds import FlexibilityLevel, RidingStyle
from athletemotion.schemas.coach import FindingStatus
from athletemotion.services.ai_coach import generate_coaching_narrative
from athletemotion.services.coach.narrative import (
    CoachContext,
    build_coach_report,
)
from athletemotion.services.coach.rewriter import (
    NoopRewriter,
    verify_numeric_fidelity,
)
from athletemotion.services.coach.rules import assess_elbow, assess_knee, assess_torso


def test_i18n_key_parity():
    """Garante que pt.json e en.json contêm exatamente as mesmas chaves."""
    base_dir = (
        Path(__file__).resolve().parents[2]
        / "src"
        / "athletemotion"
        / "services"
        / "coach"
        / "i18n"
    )
    pt_path = base_dir / "pt.json"
    en_path = base_dir / "en.json"

    assert pt_path.exists(), f"Ficheiro {pt_path} não encontrado"
    assert en_path.exists(), f"Ficheiro {en_path} não encontrado"

    with pt_path.open("r", encoding="utf-8") as f:
        pt_keys = set(json.load(f).keys())

    with en_path.open("r", encoding="utf-8") as f:
        en_keys = set(json.load(f).keys())

    diff_pt = pt_keys - en_keys
    diff_en = en_keys - pt_keys

    assert diff_pt == set(), f"Chaves presentes em pt.json mas em falta em en.json: {diff_pt}"
    assert diff_en == set(), f"Chaves presentes em en.json mas em falta em pt.json: {diff_en}"


def test_missing_knee_does_not_invent_value():
    """Garante que sem medição de joelho, o sistema reporta 'insufficient' e não inventa 148.0°."""
    finding = assess_knee(None, RidingStyle.ROAD)
    assert finding.status == FindingStatus.INSUFFICIENT
    assert finding.measured_angle is None
    assert finding.delta == 0.0

    ctx = CoachContext(athlete_name="João", modality=RidingStyle.ROAD)
    report = build_coach_report([finding], ctx, language="pt")

    assert report.data_quality.is_complete is False
    assert "knee" in report.data_quality.missing_joints
    assert "148.0" not in report.executive_summary
    assert "148" not in report.executive_summary
    assert "perfeitamente alinhada" not in report.executive_summary.lower()
    # No caso de todos insuficientes, o título/sumário explicita falta de dados
    assert (
        "insuficiente" in report.title.lower()
        or "não foi possível" in report.executive_summary.lower()
    )

    # Caso em que o tronco está presente mas o joelho está ausente:
    finding_torso = assess_torso(45.0, RidingStyle.ROAD)
    report_partial = build_coach_report([finding, finding_torso], ctx, language="pt")
    assert "não foi medido" in report_partial.executive_summary.lower()
    assert "148.0" not in report_partial.executive_summary


def test_all_missing_angles_produces_empty_plan():
    """Quando nenhuma medição está disponível, o sumário declara insuficiência e o plano é vazio."""
    findings = [
        assess_knee(None, RidingStyle.ROAD),
        assess_torso(None, RidingStyle.ROAD),
        assess_elbow(None, RidingStyle.ROAD),
    ]
    ctx = CoachContext(athlete_name="Maria")
    report = build_coach_report(findings, ctx, language="pt")

    assert report.data_quality.is_complete is False
    assert len(report.data_quality.available_joints) == 0
    assert len(report.data_quality.missing_joints) == 3
    assert report.adaptation_plan == []
    assert (
        "insuficientes" in report.title.lower()
        or "insuficientes" in report.executive_summary.lower()
    )


def test_knee_boundary_values_are_deterministic():
    """Testa os limites fechados [145.0, 155.0] em estrada (RidingStyle.ROAD)."""
    # 145.0° exato -> OK
    f_min = assess_knee(145.0, RidingStyle.ROAD)
    assert f_min.status == FindingStatus.OK
    assert f_min.delta == 0.0

    # 155.0° exato -> OK
    f_max = assess_knee(155.0, RidingStyle.ROAD)
    assert f_max.status == FindingStatus.OK
    assert f_max.delta == 0.0

    # 144.9° -> LOW
    f_low = assess_knee(144.9, RidingStyle.ROAD)
    assert f_low.status == FindingStatus.LOW
    assert f_low.delta == 0.1

    # 155.1° -> HIGH
    f_high = assess_knee(155.1, RidingStyle.ROAD)
    assert f_high.status == FindingStatus.HIGH
    assert f_high.delta == 0.1


def test_english_narrative_with_exact_numbers():
    """Garante que em inglês a narrativa utiliza textos em inglês e números exatos."""
    findings = [
        assess_knee(141.5, RidingStyle.ROAD),
        assess_torso(42.0, RidingStyle.ROAD, FlexibilityLevel.MEDIUM),
        assess_elbow(162.0, RidingStyle.ROAD),
    ]
    ctx = CoachContext(
        athlete_name="Sarah",
        modality=RidingStyle.ROAD,
        flexibility=FlexibilityLevel.MEDIUM,
        cadence_rpm=92,
        power_watts=220,
        kops_offset_mm=12.5,
    )
    report = build_coach_report(findings, ctx, language="en")

    assert "Biomechanical Coach" in report.title
    assert "141.5" in report.executive_summary
    assert "flexion" in report.executive_summary.lower()
    assert "12.5 mm" in report.kops_insight or "12.5" in report.kops_insight
    assert "92 RPM" in report.cadence_power_insight
    assert "220 W" in report.cadence_power_insight
    assert len(report.adaptation_plan) == 3


def test_kops_directionality_pt_and_en():
    """Valida se o avanço e recuo de KOPS reportam mm corretos em PT e EN."""
    ctx_fwd = CoachContext(kops_offset_mm=8.4)
    rep_pt_fwd = build_coach_report([assess_knee(150.0)], ctx_fwd, language="pt")
    assert "8.4 mm" in rep_pt_fwd.kops_insight
    assert "avanço" in rep_pt_fwd.kops_insight

    ctx_bwd = CoachContext(kops_offset_mm=-6.2)
    rep_en_bwd = build_coach_report([assess_knee(150.0)], ctx_bwd, language="en")
    assert "6.2 mm" in rep_en_bwd.kops_insight
    assert "behind" in rep_en_bwd.kops_insight.lower()


def test_rewriter_fidelity_validation():
    """Valida o funcionamento do validador de integridade numérica do rewriter."""
    original = "O joelho está a 148.5° e o desvio KOPS é 12.0 mm."
    same_numbers = "Medição confirmada: 148.5 graus no joelho com 12.0 mm de KOPS."
    missing_numbers = "O joelho está quase perfeito com ajuste leve."

    assert verify_numeric_fidelity(original, same_numbers) is True
    assert verify_numeric_fidelity(original, missing_numbers) is False

    noop = NoopRewriter()
    assert noop.rewrite(original, {}) == original


def test_legacy_shim_generate_coaching_narrative():
    """Garante que a função legada generate_coaching_narrative continua a funcionar sem inventar valores."""
    athlete_data = {"name": "Carlos", "flexibility": "low"}
    bike_data = {"modality": "road"}
    angles_summary = [
        {"name": "joelho", "angle": 140.0},
        {"name": "costas", "angle": 38.0},
    ]

    legacy_res = generate_coaching_narrative(
        athlete_data=athlete_data,
        bike_data=bike_data,
        angles_summary=angles_summary,
        language="pt",
    )

    assert "executive_summary" in legacy_res
    assert "140.0" in legacy_res["executive_summary"]
    assert "cockpit_analysis" in legacy_res
    assert "data_quality" in legacy_res
    assert legacy_res["data_quality"]["is_complete"] is False  # Cotovelo em falta
    assert "elbow" in legacy_res["data_quality"]["missing_joints"]
