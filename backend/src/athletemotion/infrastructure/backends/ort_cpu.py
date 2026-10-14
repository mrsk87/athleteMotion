"""Backend de inferência ONNX Runtime em CPU (Intel Xeon AVX2).

Configuração afinada para CPU:
- `intra_op_num_threads` fixado aos núcleos físicos para evitar contenda por hiper-threading.
- `inter_op_num_threads = 1` para latência previsível.
- `allow_spinning = 0` para eliminar flutuações de p95.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
from numpy.typing import NDArray

from athletemotion.infrastructure.backends.base import BackendInfo, InferenceBackend
from athletemotion.infrastructure.hardware import hardware_manager

logger = logging.getLogger("athlete_motion.backends.ort_cpu")


class OrtCPUBackend(InferenceBackend):
    """Backend ONNX Runtime otimizado para execução em CPU com instruções AVX2."""

    def __init__(
        self,
        threads: int | None = None,
        allow_spinning: bool = False,
    ):
        self.threads = threads or hardware_manager.physical_cores
        self.allow_spinning = allow_spinning

        self.session: ort.InferenceSession | None = None
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
        opts = device_opts or {}
        num_threads = int(opts.get("threads", self.threads))
        spinning = bool(opts.get("allow_spinning", self.allow_spinning))

        session_opts = ort.SessionOptions()
        session_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        session_opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        session_opts.intra_op_num_threads = num_threads
        session_opts.inter_op_num_threads = 1
        session_opts.enable_profiling = False

        spin_val = "1" if spinning else "0"
        import contextlib

        with contextlib.suppress(Exception):
            session_opts.add_session_config_entry("session.intra_op.allow_spinning", spin_val)
            session_opts.add_session_config_entry("session.inter_op.allow_spinning", spin_val)

        p = Path(model_path)
        if not p.exists():
            raise FileNotFoundError(f"Modelo não encontrado: {model_path}")

        self._model_path = str(p)
        self.session = ort.InferenceSession(
            str(p),
            sess_options=session_opts,
            providers=["CPUExecutionProvider"],
        )

        inputs = self.session.get_inputs()
        if not inputs:
            raise ValueError(f"Modelo {model_path} não possui nós de entrada.")
        self.input_name = inputs[0].name
        raw_shape = inputs[0].shape
        self.input_shape = [
            dim if isinstance(dim, int) and dim > 0 else 1 for dim in raw_shape
        ]
        if input_shape:
            self.input_shape = list(input_shape)

        self.output_names = [out.name for out in self.session.get_outputs()]
        logger.info(
            "OrtCPUBackend carregado: %s (threads=%d, spinning=%s, input=%s, shape=%s)",
            p.name,
            num_threads,
            spinning,
            self.input_name,
            self.input_shape,
        )

    def warmup(self, runs: int = 3) -> float:
        if not self.session:
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
        if not self.session:
            raise RuntimeError("Backend não carregado. Chame load() primeiro.")

        if tensor.dtype != np.float32:
            tensor = tensor.astype(np.float32)
        if not tensor.flags["C_CONTIGUOUS"]:
            tensor = np.ascontiguousarray(tensor)

        raw_outs = self.session.run(self.output_names, {self.input_name: tensor})
        return [np.asarray(out) for out in raw_outs]

    def close(self) -> None:
        self.session = None

    def info(self) -> BackendInfo:
        return BackendInfo(
            name="ort_cpu",
            provider="CPUExecutionProvider",
            device="CPU (Intel AVX2)",
            device_id=None,
            threads=self.threads,
            precision="FP32",
            details={
                "model_path": self._model_path,
                "input_name": self.input_name,
                "input_shape": self.input_shape,
                "output_names": self.output_names,
                "allow_spinning": self.allow_spinning,
            },
        )
