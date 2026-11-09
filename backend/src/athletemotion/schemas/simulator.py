"""Esquemas Pydantic para validação da API do Simulador Cinemático 2D."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Point2DSchema(BaseModel):
    """Ponto 2D cartesiano em milímetros."""

    x: float = Field(..., description="Coordenada X horizontal em mm")
    y: float = Field(..., description="Coordenada Y vertical em mm")


class AnthropometricProfileSchema(BaseModel):
    """Medidas dos segmentos corporais do ciclista."""

    femur_length_mm: float = Field(..., gt=200.0, lt=700.0, description="Comprimento do fémur em mm")
    tibia_length_mm: float = Field(..., gt=200.0, lt=700.0, description="Comprimento da tíbia em mm")
    trunk_length_mm: float = Field(..., gt=300.0, lt=900.0, description="Comprimento do tronco em mm")
    arm_length_mm: float = Field(..., gt=150.0, lt=500.0, description="Comprimento do braço (úmero) em mm")
    forearm_length_mm: float = Field(..., gt=150.0, lt=500.0, description="Comprimento do antebraço em mm")
    foot_length_mm: float = Field(default=260.0, gt=150.0, lt=400.0, description="Comprimento do pé em mm")
    pelvic_width_mm: float = Field(default=140.0, gt=80.0, lt=250.0, description="Largura isquiática em mm")


class BikeGeometryBaselineSchema(BaseModel):
    """Pontos de contacto e geometria da bicicleta de referência."""

    saddle_height_mm: float = Field(..., gt=400.0, lt=1100.0, description="Altura do selim BB-topo em mm")
    saddle_setback_mm: float = Field(..., ge=-200.0, le=200.0, description="Recuo da ponta do selim face ao BB em mm")
    seat_tube_angle_deg: float = Field(default=73.5, gt=65.0, lt=85.0, description="Ângulo do tubo de selim em graus")
    handlebar_stack_mm: float = Field(..., gt=300.0, lt=900.0, description="Stack do guiador face ao BB em mm")
    handlebar_reach_mm: float = Field(..., gt=200.0, lt=700.0, description="Reach do guiador face ao BB em mm")
    crank_length_mm: float = Field(default=172.5, gt=140.0, lt=200.0, description="Comprimento do crenque em mm")


class AdjustmentDeltasSchema(BaseModel):
    """Variações propostas nos pontos de contacto."""

    delta_saddle_height_mm: float = Field(default=0.0, ge=-100.0, le=100.0, description="Variação de altura do selim (mm)")
    delta_saddle_setback_mm: float = Field(default=0.0, ge=-100.0, le=100.0, description="Variação de recuo do selim (mm)")
    delta_stem_stack_mm: float = Field(default=0.0, ge=-80.0, le=80.0, description="Variação de stack/espaçadores (mm)")
    delta_stem_reach_mm: float = Field(default=0.0, ge=-80.0, le=80.0, description="Variação de avanço/reach (mm)")
    delta_crank_length_mm: float = Field(default=0.0, ge=-30.0, le=30.0, description="Variação no crenque (mm)")


class SimulatedPostureSnapshotSchema(BaseModel):
    """Esqueleto articular e ângulos calculados numa fase do ciclo."""

    crank_phase: Literal["BDC", "TDC", "POWER_3H"]
    crank_angle_deg: float
    hip_point: Point2DSchema
    knee_point: Point2DSchema
    ankle_point: Point2DSchema
    pedal_point: Point2DSchema
    shoulder_point: Point2DSchema
    elbow_point: Point2DSchema
    hand_point: Point2DSchema
    knee_angle_deg: float
    hip_angle_deg: float
    torso_angle_deg: float
    elbow_angle_deg: float
    shoulder_angle_deg: float


class KinematicRiskWarningSchema(BaseModel):
    """Alerta ergonómico da simulação."""

    code: str
    severity: Literal["optimal", "warning", "critical"]
    joint: str
    message_pt: str
    message_en: str
    measured_value: float
    threshold_value: float


class SimulateAdjustmentsRequest(BaseModel):
    """Pedido para simular alterações de BikeFit."""

    anthropometry: AnthropometricProfileSchema
    baseline_geometry: BikeGeometryBaselineSchema
    adjustments: AdjustmentDeltasSchema = Field(default_factory=AdjustmentDeltasSchema)


class SimulateAdjustmentsResponse(BaseModel):
    """Resposta com previsões posturais e análise de risco."""

    baseline_knee_bdc_deg: float
    simulated_knee_bdc_deg: float
    delta_knee_bdc_deg: float

    baseline_hip_tdc_deg: float
    simulated_hip_tdc_deg: float
    delta_hip_tdc_deg: float

    baseline_torso_deg: float
    simulated_torso_deg: float
    delta_torso_deg: float

    baseline_elbow_deg: float
    simulated_elbow_deg: float
    delta_elbow_deg: float

    kops_offset_3h_mm: float

    bdc_posture: SimulatedPostureSnapshotSchema
    tdc_posture: SimulatedPostureSnapshotSchema
    power_3h_posture: SimulatedPostureSnapshotSchema

    warnings: list[KinematicRiskWarningSchema]
    is_anatomically_feasible: bool
    summary_pt: str
    summary_en: str

