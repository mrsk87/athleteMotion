"""Serviço de retenção de dados e purga programada (Art. 5(1)(e) do RGPD - Limitação da Conservação).

Elimina dados de ciclistas com soft-delete cuja janela de retenção tenha expirado,
bem como sessões antigas que ultrapassem o período de conservação padrão (ex.: 24 meses)
sem consentimento explícito para arquivo prolongado ('retention_extended').
"""

from __future__ import annotations

import datetime
import json
import logging

from athletemotion.infrastructure import database as db_module
from athletemotion.infrastructure.database import (
    AthleteModel,
    FitSessionModel,
)
from athletemotion.infrastructure.uow import unit_of_work

logger = logging.getLogger("athlete_motion.services.retention")


def purge_expired_data(
    retention_months: int = 24,
    now_dt: datetime.datetime | None = None,
) -> dict[str, int]:
    """Purga dados caducados em conformidade com as regras de retenção temporal.

    Args:
        retention_months: Prazo máximo de conservação de sessões em meses (padrão 24).
        now_dt: Ponto no tempo de referência (por defeito datetime.now(UTC)).

    Returns:
        Dicionário com a contagem de entidades fisicamente expurgadas.
    """
    now = now_dt or datetime.datetime.now(datetime.UTC)
    purged_athletes = 0
    purged_sessions = 0

    with unit_of_work() as session:
        # 1. Purgar ciclistas com soft-delete cujo prazo de expiração tenha chegado
        expired_athletes = (
            session.query(AthleteModel)
            .filter(
                AthleteModel.deleted_at.is_not(None),
                (AthleteModel.retention_until <= now)
                | (
                    AthleteModel.retention_until.is_(None)
                    & (AthleteModel.deleted_at <= now - datetime.timedelta(days=30))
                ),
            )
            .all()
        )

        for athlete in expired_athletes:
            logger.info("Purgando definitivamente atleta com soft-delete expirado: %s", athlete.id)
            session.delete(athlete)
            purged_athletes += 1

        # 2. Purgar sessões que excederam retention_months e não têm consentimento de extensão
        cutoff_date = now - datetime.timedelta(days=retention_months * 30)
        old_sessions = (
            session.query(FitSessionModel)
            .filter(FitSessionModel.started_at <= cutoff_date)
            .all()
        )

        for fit_session in old_sessions:
            athlete = fit_session.athlete
            extended_retention = False
            if athlete and athlete.consent_scope:
                try:
                    scopes = json.loads(athlete.consent_scope)
                    if isinstance(scopes, list) and "retention_extended" in scopes:
                        extended_retention = True
                except Exception:
                    extended_retention = False

            if not extended_retention:
                logger.info(
                    "Purgando sessão expirada %s (iniciada em %s) sem extensão de retenção.",
                    fit_session.id,
                    fit_session.started_at,
                )
                session.delete(fit_session)
                purged_sessions += 1

        session.flush()

    # 3. Se houve alterações físicas, executa checkpoint do WAL e vacuum se aplicável
    if purged_athletes > 0 or purged_sessions > 0:
        db_url_str = str(db_module.engine.url)
        if ":memory:" not in db_url_str and "%3Amemory%3A" not in db_url_str:
            try:
                with db_module.engine.connect() as conn:
                    conn.exec_driver_sql("PRAGMA secure_delete = ON;")
                    conn.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE);")
                    conn.exec_driver_sql("VACUUM;")
            except Exception as exc:
                logger.warning("Aviso durante vacuum pós-purga de retenção: %s", exc)

    logger.info(
        "Purga de retenção concluída: %d atletas e %d sessões removidas.",
        purged_athletes,
        purged_sessions,
    )
    return {
        "purged_athletes": purged_athletes,
        "purged_sessions": purged_sessions,
    }
