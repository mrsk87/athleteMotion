"""Testes do `CameraSource` com um dispositivo simulado (nenhum hardware envolvido).

Os casos que interessam são os que o driver produz na vida real: aceitar a configuração e
entregar outra coisa, fixar um buffer interno maior do que o pedido, parar de entregar
frames a meio de uma sessão e mudar de resolução sem avisar.
"""

from __future__ import annotations

import argparse
import time
from collections.abc import Callable

import cv2
import pytest

from athletemotion_desktop.runtime.capture.base import (
    CaptureOpenError,
    CaptureState,
    ThreadedCaptureSource,
)
from athletemotion_desktop.runtime.capture.camera import (
    CameraConfig,
    CameraSource,
    _parse_size,
    build_argument_parser,
    measure_camera,
)
from athletemotion_desktop.runtime.capture.controls import CameraControl
from athletemotion_desktop.runtime.capture.device import (
    CameraBackend,
    fourcc_to_code,
    fourcc_to_text,
)
from tests.support.fake_capture import FakeCaptureDevice, camera_properties, fake_camera


def _config(**overrides: object) -> CameraConfig:
    """Configuração de teste (1280x720@60 MJPG, como o plano do projeto)."""
    values: dict[str, object] = {
        "index": 0,
        "width": 1280,
        "height": 720,
        "fps": 60,
        "fourcc": "MJPG",
        "backend": CameraBackend.DSHOW,
        "max_reconnect_attempts": 1,
        "open_timeout_s": 1.0,
    }
    values.update(overrides)
    return CameraConfig(**values)  # type: ignore[arg-type]


def _factories(
    *builders: Callable[[], FakeCaptureDevice],
) -> Callable[[int, CameraBackend], FakeCaptureDevice]:
    """Fábrica de dispositivos: cada abertura constrói o próximo (o último repete-se).

    Construir um dispositivo **novo** em cada reabertura é essencial: o anterior foi
    fechado pela fonte, e reutilizar um objeto já fechado faria a reconexão falhar por um
    motivo que não existe em produção (`isOpened()` de um dispositivo libertado).
    """
    remaining = list(builders)
    assert remaining, "a fábrica precisa de pelo menos um construtor"

    def factory(_index: int, _backend: CameraBackend) -> FakeCaptureDevice:
        builder = remaining.pop(0) if len(remaining) > 1 else remaining[0]
        return builder()

    return factory


def test_open_applies_the_requested_configuration() -> None:
    """FOURCC, resolução, FPS e buffer do driver são pedidos explicitamente."""
    device = fake_camera()
    source = CameraSource(_config(), device_factory=_factories(lambda: device))
    try:
        info = source.open()

        assert device.written[cv2.CAP_PROP_FOURCC] == fourcc_to_code("MJPG")
        assert device.written[cv2.CAP_PROP_FRAME_WIDTH] == 1280
        assert device.written[cv2.CAP_PROP_FRAME_HEIGHT] == 720
        assert device.written[cv2.CAP_PROP_FPS] == 60
        assert device.written[cv2.CAP_PROP_BUFFERSIZE] == 1
        assert info.resolution == "1280x720"
        assert info.fourcc == "MJPG"
        assert info.backend == "dshow"
        assert info.warnings == ()
    finally:
        source.close()


def test_divergences_are_reported_as_warnings() -> None:
    """O que a câmara entrega é o que fica registado — nunca o que se pediu."""
    # `echo_writes=False`: a câmara aceita a escrita e continua a reportar o seu modo.
    device = fake_camera(width=640, height=480, fps=30.0, fourcc="YUY2", echo_writes=False)
    source = CameraSource(_config(), device_factory=_factories(lambda: device))
    try:
        info = source.open()

        assert info.resolution == "640x480"
        assert info.fourcc == "YUY2"
        assert info.requested_fps == 60.0
        assert len(info.warnings) == 3
        joined = " ".join(info.warnings)
        assert "640x480" in joined
        assert "30.0 FPS" in joined
        assert "YUY2" in joined
    finally:
        source.close()


def test_driver_buffer_larger_than_requested_is_reported() -> None:
    """Um buffer interno grande explica latência súbita: tem de aparecer como aviso."""
    device = fake_camera(echo_writes=False)
    device.properties[cv2.CAP_PROP_BUFFERSIZE] = 4.0
    source = CameraSource(_config(buffer_size=1), device_factory=_factories(lambda: device))
    try:
        info = source.open()

        assert any("buffer de 4 frames" in warning for warning in info.warnings)
    finally:
        source.close()


def test_open_failure_mentions_the_index_and_backend() -> None:
    """A câmara que não abre dá um erro com contexto acionável."""
    device = fake_camera(opened=False)
    source = CameraSource(_config(index=3), device_factory=_factories(lambda: device))
    try:
        with pytest.raises(CaptureOpenError) as error:
            source.open()

        message = str(error.value)
        assert "índice 3" in message
        assert "DirectShow" in message
        assert device.released is True
    finally:
        source.close()


def test_frames_are_delivered_and_indexed() -> None:
    """A câmara entrega frames crescentes através do buffer reutilizado."""
    device = fake_camera(width=4, height=3, frame_value=9)
    source = CameraSource(
        _config(width=4, height=3),
        device_factory=_factories(lambda: device),
    )
    try:
        source.open()
        first = source.read(timeout_ms=1000)
        time.sleep(0.02)
        second = source.read(timeout_ms=1000)

        assert first is not None and second is not None
        assert first.shape == (3, 4, 3)
        assert second.index > first.index
        assert first.data.base is not None
    finally:
        source.close()


def test_camera_reconnects_after_it_stops_delivering() -> None:
    """Uma câmara que deixa de entregar é reaberta automaticamente."""

    def stopping() -> FakeCaptureDevice:
        device = fake_camera(width=4, height=3)
        device.frames_available = 1
        return device

    source = CameraSource(
        _config(width=4, height=3, max_reconnect_attempts=2),
        device_factory=_factories(stopping, lambda: fake_camera(width=4, height=3)),
    )
    try:
        source.open()
        deadline = time.perf_counter() + 5.0
        while source.stats().reconnects < 1 and time.perf_counter() < deadline:
            source.read(timeout_ms=50)
            time.sleep(0.005)

        assert source.stats().reconnects >= 1
        assert source.state is CaptureState.READING
        assert source.read(timeout_ms=1000) is not None
    finally:
        source.close()


def test_unexpected_frame_shape_fails_instead_of_truncating() -> None:
    """Se a câmara mudar de resolução sem reconexão, falha em vez de entregar lixo."""

    def lying() -> FakeCaptureDevice:
        return FakeCaptureDevice(properties=camera_properties(width=4, height=3), width=5, height=3)

    source = CameraSource(
        _config(width=4, height=3, max_reconnect_attempts=1, open_timeout_s=5.0),
        device_factory=_factories(lying),
    )
    try:
        with pytest.raises(CaptureOpenError) as error:
            source.open()

        # A mensagem tem de identificar a forma recebida e a esperada: é o que permite
        # perceber que o modo da câmara mudou sem reconexão.
        assert "passou a entregar (3, 5, 3) em vez de (3, 4, 3)" in str(error.value)
        assert source.state is CaptureState.FAILED
    finally:
        source.close()


def test_controls_are_probed_and_capabilities_exposed() -> None:
    """Os controlos são detetados na abertura e expostos à interface."""
    device = fake_camera(width=4, height=3)
    device.properties[cv2.CAP_PROP_EXPOSURE] = 156.0
    device.properties[cv2.CAP_PROP_GAIN] = 12.0
    source = CameraSource(
        _config(width=4, height=3),
        device_factory=_factories(lambda: device),
    )
    try:
        source.open()

        capabilities = source.capabilities
        assert capabilities[CameraControl.EXPOSURE].supported is True
        assert capabilities[CameraControl.EXPOSURE].value == pytest.approx(156.0)
        assert capabilities[CameraControl.SATURATION].supported is False
        assert source.set_control(CameraControl.EXPOSURE, 200.0) is True
        assert source.set_control(CameraControl.SATURATION, 5.0) is False
    finally:
        source.close()


def test_lock_exposure_can_be_requested_at_open() -> None:
    """Com `lock_exposure_on_open`, a exposição é fixada durante a abertura."""
    device = fake_camera(width=4, height=3)
    device.properties[cv2.CAP_PROP_EXPOSURE] = 120.0
    source = CameraSource(
        _config(width=4, height=3, lock_exposure_on_open=True),
        device_factory=_factories(lambda: device),
    )
    try:
        source.open()

        assert device.written[cv2.CAP_PROP_EXPOSURE] == pytest.approx(120.0)
    finally:
        source.close()


def test_preset_round_trip_on_the_camera() -> None:
    """Um preset tira uma fotografia dos controlos suportados e volta a aplicá-los."""
    device = fake_camera(width=4, height=3)
    device.properties[cv2.CAP_PROP_GAIN] = 8.0
    source = CameraSource(
        _config(width=4, height=3),
        device_factory=_factories(lambda: device),
    )
    try:
        source.open()
        preset = source.save_preset("ginásio")

        device.properties[cv2.CAP_PROP_GAIN] = 99.0
        rejected = source.apply_preset(preset)

        assert preset.device_id == "camera:0"
        assert preset.controls["gain"] == pytest.approx(8.0)
        assert device.properties[cv2.CAP_PROP_GAIN] == pytest.approx(8.0)
        assert rejected == ()
    finally:
        source.close()


def test_camera_is_a_capture_source() -> None:
    """O `CameraSource` cumpre o contrato da base e expõe a configuração pedida."""
    device = fake_camera()
    source = CameraSource(_config(), device_factory=_factories(lambda: device))

    assert isinstance(source, ThreadedCaptureSource)
    assert source.source_id == "camera:0"
    assert source.config.resolution == "1280x720"


def test_measure_camera_reports_captured_and_delivered() -> None:
    """A medição por CLI devolve contadores coerentes com o consumo."""
    device = fake_camera(width=4, height=3, frame_delay_s=0.002)
    info, measured_fps, captured, delivered, dropped = measure_camera(
        _config(width=4, height=3, fps=120),
        0.2,
        device_factory=_factories(lambda: device),
    )

    assert info.resolution == "4x3"
    assert captured == delivered + dropped
    assert captured > 0
    assert measured_fps > 0


def test_size_argument_parsing() -> None:
    """`--size` aceita `LARGURAxALTURA` e recusa tudo o resto."""
    assert _parse_size("1280x720") == (1280, 720)
    assert _parse_size("640X480") == (640, 480)
    with pytest.raises(argparse.ArgumentTypeError, match="resolução inválida"):
        _parse_size("1280")


def test_argument_parser_defaults_match_the_plan() -> None:
    """Os valores por omissão da CLI são os do plano (720p60 em MJPG via DirectShow)."""
    arguments = build_argument_parser().parse_args([])

    assert arguments.size == (1280, 720)
    assert arguments.fps == 60
    assert arguments.fourcc == "MJPG"
    assert arguments.backend == "dshow"
    assert arguments.list is False


def test_fourcc_helpers_are_consistent() -> None:
    """O código FOURCC escrito na câmara é o que se lê de volta."""
    assert fourcc_to_text(float(fourcc_to_code("MJPG"))) == "MJPG"
