"""Protocolo e tipos base para motores de inferência de deep learning.

Define a interface unificada `InferenceBackend` respeitada por todos os runtimes
(ONNX Runtime DirectML, ONNX Runtime CPU, OpenVINO CPU).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from numpy.typing import NDArray


@dataclass
class BackendInfo:
    """Metadados do backend de inferência ativo."""

    name: str
    provider: str
    device: str
    device_id: int | None = None
    threads: int = 1
    precision: str = "FP32"
    details: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class InferenceBackend(Protocol):
    """Protocolo unificado para backends de inferência."""

    def load(
        self,
        model_path: str | Path,
        input_shape: tuple[int, ...] | None = None,
        device_opts: dict[str, Any] | None = None,
    ) -> None:
        """Carrega o modelo e inicializa a sessão no dispositivo."""
        ...

    def warmup(self, runs: int = 3) -> float:
        """Executa ciclos de aquecimento e devolve a latência do primeiro run em ms."""
        ...

    def infer(self, tensor: NDArray[Any]) -> list[NDArray[Any]]:
        """Executa a inferência e devolve a lista de tensores de saída."""
        ...

    def close(self) -> None:
        """Liberta explicitamente recursos e buffers da sessão."""
        ...

    def info(self) -> BackendInfo:
        """Devolve os metadados do backend e do dispositivo ativo."""
        ...
