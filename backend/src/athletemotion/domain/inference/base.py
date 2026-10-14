"""Interface Strategy para motores de visão computacional."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar

import numpy as np

from .types import InferenceOutput


class ModelUnavailableError(RuntimeError):
    """Exceção levantada quando um motor não pode ser inicializado ou executado por falta ou corrupção do modelo."""

    def __init__(self, engine_name: str, reason: str, model_id: str | None = None) -> None:
        self.engine_name = engine_name
        self.reason = reason
        self.model_id = model_id
        super().__init__(f"Motor '{engine_name}' indisponível: {reason}")


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

    _engines: ClassVar[dict[str, type[BasePoseEngine]]] = {}
    _active_engine: ClassVar[BasePoseEngine | None] = None

    @classmethod
    def register(cls, name: str, engine_cls: type[BasePoseEngine]) -> None:
        cls._engines[name] = engine_cls

    @classmethod
    def get_registered_names(cls) -> list[str]:
        return list(cls._engines.keys())

    @classmethod
    def names(cls) -> list[str]:
        """Alias conciso para get_registered_names."""
        return cls.get_registered_names()

    @classmethod
    def create(cls, name: str, **kwargs) -> BasePoseEngine:
        if name not in cls._engines:
            raise ValueError(
                f"Motor '{name}' não registado. Opções disponíveis: {list(cls._engines.keys())}"
            )
        import inspect

        target = cls._engines[name]
        try:
            sig = inspect.signature(target)
            if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
                return target(**kwargs)
            filtered = {k: v for k, v in kwargs.items() if k in sig.parameters}
            return target(**filtered)
        except (ValueError, TypeError):
            return target(**kwargs)

    @classmethod
    def set_active(cls, engine: BasePoseEngine) -> None:
        """Legado: define o motor ativo global (desencorajado; use EngineManager)."""
        cls._active_engine = engine

    @classmethod
    def get_active(cls) -> BasePoseEngine:
        """Legado: obtém o motor ativo global (desencorajado; use EngineManager)."""
        if cls._active_engine is None:
            raise RuntimeError("Nenhum motor de inferência ativo no momento.")
        return cls._active_engine
