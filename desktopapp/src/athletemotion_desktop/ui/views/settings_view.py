"""Vista de Definições: hardware detetado, avisos, desempenho, câmara e aplicação.

A vista não calcula nada: lê do *view-model* e escreve no *draft*. As alterações só
chegam ao disco com o botão «Guardar», o que mantém o ficheiro de definições
consistente com o que está no ecrã.
"""

from __future__ import annotations

from typing import Final

from PyQt6.QtCore import QT_TRANSLATE_NOOP
from PyQt6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from athletemotion_desktop.config.settings import AppSettings
from athletemotion_desktop.runtime.hardware.diagnostics import DiagnosticWarning
from athletemotion_desktop.ui.i18n import SUPPORTED_LANGUAGES
from athletemotion_desktop.ui.viewmodels.settings_vm import SettingsViewModel

BACKEND_OPTIONS: Final[tuple[tuple[str, str], ...]] = (
    ("auto", QT_TRANSLATE_NOOP("SettingsView", "Automático (recomendado)")),
    ("directml", "DirectML (GPU AMD)"),
    ("openvino", "OpenVINO (CPU Intel)"),
    ("cpu", QT_TRANSLATE_NOOP("SettingsView", "CPU (ONNX Runtime)")),
)

MODE_OPTIONS: Final[tuple[tuple[str, str], ...]] = (
    ("real_time", QT_TRANSLATE_NOOP("SettingsView", "Tempo real")),
    ("precision", QT_TRANSLATE_NOOP("SettingsView", "Precisão")),
    ("batch", QT_TRANSLATE_NOOP("SettingsView", "Lote (batch)")),
)

THEME_OPTIONS: Final[tuple[tuple[str, str], ...]] = (
    ("dark", QT_TRANSLATE_NOOP("SettingsView", "Escuro")),
    ("light", QT_TRANSLATE_NOOP("SettingsView", "Claro")),
)


class SettingsView(QWidget):
    """Formulário de definições com secções de hardware, desempenho e aplicação."""

    def __init__(self, view_model: SettingsViewModel, parent: QWidget | None = None) -> None:
        """Constrói a vista ligada ao *view-model* indicado.

        Args:
            view_model: estado e ações das definições.
            parent: widget pai.
        """
        super().__init__(parent)
        self._view_model = view_model
        self._loading = False

        layout = QVBoxLayout(self)
        scroll_area = QScrollArea(self)
        scroll_area.setWidgetResizable(True)
        content = QWidget(scroll_area)
        self._content_layout = QVBoxLayout(content)
        scroll_area.setWidget(content)
        layout.addWidget(scroll_area)

        self._build_hardware_section()
        self._build_diagnostics_section()
        self._build_performance_section()
        self._build_camera_section()
        self._build_application_section()
        self._build_actions()

        self._connect_view_model()
        self.retranslate_ui()
        self.refresh()

    # ------------------------------------------------------------ construção

    def _build_hardware_section(self) -> None:
        """Cria a secção com o hardware detetado."""
        self._hardware_group = QGroupBox(self)
        self._hardware_form = QFormLayout(self._hardware_group)
        self._hardware_value_labels: dict[str, QLabel] = {}
        for key in ("cpu", "flags", "ram", "gpu", "ort", "openvino", "signature"):
            value_label = QLabel(self._hardware_group)
            value_label.setWordWrap(True)
            self._hardware_value_labels[key] = value_label
            self._hardware_form.addRow(key, value_label)

        self.refresh_hardware_button = QPushButton(self._hardware_group)
        self.refresh_hardware_button.clicked.connect(self._view_model.reload_hardware)
        self._hardware_form.addRow(self.refresh_hardware_button)
        self._content_layout.addWidget(self._hardware_group)

    def _build_diagnostics_section(self) -> None:
        """Cria a secção de avisos inteligentes."""
        self._diagnostics_group = QGroupBox(self)
        diagnostics_layout = QVBoxLayout(self._diagnostics_group)
        self.diagnostics_list = QListWidget(self._diagnostics_group)
        self.diagnostics_list.setObjectName("DiagnosticsList")
        diagnostics_layout.addWidget(self.diagnostics_list)
        self._content_layout.addWidget(self._diagnostics_group)

    def _build_performance_section(self) -> None:
        """Cria a secção de desempenho, perfil e autotune."""
        self._performance_group = QGroupBox(self)
        form = QFormLayout(self._performance_group)

        self.profile_state_label = QLabel(self._performance_group)
        self.profile_state_label.setWordWrap(True)
        form.addRow(self.profile_state_label)

        self.backend_combo = QComboBox(self._performance_group)
        for backend_value, backend_label in BACKEND_OPTIONS:
            self.backend_combo.addItem(backend_label, backend_value)
        self.backend_combo.currentIndexChanged.connect(self._on_backend_changed)
        form.addRow(self.backend_combo)

        self.mode_combo = QComboBox(self._performance_group)
        for mode_value, mode_label in MODE_OPTIONS:
            self.mode_combo.addItem(mode_label, mode_value)
        self.mode_combo.currentIndexChanged.connect(self._on_mode_changed)
        form.addRow(self.mode_combo)

        self.resolution_spin = QSpinBox(self._performance_group)
        self.resolution_spin.setRange(160, 1280)
        self.resolution_spin.setSingleStep(32)
        self.resolution_spin.valueChanged.connect(self._on_resolution_changed)
        form.addRow(self.resolution_spin)

        self.redetect_spin = QSpinBox(self._performance_group)
        self.redetect_spin.setRange(1, 120)
        self.redetect_spin.valueChanged.connect(self._on_redetect_changed)
        form.addRow(self.redetect_spin)

        self.manual_override_check = QCheckBox(self._performance_group)
        self.manual_override_check.toggled.connect(self._on_manual_override_toggled)
        form.addRow(self.manual_override_check)

        self.autotune_progress = QProgressBar(self._performance_group)
        self.autotune_progress.setRange(0, 100)
        self.autotune_progress.setValue(0)
        form.addRow(self.autotune_progress)

        buttons_row = QWidget(self._performance_group)
        buttons_layout = QHBoxLayout(buttons_row)
        buttons_layout.setContentsMargins(0, 0, 0, 0)
        self.run_autotune_button = QPushButton(buttons_row)
        self.run_autotune_button.clicked.connect(self._on_run_autotune)
        self.cancel_autotune_button = QPushButton(buttons_row)
        self.cancel_autotune_button.clicked.connect(self._view_model.cancel_autotune)
        self.cancel_autotune_button.setEnabled(False)
        buttons_layout.addWidget(self.run_autotune_button)
        buttons_layout.addWidget(self.cancel_autotune_button)
        form.addRow(buttons_row)

        self._content_layout.addWidget(self._performance_group)

    def _build_camera_section(self) -> None:
        """Cria a secção de câmara (valores usados pela captura em D03)."""
        self._camera_group = QGroupBox(self)
        form = QFormLayout(self._camera_group)

        self.camera_index_spin = QSpinBox(self._camera_group)
        self.camera_index_spin.setRange(0, 8)
        self.camera_index_spin.valueChanged.connect(self._on_camera_changed)
        form.addRow(self.camera_index_spin)

        self.camera_fps_spin = QSpinBox(self._camera_group)
        self.camera_fps_spin.setRange(15, 240)
        self.camera_fps_spin.valueChanged.connect(self._on_camera_changed)
        form.addRow(self.camera_fps_spin)

        self.camera_width_spin = QSpinBox(self._camera_group)
        self.camera_width_spin.setRange(320, 3840)
        self.camera_width_spin.setSingleStep(160)
        self.camera_width_spin.valueChanged.connect(self._on_camera_changed)
        form.addRow(self.camera_width_spin)

        self.camera_height_spin = QSpinBox(self._camera_group)
        self.camera_height_spin.setRange(240, 2160)
        self.camera_height_spin.setSingleStep(120)
        self.camera_height_spin.valueChanged.connect(self._on_camera_changed)
        form.addRow(self.camera_height_spin)

        self._content_layout.addWidget(self._camera_group)

    def _build_application_section(self) -> None:
        """Cria a secção de aplicação (idioma, tema e política de gravação)."""
        self._application_group = QGroupBox(self)
        form = QFormLayout(self._application_group)

        self.language_combo = QComboBox(self._application_group)
        for language_code, language_name in SUPPORTED_LANGUAGES.items():
            self.language_combo.addItem(language_name, language_code)
        self.language_combo.currentIndexChanged.connect(self._on_language_changed)
        form.addRow(self.language_combo)

        self.theme_combo = QComboBox(self._application_group)
        for theme_value, theme_label in THEME_OPTIONS:
            self.theme_combo.addItem(theme_label, theme_value)
        self.theme_combo.currentIndexChanged.connect(self._on_theme_changed)
        form.addRow(self.theme_combo)

        self.record_check = QCheckBox(self._application_group)
        self.record_check.toggled.connect(self._on_record_toggled)
        form.addRow(self.record_check)

        self.language_hint_label = QLabel(self._application_group)
        self.language_hint_label.setWordWrap(True)
        form.addRow(self.language_hint_label)

        self._content_layout.addWidget(self._application_group)

    def _build_actions(self) -> None:
        """Cria a barra de ações (guardar, restaurar) e o estado do formulário."""
        actions_widget = QWidget(self)
        actions_layout = QHBoxLayout(actions_widget)
        actions_layout.setContentsMargins(0, 0, 0, 0)

        self.state_label = QLabel(actions_widget)
        actions_layout.addWidget(self.state_label)
        actions_layout.addStretch()

        self.reset_button = QPushButton(actions_widget)
        self.reset_button.clicked.connect(self._on_reset)
        actions_layout.addWidget(self.reset_button)

        self.save_button = QPushButton(actions_widget)
        self.save_button.setObjectName("PrimaryButton")
        self.save_button.clicked.connect(self._on_save)
        actions_layout.addWidget(self.save_button)

        self._content_layout.addWidget(actions_widget)

    def _connect_view_model(self) -> None:
        """Liga os sinais do *view-model* aos métodos da vista."""
        self._view_model.hardware_reloaded.connect(self.refresh)
        self._view_model.diagnostics_changed.connect(self.refresh_diagnostics)
        self._view_model.autotune_progress.connect(self._on_autotune_progress)
        self._view_model.autotune_finished.connect(self._on_autotune_finished)
        self._view_model.settings_saved.connect(self.refresh)

    # ----------------------------------------------------------------- i18n

    def retranslate_ui(self) -> None:
        """Aplica todos os textos traduzíveis (padrão `retranslateUi` do Qt)."""
        self._hardware_group.setTitle(self.tr("Hardware detetado"))
        hardware_keys = {
            "cpu": self.tr("Processador"),
            "flags": self.tr("Instruções vetoriais"),
            "ram": self.tr("Memória RAM"),
            "gpu": self.tr("Placas gráficas"),
            "ort": self.tr("Providers do ONNX Runtime"),
            "openvino": self.tr("Dispositivos OpenVINO"),
            "signature": self.tr("Assinatura do hardware"),
        }
        for key, source_label in hardware_keys.items():
            label = self._hardware_form.labelForField(self._hardware_value_labels[key])
            if label is not None:
                label.setText(source_label)
        self.refresh_hardware_button.setText(self.tr("Detetar novamente"))

        self._diagnostics_group.setTitle(self.tr("Avisos e recomendações"))
        self._performance_group.setTitle(self.tr("Desempenho e inferência"))
        self._camera_group.setTitle(self.tr("Câmara"))
        self._application_group.setTitle(self.tr("Aplicação"))

        for combo, options in (
            (self.backend_combo, BACKEND_OPTIONS),
            (self.mode_combo, MODE_OPTIONS),
        ):
            for index, (_value, source_label) in enumerate(options):
                combo.setItemText(index, self.tr(source_label))

        self.performance_form_labels = {
            "backend": self.tr("Backend de inferência"),
            "mode": self.tr("Perfil de desempenho"),
            "resolution": self.tr("Resolução de entrada (px)"),
            "redetect": self.tr("Intervalo de redeteção (frames)"),
            "override": self.tr("Substituir a recomendação do autotune"),
            "progress": self.tr("Progresso do autotune"),
        }
        self._apply_form_row_labels(
            self._performance_group,
            {
                self.backend_combo: self.performance_form_labels["backend"],
                self.mode_combo: self.performance_form_labels["mode"],
                self.resolution_spin: self.performance_form_labels["resolution"],
                self.redetect_spin: self.performance_form_labels["redetect"],
                self.manual_override_check: self.performance_form_labels["override"],
                self.autotune_progress: self.performance_form_labels["progress"],
            },
        )
        self.manual_override_check.setText(self.performance_form_labels["override"])

        self.run_autotune_button.setText(self.tr("Executar autotune"))
        self.cancel_autotune_button.setText(self.tr("Cancelar"))

        self._apply_form_row_labels(
            self._camera_group,
            {
                self.camera_index_spin: self.tr("Índice do dispositivo"),
                self.camera_fps_spin: self.tr("Frames por segundo"),
                self.camera_width_spin: self.tr("Largura"),
                self.camera_height_spin: self.tr("Altura"),
            },
        )

        self._apply_form_row_labels(
            self._application_group,
            {
                self.language_combo: self.tr("Idioma"),
                self.theme_combo: self.tr("Tema"),
                self.record_check: self.tr("Gravar vídeo das sessões"),
            },
        )
        self.record_check.setText(self.tr("Gravar vídeo das sessões"))
        self.language_hint_label.setText(
            self.tr("A mudança de idioma é aplicada ao guardar as definições.")
        )
        for index, (_theme_value, source_label) in enumerate(THEME_OPTIONS):
            self.theme_combo.setItemText(index, self.tr(source_label))

        self.save_button.setText(self.tr("Guardar"))
        self.reset_button.setText(self.tr("Restaurar padrões"))
        self.refresh_state_label()

    def _apply_form_row_labels(self, group: QGroupBox, mapping: dict[QWidget, str]) -> None:
        """Substitui os rótulos das linhas de um formulário pelos textos traduzidos."""
        form_layout = group.layout()
        if not isinstance(form_layout, QFormLayout):
            return
        for field_widget, text in mapping.items():
            label = form_layout.labelForField(field_widget)
            if label is not None:
                label.setText(text)

    # ------------------------------------------------------------- atualização

    def refresh(self) -> None:
        """Atualiza todos os controlos a partir do *view-model*."""
        self._loading = True
        try:
            self.refresh_hardware_values()
            self.refresh_draft_values()
            self.refresh_diagnostics()
        finally:
            self._loading = False
        self.refresh_state_label()
        self.refresh_autotune_controls()

    def refresh_hardware_values(self) -> None:
        """Mostra a informação de hardware detetada."""
        hardware = self._view_model.hardware_info
        cpu = hardware.cpu
        physical = cpu.physical_cores if cpu.physical_cores is not None else "?"
        logical = cpu.logical_cores if cpu.logical_cores else "?"
        self._hardware_value_labels["cpu"].setText(f"{cpu.model or '—'} ({physical}/{logical})")

        def _flag(value: bool | None) -> str:
            return "?" if value is None else ("sim" if value else "não")

        self._hardware_value_labels["flags"].setText(
            f"AVX2: {_flag(cpu.has_avx2)} · AVX-512: {_flag(cpu.has_avx512)} · "
            f"VNNI: {_flag(cpu.has_vnni)}"
        )
        ram_text = f"{hardware.total_ram_gb} GB" if hardware.total_ram_gb else "—"
        self._hardware_value_labels["ram"].setText(ram_text)

        if hardware.gpus:
            self._hardware_value_labels["gpu"].setText(
                "\n".join(
                    f"{gpu.name} — {gpu.vendor}"
                    + (f", {gpu.vram_gb} GiB" if gpu.vram_gb is not None else ", VRAM desconhecida")
                    + (f", driver {gpu.driver_version}" if gpu.driver_version else "")
                    for gpu in hardware.gpus
                )
            )
        else:
            self._hardware_value_labels["gpu"].setText(self.tr("Nenhuma detetada"))
        self._hardware_value_labels["ort"].setText(", ".join(hardware.ort_providers) or "—")
        self._hardware_value_labels["openvino"].setText(", ".join(hardware.openvino_devices) or "—")
        self._hardware_value_labels["signature"].setText(hardware.signature or "—")

    def refresh_draft_values(self) -> None:
        """Sincroniza os controlos com o *draft* e o estado do perfil."""
        draft_settings = self._view_model.draft
        self.backend_combo.setCurrentIndex(
            max(0, self.backend_combo.findData(draft_settings.inference.preferred_backend))
        )
        self.mode_combo.setCurrentIndex(
            max(0, self.mode_combo.findData(draft_settings.inference.mode))
        )
        self.resolution_spin.setValue(draft_settings.inference.input_resolution)
        self.redetect_spin.setValue(draft_settings.inference.redetect_interval)
        self.manual_override_check.setChecked(draft_settings.inference.manual_override)

        self.camera_index_spin.setValue(draft_settings.camera.device_index)
        self.camera_fps_spin.setValue(draft_settings.camera.target_fps)
        self.camera_width_spin.setValue(draft_settings.camera.frame_width)
        self.camera_height_spin.setValue(draft_settings.camera.frame_height)

        self.language_combo.setCurrentIndex(
            max(0, self.language_combo.findData(draft_settings.language))
        )
        self.theme_combo.setCurrentIndex(max(0, self.theme_combo.findData(draft_settings.theme)))
        self.record_check.setChecked(draft_settings.record_sessions)

        profile_status = self._view_model.profile_status
        recommendation = profile_status.profile.recommendation if profile_status.profile else None
        if recommendation is not None:
            self.profile_state_label.setText(
                f"{profile_status.reason}\n"
                + self.tr("Recomendação: {backend} · {model} · {resolution} px").format(
                    backend=recommendation.backend,
                    model=recommendation.pose_model,
                    resolution=recommendation.input_resolution,
                )
            )
        else:
            self.profile_state_label.setText(profile_status.reason)

    def refresh_diagnostics(self) -> None:
        """Preenche a lista de avisos a partir do *view-model*."""
        diagnostics: tuple[DiagnosticWarning, ...] = self._view_model.diagnostics
        self.diagnostics_list.clear()
        if not diagnostics:
            self.diagnostics_list.addItem(self.tr("Sem avisos: configuração consistente."))
            return
        for diagnostic in diagnostics:
            prefix = {
                "error": self.tr("Erro"),
                "warning": self.tr("Aviso"),
                "info": self.tr("Informação"),
            }[diagnostic.severity]
            self.diagnostics_list.addItem(f"[{prefix}] {diagnostic.message}")

    def refresh_state_label(self) -> None:
        """Indica se existem alterações por guardar."""
        self.state_label.setText(
            self.tr("Alterações por guardar.")
            if self._view_model.is_dirty
            else self.tr("Definições sincronizadas com o disco.")
        )
        self.save_button.setEnabled(self._view_model.is_dirty)

    def refresh_autotune_controls(self) -> None:
        """Habilita/desabilita os controlos do autotune conforme o estado real."""
        available = self._view_model.autotune_available
        running = self._view_model.is_autotuning
        self.run_autotune_button.setEnabled(available and not running)
        self.cancel_autotune_button.setEnabled(running)
        if not available:
            self.run_autotune_button.setToolTip(
                self.tr(
                    "Indisponível: o módulo de autotune do backend (R14) ainda não existe neste ambiente."
                )
            )

    # ---------------------------------------------------------------- eventos

    def _on_backend_changed(self, _index: int) -> None:
        self._update_inference_field("preferred_backend", str(self.backend_combo.currentData()))

    def _on_mode_changed(self, _index: int) -> None:
        self._update_inference_field("mode", str(self.mode_combo.currentData()))

    def _on_resolution_changed(self, value: int) -> None:
        self._update_inference_field("input_resolution", value)

    def _on_redetect_changed(self, value: int) -> None:
        self._update_inference_field("redetect_interval", value)

    def _on_manual_override_toggled(self, checked: bool) -> None:
        if self._loading:
            return
        self._view_model.draft.inference = self._view_model.draft.inference.model_copy(
            update={"manual_override": checked}
        )
        if not checked:
            self._view_model.apply_recommendation()
            self.refresh()
        self.refresh_state_label()

    def _update_inference_field(self, field_name: str, value: object) -> None:
        """Aplica um campo de inferência ao *draft* e marca o override manual."""
        if self._loading:
            return
        self._view_model.mark_manual_override()
        self._view_model.draft.inference = self._view_model.draft.inference.model_copy(
            update={field_name: value}
        )
        self.refresh_state_label()
        self.refresh_diagnostics()

    def _on_camera_changed(self, _value: int) -> None:
        if self._loading:
            return
        self._view_model.draft.camera = self._view_model.draft.camera.model_copy(
            update={
                "device_index": self.camera_index_spin.value(),
                "target_fps": self.camera_fps_spin.value(),
                "frame_width": self.camera_width_spin.value(),
                "frame_height": self.camera_height_spin.value(),
            }
        )
        self.refresh_state_label()

    def _on_language_changed(self, _index: int) -> None:
        if self._loading:
            return
        self._view_model.update_draft(language=str(self.language_combo.currentData()))
        self.refresh_state_label()

    def _on_theme_changed(self, _index: int) -> None:
        if self._loading:
            return
        self._view_model.update_draft(theme=str(self.theme_combo.currentData()))
        self.refresh_state_label()

    def _on_record_toggled(self, checked: bool) -> None:
        if self._loading:
            return
        self._view_model.update_draft(record_sessions=checked)
        self.refresh_state_label()

    def _on_save(self) -> None:
        self._view_model.save()
        self.refresh()

    def _on_reset(self) -> None:
        self._view_model.reset_to_defaults()
        self.refresh()

    def _on_run_autotune(self) -> None:
        self.autotune_progress.setValue(0)
        self._view_model.start_autotune()
        self.refresh_autotune_controls()

    def _on_autotune_progress(self, percent: int, message: str) -> None:
        self.autotune_progress.setValue(percent)
        self.autotune_progress.setFormat(f"%p% — {message}")
        self.refresh_autotune_controls()

    def _on_autotune_finished(self, success: bool, message: str) -> None:
        self.autotune_progress.setFormat(message)
        if not success:
            self.autotune_progress.setValue(0)
        self.refresh()
        self.refresh_autotune_controls()

    # ------------------------------------------------------------ acesso (testes)

    @property
    def diagnostic_items(self) -> tuple[str, ...]:
        """Itens atualmente apresentados na lista de avisos."""
        return tuple(
            self.diagnostics_list.item(index).text()
            for index in range(self.diagnostics_list.count())
        )

    @property
    def settings(self) -> AppSettings:
        """Definições em edição (atalho de leitura para testes e automação)."""
        return self._view_model.draft
