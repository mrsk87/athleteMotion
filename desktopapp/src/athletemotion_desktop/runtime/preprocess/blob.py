"""Conversão da canvas (HWC uint8 BGR) no tensor NCHW float32 que o modelo consome.

**O que se evita:** a cadeia de referência
``canvas[:, :, ::-1].transpose(2, 0, 1).astype(np.float32) / 255.0``
cria dois arrays temporários por frame (a canais planarizados e a cópia float32), a
1080p isso são ~25 MB de alocações por *passagem* de frame. Aqui cada canal é
convertido com um *ufunc* NumPy que escreve **diretamente** no tensor de destino já
alocado (``out=``), canal a canal.

A aritmética é a mesma do domínio — ``(píxel * escala - média) / desvio`` — pelo que o
resultado é numericamente igual (a equivalência é verificada contra
``preprocess_roi_for_onnx``). A ordem dos canais é configurável porque os modelos do
projeto esperam RGB (convertido de BGR na captura), mas manter a ordem de origem é
útil em modelos treinados em BGR.
"""

from __future__ import annotations

from typing import Final, Literal

import numpy as np
import numpy.typing as npt

#: Ordem dos canais aceite pelo conversor.
ChannelOrder = Literal["rgb", "bgr"]

#: Escala padrão: os modelos do projeto normalizam para [0, 1].
DEFAULT_INPUT_SCALE: Final[float] = 1.0 / 255.0

#: Índices de origem de cada canal de saída (a canvas está em BGR).
_SOURCE_CHANNEL_INDEX: Final[dict[ChannelOrder, tuple[int, int, int]]] = {
    "rgb": (2, 1, 0),
    "bgr": (0, 1, 2),
}


def blob_shape(
    target_width: int, target_height: int, channels: int = 3
) -> tuple[int, int, int, int]:
    """Devolve a forma do tensor de entrada ``(1, canais, altura, largura)``.

    Args:
        target_width: largura da entrada do modelo.
        target_height: altura da entrada do modelo.
        channels: número de canais.

    Returns:
        A forma NCHW.

    Raises:
        ValueError: se alguma dimensão não for positiva.
    """
    if min(target_width, target_height, channels) <= 0:
        raise ValueError(
            f"Dimensões inválidas para o tensor: {channels}x{target_height}x{target_width}."
        )
    return (1, channels, target_height, target_width)


def canvas_to_nchw_float32(
    canvas: npt.NDArray[np.uint8],
    out: npt.NDArray[np.float32],
    *,
    channel_order: ChannelOrder = "rgb",
    input_scale: float = DEFAULT_INPUT_SCALE,
    mean: tuple[float, float, float] = (0.0, 0.0, 0.0),
    std: tuple[float, float, float] = (1.0, 1.0, 1.0),
    apply_mean_std: bool = True,
) -> None:
    """Escreve a canvas no tensor NCHW de destino, sem alocações intermédias.

    Args:
        canvas: imagem ``(altura, largura, 3)`` uint8 (BGR, como sai da captura).
        out: tensor de destino ``(1, 3, altura, largura)`` float32, C-contíguo.
        channel_order: ordem dos canais no tensor de saída.
        input_scale: fator multiplicativo inicial (por omissão ``1/255``).
        mean: média por canal subtraída depois da escala.
        std: desvio-padrão por canal pelo qual se divide depois da subtração.
        apply_mean_std: quando `False`, aplica apenas a escala (evita duas passagens
            de *ufunc* quando a média/desvio não são usados, o caso do YOLO).

    Raises:
        ValueError: se as formas não forem compatíveis ou a ordem de canais for
            desconhecida.
    """
    expected_shape = blob_shape(canvas.shape[1], canvas.shape[0], canvas.shape[2])
    if out.shape != expected_shape:
        raise ValueError(
            f"Tensor de destino com forma {out.shape}, esperada {expected_shape} "
            f"para uma canvas {canvas.shape}."
        )
    if channel_order not in _SOURCE_CHANNEL_INDEX:
        raise ValueError(
            f"Ordem de canais desconhecida: {channel_order!r} "
            f"(suportadas: {sorted(_SOURCE_CHANNEL_INDEX)})."
        )
    if len(mean) != canvas.shape[2] or len(std) != canvas.shape[2]:
        raise ValueError(
            f"mean/std com {len(mean)}/{len(std)} valores para {canvas.shape[2]} canais."
        )

    source_channels = _SOURCE_CHANNEL_INDEX[channel_order]
    for destination_channel, source_index in enumerate(source_channels):
        destination = out[0, destination_channel]
        # `casting="unsafe"` é necessário porque a origem é uint8 e o destino float32;
        # é intencional e local: o tipo do destino é ainda validado (float32).
        np.multiply(canvas[:, :, source_index], input_scale, out=destination, casting="unsafe")
        if apply_mean_std and (mean[destination_channel] != 0.0 or std[destination_channel] != 1.0):
            if mean[destination_channel] != 0.0:
                np.subtract(destination, mean[destination_channel], out=destination)
            if std[destination_channel] != 1.0:
                np.divide(destination, std[destination_channel], out=destination)


def to_nchw_float32(
    canvas: npt.NDArray[np.uint8],
    *,
    channel_order: ChannelOrder = "rgb",
    input_scale: float = DEFAULT_INPUT_SCALE,
    mean: tuple[float, float, float] = (0.0, 0.0, 0.0),
    std: tuple[float, float, float] = (1.0, 1.0, 1.0),
) -> npt.NDArray[np.float32]:
    """Versão que aloca o tensor (conveniência para testes e *cold paths*).

    O caminho de tempo real usa :func:`canvas_to_nchw_float32` com um buffer próprio.

    Args:
        canvas: imagem ``(altura, largura, 3)`` uint8.
        channel_order: ordem dos canais na saída.
        input_scale: fator multiplicativo inicial.
        mean: média por canal.
        std: desvio-padrão por canal.

    Returns:
        Tensor ``(1, 3, altura, largura)`` float32 contíguo.
    """
    out: npt.NDArray[np.float32] = np.empty(
        blob_shape(canvas.shape[1], canvas.shape[0], canvas.shape[2]), dtype=np.float32
    )
    canvas_to_nchw_float32(
        canvas,
        out,
        channel_order=channel_order,
        input_scale=input_scale,
        mean=mean,
        std=std,
        apply_mean_std=any(value != 0.0 for value in mean) or any(value != 1.0 for value in std),
    )
    return out
