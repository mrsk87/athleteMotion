"""Testes unitários e de integração para os backends, autotune, pipeline e métricas (R14)."""

import numpy as np
import pytest

from athletemotion.domain.inference.base import BasePoseEngine
from athletemotion.domain.inference.pipeline import StagedInferencePipeline
from athletemotion.domain.inference.types import (
    BiomechanicalAngles,
    InferenceOutput,
    Landmark2D,
    SegmentValidation,
)
from athletemotion.infrastructure.autotune import detect_system_hardware, get_active_profile
from athletemotion.infrastructure.backends import (
    BackendRegistry,
    OpenVinoCPUBackend,
    OrtCPUBackend,
)
from athletemotion.infrastructure.metrics import MetricsRegistry


def test_backend_registry_available():
    avail = BackendRegistry.list_available()
    assert "dml" in avail
    assert "ort_cpu" in avail
    assert "openvino" in avail
    assert avail["ort_cpu"] is True


def test_ort_cpu_backend_lifecycle():
    backend = OrtCPUBackend(threads=4)
    backend.load("models/yolo11n-pose-320.onnx")
    info = backend.info()
    assert info.name == "ort_cpu"
    assert info.precision == "FP32"
    assert info.provider == "CPUExecutionProvider"

    w_ms = backend.warmup(runs=2)
    assert w_ms >= 0.0

    dummy = np.zeros(info.details["input_shape"], dtype=np.float32)
    outs = backend.infer(dummy)
    assert len(outs) == 1
    assert outs[0].shape == (1, 56, 2100)

    backend.close()
    assert backend.session is None


def test_openvino_cpu_backend_lifecycle():
    avail = BackendRegistry.list_available()
    if not avail.get("openvino"):
        pytest.skip("OpenVINO não disponível neste ambiente.")

    backend = OpenVinoCPUBackend(threads=4)
    backend.load("models/yolo11n-pose-320.onnx")
    info = backend.info()
    assert info.name == "openvino"

    w_ms = backend.warmup(runs=2)
    assert w_ms >= 0.0

    dummy = np.zeros(info.details["input_shape"], dtype=np.float32)
    outs = backend.infer(dummy)
    assert len(outs) == 1
    assert outs[0].shape == (1, 56, 2100)

    backend.close()
    assert backend.compiled_model is None


def test_autotune_hardware_detection():
    hw = detect_system_hardware()
    assert hw["physical_cores"] >= 1
    assert hw["logical_cores"] >= hw["physical_cores"]
    assert "ort_version" in hw
    assert "os" in hw


def test_autotune_profile_structure():
    profile = get_active_profile()
    assert "hardware" in profile
    assert "profiles" in profile
    assert "realtime" in profile["profiles"]
    assert "precision" in profile["profiles"]
    assert "batch" in profile["profiles"]


def test_metrics_registry():
    m = MetricsRegistry()
    m.record_frame("test_engine", {"decode_ms": 1.5, "infer_ms": 4.2})
    m.record_drop("test_engine")
    m.set_fps("test_engine", 120.0)

    summary = m.get_summary("test_engine")
    assert summary["frames_total"] == 1
    assert summary["frames_dropped"] == 1
    assert summary["fps"] == 120.0
    assert "infer_ms" in summary["stages"]

    prom = m.generate_prometheus_text()
    assert 'athletemotion_frames_total{engine="test_engine"} 1' in prom
    assert 'athletemotion_fps_effective{engine="test_engine"} 120.0' in prom


class MockEngine(BasePoseEngine):
    def __init__(self):
        super().__init__(name="mock_engine")

    def reset(self) -> None:
        pass

    def set_side(self, side: str) -> None:
        self.side = side

    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        return InferenceOutput(
            engine_name="mock_engine",
            side="right",
            timestamp_ms=float(timestamp_ms),
            landmarks={"nose": Landmark2D(x=0.5, y=0.5, visibility=0.9)},
            angles=BiomechanicalAngles(),
            validation=SegmentValidation(),
        )


@pytest.mark.asyncio
async def test_staged_pipeline_lifecycle():
    engine = MockEngine()
    pipeline = StagedInferencePipeline(engine)
    pipeline.start()

    # Criar frame sintético JPEG
    import cv2

    img = np.zeros((100, 100, 3), dtype=np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    raw_bytes = buf.tobytes()

    pipeline.push_frame(raw_bytes, timestamp_ms=1000)
    res = await pipeline.get_result(timeout=2.0)

    assert res is not None
    output, timings = res
    assert output.engine_name == "mock_engine"
    assert timings.decode_ms >= 0.0
    assert timings.infer_ms >= 0.0

    await pipeline.stop()
