"""Testes unitários dos limiares biomecânicos, fontes científicas e adaptações ergonómicas."""

from __future__ import annotations

from athletemotion.domain.biomechanics.thresholds import (
    BIOMECHANIC_THRESHOLDS,
    FitGoal,
    InjuryFlag,
    RidingStyle,
    get_adjusted_thresholds,
)


def test_thresholds_have_scientific_sources() -> None:
    """Verifica que todos os estilos possuem fontes científicas ou marcação explícita de unverified."""
    for style, thresholds in BIOMECHANIC_THRESHOLDS.items():
        assert thresholds.knee_source != "", f"Falta fonte para joelho em {style}"
        assert thresholds.torso_source != "", f"Falta fonte para tronco em {style}"
        assert thresholds.elbow_source != "", f"Falta fonte para cotovelo em {style}"
        assert thresholds.shoulder_source != "", f"Falta fonte para ombro em {style}"
        assert thresholds.ankle_source != "", f"Falta fonte para tornozelo em {style}"
        assert thresholds.confidence_level in ("high", "moderate", "empirical")


def test_road_thresholds_scientific_citations() -> None:
    """Valida citações clássicas de Road (Holmes 1994, Bini 2011, Silberman 2005)."""
    road = BIOMECHANIC_THRESHOLDS[RidingStyle.ROAD]
    assert "Holmes et al. (1994)" in road.knee_source
    assert "Bini et al. (2011)" in road.knee_source
    assert road.knee_extension_min == 145.0
    assert road.knee_extension_max == 155.0


def test_gravel_thresholds_marked_empirical() -> None:
    """Gravel deve ser honestamente marcado como empírico/não verificado."""
    gravel = BIOMECHANIC_THRESHOLDS[RidingStyle.GRAVEL]
    assert "empirical/unverified" in gravel.knee_source
    assert gravel.confidence_level == "empirical"


def test_fit_goal_aero_adjustment() -> None:
    """Objetivo Aero deve reduzir a inclinação do tronco e flexionar mais os cotovelos."""
    base = BIOMECHANIC_THRESHOLDS[RidingStyle.ROAD]
    aero = get_adjusted_thresholds(RidingStyle.ROAD, fit_goal=FitGoal.AERO)

    assert aero.torso_inclination_max < base.torso_inclination_max
    assert aero.elbow_flexion_min < base.elbow_flexion_min
    assert aero.fit_goal == FitGoal.AERO


def test_fit_goal_comfort_adjustment() -> None:
    """Objetivo Conforto deve elevar o tronco para reduzir sobrecarga lombar."""
    base = BIOMECHANIC_THRESHOLDS[RidingStyle.ROAD]
    comfort = get_adjusted_thresholds(RidingStyle.ROAD, fit_goal=FitGoal.COMFORT)

    assert comfort.torso_inclination_min > base.torso_inclination_min
    assert comfort.fit_goal == FitGoal.COMFORT


def test_injury_flag_anterior_knee_pain() -> None:
    """Dor anterior no joelho / tendinite patelar deve elevar knee_extension_min para evitar flexão extrema."""
    adjusted = get_adjusted_thresholds(
        RidingStyle.ROAD,
        injury_flags=[InjuryFlag.ANTERIOR_KNEE_PAIN],
    )
    assert adjusted.knee_extension_min >= 147.0
    assert InjuryFlag.ANTERIOR_KNEE_PAIN in adjusted.injury_flags


def test_injury_flag_hamstring_strain() -> None:
    """Estiramento de isquiotibiais deve limitar a extensão máxima para evitar sobre-alongamento."""
    adjusted = get_adjusted_thresholds(
        RidingStyle.ROAD,
        injury_flags=[InjuryFlag.HAMSTRING_STRAIN],
    )
    assert adjusted.knee_extension_max <= 152.0


def test_injury_flag_lower_back_pain() -> None:
    """Dor lombar deve elevar significativamente a inclinação do tronco."""
    base = BIOMECHANIC_THRESHOLDS[RidingStyle.ROAD]
    adjusted = get_adjusted_thresholds(
        RidingStyle.ROAD,
        injury_flags=[InjuryFlag.LOWER_BACK_PAIN],
    )
    assert adjusted.torso_inclination_min > base.torso_inclination_min
    assert adjusted.torso_inclination_max > base.torso_inclination_max
