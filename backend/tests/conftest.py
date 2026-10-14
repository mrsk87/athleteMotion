"""Configuração global de fixtures Pytest com isolamento estrito de base de dados e segurança.

Garante que nenhuma execução de testes altere ou popule a base de dados
local de desenvolvimento (athlete_motion.db) e que os clientes de teste
possuam credenciais de autenticação Bearer válidas por defeito.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import athletemotion.infrastructure.database as db_module
import athletemotion.infrastructure.uow as uow_module
from athletemotion.api.app import app
from athletemotion.api.security.auth import get_or_create_api_token
from athletemotion.infrastructure.database import Base, get_db

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
def db_session():
    """Fornece uma sessão de base de dados para testes de integração."""
    session = db_module.SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def reset_engine_manager_leases():
    """Garante que as concessões de motores sejam sempre limpas antes e após cada teste."""
    import athletemotion.api.v1.inference_ws as ws_mod

    def _clear_mgr(mgr):
        if mgr is not None:
            for lease in list(mgr._leases.values()):
                lease.close()
            mgr._leases.clear()

    # Limpar antes de iniciar o teste
    _clear_mgr(getattr(app.state, "engine_manager", None))
    _clear_mgr(ws_mod._fallback_engine_manager)
    ws_mod._active_ws_connections.clear()

    yield

    # Limpar após concluir o teste
    _clear_mgr(getattr(app.state, "engine_manager", None))
    _clear_mgr(ws_mod._fallback_engine_manager)
    ws_mod._active_ws_connections.clear()


@pytest.fixture
def client(test_db_isolation):
    """Cliente de teste FastAPI com injeção de dependência isolada e token padrão."""
    from fastapi.testclient import TestClient

    token = get_or_create_api_token()

    def override_get_db():
        db = db_module.SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, headers={"Authorization": f"Bearer {token}"}) as c:
        yield c
    app.dependency_overrides.clear()
