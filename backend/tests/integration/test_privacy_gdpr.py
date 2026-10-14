"""Testes de integração rigorosos para conformidade com o RGPD (R06).

Cobre:
1. Consentimento explícito obrigatório na criação de atletas (Art. 6 e 9).
2. Minimização de dados biométricos sensíveis e bloqueio sem consentimento.
3. Revogação de consentimento com purga imediata de dados brutos passados.
4. Exportação integral em formato estruturado normalizado (Art. 15 e 20).
5. Ciclo de vida de apagamento lógico (soft-delete).
6. Apagamento físico definitivo (hard-delete) com varrimento de ficheiro de disco e WAL.
7. Purga periódica por regras de retenção temporal (Art. 5(1)(e)).
8. Cifra de campo em repouso (Field-Level Encryption com prefixo enc:v1:).
"""

from __future__ import annotations

import datetime
import json
import sqlite3
import uuid
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from athletemotion.infrastructure.database import (
    AthleteModel,
    Base,
    BikeModel,
    FitSessionModel,
    PostureSnapshotModel,
)
from athletemotion.infrastructure.security.cipher import CIPHER_PREFIX, FieldCipher
from athletemotion.infrastructure.uow import unit_of_work
from athletemotion.services.privacy_service import PrivacyService
from athletemotion.services.retention import purge_expired_data


def test_athlete_creation_consent_enforcement(client: TestClient):
    """Criação de ciclista exige consent_version e consent_scope com 'processing'."""
    base_payload = {
        "name": "Ciclista RGPD",
        "email": "rgpd@exemplo.pt",
        "height_cm": 175.0,
        "inseam_cm": 81.0,
        "flexibility": "medium",
        "riding_style": "road",
    }

    # 1. Sem campos de consentimento -> 422
    res_no_consent = client.post("/api/v1/athletes", json=base_payload)
    assert res_no_consent.status_code == 422

    # 2. Com consent_scope vazio -> 422
    p_empty_scope = {**base_payload, "consent_version": "v1.0", "consent_scope": []}
    res_empty_scope = client.post("/api/v1/athletes", json=p_empty_scope)
    assert res_empty_scope.status_code == 422

    # 3. Com consent_scope sem 'processing' -> 422
    p_no_processing = {**base_payload, "consent_version": "v1.0", "consent_scope": ["store_landmarks"]}
    res_no_proc = client.post("/api/v1/athletes", json=p_no_processing)
    assert res_no_proc.status_code == 422

    # 4. Com escopo desconhecido -> 422
    p_invalid_scope = {**base_payload, "consent_version": "v1.0", "consent_scope": ["processing", "unknown_scope"]}
    res_invalid_scope = client.post("/api/v1/athletes", json=p_invalid_scope)
    assert res_invalid_scope.status_code == 422

    # 5. Consentimento válido -> 201
    p_valid = {
        **base_payload,
        "consent_version": "v1.0",
        "consent_scope": ["processing", "store_landmarks"],
    }
    res_valid = client.post("/api/v1/athletes", json=p_valid)
    assert res_valid.status_code == 201
    created = res_valid.json()
    assert created["consent_version"] == "v1.0"
    assert created["consent_scope"] == ["processing", "store_landmarks"]
    assert created["consent_at"] is not None


def test_data_minimization_and_session_consent_enforcement(client: TestClient):
    """Valida minimização de dados e impedimento de guardar keypoints sem autorização."""
    # Atleta com consentimento apenas para 'processing'
    res_ath = client.post(
        "/api/v1/athletes",
        json={
            "name": "Ciclista Básico",
            "height_cm": 180.0,
            "inseam_cm": 83.0,
            "consent_version": "v1.0",
            "consent_scope": ["processing"],
        },
    )
    athlete_id = res_ath.json()["id"]

    res_bk = client.post(
        "/api/v1/bikes",
        json={"athlete_id": athlete_id, "bike_type": "road", "brand_model": "Canyon"},
    )
    bike_id = res_bk.json()["id"]

    # 1. Tentar iniciar sessão com store_landmarks=True sem consentimento do ciclista -> 422
    res_fail_start = client.post(
        "/api/v1/sessions",
        json={"athlete_id": athlete_id, "bike_id": bike_id, "store_landmarks": True},
    )
    assert res_fail_start.status_code == 422
    assert "store_landmarks" in res_fail_start.json()["detail"]

    # 2. Iniciar com store_landmarks=False -> 201
    res_ok_start = client.post(
        "/api/v1/sessions",
        json={"athlete_id": athlete_id, "bike_id": bike_id, "store_landmarks": False},
    )
    assert res_ok_start.status_code == 201
    session_id = res_ok_start.json()["id"]
    assert res_ok_start.json()["store_landmarks"] is False

    # 3. Adicionar snapshot enviando raw_landmarks: como store_landmarks=False, NÃO deve gravar landmarks
    res_snap = client.post(
        f"/api/v1/sessions/{session_id}/snapshot",
        json={
            "frame_index": 1,
            "knee_angle": 145.0,
            "raw_landmarks": [{"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 0.99}],
        },
    )
    assert res_snap.status_code == 201

    with unit_of_work() as db:
        snap_db = db.query(PostureSnapshotModel).filter_by(session_id=session_id).first()
        assert snap_db is not None
        assert snap_db.raw_landmarks_json is None  # Minimização respeitada!


def test_consent_withdrawal_purges_past_landmarks(client: TestClient):
    """Revogação do âmbito 'store_landmarks' purga imediatamente keypoints de sessões anteriores."""
    # 1. Criar atleta com 'store_landmarks'
    res_ath = client.post(
        "/api/v1/athletes",
        json={
            "name": "Ciclista Consentidor",
            "height_cm": 176.0,
            "inseam_cm": 82.0,
            "consent_version": "v1.0",
            "consent_scope": ["processing", "store_landmarks"],
        },
    )
    athlete_id = res_ath.json()["id"]

    res_bk = client.post(
        "/api/v1/bikes",
        json={"athlete_id": athlete_id, "bike_type": "road", "brand_model": "Giant TCR"},
    )
    bike_id = res_bk.json()["id"]

    # 2. Criar sessão com store_landmarks=True
    res_sess = client.post(
        "/api/v1/sessions",
        json={"athlete_id": athlete_id, "bike_id": bike_id, "store_landmarks": True},
    )
    session_id = res_sess.json()["id"]

    # 3. Adicionar snapshots com landmarks
    client.post(
        f"/api/v1/sessions/{session_id}/snapshot",
        json={
            "frame_index": 1,
            "knee_angle": 147.0,
            "raw_landmarks": [{"x": 0.1, "y": 0.2, "z": 0.3}],
        },
    )

    with unit_of_work() as db:
        snap = db.query(PostureSnapshotModel).filter_by(session_id=session_id).first()
        assert snap is not None
        assert snap.raw_landmarks_json is not None

    # 4. Ciclista retira autorização de landmarks via PATCH
    res_patch = client.patch(
        f"/api/v1/athletes/{athlete_id}/consent",
        json={"consent_version": "v1.1", "consent_scope": ["processing"]},
    )
    assert res_patch.status_code == 200
    assert res_patch.json()["consent_scope"] == ["processing"]

    # 5. Validar que na persistência o landmark foi purgado para None e a sessão foi desmarcada
    with unit_of_work() as db:
        sess_db = db.query(FitSessionModel).filter_by(id=session_id).first()
        assert sess_db.store_landmarks is False

        snap_db = db.query(PostureSnapshotModel).filter_by(session_id=session_id).first()
        assert snap_db.raw_landmarks_json is None


def test_export_athlete_data_format(client: TestClient):
    """GET /athletes/{id}/export devolve pacote completo e estruturado em conformidade com Art. 15 e 20."""
    res_ath = client.post(
        "/api/v1/athletes",
        json={
            "name": "Ciclista Para Exportar",
            "email": "exportar@exemplo.pt",
            "height_cm": 182.0,
            "inseam_cm": 85.0,
            "consent_version": "v1.0",
            "consent_scope": ["processing", "store_landmarks"],
        },
    )
    athlete_id = res_ath.json()["id"]

    res_bk = client.post(
        "/api/v1/bikes",
        json={"athlete_id": athlete_id, "bike_type": "road", "brand_model": "BMC Teammachine"},
    )
    bike_id = res_bk.json()["id"]

    res_sess = client.post(
        "/api/v1/sessions",
        json={"athlete_id": athlete_id, "bike_id": bike_id, "store_landmarks": True},
    )
    session_id = res_sess.json()["id"]

    client.post(
        f"/api/v1/sessions/{session_id}/snapshot",
        json={"frame_index": 0, "knee_angle": 149.0, "raw_landmarks": [{"x": 1.0, "y": 2.0}]},
    )

    res_export = client.get(f"/api/v1/athletes/{athlete_id}/export")
    assert res_export.status_code == 200
    bundle = res_export.json()

    assert bundle["schema_version"] == "1.0"
    assert "exported_at" in bundle
    assert bundle["athlete"]["name"] == "Ciclista Para Exportar"
    assert bundle["athlete"]["email"] == "exportar@exemplo.pt"  # Decifrado
    assert len(bundle["bikes"]) == 1
    assert bundle["bikes"][0]["brand_model"] == "BMC Teammachine"
    assert len(bundle["sessions"]) == 1
    assert bundle["sessions"][0]["id"] == session_id
    assert len(bundle["sessions"][0]["snapshots"]) == 1
    assert bundle["sessions"][0]["snapshots"][0]["raw_landmarks"] == [{"x": 1.0, "y": 2.0}]


def test_soft_delete_lifecycle(client: TestClient):
    """Soft-delete oculta o ciclista de listagens e consultas e bloqueia novas operações."""
    res_ath = client.post(
        "/api/v1/athletes",
        json={
            "name": "Ciclista Soft Delete",
            "height_cm": 170.0,
            "inseam_cm": 78.0,
            "consent_version": "v1.0",
            "consent_scope": ["processing"],
        },
    )
    athlete_id = res_ath.json()["id"]

    # 1. Apagar em modo soft (padrão)
    res_del = client.delete(f"/api/v1/athletes/{athlete_id}")
    assert res_del.status_code == 200
    assert res_del.json()["mode"] == "soft"
    assert "retention_until" in res_del.json()

    # 2. Não deve aparecer na listagem
    res_list = client.get("/api/v1/athletes")
    assert not any(a["id"] == athlete_id for a in res_list.json())

    # 3. GET direto devolve 404
    res_get = client.get(f"/api/v1/athletes/{athlete_id}")
    assert res_get.status_code == 404

    # 4. Tentar iniciar sessão devolve 404
    res_sess = client.post(
        "/api/v1/sessions",
        json={"athlete_id": athlete_id, "bike_id": "fake_bike_id"},
    )
    assert res_sess.status_code == 404


def test_hard_delete_and_physical_disk_sweep(tmp_path: Path):
    """Hard-delete remove registos, trunca WAL e não deixa vestígios no ficheiro .db em disco."""
    db_file = tmp_path / "gdpr_physical_test.db"
    db_url = f"sqlite:///{db_file.as_posix()}"

    disk_engine = create_engine(
        db_url,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=disk_engine)

    Session = sessionmaker(bind=disk_engine)

    unique_name = "SegredoCiclistaIndiscreto"
    unique_email = "indiscreto_super_secreto_99@seguro.pt"

    with Session() as s:
        ath = AthleteModel(
            id=str(uuid.uuid4()),
            name=unique_name,
            email=unique_email,
            height_cm=181.0,
            inseam_cm=84.0,
            consent_version="v1.0",
            consent_scope=json.dumps(["processing", "store_landmarks"]),
            consent_at=datetime.datetime.now(datetime.UTC),
        )
        bk = BikeModel(
            id=str(uuid.uuid4()),
            athlete_id=ath.id,
            bike_type="road",
            brand_model="Trek Emonda",
        )
        s.add(ath)
        s.add(bk)
        s.commit()
        athlete_id = ath.id

    # Inspecionar diretamente a base de dados via sqlite3 bruto
    conn = sqlite3.connect(str(db_file))
    cur = conn.cursor()
    cur.execute("SELECT email FROM athletes WHERE id = ?", (athlete_id,))
    row = cur.fetchone()
    assert row is not None
    # Campo email em repouso deve estar cifrado!
    assert row[0].startswith(CIPHER_PREFIX)
    assert unique_email not in row[0]
    conn.close()

    # Executar hard-delete utilizando o serviço
    import athletemotion.infrastructure.database as db_mod
    import athletemotion.infrastructure.uow as uow_mod

    orig_engine = db_mod.engine
    orig_sess = db_mod.SessionLocal
    orig_uow_sess = uow_mod.SessionLocal
    try:
        db_mod.engine = disk_engine
        db_mod.SessionLocal = Session
        uow_mod.SessionLocal = Session

        service = PrivacyService()
        result = service.delete_athlete(athlete_id, hard=True)
        assert result["mode"] == "hard"

        # Validar via consulta relacional
        with Session() as s:
            assert s.query(AthleteModel).filter_by(id=athlete_id).first() is None
            assert s.query(BikeModel).filter_by(athlete_id=athlete_id).first() is None

        # Varrer os bytes do ficheiro em disco (.db e .db-wal)
        db_bytes = db_file.read_bytes()
        assert unique_name.encode("utf-8") not in db_bytes
        assert unique_email.encode("utf-8") not in db_bytes

        wal_file = Path(f"{db_file.as_posix()}-wal")
        if wal_file.exists():
            wal_bytes = wal_file.read_bytes()
            assert unique_name.encode("utf-8") not in wal_bytes
            assert unique_email.encode("utf-8") not in wal_bytes
    finally:
        db_mod.engine = orig_engine
        db_mod.SessionLocal = orig_sess
        uow_mod.SessionLocal = orig_uow_sess
        disk_engine.dispose()


def test_retention_purge_expired_data():
    """Valida expurgo de perfis soft-deleted expirados e sessões com mais de 24 meses."""
    now = datetime.datetime.now(datetime.UTC)

    with unit_of_work() as session:
        # 1. Atleta soft-deleted mas ainda dentro do prazo (não deve ser expurgado)
        a_active_soft = AthleteModel(
            name="Atleta Soft Recente",
            height_cm=175.0,
            inseam_cm=80.0,
            deleted_at=now - datetime.timedelta(days=5),
            retention_until=now + datetime.timedelta(days=25),
        )
        # 2. Atleta soft-deleted cujo retention_until já passou (deve ser expurgado)
        a_expired_soft = AthleteModel(
            name="Atleta Soft Expirado",
            height_cm=175.0,
            inseam_cm=80.0,
            deleted_at=now - datetime.timedelta(days=40),
            retention_until=now - datetime.timedelta(days=1),
        )
        # 3. Atleta ativo com consentimento padrão
        a_standard = AthleteModel(
            name="Atleta Padrão",
            height_cm=175.0,
            inseam_cm=80.0,
            consent_scope=json.dumps(["processing"]),
        )
        # 4. Atleta com retenção estendida
        a_extended = AthleteModel(
            name="Atleta Extensão",
            height_cm=175.0,
            inseam_cm=80.0,
            consent_scope=json.dumps(["processing", "retention_extended"]),
        )
        session.add_all([a_active_soft, a_expired_soft, a_standard, a_extended])
        session.flush()

        bike_std = BikeModel(athlete_id=a_standard.id, bike_type="road", brand_model="Bike Std")
        bike_ext = BikeModel(athlete_id=a_extended.id, bike_type="road", brand_model="Bike Ext")
        session.add_all([bike_std, bike_ext])
        session.flush()

        # Sessão de há 30 meses (ultrapassa 24 meses)
        s_old_std = FitSessionModel(
            athlete_id=a_standard.id,
            bike_id=bike_std.id,
            started_at=now - datetime.timedelta(days=30 * 30),
        )
        # Sessão de há 30 meses mas para atleta com retention_extended
        s_old_ext = FitSessionModel(
            athlete_id=a_extended.id,
            bike_id=bike_ext.id,
            started_at=now - datetime.timedelta(days=30 * 30),
        )
        session.add_all([s_old_std, s_old_ext])
        session.flush()

        expired_athlete_id = a_expired_soft.id
        old_std_session_id = s_old_std.id
        old_ext_session_id = s_old_ext.id

    # Executar purga
    stats = purge_expired_data(retention_months=24, now_dt=now)
    assert stats["purged_athletes"] >= 1
    assert stats["purged_sessions"] >= 1

    with unit_of_work() as session:
        # Atleta expirado foi purgado
        assert session.query(AthleteModel).filter_by(id=expired_athlete_id).first() is None
        # Sessão antiga sem extensão foi purgada
        assert session.query(FitSessionModel).filter_by(id=old_std_session_id).first() is None
        # Sessão antiga com extensão foi preservada
        assert session.query(FitSessionModel).filter_by(id=old_ext_session_id).first() is not None


def test_field_cipher_encryption_at_rest():
    """Valida que FieldCipher cifra com prefixo enc:v1: e que a base de dados armazena o ciphertext."""
    cipher = FieldCipher()

    plain = "ciclista_secreto@exemplo.com"
    encrypted = cipher.encrypt(plain)
    assert encrypted is not None
    assert encrypted.startswith(CIPHER_PREFIX)
    assert encrypted != plain

    # Idempotência
    assert cipher.encrypt(encrypted) == encrypted

    # Decifra
    decrypted = cipher.decrypt(encrypted)
    assert decrypted == plain

    # Fallback para strings não cifradas (legadas)
    assert cipher.decrypt("texto_em_claro") == "texto_em_claro"
    assert cipher.decrypt(None) is None
