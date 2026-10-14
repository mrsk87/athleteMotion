"""Gestão centralizada de caminhos e diretórios do sistema (ACID compliant).

Permite configuração por variáveis de ambiente para portabilidade entre
Windows (Desktop nativo), Linux (CI/Container) e testes unitários.
"""

from __future__ import annotations

import os
from pathlib import Path


def _resolve_app_data_dir() -> Path:
    """Resolve a pasta de dados persistentes do utilizador."""
    env_dir = os.environ.get("ATHLETE_DATA_DIR")
    if env_dir:
        return Path(env_dir).resolve()

    appdata = os.environ.get("APPDATA")
    if appdata:
        return (Path(appdata) / "AthleteMotion").resolve()

    return (Path.home() / ".athletemotion" / "AthleteMotion").resolve()


def _resolve_models_dir() -> Path:
    """Resolve o diretório onde os modelos de rede neuronal residem."""
    env_dir = os.environ.get("ATHLETE_MODELS_DIR")
    if env_dir:
        return Path(env_dir).resolve()

    # backend/models relativo a backend/src/athletemotion/config/paths.py
    backend_root = Path(__file__).resolve().parents[3]
    return (backend_root / "models").resolve()


def _resolve_database_url(app_data_dir: Path) -> str:
    """Resolve a URL de conexão à base de dados relacional."""
    env_url = os.environ.get("ATHLETE_DB_URL")
    if env_url:
        return env_url

    db_file = app_data_dir / "athlete_motion.db"
    return f"sqlite:///{db_file.as_posix()}"


APP_DATA_DIR: Path = _resolve_app_data_dir()
MODELS_DIR: Path = _resolve_models_dir()
DATABASE_PATH: Path = APP_DATA_DIR / "athlete_motion.db"
DATABASE_URL: str = _resolve_database_url(APP_DATA_DIR)


def ensure_app_directories() -> None:
    """Garante que as pastas de runtime existam fisicamente antes de escrita."""
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
