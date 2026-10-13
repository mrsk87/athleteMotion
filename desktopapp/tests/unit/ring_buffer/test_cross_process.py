"""Testes de concorrência do anel com produtor e consumidor em processos separados.

Porquê em processos e não em threads: o que se está a testar é a ausência de frames
rasgados e de bloqueios entre **processos** (`spawn` no Windows, sem GIL partilhado,
sem herança de memória por `fork`). Um teste em threads daria falsas garantias.

Os processos filhos são funções de topo deste módulo (obrigatório em `spawn`: o
destino é serializado por referência e reimportado no filho).
"""

from __future__ import annotations

import multiprocessing
import time
from multiprocessing import shared_memory
from typing import Any

import numpy as np
import pytest

from athletemotion_desktop.runtime.ring_buffer.errors import RingBufferFullError
from athletemotion_desktop.runtime.ring_buffer.layout import SlotState
from athletemotion_desktop.runtime.ring_buffer.shm_ring import ShmRing, segment_exists

FRAME_HEIGHT = 8
FRAME_WIDTH = 8
FRAME_CHANNELS = 3
N_FRAMES = 10_000
#: Valor usado para preencher o frame: primo, para que o padrão de um frame nunca
#: coincida com o de outro próximo (o resto de uma divisão por 251 não repete de
#: imediato, ao contrário de um módulo 256).
FILL_MODULUS = 251


def frame_value_for(seq: int) -> int:
    """Padrão de preenchimento do frame de sequência `seq`."""
    return seq % FILL_MODULUS


def write_frame(ring: ShmRing, seq: int) -> None:
    """Escreve um frame marcado com `seq` e publica-o.

    O frame é auto-descritivo: todos os píxeis valem ``seq % 251`` e os dois primeiros
    bytes codificam a sequência. Qualquer mistura de dois frames (leitura rasgada)
    falha as asserções do consumidor.
    """
    slot = ring.acquire_write()
    slot.frame[:] = frame_value_for(seq)
    flat = slot.frame.reshape(-1)
    flat[0] = seq & 0xFF
    flat[1] = (seq >> 8) & 0xFF
    ring.commit(t_capture_ns=seq)


def inspect_frame(frame: np.ndarray) -> tuple[int, bool]:
    """Descodifica o padrão de um frame.

    Returns:
        Par ``(sequência, padrão_consistente)``.
    """
    flat = frame.reshape(-1)
    seq = int(flat[0]) | (int(flat[1]) << 8)
    consistent = bool(np.all(frame[1:] == frame_value_for(seq))) and bool(
        flat[0] == seq & 0xFF and flat[1] == (seq >> 8) & 0xFF
    )
    return seq, consistent


def producer_process(
    name: str,
    n_frames: int,
    interval_seconds: float,
    finished: Any,
    result: Any,
) -> None:  # pragma: no cover - corre em processo separado
    """Escreve `n_frames` frames no anel e reporta o resultado ao processo principal."""
    ring = ShmRing.attach(name)
    refused = 0
    try:
        for seq in range(1, n_frames + 1):
            while True:
                try:
                    write_frame(ring, seq)
                except RingBufferFullError:
                    # O consumidor tem todos os slots: descartar é a política, mas aqui
                    # espera-se que nunca aconteça com um consumidor saudável.
                    refused += 1
                    time.sleep(0.0001)
                    continue
                break
            if interval_seconds:
                time.sleep(interval_seconds)
    finally:
        stats = ring.stats()
        result.send(
            {
                "refused": refused,
                "write_seq": stats.write_seq,
                "frames_dropped": stats.frames_dropped,
            }
        )
        ring.close()
        finished.set()


def latest_consumer_process(
    name: str,
    n_frames: int,
    producer_finished: Any,
    stop: Any,
    result: Any,
) -> None:  # pragma: no cover - corre em processo separado
    """Lê sempre o frame mais recente e verifica a integridade de cada leitura."""
    ring = ShmRing.attach(name)
    reads = 0
    discarded = 0
    errors: list[str] = []
    last_seq = 0
    checksum_failures = 0
    try:
        while not stop.is_set():
            lease = ring.acquire_read(latest=True)
            if lease is None:
                if producer_finished.is_set():
                    break
                stop.wait(0.0005)
                continue
            # Padrão de consumo correto: computar dentro da lease, decidir depois de
            # `release` dizer se o frame se manteve íntegro.
            seq, consistent = inspect_frame(lease.frame)
            stable = ring.release(lease)
            if not stable:
                discarded += 1
                continue
            if not consistent:
                checksum_failures += 1
                errors.append(f"frame {seq} inconsistente")
            if seq < last_seq:
                errors.append(f"sequência regressou: {last_seq} -> {seq}")
            last_seq = max(last_seq, seq)
            reads += 1
            if reads + discarded >= n_frames:
                break
    finally:
        result.send(
            {
                "reads": reads,
                "discarded": discarded,
                "errors": errors,
                "checksum_failures": checksum_failures,
                "last_seq": last_seq,
                "frames_read": ring.stats().frames_read,
            }
        )
        ring.close()


def sequential_consumer_process(
    name: str,
    n_frames: int,
    ack: Any,
    result: Any,
) -> None:  # pragma: no cover - corre em processo separado
    """Lê os frames por ordem estrita (modo offline) confirmando cada leitura."""
    ring = ShmRing.attach(name)
    sequences: list[int] = []
    errors: list[str] = []
    try:
        for expected in range(1, n_frames + 1):
            deadline = time.perf_counter() + 10.0
            lease = None
            while lease is None:
                lease = ring.acquire_read(latest=False)
                if lease is None:
                    if time.perf_counter() > deadline:
                        errors.append(f"timeout à espera do frame {expected}")
                        break
                    time.sleep(0.0002)
            if lease is None:
                break
            sequences.append(lease.seq)
            if lease.seq != expected:
                errors.append(f"esperava o frame {expected}, recebi {lease.seq}")
            if not ring.release(lease):
                errors.append(f"frame {lease.seq} foi reescrito durante a leitura")
            ack.send(lease.seq)
    finally:
        result.send({"sequences": sequences, "errors": errors})
        ring.close()


def leasing_consumer_process(
    name: str,
    leased: Any,
    hold: Any,
) -> None:  # pragma: no cover - corre em processo separado
    """Arrenda o frame mais recente e fica a segurá-lo até ser terminado."""
    ring = ShmRing.attach(name)
    lease = None
    while lease is None:
        lease = ring.acquire_read(latest=True)
        if lease is None:
            time.sleep(0.0005)
    leased.send({"index": lease.index, "seq": lease.seq})
    hold.wait()  # só sai daqui se alguém libertar o evento (o teste mata o processo)


@pytest.fixture
def spawn_context() -> Any:
    """Contexto `spawn` — o modo usado em produção no Windows."""
    return multiprocessing.get_context("spawn")


@pytest.fixture
def local_ring() -> Any:
    """Anel pequeno (frames de 8x8x3) removido do sistema no fim do teste."""
    ring = ShmRing.create(
        n_slots=3,
        height=FRAME_HEIGHT,
        width=FRAME_WIDTH,
        channels=FRAME_CHANNELS,
    )
    try:
        yield ring
    finally:
        ring.shutdown()


def test_ten_thousand_frames_between_processes_without_corruption(
    spawn_context: Any, local_ring: ShmRing
) -> None:
    """10 000 frames entre processos: zero frames rasgados, zero sequências regressivas.

    Este é o teste central da D04: o produtor escreve o mais depressa que consegue, o
    consumidor fica atrasado de propósito e a política *latest-wins* descarta frames —
    o que **não** pode acontecer é o consumidor ler um frame misturado.
    """
    producer_result = spawn_context.Pipe(duplex=False)
    consumer_result = spawn_context.Pipe(duplex=False)
    producer_finished = spawn_context.Event()
    stop = spawn_context.Event()

    producer = spawn_context.Process(
        target=producer_process,
        args=(local_ring.name, N_FRAMES, 0.0, producer_finished, producer_result[1]),
    )
    consumer = spawn_context.Process(
        target=latest_consumer_process,
        args=(local_ring.name, N_FRAMES, producer_finished, stop, consumer_result[1]),
    )

    consumer.start()
    producer.start()
    producer.join(timeout=120)
    producer_finished.set()
    consumer.join(timeout=120)
    if consumer.is_alive():  # pragma: no cover - só em falha
        consumer.terminate()
    stop.set()

    assert producer.exitcode == 0, "o produtor morreu a meio"
    assert consumer.exitcode == 0, "o consumidor morreu a meio"

    written = producer_result[0].recv()
    read = consumer_result[0].recv()
    stats = local_ring.stats()
    # Evidência visível com `pytest -s`: quantos frames o consumidor aceitou e quantos
    # descartou por o produtor ter reescrito o slot durante a leitura.
    print(
        f"\n[anel] escritos={stats.frames_written} aceites={read['reads']} "
        f"descartados={read['discarded']} saltados={stats.skipped_by_reader} "
        f"descartados_pelo_produtor={stats.frames_dropped}"
    )

    assert written["write_seq"] == N_FRAMES
    assert written["refused"] == 0, "o produtor nunca devia ficar sem slot com um consumidor vivo"
    assert read["errors"] == []
    assert read["checksum_failures"] == 0, "nenhum frame aceite pode estar misturado"
    assert read["reads"] > 0
    assert read["last_seq"] == N_FRAMES
    assert stats.frames_written == N_FRAMES
    assert stats.frames_read == read["reads"] + read["discarded"]
    assert stats.frames_overrun == 0
    # A janela em que a marca `READING` não é atómica pode custar frames ao
    # consumidor; o que não pode acontecer é ele *usar* um frame misturado.
    assert read["discarded"] < N_FRAMES * 0.05, (
        f"descartou {read['discarded']} de {N_FRAMES} frames: anel subdimensionado"
    )


def test_sequential_reader_gets_every_frame_in_order(
    spawn_context: Any, local_ring: ShmRing
) -> None:
    """Em modo offline (sem descarte) o consumidor recebe todos os frames, por ordem."""
    frames = 200
    ack_channel = spawn_context.Pipe(duplex=False)
    consumer_result = spawn_context.Pipe(duplex=False)

    consumer = spawn_context.Process(
        target=sequential_consumer_process,
        args=(local_ring.name, frames, ack_channel[1], consumer_result[1]),
    )
    consumer.start()

    try:
        for seq in range(1, frames + 1):
            write_frame(local_ring, seq)
            # Espera a confirmação da leitura antes de reescrever: é esta espera que
            # torna o teste determinístico (em modo offline não pode haver descarte).
            assert ack_channel[0].poll(30), f"sem confirmação do frame {seq}"
            assert ack_channel[0].recv() == seq
    finally:
        consumer.join(timeout=60)

    assert consumer.exitcode == 0
    outcome = consumer_result[0].recv()
    assert outcome["errors"] == []
    assert outcome["sequences"] == list(range(1, frames + 1))
    assert local_ring.stats().frames_dropped == 0


def test_owner_cleans_up_after_a_killed_consumer(spawn_context: Any, local_ring: ShmRing) -> None:
    """Consumidor morto a meio de uma leitura: o produtor continua e o dono limpa.

    É o cenário que estraga um ring buffer mal desenhado — um slot fica marcado como
    ``READING`` para sempre. Aqui o produtor salta-o, continua a publicar e o dono
    remove o segmento no encerramento.
    """
    leased = spawn_context.Pipe(duplex=False)
    hold = spawn_context.Event()
    consumer = spawn_context.Process(
        target=leasing_consumer_process,
        args=(local_ring.name, leased[1], hold),
    )
    consumer.start()

    write_frame(local_ring, 1)
    lease_info = leased[0].recv()
    assert lease_info["seq"] == 1
    assert local_ring.read_slot(lease_info["index"]).state is SlotState.READING

    consumer.terminate()
    consumer.join(timeout=30)
    assert consumer.exitcode is not None

    # O produtor continua a funcionar: o slot do consumidor morto é saltado.
    for seq in range(2, 7):
        write_frame(local_ring, seq)

    stats = local_ring.stats()
    assert stats.frames_written == 6
    assert stats.frames_overrun == 0
    assert local_ring.read_slot(lease_info["index"]).state is SlotState.READING

    name = local_ring.name
    start = time.perf_counter()
    local_ring.shutdown()
    elapsed = time.perf_counter() - start

    assert elapsed < 1.0, f"o encerramento demorou {elapsed * 1000:.0f} ms (devia ser imediato)"
    assert segment_exists(name) is False


def test_no_orphan_segments_after_all_rings_are_closed() -> None:
    """Depois de fechar, o segmento desaparece do sistema (sem fugas de recursos)."""
    names = []
    for _ in range(3):
        ring = ShmRing.create(n_slots=2, height=4, width=4)
        names.append(ring.name)
        write_frame(ring, 1)
        ring.shutdown()

    assert all(segment_exists(name) is False for name in names)


def test_attach_to_a_missing_segment_raises_file_not_found() -> None:
    """Anexar-se a um nome inexistente falha com `FileNotFoundError` (nunca silencioso)."""
    with pytest.raises(FileNotFoundError):
        ShmRing.attach("psm_amring_nao_existe_de_todo")


def test_two_attached_rings_share_the_same_bytes(local_ring: ShmRing) -> None:
    """Duas anexações leem o mesmo segmento: o que o produtor escreve é o que chega."""
    with ShmRing.attach(local_ring.name) as first, ShmRing.attach(local_ring.name) as second:
        write_frame(local_ring, 12)
        first_lease = first.acquire_read()
        assert first_lease is not None
        first_seq, first_consistent = inspect_frame(first_lease.frame)
        assert first.release(first_lease) is True

        write_frame(local_ring, 13)
        second_lease = second.acquire_read()
        assert second_lease is not None
        second_seq, second_consistent = inspect_frame(second_lease.frame)
        assert second.release(second_lease) is True

        assert (first_seq, first_consistent) == (12, True)
        assert (second_seq, second_consistent) == (13, True)


def test_segment_size_matches_the_declared_layout(local_ring: ShmRing) -> None:
    """Sanidade: o segmento real é, no mínimo, do tamanho que o layout exige."""
    assert isinstance(local_ring.name, str)
    assert local_ring.name.startswith("psm_amring_")

    block = shared_memory.SharedMemory(name=local_ring.name)
    try:
        assert block.size >= local_ring.layout.total_bytes
    finally:
        block.close()
