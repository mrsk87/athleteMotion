"""Configuração global de fixtures Pytest com isolamento estrito de base de dados.

Garante que nenhuma execução de testes altere ou popule a base de dados
local de desenvolvimento (athlete_motion.db).
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import athletemotion.infrastructure.database as db_module
import athletemotion.infrastructure.uow as uow_module
from athletemotion.infrastructure.database import Base, get_db
from athletemotion.api.app import app

TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="session", autouse=True)
def test_db_isolation():
    """Cria uma base SQLite isolada em memória compartilhada via StaticPool."""
    test_engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    Base.metadata.create_all(bind=test_engine)

    # Guarda referências originais para restauro
    orig_engine = db_module.engine
    orig_session_local = db_module.SessionLocal
    orig_uow_session = uow_module.SessionLocal

    # Redireciona módulos para o banco em memória
    db_module.engine = test_engine
    db_module.SessionLocal = TestingSessionLocal
    uow_module.SessionLocal = TestingSessionLocal

    yield test_engine

    # Limpeza e restauro de integridade
    Base.metadata.drop_all(bind=test_engine)
    db_module.engine = orig_engine
    db_module.SessionLocal = orig_session_local
    uow_module.SessionLocal = orig_uow_session


@pytest.fixture
def client(test_db_isolation):
    """Cliente de teste FastAPI com injeção de dependência isolada."""
    from fastapi.testclient import TestClient

    def override_get_db():
        db = db_module.SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
