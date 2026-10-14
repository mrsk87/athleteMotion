"""Esquemas de dados para a API de inferência biomecânica."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class EngineInfo(BaseModel):
    name: str
    display_name: str
    description: str
    is_accelerated: bool
    hardware_provider: str
    available: bool = True
    reason: str | None = None
    model_id: str | None = None
    model_verified: bool = False
    license: str = "Unknown"
    provider_actual: str = "CPU"
    warmup_ms: float = 0.0
    notes: str = ""


class EngineListResponse(BaseModel):
    active_engine: str
    active_side: str
    available_engines: list[EngineInfo]
    directml_available: bool
    hardware_profile: dict[str, Any] | None = None


class SwitchEngineRequest(BaseModel):
    engine: str = Field(
        ..., description="Nome do motor: 'mediapipe', 'yolo11_pose', 'rtmpose', 'opencv_markers'"
    )
    side: str = Field("right", description="Lado observado: 'left' ou 'right'")
    smoothing: str = Field("one_euro", description="Modo de suavização: 'one_euro', 'none'")
