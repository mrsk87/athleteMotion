"""Utilitários de visão para inferência ONNX em alta fidelidade geométrica.

Duas decisões que custam latência e são evitadas aqui:
- `scaleup=False` por omissão no recorte: ampliar um recorte pequeno para 640 só
  inventa píxeis (mais lento e sem rigor); quando o recorte é pequeno usa-se uma
  entrada menor.
- O recorte (ROI) é feito ANTES do letterbox, para o modelo ver a pessoa grande.
"""
from __future__ import annotations

from typing import Optional, Sequence, Tuple
import cv2
import numpy as np


# Recorte em píxeis: (x, y, largura, altura)
Rect = Tuple[int, int, int, int]


def letterbox(
    im: np.ndarray,
    new_shape: Tuple[int, int] = (640, 640),
    color: Tuple[int, int, int] = (114, 114, 114),
    auto: bool = False,
    scaleFill: bool = False,
    scaleup: bool = True,
    stride: int = 32,
) -> Tuple[np.ndarray, float, Tuple[float, float]]:
    """Redimensiona e aplica padding na imagem para 640x640 sem distorção angular."""
    shape = im.shape[:2]  # altura, largura atual
    if isinstance(new_shape, int):
        new_shape = (new_shape, new_shape)

    # Razão de escala (novo / antigo)
    r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])
    if not scaleup:
        r = min(r, 1.0)

    # Dimensões redimensionadas não-padded
    new_unpad = (int(round(shape[1] * r)), int(round(shape[0] * r)))
    dw, dh = new_shape[1] - new_unpad[0], new_shape[0] - new_unpad[1]  # padding wh

    dw /= 2.0  # Dividir padding em ambos os lados
    dh /= 2.0

    if shape[::-1] != new_unpad:
        im = cv2.resize(im, new_unpad, interpolation=cv2.INTER_LINEAR)

    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
    im = cv2.copyMakeBorder(im, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color)
    return im, r, (dw, dh)


def preprocess_image_for_onnx(
    img_bgr: np.ndarray, target_size: int = 640
) -> Tuple[np.ndarray, float, Tuple[float, float]]:
    """Gera o tensor CHW float32 [1, 3, N, N] normalizado [0, 1]."""
    img_padded, ratio, (pad_w, pad_h) = letterbox(img_bgr, (target_size, target_size))
    # BGR para RGB
    img_rgb = img_padded[:, :, ::-1]
    # HWC -> CHW
    img_chw = img_rgb.transpose((2, 0, 1)).astype(np.float32) / 255.0
    # Batch dimension: [1, 3, H, W]
    tensor = np.expand_dims(img_chw, axis=0)
    return np.ascontiguousarray(tensor), ratio, (pad_w, pad_h)


def crop_frame(frame_bgr: np.ndarray, rect: Optional[Sequence[int]]) -> np.ndarray:
    """Recorta o fotograma a `rect` (x, y, w, h) sem nunca sair da imagem.

    Sem recorte válido devolve o fotograma original (nunca uma vista vazia).
    """
    if rect is None:
        return frame_bgr
    h, w = frame_bgr.shape[:2]
    x, y, rw, rh = (int(round(v)) for v in rect)
    x = max(0, min(w - 1, x))
    y = max(0, min(h - 1, y))
    rw = max(1, min(w - x, rw))
    rh = max(1, min(h - y, rh))
    return frame_bgr[y:y + rh, x:x + rw]


def preprocess_roi_for_onnx(
    frame_bgr: np.ndarray,
    target_size: int,
    rect: Optional[Sequence[int]] = None,
) -> Tuple[np.ndarray, float, Tuple[float, float], Optional[Rect]]:
    """Recorta e ajusta ao tamanho de entrada fixo, sem nunca ampliar (scaleup=False).

    Devolve o tensor, a razão de escala, o padding e o recorte usado — este último é
    indispensável para re-mapear os keypoints de volta para as coordenadas da
    fotograma original.
    """
    used_rect: Optional[Rect] = None
    working = frame_bgr
    if rect is not None:
        x, y, rw, rh = (int(round(v)) for v in rect)
        h, w = frame_bgr.shape[:2]
        x = max(0, min(w - 1, x))
        y = max(0, min(h - 1, y))
        rw = max(1, min(w - x, rw))
        rh = max(1, min(h - y, rh))
        working = frame_bgr[y:y + rh, x:x + rw]
        used_rect = (x, y, rw, rh)

    img_padded, ratio, (pad_w, pad_h) = letterbox(
        working, (target_size, target_size), scaleup=False
    )
    img_rgb = img_padded[:, :, ::-1]
    img_chw = img_rgb.transpose((2, 0, 1)).astype(np.float32) / 255.0
    tensor = np.ascontiguousarray(np.expand_dims(img_chw, axis=0))
    return tensor, ratio, (pad_w, pad_h), used_rect
