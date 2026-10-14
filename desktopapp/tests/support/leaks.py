"""Deteção de fugas entre testes: processos filhos e segmentos de memória partilhada.

Um teste de um sistema de tempo real pode passar e, ainda assim, deixar um worker a correr
ou um segmento de memória partilhada vivo. Esse tipo de fuga não aparece como falha — só
aparece como instabilidade noutro teste, mais tarde, numa máquina mais lenta. Este módulo
torna-a uma falha imediata e identificável (D14 §3).

Limitação conhecida e assumida: o registo de segmentos cobre os que são criados **neste
processo**. Um anel criado dentro de um processo filho não é visto pelo registo; o que
esse caso deixa é um processo vivo, e é por aí que é apanhado (e, no Windows, o segmento
só desaparece quando o último handle fecha — pelo que um filho que não fecha o segmento
é detectado pelo `segment_exists` sobre os nomes registados).
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Final

import psutil
import pytest

from athletemotion_desktop.runtime.ring_buffer.shm_ring import ShmRing, segment_exists

#: Tempo máximo de espera por um processo que já esteja a terminar.
#:
#: Existe uma janela real: um teste pode pedir `terminate()` e o Windows ainda não ter
#: fechado o processo quando o teste acaba. Sem esta espera, o portão falharia por
#: corrida em vez de por fuga; 2 s é muito mais do que qualquer terminação legítima.
DEFAULT_GRACE_S: Final[float] = 2.0

#: Intervalo entre verificações durante o período de espera.
POLL_INTERVAL_S: Final[float] = 0.05

#: Estados que não contam como "vivo" (processo terminado mas ainda não recolhido).
_DEAD_STATUSES: Final[frozenset[str]] = frozenset(
    {psutil.STATUS_ZOMBIE, psutil.STATUS_DEAD, psutil.STATUS_STOPPED}
)


@dataclass(frozen=True)
class Leak:
    """Uma fuga encontrada no fim de um teste.

    Args:
        kind: tipo da fuga (`processo` ou `memoria-partilhada`).
        detail: descrição com os elementos necessários para a corrigir.
    """

    kind: str
    detail: str

    def __str__(self) -> str:
        """Formata a fuga para o relatório do pytest."""
        return f"[{self.kind}] {self.detail}"


class LeakDetectedError(AssertionError):
    """Falha do portão de fugas.

    Herda de `AssertionError` para que o pytest a apresente como uma asserção do teste
    (e não como um erro do próprio mecanismo de teste).
    """


def child_processes() -> tuple[psutil.Process, ...]:
    """Processos filhos (recursivos) do processo de teste.

    Usa `psutil` em vez de `multiprocessing.active_children()`: o `active_children` só vê
    os filhos criados por `multiprocessing`, e deixaria passar um `subprocess.Popen`
    esquecido — que é exatamente o tipo de fuga que o autotune e a enumeração de câmaras
    podem deixar.

    Returns:
        Os processos filhos vivos; tupla vazia quando a consulta falha (processo que
        desapareceu a meio da enumeração).
    """
    try:
        return tuple(psutil.Process().children(recursive=True))
    except (psutil.NoSuchProcess, psutil.AccessDenied):  # pragma: no cover - corrida do SO
        return ()


def find_leaked_processes(*, grace_s: float = DEFAULT_GRACE_S) -> tuple[Leak, ...]:
    """Procura processos filhos que continuem vivos depois do teste.

    Args:
        grace_s: tempo máximo de espera por processos que estejam a terminar.

    Returns:
        Uma fuga por processo sobrevivente.
    """
    deadline = time.monotonic() + grace_s
    alive: tuple[psutil.Process, ...] = ()
    while True:
        alive = tuple(process for process in child_processes() if _is_alive(process))
        if not alive or time.monotonic() >= deadline:
            break
        time.sleep(POLL_INTERVAL_S)

    leaks: list[Leak] = []
    for process in alive:
        leaks.append(Leak(kind="processo", detail=_describe_process(process)))
    return tuple(leaks)


def find_leaked_segments(names: Iterable[str]) -> tuple[Leak, ...]:
    """Verifica quais dos segmentos criados durante o teste continuam a existir.

    Args:
        names: nomes de segmentos registados durante o teste.

    Returns:
        Uma fuga por segmento que ainda possa ser aberto.
    """
    leaks: list[Leak] = []
    for name in sorted(set(names)):
        if segment_exists(name):
            leaks.append(
                Leak(
                    kind="memoria-partilhada",
                    detail=(
                        f"o segmento '{name}' continua a existir: falta `unlink()`/`shutdown()` "
                        "no dono (quem cria é quem remove)"
                    ),
                )
            )
    return tuple(leaks)


def assert_no_leaks(*, segments: Sequence[str] = (), grace_s: float = DEFAULT_GRACE_S) -> None:
    """Falha se o teste tiver deixado processos ou segmentos de memória partilhada.

    Args:
        segments: nomes de segmentos de anel criados durante o teste.
        grace_s: tempo máximo de espera por processos que estejam a terminar.

    Raises:
        LeakDetectedError: com a lista de fugas encontradas e como as corrigir.
    """
    leaks = find_leaked_processes(grace_s=grace_s) + find_leaked_segments(segments)
    if not leaks:
        return
    lines = "\n".join(f"  - {leak}" for leak in leaks)
    raise LeakDetectedError(
        f"O teste deixou {len(leaks)} recurso(s) vivo(s):\n{lines}\n"
        "Um teste de tempo real que fica com processos ou segmentos abertos torna a "
        "suíte instável e esconde precisamente o defeito que ele devia apanhar; feche os "
        "recursos no `finally` do teste ou no `teardown` da fixture que os criou."
    )


def record_ring_creations(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Regista os segmentos de anel criados por um teste, intercetando `ShmRing.create`.

    A interceção é feita no lado do teste (e não no código de produção) para que o
    `ShmRing` não passe a ter contabilidade só para os testes. O que se perde, e está
    documentado no cabeçalho do módulo, é a visibilidade sobre segmentos criados em
    processos filhos.

    Args:
        monkeypatch: fixture do pytest que reverte a interceção no fim do teste.

    Returns:
        Lista que vai sendo preenchida com os nomes criados (é a mesma referência que o
        teste consulta no fim).
    """
    created: list[str] = []
    bound_create: Callable[..., ShmRing] = ShmRing.create

    def recording_create(*args: object, **kwargs: object) -> ShmRing:
        """Cria o anel e anota o nome do segmento antes de o devolver."""
        ring = bound_create(*args, **kwargs)
        created.append(ring.name)
        return ring

    monkeypatch.setattr(ShmRing, "create", recording_create)
    return created


def _is_alive(process: psutil.Process) -> bool:
    """Indica se o processo ainda está vivo (sem contar com zumbis)."""
    try:
        if not process.is_running():
            return False
        return process.status() not in _DEAD_STATUSES
    except (psutil.NoSuchProcess, psutil.AccessDenied):  # pragma: no cover - corrida do SO
        return False


def _describe_process(process: psutil.Process) -> str:
    """Descreve um processo vivo com o suficiente para o identificar no relatório."""
    try:
        with process.oneshot():
            name = process.name()
            command = " ".join(process.cmdline()[:4])
            return f"processo {process.pid} ('{name}') continua a correr: {command[:160]}"
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return f"processo {process.pid} continua a correr (detalhes inacessíveis)"


__all__ = [
    "DEFAULT_GRACE_S",
    "Leak",
    "LeakDetectedError",
    "assert_no_leaks",
    "child_processes",
    "find_leaked_processes",
    "find_leaked_segments",
    "record_ring_creations",
]
