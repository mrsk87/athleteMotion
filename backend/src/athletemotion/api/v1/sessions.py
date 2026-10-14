"""Rotas da API REST para ciclo de vida de sessões de BikeFit (R08).

Camada fina de apresentação HTTP, delegando regras de negócio e transações ACID
ao SessionService e construção de diagnósticos ao ReportBuilder.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from athletemotion.infrastructure.database import FitSessionModel, PostureSnapshotModel, get_db
from athletemotion.schemas.coach import CoachReport
from athletemotion.schemas.fit import (
    FitReportResponse,
    FitSessionCreate,
    FitSessionResponse,
    SnapshotCreate,
    SnapshotResponse,
)
from athletemotion.schemas.session_batch import SnapshotBatchCreate, SnapshotBatchResponse
from athletemotion.services.report_builder import (
    build_diagnostics,
    format_angles_summary_for_report,
    resolve_modality,
)
from athletemotion.services.report_generator import generate_bikefit_pdf
from athletemotion.services.reporting.exports import (
    export_session_csv,
    export_session_json,
)
from athletemotion.services.session_service import (
    AthleteNotFoundError,
    BikeNotFoundError,
    ConsentMissingError,
    InvalidSessionStateTransitionError,
    SessionNotFoundError,
    SessionService,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])
_service = SessionService()


def _handle_service_errors(exc: Exception) -> None:
    """Mapeia exceções de domínio/aplicação para códigos HTTP canónicos RFC 7807."""
    if isinstance(exc, (SessionNotFoundError, AthleteNotFoundError, BikeNotFoundError)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, InvalidSessionStateTransitionError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, ConsentMissingError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    raise exc


@router.post("", response_model=FitSessionResponse, status_code=status.HTTP_201_CREATED)
def start_fit_session(payload: FitSessionCreate) -> FitSessionResponse:
    """Inicia uma nova sessão de BikeFit vinculada a um atleta e bicicleta."""
    try:
        return _service.start_session(payload)
    except Exception as err:
        _handle_service_errors(err)
        raise


@router.post(
    "/{session_id}/snapshot", response_model=SnapshotResponse, status_code=status.HTTP_201_CREATED
)
def record_posture_snapshot(session_id: str, payload: SnapshotCreate) -> SnapshotResponse:
    """Regista um snapshot instantâneo de postura durante a análise."""
    try:
        return _service.add_snapshot(session_id, payload)
    except Exception as err:
        _handle_service_errors(err)
        raise


@router.post(
    "/{session_id}/snapshots:batch",
    response_model=SnapshotBatchResponse,
    status_code=status.HTTP_201_CREATED,
)
def record_posture_snapshots_batch(
    session_id: str, payload: SnapshotBatchCreate
) -> SnapshotBatchResponse:
    """Persiste múltiplos snapshots atómicos numa única transação (máx. 500 itens)."""
    try:
        return _service.add_snapshots_batch(session_id, payload)
    except Exception as err:
        _handle_service_errors(err)
        raise


@router.post("/{session_id}/complete", response_model=FitReportResponse)
def complete_fit_session(session_id: str) -> FitReportResponse:
    """Conclui a sessão de BikeFit de forma idempotente e calcula o relatório completo."""
    try:
        return _service.complete_session(session_id)
    except Exception as err:
        _handle_service_errors(err)
        raise


@router.post("/{session_id}/cancel", response_model=FitSessionResponse)
def cancel_fit_session(session_id: str) -> FitSessionResponse:
    """Cancela uma sessão em curso."""
    try:
        return _service.cancel_session(session_id)
    except Exception as err:
        _handle_service_errors(err)
        raise


@router.get("/{session_id}/report", response_model=FitReportResponse)
def get_fit_session_report(session_id: str) -> FitReportResponse:
    """Consulta o relatório oficial consolidado da sessão."""
    try:
        return _service.get_report(session_id)
    except Exception as err:
        _handle_service_errors(err)
        raise


@router.get("/by-athlete/{athlete_id}")
def get_athlete_sessions(
    athlete_id: str,
    limit: int = Query(20, ge=1, le=100, description="Limite máximo por página"),
    cursor: str | None = Query(None, description="Cursor para página subsequente"),
    legacy: bool = Query(False, description="Se verdadeiro, devolve lista em vez de envelope"),
) -> Any:
    """Retorna o histórico de sessões do atleta com suporte a paginação por cursor."""
    paginated = _service.list_by_athlete(athlete_id, limit=limit, cursor=cursor)
    if legacy:
        return paginated.items
    # Por padrão, para manter compatibilidade com frontend legado se não solicitar cursor:
    if cursor is None:
        return paginated.items
    return paginated


@router.get("/{session_id}/pdf")
def download_session_pdf(
    session_id: str,
    lang: Literal["pt", "en"] = Query("pt", description="Idioma do relatório (pt ou en)"),
    kops_offset: float | None = Query(None, ge=-100.0, le=100.0),
    saddle_drop: float | None = Query(None, ge=-20.0, le=20.0),
    cadence_rpm: int | None = Query(None, ge=20, le=200),
    power_watts: int | None = Query(None, ge=0, le=2500),
    db: Session = Depends(get_db),
) -> Response:
    """Gera e descarrega o Relatório Técnico Oficial de BikeFit em PDF profissional."""
    fit = db.query(FitSessionModel).filter_by(id=session_id).first()
    if not fit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada.")

    athlete, bike = fit.athlete, fit.bike
    modality = resolve_modality(bike.bike_type if bike else None)

    bundle = build_diagnostics(
        modality=modality,
        knee_angle=fit.measured_avg_knee_angle,
        back_angle=fit.measured_avg_back_angle,
        arm_angle=fit.measured_avg_arm_angle,
        ankle_angle=fit.measured_avg_ankle_angle,
        current_saddle_height_cm=bike.current_saddle_height_cm if bike else None,
        theoretical_saddle_height_cm=fit.theoretical_saddle_height_cm,
    )
    angles_summary = format_angles_summary_for_report(bundle.diagnostics_raw, language=lang)

    kops_data = None
    if kops_offset is not None:
        from athletemotion.domain.biomechanics import evaluate_kops_alignment

        kd = evaluate_kops_alignment(kops_offset)
        kops_data = {
            "offset_mm": kd.offset_mm,
            "is_aligned": kd.is_aligned,
            "recommendation": kd.recommendation_pt if lang == "pt" else kd.recommendation_en,
        }

    drop_data = None
    if saddle_drop is not None:
        from athletemotion.domain.biomechanics import FlexibilityLevel, evaluate_saddle_drop

        flex = (
            FlexibilityLevel(athlete.flexibility.lower())
            if athlete and athlete.flexibility
            else FlexibilityLevel.MEDIUM
        )
        sd = evaluate_saddle_drop(saddle_drop, modality, flex)
        drop_data = {
            "measured_drop_cm": sd.measured_drop_cm,
            "is_compliant": sd.is_compliant,
            "recommendation": sd.recommendation_pt if lang == "pt" else sd.recommendation_en,
        }

    athlete_data = {
        "name": athlete.name if athlete else "Ciclista",
        "height_cm": athlete.height_cm if athlete else "-",
        "inseam_cm": athlete.inseam_cm if athlete else "-",
        "flexibility": athlete.flexibility if athlete else "medium",
    }
    bike_data = (
        {
            "modality": bike.bike_type if bike else "road",
            "current_saddle_height_cm": bike.current_saddle_height_cm if bike else None,
            "crank_length_mm": bike.crank_length_mm if bike else None,
        }
        if bike
        else None
    )
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
    safe_id = re.sub(r"[^A-Za-z0-9_-]", "", session_id)[:32] or "session"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="bikefit_report_{safe_id}.pdf"'},
    )


@router.get("/{session_id}/ai-coach", response_model=CoachReport)
def get_ai_coaching_report(
    session_id: str,
    lang: Literal["pt", "en"] = Query("pt", description="Idioma do parecer (pt ou en)"),
    kops_offset: float | None = Query(None, ge=-100.0, le=100.0),
    cadence_rpm: int | None = Query(None, ge=20, le=200),
    power_watts: int | None = Query(None, ge=0, le=2500),
    db: Session = Depends(get_db),
) -> CoachReport:
    """Retorna um parecer biomecânico determinístico estruturado do AI Coach."""
    fit = db.query(FitSessionModel).filter_by(id=session_id).first()
    if not fit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada.")

    athlete, bike = fit.athlete, fit.bike
    modality = resolve_modality(bike.bike_type if bike else None)

    bundle = build_diagnostics(
        modality=modality,
        knee_angle=fit.measured_avg_knee_angle,
        back_angle=fit.measured_avg_back_angle,
        arm_angle=fit.measured_avg_arm_angle,
        ankle_angle=fit.measured_avg_ankle_angle,
        current_saddle_height_cm=bike.current_saddle_height_cm if bike else None,
        theoretical_saddle_height_cm=fit.theoretical_saddle_height_cm,
    )
    angles_summary = [
        {
            "name": d.joint_name.capitalize(),
            "angle": d.measured_angle,
            "range": f"{d.ideal_min:.0f}° - {d.ideal_max:.0f}°",
            "compliant": d.is_compliant,
        }
        for d in bundle.diagnostics_raw
    ]

    from athletemotion.services.ai_coach import generate_coaching_narrative

    kops_dict = (
        {"offset_mm": kops_offset, "is_aligned": abs(kops_offset or 0) <= 5.0}
        if kops_offset is not None
        else None
    )
    athlete_data = {
        "name": athlete.name if athlete else "Ciclista",
        "flexibility": athlete.flexibility if athlete else "medium",
    }
    bike_data = {"modality": bike.bike_type if bike else "road"} if bike else None

    return generate_coaching_narrative(
        athlete_data=athlete_data,
        bike_data=bike_data,
        angles_summary=angles_summary,
        kops_data=kops_dict,
        cadence_rpm=cadence_rpm,
        power_watts=power_watts,
        language=lang,
    )


@router.get("/{session_id}/export.csv")
def export_session_as_csv(
    session_id: str,
    mode: Literal["frames", "cycles", "full"] = Query("full", description="Modo de exportação CSV"),
    db: Session = Depends(get_db),
) -> Response:
    """Exporta as séries temporais e resumos da sessão em formato CSV interoperável."""
    fit = db.query(FitSessionModel).filter_by(id=session_id).first()
    if not fit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada.")

    snapshots = (
        db.query(PostureSnapshotModel)
        .filter_by(session_id=session_id)
        .order_by(PostureSnapshotModel.frame_index.asc())
        .all()
    )

    import contextlib
    import json

    cycles_data = None
    if fit.summary_json:
        with contextlib.suppress(Exception):
            summary = json.loads(fit.summary_json)
            cycles_data = summary.get("cycles")

    csv_content = export_session_csv(
        session=fit,
        snapshots=snapshots,
        cycles=cycles_data,
        mode=mode,
    )
    safe_id = re.sub(r"[^A-Za-z0-9_-]", "", session_id)[:32] or "session"
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="session_{safe_id}.csv"'},
    )


@router.get("/{session_id}/export.json")
def export_session_as_json(
    session_id: str,
    include_landmarks: bool = Query(False, description="Incluir raw_landmarks se consentido"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Exporta os dados completos da sessão em JSON estruturado versionado (schema_version=1.0.0)."""
    fit = db.query(FitSessionModel).filter_by(id=session_id).first()
    if not fit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sessão não encontrada.")

    snapshots = (
        db.query(PostureSnapshotModel)
        .filter_by(session_id=session_id)
        .order_by(PostureSnapshotModel.frame_index.asc())
        .all()
    )

    import contextlib
    import json

    cycles_data = None
    if fit.summary_json:
        with contextlib.suppress(Exception):
            summary = json.loads(fit.summary_json)
            cycles_data = summary.get("cycles")

    return export_session_json(
        session=fit,
        snapshots=snapshots,
        cycles_data=cycles_data,
        include_landmarks=include_landmarks,
    )

