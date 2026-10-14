"""Definições de tipos, estruturas e avisos biométricos de calibração espacial."""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class CalibrationMethod(StrEnum):
    """Método utilizado para estabelecer a conversão métrica de pixels para milímetros."""

    ARUCO = "aruco"
    CRANK = "crank"
    WHEEL = "wheel"
    MANUAL = "manual"


class WarningSeverity(StrEnum):
    """Gravidade do aviso de alinhamento ou qualidade da calibração."""

    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


@dataclass(frozen=True)
class CalibrationWarning:
    """Aviso estruturado bilingue sobre desalinhamento ou baixa fidelidade de calibração."""

    code: str
    severity: WarningSeverity
    message_pt: str
    message_en: str
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ScaleCalibration:
    """Resultado da calibração de escala dimensional (pixels -> mm) com incerteza estrita."""

    mm_per_px: float
    method: CalibrationMethod
    uncertainty_mm_per_px: float
    plane_roll_deg: float = 0.0
    plane_yaw_deg: float = 0.0
    valid_until: datetime.datetime | None = None
    source_frame_hash: str | None = None
    warnings: list[CalibrationWarning] = field(default_factory=list)

    @property
    def is_perpendicular(self) -> bool:
        """Indica se a câmara está suficientemente paralela ao plano sagital de movimento."""
        return abs(self.plane_roll_deg) <= 3.0 and abs(self.plane_yaw_deg) <= 8.0

    def to_mm(self, px_distance: float) -> tuple[float, float]:
        """Converte uma distância em pixels para milímetros com propagação de incerteza."""
        val_mm = px_distance * self.mm_per_px
        # Incerteza absoluta: sqrt((px * d_mm)^2 + (mm_per_px * d_px)^2) assumindo d_px ≈ 0.5 px
        sigma_px = 0.5
        unc_mm = float(
            ((px_distance * self.uncertainty_mm_per_px) ** 2 + (self.mm_per_px * sigma_px) ** 2)
            ** 0.5
        )
        return val_mm, unc_mm

    def px_to_mm(self, px_distance: float) -> float:
        """Converte uma distância em pixels para milímetros."""
        return px_distance * self.mm_per_px

    def uncertainty_mm(self, px_distance: float) -> float:
        """Calcula a incerteza absoluta em milímetros para uma dada distância em pixels."""
        return self.to_mm(px_distance)[1]


@dataclass(frozen=True)
class LensProfile:
    """Perfil intrínseco de calibração de lente (OpenCV pinhole model com distorção radial/tangencial)."""

    camera_id: str
    resolution: tuple[int, int]  # (largura, altura)
    camera_matrix: list[list[float]]  # Matriz intrínseca 3x3
    dist_coeffs: list[float]  # Coeficientes [k1, k2, p1, p2, k3]
    rms_error_px: float
    created_at: datetime.datetime = field(
        default_factory=lambda: datetime.datetime.now(datetime.UTC)
    )

    def is_valid(self) -> bool:
        """Verifica se o perfil cumpre os limites de tolerância de erro de reprojeção."""
        return self.rms_error_px < 0.5
