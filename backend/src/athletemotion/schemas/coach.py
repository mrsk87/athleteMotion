"""Schemas Pydantic para o parecer do Treinador Biomecânico determinístico."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class FindingStatus(StrEnum):
    """Estado de conformidade de uma medição articular."""

    OK = "ok"
    LOW = "low"
    HIGH = "high"
    INSUFFICIENT = "insufficient"


class DataQualityReport(BaseModel):
    """Indicador de qualidade e completude dos dados posturais recolhidos."""

    available_joints: list[str] = Field(
        default_factory=list, description="Lista de articulações com medições válidas"
    )
    missing_joints: list[str] = Field(
        default_factory=list, description="Lista de articulações em falta ou não detetadas"
    )
    is_complete: bool = Field(
        ..., description="Verdadeiro se todos os ângulos fundamentais estiverem disponíveis"
    )


class FindingSchema(BaseModel):
    """Registo de avaliação estruturada de uma articulação."""

    joint_id: str
    status: FindingStatus
    measured_angle: float | None = None
    ideal_min: float
    ideal_max: float
    delta: float = 0.0
    message: str


class CoachReport(BaseModel):
    """Contrato do parecer do Treinador Biomecânico.

    Preserva campos legados para retrocompatibilidade com o frontend e
    acrescenta metadados de rastreabilidade, qualidade e isenção de responsabilidade.
    """

    title: str
    executive_summary: str
    cockpit_analysis: str
    kops_insight: str
    cadence_power_insight: str
    adaptation_plan: list[str]

    # Campos novos para transparência e auditoria
    data_quality: DataQualityReport
    disclaimer: str
    generator: str = "rules-v1"
    findings: list[FindingSchema] = Field(default_factory=list)
