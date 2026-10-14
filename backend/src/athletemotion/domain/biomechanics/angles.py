"""Módulo de cálculo angular biomecânico em coordenadas de píxeis.

Garante que todos os cálculos trigonométricos ocorrem no espaço métrico da imagem
(multiplicando as coordenadas normalizadas pela largura e altura reais), evitando
distorções provocadas por resoluções não isotrópicas (ex.: 16:9, 1920x1080).
"""

from __future__ import annotations

import math
from collections.abc import Mapping

from athletemotion.domain.calculator import Point2D, calculate_safe_angle
from athletemotion.domain.inference.types import BiomechanicalAngles, Landmark2D


def to_pixels(landmarks: Mapping[str, Landmark2D], w: int, h: int) -> dict[str, Point2D]:
    """Converte um mapa de marcos normalizados [0, 1] para pontos 2D em píxeis.

    Args:
        landmarks: Dicionário de marcos anatómicos com coordenadas x, y normalizadas.
        w: Largura da imagem em píxeis.
        h: Altura da imagem em píxeis.

    Returns:
        Dicionário com os mesmos nomes mapeados para instâncias Point2D com coordenadas em píxeis.
    """
    width = float(w)
    height = float(h)
    return {name: Point2D(x=lm.x * width, y=lm.y * height) for name, lm in landmarks.items()}


def compute_joint_angles(
    landmarks: Mapping[str, Landmark2D],
    w: int,
    h: int,
    min_visibility: float = 0.20,
) -> BiomechanicalAngles:
    """Calcula os ângulos articulares biomecânicos principais no plano sagital em píxeis.

    Regras de integridade:
    1. Coordenadas são obrigatoriamente projetadas em píxeis antes da trigonometria.
    2. Se qualquer marco necessário para uma articulação estiver em falta ou possuir
       visibilidade inferior a `min_visibility`, o ângulo correspondente é devolvido
       como None (nunca 0.0 nem valores inventados).

    Args:
        landmarks: Mapa de marcos corporais disponíveis.
        w: Largura do fotograma em píxeis.
        h: Altura do fotograma em píxeis.
        min_visibility: Limiar mínimo de confiança/visibilidade para aceitar o ponto.

    Returns:
        BiomechanicalAngles com os ângulos calculados ou None quando indisponíveis.
    """
    pts = to_pixels(landmarks, w, h)

    def is_visible(*names: str) -> bool:
        """Verifica se todos os pontos existem e superam a visibilidade mínima."""
        for n in names:
            lm = landmarks.get(n)
            if lm is None or lm.visibility < min_visibility:
                return False
        return True

    knee_angle: float | None = None
    if is_visible("hip", "knee", "ankle"):
        knee_angle = round(
            calculate_safe_angle(pts["hip"], pts["knee"], pts["ankle"]),
            1,
        )

    torso_angle: float | None = None
    if is_visible("shoulder", "hip"):
        dx = abs(pts["shoulder"].x - pts["hip"].x)
        dy = pts["hip"].y - pts["shoulder"].y  # hip tem y maior (mais abaixo) que shoulder
        if dx > 0.0:
            torso_angle = round(math.degrees(math.atan2(abs(dy), dx)), 1)
        else:
            torso_angle = 90.0

    arm_elbow_angle: float | None = None
    if is_visible("shoulder", "elbow", "wrist"):
        arm_elbow_angle = round(
            calculate_safe_angle(pts["shoulder"], pts["elbow"], pts["wrist"]),
            1,
        )

    ankle_angle: float | None = None
    if is_visible("knee", "ankle", "toe"):
        ankle_angle = round(
            calculate_safe_angle(pts["knee"], pts["ankle"], pts["toe"]),
            1,
        )

    shoulder_angle: float | None = None
    if is_visible("elbow", "shoulder", "hip"):
        shoulder_angle = round(
            calculate_safe_angle(pts["elbow"], pts["shoulder"], pts["hip"]),
            1,
        )

    return BiomechanicalAngles(
        knee=knee_angle,
        torso=torso_angle,
        arm_elbow=arm_elbow_angle,
        shoulder=shoulder_angle,
        ankle=ankle_angle,
    )


def segment_lengths_px(
    landmarks: Mapping[str, Landmark2D],
    w: int,
    h: int,
    min_visibility: float = 0.20,
) -> dict[str, float]:
    """Calcula os comprimentos euclidianos dos segmentos corporais em píxeis.

    Args:
        landmarks: Mapa de marcos corporais.
        w: Largura do fotograma em píxeis.
        h: Altura do fotograma em píxeis.
        min_visibility: Limiar de visibilidade para validação dos pontos extremos.

    Returns:
        Dicionário com as distâncias euclidianas em píxeis para cada segmento válido.
    """
    pts = to_pixels(landmarks, w, h)
    lengths: dict[str, float] = {}

    segments = {
        "femur": ("hip", "knee"),
        "tibia": ("knee", "ankle"),
        "torso": ("hip", "shoulder"),
        "upper_arm": ("shoulder", "elbow"),
        "forearm": ("elbow", "wrist"),
    }

    # Segmento do pé: prioridade (heel, toe), fallback (ankle, toe)
    if "heel" in landmarks and "toe" in landmarks:
        segments["foot"] = ("heel", "toe")
    elif "ankle" in landmarks and "toe" in landmarks:
        segments["foot"] = ("ankle", "toe")

    for seg_name, (p1_name, p2_name) in segments.items():
        lm1 = landmarks.get(p1_name)
        lm2 = landmarks.get(p2_name)
        if lm1 is None or lm2 is None:
            continue
        if lm1.visibility < min_visibility or lm2.visibility < min_visibility:
            continue

        p1 = pts[p1_name]
        p2 = pts[p2_name]
        dist = math.hypot(p1.x - p2.x, p1.y - p2.y)
        lengths[seg_name] = round(dist, 2)

    return lengths
