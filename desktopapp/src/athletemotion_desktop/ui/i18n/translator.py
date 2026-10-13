"""Serviço de internacionalização (PT/EN) da interface gráfica.

**Porque não usamos ficheiros `.qm` compilados?**

    O wheel do PyQt6 fornece o `pylupdate6` (extração de textos), mas **não** o
    `lrelease` do Qt Linguist, que é o único programa capaz de compilar `.ts`
    para `.qm`. Para manter o repositório offline-first, sem binários externos e
    sem artefactos gerados no Git, os ficheiros `.ts` são a **fonte única de
    tradução** e são interpretados em runtime por `TsFileTranslator` (um
    `QTranslator` especializado). Se existir um `.qm` compilado do mesmo idioma,
    tem prioridade por ser mais rápido a carregar.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from pathlib import Path
from types import MappingProxyType
from typing import Final
from xml.etree import ElementTree

from PyQt6.QtCore import QCoreApplication, QObject, QTranslator, pyqtSignal

from athletemotion_desktop.config.settings import LanguageCode

logger = logging.getLogger(__name__)

DEFAULT_LANGUAGE: Final[LanguageCode] = "pt_PT"
TRANSLATIONS_DIR: Final[Path] = Path(__file__).resolve().parent

#: Idiomas suportados: código de idioma Qt -> nome apresentado no seletor.
#: Os nomes aparecem sempre na própria língua (autónimos, prática corrente em
#: seletores de idioma), pelo que não passam por `tr()`.
SUPPORTED_LANGUAGES: Final[Mapping[LanguageCode, str]] = MappingProxyType(
    {
        "pt_PT": "Português (Portugal)",
        "en_US": "English (US)",
    }
)

#: Nome-base do ficheiro de tradução de cada idioma (o plano fixa `pt_PT.ts`/`en.ts`).
TRANSLATION_FILE_STEMS: Final[Mapping[LanguageCode, str]] = MappingProxyType(
    {
        "pt_PT": "pt_PT",
        "en_US": "en",
    }
)


class UnsupportedLanguageError(ValueError):
    """O idioma pedido não consta de `SUPPORTED_LANGUAGES`."""

    def __init__(self, language: str) -> None:
        supported_languages = ", ".join(sorted(SUPPORTED_LANGUAGES))
        super().__init__(
            f"Idioma '{language}' não suportado. Idiomas disponíveis: {supported_languages}."
        )
        self.language = language


class TranslationFileError(RuntimeError):
    """Ficheiro `.ts` inexistente, ilegível ou com XML inválido."""


def validate_language(language: str) -> LanguageCode:
    """Valida um código de idioma e devolve-o na forma tipada suportada.

    Devolve a **chave** do mapa de idiomas (e não o valor recebido) para que a
    verificação de tipos acompanhe a validação em runtime, sem conversões cegas.

    Args:
        language: código de idioma recebido (por exemplo, do seletor da interface).

    Returns:
        O código validado, restrito aos idiomas suportados.

    Raises:
        UnsupportedLanguageError: se o idioma não constar de `SUPPORTED_LANGUAGES`.
    """
    for supported_language in SUPPORTED_LANGUAGES:
        if supported_language == language:
            return supported_language
    raise UnsupportedLanguageError(language)


def translation_file_path(language: LanguageCode, translations_dir: Path | None = None) -> Path:
    """Calcula o caminho do ficheiro `.ts` de um idioma (sem garantir existência).

    Args:
        language: código de idioma suportado (por exemplo `en_US`).
        translations_dir: diretório alternativo; por omissão, o diretório do módulo.

    Returns:
        Caminho do ficheiro `.ts` correspondente.
    """
    stem = TRANSLATION_FILE_STEMS.get(language, language)
    return (translations_dir or TRANSLATIONS_DIR) / f"{stem}.ts"


def parse_ts_file(path: Path) -> dict[tuple[str, str], str]:
    """Extrai as mensagens traduzidas de um ficheiro `.ts` do Qt Linguist.

    Entradas vazias, marcadas como `unfinished` ou com formas plurais são
    ignoradas: nesses casos o Qt mantém o texto fonte (PT-PT), o que é o
    comportamento correto para mensagens ainda não traduzidas.

    Args:
        path: ficheiro `.ts` a interpretar.

    Returns:
        Mapa `(contexto, texto fonte) -> tradução`.

    Raises:
        TranslationFileError: se o ficheiro não existir ou o XML for inválido.
    """
    if not path.is_file():
        raise TranslationFileError(f"Ficheiro de tradução inexistente: {path}")
    try:
        root_element = ElementTree.parse(path).getroot()
    except ElementTree.ParseError as exc:
        raise TranslationFileError(f"XML inválido no ficheiro de tradução {path}: {exc}") from exc

    messages: dict[tuple[str, str], str] = {}
    for context_element in root_element.findall("context"):
        context_name = (context_element.findtext("name") or "").strip()
        for message_element in context_element.findall("message"):
            source_text = message_element.findtext("source") or ""
            translation_element = message_element.find("translation")
            if translation_element is None:
                continue
            if translation_element.get("type") == "unfinished":
                continue
            if translation_element.find("numerusform") is not None:
                # As formas plurais exigem a variante `numerus` de `tr()`; não são
                # usadas na interface atual, pelo que ficam explicitamente de fora.
                continue
            translation_text = "".join(translation_element.itertext()).strip()
            if not translation_text:
                continue
            messages[(context_name, source_text)] = translation_text
    return messages


class TsFileTranslator(QTranslator):
    """`QTranslator` que responde a partir de um ficheiro `.ts` interpretado.

    O Qt recorre ao texto fonte sempre que `translate()` devolve uma string
    vazia, garantindo degradação correta para mensagens não traduzidas.
    """

    def __init__(self, translations_file: Path) -> None:
        """Interpreta o ficheiro `.ts` indicado.

        Args:
            translations_file: ficheiro `.ts` a carregar.

        Raises:
            TranslationFileError: propagada de `parse_ts_file`.
        """
        super().__init__()
        self._translations_file = translations_file
        self._messages = parse_ts_file(translations_file)

    @property
    def translations_file(self) -> Path:
        """Ficheiro `.ts` de origem das traduções carregadas."""
        return self._translations_file

    @property
    def message_count(self) -> int:
        """Número de mensagens traduzidas efetivamente disponíveis."""
        return len(self._messages)

    def translate(
        self,
        context: str,
        source_text: str,
        disambiguation: str | None = None,
        n: int = -1,
    ) -> str:
        """Traduz uma mensagem da interface (chamado pelo Qt através de `tr()`).

        Args:
            context: contexto da mensagem (nome da classe que chamou `tr()`).
            source_text: texto fonte registado no código (PT-PT).
            disambiguation: desambiguação opcional; não usada pela interface atual.
            n: índice para formas plurais; não usado pela interface atual.

        Returns:
            A tradução registada ou `""` para o Qt usar o texto fonte.
        """
        return self._messages.get((context, source_text), "")


class TranslationService(QObject):
    """Instala/remove tradutores Qt e avisa a interface para se retraduzir.

    A responsabilidade de persistir a escolha do utilizador é do orquestrador
    (`app.py`), que conhece o ficheiro de definições.

    Sinais:
        language_changed: emitido com o código do idioma sempre que a tradução
            efetivamente instalada muda.
    """

    language_changed = pyqtSignal(str)

    def __init__(
        self,
        application: QCoreApplication,
        translations_dir: Path | None = None,
    ) -> None:
        """Cria o serviço associado a uma aplicação Qt.

        Args:
            application: instância de `QApplication` (ou `QCoreApplication`) alvo.
            translations_dir: diretório de traduções; por omissão, o do módulo.
        """
        super().__init__()
        self._application = application
        self._translations_dir = translations_dir or TRANSLATIONS_DIR
        self._active_translator: QTranslator | None = None
        self._language: LanguageCode = DEFAULT_LANGUAGE

    @property
    def language(self) -> LanguageCode:
        """Idioma atualmente aplicado à interface."""
        return self._language

    @property
    def is_translation_installed(self) -> bool:
        """Indica se existe um tradutor Qt instalado na aplicação."""
        return self._active_translator is not None

    def apply_language(self, language: str) -> bool:
        """Aplica o idioma pedido à aplicação.

        Se não existir tradução disponível, nada é alterado (o idioma atual e o
        respetivo tradutor mantêm-se) e a situação é registada no log.

        Args:
            language: código do idioma pretendido.

        Returns:
            `True` se uma tradução foi instalada; `False` se não havia tradução
            disponível para o idioma (a interface mantém-se como estava).

        Raises:
            UnsupportedLanguageError: se o idioma não constar de `SUPPORTED_LANGUAGES`.
        """
        validated_language = validate_language(language)
        translator = self._load_translator(validated_language)
        if translator is None:
            logger.warning(
                "Tradução para '%s' indisponível em %s: a manter o idioma '%s' com os textos fonte.",
                validated_language,
                self._translations_dir,
                self._language,
            )
            return False

        self._uninstall_active_translator()
        self._application.installTranslator(translator)
        self._active_translator = translator

        if validated_language != self._language:
            self._language = validated_language
            self.language_changed.emit(validated_language)
        return True

    def remove_translation(self) -> None:
        """Remove o tradutor instalado, voltando aos textos fonte (PT-PT).

        Usado no encerramento da aplicação e pelos testes, para que uma tradução
        instalada não contamine o resto do processo.
        """
        self._uninstall_active_translator()

    def _load_translator(self, language: LanguageCode) -> QTranslator | None:
        """Carrega o tradutor do idioma, preferindo o `.qm` compilado ao `.ts`."""
        stem = TRANSLATION_FILE_STEMS.get(language, language)
        compiled_path = self._translations_dir / f"{stem}.qm"
        if compiled_path.is_file():
            compiled_translator = QTranslator()
            if compiled_translator.load(str(compiled_path)):
                logger.debug("Tradução compilada carregada: %s", compiled_path)
                return compiled_translator
            logger.error(
                "O ficheiro compilado %s existe mas não pôde ser carregado; "
                "a tentar o ficheiro .ts equivalente.",
                compiled_path,
            )

        ts_path = translation_file_path(language, self._translations_dir)
        if not ts_path.is_file():
            return None
        try:
            return TsFileTranslator(ts_path)
        except TranslationFileError as exc:
            # Não é um erro fatal: a aplicação continua utilizável em PT-PT, mas o
            # problema fica registado com o caminho e a causa para diagnóstico.
            logger.error("Falha ao interpretar o ficheiro de tradução: %s", exc)
            return None

    def _uninstall_active_translator(self) -> None:
        """Remove o tradutor instalado (a referência Qt é libertada em seguida)."""
        if self._active_translator is None:
            return
        self._application.removeTranslator(self._active_translator)
        self._active_translator = None
