"""Esquemas Pydantic para validação e serialização de medidas avançadas de BikeFit.

Expõe modelos estritos com suporte a confiança de medição, incerteza,
gating de qualidade e metadados de rastreabilidade clínica.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class MeasureWithConfidence(BaseModel):
    """Representação unificada de uma medida biomecânica com confiança e salvaguardas."""

    value: float | None = Field(default=None, description="Valor numérico medido ou None se retido")
    unit: str = Field(..., description="Unidade de medida ('°', 'mm', 'cm', 'RPM', '%')")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Pontuação composta de confiança [0.0..1.0]")
    uncertainty: float | None = Field(default=None, description="Margem de incerteza expandida (±)")
    source: Literal["cycle_detection", "manual_snapshot", "calibration", "derived"] = Field(
        default="cycle_detection", description="Origem da medição"
    )
    withheld: bool = Field(default=False, description="True se a medida foi retida pelo portão de qualidade")
    withhold_reason: str | None = Field(default=None, description="Motivo clínico/técnico da retenção")


class CycleCurvePointSchema(BaseModel):
    crank_deg: float = Field(..., ge=0.0, le=360.0, description="Ângulo do crenque em graus (0° = TDC, 180° = BDC)")
    mean: float = Field(..., description="Valor médio do ângulo articular")
    std: float = Field(..., description="Desvio padrão inter-ciclos")
    min_val: float = Field(..., description="Valor mínimo")
    max_val: float = Field(..., description="Valor máximo")


class JointCycleCurveSchema(BaseModel):
    joint_name: str = Field(..., description="Nome da articulação ('knee', 'hip', 'ankle', 'shoulder', 'elbow')")
    points: list[CycleCurvePointSchema] = Field(..., description="100 pontos amostrados ao longo da rotação")
    rom_deg: float = Field(..., description="Amplitude articular (Range of Motion)")
    peak_angle_deg: float = Field(..., description="Ângulo de pico")
    peak_phase_deg: float = Field(..., description="Fase de cranque onde ocorre o pico [0..360°]")
    min_angle_deg: float = Field(..., description="Ângulo mínimo")
    min_phase_deg: float = Field(..., description="Fase de cranque onde ocorre o mínimo [0..360°]")


class SagittalMeasuresSummary(BaseModel):
    cycles_analyzed: int = Field(..., description="Número de ciclos válidos analisados")
    knee: JointCycleCurveSchema | None = None
    hip: JointCycleCurveSchema | None = None
    ankle: JointCycleCurveSchema | None = None
    shoulder: JointCycleCurveSchema | None = None
    elbow: JointCycleCurveSchema | None = None
    kops_setback_mm: MeasureWithConfidence | None = None
    saddle_to_bar_drop_mm: MeasureWithConfidence | None = None
    reach_mm: MeasureWithConfidence | None = None


class FrontalMeasuresSummary(BaseModel):
    cycles_analyzed: int = Field(..., description="Número de ciclos analisados na vista frontal")
    hip_drop_deg: MeasureWithConfidence | None = None
    lateral_sway_mm: MeasureWithConfidence | None = None
    q_factor_mm: MeasureWithConfidence | None = None
    knee_valgus_left_mm: MeasureWithConfidence | None = None
    knee_valgus_right_mm: MeasureWithConfidence | None = None
    knee_tracking_condition_left: str = "neutral"
    knee_tracking_condition_right: str = "neutral"
    symmetry_index_pct: float | None = None


class FatigueMetricSchema(BaseModel):
    metric_name: str
    unit: str
    early_mean: float
    late_mean: float
    drift: float
    p_value: float
    significant: bool
    interpretation_pt: str
    interpretation_en: str


class FatigueReportSchema(BaseModel):
    cycles_total: int
    early_cycles_count: int
    late_cycles_count: int
    overall_fatigue_detected: bool
    summary_pt: str
    summary_en: str
    metrics: list[FatigueMetricSchema] = Field(default_factory=list)


class SessionMeasuresSummary(BaseModel):
    """Resumo unificado de medidas avançadas e portão de qualidade da sessão."""

    overall_confidence: float = Field(..., ge=0.0, le=1.0)
    gating_passed: bool = Field(..., description="True se a confiança geral satisfaz o limiar mínimo de 0.60")
    visible_side: str = Field(default="right", description="'left' ou 'right'")
    visible_side_confidence: float = Field(default=1.0)
    sagittal: SagittalMeasuresSummary | None = None
    frontal: FrontalMeasuresSummary | None = None
    fatigue: FatigueReportSchema | None = None
