"""Schemas Pydantic v2 estritos para validação de entrada e saída da API.

Garante tipagem rigorosa, documentação OpenAPI clara e legibilidade para juniores.
"""

from __future__ import annotations

import datetime
import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from athletemotion.schemas.limits import MAX_RAW_LANDMARKS_BYTES


class AthleteCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, description="Nome do ciclista")
    email: str | None = Field(default=None, description="Email de contato opcional")
    height_cm: float = Field(
        ..., ge=100.0, le=240.0, description="Altura total do ciclista em centímetros"
    )
    inseam_cm: float = Field(
        ..., ge=40.0, le=120.0, description="Altura do cavalo / entre-perna em centímetros"
    )
    shoulder_width_cm: float | None = Field(
        default=None, ge=20.0, le=70.0, description="Largura dos ombros (biacromial)"
    )
    torso_length_cm: float | None = Field(
        default=None, ge=30.0, le=100.0, description="Comprimento do tronco em cm"
    )
    arm_length_cm: float | None = Field(
        default=None, ge=30.0, le=120.0, description="Comprimento do braço em cm"
    )
    flexibility: str = Field(
        default="medium", description="Nível de flexibilidade: low, medium, high"
    )
    riding_style: str = Field(default="road", description="Modalidade: road, mtb, tt, gravel")
    consent_version: str = Field(
        ..., min_length=1, max_length=20, description="Versão do termo de consentimento (ex: 'v1.0')"
    )
    consent_scope: list[str] = Field(
        ..., description="Lista de permissões consentidas (ex: ['processing', 'store_landmarks'])"
    )

    @field_validator("consent_scope")
    @classmethod
    def validate_consent_scope(cls, v: list[str]) -> list[str]:
        if not v or "processing" not in v:
            raise ValueError(
                "O consentimento explícito para processamento de dados biométricos ('processing') "
                "é obrigatório ao abrigo do RGPD (Art. 6 e Art. 9)."
            )
        valid_scopes = {"processing", "store_landmarks", "retention_extended"}
        for scope in v:
            if scope not in valid_scopes:
                raise ValueError(f"Âmbito de consentimento não reconhecido: '{scope}'")
        return v


class ConsentUpdate(BaseModel):
    consent_version: str = Field(
        ..., min_length=1, max_length=20, description="Versão do termo de consentimento (ex: 'v1.0')"
    )
    consent_scope: list[str] = Field(
        ..., description="Lista de permissões consentidas (ex: ['processing', 'store_landmarks'])"
    )

    @field_validator("consent_scope")
    @classmethod
    def validate_consent_scope(cls, v: list[str]) -> list[str]:
        if not v or "processing" not in v:
            raise ValueError(
                "O consentimento explícito para processamento de dados biométricos ('processing') "
                "é obrigatório ao abrigo do RGPD (Art. 6 e Art. 9)."
            )
        valid_scopes = {"processing", "store_landmarks", "retention_extended"}
        for scope in v:
            if scope not in valid_scopes:
                raise ValueError(f"Âmbito de consentimento não reconhecido: '{scope}'")
        return v


class AthleteResponse(BaseModel):
    id: str
    name: str
    email: str | None
    height_cm: float
    inseam_cm: float
    shoulder_width_cm: float | None
    torso_length_cm: float | None
    arm_length_cm: float | None
    flexibility: str
    riding_style: str
    consent_at: datetime.datetime | None = None
    consent_version: str | None = None
    consent_scope: list[str] = Field(default_factory=list)
    created_at: datetime.datetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator("consent_scope", mode="before")
    @classmethod
    def parse_consent_scope(cls, v: Any) -> list[str]:
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return [str(item) for item in parsed]
            except Exception:
                return []
        if isinstance(v, list):
            return [str(item) for item in v]
        return []


class BikeCreate(BaseModel):
    athlete_id: str = Field(..., description="ID do atleta associado")
    bike_type: str = Field(default="road", description="Tipo de bicicleta: road, mtb, tt, gravel")
    brand_model: str = Field(default="Bicicleta", description="Marca e modelo da bicicleta")
    frame_size_cm: float | None = Field(
        default=None,
        description="Tamanho do quadro = tubo do selim (cm), do centro do eixo pedaleiro ao topo (C-T)",
    )
    top_tube_mm: float | None = Field(
        default=None,
        description="Tubo superior efetivo / ETT (mm), medido na horizontal entre o eixo do tubo do selim e o eixo do tubo de direção",
    )
    handlebar_width_mm: float | None = Field(
        default=None, description="Largura do guiador em milímetros"
    )
    handlebar_reach_mm: float | None = Field(
        default=None, description="Reach (profundidade) da curva do guiador em mm"
    )
    handlebar_drop_mm: float | None = Field(
        default=None, description="Drop (descida) da curva do guiador em mm"
    )
    stem_length_mm: float | None = Field(
        default=None, description="Comprimento do avanço em milímetros"
    )
    crank_length_mm: float | None = Field(
        default=None, description="Comprimento do crenque/pedivela em mm"
    )
    current_saddle_height_cm: float | None = Field(
        default=None, description="Altura atual do selim em cm"
    )
    cleat_position: str | None = Field(
        default=None,
        description="Posição atual dos travessões/cleats na sapatilha (ex: rearward / recuado, neutral / neutro, forward / avançado)",
    )


class BikeResponse(BaseModel):
    id: str
    athlete_id: str
    bike_type: str
    brand_model: str
    frame_size_cm: float | None
    top_tube_mm: float | None = None
    handlebar_width_mm: float | None
    handlebar_reach_mm: float | None = None
    handlebar_drop_mm: float | None = None
    stem_length_mm: float | None
    crank_length_mm: float | None
    current_saddle_height_cm: float | None
    cleat_position: str | None = None
    created_at: datetime.datetime

    model_config = ConfigDict(from_attributes=True)


class TheoreticalFitEstimate(BaseModel):
    lemond_saddle_height_cm: float = Field(
        ..., description="Altura de selim teórica pelo método LeMond (Cavalo * 0.883)"
    )
    hamley_109_saddle_height_cm: float = Field(
        ..., description="Altura de selim pelo método 109% (Pedal inferior ao selim)"
    )
    estimated_frame_size_cm: float = Field(..., description="Tamanho estimado do quadro em cm")
    recommended_crank_length_mm: float = Field(
        ..., description="Comprimento de biela/crenque recomendado"
    )
    recommended_handlebar_width_mm: float = Field(..., description="Largura de guiador recomendada")
    target_knee_angle_range: tuple[float, float] = Field(
        ..., description="Faixa ergonómica alvo do joelho (graus)"
    )
    target_back_angle_range: tuple[float, float] = Field(
        ..., description="Faixa ergonómica alvo das costas (graus)"
    )


class FitSessionCreate(BaseModel):
    athlete_id: str
    bike_id: str
    store_landmarks: bool = Field(
        default=False,
        description="Autorização explícita para guardar dados biométricos brutos (keypoints)",
    )


class FitSessionResponse(BaseModel):
    id: str
    athlete_id: str
    bike_id: str
    status: str
    store_landmarks: bool = False
    theoretical_saddle_height_cm: float | None
    target_knee_min: float
    target_knee_max: float
    target_back_min: float
    target_back_max: float
    measured_avg_knee_angle: float | None
    measured_avg_back_angle: float | None
    measured_avg_arm_angle: float | None
    measured_avg_ankle_angle: float | None
    started_at: datetime.datetime
    completed_at: datetime.datetime | None

    model_config = ConfigDict(from_attributes=True)


class SnapshotCreate(BaseModel):
    frame_index: int = Field(default=0, ge=0, description="Índice sequencial do fotograma >= 0")
    knee_angle: float | None = Field(default=None, ge=0.0, le=360.0)
    back_angle: float | None = Field(default=None, ge=0.0, le=360.0)
    arm_angle: float | None = Field(default=None, ge=0.0, le=360.0)
    ankle_angle: float | None = Field(default=None, ge=0.0, le=360.0)
    raw_landmarks: list[dict[str, Any]] | None = Field(
        default=None, max_length=100, description="Keypoints brutos limitados a 100 pontos"
    )

    @field_validator("raw_landmarks")
    @classmethod
    def validate_raw_landmarks_size(
        cls, v: list[dict[str, Any]] | None
    ) -> list[dict[str, Any]] | None:
        if v is not None:
            serialized = json.dumps(v)
            if len(serialized.encode("utf-8")) > MAX_RAW_LANDMARKS_BYTES:
                raise ValueError(
                    f"Tamanho serializado de raw_landmarks excede o limite máximo permitido de {MAX_RAW_LANDMARKS_BYTES} bytes."
                )
        return v


class SnapshotResponse(BaseModel):
    id: str
    session_id: str
    frame_index: int
    knee_angle: float | None
    back_angle: float | None
    arm_angle: float | None
    ankle_angle: float | None
    is_compliant: bool
    timestamp: datetime.datetime

    model_config = ConfigDict(from_attributes=True)


class DiagnosticItem(BaseModel):
    joint_name: str
    measured_angle: float
    ideal_min: float
    ideal_max: float
    is_compliant: bool
    status_label_pt: str
    status_label_en: str
    recommendation_pt: str
    recommendation_en: str
    adjustment_delta: float | None = None
    adjustment_unit: str = "cm"
    joint_id: str | None = None
    withheld: bool = False
    confidence: float = 1.0
    withhold_reason: str | None = None


class FitReportResponse(BaseModel):
    session_id: str
    athlete_name: str
    bike_model: str
    riding_style: str
    status: str
    theoretical_saddle_height_cm: float | None
    current_saddle_height_cm: float | None
    measured_avg_knee_angle: float | None
    measured_avg_back_angle: float | None
    measured_avg_arm_angle: float | None
    measured_avg_ankle_angle: float | None
    diagnostics: list[DiagnosticItem]
    overall_compliance_percentage: float
    completed_at: datetime.datetime | None


class EstimateRequest(BaseModel):
    height_cm: float = Field(..., ge=100.0, le=240.0, description="Altura total em cm")
    inseam_cm: float = Field(..., ge=40.0, le=120.0, description="Altura do cavalo em cm")
    shoulder_width_cm: float | None = Field(
        default=None, ge=20.0, le=70.0, description="Largura dos ombros"
    )
    riding_style: str = Field(default="road", description="Modalidade: road, mtb, tt, gravel")


class FrameValidationResponse(BaseModel):
    status: str
    frame_width: int
    frame_height: int
    channels: int
    message: str
