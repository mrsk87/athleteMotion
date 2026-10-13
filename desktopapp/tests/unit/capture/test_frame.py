"""Testes do contrato `Frame` e dos auxiliares de FOURCC.

O valor destes testes está em impedir duas classes de erro que só apareceriam em produção:
píxeis escrevíveis por engano (corrupção silenciosa de um frame que outro consumidor está a
ler) e frames com forma/etiqueta de cor errada (cores trocadas ou tensores desalinhados,
sem qualquer exceção).
"""

from __future__ import annotations

import numpy as np
import pytest

from athletemotion_desktop.runtime.capture.device import fourcc_to_code, fourcc_to_text
from athletemotion_desktop.runtime.capture.frame import (
    Frame,
    FrameContractError,
    PixelFormat,
    read_only_view,
)


def _buffer(width: int = 4, height: int = 3, value: int = 5) -> np.ndarray:
    """Buffer do produtor com um padrão simples."""
    buffer: np.ndarray = np.full((height, width, 3), value, dtype=np.uint8)
    return buffer


def _frame(**overrides: object) -> Frame:
    """Frame válido, com a possibilidade de sobrepor campos nos testes negativos."""
    values: dict[str, object] = {
        "index": 1,
        "t_capture_ns": 1_000,
        "width": 4,
        "height": 3,
        "pixel_format": PixelFormat.BGR24,
        "data": read_only_view(_buffer()),
        "source_id": "camera:0",
    }
    values.update(overrides)
    return Frame(**values)  # type: ignore[arg-type]


def test_frame_exposes_dimensions_and_size() -> None:
    """A forma, os canais e o tamanho em bytes derivam do buffer entregue."""
    frame = _frame()

    assert frame.shape == (3, 4, 3)
    assert frame.channels == 3
    assert frame.size_bytes == 36


def test_pixels_are_read_only_for_the_consumer() -> None:
    """Escrever nos píxeis de um frame entregue é impossível (e falha alto)."""
    frame = _frame()

    assert frame.data.flags.writeable is False
    with pytest.raises(ValueError, match="read-only"):
        frame.data[0, 0, 0] = 1


def test_frame_rejects_writable_pixels() -> None:
    """Um frame construído com píxeis escrevíveis é recusado na origem."""
    writeable = _buffer()

    with pytest.raises(FrameContractError, match="só-leitura"):
        _frame(data=writeable)


def test_frame_rejects_an_owned_array() -> None:
    """Um frame tem de ser uma vista sobre o buffer do produtor, não um array próprio.

    Um array só-leitura sem dono (`base is None`) passaria as restantes verificações, mas
    significaria que cada frame teria memória própria — e o produtor nunca poderia
    reutilizar o buffer, que é o que torna o caminho sem cópias possível.
    """
    owned: np.ndarray = np.zeros((3, 4, 3), dtype=np.uint8)
    owned.setflags(write=False)

    with pytest.raises(FrameContractError, match="cópia própria"):
        _frame(data=owned)


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"index": -1}, "índice"),
        ({"t_capture_ns": 0}, "instante de captura"),
        ({"width": 0}, "dimensões"),
        ({"pixel_format": PixelFormat.GRAY8}, "forma"),
    ],
)
def test_frame_rejects_invalid_metadata(overrides: dict[str, object], expected: str) -> None:
    """Metadados incoerentes falham na construção, com a razão identificada."""
    with pytest.raises(FrameContractError, match=expected):
        _frame(**overrides)


def test_frame_rejects_a_non_uint8_buffer() -> None:
    """Píxeis que não sejam uint8 são recusados (o pipeline assume 8 bits por canal)."""
    buffer = np.zeros((3, 4, 3), dtype=np.float32)

    with pytest.raises(FrameContractError, match="uint8"):
        # O dtype errado é exatamente o que este teste tem de exercitar.
        _frame(data=read_only_view(buffer))  # type: ignore[arg-type]


def test_grayscale_frames_have_two_dimensions() -> None:
    """Um frame em tons de cinza tem forma `(altura, largura)` e um canal."""
    buffer: np.ndarray = np.zeros((3, 4), dtype=np.uint8)

    frame = _frame(pixel_format=PixelFormat.GRAY8, data=read_only_view(buffer))

    assert frame.shape == (3, 4)
    assert frame.channels == 1


def test_equality_compares_pixels_by_value() -> None:
    """Dois frames iguais comparam-se por conteúdo, não por identidade do buffer."""
    first = _frame()
    second = _frame(index=1, t_capture_ns=1_000)

    assert first == second
    assert first != _frame(index=2)
    assert first != _frame(index=1, t_capture_ns=1_000, source_id="camera:1")
    assert first != "não é um frame"


def test_frames_are_not_hashable() -> None:
    """Um frame não é *hashable*: o buffer que o sustenta é reutilizado pelo produtor."""
    with pytest.raises(TypeError):
        hash(_frame())


def test_age_ms_uses_the_capture_timestamp() -> None:
    """A idade do frame mede-se contra o relógio monotónico entregue pelo chamador."""
    frame = _frame(t_capture_ns=1_000_000)

    assert frame.age_ms(2_500_000) == pytest.approx(1.5)


def test_fourcc_round_trips() -> None:
    """Codificar e descodificar um FOURCC devolve o mesmo código."""
    assert fourcc_to_code("MJPG") == 0x47504A4D
    assert fourcc_to_text(fourcc_to_code("MJPG")) == "MJPG"
    assert fourcc_to_text(fourcc_to_code("YUY2")) == "YUY2"


def test_fourcc_rejects_a_short_code() -> None:
    """Um código com menos de 4 caracteres é recusado em vez de aceite em silêncio."""
    with pytest.raises(ValueError, match="esperado 4"):
        fourcc_to_code("MJ")


def test_fourcc_returns_none_when_the_driver_reports_nothing() -> None:
    """Zero significa "não reportado" (nunca uma string inventada)."""
    assert fourcc_to_text(0.0) is None
