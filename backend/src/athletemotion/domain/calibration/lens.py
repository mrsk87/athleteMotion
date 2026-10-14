"""Calibração de distorção de lente de câmara e desdistorção rápida de keypoints em coordenadas de píxeis."""

from __future__ import annotations

from collections.abc import Sequence

import cv2
import numpy as np

from athletemotion.domain.calibration.types import (
    CalibrationWarning,
    LensProfile,
    WarningSeverity,
)


def calibrate_lens(
    images: list[np.ndarray],
    board_size: tuple[int, int] = (9, 6),
    square_size_mm: float = 25.0,
    camera_id: str = "default_cam",
) -> tuple[LensProfile | None, list[CalibrationWarning]]:
    """Calibra os parâmetros intrínsecos e coeficientes de distorção ótica a partir de imagens de tabuleiro de xadrez.

    Args:
        images: Lista de fotogramas contendo o padrão de xadrez em diferentes ângulos/distâncias.
        board_size: Número de cantos internos do tabuleiro (colunas, linhas), por padrão (9, 6).
        square_size_mm: Comprimento do lado do quadrado do tabuleiro em milímetros.
        camera_id: Identificador único da câmara / sensor.

    Returns:
        Tuplo (LensProfile ou None, lista de avisos).
    """
    warnings: list[CalibrationWarning] = []

    if len(images) < 3:
        warnings.append(
            CalibrationWarning(
                code="INSUFFICIENT_CALIBRATION_IMAGES",
                severity=WarningSeverity.ERROR,
                message_pt=f"Número de imagens de calibração insuficiente ({len(images)} fornecidas, mínimo 3 recomendadas >= 10).",
                message_en=f"Insufficient calibration images ({len(images)} provided, minimum 3, >=10 recommended).",
            )
        )
        return None, warnings

    cols, rows = board_size
    # Padrão 3D de coordenadas no plano Z=0 do tabuleiro em milímetros
    objp = np.zeros((rows * cols, 3), np.float32)
    objp[:, :2] = np.mgrid[0:cols, 0:rows].T.reshape(-1, 2) * square_size_mm

    objpoints: list[np.ndarray] = []
    imgpoints: list[np.ndarray] = []

    h, w = images[0].shape[:2]
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)

    successful_frames = 0
    for idx, img in enumerate(images):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
        ret, corners = cv2.findChessboardCorners(gray, (cols, rows), None)
        if ret:
            refined_corners = cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1), criteria)
            objpoints.append(objp)
            imgpoints.append(refined_corners)
            successful_frames += 1
        else:
            warnings.append(
                CalibrationWarning(
                    code="CHESSBOARD_NOT_FOUND_IN_FRAME",
                    severity=WarningSeverity.INFO,
                    message_pt=f"Padrão de xadrez não detetado no frame índice {idx}.",
                    message_en=f"Chessboard pattern not found in frame index {idx}.",
                )
            )

    if successful_frames < 3:
        warnings.append(
            CalibrationWarning(
                code="CALIBRATION_PATTERN_FAILED",
                severity=WarningSeverity.ERROR,
                message_pt=f"O padrão foi detetado em apenas {successful_frames} frames (mínimo exigido: 3).",
                message_en=f"Pattern detected in only {successful_frames} frames (minimum required: 3).",
            )
        )
        return None, warnings

    rms, mtx, dist, _rvecs, _tvecs = cv2.calibrateCamera(
        objpoints, imgpoints, (w, h), None, None
    )

    if rms >= 0.5:
        warnings.append(
            CalibrationWarning(
                code="HIGH_RMS_REPROJECTION_ERROR",
                severity=WarningSeverity.WARNING,
                message_pt=f"Erro RMS de reprojeção elevado ({rms:.3f} px >= 0.500 px). Repita com melhor iluminação.",
                message_en=f"High RMS reprojection error ({rms:.3f} px >= 0.500 px). Retake under better lighting.",
                details={"rms": rms},
            )
        )

    profile = LensProfile(
        camera_id=camera_id,
        resolution=(w, h),
        camera_matrix=mtx.tolist(),
        dist_coeffs=dist.flatten().tolist(),
        rms_error_px=float(rms),
    )

    return profile, warnings


def undistort_points(
    points: Sequence[tuple[float, float]],
    profile: LensProfile,
) -> list[tuple[float, float]]:
    """Aplica desdistorção ótica diretamente a uma lista de coordenadas 2D (keypoints).

    Evita o processamento dispendioso de remapeamento de toda a imagem de vídeo,
    garantindo computação em tempo real (< 0.2 ms) para centenas de landmarks.
    """
    if not points:
        return []

    cam_mat = np.array(profile.camera_matrix, dtype=np.float64)
    dist_coeffs = np.array(profile.dist_coeffs, dtype=np.float64)

    pts = np.array(points, dtype=np.float64).reshape(-1, 1, 2)
    # P=cam_mat faz com que os pontos retornados continuem no mesmo espaço de píxeis da câmara corrigida
    undistorted = cv2.undistortPoints(pts, cam_mat, dist_coeffs, P=cam_mat)
    res = undistorted.reshape(-1, 2).tolist()
    return [(float(pt[0]), float(pt[1])) for pt in res]
