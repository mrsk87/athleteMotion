"""Testes da verificação de integridade do ambiente de pacotes."""

from __future__ import annotations

from athletemotion_desktop.config.environment import (
    CPU_ONNX_RUNTIME,
    DIRECTML_ONNX_RUNTIME,
    detect_conflicting_onnx_runtimes,
    normalize_distribution_name,
)


def test_normalize_distribution_name_applies_pep503() -> None:
    """Nomes com pontos/underscores e maiúsculas devem coincidir com a forma canónica."""
    assert normalize_distribution_name("onnxruntime_directml") == DIRECTML_ONNX_RUNTIME
    assert normalize_distribution_name("ONNXRuntime") == CPU_ONNX_RUNTIME
    assert normalize_distribution_name("  onnxruntime.directml  ") == DIRECTML_ONNX_RUNTIME


def test_detect_conflict_returns_none_with_only_directml() -> None:
    """Só `onnxruntime-directml` é o ambiente válido para a GPU AMD."""
    installed = ["onnxruntime-directml", "numpy", "PyQt6"]

    assert detect_conflicting_onnx_runtimes(installed) is None


def test_detect_conflict_returns_none_when_no_onnx_runtime_installed() -> None:
    """Sem nenhum runtime ONNX instalado não há conflito a reportar."""
    assert detect_conflicting_onnx_runtimes(["numpy", "opencv-python"]) is None


def test_detect_conflict_reports_actionable_message() -> None:
    """A coexistência dos dois runtimes é um erro de arranque com correção explícita."""
    installed = ["onnxruntime-directml", "ONNXRuntime", "psutil"]

    message = detect_conflicting_onnx_runtimes(installed)

    assert message is not None
    assert "onnxruntime-directml" in message
    assert "onnxruntime" in message
    assert "uv pip uninstall onnxruntime" in message
    assert "DirectML" in message


def test_detect_conflict_defaults_to_installed_environment() -> None:
    """Sem argumentos, a inspeção usa o ambiente real (que não deve ter conflito)."""
    message = detect_conflicting_onnx_runtimes()

    assert message is None
