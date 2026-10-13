"""Endpoints para cálculos biomecânicos imediatos e dimensionamento teórico de BikeFit."""
from __future__ import annotations

from fastapi import APIRouter

from athletemotion.domain.biomechanics import (
    BIOMECHANIC_THRESHOLDS,
    RidingStyle,
    calculate_109_saddle_height,
    calculate_lemond_saddle_height,
    estimate_frame_size,
    recommend_crank_length,
    recommend_handlebar_width,
)
from athletemotion.schemas.fit import EstimateRequest, TheoreticalFitEstimate

router = APIRouter(prefix="/biomechanics", tags=["biomechanics"])


@router.post("/estimate", response_model=TheoreticalFitEstimate)
def estimate_theoretical_fit(payload: EstimateRequest):
    """Calcula instantaneamente as dimensões teóricas ideais de selim, quadro e componentes."""
    try:
        modality = RidingStyle(payload.riding_style.lower())
    except ValueError:
        modality = RidingStyle.ROAD

    thresholds = BIOMECHANIC_THRESHOLDS[modality]

    return TheoreticalFitEstimate(
        lemond_saddle_height_cm=calculate_lemond_saddle_height(payload.inseam_cm),
        hamley_109_saddle_height_cm=calculate_109_saddle_height(payload.inseam_cm),
        estimated_frame_size_cm=estimate_frame_size(payload.height_cm, payload.inseam_cm, modality),
        recommended_crank_length_mm=recommend_crank_length(payload.inseam_cm),
        recommended_handlebar_width_mm=recommend_handlebar_width(
            payload.shoulder_width_cm,
            payload.height_cm,
            modality,
        ),
        target_knee_angle_range=(thresholds.knee_extension_min, thresholds.knee_extension_max),
        target_back_angle_range=(thresholds.torso_inclination_min, thresholds.torso_inclination_max),
    )

