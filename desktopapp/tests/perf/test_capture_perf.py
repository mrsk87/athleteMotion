"""Portões de desempenho da captura.

O que se mede é o **custo do mecanismo**, não a captura do hardware (essa depende da câmara
e é medida pelo CLI `runtime.capture.camera`, com números registados na tarefa D03):

1. `read()` sobre um frame já disponível — é o caminho que o consumidor paga quando a
   câmara está mais rápida do que ele. Se esta contabilidade custasse décimos de
   milissegundo, o orçamento de 16,6 ms por frame ficaria comprometido.
2. Leitura em lote de um ficheiro — é o modo de análise, onde o disco (e não o tempo) é o
   limite.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from pytest_benchmark.fixture import BenchmarkFixture

from athletemotion_desktop.runtime.capture.base import CaptureStats
from athletemotion_desktop.runtime.capture.device import fourcc_to_code
from athletemotion_desktop.runtime.capture.file_source import FileSource
from tests.support.fake_capture import FakeSource

pytestmark = pytest.mark.perf

#: Orçamento da leitura de um frame já disponível (o que resta do frame de 16,6 ms a 60 FPS).
BUDGET_READ_MS = 1.0
WARMUP_FRAMES = 200


class ReadTimer:
    """Mede **só** o custo de consumir um frame já disponível.

    A espera pelo produtor fica fora da medição: se fosse contada, estaríamos a medir a
    câmara (ou o GIL) e não o mecanismo de entrega do `read()`, que é o que este portão
    controla. Cada amostra cronometra exatamente uma chamada `read()` com frame pronto.

    Args:
        source: fonte de onde se lê.
        samples_per_round: número de amostras recolhidas em cada passagem do *benchmark*.
    """

    def __init__(self, source: FakeSource, *, samples_per_round: int = 200) -> None:
        self._source = source
        self._samples_per_round = samples_per_round
        self.samples_ms: list[float] = []

    def __call__(self) -> None:
        """Recolhe uma passagem de amostras, todas com um frame já disponível."""
        for _ in range(self._samples_per_round):
            while not self._source.has_frame:
                # Espera pelo produtor *fora* da medição (cede o GIL).
                time.sleep(0)
            start = time.perf_counter_ns()
            frame = self._source.read()
            self.samples_ms.append((time.perf_counter_ns() - start) / 1e6)
            assert frame is not None

    def percentile(self, fraction: float) -> float:
        """Devolve o percentil pedido das durações registadas."""
        return float(np.percentile(self.samples_ms, fraction * 100))


@pytest.fixture
def source() -> Iterator[FakeSource]:
    """Fonte fake a entregar frames depressa (a câmara é sempre mais rápida que o CPU)."""
    created = FakeSource(period_s=0.0)
    created.open()
    try:
        yield created
    finally:
        created.close()


def test_read_of_an_available_frame_stays_within_budget(
    benchmark: BenchmarkFixture, source: FakeSource
) -> None:
    """`read()` com frame disponível fica muito abaixo de 1 ms (p50 e p95)."""
    for _ in range(WARMUP_FRAMES):
        source.read(timeout_ms=100)

    timer = ReadTimer(source)
    benchmark(timer)

    median_ms = timer.percentile(0.50)
    p95_ms = timer.percentile(0.95)
    print(
        f"\n[captura read()] p50={median_ms:.4f} ms p95={p95_ms:.4f} ms "
        f"n={len(timer.samples_ms)} (orçamento {BUDGET_READ_MS} ms)"
    )

    assert median_ms < BUDGET_READ_MS
    assert p95_ms < BUDGET_READ_MS


def test_read_allocates_nothing_per_frame(source: FakeSource) -> None:
    """O caminho de leitura não aloca por frame (a telemetria é a única coisa que cresce)."""
    first = source.read(timeout_ms=100)
    assert first is not None
    buffer_identity = id(first.data.base)

    for _ in range(200):
        frame = source.read(timeout_ms=100)
        assert frame is not None
        assert id(frame.data.base) == buffer_identity


def test_file_batch_throughput(benchmark: BenchmarkFixture, tmp_path: Path) -> None:
    """Ler um ficheiro em modo batch é limitado pelo disco, não pela cadência."""
    import cv2

    video = tmp_path / "perf.avi"
    writer = cv2.VideoWriter(str(video), fourcc_to_code("MJPG"), 30.0, (320, 240))
    assert writer.isOpened()
    try:
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        for index in range(300):
            frame[:] = index % 256
            writer.write(frame)
    finally:
        writer.release()

    source = FileSource(video, realtime=False)
    source.open()
    per_pass_ms: list[float] = []
    try:

        def read_all() -> CaptureStats:
            """Lê o ficheiro inteiro, recomeçando quando chega ao fim."""
            started = time.perf_counter_ns()
            for _ in range(300):
                if source.read() is None:
                    source.seek(frame=0)
                    source.read()
            per_pass_ms.append((time.perf_counter_ns() - started) / 1e6)
            return source.stats()

        stats = benchmark(read_all)
        median_pass_ms = float(np.median(per_pass_ms))
        print(
            f"\n[captura ficheiro] {stats.frames_delivered} frames em "
            f"{median_pass_ms:.1f} ms por passagem "
            f"({stats.frames_delivered / (median_pass_ms / 1000):.0f} frames/s)"
        )

        assert stats.frames_delivered > 0
    finally:
        source.close()
