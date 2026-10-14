"""Definição do layout anatómico de 26 pontos Halpe26 e mapeamento para BikeFit.

O formato Halpe26 estende o COCO-17 incorporando articulações axiais (cabeça, pescoço,
pelve) e, fundamentalmente para o BikeFit, os pontos anatómicos reais do pé:
- Calcanhar (heel)
- Hálux / primeiro metatarso (big_toe)
- Quinto metatarso / bordo lateral (small_toe)

Elimina a necessidade de estimar heurística ou artificialmente o calcanhar e a biqueira,
permitindo a medição precisa do ângulo do tornozelo (dorsiflexão/plantarflexão) e recuo do cleat.
"""

from __future__ import annotations

from typing import Final

HALPE26_KEYPOINTS: Final[list[str]] = [
    "nose",  # 0
    "left_eye",  # 1
    "right_eye",  # 2
    "left_ear",  # 3
    "right_ear",  # 4
    "left_shoulder",  # 5
    "right_shoulder",  # 6
    "left_elbow",  # 7
    "right_elbow",  # 8
    "left_wrist",  # 9
    "right_wrist",  # 10
    "left_hip",  # 11
    "right_hip",  # 12
    "left_knee",  # 13
    "right_knee",  # 14
    "left_ankle",  # 15
    "right_ankle",  # 16
    "head",  # 17
    "neck",  # 18
    "hip",  # 19 (centro pélvico)
    "left_big_toe",  # 20
    "right_big_toe",  # 21
    "left_small_toe",  # 22
    "right_small_toe",  # 23
    "left_heel",  # 24
    "right_heel",  # 25
]

HALPE26_NAME_TO_INDEX: Final[dict[str, int]] = {
    name: idx for idx, name in enumerate(HALPE26_KEYPOINTS)
}

# Pares anatómicos de simetria bilateral (esquerda <-> direita)
HALPE26_SYMMETRY_PAIRS: Final[list[tuple[int, int]]] = [
    (1, 2),  # left_eye, right_eye
    (3, 4),  # left_ear, right_ear
    (5, 6),  # left_shoulder, right_shoulder
    (7, 8),  # left_elbow, right_elbow
    (9, 10),  # left_wrist, right_wrist
    (11, 12),  # left_hip, right_hip
    (13, 14),  # left_knee, right_knee
    (15, 16),  # left_ankle, right_ankle
    (20, 21),  # left_big_toe, right_big_toe
    (22, 23),  # left_small_toe, right_small_toe
    (24, 25),  # left_heel, right_heel
]

# Esqueleto para renderização e integridade cinemática
HALPE26_SKELETON: Final[list[tuple[int, int]]] = [
    (17, 18),  # head -> neck
    (18, 0),  # neck -> nose
    (0, 1),
    (0, 2),  # nose -> eyes
    (1, 3),
    (2, 4),  # eyes -> ears
    (18, 5),
    (18, 6),  # neck -> shoulders
    (5, 7),
    (7, 9),  # left arm
    (6, 8),
    (8, 10),  # right arm
    (18, 19),  # neck -> hip (spine)
    (19, 11),
    (19, 12),  # hip center -> hips
    (11, 13),
    (13, 15),  # left leg
    (15, 24),  # left ankle -> left heel
    (15, 20),  # left ankle -> left big toe
    (20, 22),  # left big toe -> left small toe
    (12, 14),
    (14, 16),  # right leg
    (16, 25),  # right ankle -> right heel
    (16, 21),  # right ankle -> right big toe
    (21, 23),  # right big toe -> right small toe
]


def get_side_indices(side: str = "right") -> dict[str, int]:
    """Retorna os índices das principais articulações de BikeFit para o lado observado.

    Args:
        side: "left" ou "right".

    Returns:
        Mapeamento chave padrão -> índice Halpe26.
    """
    prefix = "left_" if side.lower() == "left" else "right_"
    return {
        "shoulder": HALPE26_NAME_TO_INDEX[f"{prefix}shoulder"],
        "elbow": HALPE26_NAME_TO_INDEX[f"{prefix}elbow"],
        "wrist": HALPE26_NAME_TO_INDEX[f"{prefix}wrist"],
        "hip": HALPE26_NAME_TO_INDEX[f"{prefix}hip"],
        "knee": HALPE26_NAME_TO_INDEX[f"{prefix}knee"],
        "ankle": HALPE26_NAME_TO_INDEX[f"{prefix}ankle"],
        "heel": HALPE26_NAME_TO_INDEX[f"{prefix}heel"],
        "toe": HALPE26_NAME_TO_INDEX[f"{prefix}big_toe"],
        "small_toe": HALPE26_NAME_TO_INDEX[f"{prefix}small_toe"],
    }
