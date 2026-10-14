"""Testes unitários do filtro de Kalman esquelético com restrição cinemática de segmentos."""

from __future__ import annotations

import math

import numpy as np

from athletemotion.domain.calculator import calculate_safe_angle
from athletemotion.domain.inference.kalman_skeleton import SkeletonKalmanFilter


def _solve_2d_knee(hip: tuple[float, float], ankle: tuple[float, float], l1: float, l2: float) -> tuple[float, float]:
    """Calcula a posição 2D do joelho (interseção frontal de duas circunferências)."""
    hx, hy = hip
    ax, ay = ankle
    d = math.hypot(ax - hx, ay - hy)
    d = min(l1 + l2 - 1e-4, max(abs(l1 - l2) + 1e-4, d))

    a = (l1 * l1 - l2 * l2 + d * d) / (2.0 * d)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))

    # Ponto intermédio ao longo do vetor hip -> ankle
    x2 = hx + a * (ax - hx) / d
    y2 = hy + a * (ay - hy) / d

    # Deslocamento perpendicular (joelho projeta para a frente / +X)
    kx = x2 + h * (ay - hy) / d
    ky = y2 - h * (ax - hx) / d
    return (kx, ky)


def test_kalman_rmse_reduction_under_noise_and_occlusions() -> None:
    """Critério R12: RMSE do ângulo do joelho filtrado com Kalman <= 70% do RMSE sem filtro."""
    rng = np.random.default_rng(2026)

    # 1. Trajetória sintética cinemática determinística
    hip = (200.0, 150.0)
    crank_center = (210.0, 330.0)
    crank_radius = 40.0
    l_femur = 100.0
    l_tibia = 100.0

    n_frames = 180  # 3 rotações a 60 FPS
    dt = 1.0 / 60.0

    true_hips: list[tuple[float, float]] = []
    true_knees: list[tuple[float, float]] = []
    true_ankles: list[tuple[float, float]] = []
    true_angles: list[float] = []

    for f in range(n_frames):
        theta = (f / 60.0) * 2.0 * math.pi
        ankle_x = crank_center[0] + crank_radius * math.sin(theta)
        ankle_y = crank_center[1] - crank_radius * math.cos(theta)
        knee_x, knee_y = _solve_2d_knee(hip, (ankle_x, ankle_y), l_femur, l_tibia)

        angle = calculate_safe_angle(hip, (knee_x, knee_y), (ankle_x, ankle_y))
        true_hips.append(hip)
        true_knees.append((knee_x, knee_y))
        true_ankles.append((ankle_x, ankle_y))
        true_angles.append(angle)

    # 2. Injeção de ruído e simulação de oclusão
    raw_angles: list[float] = []
    kalman_filter = SkeletonKalmanFilter(
        enabled=True,
        segment_constraint_enabled=True,
        tolerance_pct=0.08,
        process_noise_std=500.0,
        measurement_noise_std=5.0,
    )
    kalman_filter.set_reference_lengths(l_femur, l_tibia)

    kalman_angles: list[float] = []

    for f in range(n_frames):
        # Ruído gaussiano de captura (sigma = 5.0 px)
        noise_k = rng.normal(0.0, 5.0, size=2)
        noise_a = rng.normal(0.0, 5.0, size=2)

        # Oclusões e saltos espúrios pontuais no joelho (frames 40-42, 85-87, 130-132)
        is_occluded = f in (40, 41, 42, 85, 86, 87, 130, 131, 132)
        vis_k = 0.05 if is_occluded else 0.95

        spike_k = rng.uniform(25.0, 40.0, size=2) if is_occluded else np.zeros(2)

        meas_hip = (true_hips[f][0], true_hips[f][1], 1.0)
        meas_knee = (
            true_knees[f][0] + noise_k[0] + spike_k[0],
            true_knees[f][1] + noise_k[1] + spike_k[1],
            vis_k,
        )
        meas_ankle = (
            true_ankles[f][0] + noise_a[0],
            true_ankles[f][1] + noise_a[1],
            0.95,
        )

        # Ângulo bruto sem filtro
        raw_angle = calculate_safe_angle(
            (meas_hip[0], meas_hip[1]),
            (meas_knee[0], meas_knee[1]),
            (meas_ankle[0], meas_ankle[1]),
        )
        raw_angles.append(raw_angle)

        # Filtragem Kalman
        frame_input = {
            "right_hip": meas_hip,
            "right_knee": meas_knee,
            "right_ankle": meas_ankle,
        }
        filtered = kalman_filter.step(frame_input, dt=dt)

        filt_h = (filtered["right_hip"][0], filtered["right_hip"][1])
        filt_k = (filtered["right_knee"][0], filtered["right_knee"][1])
        filt_a = (filtered["right_ankle"][0], filtered["right_ankle"][1])

        k_angle = calculate_safe_angle(filt_h, filt_k, filt_a)
        kalman_angles.append(k_angle)

    # 3. Avaliação de RMSE ignorando os primeiros 15 frames de aquecimento
    eval_slice = slice(15, n_frames)
    t_arr = np.asarray(true_angles[eval_slice])
    r_arr = np.asarray(raw_angles[eval_slice])
    k_arr = np.asarray(kalman_angles[eval_slice])

    rmse_raw = float(np.sqrt(np.mean((r_arr - t_arr) ** 2)))
    rmse_kalman = float(np.sqrt(np.mean((k_arr - t_arr) ** 2)))

    ratio = rmse_kalman / rmse_raw
    assert (
        ratio <= 0.70
    ), f"RMSE ratio ({ratio:.2f} = {rmse_kalman:.2f}° / {rmse_raw:.2f}°) deve ser <= 0.70 (redução de 30% requerida por R12)"


def test_kalman_segment_constraint_clamping() -> None:
    """Verifica se as restrições anatómicas mantêm o comprimento de fémur e tíbia dentro de ±8%."""
    kf = SkeletonKalmanFilter(
        enabled=True,
        segment_constraint_enabled=True,
        tolerance_pct=0.08,
    )
    kf.set_reference_lengths(100.0, 100.0)

    # Marco de joelho tenta pular para comprimento 150 px (desvio absurdo de +50%)
    input_coords = {
        "right_hip": (100.0, 100.0, 1.0),
        "right_knee": (100.0, 250.0, 0.9),  # 150 px de distância
        "right_ankle": (100.0, 350.0, 0.9),
    }

    filtered = kf.step(input_coords, dt=1.0 / 60.0)

    hx, hy, _ = filtered["right_hip"]
    kx, ky, _ = filtered["right_knee"]
    femur_len = math.hypot(kx - hx, ky - hy)

    # Deve ser limitado a no máximo 108.0 px (100 * 1.08)
    assert femur_len <= 108.5
    assert femur_len >= 92.0


def test_kalman_filter_disabled_pass_through() -> None:
    """Quando enabled=False, o filtro deve funcionar como pass-through inalterado."""
    kf = SkeletonKalmanFilter(enabled=False)
    input_coords = {
        "right_hip": (123.4, 456.7, 0.8),
    }
    res = kf.step(input_coords)
    assert res["right_hip"] == (123.4, 456.7, 0.8)
