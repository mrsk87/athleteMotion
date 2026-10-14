"""Testes unitários das curvas angulares sagitais por ciclo de pedalada."""

from __future__ import annotations

import math

import numpy as np

from athletemotion.domain.measures.sagittal import (
    compute_sagittal_cycle_curves,
    resample_cycle_to_grid,
)


def test_resample_cycle_synthetic_ground_truth() -> None:
    """Verifica se a reamostragem a 100 pontos tem erro < 1.0° face à verdade-terreno."""
    # Verdade-terreno: f(theta) = 110 + 40 * cos(theta - pi)
    # Theta = 0° (TDC) -> f = 70°
    # Theta = 180° (BDC) -> f = 150°
    # Theta = 360° (TDC) -> f = 70°
    duration_ms = 1000.0  # 60 RPM
    sample_rate = 60.0  # 60 FPS
    n_samples = int(duration_ms * (sample_rate / 1000.0))

    timestamps = [i * (duration_ms / n_samples) for i in range(n_samples)]
    timestamps.append(duration_ms)

    angles = []
    for t in timestamps:
        theta = (t / duration_ms) * 2.0 * math.pi
        val = 110.0 + 40.0 * math.cos(theta - math.pi)
        angles.append(val)

    # Reamostrar para 100 pontos
    resampled = resample_cycle_to_grid(timestamps, angles, bdc_time_ms=500.0, grid_points=100)
    assert len(resampled) == 100

    # Comparar cada ponto da grelha com a fórmula exata
    max_error = 0.0
    for i in range(100):
        theta_grid = (i / 100.0) * 2.0 * math.pi
        exact = 110.0 + 40.0 * math.cos(theta_grid - math.pi)
        err = abs(resampled[i] - exact)
        if err > max_error:
            max_error = err

    # Critério de aceitação R12: erro < 1°
    assert max_error < 1.0, f"Erro máximo de reamostragem ({max_error:.3f}°) excedeu o limiar de 1.0°"


def test_compute_sagittal_cycle_curves_aggregation() -> None:
    """Valida a agregação multi-ciclo, amplitude ROM e fase de pico."""
    cycles_data = []
    for c_idx in range(5):
        # 5 ciclos com ligeira variação (DP ~ 0.5°)
        t_arr = np.linspace(0.0, 1000.0, 60)
        knee_angles = 110.0 + 40.0 * np.cos(np.linspace(0.0, 2.0 * np.pi, 60) - np.pi) + (c_idx * 0.2)
        hip_angles = 70.0 + 25.0 * np.cos(np.linspace(0.0, 2.0 * np.pi, 60) - np.pi)
        cycles_data.append(
            {
                "timestamps_ms": list(t_arr),
                "knee_angles": list(knee_angles),
                "hip_angles": list(hip_angles),
                "bdc_time_ms": 500.0,
            }
        )

    report = compute_sagittal_cycle_curves(cycles_data, grid_points=100)

    assert report.cycles_analyzed == 5
    assert len(report.knee_curve.points) == 100
    # ROM deve ser próximo de 80.0° (150° - 70°)
    assert abs(report.knee_curve.rom_deg - 80.0) < 1.5
    # Pico deve ocorrer próximo de 180° (BDC)
    assert abs(report.knee_curve.peak_phase_deg - 180.0) <= 7.2
    # Valor mínimo próximo de 70.0°
    assert abs(report.knee_curve.min_angle_deg - 70.4) < 1.5
