"""Serviço de gestão do ciclo de vida e alocação de motores de inferência.

Implementa o padrão Lease (concessão temporária por ligação/sessão), garantindo:
1. Isolamento completo de estado entre clientes (MediaPipe timestamps, rastreio, histórico).
2. Limite configurável de motores em execução simultânea (proteção de VRAM e DirectML).
3. Whitelist estrita de motores registados.
4. Serialização de chamadas através de executores dedicados por motor.
"""

from __future__ import annotations

import asyncio
import logging
import time

import numpy as np

from athletemotion.domain.inference.base import BasePoseEngine, PoseEngineRegistry
from athletemotion.domain.inference.session_pool import InferenceExecutor
from athletemotion.domain.inference.types import InferenceOutput

logger = logging.getLogger("athlete_motion.services.engine_manager")


class EngineLease:
    """Concessão de motor exclusiva para uma ligação ou sessão de vídeo."""

    def __init__(
        self,
        lease_id: str,
        engine_name: str,
        side: str,
        engine: BasePoseEngine,
        executor: InferenceExecutor,
    ) -> None:
        self.lease_id = lease_id
        self.engine_name = engine_name
        self.side = side
        self.engine = engine
        self.executor = executor
        self._is_closed = False

    def set_side(self, side: str) -> None:
        """Atualiza a orientação lateral do atleta no motor subjacente."""
        self.side = side
        self.engine.set_side(side)

    def reset(self) -> None:
        """Reinicia o estado interno do motor associado."""
        self.engine.reset()

    async def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        """Executa a inferência de forma serializada no worker dedicado."""
        if self._is_closed:
            raise RuntimeError(f"EngineLease '{self.lease_id}' já foi encerrada.")
        return await self.executor.run(self.engine.process_frame, frame_bgr, timestamp_ms)

    async def warmup(self) -> float:
        """Executa aquecimento do motor (primeiro fotograma vazio) de forma serializada."""
        if self._is_closed:
            raise RuntimeError(f"EngineLease '{self.lease_id}' já foi encerrada.")

        frame = np.zeros((540, 960, 3), dtype=np.uint8)

        def _do_warmup() -> float:
            start = time.perf_counter()
            self.engine.process_frame(frame, 0)
            return round((time.perf_counter() - start) * 1000.0, 1)

        try:
            return await self.executor.run(_do_warmup)
        except (RuntimeError, ValueError, OSError) as err:
            logger.debug("Aquecimento falhou para lease %s: %s", self.lease_id, err)
            return 0.0

    def close(self) -> None:
        """Encerra a concessão e liberta os recursos do executor e do motor."""
        if not self._is_closed:
            self._is_closed = True
            self.executor.close()
            if hasattr(self.engine, "close") and callable(self.engine.close):
                try:
                    self.engine.close()
                except (RuntimeError, OSError) as err:
                    logger.warning("Erro ao fechar motor %s: %s", self.engine_name, err)
            logger.info("EngineLease '%s' (%s) libertada.", self.lease_id, self.engine_name)


class EngineLimitExceededError(RuntimeError):
    """Lançado quando o número máximo de concessões ativas é ultrapassado."""


class EngineManager:
    """Gestor de concessões de motores para ligações WebSocket e sessões."""

    def __init__(self, max_active_engines: int = 2) -> None:
        self.max_active_engines = max_active_engines
        self._leases: dict[str, EngineLease] = {}
        self._lock = asyncio.Lock()

    @property
    def active_count(self) -> int:
        """Retorna o número de concessões ativas no momento."""
        return len(self._leases)

    async def acquire(
        self,
        lease_id: str,
        engine_name: str,
        side: str = "right",
    ) -> EngineLease:
        """Adquire uma nova concessão exclusiva para uma ligação/sessão.

        Raises:
            ValueError: Se o motor solicitado não estiver na whitelist registada.
            EngineLimitExceededError: Se o limite máximo de motores simultâneos for atingido.
        """
        registered = PoseEngineRegistry.get_registered_names()
        if engine_name not in registered:
            raise ValueError(
                f"Motor '{engine_name}' desconhecido. Motores disponíveis: {registered}"
            )

        async with self._lock:
            # Se a ligação já possui um lease ativo, liberta-o antes de criar o novo
            if lease_id in self._leases:
                old_lease = self._leases.pop(lease_id)
                old_lease.close()

            if len(self._leases) >= self.max_active_engines:
                raise EngineLimitExceededError(
                    f"Limite de motores ativos atingido ({self.max_active_engines}). "
                    "Liberta uma sessão antes de iniciar outra."
                )

            engine = PoseEngineRegistry.create(engine_name, side=side)
            executor = InferenceExecutor(name=f"{engine_name}_{lease_id[:8]}")
            lease = EngineLease(
                lease_id=lease_id,
                engine_name=engine_name,
                side=side,
                engine=engine,
                executor=executor,
            )
            self._leases[lease_id] = lease
            logger.info(
                "EngineLease concedida: id=%s, motor=%s, side=%s (ativas: %d/%d)",
                lease_id,
                engine_name,
                side,
                len(self._leases),
                self.max_active_engines,
            )
            return lease

    async def release(self, lease_id: str) -> None:
        """Liberta e encerra a concessão associada ao identificador."""
        async with self._lock:
            lease = self._leases.pop(lease_id, None)
            if lease:
                lease.close()

    def get_lease(self, lease_id: str) -> EngineLease | None:
        """Obtém a concessão ativa pelo seu identificador, se existir."""
        return self._leases.get(lease_id)

    async def shutdown(self) -> None:
        """Encerra todas as concessões ativas no shutdown da aplicação."""
        async with self._lock:
            for lease in self._leases.values():
                lease.close()
            self._leases.clear()
            logger.info("EngineManager encerrado: todas as concessões foram libertadas.")
