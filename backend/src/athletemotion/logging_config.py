"""Configuração de logging estruturado (JSON e consola humana) e rotação de ficheiros.

Suporta:
- Formato JSON em produção e ficheiros de log (com timestamp ISO, nível, módulo, request_id, duração).
- Formato colorido e legível para consola local / desenvolvimento.
- Rotação de ficheiros com limite de tamanho (RotatingFileHandler) em APP_DATA_DIR/logs.
"""

from __future__ import annotations

import json
import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from athletemotion.config.paths import APP_DATA_DIR, ensure_app_directories


class JsonLogFormatter(logging.Formatter):
    """Formatador de logging em JSON estruturado com suporte a request_id e telemetria."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry: dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Extrair request_id se injetado no log record
        if hasattr(record, "request_id"):
            log_entry["request_id"] = record.request_id

        # Extrair telemetria adicional se presente em extra
        if hasattr(record, "duration_ms"):
            log_entry["duration_ms"] = record.duration_ms
        if hasattr(record, "engine"):
            log_entry["engine"] = record.engine

        # Adicionar informações de exceção de forma estruturada
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_entry, ensure_ascii=False)


def setup_logging(
    level: str = "INFO",
    json_console: bool = False,
    enable_file_logging: bool = True,
    log_dir: Path | None = None,
) -> None:
    """Inicializa os handlers de logging para toda a aplicação.

    Args:
        level: Nível de severidade base ("DEBUG", "INFO", "WARNING", "ERROR").
        json_console: Se True, emite JSON no stdout; se False, formato legível.
        enable_file_logging: Se True, grava com rotação no diretório de dados da aplicação.
        log_dir: Diretório de logs personalizado (por omissão: APP_DATA_DIR / "logs").
    """
    root_logger = logging.getLogger()
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    root_logger.setLevel(numeric_level)

    # Remover handlers preexistentes para evitar duplicação
    for handler in list(root_logger.handlers):
        root_logger.removeHandler(handler)

    # 1. Console Handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(numeric_level)

    if json_console:
        console_handler.setFormatter(JsonLogFormatter())
    else:
        human_formatter = logging.Formatter(
            fmt="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        console_handler.setFormatter(human_formatter)

    root_logger.addHandler(console_handler)

    # 2. File Handler com rotação
    if enable_file_logging:
        try:
            if log_dir is None:
                ensure_app_directories()
                target_dir = APP_DATA_DIR / "logs"
            else:
                target_dir = log_dir

            target_dir.mkdir(parents=True, exist_ok=True)
            log_file = target_dir / "athletemotion.log"

            file_handler = RotatingFileHandler(
                log_file,
                maxBytes=10 * 1024 * 1024,  # 10 MB por ficheiro
                backupCount=5,
                encoding="utf-8",
            )
            file_handler.setLevel(numeric_level)
            file_handler.setFormatter(JsonLogFormatter())
            root_logger.addHandler(file_handler)
        except (OSError, PermissionError) as err:
            root_logger.warning("Não foi possível inicializar o ficheiro de log: %s", err)

    # Silenciar ruído excessivo de bibliotecas de terceiros em modo INFO
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("multipart").setLevel(logging.WARNING)
