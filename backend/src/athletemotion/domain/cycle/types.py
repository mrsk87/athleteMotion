"""Tipos e estruturas de dados de domínio puro para deteção de ciclos de pedalada (BikeFit).

Sem qualquer dependência de frameworks Web (FastAPI) ou ORM (SQLAlchemy).
Utiliza exclusivamente dataclasses padrão de Python e tipagem estrita.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True)
class CycleParams:
    """Parâmetros e limiares de configuração para o algoritmo de deteção de ciclos."""

    min_rpm: float = 30.0
    max_rpm: float = 140.0
    target_fps: float = 60.0
    max_gap_interpolation_ms: float = 150.0
    sg_window_length: int = 11  # Deve ser ímpar para Savitzky-Golay
    sg_polyorder: int = 3
    butter_cutoff_hz: float = 5.0
    butter_order: int = 2
    bdc_refine_window_ms: float = 80.0
    min_rom_deg: float = 35.0  # Amplitude articular mínima do joelho
    max_duration_deviation_pct: float = 0.35  # Variação máxima de duração face à mediana (35%)
    min_visibility: float = 0.5  # Visibilidade média mínima para aceitação do ciclo
    min_valid_cycles: int = 5  # Número mínimo de ciclos válidos para diagnóstico oficial


@dataclass(frozen=True)
class PedalingSample:
    """Amostra instantânea de cinemática e marcos esqueléticos num instante t."""

    frame_index: int
    timestamp_ms: float
    ankle_y: float
    ankle_x: float = 0.0
    knee_angle: float | None = None
    hip_y: float = 0.0
    hip_angle: float | None = None
    ankle_angle: float | None = None
    torso_angle: float | None = None
    arm_angle: float | None = None
    visibility: float = 1.0


@dataclass(frozen=True)
class CycleEvent:
    """Evento biomecânico identificado no ciclo de pedalada (BDC ou TDC)."""

    event_type: Literal["BDC", "TDC"]
    frame_index: int
    timestamp_ms: float
    knee_angle: float
    ankle_y: float
    confidence: float = 1.0


@dataclass
class CycleMetrics:
    """Métricas biométricas e mecânicas extraídas de uma revolução pedaleira completa."""

    cycle_index: int
    start_time_ms: float
    end_time_ms: float
    duration_ms: float
    cadence_rpm: float

    # Eventos temporais
    bdc_event: CycleEvent
    tdc_event: CycleEvent

    # Ângulos articulares no ciclo
    knee_bdc: float  # Ângulo no Ponto Morto Inferior (máxima extensão)
    knee_tdc: float  # Ângulo no Ponto Morto Superior (máxima flexão)
    knee_rom: float  # Range of Motion (bdc - tdc)
    hip_tdc: float | None = None
    ankle_rom: float | None = None
    torso_mean: float | None = None
    elbow_mean: float | None = None

    # Qualidade e integridade
    visibility_mean: float = 1.0
    valid: bool = True
    reject_reasons: list[str] = field(default_factory=list)


@dataclass
class SessionCycleSummary:
    """Agregação estatística de ciclos válidos de uma sessão de BikeFit."""

    total_cycles_detected: int
    valid_cycles_count: int
    rejected_cycles_count: int

    # Cadência (RPM)
    cadence_rpm_mean: float
    cadence_rpm_std: float

    # Ângulo do Joelho no BDC (Graus)
    knee_bdc_mean: float
    knee_bdc_median: float
    knee_bdc_std: float

    # Ângulo do Joelho no TDC (Graus)
    knee_tdc_mean: float
    knee_tdc_median: float
    knee_tdc_std: float

    # Amplitude articular (ROM)
    knee_rom_mean: float

    # Métricas complementares opcionais
    torso_mean: float | None = None
    elbow_mean: float | None = None
    ankle_rom_mean: float | None = None

    # Classificação e proveniência dos dados
    source: Literal["cycle_detection", "manual_snapshots"] = "cycle_detection"
    periodicity_confidence: float = 1.0
    outliers_count: int = 0
