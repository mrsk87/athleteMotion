"""Exporta o YOLO-Pose para ONNX em vários tamanhos de entrada.

Porque é que existem vários tamanhos: a latência de uma rede convolucional cresce
com a ÁREA da entrada. 320×320 é 1/4 dos píxeis de 640×640, e é esse o tamanho que
o motor rápido usa quando a pessoa já enche o recorte (`yolo11_pose_fast`).

Uso:
    python scripts/export_yolo_onnx.py                # 640 + 320
    python scripts/export_yolo_onnx.py --sizes 640 416 320
    python scripts/export_yolo_onnx.py --weights yolo11s-pose.pt
"""

from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path

# O Ultralytics instala pacotes sozinho quando lhe falta algo (ex.: `onnxslim` para
# simplificar o grafo). Essa instalação automática arrasta o `onnxruntime` normal,
# que SUBSTITUI o `onnxruntime-directml` e deixa o DirectML sem funcionar.
# Desligar a auto-instalação é obrigatório neste projeto.
os.environ["YOLO_AUTOINSTALL"] = "false"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("export_yolo_onnx")

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def export_size(weights: str, size: int, overwrite: bool = False, simplify: bool = False) -> Path:
    """Exporta `weights` para `models/<stem>-<size>.onnx`. Devolve o destino.

    `simplify=True` fica opcional e desligado por omissão: obriga a ter `onnxslim`
    instalado à mão e, sem ele, o Ultralytics tenta instalar (ver aviso acima).
    """
    stem = Path(weights).stem
    target = MODELS_DIR / f"{stem}-{size}.onnx"
    if target.exists() and not overwrite:
        logger.info("%s já existe (%.1f MB) — ignorado.", target.name, target.stat().st_size / 1e6)
        return target

    from ultralytics import YOLO

    logger.info("A exportar %s para ONNX @ %dpx…", weights, size)
    model = YOLO(weights)
    exported = model.export(
        format="onnx", imgsz=size, dynamic=False, simplify=simplify, device="cpu"
    )
    produced = Path(exported)
    if produced.resolve() != target.resolve():
        produced.replace(target)
    logger.info("Exportado: %s (%.1f MB)", target, target.stat().st_size / 1e6)
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description="Exporta YOLO-Pose para ONNX em vários tamanhos.")
    parser.add_argument("--weights", default="yolo11n-pose.pt")
    parser.add_argument("--sizes", nargs="*", type=int, default=[640, 320])
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--simplify", action="store_true", help="requer 'onnxslim' instalado")
    args = parser.parse_args()

    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    if not Path(args.weights).exists():
        logger.error(
            "Pesos '%s' não encontrados. Descarregue-os primeiro (ex.: YOLO('yolo11n-pose.pt')).",
            args.weights,
        )
        return 1

    try:
        for size in args.sizes:
            export_size(args.weights, size, overwrite=args.overwrite, simplify=args.simplify)
    except ImportError:
        logger.error("Pacote 'ultralytics' não instalado — impossível exportar.")
        return 1
    except Exception as err:
        logger.error("Falha na exportação: %s", err)
        return 1

    logger.info("Concluído. Ficheiros em %s", MODELS_DIR)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
