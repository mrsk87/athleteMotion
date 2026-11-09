"""Testes unitários determinísticos para o Simulador Cinemático Virtual de BikeFit."""

from __future__ import annotations

import pytest

from athletemotion.domain.biomechanics.kinematic_simulator import (
    AdjustmentDeltas,
    AnthropometricProfile,
    BikeGeometryBaseline,
    KinematicSimulator,
)


@pytest.fixture
def default_simulator() -> KinematicSimulator:
    """Fornece uma instância do simulador com proporções humanas médias calibradas."""
    anthro = AnthropometricProfile(
        femur_length_mm=430.0,
        tibia_length_mm=410.0,
        trunk_length_mm=540.0,
        arm_length_mm=320.0,
        forearm_length_mm=260.0,
    )
    baseline = BikeGeometryBaseline(
        saddle_height_mm=700.0,
        saddle_setback_mm=60.0,
        seat_tube_angle_deg=73.5,
        handlebar_stack_mm=560.0,
        handlebar_reach_mm=385.0,
        crank_length_mm=172.5,
    )
    return KinematicSimulator(anthro, baseline)


def test_simulation_zero_deltas_identity(default_simulator: KinematicSimulator):
    """Verifica que simular sem deltas produz variações nulas e ângulos fisiológicos."""
    res = default_simulator.simulate(AdjustmentDeltas())

    assert res.delta_knee_bdc_deg == 0.0
    assert res.delta_hip_tdc_deg == 0.0
    assert res.delta_torso_deg == 0.0
    assert res.delta_elbow_deg == 0.0

    # Ângulo do joelho no BDC deve estar em faixa ergonómica (140° a 155°)
    assert 140.0 <= res.simulated_knee_bdc_deg <= 155.0
    assert res.is_anatomically_feasible is True
    assert "Sem alterações" in res.summary_pt


def test_simulation_saddle_raise_increases_knee_extension(
    default_simulator: KinematicSimulator,
):
    """Subir o selim 15mm deve aumentar a extensão do joelho no BDC de forma determinística."""
    res = default_simulator.simulate(AdjustmentDeltas(delta_saddle_height_mm=15.0))

    assert res.delta_knee_bdc_deg > 0.0
    assert res.simulated_knee_bdc_deg > res.baseline_knee_bdc_deg
    assert "Elevação do selim em 15mm" in res.summary_pt


def test_simulation_saddle_drop_decreases_knee_extension(
    default_simulator: KinematicSimulator,
):
    """Descer o selim 35mm deve reduzir a extensão do joelho e alertar sobrecarga patelar."""
    res = default_simulator.simulate(AdjustmentDeltas(delta_saddle_height_mm=-35.0))

    assert res.delta_knee_bdc_deg < 0.0
    assert res.simulated_knee_bdc_deg < res.baseline_knee_bdc_deg
    # Deve disparar aviso de compressão patelofemoral
    warning_codes = [w.code for w in res.warnings]
    assert "PATELLOFEMORAL_COMPRESSION_RISK" in warning_codes


def test_simulation_excessive_saddle_triggers_hyperextension_warning(
    default_simulator: KinematicSimulator,
):
    """Elevação desproporcionada do selim (+45mm) dispara aviso de hiperextensão."""
    res = default_simulator.simulate(AdjustmentDeltas(delta_saddle_height_mm=45.0))

    assert res.simulated_knee_bdc_deg > 155.0
    warning_codes = [w.code for w in res.warnings]
    assert "KNEE_HYPEREXTENSION_RISK" in warning_codes


def test_simulation_setback_affects_kops(default_simulator: KinematicSimulator):
    """Recuar o selim em 20mm deve recuar a posição do joelho face ao pedal às 3h."""
    res_base = default_simulator.simulate(AdjustmentDeltas())
    res_back = default_simulator.simulate(AdjustmentDeltas(delta_saddle_setback_mm=20.0))

    # Knee X deve recuar (diminuir face ao pedal)
    assert res_back.kops_offset_3h_mm < res_base.kops_offset_3h_mm
