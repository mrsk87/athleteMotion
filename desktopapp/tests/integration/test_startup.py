"""Testes de integração do arranque da aplicação (subprocessos reais).

Estes testes exercitam o caminho de arranque verdadeiro, incluindo o bloqueio de
instância única, o `faulthandler` e o `spawn` do multiprocessing — efeitos de
processo que não devem ocorrer dentro do processo do pytest.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from athletemotion_desktop.config.logging_setup import CRASH_FILE_NAME, LOG_FILE_NAME
from tests.support.launcher import PROJECT_ROOT, run_headless_launch


def _read_json_log(log_file: Path) -> list[dict[str, object]]:
    """Lê um ficheiro de log JSON e devolve os registos, um por linha."""
    content = log_file.read_text(encoding="utf-8").strip()
    return [json.loads(line) for line in content.splitlines() if line.strip()]


def test_headless_startup_succeeds_and_writes_json_logs(isolated_app_data: Path) -> None:
    """O arranque real termina com código 0 e deixa logs JSON em `%APPDATA%`."""
    report = run_headless_launch(isolated_app_data)

    assert report["exit_code"] == 0
    logs_dir = isolated_app_data / "AthleteMotion" / "logs"
    records = _read_json_log(logs_dir / LOG_FILE_NAME)

    assert records, "o arranque deve produzir pelo menos um registo de log"
    messages = [str(record["message"]) for record in records]
    assert any(message.startswith("A iniciar Athlete Motion") for message in messages)
    assert all(
        record["level"] in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"} for record in records
    )

    assert (logs_dir / CRASH_FILE_NAME).is_file()


def test_startup_keeps_instance_lock_file_released(isolated_app_data: Path) -> None:
    """Após o encerramento, o bloqueio de instância única fica removido (novo arranque possível)."""
    first_report = run_headless_launch(isolated_app_data)
    second_report = run_headless_launch(isolated_app_data)

    assert first_report["exit_code"] == 0
    assert second_report["exit_code"] == 0
    assert not (isolated_app_data / "AthleteMotion" / "app.lock").exists()


@pytest.mark.parametrize("shutdown_signal", ["SIGINT", "SIGTERM"])
def test_signal_shuts_down_cleanly(isolated_app_data: Path, shutdown_signal: str) -> None:
    """Um sinal do sistema (Ctrl+C/terminação) encerra a app sem deixar o lock preso.

    O sinal é entregue a partir de uma thread secundária, com a thread principal
    bloqueada no ciclo de eventos do Qt — o cenário real de um `Ctrl+C` numa
    aplicação gráfica.
    """
    report = run_headless_launch(isolated_app_data, signal_on_ready=shutdown_signal)
    app_data_dir = isolated_app_data / "AthleteMotion"
    records = _read_json_log(app_data_dir / "logs" / LOG_FILE_NAME)

    assert report["exit_code"] == 0
    assert float(report["shutdown_ms"]) < 2000, "o encerramento controlado não deve demorar"
    assert any(f"Sinal {shutdown_signal}" in str(record["message"]) for record in records), records
    assert any("encerrado com código 0" in str(record["message"]) for record in records)
    assert not (app_data_dir / "app.lock").exists()


def test_main_aborts_when_onnx_runtimes_conflict(
    isolated_app_data: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Um ambiente com onnxruntime CPU + DirectML impede o arranque (código 2)."""
    import athletemotion_desktop.app as desktop_app

    conflict_message = "CONFLITO CRÍTICO DE AMBIENTE: teste automatizado."
    monkeypatch.setattr(desktop_app, "detect_conflicting_onnx_runtimes", lambda: conflict_message)

    exit_code = desktop_app.main()

    assert exit_code == desktop_app.EXIT_INTEGRITY_ERROR
    log_content = (isolated_app_data / "AthleteMotion" / "logs" / LOG_FILE_NAME).read_text(
        encoding="utf-8"
    )
    assert conflict_message in log_content
    assert '"level": "CRITICAL"' in log_content


def test_native_fault_writes_faulthandler_report(tmp_path: Path) -> None:
    """Uma falha nativa (não apanhável como exceção) fica registada em `LOGS_DIR`.

    A falha é provocada por leitura de um ponteiro nulo — exatamente a classe de
    erro que pode ocorrer dentro de um kernel nativo sem verificação de limites.
    """
    logs_dir = tmp_path / "logs"
    fault_code = (
        "import ctypes, sys\n"
        "from pathlib import Path\n"
        "from athletemotion_desktop.config.logging_setup import enable_crash_dumps\n"
        "enable_crash_dumps(Path(sys.argv[1]))\n"
        "ctypes.string_at(0)\n"
    )

    completed = subprocess.run(
        [sys.executable, "-c", fault_code, str(logs_dir)],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )

    assert completed.returncode != 0, "a falha nativa deve terminar o processo"
    crash_content = (logs_dir / CRASH_FILE_NAME).read_text(encoding="utf-8")
    assert "Sessão iniciada em" in crash_content
    assert re.search(r"fatal exception", crash_content, re.IGNORECASE), crash_content
    assert "string_at" in crash_content
