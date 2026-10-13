"""Testes unitários para o módulo matemático de cálculo de ângulos."""
import math
from src.domain.calculator import Point2D, Point3D, calculate_safe_angle, calculate_inclination_angle


def test_calculate_safe_angle_right_angle():
    # Triângulo retângulo: ângulo de 90° em B=(0,0) entre A=(0,1) e C=(1,0)
    a = Point2D(0.0, 1.0)
    b = Point2D(0.0, 0.0)
    c = Point2D(1.0, 0.0)
    angle = calculate_safe_angle(a, b, c)
    assert abs(angle - 90.0) < 0.01


def test_calculate_safe_angle_straight_line():
    # Linha reta: 180° em B=(0,0) entre A=(-1,0) e C=(1,0)
    a = Point2D(-1.0, 0.0)
    b = Point2D(0.0, 0.0)
    c = Point2D(1.0, 0.0)
    angle = calculate_safe_angle(a, b, c)
    assert abs(angle - 180.0) < 0.01


def test_calculate_safe_angle_degenerate_coincident_points():
    # Pontos idênticos (comprimento zero do vetor) não podem gerar divisão por zero
    a = Point2D(5.0, 5.0)
    b = Point2D(5.0, 5.0)
    c = Point2D(5.0, 5.0)
    angle = calculate_safe_angle(a, b, c)
    assert angle == 0.0
    assert not math.isnan(angle)


def test_calculate_safe_angle_float_drift_protection():
    # Coordenadas que poderiam gerar float drift cos > 1.0
    a = Point3D(1.000000000000001, 2.0)
    b = Point3D(0.0, 0.0)
    c = Point3D(1.0, 2.0)
    angle = calculate_safe_angle(a, b, c)
    assert not math.isnan(angle)
    assert angle >= 0.0


def test_calculate_inclination_angle():
    # Ponto vertical (90° em relação à horizontal)
    bottom = Point2D(10.0, 50.0)
    top = Point2D(10.0, 10.0)
    inclination = calculate_inclination_angle(bottom, top)
    assert abs(inclination - 90.0) < 0.01

    # Ponto horizontal (0° em relação à horizontal)
    top_horiz = Point2D(50.0, 50.0)
    inclination_h = calculate_inclination_angle(bottom, top_horiz)
    assert abs(inclination_h - 0.0) < 0.01

