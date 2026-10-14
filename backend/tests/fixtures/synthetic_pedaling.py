"""Gerador sintético determinístico de pedalada biomecânica para testes e benchmark de BDC/TDC.

Permite simular trajetórias anatómicas fidedignas (anca, joelho, tornozelo, pé) com
parâmetros físicos controlados: cadência (RPM), taxa de fotogramas (FPS), duração,
ruído gaussiano (pixels), drift de cadência e falhas de rastreio (dropouts).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import numpy.typing as npt


@dataclass(frozen=True)
class SyntheticPedalingDataset:
    """Conjunto de dados sintéticos com verdade-terreno de eventos BDC e TDC."""

    timestamps_ms: npt.NDArray[np.float64]  # Shape: (N,)
    time_s: npt.NDArray[np.float64]  # Shape: (N,)
    fps: float
    target_rpm: float
    actual_rpm: npt.NDArray[np.float64]  # Shape: (N,)

    # Trajetórias 2D (x, y) em píxeis
    hip_points: npt.NDArray[np.float64]  # Shape: (N, 2)
    knee_points: npt.NDArray[np.float64]  # Shape: (N, 2)
    ankle_points: npt.NDArray[np.float64]  # Shape: (N, 2)
    toe_points: npt.NDArray[np.float64]  # Shape: (N, 2)
    heel_points: npt.NDArray[np.float64]  # Shape: (N, 2)

    # Ângulos internos reais calculados em graus [0..180]
    knee_angles: npt.NDArray[np.float64]  # Shape: (N,)
    visibilities: npt.NDArray[np.float64]  # Shape: (N,)

    # Verdade-terreno de eventos
    ground_truth_bdc_indices: list[int] = field(default_factory=list)
    ground_truth_tdc_indices: list[int] = field(default_factory=list)
    ground_truth_bdc_times_ms: list[float] = field(default_factory=list)
    ground_truth_tdc_times_ms: list[float] = field(default_factory=list)


def synthetic_pedaling(
    rpm: float = 80.0,
    fps: float = 60.0,
    duration_s: float = 10.0,
    noise_std: float = 0.0,
    knee_bdc: float = 148.0,
    knee_tdc: float = 72.0,
    drift_rpm_per_s: float = 0.0,
    dropout_prob: float = 0.0,
    seed: int = 42,
) -> SyntheticPedalingDataset:
    """Gera uma série temporal de pedalada com cinemática fechada 2D e verdade-terreno.

    Convenção:
    - Sagital: ciclista voltado para a direita (X aumenta para a frente).
    - Imagem: Y aumenta para baixo (ponto mais baixo = Y máximo).
    - BDC (Ponto Morto Inferior): pedal na posição mais baixa, perna com máxima extensão (knee_bdc).
    - TDC (Ponto Morto Superior): pedal na posição mais alta, perna com máxima flexão (knee_tdc).

    Args:
        rpm: Cadência inicial em rotações por minuto.
        fps: Taxa de amostragem em fotogramas por segundo.
        duration_s: Duração da simulação em segundos.
        noise_std: Desvio padrão do ruído gaussiano aditivo em píxeis.
        knee_bdc: Ângulo do joelho desejado no BDC (graus).
        knee_tdc: Ângulo do joelho desejado no TDC (graus).
        drift_rpm_per_s: Taxa de aceleração/desaceleração da cadência (RPM/s).
        dropout_prob: Probabilidade de fotograma sem visibilidade [0, 1].
        seed: Semente pseudo-aleatória para determinismo estrito.

    Returns:
        SyntheticPedalingDataset com coordenadas, ângulos e verdade-terreno.
    """
    rng = np.random.default_rng(seed)
    total_frames = round(duration_s * fps)
    time_s = np.linspace(0.0, duration_s, total_frames, endpoint=False)
    timestamps_ms = time_s * 1000.0

    # Perfil temporal de RPM instantâneo
    instant_rpm = rpm + drift_rpm_per_s * time_s
    instant_rpm = np.clip(instant_rpm, 20.0, 160.0)

    # Fase do crenque por integração numérica da velocidade angular: d(theta)/dt = 2*pi*(rpm/60)
    dt = 1.0 / fps
    theta = np.zeros(total_frames, dtype=float)
    accum_theta = 0.0
    for i in range(total_frames):
        theta[i] = accum_theta
        accum_theta += 2.0 * math.pi * (instant_rpm[i] / 60.0) * dt

    # Cinemática exata calibrada pelos ângulos desejados knee_bdc e knee_tdc
    thigh_length = 330.0  # L1 (Fémur)
    shank_length = 330.0  # L2 (Tíbia)

    # Lei dos cossenos para distâncias máxima (BDC) e mínima (TDC) da anca ao tornozelo
    cos_bdc = math.cos(math.radians(knee_bdc))
    cos_tdc = math.cos(math.radians(knee_tdc))
    d_max = math.sqrt(max(1.0, thigh_length**2 + shank_length**2 - 2.0 * thigh_length * shank_length * cos_bdc))
    d_min = math.sqrt(max(1.0, thigh_length**2 + shank_length**2 - 2.0 * thigh_length * shank_length * cos_tdc))

    # Raio do crenque e distância ao eixo pedaleiro (BB)
    crank_length = (d_max - d_min) / 2.0
    d_bb = (d_max + d_min) / 2.0

    # Ângulo do tubo do selim (~73 graus face à horizontal, vetor direcionado para baixo/frente)
    seat_tube_angle_rad = math.radians(74.0)
    st_dir = np.array([math.cos(seat_tube_angle_rad), math.sin(seat_tube_angle_rad)])  # vetor unitário
    st_perp = np.array([-st_dir[1], st_dir[0]])  # vetor perpendicular (tangente à órbita)

    hip_origin = np.array([650.0, 320.0])
    bb_center = hip_origin + d_bb * st_dir

    # Oscilação pélvica fisiológica subtil (3 mm)
    hip_points = np.zeros((total_frames, 2), dtype=float)
    hip_points[:, 0] = hip_origin[0] + 2.0 * np.sin(theta)
    hip_points[:, 1] = hip_origin[1] + 3.0 * np.sin(2.0 * theta)

    # Órbita do pedal centrada no BB:
    # theta = 0: BDC (máxima extensão ao longo de st_dir)
    # theta = pi: TDC (máxima flexão)
    pedal_points = np.zeros((total_frames, 2), dtype=float)
    for i in range(total_frames):
        pedal_points[i] = (
            bb_center
            + (crank_length * math.cos(theta[i])) * st_dir
            + (crank_length * math.sin(theta[i])) * st_perp
        )

    # Tornozelo coincide com o eixo do pedal (com leve dinâmica de dorsiflexão/plantarflexão de 10mm)
    ankle_points = np.zeros((total_frames, 2), dtype=float)
    ankle_points[:, 0] = pedal_points[:, 0]
    ankle_points[:, 1] = pedal_points[:, 1]

    # Biqueira (toe) e Calcanhar (heel) projetados a partir do pé
    toe_points = np.zeros((total_frames, 2), dtype=float)
    toe_points[:, 0] = ankle_points[:, 0] + 65.0
    toe_points[:, 1] = ankle_points[:, 1] + 20.0

    heel_points = np.zeros((total_frames, 2), dtype=float)
    heel_points[:, 0] = ankle_points[:, 0] - 35.0
    heel_points[:, 1] = ankle_points[:, 1] + 10.0

    # Posição do joelho através de cinemática inversa 2D (Hip -> Knee -> Ankle)
    knee_points = np.zeros((total_frames, 2), dtype=float)
    knee_angles = np.zeros(total_frames, dtype=float)

    for i in range(total_frames):
        H = hip_points[i]
        A = ankle_points[i]
        D_vec = A - H
        D = float(np.linalg.norm(D_vec))

        # Clamp D para garantir solução cinemática física válida
        D_clamped = min(max(D, abs(thigh_length - shank_length) + 1.0), thigh_length + shank_length - 1.0)
        u_par = D_vec / D

        # Normal perpendicular voltada para a frente do ciclista (+X)
        # Se D_vec aponta para baixo (+Y), a normal para a frente (+X) é [u_y, -u_x]
        u_perp = np.array([u_par[1], -u_par[0]])
        if u_perp[0] < 0:
            u_perp = -u_perp

        d_par = (thigh_length**2 - shank_length**2 + D_clamped**2) / (2.0 * D_clamped)
        d_perp = math.sqrt(max(0.0, thigh_length**2 - d_par**2))

        K = H + d_par * u_par + d_perp * u_perp
        knee_points[i] = K

        # Cálculo do ângulo interno do joelho entre (H - K) e (A - K)
        vec_kh = H - K
        vec_ka = A - K
        dot = float(np.dot(vec_kh, vec_ka))
        norm_prod = float(np.linalg.norm(vec_kh) * np.linalg.norm(vec_ka))
        cos_angle = max(-1.0, min(1.0, dot / max(1e-6, norm_prod)))
        angle_deg = math.degrees(math.acos(cos_angle))
        knee_angles[i] = angle_deg

    # Identificar verdade-terreno a partir dos ciclos cinemáticos exatos de knee_angles (antes de ruído):
    # BDC: máxima extensão do joelho (máximo local de knee_angles)
    # TDC: máxima flexão do joelho (mínimo local de knee_angles)
    gt_bdc_indices: list[int] = []
    gt_tdc_indices: list[int] = []

    min_event_distance = max(4, int(fps * (60.0 / np.max(instant_rpm)) * 0.6))
    for i in range(1, total_frames - 1):
        if (
            knee_angles[i] > knee_angles[i - 1]
            and knee_angles[i] >= knee_angles[i + 1]
            and (not gt_bdc_indices or (i - gt_bdc_indices[-1]) > min_event_distance)
        ):
            gt_bdc_indices.append(i)

        if (
            knee_angles[i] < knee_angles[i - 1]
            and knee_angles[i] <= knee_angles[i + 1]
            and (not gt_tdc_indices or (i - gt_tdc_indices[-1]) > min_event_distance)
        ):
            gt_tdc_indices.append(i)

    gt_bdc_times = [float(timestamps_ms[idx]) for idx in gt_bdc_indices]
    gt_tdc_times = [float(timestamps_ms[idx]) for idx in gt_tdc_indices]

    # Injeção de ruído gaussiano se especificado
    if noise_std > 0.0:
        hip_points += rng.normal(0.0, noise_std, hip_points.shape)
        knee_points += rng.normal(0.0, noise_std, knee_points.shape)
        ankle_points += rng.normal(0.0, noise_std, ankle_points.shape)
        toe_points += rng.normal(0.0, noise_std, toe_points.shape)
        heel_points += rng.normal(0.0, noise_std, heel_points.shape)

        # Recalcular ângulos com ruído para refletir medições reais ruidosas
        for i in range(total_frames):
            vec_kh = hip_points[i] - knee_points[i]
            vec_ka = ankle_points[i] - knee_points[i]
            dot = float(np.dot(vec_kh, vec_ka))
            norm_prod = float(np.linalg.norm(vec_kh) * np.linalg.norm(vec_ka))
            cos_angle = max(-1.0, min(1.0, dot / max(1e-6, norm_prod)))
            knee_angles[i] = math.degrees(math.acos(cos_angle))

    # Visibilidade e dropouts
    visibilities = np.ones(total_frames, dtype=float)
    if dropout_prob > 0.0:
        dropout_mask = rng.uniform(0.0, 1.0, total_frames) < dropout_prob
        visibilities[dropout_mask] = 0.0

    return SyntheticPedalingDataset(
        timestamps_ms=timestamps_ms,
        time_s=time_s,
        fps=fps,
        target_rpm=rpm,
        actual_rpm=instant_rpm,
        hip_points=hip_points,
        knee_points=knee_points,
        ankle_points=ankle_points,
        toe_points=toe_points,
        heel_points=heel_points,
        knee_angles=knee_angles,
        visibilities=visibilities,
        ground_truth_bdc_indices=gt_bdc_indices,
        ground_truth_tdc_indices=gt_tdc_indices,
        ground_truth_bdc_times_ms=gt_bdc_times,
        ground_truth_tdc_times_ms=gt_tdc_times,
    )
