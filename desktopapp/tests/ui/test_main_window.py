"""Testes de interface da `MainWindow` (pytest-qt, plataforma offscreen)."""

from __future__ import annotations

import multiprocessing
import platform

import psutil
import pytest
from PyQt6.QtWidgets import QApplication, QLabel
from pytestqt.qtbot import QtBot

from athletemotion_desktop.config.settings import AppSettings
from athletemotion_desktop.ui.i18n import TranslationService
from athletemotion_desktop.ui.main_window import NAVIGATION_ENTRIES, MainWindow

pytestmark = pytest.mark.usefixtures("isolated_app_data")


def test_main_window_smoke_switches_views_and_closes_cleanly(qtbot: QtBot) -> None:
    """A janela abre, alterna vistas por clique e fecha sem deixar processos órfãos."""
    window = MainWindow(settings=AppSettings())
    qtbot.addWidget(window)
    window.show()

    assert window.isVisible()
    assert window.view_stack.count() == len(NAVIGATION_ENTRIES)
    assert window.view_stack.currentIndex() == 0
    assert "Athlete Motion" in window.windowTitle()

    window.navigation_buttons[2].click()
    assert window.view_stack.currentIndex() == 2
    assert window.navigation_buttons[2].isChecked()

    closing_events: list[bool] = []
    window.closing.connect(lambda: closing_events.append(True))
    window.close()

    assert closing_events == [True]
    assert window.isVisible() is False
    assert multiprocessing.active_children() == []


def test_language_selector_emits_request_and_retranslates(qtbot: QtBot, qapp: QApplication) -> None:
    """O seletor pede o idioma e a interface é retraduzida quando o serviço o aplica."""
    translation_service = TranslationService(qapp)
    window = MainWindow(settings=AppSettings())
    qtbot.addWidget(window)
    translation_service.language_changed.connect(window.retranslate_ui)

    requested_languages: list[str] = []
    window.language_change_requested.connect(requested_languages.append)

    english_index = window.language_selector.findData("en_US")
    assert english_index >= 0
    window.language_selector.setCurrentIndex(english_index)

    assert requested_languages == ["en_US"]
    assert window.language_label.text() == "Idioma:"  # ainda não aplicado pelo serviço

    try:
        assert translation_service.apply_language("en_US") is True
        assert window.language_label.text() == "Language:"
        assert window.navigation_buttons[1].text() == "📼 Video Analysis"
        assert "Video Analysis" in window.navigation_buttons[1].text()
    finally:
        translation_service.remove_translation()
        window.retranslate_ui()

    assert window.navigation_buttons[1].text() == "📼 Análise de Vídeo"


def test_language_selection_does_not_emit_during_construction(qtbot: QtBot) -> None:
    """A sincronização inicial do seletor não deve contar como escolha do utilizador."""
    settings = AppSettings(language="en_US")
    window = MainWindow(settings=settings)
    qtbot.addWidget(window)

    requested_languages: list[str] = []
    window.language_change_requested.connect(requested_languages.append)

    window.set_current_language("pt_PT")

    assert requested_languages == []
    assert window.language_selector.currentData() == "pt_PT"


def test_window_reports_persisted_language_in_selector(qtbot: QtBot) -> None:
    """O seletor reflete o idioma persistido nas definições."""
    window = MainWindow(settings=AppSettings(language="en_US"))
    qtbot.addWidget(window)

    assert window.language_selector.currentData() == "en_US"


def test_telemetry_label_describes_running_system(qtbot: QtBot) -> None:
    """A barra de estado descreve o sistema real, com valores medidos (nunca estimados)."""
    window = MainWindow(settings=AppSettings())
    qtbot.addWidget(window)

    telemetry_label = window.findChild(QLabel, "TelemetryLabel")
    assert telemetry_label is not None

    logical_cpu_count = psutil.cpu_count(logical=True) or 1
    total_ram_gb = round(psutil.virtual_memory().total / (1024**3), 1)
    telemetry_text = telemetry_label.text()

    assert f"{logical_cpu_count} núcleos" in telemetry_text
    assert f"{total_ram_gb} GB" in telemetry_text
    assert platform.system() in telemetry_text
