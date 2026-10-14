"""Detetor em streaming (online / tempo real) para sessões ativas e WebSockets.

Opera sobre uma janela deslizante (ring buffer) de baixa latência, identificando
eventos BDC e TDC quase em tempo real, calculando a posição angular do crenque
em 'horas' do relógio (1..12h) e mantendo isolamento estrito por ligação (R03).
"""

from __future__ import annotations

import collections
import math

import numpy as np

from athletemotion.domain.cycle.types import (
    CycleEvent,
    CycleParams,
    PedalingSample,
)


class OnlineCycleDetector:
    """Detetor com estado isolado por cliente para streaming contínuo."""

    def __init__(self, params: CycleParams | None = None, buffer_size: int = 45) -> None:
        self.params = params or CycleParams()
        self.buffer_size = buffer_size
        self._samples: collections.deque[PedalingSample] = collections.deque(maxlen=buffer_size)

        self._last_bdc_time_ms: float = -1.0
        self._last_tdc_time_ms: float = -1.0
        self._last_event_time_ms: float = -1.0
        self._estimated_rpm: float = 80.0

        # Histórico de centro de rotação (x_c, y_c) para cálculo do ângulo do relógio
        self._center_x: float | None = None
        self._center_y: float | None = None

    def reset(self) -> None:
        """Reinicia o estado interno e buffers da ligação."""
        self._samples.clear()
        self._last_bdc_time_ms = -1.0
        self._last_tdc_time_ms = -1.0
        self._last_event_time_ms = -1.0
        self._center_x = None
        self._center_y = None

    def push(self, sample: PedalingSample) -> tuple[list[CycleEvent], float, bool, bool]:
        """Processa uma nova amostra no stream.

        Args:
            sample: Amostra instantânea.

        Returns:
            Tuplo com:
            - list[CycleEvent]: Eventos BDC ou TDC confirmados neste frame.
            - clock_position: Posição estimada no relógio [1.0 .. 12.0].
            - is_bdc: Verdadeiro se o frame corrente corresponde ao BDC.
            - is_tdc: Verdadeiro se o frame corrente corresponde ao TDC.
        """
        self._samples.append(sample)
        events: list[CycleEvent] = []
        is_bdc = False
        is_tdc = False

        if len(self._samples) < 9:
            return events, 6.0, False, False

        # Atualizar centro da órbita do tornozelo
        xs = [s.ankle_x for s in self._samples if s.ankle_x > 0]
        ys = [s.ankle_y for s in self._samples]
        if xs:
            self._center_x = float(np.mean(xs))
        self._center_y = float(np.mean(ys))

        # Cálculo da posição angular em horas de relógio (1h .. 12h)
        # Convenção do ciclismo:
        # 12:00 = Top Dead Center (TDC, y mínimo / mais alto)
        # 3:00  = Posição mais avançada para a frente (+X)
        # 6:00  = Bottom Dead Center (BDC, y máximo / mais baixo)
        # 9:00  = Posição mais recuada para trás (-X)
        clock_pos = self._calculate_clock_position(sample.ankle_x, sample.ankle_y)

        # Deteção de extremos locais com latência de 3 a 5 frames
        # Inspeciona o elemento com offset relativo ao fim da fila
        lookback = 4
        if len(self._samples) >= (2 * lookback + 1):
            cand_idx = len(self._samples) - 1 - lookback
            cand_sample = self._samples[cand_idx]

            recent_ys = [s.ankle_y for s in self._samples]
            cand_y = cand_sample.ankle_y

            # Teste de máximo local (BDC: y máximo)
            window_before = recent_ys[cand_idx - lookback : cand_idx]
            window_after = recent_ys[cand_idx + 1 : cand_idx + 1 + lookback]

            dt_since_last_bdc = cand_sample.timestamp_ms - self._last_bdc_time_ms
            min_cycle_time_ms = 60000.0 / self.params.max_rpm  # ex: ~428 ms a 140 RPM

            if (
                all(cand_y > w for w in window_before)
                and all(cand_y >= w for w in window_after)
                and (self._last_bdc_time_ms < 0 or dt_since_last_bdc >= (min_cycle_time_ms * 0.7))
            ):
                event = CycleEvent(
                    event_type="BDC",
                    frame_index=cand_sample.frame_index,
                    timestamp_ms=cand_sample.timestamp_ms,
                    knee_angle=cand_sample.knee_angle or 0.0,
                    ankle_y=cand_sample.ankle_y,
                )
                events.append(event)
                self._last_bdc_time_ms = cand_sample.timestamp_ms
                if cand_sample.frame_index == sample.frame_index:
                    is_bdc = True

            # Teste de mínimo local (TDC: y mínimo)
            dt_since_last_tdc = cand_sample.timestamp_ms - self._last_tdc_time_ms
            if (
                all(cand_y < w for w in window_before)
                and all(cand_y <= w for w in window_after)
                and (self._last_tdc_time_ms < 0 or dt_since_last_tdc >= (min_cycle_time_ms * 0.7))
            ):
                event = CycleEvent(
                    event_type="TDC",
                    frame_index=cand_sample.frame_index,
                    timestamp_ms=cand_sample.timestamp_ms,
                    knee_angle=cand_sample.knee_angle or 0.0,
                    ankle_y=cand_sample.ankle_y,
                )
                events.append(event)
                self._last_tdc_time_ms = cand_sample.timestamp_ms
                if cand_sample.frame_index == sample.frame_index:
                    is_tdc = True

        return events, clock_pos, is_bdc, is_tdc

    def _calculate_clock_position(self, x: float, y: float) -> float:
        """Determina a posição do crenque no mostrador do relógio [1.0 .. 12.0]."""
        if self._center_x is None or self._center_y is None or x <= 0:
            # Fallback baseado puramente na posição Y se X não estiver disponível
            return 6.0

        dx = x - self._center_x
        dy = y - self._center_y

        # Ângulo polar: 0 no topo (12h, dy < 0), 90 à direita (3h, dx > 0), 180 no fundo (6h, dy > 0)
        # angle_rad = atan2(dx, -dy) -> 0 a 12h, pi/2 a 3h, pi a 6h, -pi/2 a 9h
        angle_rad = math.atan2(dx, -dy)
        if angle_rad < 0:
            angle_rad += 2.0 * math.pi

        # Converter radianos para horas: 2*pi = 12 horas
        hours = (angle_rad / (2.0 * math.pi)) * 12.0
        if hours <= 0.0:
            hours = 12.0
        return round(hours, 1)
