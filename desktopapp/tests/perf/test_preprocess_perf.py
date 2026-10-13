"""Portão de desempenho do pré-processamento (orçamento: ≤ 2 ms em 720p).

O orçamento vem do README_PLAN §4.2 (ROI + letterbox + blob ≤ 2 ms por frame, para
caber nos 16,6 ms de uma frame a 60 FPS com inferência de 8 ms). É uma **meta**, não um
número medido no hardware de referência — por isso os valores medidos são impressos e
ficam registados na tarefa D04.

Como é medido: o `benchmark` do pytest-benchmark orquestra as rondas e cada chamada
regista a sua própria duração, o que dá percentis reais (p50/p95) em vez de uma média
que esconde caudas longas. A cauda é o que interessa num pipeline de tempo real.
"""

from __future__ import annotations

import time
from collections.abc import Callable

import numpy as np
import pytest
from pytest_benchmark.fixture import BenchmarkFixture

from athletemotion_desktop.runtime.preprocess.pipeline import (
    RTMPOSE_INPUT_SIZE,
    Preprocessor,
    PreprocessRequest,
)
from athletemotion_desktop.runtime.preprocess.roi import Roi

pytestmark = pytest.mark.perf

#: Orçamento do plano para o pré-processamento a 720p.
BUDGET_MS_720P = 2.0
#: Aquecimento antes de medir: a primeira chamada inclui inicializações do OpenCV.
WARMUP_FRAMES = 30


class FrameTimer:
    """Chama uma função e registra a duração de cada invocação, em milissegundos."""

    def __init__(self, operation: Callable[[], None]) -> None:
        self._operation = operation
        self.samples_ms: list[float] = []

    def __call__(self) -> None:
        """Executa a operação e acrescenta a duração aos registos."""
        start = time.perf_counter_ns()
        self._operation()
        self.samples_ms.append((time.perf_counter_ns() - start) / 1e6)

    def percentile(self, fraction: float) -> float:
        """Devolve o percentil pedido das durações registadas.

        Args:
            fraction: percentil entre 0 e 1 (0.5 = mediana).

        Returns:
            Duração em milissegundos.
        """
        return float(np.percentile(self.samples_ms, fraction * 100))


def _frame(width: int, height: int) -> np.ndarray:
    """Frame sintética do tamanho pedido (textura determinística, não ruído puro)."""
    generator = np.random.default_rng(11)
    return generator.integers(0, 256, size=(height, width, 3), dtype=np.uint8)


def _measured_720p() -> tuple[FrameTimer, Preprocessor, np.ndarray, Roi]:
    """Prepara o cenário 720p: recorte de pessoa (400x500) para entrada 320x320."""
    processor = Preprocessor(PreprocessRequest(target_size=(320, 320)))
    frame = _frame(1280, 720)
    roi = Roi(x=440, y=110, width=400, height=500)

    def measure() -> None:
        """Executa o pré-processamento e descarta o resultado (mede-se o custo)."""
        processor.prepare(frame, roi)

    timer = FrameTimer(measure)
    for _ in range(WARMUP_FRAMES):
        measure()
    return timer, processor, frame, roi


def test_preprocess_720p_stays_within_budget(benchmark: BenchmarkFixture) -> None:
    """O ROI + letterbox + blob a 720p fica dentro dos 2 ms (p95), com p50 bem abaixo."""
    timer, _processor, _frame_data, _roi = _measured_720p()

    benchmark(timer)

    median_ms = timer.percentile(0.50)
    p95_ms = timer.percentile(0.95)
    print(
        f"\n[preprocess 720p->320] p50={median_ms:.3f} ms p95={p95_ms:.3f} ms "
        f"n={len(timer.samples_ms)} (orçamento {BUDGET_MS_720P} ms)"
    )

    # O critério da tarefa é o orçamento de 2 ms para o pré-processamento a 720p. Não se
    # aperta a mediana para "metade do orçamento": essa margem auto-imposta transformava
    # uma variação de turbo/load da máquina (0,84 → 1,10 ms entre execuções) numa falha,
    # sem relação com o requisito. O valor medido fica impresso acima e registado na tarefa.
    assert median_ms < BUDGET_MS_720P, f"p50 de {median_ms:.3f} ms excede {BUDGET_MS_720P} ms"
    assert p95_ms < BUDGET_MS_720P, f"p95 de {p95_ms:.3f} ms excede {BUDGET_MS_720P} ms"


def test_preprocess_1080p_is_measured(benchmark: BenchmarkFixture) -> None:
    """A 1080p (entrada 640x640) o custo é maior: mede-se e registra-se, sem meta fixa.

    1080p a 30 FPS tem 33 ms de orçamento por frame, pelo que 4x o custo do pré-processamento
    a 720p continua a caber; o número real fica no registo da tarefa para o autotune (R14/D12)
    poder decidir a resolução por máquina.
    """
    processor = Preprocessor(PreprocessRequest(target_size=(640, 640)))
    frame = _frame(1920, 1080)
    roi = Roi(x=700, y=200, width=500, height=700)

    def measure() -> None:
        """Executa o pré-processamento e descarta o resultado (mede-se o custo)."""
        processor.prepare(frame, roi)

    timer = FrameTimer(measure)
    for _ in range(WARMUP_FRAMES):
        measure()

    benchmark(timer)

    median_ms = timer.percentile(0.50)
    p95_ms = timer.percentile(0.95)
    print(
        f"\n[preprocess 1080p->640] p50={median_ms:.3f} ms p95={p95_ms:.3f} ms "
        f"n={len(timer.samples_ms)}"
    )

    assert p95_ms < 10.0, f"p95 de {p95_ms:.3f} ms inviabiliza 1080p a 30 FPS (33 ms/frame)"


def test_preprocess_rtmpose_input_stays_within_budget(benchmark: BenchmarkFixture) -> None:
    """A entrada 192x256 do RTMPose (a do bikefit) também cabe no orçamento de 2 ms."""
    processor = Preprocessor(PreprocessRequest(target_size=RTMPOSE_INPUT_SIZE))
    frame = _frame(1280, 720)
    roi = Roi(x=440, y=110, width=320, height=400)

    def measure() -> None:
        """Executa o pré-processamento e descarta o resultado (mede-se o custo)."""
        processor.prepare(frame, roi)

    timer = FrameTimer(measure)
    for _ in range(WARMUP_FRAMES):
        measure()

    benchmark(timer)

    median_ms = timer.percentile(0.50)
    p95_ms = timer.percentile(0.95)
    print(
        f"[preprocess rt 192x256] p50={median_ms:.3f} ms p95={p95_ms:.3f} ms "
        f"n={len(timer.samples_ms)} (orçamento {BUDGET_MS_720P} ms)"
    )

    assert median_ms < BUDGET_MS_720P
    assert p95_ms < BUDGET_MS_720P
