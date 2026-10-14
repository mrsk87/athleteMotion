"""Serviço de aplicação para ciclo de vida, integridade e relatórios de sessões de BikeFit (ACID).

Desacoplado de frameworks HTTP (FastAPI/Starlette), orquestra transações com a base de dados,
máquina de estados explícita e regras de negócio de relatórios biomecânicos.
"""

from __future__ import annotations

import base64
import datetime
import json
import logging
from dataclasses import asdict
from typing import Any, Literal

from athletemotion.domain.biomechanics import (
    BIOMECHANIC_THRESHOLDS,
    calculate_lemond_saddle_height,
)
from athletemotion.domain.cycle import (
    BatchCycleDetector,
    PedalingSample,
    SessionCycleSummary,
    aggregate_session_summary,
)
from athletemotion.infrastructure.database import (
    AthleteModel,
    BikeModel,
    FitSessionModel,
    PostureSnapshotModel,
)
from athletemotion.infrastructure.uow import unit_of_work
from athletemotion.schemas.fit import (
    FitReportResponse,
    FitSessionCreate,
    FitSessionResponse,
    SnapshotCreate,
    SnapshotResponse,
)
from athletemotion.schemas.pagination import PaginatedResponse
from athletemotion.schemas.session_batch import SnapshotBatchCreate, SnapshotBatchResponse
from athletemotion.services.report_builder import build_diagnostics, resolve_modality

logger = logging.getLogger("athlete_motion.services.session_service")


class SessionNotFoundError(Exception):
    """Exceção levantada quando a sessão solicitada não existe na persistência."""


class AthleteNotFoundError(Exception):
    """Exceção levantada quando o atleta associado à sessão não existe."""


class BikeNotFoundError(Exception):
    """Exceção levantada quando a bicicleta indicada não existe."""


class InvalidSessionStateTransitionError(Exception):
    """Exceção levantada quando se tenta uma transição inválida na máquina de estados da sessão."""


class ConsentMissingError(Exception):
    """Exceção levantada quando uma operação requer consentimento que não foi concedido pelo atleta."""


class SessionService:
    """Orquestrador do ciclo de vida e relatórios de sessões de BikeFit."""

    def start_session(self, payload: FitSessionCreate) -> FitSessionResponse:
        """Inicia uma nova sessão de BikeFit atómica vinculada a um ciclista e sua bicicleta."""
        with unit_of_work() as session:
            athlete = session.query(AthleteModel).filter_by(id=payload.athlete_id).first()
            if not athlete or athlete.deleted_at is not None:
                raise AthleteNotFoundError(f"Atleta com ID '{payload.athlete_id}' não encontrado.")

            bike = session.query(BikeModel).filter_by(id=payload.bike_id).first()
            if not bike:
                raise BikeNotFoundError(f"Bicicleta com ID '{payload.bike_id}' não encontrada.")

            store_landmarks = payload.store_landmarks
            if store_landmarks:
                scopes: list[str] = []
                if athlete.consent_scope:
                    try:
                        parsed = json.loads(athlete.consent_scope)
                        if isinstance(parsed, list):
                            scopes = [str(x) for x in parsed]
                    except Exception:
                        scopes = []
                if "store_landmarks" not in scopes:
                    raise ConsentMissingError(
                        "O atleta não possui consentimento ativo para armazenamento de keypoints biométricos ('store_landmarks')."
                    )

            modality = resolve_modality(bike.bike_type)
            thresholds = BIOMECHANIC_THRESHOLDS[modality]
            theoretical_saddle = calculate_lemond_saddle_height(athlete.inseam_cm)

            fit_session = FitSessionModel(
                athlete_id=athlete.id,
                bike_id=bike.id,
                status="IN_PROGRESS",
                store_landmarks=store_landmarks,
                theoretical_saddle_height_cm=theoretical_saddle,
                target_knee_min=thresholds.knee_extension_min,
                target_knee_max=thresholds.knee_extension_max,
                target_back_min=thresholds.torso_inclination_min,
                target_back_max=thresholds.torso_inclination_max,
            )
            session.add(fit_session)
            session.flush()
            return FitSessionResponse.model_validate(fit_session)

    def add_snapshot(self, session_id: str, payload: SnapshotCreate) -> SnapshotResponse:
        """Regista uma amostra instantânea de ângulos durante a sessão."""
        with unit_of_work() as session:
            fit_session = session.query(FitSessionModel).filter_by(id=session_id).first()
            if not fit_session:
                raise SessionNotFoundError(f"Sessão '{session_id}' não encontrada.")

            if fit_session.status != "IN_PROGRESS":
                raise InvalidSessionStateTransitionError(
                    f"A sessão '{session_id}' encontra-se no estado '{fit_session.status}' "
                    "e não aceita novos registos."
                )

            is_compliant = False
            if payload.knee_angle is not None and payload.knee_angle > 0:
                is_compliant = (
                    fit_session.target_knee_min <= payload.knee_angle <= fit_session.target_knee_max
                )

            snapshot = PostureSnapshotModel(
                session_id=session_id,
                frame_index=payload.frame_index,
                knee_angle=payload.knee_angle,
                back_angle=payload.back_angle,
                arm_angle=payload.arm_angle,
                ankle_angle=payload.ankle_angle,
                is_compliant=is_compliant,
                raw_landmarks_json=json.dumps(payload.raw_landmarks)
                if (fit_session.store_landmarks and payload.raw_landmarks)
                else None,
            )
            session.add(snapshot)
            session.flush()
            return SnapshotResponse.model_validate(snapshot)

    def add_snapshots_batch(
        self, session_id: str, payload: SnapshotBatchCreate
    ) -> SnapshotBatchResponse:
        """Persiste uma lista de snapshots atómicos numa única transação."""
        with unit_of_work() as session:
            fit_session = session.query(FitSessionModel).filter_by(id=session_id).first()
            if not fit_session:
                raise SessionNotFoundError(f"Sessão '{session_id}' não encontrada.")

            if fit_session.status != "IN_PROGRESS":
                raise InvalidSessionStateTransitionError(
                    f"A sessão '{session_id}' encontra-se no estado '{fit_session.status}' "
                    "e não aceita novos registos."
                )

            created_models: list[PostureSnapshotModel] = []
            for item in payload.snapshots:
                is_compliant = False
                if item.knee_angle is not None and item.knee_angle > 0:
                    is_compliant = (
                        fit_session.target_knee_min <= item.knee_angle <= fit_session.target_knee_max
                    )

                snap = PostureSnapshotModel(
                    session_id=session_id,
                    frame_index=item.frame_index,
                    knee_angle=item.knee_angle,
                    back_angle=item.back_angle,
                    arm_angle=item.arm_angle,
                    ankle_angle=item.ankle_angle,
                    is_compliant=is_compliant,
                    raw_landmarks_json=json.dumps(item.raw_landmarks)
                    if (fit_session.store_landmarks and item.raw_landmarks)
                    else None,
                )
                session.add(snap)
                created_models.append(snap)

            session.flush()
            return SnapshotBatchResponse(
                session_id=session_id,
                inserted_count=len(created_models),
                snapshots=[SnapshotResponse.model_validate(m) for m in created_models],
            )

    def complete_session(self, session_id: str) -> FitReportResponse:
        """Conclui a sessão de BikeFit de forma idempotente e calcula métricas completas."""
        with unit_of_work() as session:
            fit_session = session.query(FitSessionModel).filter_by(id=session_id).first()
            if not fit_session:
                raise SessionNotFoundError(f"Sessão '{session_id}' não encontrada.")

            # Idempotência: se já se encontra concluída, devolve o relatório existente sem recalcular
            if fit_session.status == "COMPLETED":
                logger.info("Sessão '%s' já concluída; a devolver relatório idempotente.", session_id)
                return self._assemble_report(fit_session)

            if fit_session.status == "CANCELLED":
                raise InvalidSessionStateTransitionError(
                    f"A sessão '{session_id}' foi cancelada e não pode ser concluída."
                )

            snapshots = session.query(PostureSnapshotModel).filter_by(session_id=session_id).all()

            valid_knees = [
                s.knee_angle for s in snapshots if s.knee_angle is not None and s.knee_angle > 0
            ]
            valid_backs = [
                s.back_angle for s in snapshots if s.back_angle is not None and s.back_angle > 0
            ]
            valid_arms = [
                s.arm_angle for s in snapshots if s.arm_angle is not None and s.arm_angle > 0
            ]
            valid_ankles = [
                s.ankle_angle for s in snapshots if s.ankle_angle is not None and s.ankle_angle > 0
            ]

            avg_knee = round(sum(valid_knees) / len(valid_knees), 1) if valid_knees else None
            avg_back = round(sum(valid_backs) / len(valid_backs), 1) if valid_backs else None
            avg_arm = round(sum(valid_arms) / len(valid_arms), 1) if valid_arms else None
            avg_ankle = round(sum(valid_ankles) / len(valid_ankles), 1) if valid_ankles else None

            # Deteção de ciclos de pedalada (R10)
            pedaling_samples: list[PedalingSample] = []
            for s in snapshots:
                if not s.raw_landmarks_json:
                    continue
                try:
                    raw_dict = json.loads(s.raw_landmarks_json)
                    ankle_data = raw_dict.get("ankle") if isinstance(raw_dict, dict) else None
                    if isinstance(ankle_data, dict) and "y" in ankle_data:
                        ts = float(s.frame_index * (1000.0 / 60.0))
                        pedaling_samples.append(
                            PedalingSample(
                                frame_index=s.frame_index,
                                timestamp_ms=ts,
                                ankle_y=float(ankle_data["y"]),
                                ankle_x=float(ankle_data.get("x", 0.0)),
                                knee_angle=s.knee_angle,
                                torso_angle=s.back_angle,
                                arm_angle=s.arm_angle,
                                ankle_angle=s.ankle_angle,
                                visibility=float(ankle_data.get("visibility", 1.0)),
                            )
                        )
                except Exception as parse_err:
                    logger.debug("Snapshot com landmarks não decodificáveis: %s", parse_err)

            cycle_summary: SessionCycleSummary | None = None
            source: Literal["cycle_detection", "manual_snapshots"] = "manual_snapshots"
            knee_bdc_to_use: float | None = None

            if len(pedaling_samples) >= 15:
                try:
                    detector = BatchCycleDetector()
                    detected_cycles = detector.detect_cycles(pedaling_samples)
                    if detected_cycles:
                        candidate_summary = aggregate_session_summary(detected_cycles)
                        if (
                            candidate_summary.valid_cycles_count >= 5
                            and candidate_summary.knee_bdc_median is not None
                        ):
                            cycle_summary = candidate_summary
                            source = "cycle_detection"
                            knee_bdc_to_use = round(cycle_summary.knee_bdc_median, 1)
                            avg_knee = knee_bdc_to_use
                        else:
                            cycle_summary = candidate_summary
                except Exception as cycle_err:
                    logger.warning("Falha ao analisar ciclos da sessão %s: %s", session_id, cycle_err)

            fit_session.measured_avg_knee_angle = avg_knee
            fit_session.measured_avg_back_angle = avg_back
            fit_session.measured_avg_arm_angle = avg_arm
            fit_session.measured_avg_ankle_angle = avg_ankle
            fit_session.status = "COMPLETED"
            fit_session.completed_at = datetime.datetime.now(datetime.UTC)

            athlete = fit_session.athlete
            bike = fit_session.bike
            modality = resolve_modality(bike.bike_type if bike else None)

            from athletemotion.domain.measures.confidence import calculate_measure_confidence

            cycles_count = cycle_summary.valid_cycles_count if cycle_summary else len(snapshots)
            periodicity = cycle_summary.periodicity_confidence if cycle_summary else (1.0 if snapshots else 0.5)
            measure_conf = calculate_measure_confidence(
                visibility=1.0,
                cycles_count=cycles_count,
                periodicity_confidence=periodicity,
            )

            bundle = build_diagnostics(
                modality=modality,
                knee_angle=avg_knee,
                back_angle=avg_back,
                arm_angle=avg_arm,
                ankle_angle=avg_ankle,
                current_saddle_height_cm=bike.current_saddle_height_cm if bike else None,
                theoretical_saddle_height_cm=fit_session.theoretical_saddle_height_cm,
                knee_bdc=knee_bdc_to_use,
                confidence_score=measure_conf.score,
                withhold_reason=measure_conf.withhold_reason,
            )

            summary_dict: dict[str, Any] = {
                "overall_compliance_percentage": bundle.compliance_percentage or 0.0,
                "diagnostics": [d.model_dump() for d in bundle.diagnostics_pydantic],
                "source": source,
                "cycle_detection": asdict(cycle_summary) if cycle_summary else None,
                "quality_confidence": asdict(measure_conf),
            }
            fit_session.summary_json = json.dumps(summary_dict)
            session.flush()

            return FitReportResponse(
                session_id=fit_session.id,
                athlete_name=athlete.name if athlete else "Atleta",
                bike_model=bike.brand_model if bike else "Bicicleta",
                riding_style=bike.bike_type if bike else "road",
                status=fit_session.status,
                theoretical_saddle_height_cm=fit_session.theoretical_saddle_height_cm,
                current_saddle_height_cm=bike.current_saddle_height_cm if bike else None,
                measured_avg_knee_angle=avg_knee,
                measured_avg_back_angle=avg_back,
                measured_avg_arm_angle=avg_arm,
                measured_avg_ankle_angle=avg_ankle,
                diagnostics=bundle.diagnostics_pydantic,
                overall_compliance_percentage=bundle.compliance_percentage or 0.0,
                completed_at=fit_session.completed_at,
            )

    def cancel_session(self, session_id: str) -> FitSessionResponse:
        """Cancela uma sessão em curso."""
        with unit_of_work() as session:
            fit_session = session.query(FitSessionModel).filter_by(id=session_id).first()
            if not fit_session:
                raise SessionNotFoundError(f"Sessão '{session_id}' não encontrada.")

            if fit_session.status == "COMPLETED":
                raise InvalidSessionStateTransitionError(
                    f"A sessão '{session_id}' já está concluída e não pode ser cancelada."
                )

            if fit_session.status == "CANCELLED":
                return FitSessionResponse.model_validate(fit_session)

            fit_session.status = "CANCELLED"
            session.flush()
            return FitSessionResponse.model_validate(fit_session)

    def get_report(self, session_id: str) -> FitReportResponse:
        """Consulta o relatório oficial consolidado de uma sessão."""
        with unit_of_work() as session:
            fit_session = session.query(FitSessionModel).filter_by(id=session_id).first()
            if not fit_session:
                raise SessionNotFoundError(f"Sessão '{session_id}' não encontrada.")
            return self._assemble_report(fit_session)

    def list_by_athlete(
        self,
        athlete_id: str,
        limit: int = 20,
        cursor: str | None = None,
    ) -> PaginatedResponse[FitSessionResponse]:
        """Lista as sessões de um atleta com suporte a paginação por cursor temporal."""
        with unit_of_work() as session:
            athlete = session.query(AthleteModel).filter_by(id=athlete_id).first()
            if not athlete or athlete.deleted_at is not None:
                raise AthleteNotFoundError(f"Atleta com ID '{athlete_id}' não encontrado.")

            query = session.query(FitSessionModel).filter_by(athlete_id=athlete_id)
            total = query.count()

            if cursor:
                try:
                    decoded = base64.b64decode(cursor.encode("ascii")).decode("utf-8")
                    cursor_ts, cursor_id = decoded.split("|", 1)
                    cursor_dt = datetime.datetime.fromisoformat(cursor_ts)
                    query = query.filter(
                        (FitSessionModel.started_at < cursor_dt)
                        | (
                            (FitSessionModel.started_at == cursor_dt)
                            & (FitSessionModel.id < cursor_id)
                        )
                    )
                except Exception as decode_err:
                    logger.debug("Cursor inválido '%s': %s", cursor, decode_err)

            sessions = (
                query.order_by(FitSessionModel.started_at.desc(), FitSessionModel.id.desc())
                .limit(limit + 1)
                .all()
            )

            has_more = len(sessions) > limit
            page_sessions = sessions[:limit]

            next_cursor = None
            if has_more and page_sessions:
                last = page_sessions[-1]
                raw_cursor = f"{last.started_at.isoformat()}|{last.id}"
                next_cursor = base64.b64encode(raw_cursor.encode("utf-8")).decode("ascii")

            return PaginatedResponse(
                items=[FitSessionResponse.model_validate(s) for s in page_sessions],
                total=total,
                next_cursor=next_cursor,
                limit=limit,
            )

    def _assemble_report(self, fit_session: FitSessionModel) -> FitReportResponse:
        """Constrói a resposta do relatório a partir do estado atual da entidade."""
        athlete = fit_session.athlete
        bike = fit_session.bike
        modality = resolve_modality(bike.bike_type if bike else None)

        bundle = build_diagnostics(
            modality=modality,
            knee_angle=fit_session.measured_avg_knee_angle,
            back_angle=fit_session.measured_avg_back_angle,
            arm_angle=fit_session.measured_avg_arm_angle,
            ankle_angle=fit_session.measured_avg_ankle_angle,
            current_saddle_height_cm=bike.current_saddle_height_cm if bike else None,
            theoretical_saddle_height_cm=fit_session.theoretical_saddle_height_cm,
        )

        return FitReportResponse(
            session_id=fit_session.id,
            athlete_name=athlete.name if athlete else "Atleta",
            bike_model=bike.brand_model if bike else "Bicicleta",
            riding_style=bike.bike_type if bike else "road",
            status=fit_session.status,
            theoretical_saddle_height_cm=fit_session.theoretical_saddle_height_cm,
            current_saddle_height_cm=bike.current_saddle_height_cm if bike else None,
            measured_avg_knee_angle=fit_session.measured_avg_knee_angle,
            measured_avg_back_angle=fit_session.measured_avg_back_angle,
            measured_avg_arm_angle=fit_session.measured_avg_arm_angle,
            measured_avg_ankle_angle=fit_session.measured_avg_ankle_angle,
            diagnostics=bundle.diagnostics_pydantic,
            overall_compliance_percentage=bundle.compliance_percentage or 0.0,
            completed_at=fit_session.completed_at,
        )
