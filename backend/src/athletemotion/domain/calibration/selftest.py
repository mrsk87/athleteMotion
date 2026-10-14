"""Ferramenta de autoteste e validação matemática do subsistema de calibração espacial."""

from __future__ import annotations

import math
import sys

import cv2
import numpy as np

from athletemotion.domain.calibration.aruco import detect_aruco_scale
from athletemotion.domain.calibration.crank import (
    calibrate_from_crank_endpoints,
    calibrate_from_crank_trajectory,
)
from athletemotion.domain.calibration.wheel import calibrate_from_wheel_ellipse


def generate_synthetic_aruco_scene(
    marker_id: int = 0,
    marker_side_px: int = 200,
    canvas_size: tuple[int, int] = (1080, 1920),
    rotation_deg: float = 0.0,
) -> np.ndarray:
    """Gera uma imagem sintética determinística com um marcador ArUco posicionado e rotacionado."""
    canvas_h, canvas_w = canvas_size
    img = np.ones((canvas_h, canvas_w, 3), dtype=np.uint8) * 240

    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    marker = cv2.aruco.generateImageMarker(dictionary, marker_id, marker_side_px)
    marker_bgr = cv2.cvtColor(marker, cv2.COLOR_GRAY2BGR)

    # Colar no centro da imagem
    start_y = (canvas_h - marker_side_px) // 2
    start_x = (canvas_w - marker_side_px) // 2
    img[start_y : start_y + marker_side_px, start_x : start_x + marker_side_px] = marker_bgr

    # Rotação suave no canvas para não truncar os cantos do quadrado
    if abs(rotation_deg) > 1e-3:
        center_x = start_x + marker_side_px / 2.0
        center_y = start_y + marker_side_px / 2.0
        m = cv2.getRotationMatrix2D((center_x, center_y), rotation_deg, 1.0)
        img = cv2.warpAffine(
            img,
            m,
            (canvas_w, canvas_h),
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(240, 240, 240),
        )

    return img


def run_selftest() -> bool:
    """Executa a verificação completa de precisão dos algoritmos de calibração."""
    print("=== INICIANDO AUTOTESTE DE CALIBRAÇÃO ESPACIAL (R11) ===")

    # 1. Teste de escala ArUco com lado conhecido de 100 mm em 200 px (escala teórica = 0.500 mm/px)
    expected_scale = 100.0 / 200.0
    synth_img = generate_synthetic_aruco_scene(marker_side_px=200, rotation_deg=0.0)

    calib, _warnings = detect_aruco_scale(synth_img, marker_length_mm=100.0)
    if calib is None:
        print("[FALHA] Marcador ArUco não foi detetado na imagem sintética.")
        return False

    error_pct = abs(calib.mm_per_px - expected_scale) / expected_scale * 100.0
    print(
        f"[OK] ArUco 0°: Escala obtida = {calib.mm_per_px:.4f} mm/px (esperado: {expected_scale:.4f}, erro: {error_pct:.2f}%)"
    )
    if error_pct > 1.0:
        print(f"[FALHA] Erro de escala ArUco ({error_pct:.2f}%) excede o limite estrito de 1.0%.")
        return False

    # 2. Teste ArUco com rotação de 15°
    rot_img = generate_synthetic_aruco_scene(marker_side_px=200, rotation_deg=15.0)
    calib_rot, _ = detect_aruco_scale(rot_img, marker_length_mm=100.0)
    if calib_rot is None:
        print("[FALHA] Marcador ArUco com 15° de rotação não foi detetado.")
        return False

    rot_error_pct = abs(calib_rot.mm_per_px - expected_scale) / expected_scale * 100.0
    print(
        f"[OK] ArUco 15°: Escala = {calib_rot.mm_per_px:.4f} mm/px, Roll = {calib_rot.plane_roll_deg:.1f}°, erro: {rot_error_pct:.2f}%"
    )
    if rot_error_pct > 1.5:
        print(f"[FALHA] Erro de escala sob rotação ({rot_error_pct:.2f}%) excede 1.5%.")
        return False

    # 3. Teste de Calibração de Pedivela (172.5 mm -> diâmetro 345.0 mm em 300 px)
    p_front = (600.0, 500.0)
    p_rear = (300.0, 500.0)
    calib_crank, _ = calibrate_from_crank_endpoints(p_front, p_rear, crank_length_mm=172.5)
    if calib_crank is None:
        print("[FALHA] Calibração por pedivela retornou None.")
        return False
    expected_crank_scale = 345.0 / 300.0
    if abs(calib_crank.mm_per_px - expected_crank_scale) >= 1e-4:
        print(f"[FALHA] Escala de pedivela incorreta: {calib_crank.mm_per_px}")
        return False
    print(f"[OK] Pedivela Endpoints: Escala = {calib_crank.mm_per_px:.4f} mm/px")

    # 4. Trajetória circular sintética de pedivela
    angles = np.linspace(0, 2 * math.pi, 16, endpoint=False)
    radius_true = 150.0
    cx, cy = 500.0, 500.0
    pts = [(cx + radius_true * math.cos(a), cy + radius_true * math.sin(a)) for a in angles]
    calib_traj, _ = calibrate_from_crank_trajectory(pts, crank_length_mm=172.5)
    if calib_traj is None or abs(calib_traj.mm_per_px - (172.5 / 150.0)) >= 1e-3:
        print("[FALHA] Calibração por trajetória de pedivela falhou.")
        return False
    print(f"[OK] Pedivela Trajetória: Escala = {calib_traj.mm_per_px:.4f} mm/px")

    # 5. Teste de Geometria de Roda (700c = 670 mm, elipse sintética com 670 px de eixo maior)
    wheel_angles = np.linspace(0, 2 * math.pi, 30, endpoint=False)
    # Eixo maior = 670, menor = 670 * cos(10°) ≈ 659.8 px -> yaw ≈ 10°
    a_semi = 335.0
    b_semi = 335.0 * math.cos(math.radians(10.0))
    wheel_pts = [(cx + b_semi * math.cos(t), cy + a_semi * math.sin(t)) for t in wheel_angles]
    calib_wheel, wheel_warns = calibrate_from_wheel_ellipse(wheel_pts, "700c")
    if (
        calib_wheel is None
        or abs(calib_wheel.mm_per_px - 1.0) >= 0.05
        or abs(calib_wheel.plane_yaw_deg - 10.0) >= 1.0
        or not any(w.code == "HIGH_YAW" for w in wheel_warns)
    ):
        print("[FALHA] Calibração de roda / yaw falhou.")
        return False
    print(
        f"[OK] Roda / Yaw: Escala = {calib_wheel.mm_per_px:.4f} mm/px, Yaw = {calib_wheel.plane_yaw_deg:.1f}° (alerta HIGH_YAW disparado com sucesso)"
    )

    print("=== TODOS OS TESTES DE CALIBRAÇÃO ESPACIAL PASSARAM COM SUCESSO! ===")
    return True


if __name__ == "__main__":
    success = run_selftest()
    sys.exit(0 if success else 1)
