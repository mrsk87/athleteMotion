"""Protocolo base e contratos para os motores de inferência."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np
import numpy.typing as npt


@runtime_checkable
class InferenceBackend(Protocol):
    """Protocolo que todo o backend de inferência (DirectML, OpenVINO, CPU) deve implementar."""

    @property
    def name(self) -> str:
        """Nome identificativo do backend (ex.: 'onnxruntime-directml')."""
        ...

    @property
    def is_available(self) -> bool:
        """Verifica se as bibliotecas e o dispositivo físico estão prontos para execução."""
        ...

    def load_model(self, model_path: str) -> None:
        """Carrega e aquece o modelo especificado na memória.

        Args:
            model_path: Caminho para o ficheiro de modelo ONNX ou IR OpenVINO.
        """
        ...

    def infer(self, tensor: npt.NDArray[np.float32]) -> list[npt.NDArray[np.float32]]:
        """Executa a passagem de inferência para um tensor pré-processado.

        Args:
            tensor: Matriz NumPy com formato (B, C, H, W) normalizado.

        Returns:
            Lista de arrays NumPy contendo os outputs do modelo.
        """
        ...

    def release(self) -> None:
        """Liberta explicitamente as sessões e a memória alocada na GPU/CPU."""
        ...
