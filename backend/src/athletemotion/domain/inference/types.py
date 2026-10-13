"""Definições de tipos e estruturas de dados de inferência postural."""
from __future__ import annotations

from typing import Dict, Optional
from pydantic import BaseModel, Field


class Landmark2D(BaseModel):
    x: float = Field(..., ge=0.0, le=1.0, description="Coordenada X normalizada [0, 1]")
    y: float = Field(..., ge=0.0, le=1.0, description="Coordenada Y normalizada [0, 1]")
    z: float = Field(default=0.0, description="Profundidade Z relativa")
    visibility: float = Field(default=1.0, ge=0.0, le=1.0, description="Grau de confiança/visibilidade")
    estimated: bool = Field(default=False, description="Indica se o marco foi estimado/inferido heuristicamente")


class SegmentValidation(BaseModel):
    femur_length: float = 0.0
    tibia_length: float = 0.0
    femur_valid: bool = True
    tibia_valid: bool = True
    segment_error_pct: float = 0.0


class BiomechanicalAngles(BaseModel):
    knee: Optional[float] = None
    torso: Optional[float] = None
    arm_elbow: Optional[float] = None
    shoulder: Optional[float] = None
    ankle: Optional[float] = None


class InferenceOutput(BaseModel):
    engine_name: str
    side: str  # "left" | "right"
    timestamp_ms: int
    landmarks: Dict[str, Landmark2D]
    angles: BiomechanicalAngles
    validation: SegmentValidation
    is_bdc: bool = False
    is_tdc: bool = False
    clock_position: str = "N/A"  # "12h", "3h", "6h", "9h"
