"""Testes das mensagens de controlo: serialização, tamanho e imutabilidade.

O teste central é o do **tamanho**: estes canais transportam metadados, nunca frames.
Uma mensagem que cresça para kilobytes é sinal de que alguém começou a enviar dados de
frame pela fila — o erro que este desenho existe para impedir.
"""

from __future__ import annotations

import pickle
from queue import Full

import pytest

from athletemotion_desktop.runtime.messages import (
    CONTROL_QUEUE_SIZE,
    MAX_MESSAGE_BYTES,
    Control,
    ControlKind,
    FrameReady,
    Result,
    Shutdown,
    make_control_queue,
    make_event_queue,
    make_result_queue,
)


def test_frame_ready_round_trips_through_pickle() -> None:
    """A mensagem atravessa processos sem perder nada (exigência do `spawn`)."""
    message = FrameReady(slot=2, seq=1234, t_capture_ns=987654321, roi=(10, 20, 30, 40))

    restored = pickle.loads(pickle.dumps(message))

    assert restored == message
    assert restored.roi == (10, 20, 30, 40)


def test_messages_stay_small() -> None:
    """Nenhuma mensagem de controlo traz dados de frame (todas ficam abaixo de 1 KB)."""
    messages = [
        FrameReady(slot=0, seq=1, t_capture_ns=1),
        FrameReady(slot=3, seq=10**9, t_capture_ns=10**15, roi=(0, 0, 1280, 720)),
        Result(seq=5, t_capture_ns=42, inference_ms=7.5, payload=None),
        Control(kind=ControlKind.SET_BACKEND, value="directml"),
        Shutdown(reason="utilizador fechou a janela"),
    ]

    for message in messages:
        size = len(pickle.dumps(message, protocol=pickle.HIGHEST_PROTOCOL))
        assert size < MAX_MESSAGE_BYTES, f"{type(message).__name__} ocupa {size} bytes"


def test_messages_are_immutable() -> None:
    """Mensagens de valor: ninguém as altera pelo caminho (evita bugs de corrida)."""
    message = FrameReady(slot=1, seq=2, t_capture_ns=3)

    with pytest.raises(AttributeError):
        message.seq = 99  # type: ignore[misc]


def test_equal_messages_compare_equal() -> None:
    """Duas mensagens iguais comparam-se como iguais (útil em testes e logs)."""
    assert FrameReady(slot=1, seq=2, t_capture_ns=3) == FrameReady(slot=1, seq=2, t_capture_ns=3)
    assert FrameReady(slot=1, seq=2, t_capture_ns=3) != FrameReady(slot=1, seq=3, t_capture_ns=3)
    assert Shutdown() == Shutdown(reason="pedido do utilizador", timeout_seconds=5.0)


def test_result_is_generic_over_its_payload() -> None:
    """O envelope aceita qualquer payload *picklable* (a D05 define o conteúdo)."""
    payload = {"nose": (100.0, 200.0, 0.9), "left_hip": (110.0, 300.0, 0.8)}

    message: Result[dict[str, tuple[float, float, float]]] = Result(
        seq=7, t_capture_ns=1000, inference_ms=6.25, payload=payload
    )
    restored = pickle.loads(pickle.dumps(message))

    assert restored.payload == payload
    assert restored.inference_ms == pytest.approx(6.25)


def test_control_kinds_are_strings() -> None:
    """Os comandos são strings estáveis (aparecem em logs e em configuração)."""
    assert isinstance(ControlKind.SET_BACKEND, str)
    assert ControlKind.SET_BACKEND.value == "set_backend"
    assert {kind.value for kind in ControlKind} >= {"start", "stop", "pause", "set_roi"}


def test_queues_round_trip_messages() -> None:
    """As filas de controlo transportam as mensagens sem alterações."""
    control_queue = make_control_queue()
    result_queue = make_result_queue()
    event_queue = make_event_queue()
    try:
        control_queue.put(Control(kind=ControlKind.START))
        result_queue.put(Result(seq=1, t_capture_ns=2, inference_ms=3.0, payload=None))
        event_queue.put(FrameReady(slot=0, seq=1, t_capture_ns=2))
        event_queue.put(Shutdown())

        command = control_queue.get(timeout=5)
        result = result_queue.get(timeout=5)
        first_event = event_queue.get(timeout=5)
        second_event = event_queue.get(timeout=5)

        assert command.kind is ControlKind.START
        assert result.seq == 1
        assert isinstance(first_event, FrameReady)
        assert first_event.seq == 1
        assert isinstance(second_event, Shutdown)
    finally:
        for queue in (control_queue, result_queue, event_queue):
            queue.close()
            queue.cancel_join_thread()


def test_control_queue_bounds_its_size() -> None:
    """A fila tem capacidade limitada: comandos antigos não se acumulam."""
    queue = make_control_queue()
    try:
        for _ in range(CONTROL_QUEUE_SIZE):
            queue.put(Control(kind=ControlKind.PAUSE), timeout=5)

        assert queue.full()
        # O limite é real: um comando a mais é recusado, em vez de acumular memória.
        with pytest.raises(Full):
            queue.put_nowait(Control(kind=ControlKind.PAUSE))
    finally:
        queue.close()
        queue.cancel_join_thread()
