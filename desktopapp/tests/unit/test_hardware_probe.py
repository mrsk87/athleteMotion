"""Testes da sonda de hardware, com saídas simuladas de WMI/PowerShell.

Nenhum teste toca no hardware real: as consultas externas são substituídas por
respostas gravadas, garantindo determinismo em qualquer máquina (CI incluída).
"""

from __future__ import annotations

import importlib
import json
import subprocess
from collections.abc import Callable
from dataclasses import replace

import pytest

from athletemotion_desktop.runtime.hardware import probe

POWERSHELL_TWO_GPUS = json.dumps(
    [
        {
            "Name": "Intel(R) UHD Graphics 630",
            "AdapterRAM": 1073741824,
            "DriverVersion": "27.20.100.9030",
            "VideoProcessor": "Intel(R) UHD Graphics Family",
            "PNPDeviceID": "PCI\\VEN_8086&DEV_3E98",
        },
        {
            "Name": "Radeon RX 580 Series",
            "AdapterRAM": 4293918720,
            "DriverVersion": "31.0.21924.61",
            "VideoProcessor": "AMD Radeon Graphics Processor",
            "PNPDeviceID": "PCI\\VEN_1002&DEV_67DF",
        },
    ]
)

REGISTRY_VRAM = json.dumps([{"DriverDesc": "Radeon RX 580 Series", "QWMemorySize": 8589934592}])


def test_parse_video_controller_json_accepts_single_and_list() -> None:
    """A saída pode vir como objeto (uma GPU) ou lista (várias GPUs)."""
    single_record = json.dumps({"Name": "Radeon RX 580", "AdapterRAM": 1073741824})

    assert len(probe.parse_video_controller_json(single_record)) == 1
    assert len(probe.parse_video_controller_json(POWERSHELL_TWO_GPUS)) == 2
    assert probe.parse_video_controller_json(None) == ()
    assert probe.parse_video_controller_json("") == ()
    assert probe.parse_video_controller_json("   ") == ()


def test_parse_video_controller_json_ignores_invalid_content() -> None:
    """JSON inválido ou de tipo inesperado degrada para lista vazia (sem exceção)."""
    assert probe.parse_video_controller_json("{ isto não é json }") == ()
    assert probe.parse_video_controller_json('"apenas texto"') == ()
    assert probe.parse_video_controller_json("[1, 2, 3]") == ()


def test_parse_video_controller_csv_reads_wmic_output() -> None:
    """O caminho alternativo (wmic) deve ser interpretado pelo cabeçalho."""
    csv_output = (
        "Node,AdapterRAM,DriverVersion,Name,PNPDeviceID,VideoProcessor\n"
        "PC,1073741824,31.0.21924.61,Radeon RX 580 Series,PCI\\VEN_1002&DEV_67DF,AMD\n"
        "linha incompleta\n"
    )

    records = probe.parse_video_controller_csv(csv_output)

    assert len(records) == 1
    assert records[0]["Name"] == "Radeon RX 580 Series"


def test_parse_video_controller_csv_without_content() -> None:
    """Sem saída não há registos."""
    assert probe.parse_video_controller_csv(None) == ()
    assert probe.parse_video_controller_csv("") == ()
    assert probe.parse_video_controller_csv("so-cabecalho") == ()


def test_classify_gpu_vendor_and_discrete_detection() -> None:
    """Fabricante e tipo de GPU são inferidos a partir do nome comercial."""
    assert probe.classify_gpu_vendor("Radeon RX 580 Series") == "amd"
    assert probe.classify_gpu_vendor("NVIDIA GeForce RTX 3060") == "nvidia"
    assert probe.classify_gpu_vendor("Intel(R) UHD Graphics 630") == "intel"
    assert probe.classify_gpu_vendor("Microsoft Basic Display Adapter") == "microsoft"
    assert probe.classify_gpu_vendor("Adaptador Desconhecido") == "unknown"

    assert probe.is_likely_discrete_gpu("Intel(R) UHD Graphics 630", "intel") is False
    assert probe.is_likely_discrete_gpu("Radeon RX 580 Series", "amd") is True
    assert probe.is_likely_discrete_gpu("Adaptador Desconhecido", "unknown") is None


def test_parse_gpu_records_without_gpu() -> None:
    """Um sistema sem GPU detetada devolve lista vazia, sem falhar."""
    gpus, warnings = probe.parse_gpu_records(())

    assert gpus == ()
    assert warnings == ()


def test_parse_gpu_records_flags_truncated_wmi_vram() -> None:
    """A VRAM truncada pelo WMI (4095 MiB) é reportada como desconhecida."""
    gpus, warnings = probe.parse_gpu_records(probe.parse_video_controller_json(POWERSHELL_TWO_GPUS))

    rx_580 = next(gpu for gpu in gpus if gpu.vendor == "amd")
    intel = next(gpu for gpu in gpus if gpu.vendor == "intel")

    assert rx_580.vram_gb is None
    assert intel.vram_gb == 1.0
    assert intel.is_discrete is False
    assert any("limite de 32 bits" in warning for warning in warnings)


def test_registry_vram_recovers_the_real_value() -> None:
    """O registo (`qwMemorySize`) corrige o valor truncado do WMI."""
    records = probe.parse_registry_vram_json(REGISTRY_VRAM)
    gpus, warnings = probe.parse_gpu_records(
        [{"Name": "Radeon RX 580 Series", "AdapterRAM": "4293918720"}],
        records,
    )

    assert gpus[0].vram_gb == 8.0
    assert any("registo" in warning for warning in warnings)


def test_registry_vram_parsing_rejects_invalid_input() -> None:
    """Entradas incompletas ou inválidas são descartadas."""
    assert probe.parse_registry_vram_json(None) == ()
    assert probe.parse_registry_vram_json("não é json") == ()
    assert probe.parse_registry_vram_json(json.dumps({"DriverDesc": "X"})) == ()

    # Um valor zero é preservado na leitura, mas descartado na correspondência (nunca
    # se apresenta 0 GB como se fosse uma medição real).
    zero_vram_records = probe.parse_registry_vram_json(
        json.dumps([{"DriverDesc": "Radeon RX 580 Series", "QWMemorySize": 0}])
    )
    assert len(zero_vram_records) == 1
    assert probe.match_registry_vram_gb("Radeon RX 580 Series", zero_vram_records) is None


def test_registry_vram_match_requires_unambiguous_name() -> None:
    """Só é usado um valor do registo quando a correspondência é inequívoca."""
    ambiguous = (
        {"DriverDesc": "Radeon RX 580 Series", "QWMemorySize": "8589934592"},
        {"DriverDesc": "Radeon RX 580", "QWMemorySize": "4294967296"},
    )

    assert probe.match_registry_vram_gb("Radeon RX 580 Series", ambiguous) is None
    assert probe.match_registry_vram_gb("Radeon RX 580 Series", ambiguous[:1]) == 8.0
    assert probe.match_registry_vram_gb("GeForce RTX 4090", ambiguous[:1]) is None
    assert probe.match_registry_vram_gb("", ambiguous[:1]) is None


def test_registry_vram_match_ignores_non_numeric_memory() -> None:
    """Um valor de VRAM ilegível no registo não é convertido em número inventado."""
    records = ({"DriverDesc": "Radeon RX 580 Series", "QWMemorySize": "desconhecido"},)

    assert probe.match_registry_vram_gb("Radeon RX 580 Series", records) is None


def test_probe_cpu_reads_flags_and_cores(monkeypatch: pytest.MonkeyPatch) -> None:
    """As flags de vetorização são traduzidas para os campos do `CpuInfo`."""
    monkeypatch.setattr(
        probe,
        "probe_total_ram_gb",
        lambda: 31.9,
    )
    cpu_info, warnings = probe.probe_cpu()

    assert cpu_info.physical_cores is None or cpu_info.physical_cores >= 1
    assert cpu_info.has_avx2 in (True, False)
    assert isinstance(warnings, tuple)


def test_probe_cpu_degrades_when_cpuinfo_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sem `py-cpuinfo` o CPU é caracterizado parcialmente, com aviso em vez de erro."""
    import builtins

    # O `__import__` real é reencaminhado tal como recebido; a assinatura exata não
    # interessa ao teste, o que interessa é o nome pedido.
    real_import: Callable[..., object] = builtins.__import__

    def failing_import(name: str, *args: object, **kwargs: object) -> object:
        if name == "cpuinfo":
            raise ImportError("cpuinfo indisponível (teste)")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", failing_import)

    cpu_info, warnings = probe.probe_cpu()

    assert cpu_info.has_avx2 is None
    assert any("py-cpuinfo indisponível" in warning for warning in warnings)


def test_probe_ort_providers_without_onnxruntime(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sem ONNX Runtime a lista fica vazia e o aviso explica que não há inferência."""

    def failing_import(name: str) -> object:
        raise ImportError(f"{name} ausente (teste)")

    # `probe` faz `import importlib`: o mesmo módulo, logo o mesmo efeito real.
    monkeypatch.setattr(importlib, "import_module", failing_import)

    providers, warnings = probe.probe_ort_providers()

    assert providers == ()
    assert any("ONNX Runtime não está instalado" in warning for warning in warnings)


def test_probe_ort_providers_reports_available_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Com ONNX Runtime instalado, os providers são listados como texto."""

    class FakeOnnxRuntime:
        @staticmethod
        def get_available_providers() -> list[str]:
            return ["DmlExecutionProvider", "CPUExecutionProvider"]

    monkeypatch.setattr(importlib, "import_module", lambda _name: FakeOnnxRuntime())

    providers, warnings = probe.probe_ort_providers()

    assert providers == ("DmlExecutionProvider", "CPUExecutionProvider")
    assert warnings == ()


def test_probe_ort_providers_handles_broken_installation(monkeypatch: pytest.MonkeyPatch) -> None:
    """Uma instalação presente mas inutilizável não deve fazer cair a sondagem."""

    class BrokenOnnxRuntime:
        @staticmethod
        def get_available_providers() -> list[str]:
            raise RuntimeError("binários nativos em falta")

    monkeypatch.setattr(importlib, "import_module", lambda _name: BrokenOnnxRuntime())

    providers, warnings = probe.probe_ort_providers()

    assert providers == ()
    assert any("Falha ao listar os providers" in warning for warning in warnings)


def test_probe_openvino_devices_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    """OpenVINO é opcional: ausente não gera aviso, presente lista dispositivos."""

    def missing_import(_name: str) -> object:
        raise ImportError("openvino ausente (teste)")

    monkeypatch.setattr(importlib, "import_module", missing_import)
    assert probe.probe_openvino_devices() == ((), ())

    class FakeCore:
        def __init__(self) -> None:
            self.available_devices = ["CPU", "GPU.0"]

    class FakeOpenVino:
        Core = FakeCore

    monkeypatch.setattr(importlib, "import_module", lambda _name: FakeOpenVino())
    devices, warnings = probe.probe_openvino_devices()

    assert devices == ("CPU", "GPU.0")
    assert warnings == ()


def test_probe_openvino_devices_reports_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """Uma falha ao consultar dispositivos produz aviso, não exceção."""

    class FakeCore:
        def __init__(self) -> None:
            raise RuntimeError("driver indisponível")

    class FakeOpenVino:
        Core = FakeCore

    monkeypatch.setattr(importlib, "import_module", lambda _name: FakeOpenVino())

    devices, warnings = probe.probe_openvino_devices()

    assert devices == ()
    assert any("Falha ao consultar os dispositivos OpenVINO" in warning for warning in warnings)


def test_run_command_returns_none_for_missing_executable() -> None:
    """Um comando inexistente não é executado nem levanta exceção."""
    assert probe._run_command(["comando-que-nao-existe-xyz", "--version"]) is None


def test_run_command_accepts_output_despite_error_exit_code() -> None:
    """Erros não-terminantes do PowerShell (código 1) com saída útil são aproveitados."""
    import sys

    output = probe._run_command(
        [sys.executable, "-c", "import sys; print('dados uteis'); sys.exit(1)"]
    )

    assert output is not None
    assert "dados uteis" in output


def test_run_command_returns_none_when_nothing_is_produced() -> None:
    """Sem saída, um erro do comando significa falha (nada a aproveitar)."""
    import sys

    assert probe._run_command([sys.executable, "-c", "import sys; sys.exit(3)"]) is None


def test_build_hardware_signature_changes_with_driver() -> None:
    """A assinatura muda quando o driver da GPU muda (invalida o perfil de autotune)."""
    base = probe.HardwareInfo(
        schema_version=probe.PROBE_SCHEMA_VERSION,
        generated_at="2026-10-13T00:00:00+00:00",
        cpu=probe.CpuInfo("Xeon E5-1660 v3", 8, 16, True, False, False),
        gpus=(probe.GpuInfo("Radeon RX 580 Series", "amd", 8.0, "31.0.1", True),),
        total_ram_gb=32.0,
        ort_providers=("DmlExecutionProvider",),
        openvino_devices=("CPU",),
    )
    newer_driver = replace(
        base,
        gpus=(probe.GpuInfo("Radeon RX 580 Series", "amd", 8.0, "31.0.2", True),),
    )

    assert probe.build_hardware_signature(base) != probe.build_hardware_signature(newer_driver)
    assert probe.build_hardware_signature(base) == probe.build_hardware_signature(base)


def test_collect_hardware_info_is_serializable(monkeypatch: pytest.MonkeyPatch) -> None:
    """A informação recolhida é JSON-serializável (usada pela CLI e pelos relatórios)."""
    monkeypatch.setattr(probe, "query_video_controller_records", lambda: ())
    monkeypatch.setattr(probe, "query_registry_vram_records", lambda: ())
    monkeypatch.setattr(probe, "probe_ort_providers", lambda: ((), ("sem ORT (teste)",)))
    monkeypatch.setattr(probe, "probe_openvino_devices", lambda: ((), ()))

    hardware_info = probe.collect_hardware_info()
    payload = json.loads(hardware_info.to_json())

    assert payload["schema_version"] == probe.PROBE_SCHEMA_VERSION
    assert payload["signature"]
    assert any("nenhum adaptador" in warning.lower() for warning in payload["warnings"])


def test_main_json_output(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A CLI imprime JSON válido quando pedido (comando de verificação da D02)."""
    monkeypatch.setattr(probe, "query_video_controller_records", lambda: ())
    monkeypatch.setattr(probe, "query_registry_vram_records", lambda: ())
    monkeypatch.setattr(probe, "probe_ort_providers", lambda: ((), ()))
    monkeypatch.setattr(probe, "probe_openvino_devices", lambda: ((), ()))

    exit_code = probe.main(["--json"])

    assert exit_code == 0
    assert json.loads(capsys.readouterr().out)["signature"]


def test_main_summary_output(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """O resumo legível inclui o sistema, a CPU e os avisos."""
    monkeypatch.setattr(probe, "query_video_controller_records", lambda: ())
    monkeypatch.setattr(probe, "query_registry_vram_records", lambda: ())
    monkeypatch.setattr(probe, "probe_ort_providers", lambda: ((), ("sem ORT (teste)",)))
    monkeypatch.setattr(probe, "probe_openvino_devices", lambda: ((), ()))

    exit_code = probe.main(["--summary"])
    output = capsys.readouterr().out

    assert exit_code == 0
    assert "Sistema:" in output
    assert "Aviso: sem ORT (teste)" in output


def test_main_summary_lists_detected_gpus(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Com GPU presente, o resumo mostra-a em vez de anunciar que não há adaptadores."""
    # 3 GiB é um valor abaixo do limite de 32 bits do WMI: chega para o resumo sem
    # acionar a recuperação pelo registo (que exigiria uma consulta adicional).
    rx_580 = json.dumps(
        {
            "Name": "Radeon RX 580 Series",
            "AdapterRAM": 3221225472,
            "DriverVersion": "31.0.21924.61",
        }
    )
    monkeypatch.setattr(
        probe, "query_video_controller_records", lambda: probe.parse_video_controller_json(rx_580)
    )
    monkeypatch.setattr(probe, "query_registry_vram_records", lambda: ())
    monkeypatch.setattr(probe, "probe_ort_providers", lambda: (("DmlExecutionProvider",), ()))
    monkeypatch.setattr(probe, "probe_openvino_devices", lambda: (("CPU",), ()))

    exit_code = probe.main(["--summary"])
    output = capsys.readouterr().out

    assert exit_code == 0
    assert "GPU: Radeon RX 580 Series (amd, VRAM=3.0 GiB, driver=31.0.21924.61)" in output
    assert "Providers ORT: DmlExecutionProvider" in output
    assert "Dispositivos OpenVINO: CPU" in output


def test_run_command_reports_execution_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """Uma falha do sistema ao lançar o processo externo degrada para `None`, com aviso."""

    def raising_run(*_args: object, **_kwargs: object) -> object:
        raise OSError("processo não pode ser criado")

    monkeypatch.setattr(subprocess, "run", raising_run)

    assert probe._run_command(["powershell.exe", "-Command", "Get-Date"]) is None


def test_query_video_controller_records_prefers_powershell(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Quando o PowerShell responde, o `wmic` (legado) nem chega a ser invocado."""
    commands: list[list[str]] = []

    def fake_run(command: list[str]) -> str | None:
        commands.append(command)
        return POWERSHELL_TWO_GPUS

    monkeypatch.setattr(probe, "_run_command", fake_run)

    records = probe.query_video_controller_records()

    assert len(records) == 2
    assert [command[0] for command in commands] == ["powershell.exe"]


def test_query_video_controller_records_falls_back_to_wmic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sem resposta do PowerShell, a consulta usa o `wmic` e devolve o que ele reportar."""
    csv_output = (
        "Node,AdapterRAM,DriverVersion,Name,PNPDeviceID,VideoProcessor\n"
        "PC,4293918720,31.0.21924.61,Radeon RX 580 Series,PCI\\VEN_1002&DEV_67DF,AMD\n"
    )

    def fake_run(command: list[str]) -> str | None:
        if command[0] == "wmic":
            return csv_output
        return None

    monkeypatch.setattr(probe, "_run_command", fake_run)

    records = probe.query_video_controller_records()

    assert len(records) == 1
    assert records[0]["Name"] == "Radeon RX 580 Series"


def test_query_registry_vram_records_reads_the_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """O registo é lido pelo PowerShell e o JSON devolvido é interpretado."""
    commands: list[list[str]] = []

    def fake_run(command: list[str]) -> str | None:
        commands.append(command)
        return REGISTRY_VRAM

    monkeypatch.setattr(probe, "_run_command", fake_run)

    records = probe.query_registry_vram_records()

    assert records == ({"DriverDesc": "Radeon RX 580 Series", "QWMemorySize": "8589934592"},)
    assert commands and commands[0][0] == "powershell.exe"


def test_parse_registry_vram_json_skips_incomplete_entries() -> None:
    """Entradas que não são objetos, ou sem memória, são ignoradas uma a uma."""
    payload = json.dumps(["texto solto", {"DriverDesc": "Sem memoria"}, {"QWMemorySize": 1024}])

    assert probe.parse_registry_vram_json(payload) == ()


def test_adapter_ram_gb_rejects_unusable_values() -> None:
    """VRAM em falta, ilegível ou não positiva fica desconhecida — nunca arredondada."""
    warnings: list[str] = []

    assert probe._adapter_ram_gb(None, warnings, "Radeon RX 580") is None
    assert probe._adapter_ram_gb("   ", warnings, "Radeon RX 580") is None
    assert warnings == []

    assert probe._adapter_ram_gb("desconhecido", warnings, "Radeon RX 580") is None
    assert probe._adapter_ram_gb("0", warnings, "Radeon RX 580") is None

    assert any("não é numérico" in warning for warning in warnings)
    assert any("valor inválido" in warning for warning in warnings)


def test_probe_cpu_degrades_when_psutil_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sem `psutil` a contagem de núcleos fica por detetar, com aviso explícito."""
    import builtins

    real_import: Callable[..., object] = builtins.__import__

    def failing_import(name: str, *args: object, **kwargs: object) -> object:
        if name == "psutil":
            raise OSError("psutil bloqueado pelo sistema (teste)")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", failing_import)

    cpu_info, warnings = probe.probe_cpu()

    assert cpu_info.physical_cores is None
    assert cpu_info.logical_cores is None
    assert any("psutil indisponível" in warning for warning in warnings)


def test_probe_total_ram_gb_returns_none_when_psutil_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sem `psutil` a RAM total não é inventada."""
    import builtins

    real_import: Callable[..., object] = builtins.__import__

    def failing_import(name: str, *args: object, **kwargs: object) -> object:
        if name == "psutil":
            raise ImportError("psutil indisponível (teste)")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", failing_import)

    assert probe.probe_total_ram_gb() is None
