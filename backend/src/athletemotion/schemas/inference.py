"""Esquemas de dados para a API de inferência biomecânica."""
from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field


class EngineInfo(BaseModel):
    name: str
    display_name: str
    description: str
    is_accelerated: bool
    hardware_provider: str
    # `available=False`: o motor arranca mas corre o fallback (falta o ficheiro de pesos).
    available: bool = True
    notes: str = ""


class EngineListResponse(BaseModel):
    active_engine: str
    active_side: str
    available_engines: List[EngineInfo]
    directml_available: bool


class SwitchEngineRequest(BaseModel):
    engine: str = Field(..., description="Nome do motor: 'mediapipe', 'yolo11_pose', 'rtmpose', 'opencv_markers'")
    side: str = Field("right", description="Lado observado: 'left' ou 'right'")
    smoothing: str = Field("one_euro", description="Modo de suavização: 'one_euro', 'none'")
