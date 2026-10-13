"""Testes do logging estruturado e da captura de falhas nativas."""

from __future__ import annotations

import faulthandler
import json
import logging
from pathlib import Path

import pytest

from athletemotion_desktop.config.logging_setup import (
    CRASH_FILE_NAME,
    LOG_FILE_NAME,
    MANAGED_HANDLER_ATTRIBUTE,
    enable_crash_dumps,
    setup_logging,
    shutdown_logging,
)

pytestmark = pytest.mark.usefixtures("clean_logging")


def _read_json_lines(log_file: Path) -> list[dict[str, object]]:
    """Lê o ficheiro de log e devolve os registos JSON de cada linha."""
    content = log_file.read_text(encoding="utf-8").strip()
    return [json.loads(line) for line in content.splitlines() if line.strip()]


def test_setup_logging_writes_json_records(tmp_path: Path) -> None:
    """Cada registo deve ser uma linha JSON com os campos usados em diagnóstico."""
    log_file = setup_logging(tmp_path)
    logger = logging.getLogger("teste.json")

    logger.info("Medição %s concluída", "p95")
    shutdown_logging()

    assert log_file == tmp_path / LOG_FILE_NAME
    records = _read_json_lines(log_file)
    assert len(records) == 1

    record = records[0]
    assert record["level"] == "INFO"
    assert record["logger"] == "teste.json"
    assert record["message"] == "Medição p95 concluída"
    assert record["module"] == "test_logging_setup"
    assert isinstance(record["process_id"], int)
    assert record["process_id"] > 0
    assert "T" in str(record["timestamp"])


def test_setup_logging_preserves_foreign_handlers(tmp_path: Path) -> None:
    """A configuração não deve remover handlers de terceiros (por exemplo, do pytest)."""
    foreign_handler = logging.NullHandler()
    root_logger = logging.getLogger()
    root_logger.addHandler(foreign_handler)

    try:
        setup_logging(tmp_path)
        setup_logging(tmp_path)

        managed_handlers = [
            handler
            for handler in root_logger.handlers
            if getattr(handler, MANAGED_HANDLER_ATTRIBUTE, False)
        ]
        assert len(managed_handlers) == 2  # ficheiro + consola, sem duplicação
        assert foreign_handler in root_logger.handlers
    finally:
        root_logger.removeHandler(foreign_handler)
        shutdown_logging()


def test_setup_logging_is_idempotent_for_records(tmp_path: Path) -> None:
    """Chamar `setup_logging` duas vezes não deve duplicar registos no ficheiro."""
    setup_logging(tmp_path)
    setup_logging(tmp_path)
    logging.getLogger("teste.idempotente").warning("uma única linha")
    shutdown_logging()

    records = _read_json_lines(tmp_path / LOG_FILE_NAME)
    assert len(records) == 1


def test_shutdown_logging_flushes_pending_records(tmp_path: Path) -> None:
    """O fecho deve descarregar o buffer (durabilidade das últimas mensagens)."""
    log_file = setup_logging(tmp_path)
    logging.getLogger("teste.fecho").error("mensagem final")

    shutdown_logging()

    assert "mensagem final" in log_file.read_text(encoding="utf-8")


def test_enable_crash_dumps_writes_session_header(tmp_path: Path) -> None:
    """O ficheiro de falhas deve identificar a sessão antes de qualquer crash."""
    crash_handle = enable_crash_dumps(tmp_path)
    try:
        assert faulthandler.is_enabled()

        crash_handle.flush()
        content = (tmp_path / CRASH_FILE_NAME).read_text(encoding="utf-8")
        assert "Sessão iniciada em" in content
    finally:
        faulthandler.disable()
        crash_handle.close()
