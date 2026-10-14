"""Serviço de aplicação para orquestração de calibração métrica e gestão de perfis de lente."""

from __future__ import annotations

import json
import logging
import uuid

from athletemotion.api.validation.images import validate_and_decode_image
from athletemotion.domain.calibration.aruco import detect_aruco_scale
from athletemotion.domain.calibration.lens import calibrate_lens
from athletemotion.domain.calibration.types import (
    CalibrationWarning,
)
from athletemotion.infrastructure.database import CameraProfileModel
from athletemotion.infrastructure.uow import unit_of_work
from athletemotion.schemas.calibration import (
    CalibrationWarningSchema,
    LensProfileResponse,
    ScaleCalibrationResponse,
)

logger = logging.getLogger("athlete_motion.services.calibration_service")


class CalibrationFailedError(Exception):
    """Exceção levantada quando uma operação de calibração não consegue estabelecer parâmetros válidos."""


class LensProfileNotFoundError(Exception):
    """Exceção levantada quando o perfil de lente solicitado não existe."""


def _map_warnings(warnings: list[CalibrationWarning]) -> list[CalibrationWarningSchema]:
    return [
        CalibrationWarningSchema(
            code=w.code,
            severity=w.severity.value,
            message_pt=w.message_pt,
            message_en=w.message_en,
            details=w.details,
        )
        for w in warnings
    ]


class CalibrationService:
    """Orquestra o processamento de imagens de calibração, deteção de marcadores e persistência de perfis."""

    def calibrate_scale_from_image(
        self,
        image_bytes: bytes,
        marker_length_mm: float = 100.0,
        marker_id: int | None = None,
        camera_id: str | None = None,
    ) -> ScaleCalibrationResponse:
        """Deteta marcador ArUco num fotograma, verifica alinhamento e calcula o fator mm_per_px."""
        # 1. Validação defensiva de imagem (limite de bytes, magic bytes, pixel flood)
        img = validate_and_decode_image(image_bytes)
        h, w = img.shape[:2]

        camera_matrix = None
        dist_coeffs = None
        if camera_id:
            profile = self.get_lens_profile(camera_id, w, h)
            if profile:
                camera_matrix = profile.camera_matrix
                dist_coeffs = profile.dist_coeffs

        calib, warnings = detect_aruco_scale(
            image=img,
            marker_length_mm=marker_length_mm,
            marker_id=marker_id,
            camera_matrix=camera_matrix,  # type: ignore[arg-type]
            dist_coeffs=dist_coeffs,  # type: ignore[arg-type]
        )

        if calib is None:
            first_err = warnings[0].message_pt if warnings else "Falha desconhecida na deteção do marcador."
            raise CalibrationFailedError(f"Não foi possível calibrar a escala: {first_err}")

        return ScaleCalibrationResponse(
            mm_per_px=calib.mm_per_px,
            method=calib.method.value,
            uncertainty_mm_per_px=calib.uncertainty_mm_per_px,
            plane_roll_deg=calib.plane_roll_deg,
            plane_yaw_deg=calib.plane_yaw_deg,
            is_perpendicular=calib.is_perpendicular,
            source_frame_hash=calib.source_frame_hash,
            warnings=_map_warnings(calib.warnings),
        )

    def calibrate_and_save_lens_profile(
        self,
        camera_id: str,
        images_bytes: list[bytes],
        board_cols: int = 9,
        board_rows: int = 6,
        square_size_mm: float = 25.0,
    ) -> LensProfileResponse:
        """Processa um lote de imagens de tabuleiro de xadrez e guarda o perfil de distorção ótica na BD."""
        if not images_bytes:
            raise CalibrationFailedError("Nenhuma imagem fornecida para calibração de lente.")

        decoded_images = [validate_and_decode_image(b) for b in images_bytes]
        h, w = decoded_images[0].shape[:2]

        profile, warnings = calibrate_lens(
            images=decoded_images,
            board_size=(board_cols, board_rows),
            square_size_mm=square_size_mm,
            camera_id=camera_id,
        )

        if profile is None:
            first_err = warnings[0].message_pt if warnings else "Padrão de xadrez não detetado nas imagens."
            raise CalibrationFailedError(f"Calibração de lente falhou: {first_err}")

        # Persistência atómica via Unit of Work
        with unit_of_work() as session:
            existing = (
                session.query(CameraProfileModel)
                .filter_by(camera_id=camera_id, width=w, height=h)
                .first()
            )
            if existing:
                existing.camera_matrix_json = json.dumps(profile.camera_matrix)
                existing.dist_coeffs_json = json.dumps(profile.dist_coeffs)
                existing.rms_error_px = profile.rms_error_px
                existing.created_at = profile.created_at
                record = existing
            else:
                record = CameraProfileModel(
                    id=str(uuid.uuid4()),
                    camera_id=camera_id,
                    width=w,
                    height=h,
                    camera_matrix_json=json.dumps(profile.camera_matrix),
                    dist_coeffs_json=json.dumps(profile.dist_coeffs),
                    rms_error_px=profile.rms_error_px,
                    created_at=profile.created_at,
                )
                session.add(record)

            session.flush()

            return LensProfileResponse(
                id=record.id,
                camera_id=record.camera_id,
                width=record.width,
                height=record.height,
                camera_matrix=json.loads(record.camera_matrix_json),
                dist_coeffs=json.loads(record.dist_coeffs_json),
                rms_error_px=record.rms_error_px,
                created_at=record.created_at,
            )

    def get_lens_profile(
        self, camera_id: str, width: int, height: int
    ) -> LensProfileResponse | None:
        """Obtém o perfil ótico registado para uma câmara e resolução específica."""
        with unit_of_work() as session:
            record = (
                session.query(CameraProfileModel)
                .filter_by(camera_id=camera_id, width=width, height=height)
                .first()
            )
            if not record:
                return None

            return LensProfileResponse(
                id=record.id,
                camera_id=record.camera_id,
                width=record.width,
                height=record.height,
                camera_matrix=json.loads(record.camera_matrix_json),
                dist_coeffs=json.loads(record.dist_coeffs_json),
                rms_error_px=record.rms_error_px,
                created_at=record.created_at,
            )

    def list_lens_profiles(self) -> list[LensProfileResponse]:
        """Lista todos os perfis de lente registados no sistema."""
        with unit_of_work() as session:
            records = (
                session.query(CameraProfileModel)
                .order_by(CameraProfileModel.created_at.desc())
                .all()
            )
            return [
                LensProfileResponse(
                    id=r.id,
                    camera_id=r.camera_id,
                    width=r.width,
                    height=r.height,
                    camera_matrix=json.loads(r.camera_matrix_json),
                    dist_coeffs=json.loads(r.dist_coeffs_json),
                    rms_error_px=r.rms_error_px,
                    created_at=r.created_at,
                )
                for r in records
            ]
