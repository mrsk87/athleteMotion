"""Módulo de estimativa anatómica e geométrica de pés (calcâneo e biqueira).

Quando o modelo de pose não deteta pontos dos pés (ex.: YOLOv11 COCO-17 ou
MediaPipe com oclusão/baixa confiança no pé), este módulo sintetiza o calcâneo
(heel) e a biqueira (toe) proporcionais ao comprimento real da tíbia em píxeis.

Fundamentação Biomecânica:
- Proporções antropométricas de Winter, D. A. (2009). 'Biomechanics and Motor Control
  of Human Movement', 4th ed., John Wiley & Sons: o comprimento do pé é aproximadamente
  50% a 55% do comprimento da tíbia (segmento perna/tíbia-fíbula).
- Centro articular do tornozelo (maléolo lateral): localiza-se a aproximadamente
  30% do calcâneo e 70% da ponta anterior do pé (toe).
- Escala invariante: ao utilizar `tibia_px`, as coordenadas sintetizadas escalam
  perfeitamente com a distância do atleta à câmara, evitando variações artificiais
  no ângulo do tornozelo.
"""

from __future__ import annotations

import math
from collections.abc import Mapping

import numpy as np
from athletemotion.domain.inference.types import Landmark2D

# Proporção canónica pé / tíbia segundo tabelas antropométricas de Winter (2009)
DEFAULT_FOOT_TO_TIBIA_RATIO: float = 0.50
# Distribuição do centro articular do maléolo lateral em relação ao comprimento total do pé
ANKLE_TO_HEEL_RATIO: float = 0.30
ANKLE_TO_TOE_RATIO: float = 0.70
# Deslocamento vertical relativo ao comprimento do pé (plano sagital com ligeira flexão plantar)
HEEL_DROP_RATIO: float = 0.10
TOE_DROP_RATIO: float = 0.16


def determine_facing_direction(
    landmarks: Mapping[str, Landmark2D], side: str = "right"
) -> bool:
    """Determina se o ciclista está virado para a direita (True) ou esquerda (False).

    Analisa a orientação relativa do ombro em relação à anca ou do nariz/orelha.
    """
    for prefix in (f"{side}_", "", "left_", "right_"):
        sh_key = f"{prefix}shoulder" if prefix else "shoulder"
        hip_key = f"{prefix}hip" if prefix else "hip"
        if sh_key in landmarks and hip_key in landmarks:
            sh = landmarks[sh_key]
            hip = landmarks[hip_key]
            if sh.visibility >= 0.20 and hip.visibility >= 0.20:
                return sh.x >= hip.x

    # Fallback por cabeça/nariz
    nose = landmarks.get("nose")
    ear = landmarks.get(f"{side}_ear") or landmarks.get("ear")
    if (
        nose is not None
        and ear is not None
        and nose.visibility >= 0.20
        and ear.visibility >= 0.20
    ):
        return nose.x >= ear.x

    return side == "right"


def estimate_foot(
    ankle: Landmark2D,
    knee: Landmark2D | None,
    facing_right: bool,
    tibia_px: float,
    w: int,
    h: int,
    foot_ratio: float = DEFAULT_FOOT_TO_TIBIA_RATIO,
) -> dict[str, Landmark2D]:
    """Estima calcâneo (heel) e biqueira (toe) a partir do tornozelo e da escala da tíbia.

    Regras de integridade:
    1. Marca obrigatoriamente `estimated=True`.
    2. Define `visibility = ankle.visibility * 0.5` para refletir incerteza métrica.
    3. As coordenadas são rigorosamente escaladas pelo comprimento da tíbia em píxeis.

    Args:
        ankle: Ponto do tornozelo (âncora).
        knee: Ponto do joelho (opcional, usado para inferir comprimento se tibia_px <= 0).
        facing_right: Direção sagital do ciclista.
        tibia_px: Comprimento da tíbia em píxeis.
        w: Largura da imagem em píxeis.
        h: Altura da imagem em píxeis.
        foot_ratio: Razão entre comprimento do pé e comprimento da tíbia (padrão 0.50).

    Returns:
        Dicionário com chaves 'heel' e 'toe'.
    """
    width = float(max(1, w))
    height = float(max(1, h))

    # Se tibia_px for nulo ou inválido, tenta derivar do joelho e tornozelo
    if tibia_px <= 0.0 and knee is not None:
        dx_px = (ankle.x - knee.x) * width
        dy_px = (ankle.y - knee.y) * height
        tibia_px = math.hypot(dx_px, dy_px)

    # Se ainda assim não houver referência de escala, usa fallback conservador de 15% da altura
    if tibia_px <= 0.0:
        tibia_px = height * 0.25

    foot_length_px = tibia_px * float(foot_ratio)
    direction_sign = 1.0 if facing_right else -1.0

    # Deslocamentos em píxeis no plano da imagem
    dx_toe_px = direction_sign * (ANKLE_TO_TOE_RATIO * foot_length_px)
    dy_toe_px = TOE_DROP_RATIO * foot_length_px

    dx_heel_px = -direction_sign * (ANKLE_TO_HEEL_RATIO * foot_length_px)
    dy_heel_px = HEEL_DROP_RATIO * foot_length_px

    # Ponto do tornozelo em píxeis
    ankle_px_x = ankle.x * width
    ankle_px_y = ankle.y * height

    # Coordenadas normalizadas dos pontos sintetizados
    heel_norm_x = float(np.clip((ankle_px_x + dx_heel_px) / width, 0.0, 1.0))
    heel_norm_y = float(np.clip((ankle_px_y + dy_heel_px) / height, 0.0, 1.0))

    toe_norm_x = float(np.clip((ankle_px_x + dx_toe_px) / width, 0.0, 1.0))
    toe_norm_y = float(np.clip((ankle_px_y + dy_toe_px) / height, 0.0, 1.0))

    synth_visibility = float(np.clip(ankle.visibility * 0.5, 0.0, 1.0))

    heel = Landmark2D(
        x=heel_norm_x,
        y=heel_norm_y,
        z=ankle.z,
        visibility=synth_visibility,
        estimated=True,
    )

    toe = Landmark2D(
        x=toe_norm_x,
        y=toe_norm_y,
        z=ankle.z,
        visibility=synth_visibility,
        estimated=True,
    )

    return {"heel": heel, "toe": toe}
