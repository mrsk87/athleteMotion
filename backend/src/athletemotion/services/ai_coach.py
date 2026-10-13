"""Treinador Biomecânico de IA (AI Biomechanical Coach).

Gera pareceres narrativos de alta precisão técnica em linguagem humana acessível,
explicando a relação de causa-efeito entre as medidas do atleta, os ângulos observados
e o plano de adaptação física neuromuscular nas semanas seguintes ao ajuste.
"""
from __future__ import annotations

from typing import Any


def generate_coaching_narrative(
    athlete_data: dict[str, Any],
    bike_data: dict[str, Any] | None,
    angles_summary: list[dict[str, Any]],
    kops_data: dict[str, Any] | None = None,
    symmetry_data: list[dict[str, Any]] | None = None,
    saddle_drop_data: dict[str, Any] | None = None,
    cadence_rpm: int | None = None,
    power_watts: int | None = None,
    language: str = "pt",
) -> dict[str, Any]:
    """Gera um parecer detalhado estruturado do Treinador Biomecânico em Português ou Inglês."""
    is_pt = language.lower() == "pt"
    name = athlete_data.get("name", "Ciclista" if is_pt else "Rider")
    flexibility = str(athlete_data.get("flexibility", "medium")).lower()
    modality = str(bike_data.get("modality", "road")).lower() if bike_data else "road"

    # Encontrar diagnósticos do joelho e tronco
    knee_diag = next((a for a in angles_summary if "joelho" in str(a.get("name", "")).lower()), None)
    back_diag = next((a for a in angles_summary if "costas" in str(a.get("name", "")).lower() or "tronco" in str(a.get("name", "")).lower()), None)

    knee_angle = knee_diag.get("angle", 148.0) if knee_diag else 148.0
    back_angle = back_diag.get("angle", 45.0) if back_diag else 45.0

    if is_pt:
        # 1. Sumário Executivo
        if knee_angle < 145.0:
            summary = (
                f"Olá {name}! A sua análise postural revelou uma flexão excessiva do joelho ({knee_angle:.1f}° no BDC). "
                f"Isto indica que está a pedalar com o selim mais baixo do que o ideal, transferindo uma sobrecarga desnecessária "
                f"para a cartilagem patelofemoral e limitando a potência de pico."
            )
        elif knee_angle > 155.0:
            summary = (
                f"Olá {name}! A extensão do seu joelho ({knee_angle:.1f}° no BDC) encontra-se no limite superior, provocando "
                f"uma ligeira hiperextensão que forçará a bacia a oscilar nos esforços intensos, sobrecarregando a fáscia plantar."
            )
        else:
            summary = (
                f"Parabéns {name}! A sua extensão de perna no ponto morto inferior ({knee_angle:.1f}°) está perfeitamente alinhada "
                f"com os intervalos ideais da biomecânica de ciclismo moderno (145° - 155°)."
            )

        # 2. Parecer do Cockpit & Tronco
        cockpit_notes = []
        if back_angle < 40.0 and flexibility == "low":
            cockpit_notes.append(
                f"A inclinação do tronco ({back_angle:.1f}°) é muito agressiva para a sua flexibilidade declarada (baixa). "
                f"Isto provocará compressão nos discos L4-L5 e adormecimento nas mãos após 90 minutos de treino."
            )
        elif back_angle > 52.0:
            cockpit_notes.append(
                f"A sua postura está bastante ereta ({back_angle:.1f}°), o que maximiza o conforto respiratório mas aumenta "
                f"o arrasto aerodinâmico em ventos contrários."
            )
        else:
            cockpit_notes.append(
                f"A inclinação lombar ({back_angle:.1f}°) apresenta excelente simetria entre alívio da pressão cervical e eficiência aerodinâmica."
            )

        # 3. Análise KOPS
        kops_advice = ""
        if kops_data and not kops_data.get("is_aligned", True):
            offset = kops_data.get("offset_mm", 0.0)
            if offset > 0:
                kops_advice = f"O seu joelho está {abs(offset):.1f}mm à frente do eixo do pedal. Recuar o selim redistribuirá a carga para os glúteos e isquiotibiais."
            else:
                kops_advice = f"O seu joelho está {abs(offset):.1f}mm atrás do eixo do pedal. Avançar ligeiramente o selim melhorará a cadência em subidas íngremes."

        # 4. Plano de Adaptação (3 Semanas)
        plan = [
            "Semana 1: Realize 2 treinos leves de 45-60 min com cadência alta (85-95 RPM) para habituação neuromuscular sem cargas máximas.",
            "Semana 2: Introduza subidas curtas em ritmo de cruzeiro, prestando atenção à estabilidade da bacia no selim.",
            "Semana 3: Sessão de validação de intensidade ou prova. O corpo deve estar 100% integrado ao novo posicionamento.",
        ]

        title = "Parecer do Treinador Biomecânico de IA"
    else:
        # Inglês
        if knee_angle < 145.0:
            summary = (
                f"Hello {name}! Your posture analysis detected excessive knee flexion ({knee_angle:.1f}° at BDC). "
                f"This indicates your saddle is lower than optimal, placing unnecessary compressive loads on the patellar tendon."
            )
        elif knee_angle > 155.0:
            summary = (
                f"Hello {name}! Your knee extension ({knee_angle:.1f}° at BDC) is near hyperextension, which may cause "
                f"pelvic rocking and hamstring strain over long rides."
            )
        else:
            summary = (
                f"Great job {name}! Your knee extension at bottom dead center ({knee_angle:.1f}°) matches the golden ergonomic range (145° - 155°)."
            )

        cockpit_notes = [
            f"Your torso angle ({back_angle:.1f}°) provides a healthy balance between cervical comfort and aerodynamics."
        ]

        kops_advice = "KOPS balance confirmed."
        if kops_data and not kops_data.get("is_aligned", True):
            kops_advice = f"Fore/aft adjustment recommended: {kops_data.get('actionPt', 'Adjust saddle')}"

        plan = [
            "Week 1: Spin with light resistance (85-95 RPM) for 45-60 min to adapt neuromuscular firing patterns.",
            "Week 2: Incorporate steady endurance efforts, monitoring pelvic stability.",
            "Week 3: Full training intensity. New posture should feel fully natural.",
        ]

        title = "AI Biomechanical Coach Verdict"

    return {
        "title": title,
        "executive_summary": summary,
        "cockpit_analysis": " ".join(cockpit_notes),
        "kops_insight": kops_advice,
        "cadence_power_insight": f"Cadência média: {cadence_rpm or '--'} RPM | Potência: {power_watts or '--'} W" if is_pt else f"Avg Cadence: {cadence_rpm or '--'} RPM | Power: {power_watts or '--'} W",
        "adaptation_plan": plan,
    }

