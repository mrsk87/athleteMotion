"""Portão de desempenho do anel: escrita + leitura de um frame abaixo de 0,2 ms.

O que é medido é o **mecanismo** do anel (adquirir slot, publicar, arrendar, devolver),
não a cópia dos píxeis: o produtor real (captura) já tem o frame num buffer e o
consumidor (pré-processamento) lê os píxeis como parte do seu próprio trabalho. Se a
contabilidade do anel custasse décimos de milissegundo, o orçamento de 16,6 ms por
frame ficaria logo comprometido.

Como é medido: `benchmark` do pytest-benchmark a orquestrar, com cada iteração a
registar a sua duração para se obterem percentis reais (a cauda é o que importa).
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterator

import numpy as np
import pytest
from pytest_benchmark.fixture import BenchmarkFixture

from athletemotion_desktop.runtime.ring_buffer.shm_ring import ShmRing
from tests.support.perf_baseline import Measurement, PerfBaseline

pytestmark = pytest.mark.perf

#: Chave da métrica na baseline (nome estável: muda só se a medição mudar de sentido).
METRIC = "anel SPSC 720p (escrita+leitura)"

#: Critério da tarefa D04: escrita + leitura por frame abaixo de 0,2 ms.
BUDGET_MS_PER_FRAME = 0.2
WARMUP_FRAMES = 200
FRAME_HEIGHT = 720
FRAME_WIDTH = 1280


class FrameTimer:
    """Registra a duração de cada chamada, em milissegundos."""

    def __init__(self, operation: Callable[[], None]) -> None:
        self._operation = operation
        self.samples_ms: list[float] = []

    def __call__(self) -> None:
        """Executa a operação e registra a duração."""
        start = time.perf_counter_ns()
        self._operation()
        self.samples_ms.append((time.perf_counter_ns() - start) / 1e6)

    def percentile(self, fraction: float) -> float:
        """Devolve o percentil pedido das durações (em milissegundos)."""
        return float(np.percentile(self.samples_ms, fraction * 100))


@pytest.fixture
def ring() -> Iterator[ShmRing]:
    """Anel 720p (o tamanho real do pipeline) removido no fim do teste."""
    created = ShmRing.create(n_slots=3, height=FRAME_HEIGHT, width=FRAME_WIDTH)
    try:
        yield created
    finally:
        created.shutdown()


def test_write_and_read_latency_stays_within_budget(
    benchmark: BenchmarkFixture, ring: ShmRing, perf_gate: PerfBaseline
) -> None:
    """Escrever, publicar, arrendar e devolver um frame 720p fica abaixo de 0,2 ms."""
    consumer = ShmRing.attach(ring.name)
    frames_written = 0

    def transfer_one_frame() -> None:
        """Um ciclo completo produtor → consumidor no anel."""
        nonlocal frames_written
        slot = ring.acquire_write()
        # Toca na memória do slot: garante que o buffer é real e acessível (sem copiar
        # os 2,7 MB, que é trabalho do pré-processamento, não do anel).
        slot.frame[0, 0, 0] = frames_written % 256
        seq = ring.commit()
        frames_written += 1

        lease = consumer.acquire_read(latest=True)
        if lease is not None:
            assert lease.frame.shape == (FRAME_HEIGHT, FRAME_WIDTH, 3)
            consumer.release(lease)
        assert seq > 0

    try:
        for _ in range(WARMUP_FRAMES):
            transfer_one_frame()

        timer = FrameTimer(transfer_one_frame)
        benchmark(timer)

        perf_gate.check(
            Measurement(
                metric=METRIC,
                p50_ms=timer.percentile(0.50),
                p95_ms=timer.percentile(0.95),
                budget_ms=BUDGET_MS_PER_FRAME,
                samples=len(timer.samples_ms),
            )
        )
    finally:
        consumer.close()


def test_stats_read_is_cheap(ring: ShmRing) -> None:
    """Ler a telemetria do anel (contadores) não perturba o pipeline."""
    slot = ring.acquire_write()
    slot.frame[0, 0, 0] = 1
    ring.commit()

    start = time.perf_counter_ns()
    for _ in range(1000):
        ring.stats()
    elapsed_ms = (time.perf_counter_ns() - start) / 1e6

    assert elapsed_ms / 1000 < 0.05, f"stats() leva {elapsed_ms / 1000:.4f} ms por chamada"
