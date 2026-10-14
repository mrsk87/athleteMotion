"""Testes unitários para o mapeamento anatómico Halpe26 e esqueleto de BikeFit."""

from __future__ import annotations

from athletemotion.domain.inference.halpe26 import (
    HALPE26_KEYPOINTS,
    HALPE26_NAME_TO_INDEX,
    HALPE26_SKELETON,
    HALPE26_SYMMETRY_PAIRS,
    get_side_indices,
)


def test_halpe26_integrity_and_uniqueness():
    """Valida que o layout Halpe26 tem exatamente 26 pontos com nomes únicos."""
    assert len(HALPE26_KEYPOINTS) == 26
    assert len(set(HALPE26_KEYPOINTS)) == 26
    assert len(HALPE26_NAME_TO_INDEX) == 26

    for idx, name in enumerate(HALPE26_KEYPOINTS):
        assert HALPE26_NAME_TO_INDEX[name] == idx


def test_halpe26_symmetry_pairs():
    """Valida que todos os 11 pares bilaterais são válidos e simétricos."""
    assert len(HALPE26_SYMMETRY_PAIRS) == 11
    for left_idx, right_idx in HALPE26_SYMMETRY_PAIRS:
        assert 0 <= left_idx < 26
        assert 0 <= right_idx < 26
        left_name = HALPE26_KEYPOINTS[left_idx]
        right_name = HALPE26_KEYPOINTS[right_idx]
        assert left_name.startswith("left_")
        assert right_name.startswith("right_")
        # Radical idêntico
        assert left_name.replace("left_", "") == right_name.replace("right_", "")


def test_halpe26_skeleton_connections():
    """Valida que todas as arestas do esqueleto conectam índices válidos."""
    assert len(HALPE26_SKELETON) > 20
    for p1, p2 in HALPE26_SKELETON:
        assert 0 <= p1 < 26
        assert 0 <= p2 < 26
        assert p1 != p2


def test_halpe26_bikefit_side_mapping():
    """Valida que os mapeamentos laterais (esquerdo e direito) incluem os pontos críticos e pés reais."""
    for side in ("left", "right"):
        mapping = get_side_indices(side)
        required_keys = {"shoulder", "elbow", "wrist", "hip", "knee", "ankle", "heel", "toe", "small_toe"}
        assert required_keys.issubset(mapping.keys())

        for key, idx in mapping.items():
            assert 0 <= idx < 26
            name = HALPE26_KEYPOINTS[idx]
            assert side in name, f"Ponto {key} ({name}) não corresponde ao lado {side}"
