"""Módulo de domínio puro para deteção de ciclos de pedalada, BDC/TDC e cadência."""

from __future__ import annotations

from athletemotion.domain.cycle.detector import BatchCycleDetector
from athletemotion.domain.cycle.metrics import (
    aggregate_session_summary,
    estimate_cadence_autocorr_and_fft,
)
from athletemotion.domain.cycle.preprocess import (
    interpolate_short_gaps,
    preprocess_pedaling_series,
    smooth_signal_butterworth,
    smooth_signal_savgol,
)
from athletemotion.domain.cycle.streaming import OnlineCycleDetector
from athletemotion.domain.cycle.types import (
    CycleEvent,
    CycleMetrics,
    CycleParams,
    PedalingSample,
    SessionCycleSummary,
)

__all__ = [
    "BatchCycleDetector",
    "CycleEvent",
    "CycleMetrics",
    "CycleParams",
    "OnlineCycleDetector",
    "PedalingSample",
    "SessionCycleSummary",
    "aggregate_session_summary",
    "estimate_cadence_autocorr_and_fft",
    "interpolate_short_gaps",
    "preprocess_pedaling_series",
    "smooth_signal_butterworth",
    "smooth_signal_savgol",
]
