"""Cálculo de métricas por ciclo, estimativa de cadência por FFT/Autocorrelação e agregação estatística com MAD."""

from __future__ import annotations

from typing import Literal, cast

import numpy as np
import numpy.typing as npt
from scipy.signal import find_peaks

from athletemotion.domain.cycle.types import (
    CycleMetrics,
    CycleParams,
    SessionCycleSummary,
)


def estimate_cadence_autocorr_and_fft(
    time_s: npt.NDArray[np.float64],
    signal: npt.NDArray[np.float64],
    min_rpm: float = 30.0,
    max_rpm: float = 140.0,
) -> tuple[float, float]:
    """Estima a cadência (RPM) e o índice de confiança de periodicidade [0, 1].

    Combina a Análise de Autocorrelação com a Transformada Rápida de Fourier (FFT):
    1. A autocorrelação encontra o período fundamental T minimizando harmónicas.
    2. A FFT identifica a frequência dominante com resolução espectral.
    3. A validação cruzada entre ambos determina o índice de confiança.

    Args:
        time_s: Instantes temporais uniformes em segundos.
        signal: Sinal oscilatório representativo (ex: posição Y do tornozelo).
        min_rpm: Limiar inferior de cadência humana plausível (30 RPM).
        max_rpm: Limiar superior de cadência plausível (140 RPM).

    Returns:
        Tuplo com (cadence_rpm, periodicity_confidence).
    """
    n = len(signal)
    if n < 30:
        return 0.0, 0.0

    duration = time_s[-1] - time_s[0]
    if duration <= 0:
        return 0.0, 0.0

    fs = float(n / duration)

    # Remover componente contínua (DC offset) e tendência linear
    detrended = signal - np.mean(signal)
    norm_factor = np.sum(detrended**2)
    if norm_factor < 1e-6:
        return 0.0, 0.0

    # 1. Autocorrelação normalizada
    autocorr = np.correlate(detrended, detrended, mode="full")[n - 1 :]
    autocorr = autocorr / autocorr[0]

    # Intervalo de atraso (lag) admissível em amostras
    min_lag = round(fs * (60.0 / max_rpm))
    max_lag = round(fs * (60.0 / min_rpm))
    max_lag = min(max_lag, n - 2)

    if min_lag >= max_lag or min_lag >= n:
        return 0.0, 0.0

    search_region = autocorr[min_lag : max_lag + 1]
    peaks, properties = find_peaks(search_region, height=0.2, distance=max(1, int(min_lag * 0.7)))

    rpm_autocorr = 0.0
    autocorr_confidence = 0.0

    if len(peaks) > 0:
        best_peak_idx = peaks[np.argmax(properties["peak_heights"])]
        actual_lag = min_lag + best_peak_idx
        autocorr_confidence = float(np.clip(autocorr[actual_lag], 0.0, 1.0))
        period_s = actual_lag / fs
        rpm_autocorr = 60.0 / period_s if period_s > 0 else 0.0

    # 2. Análise espectral por FFT
    freqs = np.fft.rfftfreq(n, d=1.0 / fs)
    fft_vals = np.abs(np.fft.rfft(detrended))

    # Filtrar gama [min_rpm, max_rpm] em Hertz
    f_min = min_rpm / 60.0
    f_max = max_rpm / 60.0
    valid_freq_mask = (freqs >= f_min) & (freqs <= f_max)

    rpm_fft = 0.0
    if np.any(valid_freq_mask):
        sub_freqs = freqs[valid_freq_mask]
        sub_fft = fft_vals[valid_freq_mask]
        peak_fft_idx = np.argmax(sub_fft)
        best_freq = sub_freqs[peak_fft_idx]
        rpm_fft = float(best_freq * 60.0)

    # 3. Fusão e validação cruzada
    if rpm_autocorr > 0 and rpm_fft > 0:
        diff_pct = abs(rpm_autocorr - rpm_fft) / ((rpm_autocorr + rpm_fft) / 2.0)
        if diff_pct < 0.10:  # Diferença inferior a 10%
            final_rpm = float(0.6 * rpm_autocorr + 0.4 * rpm_fft)
            final_conf = float(np.clip(autocorr_confidence * (1.0 - diff_pct), 0.0, 1.0))
        else:
            final_rpm = float(rpm_autocorr)
            final_conf = float(autocorr_confidence * 0.5)
    elif rpm_autocorr > 0:
        final_rpm = float(rpm_autocorr)
        final_conf = float(autocorr_confidence * 0.7)
    elif rpm_fft > 0:
        final_rpm = float(rpm_fft)
        final_conf = 0.4
    else:
        final_rpm = 0.0
        final_conf = 0.0

    return round(final_rpm, 1), round(final_conf, 2)


def compute_mad_outliers(
    values: npt.NDArray[np.float64], threshold: float = 3.0
) -> npt.NDArray[np.bool_]:
    """Identifica índices de outliers através da Desvio Absoluto Mediano (MAD).

    MAD = median(|x_i - median(x)|). É robusto a valores aberrantes extremos
    diferente do desvio padrão padrão baseado na média.
    """
    if len(values) < 4:
        return np.zeros(len(values), dtype=bool)

    median = float(np.median(values))
    abs_deviations = np.abs(values - median)
    mad = float(np.median(abs_deviations))

    if mad < 1e-6:
        return np.zeros(len(values), dtype=bool)

    # Fator de consistência normal para distribuição Gaussiana: 1.4826
    modified_z_scores = 0.6745 * abs_deviations / mad
    return cast(npt.NDArray[np.bool_], modified_z_scores > threshold)


def aggregate_session_summary(
    cycles: list[CycleMetrics],
    periodicity_confidence: float = 1.0,
    params: CycleParams | None = None,
) -> SessionCycleSummary:
    """Agrega os ciclos detetados e calcula médias, medianas e dispersão estatística.

    Se existirem menos de min_valid_cycles (5 ciclos), classifica a proveniência como
    'manual_snapshots' para indicar que não há estabilidade temporal suficiente.
    """
    cfg = params or CycleParams()
    total = len(cycles)
    valid_cycles = [c for c in cycles if c.valid]
    rejected_count = total - len(valid_cycles)

    if len(valid_cycles) == 0:
        return SessionCycleSummary(
            total_cycles_detected=total,
            valid_cycles_count=0,
            rejected_cycles_count=rejected_count,
            cadence_rpm_mean=0.0,
            cadence_rpm_std=0.0,
            knee_bdc_mean=0.0,
            knee_bdc_median=0.0,
            knee_bdc_std=0.0,
            knee_tdc_mean=0.0,
            knee_tdc_median=0.0,
            knee_tdc_std=0.0,
            knee_rom_mean=0.0,
            source="manual_snapshots",
            periodicity_confidence=periodicity_confidence,
            outliers_count=0,
        )

    bdc_angles = np.array([c.knee_bdc for c in valid_cycles], dtype=float)
    tdc_angles = np.array([c.knee_tdc for c in valid_cycles], dtype=float)
    rpms = np.array([c.cadence_rpm for c in valid_cycles], dtype=float)
    roms = np.array([c.knee_rom for c in valid_cycles], dtype=float)

    # Deteção de outliers via MAD
    outliers_mask = compute_mad_outliers(bdc_angles)
    outliers_count = int(np.sum(outliers_mask))

    # Se houver outliers mas sobrarem ciclos válidos suficientes, filtra os outliers das médias
    clean_bdc = bdc_angles[~outliers_mask] if len(bdc_angles[~outliers_mask]) >= 3 else bdc_angles

    source_typed: Literal["cycle_detection", "manual_snapshots"] = (
        "cycle_detection" if len(valid_cycles) >= cfg.min_valid_cycles else "manual_snapshots"
    )

    return SessionCycleSummary(
        total_cycles_detected=total,
        valid_cycles_count=len(valid_cycles),
        rejected_cycles_count=rejected_count,
        cadence_rpm_mean=round(float(np.mean(rpms)), 1),
        cadence_rpm_std=round(float(np.std(rpms)), 1),
        knee_bdc_mean=round(float(np.mean(clean_bdc)), 1),
        knee_bdc_median=round(float(np.median(clean_bdc)), 1),
        knee_bdc_std=round(float(np.std(clean_bdc)), 1),
        knee_tdc_mean=round(float(np.mean(tdc_angles)), 1),
        knee_tdc_median=round(float(np.median(tdc_angles)), 1),
        knee_tdc_std=round(float(np.std(tdc_angles)), 1),
        knee_rom_mean=round(float(np.mean(roms)), 1),
        source=source_typed,
        periodicity_confidence=periodicity_confidence,
        outliers_count=outliers_count,
    )
