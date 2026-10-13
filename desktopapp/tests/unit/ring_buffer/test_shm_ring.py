"""Testes do anel SPSC num único processo: protocolo, contadores, posse e limpeza.

O teste de concorrência real (dois processos) está em `test_cross_process.py`; aqui
exercita-se o protocolo passo a passo, onde as asserções podem ser exatas.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import replace
from multiprocessing import shared_memory

import numpy as np
import pytest

from athletemotion_desktop.runtime.ring_buffer import layout as ring_layout
from athletemotion_desktop.runtime.ring_buffer.errors import (
    RingBufferClosedError,
    RingBufferFullError,
    RingBufferLayoutError,
    RingBufferOwnershipError,
    RingBufferStateError,
    TornFrameError,
)
from athletemotion_desktop.runtime.ring_buffer.layout import MAGIC, SlotState
from athletemotion_desktop.runtime.ring_buffer.shm_ring import (
    DEFAULT_SLOTS,
    ShmRing,
    list_ring_names,
    segment_exists,
)


@pytest.fixture
def ring() -> Iterator[ShmRing]:
    """Anel 4x5x3 pronto a usar, removido do sistema no fim de cada teste."""
    created = ShmRing.create(n_slots=DEFAULT_SLOTS, height=4, width=5, channels=3)
    try:
        yield created
    finally:
        created.shutdown()


def _fill(ring_instance: ShmRing, value: int) -> int:
    """Escreve um frame constante e devolve a sequência publicada."""
    slot = ring_instance.acquire_write()
    slot.frame[:] = value
    return ring_instance.commit()


def _header(
    *,
    n_slots: int,
    slot_bytes: int,
    frame_width: int,
    frame_height: int,
    channels: int,
    magic: int = MAGIC,
    layout_version: int = ring_layout.LAYOUT_VERSION,
) -> ring_layout.RingHeader:
    """Constrói um cabeçalho de teste com a geometria indicada."""
    return ring_layout.RingHeader(
        magic=magic,
        layout_version=layout_version,
        n_slots=n_slots,
        slot_bytes=slot_bytes,
        frame_width=frame_width,
        frame_height=frame_height,
        channels=channels,
        dtype_code=ring_layout.DTYPE_UINT8,
        header_bytes=ring_layout.HEADER_STRUCT.size,
        slot_record_bytes=ring_layout.SLOT_RECORD_STRUCT.size,
        data_offset=192,
        write_seq=0,
        read_seq=0,
        frames_written=0,
        frames_read=0,
        frames_dropped=0,
        frames_overrun=0,
        last_write_ns=0,
    )


def test_create_and_attach_share_the_layout(ring: ShmRing) -> None:
    """O consumidor anexa-se ao mesmo layout: forma, tipo e número de slots iguais."""
    with ShmRing.attach(ring.name) as consumer:
        assert consumer.is_owner is False
        assert ring.is_owner is True
        assert consumer.n_slots == ring.n_slots
        assert consumer.frame_shape == (4, 5, 3)
        assert consumer.dtype == np.dtype(np.uint8)
        assert consumer.layout.total_bytes == ring.layout.total_bytes


def test_attach_rejects_a_foreign_segment() -> None:
    """Um segmento sem o nosso `magic` é recusado em vez de interpretado às cegas."""
    name = "psm_amring_teste_magic"
    block = shared_memory.SharedMemory(name=name, create=True, size=4096)
    try:
        buffer = block.buf
        assert buffer is not None
        ring_layout.write_header(
            buffer,
            _header(
                n_slots=2, slot_bytes=12, frame_width=2, frame_height=2, channels=3, magic=MAGIC + 1
            ),
        )

        with pytest.raises(RingBufferLayoutError, match="magic inesperado"):
            ShmRing.attach(name)
    finally:
        block.close()
        block.unlink()


def test_attach_rejects_a_different_layout_version() -> None:
    """Produtor e consumidor com versões de layout diferentes não podem conversar."""
    ring = ShmRing.create(name="psm_amring_teste_versao", n_slots=2, height=2, width=2)
    try:
        ring_layout.write_header_field(ring._buffer, "layout_version", 99)
        with pytest.raises(RingBufferLayoutError, match="versão de layout 99"):
            ShmRing.attach(ring.name)
    finally:
        ring.shutdown()


def test_attach_rejects_a_segment_smaller_than_the_layout() -> None:
    """Um segmento mais pequeno do que o layout pedido falha com contexto, não com lixo.

    No Windows a alocação é arredondada para a granularidade de página, pelo que só um
    layout declaradamente maior do que o segmento permite exercitar o caminho.
    """
    name = "psm_amring_teste_curto"
    block = shared_memory.SharedMemory(name=name, create=True, size=4096)
    try:
        buffer = block.buf
        assert buffer is not None
        ring_layout.write_header(
            buffer,
            _header(n_slots=3, slot_bytes=100_000, frame_width=100, frame_height=1000, channels=1),
        )

        with pytest.raises(RingBufferLayoutError, match="mais pequeno que os"):
            ShmRing.attach(name)
    finally:
        block.close()
        block.unlink()


def test_round_trip_updates_counters_and_slot_state(ring: ShmRing) -> None:
    """Um frame escrito chega inteiro ao consumidor, com o instante de captura."""
    with ShmRing.attach(ring.name) as consumer:
        seq = _fill(ring, 7)
        assert seq == 1

        lease = consumer.acquire_read()
        assert lease is not None
        assert lease.seq == 1
        assert int(lease.frame.sum()) == 7 * 60
        assert ring.read_slot(lease.index).state is SlotState.READING

        consumer.release(lease)
        assert ring.read_slot(lease.index).state is SlotState.EMPTY
        assert consumer.acquire_read() is None

        stats = ring.stats()
        assert stats.write_seq == 1
        assert stats.read_seq == 1
        assert stats.frames_written == 1
        assert stats.frames_read == 1
        assert stats.frames_dropped == 0
        assert stats.pending is False
        assert stats.skipped_by_reader == 0


def test_capture_timestamp_travels_with_the_frame(ring: ShmRing) -> None:
    """O instante de captura é do produtor (não do consumo), como exige o protocolo."""
    with ShmRing.attach(ring.name) as consumer:
        slot = ring.acquire_write()
        slot.frame[:] = 1
        ring.commit(t_capture_ns=555_000)

        lease = consumer.acquire_read()

        assert lease is not None
        assert lease.t_capture_ns == 555_000


def test_latest_wins_skips_intermediate_frames(ring: ShmRing) -> None:
    """Em tempo real o consumidor recebe a imagem fresca e conta as que saltou."""
    with ShmRing.attach(ring.name) as consumer:
        for value in (1, 2, 3, 4, 5):
            _fill(ring, value)

        # Antes de ler é que a defasagem é observável: 5 publicados, 0 entregues.
        before = ring.stats()
        assert before.skipped_by_reader == 4

        lease = consumer.acquire_read(latest=True)

        assert lease is not None
        assert lease.seq == 5
        assert int(lease.frame.sum()) == 5 * 60
        consumer.release(lease)

        after = ring.stats()
        assert after.write_seq == 5
        assert after.read_seq == 5
        assert after.skipped_by_reader == 0
        # Duas escritas reutilizaram slots que ninguém leu: frames perdidos de propósito.
        assert after.frames_dropped == 2


def test_sequential_reader_reports_lost_frames(ring: ShmRing) -> None:
    """Em modo offline, um frame substituído antes de ser lido é um erro, não um salto."""
    with ShmRing.attach(ring.name) as consumer:
        for _ in range(6):
            _fill(ring, 1)

        with pytest.raises(TornFrameError, match="esperava a sequência 1"):
            consumer.acquire_read(latest=False)


def test_producer_never_writes_into_a_leased_slot(ring: ShmRing) -> None:
    """Enquanto o consumidor lê um slot, o produtor usa outro: nada é rasgado."""
    with ShmRing.attach(ring.name) as consumer:
        first_seq = _fill(ring, 1)
        lease = consumer.acquire_read()
        assert lease is not None
        assert ring.read_slot(lease.index).seq == first_seq

        _fill(ring, 2)
        _fill(ring, 3)

        assert ring.read_slot(lease.index).state is SlotState.READING
        assert ring.read_slot(lease.index).seq == first_seq
        assert int(lease.frame.sum()) == 60

        consumer.release(lease)
        assert ring.read_slot(lease.index).state is SlotState.EMPTY


def test_ring_full_is_reported_instead_of_overwriting() -> None:
    """Com todos os slots em leitura, o produtor descarta o frame e conta a perda.

    Com um único consumidor bem comportado isto não acontece (só existe uma lease):
    o caminho é defensivo e cobre o caso de um consumidor que morreu a meio de uma
    leitura, deixando o slot marcado como `READING`.
    """
    ring = ShmRing.create(n_slots=2, height=2, width=2)
    try:
        for index in range(2):
            ring_layout.write_slot_state(ring._buffer, ring.layout, index, SlotState.READING)

        with pytest.raises(RingBufferFullError, match="Sem slot livre nos 2 slots"):
            ring.acquire_write()

        assert ring.stats().frames_overrun == 1
    finally:
        ring.shutdown()


def test_release_reports_a_rewritten_slot_as_unstable(ring: ShmRing) -> None:
    """Se o produtor reescrever o slot durante a leitura, o frame é marcado instável.

    O contrato é: computar dentro da lease, decidir depois de `release()` devolver
    `True`. Assim o consumidor pode usar o resultado sem risco de dados misturados.
    """
    with ShmRing.attach(ring.name) as consumer:
        _fill(ring, 1)
        lease = consumer.acquire_read()
        assert lease is not None

        # Simula o cruzamento real (a marca `READING` não é atómica): o produtor
        # reescreveu o slot que o consumidor estava a ler.
        ring_layout.write_slot_seq(ring._buffer, ring.layout, lease.index, 999)

        assert consumer.release(lease) is False
        assert consumer.has_lease is False
        # O slot fica `READY`: contém um frame publicado que ninguém leu.
        assert ring.read_slot(lease.index).state is SlotState.READY


def test_release_reports_a_stable_frame(ring: ShmRing) -> None:
    """Sem interferência do produtor, `release` confirma que o frame é íntegro."""
    with ShmRing.attach(ring.name) as consumer:
        _fill(ring, 1)
        lease = consumer.acquire_read()
        assert lease is not None

        assert consumer.release(lease) is True
        assert ring.read_slot(lease.index).state is SlotState.EMPTY


def test_lease_recovers_when_the_producer_wins_the_race(
    ring: ShmRing, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Se o produtor reescrever o slot entre o claim e a leitura dos metadados, recua.

    É a janela que existe por a marca `READING` não ser atómica (ver o docstring do
    módulo). O consumidor tem de (a) devolver o slot ao produtor e (b) não entregar
    nada, em vez de devolver um frame possivelmente misturado.
    """
    original_write_state = ring_layout.write_slot_state

    def racing_producer(
        buffer: memoryview, layout: object, index: int, state: ring_layout.SlotState
    ) -> None:
        """Simula o produtor a reescrever o slot exatamente na janela crítica."""
        original_write_state(buffer, layout, index, state)  # type: ignore[arg-type]
        if state is SlotState.READING:
            ring_layout.write_slot_seq(buffer, layout, index, 4242)  # type: ignore[arg-type]

    with ShmRing.attach(ring.name) as consumer:
        _fill(ring, 1)
        monkeypatch.setattr(ring_layout, "write_slot_state", racing_producer)

        assert consumer.acquire_read(latest=True) is None
        assert consumer.has_lease is False
        assert ring.read_slot(0).state is SlotState.READY
        assert ring.stats().read_seq == 0, "um frame não entregue não pode avançar o cursor"


def test_sequential_reader_reports_the_race_as_lost_data(
    ring: ShmRing, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Em modo offline, perder o frame esperado é erro (nunca um salto silencioso)."""
    original_write_state = ring_layout.write_slot_state

    def racing_producer(
        buffer: memoryview, layout: object, index: int, state: ring_layout.SlotState
    ) -> None:
        original_write_state(buffer, layout, index, state)  # type: ignore[arg-type]
        if state is SlotState.READING:
            ring_layout.write_slot_seq(buffer, layout, index, 777)  # type: ignore[arg-type]

    with ShmRing.attach(ring.name) as consumer:
        _fill(ring, 1)
        monkeypatch.setattr(ring_layout, "write_slot_state", racing_producer)

        with pytest.raises(TornFrameError, match="esperava a sequência 1"):
            consumer.acquire_read(latest=False)


def test_protocol_violations_raise_state_errors(ring: ShmRing) -> None:
    """Chamadas fora de ordem falham com erro tipado em vez de corromper o anel."""
    with pytest.raises(RingBufferStateError, match="não existe nenhum acquire_write pendente"):
        ring.commit()

    slot = ring.acquire_write()
    with pytest.raises(RingBufferStateError, match="ainda não foi publicado com commit"):
        ring.acquire_write()
    slot.frame[:] = 1
    ring.commit()

    with pytest.raises(RingBufferStateError, match="não existe lease ativa"):
        ring.release()

    lease = ring.acquire_read()
    assert lease is not None
    wrong_slot = replace(lease, index=(lease.index + 1) % ring.n_slots)
    with pytest.raises(RingBufferStateError, match="não corresponde à lease ativa"):
        ring.release(wrong_slot)

    with pytest.raises(RingBufferStateError, match="ainda está arrendado"):
        ring.acquire_read()
    ring.release(lease)


def test_only_the_owner_can_unlink(ring: ShmRing) -> None:
    """O consumidor não pode remover um segmento que não criou (o dono é único)."""
    with ShmRing.attach(ring.name) as consumer:
        with pytest.raises(RingBufferOwnershipError, match="só pode ser executada pelo processo"):
            consumer.unlink()

        assert segment_exists(ring.name) is True


def test_close_blocks_further_use(ring: ShmRing) -> None:
    """Depois de fechado, qualquer operação é recusada com erro explícito."""
    ring.close()

    assert ring.is_closed is True
    with pytest.raises(RingBufferClosedError, match="já foi fechado"):
        ring.stats()
    with pytest.raises(RingBufferClosedError, match="já foi fechado"):
        ring.acquire_write()
    with pytest.raises(RingBufferClosedError, match="já foi fechado"):
        ring.acquire_read()
    with pytest.raises(RingBufferClosedError, match="já foi fechado"):
        ring.unlink()


def test_shutdown_is_idempotent_and_removes_the_segment() -> None:
    """`shutdown` pode ser chamado duas vezes (encerramento concorrente) sem falhar."""
    ring = ShmRing.create(n_slots=2, height=2, width=2)
    name = ring.name

    assert segment_exists(name) is True

    ring.shutdown()
    ring.shutdown()

    assert segment_exists(name) is False


def test_context_manager_removes_the_segment() -> None:
    """O bloco `with` garante a remoção do segmento, mesmo com exceção pelo meio."""
    name = ""
    with (
        pytest.raises(RuntimeError, match="falha simulada"),
        ShmRing.create(n_slots=2, height=2, width=2) as ring,
    ):
        name = ring.name
        assert segment_exists(name) is True
        raise RuntimeError("falha simulada")

    assert segment_exists(name) is False


def test_unlink_then_shutdown_is_clean(ring: ShmRing) -> None:
    """Remover o segmento e depois encerrar não rebenta (dupla limpeza defensiva).

    Nota de plataforma: no Windows o nome do segmento só deixa de resolver quando
    **todos** os *handles* abertos forem fechados — por isso a ausência é verificada
    depois do encerramento, não logo após o `unlink`.
    """
    name = ring.name

    ring.unlink()
    ring.shutdown()  # fecha o handle e volta a remover (silenciosamente)
    ring.shutdown()

    assert segment_exists(name) is False


def test_repr_reports_the_state() -> None:
    """A representação mostra o essencial e não rebenta depois do fecho."""
    ring = ShmRing.create(n_slots=2, height=4, width=5)
    try:
        assert "shape=4x5x3" in repr(ring)
        assert "slots=2" in repr(ring)
        assert "write_seq=0" in repr(ring)

        slot = ring.acquire_write()
        slot.frame[:] = 3
        ring.commit()
        assert "write_seq=1" in repr(ring)

        ring.close()
        assert "fechado" in repr(ring)
    finally:
        ring.shutdown()


def test_attach_rejects_an_inconsistent_geometry() -> None:
    """Um cabeçalho internamente incoerente é recusado antes de criar vistas NumPy.

    Sem esta validação, um `slot_bytes` que não corresponde a ``h×w×c`` produziria
    vistas sobre memória que não é um frame — o consumidor lería lixo numérico sem
    qualquer aviso.
    """
    name = "psm_amring_teste_geometria"
    block = shared_memory.SharedMemory(name=name, create=True, size=4096)
    try:
        buffer = block.buf
        assert buffer is not None
        ring_layout.write_header(
            buffer,
            _header(n_slots=2, slot_bytes=999, frame_width=2, frame_height=2, channels=3),
        )

        with pytest.raises(RingBufferLayoutError, match="não corresponde"):
            ShmRing.attach(name)
    finally:
        block.close()
        block.unlink()


def test_silent_unlink_ignores_a_missing_segment() -> None:
    """A limpeza do `atexit` nunca falha (e nunca rebenta no encerramento)."""
    from athletemotion_desktop.runtime.ring_buffer.shm_ring import _unlink_silently

    _unlink_silently("psm_amring_que_nunca_existiu")


def test_enumeration_is_documented_per_platform() -> None:
    """Sem nome não há deteção: no Windows a listagem é vazia e a existência pelo nome."""
    with ShmRing.create(n_slots=2, height=2, width=2) as ring:
        if os.name == "nt":
            assert list_ring_names() == ()
            assert segment_exists(ring.name) is True
        else:  # pragma: no cover - caminho POSIX
            assert ring.name in list_ring_names()


def test_float32_ring_keeps_the_dtype() -> None:
    """O anel também transporta tensores (`float32`), não só imagem BGR."""
    with ShmRing.create(n_slots=2, height=2, width=2, channels=3, dtype=np.float32) as ring:
        assert ring.dtype == np.dtype(np.float32)

        slot = ring.acquire_write()
        slot.frame[:] = 0.5
        ring.commit()

        with ShmRing.attach(ring.name) as consumer:
            assert consumer.dtype == np.dtype(np.float32)
            lease = consumer.acquire_read()
            assert lease is not None
            assert float(lease.frame.mean()) == pytest.approx(0.5)
            consumer.release(lease)


def test_create_rejects_invalid_dimensions() -> None:
    """Criar um anel com dimensões inválidas falha antes de alocar memória."""
    with pytest.raises(ValueError, match="Dimensões de frame inválidas"):
        ShmRing.create(height=0, width=2)

    with pytest.raises(ValueError, match="n_slots=1 é insuficiente"):
        ShmRing.create(n_slots=1, height=2, width=2)
