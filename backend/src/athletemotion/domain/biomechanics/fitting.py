"""Fórmulas antropométricas teóricas de ajuste de bicicleta (LeMond, Hamley 109%, etc.)."""
from __future__ import annotations

from .thresholds import RidingStyle


def calculate_lemond_saddle_height(inseam_cm: float) -> float:
    """Fórmula clássica de Greg LeMond para altura do selim.

    Medida do centro do eixo pedaleiro até o topo do selim ao longo do tubo do selim.
    Fórmula: Cavalo (cm) * 0.883
    """
    return round(inseam_cm * 0.883, 1)


def calculate_109_saddle_height(inseam_cm: float) -> float:
    """Método de Hamley & Thomas (109%).

    Medida do eixo do pedal no ponto mais baixo até o topo do selim.
    Fórmula: Cavalo (cm) * 1.09
    """
    return round(inseam_cm * 1.09, 1)


def estimate_frame_size(height_cm: float, inseam_cm: float, modality: RidingStyle) -> float:
    """Estima o tamanho recomendado do quadro de bicicleta em centímetros."""
    if modality in (RidingStyle.ROAD, RidingStyle.GRAVEL):
        # Método tradicional de estrada: Cavalo * 0.665
        return round(inseam_cm * 0.665, 1)
    elif modality == RidingStyle.MTB:
        # MTB normalmente em polegadas ou cm menor: (Cavalo * 0.226) polegadas -> cm
        return round(inseam_cm * 0.58, 1)
    else:
        # Triatlo / TT ligeiramente menor que estrada para aerodinâmica
        return round(inseam_cm * 0.65, 1)


def recommend_crank_length(inseam_cm: float) -> float:
    """Recomenda o comprimento da biela/crenque em milímetros com base no cavalo."""
    if inseam_cm < 74.0:
        return 165.0
    elif inseam_cm <= 81.0:
        return 170.0
    elif inseam_cm <= 86.0:
        return 172.5
    else:
        return 175.0


def recommend_handlebar_width(
    shoulder_width_cm: float | None,
    height_cm: float,
    modality: RidingStyle,
) -> float:
    """Recomenda a largura ideal do guiador em milímetros."""
    base_shoulder = shoulder_width_cm if shoulder_width_cm and shoulder_width_cm > 20 else (height_cm * 0.235)

    if modality == RidingStyle.ROAD:
        if base_shoulder < 39.0:
            return 380.0
        elif base_shoulder <= 41.5:
            return 400.0
        elif base_shoulder <= 44.0:
            return 420.0
        else:
            return 440.0
    elif modality == RidingStyle.GRAVEL:
        return 440.0 if base_shoulder > 41.0 else 420.0
    elif modality == RidingStyle.MTB:
        return 760.0 if height_cm > 175.0 else 720.0
    else:
        return 400.0
