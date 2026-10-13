"""Testes do perfil de hardware (`hardware_profile.json`) e do executor do autotune."""

from __future__ import annotations

import json
import sys
import textwrap
import time
from pathlib import Path

import pytest

from athletemotion_desktop.runtime.hardware.autotune import (
    AutotuneProcess,
    AutotuneProgress,
    autotune_module_available,
    parse_progress_line,
)
from athletemotion_desktop.runtime.hardware.profile import (
    PROFILE_SCHEMA_VERSION,
    AutotuneUnavailableError,
    ProfileState,
    load_profile,
)

VALID_PROFILE = {
    "schema_version": PROFILE_SCHEMA_VERSION,
    "generated_at": "2026-10-13T12:00:00+00:00",
    "hardware_signature": "abc123",
    "ort_version": "1.24.4",
    "recommendation": {
        "backend": "directml",
        "pose_model": "pose_rtmpose_m_halpe26",
        "detector_model": "det_yolo11n",
        "input_resolution": 320,
        "redetect_interval": 12,
        "mode": "real_time",
    },
    "measurements": [
        {
            "backend": "directml",
            "pose_model": "pose_rtmpose_m_halpe26",
            "input_resolution": 320,
            "latency_p50_ms": 7.4,
            "latency_p95_ms": 9.1,
            "fps": 58.2,
        }
    ],
}

STATUS_STUB = textwrap.dedent(
    """
    import json, sys, time
    for step in range(1, 4):
        print(json.dumps({"stage": f"etapa{step}", "fraction": step / 4, "message": f"a medir {step}"}))
        sys.stdout.flush()
        time.sleep(0.05)
    sys.exit(0)
    """
)

HANGING_STUB = textwrap.dedent(
    """
    import json, sys, time
    print(json.dumps({"stage": "longo", "fraction": 0.1, "message": "etapa longa"}))
    sys.stdout.flush()
    time.sleep(60)
    """
)


def _write_profile(profile_file: Path, payload: object) -> Path:
    """Escreve um perfil em disco (aceita dicionário ou texto bruto)."""
    content = payload if isinstance(payload, str) else json.dumps(payload)
    profile_file.write_text(content, encoding="utf-8")
    return profile_file


def test_load_profile_missing_file_is_not_an_error(tmp_path: Path) -> None:
    """Sem perfil, o estado é `MISSING` com instruções claras para o utilizador."""
    status = load_profile(tmp_path / "hardware_profile.json", "abc123")

    assert status.state is ProfileState.MISSING
    assert status.profile is None
    assert status.is_usable is False
    assert "autotune" in status.reason


def test_load_profile_ready_when_signature_matches(tmp_path: Path) -> None:
    """Um perfil da versão atual com a mesma assinatura é usado."""
    profile_file = _write_profile(tmp_path / "hardware_profile.json", VALID_PROFILE)

    status = load_profile(profile_file, "abc123")

    assert status.state is ProfileState.READY
    assert status.is_usable is True
    assert status.profile is not None
    assert status.profile.recommendation.backend == "directml"
    assert status.profile.measurements[0].latency_p95_ms == 9.1


def test_load_profile_requires_new_autotune_when_hardware_changed(tmp_path: Path) -> None:
    """Driver/GPU/CPU diferentes invalidam o perfil (estado `NEEDS_AUTOTUNE`)."""
    profile_file = _write_profile(tmp_path / "hardware_profile.json", VALID_PROFILE)

    status = load_profile(profile_file, "assinatura-diferente")

    assert status.state is ProfileState.NEEDS_AUTOTUNE
    assert status.profile is not None
    assert status.is_usable is False
    assert "mudaram" in status.reason


def test_load_profile_rejects_invalid_json(tmp_path: Path) -> None:
    """JSON corrompido é reportado como inválido, sem exceção."""
    profile_file = _write_profile(tmp_path / "hardware_profile.json", "{ isto não é json")

    status = load_profile(profile_file, "abc123")

    assert status.state is ProfileState.INVALID
    assert "JSON inválido" in status.reason


def test_load_profile_reports_schema_violation(tmp_path: Path) -> None:
    """Um perfil fora do esquema indica o campo problemático ao utilizador."""
    invalid_profile = {**VALID_PROFILE, "recommendation": {"backend": "vulkan"}}
    profile_file = _write_profile(tmp_path / "hardware_profile.json", invalid_profile)

    status = load_profile(profile_file, "abc123")

    assert status.state is ProfileState.INVALID
    assert "esquema" in status.reason
    assert "recommendation.backend" in status.reason


def test_load_profile_rejects_unknown_schema_version(tmp_path: Path) -> None:
    """Uma versão de esquema desconhecida não é interpretada à sorte."""
    future_profile = {**VALID_PROFILE, "schema_version": PROFILE_SCHEMA_VERSION + 1}
    profile_file = _write_profile(tmp_path / "hardware_profile.json", future_profile)

    status = load_profile(profile_file, "abc123")

    assert status.state is ProfileState.INVALID
    assert "v2" in status.reason


def test_parse_progress_line_accepts_valid_json() -> None:
    """Linhas JSON com etapa e fração são convertidas em progresso."""
    progress = parse_progress_line('{"stage": "medir", "fraction": 0.42, "message": "320 px"}')

    assert progress == AutotuneProgress(stage="medir", fraction=0.42, message="320 px")
    assert progress is not None
    assert progress.percent == 42


def test_parse_progress_line_clamps_and_defaults() -> None:
    """Frações fora do intervalo são limitadas e campos em falta têm padrões."""
    progress = parse_progress_line('{"stage": "x", "fraction": 5}')

    assert progress is not None
    assert progress.fraction == 1.0
    assert progress.percent == 100


def test_parse_progress_line_ignores_non_progress_lines() -> None:
    """Logs normais do processo não são confundidos com progresso."""
    assert parse_progress_line("A medir latências...") is None
    assert parse_progress_line("{ json inválido }") is None
    assert parse_progress_line("[1, 2]") is None
    assert parse_progress_line('{"stage": "x", "fraction": "muitos"}') is None


def test_autotune_starts_without_backend_module(tmp_path: Path) -> None:
    """Sem o módulo do backend (R14), o autotune falha de forma explícita e explicada."""
    if autotune_module_available():
        pytest.skip(
            "O módulo de autotune do backend já existe: cenário de indisponibilidade obsoleto."
        )

    autotune = AutotuneProcess(tmp_path / "hardware_profile.json")

    with pytest.raises(AutotuneUnavailableError, match="autotune não está disponível"):
        autotune.start()


def test_autotune_reports_progress_and_completes(tmp_path: Path) -> None:
    """O progresso é lido em paralelo e o processo termina com sucesso."""
    profile_file = tmp_path / "hardware_profile.json"
    autotune = AutotuneProcess(profile_file, command=[sys.executable, "-c", STATUS_STUB])

    autotune.start()
    progress: list[AutotuneProgress] = []
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        latest = autotune.poll_progress()
        if latest is not None:
            progress.append(latest)
        if not autotune.is_running and autotune.poll_progress() is None:
            break
        time.sleep(0.02)

    assert autotune.exit_code == 0
    assert autotune.is_running is False
    assert [item.percent for item in progress] == [25, 50, 75]
    assert progress[-1].message == "a medir 3"


def test_autotune_can_be_cancelled(tmp_path: Path) -> None:
    """Um autotune longo pode ser cancelado e o processo deixa de correr."""
    autotune = AutotuneProcess(
        tmp_path / "hardware_profile.json", command=[sys.executable, "-c", HANGING_STUB]
    )
    autotune.start()

    first_progress: AutotuneProgress | None = None
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and first_progress is None:
        first_progress = autotune.poll_progress()
        time.sleep(0.02)

    autotune.cancel()

    assert first_progress is not None
    assert first_progress.stage == "longo"
    assert autotune.is_running is False
    assert autotune.exit_code is not None


def test_autotune_cancel_without_start_is_noop(tmp_path: Path) -> None:
    """Cancelar antes de arrancar não faz nada (nem rebenta)."""
    autotune = AutotuneProcess(tmp_path / "hardware_profile.json")

    autotune.cancel()

    assert autotune.is_running is False
    assert autotune.exit_code is None
    assert autotune.wait(timeout=0.1) is None
    assert autotune.stderr_tail == ""


def test_autotune_cannot_start_twice(tmp_path: Path) -> None:
    """Lançar duas vezes o mesmo benchmark não é permitido."""
    autotune = AutotuneProcess(
        tmp_path / "hardware_profile.json", command=[sys.executable, "-c", HANGING_STUB]
    )
    autotune.start()
    try:
        with pytest.raises(RuntimeError, match="já está em execução"):
            autotune.start()
    finally:
        autotune.cancel()


def test_autotune_command_defaults_to_backend_module() -> None:
    """O comando por omissão executa o módulo do autotune do backend."""
    autotune = AutotuneProcess(Path("perfil.json"))

    assert autotune.command[1:3] == ("-m", "athletemotion.infrastructure.autotune")
    assert "--json-progress" in autotune.command
