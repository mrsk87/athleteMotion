"""Testes do layout binário do anel: offsets, contadores e vistas NumPy.

Estes testes fixam o **protocolo em bytes**. Se alguém acrescentar um campo ao
cabeçalho sem o documentar, o teste do tamanho e dos offsets falha antes de o erro
chegar a um processo de inferência a ler lixo.
"""

from __future__ import annotations

import struct

import numpy as np
import pytest

from athletemotion_desktop.runtime.ring_buffer import layout as ring_layout
from athletemotion_desktop.runtime.ring_buffer.errors import RingBufferLayoutError
from athletemotion_desktop.runtime.ring_buffer.layout import (
    DATA_ALIGNMENT,
    HEADER_FIELDS,
    HEADER_STRUCT,
    MAGIC,
    SLOT_RECORD_STRUCT,
    SlotState,
    align_up,
    compute_layout,
    dtype_code_for,
    frame_bytes,
    frame_view,
    read_header,
    read_header_field,
    read_slot_record,
    read_slot_seq,
    slot_data_offset,
    slot_record_offset,
    write_header,
    write_header_field,
    write_slot_capture_time,
    write_slot_seq,
    write_slot_state,
)


def _buffer(layout: ring_layout.RingLayout) -> memoryview:
    """Cria um bloco de bytes do tamanho do layout (substituto do segmento real)."""
    return memoryview(bytearray(layout.total_bytes))


def test_header_field_offsets_are_the_documented_ones() -> None:
    """Os offsets dos campos são o contrato entre produtor e consumidor."""
    assert HEADER_FIELDS[0] == "magic"
    assert HEADER_FIELDS[1] == "layout_version"
    assert ring_layout.HEADER_FIELD_TABLE["magic"] == (0, "<Q")
    assert ring_layout.HEADER_FIELD_TABLE["layout_version"] == (8, "<I")
    assert ring_layout.HEADER_FIELD_TABLE["n_slots"] == (12, "<I")
    assert ring_layout.HEADER_FIELD_TABLE["slot_bytes"] == (16, "<Q")
    assert ring_layout.HEADER_FIELD_TABLE["frame_width"] == (24, "<I")
    assert ring_layout.HEADER_FIELD_TABLE["frame_height"] == (28, "<I")
    assert ring_layout.HEADER_FIELD_TABLE["channels"] == (32, "<I")
    assert ring_layout.HEADER_FIELD_TABLE["dtype_code"] == (36, "<I")
    assert ring_layout.HEADER_FIELD_TABLE["write_seq"] == (64, "<Q")
    assert ring_layout.HEADER_FIELD_TABLE["last_write_ns"] == (112, "<Q")


def test_header_size_matches_its_fields() -> None:
    """O cabeçalho tem exatamente um campo por entrada declarada, sem padding."""
    assert HEADER_STRUCT.size == 120
    assert len(HEADER_FIELDS) == len(HEADER_STRUCT.format) - 1
    assert SLOT_RECORD_STRUCT.size == 24


def test_compute_layout_aligns_data_area() -> None:
    """A zona de dados começa alinhada a 8 bytes (vistas NumPy sem surpresas)."""
    layout = compute_layout(n_slots=3, slot_bytes=60)

    assert layout.header_bytes == HEADER_STRUCT.size
    assert layout.records_offset == HEADER_STRUCT.size
    assert layout.data_offset % DATA_ALIGNMENT == 0
    assert layout.data_offset >= layout.records_offset + 3 * SLOT_RECORD_STRUCT.size
    assert layout.total_bytes == layout.data_offset + 3 * 60


def test_compute_layout_rejects_impossible_rings() -> None:
    """Um anel com menos de dois slots não consegue garantir escrita e leitura."""
    with pytest.raises(ValueError, match="n_slots=1 é insuficiente"):
        compute_layout(n_slots=1, slot_bytes=60)

    with pytest.raises(ValueError, match="slot_bytes=0 inválido"):
        compute_layout(n_slots=3, slot_bytes=0)


def test_frame_bytes_and_dtype_codes() -> None:
    """O tamanho do frame e o código do tipo acompanham o `dtype` pedido."""
    assert frame_bytes(720, 1280, 3, np.dtype(np.uint8)) == 720 * 1280 * 3
    assert frame_bytes(4, 5, 3, np.dtype(np.float32)) == 4 * 5 * 3 * 4
    assert dtype_code_for(np.uint8) == ring_layout.DTYPE_UINT8
    assert dtype_code_for(np.float32) == ring_layout.DTYPE_FLOAT32

    with pytest.raises(ValueError, match="não suportado"):
        dtype_code_for(np.float64)

    with pytest.raises(ValueError, match="Dimensões de frame inválidas"):
        frame_bytes(0, 1280, 3, np.dtype(np.uint8))


def test_align_up_rounds_to_multiple_and_rejects_bad_alignment() -> None:
    """O alinhamento é sempre para o múltiplo seguinte (nunca para baixo)."""
    assert align_up(1, 8) == 8
    assert align_up(8, 8) == 8
    assert align_up(9, 8) == 16

    with pytest.raises(ValueError, match="Alinhamento inválido"):
        align_up(8, 0)


def test_header_round_trip() -> None:
    """Gravar e reler o cabeçalho devolve exatamente os mesmos valores."""
    layout = compute_layout(n_slots=3, slot_bytes=60)
    buffer = _buffer(layout)
    header = ring_layout.RingHeader(
        magic=MAGIC,
        layout_version=ring_layout.LAYOUT_VERSION,
        n_slots=3,
        slot_bytes=60,
        frame_width=5,
        frame_height=4,
        channels=3,
        dtype_code=ring_layout.DTYPE_UINT8,
        header_bytes=layout.header_bytes,
        slot_record_bytes=layout.slot_record_bytes,
        data_offset=layout.data_offset,
        write_seq=41,
        read_seq=39,
        frames_written=41,
        frames_read=39,
        frames_dropped=2,
        frames_overrun=1,
        last_write_ns=123456789,
    )

    write_header(buffer, header)

    assert read_header(buffer) == header
    assert header.dtype == np.dtype(np.uint8)
    assert header.shape == (4, 5, 3)


def test_read_header_rejects_short_segment() -> None:
    """Um segmento mais curto que o cabeçalho é recusado com contexto."""
    with pytest.raises(RingBufferLayoutError, match="mais curto que o cabeçalho"):
        read_header(memoryview(bytearray(16)))


def test_single_header_field_read_and_write() -> None:
    """Contadores são atualizados campo a campo, um de cada vez."""
    layout = compute_layout(n_slots=2, slot_bytes=8)
    buffer = _buffer(layout)

    write_header_field(buffer, "frames_dropped", 3)
    write_header_field(buffer, "write_seq", 2**40)

    assert read_header_field(buffer, "frames_dropped") == 3
    assert read_header_field(buffer, "write_seq") == 2**40


def test_unknown_header_field_is_a_key_error() -> None:
    """Um nome de campo inexistente não pode passar em silêncio."""
    buffer = _buffer(compute_layout(n_slots=2, slot_bytes=8))

    with pytest.raises(KeyError):
        read_header_field(buffer, "campo_que_nao_existe")

    with pytest.raises(KeyError):
        write_header_field(buffer, "campo_que_nao_existe", 1)


def test_slot_offsets_and_bounds() -> None:
    """Registos e dados têm offsets previsíveis, e índices inválidos falham."""
    layout = compute_layout(n_slots=3, slot_bytes=60)

    assert slot_record_offset(layout, 0) == layout.records_offset
    assert slot_record_offset(layout, 2) == layout.records_offset + 48
    assert slot_data_offset(layout, 1) == layout.data_offset + 60
    assert slot_data_offset(layout, 2) - slot_data_offset(layout, 1) == layout.slot_bytes

    with pytest.raises(IndexError, match="Índice de slot fora do anel: 3"):
        slot_record_offset(layout, 3)

    with pytest.raises(IndexError, match="Índice de slot fora do anel: -1"):
        slot_data_offset(layout, -1)


def test_slot_state_and_metadata_round_trip() -> None:
    """O estado, a sequência e o instante de captura de um slot são legíveis."""
    layout = compute_layout(n_slots=3, slot_bytes=60)
    buffer = _buffer(layout)

    write_slot_seq(buffer, layout, 1, 7)
    write_slot_state(buffer, layout, 1, SlotState.READING)
    write_slot_capture_time(buffer, layout, 1, 987654321)

    record = read_slot_record(buffer, layout, 1)

    assert read_slot_seq(buffer, layout, 1) == 7
    assert record == ring_layout.SlotRecord(
        seq=7, state=SlotState.READING, flags=0, t_capture_ns=987654321
    )


def test_frame_view_shares_memory_with_the_segment() -> None:
    """A vista do slot escreve diretamente no segmento (zero-copy, sem `copy`)."""
    layout = compute_layout(n_slots=2, slot_bytes=4 * 5 * 3)
    buffer = _buffer(layout)
    header = ring_layout.RingHeader(
        magic=MAGIC,
        layout_version=ring_layout.LAYOUT_VERSION,
        n_slots=2,
        slot_bytes=layout.slot_bytes,
        frame_width=5,
        frame_height=4,
        channels=3,
        dtype_code=ring_layout.DTYPE_UINT8,
        header_bytes=layout.header_bytes,
        slot_record_bytes=layout.slot_record_bytes,
        data_offset=layout.data_offset,
        write_seq=0,
        read_seq=0,
        frames_written=0,
        frames_read=0,
        frames_dropped=0,
        frames_overrun=0,
        last_write_ns=0,
    )

    view = frame_view(buffer, layout, 1, header)
    view[:] = 9

    raw = bytes(
        buffer[slot_data_offset(layout, 1) : slot_data_offset(layout, 1) + layout.slot_bytes]
    )

    assert raw == bytes([9]) * layout.slot_bytes
    assert not view.flags["OWNDATA"]


def test_second_slot_view_does_not_overlap_the_first() -> None:
    """Cada slot tem a sua região: escrever num não pode tocar no outro."""
    layout = compute_layout(n_slots=2, slot_bytes=12)
    buffer = _buffer(layout)
    header = ring_layout.RingHeader(
        magic=MAGIC,
        layout_version=ring_layout.LAYOUT_VERSION,
        n_slots=2,
        slot_bytes=12,
        frame_width=2,
        frame_height=2,
        channels=3,
        dtype_code=ring_layout.DTYPE_UINT8,
        header_bytes=layout.header_bytes,
        slot_record_bytes=layout.slot_record_bytes,
        data_offset=layout.data_offset,
        write_seq=0,
        read_seq=0,
        frames_written=0,
        frames_read=0,
        frames_dropped=0,
        frames_overrun=0,
        last_write_ns=0,
    )

    first = frame_view(buffer, layout, 0, header)
    second = frame_view(buffer, layout, 1, header)
    first[:] = 1
    second[:] = 2

    assert int(first.sum()) == 12
    assert int(second.sum()) == 24
    assert not np.shares_memory(first, second)


def test_slot_records_do_not_overlap_the_data_area() -> None:
    """Os registos ficam antes da zona de dados (um deslize aqui corromperia frames)."""
    layout = compute_layout(n_slots=4, slot_bytes=1024)

    last_record_end = slot_record_offset(layout, 3) + SLOT_RECORD_STRUCT.size

    assert last_record_end <= layout.data_offset
    assert struct.calcsize("<Q") == 8
