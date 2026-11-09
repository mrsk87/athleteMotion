"""Testes de integração para os novos endpoints REST de Bike CAD, Simulador Cinemático e Força Patelofemoral."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_simulate_adjustments_endpoint(client: TestClient):
    """Testa o endpoint /biomechanics/simulate-adjustments com elevação de selim."""
    payload = {
        "anthropometry": {
            "femur_length_mm": 430.0,
            "tibia_length_mm": 410.0,
            "trunk_length_mm": 540.0,
            "arm_length_mm": 320.0,
            "forearm_length_mm": 260.0,
            "foot_length_mm": 260.0,
            "pelvic_width_mm": 140.0,
        },
        "baseline_geometry": {
            "saddle_height_mm": 700.0,
            "saddle_setback_mm": 60.0,
            "seat_tube_angle_deg": 73.5,
            "handlebar_stack_mm": 560.0,
            "handlebar_reach_mm": 385.0,
            "crank_length_mm": 172.5,
        },
        "adjustments": {
            "delta_saddle_height_mm": 15.0,
            "delta_saddle_setback_mm": 0.0,
            "delta_stem_stack_mm": 0.0,
            "delta_stem_reach_mm": 0.0,
            "delta_crank_length_mm": 0.0,
        },
    }

    response = client.post("/api/v1/biomechanics/simulate-adjustments", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["delta_knee_bdc_deg"] > 0.0
    assert data["simulated_knee_bdc_deg"] > data["baseline_knee_bdc_deg"]
    assert data["bdc_posture"]["crank_phase"] == "BDC"
    assert "Elevação do selim" in data["summary_pt"]


def test_patellofemoral_stress_endpoint(client: TestClient):
    """Testa o endpoint /biomechanics/patellofemoral-stress com ciclo de 100 pontos."""
    angles = [135.0 + 10.0 * (i / 100.0) for i in range(100)]
    payload = {
        "rider_weight_kg": 75.0,
        "crank_length_mm": 172.5,
        "knee_extension_angles_100_points": angles,
        "cadence_rpm": 85.0,
        "power_watts": 250.0,
    }

    response = client.post("/api/v1/biomechanics/patellofemoral-stress", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["peak_compressive_force_n"] > 500.0
    assert data["peak_stress_mpa"] > 1.0
    assert len(data["samples"]) == 100
    assert "recommendation_pt" in data


def test_bike_cad_endpoint(client: TestClient):
    """Testa o endpoint /calibration/bike-cad com geometria ortogonal conhecida."""
    payload = {
        "landmarks": {
            "bottom_bracket": {"x": 500.0, "y": 700.0},
            "saddle_nose": {"x": 470.0, "y": 350.0},
            "saddle_center": {"x": 440.0, "y": 340.0},
            "handlebar_clamp": {"x": 700.0, "y": 420.0},
            "hood_peak": {"x": 735.0, "y": 410.0},
            "front_axle": {"x": 800.0, "y": 700.0},
            "rear_axle": {"x": 300.0, "y": 700.0},
        },
        "mm_per_pixel": 2.0,
        "scale_uncertainty_ratio": 0.015,
        "facing_direction": "right",
    }

    response = client.post("/api/v1/calibration/bike-cad", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["stack_bb_to_bar"]["value"] == 560.0
    assert data["reach_bb_to_bar"]["value"] == 400.0
    assert data["wheelbase"]["value"] == 1000.0
    assert data["effective_seat_tube_angle_deg"] > 70.0
    assert data["confidence_score"] > 0.8
