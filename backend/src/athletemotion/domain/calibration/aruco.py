"""Deteção de marcadores fiduciários ArUco para calibração métrica precisa e orientação do plano."""

from __future__ import annotations

import hashlib
import math

import cv2
import numpy as np

from athletemotion.domain.calibration.types import (
    CalibrationMethod,
    CalibrationWarning,
    ScaleCalibration,
    WarningSeverity,
)


def detect_aruco_scale(
    image: np.ndarray,
    marker_length_mm: float = 100.0,
    marker_id: int | None = None,
    dictionary_id: int = cv2.aruco.DICT_4X4_50,
    camera_matrix: np.ndarray | None = None,
    dist_coeffs: np.ndarray | None = None,
) -> tuple[ScaleCalibration | None, list[CalibrationWarning]]:
    """Deteta marcador ArUco na imagem, calcula o fator mm_per_px e estima roll e yaw do plano.

    Args:
        image: Frame BGR ou escala de cinzentos.
        marker_length_mm: Comprimento do lado exterior do quadrado negro em milímetros.
        marker_id: ID específico do marcador a procurar (ou None para o primeiro encontrado).
        dictionary_id: Dicionário OpenCV ArUco (padrão DICT_4X4_50).
        camera_matrix: Matriz intrínseca 3x3 opcional para solvePnP.
        dist_coeffs: Coeficientes de distorção opcionais.

    Returns:
        Tuplo (ScaleCalibration ou None, lista de CalibrationWarning).
    """
    warnings: list[CalibrationWarning] = []

    if image is None or image.size == 0:
        warnings.append(
            CalibrationWarning(
                code="EMPTY_IMAGE",
                severity=WarningSeverity.ERROR,
                message_pt="A imagem fornecida está vazia ou corrompida.",
                message_en="Provided image is empty or corrupted.",
            )
        )
        return None, warnings

    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image

    # 1. Verificação de nitidez ótica (variância do Laplaciano)
    laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if laplacian_var < 50.0:
        warnings.append(
            CalibrationWarning(
                code="LOW_SHARPNESS",
                severity=WarningSeverity.WARNING,
                message_pt=f"Nitidez da imagem reduzida ({laplacian_var:.1f}). Risco de erro sub-pixel.",
                message_en=f"Low image sharpness ({laplacian_var:.1f}). Sub-pixel jitter risk.",
                details={"laplacian_var": laplacian_var},
            )
        )

    # 2. Deteção de Marcadores ArUco
    dictionary = cv2.aruco.getPredefinedDictionary(dictionary_id)
    params = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(dictionary, params)
    corners, ids, _ = detector.detectMarkers(gray)

    if ids is None or len(ids) == 0:
        warnings.append(
            CalibrationWarning(
                code="MARKER_NOT_FOUND",
                severity=WarningSeverity.ERROR,
                message_pt="Nenhum marcador ArUco detetado no frame.",
                message_en="No ArUco marker detected in the frame.",
            )
        )
        return None, warnings

    # Localizar o índice do marcador pretendido
    target_idx = 0
    if marker_id is not None:
        flat_ids = ids.flatten().tolist()
        if marker_id not in flat_ids:
            warnings.append(
                CalibrationWarning(
                    code="TARGET_MARKER_NOT_FOUND",
                    severity=WarningSeverity.ERROR,
                    message_pt=f"Marcador com ID {marker_id} não encontrado na imagem.",
                    message_en=f"Marker with ID {marker_id} not found in image.",
                )
            )
            return None, warnings
        target_idx = flat_ids.index(marker_id)

    # Coordenadas dos 4 cantos do marcador: shape (4, 2)
    # Ordem OpenCV: top-left, top-right, bottom-right, bottom-left
    c = corners[target_idx].reshape(4, 2).astype(np.float64)

    # 3. Validação do tamanho relativo do marcador no frame (> 3 % da largura)
    d01 = float(np.linalg.norm(c[1] - c[0]))
    d12 = float(np.linalg.norm(c[2] - c[1]))
    d23 = float(np.linalg.norm(c[3] - c[2]))
    d30 = float(np.linalg.norm(c[0] - c[3]))
    avg_side_px = (d01 + d12 + d23 + d30) / 4.0

    marker_ratio = avg_side_px / w
    if marker_ratio < 0.03:
        warnings.append(
            CalibrationWarning(
                code="SMALL_MARKER",
                severity=WarningSeverity.WARNING,
                message_pt=f"Marcador muito pequeno no frame ({marker_ratio*100:.1f}% da largura, recomendado >= 3%).",
                message_en=f"Marker too small ({marker_ratio*100:.1f}% of width, >= 3% recommended).",
                details={"marker_ratio": marker_ratio},
            )
        )

    # Escala dimensional
    mm_per_px = float(marker_length_mm / avg_side_px)

    # 4. Estimação de Pose 3D (Roll e Yaw) via solvePnP
    half_l = marker_length_mm / 2.0
    obj_pts = np.array(
        [
            [-half_l, half_l, 0.0],
            [half_l, half_l, 0.0],
            [half_l, -half_l, 0.0],
            [-half_l, -half_l, 0.0],
        ],
        dtype=np.float64,
    )

    if camera_matrix is None:
        # Matriz intrínseca aproximada baseada na resolução da imagem
        focal_length = float(w)
        cam_mat = np.array(
            [[focal_length, 0.0, w / 2.0], [0.0, focal_length, h / 2.0], [0.0, 0.0, 1.0]],
            dtype=np.float64,
        )
    else:
        cam_mat = np.asarray(camera_matrix, dtype=np.float64)

    dist = (
        np.asarray(dist_coeffs, dtype=np.float64)
        if dist_coeffs is not None
        else np.zeros((5, 1), dtype=np.float64)
    )

    roll_deg = 0.0
    yaw_deg = 0.0

    try:
        success, rvec, _tvec = cv2.solvePnP(
            obj_pts, c, cam_mat, dist, flags=cv2.SOLVEPNP_IPPE_SQUARE
        )
        if success:
            rmat, _ = cv2.Rodrigues(rvec)
            # Rotações em torno dos eixos locais
            yaw_rad = math.atan2(-rmat[2, 0], math.sqrt(rmat[2, 1] ** 2 + rmat[2, 2] ** 2))
            roll_rad = math.atan2(rmat[1, 0], rmat[0, 0])

            yaw_deg = float(math.degrees(yaw_rad))
            roll_deg = float(math.degrees(roll_rad))
    except Exception:
        # Fallback analítico 2D caso solvePnP falhe
        dx = c[1][0] - c[0][0]
        dy = c[1][1] - c[0][1]
        roll_deg = float(math.degrees(math.atan2(dy, dx)))

    # Verificar limiares clínicos e emitir alertas estruturados
    if abs(roll_deg) > 3.0:
        warnings.append(
            CalibrationWarning(
                code="HIGH_ROLL",
                severity=WarningSeverity.WARNING,
                message_pt=f"Inclinação da câmara excessiva (|roll| = {abs(roll_deg):.1f}° > 3.0°).",
                message_en=f"Excessive camera roll (|roll| = {abs(roll_deg):.1f}° > 3.0°).",
                details={"roll_deg": roll_deg},
            )
        )

    if abs(yaw_deg) > 8.0:
        warnings.append(
            CalibrationWarning(
                code="HIGH_YAW",
                severity=WarningSeverity.WARNING,
                message_pt=f"Câmara não perpendicular ao plano (|yaw| = {abs(yaw_deg):.1f}° > 8.0°).",
                message_en=f"Camera not perpendicular to plane (|yaw| = {abs(yaw_deg):.1f}° > 8.0°).",
                details={"yaw_deg": yaw_deg},
            )
        )

    # 5. Cálculo estrito de incerteza (propagação de jitter subpixel + distorção de perspetiva)
    subpixel_jitter_px = 0.5
    scale_jitter_unc = mm_per_px * (subpixel_jitter_px / avg_side_px)
    perspective_unc = mm_per_px * abs(math.sin(math.radians(yaw_deg))) * 0.05
    total_uncertainty = float(scale_jitter_unc + perspective_unc)

    frame_hash = hashlib.sha256(gray.tobytes()[:4096]).hexdigest()[:16]

    calibration = ScaleCalibration(
        mm_per_px=mm_per_px,
        method=CalibrationMethod.ARUCO,
        uncertainty_mm_per_px=total_uncertainty,
        plane_roll_deg=roll_deg,
        plane_yaw_deg=yaw_deg,
        source_frame_hash=frame_hash,
        warnings=warnings,
    )

    return calibration, warnings
