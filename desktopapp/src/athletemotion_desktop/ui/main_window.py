"""Janela principal da aplicação desktop Athlete Motion.

Padrão estrutural: a construção da interface (`_setup_ui`) não contém textos e
`retranslate_ui()` aplica-os todos. É o padrão `retranslateUi` do Qt Translator e
é o que permite trocar de idioma a quente sem reconstruir widgets.
"""

from __future__ import annotations

import logging
import platform
import sys
from dataclasses import dataclass
from typing import Final

import psutil
from PyQt6.QtCore import QT_TRANSLATE_NOOP, QEvent, pyqtSignal
from PyQt6.QtGui import QCloseEvent
from PyQt6.QtWidgets import (
    QButtonGroup,
    QComboBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QPushButton,
    QStackedWidget,
    QStatusBar,
    QVBoxLayout,
    QWidget,
)

from athletemotion_desktop.config.settings import AppSettings
from athletemotion_desktop.ui.i18n import SUPPORTED_LANGUAGES

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class NavigationEntry:
    """Definição declarativa de uma vista da navegação lateral.

    Os textos usam `QT_TRANSLATE_NOOP` — uma marca para o `pylupdate6` extrair a
    string com o contexto `MainWindow` (o mesmo contexto de `self.tr(...)`), sem
    impedir que a definição seja declarativa e verificável por testes.
    """

    view_id: int
    icon: str
    title_source: str
    description_source: str


#: Identificador da vista de Definições. É partilhado com o `app.py`, que injeta a
#: vista funcional (D02) nesta posição da pilha.
SETTINGS_VIEW_ID: Final[int] = 4

NAVIGATION_ENTRIES: Final[tuple[NavigationEntry, ...]] = (
    NavigationEntry(
        view_id=0,
        icon="📡",
        title_source=QT_TRANSLATE_NOOP("MainWindow", "Live Fit"),
        description_source=QT_TRANSLATE_NOOP(
            "MainWindow", "Análise em tempo real da posição do ciclista."
        ),
    ),
    NavigationEntry(
        view_id=1,
        icon="📼",
        title_source=QT_TRANSLATE_NOOP("MainWindow", "Análise de Vídeo"),
        description_source=QT_TRANSLATE_NOOP(
            "MainWindow", "Análise de vídeo gravado com comparação A/B."
        ),
    ),
    NavigationEntry(
        view_id=2,
        icon="📊",
        title_source=QT_TRANSLATE_NOOP("MainWindow", "Relatórios"),
        description_source=QT_TRANSLATE_NOOP(
            "MainWindow", "Relatórios de sessão, exportação e rastreabilidade."
        ),
    ),
    NavigationEntry(
        view_id=3,
        icon="⚡",
        title_source=QT_TRANSLATE_NOOP("MainWindow", "Benchmark"),
        description_source=QT_TRANSLATE_NOOP(
            "MainWindow", "Diagnóstico de hardware e comparação de backends de inferência."
        ),
    ),
    NavigationEntry(
        view_id=SETTINGS_VIEW_ID,
        icon="⚙️",
        title_source=QT_TRANSLATE_NOOP("MainWindow", "Definições"),
        description_source=QT_TRANSLATE_NOOP(
            "MainWindow", "Câmara, modelos, idioma, tema e privacidade."
        ),
    ),
)


class MainWindow(QMainWindow):
    """Janela principal com navegação lateral, pilha de vistas e telemetria de sistema."""

    DEFAULT_WIDTH: Final[int] = 1366
    DEFAULT_HEIGHT: Final[int] = 768

    language_change_requested = pyqtSignal(str)
    """Pedido de mudança de idioma pelo utilizador.

    A janela não aplica nem persiste o idioma: apenas comunica a intenção.
    A aplicação (`app.py`) instala o tradutor e grava a preferência. O sinal
    transporta o código do idioma pedido.
    """

    closing = pyqtSignal()
    """Emitido antes de a janela fechar, para o orquestrador libertar recursos."""

    def __init__(self, settings: AppSettings, parent: QWidget | None = None) -> None:
        """Constrói a janela para as definições indicadas.

        Args:
            settings: definições validadas da aplicação (idioma, tema, câmara).
            parent: widget pai opcional.
        """
        super().__init__(parent)
        self.settings = settings
        self._navigation_buttons: list[QPushButton] = []
        self._view_headings: list[QLabel] = []
        self._view_descriptions: list[QLabel] = []
        self._status_bar = QStatusBar(self)

        self.resize(self.DEFAULT_WIDTH, self.DEFAULT_HEIGHT)
        self._setup_ui()
        self.retranslate_ui()
        self.set_current_language(settings.language)

    # ------------------------------------------------------------------ i18n

    def retranslate_ui(self) -> None:
        """(Re)aplica todos os textos traduzíveis da interface.

        Chamado na construção e sempre que o idioma ativo muda.
        """
        self.setWindowTitle(self.tr("Athlete Motion — Bikefit Studio"))
        self._brand_label.setText(self.tr("ATHLETE MOTION"))
        self._subtitle_label.setText(self.tr("Bikefit Core Edition"))
        self._language_label.setText(self.tr("Idioma:"))
        self._version_label.setText(self.tr("v0.2.0 • Bare-Metal"))

        for entry, button, heading, description in zip(
            NAVIGATION_ENTRIES,
            self._navigation_buttons,
            self._view_headings,
            self._view_descriptions,
            strict=True,
        ):
            button.setText(f"{entry.icon} {self.tr(entry.title_source)}")
            heading.setText(self.tr(entry.title_source))
            description.setText(self.tr(entry.description_source))

        self._status_bar.showMessage(self.tr("Sistema pronto. Aceleração de hardware ativa."))
        self._telemetry_label.setText(self._build_system_summary())

    def set_current_language(self, language: str) -> None:
        """Sincroniza o seletor de idioma com o idioma efetivamente aplicado.

        Não emite `language_change_requested`: é uma atualização programática do
        estado da interface, não uma escolha do utilizador.

        Args:
            language: código do idioma aplicado (por exemplo `pt_PT`).
        """
        selector_index = self.language_selector.findData(language)
        if selector_index < 0:
            logger.warning(
                "Idioma '%s' não consta do seletor de idiomas; a manter '%s'.",
                language,
                self.language_selector.currentData(),
            )
            return
        self.language_selector.blockSignals(True)
        self.language_selector.setCurrentIndex(selector_index)
        self.language_selector.blockSignals(False)

    def set_view_widget(self, view_id: int, widget: QWidget) -> None:
        """Substitui a página provisória de uma vista pelo widget funcional.

        As páginas de exemplo são criadas no arranque e cada tarefa (D02, D07, D09…)
        entrega o seu widget; esta substituição evita que a janela conheça todas as
        vistas concretas.

        Args:
            view_id: identificador da vista (posição em `NAVIGATION_ENTRIES`).
            widget: widget que passa a ocupar a posição da vista.

        Raises:
            IndexError: se a vista indicada não existir.
        """
        if not 0 <= view_id < self.view_stack.count():
            raise IndexError(
                f"Vista {view_id} não existe (intervalo válido: 0..{self.view_stack.count() - 1})."
            )

        current_index = self.view_stack.currentIndex()
        placeholder = self.view_stack.widget(view_id)
        if placeholder is None:
            raise IndexError(f"A pilha de vistas não tem widget na posição {view_id}.")
        self.view_stack.removeWidget(placeholder)
        placeholder.deleteLater()
        self.view_stack.insertWidget(view_id, widget)
        self.view_stack.setCurrentIndex(current_index)

    @property
    def navigation_buttons(self) -> tuple[QPushButton, ...]:
        """Botões de navegação lateral, por ordem de `NAVIGATION_ENTRIES`.

        Propriedade de leitura usada por testes e por automação de acessibilidade;
        a escrita continua encapsulada na janela.
        """
        return tuple(self._navigation_buttons)

    @property
    def language_label(self) -> QLabel:
        """Rótulo do seletor de idioma (leitura, para testes e acessibilidade)."""
        return self._language_label

    def changeEvent(self, event: QEvent | None) -> None:
        """Retraduz a interface quando o Qt emite `LanguageChange`."""
        if event is not None and event.type() == QEvent.Type.LanguageChange:
            self.retranslate_ui()
        super().changeEvent(event)

    # ------------------------------------------------------------------- UI

    def _setup_ui(self) -> None:
        """Cria a estrutura da interface (sem textos, que ficam em `retranslate_ui`)."""
        central_widget = QWidget(self)
        self.setCentralWidget(central_widget)

        main_layout = QHBoxLayout(central_widget)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        main_layout.addWidget(self._create_sidebar())

        self.view_stack = QStackedWidget(self)
        main_layout.addWidget(self.view_stack, stretch=1)

        self._create_views()
        self._setup_status_bar()

    def _create_sidebar(self) -> QWidget:
        """Constrói a barra lateral: marca, navegação, seletor de idioma e versão."""
        sidebar_widget = QWidget(self)
        sidebar_widget.setObjectName("Sidebar")

        layout = QVBoxLayout(sidebar_widget)
        layout.setContentsMargins(12, 20, 12, 20)
        layout.setSpacing(8)

        self._brand_label = QLabel(sidebar_widget)
        self._brand_label.setObjectName("BrandTitle")
        layout.addWidget(self._brand_label)

        self._subtitle_label = QLabel(sidebar_widget)
        self._subtitle_label.setObjectName("BrandSubtitle")
        layout.addWidget(self._subtitle_label)

        self._navigation_group = QButtonGroup(sidebar_widget)
        self._navigation_group.setExclusive(True)
        for entry in NAVIGATION_ENTRIES:
            button = QPushButton(sidebar_widget)
            button.setCheckable(True)
            if entry.view_id == 0:
                button.setChecked(True)
            self._navigation_group.addButton(button, entry.view_id)
            self._navigation_buttons.append(button)
            layout.addWidget(button)
        self._navigation_group.idClicked.connect(self._on_navigation_changed)

        layout.addStretch()
        layout.addWidget(self._create_language_selector(sidebar_widget))

        self._version_label = QLabel(sidebar_widget)
        self._version_label.setObjectName("VersionLabel")
        layout.addWidget(self._version_label)

        return sidebar_widget

    def _create_language_selector(self, parent: QWidget) -> QWidget:
        """Cria a linha do seletor de idioma (rótulo + combo persistido).

        Args:
            parent: widget pai do contentor do seletor.

        Returns:
            O contentor com o rótulo e o seletor de idiomas.
        """
        container = QWidget(parent)
        layout = QHBoxLayout(container)
        layout.setContentsMargins(8, 0, 8, 0)
        layout.setSpacing(6)

        self._language_label = QLabel(container)
        layout.addWidget(self._language_label)

        self.language_selector = QComboBox(container)
        for language_code, language_name in SUPPORTED_LANGUAGES.items():
            self.language_selector.addItem(language_name, language_code)
        self.language_selector.currentIndexChanged.connect(self._on_language_index_changed)
        layout.addWidget(self.language_selector, stretch=1)

        return container

    def _create_views(self) -> None:
        """Cria as páginas da pilha (uma por entrada de navegação)."""
        for _ in NAVIGATION_ENTRIES:
            page = QWidget()
            page_layout = QVBoxLayout(page)
            page_layout.setContentsMargins(32, 32, 32, 32)

            card = QFrame()
            card.setProperty("class", "card")
            card_layout = QVBoxLayout(card)

            heading = QLabel(card)
            heading.setProperty("class", "heading")
            card_layout.addWidget(heading)

            description = QLabel(card)
            description.setProperty("class", "description")
            card_layout.addWidget(description)
            card_layout.addStretch()

            page_layout.addWidget(card)
            page_layout.addStretch()

            self._view_headings.append(heading)
            self._view_descriptions.append(description)
            self.view_stack.addWidget(page)

    def _setup_status_bar(self) -> None:
        """Configura a barra de estado com a telemetria de sistema."""
        self.setStatusBar(self._status_bar)

        self._telemetry_label = QLabel(self)
        self._telemetry_label.setObjectName("TelemetryLabel")
        self._status_bar.addPermanentWidget(self._telemetry_label)

    def _build_system_summary(self) -> str:
        """Resume o sistema em execução para a barra de estado.

        Os valores são medidos no arranque (não são estimativas) e o texto é
        traduzível; os marcadores `{}` devem ser preservados na tradução.
        """
        logical_cpu_count = psutil.cpu_count(logical=True) or 1
        total_ram_gb = round(psutil.virtual_memory().total / (1024**3), 1)
        python_version = f"{sys.version_info.major}.{sys.version_info.minor}"
        return self.tr(
            "SO: {system} {release} | Python {python_version} | CPU: {cores} núcleos | RAM: {ram} GB"
        ).format(
            system=platform.system(),
            release=platform.release(),
            python_version=python_version,
            cores=logical_cpu_count,
            ram=total_ram_gb,
        )

    # --------------------------------------------------------------- eventos

    def _on_navigation_changed(self, view_id: int) -> None:
        """Muda a vista ativa quando o utilizador clica na barra lateral.

        Args:
            view_id: índice da vista (igual ao `view_id` da entrada de navegação).
        """
        self.view_stack.setCurrentIndex(view_id)

    def _on_language_index_changed(self, selector_index: int) -> None:
        """Comunica a intenção de mudança de idioma (a aplicação é quem aplica).

        Args:
            selector_index: índice escolhido no seletor de idiomas.
        """
        requested_language = self.language_selector.itemData(selector_index)
        if requested_language is None:
            logger.warning("Seletor de idiomas sem código associado no índice %d.", selector_index)
            return
        self.language_change_requested.emit(str(requested_language))

    def closeEvent(self, event: QCloseEvent | None) -> None:
        """Notifica o orquestrador antes de fechar a janela.

        A libertação de memória partilhada e a paragem de processos filhos são
        responsabilidade do orquestrador, que é dono desses recursos.

        Args:
            event: evento de fecho do Qt.
        """
        logger.info("Pedido de fecho da janela principal recebido.")
        self.closing.emit()
        super().closeEvent(event)
