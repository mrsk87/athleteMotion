"""Banco de ensaio dos motores de análise de pose humana.

Mede, para cada motor registado, o custo REAL por fotograma na máquina onde corre:

1. Tempo de construção da sessão (o custo escondido no arranque).
2. Primeira inferência (aquecimento) — no DirectML o primeiro `run` compila/otimiza
   o grafo, por isso nunca deve entrar na média que o utilizador sente.
3. Latência em regime estável: p50, p95 e FPS — é isto que decide se o esqueleto
   acompanha a perna ou chega atrasado.
4. Processamento completo (`process_frame`), que acrescenta pré-processamento e
   cálculo de ângulos.

Uso:
    python scripts/benchmark_inference.py                     # todos, 60 fotogramas
    python scripts/benchmark_inference.py --engines yolo11_pose
    python scripts/benchmark_inference.py --image foto.jpg --runs 120
    python scripts/benchmark_inference.py --json resultado.json

Nota honesta sobre o que este ensaio mede: o fotograma sintético não contém uma
pessoa, pelo que o filtro de confiança corta logo no início. O custo dominante
(a passagem pela rede) é medido na mesma; a pós-detecção (decodificação dos 17
keypoints e cálculo de ângulos) só é exercitada quando há pessoa detetada.
"""

from __future__ import annotations

import argparse
import json
import logging
import statistics
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

# Correr a partir da pasta backend sem instalar o pacote.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import athletemotion.domain.inference  # noqa: F401  (regista todos os motores no Factory)
from athletemotion.domain.inference.base import PoseEngineRegistry
from athletemotion.infrastructure.hardware import hardware_manager

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

# Motores que o ensaio conhece; os que exigem ficheiros de pesos só entram se existirem.
DEFAULT_ENGINES = [
    "mediapipe",
    "yolo11_pose",
    "yolo11_pose_cpu",
    "rtmpose",
    "opencv_markers",
]


def make_frame(width: int, height: int, seed: int = 7) -> np.ndarray:
    """Fotograma determinístico (ruído), para o custo de rede ser real e repetível."""
    rng = np.random.default_rng(seed)
    return rng.integers(0, 256, size=(height, width, 3), dtype=np.uint8)


def load_frame(image_path: str | None, width: int, height: int) -> np.ndarray:
    if not image_path:
        return make_frame(width, height)
    import cv2

    frame = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if frame is None:
        raise SystemExit(f"Não foi possível ler a imagem: {image_path}")
    if frame.shape[1] > width or frame.shape[0] > height:
        scale = min(width / frame.shape[1], height / frame.shape[0])
        frame = cv2.resize(frame, (int(frame.shape[1] * scale), int(frame.shape[0] * scale)))
    return frame


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((pct / 100.0) * (len(ordered) - 1))))
    return ordered[index]


def benchmark_engine(
    name: str,
    frame: np.ndarray,
    runs: int,
    warmup: int,
    side: str = "right",
) -> dict[str, Any]:
    """Constrói o motor, aquece-o e mede a latência em regime estável."""
    result: dict[str, Any] = {"engine": name, "ok": False}

    build_start = time.perf_counter()
    try:
        engine = PoseEngineRegistry.create(name, side=side)
    except Exception as err:  # pragma: no cover - depende de pesos instalados
        result["error"] = f"construção falhou: {err}"
        return result
    result["build_ms"] = round((time.perf_counter() - build_start) * 1000.0, 1)

    session = getattr(engine, "session", None)
    result["has_session"] = session is not None
    if session is not None:
        try:
            input_meta = session.get_inputs()[0]
            result["input_shape"] = list(input_meta.shape)
            result["providers"] = list(session.get_providers())
        except Exception:
            pass

    timings: list[float] = []
    first_frame_ms: float | None = None
    total = warmup + runs

    try:
        for index in range(total):
            start = time.perf_counter()
            output = engine.process_frame(frame, timestamp_ms=index * 33)
            elapsed = (time.perf_counter() - start) * 1000.0
            if index == 0:
                first_frame_ms = elapsed
            if index >= warmup:
                timings.append(elapsed)
    except Exception as err:  # pragma: no cover
        result["error"] = f"inferência falhou: {err}"
        return result

    result["ok"] = True
    result["first_frame_ms"] = round(first_frame_ms or 0.0, 2)
    result["p50_ms"] = round(statistics.median(timings), 2)
    result["p95_ms"] = round(percentile(timings, 95), 2)
    result["mean_ms"] = round(statistics.fmean(timings), 2)
    result["fps"] = round(1000.0 / result["p50_ms"], 1) if result["p50_ms"] > 0 else 0.0
    result["frames_measured"] = len(timings)
    result["landmarks_found"] = len(output.landmarks)
    return result


def close_engine(name: str) -> None:
    try:
        session = getattr(PoseEngineRegistry.get_active(), "session", None)
    except RuntimeError:
        return
    if session is not None:
        del session


def main() -> int:
    parser = argparse.ArgumentParser(description="Banco de ensaio dos motores de pose.")
    parser.add_argument("--engines", nargs="*", default=DEFAULT_ENGINES)
    parser.add_argument("--runs", type=int, default=60, help="fotogramas medidos por motor")
    parser.add_argument("--warmup", type=int, default=5, help="fotogramas descartados")
    parser.add_argument("--width", type=int, default=960)
    parser.add_argument("--height", type=int, default=540)
    parser.add_argument("--image", default=None, help="imagem real (opcional)")
    parser.add_argument("--side", default="right", choices=["left", "right"])
    parser.add_argument("--json", default=None, help="ficheiro onde gravar o resultado")
    args = parser.parse_args()

    frame = load_frame(args.image, args.width, args.height)

    print("=" * 78)
    print("BANCO DE ENSAIO — MOTORES DE ANÁLISE DE POSE HUMANA")
    print("=" * 78)
    print(
        f"Fotograma: {frame.shape[1]}x{frame.shape[0]} | fotogramas medidos: {args.runs} "
        f"| aquecimento: {args.warmup}"
    )
    print(f"Providers ONNX Runtime: {hardware_manager.available_providers}")
    print(f"DirectML disponível: {hardware_manager.has_directml}")
    print(
        f"Threads de CPU: intra={hardware_manager.intra_op_threads} "
        f"inter={hardware_manager.inter_op_threads} (núcleos lógicos={hardware_manager.logical_cores})"
    )
    print("-" * 78)

    results: list[dict[str, Any]] = []
    for name in args.engines:
        if name not in PoseEngineRegistry.get_registered_names():
            print(f"[{name}] ignorado — não registado.")
            continue
        print(f"[{name}] a construir e a medir…", flush=True)
        outcome = benchmark_engine(name, frame, args.runs, args.warmup, args.side)
        results.append(outcome)
        if not outcome.get("ok"):
            print(f"[{name}] FALHOU: {outcome.get('error')}")
            continue
        print(
            f"[{name}] build {outcome['build_ms']}ms | 1.º {outcome['first_frame_ms']}ms | "
            f"p50 {outcome['p50_ms']}ms | p95 {outcome['p95_ms']}ms | {outcome['fps']} FPS"
            + (f" | shape {outcome.get('input_shape')}" if outcome.get("input_shape") else "")
        )

    print("-" * 78)
    header = f"{'motor':<22}{'build':>9}{'1.º':>9}{'p50':>9}{'p95':>9}{'FPS':>8}"
    print(header)
    for item in results:
        if not item.get("ok"):
            print(f"{item['engine']:<22}{'—':>9}{'—':>9}{'—':>9}{'—':>9}{'—':>8}")
            continue
        print(
            f"{item['engine']:<22}{item['build_ms']:>9}{item['first_frame_ms']:>9}"
            f"{item['p50_ms']:>9}{item['p95_ms']:>9}{item['fps']:>8}"
        )
    print("=" * 78)

    if args.json:
        payload = {
            "frame": {"width": int(frame.shape[1]), "height": int(frame.shape[0])},
            "runs": args.runs,
            "warmup": args.warmup,
            "providers": list(hardware_manager.available_providers),
            "results": results,
        }
        Path(args.json).write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(f"Resultado gravado em {args.json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
