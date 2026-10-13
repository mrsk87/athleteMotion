"""Equivalência numérica do pré-processamento do desktop com o domínio partilhado.

**Porquê este teste é obrigatório:** o desktop e o backend analisam o mesmo vídeo. Se o
recorte/letterbox/normalização divergir do domínio, os keypoints saem de sítios
diferentes conforme a aplicação — e os ângulos articulares deixam de ser comparáveis.

O critério da tarefa é ±1e-6; o teste exige **igualdade exata** (é o que acontece hoje:
o mesmo recorte, a mesma interpolação e a mesma aritmética dão o mesmo tensor) e, em
separado, compara com a tolerância pedida, para que uma alteração futura que introduza
uma diferença minúscula seja detetada e discutida em vez de passar despercebida.
"""

from __future__ import annotations

import numpy as np
import pytest

from athletemotion_desktop.runtime.preprocess.pipeline import (
    RTMPOSE_INPUT_SIZE,
    YOLO_INPUT_SIZE,
    Preprocessor,
    PreprocessRequest,
)
from athletemotion_desktop.runtime.preprocess.roi import Roi
from tests.support.domain_reference import domain_available, load_domain_onnx_utils

pytestmark = pytest.mark.skipif(
    not domain_available(),
    reason="implementação de referência do domínio ausente neste checkout",
)

NUMERIC_TOLERANCE = 1e-6
FRAME_SHAPE = (720, 1280, 3)


def _frames(count: int) -> list[np.ndarray]:
    """Gera frames sintéticas determinísticas (sem depender de vídeo no repositório)."""
    generator = np.random.default_rng(20261013)
    return [generator.integers(0, 256, size=FRAME_SHAPE, dtype=np.uint8) for _ in range(count)]


def _rois(frames: list[np.ndarray]) -> list[Roi]:
    """ROIs variados: centrais, encostados às bordas, maiores e menores que a entrada."""
    height, width = frames[0].shape[:2]
    return [
        Roi(x=0, y=0, width=width, height=height),
        Roi(x=300, y=100, width=400, height=500),
        Roi(x=0, y=0, width=200, height=200),
        Roi(x=width - 150, y=height - 120, width=400, height=500),  # sai da frame
        Roi(x=-50, y=-30, width=300, height=400),  # começa fora da frame
        Roi(x=640, y=360, width=640, height=360),  # panorâmico
        Roi(x=512, y=0, width=256, height=720),  # vertical alto (pessoa de pé)
        Roi(x=100, y=50, width=1, height=1),  # degenerado
    ]


@pytest.mark.parametrize("target_size", [(640, 640), (320, 320)])
def test_tensors_match_the_domain_within_tolerance(target_size: tuple[int, int]) -> None:
    """Para 20+ frames/ROIs, o tensor do desktop é igual ao do domínio (±1e-6).

    Só entradas quadradas são comparáveis: `preprocess_roi_for_onnx` aceita um único
    lado e constrói sempre um letterbox quadrado. A extensão retangular (192x256 do
    RTMPose) é verificada logo abaixo, separadamente.
    """
    domain = load_domain_onnx_utils()
    frames = _frames(3) * 7  # 21 frames
    rois = _rois(frames)
    processor = Preprocessor(PreprocessRequest(target_size=target_size))

    worst_difference = 0.0
    comparisons = 0
    for frame_index, frame in enumerate(frames):
        roi = rois[frame_index % len(rois)]
        reference, _ratio, _pad, _rect = domain.preprocess_roi_for_onnx(
            frame, target_size[0], roi.as_tuple()
        )
        prepared = processor.prepare(frame, roi)
        worst_difference = max(worst_difference, float(np.max(np.abs(prepared.blob - reference))))
        comparisons += 1

    print(
        f"\n[equivalência {target_size[0]}x{target_size[1]}] comparações={comparisons} "
        f"diferença máxima={worst_difference:.3e} (critério {NUMERIC_TOLERANCE:.0e})"
    )

    assert comparisons >= 20
    assert worst_difference <= NUMERIC_TOLERANCE, (
        f"diferença máxima {worst_difference:.3e} excede {NUMERIC_TOLERANCE:.0e}"
    )


def test_tensors_are_bit_identical_to_the_domain() -> None:
    """Hoje os tensores são exatamente iguais — uma divergência futura tem de ser vista."""
    domain = load_domain_onnx_utils()
    frame = _frames(1)[0]
    processor = Preprocessor(PreprocessRequest(target_size=YOLO_INPUT_SIZE))

    for roi in _rois([frame]):
        reference, _ratio, _pad, _rect = domain.preprocess_roi_for_onnx(
            frame, YOLO_INPUT_SIZE[0], roi.as_tuple()
        )
        prepared = processor.prepare(frame, roi)

        assert np.array_equal(prepared.blob, reference), f"divergiu no ROI {roi}"


def test_scale_and_padding_match_the_domain() -> None:
    """A escala e o padding devolvidos são os mesmos do domínio (é o que permite mapear)."""
    domain = load_domain_onnx_utils()
    frame = _frames(1)[0]
    processor = Preprocessor(PreprocessRequest(target_size=YOLO_INPUT_SIZE))

    for roi in _rois([frame]):
        _tensor, ratio, (pad_w, pad_h), used_rect = domain.preprocess_roi_for_onnx(
            frame, YOLO_INPUT_SIZE[0], roi.as_tuple()
        )
        prepared = processor.prepare(frame, roi)

        assert prepared.geometry.scale == pytest.approx(ratio)
        assert prepared.geometry.pad_x == pytest.approx(pad_w)
        assert prepared.geometry.pad_y == pytest.approx(pad_h)
        assert prepared.roi is not None
        assert prepared.roi.as_tuple() == used_rect


def test_padding_ratio_keeps_equivalence_when_the_domain_gets_the_expanded_roi() -> None:
    """Com padding (RTMPose 1.25), a equivalência mantém-se sobre o ROI alargado.

    O domínio não conhece padding: alargar o recorte é uma decisão do chamador. O teste
    aplica-o aqui ao ROI para provar que a matemática do desktop não muda por causa
    disso — o que muda é só a região que entra no modelo.
    """
    domain = load_domain_onnx_utils()
    frame = _frames(1)[0]
    processor = Preprocessor(PreprocessRequest(target_size=(256, 256), padding_ratio=1.25))
    roi = Roi(x=400, y=200, width=320, height=400)
    frame_height, frame_width = frame.shape[:2]
    expanded = roi.expanded(1.25, frame_width, frame_height)

    assert expanded.width > roi.width and expanded.height > roi.height

    reference, _ratio, _pad, _rect = domain.preprocess_roi_for_onnx(frame, 256, expanded.as_tuple())
    prepared = processor.prepare(frame, roi)

    assert np.array_equal(prepared.blob, reference)


def test_rectangular_input_matches_the_domain_where_they_overlap() -> None:
    """A entrada 192x256 do RTMPose é uma extensão: o que o modelo vê da pessoa é igual.

    O letterbox quadrado do domínio coloca o recorte redimensionado entre as faixas de
    padding; a versão retangular coloca exatamente os mesmos píxeis (mesma escala, mesma
    interpolação) e só difere na quantidade de padding à volta. Comparar a região
    interior contra a região interior do domínio é, por isso, a verificação exata
    possível — e é a que importa: é essa região que o modelo analisa.
    """
    domain = load_domain_onnx_utils()
    frame = _frames(1)[0]
    roi = Roi(x=400, y=200, width=300, height=400)  # 3:4, a proporção da entrada
    processor = Preprocessor(PreprocessRequest(target_size=RTMPOSE_INPUT_SIZE))

    reference, _ratio, (pad_w, pad_h), _rect = domain.preprocess_roi_for_onnx(
        frame, RTMPOSE_INPUT_SIZE[1], roi.as_tuple()
    )
    prepared = processor.prepare(frame, roi)

    assert prepared.canvas.shape[:2] == (RTMPOSE_INPUT_SIZE[1], RTMPOSE_INPUT_SIZE[0])
    assert prepared.geometry.pad_x == 0.0 and prepared.geometry.pad_y == 0.0

    # Geometria do lado do domínio (mesmo arredondamento assimétrico do padding).
    domain_left = round(pad_w - 0.1)
    domain_top = round(pad_h - 0.1)
    assert (domain_left, domain_top) == (32, 0)
    inner = reference[
        :,
        :,
        domain_top : domain_top + prepared.canvas.shape[0],
        domain_left : domain_left + prepared.canvas.shape[1],
    ]

    assert np.array_equal(prepared.blob, inner)
    assert int(prepared.canvas[0, 0, 0]) != 114, "a primeira linha devia ser imagem, não padding"


def test_transform_brings_keypoints_back_like_the_domain() -> None:
    """Converter keypoints com o transform dá o mesmo que a fórmula do backend.

    A fórmula do backend (`yolo_engine._extract_person`) é
    ``(x_modelo - pad) / ratio + offset_do_recorte``; este teste replica-a literalmente
    sobre o mesmo ROI para provar que o desktop não introduz desvio sistemático.
    """
    domain = load_domain_onnx_utils()
    frame = _frames(1)[0]
    roi = Roi(x=300, y=100, width=400, height=500)
    processor = Preprocessor(PreprocessRequest(target_size=YOLO_INPUT_SIZE))
    prepared = processor.prepare(frame, roi)

    _tensor, ratio, (pad_w, pad_h), rect = domain.preprocess_roi_for_onnx(
        frame, YOLO_INPUT_SIZE[0], roi.as_tuple()
    )
    assert rect is not None
    offsets = (float(rect[0]), float(rect[1]))

    model_points = np.array([[10.0, 20.0], [319.0, 300.0], [160.0, 160.0]], dtype=np.float32)
    converted = prepared.transform.model_to_frame(model_points)

    for index, (model_x, model_y) in enumerate(model_points):
        expected_x = (model_x - pad_w) / ratio + offsets[0]
        expected_y = (model_y - pad_h) / ratio + offsets[1]
        assert converted[index][0] == pytest.approx(expected_x)
        assert converted[index][1] == pytest.approx(expected_y)
