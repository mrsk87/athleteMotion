"""Backend de inferência OpenVINO para CPU (Intel Xeon AVX2).

Implementa `InferenceBackend` utilizando a biblioteca nativa OpenVINO:
- `PERFORMANCE_HINT = LATENCY` para menor atraso por fotograma.
- `INFERENCE_NUM_THREADS` parametrizado pelos núcleos físicos.
- Compilação com cache em disco (`CACHE_DIR`) para arranques subsequentes instantâneos.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from athletemotion.config.paths import APP_DATA_DIR
from athletemotion.infrastructure.backends.base import BackendInfo, InferenceBackend
from athletemotion.infrastructure.hardware import hardware_manager

logger = logging.getLogger("athlete_motion.backends.openvino_cpu")


class OpenVinoCPUBackend(InferenceBackend):
    """Backend OpenVINO otimizado para inferência de baixa latência em CPU."""

    def __init__(
        self,
        threads: int | None = None,
        cache_dir: str | Path | None = None,
    ):
        self.threads = threads or hardware_manager.physical_cores
        default_cache = APP_DATA_DIR / "openvino_cache"
        self.cache_dir = Path(cache_dir or default_cache)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        self.core: Any = None
        self.compiled_model: Any = None
        self.infer_request: Any = None
        self.input_name: str = ""
        self.input_shape: list[int] = []
        self.output_names: list[str] = []
        self._model_path: str = ""

    def load(
        self,
        model_path: str | Path,
        input_shape: tuple[int, ...] | None = None,
        device_opts: dict[str, Any] | None = None,
    ) -> None:
        try:
            import openvino as ov
        except ImportError as err:
            raise RuntimeError(
                "OpenVINO não está instalado. Instale com 'pip install \".[openvino]\"'"
            ) from err

        opts = device_opts or {}
        num_threads = int(opts.get("threads", self.threads))

        p = Path(model_path)
        if not p.exists():
            raise FileNotFoundError(f"Modelo não encontrado: {model_path}")

        self._model_path = str(p)
        self.core = ov.Core()

        # Configurações de latência em CPU
        self.core.set_property(
            "CPU",
            {
                "PERFORMANCE_HINT": "LATENCY",
                "INFERENCE_NUM_THREADS": str(num_threads),
                "CACHE_DIR": str(self.cache_dir),
            },
        )

        model = self.core.read_model(str(p))

        # Tratar formas dinâmicas (ex.: rtmpose batch variável)
        model_input = model.inputs[0]
        partial_shape = model_input.get_partial_shape()
        resolved_shape = []
        for dim in partial_shape:
            if dim.is_dynamic:
                resolved_shape.append(1)
            else:
                resolved_shape.append(dim.get_length())
        if input_shape:
            resolved_shape = list(input_shape)

        if partial_shape.is_dynamic or input_shape:
            model.reshape({0: resolved_shape})

        self.compiled_model = self.core.compile_model(model, "CPU")
        self.infer_request = self.compiled_model.create_infer_request()

        # Obter metadados de entrada e saída
        self.input_name = model_input.get_any_name() if model_input.names else "input"
        self.input_shape = resolved_shape

        self.output_names = [
            out.get_any_name() if out.names else f"output_{i}"
            for i, out in enumerate(self.compiled_model.outputs)
        ]

        logger.info(
            "OpenVinoCPUBackend carregado: %s (threads=%d, cache=%s, input=%s, shape=%s)",
            p.name,
            num_threads,
            self.cache_dir,
            self.input_name,
            self.input_shape,
        )

    def warmup(self, runs: int = 3) -> float:
        if self.infer_request is None:
            raise RuntimeError("Backend não carregado. Chame load() primeiro.")

        dummy = np.zeros(self.input_shape, dtype=np.float32)
        first_lat_ms = 0.0

        for i in range(max(1, runs)):
            t0 = time.perf_counter()
            self.infer(dummy)
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            if i == 0:
                first_lat_ms = elapsed_ms

        return first_lat_ms

    def infer(self, tensor: NDArray[Any]) -> list[NDArray[Any]]:
        if self.infer_request is None or self.compiled_model is None:
            raise RuntimeError("Backend não carregado. Chame load() primeiro.")

        if tensor.dtype != np.float32:
            tensor = tensor.astype(np.float32)
        if not tensor.flags["C_CONTIGUOUS"]:
            tensor = np.ascontiguousarray(tensor)

        res = self.infer_request.infer({0: tensor})
        # Extrair saídas ordenadas na forma de ndarrays
        outputs = [np.asarray(res[out]) for out in self.compiled_model.outputs]
        return outputs

    def close(self) -> None:
        self.infer_request = None
        self.compiled_model = None
        self.core = None

    def info(self) -> BackendInfo:
        return BackendInfo(
            name="openvino",
            provider="OpenVINO CPU Plugin",
            device="CPU (OpenVINO LATENCY)",
            device_id=None,
            threads=self.threads,
            precision="FP32",
            details={
                "model_path": self._model_path,
                "input_name": self.input_name,
                "input_shape": self.input_shape,
                "output_names": self.output_names,
                "cache_dir": str(self.cache_dir),
            },
        )
