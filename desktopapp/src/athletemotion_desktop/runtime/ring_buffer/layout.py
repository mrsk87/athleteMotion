"""Layout binário do anel de frames em memória partilhada (protocolo único e explícito).

O anel é um único bloco de ``shared_memory`` dividido em três zonas::

    offset 0                                             (header_bytes)
    ┌──────────────────────────────┬───────────────────────────────────────────────┐
    │ Cabeçalho (fixo, 18 campos)  │ Registos de slot (n_slots × 24 bytes)         │
    └──────────────────────────────┴───────────────────────────────────────────────┘
    ...continuação...
    ┌──────────────────────────────────────────────────────────────────────────────┐
    │ Zona de dados: n_slots × slot_bytes  (frame 0, frame 1, … frame n-1)         │
    └──────────────────────────────────────────────────────────────────────────────┘

Cabeçalho (``HEADER_STRUCT``, little-endian, sem padding — 120 bytes):

===================  ====  =====================================================
campo                tipo  significado
===================  ====  =====================================================
magic                 u64  ``AMRING01`` — identifica o segmento como nosso
layout_version        u32  versão do layout (muda ⇒ recusa de anexação)
n_slots               u32  número de slots do anel
slot_bytes            u64  bytes de um frame (``h*w*c*itemsize``)
frame_width           u32  largura em píxeis do frame
frame_height          u32  altura em píxeis do frame
channels              u32  canais por píxel (3 = BGR/BGR-like)
dtype_code            u32  0 = uint8, 1 = float32
header_bytes          u64  tamanho desta zona (para validação)
slot_record_bytes     u64  tamanho do registo de um slot
data_offset           u64  offset do primeiro byte de dados
write_seq             u64  sequência do último frame publicado (0 = nenhum)
read_seq              u64  sequência do último frame entregue ao consumidor
frames_written        u64  total de frames publicados
frames_read           u64  total de frames entregues
frames_dropped        u64  frames publicados que o consumidor nunca leu
frames_overrun        u64  frames que o produtor não conseguiu escrever (anel cheio)
last_write_ns         u64  ``time.perf_counter_ns()`` do último ``commit``
===================  ====  =====================================================

**Regra de posse por campo (por que cada campo tem um único escritor):** o cabeçalho
é gravado **uma vez** na criação e, a partir daí, cada contador é atualizado
individualmente por quem o possui — o produtor escreve ``write_seq``,
``frames_written``, ``frames_dropped``, ``frames_overrun`` e ``last_write_ns``; o
consumidor escreve ``read_seq`` e ``frames_read``. Reempacotar o cabeçalho inteiro no
*hot path* seria um erro subtil: reescreveria os contadores do outro processo com
valores já antigos.

Registo de slot (``SLOT_RECORD_STRUCT``, 24 bytes, alinhado a 8):

===================  ====  =====================================================
campo                tipo  significado
===================  ====  =====================================================
seq                   u64  sequência do frame guardado (0 = slot virgem)
state                 u32  estado (:class:`SlotState`)
flags                 u32  reservado para uso futuro (sempre 0 hoje)
t_capture_ns          u64  instante de captura do frame (relógio da captura)
===================  ====  =====================================================

Contrato de publicação (por que ordem se escreve cada campo): o produtor escreve
**primeiro** os píxeis, **depois** ``t_capture_ns``, **depois** ``seq`` e só no fim
``state = READY``. Assim, o último campo a ficar visível é o que autoriza a leitura
(a publicação). O consumidor nunca decide pelo ``state`` sozinho: confirma também a
``seq``, que é o que deteta uma reutilização do slot a meio de uma leitura.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from enum import IntEnum
from typing import Final

import numpy as np
import numpy.typing as npt

from athletemotion_desktop.runtime.ring_buffer.errors import RingBufferLayoutError

#: Identificador binário do segmento: "AMRING01" em ASCII (big-endian na leitura).
MAGIC: Final[int] = 0x414D52494E473031

#: Versão do layout descrito neste módulo. Qualquer alteração aos campos abaixo
#: obriga a incrementar este número: um consumidor antigo deve **recusar** anexar-se
#: em vez de interpretar bytes errados como coordenadas de frame.
LAYOUT_VERSION: Final[int] = 1

#: Alinhamento da zona de dados. Manter múltiplos de 8 evita desalinhamentos nas
#: vistas NumPy (importante para o acesso vetorizado e para futuras extensões SIMD).
DATA_ALIGNMENT: Final[int] = 8

_HEADER_FORMAT: Final[str] = "<QIIQIIIIQQQQQQQQQQ"
_SLOT_RECORD_FORMAT: Final[str] = "<QIIQ"

HEADER_STRUCT: Final[struct.Struct] = struct.Struct(_HEADER_FORMAT)
SLOT_RECORD_STRUCT: Final[struct.Struct] = struct.Struct(_SLOT_RECORD_FORMAT)

#: Nomes dos campos do cabeçalho, pela ordem em que aparecem no segmento.
HEADER_FIELDS: Final[tuple[str, ...]] = (
    "magic",
    "layout_version",
    "n_slots",
    "slot_bytes",
    "frame_width",
    "frame_height",
    "channels",
    "dtype_code",
    "header_bytes",
    "slot_record_bytes",
    "data_offset",
    "write_seq",
    "read_seq",
    "frames_written",
    "frames_read",
    "frames_dropped",
    "frames_overrun",
    "last_write_ns",
)

#: Códigos de `dtype` aceites na zona de dados (o anel transporta frames crus).
DTYPE_UINT8: Final[int] = 0
DTYPE_FLOAT32: Final[int] = 1

_DTYPE_TO_CODE: Final[dict[np.dtype[np.generic], int]] = {
    np.dtype(np.uint8): DTYPE_UINT8,
    np.dtype(np.float32): DTYPE_FLOAT32,
}
_CODE_TO_DTYPE: Final[dict[int, np.dtype[np.generic]]] = {
    code: dtype for dtype, code in _DTYPE_TO_CODE.items()
}


class SlotState(IntEnum):
    """Estado de um slot, escrito pelo dono atual do slot (produtor ou consumidor)."""

    EMPTY = 0
    """Livre ou já consumido: pode ser reutilizado sem perder nada."""

    WRITING = 1
    """O produtor está a escrever os píxeis deste slot."""

    READY = 2
    """Frame completo e publicado, à espera de ser lido."""

    READING = 3
    """O consumidor tem uma *lease* ativa: o produtor deve evitar este slot."""


@dataclass(frozen=True, slots=True)
class RingLayout:
    """Geometria calculada do segmento de memória partilhada.

    Attributes:
        n_slots: número de slots do anel.
        slot_bytes: bytes de um frame.
        header_bytes: tamanho do cabeçalho (zona fixa inicial).
        slot_record_bytes: tamanho do registo de metadados de um slot.
        records_offset: offset do primeiro registo de slot.
        data_offset: offset do primeiro frame (alinhado a :data:`DATA_ALIGNMENT`).
        total_bytes: tamanho total do segmento.
    """

    n_slots: int
    slot_bytes: int
    header_bytes: int
    slot_record_bytes: int
    records_offset: int
    data_offset: int
    total_bytes: int


@dataclass(frozen=True, slots=True)
class RingHeader:
    """Conteúdo do cabeçalho do anel.

    Attributes:
        magic: identificador do segmento.
        layout_version: versão do layout.
        n_slots: número de slots.
        slot_bytes: bytes por frame.
        frame_width: largura do frame em píxeis.
        frame_height: altura do frame em píxeis.
        channels: canais por píxel.
        dtype_code: código do tipo dos píxeis (:data:`DTYPE_UINT8`/:data:`DTYPE_FLOAT32`).
        header_bytes: tamanho da zona de cabeçalho.
        slot_record_bytes: tamanho do registo de slot.
        data_offset: offset da zona de dados.
        write_seq: sequência do último frame publicado.
        read_seq: sequência do último frame entregue ao consumidor.
        frames_written: total de frames publicados.
        frames_read: total de frames entregues.
        frames_dropped: frames publicados que nunca foram lidos.
        frames_overrun: frames escritos sobre um slot em leitura.
        last_write_ns: instante do último `commit`, em `perf_counter_ns`.
    """

    magic: int
    layout_version: int
    n_slots: int
    slot_bytes: int
    frame_width: int
    frame_height: int
    channels: int
    dtype_code: int
    header_bytes: int
    slot_record_bytes: int
    data_offset: int
    write_seq: int
    read_seq: int
    frames_written: int
    frames_read: int
    frames_dropped: int
    frames_overrun: int
    last_write_ns: int

    def to_tuple(self) -> tuple[int, ...]:
        """Devolve os campos pela ordem binária do segmento (para `struct.pack_into`)."""
        return (
            self.magic,
            self.layout_version,
            self.n_slots,
            self.slot_bytes,
            self.frame_width,
            self.frame_height,
            self.channels,
            self.dtype_code,
            self.header_bytes,
            self.slot_record_bytes,
            self.data_offset,
            self.write_seq,
            self.read_seq,
            self.frames_written,
            self.frames_read,
            self.frames_dropped,
            self.frames_overrun,
            self.last_write_ns,
        )

    @property
    def dtype(self) -> np.dtype[np.generic]:
        """Tipo NumPy dos píxeis guardados na zona de dados.

        Raises:
            KeyError: se o código de tipo não for conhecido (segmento corrompido).
        """
        return _CODE_TO_DTYPE[self.dtype_code]

    @property
    def shape(self) -> tuple[int, int, int]:
        """Forma lógica de um frame: ``(altura, largura, canais)``."""
        return (self.frame_height, self.frame_width, self.channels)


@dataclass(frozen=True, slots=True)
class SlotRecord:
    """Metadados de um slot.

    Attributes:
        seq: sequência do frame guardado (0 = virgem).
        state: estado do slot.
        flags: reservado para uso futuro.
        t_capture_ns: instante de captura do frame.
    """

    seq: int
    state: SlotState
    flags: int
    t_capture_ns: int


def dtype_code_for(dtype: np.dtype[np.generic] | type[np.generic]) -> int:
    """Traduz um ``dtype`` NumPy para o código binário do anel.

    Args:
        dtype: tipo desejado para os píxeis (``np.uint8`` ou ``np.float32``).

    Returns:
        O código correspondente em (:data:`DTYPE_UINT8`, :data:`DTYPE_FLOAT32`).

    Raises:
        ValueError: se o tipo não for suportado pelo anel.
    """
    normalized = np.dtype(dtype)
    try:
        return _DTYPE_TO_CODE[normalized]
    except KeyError:
        supported = sorted(str(code) for code in _DTYPE_TO_CODE.values())
        raise ValueError(
            f"Tipo de frame não suportado pelo anel: {normalized!r}. Suportados: {supported}."
        ) from None


def frame_bytes(height: int, width: int, channels: int, dtype: np.dtype[np.generic]) -> int:
    """Calcula os bytes de um frame.

    Args:
        height: altura em píxeis.
        width: largura em píxeis.
        channels: canais por píxel.
        dtype: tipo dos píxeis.

    Returns:
        Número de bytes contíguos de um frame.

    Raises:
        ValueError: se alguma dimensão não for positiva.
    """
    if height <= 0 or width <= 0 or channels <= 0:
        raise ValueError(
            "Dimensões de frame inválidas: "
            f"altura={height}, largura={width}, canais={channels} (têm de ser positivas)."
        )
    return height * width * channels * int(np.dtype(dtype).itemsize)


def align_up(value: int, alignment: int = DATA_ALIGNMENT) -> int:
    """Arredonda `value` para o múltiplo de `alignment` seguinte.

    Args:
        value: valor a arredondar.
        alignment: alinhamento pretendido (potência de dois).

    Returns:
        O menor múltiplo de `alignment` maior ou igual a `value`.

    Raises:
        ValueError: se `alignment` não for positivo.
    """
    if alignment <= 0:
        raise ValueError(f"Alinhamento inválido: {alignment} (tem de ser positivo).")
    return ((value + alignment - 1) // alignment) * alignment


def compute_layout(n_slots: int, slot_bytes: int) -> RingLayout:
    """Calcula a geometria do segmento para `n_slots` frames de `slot_bytes`.

    Args:
        n_slots: número de slots (mínimo 3: dois para o produtor e um para a *lease*).
        slot_bytes: bytes de um frame.

    Returns:
        A geometria pronta a usar por :class:`ShmRing`.

    Raises:
        ValueError: se `n_slots` ou `slot_bytes` não forem válidos.
    """
    if n_slots < 2:
        raise ValueError(
            f"n_slots={n_slots} é insuficiente: um anel SPSC com latest-wins precisa de "
            "pelo menos 2 slots (1 em escrita + 1 em leitura)."
        )
    if slot_bytes <= 0:
        raise ValueError(f"slot_bytes={slot_bytes} inválido (tem de ser positivo).")

    records_offset = HEADER_STRUCT.size
    data_offset = align_up(records_offset + n_slots * SLOT_RECORD_STRUCT.size)
    return RingLayout(
        n_slots=n_slots,
        slot_bytes=slot_bytes,
        header_bytes=HEADER_STRUCT.size,
        slot_record_bytes=SLOT_RECORD_STRUCT.size,
        records_offset=records_offset,
        data_offset=data_offset,
        total_bytes=data_offset + n_slots * slot_bytes,
    )


def slot_record_offset(layout: RingLayout, index: int) -> int:
    """Devolve o offset do registo do slot `index`.

    Args:
        layout: geometria do anel.
        index: índice do slot.

    Returns:
        Offset em bytes dentro do segmento.

    Raises:
        IndexError: se o índice estiver fora do anel.
    """
    if not 0 <= index < layout.n_slots:
        raise IndexError(f"Índice de slot fora do anel: {index} (0..{layout.n_slots - 1}).")
    return layout.records_offset + index * layout.slot_record_bytes


def slot_data_offset(layout: RingLayout, index: int) -> int:
    """Devolve o offset dos píxeis do slot `index`.

    Args:
        layout: geometria do anel.
        index: índice do slot.

    Returns:
        Offset em bytes dentro do segmento.

    Raises:
        IndexError: se o índice estiver fora do anel.
    """
    if not 0 <= index < layout.n_slots:
        raise IndexError(f"Índice de slot fora do anel: {index} (0..{layout.n_slots - 1}).")
    return layout.data_offset + index * layout.slot_bytes


def read_header(buffer: memoryview) -> RingHeader:
    """Interpreta o cabeçalho de um segmento.

    Args:
        buffer: vista sobre o início do segmento de memória partilhada.

    Returns:
        O cabeçalho descodificado.

    Raises:
        RingBufferLayoutError: se o segmento for curto demais para conter o cabeçalho.
    """
    if len(buffer) < HEADER_STRUCT.size:
        raise RingBufferLayoutError(
            "<desconhecido>",
            f"segmento com {len(buffer)} bytes é mais curto que o cabeçalho "
            f"({HEADER_STRUCT.size} bytes)",
        )
    values = HEADER_STRUCT.unpack_from(buffer, 0)
    return RingHeader(*values)


def write_header(buffer: memoryview, header: RingHeader) -> None:
    """Grava o cabeçalho completo no segmento.

    Usada apenas na criação (o cabeçalho é imutável depois de publicado); os
    contadores são atualizados campo a campo por quem os possui.

    Args:
        buffer: vista sobre o início do segmento.
        header: cabeçalho a gravar.
    """
    HEADER_STRUCT.pack_into(buffer, 0, *header.to_tuple())


def read_slot_record(buffer: memoryview, layout: RingLayout, index: int) -> SlotRecord:
    """Lê o registo de metadados do slot `index`.

    Args:
        buffer: vista sobre o segmento.
        layout: geometria do anel.
        index: índice do slot.

    Returns:
        Os metadados do slot.
    """
    seq, state, flags, t_capture_ns = SLOT_RECORD_STRUCT.unpack_from(
        buffer, slot_record_offset(layout, index)
    )
    return SlotRecord(seq=seq, state=SlotState(state), flags=flags, t_capture_ns=t_capture_ns)


def read_slot_seq(buffer: memoryview, layout: RingLayout, index: int) -> int:
    """Lê **apenas** a sequência do slot (operação atómica de 8 bytes).

    É este o campo usado para detetar um frame rasgado: uma leitura isolada de 8 bytes
    alinhados é indivisível, ao contrário da leitura do registo completo.

    Args:
        buffer: vista sobre o segmento.
        layout: geometria do anel.
        index: índice do slot.

    Returns:
        A sequência gravada no slot.
    """
    seq = struct.unpack_from("<Q", buffer, slot_record_offset(layout, index))[0]
    return int(seq)


def write_slot_state(buffer: memoryview, layout: RingLayout, index: int, state: SlotState) -> None:
    """Grava o estado do slot (campo de 4 bytes isolado).

    Args:
        buffer: vista sobre o segmento.
        layout: geometria do anel.
        index: índice do slot.
        state: novo estado.
    """
    struct.pack_into("<I", buffer, slot_record_offset(layout, index) + 8, int(state))


def write_slot_capture_time(
    buffer: memoryview, layout: RingLayout, index: int, t_capture_ns: int
) -> None:
    """Grava o instante de captura do slot.

    Args:
        buffer: vista sobre o segmento.
        layout: geometria do anel.
        index: índice do slot.
        t_capture_ns: instante de captura em nanosegundos.
    """
    struct.pack_into("<Q", buffer, slot_record_offset(layout, index) + 16, t_capture_ns)


def write_slot_seq(buffer: memoryview, layout: RingLayout, index: int, seq: int) -> None:
    """Publica a sequência do slot — o último campo escrito antes de `READY`.

    Args:
        buffer: vista sobre o segmento.
        layout: geometria do anel.
        index: índice do slot.
        seq: sequência do frame publicado.
    """
    struct.pack_into("<Q", buffer, slot_record_offset(layout, index), seq)


def _build_header_field_table() -> dict[str, tuple[int, str]]:
    """Constrói a tabela `campo → (offset, formato)` a partir do formato declarado.

    Derivar a tabela do próprio `struct.Struct` (em vez de repetir offsets à mão)
    garante que cabeçalho e tabela nunca divergem — um erro de offset aqui
    corromperia os contadores de forma silenciosa.

    Returns:
        Dicionário com o offset e o formato `struct` de cada campo do cabeçalho.
    """
    sizes = {"Q": 8, "I": 4}
    table: dict[str, tuple[int, str]] = {}
    offset = 0
    for name, code in zip(HEADER_FIELDS, HEADER_STRUCT.format[1:], strict=True):
        table[name] = (offset, f"<{code}")
        offset += sizes[code]
    return table


#: Tabela pública `campo → (offset, formato)`, derivada de :data:`HEADER_STRUCT`.
#: É a referência do protocolo: testes e ferramentas de diagnóstico comparam-na com
#: os offsets que esperam, e é por ela que os contadores são lidos/gravados.
HEADER_FIELD_TABLE: Final[dict[str, tuple[int, str]]] = _build_header_field_table()


def read_header_field(buffer: memoryview, field: str) -> int:
    """Lê um único campo do cabeçalho sem descodificar o resto.

    Args:
        buffer: vista sobre o início do segmento.
        field: nome do campo (ver :data:`HEADER_FIELDS`).

    Returns:
        O valor do campo.

    Raises:
        KeyError: se o campo não existir no cabeçalho.
    """
    offset, fmt = HEADER_FIELD_TABLE[field]
    value = struct.unpack_from(fmt, buffer, offset)[0]
    return int(value)


def write_header_field(buffer: memoryview, field: str, value: int) -> None:
    """Grava um único campo do cabeçalho (contadores atualizados no *hot path*).

    Args:
        buffer: vista sobre o início do segmento.
        field: nome do campo.
        value: novo valor.

    Raises:
        KeyError: se o campo não existir no cabeçalho.
        RingBufferLayoutError: se a zona do campo sair fora do cabeçalho.
    """
    offset, fmt = HEADER_FIELD_TABLE[field]
    if offset + struct.calcsize(fmt) > HEADER_STRUCT.size:
        raise RingBufferLayoutError(
            field,
            f"campo '{field}' em {offset} ultrapassa o cabeçalho ({HEADER_STRUCT.size} bytes)",
        )
    struct.pack_into(fmt, buffer, offset, value)


def frame_view(
    buffer: memoryview, layout: RingLayout, index: int, header: RingHeader
) -> npt.NDArray[np.generic]:
    """Cria a vista NumPy sobre os píxeis do slot `index` (zero-copy).

    A vista é criada uma vez por slot (na criação/anexação) e reutilizada: não há
    alocação por frame no *hot path*.

    Args:
        buffer: vista sobre o segmento de memória partilhada.
        layout: geometria do anel.
        index: índice do slot.
        header: cabeçalho (dá forma e tipo à vista).

    Returns:
        Matriz ``(altura, largura, canais)`` que escreve diretamente na memória
        partilhada.
    """
    view: npt.NDArray[np.generic] = np.ndarray(
        shape=header.shape,
        dtype=header.dtype,
        buffer=buffer,
        offset=slot_data_offset(layout, index),
    )
    return view
