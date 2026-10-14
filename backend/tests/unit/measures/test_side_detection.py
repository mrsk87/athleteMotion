"""Testes unitários de deteção do perfil sagital visível (esquerdo vs direito)."""

from __future__ import annotations

from athletemotion.domain.measures.side_detection import detect_visible_side


def test_detect_visible_side_right() -> None:
    """Perfil direito com marcos direitos em primeiro plano (alta visibilidade)."""
    history = []
    for _ in range(10):
        frame = {
            "right_shoulder": (200.0, 150.0, 0.95),
            "right_hip": (180.0, 300.0, 0.95),
            "right_knee": (210.0, 420.0, 0.95),
            "right_ankle": (190.0, 520.0, 0.95),
            "left_shoulder": (195.0, 152.0, 0.20),
            "left_hip": (175.0, 302.0, 0.20),
            "left_knee": (205.0, 422.0, 0.20),
            "left_ankle": (185.0, 522.0, 0.20),
            "nose": (240.0, 130.0, 0.90),
            "right_ear": (210.0, 125.0, 0.90),
            "left_ear": (205.0, 125.0, 0.15),
        }
        history.append(frame)

    side, conf = detect_visible_side(history)
    assert side == "right"
    assert conf >= 0.70


def test_detect_visible_side_left() -> None:
    """Perfil esquerdo com marcos esquerdos em primeiro plano."""
    history = []
    for _ in range(10):
        frame = {
            "left_shoulder": (200.0, 150.0, 0.95),
            "left_hip": (180.0, 300.0, 0.95),
            "left_knee": (210.0, 420.0, 0.95),
            "left_ankle": (190.0, 520.0, 0.95),
            "right_shoulder": (205.0, 152.0, 0.25),
            "right_hip": (185.0, 302.0, 0.25),
            "right_knee": (215.0, 422.0, 0.25),
            "right_ankle": (195.0, 522.0, 0.25),
            "nose": (160.0, 130.0, 0.90),
            "left_ear": (190.0, 125.0, 0.90),
            "right_ear": (195.0, 125.0, 0.10),
        }
        history.append(frame)

    side, conf = detect_visible_side(history)
    assert side == "left"
    assert conf >= 0.70


def test_detect_visible_side_ambiguous_keeps_default() -> None:
    """Dados ambíguos ou vazios devem reter o lado por defeito com menor confiança."""
    side, conf = detect_visible_side([], default_side="left")
    assert side == "left"
    assert conf <= 0.60
