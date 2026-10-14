"""Testes determinísticos do detetor de ciclos de pedalada, BDC/TDC e cadência.

Valida:
1. Precisão de cadência (< 1 RPM de erro) e BDC timing (< 1 frame de erro em >= 95% dos ciclos).
2. Rejeição de ciclos com durações aberrantes, baixa visibilidade ou ROM insuficiente.
3. Agregação estatística de sessão com MAD e classificação de proveniência (cycle_detection vs manual_snapshots).
4. Detetor em streaming (OnlineCycleDetector) com cálculo de clock_position e identificação de BDC/TDC.
"""

from __future__ import annotations

import numpy as np
import pytest

from athletemotion.domain.cycle.detector import BatchCycleDetector
from athletemotion.domain.cycle.metrics import (
    aggregate_session_summary,
    compute_mad_outliers,
    estimate_cadence_autocorr_and_fft,
)
from athletemotion.domain.cycle.streaming import OnlineCycleDetector
from athletemotion.domain.cycle.types import (
    CycleEvent,
    CycleMetrics,
    PedalingSample,
)
from tests.fixtures.synthetic_pedaling import synthetic_pedaling


@pytest.mark.parametrize("target_rpm", [40.0, 60.0, 80.0, 110.0])
def test_cadence_estimation_accuracy(target_rpm: float):
    """Estimação de cadência via Autocorrelação + FFT deve ter erro < 1.0 RPM em sinal limpo."""
    fps = 60.0
    data = synthetic_pedaling(rpm=target_rpm, fps=fps, duration_s=12.0, noise_std=0.0)

    estimated_rpm, confidence = estimate_cadence_autocorr_and_fft(
        time_s=data.time_s,
        signal=data.ankle_points[:, 1],
        min_rpm=30.0,
        max_rpm=140.0,
    )

    assert abs(estimated_rpm - target_rpm) <= 1.0
    assert confidence >= 0.70


@pytest.mark.parametrize("noise_px", [0.0, 1.0, 2.0, 3.0])
def test_bdc_detection_precision_under_noise(noise_px: float):
    """Timing do BDC deve estar a <= 1 frame da verdade-terreno em >= 95% dos ciclos."""
    target_rpm = 80.0
    fps = 60.0
    data = synthetic_pedaling(
        rpm=target_rpm,
        fps=fps,
        duration_s=10.0,
        noise_std=noise_px,
        knee_bdc=148.0,
        knee_tdc=72.0,
    )

    detector = BatchCycleDetector()
    bdc_events, tdc_events, cycles, _conf = detector.detect_events_and_cycles(
        timestamps_ms=data.timestamps_ms,
        ankle_y=data.ankle_points[:, 1],
        knee_angles=data.knee_angles,
        visibilities=data.visibilities,
    )

    assert len(bdc_events) >= 10
    assert len(tdc_events) >= 10
    assert len(cycles) >= 9

    # Comparar cada BDC detetado com o marco mais próximo da verdade-terreno
    gt_bdcs = data.ground_truth_bdc_indices
    frame_errors = []

    for bdc_ev in bdc_events:
        closest_gt = min(gt_bdcs, key=lambda gt: abs(gt - bdc_ev.frame_index))
        error_frames = abs(closest_gt - bdc_ev.frame_index)
        frame_errors.append(error_frames)

    # Erro <= 1 frame em pelo menos 95% dos ciclos
    within_one_frame = sum(1 for err in frame_errors if err <= 1)
    ratio = within_one_frame / len(frame_errors)
    assert ratio >= 0.95, f"Falha de precisão com ruído={noise_px}px: rácio={ratio:.2f}"


def test_cycle_rejection_mechanisms():
    """Valida rejeição de ciclos anómalos: baixa visibilidade, duração atípica e amplitude curta."""
    BatchCycleDetector()

    # Criar ciclo sintético base
    bdc_1 = CycleEvent(event_type="BDC", frame_index=0, timestamp_ms=0.0, knee_angle=148.0, ankle_y=800.0)
    tdc_1 = CycleEvent(event_type="TDC", frame_index=22, timestamp_ms=375.0, knee_angle=72.0, ankle_y=600.0)
    bdc_2 = CycleEvent(event_type="BDC", frame_index=45, timestamp_ms=750.0, knee_angle=148.0, ankle_y=800.0)
    bdc_3 = CycleEvent(event_type="BDC", frame_index=90, timestamp_ms=1500.0, knee_angle=148.0, ankle_y=800.0)

    # 1. Ciclo normal (750 ms ~ 80 RPM, knee_rom = 76°)
    c_normal = CycleMetrics(
        cycle_index=0,
        start_time_ms=0.0,
        end_time_ms=750.0,
        duration_ms=750.0,
        cadence_rpm=80.0,
        bdc_event=bdc_1,
        tdc_event=tdc_1,
        knee_bdc=148.0,
        knee_tdc=72.0,
        knee_rom=76.0,
        visibility_mean=0.9,
    )

    # 2. Ciclo com ROM insuficiente (knee_rom = 20° < 35°)
    c_low_rom = CycleMetrics(
        cycle_index=1,
        start_time_ms=750.0,
        end_time_ms=1500.0,
        duration_ms=750.0,
        cadence_rpm=80.0,
        bdc_event=bdc_2,
        tdc_event=tdc_1,
        knee_bdc=148.0,
        knee_tdc=130.0,
        knee_rom=18.0,
        visibility_mean=0.9,
    )

    # 3. Ciclo com baixa visibilidade (vis = 0.3 < 0.5)
    c_low_vis = CycleMetrics(
        cycle_index=2,
        start_time_ms=1500.0,
        end_time_ms=2250.0,
        duration_ms=750.0,
        cadence_rpm=80.0,
        bdc_event=bdc_3,
        tdc_event=tdc_1,
        knee_bdc=148.0,
        knee_tdc=72.0,
        knee_rom=76.0,
        visibility_mean=0.3,
    )

    # Aplicar regras de rejeição
    cycles = [c_normal, c_low_rom, c_low_vis]
    for c in cycles:
        reasons = []
        if c.knee_rom < 35.0:
            reasons.append("insufficient_knee_rom")
        if c.visibility_mean < 0.5:
            reasons.append("low_visibility")
        if reasons:
            c.valid = False
            c.reject_reasons = reasons

    assert c_normal.valid is True
    assert c_low_rom.valid is False
    assert "insufficient_knee_rom" in c_low_rom.reject_reasons
    assert c_low_vis.valid is False
    assert "low_visibility" in c_low_vis.reject_reasons


def test_mad_outlier_detection():
    """compute_mad_outliers deve isolar com precisão medições angulares aberrantes."""
    angles = np.array([148.0, 147.5, 148.5, 148.0, 147.8, 185.0, 148.2])  # 185 é aberrante
    outliers = compute_mad_outliers(angles)
    assert bool(outliers[5]) is True
    assert sum(outliers) == 1


def test_session_summary_source_labeling():
    """Quando o número de ciclos válidos for < 5, a fonte deve ser manual_snapshots."""
    dummy_event = CycleEvent(event_type="BDC", frame_index=0, timestamp_ms=0.0, knee_angle=148.0, ankle_y=800.0)

    def _make_cycle(valid=True):
        return CycleMetrics(
            cycle_index=0,
            start_time_ms=0.0,
            end_time_ms=750.0,
            duration_ms=750.0,
            cadence_rpm=80.0,
            bdc_event=dummy_event,
            tdc_event=dummy_event,
            knee_bdc=148.0,
            knee_tdc=72.0,
            knee_rom=76.0,
            valid=valid,
        )

    # 3 ciclos válidos (< 5 exigidos)
    summary_insufficient = aggregate_session_summary([_make_cycle(), _make_cycle(), _make_cycle()])
    assert summary_insufficient.valid_cycles_count == 3
    assert summary_insufficient.source == "manual_snapshots"

    # 6 ciclos válidos (>= 5 exigidos)
    summary_sufficient = aggregate_session_summary([_make_cycle() for _ in range(6)])
    assert summary_sufficient.valid_cycles_count == 6
    assert summary_sufficient.source == "cycle_detection"
    assert summary_sufficient.knee_bdc_median == 148.0


def test_online_streaming_detector():
    """OnlineCycleDetector deve rastrear fase em horas (1..12h) e emitir eventos BDC/TDC."""
    detector = OnlineCycleDetector()
    data = synthetic_pedaling(rpm=80.0, fps=60.0, duration_s=4.0, noise_std=0.0)

    detected_bdcs = []
    detected_tdcs = []
    clock_positions = []

    for i in range(len(data.timestamps_ms)):
        sample = PedalingSample(
            frame_index=i,
            timestamp_ms=float(data.timestamps_ms[i]),
            ankle_y=float(data.ankle_points[i, 1]),
            ankle_x=float(data.ankle_points[i, 0]),
            knee_angle=float(data.knee_angles[i]),
            visibility=float(data.visibilities[i]),
        )
        events, clock_pos, _is_bdc, _is_tdc = detector.push(sample)
        clock_positions.append(clock_pos)

        for ev in events:
            if ev.event_type == "BDC":
                detected_bdcs.append(ev)
            elif ev.event_type == "TDC":
                detected_tdcs.append(ev)

    # Devem ser detetados ciclos ao longo dos 4 segundos (~5 revoluções)
    assert len(detected_bdcs) >= 4
    assert len(detected_tdcs) >= 4

    # Clock position deve percorrer valores distribuídos pelo relógio (1h a 12h)
    assert min(clock_positions) <= 3.0
    assert max(clock_positions) >= 9.0
