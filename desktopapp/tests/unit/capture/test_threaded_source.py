"""Testes da base com thread dedicada: *latest-wins*, descarte, reconexão e estados.

É aqui que se prova o critério central da tarefa — **`read()` nunca devolve um frame mais
antigo do que o último escrito** — e o comportamento em falha (a câmara desliga-se e a
fonte recupera sem bloquear quem consome).
"""

from __future__ import annotations

import threading
import time

import numpy as np
import pytest

from athletemotion_desktop.runtime.capture.base import (
    CaptureOpenError,
    CaptureSourceError,
    CaptureState,
)
from tests.fakes.fake_camera import FakeSource, make_source_info


def _wait_for(predicate: object, timeout_s: float = 2.0) -> bool:
    """Espera até a condição se verificar (sem `sleep` fixo em testes de concorrência)."""
    deadline = time.perf_counter() + timeout_s
    check = predicate  # nomear a chamada torna o teste mais legível
    assert callable(check)
    while time.perf_counter() < deadline:
        if check():
            return True
        time.sleep(0.002)
    return bool(check())


def test_read_returns_the_most_recent_frame_and_counts_drops() -> None:
    """O consumidor recebe sempre o frame mais recente; os saltados ficam contados."""
    source = FakeSource(period_s=0.001)
    try:
        source.open()

        first = source.read(timeout_ms=500)
        assert first is not None
        # O consumidor dorme enquanto a câmara continua: os frames intermédios existiram
        # e não podem desaparecer sem ficar registados.
        time.sleep(0.05)
        second = source.read(timeout_ms=500)

        assert second is not None
        assert second.index > first.index
        stats = source.stats()
        assert stats.frames_dropped >= 1
        assert stats.frames_captured == stats.frames_delivered + stats.frames_dropped
    finally:
        source.close()


def test_read_never_goes_backwards() -> None:
    """Uma sequência de leituras devolve índices estritamente crescentes."""
    source = FakeSource(period_s=0.001)
    try:
        source.open()
        indices = []
        for _ in range(20):
            frame = source.read(timeout_ms=500)
            if frame is not None:
                indices.append(frame.index)
            time.sleep(0.002)

        assert len(indices) >= 5
        assert indices == sorted(indices)
        assert len(set(indices)) == len(indices)
    finally:
        source.close()


def test_read_without_timeout_does_not_block() -> None:
    """`read(timeout_ms=0)` devolve imediatamente, mesmo sem frame novo."""
    source = FakeSource(period_s=0.2)
    try:
        source.open()
        assert source.read(timeout_ms=500) is not None

        start = time.perf_counter()
        assert source.read() is None
        elapsed_ms = (time.perf_counter() - start) * 1000

        assert elapsed_ms < 20, f"read() sem timeout levou {elapsed_ms:.1f} ms"
    finally:
        source.close()


def test_read_returns_none_when_the_source_failed() -> None:
    """Depois de uma falha definitiva, `read()` devolve `None` em vez de bloquear."""
    source = FakeSource(period_s=0.001, fail_after=1, max_reconnect_attempts=1)
    try:
        source.open()
        assert _wait_for(lambda: source.state is CaptureState.FAILED, timeout_s=5.0)

        # O último frame válido continua a ser entregue (não se deita fora imagem boa);
        # a partir daí, `read` responde `None` sem esperar pelo timeout.
        while source.read(timeout_ms=100) is not None:
            pass

        start = time.perf_counter()
        assert source.read(timeout_ms=2000) is None
        assert (time.perf_counter() - start) < 0.5
        assert "reconexão" in (source.last_error or "")
    finally:
        source.close()


def test_frames_reuse_the_producer_buffer() -> None:
    """Todos os frames partilham o mesmo buffer: não há alocação por frame."""
    source = FakeSource(period_s=0.002)
    try:
        source.open()
        first = source.read(timeout_ms=500)
        time.sleep(0.02)
        second = source.read(timeout_ms=500)

        assert first is not None and second is not None
        assert first.data.base is second.data.base
    finally:
        source.close()


def test_reconnect_reopens_the_device_and_counts_it() -> None:
    """Após falhas seguidas, a fonte reabre o dispositivo e conta a reconexão."""
    source = FakeSource(period_s=0.001, fail_after=2, max_reconnect_attempts=2)
    try:
        source.open()
        assert _wait_for(lambda: source.stats().reconnects >= 1, timeout_s=5.0)
        assert source.opens >= 2
        assert source.releases >= 1
    finally:
        source.close()


def test_open_failure_is_reported_with_context() -> None:
    """Uma abertura impossível devolve `CaptureOpenError` com a razão preenchida."""
    source = FakeSource(open_error=CaptureOpenError("fake:0", "índice inválido (teste)"))
    try:
        with pytest.raises(CaptureOpenError, match="índice inválido"):
            source.open()

        assert source.state is CaptureState.FAILED
        assert source.last_error is not None
    finally:
        source.close()


def test_open_times_out_when_no_frame_arrives() -> None:
    """Sem frames dentro do prazo, a abertura falha e o dispositivo é libertado."""
    source = FakeSource(period_s=0.05, fail_after=0, open_timeout_s=0.2)
    try:
        with pytest.raises(CaptureOpenError, match="nenhum frame"):
            source.open()

        # A thread não pode ficar viva a segurar a câmara depois de uma abertura falhada.
        assert source.releases >= 1
    finally:
        source.close()


def test_opening_twice_is_an_error() -> None:
    """Abrir uma fonte já aberta é um erro de protocolo, não um segundo dispositivo."""
    source = FakeSource()
    try:
        source.open()
        with pytest.raises(CaptureSourceError, match="já está aberta"):
            source.open()
    finally:
        source.close()


def test_state_listeners_are_notified_and_cannot_break_capture() -> None:
    """Os observadores recebem as transições; um que rebente não pára a captura."""
    seen: list[CaptureState] = []

    def failing_listener(state: CaptureState, reason: str) -> None:
        seen.append(state)
        raise RuntimeError("observador avariado (teste)")

    source = FakeSource(period_s=0.002)
    source.add_state_listener(failing_listener)
    try:
        source.open()

        assert _wait_for(lambda: CaptureState.READING in seen)
        # A captura continua a entregar frames apesar do observador avariado.
        assert source.read(timeout_ms=500) is not None
    finally:
        source.close()


def test_effective_fps_is_measured_from_capture_times() -> None:
    """O FPS efetivo é medido na captura, não no consumo."""
    source = FakeSource(period_s=0.01)
    try:
        source.open()
        assert _wait_for(lambda: source.stats().frames_captured >= 10)
        measured = source.effective_fps

        assert 10.0 < measured < 400.0, f"FPS efetivo implausível: {measured}"
    finally:
        source.close()


def test_slow_source_raises_a_fps_warning() -> None:
    """Quando o efetivo fica abaixo de 90 % do pedido, a `SourceInfo` traz um aviso."""
    # Pede 5000 FPS: impossível de cumprir por uma fonte que entrega de 5 em 5 ms.
    source = FakeSource(period_s=0.005, requested_fps=5000.0)
    try:
        source.open()
        assert _wait_for(
            lambda: any("abaixo de" in w for w in source.info().warnings), timeout_s=5.0
        )
        warnings = source.info().warnings
        assert any("90%" in warning for warning in warnings)
    finally:
        source.close()


def test_close_is_idempotent_and_stops_the_thread() -> None:
    """Fechar duas vezes é seguro e a thread termina (nada fica a segurar a câmara)."""
    source = FakeSource(period_s=0.005)
    source.open()

    source.close()
    source.close()

    assert source.state is CaptureState.CLOSED
    assert source.releases >= 1
    assert source.read(timeout_ms=10) is None


def test_stats_snapshot_is_consistent() -> None:
    """O instantâneo de telemetria mantém `capturados = entregues + descartados`."""
    source = FakeSource(period_s=0.001)
    try:
        source.open()
        time.sleep(0.05)
        source.read(timeout_ms=500)
        stats = source.stats()

        assert stats.frames_captured == stats.frames_delivered + stats.frames_dropped
        assert stats.read_failures == 0
    finally:
        source.close()


def test_info_requires_an_open_source() -> None:
    """Pedir informação antes de abrir falha de forma explícita."""
    source = FakeSource()
    with pytest.raises(CaptureSourceError, match="não foi aberta"):
        source.info()


def test_source_info_helpers() -> None:
    """A `SourceInfo` formata a resolução e preserva os avisos."""
    info = make_source_info(width=1920, height=1080)

    assert info.resolution == "1920x1080"
    assert info.warnings == ()


def test_close_releases_a_blocked_reader() -> None:
    """Um `read` bloqueado termina com o `close`, em vez de esperar pelo timeout.

    O resultado pode ser `None` ou um último frame publicado *antes* de o `close`
    terminar; o que não pode acontecer é a leitura ficar presa até ao fim do timeout
    (seria um encerramento que bloqueia a thread de UI).
    """
    source = FakeSource(period_s=0.5)
    source.open()
    assert source.read(timeout_ms=2000) is not None  # consome o primeiro frame

    finished: list[float] = []

    def waiter() -> None:
        source.read(timeout_ms=5000)
        finished.append(time.perf_counter())

    thread = threading.Thread(target=waiter)
    thread.start()
    time.sleep(0.05)
    closed_at = time.perf_counter()
    source.close()
    thread.join(timeout=2.0)

    assert not thread.is_alive(), "a leitura bloqueada não foi desbloqueada pelo close"
    assert finished and (finished[0] - closed_at) < 1.0


def test_frame_data_is_shared_with_the_buffer() -> None:
    """Os píxeis entregues são a vista do buffer (sem cópia por frame)."""
    source = FakeSource(period_s=0.005)
    try:
        source.open()
        frame = source.read(timeout_ms=500)
        assert frame is not None
        assert frame.data.base is not None
        assert not frame.data.flags.writeable
        # Não se afirma o conteúdo dos píxeis: o produtor continua a correr e pode já ter
        # reescrito o buffer partilhado (é o contrato documentado do `Frame`).
        assert int(np.asarray(frame.data).flat[0]) >= 0
    finally:
        source.close()
