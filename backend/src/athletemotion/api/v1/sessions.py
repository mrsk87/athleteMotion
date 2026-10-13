"""Endpoints transacionais para ciclo de vida de sessões de BikeFit (ACID)."""
from __future__ import annotations

import datetime
import json
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from athletemotion.domain.biomechanics import (
    BIOMECHANIC_THRESHOLDS,
    RidingStyle,
    calculate_lemond_saddle_height,
    evaluate_posture_angles,
)
from athletemotion.infrastructure.database import (
    AthleteModel,
    BikeModel,
    FitSessionModel,
    PostureSnapshotModel,
    get_db,
)
from athletemotion.infrastructure.uow import unit_of_work
from athletemotion.schemas.fit import (
    DiagnosticItem,
    FitReportResponse,
    FitSessionCreate,
    FitSessionResponse,
    SnapshotCreate,
    SnapshotResponse,
)
from athletemotion.services.report_generator import generate_bikefit_pdf

router = APIRouter(prefix="/sessions", tags=["sessions"])



@router.post("", response_model=FitSessionResponse, status_code=status.HTTP_201_CREATED)
def start_fit_session(payload: FitSessionCreate):
    """Inicia uma nova sessão de BikeFit atómica vinculada a um ciclista e sua bicicleta."""
    with unit_of_work() as session:
        athlete = session.query(AthleteModel).filter_by(id=payload.athlete_id).first()
        if not athlete:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Atleta não encontrado.")

        bike = session.query(BikeModel).filter_by(id=payload.bike_id).first()
        if not bike:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bicicleta não encontrada.")

        try:
            modality = RidingStyle(bike.bike_type.lower())
        except ValueError:
            modality = RidingStyle.ROAD

        thresholds = BIOMECHANIC_THRESHOLDS[modality]
        theoretical_saddle = calculate_lemond_saddle_height(athlete.inseam_cm)

        fit_session = FitSessionModel(
            athlete_id=athlete.id,
            bike_id=bike.id,
            status="IN_PROGRESS",
            theoretical_saddle_height_cm=theoretical_saddle,
            target_knee_min=thresholds.knee_extension_min,
            target_knee_max=thresholds.knee_extension_max,
            target_back_min=thresholds.torso_inclination_min,
            target_back_max=thresholds.torso_inclination_max,
        )
        session.add(fit_session)
        session.flush()
        return FitSessionResponse.model_validate(fit_session)


@router.post("/{session_id}/snapshot", response_model=SnapshotResponse, status_code=status.HTTP_201_CREATED)
def record_posture_snapshot(session_id: str, payload: SnapshotCreate):
    """Regista uma amostra instantânea dos ângulos articulares durante a análise ao vivo."""
    with unit_of_work() as session:
        fit_session = session.query(FitSessionModel).filter_by(id=session_id).first()
        if not fit_session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada.")

        if fit_session.status != "IN_PROGRESS":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Esta sessão já foi concluída ou cancelada e não aceita novos registos.",
            )

        # Avaliar conformidade do joelho
        is_compliant = False
        if payload.knee_angle:
            is_compliant = (fit_session.target_knee_min <= payload.knee_angle <= fit_session.target_knee_max)

        snapshot = PostureSnapshotModel(
            session_id=session_id,
            frame_index=payload.frame_index,
            knee_angle=payload.knee_angle,
            back_angle=payload.back_angle,
            arm_angle=payload.arm_angle,
            ankle_angle=payload.ankle_angle,
            is_compliant=is_compliant,
            raw_landmarks_json=json.dumps(payload.raw_landmarks) if payload.raw_landmarks else None,
        )
        session.add(snapshot)
        session.flush()
        return SnapshotResponse.model_validate(snapshot)


@router.post("/{session_id}/complete", response_model=FitReportResponse)
def complete_fit_session(session_id: str):
    """Finaliza atipicamente a sessão, consolidando as médias e gerando diagnósticos com ACID."""
    with unit_of_work() as session:
        fit_session = session.query(FitSessionModel).filter_by(id=session_id).first()
        if not fit_session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada.")

        snapshots = session.query(PostureSnapshotModel).filter_by(session_id=session_id).all()
        
        valid_knees = [s.knee_angle for s in snapshots if s.knee_angle is not None and s.knee_angle > 0]
        valid_backs = [s.back_angle for s in snapshots if s.back_angle is not None and s.back_angle > 0]
        valid_arms = [s.arm_angle for s in snapshots if s.arm_angle is not None and s.arm_angle > 0]
        valid_ankles = [s.ankle_angle for s in snapshots if s.ankle_angle is not None and s.ankle_angle > 0]

        avg_knee = round(sum(valid_knees) / len(valid_knees), 1) if valid_knees else None
        avg_back = round(sum(valid_backs) / len(valid_backs), 1) if valid_backs else None
        avg_arm = round(sum(valid_arms) / len(valid_arms), 1) if valid_arms else None
        avg_ankle = round(sum(valid_ankles) / len(valid_ankles), 1) if valid_ankles else None

        fit_session.measured_avg_knee_angle = avg_knee
        fit_session.measured_avg_back_angle = avg_back
        fit_session.measured_avg_arm_angle = avg_arm
        fit_session.measured_avg_ankle_angle = avg_ankle
        fit_session.status = "COMPLETED"
        fit_session.completed_at = datetime.datetime.now(datetime.timezone.utc)

        # Obter atleta e bicicleta
        athlete = fit_session.athlete
        bike = fit_session.bike
        try:
            modality = RidingStyle(bike.bike_type.lower())
        except ValueError:
            modality = RidingStyle.ROAD

        diagnostics_raw = evaluate_posture_angles(
            modality=modality,
            knee_angle=avg_knee,
            back_angle=avg_back,
            arm_angle=avg_arm,
            ankle_angle=avg_ankle,
            current_saddle_height_cm=bike.current_saddle_height_cm,
            theoretical_saddle_height_cm=fit_session.theoretical_saddle_height_cm,
        )

        diagnostics_pydantic = [
            DiagnosticItem(
                joint_name=d.joint_name,
                measured_angle=d.measured_angle,
                ideal_min=d.ideal_min,
                ideal_max=d.ideal_max,
                is_compliant=d.is_compliant,
                status_label_pt=d.status_label_pt,
                status_label_en=d.status_label_en,
                recommendation_pt=d.recommendation_pt,
                recommendation_en=d.recommendation_en,
                adjustment_delta=d.adjustment_delta,
                adjustment_unit=d.adjustment_unit,
            )
            for d in diagnostics_raw
        ]

        compliant_count = sum(1 for d in diagnostics_pydantic if d.is_compliant)
        total_count = len(diagnostics_pydantic) if diagnostics_pydantic else 1
        compliance_percentage = round((compliant_count / total_count) * 100.0, 1)

        summary_dict = {
            "overall_compliance_percentage": compliance_percentage,
            "diagnostics": [d.model_dump() for d in diagnostics_pydantic],
        }
        fit_session.summary_json = json.dumps(summary_dict)

        return FitReportResponse(
            session_id=fit_session.id,
            athlete_name=athlete.name,
            bike_model=bike.brand_model,
            riding_style=bike.bike_type,
            status=fit_session.status,
            theoretical_saddle_height_cm=fit_session.theoretical_saddle_height_cm,
            current_saddle_height_cm=bike.current_saddle_height_cm,
            measured_avg_knee_angle=avg_knee,
            measured_avg_back_angle=avg_back,
            measured_avg_arm_angle=avg_arm,
            measured_avg_ankle_angle=avg_ankle,
            diagnostics=diagnostics_pydantic,
            overall_compliance_percentage=compliance_percentage,
            completed_at=fit_session.completed_at,
        )


@router.get("/{session_id}/report", response_model=FitReportResponse)
def get_fit_session_report(session_id: str, db: Session = Depends(get_db)):
    """Consulta o relatório biomecânico completo de uma sessão finalizada."""
    fit_session = db.query(FitSessionModel).filter_by(id=session_id).first()
    if not fit_session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada.")

    athlete = fit_session.athlete
    bike = fit_session.bike
    try:
        modality = RidingStyle(bike.bike_type.lower())
    except ValueError:
        modality = RidingStyle.ROAD

    diagnostics_raw = evaluate_posture_angles(
        modality=modality,
        knee_angle=fit_session.measured_avg_knee_angle,
        back_angle=fit_session.measured_avg_back_angle,
        arm_angle=fit_session.measured_avg_arm_angle,
        ankle_angle=fit_session.measured_avg_ankle_angle,
        current_saddle_height_cm=bike.current_saddle_height_cm,
        theoretical_saddle_height_cm=fit_session.theoretical_saddle_height_cm,
    )

    diagnostics_pydantic = [
        DiagnosticItem(
            joint_name=d.joint_name,
            measured_angle=d.measured_angle,
            ideal_min=d.ideal_min,
            ideal_max=d.ideal_max,
            is_compliant=d.is_compliant,
            status_label_pt=d.status_label_pt,
            status_label_en=d.status_label_en,
            recommendation_pt=d.recommendation_pt,
            recommendation_en=d.recommendation_en,
            adjustment_delta=d.adjustment_delta,
            adjustment_unit=d.adjustment_unit,
        )
        for d in diagnostics_raw
    ]

    compliant_count = sum(1 for d in diagnostics_pydantic if d.is_compliant)
    total_count = len(diagnostics_pydantic) if diagnostics_pydantic else 1
    compliance_percentage = round((compliant_count / total_count) * 100.0, 1)

    return FitReportResponse(
        session_id=fit_session.id,
        athlete_name=athlete.name,
        bike_model=bike.brand_model,
        riding_style=bike.bike_type,
        status=fit_session.status,
        theoretical_saddle_height_cm=fit_session.theoretical_saddle_height_cm,
        current_saddle_height_cm=bike.current_saddle_height_cm,
        measured_avg_knee_angle=fit_session.measured_avg_knee_angle,
        measured_avg_back_angle=fit_session.measured_avg_back_angle,
        measured_avg_arm_angle=fit_session.measured_avg_arm_angle,
        measured_avg_ankle_angle=fit_session.measured_avg_ankle_angle,
        diagnostics=diagnostics_pydantic,
        overall_compliance_percentage=compliance_percentage,
        completed_at=fit_session.completed_at,
    )


@router.get("/by-athlete/{athlete_id}", response_model=list[FitSessionResponse])
def get_athlete_sessions(athlete_id: str, db: Session = Depends(get_db)):
    """Retorna todas as sessões de BikeFit associadas a um determinado atleta."""
    sessions = (
        db.query(FitSessionModel)
        .filter_by(athlete_id=athlete_id)
        .order_by(FitSessionModel.started_at.desc())
        .all()
    )
    return [FitSessionResponse.model_validate(s) for s in sessions]


@router.get("/{session_id}/pdf")
def download_session_pdf(
    session_id: str,
    lang: str = Query("pt", description="Idioma do relatório (pt ou en)"),
    kops_offset: float | None = Query(None, description="Desvio KOPS em mm"),
    saddle_drop: float | None = Query(None, description="Desnível do selim em cm"),
    cadence_rpm: int | None = Query(None, description="Cadência média em RPM"),
    power_watts: int | None = Query(None, description="Potência média em Watts"),
    db: Session = Depends(get_db),
):
    """Gera e descarrega o Relatório Técnico Oficial de BikeFit em PDF profissional."""
    fit_session = db.query(FitSessionModel).filter_by(id=session_id).first()
    if not fit_session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada.")

    athlete = fit_session.athlete
    bike = fit_session.bike
    is_pt = lang.lower() == "pt"

    try:
        modality = RidingStyle(bike.bike_type.lower()) if bike else RidingStyle.ROAD
    except ValueError:
        modality = RidingStyle.ROAD

    # Diagnósticos angulares
    diagnostics_raw = evaluate_posture_angles(
        modality=modality,
        knee_angle=fit_session.measured_avg_knee_angle,
        back_angle=fit_session.measured_avg_back_angle,
        arm_angle=fit_session.measured_avg_arm_angle,
        ankle_angle=fit_session.measured_avg_ankle_angle,
        current_saddle_height_cm=bike.current_saddle_height_cm if bike else None,
        theoretical_saddle_height_cm=fit_session.theoretical_saddle_height_cm,
    )

    angles_summary = [
        {
            "name": d.joint_name.capitalize(),
            "angle": d.measured_angle,
            "range": f"{d.ideal_min:.0f}° - {d.ideal_max:.0f}°",
            "compliant": d.is_compliant,
            "recommendation": d.recommendation_pt if is_pt else d.recommendation_en,
        }
        for d in diagnostics_raw
    ]

    # Estruturar KOPS se fornecido
    kops_data = None
    if kops_offset is not None:
        from athletemotion.domain.biomechanics import evaluate_kops_alignment

        kd = evaluate_kops_alignment(kops_offset)
        kops_data = {
            "offset_mm": kd.offset_mm,
            "is_aligned": kd.is_aligned,
            "recommendation": kd.recommendation_pt if is_pt else kd.recommendation_en,
        }

    # Estruturar Saddle Drop se fornecido
    drop_data = None
    if saddle_drop is not None:
        from athletemotion.domain.biomechanics import FlexibilityLevel, evaluate_saddle_drop

        flex = FlexibilityLevel(athlete.flexibility.lower()) if athlete and athlete.flexibility else FlexibilityLevel.MEDIUM
        sd = evaluate_saddle_drop(saddle_drop, modality, flex)
        drop_data = {
            "measured_drop_cm": sd.measured_drop_cm,
            "is_compliant": sd.is_compliant,
            "recommendation": sd.recommendation_pt if is_pt else sd.recommendation_en,
        }

    athlete_data = {
        "name": athlete.name if athlete else "Ciclista",
        "height_cm": athlete.height_cm if athlete else "-",
        "inseam_cm": athlete.inseam_cm if athlete else "-",
        "flexibility": athlete.flexibility if athlete else "medium",
    }

    bike_data = {
        "modality": bike.bike_type if bike else "road",
        "current_saddle_height_cm": bike.current_saddle_height_cm if bike else None,
        "crank_length_mm": bike.crank_length_mm if bike else None,
    } if bike else None

    session_data = {
        "cadence_rpm": cadence_rpm if cadence_rpm is not None else "-",
        "power_watts": power_watts if power_watts is not None else "-",
    }

    pdf_bytes = generate_bikefit_pdf(
        athlete_data=athlete_data,
        bike_data=bike_data,
        session_data=session_data,
        angles_summary=angles_summary,
        kops_data=kops_data,
        saddle_drop_data=drop_data,
        language=lang,
    )

    filename = f"bikefit_report_{session_id[:8]}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{session_id}/ai-coach")
def get_ai_coaching_report(
    session_id: str,
    lang: str = Query("pt", description="Idioma do parecer (pt ou en)"),
    kops_offset: float | None = Query(None, description="Desvio KOPS em mm"),
    cadence_rpm: int | None = Query(None, description="Cadência média em RPM"),
    power_watts: int | None = Query(None, description="Potência média em Watts"),
    db: Session = Depends(get_db),
):
    """Retorna um parecer biomecânico narrativo inteligente gerado pelo Treinador de IA."""
    fit_session = db.query(FitSessionModel).filter_by(id=session_id).first()
    if not fit_session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada.")

    athlete = fit_session.athlete
    bike = fit_session.bike
    is_pt = lang.lower() == "pt"

    try:
        modality = RidingStyle(bike.bike_type.lower()) if bike else RidingStyle.ROAD
    except ValueError:
        modality = RidingStyle.ROAD

    diagnostics_raw = evaluate_posture_angles(
        modality=modality,
        knee_angle=fit_session.measured_avg_knee_angle,
        back_angle=fit_session.measured_avg_back_angle,
        arm_angle=fit_session.measured_avg_arm_angle,
        ankle_angle=fit_session.measured_avg_ankle_angle,
        current_saddle_height_cm=bike.current_saddle_height_cm if bike else None,
        theoretical_saddle_height_cm=fit_session.theoretical_saddle_height_cm,
    )

    angles_summary = [
        {
            "name": d.joint_name.capitalize(),
            "angle": d.measured_angle,
            "range": f"{d.ideal_min:.0f}° - {d.ideal_max:.0f}°",
            "compliant": d.is_compliant,
        }
        for d in diagnostics_raw
    ]

    from athletemotion.services.ai_coach import generate_coaching_narrative

    kops_dict = {"offset_mm": kops_offset, "is_aligned": abs(kops_offset or 0) <= 5.0} if kops_offset is not None else None

    athlete_data = {
        "name": athlete.name if athlete else "Ciclista",
        "flexibility": athlete.flexibility if athlete else "medium",
    }
    bike_data = {"modality": bike.bike_type if bike else "road"} if bike else None

    narrative = generate_coaching_narrative(
        athlete_data=athlete_data,
        bike_data=bike_data,
        angles_summary=angles_summary,
        kops_data=kops_dict,
        cadence_rpm=cadence_rpm,
        power_watts=power_watts,
        language=lang,
    )

    return narrative



