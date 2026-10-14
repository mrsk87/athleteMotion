"""Testes unitários para o associador temporal de atletas (TargetSelector)."""

from __future__ import annotations

import pytest

from athletemotion.domain.inference.target_selector import (
    DetectionCandidate,
    TargetSelector,
    TargetSelectorConfig,
    compute_iou,
)


def test_compute_iou_scenarios():
    """Valida o cálculo de IoU em sobreposições exatas, parciais e disjuntas."""
    # Caixas idênticas
    box1 = (0.1, 0.1, 0.5, 0.5)
    assert compute_iou(box1, box1) == pytest.approx(1.0)

    # Caixas disjuntas
    box2 = (0.6, 0.6, 0.9, 0.9)
    assert compute_iou(box1, box2) == pytest.approx(0.0)

    # 50% de sobreposição horizontal
    box_a = (0.0, 0.0, 0.4, 0.4)  # Área = 0.16
    box_b = (0.2, 0.0, 0.6, 0.4)  # Área = 0.16, Interseção = 0.2*0.4 = 0.08, União = 0.24
    assert compute_iou(box_a, box_b) == pytest.approx(0.08 / 0.24)


def test_target_selector_locks_on_athlete():
    """Valida que o atleta é bloqueado (lock) após N frames estáveis consecutivos."""
    selector = TargetSelector(TargetSelectorConfig(lock_frames=5))
    assert selector.is_locked is False

    box = (0.3, 0.2, 0.7, 0.9)
    for _frame_idx in range(4):
        cand = DetectionCandidate(box=box, confidence=0.85)
        selected = selector.select_target([cand])
        assert selected is not None
        assert selector.is_locked is False

    # 5º frame: atinge lock_frames
    cand = DetectionCandidate(box=box, confidence=0.85)
    selected = selector.select_target([cand])
    assert selected is not None
    assert selector.is_locked is True


def test_target_selector_rejects_bystander_with_higher_confidence():
    """Cenário multi-pessoa: o atleta em movimento NÃO é trocado por um espectador com maior confiança."""
    selector = TargetSelector(TargetSelectorConfig(lock_frames=3))

    # Estabelece lock no ciclista (posição x: 0.2 -> 0.6)
    athlete_box = (0.2, 0.3, 0.4, 0.8)
    for _ in range(4):
        selected = selector.select_target([DetectionCandidate(box=athlete_box, confidence=0.80)])
        assert selected is not None

    assert selector.is_locked is True

    # Novo frame: o atleta move-se ligeiramente (x: 0.22 -> 0.42), mas surge um espectador com 0.98 de confiança
    athlete_moved = (0.22, 0.31, 0.42, 0.81)
    bystander_box = (0.75, 0.2, 0.95, 0.9)  # Do outro lado da imagem

    cands = [
        DetectionCandidate(box=bystander_box, confidence=0.98, candidate_id=1),  # Espectador com alta confiança
        DetectionCandidate(box=athlete_moved, confidence=0.75, candidate_id=2),  # Atleta com confiança média
    ]

    selected = selector.select_target(cands)
    assert selected is not None
    assert selected.candidate_id == 2, "TargetSelector saltou incorretamente para o espectador!"


def test_target_selector_occlusion_and_recovery():
    """Valida que o lock tolera oclusões temporárias (< max_lost_frames) e recupera."""
    selector = TargetSelector(TargetSelectorConfig(lock_frames=3, max_lost_frames=5))

    athlete_box = (0.3, 0.3, 0.5, 0.8)
    for _ in range(3):
        selector.select_target([DetectionCandidate(box=athlete_box, confidence=0.85)])

    assert selector.is_locked is True

    # Oclusão durante 3 frames (retorna None mantendo o lock)
    for _ in range(3):
        selected = selector.select_target([])
        assert selected is None
        assert selector.is_locked is True

    # Atleta reaparece na vizinhança
    athlete_reappear = (0.32, 0.31, 0.52, 0.81)
    selected = selector.select_target([DetectionCandidate(box=athlete_reappear, confidence=0.82)])
    assert selected is not None
    assert selector.is_locked is True
    assert selector.consecutive_lost_frames == 0
