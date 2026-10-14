"""Pré-processamento de sinais cinemáticos de pedalada (filtragem, interpolação e suavização).

Garante que séries temporais contendo ruído de rastreio ou pequenos dropouts
sejam condicionadas antes da extração de picos e análise de Fourier/autocorrelação.
"""

from __future__ import annotations

from typing import cast

import numpy as np
import numpy.typing as npt
from scipy.signal import butter, filtfilt, savgol_filter

from athletemotion.domain.cycle.types import CycleParams


def interpolate_short_gaps(
    time_s: npt.NDArray[np.float64],
    signal: npt.NDArray[np.float64],
    max_gap_s: float = 0.150,
) -> npt.NDArray[np.float64]:
    """Interpola linearmente falhas ou NaNs cuja duração seja inferior a max_gap_s.

    Se uma falha for superior ao limiar de segurança (150 ms), os valores mantêm-se NaN
    para impedir a invenção de trajetória durante oclusões prolongadas.

    Args:
        time_s: Array com instantes temporais em segundos.
        signal: Array 1D com o sinal a processar (pode conter NaNs).
        max_gap_s: Duração máxima de gap a interpolar (150 ms por defeito).

    Returns:
        np.ndarray com gaps curtos interpolados.
    """
    cleaned = signal.copy()
    valid_mask = ~np.isnan(cleaned)

    if not np.any(valid_mask):
        return cleaned

    # Identificar blocos de NaNs consecutivos
    nan_indices = np.where(~valid_mask)[0]
    if len(nan_indices) == 0:
        return cleaned

    # Agrupar índices contíguos de NaN
    gap_starts = []
    gap_ends = []
    in_gap = False

    for i in range(len(signal)):
        if np.isnan(signal[i]):
            if not in_gap:
                gap_starts.append(i)
                in_gap = True
        else:
            if in_gap:
                gap_ends.append(i - 1)
                in_gap = False
    if in_gap:
        gap_ends.append(len(signal) - 1)

    for start_idx, end_idx in zip(gap_starts, gap_ends, strict=False):
        # Verifica duração do gap
        t_before = time_s[start_idx - 1] if start_idx > 0 else time_s[0]
        t_after = time_s[end_idx + 1] if end_idx < len(time_s) - 1 else time_s[-1]
        gap_duration = t_after - t_before

        # Se o gap estiver contido entre amostras válidas e for <= max_gap_s
        if start_idx > 0 and end_idx < len(time_s) - 1 and gap_duration <= max_gap_s:
            x_vals = [time_s[start_idx - 1], time_s[end_idx + 1]]
            y_vals = [signal[start_idx - 1], signal[end_idx + 1]]
            interp_t = time_s[start_idx : end_idx + 1]
            cleaned[start_idx : end_idx + 1] = np.interp(interp_t, x_vals, y_vals)

    return cleaned


def smooth_signal_savgol(
    signal: npt.NDArray[np.float64],
    window_length: int = 11,
    polyorder: int = 3,
) -> npt.NDArray[np.float64]:
    """Aplica o filtro Savitzky-Golay preservando a curvatura dos extremos (BDC/TDC).

    Diferente de filtros passa-baixo lineares que atenuam picos acentuados,
    o filtro Savitzky-Golay ajusta polinómios locais preservando a amplitude dos extremos.

    Args:
        signal: Array 1D com sinal numérico contínuo.
        window_length: Tamanho da janela local (ímpar).
        polyorder: Ordem do polinómio.

    Returns:
        np.ndarray do sinal suavizado.
    """
    n = len(signal)
    if n < window_length:
        return signal

    # Garantir janela ímpar
    win = window_length if window_length % 2 != 0 else window_length + 1
    if win >= n:
        win = n - 1 if (n - 1) % 2 != 0 else n - 2
    if win <= polyorder:
        return signal

    return cast(
        npt.NDArray[np.float64],
        savgol_filter(signal, window_length=win, polyorder=polyorder),
    )


def smooth_signal_butterworth(
    signal: npt.NDArray[np.float64],
    fps: float,
    cutoff_hz: float = 5.0,
    order: int = 2,
) -> npt.NDArray[np.float64]:
    """Aplica um filtro passa-baixo Butterworth zero-fase (forward-backward).

    Útil para remover ruído de alta frequência sem introduzir atraso de fase.
    """
    nyquist = 0.5 * fps
    normal_cutoff = min(cutoff_hz / nyquist, 0.99)
    if normal_cutoff <= 0.0 or len(signal) <= 3 * order:
        return signal

    b, a = butter(order, normal_cutoff, btype="low", analog=False)
    return cast(npt.NDArray[np.float64], filtfilt(b, a, signal))


def preprocess_pedaling_series(
    timestamps_ms: npt.NDArray[np.float64],
    ankle_y: npt.NDArray[np.float64],
    knee_angles: npt.NDArray[np.float64] | None = None,
    params: CycleParams | None = None,
) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64], npt.NDArray[np.float64] | None]:
    """Aplica o fluxo completo de pré-processamento às séries temporais de entrada.

    Fluxo:
    1. Conversão temporal para segundos e interpolação de gaps curtos (≤ 150 ms).
    2. Suavização polinomial Savitzky-Golay para preservar extremos físicos.

    Returns:
        Tuplo com (timestamps_ms, ankle_y_smooth, knee_angles_smooth).
    """
    cfg = params or CycleParams()
    time_s = timestamps_ms / 1000.0

    # 1. Interpolação de micro-falhas
    cleaned_ankle_y = interpolate_short_gaps(time_s, ankle_y, max_gap_s=cfg.max_gap_interpolation_ms / 1000.0)

    # Preencher eventuais NaNs residuais nas pontas
    if np.any(np.isnan(cleaned_ankle_y)):
        valid_idx = np.where(~np.isnan(cleaned_ankle_y))[0]
        if len(valid_idx) > 0:
            cleaned_ankle_y = np.interp(time_s, time_s[valid_idx], cleaned_ankle_y[valid_idx])

    # 2. Filtragem Savitzky-Golay
    smoothed_ankle_y = smooth_signal_savgol(
        cleaned_ankle_y, window_length=cfg.sg_window_length, polyorder=cfg.sg_polyorder
    )

    # 3. Processar ângulos do joelho se fornecidos
    smoothed_knee_angles = None
    if knee_angles is not None:
        cleaned_knee = interpolate_short_gaps(
            time_s, knee_angles, max_gap_s=cfg.max_gap_interpolation_ms / 1000.0
        )
        if np.any(np.isnan(cleaned_knee)):
            valid_idx = np.where(~np.isnan(cleaned_knee))[0]
            if len(valid_idx) > 0:
                cleaned_knee = np.interp(time_s, time_s[valid_idx], cleaned_knee[valid_idx])
        smoothed_knee_angles = smooth_signal_savgol(
            cleaned_knee, window_length=cfg.sg_window_length, polyorder=cfg.sg_polyorder
        )

    return timestamps_ms, smoothed_ankle_y, smoothed_knee_angles
