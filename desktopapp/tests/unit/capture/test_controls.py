"""Testes dos controlos de câmara: verificação de suporte, trava de exposição e presets.

O tema destes testes é a **honestidade**: um driver que aceita tudo mas não devolve nada
não pode levar a aplicação a apresentar controlos que não existem, nem a gravar presets que
não se reproduzem.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path

import cv2
import pytest

from athletemotion_desktop.runtime.capture.controls import (
    PRESET_SCHEMA_VERSION,
    PRESETS_FILE_NAME,
    CameraControl,
    CameraPreset,
    apply_preset,
    capture_preset,
    load_presets,
    lock_exposure,
    probe_controls,
    save_presets,
    set_control,
)
from tests.fakes.fake_camera import FakeCaptureDevice, camera_properties


def _device(
    properties_extra: Mapping[int, float] | None = None, **device_options: object
) -> FakeCaptureDevice:
    """Dispositivo simulado com propriedades extra e opções do dobre.

    Args:
        properties_extra: propriedades adicionais (`CAP_PROP_*` → valor).
        device_options: opções do `FakeCaptureDevice` (ex.: `accept_writes=False`).
    """
    properties = camera_properties()
    properties.update(properties_extra or {})
    return FakeCaptureDevice(properties=properties, **device_options)  # type: ignore[arg-type]


def test_supported_controls_are_confirmed_by_a_write_read_round_trip() -> None:
    """Um controlo é suportado quando a escrita é aceite e a leitura confirma o valor."""
    device = _device({cv2.CAP_PROP_EXPOSURE: 156.0, cv2.CAP_PROP_GAIN: 4.0})

    capabilities = probe_controls(device)

    assert capabilities[CameraControl.EXPOSURE].supported is True
    assert capabilities[CameraControl.EXPOSURE].value == pytest.approx(156.0)
    assert "confirmado" in capabilities[CameraControl.EXPOSURE].reason
    assert device.written[cv2.CAP_PROP_EXPOSURE] == pytest.approx(156.0)


def test_driver_that_only_returns_zero_is_not_considered_supported() -> None:
    """Aceitar escritas e devolver sempre 0.0 não é suporte: fica explícito o contrário."""
    device = FakeCaptureDevice(properties=camera_properties())

    capabilities = probe_controls(device)

    assert capabilities[CameraControl.GAIN].supported is False
    assert capabilities[CameraControl.GAIN].value == pytest.approx(0.0)
    assert "indistinguível de não suportado" in capabilities[CameraControl.GAIN].reason


def test_driver_that_refuses_writes_reports_no_support() -> None:
    """Um driver que recusa tudo não expõe nenhum controlo."""
    device = _device(accept_writes=False)

    capabilities = probe_controls(device)

    assert all(not capability.supported for capability in capabilities.values())
    assert device.written == {}


def test_driver_that_raises_on_read_is_handled() -> None:
    """Uma exceção do driver ao ler um controlo não interrompe a sondagem."""

    class ExplodingDevice(FakeCaptureDevice):
        def get(self, prop_id: int) -> float:
            if prop_id == cv2.CAP_PROP_GAIN:
                raise RuntimeError("propriedade inválida no driver (teste)")
            return super().get(prop_id)

    device = ExplodingDevice(properties=camera_properties())

    capabilities = probe_controls(device)

    assert capabilities[CameraControl.GAIN].supported is False
    assert "leitura falhou" in capabilities[CameraControl.GAIN].reason
    # O resto da sondagem continua: um controlo avariado não invalida os outros.
    assert CameraControl.SATURATION in capabilities


def test_set_control_ignores_unsupported_controls() -> None:
    """Escrever num controlo não suportado devolve `False` e não toca no dispositivo."""
    device = FakeCaptureDevice(properties=camera_properties())
    capabilities = probe_controls(device)
    # A sondagem escreve o valor atual de cada controlo para os verificar; o que não pode
    # aparecer é uma escrita *nova* depois disso.
    writes_after_probe = dict(device.written)

    assert set_control(device, capabilities, CameraControl.FOCUS, 10.0) is False
    assert device.written == writes_after_probe


def test_set_control_reports_driver_refusal() -> None:
    """Se o driver recusar a escrita, o resultado é `False` (nunca um sucesso presumido)."""
    device = _device({cv2.CAP_PROP_GAIN: 4.0})
    capabilities = probe_controls(device)
    device.accept_writes = False

    assert set_control(device, capabilities, CameraControl.GAIN, 12.0) is False


def test_lock_exposure_turns_off_auto_and_fixes_the_value() -> None:
    """Travar a exposição desliga a automática e fixa o valor que ela estava a usar."""
    device = _device({cv2.CAP_PROP_EXPOSURE: 120.0, cv2.CAP_PROP_AUTO_EXPOSURE: 0.75})
    capabilities = probe_controls(device)

    locked = lock_exposure(device, capabilities)

    assert locked == pytest.approx(120.0)
    assert device.written[cv2.CAP_PROP_AUTO_EXPOSURE] == 0.0
    assert device.written[cv2.CAP_PROP_EXPOSURE] == pytest.approx(120.0)


def test_lock_exposure_returns_none_when_not_controllable() -> None:
    """Sem controlo de exposição, a função diz que não conseguiu (não inventa um valor)."""
    device = FakeCaptureDevice(properties=camera_properties())
    capabilities = probe_controls(device)
    writes_after_probe = dict(device.written)

    assert lock_exposure(device, capabilities) is None
    assert device.written == writes_after_probe


def test_capture_preset_keeps_only_supported_controls() -> None:
    """Um preset guarda apenas o que foi verificado — o resto não se reproduziria."""
    device = _device({cv2.CAP_PROP_GAIN: 8.0, cv2.CAP_PROP_EXPOSURE: 90.0})
    capabilities = probe_controls(device)

    preset = capture_preset("ginásio", "camera:0", capabilities)

    assert set(preset.controls) == {"gain", "exposure"}
    assert preset.device_id == "camera:0"
    assert preset.controls["gain"] == pytest.approx(8.0)


def test_apply_preset_reports_what_it_could_not_apply() -> None:
    """Controlos que o dispositivo não aceita são devolvidos ao chamador."""
    device = _device({cv2.CAP_PROP_GAIN: 8.0})
    capabilities = probe_controls(device)
    preset = CameraPreset(
        name="importado",
        device_id="camera:0",
        controls={"gain": 12.0, "saturation": 40.0},
        created_at="2026-10-13T00:00:00+00:00",
    )

    rejected = apply_preset(device, capabilities, preset)

    assert rejected == (CameraControl.SATURATION,)
    assert device.properties[cv2.CAP_PROP_GAIN] == pytest.approx(12.0)


def test_apply_preset_ignores_unknown_control_names() -> None:
    """Um preset de outra versão com um nome desconhecido não rebenta a aplicação."""
    device = _device({cv2.CAP_PROP_GAIN: 8.0})
    capabilities = probe_controls(device)
    preset = CameraPreset(
        name="futuro",
        device_id="camera:0",
        controls={"gain": 3.0, "gamma_inexistente": 1.0},
        created_at="2026-10-13T00:00:00+00:00",
    )

    assert apply_preset(device, capabilities, preset) == ()
    assert device.properties[cv2.CAP_PROP_GAIN] == pytest.approx(3.0)


def test_presets_round_trip_through_disk(tmp_path: Path) -> None:
    """Gravar e ler presets devolve exatamente o que foi gravado."""
    presets_file = tmp_path / "camera_presets.json"
    preset = CameraPreset(
        name="ginásio",
        device_id="camera:0",
        controls={"exposure": 156.0, "gain": 4.0},
        created_at="2026-10-13T10:00:00+00:00",
    )

    save_presets((preset,), presets_file)
    loaded = load_presets(presets_file)

    assert loaded == (preset,)
    payload = json.loads(presets_file.read_text(encoding="utf-8"))
    assert payload["schema_version"] == PRESET_SCHEMA_VERSION


def test_saving_presets_is_atomic_and_leaves_no_temporary_file(tmp_path: Path) -> None:
    """A gravação não deixa ficheiros `.tmp` para trás e substitui o anterior inteiro."""
    presets_file = tmp_path / "camera_presets.json"
    first = CameraPreset("a", "camera:0", {"gain": 1.0}, "2026-10-13T10:00:00+00:00")
    second = CameraPreset("b", "camera:0", {"gain": 2.0}, "2026-10-13T11:00:00+00:00")

    save_presets((first,), presets_file)
    save_presets((second,), presets_file)

    leftovers = [path.name for path in tmp_path.iterdir() if path.name != presets_file.name]
    assert leftovers == []
    assert load_presets(presets_file) == (second,)


def test_missing_presets_file_is_not_an_error(tmp_path: Path) -> None:
    """Sem ficheiro de presets, a lista é vazia (a primeira utilização é normal)."""
    assert load_presets(tmp_path / "ausente.json") == ()


@pytest.mark.parametrize(
    "content",
    [
        "{isto não é json",
        json.dumps({"schema_version": PRESET_SCHEMA_VERSION, "presets": [{"name": "x"}]}),
        json.dumps({"schema_version": 99, "presets": []}),
        json.dumps({"presets": []}),
    ],
)
def test_invalid_presets_files_are_ignored_with_a_warning(tmp_path: Path, content: str) -> None:
    """Um ficheiro corrompido, incompleto ou de versão futura não impede a captura."""
    presets_file = tmp_path / "camera_presets.json"
    presets_file.write_text(content, encoding="utf-8")

    assert load_presets(presets_file) == ()


def test_presets_are_stored_in_the_user_data_directory(
    isolated_app_data: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Sem caminho explícito, os presets ficam em `%APPDATA%/AthleteMotion`."""
    from athletemotion_desktop.config.paths import get_app_paths

    preset = CameraPreset("padrão", "camera:0", {"gain": 4.0}, "2026-10-13T10:00:00+00:00")
    written = save_presets((preset,))

    expected = get_app_paths().camera_presets_file
    assert written == expected
    assert written.name == PRESETS_FILE_NAME
    assert written.parent == isolated_app_data / "AthleteMotion"
    assert load_presets() == (preset,)
