"""Testes dos avisos inteligentes (diagnósticos) da vista de Definições."""

from __future__ import annotations

from athletemotion_desktop.runtime.hardware.diagnostics import build_diagnostics
from athletemotion_desktop.runtime.hardware.probe import (
    PROBE_SCHEMA_VERSION,
    CpuInfo,
    GpuInfo,
    HardwareInfo,
)


def _hardware_info(
    *,
    gpus: tuple[GpuInfo, ...] = (GpuInfo("Radeon RX 580 Series", "amd", 8.0, "31.0.1", True),),
    ort_providers: tuple[str, ...] = ("DmlExecutionProvider", "CPUExecutionProvider"),
    openvino_devices: tuple[str, ...] = ("CPU",),
    cpu: CpuInfo | None = None,
    warnings: tuple[str, ...] = (),
) -> HardwareInfo:
    """Constrói informação de hardware sintética para os testes."""
    return HardwareInfo(
        schema_version=PROBE_SCHEMA_VERSION,
        generated_at="2026-10-13T12:00:00+00:00",
        cpu=cpu or CpuInfo("Intel(R) Xeon(R) CPU E5-1660 v3", 8, 16, True, False, False),
        gpus=gpus,
        total_ram_gb=32.0,
        ort_providers=ort_providers,
        openvino_devices=openvino_devices,
        warnings=warnings,
        signature="abc123",
    )


def test_no_warnings_for_a_healthy_machine() -> None:
    """Máquina com DirectML, VRAM suficiente e AVX2 não gera ruído."""
    diagnostics = build_diagnostics(_hardware_info(), selected_backend="auto")

    assert diagnostics == ()


def test_missing_onnxruntime_is_a_blocking_error() -> None:
    """Sem ONNX Runtime não há inferência: é erro, não aviso."""
    diagnostics = build_diagnostics(
        _hardware_info(ort_providers=(), openvino_devices=()), selected_backend="auto"
    )

    assert diagnostics[0].is_blocking is True
    assert "ONNX Runtime" in diagnostics[0].message


def test_directml_selected_without_provider_is_an_error() -> None:
    """Escolher DirectML numa máquina sem o provider é um erro explícito."""
    diagnostics = build_diagnostics(
        _hardware_info(ort_providers=("CPUExecutionProvider",)), selected_backend="directml"
    )

    assert any(
        diagnostic.is_blocking and "DmlExecutionProvider" in diagnostic.message
        for diagnostic in diagnostics
    )


def test_openvino_selected_without_devices_is_an_error() -> None:
    """Escolher OpenVINO sem dispositivos detetados é um erro explícito."""
    diagnostics = build_diagnostics(
        _hardware_info(openvino_devices=()), selected_backend="openvino"
    )

    assert any(
        diagnostic.is_blocking and "OpenVINO" in diagnostic.message for diagnostic in diagnostics
    )


def test_auto_without_directml_warns_about_slower_backend() -> None:
    """Em modo automático, a ausência de DirectML degrada o desempenho (aviso)."""
    diagnostics = build_diagnostics(
        _hardware_info(ort_providers=("CPUExecutionProvider",)), selected_backend="auto"
    )

    assert any(
        diagnostic.severity == "warning" and "DirectML" in diagnostic.message
        for diagnostic in diagnostics
    )


def test_low_vram_warns_to_reduce_resolution() -> None:
    """VRAM abaixo de 2 GB obriga a reduzir a resolução de entrada."""
    diagnostics = build_diagnostics(
        _hardware_info(gpus=(GpuInfo("Radeon RX 550", "amd", 1.0, "30.0", True),)),
        selected_backend="directml",
    )

    assert any("VRAM detetada de 1.0 GB" in diagnostic.message for diagnostic in diagnostics)


def test_unknown_vram_is_reported_as_info() -> None:
    """VRAM desconhecida não gera um aviso falso: fica como informação."""
    diagnostics = build_diagnostics(
        _hardware_info(gpus=(GpuInfo("Adaptador Genérico", "unknown", None, None, None),)),
        selected_backend="cpu",
    )

    assert any(
        diagnostic.severity == "info" and "VRAM" in diagnostic.message for diagnostic in diagnostics
    )


def test_no_gpu_at_all_is_acceptable() -> None:
    """Sem GPUs detetadas (ex.: máquina virtual) não há falha: só contexto."""
    diagnostics = build_diagnostics(
        _hardware_info(gpus=(), ort_providers=("CPUExecutionProvider",), openvino_devices=()),
        selected_backend="cpu",
    )

    assert all(not diagnostic.is_blocking for diagnostic in diagnostics)


def test_cpu_without_avx2_warns() -> None:
    """Sem AVX2 o backend de CPU é desaconselhado."""
    diagnostics = build_diagnostics(
        _hardware_info(cpu=CpuInfo("CPU antigo", 2, 4, False, False, False)),
        selected_backend="cpu",
    )

    assert any("AVX2" in diagnostic.message for diagnostic in diagnostics)


def test_integrated_gpu_in_first_position_warns() -> None:
    """A armadilha da iGPU no `device_id` 0 é sinalizada."""
    diagnostics = build_diagnostics(
        _hardware_info(
            gpus=(
                GpuInfo("Intel(R) UHD Graphics 630", "intel", 1.0, "27.20", False),
                GpuInfo("Radeon RX 580 Series", "amd", 8.0, "31.0.1", True),
            )
        ),
        selected_backend="directml",
    )

    assert any("integrada" in diagnostic.message for diagnostic in diagnostics)


def test_runtime_conflict_is_reported_as_error() -> None:
    """A coexistência de onnxruntime CPU com DirectML é erro de configuração."""
    diagnostics = build_diagnostics(
        _hardware_info(),
        selected_backend="directml",
        installed_packages=("onnxruntime", "onnxruntime-directml"),
    )

    assert diagnostics[0].is_blocking is True
    assert "CONFLITO" in diagnostics[0].message


def test_probe_warnings_are_surfaced_as_info() -> None:
    """Os avisos da sonda chegam ao utilizador, sem duplicações."""
    diagnostics = build_diagnostics(
        _hardware_info(warnings=("VRAM impossível de medir (teste).",)),
        selected_backend="directml",
        installed_packages=("onnxruntime-directml",),
    )

    info_messages = [item.message for item in diagnostics if item.severity == "info"]
    assert "VRAM impossível de medir (teste)." in info_messages


def test_diagnostics_are_deduplicated() -> None:
    """Mensagens repetidas aparecem uma única vez."""
    repeated = ("Aviso repetido.", "Aviso repetido.")
    diagnostics = build_diagnostics(
        _hardware_info(warnings=repeated),
        selected_backend="directml",
        installed_packages=("onnxruntime-directml",),
    )

    assert [item.message for item in diagnostics].count("Aviso repetido.") == 1
