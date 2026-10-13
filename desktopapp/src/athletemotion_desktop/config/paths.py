"""Gestão de caminhos e diretórios do sistema (%APPDATA% no Windows)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AppPaths:
    """Estrutura imutável com os diretórios operacionais da aplicação."""

    app_data_dir: Path
    logs_dir: Path
    models_dir: Path
    sessions_dir: Path
    settings_file: Path
    hardware_profile_file: Path
    camera_presets_file: Path


def get_app_paths() -> AppPaths:
    """Obtém ou cria os caminhos padronizados da aplicação para o utilizador atual.

    Returns:
        AppPaths com todas as localizações de diretórios prontas para utilização.
    """
    app_data_env = os.environ.get("APPDATA")
    if app_data_env:
        base_dir = Path(app_data_env) / "AthleteMotion"
    else:
        base_dir = Path.home() / ".athletemotion"

    logs_dir = base_dir / "logs"
    models_dir = base_dir / "models"
    sessions_dir = base_dir / "sessions"
    settings_file = base_dir / "settings.json"
    hardware_profile_file = base_dir / "hardware_profile.json"
    camera_presets_file = base_dir / "camera_presets.json"

    # Criação garantida dos diretórios principais
    logs_dir.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(parents=True, exist_ok=True)
    sessions_dir.mkdir(parents=True, exist_ok=True)

    return AppPaths(
        app_data_dir=base_dir,
        logs_dir=logs_dir,
        models_dir=models_dir,
        sessions_dir=sessions_dir,
        settings_file=settings_file,
        hardware_profile_file=hardware_profile_file,
        camera_presets_file=camera_presets_file,
    )
