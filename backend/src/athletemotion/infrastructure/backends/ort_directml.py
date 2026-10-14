"""Backend de inferência ONNX Runtime com aceleração DirectML para GPUs Windows (AMD/Intel/NVIDIA).

Implementa `InferenceBackend` respeitando rigorosamente as diretrizes de hardware:
- `enable_mem_pattern = False` (requisito DirectML).
- `execution_mode = ORT_SEQUENTIAL`.
- Descarte de aquecimento inicial (warmup).
- Suporte opcional a IOBinding para reutilização de tensores.
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

logger = logging.getLogger("athlete_motion.backends.directml")


class OrtDirectMLBackend(InferenceBackend):
    """Backend ONNX Runtime acelerado por DirectML."""

    def __init__(
        self,
        device_id: int = 0,
        disable_metacommands: bool = False,
        use_io_binding: bool = False,
    ):
        self.device_id = device_id
        self.disable_metacommands = disable_metacommands
        self.use_io_binding = use_io_binding

        self.session: ort.InferenceSession | None = None
        self.input_name: str = ""
        self.input_shape: list[int] = []
        self.output_names: list[str] = []
        self._io_binding: ort.IOBinding | None = None
        self._input_ortvalue: ort.OrtValue | None = None
        self._active_provider: str = "Unknown"
        self._model_path: str = ""

    def load(
        self,
        model_path: str | Path,
        input_shape: tuple[int, ...] | None = None,
        device_opts: dict[str, Any] | None = None,
    ) -> None:
        opts = device_opts or {}
        device_id = int(opts.get("device_id", self.device_id))
        disable_meta = bool(opts.get("disable_metacommands", self.disable_metacommands))

        session_opts = hardware_manager.create_session_options(gpu=True)
        providers = hardware_manager.get_execution_providers(
            gpu=True,
            device_id=device_id,
            disable_metacommands=disable_meta,
        )

        p = Path(model_path)
        if not p.exists():
            raise FileNotFoundError(f"Modelo não encontrado: {model_path}")

        self._model_path = str(p)
        self.session = ort.InferenceSession(
            str(p),
            sess_options=session_opts,
            providers=providers,
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
        self._active_provider = (
            self.session.get_providers()[0]
            if self.session.get_providers()
            else "Unknown"
        )
        logger.info(
            "OrtDirectMLBackend carregado: %s (provider=%s, input=%s, shape=%s)",
            p.name,
            self._active_provider,
            self.input_name,
            self.input_shape,
        )

        if self.use_io_binding and self._active_provider == "DmlExecutionProvider":
            self._setup_io_binding()

    def _setup_io_binding(self) -> None:
        """Configura pré-alocação IOBinding para evitar overhead em runtime."""
        if not self.session:
            return
        try:
            self._io_binding = self.session.io_binding()
            dummy = np.zeros(self.input_shape, dtype=np.float32)
            self._input_ortvalue = ort.OrtValue.ortvalue_from_numpy(
                dummy, "dml", self.device_id
            )
            self._io_binding.bind_ortvalue_input(self.input_name, self._input_ortvalue)
            for out_name in self.output_names:
                self._io_binding.bind_output(out_name, "dml", self.device_id)
            logger.debug("IOBinding DirectML inicializado com sucesso.")
        except Exception as exc:
            logger.warning("Falha ao configurar IOBinding no DirectML: %s", exc)
            self._io_binding = None
            self._input_ortvalue = None

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

        logger.debug(
            "Warmup concluído para %s (%d runs, 1º run=%.2f ms)",
            self._model_path,
            runs,
            first_lat_ms,
        )
        return first_lat_ms

    def infer(self, tensor: NDArray[Any]) -> list[NDArray[Any]]:
        if not self.session:
            raise RuntimeError("Backend não carregado. Chame load() primeiro.")

        # Garantir tipo float32 e contiguidade
        if tensor.dtype != np.float32:
            tensor = tensor.astype(np.float32)
        if not tensor.flags["C_CONTIGUOUS"]:
            tensor = np.ascontiguousarray(tensor)

        if self._io_binding is not None:
            try:
                # Atualizar ortvalue input
                ort_val = ort.OrtValue.ortvalue_from_numpy(
                    tensor, "dml", self.device_id
                )
                self._io_binding.bind_ortvalue_input(self.input_name, ort_val)
                self.session.run_with_iobinding(self._io_binding)
                outputs = self._io_binding.copy_outputs_to_cpu()
                return [np.asarray(out) for out in outputs]
            except Exception as exc:
                logger.warning("Falha em run_with_iobinding: %s. Fallback para run normal.", exc)
                self._io_binding = None

        raw_outs = self.session.run(self.output_names, {self.input_name: tensor})
        return [np.asarray(out) for out in raw_outs]

    def close(self) -> None:
        self._io_binding = None
        self._input_ortvalue = None
        self.session = None

    def info(self) -> BackendInfo:
        return BackendInfo(
            name="directml",
            provider=self._active_provider,
            device="GPU (DirectML)",
            device_id=self.device_id,
            threads=hardware_manager.physical_cores,
            precision="FP32",
            details={
                "model_path": self._model_path,
                "input_name": self.input_name,
                "input_shape": self.input_shape,
                "output_names": self.output_names,
                "use_io_binding": self.use_io_binding,
            },
        )
