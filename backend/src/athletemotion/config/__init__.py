"""Configurações da aplicação e caminhos do sistema."""

from __future__ import annotations

from athletemotion.config.paths import APP_DATA_DIR, DATABASE_PATH, DATABASE_URL, MODELS_DIR
from athletemotion.config.settings import settings

__all__ = [
    "APP_DATA_DIR",
    "DATABASE_PATH",
    "DATABASE_URL",
    "MODELS_DIR",
    "settings",
]
