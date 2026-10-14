"""Registo central e fábrica de backends de inferência de deep learning."""

from __future__ import annotations

import logging
from typing import Any

from athletemotion.infrastructure.backends.base import InferenceBackend
from athletemotion.infrastructure.backends.openvino_cpu import OpenVinoCPUBackend
from athletemotion.infrastructure.backends.ort_cpu import OrtCPUBackend
from athletemotion.infrastructure.backends.ort_directml import OrtDirectMLBackend
from athletemotion.infrastructure.hardware import hardware_manager

logger = logging.getLogger("athlete_motion.backends.registry")

_BACKEND_MAP: dict[str, type[InferenceBackend]] = {
    "dml": OrtDirectMLBackend,
    "directml": OrtDirectMLBackend,
    "ort_cpu": OrtCPUBackend,
    "cpu": OrtCPUBackend,
    "openvino": OpenVinoCPUBackend,
    "openvino_cpu": OpenVinoCPUBackend,
}


class BackendRegistry:
    """Fábrica para instanciar backends de inferência."""

    @classmethod
    def register(cls, name: str, backend_cls: type[InferenceBackend]) -> None:
        """Regista uma nova classe de backend."""
        _BACKEND_MAP[name.lower()] = backend_cls

    @classmethod
    def create(cls, name: str, **kwargs: Any) -> InferenceBackend:
        """Cria e devolve uma instância do backend solicitado."""
        canonical = name.lower()
        if canonical not in _BACKEND_MAP:
            valid = list(_BACKEND_MAP.keys())
            raise ValueError(f"Backend desconhecido: '{name}'. Opções válidas: {valid}")
        return _BACKEND_MAP[canonical](**kwargs)

    @classmethod
    def list_available(cls) -> dict[str, bool]:
        """Informa quais os backends suportados e instalados no ambiente atual."""
        status = {
            "dml": hardware_manager.has_directml,
            "ort_cpu": True,
            "openvino": False,
        }
        try:
            import openvino  # noqa: F401

            status["openvino"] = True
        except ImportError:
            status["openvino"] = False
        return status

    @classmethod
    def get_preferred_backend(cls) -> str:
        """Determina o backend ótimo para a máquina atual."""
        avail = cls.list_available()
        if avail.get("dml"):
            return "dml"
        if avail.get("openvino"):
            return "openvino"
        return "ort_cpu"
