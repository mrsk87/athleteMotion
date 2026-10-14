"""Módulo de análise biomecânica no plano frontal (vista anterior/posterior).

Calcula:
- Queda pélvica lateral (Hip Drop em graus)
- Oscilação lateral do tronco/cabeça (Lateral Sway em mm)
- Trajetória frontal do joelho (Knee Tracking varo/valgo por ciclo)
- Largura de apoio dinâmico (Fator Q estimado em mm)
- Índices de simetria bilateral (SI) para os membros inferiores
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from athletemotion.domain.biomechanics.alignment import (
    FrontalKneeDiagnostic,
    evaluate_frontal_knee_tracking,
)
from athletemotion.domain.biomechanics.symmetry import (
    SymmetryReport,
    calculate_symmetry_index,
)
from athletemotion.domain.calibration.types import ScaleCalibration

__all__ = [
    "FrontalKneeDiagnostic",
    "FrontalMeasuresReport",
    "HipDropReport",
    "KneeTrackingSummary",
    "LateralSwayReport",
    "calculate_knee_frontal_deviation_px",
    "calculate_lateral_sway",
    "calculate_pelvic_drop",
    "compute_frontal_measures",
]


@dataclass(frozen=True)
class HipDropReport:
    """Análise de estabilidade pélvica e oscilação lateral da bacia."""

    max_drop_deg: float
    mean_drop_deg: float
    peak_to_peak_deg: float
    is_stable: bool
    status_label_pt: str
    status_label_en: str
    recommendation_pt: str
    recommendation_en: str


@dataclass(frozen=True)
class LateralSwayReport:
    """Medição da oscilação lateral do tronco / linha central em mm."""

    sway_mm: float | None
    uncertainty_mm: float | None
    withheld: bool
    reason: str | None
    status_label_pt: str
    status_label_en: str


@dataclass(frozen=True)
class KneeTrackingSummary:
    """Resumo de alinhamento e trajetória frontal para ambos os joelhos."""

    left_diagnostic: FrontalKneeDiagnostic
    right_diagnostic: FrontalKneeDiagnostic
    left_max_deviation_mm: float
    right_max_deviation_mm: float


@dataclass(frozen=True)
class FrontalMeasuresReport:
    """Relatório integrado de métricas biomecânicas do plano frontal."""

    hip_drop: HipDropReport
    lateral_sway: LateralSwayReport
    knee_tracking: KneeTrackingSummary
    q_factor_mm: float | None
    q_factor_uncertainty_mm: float | None
    symmetry_knee_rom: SymmetryReport
    cycles_analyzed: int


def calculate_pelvic_drop(
    left_hip_points: Sequence[tuple[float, float]],
    right_hip_points: Sequence[tuple[float, float]],
    stability_threshold_deg: float = 2.5,
) -> HipDropReport:
    """Calcula a oscilação e queda pélvica a partir das trajetórias das ancas.

    Ângulo de inclinação pélvica face à horizontal:
    arctan((y_right - y_left) / (x_right - x_left)) em graus.
    """
    n = min(len(left_hip_points), len(right_hip_points))
    if n < 2:
        return HipDropReport(
            max_drop_deg=0.0,
            mean_drop_deg=0.0,
            peak_to_peak_deg=0.0,
            is_stable=True,
            status_label_pt="Dados insuficientes para análise pélvica",
            status_label_en="Insufficient data for pelvic analysis",
            recommendation_pt="Manter cadência constante na vista frontal.",
            recommendation_en="Maintain steady cadence in frontal view.",
        )

    angles: list[float] = []
    for i in range(n):
        lx, ly = left_hip_points[i]
        rx, ry = right_hip_points[i]
        dx = rx - lx
        dy = ry - ly  # Coordenada Y cresce para baixo
        if abs(dx) < 1e-4:
            continue
        rad = math.atan2(dy, dx)
        deg = math.degrees(rad)
        angles.append(deg)

    if not angles:
        return HipDropReport(
            max_drop_deg=0.0,
            mean_drop_deg=0.0,
            peak_to_peak_deg=0.0,
            is_stable=True,
            status_label_pt="Sem dados válidos",
            status_label_en="No valid data",
            recommendation_pt="Verificar enquadramento da câmara frontal.",
            recommendation_en="Check frontal camera framing.",
        )

    arr = np.asarray(angles, dtype=np.float64)
    # Centrar face à média estática para medir a oscilação dinâmica
    centered = arr - np.mean(arr)
    p2p = float(np.ptp(centered))
    max_drop = float(np.max(np.abs(centered)))
    mean_drop = float(np.mean(np.abs(centered)))

    p2p_rounded = round(p2p, 1)
    max_rounded = round(max_drop, 1)
    mean_rounded = round(mean_drop, 1)

    is_stable = p2p_rounded <= stability_threshold_deg

    if is_stable:
        status_pt = f"Pélvis Estável (Oscilação {p2p_rounded}°)"
        status_en = f"Stable Pelvis (Oscillation {p2p_rounded}°)"
        rec_pt = "Bacia nivelada e estável sobre o selim. Sem oscilação nociva."
        rec_en = "Pelvis level and stable on the saddle. No harmful rocking."
    else:
        status_pt = f"Queda Pélvica Excessiva ({p2p_rounded}° > {stability_threshold_deg}°)"
        status_en = f"Excessive Pelvic Drop ({p2p_rounded}° > {stability_threshold_deg}°)"
        rec_pt = (
            f"Bacia oscila {p2p_rounded}° lateralmente. Indica selim excessivamente alto "
            "ou fraqueza no glúteo médio. Recomenda-se baixar o selim em 5 mm."
        )
        rec_en = (
            f"Pelvis rocks {p2p_rounded}° laterally. Indicates saddle is too high "
            "or gluteus medius weakness. Lowering saddle by ~5 mm is recommended."
        )

    return HipDropReport(
        max_drop_deg=max_rounded,
        mean_drop_deg=mean_rounded,
        peak_to_peak_deg=p2p_rounded,
        is_stable=is_stable,
        status_label_pt=status_pt,
        status_label_en=status_en,
        recommendation_pt=rec_pt,
        recommendation_en=rec_en,
    )


def calculate_lateral_sway(
    torso_x_points: Sequence[float],
    calibration: ScaleCalibration | None,
    max_acceptable_sway_mm: float = 30.0,
) -> LateralSwayReport:
    """Calcula a oscilação lateral do tronco/cabeça durante a pedalada."""
    if len(torso_x_points) < 5:
        return LateralSwayReport(
            sway_mm=None,
            uncertainty_mm=None,
            withheld=True,
            reason="Amostras insuficientes de tronco.",
            status_label_pt="Amostras insuficientes",
            status_label_en="Insufficient samples",
        )

    if calibration is None:
        return LateralSwayReport(
            sway_mm=None,
            uncertainty_mm=None,
            withheld=True,
            reason="Calibração métrica ausente. Medição de sway em mm requer escala.",
            status_label_pt="Não calibrado",
            status_label_en="Uncalibrated",
        )

    arr = np.asarray(torso_x_points, dtype=np.float64)
    # Amplitude pico a pico da coordenada X
    ptp_px = float(np.ptp(arr))
    sway_mm = calibration.px_to_mm(ptp_px)
    unc_mm = calibration.uncertainty_mm(ptp_px)

    val_rounded = round(sway_mm, 1)
    unc_rounded = round(unc_mm, 1)

    if val_rounded <= max_acceptable_sway_mm:
        status_pt = f"Oscilação Controlada ({val_rounded} mm)"
        status_en = f"Controlled Sway ({val_rounded} mm)"
    else:
        status_pt = f"Oscilação Excessiva ({val_rounded} mm)"
        status_en = f"Excessive Sway ({val_rounded} mm)"

    return LateralSwayReport(
        sway_mm=val_rounded,
        uncertainty_mm=unc_rounded,
        withheld=False,
        reason=None,
        status_label_pt=status_pt,
        status_label_en=status_en,
    )


def calculate_knee_frontal_deviation_px(
    hip: tuple[float, float],
    knee: tuple[float, float],
    ankle: tuple[float, float],
) -> float:
    """Calcula o desvio horizontal do joelho face ao eixo mecânico anca-tornozelo.

    Retorna o desvio em píxeis.
    """
    hx, hy = hip
    kx, ky = knee
    ax, ay = ankle

    dy_leg = ay - hy
    if abs(dy_leg) < 1e-4:
        return 0.0

    # Interpolação linear da coordenada X do eixo anca-tornozelo na altura Y do joelho
    fraction = (ky - hy) / dy_leg
    axis_x = hx + fraction * (ax - hx)

    # Desvio relativo: joelho menos o eixo ideal
    return float(kx - axis_x)


def compute_frontal_measures(
    frames_landmarks: Sequence[dict[str, tuple[float, float]]],
    calibration: ScaleCalibration | None = None,
    left_knee_rom_deg: float = 70.0,
    right_knee_rom_deg: float = 70.0,
) -> FrontalMeasuresReport:
    """Executa a bateria de medições do plano frontal a partir dos marcos esqueléticos."""
    left_hips: list[tuple[float, float]] = []
    right_hips: list[tuple[float, float]] = []
    torso_xs: list[float] = []

    left_devs_px: list[float] = []
    right_devs_px: list[float] = []
    ankle_widths_px: list[float] = []

    for lms in frames_landmarks:
        l_hip = lms.get("left_hip")
        r_hip = lms.get("right_hip")
        l_knee = lms.get("left_knee")
        r_knee = lms.get("right_knee")
        l_ankle = lms.get("left_ankle")
        r_ankle = lms.get("right_ankle")

        if l_hip and r_hip:
            left_hips.append(l_hip)
            right_hips.append(r_hip)
            mid_x = (l_hip[0] + r_hip[0]) / 2.0
            torso_xs.append(mid_x)

        if l_hip and l_knee and l_ankle:
            dev_l = calculate_knee_frontal_deviation_px(l_hip, l_knee, l_ankle)
            left_devs_px.append(dev_l)

        if r_hip and r_knee and r_ankle:
            dev_r = calculate_knee_frontal_deviation_px(r_hip, r_knee, r_ankle)
            right_devs_px.append(dev_r)

        if l_ankle and r_ankle:
            w = abs(r_ankle[0] - l_ankle[0])
            ankle_widths_px.append(w)

    # 1. Hip drop
    hip_drop_rep = calculate_pelvic_drop(left_hips, right_hips)

    # 2. Lateral sway
    sway_rep = calculate_lateral_sway(torso_xs, calibration)

    # 3. Knee tracking (varo/valgo)
    # Converter desvios para mm se calibrado, senão trata píxeis diretamente com cautela
    if calibration is not None and left_devs_px:
        l_max_dev_mm = calibration.px_to_mm(float(np.max(np.abs(left_devs_px))))
        l_mean_dev_mm = calibration.px_to_mm(float(np.mean(left_devs_px)))
    elif left_devs_px:
        l_max_dev_mm = float(np.max(np.abs(left_devs_px)))
        l_mean_dev_mm = float(np.mean(left_devs_px))
    else:
        l_max_dev_mm = 0.0
        l_mean_dev_mm = 0.0

    if calibration is not None and right_devs_px:
        r_max_dev_mm = calibration.px_to_mm(float(np.max(np.abs(right_devs_px))))
        r_mean_dev_mm = calibration.px_to_mm(float(np.mean(right_devs_px)))
    elif right_devs_px:
        r_max_dev_mm = float(np.max(np.abs(right_devs_px)))
        r_mean_dev_mm = float(np.mean(right_devs_px))
    else:
        r_max_dev_mm = 0.0
        r_mean_dev_mm = 0.0

    diag_left = evaluate_frontal_knee_tracking(l_mean_dev_mm, side="left")
    diag_right = evaluate_frontal_knee_tracking(r_mean_dev_mm, side="right")

    tracking_summary = KneeTrackingSummary(
        left_diagnostic=diag_left,
        right_diagnostic=diag_right,
        left_max_deviation_mm=round(l_max_dev_mm, 1),
        right_max_deviation_mm=round(r_max_dev_mm, 1),
    )

    # 4. Fator Q dinâmico
    q_val: float | None = None
    q_unc: float | None = None
    if calibration is not None and ankle_widths_px:
        mean_w_px = float(np.mean(ankle_widths_px))
        q_val = round(calibration.px_to_mm(mean_w_px), 1)
        q_unc = round(calibration.uncertainty_mm(mean_w_px), 1)

    # 5. Índice de simetria (SI) entre joelhos
    si_rep = calculate_symmetry_index(left_knee_rom_deg, right_knee_rom_deg, joint_name="joelho_rom")

    return FrontalMeasuresReport(
        hip_drop=hip_drop_rep,
        lateral_sway=sway_rep,
        knee_tracking=tracking_summary,
        q_factor_mm=q_val,
        q_factor_uncertainty_mm=q_unc,
        symmetry_knee_rom=si_rep,
        cycles_analyzed=len(left_hips),
    )
