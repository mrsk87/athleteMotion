"""Testes unitários determinísticos para a estimativa de Torque Articular e Carga Patelofemoral."""

from __future__ import annotations

from athletemotion.domain.measures.joint_torque import JointStressRisk, JointTorqueEstimator


def test_instantaneous_sample_power_phase():
    """Verifica que aos 85° (pico de descida do pedal) o torque e forças compressivas são máximos."""
    estimator = JointTorqueEstimator(rider_weight_kg=75.0, crank_length_mm=172.5)

    sample = estimator.compute_instantaneous_sample(
        knee_extension_angle_deg=120.0,  # 60° de flexão
        crank_angle_deg=85.0,  # Zona de potência máxima
        cadence_rpm=90.0,
        power_watts=250.0,
    )

    assert sample.pedal_force_tangential_n > 100.0
    assert sample.knee_extensor_moment_nm > 15.0
    assert sample.patellofemoral_compressive_force_n > 300.0
    assert sample.patellofemoral_stress_mpa > 0.5


def test_cycle_revolution_low_saddle_triggers_high_compression():
    """Verifica que simular joelho excessivamente flexionado ao longo do ciclo gera alerta de sobrecarga."""
    estimator = JointTorqueEstimator(rider_weight_kg=80.0, crank_length_mm=175.0)

    # Curva angular com flexão severa (extensão não passa de 130°, selim muito baixo)
    angles_100_low_saddle = [125.0 + 10.0 * (i / 100.0) for i in range(100)]

    summary = estimator.analyze_cycle_revolution(
        knee_extension_angles_100_points=angles_100_low_saddle,
        cadence_rpm=75.0,  # Cadência baixa aumenta força por rotação
        power_watts=350.0,  # Alta potência
    )

    assert summary.peak_compressive_force_n > 1000.0
    assert "selim baixo" in summary.saddle_height_correlation_note_pt.lower()
    assert "elevar o selim" in summary.recommendation_pt.lower()


def test_cycle_revolution_optimal_fit():
    """Verifica que ciclista com boa extensão e cadência equilibrada opera em risco moderado/baixo."""
    estimator = JointTorqueEstimator(rider_weight_kg=68.0, crank_length_mm=170.0)

    # Curva angular normal onde o BDC atinge 150°
    angles_100_optimal = [145.0 + 5.0 * (i / 100.0) for i in range(100)]

    summary = estimator.analyze_cycle_revolution(
        knee_extension_angles_100_points=angles_100_optimal,
        cadence_rpm=92.0,
        power_watts=180.0,
    )

    assert summary.risk_level in (JointStressRisk.LOW, JointStressRisk.MODERATE)
    assert len(summary.samples) == 100

