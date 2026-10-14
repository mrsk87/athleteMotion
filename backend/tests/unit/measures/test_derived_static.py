"""Testes unitários das medidas estáticas derivadas (KOPS, Saddle Drop, Reach)."""

from __future__ import annotations

import pytest

from athletemotion.domain.calibration.types import CalibrationMethod, ScaleCalibration
from athletemotion.domain.measures.sagittal import (
    calculate_kops_setback,
    calculate_reach,
    calculate_saddle_to_bar_drop,
)


@pytest.fixture
def calibrated_scale() -> ScaleCalibration:
    # 2.0 mm por pixel com incerteza de 0.02 mm/px
    return ScaleCalibration(
        mm_per_px=2.0,
        method=CalibrationMethod.ARUCO,
        uncertainty_mm_per_px=0.02,
    )


def test_kops_setback_with_calibration(calibrated_scale: ScaleCalibration) -> None:
    """Verifica KOPS com calibração ativa e offset em píxeis."""
    # 10 px de avanço -> 20.0 mm
    res = calculate_kops_setback(
        knee_anterior_x_px=110.0,
        pedal_spindle_x_px=100.0,
        calibration=calibrated_scale,
    )
    assert not res.withheld
    assert res.value_mm == 20.0
    assert res.uncertainty_mm is not None
    assert "Joelho Adiantado" in res.status_label_pt
    assert "Recuar o selim" in res.recommendation_pt


def test_kops_setback_without_calibration() -> None:
    """Sem calibração, o KOPS deve ser retido com value_mm = None."""
    res = calculate_kops_setback(
        knee_anterior_x_px=110.0,
        pedal_spindle_x_px=100.0,
        calibration=None,
    )
    assert res.withheld is True
    assert res.value_mm is None
    assert res.uncertainty_mm is None
    assert "ausente" in (res.reason or "")


def test_saddle_to_bar_drop_with_calibration(calibrated_scale: ScaleCalibration) -> None:
    """Verifica medição de desnível vertical selim-guiador."""
    # Selim em Y=200, Guiador em Y=250 -> 50 px de drop -> 100.0 mm
    res = calculate_saddle_to_bar_drop(
        saddle_ref_y_px=200.0,
        handlebar_ref_y_px=250.0,
        calibration=calibrated_scale,
    )
    assert not res.withheld
    assert res.value_mm == 100.0
    assert res.uncertainty_mm == 1.4


def test_reach_with_calibration(calibrated_scale: ScaleCalibration) -> None:
    """Verifica medição de alcance horizontal (reach)."""
    # Distância horizontal de 250 px -> 500.0 mm
    res = calculate_reach(
        saddle_nose_x_px=100.0,
        handlebar_clamp_x_px=350.0,
        calibration=calibrated_scale,
    )
    assert not res.withheld
    assert res.value_mm == 500.0
    assert res.uncertainty_mm == 5.1
