"""Endpoints REST para calibração métrica, escala dimensional e perfis de distorção ótica."""

from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status

from athletemotion.domain.calculator import Point2D
from athletemotion.domain.calibration.bike_cad import (
    BikeCadAnalyzer,
    BikeLandmarks2D,
)
from athletemotion.domain.calibration.types import CalibrationMethod, ScaleCalibration
from athletemotion.schemas.bike_cad import BikeCadReportResponse, BikeCadRequest
from athletemotion.schemas.calibration import (
    LensProfileResponse,
    ScaleCalibrationResponse,
)
from athletemotion.schemas.measures import MeasureWithConfidence
from athletemotion.services.calibration_service import (
    CalibrationFailedError,
    CalibrationService,
)

router = APIRouter(prefix="/calibration", tags=["calibration"])
_service = CalibrationService()


@router.post(
    "/scale",
    response_model=ScaleCalibrationResponse,
    status_code=status.HTTP_200_OK,
)
async def calibrate_metric_scale(
    file: UploadFile = File(..., description="Fotograma capturado contendo o marcador ArUco"),
    marker_length_mm: float = Query(
        default=100.0,
        gt=10.0,
        le=500.0,
        description="Comprimento do lado exterior do marcador negro em milímetros",
    ),
    marker_id: int | None = Query(
        default=None, ge=0, le=49, description="ID opcional do marcador a procurar (dicionário 4x4)"
    ),
    camera_id: str | None = Query(
        default=None, description="Identificador da câmara para aplicar correção ótica se existir"
    ),
) -> ScaleCalibrationResponse:
    """Deteta marcador ArUco, estima orientação do plano (roll e yaw) e calcula o fator mm_per_px."""
    contents = await file.read()
    try:
        return _service.calibrate_scale_from_image(
            image_bytes=contents,
            marker_length_mm=marker_length_mm,
            marker_id=marker_id,
            camera_id=camera_id,
        )
    except CalibrationFailedError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(err)
        ) from err


@router.post(
    "/lens",
    response_model=LensProfileResponse,
    status_code=status.HTTP_201_CREATED,
)
async def calibrate_lens_distortion(
    camera_id: str = Form(..., min_length=1, max_length=100, description="Identificador único da câmara"),
    files: list[UploadFile] = File(
        ..., min_length=3, description="Lote de imagens do tabuleiro de xadrez em diferentes ângulos"
    ),
    board_cols: int = Form(default=9, ge=3, le=20, description="Número de cantos internos em largura"),
    board_rows: int = Form(default=6, ge=3, le=20, description="Número de cantos internos em altura"),
    square_size_mm: float = Form(default=25.0, gt=5.0, le=100.0, description="Lado do quadrado em mm"),
) -> LensProfileResponse:
    """Calcula a matriz intrínseca e coeficientes de distorção da lente a partir de imagens de xadrez."""
    images_bytes: list[bytes] = []
    for f in files:
        images_bytes.append(await f.read())

    try:
        return _service.calibrate_and_save_lens_profile(
            camera_id=camera_id,
            images_bytes=images_bytes,
            board_cols=board_cols,
            board_rows=board_rows,
            square_size_mm=square_size_mm,
        )
    except CalibrationFailedError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(err)
        ) from err


@router.get("/profiles", response_model=list[LensProfileResponse])
def list_camera_profiles() -> list[LensProfileResponse]:
    """Lista todos os perfis de distorção de lente gravados no sistema."""
    return _service.list_lens_profiles()


@router.get("/profiles/{camera_id}", response_model=LensProfileResponse)
def get_camera_profile(
    camera_id: str,
    width: int = Query(..., gt=0),
    height: int = Query(..., gt=0),
) -> LensProfileResponse:
    """Obtém o perfil ótico registado para uma câmara numa resolução específica."""
    profile = _service.get_lens_profile(camera_id, width, height)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Perfil ótico não encontrado para a câmara '{camera_id}' na resolução {width}x{height}.",
        )
    return profile


@router.post("/bike-cad", response_model=BikeCadReportResponse)
def compute_bike_cad(payload: BikeCadRequest) -> BikeCadReportResponse:
    """Calcula a geometria métrica 2D da bicicleta (Stack, Reach, Selim, Wheelbase) com propagação de incerteza."""
    landmarks = BikeLandmarks2D(
        bottom_bracket=Point2D(payload.landmarks.bottom_bracket.x, payload.landmarks.bottom_bracket.y),
        saddle_nose=Point2D(payload.landmarks.saddle_nose.x, payload.landmarks.saddle_nose.y),
        saddle_center=Point2D(payload.landmarks.saddle_center.x, payload.landmarks.saddle_center.y),
        handlebar_clamp=Point2D(payload.landmarks.handlebar_clamp.x, payload.landmarks.handlebar_clamp.y),
        hood_peak=Point2D(payload.landmarks.hood_peak.x, payload.landmarks.hood_peak.y)
        if payload.landmarks.hood_peak
        else None,
        front_axle=Point2D(payload.landmarks.front_axle.x, payload.landmarks.front_axle.y)
        if payload.landmarks.front_axle
        else None,
        rear_axle=Point2D(payload.landmarks.rear_axle.x, payload.landmarks.rear_axle.y)
        if payload.landmarks.rear_axle
        else None,
    )
    scale = ScaleCalibration(
        mm_per_px=payload.mm_per_pixel,
        method=CalibrationMethod.MANUAL,
        uncertainty_mm_per_px=payload.mm_per_pixel * payload.scale_uncertainty_ratio,
        plane_roll_deg=0.0,
        plane_yaw_deg=0.0,
    )
    analyzer = BikeCadAnalyzer(scale)
    report = analyzer.analyze(landmarks, facing_direction=payload.facing_direction)

    def _to_measure_schema(m):
        if m is None:
            return None
        return MeasureWithConfidence(
            value=m.value_mm,
            unit="mm",
            confidence=report.confidence_score,
            uncertainty=m.uncertainty_mm,
            source="calibration",
            withheld=not m.is_valid,
            withhold_reason=m.notes if not m.is_valid else None,
        )

    return BikeCadReportResponse(
        stack_bb_to_bar=_to_measure_schema(report.stack),
        reach_bb_to_bar=_to_measure_schema(report.reach),
        saddle_height_bb=_to_measure_schema(report.saddle_height),
        saddle_setback_bb=_to_measure_schema(report.saddle_setback),
        saddle_to_bar_distance=_to_measure_schema(report.saddle_to_bar_distance),
        saddle_to_bar_drop=_to_measure_schema(report.saddle_to_bar_drop),
        saddle_to_hood_distance=_to_measure_schema(report.saddle_to_hood_distance),
        wheelbase=_to_measure_schema(report.wheelbase),
        effective_seat_tube_angle_deg=report.effective_seat_tube_angle_deg,
        confidence_score=report.confidence_score,
        warnings=report.warnings,
    )

