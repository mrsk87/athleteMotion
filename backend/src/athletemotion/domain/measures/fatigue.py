"""Módulo de deteção e quantificação de fadiga biomecânica e deriva cinemática (Drift).

Compara o primeiro terço da sessão (fresco/estável) com o último terço (potencial fadiga)
recorrendo ao teste não-paramétrico de Mann-Whitney U para validação de significância estatística.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from scipy.stats import mannwhitneyu


@dataclass(frozen=True)
class FatigueMetricDrift:
    """Deriva e teste estatístico de uma métrica postural ou motora ao longo do tempo."""

    metric_name: str
    unit: str
    early_mean: float
    late_mean: float
    drift: float  # late_mean - early_mean
    p_value: float
    significant: bool
    interpretation_pt: str
    interpretation_en: str


@dataclass(frozen=True)
class FatigueReport:
    """Relatório global de fadiga e deriva postural na sessão."""

    metrics: list[FatigueMetricDrift]
    cycles_total: int
    early_cycles_count: int
    late_cycles_count: int
    overall_fatigue_detected: bool
    summary_pt: str
    summary_en: str


def _safe_mann_whitney(early: Sequence[float], late: Sequence[float]) -> float:
    """Executa o teste Mann-Whitney U de forma defensiva para amostras reais ou sintéticas."""
    arr_early = np.asarray(early, dtype=np.float64)
    arr_late = np.asarray(late, dtype=np.float64)

    if len(arr_early) < 3 or len(arr_late) < 3:
        return 1.0

    # Se ambas as amostras forem idênticas sem variância
    if np.all(arr_early == arr_early[0]) and np.all(arr_late == arr_early[0]):
        return 1.0

    try:
        res = mannwhitneyu(arr_early, arr_late, alternative="two-sided")
        return float(res.pvalue)
    except Exception:
        return 1.0


def evaluate_metric_drift(
    metric_name: str,
    unit: str,
    early_samples: Sequence[float],
    late_samples: Sequence[float],
    clinical_effect_threshold: float,
    alpha: float = 0.05,
) -> FatigueMetricDrift:
    """Calcula a deriva temporal e a significância estatística e clínica."""
    if not early_samples or not late_samples:
        return FatigueMetricDrift(
            metric_name=metric_name,
            unit=unit,
            early_mean=0.0,
            late_mean=0.0,
            drift=0.0,
            p_value=1.0,
            significant=False,
            interpretation_pt="Dados insuficientes para cálculo de deriva.",
            interpretation_en="Insufficient data for drift calculation.",
        )

    e_mean = float(np.mean(early_samples))
    l_mean = float(np.mean(late_samples))
    drift = l_mean - e_mean

    p_val = _safe_mann_whitney(early_samples, late_samples)
    is_stat_sig = p_val < alpha
    is_clin_sig = abs(drift) >= clinical_effect_threshold
    significant = is_stat_sig and is_clin_sig

    drift_r = round(drift, 2)
    e_mean_r = round(e_mean, 1)
    l_mean_r = round(l_mean, 1)
    p_val_r = round(p_val, 4)

    # Interpretação clínica orientada
    if significant:
        if metric_name == "knee_bdc":
            if drift > 0:
                int_pt = f"Aumento significativo da extensão do joelho (+{drift_r}°). O atleta descaí para trás no selim ou perde controlo pélvico."
                int_en = f"Significant increase in knee extension (+{drift_r}°). Athlete slipping back or losing pelvic control."
            else:
                int_pt = f"Aumento da flexão do joelho ({drift_r}°). O atleta avança a bacia na ponta do selim com o cansaço."
                int_en = f"Increased knee flexion ({drift_r}°). Athlete shifting forward to saddle nose with fatigue."
        elif metric_name == "torso_inclination":
            if drift > 0:
                int_pt = f"Tronco mais ereto (+{drift_r}°). Perda de sustentação postural dos músculos lombares."
                int_en = f"More upright torso (+{drift_r}°). Loss of core/lumbar postural endurance."
            else:
                int_pt = f"Tronco mais baixo/colapsado ({drift_r}°). Cansaço muscular dos membros superiores/escapulares."
                int_en = f"Torso dropping lower ({drift_r}°). Upper body / scapular fatigue."
        elif metric_name == "cadence_rpm":
            int_pt = f"Deriva de cadência de {drift_r} RPM (p={p_val_r}). Perda de ritmo neuromuscular."
            int_en = f"Cadence drift of {drift_r} RPM (p={p_val_r}). Neuromuscular pacing fatigue."
        else:
            int_pt = f"Deriva significativa de {drift_r} {unit} (p={p_val_r})."
            int_en = f"Significant drift of {drift_r} {unit} (p={p_val_r})."
    else:
        int_pt = f"Variação estável ({drift_r} {unit}, p={p_val_r}). Sem evidência de fadiga."
        int_en = f"Stable variation ({drift_r} {unit}, p={p_val_r}). No evidence of fatigue."

    return FatigueMetricDrift(
        metric_name=metric_name,
        unit=unit,
        early_mean=e_mean_r,
        late_mean=l_mean_r,
        drift=drift_r,
        p_value=p_val_r,
        significant=significant,
        interpretation_pt=int_pt,
        interpretation_en=int_en,
    )


def analyze_session_fatigue(
    cycle_knee_bdc_series: Sequence[float],
    cycle_torso_series: Sequence[float] | None = None,
    cycle_cadence_series: Sequence[float] | None = None,
    min_cycles: int = 6,
) -> FatigueReport:
    """Compara o terço inicial com o terço final de uma sessão para avaliar fadiga global."""
    n = len(cycle_knee_bdc_series)
    if n < min_cycles:
        return FatigueReport(
            metrics=[],
            cycles_total=n,
            early_cycles_count=0,
            late_cycles_count=0,
            overall_fatigue_detected=False,
            summary_pt=f"Sessão demasiado curta ({n} ciclos < {min_cycles} requeridos) para deteção fiável de fadiga.",
            summary_en=f"Session too short ({n} cycles < {min_cycles} required) for reliable fatigue detection.",
        )

    # Divisão em terços
    split_size = max(2, n // 3)
    early_idx = slice(0, split_size)
    late_idx = slice(n - split_size, n)

    metrics: list[FatigueMetricDrift] = []

    # 1. Joelho BDC (limiar clínico: 2.0°)
    knee_early = cycle_knee_bdc_series[early_idx]
    knee_late = cycle_knee_bdc_series[late_idx]
    knee_metric = evaluate_metric_drift("knee_bdc", "°", knee_early, knee_late, clinical_effect_threshold=2.0)
    metrics.append(knee_metric)

    # 2. Tronco (limiar clínico: 2.5°)
    if cycle_torso_series and len(cycle_torso_series) == n:
        torso_early = cycle_torso_series[early_idx]
        torso_late = cycle_torso_series[late_idx]
        torso_metric = evaluate_metric_drift("torso_inclination", "°", torso_early, torso_late, clinical_effect_threshold=2.5)
        metrics.append(torso_metric)

    # 3. Cadência (limiar clínico: 3.0 RPM)
    if cycle_cadence_series and len(cycle_cadence_series) == n:
        cad_early = cycle_cadence_series[early_idx]
        cad_late = cycle_cadence_series[late_idx]
        cad_metric = evaluate_metric_drift("cadence_rpm", "RPM", cad_early, cad_late, clinical_effect_threshold=3.0)
        metrics.append(cad_metric)

    fatigue_detected = any(m.significant for m in metrics)

    if fatigue_detected:
        sig_names = [m.metric_name for m in metrics if m.significant]
        summary_pt = f"Fadiga identificada com deriva estatisticamente significativa em: {', '.join(sig_names)}."
        summary_en = f"Fatigue identified with statistically significant drift in: {', '.join(sig_names)}."
    else:
        summary_pt = "Padrão biomecânico e cadência estáveis ao longo de toda a sessão. Sem fadiga mensurável."
        summary_en = "Biomechanical pattern and cadence remained stable throughout the session. No measurable fatigue."

    return FatigueReport(
        metrics=metrics,
        cycles_total=n,
        early_cycles_count=split_size,
        late_cycles_count=split_size,
        overall_fatigue_detected=fatigue_detected,
        summary_pt=summary_pt,
        summary_en=summary_en,
    )
