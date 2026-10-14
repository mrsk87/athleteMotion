"""Pipeline assíncrono em estágios desacoplados para inferência de alta performance.

Arquitetura em estágios (R14):
1. Estágio 1 (Decode & Preprocess): descodificação JPEG e pré-processamento rápido (C++ blob).
2. Estágio 2 (Inference Worker): passagem para a frente exclusiva no backend (DirectML / OpenVINO).
3. Estágio 3 (Postprocess & Biomechanics): decodificação de keypoints, estabilização e ângulos.

Comunicação entre estágios via buffers de tamanho 1 com política 'latest-frame-wins'
(double-buffering), garantindo ausência total de acumulação de latência em streaming.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

from athletemotion.domain.inference.base import BasePoseEngine
from athletemotion.domain.inference.types import InferenceOutput

logger = logging.getLogger("athlete_motion.pipeline")


@dataclass
class StageTimings:
    """Métricas de latência por estágio de processamento (em milissegundos)."""

    decode_ms: float = 0.0
    preprocess_ms: float = 0.0
    infer_ms: float = 0.0
    postprocess_ms: float = 0.0
    total_ms: float = 0.0

    def to_dict(self) -> dict[str, float]:
        return {
            "decode_ms": round(self.decode_ms, 2),
            "preprocess_ms": round(self.preprocess_ms, 2),
            "infer_ms": round(self.infer_ms, 2),
            "postprocess_ms": round(self.postprocess_ms, 2),
            "total_ms": round(self.total_ms, 2),
        }


@dataclass
class PipelineFrame:
    """Invólucro de dados transportado através dos estágios do pipeline."""

    raw_bytes: bytes
    timestamp_ms: int
    frame_bgr: NDArray[Any] | None = None
    input_tensor: NDArray[Any] | None = None
    preproc_meta: dict[str, Any] = field(default_factory=dict)
    raw_outputs: list[NDArray[Any]] = field(default_factory=list)
    output: InferenceOutput | None = None
    timings: StageTimings = field(default_factory=StageTimings)


class StagedInferencePipeline:
    """Pipeline em estágios com execução desacoplada e política latest-wins."""

    def __init__(self, engine: BasePoseEngine):
        self.engine = engine
        self._running = False

        # Slots atómicos para latest-wins entre estágios
        self._raw_slot: tuple[bytes, int] | None = None
        self._raw_event = asyncio.Event()

        self._preproc_slot: PipelineFrame | None = None
        self._preproc_event = asyncio.Event()

        self._infer_slot: PipelineFrame | None = None
        self._infer_event = asyncio.Event()

        self._output_queue: asyncio.Queue[tuple[InferenceOutput, StageTimings]] = asyncio.Queue(maxsize=1)
        self._tasks: list[asyncio.Task[Any]] = []

    def start(self) -> None:
        """Inicia os workers assíncronos dos 3 estágios."""
        if self._running:
            return
        self._running = True
        self._tasks = [
            asyncio.create_task(self._stage_decode_preprocess(), name="pipeline_stage1_preproc"),
            asyncio.create_task(self._stage_inference(), name="pipeline_stage2_infer"),
            asyncio.create_task(self._stage_postprocess(), name="pipeline_stage3_postproc"),
        ]
        logger.debug("StagedInferencePipeline iniciado com sucesso.")

    async def stop(self) -> None:
        """Encerra graciosamente todos os estágios do pipeline."""
        self._running = False
        self._raw_event.set()
        self._preproc_event.set()
        self._infer_event.set()

        for t in self._tasks:
            t.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        logger.debug("StagedInferencePipeline encerrado.")

    def push_frame(self, raw_bytes: bytes, timestamp_ms: int) -> None:
        """Ingere um novo fotograma JPEG. Substitui imediatamente qualquer frame anterior pendente."""
        self._raw_slot = (raw_bytes, timestamp_ms)
        self._raw_event.set()

    async def get_result(self, timeout: float = 0.5) -> tuple[InferenceOutput, StageTimings] | None:
        """Obtém o resultado mais recente concluído."""
        try:
            return await asyncio.wait_for(self._output_queue.get(), timeout=timeout)
        except TimeoutError:
            return None

    # ------------------------------------------------------------- Estágio 1: Decode
    async def _stage_decode_preprocess(self) -> None:
        loop = asyncio.get_running_loop()

        def _decode(b: bytes) -> NDArray[Any] | None:
            return cv2.imdecode(np.frombuffer(b, np.uint8), cv2.IMREAD_COLOR)

        while self._running:
            await self._raw_event.wait()
            self._raw_event.clear()

            slot = self._raw_slot
            if slot is None:
                continue

            raw_bytes, ts = slot

            # Descodificação off-thread
            t0 = time.perf_counter()
            frame_bgr = await loop.run_in_executor(None, _decode, raw_bytes)
            t_decode = (time.perf_counter() - t0) * 1000.0

            if frame_bgr is None:
                continue

            p_frame = PipelineFrame(raw_bytes=raw_bytes, timestamp_ms=ts, frame_bgr=frame_bgr)
            p_frame.timings.decode_ms = t_decode

            # Passa para o estágio seguinte (latest-wins)
            self._preproc_slot = p_frame
            self._preproc_event.set()

    # ------------------------------------------------------------- Estágio 2: Inferência
    async def _stage_inference(self) -> None:
        loop = asyncio.get_running_loop()
        while self._running:
            await self._preproc_event.wait()
            self._preproc_event.clear()

            p_frame = self._preproc_slot
            if p_frame is None or p_frame.frame_bgr is None:
                continue

            # A inferência corre no worker síncrono dedicado do motor
            t0 = time.perf_counter()
            output = await loop.run_in_executor(
                None, self.engine.process_frame, p_frame.frame_bgr, p_frame.timestamp_ms
            )
            p_frame.timings.infer_ms = (time.perf_counter() - t0) * 1000.0
            p_frame.output = output

            self._infer_slot = p_frame
            self._infer_event.set()

    # ------------------------------------------------------------- Estágio 3: Postprocess
    async def _stage_postprocess(self) -> None:
        while self._running:
            await self._infer_event.wait()
            self._infer_event.clear()

            p_frame = self._infer_slot
            if p_frame is None or p_frame.output is None:
                continue

            p_frame.timings.total_ms = (
                p_frame.timings.decode_ms + p_frame.timings.infer_ms + p_frame.timings.postprocess_ms
            )

            # Esvaziar fila se já contiver frame anterior (latest-wins)
            if self._output_queue.full():
                import contextlib

                with contextlib.suppress(asyncio.QueueEmpty):
                    self._output_queue.get_nowait()

            await self._output_queue.put((p_frame.output, p_frame.timings))
