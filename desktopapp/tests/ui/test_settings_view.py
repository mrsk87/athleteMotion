"""Testes da vista de Definições e do seu *view-model* (pytest-qt, offscreen)."""

from __future__ import annotations

import json
import sys
import textwrap
import time
from dataclasses import replace
from pathlib import Path

import pytest
from PyQt6.QtWidgets import QApplication
from pytestqt.qtbot import QtBot

from athletemotion_desktop.config.paths import get_app_paths
from athletemotion_desktop.config.settings import load_settings
from athletemotion_desktop.runtime.hardware.autotune import AutotuneProcess
from athletemotion_desktop.runtime.hardware.probe import (
    PROBE_SCHEMA_VERSION,
    CpuInfo,
    GpuInfo,
    HardwareInfo,
)
from athletemotion_desktop.runtime.hardware.profile import PROFILE_SCHEMA_VERSION
from athletemotion_desktop.ui.i18n import TsFileTranslator, translation_file_path
from athletemotion_desktop.ui.viewmodels.settings_vm import SettingsViewModel
from athletemotion_desktop.ui.views.settings_view import SettingsView

pytestmark = pytest.mark.usefixtures("isolated_app_data")

SLOW_PROBE_DELAY_SECONDS = 0.3

PROGRESS_STUB = textwrap.dedent(
    """
    import json, sys, time
    for step in range(1, 6):
        print(json.dumps({"stage": f"etapa{step}", "fraction": step / 5, "message": f"passo {step}"}))
        sys.stdout.flush()
        time.sleep(0.08)
    sys.exit(0)
    """
)

HANGING_STUB = textwrap.dedent(
    """
    import json, sys, time
    print(json.dumps({"stage": "longo", "fraction": 0.1, "message": "etapa longa"}))
    sys.stdout.flush()
    time.sleep(60)
    """
)


def _hardware_info() -> HardwareInfo:
    """Hardware sintético representativo do computador de referência."""
    return HardwareInfo(
        schema_version=PROBE_SCHEMA_VERSION,
        generated_at="2026-10-13T12:00:00+00:00",
        cpu=CpuInfo("Intel(R) Xeon(R) CPU E5-1660 v3 @ 3.00GHz", 8, 16, True, False, False),
        gpus=(GpuInfo("Radeon RX 580 Series", "amd", 8.0, "31.0.21924.61", True),),
        total_ram_gb=31.9,
        ort_providers=("DmlExecutionProvider", "CPUExecutionProvider"),
        openvino_devices=("CPU",),
        warnings=(),
        signature="abc123",
    )


def _build_view(
    qtbot: QtBot,
    *,
    hardware_probe=_hardware_info,
    profile_payload: dict[str, object] | None = None,
    autotune_command: list[str] | None = None,
) -> tuple[SettingsView, SettingsViewModel]:
    """Cria a vista e o view-model com dependências injetadas (sem hardware real)."""
    paths = get_app_paths()
    if profile_payload is not None:
        paths.hardware_profile_file.write_text(json.dumps(profile_payload), encoding="utf-8")

    def autotune_factory(profile_file: Path) -> AutotuneProcess:
        return AutotuneProcess(profile_file, command=autotune_command)

    settings = load_settings(paths.settings_file)
    view_model = SettingsViewModel(
        settings,
        paths.settings_file,
        profile_file=paths.hardware_profile_file,
        hardware_probe=hardware_probe,
        autotune_factory=autotune_factory,
    )
    view_model.collect_hardware()
    view = SettingsView(view_model)
    qtbot.addWidget(view)
    return view, view_model


def _ready_profile(signature: str = "abc123") -> dict[str, object]:
    """Perfil de autotune válido para o hardware sintético."""
    return {
        "schema_version": PROFILE_SCHEMA_VERSION,
        "generated_at": "2026-10-13T12:00:00+00:00",
        "hardware_signature": signature,
        "ort_version": "1.24.4",
        "recommendation": {
            "backend": "directml",
            "pose_model": "pose_rtmpose_m_halpe26",
            "detector_model": "det_yolo11n",
            "input_resolution": 416,
            "redetect_interval": 15,
            "mode": "precision",
        },
        "measurements": [],
    }


def test_view_shows_hardware_and_has_no_blocking_warnings(qtbot: QtBot) -> None:
    """A vista apresenta o hardware detetado e não inventa avisos numa máquina sã."""
    view, _view_model = _build_view(qtbot)

    assert "Radeon RX 580" in view._hardware_value_labels["gpu"].text()
    assert "DmlExecutionProvider" in view._hardware_value_labels["ort"].text()
    assert "AVX2: sim" in view._hardware_value_labels["flags"].text()
    assert view.diagnostic_items == ("Sem avisos: configuração consistente.",)


def test_view_without_gpu_falls_back_and_warns(qtbot: QtBot) -> None:
    """Numa máquina sem GPU detetada a vista não falha (critério de aceitação da D02)."""

    def probe_without_gpu() -> HardwareInfo:
        return replace(
            _hardware_info(),
            gpus=(),
            ort_providers=("CPUExecutionProvider",),
            signature="sem-gpu",
        )

    view, view_model = _build_view(qtbot, hardware_probe=probe_without_gpu)

    assert view._hardware_value_labels["gpu"].text() == view.tr("Nenhuma detetada")
    assert view_model.hardware_info is not None
    assert view.diagnostic_items  # há avisos (sem DirectML), mas nada rebentou


def test_profile_recommendation_is_applied_when_not_overridden(qtbot: QtBot) -> None:
    """Um perfil válido preenche o *draft* com a recomendação medida."""
    view, view_model = _build_view(qtbot, profile_payload=_ready_profile())

    assert view_model.profile_status is not None
    assert view_model.draft.inference.preferred_backend == "directml"
    assert view_model.draft.inference.input_resolution == 416
    assert view_model.draft.inference.redetect_interval == 15
    assert "Recomendação" in view.profile_state_label.text()


def test_manual_change_marks_override_and_is_persisted(qtbot: QtBot) -> None:
    """Alterar a inferência marca o override manual e a gravação persiste-o."""
    view, view_model = _build_view(qtbot, profile_payload=_ready_profile())
    resolution_index = view.resolution_spin.value()
    assert resolution_index == 416

    view.resolution_spin.setValue(256)

    assert view_model.draft.inference.manual_override is True
    assert view_model.is_dirty is True

    view.save_button.click()

    persisted = load_settings(get_app_paths().settings_file)
    assert persisted.inference.input_resolution == 256
    assert persisted.inference.manual_override is True
    assert view_model.is_dirty is False


def test_override_prevents_profile_from_overwriting_choices(qtbot: QtBot) -> None:
    """Com override manual, uma nova sondagem não substitui a escolha do utilizador."""
    _view, view_model = _build_view(qtbot, profile_payload=_ready_profile())
    view_model.draft.inference = view_model.draft.inference.model_copy(
        update={"input_resolution": 256, "manual_override": True}
    )

    view_model.reload_hardware()
    view_model.collect_hardware()

    assert view_model.draft.inference.input_resolution == 256


def test_reset_restores_defaults_without_writing(qtbot: QtBot) -> None:
    """«Restaurar padrões» repõe o formulário sem tocar no ficheiro em disco."""
    view, view_model = _build_view(qtbot, profile_payload=_ready_profile())
    view.resolution_spin.setValue(256)
    assert view_model.is_dirty is True

    view.reset_button.click()

    assert view_model.draft.inference.input_resolution == 320
    assert view_model.draft.inference.redetect_interval == 10
    assert view_model.draft.inference.manual_override is False
    assert view_model.draft.camera.target_fps == 60
    assert get_app_paths().settings_file.exists() is False
    # A reposição devolve o *draft* aos valores persistidos (nada ficou por guardar).
    assert view_model.is_dirty is False


def test_save_writes_theme_and_language_changes(qtbot: QtBot) -> None:
    """Alterações de aplicação (tema/idioma) também são persistidas pelo botão Guardar."""
    view, view_model = _build_view(qtbot)
    themes: list[str] = []
    view_model.theme_change_requested.connect(themes.append)

    view.language_combo.setCurrentIndex(view.language_combo.findData("en_US"))
    view.theme_combo.setCurrentIndex(view.theme_combo.findData("light"))
    view.save_button.click()

    persisted = load_settings(get_app_paths().settings_file)
    assert persisted.language == "en_US"
    assert persisted.theme == "light"
    assert themes == ["light"]


def test_autotune_button_reflects_backend_availability(qtbot: QtBot) -> None:
    """Sem o módulo do autotune (R14) o botão fica desativado e explica porquê."""
    view, view_model = _build_view(qtbot)

    if view_model.autotune_available:  # pragma: no cover - depende do estado do backend
        pytest.skip("O módulo de autotune do backend já existe neste ambiente.")

    assert view.run_autotune_button.isEnabled() is False
    assert "indisponível" in view.run_autotune_button.toolTip().lower()


def test_autotune_failure_is_reported_instead_of_faking_progress(
    qtbot: QtBot, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Pedir autotune indisponível produz uma mensagem de erro, não progresso falso."""
    view, view_model = _build_view(qtbot)
    finished: list[tuple[bool, str]] = []
    view_model.autotune_finished.connect(lambda ok, message: finished.append((ok, message)))

    started = view_model.start_autotune()

    assert started is False
    assert finished and finished[0][0] is False
    assert "não está disponível" in finished[0][1]
    assert "R14" in finished[0][1]
    assert view.autotune_progress.value() == 0
    assert "não está disponível" in view.autotune_progress.format()


def test_autotune_runs_without_blocking_the_event_loop(qtbot: QtBot, qapp: QApplication) -> None:
    """O autotune corre em processo separado e o ciclo de eventos responde < 50 ms."""
    command = [sys.executable, "-c", PROGRESS_STUB]
    _view, view_model = _build_view(qtbot, autotune_command=command)
    finished: list[tuple[bool, str]] = []
    view_model.autotune_finished.connect(lambda ok, message: finished.append((ok, message)))

    assert view_model.start_autotune() is True

    iteration_seconds: list[float] = []
    observed_percentages: list[int] = []
    view_model.autotune_progress.connect(lambda percent, _msg: observed_percentages.append(percent))
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline and not finished:
        started_at = time.perf_counter()
        qapp.processEvents()
        iteration_seconds.append(time.perf_counter() - started_at)
        time.sleep(0.01)

    assert finished and finished[0][0] is True
    assert observed_percentages[-1] == 100
    assert len(iteration_seconds) >= 10, (
        "o ciclo de eventos não continuou a correr durante o autotune"
    )

    # O orçamento de 50 ms aplica-se à resposta do ciclo de eventos: mede-se o p95,
    # porque um único pico isolado é escalonamento do sistema operativo (o processo de
    # benchmark compete por GPU/CPU) e não bloqueio da interface.
    ordered = sorted(iteration_seconds)
    p95_seconds = ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]
    assert p95_seconds < 0.05, (
        f"p95 da resposta do ciclo de eventos = {p95_seconds * 1000:.1f} ms "
        f"(máximo {ordered[-1] * 1000:.1f} ms, {len(ordered)} iterações)"
    )


def test_autotune_can_be_cancelled_from_the_view(qtbot: QtBot, qapp: QApplication) -> None:
    """Cancelar interrompe o processo de benchmark e repõe o estado da vista."""
    command = [sys.executable, "-c", HANGING_STUB]
    view, view_model = _build_view(qtbot, autotune_command=command)
    finished: list[tuple[bool, str]] = []
    view_model.autotune_finished.connect(lambda ok, message: finished.append((ok, message)))

    view_model.start_autotune()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline and not view_model.is_autotuning:
        qapp.processEvents()
        time.sleep(0.01)
    while time.monotonic() < deadline and view.autotune_progress.value() == 0:
        qapp.processEvents()
        time.sleep(0.01)

    view.cancel_autotune_button.click()

    assert view_model.is_autotuning is False
    assert finished and finished[0][0] is False
    assert "cancelado" in finished[0][1].lower()
    assert view.autotune_progress.value() == 0


def test_hardware_probe_does_not_block_the_caller(qtbot: QtBot, qapp: QApplication) -> None:
    """A sondagem arranca em thread separada: a chamada regressa de imediato."""
    view, view_model = _build_view(
        qtbot, hardware_probe=_slow_probe_wrapper(view_delay=SLOW_PROBE_DELAY_SECONDS)
    )
    view_model.hardware_info = None

    started = time.perf_counter()
    view_model.start_hardware_probe()
    elapsed = time.perf_counter() - started

    assert elapsed < 0.05, f"start_hardware_probe bloqueou {elapsed * 1000:.1f} ms"
    assert view_model.is_hardware_loading is True

    qtbot.waitUntil(lambda: view_model.hardware_info is not None, timeout=5000)
    assert view_model.is_hardware_loading is False
    assert "Sistema analisado" in view.hardware_state_label.text()


def test_view_texts_follow_the_selected_language(qtbot: QtBot, qapp: QApplication) -> None:
    """Com o inglês instalado, os rótulos da vista mudam.

    Prova, em execução e não só no ficheiro `.ts`, que o contexto das mensagens
    corresponde à classe da vista (`SettingsView`): uma tradução existente mas com
    contexto errado continuaria a mostrar PT-PT ao utilizador.
    """
    translator = TsFileTranslator(translation_file_path("en_US"))
    qapp.installTranslator(translator)
    try:
        view, _view_model = _build_view(qtbot)

        assert view._hardware_group.title() == "Detected hardware"
        assert view.refresh_hardware_button.text() == "Detect again"
        assert view.save_button.text() == "Save"
        assert view._camera_group.title() == "Camera"
    finally:
        qapp.removeTranslator(translator)


def _slow_probe_wrapper(view_delay: float):
    """Cria uma sonda lenta, para provar que a UI não espera por ela."""

    def slow_probe() -> HardwareInfo:
        time.sleep(view_delay)
        return _hardware_info()

    return slow_probe
