"""Estado e ações da vista de Definições.

Separação de responsabilidades: o *view-model* não desenha nada e não duplica
lógica de hardware — usa a sonda (`runtime/hardware/probe`), o perfil
(`runtime/hardware/profile`) e as regras de aviso (`runtime/hardware/diagnostics`).
A vista limita-se a mostrar e a recolher valores.

Regra de atomicidade das preferências: as alterações são feitas numa **cópia de
trabalho** (*draft*) e só chegam ao disco em `save()`, através de gravação atómica
(`.tmp` + `os.replace`). Fechar a janela sem guardar não altera o estado persistido.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path

from PyQt6.QtCore import QObject, QTimer, pyqtSignal

from athletemotion_desktop.config.settings import AppSettings, save_settings
from athletemotion_desktop.runtime.hardware.autotune import (
    AutotuneProcess,
    AutotuneProgress,
    autotune_module_available,
)
from athletemotion_desktop.runtime.hardware.diagnostics import (
    DiagnosticWarning,
    build_diagnostics,
)
from athletemotion_desktop.runtime.hardware.probe import HardwareInfo, collect_hardware_info
from athletemotion_desktop.runtime.hardware.profile import (
    AutotuneUnavailableError,
    ProfileStatus,
    load_profile,
)

logger = logging.getLogger(__name__)

#: Intervalo de consulta ao processo de autotune. 100 ms mantém a barra de progresso
#: fluida sem custo assinalável no ciclo de eventos da UI.
AUTOTUNE_POLL_INTERVAL_MS = 100


class SettingsViewModel(QObject):
    """Liga a vista de Definições às definições persistidas e ao autotune.

    Sinais:
        hardware_reloaded: a informação de hardware foi atualizada.
        diagnostics_changed: a lista de avisos mudou.
        autotune_progress: percentagem (0–100) e mensagem de estado.
        autotune_finished: sucesso e mensagem final do autotune.
        settings_saved: as definições foram gravadas em disco.
        theme_change_requested: o tema escolhido deve ser aplicado à aplicação.
    """

    hardware_reloaded = pyqtSignal()
    diagnostics_changed = pyqtSignal()
    autotune_progress = pyqtSignal(int, str)
    autotune_finished = pyqtSignal(bool, str)
    settings_saved = pyqtSignal()
    theme_change_requested = pyqtSignal(str)

    def __init__(
        self,
        settings: AppSettings,
        settings_file: Path,
        *,
        profile_file: Path,
        hardware_probe: Callable[[], HardwareInfo] = collect_hardware_info,
        autotune_factory: Callable[[Path], AutotuneProcess] = AutotuneProcess,
        parent: QObject | None = None,
    ) -> None:
        """Cria o view-model com as dependências injetadas.

        Args:
            settings: definições carregadas do disco.
            settings_file: caminho do ficheiro de definições (gravação atómica).
            profile_file: caminho de `hardware_profile.json`.
            hardware_probe: função de sondagem (substituível nos testes).
            autotune_factory: construtor do processo de autotune (substituível nos testes).
            parent: objeto pai do Qt.
        """
        super().__init__(parent)
        self._saved_settings = settings
        self._draft_settings = settings.model_copy(deep=True)
        self._settings_file = settings_file
        self._profile_file = profile_file
        self._hardware_probe = hardware_probe
        self._autotune_factory = autotune_factory

        self.hardware_info: HardwareInfo = hardware_probe()
        self.profile_status: ProfileStatus = load_profile(
            profile_file, self.hardware_info.signature
        )
        self._autotune: AutotuneProcess | None = None
        self._autotune_timer = QTimer(self)
        self._autotune_timer.setInterval(AUTOTUNE_POLL_INTERVAL_MS)
        self._autotune_timer.timeout.connect(self._on_autotune_poll)

    # ------------------------------------------------------------ propriedades

    @property
    def draft(self) -> AppSettings:
        """Cópia de trabalho das definições (o que a vista está a editar)."""
        return self._draft_settings

    @property
    def saved_settings(self) -> AppSettings:
        """Definições tal como estão persistidas em disco."""
        return self._saved_settings

    @property
    def is_dirty(self) -> bool:
        """Indica se existem alterações por guardar."""
        return self._draft_settings != self._saved_settings

    @property
    def diagnostics(self) -> tuple[DiagnosticWarning, ...]:
        """Avisos atuais para o hardware e o backend selecionados."""
        return build_diagnostics(
            self.hardware_info,
            selected_backend=self._draft_settings.inference.preferred_backend,
        )

    @property
    def autotune_available(self) -> bool:
        """Indica se o autotune pode ser executado neste ambiente (depende de R14)."""
        return autotune_module_available()

    @property
    def is_autotuning(self) -> bool:
        """Indica se existe uma execução de autotune em curso."""
        return self._autotune is not None and self._autotune.is_running

    # --------------------------------------------------------------- hardware

    def reload_hardware(self) -> None:
        """Volta a sondar o hardware e a reavaliar o perfil de autotune.

        Se existir um perfil válido e o utilizador não tiver substituído a
        recomendação manualmente, o *draft* passa a refletir essa recomendação.
        """
        self.hardware_info = self._hardware_probe()
        self.profile_status = load_profile(self._profile_file, self.hardware_info.signature)
        self.apply_recommendation(emit_signals=False)
        self.hardware_reloaded.emit()
        self.diagnostics_changed.emit()

    def apply_recommendation(self, *, emit_signals: bool = True) -> bool:
        """Aplica ao *draft* a recomendação do perfil de autotune, se aplicável.

        Args:
            emit_signals: emite `diagnostics_changed` quando algo muda.

        Returns:
            `True` se a recomendação foi aplicada.
        """
        profile = self.profile_status.profile
        if profile is None or self._draft_settings.inference.manual_override:
            return False

        recommendation = profile.recommendation
        self._draft_settings.inference = self._draft_settings.inference.model_copy(
            update={
                "preferred_backend": recommendation.backend,
                "pose_model": recommendation.pose_model,
                "detector_model": recommendation.detector_model,
                "input_resolution": recommendation.input_resolution,
                "redetect_interval": recommendation.redetect_interval,
                "mode": recommendation.mode,
            }
        )
        if emit_signals:
            self.diagnostics_changed.emit()
        return True

    # -------------------------------------------------------------- definições

    def mark_manual_override(self) -> None:
        """Regista que o utilizador passou a controlar manualmente a inferência."""
        if not self._draft_settings.inference.manual_override:
            self._draft_settings.inference = self._draft_settings.inference.model_copy(
                update={"manual_override": True}
            )
            self.diagnostics_changed.emit()

    def update_draft(self, **updates: object) -> None:
        """Aplica alterações ao *draft* (auxiliar usado pelos testes e controladores).

        Args:
            updates: pares `campo`/`valor` ao nível da raiz das definições.
        """
        self._draft_settings = self._draft_settings.model_copy(update=updates)
        self.diagnostics_changed.emit()

    def save(self) -> None:
        """Grava atomicamente o *draft* e propaga a mudança de tema, se aplicável."""
        theme_changed = self._draft_settings.theme != self._saved_settings.theme
        save_settings(self._draft_settings, self._settings_file)
        self._saved_settings = self._draft_settings.model_copy(deep=True)
        self.settings_saved.emit()
        if theme_changed:
            self.theme_change_requested.emit(self._draft_settings.theme)

    def reset_to_defaults(self) -> None:
        """Repõe os valores padrão no *draft* (o disco só muda ao guardar)."""
        self._draft_settings = self._draft_settings.reset_to_defaults()
        self.diagnostics_changed.emit()

    # --------------------------------------------------------------- autotune

    def start_autotune(self) -> bool:
        """Lança o autotune em processo separado.

        Returns:
            `True` se arrancou; `False` quando está indisponível (razão registada
            e comunicada por `autotune_finished`).
        """
        if self.is_autotuning:
            logger.warning("O autotune já está em curso; o pedido foi ignorado.")
            return False

        autotune = self._autotune_factory(self._profile_file)
        try:
            autotune.start()
        except AutotuneUnavailableError as exc:
            logger.error("Autotune indisponível: %s", exc.reason)
            self.autotune_finished.emit(False, exc.reason)
            return False

        self._autotune = autotune
        self._autotune_timer.start()
        self.autotune_progress.emit(0, "Autotune iniciado…")
        return True

    def cancel_autotune(self) -> None:
        """Cancela o autotune em curso, se existir."""
        if self._autotune is None:
            return
        self._autotune.cancel()
        self._autotune_timer.stop()
        self.autotune_finished.emit(False, "Autotune cancelado pelo utilizador.")
        self._autotune = None

    def _on_autotune_poll(self) -> None:
        """Consulta o progresso do autotune (chamado pelo temporizador da UI)."""
        autotune = self._autotune
        if autotune is None:
            self._autotune_timer.stop()
            return

        progress: AutotuneProgress | None = autotune.poll_progress()
        if progress is not None:
            message = progress.message or progress.stage
            self.autotune_progress.emit(progress.percent, message)

        if autotune.is_running:
            return

        self._autotune_timer.stop()
        exit_code = autotune.exit_code
        self._autotune = None
        if exit_code == 0:
            self.reload_hardware()
            self.autotune_finished.emit(True, "Autotune concluído: perfil de hardware atualizado.")
            return

        detail = autotune.stderr_tail.strip() or "sem detalhes do processo"
        logger.error("Autotune terminou com código %s: %s", exit_code, detail)
        self.autotune_finished.emit(False, f"O autotune falhou (código {exit_code}): {detail}")

    def shutdown(self) -> None:
        """Para o temporizador e garante que nenhum autotune fica a correr solto.

        Chamado no encerramento da aplicação: sem isto, um processo de benchmark
        ficaria a consumir a GPU depois de a janela fechar.
        """
        self._autotune_timer.stop()
        if self._autotune is not None and self._autotune.is_running:
            logger.warning("A cancelar o autotune durante o encerramento da aplicação.")
            self._autotune.cancel()
        self._autotune = None
