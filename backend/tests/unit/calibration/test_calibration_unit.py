"""Testes unitários determinísticos para o subsistema de calibração espacial e ótica (R11)."""

from __future__ import annotations

import math

import numpy as np
import pytest

from athletemotion.domain.biomechanics.alignment import evaluate_kops_alignment
from athletemotion.domain.calibration.aruco import detect_aruco_scale
from athletemotion.domain.calibration.crank import (
    calibrate_from_crank_endpoints,
    calibrate_from_crank_trajectory,
)
from athletemotion.domain.calibration.lens import undistort_points
from athletemotion.domain.calibration.roll import (
    correct_roll_points,
    estimate_roll_from_line,
)
from athletemotion.domain.calibration.scale import CoordinateTransformer
from athletemotion.domain.calibration.selftest import generate_synthetic_aruco_scene
from athletemotion.domain.calibration.types import (
    CalibrationMethod,
    LensProfile,
    ScaleCalibration,
)
from athletemotion.domain.calibration.wheel import calibrate_from_wheel_ellipse


def test_aruco_detection_zero_degrees():
    """Valida deteção de escala ArUco sem rotação com erro < 1.0%."""
    # 100 mm em 250 px -> esperado = 0.4000 mm/px
    img = generate_synthetic_aruco_scene(marker_id=0, marker_side_px=250, rotation_deg=0.0)
    calib, _warnings = detect_aruco_scale(img, marker_length_mm=100.0)

    assert calib is not None
    assert calib.method == CalibrationMethod.ARUCO
    assert abs(calib.mm_per_px - 0.40) / 0.40 < 0.01  # Erro < 1%
    assert abs(calib.plane_roll_deg) < 1.0
    assert abs(calib.plane_yaw_deg) < 2.0
    assert calib.is_perpendicular is True
    assert calib.uncertainty_mm_per_px > 0.0


def test_aruco_detection_under_rotation():
    """Valida escala e deteção de roll com marcador rodado a 20 graus."""
    img = generate_synthetic_aruco_scene(marker_id=0, marker_side_px=200, rotation_deg=20.0)
    calib, warnings = detect_aruco_scale(img, marker_length_mm=100.0)

    assert calib is not None
    # 100 mm em 200 px -> esperado = 0.500 mm/px
    assert abs(calib.mm_per_px - 0.50) / 0.50 < 0.015
    # OpenCV calcula ângulo no sentido horário
    assert abs(abs(calib.plane_roll_deg) - 20.0) < 1.0
    # Como |roll| > 3.0°, deve disparar aviso HIGH_ROLL
    assert any(w.code == "HIGH_ROLL" for w in warnings)
    assert calib.is_perpendicular is False


def test_aruco_marker_not_found_and_empty():
    """Tratamento gracioso para imagem vazia ou sem marcador."""
    calib_empty, warns_empty = detect_aruco_scale(np.array([]))
    assert calib_empty is None
    assert any(w.code == "EMPTY_IMAGE" for w in warns_empty)

    blank_img = np.ones((500, 500, 3), dtype=np.uint8) * 200
    calib_none, warns_none = detect_aruco_scale(blank_img)
    assert calib_none is None
    assert any(w.code == "MARKER_NOT_FOUND" for w in warns_none)


def test_aruco_small_marker_warning():
    """Alerta quando o marcador ocupa menos de 3% da largura do fotograma."""
    # Canvas 2000px, marcador de 40px = 2% da largura (< 3%)
    img = generate_synthetic_aruco_scene(marker_side_px=40, canvas_size=(1000, 2000))
    calib, warnings = detect_aruco_scale(img, marker_length_mm=100.0)

    if calib is not None:
        assert any(w.code == "SMALL_MARKER" for w in warnings)


def test_crank_endpoints_calibration():
    """Valida escala de pedivela por pontos 3h e 9h."""
    p_front = (700.0, 400.0)
    p_rear = (355.0, 400.0)  # Distância = 345 px
    # Para pedivela 172.5 mm -> diâmetro = 345.0 mm -> escala esperada = 1.0 mm/px
    calib, _warnings = calibrate_from_crank_endpoints(p_front, p_rear, crank_length_mm=172.5)

    assert calib is not None
    assert calib.method == CalibrationMethod.CRANK
    assert abs(calib.mm_per_px - 1.0) < 1e-4
    assert abs(calib.plane_roll_deg) < 1e-4
    assert calib.uncertainty_mm_per_px == pytest.approx(0.06, rel=1e-2)


def test_crank_endpoints_points_too_close():
    """Rejeita pontos com menos de 20 px de separação."""
    calib, warnings = calibrate_from_crank_endpoints((100.0, 100.0), (105.0, 102.0))
    assert calib is None
    assert any(w.code == "CRANK_POINTS_TOO_CLOSE" for w in warnings)


def test_crank_trajectory_circle_fit():
    """Valida ajuste de círculo a nuvem de 16 pontos de pedalada."""
    true_radius = 175.0
    cx, cy = 600.0, 450.0
    angles = np.linspace(0, 2 * math.pi, 16, endpoint=False)
    pts = [(cx + true_radius * math.cos(a), cy + true_radius * math.sin(a)) for a in angles]

    calib, _warnings = calibrate_from_crank_trajectory(pts, crank_length_mm=175.0)
    assert calib is not None
    assert abs(calib.mm_per_px - 1.0) < 1e-3
    assert calib.uncertainty_mm_per_px > 0.0


def test_wheel_ellipse_scale_and_yaw():
    """Valida calibração por roda 700c e deteção de yaw oblíquo."""
    # Roda 700c com 670 mm
    # Eixo maior = 670 px -> mm_per_px = 1.0
    # Eixo menor com yaw de 12° -> cos(12°) ≈ 0.9781
    yaw_target = 12.0
    a_semi = 335.0
    b_semi = 335.0 * math.cos(math.radians(yaw_target))
    cx, cy = 640.0, 480.0

    thetas = np.linspace(0, 2 * math.pi, 40, endpoint=False)
    ellipse_pts = [(cx + b_semi * math.cos(t), cy + a_semi * math.sin(t)) for t in thetas]

    calib, warnings = calibrate_from_wheel_ellipse(ellipse_pts, "700c")
    assert calib is not None
    assert abs(calib.mm_per_px - 1.0) < 0.05
    assert abs(calib.plane_yaw_deg - yaw_target) < 1.0
    # Como yaw > 8.0°, deve disparar aviso HIGH_YAW
    assert any(w.code == "HIGH_YAW" for w in warnings)


def test_lens_point_undistortion():
    """Valida aplicação de desdistorção ótica a pontos 2D sem distorcer o ponto central."""
    w, h = 1920, 1080
    fx, fy = 1200.0, 1200.0
    cx, cy = w / 2.0, h / 2.0
    cam_mat = [[fx, 0.0, cx], [0.0, fy, cy], [0.0, 0.0, 1.0]]
    # Barril com k1 negativo
    dist_coeffs = [-0.15, 0.02, 0.0, 0.0, 0.0]

    profile = LensProfile(
        camera_id="cam_test",
        resolution=(w, h),
        camera_matrix=cam_mat,
        dist_coeffs=dist_coeffs,
        rms_error_px=0.25,
    )
    assert profile.is_valid() is True

    # Ponto no centro ótico não sofre distorção radial
    center_pt = [(cx, cy)]
    undist_center = undistort_points(center_pt, profile)
    assert abs(undist_center[0][0] - cx) < 1e-3
    assert abs(undist_center[0][1] - cy) < 1e-3

    # Ponto periférico sofre deslocamento
    corner_pt = [(1800.0, 950.0)]
    undist_corner = undistort_points(corner_pt, profile)
    assert undist_corner[0] != corner_pt[0]


def test_roll_estimation_and_point_correction():
    """Valida estimativa de ângulo de roll da linha do solo e rotação compensatória de pontos."""
    # Linha inclinada em 5 graus
    rad5 = math.radians(5.0)
    p1 = (100.0, 500.0)
    p2 = (100.0 + 400.0 * math.cos(rad5), 500.0 + 400.0 * math.sin(rad5))

    measured_roll = estimate_roll_from_line(p1, p2)
    assert abs(measured_roll - 5.0) < 1e-3

    # Rodar de volta o ponto p2 em torno de p1 deve nivelar a ordenada Y para 500.0
    corrected = correct_roll_points([p2], measured_roll, origin=p1)
    assert abs(corrected[0][1] - 500.0) < 1e-3


def test_coordinate_transformer_measurements():
    """Valida CoordinateTransformer medindo distâncias e incertezas em milímetros."""
    scale = ScaleCalibration(
        mm_per_px=0.5,
        method=CalibrationMethod.ARUCO,
        uncertainty_mm_per_px=0.01,
        plane_roll_deg=0.0,
        plane_yaw_deg=0.0,
    )
    transformer = CoordinateTransformer(scale=scale)

    # 200 px de distância -> 100.0 mm
    dist_mm, unc_mm = transformer.measure_distance_mm((100.0, 100.0), (300.0, 100.0))
    assert dist_mm is not None
    assert unc_mm is not None
    assert abs(dist_mm - 100.0) < 1e-4
    assert unc_mm > 0.0

    # Desfasamento horizontal KOPS (patela x=450, pedal x=400 -> recuado -50 px = -25.0 mm)
    offset_mm, _unc_kops = transformer.measure_horizontal_offset_mm(450.0, 400.0)
    assert offset_mm is not None
    assert abs(offset_mm - (-25.0)) < 1e-4

    # Sem escala, devolve (None, None) garantindo compliance de dados clínicos
    transformer_uncalibrated = CoordinateTransformer(scale=None)
    d_none, u_none = transformer_uncalibrated.measure_distance_mm((0, 0), (10, 10))
    assert d_none is None
    assert u_none is None


def test_kops_evaluation_with_uncertainty():
    """Valida que evaluate_kops_alignment preserva a incerteza e classifica corretamente."""
    diag_neutral = evaluate_kops_alignment(offset_mm=2.5, uncertainty_mm=1.2)
    assert diag_neutral.is_aligned is True
    assert diag_neutral.offset_mm == 2.5
    assert diag_neutral.uncertainty_mm == 1.2
    assert "Perfeito" in diag_neutral.status_label_pt

    diag_ahead = evaluate_kops_alignment(offset_mm=14.0, uncertainty_mm=2.0)
    assert diag_ahead.is_aligned is False
    assert diag_ahead.uncertainty_mm == 2.0
    assert "adiantado" in diag_ahead.status_label_pt
