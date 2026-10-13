"""Filtro temporal One-Euro para estabilização de landmarks biomecânicos."""
from __future__ import annotations

import math
from typing import Dict, Optional
from .types import Landmark2D


class LowPassFilter:
    def __init__(self, alpha: float = 0.5):
        self.alpha = alpha
        self.hat_x_prev: Optional[float] = None

    def reset(self):
        self.hat_x_prev = None

    def filter(self, x: float, alpha: Optional[float] = None) -> float:
        if alpha is not None:
            self.alpha = alpha
        if self.hat_x_prev is None:
            self.hat_x_prev = x
            return x
        hat_x = self.alpha * x + (1.0 - self.alpha) * self.hat_x_prev
        self.hat_x_prev = hat_x
        return hat_x


class OneEuroFilter1D:
    def __init__(self, min_cutoff: float = 1.2, beta: float = 0.05, d_cutoff: float = 1.0):
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.x_filter = LowPassFilter()
        self.dx_filter = LowPassFilter()
        self.t_prev: Optional[float] = None

    def reset(self):
        self.x_filter.reset()
        self.dx_filter.reset()
        self.t_prev = None

    def _alpha(self, cutoff: float, dt: float) -> float:
        tau = 1.0 / (2.0 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def filter(self, x: float, timestamp_sec: float) -> float:
        if self.t_prev is None:
            self.t_prev = timestamp_sec
            return self.x_filter.filter(x)

        dt = timestamp_sec - self.t_prev
        # Se o timestamp não avançou, regrediu ou saltou (seek/loop/0ms),
        # nunca deixar dt colapsar para 1e-4 porque prenderia o valor no filtro.
        if dt <= 0.002 or dt > 0.5:
            if abs(timestamp_sec - self.t_prev) > 0.5:
                self.reset()
                self.t_prev = timestamp_sec
                return self.x_filter.filter(x)
            dt = 0.0333  # Passo nominal de 30 FPS (~33ms)

        self.t_prev = timestamp_sec

        # Estimar derivada (velocidade)
        prev_x = self.x_filter.hat_x_prev if self.x_filter.hat_x_prev is not None else x
        dx = (x - prev_x) / dt
        alpha_d = self._alpha(self.d_cutoff, dt)
        hat_dx = self.dx_filter.filter(dx, alpha_d)

        # Adaptar frequência de corte
        cutoff = self.min_cutoff + self.beta * abs(hat_dx)
        alpha = self._alpha(cutoff, dt)
        return self.x_filter.filter(x, alpha)


class LandmarkFilterPipeline:
    """Aplica filtros One-Euro independentes em X e Y para cada junta anatómica."""

    def __init__(self, min_cutoff: float = 1.2, beta: float = 0.05):
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.filters_x: Dict[str, OneEuroFilter1D] = {}
        self.filters_y: Dict[str, OneEuroFilter1D] = {}

    def reset(self):
        for f in self.filters_x.values():
            f.reset()
        for f in self.filters_y.values():
            f.reset()

    def filter_landmarks(self, landmarks: Dict[str, Landmark2D], timestamp_ms: int) -> Dict[str, Landmark2D]:
        import time
        if timestamp_ms <= 0:
            t_sec = time.perf_counter()
        else:
            t_sec = timestamp_ms / 1000.0
        filtered: Dict[str, Landmark2D] = {}

        for name, lm in landmarks.items():
            if name not in self.filters_x:
                self.filters_x[name] = OneEuroFilter1D(self.min_cutoff, self.beta)
                self.filters_y[name] = OneEuroFilter1D(self.min_cutoff, self.beta)

            smooth_x = self.filters_x[name].filter(lm.x, t_sec)
            smooth_y = self.filters_y[name].filter(lm.y, t_sec)

            filtered[name] = Landmark2D(
                x=float(smooth_x),
                y=float(smooth_y),
                z=lm.z,
                visibility=lm.visibility,
            )

        return filtered
