"""Testes da orquestração do idioma: aplicação pelo serviço e persistência atómica.

Estes testes cobrem a ligação feita pelo `app.py` entre o pedido do seletor, o
serviço de traduções e o ficheiro de definições — a garantia de que a interface
nunca fica num idioma diferente do que está gravado.
"""

from __future__ import annotations

import json
from functools import partial
from pathlib import Path

import pytest
from PyQt6.QtWidgets import QApplication
from pytestqt.qtbot import QtBot

from athletemotion_desktop.app import handle_language_change_request
from athletemotion_desktop.config.paths import get_app_paths
from athletemotion_desktop.config.settings import AppSettings
from athletemotion_desktop.ui.i18n import TranslationService
from athletemotion_desktop.ui.main_window import MainWindow


def _build_window(
    qtbot: QtBot,
    qapp: QApplication,
    settings: AppSettings,
    translations_dir: Path | None = None,
) -> tuple[MainWindow, TranslationService]:
    """Liga janela + serviço de traduções exatamente como o `app.py` faz em produção."""
    settings_file = get_app_paths().settings_file
    translation_service = TranslationService(qapp, translations_dir=translations_dir)
    window = MainWindow(settings=settings)
    qtbot.addWidget(window)
    window.language_change_requested.connect(
        partial(
            handle_language_change_request,
            translation_service=translation_service,
            settings=settings,
            settings_file=settings_file,
            window=window,
        )
    )
    translation_service.language_changed.connect(window.retranslate_ui)
    return window, translation_service


def test_language_change_is_applied_and_persisted(
    qtbot: QtBot, qapp: QApplication, isolated_app_data: Path
) -> None:
    """Escolher inglês traduz a interface e grava a preferência em disco."""
    settings = AppSettings()
    window, translation_service = _build_window(qtbot, qapp, settings)

    try:
        window.language_selector.setCurrentIndex(window.language_selector.findData("en_US"))

        assert translation_service.language == "en_US"
        assert window.language_label.text() == "Language:"
        persisted_settings = json.loads(get_app_paths().settings_file.read_text(encoding="utf-8"))
        assert persisted_settings["language"] == "en_US"
    finally:
        translation_service.remove_translation()
        window.retranslate_ui()


def test_language_change_can_be_reverted(
    qtbot: QtBot, qapp: QApplication, isolated_app_data: Path
) -> None:
    """Voltar a PT-PT repõe os textos fonte e grava a reversão."""
    settings = AppSettings(language="en_US")
    window, translation_service = _build_window(qtbot, qapp, settings)
    assert translation_service.apply_language("en_US") is True

    try:
        # O seletor arranca no idioma persistido (en_US); escolher PT provoca o pedido real.
        assert window.language_selector.currentData() == "en_US"
        window.language_selector.setCurrentIndex(window.language_selector.findData("pt_PT"))

        assert translation_service.language == "pt_PT"
        assert window.language_label.text() == "Idioma:"
        assert window.navigation_buttons[1].text() == "📼 Análise de Vídeo"
        persisted_settings = json.loads(get_app_paths().settings_file.read_text(encoding="utf-8"))
        assert persisted_settings["language"] == "pt_PT"
    finally:
        translation_service.remove_translation()


def test_unavailable_translation_is_not_persisted(
    qtbot: QtBot, qapp: QApplication, isolated_app_data: Path, tmp_path: Path
) -> None:
    """Sem tradução disponível, o pedido é recusado e nada é gravado.

    Persistir um idioma que a interface não consegue apresentar deixaria o ficheiro
    de definições a mentir sobre o estado real da aplicação.
    """
    empty_translations_dir = tmp_path / "sem_traducoes"
    empty_translations_dir.mkdir()
    settings = AppSettings()
    window, translation_service = _build_window(
        qtbot, qapp, settings, translations_dir=empty_translations_dir
    )

    try:
        window.language_selector.setCurrentIndex(window.language_selector.findData("en_US"))

        assert translation_service.language == "pt_PT"
        assert settings.language == "pt_PT"
        assert window.language_selector.currentData() == "pt_PT"
        assert window.language_label.text() == "Idioma:"
        assert not get_app_paths().settings_file.exists()
    finally:
        translation_service.remove_translation()


@pytest.mark.usefixtures("isolated_app_data")
def test_repeated_selection_of_current_language_is_noop(qtbot: QtBot, qapp: QApplication) -> None:
    """Reescolher o idioma já ativo não reescreve o ficheiro de definições."""
    settings = AppSettings()
    window, translation_service = _build_window(qtbot, qapp, settings)

    try:
        window.language_selector.setCurrentIndex(window.language_selector.findData("pt_PT"))

        assert not get_app_paths().settings_file.exists()
        assert translation_service.language == "pt_PT"
    finally:
        translation_service.remove_translation()
