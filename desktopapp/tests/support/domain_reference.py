"""Acesso à implementação de referência do domínio partilhado (pacote `athletemotion`).

**Porquê carregar o ficheiro em vez de importar o pacote:** o pacote não está instalado
no ambiente do desktop (dependência `athletemotion @ file:../backend` diferida até a
R01 fechar) e, mesmo com `PYTHONPATH`, importar `athletemotion.domain.inference` arrasta
o `onnxruntime` (o `__init__` do pacote importa os motores YOLO/RTMPose), que ainda não
existe neste ambiente. O módulo de pré-processamento é uma folha que só precisa de
`cv2`/`numpy`, pelo que é carregado diretamente pelo caminho do ficheiro.

Quando a R01 estiver 🟢 DONE e o pacote instalado, este auxiliar deixa de ser preciso:
passa a valer `from athletemotion.domain.inference import onnx_utils`.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

#: Caminho do módulo de referência dentro do repositório (`backend/src/...`).
DOMAIN_ONNX_UTILS_PATH = (
    Path(__file__).resolve().parents[3]
    / "backend"
    / "src"
    / "athletemotion"
    / "domain"
    / "inference"
    / "onnx_utils.py"
)


def domain_available() -> bool:
    """Indica se a implementação de referência está disponível neste checkout."""
    return DOMAIN_ONNX_UTILS_PATH.is_file()


def load_domain_onnx_utils() -> ModuleType:
    """Carrega `athletemotion.domain.inference.onnx_utils` pelo caminho do ficheiro.

    Returns:
        O módulo carregado, com `preprocess_roi_for_onnx`, `crop_frame` e `letterbox`.

    Raises:
        FileNotFoundError: se o ficheiro de referência não existir no checkout.
    """
    if not domain_available():
        raise FileNotFoundError(
            f"Módulo de referência do domínio não encontrado em {DOMAIN_ONNX_UTILS_PATH}."
        )
    spec = importlib.util.spec_from_file_location(
        "domain_onnx_utils_reference", DOMAIN_ONNX_UTILS_PATH
    )
    if spec is None or spec.loader is None:  # pragma: no cover - caminho defensivo
        raise ImportError(f"Não foi possível criar o módulo a partir de {DOMAIN_ONNX_UTILS_PATH}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
