"""Esquemas Pydantic para a funcionalidade Bike CAD (Auto-Deteção de Geometria da Bicicleta)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from athletemotion.schemas.measures import MeasureWithConfidence


class PixelPointSchema(BaseModel):
    """Ponto bidimensional em coordenadas de pixel da imagem."""

    x: float = Field(..., description="Coordenada X em píxeis")
    y: float = Field(..., description="Coordenada Y em píxeis")


class BikeLandmarks2DSchema(BaseModel):
    """Pontos-chave estruturais da bicicleta anotados ou detetados em píxeis."""

    bottom_bracket: PixelPointSchema = Field(..., description="Centro do eixo pedaleiro (BB)")
    saddle_nose: PixelPointSchema = Field(..., description="Ponta anterior do selim")
    saddle_center: PixelPointSchema = Field(..., description="Ponto anatómico central do selim (topo)")
    handlebar_clamp: PixelPointSchema = Field(..., description="Centro do aperto do guiador no avanço")
    hood_peak: PixelPointSchema | None = Field(default=None, description="Ponto de apoio das mãos nas manetes")
    front_axle: PixelPointSchema | None = Field(default=None, description="Centro do eixo da roda dianteira")
    rear_axle: PixelPointSchema | None = Field(default=None, description="Centro do eixo da roda traseira")


class BikeCadRequest(BaseModel):
    """Pedido de cálculo das dimensões CAD da bicicleta com calibração métrica."""

    landmarks: BikeLandmarks2DSchema
    mm_per_pixel: float = Field(..., gt=0.0, description="Fator de calibração espacial (mm por píxel)")
    scale_uncertainty_ratio: float = Field(
        default=0.015, ge=0.0, le=0.1, description="Incerteza relativa da calibração métrica (ex.: 0.015 = ±1.5%)"
    )
    facing_direction: str = Field(default="right", description="Orientação da bicicleta: 'right' ou 'left'")


class BikeCadReportResponse(BaseModel):
    """Relatório métrico completo da geometria da bicicleta."""

    stack_bb_to_bar: MeasureWithConfidence
    reach_bb_to_bar: MeasureWithConfidence
    saddle_height_bb: MeasureWithConfidence
    saddle_setback_bb: MeasureWithConfidence
    saddle_to_bar_distance: MeasureWithConfidence
    saddle_to_bar_drop: MeasureWithConfidence
    saddle_to_hood_distance: MeasureWithConfidence | None = None
    wheelbase: MeasureWithConfidence | None = None
    effective_seat_tube_angle_deg: float
    confidence_score: float
    warnings: list[str] = Field(default_factory=list)
