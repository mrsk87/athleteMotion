"""Testes unitários das medidas biomecânicas no plano frontal."""

from __future__ import annotations

import pytest

from athletemotion.domain.calibration.types import CalibrationMethod, ScaleCalibration
from athletemotion.domain.measures.frontal import (
    calculate_knee_frontal_deviation_px,
    calculate_lateral_sway,
    calculate_pelvic_drop,
)


@pytest.fixture
def calibrated_scale() -> ScaleCalibration:
    return ScaleCalibration(
        mm_per_px=1.5,
        method=CalibrationMethod.ARUCO,
        uncertainty_mm_per_px=0.015,
    )


def test_pelvic_drop_stable() -> None:
    """Oscilação pélvica de 1° deve ser classificada como estável."""
    left_hips = [(100.0, 200.0), (100.0, 201.0), (100.0, 199.0)]
    right_hips = [(200.0, 200.0), (200.0, 200.0), (200.0, 200.0)]

    rep = calculate_pelvic_drop(left_hips, right_hips)
    assert rep.is_stable
    assert rep.peak_to_peak_deg <= 2.5
    assert "Estável" in rep.status_label_pt


def test_pelvic_drop_excessive() -> None:
    """Oscilação pélvica de 4° indica instabilidade / selim alto."""
    # Com dy variando entre -6 e +6 num dx de 100 px: atan(6/100) ~ 3.4° -> p2p ~ 6.8°
    left_hips = [(100.0, 194.0), (100.0, 206.0)]
    right_hips = [(200.0, 200.0), (200.0, 200.0)]

    rep = calculate_pelvic_drop(left_hips, right_hips, stability_threshold_deg=2.5)
    assert not rep.is_stable
    assert rep.peak_to_peak_deg > 2.5
    assert "Excessiva" in rep.status_label_pt
    assert "baixar o selim" in rep.recommendation_pt


def test_lateral_sway_with_and_without_calibration(calibrated_scale: ScaleCalibration) -> None:
    """Verifica oscilação lateral com escala métrica e retenção sem escala."""
    xs = [150.0, 155.0, 148.0, 160.0, 152.0]  # ptp = 12 px

    # Com calibração (1.5 mm/px) -> 18.0 mm
    rep = calculate_lateral_sway(xs, calibrated_scale)
    assert not rep.withheld
    assert rep.sway_mm == 18.0

    # Sem calibração -> withheld
    rep_none = calculate_lateral_sway(xs, None)
    assert rep_none.withheld is True
    assert rep_none.sway_mm is None


def test_knee_frontal_deviation_calculation() -> None:
    """Verifica cálculo do desvio do joelho face ao eixo anca-tornozelo."""
    # Anca em (100, 100), Tornozelo em (100, 500) -> eixo perfeitamente vertical em X=100
    # Joelho a meio da perna Y=300:
    # Se joelho está em X=110, desviou +10 px para fora/dentro
    hip = (100.0, 100.0)
    knee = (110.0, 300.0)
    ankle = (100.0, 500.0)

    dev = calculate_knee_frontal_deviation_px(hip, knee, ankle)
    assert dev == 10.0
