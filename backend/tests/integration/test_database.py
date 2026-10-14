"""Testes de integridade de base de dados, migrações, tipos UTC e resiliência ACID (R07)."""

from __future__ import annotations

import datetime
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from athletemotion.infrastructure.backup import perform_db_backup
from athletemotion.infrastructure.database import (
    AthleteModel,
    BikeModel,
    FitSessionModel,
    PostureSnapshotModel,
    force_db_sync,
    init_db,
    optimize_database,
)
from athletemotion.infrastructure.uow import unit_of_work


def test_utc_datetime_type_decorator(db_session: Session):
    """Garante que datas gravadas naive ou aware são sempre recuperadas com timezone UTC."""
    now_utc = datetime.datetime.now(datetime.UTC)
    athlete = AthleteModel(
        name="Ciclista UTC",
        height_cm=180.0,
        inseam_cm=84.0,
        created_at=now_utc,
    )
    db_session.add(athlete)
    db_session.commit()
    db_session.refresh(athlete)

    assert athlete.created_at.tzinfo is not None
    assert athlete.created_at.tzinfo == datetime.UTC
    assert abs((athlete.created_at - now_utc).total_seconds()) < 1.0


def test_atomic_rollback_on_unit_of_work_failure():
    """Garante atomicidade estrita: se ocorrer exceção dentro do UoW, nenhuma alteração persiste."""
    unique_name = f"Rollback Athlete {datetime.datetime.now().timestamp()}"

    with (
        pytest.raises(RuntimeError, match="Simulated crash"),
        unit_of_work() as session,
    ):
        athlete = AthleteModel(
            name=unique_name,
            height_cm=175.0,
            inseam_cm=80.0,
        )
        session.add(athlete)
        session.flush()
        # Forçar erro intencional antes do encerramento do bloco
        raise RuntimeError("Simulated crash")

    # Verificar que o atleta não foi gravado
    with unit_of_work() as verify_session:
        found = verify_session.query(AthleteModel).filter_by(name=unique_name).first()
        assert found is None, "O registo não devia existir após rollback no UoW"


def test_foreign_key_cascade_deletion(db_session: Session):
    """Garante integridade referencial com remoção em cascata (PRAGMA foreign_keys = ON)."""
    athlete = AthleteModel(name="Atleta Cascade", height_cm=172.0, inseam_cm=79.0)
    db_session.add(athlete)
    db_session.flush()

    bike = BikeModel(athlete_id=athlete.id, brand_model="Bike Cascade")
    db_session.add(bike)
    db_session.flush()

    session_model = FitSessionModel(athlete_id=athlete.id, bike_id=bike.id)
    db_session.add(session_model)
    db_session.flush()

    snapshot = PostureSnapshotModel(session_id=session_model.id, knee_angle=148.0)
    db_session.add(snapshot)
    db_session.commit()

    athlete_id = athlete.id
    bike_id = bike.id
    fit_session_id = session_model.id
    snapshot_id = snapshot.id

    # Apagar o atleta
    db_session.delete(athlete)
    db_session.commit()

    # Verificar cascata completa
    assert db_session.query(AthleteModel).filter_by(id=athlete_id).first() is None
    assert db_session.query(BikeModel).filter_by(id=bike_id).first() is None
    assert db_session.query(FitSessionModel).filter_by(id=fit_session_id).first() is None
    assert db_session.query(PostureSnapshotModel).filter_by(id=snapshot_id).first() is None


def test_force_sync_and_optimize():
    """Garante que as operações de checkpoint forçado e PRAGMA optimize executam sem erros."""
    force_db_sync()
    optimize_database()


def test_online_database_backup(tmp_path: Path):
    """Garante que a rotina nativa de backup do SQLite produz uma cópia válida em disco."""
    backup_file = tmp_path / "test_backup.db"
    res = perform_db_backup(backup_file)
    assert res.exists()
    assert res.stat().st_size > 0


def test_init_db_idempotency():
    """Garante que init_db pode ser chamado repetidamente sem erros."""
    init_db()
    init_db()
