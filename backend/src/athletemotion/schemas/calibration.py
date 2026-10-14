"""Schemas Pydantic estritos para calibração métrica, correção ótica e medição dimensional."""

from __future__ import annotations

import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CalibrationWarningSchema(BaseModel):
    """Aviso estruturado sobre qualidade ou alinhamento da calibração."""

    code: str
    severity: str
    message_pt: str
    message_en: str
    details: dict[str, Any] = Field(default_factory=dict)


class ScaleCalibrationResponse(BaseModel):
    """Resposta com a escala métrica estabelecida (mm por pixel) e respetiva incerteza."""

    mm_per_px: float = Field(..., gt=0.0, description="Fator de conversão de pixels para milímetros")
    method: str = Field(..., description="Método utilizado: aruco, crank, wheel, manual")
    uncertainty_mm_per_px: float = Field(..., ge=0.0, description="Incerteza expandida de escala em mm/px")
    plane_roll_deg: float = Field(default=0.0, description="Inclinação da câmara em graus em relação ao solo")
    plane_yaw_deg: float = Field(default=0.0, description="Desvio perpendicular em relação ao plano sagital")
    is_perpendicular: bool = Field(..., description="True se |roll| <= 3° e |yaw| <= 8°")
    source_frame_hash: str | None = Field(default=None, description="Hash criptográfico do frame de calibração")
    warnings: list[CalibrationWarningSchema] = Field(default_factory=list)


class LensProfileResponse(BaseModel):
    """Perfil de calibração ótica e distorção intrínseca de uma câmara."""

    id: str | None = None
    camera_id: str
    width: int
    height: int
    camera_matrix: list[list[float]]
    dist_coeffs: list[float]
    rms_error_px: float
    created_at: datetime.datetime

    model_config = ConfigDict(from_attributes=True)


class KopsMeasurementResponse(BaseModel):
    """Resultado da avaliação de alinhamento KOPS patela-eixo do pedal em milímetros reais."""

    offset_px: float
    offset_mm: float | None = None
    uncertainty_mm: float | None = None
    status: str
    is_aligned: bool
    warnings: list[CalibrationWarningSchema] = Field(default_factory=list)
