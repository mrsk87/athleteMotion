"""Esquemas Pydantic para estimativa de Torque Articular e Carga Patelofemoral."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class PatellofemoralSampleSchema(BaseModel):
    """Amostra de esforço num ponto angular específico."""

    crank_angle_deg: float = Field(..., ge=0.0, le=360.0)
    knee_flexion_deg: float = Field(..., ge=0.0, le=180.0)
    cadence_rpm: float = Field(..., ge=0.0)
    power_watts: float = Field(..., ge=0.0)
    pedal_force_tangential_n: float
    knee_extensor_moment_nm: float
    quadriceps_force_n: float
    patellofemoral_compressive_force_n: float
    patellofemoral_stress_mpa: float
    risk_level: Literal["low", "moderate", "high"]


class PatellofemoralRevolutionRequest(BaseModel):
    """Pedido para análise de um ciclo pedaleiro completo de esforço patelar."""

    rider_weight_kg: float = Field(default=75.0, gt=30.0, lt=200.0, description="Massa corporal do ciclista em kg")
    crank_length_mm: float = Field(default=172.5, gt=140.0, lt=200.0, description="Comprimento do crenque em mm")
    knee_extension_angles_100_points: list[float] = Field(
        ..., min_length=10, max_length=100, description="Série temporal de ângulos de extensão do joelho ao longo de 1 revolução"
    )
    cadence_rpm: float = Field(default=85.0, gt=20.0, lt=200.0, description="Cadência em rotações por minuto")
    power_watts: float = Field(default=220.0, gt=0.0, lt=2500.0, description="Potência mecânica média em Watts")


class PatellofemoralRevolutionResponse(BaseModel):
    """Sumário clínico da sobrecarga patelofemoral ao longo da rotação."""

    peak_compressive_force_n: float
    peak_stress_mpa: float
    peak_force_crank_angle_deg: float
    mean_downstroke_force_n: float
    risk_level: Literal["low", "moderate", "high"]
    saddle_height_correlation_note_pt: str
    saddle_height_correlation_note_en: str
    recommendation_pt: str
    recommendation_en: str
    samples: list[PatellofemoralSampleSchema]

