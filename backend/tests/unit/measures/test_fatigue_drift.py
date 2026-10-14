"""Testes unitários de fadiga e deriva biomecânica com teste não-paramétrico de Mann-Whitney."""

from __future__ import annotations

import numpy as np

from athletemotion.domain.measures.fatigue import (
    analyze_session_fatigue,
    evaluate_metric_drift,
)


def test_fatigue_synthetic_drift_detected() -> None:
    """Verifica se uma deriva sintética de +3.0° é identificada com significant=True."""
    np.random.seed(42)
    # 20 ciclos: primeiros 6 têm média 145°, últimos 6 têm média 148° com ruído gaussiano (sigma=0.3)
    early = list(np.random.normal(145.0, 0.3, size=8))
    middle = list(np.random.normal(146.5, 0.3, size=8))
    late = list(np.random.normal(148.0, 0.3, size=8))
    series = early + middle + late

    report = analyze_session_fatigue(series)

    assert report.overall_fatigue_detected is True
    knee_metric = next(m for m in report.metrics if m.metric_name == "knee_bdc")
    assert knee_metric.significant is True
    assert abs(knee_metric.drift - 3.0) < 0.8
    assert knee_metric.p_value < 0.05


def test_fatigue_synthetic_no_drift_specificity_200_runs() -> None:
    """Critério R12: Sem drift, significant=False em >= 95% de 200 execuções com ruído (alfa=0.05)."""
    rng = np.random.default_rng(2026)
    n_runs = 200
    false_positives = 0

    for _ in range(n_runs):
        # 24 ciclos estacionários com ruído gaussiano (sigma=0.5°)
        early = rng.normal(148.0, 0.5, size=8)
        late = rng.normal(148.0, 0.5, size=8)

        metric = evaluate_metric_drift(
            metric_name="knee_bdc",
            unit="°",
            early_samples=list(early),
            late_samples=list(late),
            clinical_effect_threshold=2.0,
            alpha=0.05,
        )
        if metric.significant:
            false_positives += 1

    specificity_pct = ((n_runs - false_positives) / n_runs) * 100.0
    # Critério R12: sem drift -> False em >= 95% de 200 execuções com ruído
    assert (
        specificity_pct >= 95.0
    ), f"Especificidade ({specificity_pct:.1f}%) abaixo do limiar requerido de 95% ({false_positives} falsos positivos em {n_runs})"
