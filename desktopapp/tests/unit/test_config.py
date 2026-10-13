"""Testes unitários para o subsistema de configurações e caminhos."""

from pathlib import Path

import pytest

from athletemotion_desktop.config.paths import get_app_paths
from athletemotion_desktop.config.settings import AppSettings, load_settings, save_settings


def test_app_paths_creation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verifica se os caminhos são criados corretamente."""
    monkeypatch.setenv("APPDATA", str(tmp_path))
    paths = get_app_paths()

    assert paths.logs_dir.exists()
    assert paths.models_dir.exists()
    assert paths.sessions_dir.exists()
    assert paths.settings_file.parent.exists()


def test_settings_acid_save_and_load(tmp_path: Path) -> None:
    """Valida a persistência atómica ACID das definições via substituição de ficheiro temporário."""
    test_settings_file = tmp_path / "test_settings.json"

    initial_settings = AppSettings()
    initial_settings.camera.target_fps = 60
    initial_settings.inference.confidence_threshold = 0.55

    save_settings(initial_settings, custom_path=test_settings_file)
    assert test_settings_file.exists()

    loaded = load_settings(custom_path=test_settings_file)
    assert loaded.camera.target_fps == 60
    assert loaded.inference.confidence_threshold == 0.55


def test_save_settings_never_leaves_temporary_file(tmp_path: Path) -> None:
    """A gravação atómica não deve deixar ficheiros `.tmp` para trás."""
    test_settings_file = tmp_path / "settings.json"

    save_settings(AppSettings(), custom_path=test_settings_file)

    assert test_settings_file.exists()
    assert list(tmp_path.glob("*.tmp")) == []


def test_load_settings_with_invalid_json_falls_back_to_defaults(tmp_path: Path) -> None:
    """Ficheiro corrompido não pode impedir o arranque: usa-se o padrão e regista-se o problema."""
    corrupted_file = tmp_path / "settings.json"
    corrupted_file.write_text("{ isto não é JSON válido", encoding="utf-8")

    loaded = load_settings(custom_path=corrupted_file)

    assert loaded == AppSettings()


def test_load_settings_with_unknown_language_falls_back_to_defaults(tmp_path: Path) -> None:
    """Um idioma desconhecido é rejeitado pela validação (nunca aceito silenciosamente)."""
    settings_file = tmp_path / "settings.json"
    settings_file.write_text('{"schema_version": 1, "language": "xx_XX"}', encoding="utf-8")

    loaded = load_settings(custom_path=settings_file)

    assert loaded.language == "pt_PT"


def test_load_settings_without_file_returns_defaults(tmp_path: Path) -> None:
    """Sem ficheiro de definições, a aplicação arranca com os valores padrão."""
    assert load_settings(custom_path=tmp_path / "ausente.json") == AppSettings()
