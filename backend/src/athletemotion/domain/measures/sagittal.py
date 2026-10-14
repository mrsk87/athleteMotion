"""Curvas angulares sagitais por ciclo de pedalada (0–360°) e medidas estáticas derivadas.

Implementa a normalização e reamostragem a 100 pontos da revolução do pedaleiro,
cálculo de média ± DP, ROM (amplitude) e fase de pico para:
- Joelho (flexão/extensão)
- Anca (flexão tronco-fémur)
- Tornozelo (dorsiflexão/flexão plantar)
- Ombro (tronco-braço)
- Cotovelo (braço-antebraço)

Implementa também as medidas estáticas em milímetros com propagação de incerteza:
- KOPS (Setback da rótula face ao eixo do pedal a 3h)
- Saddle-to-Bar Drop (desnível vertical selim-guiador)
- Reach (alcance horizontal selim-guiador)
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt

from athletemotion.domain.calibration.types import ScaleCalibration


@dataclass(frozen=True)
class CycleCurvePoint:
    """Ponto instantâneo na curva angular de um ciclo."""

    crank_deg: float  # [0.0..360.0]
    mean: float
    std: float
    min_val: float
    max_val: float


@dataclass(frozen=True)
class JointCycleCurve:
    """Curva estatística média de uma articulação ao longo do ciclo pedaleiro."""

    joint_name: str
    points: list[CycleCurvePoint]
    rom_deg: float
    peak_angle_deg: float
    peak_phase_deg: float
    min_angle_deg: float
    min_phase_deg: float


@dataclass(frozen=True)
class SagittalCycleReport:
    """Relatório completo das curvas angulares sagitais agregadas em múltiplos ciclos."""

    cycles_analyzed: int
    knee_curve: JointCycleCurve
    hip_curve: JointCycleCurve
    ankle_curve: JointCycleCurve
    shoulder_curve: JointCycleCurve
    elbow_curve: JointCycleCurve


@dataclass(frozen=True)
class DerivedStaticMeasure:
    """Medida estática métrica em milímetros com incerteza estrita e salvaguarda de calibração."""

    name: str
    value_mm: float | None
    uncertainty_mm: float | None
    withheld: bool
    reason: str | None
    status_label_pt: str
    status_label_en: str
    recommendation_pt: str
    recommendation_en: str


def resample_cycle_to_grid(
    cycle_samples_time_ms: Sequence[float],
    cycle_angles: Sequence[float],
    bdc_time_ms: float | None = None,
    grid_points: int = 100,
) -> npt.NDArray[np.float64]:
    """Reamostra uma série angular de um ciclo para uma grelha uniforme de 0° a 360°.

    Utiliza mapeamento bifásico se o BDC estiver disponível (0°=TDC a 180°=BDC, 180° a 360°=TDC),
    ou interpolação linear uniforme.
    """
    n = len(cycle_samples_time_ms)
    if n < 2 or len(cycle_angles) != n:
        return np.zeros(grid_points, dtype=np.float64)

    t_arr = np.asarray(cycle_samples_time_ms, dtype=np.float64)
    a_arr = np.asarray(cycle_angles, dtype=np.float64)

    t_start = t_arr[0]
    t_end = t_arr[-1]
    dur = t_end - t_start
    if dur <= 0:
        return np.full(grid_points, a_arr[0], dtype=np.float64)

    # Cálculo dos ângulos do cranque para cada amostra
    if bdc_time_ms is not None and t_start < bdc_time_ms < t_end:
        dur_down = bdc_time_ms - t_start
        dur_up = t_end - bdc_time_ms
        crank_angles = np.zeros(n, dtype=np.float64)
        for i, t in enumerate(t_arr):
            if t <= bdc_time_ms:
                crank_angles[i] = ((t - t_start) / dur_down) * 180.0
            else:
                crank_angles[i] = 180.0 + ((t - bdc_time_ms) / dur_up) * 180.0
    else:
        crank_angles = ((t_arr - t_start) / dur) * 360.0

    # Garantir monotonicidade para interpolação
    crank_angles[0] = 0.0
    crank_angles[-1] = 360.0

    target_grid = np.linspace(0.0, 360.0, grid_points, endpoint=False)
    resampled: npt.NDArray[np.float64] = np.interp(target_grid, crank_angles, a_arr)
    return resampled


def build_joint_cycle_curve(
    joint_name: str,
    resampled_cycles: Sequence[npt.NDArray[np.float64]],
    grid_points: int = 100,
) -> JointCycleCurve:
    """Agrega múltiplas curvas reamostradas numa curva estatística média ± DP."""
    if not resampled_cycles:
        empty_points = [
            CycleCurvePoint(
                crank_deg=round(i * (360.0 / grid_points), 1),
                mean=0.0,
                std=0.0,
                min_val=0.0,
                max_val=0.0,
            )
            for i in range(grid_points)
        ]
        return JointCycleCurve(
            joint_name=joint_name,
            points=empty_points,
            rom_deg=0.0,
            peak_angle_deg=0.0,
            peak_phase_deg=0.0,
            min_angle_deg=0.0,
            min_phase_deg=0.0,
        )

    matrix = np.vstack(resampled_cycles)  # Shape: (N_cycles, grid_points)
    mean_curve = np.mean(matrix, axis=0)
    std_curve = np.std(matrix, axis=0)
    min_curve = np.min(matrix, axis=0)
    max_curve = np.max(matrix, axis=0)

    points: list[CycleCurvePoint] = []
    for i in range(grid_points):
        deg = round(i * (360.0 / grid_points), 1)
        points.append(
            CycleCurvePoint(
                crank_deg=deg,
                mean=round(float(mean_curve[i]), 2),
                std=round(float(std_curve[i]), 2),
                min_val=round(float(min_curve[i]), 2),
                max_val=round(float(max_curve[i]), 2),
            )
        )

    peak_idx = int(np.argmax(mean_curve))
    min_idx = int(np.argmin(mean_curve))

    peak_angle = round(float(mean_curve[peak_idx]), 2)
    peak_phase = round(peak_idx * (360.0 / grid_points), 1)
    min_angle = round(float(mean_curve[min_idx]), 2)
    min_phase = round(min_idx * (360.0 / grid_points), 1)
    rom = round(peak_angle - min_angle, 2)

    return JointCycleCurve(
        joint_name=joint_name,
        points=points,
        rom_deg=rom,
        peak_angle_deg=peak_angle,
        peak_phase_deg=peak_phase,
        min_angle_deg=min_angle,
        min_phase_deg=min_phase,
    )


def compute_sagittal_cycle_curves(
    cycles_data: Sequence[dict[str, Any]],
    grid_points: int = 100,
) -> SagittalCycleReport:
    """Calcula as curvas completas por ciclo para joelho, anca, tornozelo, ombro e cotovelo.

    Cada item em `cycles_data` deve conter:
    - 'timestamps_ms': lista de floats
    - 'knee_angles': lista de floats
    - 'hip_angles': lista de floats (opcional, defaults a 0)
    - 'ankle_angles': lista de floats (opcional)
    - 'shoulder_angles': lista de floats (opcional)
    - 'elbow_angles': lista de floats (opcional)
    - 'bdc_time_ms': float opcional
    """
    knee_resampled: list[npt.NDArray[np.float64]] = []
    hip_resampled: list[npt.NDArray[np.float64]] = []
    ankle_resampled: list[npt.NDArray[np.float64]] = []
    shoulder_resampled: list[npt.NDArray[np.float64]] = []
    elbow_resampled: list[npt.NDArray[np.float64]] = []

    for c in cycles_data:
        t_ms = c.get("timestamps_ms", [])
        if len(t_ms) < 2:
            continue
        bdc_t = c.get("bdc_time_ms")

        if "knee_angles" in c:
            knee_resampled.append(resample_cycle_to_grid(t_ms, c["knee_angles"], bdc_t, grid_points))
        if "hip_angles" in c:
            hip_resampled.append(resample_cycle_to_grid(t_ms, c["hip_angles"], bdc_t, grid_points))
        if "ankle_angles" in c:
            ankle_resampled.append(resample_cycle_to_grid(t_ms, c["ankle_angles"], bdc_t, grid_points))
        if "shoulder_angles" in c:
            shoulder_resampled.append(resample_cycle_to_grid(t_ms, c["shoulder_angles"], bdc_t, grid_points))
        if "elbow_angles" in c:
            elbow_resampled.append(resample_cycle_to_grid(t_ms, c["elbow_angles"], bdc_t, grid_points))

    cycles_count = len(knee_resampled)
    knee_c = build_joint_cycle_curve("knee", knee_resampled, grid_points)
    hip_c = build_joint_cycle_curve("hip", hip_resampled, grid_points)
    ankle_c = build_joint_cycle_curve("ankle", ankle_resampled, grid_points)
    shoulder_c = build_joint_cycle_curve("shoulder", shoulder_resampled, grid_points)
    elbow_c = build_joint_cycle_curve("elbow", elbow_resampled, grid_points)

    return SagittalCycleReport(
        cycles_analyzed=cycles_count,
        knee_curve=knee_c,
        hip_curve=hip_c,
        ankle_curve=ankle_c,
        shoulder_curve=shoulder_c,
        elbow_curve=elbow_c,
    )


# ---------------------------------------------------------------------------
# Subtarefa 3: Medidas estáticas derivadas (em mm, requer calibração R11)
# ---------------------------------------------------------------------------


def calculate_kops_setback(
    knee_anterior_x_px: float,
    pedal_spindle_x_px: float,
    calibration: ScaleCalibration | None,
    side: str = "right",
    tolerance_mm: float = 5.0,
) -> DerivedStaticMeasure:
    """Calcula o setback KOPS (alinhamento joelho-eixo do pedal) na posição horizontal das 3h."""
    if calibration is None:
        return DerivedStaticMeasure(
            name="kops_setback",
            value_mm=None,
            uncertainty_mm=None,
            withheld=True,
            reason="Calibração métrica ausente. A medida KOPS em mm requer escala verificada.",
            status_label_pt="Não calibrado",
            status_label_en="Uncalibrated",
            recommendation_pt="Efetuar calibração métrica com ArUco ou crenque para obter milímetros.",
            recommendation_en="Perform metric calibration with ArUco or crank to obtain millimeters.",
        )

    # Offset em píxeis: positivo se joelho à frente do eixo no sentido de marcha
    # Se side == "right" e ciclista virado à direita, joelho adiantado tem x maior
    offset_px = knee_anterior_x_px - pedal_spindle_x_px
    offset_mm = calibration.px_to_mm(offset_px)
    unc_mm = calibration.uncertainty_mm(offset_px)

    abs_mm = abs(round(offset_mm, 1))
    unc_rounded = round(unc_mm, 1)

    if abs_mm <= tolerance_mm:
        return DerivedStaticMeasure(
            name="kops_setback",
            value_mm=round(offset_mm, 1),
            uncertainty_mm=unc_rounded,
            withheld=False,
            reason=None,
            status_label_pt="KOPS Neutro e Alinhado",
            status_label_en="KOPS Neutral and Aligned",
            recommendation_pt=f"Posição horizontal do selim perfeita ({offset_mm:+.1f} ± {unc_rounded} mm).",
            recommendation_en=f"Saddle fore/aft position optimal ({offset_mm:+.1f} ± {unc_rounded} mm).",
        )
    elif offset_mm > tolerance_mm:
        return DerivedStaticMeasure(
            name="kops_setback",
            value_mm=round(offset_mm, 1),
            uncertainty_mm=unc_rounded,
            withheld=False,
            reason=None,
            status_label_pt=f"Joelho Adiantado (+{abs_mm} mm)",
            status_label_en=f"Knee Forward (+{abs_mm} mm)",
            recommendation_pt=f"Recuar o selim em aproximadamente {abs_mm} mm (±{unc_rounded} mm) para aliviar a rótula.",
            recommendation_en=f"Slide saddle backward by ~{abs_mm} mm (±{unc_rounded} mm) to relieve patellar load.",
        )
    else:
        return DerivedStaticMeasure(
            name="kops_setback",
            value_mm=round(offset_mm, 1),
            uncertainty_mm=unc_rounded,
            withheld=False,
            reason=None,
            status_label_pt=f"Joelho Atrasado (-{abs_mm} mm)",
            status_label_en=f"Knee Behind (-{abs_mm} mm)",
            recommendation_pt=f"Avançar o selim em aproximadamente {abs_mm} mm (±{unc_rounded} mm) para otimizar o quadríceps.",
            recommendation_en=f"Slide saddle forward by ~{abs_mm} mm (±{unc_rounded} mm) to optimize quadriceps.",
        )


def calculate_saddle_to_bar_drop(
    saddle_ref_y_px: float,
    handlebar_ref_y_px: float,
    calibration: ScaleCalibration | None,
) -> DerivedStaticMeasure:
    """Calcula o desnível vertical selim-guiador (Saddle-to-Bar Drop) em mm.

    Nota em coordenadas de imagem: Y cresce para baixo, logo se o selim estiver
    mais alto que o guiador, saddle_ref_y < handlebar_ref_y, e o drop é positivo.
    """
    if calibration is None:
        return DerivedStaticMeasure(
            name="saddle_to_bar_drop",
            value_mm=None,
            uncertainty_mm=None,
            withheld=True,
            reason="Calibração métrica ausente.",
            status_label_pt="Não calibrado",
            status_label_en="Uncalibrated",
            recommendation_pt="Efetuar calibração métrica para medição de desnível.",
            recommendation_en="Perform metric calibration to measure saddle drop.",
        )

    drop_px = handlebar_ref_y_px - saddle_ref_y_px  # Positivo se selim mais alto
    drop_mm = calibration.px_to_mm(drop_px)
    unc_mm = calibration.uncertainty_mm(drop_px)

    val_rounded = round(drop_mm, 1)
    unc_rounded = round(unc_mm, 1)

    return DerivedStaticMeasure(
        name="saddle_to_bar_drop",
        value_mm=val_rounded,
        uncertainty_mm=unc_rounded,
        withheld=False,
        reason=None,
        status_label_pt=f"Desnível Selim-Guiador ({val_rounded} mm)",
        status_label_en=f"Saddle-to-Bar Drop ({val_rounded} mm)",
        recommendation_pt=f"Desnível vertical medido: {val_rounded} ± {unc_rounded} mm.",
        recommendation_en=f"Measured vertical drop: {val_rounded} ± {unc_rounded} mm.",
    )


def calculate_reach(
    saddle_nose_x_px: float,
    handlebar_clamp_x_px: float,
    calibration: ScaleCalibration | None,
) -> DerivedStaticMeasure:
    """Calcula o alcance horizontal selim-guiador (Reach) em mm."""
    if calibration is None:
        return DerivedStaticMeasure(
            name="reach",
            value_mm=None,
            uncertainty_mm=None,
            withheld=True,
            reason="Calibração métrica ausente.",
            status_label_pt="Não calibrado",
            status_label_en="Uncalibrated",
            recommendation_pt="Efetuar calibração métrica para medição de alcance horizontal.",
            recommendation_en="Perform metric calibration to measure reach.",
        )

    reach_px = abs(handlebar_clamp_x_px - saddle_nose_x_px)
    reach_mm = calibration.px_to_mm(reach_px)
    unc_mm = calibration.uncertainty_mm(reach_px)

    val_rounded = round(reach_mm, 1)
    unc_rounded = round(unc_mm, 1)

    return DerivedStaticMeasure(
        name="reach",
        value_mm=val_rounded,
        uncertainty_mm=unc_rounded,
        withheld=False,
        reason=None,
        status_label_pt=f"Alcance Selim-Guiador ({val_rounded} mm)",
        status_label_en=f"Reach ({val_rounded} mm)",
        recommendation_pt=f"Distância horizontal selim-guiador: {val_rounded} ± {unc_rounded} mm.",
        recommendation_en=f"Horizontal reach: {val_rounded} ± {unc_rounded} mm.",
    )
