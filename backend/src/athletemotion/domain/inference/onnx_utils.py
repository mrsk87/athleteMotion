"""Utilitários de visão para inferência ONNX em alta fidelidade geométrica.

Duas decisões que custam latência e são evitadas aqui:
- `scaleup=False` por omissão no recorte: ampliar um recorte pequeno para 640 só
  inventa píxeis (mais lento e sem rigor); quando o recorte é pequeno usa-se uma
  entrada menor.
- O recorte (ROI) é feito ANTES do letterbox, para o modelo ver a pessoa grande.
"""

from __future__ import annotations

from collections.abc import Sequence

import cv2
import numpy as np

# Recorte em píxeis: (x, y, largura, altura)
Rect = tuple[int, int, int, int]


def letterbox(
    im: np.ndarray,
    new_shape: tuple[int, int] = (640, 640),
    color: tuple[int, int, int] = (114, 114, 114),
    auto: bool = False,
    scaleFill: bool = False,
    scaleup: bool = True,
    stride: int = 32,
) -> tuple[np.ndarray, float, tuple[float, float]]:
    """Redimensiona e aplica padding na imagem para 640x640 sem distorção angular."""
    shape = im.shape[:2]  # altura, largura atual
    if isinstance(new_shape, int):
        new_shape = (new_shape, new_shape)

    # Razão de escala (novo / antigo)
    r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])
    if not scaleup:
        r = min(r, 1.0)

    # Dimensões redimensionadas não-padded
    new_unpad = (round(shape[1] * r), round(shape[0] * r))
    dw, dh = new_shape[1] - new_unpad[0], new_shape[0] - new_unpad[1]  # padding wh

    dw /= 2.0  # Dividir padding em ambos os lados
    dh /= 2.0

    if shape[::-1] != new_unpad:
        im = cv2.resize(im, new_unpad, interpolation=cv2.INTER_LINEAR)

    top, bottom = round(dh - 0.1), round(dh + 0.1)
    left, right = round(dw - 0.1), round(dw + 0.1)
    im = cv2.copyMakeBorder(im, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color)
    return im, r, (dw, dh)


def preprocess_image_for_onnx(
    img_bgr: np.ndarray, target_size: int = 640
) -> tuple[np.ndarray, float, tuple[float, float]]:
    """Gera o tensor CHW float32 [1, 3, N, N] normalizado [0, 1]."""
    img_padded, ratio, (pad_w, pad_h) = letterbox(img_bgr, (target_size, target_size))
    # BGR para RGB
    img_rgb = img_padded[:, :, ::-1]
    # HWC -> CHW
    img_chw = img_rgb.transpose((2, 0, 1)).astype(np.float32) / 255.0
    # Batch dimension: [1, 3, H, W]
    tensor = np.expand_dims(img_chw, axis=0)
    return np.ascontiguousarray(tensor), ratio, (pad_w, pad_h)


def crop_frame(frame_bgr: np.ndarray, rect: Sequence[int] | None) -> np.ndarray:
    """Recorta o fotograma a `rect` (x, y, w, h) sem nunca sair da imagem.

    Sem recorte válido devolve o fotograma original (nunca uma vista vazia).
    """
    if rect is None:
        return frame_bgr
    h, w = frame_bgr.shape[:2]
    x, y, rw, rh = (round(v) for v in rect)
    x = max(0, min(w - 1, x))
    y = max(0, min(h - 1, y))
    rw = max(1, min(w - x, rw))
    rh = max(1, min(h - y, rh))
    return frame_bgr[y : y + rh, x : x + rw]


def preprocess_roi_for_onnx(
    frame_bgr: np.ndarray,
    target_size: int,
    rect: Sequence[int] | None = None,
) -> tuple[np.ndarray, float, tuple[float, float], Rect | None]:
    """Recorta e ajusta ao tamanho de entrada fixo, sem nunca ampliar (scaleup=False).

    Devolve o tensor, a razão de escala, o padding e o recorte usado — este último é
    indispensável para re-mapear os keypoints de volta para as coordenadas da
    fotograma original.
    """
    used_rect: Rect | None = None
    working = frame_bgr
    if rect is not None:
        x, y, rw, rh = (round(v) for v in rect)
        h, w = frame_bgr.shape[:2]
        x = max(0, min(w - 1, x))
        y = max(0, min(h - 1, y))
        rw = max(1, min(w - x, rw))
        rh = max(1, min(h - y, rh))
        working = frame_bgr[y : y + rh, x : x + rw]
        used_rect = (x, y, rw, rh)

    img_padded, ratio, (pad_w, pad_h) = letterbox(
        working, (target_size, target_size), scaleup=False
    )
    img_rgb = img_padded[:, :, ::-1]
    img_chw = img_rgb.transpose((2, 0, 1)).astype(np.float32) / 255.0
    tensor = np.ascontiguousarray(np.expand_dims(img_chw, axis=0))
    return tensor, ratio, (pad_w, pad_h), used_rect


def preprocess_topdown_affine(
    img_bgr: np.ndarray,
    bbox_xyxy: tuple[float, float, float, float],
    target_wh: tuple[int, int] = (192, 256),
    padding: float = 1.25,
    mean: Sequence[float] = (123.675, 116.28, 103.53),
    std: Sequence[float] = (58.395, 57.12, 57.375),
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Recorta e deforma afim o ciclista para a resolução fixa do RTMPose (192x256).

    Preserva a razão de aspeto anatómica sem distorção e calcula a matriz inversa
    para remapear keypoints diretamente para as coordenadas do frame original.

    Returns:
        (tensor_chw [1, 3, H, W], M [2, 3], M_inv [2, 3])
    """
    target_w, target_h = target_wh
    x1, y1, x2, y2 = bbox_xyxy
    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0
    bw = max(1e-4, x2 - x1)
    bh = max(1e-4, y2 - y1)

    scale_w = bw * padding
    scale_h = bh * padding
    aspect_ratio = target_w / float(target_h)

    if scale_w > scale_h * aspect_ratio:
        scale_h = scale_w / aspect_ratio
    else:
        scale_w = scale_h * aspect_ratio

    half_w = scale_w * 0.5
    half_h = scale_h * 0.5

    src_pts = np.array(
        [
            [cx - half_w, cy - half_h],
            [cx + half_w, cy - half_h],
            [cx + half_w, cy + half_h],
        ],
        dtype=np.float32,
    )
    dst_pts = np.array(
        [
            [0.0, 0.0],
            [float(target_w), 0.0],
            [float(target_w), float(target_h)],
        ],
        dtype=np.float32,
    )

    m = cv2.getAffineTransform(src_pts, dst_pts)
    m_inv = cv2.invertAffineTransform(m)

    warped = cv2.warpAffine(
        img_bgr, m, (target_w, target_h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT
    )
    warped_rgb = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB)
    mean_arr = np.array(mean, dtype=np.float32).reshape(1, 1, 3)
    std_arr = np.array(std, dtype=np.float32).reshape(1, 1, 3)
    norm = (warped_rgb.astype(np.float32) - mean_arr) / std_arr
    chw = norm.transpose((2, 0, 1))
    tensor = np.ascontiguousarray(np.expand_dims(chw, axis=0))
    return tensor, m, m_inv


def transform_points_affine(points_xy: np.ndarray, m_inv: np.ndarray) -> np.ndarray:
    """Aplica a transformação afim inversa aos pontos preditos pelo modelo.

    Args:
        points_xy: Array de forma [N, 2] no espaço (target_w, target_h).
        m_inv: Matriz de transformação afim 2x3.

    Returns:
        Array de forma [N, 2] no espaço de pixels do fotograma original.
    """
    if points_xy.ndim != 2 or points_xy.shape[1] != 2:
        return points_xy
    pts_ones = np.hstack([points_xy, np.ones((points_xy.shape[0], 1), dtype=np.float32)])
    return (m_inv @ pts_ones.T).T

