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
from tests.support.perf_baseline import Measurement, PerfBaseline

STARTUP_BUDGET_MS = 2000.0

#: Chave da métrica de arranque na baseline.
METRIC = "arranque da aplicação (subprocesso)"

pytestmark = [pytest.mark.perf, pytest.mark.usefixtures("isolated_app_data")]


def test_application_startup_stays_within_budget(
    isolated_app_data: Path, perf_gate: PerfBaseline
) -> None:
    """O arranque real deve ficar dentro do orçamento de 2 segundos.

    A medição é de **amostra única** (um arranque por execução): compara-se com o
    orçamento e não com a baseline, porque o arranque é dominado pela cache de ficheiros
    e pelo antivírus, e uma variação de 15 % entre execuções não diz nada sobre o código.
    """
    report = run_headless_launch(isolated_app_data)
    startup_ms = float(report["startup_ms"])

    assert report["exit_code"] == 0
    perf_gate.check(
        Measurement(
            metric=METRIC,
            p50_ms=startup_ms,
            p95_ms=startup_ms,
            budget_ms=STARTUP_BUDGET_MS,
            samples=1,
            compare=False,
        )
    )
