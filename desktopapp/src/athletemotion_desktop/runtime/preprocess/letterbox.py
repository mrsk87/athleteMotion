"""Letterbox para a entrada fixa do modelo, **escrevendo num buffer pré-alocado**.

O que este módulo evita (e porquê): a versão de referência do domínio compõe a imagem
com ``cv2.copyMakeBorder``, o que aloca um array novo a cada frame. A 60 FPS são 60
alocações por segundo de ~300 KB (320x320x3) a ~1 MB (640x640x3) — pressão constante
no *garbage collector* exatamente no *hot path* do pipeline.

Aqui a imagem é composta em quatro operações: o recorte redimensionado é colado numa
canvas pré-alocada e as quatro faixas de padding são pintadas com a cor de fundo. O
resultado em bytes é **idêntico** ao do domínio (mesma escala, mesmo arredondamento de
padding, mesma interpolação) — a equivalência é verificada por teste contra
``athletemotion.domain.inference.onnx_utils.preprocess_roi_for_onnx``.

**Sem ampliação por omissão** (``scale_up=False``): ampliar um recorte pequeno para
640 só inventa píxeis (e custa tempo). Quando o recorte é menor que a entrada, o
modelo vê a pessoa ao tamanho real, com padding à volta — a decisão vem do domínio e
é mantida aqui de propósito.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
import numpy.typing as npt

#: Cinzento usado no padding, igual ao do domínio (114, 114, 114).
DEFAULT_PAD_COLOR: tuple[int, int, int] = (114, 114, 114)


@dataclass(frozen=True, slots=True)
class LetterboxGeometry:
    """Geometria calculada de um letterbox (o que é preciso para compor e mapear).

    Attributes:
        scale: razão de escala aplicada ao recorte.
        pad_x: padding horizontal fracionário (`dw` do domínio).
        pad_y: padding vertical fracionário (`dh` do domínio).
        left: coluna onde o recorte redimensionado começa na canvas.
        top: linha onde o recorte redimensionado começa na canvas.
        resized_width: largura do recorte depois de redimensionado.
        resized_height: altura do recorte depois de redimensionado.
    """

    scale: float
    pad_x: float
    pad_y: float
    left: int
    top: int
    resized_width: int
    resized_height: int


def letterbox_geometry(
    crop_width: int,
    crop_height: int,
    target_width: int,
    target_height: int,
    *,
    scale_up: bool = False,
) -> LetterboxGeometry:
    """Calcula a escala e o padding do letterbox sem tocar em píxeis.

    A aritmética é a do domínio, incluindo o arredondamento assimétrico do padding
    (``round(dw - 0.1)`` / ``round(dw + 0.1)``), que garante que as duas faixas somam
    exatamente o espaço livre.

    Args:
        crop_width: largura do recorte de entrada.
        crop_height: altura do recorte de entrada.
        target_width: largura da entrada do modelo.
        target_height: altura da entrada do modelo.
        scale_up: permitir ampliar o recorte (`False` preserva a decisão do domínio).

    Returns:
        A geometria do letterbox.

    Raises:
        ValueError: se alguma dimensão não for positiva.
    """
    if min(crop_width, crop_height, target_width, target_height) <= 0:
        raise ValueError(
            "Dimensões inválidas no letterbox: "
            f"recorte={crop_width}x{crop_height}, entrada={target_width}x{target_height}."
        )

    scale = min(target_height / crop_height, target_width / crop_width)
    if not scale_up:
        scale = min(scale, 1.0)

    # `round` já devolve `int` em Python: sem conversão redundante.
    resized_width = round(crop_width * scale)
    resized_height = round(crop_height * scale)
    pad_x = (target_width - resized_width) / 2.0
    pad_y = (target_height - resized_height) / 2.0
    left = round(pad_x - 0.1)
    top = round(pad_y - 0.1)

    return LetterboxGeometry(
        scale=scale,
        pad_x=pad_x,
        pad_y=pad_y,
        left=left,
        top=top,
        resized_width=resized_width,
        resized_height=resized_height,
    )


def letterbox_into(
    crop: npt.NDArray[np.uint8],
    canvas: npt.NDArray[np.uint8],
    geometry: LetterboxGeometry,
    *,
    pad_color: tuple[int, int, int] = DEFAULT_PAD_COLOR,
) -> None:
    """Compõe o recorte numa canvas pré-alocada, sem alocar memória.

    Só são escritas as regiões usadas: o recorte redimensionado **e** as quatro faixas
    de padding. Não é preciso limpar a canvas antes — no fim do frame, todos os seus
    píxeis foram escritos.

    Args:
        crop: recorte BGR do frame original.
        canvas: buffer de destino ``(target_h, target_w, 3)`` uint8, reutilizado.
        geometry: geometria devolvida por :func:`letterbox_geometry`.
        pad_color: cor de fundo do padding.

    Raises:
        ValueError: se a canvas não tiver o tamanho esperado pela geometria.
    """
    top = geometry.top
    left = geometry.left
    resized_height = geometry.resized_height
    resized_width = geometry.resized_width
    if canvas.ndim != 3 or canvas.shape[2] != crop.shape[2]:
        raise ValueError(
            f"Canvas com forma {canvas.shape} incompatível com o recorte {crop.shape} "
            "(mesmo número de canais)."
        )
    if canvas.shape[0] < top + resized_height or canvas.shape[1] < left + resized_width:
        raise ValueError(
            f"Canvas {canvas.shape} demasiado pequena para a geometria "
            f"({top}+{resized_height} linhas, {left}+{resized_width} colunas)."
        )

    target_region = canvas[top : top + resized_height, left : left + resized_width]
    if crop.shape[0] == resized_height and crop.shape[1] == resized_width:
        # Já está no tamanho final: evita uma passagem de `cv2.resize` quando o recorte
        # não precisou de ser redimensionado (o domínio também salta este passo).
        target_region[:] = crop
    else:
        # `dst` escreve diretamente na canvas: sem array interm por frame.
        cv2.resize(
            crop, (resized_width, resized_height), target_region, interpolation=cv2.INTER_LINEAR
        )

    # As quatro faixas de padding. Cada fatia tem 0 linhas/colunas quando não há
    # padding nessa direção (atribuição a uma fatia vazia é uma no-op segura).
    canvas[:top, :] = pad_color
    canvas[top + resized_height :, :] = pad_color
    canvas[top : top + resized_height, :left] = pad_color
    canvas[top : top + resized_height, left + resized_width :] = pad_color


def letterbox(
    crop: npt.NDArray[np.uint8],
    target_size: tuple[int, int],
    *,
    scale_up: bool = False,
    pad_color: tuple[int, int, int] = DEFAULT_PAD_COLOR,
) -> tuple[npt.NDArray[np.uint8], LetterboxGeometry]:
    """Compõe o recorte numa canvas nova (conveniência para testes e *cold paths*).

    O caminho de tempo real usa :func:`letterbox_into` com uma canvas reutilizada; esta
    variante existe para código que não tem buffers próprios.

    Args:
        crop: recorte BGR.
        target_size: par ``(largura, altura)`` da entrada do modelo.
        scale_up: permitir ampliar o recorte.
        pad_color: cor do padding.

    Returns:
        Par ``(canvas, geometria)``.
    """
    target_width, target_height = target_size
    geometry = letterbox_geometry(
        crop.shape[1],
        crop.shape[0],
        target_width,
        target_height,
        scale_up=scale_up,
    )
    canvas: npt.NDArray[np.uint8] = np.empty(
        (target_height, target_width, crop.shape[2]), dtype=np.uint8
    )
    letterbox_into(crop, canvas, geometry, pad_color=pad_color)
    return canvas, geometry
