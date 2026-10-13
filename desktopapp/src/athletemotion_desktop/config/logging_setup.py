"""Logging estruturado (JSON) e captura de falhas nativas.

Porquê um módulo separado de `app.py`?
    Este código não importa PyQt, pelo que pode ser exercitado por testes
    unitários puros e reutilizado por scripts de CLI (benchmarks, empacotamento).
    Mantém também a regra de camadas: ferramentas de diagnóstico não dependem
    do ciclo de vida da interface gráfica.
"""

from __future__ import annotations

import faulthandler
import json
import logging
import os
import sys
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import IO, Final

#: Marca os handlers criados por este módulo. Permite configuração idempotente
#: sem remover handlers de terceiros (por exemplo, os do `pytest`/`caplog`).
MANAGED_HANDLER_ATTRIBUTE: Final[str] = "_athletemotion_managed"

LOG_FILE_NAME: Final[str] = "desktopapp.log"
CRASH_FILE_NAME: Final[str] = "crash_fault.log"
MAX_LOG_BYTES: Final[int] = 5 * 1024 * 1024
LOG_BACKUP_COUNT: Final[int] = 5


class JsonLogFormatter(logging.Formatter):
    """Serializa cada registo de log numa única linha JSON.

    O formato é consumido por ferramentas de diagnóstico e pelo cliente de
    observabilidade do backend, evitando dependências de parsing de texto livre.
    """

    def format(self, record: logging.LogRecord) -> str:
        """Converte o registo num objeto JSON, incluindo o rastreio de exceções.

        Args:
            record: registo emitido pelo módulo `logging`.

        Returns:
            Linha JSON terminada por mudança de linha.
        """
        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno,
            "process_id": record.process,
            "thread": record.threadName,
        }
        if record.exc_info is not None:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def setup_logging(
    logs_dir: Path,
    *,
    console_level: int = logging.INFO,
    file_level: int = logging.DEBUG,
) -> Path:
    """Configura o logging da aplicação (consola legível + ficheiro JSON rotativo).

    A função é idempotente: chamadas repetidas substituem apenas os handlers
    geridos por este módulo.

    Args:
        logs_dir: diretório de logs (criado se não existir).
        console_level: nível mínimo apresentado na consola.
        file_level: nível mínimo gravado no ficheiro JSON.

    Returns:
        Caminho do ficheiro de log JSON.

    Raises:
        OSError: se o diretório de logs não puder ser criado ou escrito.
    """
    logs_dir.mkdir(parents=True, exist_ok=True)

    file_handler = RotatingFileHandler(
        logs_dir / LOG_FILE_NAME,
        maxBytes=MAX_LOG_BYTES,
        backupCount=LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setLevel(file_level)
    file_handler.setFormatter(JsonLogFormatter())

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(console_level)
    console_handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] [%(name)s]: %(message)s")
    )

    root_logger = logging.getLogger()
    _remove_managed_handlers(root_logger)
    for handler in (file_handler, console_handler):
        setattr(handler, MANAGED_HANDLER_ATTRIBUTE, True)
        root_logger.addHandler(handler)

    if root_logger.level > logging.INFO or root_logger.level == logging.NOTSET:
        root_logger.setLevel(logging.INFO)

    return logs_dir / LOG_FILE_NAME


def shutdown_logging() -> None:
    """Descarrega e fecha os handlers geridos por este módulo (durabilidade no fecho).

    Garante que as últimas linhas de log são escritas em disco antes de o
    processo terminar, mesmo num encerramento provocado pelo utilizador.
    """
    root_logger = logging.getLogger()
    for handler in list(root_logger.handlers):
        if getattr(handler, MANAGED_HANDLER_ATTRIBUTE, False):
            root_logger.removeHandler(handler)
            handler.flush()
            handler.close()


def enable_crash_dumps(logs_dir: Path) -> IO[str]:
    """Ativa o `faulthandler` para registar falhas nativas do interpretador.

    Uma falha de segmentação (por exemplo, dentro de um kernel ONNX sem
    proteção de memória) não é apanhável como exceção Python; o `faulthandler`
    é a única forma de deixar rasto em disco nesses casos.

    Args:
        logs_dir: diretório onde o relatório de falha será escrito.

    Returns:
        Handle do ficheiro de falhas. Deve permanecer aberto enquanto a
        aplicação estiver viva e ser fechado no encerramento.

    Raises:
        OSError: se o ficheiro de falhas não puder ser aberto.
    """
    logs_dir.mkdir(parents=True, exist_ok=True)
    crash_handle = (logs_dir / CRASH_FILE_NAME).open("a", encoding="utf-8", buffering=1)
    started_at = datetime.now(UTC).isoformat()
    crash_handle.write(f"=== Sessão iniciada em {started_at} (pid {os.getpid()}) ===\n")
    crash_handle.flush()
    faulthandler.enable(file=crash_handle, all_threads=True)
    return crash_handle


def _remove_managed_handlers(root_logger: logging.Logger) -> None:
    """Remove e fecha os handlers criados anteriormente por este módulo."""
    for handler in list(root_logger.handlers):
        if getattr(handler, MANAGED_HANDLER_ATTRIBUTE, False):
            root_logger.removeHandler(handler)
            handler.close()
