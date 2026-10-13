"""Estilos e temas visuais da aplicação."""

from pathlib import Path


def get_dark_stylesheet() -> str:
    """Carrega o stylesheet QSS escuro padrão da aplicação."""
    qss_path = Path(__file__).parent / "dark.qss"
    if qss_path.exists():
        return qss_path.read_text(encoding="utf-8")
    return ""
