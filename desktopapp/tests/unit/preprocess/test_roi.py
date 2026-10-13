"""Testes dos recortes (ROI) e do mapeamento de coordenadas modelo ↔ frame.

Estes testes fixam a semântica de aparagem: um ROI que sai da imagem é aparado, nunca
rejeitado nem silenciosamente aceite fora dos limites (isso produziria vistas de
memória errada ou exceções do NumPy no meio do *hot path*).
"""

from __future__ import annotations

import numpy as np
import pytest

from athletemotion_desktop.runtime.preprocess.roi import (
    Roi,
    Transform,
    clamp_roi,
    crop_roi,
)

FRAME_WIDTH = 1280
FRAME_HEIGHT = 720


def test_roi_as_tuple_and_slice() -> None:
    """O ROI expõe-se nos dois formatos usados pelo pipeline."""
    roi = Roi(x=10, y=20, width=30, height=40)

    assert roi.as_tuple() == (10, 20, 30, 40)
    assert roi.to_slice() == (slice(20, 60), slice(10, 40))


def test_clamp_keeps_a_roi_inside_the_frame() -> None:
    """ROIs nas bordas são aparados exatamente como no domínio (`crop_frame`)."""
    assert Roi(x=300, y=100, width=400, height=500).clamp(FRAME_WIDTH, FRAME_HEIGHT) == Roi(
        x=300, y=100, width=400, height=500
    )
    # Começa fora da frame: o canto é puxado para dentro mantendo o tamanho do recorte
    # (semântica do domínio: o recorte desloca-se, não encolhe).
    assert Roi(x=-50, y=-30, width=300, height=400).clamp(FRAME_WIDTH, FRAME_HEIGHT) == Roi(
        x=0, y=0, width=300, height=400
    )
    # Ultrapassa a borda direita/inferior.
    assert Roi(x=1200, y=700, width=400, height=500).clamp(FRAME_WIDTH, FRAME_HEIGHT) == Roi(
        x=1200, y=700, width=80, height=20
    )
    # Completamente fora: fica um recorte mínimo de 1x1 (nunca vazio).
    assert Roi(x=5000, y=5000, width=10, height=10).clamp(FRAME_WIDTH, FRAME_HEIGHT) == Roi(
        x=1279, y=719, width=1, height=1
    )
    # Tamanho zero/negativo nunca produz um recorte degenerado.
    assert Roi(x=100, y=100, width=0, height=-5).clamp(FRAME_WIDTH, FRAME_HEIGHT) == Roi(
        x=100, y=100, width=1, height=1
    )


def test_clamp_rejects_degenerate_frame_sizes() -> None:
    """Uma frame sem dimensões não é um recorte possível — falha em vez de adivinhar."""
    with pytest.raises(ValueError, match="Dimensões de frame inválidas"):
        Roi(x=0, y=0, width=10, height=10).clamp(0, 720)


def test_clamp_roi_helper_matches_the_dataclass() -> None:
    """O atalho funcional devolve o mesmo que o método do ROI."""
    assert clamp_roi((1300, 750, 100, 100), FRAME_WIDTH, FRAME_HEIGHT) == Roi(
        x=1279, y=719, width=1, height=1
    )


def test_expanded_roi_grows_around_the_center_and_stays_inside() -> None:
    """O padding do RTMPose alarga o recorte em torno do centro, sem sair da frame."""
    roi = Roi(x=400, y=200, width=400, height=400)

    expanded = roi.expanded(1.25, FRAME_WIDTH, FRAME_HEIGHT)

    assert expanded == Roi(x=350, y=150, width=500, height=500)
    assert expanded.width > roi.width
    # O centro mantém-se (é isso que preserva a pessoa no enquadramento).
    assert expanded.x + expanded.width / 2 == roi.x + roi.width / 2

    near_edge = Roi(x=1200, y=600, width=200, height=200).expanded(1.25, FRAME_WIDTH, FRAME_HEIGHT)
    assert near_edge.x + near_edge.width <= FRAME_WIDTH
    assert near_edge.y + near_edge.height <= FRAME_HEIGHT


def test_expanded_roi_rejects_a_shrinking_ratio() -> None:
    """Um fator menor que 1 cortaria a pessoa: é engano, não configuração."""
    with pytest.raises(ValueError, match="reduziria o recorte"):
        Roi(x=0, y=0, width=10, height=10).expanded(0.8, FRAME_WIDTH, FRAME_HEIGHT)


def test_crop_roi_returns_a_view_without_copying() -> None:
    """O recorte é uma vista: nenhum píxel é copiado antes do letterbox."""
    frame = np.arange(FRAME_HEIGHT * FRAME_WIDTH * 3, dtype=np.uint8).reshape(
        FRAME_HEIGHT, FRAME_WIDTH, 3
    )
    roi = Roi(x=100, y=50, width=200, height=150)

    crop = crop_roi(frame, roi)

    assert crop.shape == (150, 200, 3)
    assert crop.base is frame or np.shares_memory(crop, frame)
    assert crop[0, 0, 0] == frame[50, 100, 0]
    # Escrever no recorte escreve na frame: é a mesma memória (zero-copy).
    crop[0, 0, 0] = 255
    assert frame[50, 100, 0] == 255


def test_crop_roi_without_roi_returns_the_frame() -> None:
    """Sem ROI, o modelo vê a frame inteira."""
    frame = np.zeros((FRAME_HEIGHT, FRAME_WIDTH, 3), dtype=np.uint8)

    assert crop_roi(frame, None) is frame


def test_crop_roi_rejects_a_non_image() -> None:
    """Uma entrada que não é imagem falha com contexto, antes de chegar ao cv2."""
    with pytest.raises(ValueError, match="Esperava uma imagem"):
        crop_roi(np.zeros((10, 10), dtype=np.uint8), Roi(x=0, y=0, width=5, height=5))


def test_crop_roi_clamps_against_an_expected_frame_size() -> None:
    """O recorte pode ser validado contra um tamanho declarado (usado nos testes D08)."""
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)

    crop = crop_roi(frame, Roi(x=0, y=0, width=100, height=100), frame_size=(100, 100))

    assert crop.shape == (100, 100, 3)


def test_transform_maps_points_both_ways() -> None:
    """Ida e volta pelo transform recupera o ponto original (sem deriva acumulada)."""
    transform = Transform(
        roi=Roi(x=300, y=100, width=400, height=500),
        scale=0.64,
        pad_x=32.0,
        pad_y=0.0,
        target_width=320,
        target_height=320,
    )

    model_point = transform.frame_to_model_point(500.0, 350.0)
    frame_point = transform.model_to_frame_point(*model_point)

    assert frame_point[0] == pytest.approx(500.0)
    assert frame_point[1] == pytest.approx(350.0)
    assert transform.model_to_frame_point(32.0, 0.0) == pytest.approx((300.0, 100.0))


def test_transform_converts_a_matrix_of_points() -> None:
    """A conversão vetorizada devolve ``(N, 2)`` float32 contíguo."""
    transform = Transform(
        roi=Roi(x=10, y=20, width=100, height=100),
        scale=1.0,
        pad_x=0.0,
        pad_y=0.0,
        target_width=100,
        target_height=100,
    )
    points = np.array([[0.0, 0.0], [50.0, 60.0]], dtype=np.float32)

    converted = transform.model_to_frame(points)

    assert converted.dtype == np.float32
    assert converted.flags["C_CONTIGUOUS"]
    assert converted.tolist() == [[10.0, 20.0], [60.0, 80.0]]


def test_transform_rejects_malformed_points_and_scales() -> None:
    """Formas inválidas falham explicitamente (nunca um resultado silenciosamente errado)."""
    with pytest.raises(ValueError, match="Escala inválida"):
        Transform(
            roi=Roi(x=0, y=0, width=10, height=10),
            scale=0.0,
            pad_x=0.0,
            pad_y=0.0,
            target_width=10,
            target_height=10,
        )

    transform = Transform(
        roi=Roi(x=0, y=0, width=10, height=10),
        scale=1.0,
        pad_x=0.0,
        pad_y=0.0,
        target_width=10,
        target_height=10,
    )
    with pytest.raises(ValueError, match="matriz \\(N, 2\\)"):
        transform.model_to_frame(np.zeros((3, 3), dtype=np.float32))
    with pytest.raises(ValueError, match="matriz \\(N, 2\\)"):
        transform.model_to_frame(np.zeros(4, dtype=np.float32))
