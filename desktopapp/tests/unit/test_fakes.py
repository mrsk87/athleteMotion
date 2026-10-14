"""Testes dos dobres de teste: um dobre avariado enfraquece em silêncio tudo o que o usa.

Os testes aqui não verificam o produto; verificam a **ferramenta de verificação**. Se o
`FakeBackend` deixasse de impor a sessão única (como o DirectML impõe), o pipeline poderia
paralelizar a mesma sessão e a suíte continuaria verde — esse é o defeito que estes testes
impedem.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable

import numpy as np
import pytest

from tests.fakes.fake_backend import (
    ConcurrentInferenceError,
    FakeBackend,
    FakeBackendError,
    pose_outputs,
)
from tests.fakes.fake_pipeline import FakePipeline, FakePipelineState, FakeResultPayload

TENSOR = np.zeros((1, 3, 320, 320), dtype=np.float32)


def state_of(pipeline: FakePipeline) -> FakePipelineState:
    """Devolve o estado do pipeline sem deixar o mypy estreitar o tipo.

    Um `assert pipeline.state is X` faz o mypy considerar todas as leituras seguintes como
    `Literal[X]`, e a asserção da transição seguinte passa a ser um erro de tipos
    ("non-overlapping identity check") — o que, aqui, esconderia justamente o que o teste
    quer verificar. A chamada de função corta o estreitamento.

    Args:
        pipeline: pipeline a consultar.

    Returns:
        O estado atual.
    """
    return pipeline.state


# ----------------------------------------------------------------- FakeBackend


def test_backend_reports_calls_and_returns_a_pose() -> None:
    """O ciclo normal conta carregamentos/inferências e devolve `(1, N, 3)`."""
    backend = FakeBackend()
    backend.load_model("pose.onnx")

    outputs = backend.infer(TENSOR)

    assert backend.last_model_path == "pose.onnx"
    assert backend.stats.loads == 1
    assert backend.stats.inferences == 1
    assert len(outputs) == 1
    assert outputs[0].shape == (1, 26, 3)
    assert outputs[0].dtype == np.float32


def test_backend_latency_is_respected() -> None:
    """A latência configurada é realmente gasta (é o que permite testar backpressure)."""
    backend = FakeBackend(latency_s=0.05)

    start = time.perf_counter()
    backend.infer(TENSOR)
    elapsed = time.perf_counter() - start

    assert elapsed >= 0.05


def wait_until(condition: Callable[[], bool], *, timeout_s: float = 5.0) -> None:
    """Espera ativa por uma condição, sem `sleep` cego (o teste falha se ela não chegar).

    Args:
        condition: predicado a satisfazer.
        timeout_s: limite de espera.

    Raises:
        AssertionError: quando o limite é atingido sem a condição se verificar.
    """
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(0.002)
    pytest.fail("a condição esperada não se verificou dentro do limite")


def test_backend_refuses_concurrent_inference_on_the_same_session() -> None:
    """Duas passagens simultâneas falham — como falharia o DirectML.

    A primeira inferência é travada dentro do motor (`stall_event`) para que a segunda
    aconteça garantidamente **durante** a primeira: sem isso o teste dependeria do
    escalonamento das threads e passaria ou falharia por sorte.
    """
    stall = threading.Event()
    backend = FakeBackend(stall_event=stall)
    first_call_errors: list[BaseException] = []

    def first_call() -> None:
        """Primeira inferência (fica travada dentro do motor até `stall` ser libertado)."""
        try:
            backend.infer(TENSOR)
        except BaseException as exc:  # noqa: BLE001 - é isso que o teste quer observar
            first_call_errors.append(exc)

    thread = threading.Thread(target=first_call)
    thread.start()
    try:
        wait_until(lambda: backend.stats.max_concurrent == 1)

        with pytest.raises(ConcurrentInferenceError, match="DirectML"):
            backend.infer(TENSOR)
    finally:
        stall.set()
        thread.join(timeout=5.0)

    assert first_call_errors == []
    assert backend.stats.max_concurrent == 1


def test_backend_can_report_unavailability() -> None:
    """Um motor indisponível recusa carregar modelos com uma mensagem acionável."""
    backend = FakeBackend(available=False)

    assert backend.is_available is False
    with pytest.raises(FakeBackendError, match="indisponível"):
        backend.load_model("pose.onnx")


def test_backend_injects_failures_after_n_inferences() -> None:
    """A falha injetada chega depois de N inferências válidas (watchdog/`DEGRADED`)."""
    backend = FakeBackend(fail_after=2)

    backend.infer(TENSOR)
    backend.infer(TENSOR)
    with pytest.raises(FakeBackendError, match="Falha simulada"):
        backend.infer(TENSOR)

    assert backend.stats.inferences == 2
    assert backend.stats.failures == 1


def test_backend_rejects_a_tensor_with_the_wrong_rank() -> None:
    """O motor falso não aceita entradas que o motor real também recusaria."""
    backend = FakeBackend()

    with pytest.raises(ValueError, match=r"espera um tensor \(B, C, H, W\)"):
        backend.infer(np.zeros((3, 320, 320), dtype=np.float32))


def test_backend_release_stops_accepting_work() -> None:
    """Depois de libertado, o motor recusa trabalho novo (recursos fechados a sério)."""
    backend = FakeBackend()
    backend.release()

    assert backend.is_available is False
    with pytest.raises(FakeBackendError, match="foi libertado"):
        backend.infer(TENSOR)
    assert backend.stats.releases == 1


def test_backend_accepts_an_output_factory() -> None:
    """O resultado por omissão pode ser substituído (modelos com outra saída)."""

    def factory(tensor: np.ndarray) -> list[np.ndarray]:
        """Devolve um tensor com a forma do modelo de deteção YOLO."""
        return [np.zeros((1, 5, 4), dtype=np.float32), np.zeros((1, 4), dtype=np.float32)]

    backend = FakeBackend(output_factory=factory)

    outputs = backend.infer(TENSOR)

    assert [array.shape for array in outputs] == [(1, 5, 4), (1, 4)]


def test_pose_outputs_validates_the_shape() -> None:
    """Landmarks num formato diferente devolvem um erro explicativo."""
    with pytest.raises(ValueError, match="forma \\(N, 3\\)"):
        pose_outputs([[1.0, 2.0]])


# ----------------------------------------------------------------- FakePipeline


def test_pipeline_start_stop_cycles_through_the_documented_states() -> None:
    """O arranque e a paragem passam pelos estados que a UI vai desenhar."""
    pipeline = FakePipeline()
    seen: list[FakePipelineState] = []
    pipeline.subscribe_state(lambda state, reason: seen.append(state))

    pipeline.start("camera:0")
    assert state_of(pipeline) is FakePipelineState.RUNNING
    assert pipeline.source_id == "camera:0"

    pipeline.stop()
    assert state_of(pipeline) is FakePipelineState.STOPPED
    assert pipeline.source_id is None

    assert seen == [
        FakePipelineState.STARTING,
        FakePipelineState.WARMING,
        FakePipelineState.RUNNING,
        FakePipelineState.STOPPING,
        FakePipelineState.STOPPED,
    ]


def test_pipeline_refuses_to_start_twice() -> None:
    """Arrancar um pipeline já a correr é um erro de protocolo, não um no-op."""
    pipeline = FakePipeline()
    pipeline.start()

    with pytest.raises(RuntimeError, match="já está em"):
        pipeline.start()


def test_pipeline_delivers_results_and_can_unsubscribe() -> None:
    """Os resultados chegam aos observadores e a desinscrição é efetiva."""
    pipeline = FakePipeline()
    received: list[FakeResultPayload] = []
    unsubscribe = pipeline.subscribe(lambda result: received.append(result.payload))
    pipeline.start()

    pipeline.emit()
    pipeline.emit()
    unsubscribe()
    pipeline.emit()

    assert len(received) == 2
    assert received[0].angles_deg["knee_left"] == pytest.approx(145.5)


def test_pipeline_survives_a_broken_subscriber() -> None:
    """Um observador que rebenta não impede a entrega aos restantes (como um slot de sinal)."""
    pipeline = FakePipeline()
    received: list[int] = []

    def broken(result: object) -> None:
        """Observador avariado de propósito."""
        raise RuntimeError("observador avariado")

    pipeline.subscribe(broken)
    pipeline.subscribe(lambda result: received.append(result.seq))
    pipeline.start()

    pipeline.emit()

    assert received == [1]
    assert pipeline.stats.subscriber_errors == 1


def test_pipeline_requires_running_state_to_emit() -> None:
    """Entregar resultados com o pipeline parado é um erro do teste, dito como tal."""
    pipeline = FakePipeline()

    with pytest.raises(RuntimeError, match="Nao|Não"):
        pipeline.emit()


def test_pipeline_exposes_the_result_frame_mismatch() -> None:
    """`latest()` mostra a defasagem entre o último frame e o resultado que o gerou."""
    pipeline = FakePipeline()
    pipeline.start()
    result = pipeline.emit()

    frame_seq, latest = pipeline.latest()
    assert frame_seq == result.seq

    pipeline.advance_frame(3)
    frame_seq, latest = pipeline.latest()

    assert frame_seq == result.seq + 3
    assert latest is not None and latest.seq == result.seq


def test_pipeline_reports_degraded_and_failed_states() -> None:
    """O watchdog comunica `DEGRADED` e `FAILED` com motivo legível."""
    pipeline = FakePipeline()
    pipeline.start()

    pipeline.degrade("driver DML falhou duas vezes; a usar CPU")
    assert state_of(pipeline) is FakePipelineState.DEGRADED
    # Em estado degradado ainda há resultados (é o ponto do fallback).
    assert pipeline.emit().payload.landmarks.shape == (26, 3)

    pipeline.fail("processo de inferência morreu")
    assert state_of(pipeline) is FakePipelineState.FAILED
    with pytest.raises(RuntimeError, match="FAILED|failed"):
        pipeline.emit()
