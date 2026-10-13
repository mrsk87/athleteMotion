"""Configurações e caminhos da aplicação desktop."""

from athletemotion_desktop.config.paths import AppPaths, get_app_paths
from athletemotion_desktop.config.settings import AppSettings, load_settings, save_settings

__all__ = ["AppPaths", "AppSettings", "get_app_paths", "load_settings", "save_settings"]
