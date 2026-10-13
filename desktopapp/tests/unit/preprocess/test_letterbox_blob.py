"""Testes do letterbox (composição em canvas) e da conversão para tensor NCHW.

São os dois passos onde um erro passa despercebido (a imagem continua a "parecer"
certa) mas degrada a precisão do modelo: padding ao lado errado, canais trocados,
normalização aplicada duas vezes.
"""

from __future__ import annotations

import numpy as np
import pytest

from athletemotion_desktop.runtime.preprocess.blob import (
    DEFAULT_INPUT_SCALE,
    blob_shape,
    canvas_to_nchw_float32,
    to_nchw_float32,
)
from athletemotion_desktop.runtime.preprocess.letterbox import (
    DEFAULT_PAD_COLOR,
    letterbox,
    letterbox_geometry,
    letterbox_into,
)


def _gradient(width: int, height: int) -> np.ndarray:
    """Imagem BGR determinística com valores distintos por canal (deteta trocas)."""
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    frame[:, :, 0] = np.arange(width, dtype=np.uint8)[None, :]  # azul = x
    frame[:, :, 1] = np.arange(height, dtype=np.uint8)[:, None]  # verde = y
    frame[:, :, 2] = 200  # vermelho constante
    return frame


def test_geometry_matches_the_domain_formula() -> None:
    """Escala e padding seguem a fórmula do domínio, incluindo o arredondamento."""
    geometry = letterbox_geometry(400, 500, 320, 320)

    assert geometry.scale == pytest.approx(0.64)
    assert geometry.resized_width == 256
    assert geometry.resized_height == 320
    assert geometry.pad_x == pytest.approx(32.0)
    assert geometry.pad_y == pytest.approx(0.0)
    assert (geometry.left, geometry.top) == (32, 0)
    # As duas faixas somam exatamente o espaço livre (nunca 1 píxel a mais/menos).
    assert geometry.left + geometry.resized_width + round(geometry.pad_x + 0.1) == 320
    assert geometry.top + geometry.resized_height + round(geometry.pad_y + 0.1) == 320


def test_geometry_does_not_scale_up_by_default() -> None:
    """Um recorte pequeno não é ampliado: entra ao tamanho real, com padding."""
    geometry = letterbox_geometry(100, 80, 640, 640)

    assert geometry.scale == 1.0
    assert (geometry.resized_width, geometry.resized_height) == (100, 80)
    assert geometry.pad_x == pytest.approx(270.0)
    assert geometry.pad_y == pytest.approx(280.0)


def test_geometry_can_scale_up_when_asked() -> None:
    """Quando explícito, o recorte é ampliado até preencher a entrada."""
    geometry = letterbox_geometry(100, 80, 640, 640, scale_up=True)

    assert geometry.scale == pytest.approx(6.4)
    assert geometry.resized_height == 512
    assert geometry.pad_y == pytest.approx(64.0)


def test_geometry_supports_rectangular_targets() -> None:
    """A entrada 192x256 do RTMPose usa a mesma matemática, com alvo retangular."""
    geometry = letterbox_geometry(300, 400, 192, 256)

    assert geometry.scale == pytest.approx(0.64)
    assert (geometry.resized_width, geometry.resized_height) == (192, 256)
    assert (geometry.pad_x, geometry.pad_y) == (0.0, 0.0)


def test_geometry_rejects_invalid_dimensions() -> None:
    """Dimensões nulas/negativas falham antes de se tocar em píxeis."""
    with pytest.raises(ValueError, match="Dimensões inválidas no letterbox"):
        letterbox_geometry(0, 100, 320, 320)
    with pytest.raises(ValueError, match="Dimensões inválidas no letterbox"):
        letterbox_geometry(100, 100, 320, -320)


def test_letterbox_into_writes_borders_and_crop() -> None:
    """A canvas fica completamente escrita: padding nas faixas, imagem no centro."""
    crop = _gradient(200, 100)
    canvas = np.full((320, 320, 3), 7, dtype=np.uint8)  # lixo inicial de propósito
    geometry = letterbox_geometry(200, 100, 320, 320)

    letterbox_into(crop, canvas, geometry)

    assert geometry.scale == 1.0
    assert (geometry.left, geometry.top) == (60, 110)
    # Faixas de padding com a cor definida.
    assert (canvas[0, 0] == DEFAULT_PAD_COLOR).all()
    assert (canvas[319, 319] == DEFAULT_PAD_COLOR).all()
    assert (canvas[110, 0] == DEFAULT_PAD_COLOR).all()
    assert (canvas[109, 160] == DEFAULT_PAD_COLOR).all()
    # Região central com o recorte (mesmos valores do recorte original).
    assert np.array_equal(canvas[110:210, 60:260], crop)
    # Nenhum píxel com o valor de lixo inicial → a canvas foi toda reescrita.
    assert not (canvas == 7).all()


def test_letterbox_into_resizes_with_linear_interpolation() -> None:
    """O redimensionamento usa a mesma interpolação do domínio (INTER_LINEAR)."""
    import cv2

    crop = _gradient(256, 256)
    canvas = np.empty((160, 160, 3), dtype=np.uint8)
    geometry = letterbox_geometry(256, 256, 160, 160)

    letterbox_into(crop, canvas, geometry)

    expected = cv2.resize(crop, (160, 160), interpolation=cv2.INTER_LINEAR)
    assert np.array_equal(canvas, expected)


def test_letterbox_into_validates_the_canvas() -> None:
    """Uma canvas com forma errada falha com contexto em vez de escrever fora dos limites."""
    crop = _gradient(200, 100)
    geometry = letterbox_geometry(200, 100, 320, 320)

    with pytest.raises(ValueError, match="incompatível com o recorte"):
        letterbox_into(crop, np.empty((320, 320), dtype=np.uint8), geometry)
    with pytest.raises(ValueError, match="demasiado pequena"):
        letterbox_into(crop, np.empty((50, 50, 3), dtype=np.uint8), geometry)


def test_letterbox_convenience_wrapper_matches_letterbox_into() -> None:
    """A variante que aloca devolve exatamente o mesmo que a variante com buffer."""
    crop = _gradient(320, 180)

    canvas, geometry = letterbox(crop, (256, 256))
    reused = np.empty((256, 256, 3), dtype=np.uint8)
    letterbox_into(crop, reused, geometry)

    assert np.array_equal(canvas, reused)


def test_blob_shape_and_validation() -> None:
    """A forma NCHW é derivada das dimensões e validada."""
    assert blob_shape(320, 240) == (1, 3, 240, 320)

    with pytest.raises(ValueError, match="Dimensões inválidas para o tensor"):
        blob_shape(0, 240)


def test_canvas_to_nchw_converts_channels_and_normalizes() -> None:
    """RGB/BGR, escala e normalização produzem o mesmo que a expressão de referência."""
    canvas = _gradient(5, 4)

    tensor = to_nchw_float32(canvas)

    reference = canvas[:, :, ::-1].transpose(2, 0, 1).astype(np.float32) / 255.0
    assert np.array_equal(tensor, reference[None, ...])

    tensor_bgr = to_nchw_float32(canvas, channel_order="bgr")
    reference_bgr = canvas.transpose(2, 0, 1).astype(np.float32) / 255.0
    assert np.array_equal(tensor_bgr, reference_bgr[None, ...])


def test_canvas_to_nchw_applies_mean_and_std() -> None:
    """Com média/desvio (caso ImageNet do RTMPose) o cálculo é idêntico ao de referência."""
    canvas = _gradient(6, 5)
    mean = (0.485, 0.456, 0.406)
    std = (0.229, 0.224, 0.225)

    tensor = to_nchw_float32(canvas, mean=mean, std=std)

    reference = canvas[:, :, ::-1].transpose(2, 0, 1).astype(np.float32) / 255.0
    for channel in range(3):
        reference[channel] = (reference[channel] - mean[channel]) / std[channel]
    assert np.allclose(tensor, reference[None, ...], atol=1e-6)


def test_canvas_to_nchw_writes_into_the_given_buffer() -> None:
    """O caminho de tempo real escreve no buffer de destino, sem alocar outro."""
    canvas = _gradient(4, 3)
    out: np.ndarray = np.empty(blob_shape(4, 3), dtype=np.float32)
    out[:] = -1.0

    canvas_to_nchw_float32(canvas, out)

    assert (out >= 0.0).all()
    # Em ordem RGB, o canal 0 do tensor vem do canal 2 (vermelho) da canvas BGR, que
    # neste padrão é o valor constante 200.
    assert float(out[0, 0].mean()) == pytest.approx(200.0 / 255.0)


def test_canvas_to_nchw_skips_mean_std_when_not_needed() -> None:
    """Sem média/desvio, a escala é aplicada numa só passagem (caso do YOLO)."""
    canvas = _gradient(4, 3)
    out: np.ndarray = np.empty(blob_shape(4, 3), dtype=np.float32)

    canvas_to_nchw_float32(canvas, out, apply_mean_std=False)

    assert float(out[0, 1, 2, 0]) == pytest.approx(2.0 * DEFAULT_INPUT_SCALE, rel=1e-6)


def test_canvas_to_nchw_rejects_incompatible_inputs() -> None:
    """Formas, ordem de canais e mean/std inválidos falham com mensagem explícita."""
    canvas = _gradient(4, 3)
    out: np.ndarray = np.empty(blob_shape(4, 3), dtype=np.float32)

    with pytest.raises(ValueError, match="Tensor de destino com forma"):
        canvas_to_nchw_float32(canvas, np.empty((1, 3, 4, 4), dtype=np.float32))
    with pytest.raises(ValueError, match="Ordem de canais desconhecida"):
        canvas_to_nchw_float32(canvas, out, channel_order="yuv")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="mean/std com"):
        # Aridade errada de propósito: é exatamente o que a validação tem de recusar.
        canvas_to_nchw_float32(canvas, out, mean=(0.0, 0.0))  # type: ignore[arg-type]
