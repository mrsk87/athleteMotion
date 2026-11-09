"""Testes unitários determinísticos para o módulo de Bike CAD."""

from __future__ import annotations

import pytest

from athletemotion.domain.calculator import Point2D
from athletemotion.domain.calibration.bike_cad import BikeCadAnalyzer, BikeLandmarks2D
from athletemotion.domain.calibration.types import CalibrationMethod, ScaleCalibration


@pytest.fixture
def scale_1000px_is_1000mm() -> ScaleCalibration:
    """Escala de teste calibrada exatamente a 1.0 mm por pixel."""
    return ScaleCalibration(
        mm_per_px=1.0,
        method=CalibrationMethod.ARUCO,
        uncertainty_mm_per_px=0.01,
        plane_roll_deg=0.0,
        plane_yaw_deg=0.0,
    )


def test_bike_cad_orthogonal_geometry(scale_1000px_is_1000mm: ScaleCalibration):
    """Verifica o cálculo de Stack, Reach, Altura do Selim e Drop num quadro sintético padrão."""
    analyzer = BikeCadAnalyzer(scale_1000px_is_1000mm)

    # Coordenadas em píxeis (Y cresce para baixo):
    # BB em (500, 800)
    # Saddle Center em (300, 200) -> dy = 600px, dx = 200px -> hypot = sqrt(600^2 + 200^2) ≈ 632.4 mm
    # Saddle Nose em (350, 200) -> setback = 500 - 350 = 150 mm
    # Bar Clamp em (900, 260) -> stack = abs(800 - 260) = 540 mm, reach = 900 - 500 = 400 mm
    # Saddle Drop -> bar.y - s_center.y = 260 - 200 = 60 mm (selim 60mm mais alto que o guiador)
    landmarks = BikeLandmarks2D(
        bottom_bracket=Point2D(x=500.0, y=800.0),
        saddle_nose=Point2D(x=350.0, y=200.0),
        saddle_center=Point2D(x=300.0, y=200.0),
        handlebar_clamp=Point2D(x=900.0, y=260.0),
        hood_peak=Point2D(x=970.0, y=240.0),
        front_axle=Point2D(x=1100.0, y=750.0),
        rear_axle=Point2D(x=100.0, y=750.0),
    )

    report = analyzer.analyze(landmarks, facing_direction="right")

    assert report.stack.value_mm == 540.0
    assert report.reach.value_mm == 400.0
    assert report.saddle_setback.value_mm == 150.0
    assert report.saddle_to_bar_drop.value_mm == 60.0
    assert abs(report.saddle_height.value_mm - 632.5) <= 0.5
    assert report.wheelbase is not None
    assert report.wheelbase.value_mm == 1000.0  # 1100 - 100 = 1000
    assert report.confidence_score >= 0.90

