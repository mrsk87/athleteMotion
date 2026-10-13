"""Utilitários para executar a aplicação desktop real num subprocesso.

A medição e o arranque são feitos fora do processo do pytest porque implicam
efeitos de processo (bloqueio de instância, `faulthandler`, `spawn`).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
HEADLESS_LAUNCHER = PROJECT_ROOT / "tests" / "support" / "headless_launch.py"
STARTUP_REPORT_PREFIX = "STARTUP_REPORT "


def run_headless_launch(
    app_data_dir: Path,
    *,
    signal_on_ready: str | None = None,
    timeout_seconds: float = 180,
) -> dict[str, float | int]:
    """Executa o lançador headless e devolve o relatório de arranque.

    Args:
        app_data_dir: diretório usado como `%APPDATA%` do subprocesso.
        signal_on_ready: sinal a entregar à aplicação com o ciclo de eventos real
            (por exemplo `SIGINT`). Quando omitido, o ciclo de eventos é substituído
            por um retorno imediato e apenas o arranque é medido.
        timeout_seconds: limite de tempo do subprocesso.

    Returns:
        Relatório com o código de saída, o tempo de arranque em milissegundos e,
        no modo de sinais, o tempo de encerramento em milissegundos.

    Raises:
        AssertionError: se o subprocesso falhar ou não produzir relatório.
    """
    command = [sys.executable, str(HEADLESS_LAUNCHER), "--app-data", str(app_data_dir)]
    if signal_on_ready is not None:
        command += ["--signal-on-ready", signal_on_ready]

    completed = subprocess.run(
        command,
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
    )
    if completed.returncode != 0:
        raise AssertionError(
            f"lançador headless falhou com código {completed.returncode}\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )

    for line in completed.stdout.splitlines():
        if line.startswith(STARTUP_REPORT_PREFIX):
            payload: dict[str, float | int] = json.loads(line[len(STARTUP_REPORT_PREFIX) :])
            return payload

    raise AssertionError(f"relatório de arranque ausente na saída:\n{completed.stdout}")
