"""Portão de desempenho do arranque da aplicação.

Critério de aceitação da D01: `python -m athletemotion_desktop` abre a janela em
menos de 2 s. A medição é feita num subprocesso, desde o início do interpretador
até a janela estar criada e apresentada, incluindo a importação do PyQt6 — o pior
caso realista para o utilizador.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.support.launcher import run_headless_launch

STARTUP_BUDGET_MS = 2000.0

pytestmark = [pytest.mark.perf, pytest.mark.usefixtures("isolated_app_data")]


def test_application_startup_stays_within_budget(isolated_app_data: Path) -> None:
    """O arranque real deve ficar dentro do orçamento de 2 segundos."""
    report = run_headless_launch(isolated_app_data)
    startup_ms = float(report["startup_ms"])

    assert report["exit_code"] == 0
    assert startup_ms < STARTUP_BUDGET_MS, (
        f"arranque em {startup_ms:.0f} ms excede o orçamento de {STARTUP_BUDGET_MS:.0f} ms"
    )
