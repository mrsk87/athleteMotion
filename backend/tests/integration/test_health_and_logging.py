"""Testes de integração para observabilidade, logging estruturado e probes de saúde (health)."""

from __future__ import annotations

import json
import logging
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from athletemotion.api.app import app
from athletemotion.api.health import readiness_probe
from athletemotion.logging_config import JsonLogFormatter, setup_logging


def test_liveness_probe_returns_200_alive():
    """Valida que /health/live responde 200 OK sem necessidade de autenticação."""
    client = TestClient(app)
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


def test_readiness_probe_healthy():
    """Valida que /health/ready reporta a saúde da BD e do EngineManager em condições normais."""
    with TestClient(app) as client:
        response = client.get("/health/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ready"
        assert data["database"] == "ok"
        assert "version" in data


def test_readiness_probe_fails_when_db_down():
    """Valida que /health/ready retorna 503 quando a base de dados falha."""
    mock_request = MagicMock()
    mock_request.app.state.engine_manager = MagicMock()
    mock_request.app.state.engine_manager.active_leases = {}
    mock_response = MagicMock()

    # Simular falha de BD interceptando get_db
    with pytest.MonkeyPatch.context() as mp:

        def _failing_get_db():
            raise RuntimeError("Conexão à base de dados falhou intencionalmente")

        mp.setattr("athletemotion.api.health.get_db", _failing_get_db)
        data = readiness_probe(mock_request, mock_response)
        assert data["status"] == "unhealthy"
        assert data["database"] == "unreachable"
        assert mock_response.status_code == 503


def test_json_log_formatter():
    """Valida que o JsonLogFormatter emite JSON válido com timestamp, nível e campos adicionais."""
    formatter = JsonLogFormatter()
    record = logging.LogRecord(
        name="test_logger",
        level=logging.INFO,
        pathname="test.py",
        lineno=10,
        msg="Teste de mensagem estruturada",
        args=(),
        exc_info=None,
    )
    record.request_id = "req-12345"
    record.duration_ms = 42.5

    formatted = formatter.format(record)
    parsed = json.loads(formatted)

    assert parsed["level"] == "INFO"
    assert parsed["logger"] == "test_logger"
    assert parsed["message"] == "Teste de mensagem estruturada"
    assert parsed["request_id"] == "req-12345"
    assert parsed["duration_ms"] == 42.5
    assert "timestamp" in parsed


def test_setup_logging_runs_without_errors(tmp_path):
    """Valida que a inicialização do logging com ficheiro temporário funciona perfeitamente."""
    setup_logging(level="DEBUG", json_console=True, enable_file_logging=True, log_dir=tmp_path)
    log_file = tmp_path / "athletemotion.log"
    logger = logging.getLogger("test_subsystem")
    logger.info("Registo em ficheiro com sucesso")

    # Restaurar logging padrão após teste
    setup_logging(level="INFO", json_console=False, enable_file_logging=False)
    assert log_file.exists()
    content = log_file.read_text(encoding="utf-8")
    assert "Registo em ficheiro com sucesso" in content
