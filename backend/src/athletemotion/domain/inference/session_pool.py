"""Gestão de concorrência e execução serializada de inferência por sessão.

DirectML e certas sessões de runtime ONNX não suportam execuções concorrentes
(Run() simultâneo) na mesma sessão de hardware sob risco de corrupção ou crash.
Este módulo fornece executores dedicados de worker único (1 thread) por instância
de motor, garantindo serialização estrita e latência previsível.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Any, Self, TypeVar

logger = logging.getLogger("athlete_motion.domain.session_pool")

T = TypeVar("T")


class InferenceExecutor:
    """Executor dedicado de inferência com exatamente um worker thread.

    Garante que qualquer chamada a `process_frame()` ou `warmup()` para uma
    determinada instância de motor é estritamente serializada, prevenindo
    concorrência indevida em sessões DirectML e MediaPipe.
    """

    def __init__(self, name: str = "engine") -> None:
        self.name = name
        self._executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix=f"infer_{name}",
        )
        self._is_closed = False

    async def run(self, func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        """Executa a função de inferência no worker thread dedicado da sessão."""
        if self._is_closed:
            raise RuntimeError(f"InferenceExecutor '{self.name}' já foi encerrado.")

        loop = asyncio.get_running_loop()
        call = partial(func, *args, **kwargs)
        return await loop.run_in_executor(self._executor, call)

    def close(self) -> None:
        """Encerra o executor e liberta recursos do threadpool."""
        if not self._is_closed:
            self._is_closed = True
            self._executor.shutdown(wait=False, cancel_futures=True)
            logger.debug("InferenceExecutor '%s' encerrado com sucesso.", self.name)

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: object,
    ) -> None:
        self.close()
