"""Testes da enumeração de câmaras: nomes do Windows, índices do OpenCV e *hot-plug*.

Nada aqui toca em hardware nem em PowerShell: a saída do `Get-PnpDevice` é gravada e a
sondagem de índices usa dispositivos simulados. O que se testa é sobretudo a **honestidade
da associação** entre nomes e índices (é heurística e diz-se que é) e o comportamento
quando as contagens não coincidem.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Sequence

import cv2
import pytest

from athletemotion_desktop.runtime.capture.device import CameraBackend, CaptureDevice
from athletemotion_desktop.runtime.capture.devices import (
    CameraDevice,
    CameraHotplugMonitor,
    diff_devices,
    format_devices,
    list_cameras,
    main,
    parse_pnp_cameras,
    probe_indices,
)
from tests.support.fake_capture import FakeCaptureDevice

PNP_TWO_CAMERAS = json.dumps(
    [
        {
            "FriendlyName": "Logitech BRIO",
            "InstanceId": r"USB\VID_046D&PID_085E\7&1A2B3C4D&0&2",
        },
        {
            "FriendlyName": "Câmara integrada",
            "InstanceId": r"PCI\VEN_8086&DEV_9D03\3&11583659&0&10",
        },
    ]
)

PNP_ONE_CAMERA = json.dumps(
    {"FriendlyName": "OBS Virtual Camera", "InstanceId": r"ROOT\OBSVCAM\0000"}
)


def _probing_factory(
    openable: dict[int, tuple[int, int]],
) -> Callable[[int, CameraBackend], CaptureDevice]:
    """Fábrica que abre apenas os índices indicados, com a resolução dada."""

    def factory(index: int, _backend: CameraBackend) -> FakeCaptureDevice:
        if index not in openable:
            return FakeCaptureDevice(opened=False, width=1, height=1)
        width, height = openable[index]
        return FakeCaptureDevice(
            properties={
                cv2.CAP_PROP_FRAME_WIDTH: float(width),
                cv2.CAP_PROP_FRAME_HEIGHT: float(height),
            },
            width=width,
            height=height,
        )

    return factory


def _runner(payload: str | None) -> Callable[[Sequence[str]], str | None]:
    """Executor de comandos que devolve a saída gravada do PowerShell."""

    def run(_command: Sequence[str]) -> str | None:
        return payload

    return run


def test_parse_pnp_cameras_reads_a_list() -> None:
    """Uma lista de dispositivos é interpretada com nomes e identificadores."""
    assert parse_pnp_cameras(PNP_TWO_CAMERAS) == (
        ("Logitech BRIO", r"USB\VID_046D&PID_085E\7&1A2B3C4D&0&2"),
        ("Câmara integrada", r"PCI\VEN_8086&DEV_9D03\3&11583659&0&10"),
    )


def test_parse_pnp_cameras_handles_a_single_device() -> None:
    """Com uma só câmara o `ConvertTo-Json` devolve um objeto (e não uma lista)."""
    assert parse_pnp_cameras(PNP_ONE_CAMERA) == (("OBS Virtual Camera", r"ROOT\OBSVCAM\0000"),)


@pytest.mark.parametrize(
    "payload",
    [
        None,
        "",
        "   ",
        "não é json",
        json.dumps([{"InstanceId": "sem nome"}]),
        json.dumps(["texto solto"]),
        json.dumps({"FriendlyName": "   ", "InstanceId": "x"}),
    ],
)
def test_parse_pnp_cameras_ignores_unusable_output(payload: str | None) -> None:
    """Saída ausente, inválida ou sem nome legível não produz câmaras inventadas."""
    assert parse_pnp_cameras(payload) == ()


def test_probe_indices_finds_and_releases_devices() -> None:
    """A sondagem encontra os índices utilizáveis e fecha tudo o que abriu."""
    opened: list[FakeCaptureDevice] = []

    def factory(index: int, backend: CameraBackend) -> FakeCaptureDevice:
        device = _probing_factory({0: (1280, 720), 2: (640, 480)})(index, backend)
        assert isinstance(device, FakeCaptureDevice)
        opened.append(device)
        return device

    found = probe_indices(max_index=4, device_factory=factory)

    assert found == ((0, "1280x720"), (2, "640x480"))
    assert all(device.released for device in opened)
    assert len(opened) == 4


def test_probe_indices_survives_an_index_that_raises() -> None:
    """Um índice que rebenta não invalida a descoberta dos restantes."""

    def factory(index: int, backend: CameraBackend) -> CaptureDevice:
        if index == 1:
            raise OSError("driver avariado no índice 1 (teste)")
        return _probing_factory({0: (320, 240)})(index, backend)

    assert probe_indices(max_index=3, device_factory=factory) == ((0, "320x240"),)


def test_list_cameras_pairs_names_with_indices_and_says_so() -> None:
    """Com nomes e índices em igual número, a associação é marcada como inferida."""
    devices = list_cameras(
        max_index=3,
        device_factory=_probing_factory({0: (1280, 720), 1: (1920, 1080)}),
        command_runner=_runner(PNP_TWO_CAMERAS),
    )

    assert [device.name for device in devices] == ["Logitech BRIO", "Câmara integrada"]
    assert [device.index for device in devices] == [0, 1]
    assert all(device.name_is_inferred for device in devices)
    assert devices[0].device_id.startswith("USB\\VID_046D")
    assert devices[1].resolution == "1920x1080"


def test_list_cameras_without_names_uses_generic_ones() -> None:
    """Sem o Windows a responder, os nomes são genéricos (nunca inventados)."""
    devices = list_cameras(
        max_index=2,
        device_factory=_probing_factory({0: (640, 480)}),
        command_runner=_runner(None),
    )

    assert len(devices) == 1
    assert devices[0].name == "Câmara 0"
    assert devices[0].index == 0
    assert devices[0].name_is_inferred is False
    assert devices[0].device_id == "cv2:0"


def test_list_cameras_with_mismatched_counts_avoids_the_guess() -> None:
    """Contagens diferentes impedem a associação: nomes genéricos em vez de palpites."""
    devices = list_cameras(
        max_index=2,
        device_factory=_probing_factory({0: (640, 480)}),
        command_runner=_runner(PNP_TWO_CAMERAS),
    )

    assert [device.name for device in devices] == ["Câmara 0"]
    assert devices[0].name_is_inferred is False


def test_list_cameras_keeps_devices_blocked_by_another_application() -> None:
    """Uma câmara que existe mas não abre é reportada (não desaparece da lista)."""
    devices = list_cameras(
        max_index=2,
        device_factory=_probing_factory({}),
        command_runner=_runner(PNP_TWO_CAMERAS),
    )

    assert len(devices) == 2
    assert all(device.index is None for device in devices)
    assert all(not device.is_usable for device in devices)
    assert devices[0].name == "Logitech BRIO"


def test_list_cameras_returns_nothing_when_nothing_exists() -> None:
    """Sem câmaras no Windows nem índices utilizáveis, a lista é vazia."""
    devices = list_cameras(
        max_index=2, device_factory=_probing_factory({}), command_runner=_runner(None)
    )

    assert devices == ()


def test_diff_devices_detects_connection_and_disconnection() -> None:
    """A comparação por `device_id` identifica ligações e desligações."""
    before = (
        CameraDevice("usb-1", "BRIO", 0, "dshow"),
        CameraDevice("usb-2", "Integrada", 1, "dshow"),
    )
    after = (
        CameraDevice("usb-2", "Integrada", 1, "dshow"),
        CameraDevice("usb-3", "Nova", 2, "dshow"),
    )

    added, removed = diff_devices(before, after)

    assert [device.device_id for device in added] == ["usb-3"]
    assert [device.device_id for device in removed] == ["usb-1"]


def test_diff_devices_reports_a_device_that_starts_working() -> None:
    """Passar de \"sem índice\" a utilizável conta como ligação (interessa a quem grava)."""
    busy = (CameraDevice("usb-1", "BRIO", None, None),)
    working = (CameraDevice("usb-1", "BRIO", 0, "dshow"),)

    added, removed = diff_devices(busy, working)

    assert [device.device_id for device in added] == ["usb-1"]
    assert removed == ()


def test_hotplug_monitor_reports_changes_once() -> None:
    """O vigia avisa na primeira alteração e não repete enquanto o estado não muda."""
    snapshots = [
        (CameraDevice("usb-1", "BRIO", 0, "dshow"),),
        (CameraDevice("usb-1", "BRIO", 0, "dshow"),),
        (
            CameraDevice("usb-1", "BRIO", 0, "dshow"),
            CameraDevice("usb-2", "Integrada", 1, "dshow"),
        ),
    ]
    calls: list[int] = []

    def lister() -> tuple[CameraDevice, ...]:
        return snapshots.pop(0) if len(snapshots) > 1 else snapshots[0]

    monitor = CameraHotplugMonitor(lambda added, removed: calls.append(len(added)), lister=lister)

    assert len(monitor.prime()) == 1
    assert monitor.poll_once() == ((), ())
    added, removed = monitor.poll_once()

    assert [device.device_id for device in added] == ["usb-2"]
    assert removed == ()
    assert calls == [1]


def test_hotplug_monitor_start_and_stop() -> None:
    """O vigia arranca numa thread, deteta a mudança e pára quando lhe é pedido."""
    state: dict[str, tuple[CameraDevice, ...]] = {
        "devices": (CameraDevice("usb-1", "BRIO", 0, "dshow"),)
    }
    seen: list[int] = []

    def lister() -> tuple[CameraDevice, ...]:
        return state["devices"]

    monitor = CameraHotplugMonitor(
        lambda added, removed: seen.append(len(added)), interval_s=0.05, lister=lister
    )
    try:
        monitor.start()
        state["devices"] = (
            CameraDevice("usb-1", "BRIO", 0, "dshow"),
            CameraDevice("usb-2", "Integrada", 1, "dshow"),
        )
        deadline = 2.0
        start = time.perf_counter()
        while not seen and time.perf_counter() - start < deadline:
            time.sleep(0.01)

        assert seen == [1]
    finally:
        monitor.stop()
        monitor.stop()  # idempotente


def test_format_devices_is_explicit_when_empty() -> None:
    """Sem câmaras, a mensagem diz isso em vez de imprimir nada."""
    assert "Nenhuma câmara" in format_devices(())


def test_format_devices_marks_inferred_names_and_busy_devices() -> None:
    """A listagem distingue nome inferido de nome confirmado e câmara ocupada."""
    text = format_devices(
        (
            CameraDevice("usb-1", "BRIO", 0, "dshow", resolution="1280x720", name_is_inferred=True),
            CameraDevice("usb-2", "Integrada", None, None),
        )
    )

    assert "BRIO (nome inferido): índice 0 (dshow), 1280x720" in text
    assert "sem índice OpenCV" in text


def test_main_json_output(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """O CLI em modo JSON devolve código 0 quando há câmaras utilizáveis."""
    import athletemotion_desktop.runtime.capture.devices as devices_module

    monkeypatch.setattr(
        devices_module,
        "list_cameras",
        lambda **_kwargs: (CameraDevice("usb-1", "BRIO", 0, "dshow", resolution="1280x720"),),
    )

    exit_code = main(["--json"])
    payload = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert payload[0]["name"] == "BRIO"
    assert payload[0]["index"] == 0


def test_main_returns_one_when_no_camera_works(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Sem câmaras utilizáveis o código de saída é 1 (útil em scripts de diagnóstico)."""
    import athletemotion_desktop.runtime.capture.devices as devices_module

    monkeypatch.setattr(
        devices_module,
        "list_cameras",
        lambda **_kwargs: (CameraDevice("usb-2", "Integrada", None, None),),
    )

    exit_code = main([])

    assert exit_code == 1
    assert "Integrada" in capsys.readouterr().out
