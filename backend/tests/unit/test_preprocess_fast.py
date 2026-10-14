"""Testes unitários de equivalência numérica para o pré-processamento rápido."""

import numpy as np

from athletemotion.domain.inference.onnx_utils import preprocess_roi_for_onnx
from athletemotion.domain.inference.preprocess_fast import FastRoiPreprocessor, fast_preprocess_roi


def test_fast_preprocess_numerical_equivalence_no_roi():
    """Valida equivalência estrita (+-1e-6) sem ROI em imagem 720p."""
    rng = np.random.default_rng(1234)
    frame = rng.integers(0, 256, (720, 1280, 3), dtype=np.uint8)

    t_orig, r_orig, pad_orig, rect_orig = preprocess_roi_for_onnx(frame, target_size=320, rect=None)
    t_fast, r_fast, pad_fast, rect_fast = fast_preprocess_roi(frame, target_size=320, rect=None)

    assert rect_orig == rect_fast
    assert abs(r_orig - r_fast) < 1e-5
    assert abs(pad_orig[0] - pad_fast[0]) < 1e-5
    assert abs(pad_orig[1] - pad_fast[1]) < 1e-5

    max_diff = float(np.max(np.abs(t_orig - t_fast)))
    assert max_diff <= 1e-6, f"Diferença máxima de {max_diff} excedeu o limiar de 1e-6"


def test_fast_preprocess_numerical_equivalence_with_roi():
    """Valida equivalência estrita (+-1e-6) com recorte ROI ativo."""
    rng = np.random.default_rng(5678)
    frame = rng.integers(0, 256, (1080, 1920, 3), dtype=np.uint8)
    roi = (250, 180, 600, 750)

    t_orig, r_orig, pad_orig, rect_orig = preprocess_roi_for_onnx(frame, target_size=640, rect=roi)
    t_fast, r_fast, pad_fast, rect_fast = fast_preprocess_roi(frame, target_size=640, rect=roi)

    assert rect_orig == rect_fast
    assert abs(r_orig - r_fast) < 1e-5
    assert abs(pad_orig[0] - pad_fast[0]) < 1e-5
    assert abs(pad_orig[1] - pad_fast[1]) < 1e-5

    max_diff = float(np.max(np.abs(t_orig - t_fast)))
    assert max_diff <= 1e-6, f"Diferença máxima de {max_diff} excedeu o limiar de 1e-6"


def test_fast_roi_preprocessor_class():
    """Valida funcionamento da classe encapsuladora FastRoiPreprocessor."""
    preproc = FastRoiPreprocessor(target_size=320)
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    tensor, ratio, _pad, _rect = preproc(frame)

    assert tensor.shape == (1, 3, 320, 320)
    assert tensor.dtype == np.float32
    assert ratio > 0.0
