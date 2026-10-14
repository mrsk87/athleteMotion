"""Serviço de aplicação para conformidade com o RGPD (Artigos 7, 15, 17 e 32).

Garante a gestão do ciclo de vida dos dados do titular:
- Validação e atualização de consentimento informado (Art. 7).
- Minimização de dados biométricos sensíveis (Art. 9).
- Exportação integral portável em formato normalizado (Art. 15 / 20).
- Apagamento lógico (soft) e apagamento definitivo (hard) com purga física no SQLite e WAL (Art. 17).
"""

from __future__ import annotations

import datetime
import json
import logging
from typing import Any

from athletemotion.infrastructure import database as db_module
from athletemotion.infrastructure.database import (
    AthleteModel,
    FitSessionModel,
    PostureSnapshotModel,
)
from athletemotion.infrastructure.uow import unit_of_work
from athletemotion.schemas.fit import AthleteResponse, ConsentUpdate

logger = logging.getLogger("athlete_motion.services.privacy_service")


class AthleteNotFoundError(Exception):
    """Exceção levantada quando o ciclista solicitado não existe ou já foi eliminado."""


class ConsentValidationError(Exception):
    """Exceção levantada quando o consentimento fornecido não cumpre os requisitos legais."""


class PrivacyService:
    """Orquestra operações de privacidade, conformidade com o RGPD e eliminação segura de dados."""

    def update_consent(self, athlete_id: str, payload: ConsentUpdate) -> AthleteResponse:
        """Atualiza a versão e o âmbito do consentimento do titular dos dados.

        Se a autorização de armazenamento de keypoints biométricos ('store_landmarks')
        for revogada, purga imediatamente todos os registos brutos já existentes.
        """
        if not payload.consent_scope or "processing" not in payload.consent_scope:
            raise ConsentValidationError(
                "O consentimento para processamento ('processing') é obrigatório para manter o perfil ativo."
            )

        with unit_of_work() as session:
            athlete = session.query(AthleteModel).filter_by(id=athlete_id).first()
            if not athlete or athlete.deleted_at is not None:
                raise AthleteNotFoundError(f"Atleta com ID '{athlete_id}' não encontrado.")

            was_storing = False
            if athlete.consent_scope:
                try:
                    old_scopes = json.loads(athlete.consent_scope)
                    was_storing = "store_landmarks" in old_scopes
                except Exception:
                    was_storing = False

            now_storing = "store_landmarks" in payload.consent_scope

            # Se o consentimento para landmarks foi revogado: purgar imediatamente dados existentes
            if was_storing and not now_storing:
                logger.info(
                    "Consentimento 'store_landmarks' revogado para o atleta %s. Purgando landmarks brutos...",
                    athlete_id,
                )
                # Obter sessões do atleta
                athlete_sessions = session.query(FitSessionModel).filter_by(athlete_id=athlete_id).all()
                for s in athlete_sessions:
                    s.store_landmarks = False
                    session.query(PostureSnapshotModel).filter_by(session_id=s.id).update(
                        {"raw_landmarks_json": None}, synchronize_session=False
                    )

            athlete.consent_version = payload.consent_version
            athlete.consent_scope = json.dumps(payload.consent_scope)
            athlete.consent_at = datetime.datetime.now(datetime.UTC)
            session.flush()

            return AthleteResponse.model_validate(athlete)

    def export_athlete_data(self, athlete_id: str) -> dict[str, Any]:
        """Gera um pacote de dados completo e portável (Art. 15 e 20 RGPD) em JSON normalizado."""
        with unit_of_work() as session:
            athlete = session.query(AthleteModel).filter_by(id=athlete_id).first()
            if not athlete or athlete.deleted_at is not None:
                raise AthleteNotFoundError(f"Atleta com ID '{athlete_id}' não encontrado.")

            scopes: list[str] = []
            if athlete.consent_scope:
                try:
                    parsed = json.loads(athlete.consent_scope)
                    if isinstance(parsed, list):
                        scopes = [str(item) for item in parsed]
                except Exception:
                    scopes = []

            # 1. Dados Pessoais do Atleta (email é automaticamente decifrado pelo TypeDecorator)
            athlete_data = {
                "id": athlete.id,
                "name": athlete.name,
                "email": athlete.email,
                "height_cm": athlete.height_cm,
                "inseam_cm": athlete.inseam_cm,
                "shoulder_width_cm": athlete.shoulder_width_cm,
                "torso_length_cm": athlete.torso_length_cm,
                "arm_length_cm": athlete.arm_length_cm,
                "flexibility": athlete.flexibility,
                "riding_style": athlete.riding_style,
                "consent_at": athlete.consent_at.isoformat() if athlete.consent_at else None,
                "consent_version": athlete.consent_version,
                "consent_scope": scopes,
                "created_at": athlete.created_at.isoformat(),
            }

            # 2. Bicicletas e Componentes
            bikes_data = []
            for b in athlete.bikes:
                bikes_data.append(
                    {
                        "id": b.id,
                        "bike_type": b.bike_type,
                        "brand_model": b.brand_model,
                        "frame_size_cm": b.frame_size_cm,
                        "top_tube_mm": b.top_tube_mm,
                        "handlebar_width_mm": b.handlebar_width_mm,
                        "handlebar_reach_mm": b.handlebar_reach_mm,
                        "handlebar_drop_mm": b.handlebar_drop_mm,
                        "stem_length_mm": b.stem_length_mm,
                        "crank_length_mm": b.crank_length_mm,
                        "current_saddle_height_cm": b.current_saddle_height_cm,
                        "cleat_position": b.cleat_position,
                        "created_at": b.created_at.isoformat(),
                    }
                )

            # 3. Sessões de BikeFit e Snapshots Biométricos
            sessions_data = []
            for s in athlete.sessions:
                summary_data = None
                if s.summary_json:
                    try:
                        summary_data = json.loads(s.summary_json)
                    except Exception:
                        summary_data = s.summary_json

                snapshots_data = []
                for snap in s.snapshots:
                    raw_landmarks = None
                    if snap.raw_landmarks_json:
                        try:
                            raw_landmarks = json.loads(snap.raw_landmarks_json)
                        except Exception:
                            raw_landmarks = snap.raw_landmarks_json

                    snapshots_data.append(
                        {
                            "id": snap.id,
                            "frame_index": snap.frame_index,
                            "timestamp": snap.timestamp.isoformat(),
                            "knee_angle": snap.knee_angle,
                            "back_angle": snap.back_angle,
                            "arm_angle": snap.arm_angle,
                            "ankle_angle": snap.ankle_angle,
                            "is_compliant": snap.is_compliant,
                            "raw_landmarks": raw_landmarks,
                        }
                    )

                sessions_data.append(
                    {
                        "id": s.id,
                        "bike_id": s.bike_id,
                        "status": s.status,
                        "store_landmarks": s.store_landmarks,
                        "theoretical_saddle_height_cm": s.theoretical_saddle_height_cm,
                        "target_knee_min": s.target_knee_min,
                        "target_knee_max": s.target_knee_max,
                        "target_back_min": s.target_back_min,
                        "target_back_max": s.target_back_max,
                        "measured_avg_knee_angle": s.measured_avg_knee_angle,
                        "measured_avg_back_angle": s.measured_avg_back_angle,
                        "measured_avg_arm_angle": s.measured_avg_arm_angle,
                        "measured_avg_ankle_angle": s.measured_avg_ankle_angle,
                        "summary": summary_data,
                        "started_at": s.started_at.isoformat(),
                        "completed_at": s.completed_at.isoformat() if s.completed_at else None,
                        "snapshots_count": len(snapshots_data),
                        "snapshots": snapshots_data,
                    }
                )

            return {
                "schema_version": "1.0",
                "exported_at": datetime.datetime.now(datetime.UTC).isoformat(),
                "athlete": athlete_data,
                "bikes": bikes_data,
                "sessions": sessions_data,
            }

    def delete_athlete(self, athlete_id: str, hard: bool = False) -> dict[str, Any]:
        """Executa a eliminação de um atleta (Art. 17 RGPD — Direito ao Apagamento).

        Args:
            athlete_id: Identificador único do atleta.
            hard: Se False (padrão), marca `deleted_at` e agenda retenção (soft-delete).
                  Se True, apaga fisicamente os registos e força purga do SQLite e WAL.
        """
        now = datetime.datetime.now(datetime.UTC)

        if not hard:
            # Soft delete atómico
            with unit_of_work() as session:
                athlete = session.query(AthleteModel).filter_by(id=athlete_id).first()
                if not athlete or athlete.deleted_at is not None:
                    raise AthleteNotFoundError(f"Atleta com ID '{athlete_id}' não encontrado.")

                athlete.deleted_at = now
                # Retenção padrão de 30 dias para expiração definitiva
                athlete.retention_until = now + datetime.timedelta(days=30)
                session.flush()

            logger.info("Atleta %s marcado para soft-delete com retenção até 30 dias.", athlete_id)
            return {
                "athlete_id": athlete_id,
                "mode": "soft",
                "deleted_at": now.isoformat(),
                "retention_until": (now + datetime.timedelta(days=30)).isoformat(),
            }

        # Hard delete físico
        with unit_of_work() as session:
            athlete = session.query(AthleteModel).filter_by(id=athlete_id).first()
            if not athlete:
                raise AthleteNotFoundError(f"Atleta com ID '{athlete_id}' não encontrado.")

            session.delete(athlete)
            session.flush()

        # Executar purga física completa no SQLite, assegurando que nada sobra no WAL ou páginas livres
        self._physical_vacuum_and_truncate_wal()

        logger.info("Hard delete executado com sucesso para o atleta %s.", athlete_id)
        return {
            "athlete_id": athlete_id,
            "mode": "hard",
            "deleted_at": now.isoformat(),
        }

    @staticmethod
    def _physical_vacuum_and_truncate_wal() -> None:
        """Executa comandos DDL de purga física no SQLite e descarta páginas mortas no WAL."""
        db_url_str = str(db_module.engine.url)
        if ":memory:" in db_url_str or "%3Amemory%3A" in db_url_str:
            return

        try:
            with db_module.engine.connect() as conn:
                conn.exec_driver_sql("PRAGMA secure_delete = ON;")
                conn.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE);")
                conn.exec_driver_sql("VACUUM;")
        except Exception as exc:
            logger.warning("Aviso durante physical_vacuum_and_truncate_wal: %s", exc)
