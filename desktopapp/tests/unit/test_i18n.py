"""Testes da internacionalização: parsing de `.ts`, instalação de tradutores e cobertura."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from PyQt6.QtWidgets import QApplication

from athletemotion_desktop.ui.i18n import (
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES,
    TRANSLATIONS_DIR,
    TranslationFileError,
    TranslationService,
    TsFileTranslator,
    UnsupportedLanguageError,
    parse_ts_file,
    translation_file_path,
)
from athletemotion_desktop.ui.main_window import NAVIGATION_ENTRIES

ENGLISH_TS_PATH = translation_file_path("en_US")
SETTINGS_VIEW_PATH = (
    Path(__file__).resolve().parents[2]
    / "src"
    / "athletemotion_desktop"
    / "ui"
    / "views"
    / "settings_view.py"
)

_TR_CALL_RE = re.compile(r'self\.tr\(\s*"((?:[^"\\]|\\.)*)"', re.DOTALL)


def _tr_literals_in(path: Path) -> set[str]:
    """Extrai os literais passados a `self.tr(...)` num ficheiro de código.

    Args:
        path: ficheiro Python a analisar.

    Returns:
        Conjunto dos textos marcados para tradução.
    """
    content = path.read_text(encoding="utf-8")
    return {literal for literal in _TR_CALL_RE.findall(content) if "\\" not in literal}


def test_supported_languages_covers_every_translation_file() -> None:
    """Cada idioma suportado tem de ter ficheiro `.ts` versionado."""
    for language_code in SUPPORTED_LANGUAGES:
        assert translation_file_path(language_code).is_file(), language_code


def test_parse_ts_file_reads_translated_messages() -> None:
    """As mensagens traduzidas do inglês devem ser lidas do XML."""
    messages = parse_ts_file(ENGLISH_TS_PATH)

    assert messages[("MainWindow", "Idioma:")] == "Language:"
    assert messages[("MainWindow", "Análise de Vídeo")] == "Video Analysis"
    assert len(messages) >= 15


def test_english_translation_covers_all_navigation_texts() -> None:
    """Novos textos de navegação sem tradução fariam o produto parecer meio traduzido."""
    messages = parse_ts_file(ENGLISH_TS_PATH)

    missing = [
        source_text
        for entry in NAVIGATION_ENTRIES
        for source_text in (entry.title_source, entry.description_source)
        if ("MainWindow", source_text) not in messages
    ]

    assert missing == []


def test_english_translation_covers_every_settings_view_text() -> None:
    """Cada texto da vista de Definições tem de ter tradução inglesa (nada meio traduzido)."""
    messages = parse_ts_file(ENGLISH_TS_PATH)
    source_texts = _tr_literals_in(SETTINGS_VIEW_PATH)

    assert source_texts, "a vista de Definições deve marcar os textos com tr()"
    missing = [text for text in sorted(source_texts) if ("SettingsView", text) not in messages]

    assert missing == []


def test_translation_files_have_no_unfinished_entries() -> None:
    """Uma entrada `unfinished` deixa a interface a meio caminho entre PT e EN."""
    for language_code in SUPPORTED_LANGUAGES:
        content = translation_file_path(language_code).read_text(encoding="utf-8")

        assert "unfinished" not in content, language_code


def test_portuguese_translation_never_contradicts_source() -> None:
    """O PT-PT é a língua fonte: qualquer entrada traduzida tem de ser idêntica à origem."""
    messages = parse_ts_file(translation_file_path(DEFAULT_LANGUAGE))

    for (_context, source_text), translation in messages.items():
        assert translation == source_text


def test_parse_ts_file_rejects_missing_and_malformed_files(tmp_path: Path) -> None:
    """Ficheiros ausentes ou com XML inválido devem falhar com erro tipado."""
    with pytest.raises(TranslationFileError, match="inexistente"):
        parse_ts_file(tmp_path / "nao_existe.ts")

    broken_file = tmp_path / "broken.ts"
    broken_file.write_text("<TS><context>", encoding="utf-8")
    with pytest.raises(TranslationFileError, match="XML inválido"):
        parse_ts_file(broken_file)


def test_parse_ts_file_ignores_unfinished_and_empty_translations(tmp_path: Path) -> None:
    """Traduções pendentes ou vazias devem manter o texto fonte (nunca strings vazias)."""
    ts_file = tmp_path / "pendente.ts"
    ts_file.write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE TS>
<TS version="2.1">
<context>
    <name>MainWindow</name>
    <message>
        <source>Pronta</source>
        <translation>Done</translation>
    </message>
    <message>
        <source>Pendente</source>
        <translation type="unfinished"></translation>
    </message>
    <message>
        <source>Vazia</source>
        <translation></translation>
    </message>
</context>
</TS>
""",
        encoding="utf-8",
    )

    messages = parse_ts_file(ts_file)

    assert messages == {("MainWindow", "Pronta"): "Done"}


def test_ts_file_translator_translates_and_falls_back() -> None:
    """O tradutor devolve a tradução conhecida e o texto fonte quando não há entrada.

    Devolver string vazia seria interpretado pelo PyQt6 como tradução vazia (rótulos
    em branco na interface), pelo que o recurso é o próprio texto fonte.
    """
    translator = TsFileTranslator(ENGLISH_TS_PATH)

    assert translator.translate("MainWindow", "Idioma:") == "Language:"
    assert translator.translate("MainWindow", "Texto inexistente") == "Texto inexistente"
    assert translator.message_count >= 15
    assert translator.translations_file == ENGLISH_TS_PATH


def test_apply_language_rejects_unsupported_language(qapp: QApplication) -> None:
    """Um idioma fora da lista suportada é um erro de programação explícito."""
    service = TranslationService(qapp)

    with pytest.raises(UnsupportedLanguageError, match="xx_XX"):
        service.apply_language("xx_XX")


def test_apply_language_without_translation_files_keeps_current_language(
    qapp: QApplication, tmp_path: Path
) -> None:
    """Sem ficheiros de tradução, nada muda e o pedido é recusado (sem persistir)."""
    service = TranslationService(qapp, translations_dir=tmp_path)

    assert service.apply_language("en_US") is False
    assert service.language == DEFAULT_LANGUAGE
    assert service.is_translation_installed is False


def test_apply_language_installs_and_removes_translators(qapp: QApplication) -> None:
    """Trocar de idioma instala o tradutor; removê-lo volta aos textos fonte."""
    service = TranslationService(qapp)
    applied_languages: list[str] = []
    service.language_changed.connect(applied_languages.append)

    try:
        assert service.apply_language("en_US") is True
        assert service.language == "en_US"
        assert service.is_translation_installed is True

        assert service.apply_language("pt_PT") is True
        assert service.language == DEFAULT_LANGUAGE

        service.remove_translation()
        assert service.is_translation_installed is False
    finally:
        service.remove_translation()

    assert applied_languages == ["en_US", "pt_PT"]


def test_translations_directory_is_the_package_directory() -> None:
    """As traduções vivem junto do código do serviço (empacotamento previsível)."""
    assert (
        TRANSLATIONS_DIR
        == Path(__file__).resolve().parents[2] / "src" / ("athletemotion_desktop") / "ui" / "i18n"
    )
