"""Application version loaded from the repository's single source of truth."""
from pathlib import Path

# backend/VERSION
_VERSION_FILE = Path(__file__).resolve().parents[2] / "VERSION"
if not _VERSION_FILE.exists():
    _VERSION_FILE = Path(__file__).with_name("VERSION")

__version__ = _VERSION_FILE.read_text(encoding="utf-8").strip() if _VERSION_FILE.exists() else "0.2.0"
