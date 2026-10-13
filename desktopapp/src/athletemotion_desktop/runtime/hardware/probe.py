"""Sondagem de hardware do computador de trabalho.

**Sem dependências de Qt** (regra do protocolo para `runtime/`): o resultado é
serializável e pode ser obtido por CLI — `python -m athletemotion_desktop.runtime.hardware.probe --json`.

Princípio de degradação: nenhuma sonda falha para fora. Quando um componente não
pode ser lido (pacote ausente, comando bloqueado, driver raro), o campo fica
`None`/vazio e a razão é registada em `HardwareInfo.warnings`, para a interface
avisar o utilizador em vez de inventar valores.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import logging
import platform
import re
import shutil
import subprocess
import sys
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Final

logger = logging.getLogger(__name__)

PROBE_SCHEMA_VERSION: Final[int] = 1

#: Limite de tempo para comandos externos (PowerShell/wmic). Uma sonda de hardware
#: nunca pode bloquear o arranque por causa de um comando pendurado.
EXTERNAL_COMMAND_TIMEOUT_SECONDS: Final[float] = 10.0

#: Abaixo deste valor a resolução de entrada deve ser reduzida (ver avisos da D02).
MIN_USABLE_VRAM_GB: Final[float] = 2.0

#: `Win32_VideoController.AdapterRAM` é um inteiro com sinal de 32 bits: cartões com
#: 4 GiB ou mais aparecem truncados em `0xFFF00000` (4 293 918 720 bytes = 4095 MiB)
#: ou negativos. Verificado nesta máquina: a RX 580 de 8 GB reporta 4095 MiB.
#: Ao atingir este valor não é possível distinguir "4 GiB reais" de "valor truncado",
#: pelo que o campo é reportado como desconhecido e a sonda procura uma segunda fonte.
_CAPPED_ADAPTER_RAM_BYTES: Final[int] = 0xFFF00000

#: Chave de classe dos adaptadores de ecrã no registo do Windows. A propriedade
#: `HardwareInformation.qwMemorySize` é um QWORD com a VRAM real, ao contrário do WMI.
_DISPLAY_CLASS_REGISTRY_PATH: Final[str] = (
    r"HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\*"
)


@dataclass(frozen=True)
class CpuInfo:
    """Características do processador relevantes para a escolha de backend."""

    model: str | None
    physical_cores: int | None
    logical_cores: int | None
    has_avx2: bool | None
    has_avx512: bool | None
    has_vnni: bool | None


@dataclass(frozen=True)
class GpuInfo:
    """Adaptador gráfico detetado no sistema."""

    name: str
    vendor: str
    vram_gb: float | None
    driver_version: str | None
    is_discrete: bool | None


@dataclass(frozen=True)
class HardwareInfo:
    """Retrato do hardware e dos motores de inferência disponíveis."""

    schema_version: int
    generated_at: str
    cpu: CpuInfo
    gpus: tuple[GpuInfo, ...]
    total_ram_gb: float | None
    ort_providers: tuple[str, ...]
    openvino_devices: tuple[str, ...]
    warnings: tuple[str, ...] = field(default=())
    signature: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Converte a informação em estruturas JSON-serializáveis."""
        return asdict(self)

    def to_json(self) -> str:
        """Serializa a informação de hardware em JSON legível e estável."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2, sort_keys=True)


def _run_command(command: Sequence[str], timeout: float = EXTERNAL_COMMAND_TIMEOUT_SECONDS) -> str | None:
    """Executa um comando externo devolvendo o `stdout`.

    Args:
        command: comando e argumentos a executar.
        timeout: limite em segundos.

    Returns:
        `stdout` em texto, ou `None` se o comando não existir, expirar ou falhar
        (a razão fica no log, nunca propagada como exceção).
    """
    if shutil.which(command[0]) is None:
        logger.debug("Comando '%s' indisponível neste sistema.", command[0])
        return None
    try:
        completed = subprocess.run(
            list(command),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            # Sem janela de consola a piscar quando a app corre em modo gráfico.
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("Falha ao executar '%s': %s", " ".join(command), exc)
        return None

    if completed.returncode != 0:
        # O PowerShell devolve código 1 em erros *não-terminantes* (por exemplo, sem
        # permissão em subchaves do registo) mesmo produzindo saída válida. Quando há
        # `stdout` útil, aproveita-se; a mensagem de erro fica registada para diagnóstico.
        stderr_excerpt = (completed.stderr or "").strip().splitlines()
        logger.warning(
            "Comando '%s' terminou com código %d: %s",
            " ".join(command),
            completed.returncode,
            stderr_excerpt[-1][:200] if stderr_excerpt else "(sem mensagem)",
        )
        if not (completed.stdout or "").strip():
            return None
    return completed.stdout


def query_video_controller_records() -> tuple[Mapping[str, str], ...]:
    """Consulta os adaptadores gráficos do Windows.

    Ordem de preferência: `PowerShell Get-CimInstance` (disponível em Windows 10/11)
    e, em alternativa, `wmic` (descontinuado, mantido como último recurso).

    Returns:
        Registos de adaptadores; tupla vazia quando nada pode ser lido.
    """
    powershell_output = _run_command(
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_VideoController | "
            "Select-Object Name,AdapterRAM,DriverVersion,VideoProcessor,PNPDeviceID "
            "| ConvertTo-Json -Compress",
        ]
    )
    records = parse_video_controller_json(powershell_output)
    if records:
        return records

    wmic_output = _run_command(
        [
            "wmic",
            "path",
            "win32_VideoController",
            "get",
            "Name,AdapterRAM,DriverVersion,VideoProcessor,PNPDeviceID",
            "/format:csv",
        ]
    )
    return parse_video_controller_csv(wmic_output)


def parse_video_controller_json(raw_output: str | None) -> tuple[Mapping[str, str], ...]:
    """Interpreta a saída JSON do `Get-CimInstance`.

    Args:
        raw_output: texto JSON (um objeto ou uma lista) ou `None`.

    Returns:
        Registos normalizados; tupla vazia se o texto for vazio ou inválido.
    """
    if not raw_output or not raw_output.strip():
        return ()
    try:
        payload = json.loads(raw_output)
    except json.JSONDecodeError as exc:
        logger.warning("Saída JSON inválida ao consultar os adaptadores gráficos: %s", exc)
        return ()

    if isinstance(payload, Mapping):
        payload = [payload]
    if not isinstance(payload, list):
        logger.warning("Formato inesperado na consulta de adaptadores gráficos: %s", type(payload))
        return ()

    records: list[Mapping[str, str]] = []
    for entry in payload:
        if not isinstance(entry, Mapping):
            continue
        records.append({str(key): "" if value is None else str(value) for key, value in entry.items()})
    return tuple(records)


def parse_video_controller_csv(raw_output: str | None) -> tuple[Mapping[str, str], ...]:
    """Interpreta a saída CSV do `wmic` (com recurso a `PowerShell`).

    Args:
        raw_output: texto CSV com cabeçalho, ou `None`.

    Returns:
        Registos normalizados; tupla vazia se o texto for vazio.
    """
    if not raw_output or not raw_output.strip():
        return ()
    lines = [line for line in raw_output.splitlines() if line.strip()]
    if len(lines) < 2:
        return ()

    header = [column.strip() for column in lines[0].split(",")]
    records: list[Mapping[str, str]] = []
    for line in lines[1:]:
        values = [value.strip() for value in line.split(",")]
        if len(values) < len(header):
            continue
        records.append(dict(zip(header, values, strict=False)))
    return tuple(records)


def classify_gpu_vendor(name: str) -> str:
    """Classifica o fabricante do adaptador a partir do nome comercial."""
    normalized = name.lower()
    if "amd" in normalized or "radeon" in normalized:
        return "amd"
    if "nvidia" in normalized or "geforce" in normalized or "quadro" in normalized:
        return "nvidia"
    if "intel" in normalized:
        return "intel"
    if "microsoft" in normalized or "basic display" in normalized:
        return "microsoft"
    return "unknown"


def is_likely_discrete_gpu(name: str, vendor: str) -> bool | None:
    """Estima se o adaptador é dedicado (`True`), integrado (`False`) ou indeterminado.

    A heurística usa nomes comerciais porque o WMI não expõe o tipo de adaptador de
    forma fiável; quando não há confiança suficiente devolve `None` (nunca adivinha).
    """
    normalized = name.lower()
    if vendor == "intel":
        integrated_markers = ("uhd", "hd graphics", "iris", "graphics 5", "graphics 6")
        if any(marker in normalized for marker in integrated_markers):
            return False
    if vendor in {"amd", "nvidia"}:
        return True
    if "microsoft" in normalized:
        return False
    return None


def _adapter_ram_gb(raw_value: str | None, warnings: list[str], gpu_name: str) -> float | None:
    """Converte `AdapterRAM` em GiB, devolvendo `None` quando o valor não é fiável."""
    if raw_value is None or not str(raw_value).strip():
        return None
    try:
        raw_bytes = int(float(str(raw_value)))
    except ValueError:
        warnings.append(f"VRAM ilegível para '{gpu_name}': valor '{raw_value}' não é numérico.")
        return None

    if raw_bytes <= 0:
        warnings.append(
            f"VRAM de '{gpu_name}' reportada como {raw_bytes} bytes: valor inválido, ignorado."
        )
        return None
    if raw_bytes >= _CAPPED_ADAPTER_RAM_BYTES:
        warnings.append(
            f"VRAM de '{gpu_name}' reportada como {raw_bytes / 1024**3:.1f} GiB, que é o limite "
            f"de 32 bits do WMI: valor não fiável, a procurar no registo (qwMemorySize)."
        )
        return None
    return round(raw_bytes / 1024**3, 2)


def query_registry_vram_records() -> tuple[Mapping[str, str], ...]:
    """Consulta a VRAM real dos adaptadores no registo do Windows.

    O WMI trunca a VRAM a 32 bits (a RX 580 de 8 GB aparece como 4 GiB); a propriedade
    `HardwareInformation.qwMemorySize` é um QWORD com o valor correto.

    Returns:
        Registos com `DriverDesc` e `qwMemorySize`; tupla vazia se não for possível ler.
    """
    command = (
        f"Get-ChildItem '{_DISPLAY_CLASS_REGISTRY_PATH}' -ErrorAction SilentlyContinue "
        "| ForEach-Object { "
        "$entry = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue; "
        "if ($entry.'HardwareInformation.qwMemorySize') { "
        "[PSCustomObject]@{ DriverDesc = $entry.DriverDesc; "
        "QWMemorySize = $entry.'HardwareInformation.qwMemorySize' } } } "
        "| ConvertTo-Json -Compress"
    )
    raw_output = _run_command(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command])
    return parse_registry_vram_json(raw_output)


def parse_registry_vram_json(raw_output: str | None) -> tuple[Mapping[str, str], ...]:
    """Interpreta a saída JSON da consulta de VRAM ao registo.

    Args:
        raw_output: texto JSON (objeto ou lista) ou `None`.

    Returns:
        Registos com `DriverDesc`/`QWMemorySize`; tupla vazia se inválido.
    """
    if not raw_output or not raw_output.strip():
        return ()
    try:
        payload = json.loads(raw_output)
    except json.JSONDecodeError as exc:
        logger.warning("Saída JSON inválida ao ler a VRAM do registo: %s", exc)
        return ()

    if isinstance(payload, Mapping):
        payload = [payload]
    if not isinstance(payload, list):
        return ()

    records: list[Mapping[str, str]] = []
    for entry in payload:
        if not isinstance(entry, Mapping):
            continue
        description = entry.get("DriverDesc")
        memory = entry.get("QWMemorySize")
        if description is None or memory in (None, ""):
            continue
        records.append({"DriverDesc": str(description), "QWMemorySize": str(memory)})
    return tuple(records)


def _normalize_hardware_name(name: str) -> str:
    """Reduz um nome comercial a uma forma comparável (sem marcas nem separadores)."""
    normalized = re.sub(r"[^a-z0-9]", "", name.lower())
    for brand in ("amd", "nvidia", "intel", "corporation", "series", "graphics"):
        normalized = normalized.replace(brand, "")
    return normalized


def match_registry_vram_gb(
    adapter_name: str, registry_records: Sequence[Mapping[str, str]]
) -> float | None:
    """Faz corresponder um adaptador a uma entrada do registo pelo nome comercial.

    A correspondência é conservadora: só devolve um valor quando exatamente uma
    entrada do registo é compatível com o nome do adaptador (evita associar a VRAM
    do cartão errado, por exemplo a iGPU Intel em vez da GPU dedicada).

    Args:
        adapter_name: nome devolvido pelo WMI (por exemplo "Radeon RX 580 Series").
        registry_records: registos de `query_registry_vram_records`.

    Returns:
        VRAM em GiB ou `None` se não houver correspondência inequívoca.
    """
    target = _normalize_hardware_name(adapter_name)
    if not target:
        return None

    matches: list[float] = []
    for record in registry_records:
        candidate = _normalize_hardware_name(record.get("DriverDesc", ""))
        if not candidate or (target not in candidate and candidate not in target):
            continue
        try:
            memory_bytes = int(str(record.get("QWMemorySize", "")).strip())
        except ValueError:
            logger.warning(
                "VRAM ilegível no registo para '%s': %s",
                record.get("DriverDesc"),
                record.get("QWMemorySize"),
            )
            continue
        if memory_bytes <= 0:
            continue
        matches.append(round(memory_bytes / 1024**3, 2))

    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        logger.warning(
            "Correspondência ambígua de VRAM para '%s' (%d entradas do registo): valor ignorado.",
            adapter_name,
            len(matches),
        )
    return None


def parse_gpu_records(
    records: Sequence[Mapping[str, str]],
    registry_vram_records: Sequence[Mapping[str, str]] = (),
) -> tuple[tuple[GpuInfo, ...], tuple[str, ...]]:
    """Converte registos de adaptadores em `GpuInfo`, recolhendo avisos.

    Args:
        records: registos obtidos de `query_video_controller_records`.
        registry_vram_records: VRAM obtida do registo, usada quando o WMI trunca o valor.

    Returns:
        Par `(gpus, avisos)`. Entradas sem nome são ignoradas.
    """
    warnings: list[str] = []
    gpus: list[GpuInfo] = []
    for record in records:
        name = (record.get("Name") or record.get("name") or "").strip()
        if not name:
            continue
        vendor = classify_gpu_vendor(name)
        raw_vram = record.get("AdapterRAM") or record.get("adapterram")
        vram_gb = _adapter_ram_gb(raw_vram, warnings, name)
        if vram_gb is None and registry_vram_records:
            vram_gb = match_registry_vram_gb(name, registry_vram_records)
            if vram_gb is not None:
                warnings.append(
                    f"VRAM de '{name}' obtida do registo (qwMemorySize): {vram_gb} GiB "
                    "(o WMI trunca valores acima de 4 GiB)."
                )
        driver_version = (
            (record.get("DriverVersion") or record.get("driverversion") or "").strip() or None
        )
        gpus.append(
            GpuInfo(
                name=name,
                vendor=vendor,
                vram_gb=vram_gb,
                driver_version=driver_version,
                is_discrete=is_likely_discrete_gpu(name, vendor),
            )
        )
    return tuple(gpus), tuple(warnings)


def probe_cpu() -> tuple[CpuInfo, tuple[str, ...]]:
    """Lê o processador (modelo, núcleos e flags de vetorização).

    Returns:
        Par `(CpuInfo, avisos)`. Campos desconhecidos ficam `None` em vez de um valor inventado.
    """
    warnings: list[str] = []
    model: str | None = None
    flags: set[str] = set()

    try:
        import cpuinfo

        cpu_details = cpuinfo.get_cpu_info()
        model = str(cpu_details.get("brand_raw") or "").strip() or None
        flags = {str(flag).lower() for flag in cpu_details.get("flags", [])}
    except (ImportError, OSError, RuntimeError) as exc:
        warnings.append(f"py-cpuinfo indisponível ({exc}); modelo/flags do CPU por detetar.")
        model = platform.processor() or None

    physical_cores: int | None = None
    logical_cores: int | None = None
    try:
        import psutil

        physical_cores = psutil.cpu_count(logical=False)
        logical_cores = psutil.cpu_count(logical=True)
    except (ImportError, OSError, RuntimeError) as exc:
        warnings.append(f"psutil indisponível ({exc}); contagem de núcleos por detetar.")

    def _has_flag(flag: str) -> bool | None:
        if not flags:
            return None
        return flag in flags

    return (
        CpuInfo(
            model=model,
            physical_cores=physical_cores,
            logical_cores=logical_cores,
            has_avx2=_has_flag("avx2"),
            has_avx512=_has_flag("avx512f"),
            has_vnni=_has_flag("avx_vnni") or _has_flag("vnni"),
        ),
        tuple(warnings),
    )


def probe_total_ram_gb() -> float | None:
    """Devolve a RAM total em GiB, ou `None` se não for possível medir."""
    try:
        import psutil

        return round(psutil.virtual_memory().total / 1024**3, 1)
    except (ImportError, OSError, RuntimeError) as exc:
        logger.warning("Não foi possível medir a RAM total: %s", exc)
        return None


def probe_ort_providers() -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Lista os providers do ONNX Runtime disponíveis no ambiente.

    Returns:
        Par `(providers, avisos)`. Sem `onnxruntime` instalado devolve lista vazia e
        um aviso explícito (a inferência é impossível nesse estado).
    """
    try:
        onnxruntime = importlib.import_module("onnxruntime")
    except ImportError:
        return (), ("ONNX Runtime não está instalado neste ambiente: inferência indisponível.",)
    except (OSError, RuntimeError) as exc:
        return (), (f"ONNX Runtime presente mas não carregável ({exc}): inferência indisponível.",)

    try:
        providers = tuple(str(provider) for provider in onnxruntime.get_available_providers())
    except (AttributeError, RuntimeError) as exc:
        return (), (f"Falha ao listar os providers do ONNX Runtime: {exc}",)
    return providers, ()


def probe_openvino_devices() -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Lista os dispositivos OpenVINO disponíveis (CPU, GPU, …).

    Returns:
        Par `(dispositivos, avisos)`. Sem `openvino` instalado devolve lista vazia
        sem aviso bloqueante — é uma dependência opcional (`[openvino]`).
    """
    try:
        openvino = importlib.import_module("openvino")
    except ImportError:
        return (), ()
    except (OSError, RuntimeError) as exc:
        return (), (f"OpenVINO presente mas não carregável ({exc}).",)

    try:
        core = openvino.Core()
        return tuple(str(device) for device in core.available_devices), ()
    except (RuntimeError, AttributeError) as exc:
        return (), (f"Falha ao consultar os dispositivos OpenVINO: {exc}",)


def build_hardware_signature(info: HardwareInfo) -> str:
    """Calcula uma assinatura estável do hardware relevante para o autotune.

    A assinatura muda quando muda o CPU, a lista de GPUs, a versão do driver ou os
    providers disponíveis — exatamente as condições em que um perfil de autotune
    deixa de ser válido.

    Args:
        info: informação de hardware (o campo `signature` é ignorado).

    Returns:
        Resumo SHA-256 truncado (16 caracteres hexadecimais).
    """
    parts = [
        f"cpu:{info.cpu.model}",
        f"cores:{info.cpu.physical_cores}/{info.cpu.logical_cores}",
        *(f"gpu:{gpu.name}|{gpu.driver_version}|{gpu.vram_gb}" for gpu in info.gpus),
        f"ort:{','.join(info.ort_providers)}",
        f"ov:{','.join(info.openvino_devices)}",
    ]
    digest = hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()
    return digest[:16]


def collect_hardware_info() -> HardwareInfo:
    """Reúne toda a informação de hardware num único objeto serializável.

    Returns:
        `HardwareInfo` preenchido com o que foi possível detetar, mais os avisos
        das sondas que degradaram.
    """
    cpu_info, cpu_warnings = probe_cpu()
    gpu_records = query_video_controller_records()
    gpus, gpu_warnings = parse_gpu_records(gpu_records, query_registry_vram_records())
    ort_providers, ort_warnings = probe_ort_providers()
    openvino_devices, openvino_warnings = probe_openvino_devices()

    warnings = list(cpu_warnings) + list(gpu_warnings) + list(ort_warnings) + list(openvino_warnings)
    if not gpu_records:
        warnings.append(
            "Nenhum adaptador gráfico foi reportado pelo Windows (WMI/PowerShell): "
            "a escolha de backend ficará limitada à CPU."
        )

    hardware_info = HardwareInfo(
        schema_version=PROBE_SCHEMA_VERSION,
        generated_at=datetime.now(timezone.utc).isoformat(),
        cpu=cpu_info,
        gpus=gpus,
        total_ram_gb=probe_total_ram_gb(),
        ort_providers=ort_providers,
        openvino_devices=openvino_devices,
        warnings=tuple(warnings),
        signature="",
    )
    return replace(hardware_info, signature=build_hardware_signature(hardware_info))


def describe_system_name() -> str:
    """Descreve o sistema operativo (usado nos relatórios e nos logs)."""
    return f"{platform.system()} {platform.release()} ({platform.machine()})"


def main(argv: Sequence[str] | None = None) -> int:
    """Ponto de entrada de CLI da sonda de hardware.

    Args:
        argv: argumentos de linha de comandos (por omissão, `sys.argv[1:]`).

    Returns:
        Código de saída (0 em sucesso).
    """
    parser = argparse.ArgumentParser(description="Sonda de hardware do Athlete Motion Desktop")
    parser.add_argument("--json", action="store_true", help="Imprime a informação em JSON.")
    parser.add_argument(
        "--summary", action="store_true", help="Imprime um resumo legível por humanos."
    )
    arguments = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    hardware_info = collect_hardware_info()

    if arguments.json:
        print(hardware_info.to_json())
        return 0

    print(f"Sistema: {describe_system_name()}")
    print(f"CPU: {hardware_info.cpu.model} ({hardware_info.cpu.physical_cores} físicos / "
          f"{hardware_info.cpu.logical_cores} lógicos)")
    print(
        "Flags: "
        f"AVX2={hardware_info.cpu.has_avx2} AVX-512={hardware_info.cpu.has_avx512} "
        f"VNNI={hardware_info.cpu.has_vnni}"
    )
    print(f"RAM: {hardware_info.total_ram_gb} GB")
    for gpu in hardware_info.gpus:
        print(f"GPU: {gpu.name} ({gpu.vendor}, VRAM={gpu.vram_gb} GiB, driver={gpu.driver_version})")
    print(f"Providers ORT: {', '.join(hardware_info.ort_providers) or 'nenhum'}")
    print(f"Dispositivos OpenVINO: {', '.join(hardware_info.openvino_devices) or 'nenhum'}")
    for warning in hardware_info.warnings:
        print(f"Aviso: {warning}")
    print(f"Assinatura do hardware: {hardware_info.signature}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
