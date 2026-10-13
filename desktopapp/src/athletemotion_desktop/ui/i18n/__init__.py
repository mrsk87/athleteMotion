"""Internacionalização (i18n) da interface: traduções PT/EN via `QTranslator`.

Os ficheiros `.ts` deste pacote são a fonte única de tradução e são atualizados
por `scripts/update_translations.ps1`.
"""

from athletemotion_desktop.ui.i18n.translator import (
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES,
    TRANSLATIONS_DIR,
    TranslationFileError,
    TranslationService,
    TsFileTranslator,
    UnsupportedLanguageError,
    parse_ts_file,
    translation_file_path,
    validate_language,
)

__all__ = [
    "DEFAULT_LANGUAGE",
    "SUPPORTED_LANGUAGES",
    "TRANSLATIONS_DIR",
    "TranslationFileError",
    "TranslationService",
    "TsFileTranslator",
    "UnsupportedLanguageError",
    "parse_ts_file",
    "translation_file_path",
    "validate_language",
]
