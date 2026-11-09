"""Simulador cinemático virtual de ajustes de posicionamento (Digital Twin).

Calcula a cinemática direta 2D do sistema ciclista-bicicleta no plano sagital
a partir das dimensões antropométricas e dos pontos de contacto mecânicos
(selim, pedaleiro e guiador).

Permite aos fitters simular previamente o impacto de alterações de componentes
(altura de selim, recuo, avanço e espaçadores de guiador) antes da intervenção física,
com verificação determinística de limites articulares e fatores de risco de lesão.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from athletemotion.domain.calculator import Point2D


class KinematicRiskLevel(StrEnum):
    """Nível de risco clínico da simulação cinemática."""

    OPTIMAL = "optimal"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass(frozen=True)
class AnthropometricProfile:
    """Medidas dos segmentos ósseos do ciclista em milímetros."""

    femur_length_mm: float
    tibia_length_mm: float
    trunk_length_mm: float
    arm_length_mm: float
    forearm_length_mm: float
    foot_length_mm: float = 260.0
    pelvic_width_mm: float = 140.0


@dataclass(frozen=True)
class BikeGeometryBaseline:
    """Configuração geométrica de referência dos pontos de contacto (em mm)."""

    saddle_height_mm: float  # Distância do centro do BB ao topo do selim
    saddle_setback_mm: float  # Recuo da ponta do selim atrás do eixo do BB (positivo)
    seat_tube_angle_deg: float = 73.5  # Ângulo do tubo de selim face à horizontal
    handlebar_stack_mm: float = 560.0  # Altura vertical do aperto do guiador face ao BB
    handlebar_reach_mm: float = 385.0  # Distância horizontal do aperto à frente do BB
    crank_length_mm: float = 172.5  # Comprimento da biela


@dataclass(frozen=True)
class AdjustmentDeltas:
    """Ajustes propostos em milímetros face à geometria de referência."""

    delta_saddle_height_mm: float = 0.0  # Positivo = subir selim, negativo = descer
    delta_saddle_setback_mm: float = 0.0  # Positivo = recuar selim, negativo = avançar
    delta_stem_stack_mm: float = 0.0  # Positivo = adicionar espaçadores / elevar avanço
    delta_stem_reach_mm: float = 0.0  # Positivo = alongar avanço, negativo = encurtar
    delta_crank_length_mm: float = 0.0  # Variação no comprimento da biela


@dataclass(frozen=True)
class KinematicRiskWarning:
    """Alerta clínico ou biomecânico gerado pela simulação."""

    code: str
    severity: KinematicRiskLevel
    joint: str
    message_pt: str
    message_en: str
    measured_value: float
    threshold_value: float


@dataclass(frozen=True)
class SimulatedPostureSnapshot:
    """Postura corporal prevista para uma determinada fase da pedalada."""

    crank_phase: str  # 'BDC' (6h), 'TDC' (12h), 'POWER_3H' (3h)
    crank_angle_deg: float
    hip_point: Point2D
    knee_point: Point2D
    ankle_point: Point2D
    pedal_point: Point2D
    shoulder_point: Point2D
    elbow_point: Point2D
    hand_point: Point2D
    knee_angle_deg: float
    hip_angle_deg: float
    torso_angle_deg: float
    elbow_angle_deg: float
    shoulder_angle_deg: float


@dataclass(frozen=True)
class SimulationResult:
    """Resultado completo da simulação cinemática comparando baseline com proposta."""

    baseline_knee_bdc_deg: float
    simulated_knee_bdc_deg: float
    delta_knee_bdc_deg: float

    baseline_hip_tdc_deg: float
    simulated_hip_tdc_deg: float
    delta_hip_tdc_deg: float

    baseline_torso_deg: float
    simulated_torso_deg: float
    delta_torso_deg: float

    baseline_elbow_deg: float
    simulated_elbow_deg: float
    delta_elbow_deg: float

    kops_offset_3h_mm: float  # Posição do joelho face ao eixo do pedal às 3h (+ = avançado)

    bdc_posture: SimulatedPostureSnapshot
    tdc_posture: SimulatedPostureSnapshot
    power_3h_posture: SimulatedPostureSnapshot

    warnings: list[KinematicRiskWarning] = field(default_factory=list)
    is_anatomically_feasible: bool = True
    summary_pt: str = ""
    summary_en: str = ""


class KinematicSimulator:
    """Motor matemático de cinemática direta e previsão postural de BikeFit."""

    def __init__(
        self,
        anthropometry: AnthropometricProfile,
        baseline_geometry: BikeGeometryBaseline,
    ) -> None:
        """Inicializa o simulador com medidas antropométricas e geometria da bicicleta.

        Args:
            anthropometry: Medidas corporais do atleta.
            baseline_geometry: Dimensões de contacto da bicicleta de referência.
        """
        self.anthro = anthropometry
        self.baseline = baseline_geometry

    def simulate(self, adjustments: AdjustmentDeltas) -> SimulationResult:
        """Executa a simulação cinemática completa com os ajustes fornecidos.

        Args:
            adjustments: Variações de selim, guiador e crenques a testar.

        Returns:
            SimulationResult com ângulos previstos, esqueletos simulados e alertas ergonómicos.
        """
        # 1. Geometria de Referência e Geometria Ajustada
        base_postures = self._compute_postures(self.baseline, AdjustmentDeltas())
        adj_postures = self._compute_postures(self.baseline, adjustments)

        base_bdc = base_postures["BDC"]
        base_tdc = base_postures["TDC"]
        adj_bdc = adj_postures["BDC"]
        adj_tdc = adj_postures["TDC"]
        adj_3h = adj_postures["POWER_3H"]

        delta_knee_bdc = round(adj_bdc.knee_angle_deg - base_bdc.knee_angle_deg, 1)
        delta_hip_tdc = round(adj_tdc.hip_angle_deg - base_tdc.hip_angle_deg, 1)
        delta_torso = round(adj_bdc.torso_angle_deg - base_bdc.torso_angle_deg, 1)
        delta_elbow = round(adj_bdc.elbow_angle_deg - base_bdc.elbow_angle_deg, 1)

        # 2. Avaliação de KOPS às 3h (deslocamento horizontal joelho - pedal)
        kops_offset_mm = round(adj_3h.knee_point.x - adj_3h.pedal_point.x, 1)

        # 3. Portões de Risco Biomecânico e Limites Clínicos
        warnings: list[KinematicRiskWarning] = []
        is_feasible = True

        # Risco de hiperextensão do joelho (BDC > 155°)
        if adj_bdc.knee_angle_deg > 155.0:
            severity = (
                KinematicRiskLevel.CRITICAL
                if adj_bdc.knee_angle_deg > 160.0
                else KinematicRiskLevel.WARNING
            )
            warnings.append(
                KinematicRiskWarning(
                    code="KNEE_HYPEREXTENSION_RISK",
                    severity=severity,
                    joint="knee",
                    message_pt=(
                        f"Extensão excessiva do joelho a {adj_bdc.knee_angle_deg}° no Ponto Morto Inferior. "
                        "Risco elevado de tendinite no tendão do bíceps femoral e sobrecarga poplítea."
                    ),
                    message_en=(
                        f"Excessive knee extension at {adj_bdc.knee_angle_deg}° at Bottom Dead Center. "
                        "High risk of biceps femoris tendon strain and posterior knee pain."
                    ),
                    measured_value=adj_bdc.knee_angle_deg,
                    threshold_value=155.0,
                )
            )
            if adj_bdc.knee_angle_deg >= 170.0:
                is_feasible = False

        # Risco de flexão excessiva / sobrecarga patelofemoral (BDC < 140°)
        elif adj_bdc.knee_angle_deg < 140.0:
            warnings.append(
                KinematicRiskWarning(
                    code="PATELLOFEMORAL_COMPRESSION_RISK",
                    severity=KinematicRiskLevel.WARNING,
                    joint="knee",
                    message_pt=(
                        f"Extensão do joelho insuficiente ({adj_bdc.knee_angle_deg}°). "
                        "Selim excessivamente baixo aumenta a força de compressão patelofemoral anterior."
                    ),
                    message_en=(
                        f"Insufficient knee extension ({adj_bdc.knee_angle_deg}°). "
                        "Low saddle height increases anterior patellofemoral compressive force."
                    ),
                    measured_value=adj_bdc.knee_angle_deg,
                    threshold_value=140.0,
                )
            )

        # Risco de pinçamento de anca / restrição respiratória no TDC (Hip TDC < 45°)
        if adj_tdc.hip_angle_deg < 45.0:
            warnings.append(
                KinematicRiskWarning(
                    code="HIP_IMPINGEMENT_RISK",
                    severity=KinematicRiskLevel.WARNING,
                    joint="hip",
                    message_pt=(
                        f"Ângulo de anca fechado em {adj_tdc.hip_angle_deg}° no topo do curso (TDC). "
                        "Risco de impacto femoroacetabular anterior e restrição do diafragma."
                    ),
                    message_en=(
                        f"Acute hip angle of {adj_tdc.hip_angle_deg}° at Top Dead Center. "
                        "Risk of anterior femoroacetabular impingement and diaphragmatic restriction."
                    ),
                    measured_value=adj_tdc.hip_angle_deg,
                    threshold_value=45.0,
                )
            )

        # Risco de sobrecarga lombar por inclinação excessiva (Torso < 35°)
        if adj_bdc.torso_angle_deg < 35.0:
            warnings.append(
                KinematicRiskWarning(
                    code="LUMBAR_HYPERFLEXION_RISK",
                    severity=KinematicRiskLevel.WARNING,
                    joint="trunk",
                    message_pt=(
                        f"Inclinação do tronco muito agressiva ({adj_bdc.torso_angle_deg}°). "
                        "Exige flexibilidade isquiotibial elevada e sobrecarrega a coluna lombar."
                    ),
                    message_en=(
                        f"Aggressive torso inclination ({adj_bdc.torso_angle_deg}°). "
                        "Requires high hamstring flexibility and increases lumbar spine stress."
                    ),
                    measured_value=adj_bdc.torso_angle_deg,
                    threshold_value=35.0,
                )
            )

        # Risco de hiperextensão dos braços / cockpit longo (Elbow > 165°)
        if adj_bdc.elbow_angle_deg > 165.0:
            warnings.append(
                KinematicRiskWarning(
                    code="ARM_LOCKOUT_RISK",
                    severity=KinematicRiskLevel.WARNING,
                    joint="elbow",
                    message_pt=(
                        f"Cotovelos em extensão quase total ({adj_bdc.elbow_angle_deg}°). "
                        "Cockpit excessivamente longo reduz a absorção de vibrações e sobrecarrega os trapézios."
                    ),
                    message_en=(
                        f"Near total elbow extension ({adj_bdc.elbow_angle_deg}°). "
                        "Cockpit reach is too long, reducing shock absorption and straining upper trapezius."
                    ),
                    measured_value=adj_bdc.elbow_angle_deg,
                    threshold_value=165.0,
                )
            )

        # 4. Síntese textual do impacto do ajuste
        saddle_change = adjustments.delta_saddle_height_mm
        setback_change = adjustments.delta_saddle_setback_mm
        reach_change = adjustments.delta_stem_reach_mm

        summary_parts_pt: list[str] = []
        if abs(saddle_change) > 0.5:
            verb = "Elevação" if saddle_change > 0 else "Descida"
            summary_parts_pt.append(
                f"{verb} do selim em {abs(saddle_change):.0f}mm resulta numa variação de {delta_knee_bdc:+.1f}° no joelho BDC."
            )
        if abs(setback_change) > 0.5:
            verb = "Recuo" if setback_change > 0 else "Avanço"
            summary_parts_pt.append(
                f"{verb} do selim em {abs(setback_change):.0f}mm altera o offset KOPS para {kops_offset_mm:+.1f}mm."
            )
        if abs(reach_change) > 0.5:
            verb = "Alongamento" if reach_change > 0 else "Encurtamento"
            summary_parts_pt.append(
                f"{verb} do avanço em {abs(reach_change):.0f}mm altera a flexão do cotovelo para {adj_bdc.elbow_angle_deg:.1f}°."
            )

        summary_pt = (
            " ".join(summary_parts_pt)
            if summary_parts_pt
            else "Sem alterações de posição face à referência."
        )
        summary_en = f"Simulated posture: Knee BDC at {adj_bdc.knee_angle_deg:.1f}°, Torso at {adj_bdc.torso_angle_deg:.1f}°, KOPS at {kops_offset_mm:+.1f}mm."

        return SimulationResult(
            baseline_knee_bdc_deg=round(base_bdc.knee_angle_deg, 1),
            simulated_knee_bdc_deg=round(adj_bdc.knee_angle_deg, 1),
            delta_knee_bdc_deg=delta_knee_bdc,
            baseline_hip_tdc_deg=round(base_tdc.hip_angle_deg, 1),
            simulated_hip_tdc_deg=round(adj_tdc.hip_angle_deg, 1),
            delta_hip_tdc_deg=delta_hip_tdc,
            baseline_torso_deg=round(base_bdc.torso_angle_deg, 1),
            simulated_torso_deg=round(adj_bdc.torso_angle_deg, 1),
            delta_torso_deg=delta_torso,
            baseline_elbow_deg=round(base_bdc.elbow_angle_deg, 1),
            simulated_elbow_deg=round(adj_bdc.elbow_angle_deg, 1),
            delta_elbow_deg=delta_elbow,
            kops_offset_3h_mm=kops_offset_mm,
            bdc_posture=adj_bdc,
            tdc_posture=adj_tdc,
            power_3h_posture=adj_3h,
            warnings=warnings,
            is_anatomically_feasible=is_feasible,
            summary_pt=summary_pt,
            summary_en=summary_en,
        )

    def _compute_postures(
        self,
        base_geo: BikeGeometryBaseline,
        deltas: AdjustmentDeltas,
    ) -> dict[str, SimulatedPostureSnapshot]:
        """Calcula as coordenadas dos pontos anatómicos para as três fases principais."""
        crank_len = base_geo.crank_length_mm + deltas.delta_crank_length_mm
        total_saddle_height = base_geo.saddle_height_mm + deltas.delta_saddle_height_mm
        total_setback = base_geo.saddle_setback_mm + deltas.delta_saddle_setback_mm

        # Convenção cartesiana com origem (0, 0) no centro do Bottom Bracket (BB)
        # X: positivo para a frente (direção da roda dianteira), negativo para trás
        # Y: positivo para cima, negativo para baixo
        seat_angle_rad = math.radians(base_geo.seat_tube_angle_deg)

        # Posição do centro do selim
        # O selim recua ao longo do ângulo do tubo ou via ajuste manual nos carris
        saddle_x = -total_setback
        saddle_y = total_saddle_height * math.sin(seat_angle_rad)

        # Articulação da anca (trocânter maior): ligeiramente acima e à frente do ponto de apoio
        hip_x = saddle_x + 25.0
        hip_y = saddle_y + 30.0
        hip_pt = Point2D(x=hip_x, y=hip_y)

        # Posição do aperto do guiador (handlebar clamp)
        bar_x = base_geo.handlebar_reach_mm + deltas.delta_stem_reach_mm
        bar_y = base_geo.handlebar_stack_mm + deltas.delta_stem_stack_mm

        # Ponto de apoio das mãos (hoods / manetes): tipicamente 70mm à frente e 20mm acima do clamp
        hand_pt = Point2D(x=bar_x + 70.0, y=bar_y + 20.0)

        # Na pedalada, o ponto de maior extensão do membro inferior (BDC) ocorre
        # sensivelmente alinhado com o tubo de selim (~253° de ângulo de biela)
        phases = {
            "BDC": (253.5, -crank_len * math.cos(seat_angle_rad), -crank_len * math.sin(seat_angle_rad)),
            "TDC": (73.5, crank_len * math.cos(seat_angle_rad), crank_len * math.sin(seat_angle_rad)),
            "POWER_3H": (0.0, crank_len, 0.0),  # Posição horizontal das 3 horas
        }

        snapshots: dict[str, SimulatedPostureSnapshot] = {}

        for phase_name, (crank_deg, px, py) in phases.items():
            pedal_pt = Point2D(x=px, y=py)

            # Tornozelo (maléolo lateral): apoiado com offset de travessa e sapato
            # O eixo do pedal está sob os metatarsos; o tornozelo situa-se ~65-75mm atrás e ~60-70mm acima
            if phase_name == "BDC":
                ankle_x = pedal_pt.x - 65.0
                ankle_y = pedal_pt.y + 65.0
            elif phase_name == "TDC":
                ankle_x = pedal_pt.x - 75.0
                ankle_y = pedal_pt.y + 55.0
            else:  # 3h
                ankle_x = pedal_pt.x - 70.0
                ankle_y = pedal_pt.y + 60.0
            ankle_pt = Point2D(x=ankle_x, y=ankle_y)

            # Cinemática inversa do membro inferior: resolver joelho dado Hip e Ankle
            knee_pt, knee_angle = self._solve_knee_position(hip_pt, ankle_pt)

            # Cinemática superior: resolver ombro e cotovelo dado Hip e Hand
            shoulder_pt, elbow_pt, torso_angle, elbow_angle, shoulder_angle = (
                self._solve_upper_body(hip_pt, hand_pt)
            )

            # Ângulo da anca (tronco-fémur)
            hip_angle = self._calculate_interior_angle(shoulder_pt, hip_pt, knee_pt)

            snapshots[phase_name] = SimulatedPostureSnapshot(
                crank_phase=phase_name,
                crank_angle_deg=crank_deg,
                hip_point=hip_pt,
                knee_point=knee_pt,
                ankle_point=ankle_pt,
                pedal_point=pedal_pt,
                shoulder_point=shoulder_pt,
                elbow_point=elbow_pt,
                hand_point=hand_pt,
                knee_angle_deg=knee_angle,
                hip_angle_deg=hip_angle,
                torso_angle_deg=torso_angle,
                elbow_angle_deg=elbow_angle,
                shoulder_angle_deg=shoulder_angle,
            )

        return snapshots

    def _solve_knee_position(self, hip: Point2D, ankle: Point2D) -> tuple[Point2D, float]:
        """Calcula a posição 2D do joelho usando a interseção de dois círculos (fémur e tíbia)."""
        l1 = self.anthro.femur_length_mm
        l2 = self.anthro.tibia_length_mm

        dx = ankle.x - hip.x
        dy = ankle.y - hip.y
        d = math.hypot(dx, dy)

        # Salvaguarda: se a distância for maior que a perna totalmente esticada
        if d >= (l1 + l2):
            # Hiperextensão máxima teórica (180°)
            unit_x = dx / max(d, 1e-4)
            unit_y = dy / max(d, 1e-4)
            knee_x = hip.x + unit_x * l1
            knee_y = hip.y + unit_y * l1
            return Point2D(x=knee_x, y=knee_y), 180.0

        # Lei dos Cossenos para o ângulo interno na anca
        cos_alpha = (l1 * l1 + d * d - l2 * l2) / (2.0 * l1 * d)
        cos_alpha = max(-1.0, min(1.0, cos_alpha))
        alpha = math.acos(cos_alpha)

        # Ângulo do vetor Hip -> Ankle
        base_angle = math.atan2(dy, dx)

        # O joelho dobra sempre para a frente da bicicleta (sentido positivo de X)
        knee_angle_rad = base_angle + alpha
        knee_x = hip.x + l1 * math.cos(knee_angle_rad)
        knee_y = hip.y + l1 * math.sin(knee_angle_rad)
        knee_pt = Point2D(x=knee_x, y=knee_y)

        # Ângulo de extensão do joelho (180° = perna reta)
        cos_knee = (l1 * l1 + l2 * l2 - d * d) / (2.0 * l1 * l2)
        cos_knee = max(-1.0, min(1.0, cos_knee))
        extension_deg = round(math.degrees(math.acos(cos_knee)), 1)

        return knee_pt, extension_deg

    def _solve_upper_body(
        self,
        hip: Point2D,
        hand: Point2D,
    ) -> tuple[Point2D, Point2D, float, float, float]:
        """Resolve a posição do ombro e cotovelo unindo anca e guiador."""
        trunk_len = self.anthro.trunk_length_mm
        arm_len = self.anthro.arm_length_mm
        forearm_len = self.anthro.forearm_length_mm

        # 1. Estimar inclinação do tronco orientada ao guiador
        dx_hh = hand.x - hip.x
        dy_hh = hand.y - hip.y
        direct_dist = math.hypot(dx_hh, dy_hh)

        # O ombro posiciona-se no fim do tronco
        # Ângulo do tronco: tipicamente entre 35° e 55° face à horizontal
        target_torso_angle_deg = 45.0
        if direct_dist > 0:
            target_torso_angle_deg = max(
                30.0, min(65.0, math.degrees(math.atan2(abs(dy_hh), max(dx_hh, 1.0))))
            )

        torso_rad = math.radians(target_torso_angle_deg)
        shoulder_x = hip.x + trunk_len * math.cos(torso_rad)
        shoulder_y = hip.y + trunk_len * math.sin(torso_rad)
        shoulder_pt = Point2D(x=shoulder_x, y=shoulder_y)

        # 2. Interseção braço (ombro -> cotovelo) e antebraço (cotovelo -> mão)
        dx_sh = hand.x - shoulder_pt.x
        dy_sh = hand.y - shoulder_pt.y
        arm_reach = math.hypot(dx_sh, dy_sh)

        l_arm = arm_len
        l_fore = forearm_len

        if arm_reach >= (l_arm + l_fore):
            # Braço totalmente esticado
            cos_elbow = -1.0
            elbow_deg = 180.0
            u_x = dx_sh / max(arm_reach, 1e-4)
            u_y = dy_sh / max(arm_reach, 1e-4)
            elbow_pt = Point2D(x=shoulder_pt.x + u_x * l_arm, y=shoulder_pt.y + u_y * l_arm)
        else:
            cos_alpha = (l_arm * l_arm + arm_reach * arm_reach - l_fore * l_fore) / (
                2.0 * l_arm * arm_reach
            )
            cos_alpha = max(-1.0, min(1.0, cos_alpha))
            alpha = math.acos(cos_alpha)
            reach_angle = math.atan2(dy_sh, dx_sh)

            # Cotovelo flete suavemente para baixo
            elbow_rad = reach_angle - alpha
            elbow_x = shoulder_pt.x + l_arm * math.cos(elbow_rad)
            elbow_y = shoulder_pt.y + l_arm * math.sin(elbow_rad)
            elbow_pt = Point2D(x=elbow_x, y=elbow_y)

            cos_elbow = (l_arm * l_arm + l_fore * l_fore - arm_reach * arm_reach) / (
                2.0 * l_arm * l_fore
            )
            cos_elbow = max(-1.0, min(1.0, cos_elbow))
            elbow_deg = round(math.degrees(math.acos(cos_elbow)), 1)

        # Ângulo do ombro (tronco face ao braço)
        shoulder_deg = round(self._calculate_interior_angle(hip, shoulder_pt, elbow_pt), 1)

        return shoulder_pt, elbow_pt, round(target_torso_angle_deg, 1), elbow_deg, shoulder_deg

    @staticmethod
    def _calculate_interior_angle(p1: Point2D, vertex: Point2D, p2: Point2D) -> float:
        """Calcula o ângulo interno em graus no vértice entre os pontos p1 e p2."""
        v1_x = p1.x - vertex.x
        v1_y = p1.y - vertex.y
        v2_x = p2.x - vertex.x
        v2_y = p2.y - vertex.y

        dot = v1_x * v2_x + v1_y * v2_y
        mag1 = math.hypot(v1_x, v1_y)
        mag2 = math.hypot(v2_x, v2_y)

        if mag1 < 1e-4 or mag2 < 1e-4:
            return 0.0

        cos_val = max(-1.0, min(1.0, dot / (mag1 * mag2)))
        return round(math.degrees(math.acos(cos_val)), 1)

