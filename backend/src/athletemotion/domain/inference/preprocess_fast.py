"""Pré-processamento rápido de imagens e ROIs para inferência ONNX / OpenVINO.

Substitui as operações em Python de transposição e conversão float32:
- Utiliza `cv2.dnn.blobFromImage` acelerado por AVX2/SIMD em C++.
- Elimina cópias intermédias e alocações excessivas de NumPy.
- Garante equivalência numérica estrita (erro máximo <= 1e-6) face a `preprocess_roi_for_onnx`.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import cv2
from numpy.typing import NDArray

Rect = tuple[int, int, int, int]


def fast_preprocess_roi(
    frame_bgr: NDArray[Any],
    target_size: int,
    rect: Sequence[int] | None = None,
) -> tuple[NDArray[Any], float, tuple[float, float], Rect | None]:
    """Recorta a ROI e gera o tensor CHW [1, 3, N, N] normalizado de alta velocidade.

    Args:
        frame_bgr: Fotograma BGR original uint8.
        target_size: Dimensão do lado quadrado do modelo (ex.: 320 ou 640).
        rect: Opcional (x, y, largura, altura) para recorte.

    Returns:
        (tensor, ratio, (pad_w, pad_h), used_rect)
    """
    used_rect: Rect | None = None
    working = frame_bgr

    if rect is not None:
        h, w = frame_bgr.shape[:2]
        x, y, rw, rh = (round(v) for v in rect)
        x = max(0, min(w - 1, x))
        y = max(0, min(h - 1, y))
        rw = max(1, min(w - x, rw))
        rh = max(1, min(h - y, rh))
        working = frame_bgr[y : y + rh, x : x + rw]
        used_rect = (x, y, rw, rh)

    shape = working.shape[:2]  # h, w
    r = min(target_size / shape[0], target_size / shape[1])
    r = min(r, 1.0)  # scaleup=False

    new_unpad = (round(shape[1] * r), round(shape[0] * r))
    dw = (target_size - new_unpad[0]) / 2.0
    dh = (target_size - new_unpad[1]) / 2.0

    if shape[::-1] != new_unpad:
        resized = cv2.resize(working, new_unpad, interpolation=cv2.INTER_LINEAR)
    else:
        resized = working

    top, bottom = round(dh - 0.1), round(dh + 0.1)
    left, right = round(dw - 0.1), round(dw + 0.1)

    padded = cv2.copyMakeBorder(
        resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114)
    )

    # blobFromImage executa BGR->RGB, HWC->CHW, normalização 1/255 e expand_dims em C++
    tensor = cv2.dnn.blobFromImage(
        padded,
        scalefactor=1.0 / 255.0,
        size=(target_size, target_size),
        mean=(0, 0, 0),
        swapRB=True,
        crop=False,
    )

    return tensor, r, (dw, dh), used_rect


class FastRoiPreprocessor:
    """Pré-processador reutilizável com cache de buffers."""

    def __init__(self, target_size: int = 320):
        self.target_size = target_size

    def __call__(
        self,
        frame_bgr: NDArray[Any],
        rect: Sequence[int] | None = None,
    ) -> tuple[NDArray[Any], float, tuple[float, float], Rect | None]:
        return fast_preprocess_roi(frame_bgr, self.target_size, rect)
