"""Verificação de integridade do ambiente de pacotes nativos.

O `onnxruntime` (CPU) e o `onnxruntime-directml` partilham o mesmo pacote de
importação (`onnxruntime`) e os mesmos binários nativos. Quando coexistem, o
provider DirectML pode deixar de funcionar **sem erro explícito** — a inferência
passa silenciosamente a correr em CPU ou falha com erros de operador. Esta
verificação transforma esse estado inválido numa falha de arranque visível.
"""

from __future__ import annotations

import importlib.metadata
import re
from collections.abc import Iterable
from typing import Final

#: Normalização de nomes de distribuição segundo a PEP 503.
_DISTRIBUTION_NAME_PATTERN: Final[re.Pattern[str]] = re.compile(r"[-_.]+")

CPU_ONNX_RUNTIME: Final[str] = "onnxruntime"
DIRECTML_ONNX_RUNTIME: Final[str] = "onnxruntime-directml"
DIRECTML_PROVIDER: Final[str] = "DmlExecutionProvider"


class EnvironmentInspectionError(RuntimeError):
    """Não foi possível inspecionar os pacotes instalados no ambiente atual."""


def normalize_distribution_name(name: str) -> str:
    """Normaliza o nome de um pacote como a PEP 503 (`onnxruntime_directml` → `onnxruntime-directml`).

    Args:
        name: nome do pacote tal como aparece nos metadados da distribuição.

    Returns:
        Nome em minúsculas, com separadores reduzidos a hífen.
    """
    return _DISTRIBUTION_NAME_PATTERN.sub("-", name.strip().lower())


def installed_distribution_names() -> frozenset[str]:
    """Lê os nomes normalizados de todos os pacotes instalados no ambiente.

    Returns:
        Conjunto imutável de nomes de distribuição normalizados.

    Raises:
        EnvironmentInspectionError: se os metadados das distribuições não
            puderem ser lidos (ambiente corrompido ou permissões insuficientes).
    """
    try:
        distributions = importlib.metadata.distributions()
        return frozenset(
            normalize_distribution_name(distribution.metadata["Name"])
            for distribution in distributions
            if distribution.metadata["Name"]
        )
    except Exception as exc:
        raise EnvironmentInspectionError(
            f"Falha ao ler os metadados dos pacotes instalados: {exc!r}"
        ) from exc


def detect_conflicting_onnx_runtimes(
    installed_packages: Iterable[str] | None = None,
) -> str | None:
    """Deteta a coexistência proibida de `onnxruntime` (CPU) e `onnxruntime-directml`.

    Args:
        installed_packages: nomes de pacotes a inspecionar. Se `None`, são lidos
            do ambiente Python atual. O parâmetro existe para testes determinísticos.

    Returns:
        `None` quando o ambiente é válido; caso contrário, a mensagem de erro
        em PT-PT a apresentar ao utilizador (pronta para log e para o ecrã).

    Raises:
        EnvironmentInspectionError: propagada de `installed_distribution_names`.
    """
    if installed_packages is None:
        normalized_names = installed_distribution_names()
    else:
        normalized_names = frozenset(
            normalize_distribution_name(name) for name in installed_packages
        )

    has_cpu_runtime = CPU_ONNX_RUNTIME in normalized_names
    has_directml_runtime = DIRECTML_ONNX_RUNTIME in normalized_names
    if not (has_cpu_runtime and has_directml_runtime):
        return None

    return (
        "CONFLITO CRÍTICO DE AMBIENTE: os pacotes 'onnxruntime' (CPU) e "
        "'onnxruntime-directml' estão instalados simultaneamente. O pacote CPU substitui os "
        "binários nativos usados pelo provider DirectML (GPU AMD RX 580), o que provoca "
        "inferência silenciosamente mais lenta ou erros de operador.\n"
        "Correção: uv pip uninstall onnxruntime   (ou: python -m pip uninstall onnxruntime)\n"
        "O arranque foi abortado para não produzir medições biomecânicas inválidas."
    )
