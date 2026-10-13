"""Anel SPSC de frames em memória partilhada (*single producer, single consumer*).

**Porquê memória partilhada e não uma fila:** uma ``Queue`` serializa o frame (pickle)
e aloca memória por envio; a 1080p isso são ~6 MB por frame a atravessar o GIL de
ambos os lados. Aqui o produtor escreve **diretamente** na memória que o consumidor
lê, e só metadados pequenos passam por canais de controlo.

**Concorrência (justificação das escolhas):**

1. **Dois processos, dois papéis.** O produtor só escreve em slots que ninguém está a
   ler; o consumidor marca ``READING`` no slot que *arrendou* (*lease*) e o produtor
   salta-o. Não existe região de dados com escrita simultânea — as corridas são
   evitadas por construção, não por probabilidade.
2. **Contadores por campo, não por estrutura.** Cada contador é gravado com um
   ``struct.pack_into`` de 4 ou 8 bytes alinhados. Reempacotar o cabeçalho inteiro
   escreveria dezenas de campos não indivisivelmente e, pior, reescreveria com valores
   antigos os contadores que pertencem ao outro processo.
3. **Sem ``multiprocessing.Lock`` no *hot path*.** Um lock entre processos custa uma
   chamada ao kernel por frame e abre a porta a inversão de prioridade. O anel é SPSC
   e *latest-wins*: o produtor **nunca espera** pelo consumidor — quando não há slot
   livre devolve :class:`RingBufferFullError` e o pipeline conta a perda.
4. **Publicação ordenada.** Píxeis → ``t_capture_ns`` → ``seq`` → ``state = READY``
   (ver `layout`). O consumidor confirma a ``seq`` antes e depois de ler.
5. **A marca `READING` não é atómica — e isso é assumido.** Entre o momento em que o
   produtor decide que um slot está livre e o momento em que escreve os píxeis, o
   consumidor pode reclamá-lo. Sem *compare-and-swap* não há forma de eliminar essa
   janela, pelo que o desenho a **deteta em vez de a negar**: o consumidor reclama o
   slot *antes* de ler os metadados (janela mínima) e :meth:`ShmRing.release` devolve
   se o frame se manteve íntegro. O consumidor de tempo real descarta e volta a pedir
   o frame seguinte; o consumidor de análise offline recebe
   :class:`TornFrameError`, porque aí perder um frame é perda de dados, não atraso.
6. **Zero alocações por frame.** As vistas NumPy de cada slot são criadas uma vez, na
   criação/anexação.

**Posse e limpeza:** só o processo criador pode `unlink()`. Um segmento é um recurso do
sistema operativo; sem `unlink` fica órfão. O dono fecha-o por *context manager*, por
`shutdown()` ou, como última rede, no `atexit`.
"""

from __future__ import annotations

import atexit
import logging
import os
import time
import uuid
from dataclasses import dataclass
from multiprocessing import shared_memory
from types import TracebackType
from typing import Final, Self

import numpy as np
import numpy.typing as npt

from athletemotion_desktop.runtime.ring_buffer import layout as layout_module
from athletemotion_desktop.runtime.ring_buffer.errors import (
    RingBufferClosedError,
    RingBufferFullError,
    RingBufferLayoutError,
    RingBufferOwnershipError,
    RingBufferStateError,
    TornFrameError,
)
from athletemotion_desktop.runtime.ring_buffer.layout import (
    LAYOUT_VERSION,
    MAGIC,
    RingHeader,
    RingLayout,
    SlotRecord,
    SlotState,
)

logger = logging.getLogger(__name__)

#: Número de slots por omissão. Três dão margem ao padrão real do pipeline: um slot
#: em escrita, um publicado à espera de leitura e um em leitura.
DEFAULT_SLOTS: Final[int] = 3

#: Prefixo do nome do segmento, para ser óbvio na listagem de recursos do sistema e
#: permitir aos testes verificar que nada ficou órfão.
NAME_PREFIX: Final[str] = "psm_amring_"

#: Tentativas de localizar o frame mais recente. Cada tentativa falhada significa que
#: o produtor substituiu o slot nesse intervalo: com três slots, três falhas seguidas
#: indicam um produtor muito mais rápido do que o consumidor (anel subdimensionado).
_FIND_SLOT_ATTEMPTS: Final[int] = 3


def make_ring_name(label: str = "frames") -> str:
    """Gera um nome de segmento único e legível.

    Args:
        label: rótulo curto que identifica o anel (ex.: `frames`, `tensors`).

    Returns:
        Nome pronto para `multiprocessing.shared_memory.SharedMemory`.
    """
    return f"{NAME_PREFIX}{label}_{os.getpid()}_{uuid.uuid4().hex[:8]}"


def segment_exists(name: str) -> bool:
    """Verifica se um segmento existe neste sistema.

    No Windows os segmentos são *file mappings* com nome (apoiados no ficheiro de
    paginação, sem ficheiro em disco) e o sistema operativo não oferece enumeração —
    a única forma de os detetar, e a única que funciona nas duas plataformas, é
    tentar abrir pelo nome. É esta a verificação usada para provar que não ficaram
    segmentos órfãos.

    Args:
        name: nome do segmento.

    Returns:
        `True` se o segmento puder ser aberto.
    """
    try:
        block = shared_memory.SharedMemory(name=name)
    except FileNotFoundError:
        return False
    block.close()
    return True


def list_ring_names() -> tuple[str, ...]:
    """Lista os segmentos de anel visíveis no sistema de ficheiros.

    **Só POSIX.** No Windows os segmentos não têm representação em disco e não há API
    de enumeração, pelo que esta função devolve uma tupla vazia — use
    :func:`segment_exists` para verificar um nome em qualquer plataforma.

    Returns:
        Nomes dos segmentos que começam por :data:`NAME_PREFIX`, ordenados.
    """
    if os.name == "nt":  # caminho Windows: nada a enumerar
        logger.debug("Enumerar segmentos não é possível no Windows; use segment_exists().")
        return ()

    shm_dir = "/dev/shm"  # pragma: no cover - caminho POSIX
    if not os.path.isdir(shm_dir):
        return ()
    return tuple(sorted(entry for entry in os.listdir(shm_dir) if entry.startswith(NAME_PREFIX)))


@dataclass(frozen=True, slots=True)
class FrameSlot:
    """Slot entregue por :meth:`ShmRing.acquire_write` ou :meth:`ShmRing.acquire_read`.

    Attributes:
        index: índice do slot no anel.
        seq: sequência do frame (a publicada, ou a lida, conforme o caminho).
        t_capture_ns: instante de captura do frame.
        frame: vista NumPy que lê/escreve diretamente na memória partilhada.
    """

    index: int
    seq: int
    t_capture_ns: int
    frame: npt.NDArray[np.generic]


@dataclass(frozen=True, slots=True)
class RingStats:
    """Instantâneo dos contadores do anel (telemetria do pipeline).

    Attributes:
        write_seq: sequência do último frame publicado.
        read_seq: sequência do último frame entregue ao consumidor.
        frames_written: total de frames publicados.
        frames_read: total de frames entregues.
        frames_dropped: frames publicados que o consumidor nunca leu.
        frames_overrun: frames que o produtor não conseguiu escrever (anel cheio).
        last_write_ns: instante do último `commit` (`perf_counter_ns`).
        pending: `True` quando existe um frame publicado ainda não entregue.
        skipped_by_reader: frames saltados pelo consumidor em modo `latest`
            (`write_seq - read_seq - pending`), ou seja, a defasagem atual.
    """

    write_seq: int
    read_seq: int
    frames_written: int
    frames_read: int
    frames_dropped: int
    frames_overrun: int
    last_write_ns: int
    pending: bool
    skipped_by_reader: int


class ShmRing:
    """Anel de frames SPSC sobre ``multiprocessing.shared_memory``.

    O produtor usa :meth:`acquire_write`/:meth:`commit`; o consumidor usa
    :meth:`acquire_read`/:meth:`release`. Ambos podem correr no mesmo processo (útil
    em testes e em pipelines de thread única), mas o contrato é **um produtor e um
    consumidor**: dois produtores a escrever no mesmo anel corrompem frames.
    """

    def __init__(
        self,
        shared_memory_block: shared_memory.SharedMemory,
        *,
        n_slots: int,
        height: int,
        width: int,
        channels: int,
        dtype: npt.DTypeLike,
        owns: bool,
    ) -> None:
        """Inicializa o anel sobre um bloco de memória partilhada já aberto.

        Prefira :meth:`create`/:meth:`attach`; este construtor existe para esses dois
        caminhos e para isolar o layout nos testes.

        Args:
            shared_memory_block: bloco aberto (dono ou não).
            n_slots: número de slots.
            height: altura do frame em píxeis.
            width: largura do frame em píxeis.
            channels: canais por píxel.
            dtype: tipo dos píxeis.
            owns: `True` se este processo criou o bloco e pode `unlink`.
        """
        self._shm = shared_memory_block
        # `SharedMemory.buf` devolve `None` depois de fechado: validar aqui (uma vez)
        # mantém `self._buffer` como `memoryview` em todo o resto da classe, em vez de
        # obrigar a verificar `None` em cada acesso do *hot path*.
        buffer = shared_memory_block.buf
        if buffer is None:
            raise RingBufferClosedError(shared_memory_block.name)
        self._buffer: memoryview = buffer
        self._owns_block = owns
        self._closed = False
        self._layout: RingLayout = layout_module.compute_layout(
            n_slots, layout_module.frame_bytes(height, width, channels, np.dtype(dtype))
        )
        self._header = RingHeader(
            magic=MAGIC,
            layout_version=LAYOUT_VERSION,
            n_slots=n_slots,
            slot_bytes=self._layout.slot_bytes,
            frame_width=width,
            frame_height=height,
            channels=channels,
            dtype_code=layout_module.dtype_code_for(np.dtype(dtype)),
            header_bytes=self._layout.header_bytes,
            slot_record_bytes=self._layout.slot_record_bytes,
            data_offset=self._layout.data_offset,
            write_seq=0,
            read_seq=0,
            frames_written=0,
            frames_read=0,
            frames_dropped=0,
            frames_overrun=0,
            last_write_ns=0,
        )
        # Vistas criadas uma única vez: o *hot path* não aloca nada.
        self._views: tuple[npt.NDArray[np.generic], ...] = tuple(
            layout_module.frame_view(self._buffer, self._layout, index, self._header)
            for index in range(n_slots)
        )
        self._write_index = 0
        self._write_slot: int | None = None
        self._lease: int | None = None
        self._lease_seq = 0
        self._unlink_registered = False

    # ------------------------------------------------------------- construção

    @classmethod
    def create(
        cls,
        *,
        name: str | None = None,
        n_slots: int = DEFAULT_SLOTS,
        height: int,
        width: int,
        channels: int = 3,
        dtype: npt.DTypeLike = np.uint8,
    ) -> ShmRing:
        """Cria o segmento de memória partilhada e publica o cabeçalho do anel.

        Args:
            name: nome do segmento (gerado quando omitido).
            n_slots: número de slots.
            height: altura do frame em píxeis.
            width: largura do frame em píxeis.
            channels: canais por píxel.
            dtype: tipo dos píxeis (`uint8` para BGR, `float32` para tensores).

        Returns:
            O anel pronto a escrever, com posse do segmento.

        Raises:
            ValueError: se as dimensões ou o tipo não forem válidos.
        """
        layout = layout_module.compute_layout(
            n_slots, layout_module.frame_bytes(height, width, channels, np.dtype(dtype))
        )
        ring_name = name or make_ring_name()
        block = shared_memory.SharedMemory(name=ring_name, create=True, size=layout.total_bytes)
        ring = cls(
            block,
            n_slots=n_slots,
            height=height,
            width=width,
            channels=channels,
            dtype=dtype,
            owns=True,
        )
        layout_module.write_header(ring._buffer, ring._header)
        ring._register_unlink_on_exit()
        logger.debug(
            "Anel '%s' criado: %d slots de %d bytes (total %d bytes).",
            ring_name,
            n_slots,
            layout.slot_bytes,
            layout.total_bytes,
        )
        return ring

    @classmethod
    def attach(cls, name: str) -> ShmRing:
        """Anexa-se a um anel existente, validando o cabeçalho antes de o usar.

        Args:
            name: nome do segmento criado pelo outro processo.

        Returns:
            O anel pronto a usar (sem posse: `unlink` é recusado).

        Raises:
            RingBufferLayoutError: se o cabeçalho não corresponder a este layout.
            FileNotFoundError: se o segmento não existir.
        """
        block = shared_memory.SharedMemory(name=name)
        buffer = block.buf
        if buffer is None:  # pragma: no cover - impossível logo após abrir o segmento
            block.close()
            raise RingBufferClosedError(name)
        try:
            header = layout_module.read_header(buffer)
            _validate_attached_header(header, segment_bytes=block.size, name=name)
        except (RingBufferLayoutError, KeyError, ValueError) as exc:
            block.close()
            if isinstance(exc, RingBufferLayoutError):
                raise RingBufferLayoutError(name, exc.reason) from exc
            raise RingBufferLayoutError(name, str(exc)) from exc

        # A validação acima garante que o tamanho do segmento chega para o layout; a
        # construção só falharia com geometria impossível, já filtrada.
        ring = cls(
            block,
            n_slots=header.n_slots,
            height=header.frame_height,
            width=header.frame_width,
            channels=header.channels,
            dtype=header.dtype,
            owns=False,
        )
        logger.debug(
            "Anel '%s' anexado: %d slots, frame %dx%dx%d.",
            name,
            header.n_slots,
            header.frame_width,
            header.frame_height,
            header.channels,
        )
        return ring

    # ------------------------------------------------------------ propriedades

    @property
    def name(self) -> str:
        """Nome do segmento de memória partilhada."""
        return self._shm.name

    @property
    def n_slots(self) -> int:
        """Número de slots do anel."""
        return self._header.n_slots

    @property
    def layout(self) -> RingLayout:
        """Geometria do anel (cabeçalho, registos e zona de dados)."""
        return self._layout

    @property
    def frame_shape(self) -> tuple[int, int, int]:
        """Forma de um frame: ``(altura, largura, canais)``."""
        return self._header.shape

    @property
    def dtype(self) -> np.dtype[np.generic]:
        """Tipo dos píxeis guardados no anel."""
        return self._header.dtype

    @property
    def is_owner(self) -> bool:
        """`True` se este processo criou o segmento (e pode `unlink`)."""
        return self._owns_block

    @property
    def is_closed(self) -> bool:
        """`True` depois de :meth:`close`."""
        return self._closed

    @property
    def has_lease(self) -> bool:
        """`True` se o consumidor tem um slot arrendado por libertar."""
        return self._lease is not None

    def stats(self) -> RingStats:
        """Lê os contadores do segmento.

        Returns:
            Instantâneo dos contadores. Os campos são lidos individualmente: com os
            dois processos ativos o instantâneo pode apanhar um contador uma unidade
            à frente do outro (aceitável para telemetria, nunca para decisões).

        Raises:
            RingBufferClosedError: se o anel já tiver sido fechado.
        """
        self._require_open()
        header = self._read_header()
        pending = header.read_seq < header.write_seq
        return RingStats(
            write_seq=header.write_seq,
            read_seq=header.read_seq,
            frames_written=header.frames_written,
            frames_read=header.frames_read,
            frames_dropped=header.frames_dropped,
            frames_overrun=header.frames_overrun,
            last_write_ns=header.last_write_ns,
            pending=pending,
            skipped_by_reader=max(0, header.write_seq - header.read_seq - int(pending)),
        )

    def read_slot(self, index: int) -> SlotRecord:
        """Lê os metadados de um slot (diagnóstico e testes).

        Args:
            index: índice do slot.

        Returns:
            O registo do slot.

        Raises:
            RingBufferClosedError: se o anel já tiver sido fechado.
            IndexError: se o índice estiver fora do anel.
        """
        self._require_open()
        return layout_module.read_slot_record(self._buffer, self._layout, index)

    # --------------------------------------------------------------- produção

    def acquire_write(self) -> FrameSlot:
        """Obtém um slot exclusivo para escrever o próximo frame.

        Nunca espera: se todos os slots estiverem em leitura, esse é o sinal de que o
        consumidor está atrasado e o frame novo deve ser descartado.

        Returns:
            O slot reservado, com a vista NumPy pronta a escrever.

        Raises:
            RingBufferFullError: se todos os slots estiverem em leitura.
            RingBufferStateError: se já existir um `acquire_write` por publicar.
            RingBufferClosedError: se o anel já tiver sido fechado.
        """
        self._require_open()
        if self._write_slot is not None:
            raise RingBufferStateError(
                self.name,
                "acquire_write",
                f"o slot {self._write_slot} ainda não foi publicado com commit()",
            )

        index = self._find_writable_slot()
        if index is None:
            self._bump_counter("frames_overrun")
            raise RingBufferFullError(self._header.n_slots)
        return self._reserve_slot(index)

    def _find_writable_slot(self) -> int | None:
        """Procura o próximo slot que o produtor possa usar.

        Percorre os slots a partir da posição corrente (round-robin) e ignora os que
        estão em leitura. Um slot ``READY`` reutilizado conta como `frames_dropped`:
        o frame que lá estava foi publicado e nunca chegou ao consumidor.

        Returns:
            Índice do slot a usar, ou `None` se todos estiverem em leitura.
        """
        n_slots = self._header.n_slots
        for offset in range(n_slots):
            index = (self._write_index + offset) % n_slots
            record = layout_module.read_slot_record(self._buffer, self._layout, index)
            if record.state is SlotState.READING:
                continue
            if record.state is SlotState.READY:
                self._bump_counter("frames_dropped")
            return index
        return None

    def _reserve_slot(self, index: int) -> FrameSlot:
        """Marca o slot como `WRITING` e devolve a vista para escrita.

        Args:
            index: índice do slot escolhido.

        Returns:
            O slot reservado (com a sequência ainda do frame anterior).
        """
        layout_module.write_slot_state(self._buffer, self._layout, index, SlotState.WRITING)
        self._write_slot = index
        self._write_index = (index + 1) % self._header.n_slots
        record = layout_module.read_slot_record(self._buffer, self._layout, index)
        return FrameSlot(
            index=index,
            seq=record.seq,
            t_capture_ns=record.t_capture_ns,
            frame=self._views[index],
        )

    def commit(self, *, t_capture_ns: int | None = None) -> int:
        """Publica o frame escrito no slot reservado.

        A ordem de escrita é a parte crítica do protocolo: os píxeis já estão no
        lugar, seguem-se o instante de captura, a sequência e o estado ``READY``. O
        consumidor só considera o frame depois de ver a sequência nova.

        Args:
            t_capture_ns: instante de captura em nanosegundos (por omissão,
                `time.perf_counter_ns()`).

        Returns:
            A sequência do frame publicado (começa em 1).

        Raises:
            RingBufferStateError: se não existir nenhum `acquire_write` pendente.
            RingBufferClosedError: se o anel já tiver sido fechado.
        """
        self._require_open()
        if self._write_slot is None:
            raise RingBufferStateError(
                self.name,
                "commit",
                "não existe nenhum acquire_write pendente (chame acquire_write() primeiro)",
            )
        index = self._write_slot
        # `perf_counter_ns` é o relógio das latências (protocolo §3, regra 7): monotónico,
        # ao contrário de `time.time()`, que salta com ajustes do sistema.
        capture_ns = int(t_capture_ns) if t_capture_ns is not None else time.perf_counter_ns()
        seq = layout_module.read_header_field(self._buffer, "write_seq") + 1

        layout_module.write_slot_capture_time(self._buffer, self._layout, index, capture_ns)
        layout_module.write_slot_seq(self._buffer, self._layout, index, seq)
        layout_module.write_slot_state(self._buffer, self._layout, index, SlotState.READY)

        # Só campos do produtor: os contadores do consumidor não são tocados aqui.
        layout_module.write_header_field(self._buffer, "write_seq", seq)
        layout_module.write_header_field(
            self._buffer,
            "frames_written",
            layout_module.read_header_field(self._buffer, "frames_written") + 1,
        )
        layout_module.write_header_field(self._buffer, "last_write_ns", capture_ns)

        self._write_slot = None
        return seq

    # --------------------------------------------------------------- consumo

    def acquire_read(self, *, latest: bool = True) -> FrameSlot | None:
        """Arrenda o frame mais recente (ou o seguinte) para leitura.

        Args:
            latest: quando `True` (política de tempo real), salta todos os frames
                intermédios e devolve o último publicado. Quando `False`, devolve
                exatamente o frame seguinte ao último entregue — útil para análise de
                vídeo offline, em que saltar frames seria perder dados.

        Returns:
            O slot arrendado, ou `None` quando não há nada novo para ler (ou quando
                todas as tentativas foram perdidas para o produtor — nesse caso o mais
                honesto é dizer «nada disponível», não entregar um frame rasgado).

        Raises:
            TornFrameError: em modo `latest=False`, se o frame seguinte ao último
                entregue já tiver sido substituído (perda de dados tem de ser dita).
            RingBufferStateError: se já existir uma lease por libertar.
            RingBufferClosedError: se o anel já tiver sido fechado.
        """
        self._require_open()
        if self._lease is not None:
            raise RingBufferStateError(
                self.name,
                "acquire_read",
                f"o slot {self._lease} ainda está arrendado (chame release() primeiro)",
            )

        if not latest:
            return self._acquire_next_frame()

        # Em tempo real o consumidor quer o frame mais recente: se o produtor o
        # substituiu entretanto (consumidor atrasado), recomeça-se do cabeçalho em vez
        # de falhar — o objetivo é mostrar imagem fresca, não a que existia há 30 ms.
        for _attempt in range(_FIND_SLOT_ATTEMPTS):
            write_seq = layout_module.read_header_field(self._buffer, "write_seq")
            read_seq = layout_module.read_header_field(self._buffer, "read_seq")
            if write_seq == 0 or read_seq >= write_seq:
                return None
            index = self._find_slot_with_seq(write_seq)
            if index is None:
                continue
            lease = self._lease_slot(index, write_seq)
            if lease is not None:
                return lease
        logger.debug(
            "Anel '%s': %d tentativas perdidas para o produtor; sem frame nesta passagem.",
            self.name,
            _FIND_SLOT_ATTEMPTS,
        )
        return None

    def _acquire_next_frame(self) -> FrameSlot | None:
        """Arrenda exatamente o frame seguinte ao último entregue (modo offline).

        Returns:
            O slot arrendado, ou `None` se não houver nada novo.

        Raises:
            TornFrameError: se o frame esperado já tiver sido substituído — em modo
                sequencial isso é perda de dados e tem de ser reportado, nunca
                saltado em silêncio (um relatório com frames em falta deve dizê-lo).
        """
        write_seq = layout_module.read_header_field(self._buffer, "write_seq")
        read_seq = layout_module.read_header_field(self._buffer, "read_seq")
        if write_seq == 0 or read_seq >= write_seq:
            return None

        target_seq = read_seq + 1
        index = self._find_slot_with_seq(target_seq)
        if index is None:
            raise TornFrameError(-1, target_seq, write_seq)
        lease = self._lease_slot(index, target_seq)
        if lease is None:
            raise TornFrameError(index, target_seq, self._write_seq_now())
        return lease

    def _lease_slot(self, index: int, seq: int) -> FrameSlot | None:
        """Reclama o slot e confirma que ainda contém o frame `seq`.

        A ordem importa: reclamar **primeiro** (``READING``) e só depois ler os
        metadados reduz ao mínimo a janela em que o produtor e o consumidor se cruzam
        — o produtor salta slots marcados, mas a marca não é atómica. Quando a
        verificação falha, o slot é devolvido ao produtor como ``READY`` (o frame não
        lido será contado como perdido quando for reutilizado).

        Args:
            index: índice do slot localizado pela sequência.
            seq: sequência do frame a entregar.

        Returns:
            O slot entregue ao consumidor, ou `None` se o produtor o reescreveu
            entretanto (frame perdido, sem valor rasgado a devolver).
        """
        layout_module.write_slot_state(self._buffer, self._layout, index, SlotState.READING)
        try:
            record = self._read_stable_record(index, seq)
        except TornFrameError:
            layout_module.write_slot_state(self._buffer, self._layout, index, SlotState.READY)
            return None

        layout_module.write_header_field(self._buffer, "read_seq", seq)
        layout_module.write_header_field(
            self._buffer,
            "frames_read",
            layout_module.read_header_field(self._buffer, "frames_read") + 1,
        )

        self._lease = index
        self._lease_seq = seq
        return FrameSlot(
            index=index,
            seq=seq,
            t_capture_ns=record.t_capture_ns,
            frame=self._views[index],
        )

    def _write_seq_now(self) -> int:
        """Lê a sequência publicada atual (auxiliar das mensagens de erro)."""
        return layout_module.read_header_field(self._buffer, "write_seq")

    def _find_slot_with_seq(self, seq: int) -> int | None:
        """Localiza o slot que contém a sequência pretendida.

        O produtor salta slots que estão em leitura, pelo que o índice do slot **não**
        é `seq % n_slots` — a sequência é o único identificador fiável. A procura
        custa `n_slots` leituras de 8 bytes (três slots: ~ns por frame).

        Args:
            seq: sequência a procurar (sempre >= 1: 0 significa slot virgem).

        Returns:
            Índice do slot, ou `None` se a sequência já não existir no anel.
        """
        for index in range(self._header.n_slots):
            if layout_module.read_slot_seq(self._buffer, self._layout, index) == seq:
                return index
        return None

    def _read_stable_record(self, index: int, expected_seq: int) -> SlotRecord:
        """Lê os metadados de um slot confirmando que o frame não foi substituído.

        Padrão de *seqlock* simplificado: lê a sequência, lê os metadados, volta a ler
        a sequência. Se mudou, o produtor reescreveu o slot a meio e o frame não é
        utilizável (nunca se devolve um valor possivelmente rasgado).

        Args:
            index: índice do slot.
            expected_seq: sequência que o consumidor espera encontrar.

        Returns:
            Os metadados do slot.

        Raises:
            TornFrameError: se a sequência observada não for a esperada.
        """
        for _attempt in range(3):
            seq_before = layout_module.read_slot_seq(self._buffer, self._layout, index)
            record = layout_module.read_slot_record(self._buffer, self._layout, index)
            seq_after = layout_module.read_slot_seq(self._buffer, self._layout, index)
            if seq_before == seq_after == record.seq:
                if record.seq != expected_seq:
                    raise TornFrameError(index, expected_seq, record.seq)
                return record
        raise TornFrameError(
            index, expected_seq, layout_module.read_slot_seq(self._buffer, self._layout, index)
        )

    def release(self, slot: FrameSlot | None = None) -> bool:
        """Devolve o slot arrendado e indica se o frame se manteve íntegro.

        A verificação da sequência acontece aqui, no fim do trabalho do consumidor. O
        contrato para quem consome é: **computar dentro da lease, decidir depois**. Se
        o resultado só for usado quando este método devolver `True`, nunca se usa um
        frame rasgado; se devolver `False`, o frame é descartado (e o produtor já
        poderá reutilizar o slot).

        Args:
            slot: slot devolvido por `acquire_read`; quando omitido, liberta a lease
                ativa deste processo.

        Returns:
            `True` se o frame não foi tocado pelo produtor durante a leitura; `False`
            se foi reescrito (dados possivelmente misturados, a descartar).

        Raises:
            RingBufferStateError: se não existir lease, ou se o slot não corresponder.
            RingBufferClosedError: se o anel já tiver sido fechado.
        """
        self._require_open()
        if self._lease is None:
            raise RingBufferStateError(self.name, "release", "não existe lease ativa")
        if slot is not None and slot.index != self._lease:
            raise RingBufferStateError(
                self.name,
                "release",
                f"slot {slot.index} não corresponde à lease ativa (slot {self._lease})",
            )

        index = self._lease
        expected_seq = self._lease_seq
        observed_seq = layout_module.read_slot_seq(self._buffer, self._layout, index)
        stable = observed_seq == expected_seq
        if not stable:
            logger.debug(
                "Anel '%s': o slot %d foi reescrito durante a leitura (esperava %d, vi %d).",
                self.name,
                index,
                expected_seq,
                observed_seq,
            )

        # Estável → o slot está livre para reutilização. Instável → o slot contém um
        # frame publicado que ninguém leu: fica `READY` para o produtor contar a perda
        # ao reutilizá-lo (marcá-lo `EMPTY` esconderia o descarte da telemetria).
        layout_module.write_slot_state(
            self._buffer,
            self._layout,
            index,
            SlotState.EMPTY if stable else SlotState.READY,
        )
        self._lease = None
        return stable

    # --------------------------------------------------------------- limpeza

    def close(self) -> None:
        """Fecha o segmento neste processo (o segmento só desaparece com `unlink`).

        Libertar as vistas antes de fechar evita ``BufferError: cannot close exported
        pointers exist``, um erro fácil de introduzir e difícil de diagnosticar.
        """
        if self._closed:
            return
        self._closed = True
        self._views = ()
        try:
            self._buffer.release()
        except BufferError:  # pragma: no cover - caminho defensivo
            logger.warning("Não foi possível libertar a vista do anel '%s'.", self.name)
        self._shm.close()

    def unlink(self) -> None:
        """Remove o segmento do sistema (apenas o processo criador).

        Raises:
            RingBufferOwnershipError: se este processo não for o dono.
            RingBufferClosedError: se o anel já tiver sido fechado.
        """
        self._require_open()
        if not self._owns_block:
            raise RingBufferOwnershipError(self.name, "unlink")
        self._shm.unlink()
        self._unlink_registered = False

    def shutdown(self) -> None:
        """Fecha e (sendo dono) remove o segmento, de forma idempotente.

        É o caminho usado no encerramento da aplicação e nos testes: garante que não
        ficam segmentos órfãos no sistema, mesmo que o consumidor tenha morrido.
        """
        if self._closed:
            return
        self.close()
        if self._owns_block:
            try:
                self._shm.unlink()
            except FileNotFoundError:
                # Já removido (duplo `shutdown` durante o encerramento).
                logger.debug("Segmento '%s' já não existia ao remover.", self.name)
            self._unlink_registered = False

    def __enter__(self) -> Self:
        """Permite `with ShmRing.create(...) as ring:` com fecho garantido."""
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        """Fecha e remove o segmento ao sair do bloco `with`."""
        self.shutdown()

    def __repr__(self) -> str:
        """Representação legível, com o estado útil para diagnóstico."""
        height, width, channels = self._header.shape
        if self._closed:
            state = "fechado"
        else:
            state = f"write_seq={layout_module.read_header_field(self._buffer, 'write_seq')}"
        return (
            f"ShmRing(name={self.name!r}, shape={height}x{width}x{channels}, "
            f"slots={self._header.n_slots}, owner={self._owns_block}, {state})"
        )

    # ------------------------------------------------------------- auxiliares

    def _read_header(self) -> RingHeader:
        """Lê o cabeçalho do segmento (validação de tamanho incluída).

        Returns:
            O cabeçalho descodificado.
        """
        return layout_module.read_header(self._buffer)

    def _require_open(self) -> None:
        """Garante que o anel ainda pode ser usado.

        Raises:
            RingBufferClosedError: se o anel já tiver sido fechado.
        """
        if self._closed:
            raise RingBufferClosedError(self.name)

    def _bump_counter(self, field: str, amount: int = 1) -> None:
        """Incrementa um contador do cabeçalho, campo a campo.

        Args:
            field: nome do contador (ex.: `frames_dropped`).
            amount: incremento.
        """
        current = layout_module.read_header_field(self._buffer, field)
        layout_module.write_header_field(self._buffer, field, current + amount)

    def _register_unlink_on_exit(self) -> None:
        """Regista o `unlink` no encerramento do interpretador (última rede de segurança).

        Sem isto, um caminho de erro que não passe pelo `shutdown` deixaria o segmento
        no sistema para sempre — exatamente o tipo de fuga que só se nota semanas
        depois, quando o disco enche.
        """
        if self._unlink_registered:
            return
        atexit.register(_unlink_silently, self.name)
        self._unlink_registered = True


def _validate_attached_header(header: RingHeader, *, segment_bytes: int, name: str) -> None:
    """Valida o cabeçalho de um segmento alheio antes de construir vistas sobre ele.

    Porquê validar tudo **antes** de construir o anel: as vistas NumPy são criadas no
    construtor e uma geometria incoerente (por exemplo, ``slot_bytes`` que não
    corresponde a ``h×w×c``) produziria vistas sobre memória que não é um frame — o
    consumidor lería lixo numérico sem qualquer aviso. Aqui falha-se alto e cedo.

    Args:
        header: cabeçalho lido do segmento.
        segment_bytes: tamanho real do segmento (o Windows arredonda para a página,
            pelo que pode ser maior do que o pedido).
        name: nome do segmento (contexto das mensagens de erro).

    Raises:
        RingBufferLayoutError: se algo no cabeçalho não for coerente com este layout.
    """
    if header.magic != MAGIC:
        raise RingBufferLayoutError(
            name,
            f"magic inesperado 0x{header.magic:016X} (esperado 0x{MAGIC:016X}): "
            "o segmento não é um anel de frames",
        )
    if header.layout_version != LAYOUT_VERSION:
        raise RingBufferLayoutError(
            name,
            f"versão de layout {header.layout_version} != {LAYOUT_VERSION} "
            "(produtor e consumidor com binários diferentes)",
        )

    expected_frame_bytes = layout_module.frame_bytes(
        header.frame_height, header.frame_width, header.channels, header.dtype
    )
    if expected_frame_bytes != header.slot_bytes:
        raise RingBufferLayoutError(
            name,
            f"slot_bytes={header.slot_bytes} não corresponde a "
            f"{header.frame_height}x{header.frame_width}x{header.channels} "
            f"{header.dtype} ({expected_frame_bytes} bytes)",
        )

    expected = layout_module.compute_layout(header.n_slots, header.slot_bytes)
    declared = (header.header_bytes, header.slot_record_bytes, header.data_offset)
    computed = (expected.header_bytes, expected.slot_record_bytes, expected.data_offset)
    if declared != computed:
        raise RingBufferLayoutError(
            name,
            f"geometria declarada {declared} difere da calculada {computed}",
        )
    if segment_bytes < expected.total_bytes:
        raise RingBufferLayoutError(
            name,
            f"segmento com {segment_bytes} bytes é mais pequeno que os "
            f"{expected.total_bytes} bytes exigidos por {header.n_slots} slots "
            f"de {header.slot_bytes} bytes",
        )


def _unlink_silently(name: str) -> None:
    """Remove um segmento de memória partilhada ignorando ausência e erros tardios.

    Existe apenas para o `atexit`: no encerramento do interpretador não há contexto
    para reportar falhas, e um segmento já removido não é um problema.

    Args:
        name: nome do segmento.
    """
    try:
        block = shared_memory.SharedMemory(name=name)
    except FileNotFoundError:
        return
    except OSError as exc:  # pragma: no cover - caminho defensivo
        logger.debug("Não foi possível abrir '%s' no encerramento: %s", name, exc)
        return
    try:
        block.close()
        block.unlink()
    except (FileNotFoundError, OSError) as exc:  # pragma: no cover - caminho defensivo
        logger.debug("Não foi possível remover '%s' no encerramento: %s", name, exc)
