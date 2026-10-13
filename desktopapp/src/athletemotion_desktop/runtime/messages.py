"""Mensagens de controlo entre a UI, a captura e o processo de inferência.

**Regra de ouro:** por estes canais passam apenas **metadados** (dezenas de bytes). Os
frames viajam pelo anel de memória partilhada (`runtime.ring_buffer`); um frame
enviado por `Queue`/`Pipe` seria serializado (pickle), copiado duas vezes e a
transformar um pipeline de tempo real num gerador de lixo — a 1080p, ~6 MB por frame.

Todas as mensagens são `dataclass` **frozen** com `slots` — pequenas, imutáveis e
*mensagens de valor*: duas mensagens iguais comparam-se como iguais, o que simplifica
testes e o registo em log. Herdam a capacidade de *pickle* das dataclasses (sem
estado de recursos), que é o que o `multiprocessing` exige no Windows (`spawn`).

Mensagens definidas:

- :class:`FrameReady` — «há um frame novo no anel, no slot X, com a sequência S».
- :class:`Result` — envelope do resultado de um frame; o conteúdo é genérico
  (`Result[Payload]`) para que a D05 defina o seu payload sem tocar neste módulo.
- :class:`Control` — comandos do utilizador/UI para o pipeline.
- :class:`Shutdown` — pedido de encerramento ordenado.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from multiprocessing import Queue
from typing import Final, Generic, TypeVar

#: Recorte em píxeis `(x, y, largura, altura)` — o mesmo formato do domínio partilhado.
Rect = tuple[int, int, int, int]

#: Tamanho máximo das filas de controlo. Um valor pequeno é intencional: se o
#: consumidor estiver atrasado não se acumulam comandos antigos que deixariam o
#: sistema a executar decisões já ultrapassadas.
CONTROL_QUEUE_SIZE: Final[int] = 8

#: Limiar acima do qual uma mensagem de controlo é suspeita (provavelmente transporta
#: dados de frame, o que não pode acontecer). Usado pelos testes como guarda de desenho.
MAX_MESSAGE_BYTES: Final[int] = 1024

#: Tipo do conteúdo de um :class:`Result`. A D05 especializa-o (keypoints, métricas).
PayloadT = TypeVar("PayloadT")


@dataclass(frozen=True, slots=True)
class FrameReady:
    """Anuncia um frame publicado no anel (*não* transporta o frame).

    Attributes:
        slot: índice do slot no anel.
        seq: sequência do frame.
        t_capture_ns: instante de captura (`perf_counter_ns`), para corrigir a
            defasagem entre o frame e o resultado.
        roi: recorte previsto para este frame, quando existe (o detetor já correu).
    """

    slot: int
    seq: int
    t_capture_ns: int
    roi: Rect | None = None


@dataclass(frozen=True, slots=True)
class Result(Generic[PayloadT]):
    """Envelope do resultado de inferência de um frame.

    Attributes:
        seq: sequência do frame que originou o resultado (permite desenhar o esqueleto
            sobre o frame certo, ou extrapolar quando já não está disponível).
        t_capture_ns: instante de captura do frame original.
        inference_ms: tempo de inferência medido, em milissegundos (telemetria).
        payload: conteúdo do resultado (definido pela D05).
    """

    seq: int
    t_capture_ns: int
    inference_ms: float
    payload: PayloadT


class ControlKind(StrEnum):
    """Comandos que a UI pode enviar ao pipeline."""

    START = "start"
    STOP = "stop"
    PAUSE = "pause"
    RESUME = "resume"
    SET_BACKEND = "set_backend"
    SET_ROI = "set_roi"
    RESET_FILTERS = "reset_filters"


@dataclass(frozen=True, slots=True)
class Control:
    """Comando de controlo do pipeline.

    Attributes:
        kind: comando a executar.
        value: valor textual associado (ex.: identificador do backend escolhido).
        roi: recorte associado (ex.: ROI fixado manualmente pelo utilizador).
        t_requested_ns: instante do pedido, para descartar comandos obsoletos.
    """

    kind: ControlKind
    value: str | None = None
    roi: Rect | None = None
    t_requested_ns: int = 0


@dataclass(frozen=True, slots=True)
class Shutdown:
    """Pedido de encerramento ordenado do pipeline.

    Attributes:
        reason: motivo legível (aparece no log, para se saber *quem* mandou parar).
        timeout_seconds: tempo que o emissor está disposto a esperar pela confirmação.
    """

    reason: str = "pedido do utilizador"
    timeout_seconds: float = 5.0


def make_control_queue(*, maxsize: int = CONTROL_QUEUE_SIZE) -> Queue[Control]:
    """Cria a fila de comandos UI → pipeline.

    Args:
        maxsize: capacidade máxima (pequena de propósito: ver :data:`CONTROL_QUEUE_SIZE`).

    Returns:
        A fila, pronta a usar com `put_nowait`/`get_nowait`.
    """
    return Queue(maxsize=maxsize)


def make_result_queue(*, maxsize: int = CONTROL_QUEUE_SIZE) -> Queue[Result[object]]:
    """Cria a fila de resultados pipeline → UI.

    Args:
        maxsize: capacidade máxima.

    Returns:
        A fila de resultados.
    """
    return Queue(maxsize=maxsize)


def make_event_queue(
    *, maxsize: int = CONTROL_QUEUE_SIZE
) -> Queue[FrameReady | Result[object] | Shutdown]:
    """Cria uma fila única para avisos de frame, resultados e encerramento.

    Um só canal evita três filas a competir por atenção no mesmo *loop* de eventos, e
    preserva a ordem dos acontecimentos (o encerramento chega depois do último
    resultado).

    Args:
        maxsize: capacidade máxima.

    Returns:
        A fila de eventos do pipeline.
    """
    return Queue(maxsize=maxsize)
