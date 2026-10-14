"""Módulo de cálculo matemático de precisão para articulações biomecânicas.

Desenvolvido para ser facilmente compreendido por juniores e completamente
livre de efeitos colaterais (funções puras).
"""

from __future__ import annotations

import math
from typing import NamedTuple


class Point2D(NamedTuple):
    x: float
    y: float


class Point3D(NamedTuple):
    x: float
    y: float
    z: float = 0.0
    visibility: float = 1.0


def calculate_safe_angle(
    a: Point2D | Point3D | tuple[float, float],
    b: Point2D | Point3D | tuple[float, float],
    c: Point2D | Point3D | tuple[float, float],
) -> float:
    """Calcula o ângulo formado pelo vértice B entre os pontos A e C.

    Exemplo: A = Quadril, B = Joelho, C = Tornozelo -> Retorna o ângulo do joelho.

    Regras de Segurança:
    1. Se os pontos forem idênticos (comprimento de vetor zero), retorna 0.0 sem quebrar.
    2. Garante que o produto escalar / magnitudes seja fixado entre [-1.0, 1.0] para
       evitar erros de ponto flutuante que gerem NaN em math.acos().
    3. Retorna o ângulo em graus no intervalo [0.0, 180.0].
    """
    # Extrair coordenadas X e Y
    ax, ay = (a.x, a.y) if isinstance(a, (Point2D, Point3D)) else (a[0], a[1])
    bx, by = (b.x, b.y) if isinstance(b, (Point2D, Point3D)) else (b[0], b[1])
    cx, cy = (c.x, c.y) if isinstance(c, (Point2D, Point3D)) else (c[0], c[1])

    # Vetores BA e BC
    v1_x, v1_y = ax - bx, ay - by
    v2_x, v2_y = cx - bx, cy - by

    # Magnitudes (comprimento dos vetores)
    mag1 = math.hypot(v1_x, v1_y)
    mag2 = math.hypot(v2_x, v2_y)

    # Proteção estrita contra divisão por zero
    if mag1 == 0.0 or mag2 == 0.0:
        return 0.0

    # Produto escalar (Dot product)
    dot = v1_x * v2_x + v1_y * v2_y

    # Cosseno com clamping para evitar NaN por imprecisão float
    cos_val = dot / (mag1 * mag2)
    clamped_cos = max(-1.0, min(1.0, cos_val))

    # Ângulo em graus
    angle_rad = math.acos(clamped_cos)
    return round(math.degrees(angle_rad), 2)


def calculate_inclination_angle(
    bottom: Point2D | Point3D | tuple[float, float],
    top: Point2D | Point3D | tuple[float, float],
) -> float:
    """Calcula a inclinação de um segmento (ex: tronco entre quadril e ombro) em relação à horizontal.

    Retorna o ângulo em graus [0.0, 90.0] onde 0° é totalmente horizontal
    e 90° é totalmente vertical.
    """
    bx, by = (
        (bottom.x, bottom.y) if isinstance(bottom, (Point2D, Point3D)) else (bottom[0], bottom[1])
    )
    tx, ty = (top.x, top.y) if isinstance(top, (Point2D, Point3D)) else (top[0], top[1])

    dx = abs(tx - bx)
    dy = abs(by - ty)  # Coordenada Y em telas cresce para baixo

    mag = math.hypot(dx, dy)
    if mag == 0.0:
        return 0.0

    sin_val = max(0.0, min(1.0, dy / mag))
    angle_rad = math.asin(sin_val)
    return round(math.degrees(angle_rad), 2)
