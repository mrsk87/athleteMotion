"""Módulo de Estimativa de Torque Articular Inverso (Net Joint Moments - NJM) e Carga Patelofemoral.

Cruza a cinemática angular do joelho e anca com a potência em Watts e cadência em RPM
(fornecidas por sensores de potência BLE ou estimadas) para calcular:
- Torque efetivo instantâneo no pedaleiro;
- Momento extensor líquido do joelho (Net Joint Moment);
- Força compressiva na articulação patelofemoral (F_PF);
- Tensão patelofemoral (MPa) e índice de risco de sobrecarga articular anterior.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import StrEnum


class JointStressRisk(StrEnum):
    """Nível de risco de sobrecarga articular na articulação patelofemoral."""

    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"


@dataclass(frozen=True)
class PatellofemoralLoadSample:
    """Amostra de carga e esforço articular num instante do ciclo de pedalada."""

    crank_angle_deg: float  # [0..360]
    knee_flexion_deg: float  # Flexão anatómica (0° = reto, 90° = dobrado)
    cadence_rpm: float
    power_watts: float
    pedal_force_tangential_n: float  # Força tangencial propulsiva no pedal (N)
    knee_extensor_moment_nm: float  # Momento extensor do joelho (N·m)
    quadriceps_force_n: float  # Força estimada no tendão quadricipital (N)
    patellofemoral_compressive_force_n: float  # Força compressiva patelar (N)
    patellofemoral_stress_mpa: float  # Pressão de contacto patelofemoral (MPa)
    risk_level: JointStressRisk


@dataclass(frozen=True)
class PatellofemoralCycleSummary:
    """Resumo estatístico da carga articular ao longo de uma revolução completa."""

    peak_compressive_force_n: float  # Força compressiva máxima (N)
    peak_stress_mpa: float  # Pressão máxima patelofemoral (MPa)
    peak_force_crank_angle_deg: float  # Ângulo do pedivela onde ocorre o pico (típico: 70°-90°)
    mean_downstroke_force_n: float  # Força média na fase de impulsão (1h-5h)
    risk_level: JointStressRisk
    saddle_height_correlation_note_pt: str
    saddle_height_correlation_note_en: str
    recommendation_pt: str
    recommendation_en: str
    samples: list[PatellofemoralLoadSample] = field(default_factory=list)


class JointTorqueEstimator:
    """Estimador de dinâmica inversa 2D e cargas articulares em ciclismo."""

    def __init__(
        self,
        rider_weight_kg: float = 75.0,
        crank_length_mm: float = 172.5,
    ) -> None:
        """Inicializa o estimador de carga patelofemoral.

        Args:
            rider_weight_kg: Massa corporal do ciclista em quilogramas.
            crank_length_mm: Comprimento da biela/crenque em milímetros.
        """
        self.rider_weight_kg = max(40.0, min(150.0, rider_weight_kg))
        self.crank_length_m = crank_length_mm / 1000.0

    def compute_instantaneous_sample(
        self,
        knee_extension_angle_deg: float,
        crank_angle_deg: float,
        cadence_rpm: float,
        power_watts: float,
    ) -> PatellofemoralLoadSample:
        """Calcula a carga patelofemoral instantânea num ponto do ciclo.

        Args:
            knee_extension_angle_deg: Ângulo de extensão do joelho (180° = esticado).
            crank_angle_deg: Posição do crenque (0° = 12h, 90° = 3h, 180° = 6h BDC).
            cadence_rpm: Cadência em rotações por minuto.
            power_watts: Potência mecânica gerada em Watts.

        Returns:
            PatellofemoralLoadSample com forças, momentos e nível de risco.
        """
        crank_deg = crank_angle_deg % 360.0
        cadence = max(30.0, min(160.0, cadence_rpm))
        power = max(10.0, power_watts)

        # 1. Velocidade angular do pedaleiro
        omega = cadence * (2.0 * math.pi / 60.0)  # rad/s

        # 2. Torque médio total
        torque_avg = power / max(omega, 1e-3)  # N·m

        # 3. Modelação da curva instantânea de torque em função do ângulo do pedivela
        # Na fase de descida (20° a 150°), o torque atinge um pico de ~1.8x o torque médio aos 85°
        if 15.0 <= crank_deg <= 165.0:
            phase_rad = math.radians((crank_deg - 15.0) * (180.0 / 150.0))
            torque_profile = math.sin(phase_rad) ** 1.2
            torque_instant = torque_avg * (0.2 + 1.65 * torque_profile)
        else:
            # Fase passiva de subida / recuperação (7h-11h)
            torque_instant = torque_avg * 0.12

        # 4. Força tangencial propulsiva exercida no pedal
        pedal_tangential_n = torque_instant / max(self.crank_length_m, 1e-3)

        # 5. Flexão anatómica do joelho (0° = perna reta, 90° = ângulo reto)
        # Conforme convenção ADR 006: knee_extension_angle_deg tem 180° perfeitamente reto
        knee_flexion_deg = max(0.0, min(140.0, 180.0 - knee_extension_angle_deg))
        knee_flexion_rad = math.radians(knee_flexion_deg)

        # 6. Braço de alavanca do momento extensor do joelho (Winter 2D kinematics)
        # No pico de força (3h), o joelho está à frente do pedal ou alinhado (KOPS)
        # O braço de momento do vetor de força do pedal ao joelho varia entre 0.08m e 0.16m
        knee_moment_arm_m = 0.08 + 0.07 * math.sin(knee_flexion_rad)
        knee_extensor_moment_nm = pedal_tangential_n * knee_moment_arm_m

        # 7. Braço de alavanca do tendão patelar face ao centro de rotação femoral (Buff et al.)
        # Varia entre 0.042m (em extensão total) e 0.052m (a 60°-90° de flexão)
        patellar_tendon_moment_arm_m = 0.043 + 0.009 * math.sin(knee_flexion_rad)

        # 8. Força de tração no quadricípete / tendão quadricipital
        quadriceps_force_n = knee_extensor_moment_nm / max(patellar_tendon_moment_arm_m, 1e-3)

        # 9. Força compressiva da patela contra a tróclea femoral (Huberti & Hayes):
        # F_PF = 2 * F_quad * sin(flexion / 2)
        patellofemoral_force_n = (
            2.0 * quadriceps_force_n * math.sin(knee_flexion_rad / 2.0)
        )

        # 10. Área de contacto patelofemoral em mm² (Huberti & Hayes 1984):
        # Aumenta de ~220 mm² a 20° de flexão para ~460 mm² aos 90°
        contact_area_mm2 = 200.0 + 280.0 * math.sin(min(math.pi / 2.0, knee_flexion_rad))
        contact_area_m2 = contact_area_mm2 * 1e-6

        # 11. Pressão / Tensão patelofemoral em Megapascais (MPa = N / mm²)
        stress_mpa = (patellofemoral_force_n / max(contact_area_m2, 1e-5)) / 1e6

        # Avaliação de gravidade clínica (Ericson & Nisell, Bini & Hume)
        if stress_mpa > 3.6 or patellofemoral_force_n > 1500.0:
            risk = JointStressRisk.HIGH
        elif stress_mpa > 2.4 or patellofemoral_force_n > 1000.0:
            risk = JointStressRisk.MODERATE
        else:
            risk = JointStressRisk.LOW

        return PatellofemoralLoadSample(
            crank_angle_deg=round(crank_deg, 1),
            knee_flexion_deg=round(knee_flexion_deg, 1),
            cadence_rpm=round(cadence, 1),
            power_watts=round(power, 1),
            pedal_force_tangential_n=round(pedal_tangential_n, 1),
            knee_extensor_moment_nm=round(knee_extensor_moment_nm, 1),
            quadriceps_force_n=round(quadriceps_force_n, 1),
            patellofemoral_compressive_force_n=round(patellofemoral_force_n, 1),
            patellofemoral_stress_mpa=round(stress_mpa, 2),
            risk_level=risk,
        )

    def analyze_cycle_revolution(
        self,
        knee_extension_angles_100_points: list[float],
        cadence_rpm: float,
        power_watts: float,
    ) -> PatellofemoralCycleSummary:
        """Avalia a evolução completa da carga patelar ao longo de uma revolução pedaleira.

        Args:
            knee_extension_angles_100_points: 100 pontos da curva angular do joelho de 0° a 360°.
            cadence_rpm: Cadência média da sessão em RPM.
            power_watts: Potência média da sessão em Watts.

        Returns:
            PatellofemoralCycleSummary com picos de força, pressão articular e recomendações clínicas.
        """
        samples: list[PatellofemoralLoadSample] = []
        n_pts = len(knee_extension_angles_100_points)
        step_deg = 360.0 / max(n_pts, 1)

        for i, knee_ext in enumerate(knee_extension_angles_100_points):
            crank_deg = i * step_deg
            sample = self.compute_instantaneous_sample(
                knee_extension_angle_deg=knee_ext,
                crank_angle_deg=crank_deg,
                cadence_rpm=cadence_rpm,
                power_watts=power_watts,
            )
            samples.append(sample)

        # Determinar pico de força e pressão
        peak_sample = max(samples, key=lambda s: s.patellofemoral_compressive_force_n)
        peak_force = peak_sample.patellofemoral_compressive_force_n
        peak_stress = peak_sample.patellofemoral_stress_mpa
        peak_angle = peak_sample.crank_angle_deg

        # Força média na fase de impulsão (30° a 150°)
        downstroke_samples = [s for s in samples if 30.0 <= s.crank_angle_deg <= 150.0]
        mean_downstroke_force = (
            sum(s.patellofemoral_compressive_force_n for s in downstroke_samples)
            / max(len(downstroke_samples), 1)
        )

        overall_risk = peak_sample.risk_level

        # Diagnóstico clínico correlacionado com ajuste de selim
        if overall_risk == JointStressRisk.HIGH:
            note_pt = (
                f"Pico de compressão patelofemoral severo ({peak_force:.0f} N / {peak_stress:.1f} MPa) "
                f"detetado aos {peak_angle:.0f}° do ciclo pedaleiro. "
                "Fortemente correlacionado com flexão excessiva do joelho resultante de selim baixo."
            )
            note_en = (
                f"Severe patellofemoral compressive peak ({peak_force:.0f} N / {peak_stress:.1f} MPa) "
                f"detected at {peak_angle:.0f}° of crank rotation. "
                "Strongly correlated with excessive knee flexion from a low saddle."
            )
            rec_pt = (
                "Recomenda-se elevar o selim entre 6mm e 10mm e verificar o recuo (setback) para reduzir "
                "o braço de momento sobre a patela, prevenindo condromalácia e tendinopatia patelar."
            )
            rec_en = (
                "Raising saddle by 6-10mm and reviewing setback is recommended to reduce patellar "
                "lever arm and prevent chondromalacia and patellar tendinopathy."
            )
        elif overall_risk == JointStressRisk.MODERATE:
            note_pt = (
                f"Carga patelofemoral moderada ({peak_force:.0f} N / {peak_stress:.1f} MPa). "
                "Valores toleráveis, mas com potencial sobrecarga por selim baixo ou cadência baixa."
            )
            note_en = (
                f"Moderate patellofemoral load ({peak_force:.0f} N / {peak_stress:.1f} MPa). "
                "Tolerable for trained cyclists, but potential strain from slightly low saddle or low cadence."
            )
            rec_pt = (
                "Recomenda-se elevar o selim entre 2mm e 5mm ou adotar cadências de pedalada ligeiramente "
                "mais elevadas (>85 RPM) para diminuir a força de reação por pedalada mantendo os mesmos Watts."
            )
            rec_en = (
                "Consider minor saddle elevation (2-4mm) or higher cadence (>85 RPM) to reduce peak "
                "pedal reaction force while preserving target power output."
            )
        else:
            note_pt = (
                f"Carga patelofemoral ótima ({peak_force:.0f} N / {peak_stress:.1f} MPa). "
                "A extensão do joelho distribui harmoniosamente as forças compressivas na tróclea femoral."
            )
            note_en = (
                f"Optimal patellofemoral load ({peak_force:.0f} N / {peak_stress:.1f} MPa). "
                "Knee extension harmoniously distributes compressive forces across the femoral trochlea."
            )
            rec_pt = "Manter o posicionamento vertical e horizontal do selim nesta configuração."
            rec_en = "Maintain current vertical and horizontal saddle setup."

        return PatellofemoralCycleSummary(
            peak_compressive_force_n=round(peak_force, 1),
            peak_stress_mpa=round(peak_stress, 2),
            peak_force_crank_angle_deg=round(peak_angle, 1),
            mean_downstroke_force_n=round(mean_downstroke_force, 1),
            risk_level=overall_risk,
            saddle_height_correlation_note_pt=note_pt,
            saddle_height_correlation_note_en=note_en,
            recommendation_pt=rec_pt,
            recommendation_en=rec_en,
            samples=samples,
        )

