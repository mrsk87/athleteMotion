"""Módulo de Metrologia e Geometria de Bicicleta (Bike CAD sem fita métrica).

Calcula as dimensões fundamentais do quadro e dos pontos de contacto da bicicleta
(Stack, Reach, Altura do Selim, Recuo, Saddle Drop e Distância ao Guiador)
a partir de coordenadas de marcos mecânicos e da calibração métrica espacial (R11).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from athletemotion.domain.calculator import Point2D
from athletemotion.domain.calibration.types import ScaleCalibration


@dataclass(frozen=True)
class BikeLandmarks2D:
    """Marcos geométricos da bicicleta identificados no fotograma em píxeis."""

    bottom_bracket: Point2D  # Centro do eixo pedaleiro (BB)
    saddle_nose: Point2D  # Ponta anterior do selim
    saddle_center: Point2D  # Centro anatómico de suporte do selim (topo)
    handlebar_clamp: Point2D  # Centro do aperto do avanço no guiador
    hood_peak: Point2D | None = None  # Ponto de apoio das mãos nas manetes (hoods)
    front_axle: Point2D | None = None  # Eixo da roda dianteira (opcional)
    rear_axle: Point2D | None = None  # Eixo da roda traseira (opcional)


@dataclass(frozen=True)
class CadMetricValue:
    """Medida de Bike CAD em milímetros com intervalo de incerteza clínica."""

    name: str
    value_mm: float
    uncertainty_mm: float
    is_valid: bool
    status_label_pt: str
    status_label_en: str
    notes: str = ""


@dataclass(frozen=True)
class BikeCadReport:
    """Relatório estruturado de geometria e pontos de contacto Bike CAD."""

    saddle_height: CadMetricValue  # Eixo pedaleiro -> Centro do selim
    saddle_setback: CadMetricValue  # Recuo da ponta do selim atrás do BB (horizontal)
    stack: CadMetricValue  # Desnível vertical BB -> Aperto do guiador
    reach: CadMetricValue  # Alcance horizontal BB -> Aperto do guiador
    saddle_to_bar_drop: CadMetricValue  # Desnível vertical Selim -> Guiador
    saddle_to_bar_distance: CadMetricValue  # Distância direta Selim -> Guiador
    saddle_to_hood_distance: CadMetricValue | None = None  # Distância Selim -> Manetes
    wheelbase: CadMetricValue | None = None  # Distância entre eixos das rodas
    effective_seat_tube_angle_deg: float = 73.5  # Ângulo virtual do tubo de selim
    warnings: list[str] = field(default_factory=list)
    confidence_score: float = 1.0


class BikeCadAnalyzer:
    """Analisador métrico de geometria e pontos de contacto Bike CAD."""

    def __init__(self, scale_calibration: ScaleCalibration) -> None:
        """Inicializa o analisador com a calibração de escala dimensional (mm/px).

        Args:
            scale_calibration: Calibração espacial válida obtida via ArUco, roda ou pedivela.
        """
        self.scale = scale_calibration

    def analyze(
        self,
        landmarks: BikeLandmarks2D,
        facing_direction: str = "right",
    ) -> BikeCadReport:
        """Calcula todas as medidas métricas de Bike CAD com propagação de incerteza.

        Args:
            landmarks: Marcos anatómicos mecânicos da bicicleta em píxeis.
            facing_direction: Sentido da bicicleta na imagem ('right' ou 'left').

        Returns:
            BikeCadReport com todas as grandezas em milímetros e respetivas incertezas.
        """
        warnings: list[str] = []
        is_facing_right = facing_direction.lower() == "right"
        direction_factor = 1.0 if is_facing_right else -1.0

        bb = landmarks.bottom_bracket
        s_nose = landmarks.saddle_nose
        s_center = landmarks.saddle_center
        bar = landmarks.handlebar_clamp

        # 1. Altura do Selim (Saddle Height): distância Euclidiana BB -> Centro do Selim
        dx_sh = s_center.x - bb.x
        dy_sh = s_center.y - bb.y  # Em imagens Y cresce para baixo, mas hypot é invariante
        px_sh = math.hypot(dx_sh, dy_sh)
        val_sh, unc_sh = self.scale.to_mm(px_sh)

        valid_sh = 500.0 <= val_sh <= 950.0
        if not valid_sh:
            warnings.append(
                f"Altura do selim calculada ({val_sh:.1f} mm) fora do intervalo padrão (500-950 mm)."
            )

        metric_sh = CadMetricValue(
            name="saddle_height",
            value_mm=round(val_sh, 1),
            uncertainty_mm=round(unc_sh, 1),
            is_valid=valid_sh,
            status_label_pt="Altura do Selim (BB ao Centro)",
            status_label_en="Saddle Height (BB to Center)",
            notes="Medida direta do centro do eixo pedaleiro ao ponto anatómico central do selim.",
        )

        # 2. Recuo do Selim (Saddle Setback): distância horizontal da ponta do selim atrás do BB
        # Se voltado para a direita: BB à frente da ponta do selim significa bb.x > s_nose.x
        # Logo setback = (bb.x - s_nose.x) * direction_factor
        dx_setback = (bb.x - s_nose.x) * direction_factor
        val_setback, unc_setback = self.scale.to_mm(dx_setback)

        valid_setback = -20.0 <= val_setback <= 150.0
        if not valid_setback:
            warnings.append(
                f"Recuo do selim ({val_setback:.1f} mm) invulgar. Verifique a ponta do selim."
            )

        metric_setback = CadMetricValue(
            name="saddle_setback",
            value_mm=round(val_setback, 1),
            uncertainty_mm=round(unc_setback, 1),
            is_valid=valid_setback,
            status_label_pt="Recuo do Selim (Setback)",
            status_label_en="Saddle Setback",
            notes="Offset horizontal entre a ponta do selim e o plano vertical do eixo pedaleiro.",
        )

        # 3. Stack: desnível vertical entre BB e centro do aperto do guiador
        # Em coordenadas de ecrã Y cresce para baixo: como o guiador está mais alto que o BB, bb.y > bar.y
        dy_stack = abs(bb.y - bar.y)
        val_stack, unc_stack = self.scale.to_mm(dy_stack)

        valid_stack = 420.0 <= val_stack <= 750.0
        if not valid_stack:
            warnings.append(
                f"Stack do quadro/cockpit ({val_stack:.1f} mm) fora do espectro convencional (420-750 mm)."
            )

        metric_stack = CadMetricValue(
            name="stack",
            value_mm=round(val_stack, 1),
            uncertainty_mm=round(unc_stack, 1),
            is_valid=valid_stack,
            status_label_pt="Stack do Cockpit",
            status_label_en="Cockpit Stack",
            notes="Distância vertical do centro do pedaleiro ao aperto do guiador.",
        )

        # 4. Reach: alcance horizontal do BB até ao centro do aperto do guiador
        # Bar à frente do BB: (bar.x - bb.x) * direction_factor
        dx_reach = (bar.x - bb.x) * direction_factor
        val_reach, unc_reach = self.scale.to_mm(dx_reach)

        valid_reach = 300.0 <= val_reach <= 550.0
        if not valid_reach:
            warnings.append(
                f"Reach do quadro/cockpit ({val_reach:.1f} mm) invulgar (esperado 300-550 mm)."
            )

        metric_reach = CadMetricValue(
            name="reach",
            value_mm=round(val_reach, 1),
            uncertainty_mm=round(unc_reach, 1),
            is_valid=valid_reach,
            status_label_pt="Reach do Cockpit",
            status_label_en="Cockpit Reach",
            notes="Distância horizontal do centro do pedaleiro ao centro do aperto do guiador.",
        )

        # 5. Saddle-to-Bar Drop: desnível vertical Selim -> Guiador
        # Selim acima do guiador: s_center.y < bar.y (Y cresce para baixo), logo positivo = selim mais alto
        dy_drop = bar.y - s_center.y
        val_drop, unc_drop = self.scale.to_mm(dy_drop)

        valid_drop = -50.0 <= val_drop <= 200.0

        metric_drop = CadMetricValue(
            name="saddle_to_bar_drop",
            value_mm=round(val_drop, 1),
            uncertainty_mm=round(unc_drop, 1),
            is_valid=valid_drop,
            status_label_pt="Desnível Selim-Guiador (Drop)",
            status_label_en="Saddle-to-Bar Drop",
            notes="Diferença de altura entre o topo do selim e o aperto do guiador (positivo = selim mais alto).",
        )

        # 6. Saddle-to-Bar Distance: distância linear direta Selim -> Guiador
        px_sbar = math.hypot(bar.x - s_center.x, bar.y - s_center.y)
        val_sbar, unc_sbar = self.scale.to_mm(px_sbar)

        metric_sbar = CadMetricValue(
            name="saddle_to_bar_distance",
            value_mm=round(val_sbar, 1),
            uncertainty_mm=round(unc_sbar, 1),
            is_valid=350.0 <= val_sbar <= 800.0,
            status_label_pt="Distância Selim ao Guiador",
            status_label_en="Saddle-to-Bar Distance",
            notes="Comprimento linear do cockpit da ponta/centro do selim ao aperto do guiador.",
        )

        # 7. Saddle-to-Hood (se fornecido hood_peak)
        metric_hood = None
        if landmarks.hood_peak:
            px_hood = math.hypot(
                landmarks.hood_peak.x - s_nose.x, landmarks.hood_peak.y - s_nose.y
            )
            val_hood, unc_hood = self.scale.to_mm(px_hood)
            metric_hood = CadMetricValue(
                name="saddle_to_hood_distance",
                value_mm=round(val_hood, 1),
                uncertainty_mm=round(unc_hood, 1),
                is_valid=450.0 <= val_hood <= 900.0,
                status_label_pt="Distância Selim às Manetes (Hoods)",
                status_label_en="Saddle-to-Hood Reach",
                notes="Distância real da ponta do selim à zona primária de apoio das mãos.",
            )

        # 8. Wheelbase (se eixos de roda fornecidos)
        metric_wheelbase = None
        if landmarks.front_axle and landmarks.rear_axle:
            px_wb = math.hypot(
                landmarks.front_axle.x - landmarks.rear_axle.x,
                landmarks.front_axle.y - landmarks.rear_axle.y,
            )
            val_wb, unc_wb = self.scale.to_mm(px_wb)
            metric_wheelbase = CadMetricValue(
                name="wheelbase",
                value_mm=round(val_wb, 1),
                uncertainty_mm=round(unc_wb, 1),
                is_valid=850.0 <= val_wb <= 1250.0,
                status_label_pt="Distância entre Eixos (Wheelbase)",
                status_label_en="Wheelbase",
                notes="Distância entre o centro dos cubos das rodas dianteira e traseira.",
            )

        # Ângulo virtual do tubo de selim (Seat Tube Angle)
        # Vetor BB -> Saddle Center: dy = vertical, dx = horizontal atrás do BB
        vert_px = abs(s_center.y - bb.y)
        horiz_px = abs(s_center.x - bb.x)
        seat_angle_deg = 73.5
        if horiz_px > 0:
            seat_angle_deg = round(math.degrees(math.atan2(vert_px, horiz_px)), 1)

        # Score composto de confiança com base na calibração de escala e perpendicularidade
        confidence = 1.0
        if not self.scale.is_perpendicular:
            confidence *= 0.85
            warnings.append(
                f"Câmara com inclinação de plano detectada (Roll: {self.scale.plane_roll_deg:.1f}°, Yaw: {self.scale.plane_yaw_deg:.1f}°). Incerteza acrescida."
            )
        if len(warnings) > 0:
            confidence = max(0.5, confidence - len(warnings) * 0.05)

        return BikeCadReport(
            saddle_height=metric_sh,
            saddle_setback=metric_setback,
            stack=metric_stack,
            reach=metric_reach,
            saddle_to_bar_drop=metric_drop,
            saddle_to_bar_distance=metric_sbar,
            saddle_to_hood_distance=metric_hood,
            wheelbase=metric_wheelbase,
            effective_seat_tube_angle_deg=seat_angle_deg,
            warnings=warnings,
            confidence_score=round(confidence, 2),
        )

