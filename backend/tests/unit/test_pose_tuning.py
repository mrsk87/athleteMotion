"""Testes das afinações de desempenho dos motores de pose.

Cobrem exatamente as decisões que fazem o motor acompanhar o movimento:
- política de rastreio por ROI (quando se re-deteta em fotograma inteiro),
- opções de sessão que o DirectML exige,
- deteção automática do tamanho de entrada do modelo ONNX,
- descodificação SimCC do RTMPose.
"""
import numpy as np
import pytest

from athletemotion.infrastructure.hardware import HardwareManager, hardware_manager, _detect_physical_cores
from athletemotion.domain.inference.person_tracker import (
    PersonTracker,
    box_to_pixels,
    clamp_box,
    expand_box,
    iou,
)


# --------------------------------------------------------------------- tracker

def test_clamp_and_expand_and_iou_are_pure():
    assert clamp_box((-0.5, 0.2, 1.4, 0.8)) == (0.0, 0.2, 1.0, 0.8)
    assert clamp_box((0.8, 0.2, 0.3, 0.1)) == (0.3, 0.1, 0.8, 0.2)
    # margem de 50% sobre uma caixa 0.2×0.2 centrada em 0.5
    assert expand_box((0.4, 0.4, 0.6, 0.6), 0.5) == pytest.approx((0.3, 0.3, 0.7, 0.7))
    assert iou((0.0, 0.0, 1.0, 1.0), (0.0, 0.0, 1.0, 1.0)) == pytest.approx(1.0)
    assert iou((0.0, 0.0, 1.0, 1.0), (1.0, 0.0, 2.0, 1.0)) == pytest.approx(0.0)


def test_box_to_pixels_stays_inside_the_frame():
    assert box_to_pixels((0.5, 0.5, 1.0, 1.0), 100, 100) == (50, 50, 50, 50)
    x, y, w, h = box_to_pixels((-1.0, -1.0, 3.0, 3.0), 64, 48)
    assert (x, y, w, h) == (0, 0, 64, 48)


def test_tracker_detects_full_frame_only_when_needed():
    tracker = PersonTracker(redetect_interval=4, max_misses=2)

    # Sem caixa ainda não se pode reutilizar nada.
    assert tracker.needs_full_frame() is True

    tracker.observe((0.3, 0.2, 0.7, 0.9))
    assert tracker.needs_full_frame() is False

    # Enquanto o intervalo não passa, o recorte serve (fotogramas sem deteção nova).
    for _ in range(3):
        tracker.tick(pose_found=True)
        assert tracker.needs_full_frame() is False

    # Ao chegar ao intervalo, volta a detetar em fotograma inteiro.
    tracker.tick(pose_found=True)
    assert tracker.needs_full_frame() is True


def test_tracker_gives_up_after_repeated_misses():
    tracker = PersonTracker(redetect_interval=30, max_misses=2)
    tracker.observe((0.3, 0.2, 0.7, 0.9))
    tracker.tick(pose_found=False)
    assert tracker.needs_full_frame() is False
    tracker.tick(pose_found=False)
    # Duas falhas seguidas: o rastreio deixou de ser fiável.
    assert tracker.needs_full_frame() is True


def test_tracker_redetects_when_person_reaches_the_edge():
    tracker = PersonTracker(redetect_interval=100)
    tracker.observe((0.0, 0.2, 0.4, 0.9))
    assert tracker.needs_full_frame() is True


def test_tracker_smooths_and_reports_reuse_ratio():
    tracker = PersonTracker(smoothing=0.5)
    tracker.observe((0.0, 0.0, 1.0, 1.0))
    merged = tracker.observe((0.2, 0.2, 0.8, 0.8))
    assert merged == pytest.approx((0.1, 0.1, 0.9, 0.9))
    tracker.note_roi_reuse()
    stats = tracker.stats()
    assert stats["detections"] == 2
    assert stats["roi_reuses"] == 1
    assert stats["reuse_ratio"] == pytest.approx(1 / 3, abs=1e-3)


# -------------------------------------------------------------------- hardware

def test_directml_requires_memory_pattern_disabled():
    manager = HardwareManager()
    gpu_options = manager.create_session_options(gpu=True)
    cpu_options = manager.create_session_options(gpu=False)
    if manager.has_directml:
        assert gpu_options.enable_mem_pattern is False
    assert cpu_options.enable_mem_pattern is True


def test_threads_follow_physical_cores():
    manager = HardwareManager()
    assert manager.intra_op_threads == manager.physical_cores
    assert manager.physical_cores >= 1
    assert manager.inter_op_threads == 1


def test_provider_order_prefers_gpu_when_available():
    manager = HardwareManager()
    providers = manager.get_execution_providers(gpu=True)
    assert providers[-1] == "CPUExecutionProvider"
    if manager.has_directml:
        assert providers[0][0] == "DmlExecutionProvider"
        assert providers[0][1]["device_id"] == 0
    names = manager.get_execution_providers(gpu=False)
    assert names == ["CPUExecutionProvider"]


def test_physical_core_detection_never_returns_zero():
    assert _detect_physical_cores(0) >= 1
    assert _detect_physical_cores(16) >= 1
    assert hardware_manager.logical_cores >= 1


# ------------------------------------------------------------------- motores

def test_yolo_reads_input_size_from_the_model():
    from athletemotion.domain.inference.base import PoseEngineRegistry
    from athletemotion.domain.inference.yolo_engine import FAST_MODEL_CANDIDATES

    if not any(__import__("pathlib").Path(c).exists() for c in FAST_MODEL_CANDIDATES):
        pytest.skip("modelo YOLO 320/416 não exportado nesta máquina")

    engine = PoseEngineRegistry.create("yolo11_pose_fast", side="right", warmup=False)
    # O tamanho NUNCA é assumido: é lido da forma estática da sessão ONNX.
    assert engine.input_size in (320, 416)
    assert engine.is_ready is True
    assert engine.tracker.needs_full_frame() is True


def test_mediapipe_resolves_an_existing_task_model():
    from pathlib import Path

    from athletemotion.domain.inference.mediapipe_engine import resolve_landmarker_model

    resolved = resolve_landmarker_model(2)
    if resolved is None:
        pytest.skip("modelos .task do MediaPipe não descarregados nesta máquina")
    assert Path(resolved).exists()
    assert str(resolved).endswith(".task")


def test_rtmpose_simcc_decoding_maps_argmax_to_normalised_coordinates():
    from athletemotion.domain.inference.rtmpose_engine import decode_simcc

    # Distribuição com pico no índice 320 de 640 bins → 320/2/320 = 0.5
    distribution = np.zeros((2, 640), dtype=np.float32)
    distribution[0, 320] = 9.0
    distribution[1, 0] = 9.0

    coords = decode_simcc(distribution, input_length=320)
    assert coords[0] == pytest.approx(0.5, abs=1e-4)
    assert coords[1] == pytest.approx(0.0, abs=1e-4)
