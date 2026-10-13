"""Configuração partilhada dos testes da aplicação desktop.

Duas regras são aplicadas a toda a suíte:
1. **Sem servidor gráfico**: a plataforma Qt usada é `offscreen` (protocolo §3, regra 8),
   salvo se o ambiente já definir outra.
2. **Sem dados reais**: qualquer teste que escreva definições/logs usa um `%APPDATA%`
   isolado, para nunca tocar em dados do utilizador.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from pathlib import Path

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")


@pytest.fixture
def isolated_app_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Isola `%APPDATA%` num diretório temporário do teste.

    Args:
        tmp_path: diretório temporário fornecido pelo pytest.
        monkeypatch: ajuda a substituir a variável de ambiente sem efeitos colaterais.

    Returns:
        A raiz de `%APPDATA%` isolada. O diretório de dados da aplicação é
        `<raiz>/AthleteMotion` (tal como em produção).
    """
    app_data_root = tmp_path / "AppData"
    app_data_root.mkdir()
    monkeypatch.setenv("APPDATA", str(app_data_root))
    return app_data_root


@pytest.fixture
def clean_logging() -> Iterator[None]:
    """Garante que os handlers de logging geridos pela aplicação são removidos no fim."""
    from athletemotion_desktop.config.logging_setup import shutdown_logging

    shutdown_logging()
    yield
    shutdown_logging()
    logging.getLogger().setLevel(logging.WARNING)
