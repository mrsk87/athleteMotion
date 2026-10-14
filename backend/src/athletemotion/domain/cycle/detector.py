"""Detetor determinístico de ciclos de pedalada, BDC/TDC e extração de métricas (modo lote).

Identifica rotações do crenque através dos extremos verticais do tornozelo
com refinamento temporal pelo ângulo de máxima extensão do joelho (BDC).
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt
from scipy.signal import find_peaks

from athletemotion.domain.cycle.metrics import (
    aggregate_session_summary,
    estimate_cadence_autocorr_and_fft,
)
from athletemotion.domain.cycle.preprocess import preprocess_pedaling_series
from athletemotion.domain.cycle.types import (
    CycleEvent,
    CycleMetrics,
    CycleParams,
    PedalingSample,
    SessionCycleSummary,
)


class BatchCycleDetector:
    """Detetor em lote (offline) para séries temporais gravadas ou acumuladas em sessão."""

    def __init__(self, params: CycleParams | None = None) -> None:
        self.params = params or CycleParams()

    def detect_events_and_cycles(
        self,
        timestamps_ms: npt.NDArray[np.float64],
        ankle_y: npt.NDArray[np.float64],
        knee_angles: npt.NDArray[np.float64] | None = None,
        visibilities: npt.NDArray[np.float64] | None = None,
        estimated_cadence_rpm: float | None = None,
    ) -> tuple[list[CycleEvent], list[CycleEvent], list[CycleMetrics], float]:
        """Processa as séries temporais e extrai eventos BDC, TDC e os ciclos completos.

        Args:
            timestamps_ms: Array de tempos em milissegundos.
            ankle_y: Posições Y do tornozelo em píxeis (Y aumenta para baixo).
            knee_angles: Ângulos internos do joelho em graus [0..180].
            visibilities: Confiança/visibilidade das amostras [0..1].
            estimated_cadence_rpm: Cadência prévia se conhecida.

        Returns:
            Tuplo contendo (bdc_events, tdc_events, cycles, cadence_confidence).
        """
        n = len(timestamps_ms)
        if n < 30:
            return [], [], [], 0.0

        time_s = timestamps_ms / 1000.0
        duration_s = float(time_s[-1] - time_s[0])
        if duration_s <= 0.0:
            return [], [], [], 0.0

        fps = float(n / duration_s)

        # 1. Pré-processamento e suavização
        _, smooth_ankle_y, smooth_knee = preprocess_pedaling_series(
            timestamps_ms=timestamps_ms,
            ankle_y=ankle_y,
            knee_angles=knee_angles,
            params=self.params,
        )

        # 2. Estimativa de cadência global
        if estimated_cadence_rpm is not None and estimated_cadence_rpm > 0:
            rpm = estimated_cadence_rpm
            cadence_conf = 1.0
        else:
            rpm, cadence_conf = estimate_cadence_autocorr_and_fft(
                time_s=time_s,
                signal=smooth_ankle_y,
                min_rpm=self.params.min_rpm,
                max_rpm=self.params.max_rpm,
            )

        if rpm < self.params.min_rpm or rpm > self.params.max_rpm:
            # Sem periodicidade humana plausível
            return [], [], [], cadence_conf

        period_s = 60.0 / rpm
        period_samples = round(fps * period_s)
        min_distance = max(4, round(period_samples * 0.6))

        # 3. Deteção de extremos no eixo Y do tornozelo
        # Y máximo = ponto mais baixo na imagem = BDC candidato
        # Y mínimo = ponto mais alto na imagem = TDC candidato
        y_range = float(np.ptp(smooth_ankle_y))
        min_prominence = max(5.0, y_range * 0.25)

        # Picos de Y (BDC)
        bdc_cand_idx, _ = find_peaks(
            smooth_ankle_y,
            prominence=min_prominence,
            distance=min_distance,
        )

        # Vales de Y (TDC) -> picos de -Y
        tdc_cand_idx, _ = find_peaks(
            -smooth_ankle_y,
            prominence=min_prominence,
            distance=min_distance,
        )

        # 4. Refinamento temporal do BDC pelo ângulo de máxima extensão do joelho
        # Numa janela de ±80 ms em torno do BDC mecânico do tornozelo
        refine_window_samples = round((self.params.bdc_refine_window_ms / 1000.0) * fps)
        refine_window_samples = max(2, refine_window_samples)

        refined_bdc_idx: list[int] = []
        for c_idx in bdc_cand_idx:
            best_idx = int(c_idx)
            if smooth_knee is not None:
                start_w = max(0, c_idx - refine_window_samples)
                end_w = min(n, c_idx + refine_window_samples + 1)
                window_knee = smooth_knee[start_w:end_w]
                if len(window_knee) > 0:
                    local_max_offset = int(np.argmax(window_knee))
                    best_idx = start_w + local_max_offset
            refined_bdc_idx.append(best_idx)

        # 5. Criar objetos de evento
        bdc_events = [
            CycleEvent(
                event_type="BDC",
                frame_index=idx,
                timestamp_ms=float(timestamps_ms[idx]),
                knee_angle=float(smooth_knee[idx]) if smooth_knee is not None else 0.0,
                ankle_y=float(smooth_ankle_y[idx]),
            )
            for idx in refined_bdc_idx
        ]

        tdc_events = [
            CycleEvent(
                event_type="TDC",
                frame_index=int(idx),
                timestamp_ms=float(timestamps_ms[idx]),
                knee_angle=float(smooth_knee[idx]) if smooth_knee is not None else 0.0,
                ankle_y=float(smooth_ankle_y[idx]),
            )
            for idx in tdc_cand_idx
        ]

        # 6. Emparelhamento e construção dos ciclos completos (BDC -> TDC -> BDC seguinte)
        cycles = self._build_cycles_from_events(
            bdc_events=bdc_events,
            tdc_events=tdc_events,
            smooth_knee=smooth_knee,
            visibilities=visibilities,
        )

        return bdc_events, tdc_events, cycles, cadence_conf

    def _build_cycles_from_events(
        self,
        bdc_events: list[CycleEvent],
        tdc_events: list[CycleEvent],
        smooth_knee: npt.NDArray[np.float64] | None,
        visibilities: npt.NDArray[np.float64] | None,
    ) -> list[CycleMetrics]:
        """Constrói ciclos entre BDCs consecutivos com um TDC intermédio."""
        if len(bdc_events) < 2 or len(tdc_events) == 0:
            return []

        cycles: list[CycleMetrics] = []
        durations: list[float] = []

        for i in range(len(bdc_events) - 1):
            bdc_curr = bdc_events[i]
            bdc_next = bdc_events[i + 1]

            # Procurar TDC entre bdc_curr e bdc_next
            tdcs_between = [
                t for t in tdc_events
                if bdc_curr.timestamp_ms < t.timestamp_ms < bdc_next.timestamp_ms
            ]
            if not tdcs_between:
                continue

            # Se houver mais de um, seleciona o que tiver menor ângulo de joelho (ou tornozelo mais alto)
            best_tdc = min(tdcs_between, key=lambda t: t.knee_angle if smooth_knee is not None else t.ankle_y)

            duration_ms = bdc_next.timestamp_ms - bdc_curr.timestamp_ms
            if duration_ms <= 0:
                continue

            rpm = 60000.0 / duration_ms
            durations.append(duration_ms)

            # Visibilidade média durante o ciclo
            mean_vis = 1.0
            if visibilities is not None:
                start_f = bdc_curr.frame_index
                end_f = bdc_next.frame_index
                if end_f > start_f:
                    mean_vis = float(np.mean(visibilities[start_f:end_f]))

            knee_bdc = bdc_curr.knee_angle
            knee_tdc = best_tdc.knee_angle
            knee_rom = max(0.0, knee_bdc - knee_tdc)

            cycle_metric = CycleMetrics(
                cycle_index=len(cycles),
                start_time_ms=bdc_curr.timestamp_ms,
                end_time_ms=bdc_next.timestamp_ms,
                duration_ms=round(duration_ms, 1),
                cadence_rpm=round(rpm, 1),
                bdc_event=bdc_curr,
                tdc_event=best_tdc,
                knee_bdc=round(knee_bdc, 1),
                knee_tdc=round(knee_tdc, 1),
                knee_rom=round(knee_rom, 1),
                visibility_mean=round(mean_vis, 2),
                valid=True,
                reject_reasons=[],
            )
            cycles.append(cycle_metric)

        # 7. Validação e rejeição de ciclos anómalos
        if durations:
            med_duration = float(np.median(durations))
            for c in cycles:
                reasons: list[str] = []

                # Duração desproporcionada face à mediana (±35%)
                if abs(c.duration_ms - med_duration) > (self.params.max_duration_deviation_pct * med_duration):
                    reasons.append("duration_outlier")

                # Amplitude articular insuficiente
                if c.knee_rom < self.params.min_rom_deg:
                    reasons.append("insufficient_knee_rom")

                # Visibilidade deficitária do ciclista
                if c.visibility_mean < self.params.min_visibility:
                    reasons.append("low_visibility")

                # Cadência fora do limiar fisiológico
                if c.cadence_rpm < self.params.min_rpm or c.cadence_rpm > self.params.max_rpm:
                    reasons.append("cadence_out_of_bounds")

                if reasons:
                    c.valid = False
                    c.reject_reasons = reasons

        return cycles

    def detect_cycles(self, samples: list[PedalingSample]) -> list[CycleMetrics]:
        """Extrai os ciclos a partir de uma lista de PedalingSample."""
        if not samples:
            return []
        timestamps = np.array([s.timestamp_ms for s in samples], dtype=float)
        ankle_y = np.array([s.ankle_y for s in samples], dtype=float)
        knee_angles = (
            np.array(
                [s.knee_angle if s.knee_angle is not None else np.nan for s in samples],
                dtype=float,
            )
            if any(s.knee_angle is not None for s in samples)
            else None
        )
        visibilities = np.array([s.visibility for s in samples], dtype=float)
        _, _, cycles, _ = self.detect_events_and_cycles(
            timestamps_ms=timestamps,
            ankle_y=ankle_y,
            knee_angles=knee_angles,
            visibilities=visibilities,
        )
        return cycles

    def process_samples(self, samples: list[PedalingSample]) -> SessionCycleSummary:
        """Processa diretamente uma lista estruturada de PedalingSample."""
        if not samples:
            return aggregate_session_summary([], periodicity_confidence=0.0, params=self.params)

        timestamps = np.array([s.timestamp_ms for s in samples], dtype=float)
        ankle_y = np.array([s.ankle_y for s in samples], dtype=float)
        knee_angles = (
            np.array([s.knee_angle if s.knee_angle is not None else np.nan for s in samples], dtype=float)
            if any(s.knee_angle is not None for s in samples)
            else None
        )
        visibilities = np.array([s.visibility for s in samples], dtype=float)

        _, _, cycles, conf = self.detect_events_and_cycles(
            timestamps_ms=timestamps,
            ankle_y=ankle_y,
            knee_angles=knee_angles,
            visibilities=visibilities,
        )

        return aggregate_session_summary(cycles, periodicity_confidence=conf, params=self.params)
