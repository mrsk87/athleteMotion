"""Avisos inteligentes sobre o hardware e as escolhas de inferência.

Porquê separado da interface: estas regras são **decisões técnicas** (o que impede
a inferência de funcionar ou o que a torna lenta) e têm de ser testáveis sem Qt,
para serem reutilizadas pelo arranque, pela vista de Definições (D02) e pela vista
de Benchmark (D12).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

from athletemotion_desktop.config.environment import detect_conflicting_onnx_runtimes
from athletemotion_desktop.runtime.hardware.probe import MIN_USABLE_VRAM_GB, HardwareInfo

DiagnosticSeverity = Literal["error", "warning", "info"]

#: Providers que a aplicação procura no ONNX Runtime.
DIRECTML_PROVIDER: Final[str] = "DmlExecutionProvider"
OPENVINO_GPU_PROVIDER: Final[str] = "OpenVINOExecutionProvider"


@dataclass(frozen=True)
class DiagnosticWarning:
    """Aviso ou erro apresentado ao utilizador na vista de Definições.

    Attributes:
        severity: `error` impede o funcionamento pretendido; `warning` degrada a
            experiência; `info` é contexto útil.
        message: texto em PT-PT, acionável (diz o que fazer).
    """

    severity: DiagnosticSeverity
    message: str

    @property
    def is_blocking(self) -> bool:
        """Indica se o aviso representa um impedimento (erro)."""
        return self.severity == "error"


def build_diagnostics(
    hardware_info: HardwareInfo,
    *,
    selected_backend: str,
    installed_packages: tuple[str, ...] | None = None,
) -> tuple[DiagnosticWarning, ...]:
    """Constrói a lista de avisos para o hardware e o backend selecionados.

    Args:
        hardware_info: informação de hardware detetada.
        selected_backend: backend de inferência escolhido nas definições
            (`auto`, `directml`, `openvino`, `cpu`).
        installed_packages: nomes de pacotes instalados (injeção para testes);
            quando `None`, o conflito de runtimes é avaliado no ambiente real.

    Returns:
        Tupla de avisos, ordenada por severidade (erros primeiro) e sem duplicados.
    """
    diagnostics: list[DiagnosticWarning] = []
    providers = set(hardware_info.ort_providers)
    has_ort = bool(hardware_info.ort_providers)
    has_directml = DIRECTML_PROVIDER in providers
    has_openvino_devices = bool(hardware_info.openvino_devices)

    conflict_message = _detect_runtime_conflict(installed_packages)
    if conflict_message is not None:
        diagnostics.append(DiagnosticWarning("error", conflict_message))

    if not has_ort:
        diagnostics.append(
            DiagnosticWarning(
                "error",
                "Nenhum runtime de inferência está instalado (ONNX Runtime): a análise de pose "
                "não pode correr. Instale o extra apropriado (por exemplo `uv pip install -e "
                "\".[directml]\"`).",
            )
        )
        return _sorted_diagnostics(diagnostics)

    if selected_backend == "directml" and not has_directml:
        diagnostics.append(
            DiagnosticWarning(
                "error",
                "O backend DirectML foi escolhido mas o provider 'DmlExecutionProvider' não está "
                "disponível. Instale o extra DirectML ou escolha OpenVINO/CPU.",
            )
        )

    if selected_backend == "openvino" and not has_openvino_devices:
        diagnostics.append(
            DiagnosticWarning(
                "error",
                "O backend OpenVINO foi escolhido mas não foi detetado nenhum dispositivo. "
                "Instale o extra OpenVINO ou escolha outro backend.",
            )
        )

    if selected_backend == "auto" and not has_directml:
        diagnostics.append(
            DiagnosticWarning(
                "warning",
                "Sem DirectML disponível: o modo automático irá usar OpenVINO ou CPU, com "
                "desempenho inferior ao da GPU.",
            )
        )

    diagnostics.extend(_vram_diagnostics(hardware_info))
    diagnostics.extend(_cpu_diagnostics(hardware_info))
    diagnostics.extend(_gpu_order_diagnostics(hardware_info))
    diagnostics.extend(
        DiagnosticWarning("info", warning) for warning in hardware_info.warnings
    )
    return _sorted_diagnostics(diagnostics)


def _detect_runtime_conflict(installed_packages: tuple[str, ...] | None) -> str | None:
    """Avalia o conflito proibido entre `onnxruntime` (CPU) e `onnxruntime-directml`."""
    if installed_packages is None:
        return detect_conflicting_onnx_runtimes()
    return detect_conflicting_onnx_runtimes(installed_packages)


def _vram_diagnostics(hardware_info: HardwareInfo) -> list[DiagnosticWarning]:
    """Avisa quando a VRAM é insuficiente ou desconhecida."""
    known_vram = [gpu.vram_gb for gpu in hardware_info.gpus if gpu.vram_gb is not None]
    if not known_vram:
        if hardware_info.gpus:
            return [
                DiagnosticWarning(
                    "info",
                    "A VRAM das GPUs detetadas não pôde ser medida com fiabilidade: a resolução "
                    "de entrada deve ser validada com o autotune antes de sessões longas.",
                )
            ]
        return []

    smallest_vram = min(known_vram)
    if smallest_vram < MIN_USABLE_VRAM_GB:
        return [
            DiagnosticWarning(
                "warning",
                f"VRAM detetada de {smallest_vram} GB (abaixo de {MIN_USABLE_VRAM_GB} GB): "
                "reduza a resolução de entrada do modelo ou use o backend de CPU.",
            )
        ]
    return []


def _cpu_diagnostics(hardware_info: HardwareInfo) -> list[DiagnosticWarning]:
    """Avisa quando a CPU não tem as instruções vetoriais esperadas pelo OpenVINO."""
    if hardware_info.cpu.has_avx2 is False:
        return [
            DiagnosticWarning(
                "warning",
                "O CPU não expõe AVX2: o backend OpenVINO/CPU será muito lento. "
                "Dê preferência à GPU (DirectML).",
            )
        ]
    return []


def _gpu_order_diagnostics(hardware_info: HardwareInfo) -> list[DiagnosticWarning]:
    """Deteta a armadilha clássica de a GPU integrada ocupar o `device_id` 0."""
    if len(hardware_info.gpus) < 2:
        return []
    first_gpu = hardware_info.gpus[0]
    if first_gpu.is_discrete is False and any(gpu.is_discrete for gpu in hardware_info.gpus[1:]):
        return [
            DiagnosticWarning(
                "warning",
                f"A primeira GPU detetada é integrada ('{first_gpu.name}') e existe uma GPU "
                "dedicada: confirme o dispositivo escolhido pelo autotune antes de medir, para "
                "não usar a integrada por engano.",
            )
        ]
    return []


def _sorted_diagnostics(diagnostics: list[DiagnosticWarning]) -> tuple[DiagnosticWarning, ...]:
    """Ordena por severidade e remove duplicados preservando a ordem de deteção."""
    severity_order: dict[DiagnosticSeverity, int] = {"error": 0, "warning": 1, "info": 2}
    seen: set[str] = set()
    unique: list[DiagnosticWarning] = []
    for diagnostic in sorted(diagnostics, key=lambda item: severity_order[item.severity]):
        if diagnostic.message in seen:
            continue
        seen.add(diagnostic.message)
        unique.append(diagnostic)
    return tuple(unique)
