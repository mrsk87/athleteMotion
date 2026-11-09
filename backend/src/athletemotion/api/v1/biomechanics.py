"""Endpoints para cálculos biomecânicos imediatos, dimensionamento e simulações digitais."""

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
from athletemotion.domain.biomechanics.kinematic_simulator import (
    AdjustmentDeltas,
    AnthropometricProfile,
    BikeGeometryBaseline,
    KinematicSimulator,
)
from athletemotion.domain.measures.joint_torque import JointTorqueEstimator
from athletemotion.schemas.fit import EstimateRequest, TheoreticalFitEstimate
from athletemotion.schemas.joint_torque import (
    PatellofemoralRevolutionRequest,
    PatellofemoralRevolutionResponse,
    PatellofemoralSampleSchema,
)
from athletemotion.schemas.simulator import (
    KinematicRiskWarningSchema,
    Point2DSchema,
    SimulateAdjustmentsRequest,
    SimulateAdjustmentsResponse,
    SimulatedPostureSnapshotSchema,
)

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
        target_back_angle_range=(
            thresholds.torso_inclination_min,
            thresholds.torso_inclination_max,
        ),
    )


@router.post("/simulate-adjustments", response_model=SimulateAdjustmentsResponse)
def simulate_kinematic_adjustments(payload: SimulateAdjustmentsRequest) -> SimulateAdjustmentsResponse:
    """Simula ajustes virtuais de BikeFit (Digital Twin 2D) e prevê alterações articulares."""
    anthro = AnthropometricProfile(
        femur_length_mm=payload.anthropometry.femur_length_mm,
        tibia_length_mm=payload.anthropometry.tibia_length_mm,
        trunk_length_mm=payload.anthropometry.trunk_length_mm,
        arm_length_mm=payload.anthropometry.arm_length_mm,
        forearm_length_mm=payload.anthropometry.forearm_length_mm,
        foot_length_mm=payload.anthropometry.foot_length_mm,
        pelvic_width_mm=payload.anthropometry.pelvic_width_mm,
    )
    baseline = BikeGeometryBaseline(
        saddle_height_mm=payload.baseline_geometry.saddle_height_mm,
        saddle_setback_mm=payload.baseline_geometry.saddle_setback_mm,
        seat_tube_angle_deg=payload.baseline_geometry.seat_tube_angle_deg,
        handlebar_stack_mm=payload.baseline_geometry.handlebar_stack_mm,
        handlebar_reach_mm=payload.baseline_geometry.handlebar_reach_mm,
        crank_length_mm=payload.baseline_geometry.crank_length_mm,
    )
    deltas = AdjustmentDeltas(
        delta_saddle_height_mm=payload.adjustments.delta_saddle_height_mm,
        delta_saddle_setback_mm=payload.adjustments.delta_saddle_setback_mm,
        delta_stem_stack_mm=payload.adjustments.delta_stem_stack_mm,
        delta_stem_reach_mm=payload.adjustments.delta_stem_reach_mm,
        delta_crank_length_mm=payload.adjustments.delta_crank_length_mm,
    )
    simulator = KinematicSimulator(anthro, baseline)
    result = simulator.simulate(deltas)

    def _to_posture_schema(p) -> SimulatedPostureSnapshotSchema:
        return SimulatedPostureSnapshotSchema(
            crank_phase=p.crank_phase,
            crank_angle_deg=p.crank_angle_deg,
            hip_point=Point2DSchema(x=p.hip_point.x, y=p.hip_point.y),
            knee_point=Point2DSchema(x=p.knee_point.x, y=p.knee_point.y),
            ankle_point=Point2DSchema(x=p.ankle_point.x, y=p.ankle_point.y),
            pedal_point=Point2DSchema(x=p.pedal_point.x, y=p.pedal_point.y),
            shoulder_point=Point2DSchema(x=p.shoulder_point.x, y=p.shoulder_point.y),
            elbow_point=Point2DSchema(x=p.elbow_point.x, y=p.elbow_point.y),
            hand_point=Point2DSchema(x=p.hand_point.x, y=p.hand_point.y),
            knee_angle_deg=p.knee_angle_deg,
            hip_angle_deg=p.hip_angle_deg,
            torso_angle_deg=p.torso_angle_deg,
            elbow_angle_deg=p.elbow_angle_deg,
            shoulder_angle_deg=p.shoulder_angle_deg,
        )

    return SimulateAdjustmentsResponse(
        baseline_knee_bdc_deg=result.baseline_knee_bdc_deg,
        simulated_knee_bdc_deg=result.simulated_knee_bdc_deg,
        delta_knee_bdc_deg=result.delta_knee_bdc_deg,
        baseline_hip_tdc_deg=result.baseline_hip_tdc_deg,
        simulated_hip_tdc_deg=result.simulated_hip_tdc_deg,
        delta_hip_tdc_deg=result.delta_hip_tdc_deg,
        baseline_torso_deg=result.baseline_torso_deg,
        simulated_torso_deg=result.simulated_torso_deg,
        delta_torso_deg=result.delta_torso_deg,
        baseline_elbow_deg=result.baseline_elbow_deg,
        simulated_elbow_deg=result.simulated_elbow_deg,
        delta_elbow_deg=result.delta_elbow_deg,
        kops_offset_3h_mm=result.kops_offset_3h_mm,
        bdc_posture=_to_posture_schema(result.bdc_posture),
        tdc_posture=_to_posture_schema(result.tdc_posture),
        power_3h_posture=_to_posture_schema(result.power_3h_posture),
        warnings=[
            KinematicRiskWarningSchema(
                code=w.code,
                severity=w.severity.value,
                joint=w.joint,
                message_pt=w.message_pt,
                message_en=w.message_en,
                measured_value=w.measured_value,
                threshold_value=w.threshold_value,
            )
            for w in result.warnings
        ],
        is_anatomically_feasible=result.is_anatomically_feasible,
        summary_pt=result.summary_pt,
        summary_en=result.summary_en,
    )


@router.post("/patellofemoral-stress", response_model=PatellofemoralRevolutionResponse)
def estimate_patellofemoral_stress(payload: PatellofemoralRevolutionRequest) -> PatellofemoralRevolutionResponse:
    """Estima as forças de compressão patelofemoral e tensão (MPa) ao longo do ciclo de pedalada."""
    estimator = JointTorqueEstimator(
        rider_weight_kg=payload.rider_weight_kg,
        crank_length_mm=payload.crank_length_mm,
    )
    summary = estimator.analyze_cycle_revolution(
        knee_extension_angles_100_points=payload.knee_extension_angles_100_points,
        cadence_rpm=payload.cadence_rpm,
        power_watts=payload.power_watts,
    )
    return PatellofemoralRevolutionResponse(
        peak_compressive_force_n=summary.peak_compressive_force_n,
        peak_stress_mpa=summary.peak_stress_mpa,
        peak_force_crank_angle_deg=summary.peak_force_crank_angle_deg,
        mean_downstroke_force_n=summary.mean_downstroke_force_n,
        risk_level=summary.risk_level.value,
        saddle_height_correlation_note_pt=summary.saddle_height_correlation_note_pt,
        saddle_height_correlation_note_en=summary.saddle_height_correlation_note_en,
        recommendation_pt=summary.recommendation_pt,
        recommendation_en=summary.recommendation_en,
        samples=[
            PatellofemoralSampleSchema(
                crank_angle_deg=s.crank_angle_deg,
                knee_flexion_deg=s.knee_flexion_deg,
                cadence_rpm=s.cadence_rpm,
                power_watts=s.power_watts,
                pedal_force_tangential_n=s.pedal_force_tangential_n,
                knee_extensor_moment_nm=s.knee_extensor_moment_nm,
                quadriceps_force_n=s.quadriceps_force_n,
                patellofemoral_compressive_force_n=s.patellofemoral_compressive_force_n,
                patellofemoral_stress_mpa=s.patellofemoral_stress_mpa,
                risk_level=s.risk_level.value,
            )
            for s in summary.samples
        ],
    )
