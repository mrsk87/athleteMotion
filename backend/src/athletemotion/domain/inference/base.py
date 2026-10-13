"""Interface Strategy para motores de visão computacional."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Dict, Optional, Type
import numpy as np

from .types import InferenceOutput


class BasePoseEngine(ABC):
    """Contrato abstrato que todos os motores de pose devem cumprir."""

    def __init__(self, name: str):
        self.name = name

    @abstractmethod
    def set_side(self, side: str) -> None:
        """Define o perfil observado ('left' ou 'right')."""
        pass

    @abstractmethod
    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        """Processa um frame de vídeo em formato BGR e retorna a telemetria padronizada."""
        pass

    @abstractmethod
    def reset(self) -> None:
        """Limpa estados internos (filtros temporais, histórico de segmentos)."""
        pass


class PoseEngineRegistry:
    """Registo e fábrica central de motores disponíveis."""

    _engines: Dict[str, Type[BasePoseEngine]] = {}
    _active_engine: Optional[BasePoseEngine] = None

    @classmethod
    def register(cls, name: str, engine_cls: Type[BasePoseEngine]) -> None:
        cls._engines[name] = engine_cls

    @classmethod
    def get_registered_names(cls) -> list[str]:
        return list(cls._engines.keys())

    @classmethod
    def create(cls, name: str, **kwargs) -> BasePoseEngine:
        if name not in cls._engines:
            raise ValueError(f"Motor '{name}' não registado. Opções disponíveis: {list(cls._engines.keys())}")
        return cls._engines[name](**kwargs)

    @classmethod
    def set_active(cls, engine: BasePoseEngine) -> None:
        cls._active_engine = engine

    @classmethod
    def get_active(cls) -> BasePoseEngine:
        if cls._active_engine is None:
            raise RuntimeError("Nenhum motor de inferência ativo no momento.")
        return cls._active_engine
