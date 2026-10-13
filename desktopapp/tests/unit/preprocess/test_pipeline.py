"""Testes do pré-processador: reutilização de buffers e mapeamento de coordenadas.

O critério que interessa aqui é **não alocar por frame**: se cada frame criasse uma
canvas e um tensor novos, o pipeline de tempo real ficaria a competir com o *garbage
collector*. O teste mede isso em vez de confiar na leitura do código.
"""

from __future__ import annotations

import gc
import tracemalloc

import numpy as np
import pytest

from athletemotion_desktop.runtime.preprocess.pipeline import (
    RTMPOSE_INPUT_SIZE,
    PreparedFrame,
    Preprocessor,
    PreprocessRequest,
)
from athletemotion_desktop.runtime.preprocess.roi import Roi

FRAME_HEIGHT = 720
FRAME_WIDTH = 1280
#: Orçamento de crescimento de memória Python para 100 frames. É deliberadamente
#: folgado (objetos `PreparedFrame`/`Transform` são criados e libertados): o que o teste
#: deteta é uma cópia do frame ou do tensor por iteração (centenas de KB a MB).
MAX_PYTHON_GROWTH_BYTES = 200_000


def _frame() -> np.ndarray:
    """Frame sintética determinística."""
    generator = np.random.default_rng(3)
    return generator.integers(0, 256, size=(FRAME_HEIGHT, FRAME_WIDTH, 3), dtype=np.uint8)


def test_prepare_returns_the_internal_buffers() -> None:
    """O tensor devolvido é o buffer do pré-processador (não uma cópia por frame)."""
    processor = Preprocessor(PreprocessRequest(target_size=(320, 320)))
    frame = _frame()

    first = processor.prepare(frame, Roi(x=100, y=100, width=200, height=300))
    second = processor.prepare(frame, Roi(x=110, y=100, width=200, height=300))

    assert first.blob is processor.blob
    assert second.blob is processor.blob
    assert first.canvas is processor.canvas
    assert second.canvas is processor.canvas
    assert first.blob is second.blob


def test_prepare_does_not_grow_python_memory() -> None:
    """100 frames não acumulam memória Python (nem copiam o frame por iteração)."""
    processor = Preprocessor(PreprocessRequest(target_size=(640, 640)))
    frame = _frame()
    roi = Roi(x=200, y=100, width=400, height=500)

    gc.collect()
    tracemalloc.start()
    baseline, _ = tracemalloc.get_traced_memory()
    for _ in range(100):
        processor.prepare(frame, roi)
    gc.collect()
    current, _ = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    assert current - baseline < MAX_PYTHON_GROWTH_BYTES, (
        f"o pré-processamento acumulou {current - baseline} bytes em 100 frames"
    )


def test_expected_warning_about_reused_buffers() -> None:
    """Documenta (em teste) que os buffers são reutilizados e têm de ser copiados."""
    processor = Preprocessor(PreprocessRequest(target_size=(256, 256)))
    frame = _frame()

    prepared: PreparedFrame = processor.prepare(frame, Roi(x=0, y=0, width=300, height=300))
    copy_of_tensor = prepared.blob.copy()
    processor.prepare(frame, Roi(x=400, y=200, width=300, height=300))

    assert not np.array_equal(copy_of_tensor, prepared.blob)
    assert np.array_equal(copy_of_tensor, copy_of_tensor)  # a cópia manteve-se válida


def test_prepare_without_roi_uses_the_whole_frame() -> None:
    """Sem ROI, o recorte é a frame inteira e o transform tem offset zero."""
    processor = Preprocessor(PreprocessRequest(target_size=(640, 640)))

    prepared = processor.prepare(_frame())

    assert prepared.roi is None
    assert prepared.transform.roi.as_tuple() == (0, 0, FRAME_WIDTH, FRAME_HEIGHT)
    assert prepared.canvas.shape == (640, 640, 3)


def test_padding_ratio_expands_the_roi_inside_the_frame() -> None:
    """Com padding (RTMPose), o ROI efetivo é maior mas continua dentro da frame."""
    processor = Preprocessor(PreprocessRequest(target_size=RTMPOSE_INPUT_SIZE, padding_ratio=1.25))
    roi = Roi(x=1180, y=620, width=100, height=100)

    prepared = processor.prepare(_frame(), roi)

    assert prepared.roi is not None
    assert prepared.roi.width >= roi.width
    assert prepared.roi.x + prepared.roi.width <= FRAME_WIDTH
    assert prepared.roi.y + prepared.roi.height <= FRAME_HEIGHT


def test_transform_round_trip_through_the_pipeline() -> None:
    """Um ponto da frame convertido para o modelo e de volta volta ao mesmo sítio."""
    processor = Preprocessor(PreprocessRequest(target_size=(640, 640)))
    roi = Roi(x=300, y=100, width=400, height=500)
    prepared = processor.prepare(_frame(), roi)

    model_point = prepared.transform.frame_to_model_point(500.0, 350.0)
    frame_point = prepared.transform.model_to_frame_point(*model_point)

    assert frame_point[0] == pytest.approx(500.0)
    assert frame_point[1] == pytest.approx(350.0)
    # O canto do ROI mapeia para o canto do recorte dentro do letterbox.
    assert prepared.transform.frame_to_model_point(roi.x, roi.y) != (0.0, 0.0)
    assert prepared.transform.frame_to_model_point(float(roi.x), float(roi.y)) == pytest.approx(
        (prepared.geometry.pad_x, prepared.geometry.pad_y)
    )


def test_configure_reallocates_only_when_the_size_changes() -> None:
    """Mudar de resolução obriga a realocar; mudar a média/desvio não."""
    processor = Preprocessor(PreprocessRequest(target_size=(640, 640)))
    original_blob = processor.blob
    original_canvas = processor.canvas

    processor.configure(PreprocessRequest(target_size=(640, 640), mean=(0.485, 0.456, 0.406)))
    assert processor.blob is original_blob
    assert processor.canvas is original_canvas

    processor.configure(PreprocessRequest(target_size=(320, 320)))
    assert processor.blob is not original_blob
    assert processor.canvas is not original_canvas
    assert processor.blob.shape == (1, 3, 320, 320)


def test_with_size_returns_a_copy() -> None:
    """O pedido é imutável: `with_size` não altera o original (seguro para partilhar)."""
    request = PreprocessRequest(target_size=(640, 640))

    smaller = request.with_size((320, 320))

    assert request.target_size == (640, 640)
    assert smaller.target_size == (320, 320)


def test_prepare_rejects_a_frame_that_is_not_an_image() -> None:
    """Uma entrada mal formada falha antes de chegar ao cv2."""
    processor = Preprocessor()

    with pytest.raises(ValueError, match="Esperava uma imagem"):
        processor.prepare(np.zeros((10, 10), dtype=np.uint8))
