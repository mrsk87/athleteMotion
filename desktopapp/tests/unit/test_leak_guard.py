"""Testes do portão de fugas e do próprio mecanismo que o torna possível.

Um guarda de fugas que nunca falhou não prova nada: os primeiros testes aqui **criam**
uma fuga de propósito (um segmento que não é removido, um processo que dorme) e exigem
que o guarda a veja. Só depois se testa o caminho limpo.
"""

from __future__ import annotations

import multiprocessing
import time
from collections.abc import Iterator
from multiprocessing.process import BaseProcess

import pytest

from athletemotion_desktop.runtime.ring_buffer.shm_ring import ShmRing
from tests.support.leaks import (
    LeakDetectedError,
    assert_no_leaks,
    find_leaked_processes,
    find_leaked_segments,
    record_ring_creations,
)


def sleeping_child_process() -> None:
    """Corpo do processo usado para provar que o guarda vê processos vivos.

    Tem de ser uma função de topo (e não uma lambda nem um `__call__`) para poder ser
    enviada a um processo `spawn` no Windows.
    """
    time.sleep(60.0)


@pytest.fixture
def live_child() -> Iterator[BaseProcess]:
    """Processo filho vivo durante o teste e terminado no fim (sem deixar fuga)."""
    context = multiprocessing.get_context("spawn")
    child = context.Process(target=sleeping_child_process, name="fuga-de-teste")
    child.start()
    try:
        yield child
    finally:
        child.terminate()
        child.join(timeout=10.0)


def test_guard_detects_a_leaked_shared_memory_segment() -> None:
    """Um segmento criado e não removido é apanhado pelo nome."""
    ring = ShmRing.create(n_slots=2, height=8, width=8)
    try:
        leaks = find_leaked_segments([ring.name])
        assert len(leaks) == 1
        assert leaks[0].kind == "memoria-partilhada"
        assert ring.name in leaks[0].detail
        assert "unlink()" in leaks[0].detail
    finally:
        ring.shutdown()

    assert find_leaked_segments([ring.name]) == ()


def test_guard_ignores_names_that_never_existed() -> None:
    """Um nome desconhecido não é uma fuga: o guarda não inventa violações."""
    assert find_leaked_segments(["athletemotion_ring_nao_existe_1234"]) == ()


def test_guard_detects_a_process_that_survives_the_test(
    live_child: BaseProcess,
) -> None:
    """Um processo filho que continua a correr é uma fuga com identificação útil."""
    leaks = find_leaked_processes(grace_s=0.3)

    assert any(str(live_child.pid) in leak.detail for leak in leaks), leaks
    assert all(leak.kind == "processo" for leak in leaks)


def test_guard_accepts_a_process_that_already_exited(live_child: BaseProcess) -> None:
    """Depois de o processo terminar, o guarda fica satisfeito (sem falso positivo)."""
    live_child.terminate()
    live_child.join(timeout=10.0)

    assert find_leaked_processes(grace_s=1.0) == ()


def test_assert_no_leaks_reports_every_kind_together() -> None:
    """A mensagem final lista as duas naturezas de fuga e explica como as corrigir."""
    ring = ShmRing.create(n_slots=2, height=8, width=8)
    context = multiprocessing.get_context("spawn")
    child = context.Process(target=sleeping_child_process, name="fuga-de-teste")
    child.start()
    try:
        with pytest.raises(LeakDetectedError) as error:
            assert_no_leaks(segments=[ring.name], grace_s=0.3)
        message = str(error.value)
        assert "memoria-partilhada" in message
        assert "processo" in message
        assert ring.name in message
        assert "2 recurso(s) vivo(s)" in message
    finally:
        child.terminate()
        child.join(timeout=10.0)
        ring.shutdown()


def test_assert_no_leaks_passes_on_a_clean_test() -> None:
    """O caminho normal (tudo fechado) não produz ruído nem falha."""
    ring = ShmRing.create(n_slots=2, height=8, width=8)
    name = ring.name
    ring.shutdown()

    assert_no_leaks(segments=[name], grace_s=0.1)


def test_ring_creation_recorder_captures_the_names(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A interceção de `ShmRing.create` registra o nome sem alterar o comportamento."""
    created = record_ring_creations(monkeypatch)
    ring = ShmRing.create(n_slots=2, height=8, width=8)
    try:
        assert created == [ring.name]
        assert ring.stats().frames_written == 0
    finally:
        ring.shutdown()


def test_guard_is_active_for_this_suite_and_clean() -> None:
    """O guarda autouse corre para todos os testes: aqui prova-se que não há falsos positivos.

    Este teste não faz nada de especial de propósito: se a fixture autouse do
    `conftest.py` não estivesse instalada, os testes acima (que criam fugas) continuariam
    a passar — é este o elo que liga o mecanismo à suíte.
    """
    assert find_leaked_processes(grace_s=0.05) == ()
