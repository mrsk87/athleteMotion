"""Testes da fonte de ficheiro, com vídeos gerados no próprio teste.

O vídeo vem do gerador partilhado (`tests.fakes.synthetic.write_synthetic_video`): cada
frame tem um valor de cinzento identificável (`10 + índice × 5`). Isso permite verificar por
**conteúdo** — e não só pelo contador — que `step` e `seek` devolvem o frame certo: é o
critério «frame N devolve o N-ésimo» da tarefa, e o único que deteta um `seek` que se
desloca para o *keyframe* anterior.

A tolerância de ±4 níveis de cinzento existe porque a compressão MJPG não é sem perdas;
o valor exato não é recuperável, a posição é.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pytest

from athletemotion_desktop.runtime.capture.base import (
    CaptureOpenError,
    CaptureSourceError,
    CaptureState,
)
from athletemotion_desktop.runtime.capture.file_source import (
    MAX_SPEED,
    MIN_SPEED,
    FileSource,
    LoopRange,
)
from tests.fakes.synthetic import GRAY_TOLERANCE, gray_value, mean_gray, write_synthetic_video

FRAME_WIDTH = 64
FRAME_HEIGHT = 48
FRAME_COUNT = 20
FPS = 25.0


@pytest.fixture
def video(tmp_path: Path) -> Path:
    """Vídeo de 20 frames em `/tmp`, removido no fim do teste."""
    return write_synthetic_video(
        tmp_path / "clip.avi",
        frame_count=FRAME_COUNT,
        width=FRAME_WIDTH,
        height=FRAME_HEIGHT,
        fps=FPS,
    )


def frame_mean(frame: object) -> float:
    """Média dos píxeis de um frame do contrato de captura (identifica-o no vídeo)."""
    return mean_gray(np.asarray(frame.data))  # type: ignore[attr-defined]


def test_open_reports_real_metadata(video: Path) -> None:
    """A `SourceInfo` traz resolução, FPS e contagem de frames do ficheiro."""
    source = FileSource(video, realtime=False)
    try:
        info = source.open()

        assert info.kind == "file"
        assert info.resolution == f"{FRAME_WIDTH}x{FRAME_HEIGHT}"
        assert info.fps == pytest.approx(FPS)
        assert info.frame_count == pytest.approx(FRAME_COUNT, abs=1)
        assert info.duration_s is not None and info.duration_s > 0
        assert info.backend == "file"
        assert source.state is CaptureState.READING
    finally:
        source.close()


def test_sequential_reads_advance_one_frame_at_a_time(video: Path) -> None:
    """`read()` devolve frames consecutivos, identificáveis pelo conteúdo."""
    source = FileSource(video, realtime=False)
    try:
        source.open()
        indices: list[int] = []
        for index in range(FRAME_COUNT):
            frame = source.read()
            assert frame is not None
            indices.append(frame.index)
            # O conteúdo só pode ser validado no momento da leitura: todos os frames
            # partilham o mesmo buffer (é o que torna o caminho sem cópias possível).
            assert frame_mean(frame) == pytest.approx(gray_value(index), abs=GRAY_TOLERANCE)

        assert indices == list(range(FRAME_COUNT))
        stats = source.stats()
        assert stats.frames_delivered == FRAME_COUNT
        assert stats.frames_dropped == 0
    finally:
        source.close()


def test_end_of_file_is_signalled_and_sticky(video: Path) -> None:
    """No fim do ficheiro `read()` devolve `None` e `at_end` fica verdadeiro."""
    source = FileSource(video, realtime=False)
    try:
        source.open()
        for _ in range(FRAME_COUNT + 5):
            source.read()

        assert source.at_end is True
        assert source.read() is None
    finally:
        source.close()


def test_step_returns_exactly_the_requested_frame(video: Path) -> None:
    """`step(n)` devolve o frame `N` posições à frente, verificado por conteúdo."""
    source = FileSource(video, realtime=False)
    try:
        source.open()
        start = source.read()
        assert start is not None and start.index == 0

        forward = source.step(5)
        assert forward is not None
        assert forward.index == 5
        assert frame_mean(forward) == pytest.approx(gray_value(5), abs=GRAY_TOLERANCE)

        backward = source.step(-3)
        assert backward is not None
        assert backward.index == 2
        assert frame_mean(backward) == pytest.approx(gray_value(2), abs=GRAY_TOLERANCE)
    finally:
        source.close()


def test_step_of_zero_is_rejected(video: Path) -> None:
    """`step(0)` seria ambíguo (frame atual ou seguinte) e é recusado."""
    source = FileSource(video, realtime=False)
    try:
        source.open()
        with pytest.raises(ValueError, match="não move a posição"):
            source.step(0)
    finally:
        source.close()


def test_stepping_before_the_first_frame_is_an_error(video: Path) -> None:
    """Recuar para antes do início do ficheiro falha com contexto."""
    source = FileSource(video, realtime=False)
    try:
        source.open()
        with pytest.raises(CaptureSourceError, match="antes do início"):
            source.step(-1)
    finally:
        source.close()


def test_seek_by_frame_and_by_milliseconds(video: Path) -> None:
    """`seek` aceita um frame ou um instante, e o frame seguinte é o pedido."""
    source = FileSource(video, realtime=False)
    try:
        source.open()

        assert source.seek(frame=7) is True
        by_frame = source.read()
        assert by_frame is not None and by_frame.index == 7

        assert source.seek(ms=400.0) is True  # 400 ms a 25 FPS = frame 10
        by_ms = source.read()
        assert by_ms is not None and by_ms.index == 10
        assert frame_mean(by_ms) == pytest.approx(gray_value(10), abs=GRAY_TOLERANCE)
    finally:
        source.close()


def test_seek_validates_its_arguments(video: Path) -> None:
    """Sem destino, com dois destinos ou fora do ficheiro, `seek` falha explicitamente."""
    source = FileSource(video, realtime=False)
    try:
        source.open()

        with pytest.raises(CaptureSourceError, match="exatamente um destino"):
            source.seek()
        with pytest.raises(CaptureSourceError, match="exatamente um destino"):
            source.seek(frame=1, ms=100.0)
        with pytest.raises(CaptureSourceError, match="fora do ficheiro"):
            source.seek(frame=999)
        with pytest.raises(CaptureSourceError, match="fora do ficheiro"):
            source.seek(frame=-1)
    finally:
        source.close()


def test_speed_is_validated_and_used(video: Path) -> None:
    """A velocidade aceita 0,1×–2× e é recusada fora disso."""
    source = FileSource(video, realtime=False)
    try:
        source.open()

        source.set_speed(2.0)
        assert source.speed == pytest.approx(2.0)
        with pytest.raises(ValueError, match="fora do intervalo"):
            source.set_speed(MAX_SPEED + 0.1)
        with pytest.raises(ValueError, match="fora do intervalo"):
            source.set_speed(MIN_SPEED - 0.05)
        with pytest.raises(ValueError, match="fora do intervalo"):
            FileSource(video, speed=5.0)
    finally:
        source.close()


def test_batch_mode_reads_as_fast_as_possible(video: Path) -> None:
    """Sem `realtime`, ler 20 frames não espera pela cadência do ficheiro (0,8 s)."""
    source = FileSource(video, realtime=False)
    try:
        source.open()
        start = time.perf_counter()
        for _ in range(FRAME_COUNT):
            source.read()
        elapsed = time.perf_counter() - start

        assert elapsed < 0.2, f"o modo batch esperou {elapsed:.3f}s pela cadência"
    finally:
        source.close()


def test_realtime_mode_respects_the_file_pacing(video: Path) -> None:
    """Com `realtime`, o segundo frame só chega depois do intervalo de 1/FPS."""
    source = FileSource(video, realtime=True)
    try:
        source.open()
        source.read()
        start = time.perf_counter()
        second = source.read()
        elapsed = time.perf_counter() - start

        assert second is not None
        # 25 FPS → 40 ms entre frames; a margem cobre o ruído do sistema.
        assert 0.02 <= elapsed < 0.3, f"intervalo entre frames de {elapsed * 1000:.1f} ms"
    finally:
        source.close()


def test_timeout_caps_the_pacing_wait(video: Path) -> None:
    """Um timeout curto devolve `None` em vez de esperar pela cadência completa."""
    source = FileSource(video, realtime=True)
    try:
        source.open()
        source.read()

        start = time.perf_counter()
        frame = source.read(timeout_ms=1)
        elapsed = time.perf_counter() - start

        assert frame is None
        assert elapsed < 0.03
    finally:
        source.close()


def test_loop_a_b_repeats_the_selected_range(video: Path) -> None:
    """O intervalo A-B repete os frames pedidos (o caso de «ver esta pedalada 10×»)."""
    source = FileSource(video, realtime=False)
    try:
        source.open()
        source.set_loop(LoopRange(start_frame=3, end_frame=6))

        indices = []
        for _ in range(9):
            frame = source.read()
            assert frame is not None
            indices.append(frame.index)

        assert indices == [3, 4, 5, 6, 3, 4, 5, 6, 3]
        assert source.at_end is False

        source.clear_loop()
        assert source.loop is None
    finally:
        source.close()


def test_loop_range_validates_the_file(video: Path) -> None:
    """Um intervalo que sai do ficheiro é recusado (em vez de repetir lixo)."""
    source = FileSource(video, realtime=False)
    try:
        source.open()

        with pytest.raises(CaptureSourceError, match="ultrapassa o ficheiro"):
            source.set_loop(LoopRange(start_frame=10, end_frame=FRAME_COUNT + 5))
        with pytest.raises(ValueError, match="intervalo A-B inválido"):
            LoopRange(start_frame=5, end_frame=4)
    finally:
        source.close()


def test_frame_contract_is_shared_with_the_camera(video: Path) -> None:
    """Os frames do ficheiro cumprem o mesmo contrato (píxeis só-leitura, buffer reusado)."""
    source = FileSource(video, realtime=False)
    try:
        source.open()
        first = source.read()
        second = source.read()

        assert first is not None and second is not None
        assert first.data.flags.writeable is False
        assert first.data.base is second.data.base
        assert first.source_id == "file:clip.avi"
    finally:
        source.close()


def test_operations_require_an_open_source(video: Path) -> None:
    """Ler/posicionar antes de abrir falha de forma explícita."""
    source = FileSource(video, realtime=False)

    with pytest.raises(CaptureSourceError, match="não está aberta"):
        source.read()
    with pytest.raises(CaptureSourceError, match="não está aberta"):
        source.seek(frame=0)
    with pytest.raises(CaptureSourceError, match="não foi aberta"):
        source.info()


def test_missing_or_invalid_files_fail_with_context(tmp_path: Path) -> None:
    """Ficheiro inexistente ou ilegível dá um `CaptureOpenError` explicativo."""
    missing = FileSource(tmp_path / "ausente.mp4", realtime=False)
    with pytest.raises(CaptureOpenError, match="não existe"):
        missing.open()

    garbage = tmp_path / "lixo.avi"
    garbage.write_text("isto não é um vídeo", encoding="utf-8")
    broken = FileSource(garbage, realtime=False)
    with pytest.raises(CaptureOpenError, match="não foi possível descodificar"):
        broken.open()


def test_closing_twice_is_safe(video: Path) -> None:
    """Fechar duas vezes não levanta e deixa a fonte em `CLOSED`."""
    source = FileSource(video, realtime=False)
    source.open()

    source.close()
    source.close()

    assert source.state is CaptureState.CLOSED
    with pytest.raises(CaptureSourceError):
        source.read()


def test_open_twice_is_rejected(video: Path) -> None:
    """Abrir uma fonte já aberta é um erro de protocolo."""
    source = FileSource(video, realtime=False)
    try:
        source.open()
        with pytest.raises(CaptureSourceError, match="já está aberta"):
            source.open()
    finally:
        source.close()
