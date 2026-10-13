"""Ciclo de vida principal da aplicação: logging, integridade, i18n e janela.

O `main()` é mantido fino e delega em funções pequenas e testáveis, porque é o
ponto de entrada usado pelo empacotamento (PyInstaller) e pelos testes de arranque.
"""

from __future__ import annotations

import logging
import multiprocessing
import signal
import sys
from functools import partial
from pathlib import Path
from typing import Final

from PyQt6.QtCore import QLockFile, QTimer
from PyQt6.QtWidgets import QApplication

from athletemotion_desktop.config.environment import detect_conflicting_onnx_runtimes
from athletemotion_desktop.config.logging_setup import (
    enable_crash_dumps,
    setup_logging,
    shutdown_logging,
)
from athletemotion_desktop.config.paths import get_app_paths
from athletemotion_desktop.config.settings import AppSettings, load_settings, save_settings
from athletemotion_desktop.ui.i18n import (
    DEFAULT_LANGUAGE,
    TranslationService,
    UnsupportedLanguageError,
)
from athletemotion_desktop.ui.main_window import SETTINGS_VIEW_ID, MainWindow
from athletemotion_desktop.ui.theme import get_dark_stylesheet
from athletemotion_desktop.ui.viewmodels.settings_vm import SettingsViewModel
from athletemotion_desktop.ui.views.settings_view import SettingsView

logger = logging.getLogger("athletemotion_desktop")

EXIT_SUCCESS: Final[int] = 0
EXIT_ALREADY_RUNNING: Final[int] = 1
EXIT_INTEGRITY_ERROR: Final[int] = 2

LOCK_FILE_NAME: Final[str] = "app.lock"
LOCK_TIMEOUT_MS: Final[int] = 100

#: Intervalo do temporizador que devolve o controlo ao interpretador (ver
#: `install_shutdown_signal_handlers`). 200 ms é impercetível para o utilizador e
#: mantém o custo por tique irrelevante para os 60 FPS da interface.
SIGNAL_POLL_INTERVAL_MS: Final[int] = 200


def _configure_multiprocessing_start_method() -> None:
    """Fixa o método de arranque `spawn` (obrigatório no Windows com multiprocessing)."""
    try:
        multiprocessing.set_start_method("spawn")
    except RuntimeError:
        # Já foi definido anteriormente (por exemplo, por um teste que reutiliza o
        # processo); o valor existente é o correto e não deve ser alterado.
        logger.debug("Método de arranque de multiprocessing já estava definido.")


def install_shutdown_signal_handlers(application: QApplication) -> QTimer:
    """Instala o encerramento controlado para sinais do sistema (SIGINT/SIGTERM/SIGBREAK).

    Porquê um temporizador de despertar?
        Em Python, os handlers de sinais só correm quando o interpretador volta a
        executar *bytecode*. Enquanto o processo está bloqueado dentro do ciclo de
        eventos do Qt (código C++), um `Ctrl+C` ficaria pendente indefinidamente e a
        aplicação nunca faria *unlock*, *flush* de logs ou fecho do relatório de
        falhas. Um temporizador de 200 ms garante que o interpretador recupera o
        controlo com regularidade suficiente para despachar os sinais pendentes.

    Args:
        application: aplicação Qt a encerrar quando um sinal for recebido.

    Returns:
        O temporizador de despertar. Deve permanecer vivo (referência no chamador)
        enquanto a aplicação estiver em execução.
    """

    def _request_shutdown(signal_number: int, _frame: object | None) -> None:
        """Pede o fecho do ciclo de eventos para o encerramento seguir o caminho normal."""
        logger.warning(
            "Sinal %s recebido: a encerrar a aplicação de forma controlada.",
            signal.Signals(signal_number).name,
        )
        application.quit()

    for signal_name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        signal_number = getattr(signal, signal_name, None)
        if signal_number is None:
            # Sinal inexistente nesta plataforma (por exemplo, SIGBREAK fora do Windows).
            continue
        try:
            signal.signal(signal_number, _request_shutdown)
        except (ValueError, OSError) as exc:
            # Só acontece se não estivermos na thread principal; a aplicação mantém-se
            # utilizável, mas o motivo fica registado em vez de silenciado.
            logger.debug("Sinal %s não pôde ser tratado neste contexto: %s", signal_name, exc)

    wakeup_timer = QTimer(application)
    wakeup_timer.setInterval(SIGNAL_POLL_INTERVAL_MS)
    # Sem trabalho: o objetivo é apenas executar bytecode periodicamente.
    wakeup_timer.timeout.connect(lambda: None)
    wakeup_timer.start()
    return wakeup_timer


def _apply_theme(application: QApplication, theme: str) -> None:
    """Aplica o tema escolhido à aplicação em execução.

    Args:
        application: instância de `QApplication`.
        theme: tema pretendido (`dark` ou `light`).
    """
    if theme == "dark":
        application.setStyleSheet(get_dark_stylesheet())
        return
    # O tema claro usa a paleta nativa do sistema até existir uma folha própria
    # (tarefa D07); não se inventa um tema claro incompleto.
    application.setStyleSheet("")
    logger.info("Tema 'claro': a usar a paleta nativa do sistema.")


def _on_settings_saved(
    *,
    translation_service: TranslationService,
    window: MainWindow,
    settings: AppSettings,
) -> None:
    """Reage à gravação das definições na vista D02 (idioma + repor o seletor da janela).

    Args:
        translation_service: serviço de traduções da aplicação.
        window: janela principal (seletor de idioma da barra lateral).
        settings: definições gravadas.
    """
    if settings.language != translation_service.language and translation_service.apply_language(
        settings.language
    ):
        logger.info("Idioma aplicado a partir das definições: %s", settings.language)
    window.set_current_language(translation_service.language)


def _report_startup_blocker(message: str) -> None:
    """Regista e apresenta ao utilizador um impedimento de arranque.

    Antes da criação do `QApplication` não existe interface para mostrar o erro,
    pelo que a mensagem vai para o log estruturado e para o `stderr` do processo.

    Args:
        message: mensagem em PT-PT, pronta a apresentar.
    """
    logger.critical(message)
    print(message, file=sys.stderr)


def _apply_initial_language(translation_service: TranslationService, settings: AppSettings) -> None:
    """Instala a tradução do idioma persistido pelo utilizador.

    Args:
        translation_service: serviço de traduções da aplicação.
        settings: definições carregadas do disco.

    Raises:
        UnsupportedLanguageError: se o idioma persistido não for suportado.
    """
    if translation_service.apply_language(settings.language):
        logger.info("Idioma da interface: %s", settings.language)
        return

    if settings.language == DEFAULT_LANGUAGE:
        logger.warning(
            "Sem ficheiro de tradução para o idioma padrão; a interface usa os textos fonte (PT-PT)."
        )
        return

    logger.error(
        "Tradução para '%s' indisponível; a usar o idioma padrão '%s'.",
        settings.language,
        DEFAULT_LANGUAGE,
    )
    translation_service.apply_language(DEFAULT_LANGUAGE)


def handle_language_change_request(
    language: str,
    *,
    translation_service: TranslationService,
    settings: AppSettings,
    settings_file: Path,
    window: MainWindow,
) -> None:
    """Aplica e persiste o idioma pedido pelo utilizador.

    Se a tradução não estiver disponível, o pedido é recusado de forma visível
    (log de erro + reposição do seletor) e **nada é gravado**: persistir um idioma
    que a interface não consegue apresentar criaria um estado inconsistente entre
    o que está gravado e o que o utilizador vê.

    Args:
        language: código do idioma pedido.
        translation_service: serviço de traduções da aplicação.
        settings: definições em memória a atualizar.
        settings_file: caminho do ficheiro de definições a gravar atomicamente.
        window: janela principal, usada para repor o seletor de idioma.
    """
    try:
        applied = translation_service.apply_language(language)
    except UnsupportedLanguageError as exc:
        logger.error("Pedido de idioma inválido: %s", exc)
        applied = False

    if not applied:
        logger.error(
            "Idioma '%s' não aplicado: não existe tradução disponível. A interface mantém '%s'.",
            language,
            translation_service.language,
        )
        window.set_current_language(translation_service.language)
        return

    applied_language = translation_service.language
    if settings.language == applied_language:
        logger.debug("Idioma '%s' já estava gravado; nada a fazer.", applied_language)
        return

    settings.language = applied_language
    save_settings(settings, settings_file)
    logger.info("Idioma da interface alterado e persistido: %s", applied_language)


def main() -> int:
    """Ponto de entrada central da aplicação desktop.

    Returns:
        Código de saída do processo: `0` em execução normal, `1` se já existe
        outra instância, `2` se o ambiente de inferência for inválido.
    """
    multiprocessing.freeze_support()
    _configure_multiprocessing_start_method()

    paths = get_app_paths()
    setup_logging(paths.logs_dir)
    logger.info("A iniciar Athlete Motion Desktop v0.2.0")

    crash_dump_handle = enable_crash_dumps(paths.logs_dir)
    try:
        conflict_message = detect_conflicting_onnx_runtimes()
        if conflict_message is not None:
            _report_startup_blocker(conflict_message)
            return EXIT_INTEGRITY_ERROR

        lock_file = QLockFile(str(paths.app_data_dir / LOCK_FILE_NAME))
        if not lock_file.tryLock(LOCK_TIMEOUT_MS):
            _report_startup_blocker(
                "Já existe uma instância do Athlete Motion Desktop em execução. "
                "Feche a janela existente ou remova manualmente o ficheiro de bloqueio: "
                f"{paths.app_data_dir / LOCK_FILE_NAME}"
            )
            return EXIT_ALREADY_RUNNING

        application = QApplication(sys.argv)
        application.setApplicationName("AthleteMotionDesktop")
        application.setOrganizationName("AthleteMotion")
        wakeup_timer = install_shutdown_signal_handlers(application)

        settings = load_settings(paths.settings_file)
        translation_service = TranslationService(application)
        try:
            _apply_initial_language(translation_service, settings)
        except UnsupportedLanguageError as exc:
            logger.error(
                "Idioma persistido inválido (%s); a usar o idioma padrão '%s'.",
                exc,
                DEFAULT_LANGUAGE,
            )
            translation_service.apply_language(DEFAULT_LANGUAGE)

        if settings.theme == "dark":
            application.setStyleSheet(get_dark_stylesheet())

        window = MainWindow(settings=settings)

        settings_view_model = SettingsViewModel(
            settings,
            paths.settings_file,
            profile_file=paths.hardware_profile_file,
        )
        window.set_view_widget(SETTINGS_VIEW_ID, SettingsView(settings_view_model))
        settings_view_model.theme_change_requested.connect(
            lambda theme: _apply_theme(application, theme)
        )
        settings_view_model.settings_saved.connect(
            partial(
                _on_settings_saved,
                translation_service=translation_service,
                window=window,
                settings=settings_view_model.saved_settings,
            )
        )
        window.closing.connect(settings_view_model.shutdown)

        window.language_change_requested.connect(
            partial(
                handle_language_change_request,
                translation_service=translation_service,
                settings=settings,
                settings_file=paths.settings_file,
                window=window,
            )
        )
        translation_service.language_changed.connect(window.retranslate_ui)
        window.show()

        try:
            exit_code = application.exec()
        finally:
            wakeup_timer.stop()
        lock_file.unlock()
        logger.info("Athlete Motion Desktop encerrado com código %d", exit_code)
        return exit_code
    finally:
        crash_dump_handle.close()
        shutdown_logging()
