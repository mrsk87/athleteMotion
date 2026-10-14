"""Matriz de ensaio comparativo de desempenho de inferência.

Mede de forma determinística e rigorosa:
- p50, p95, p99 de latência por fotograma (ms).
- Taxa de transferência efetiva (FPS).
- Primeiro run (warmup) isolado.
- Utilização de CPU e memória RAM (via psutil).
- Exportação em JSON, CSV e tabela Markdown formatada.

Uso:
    python scripts/benchmark_matrix.py --frames 300 --out docs/perf/baseline.json
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import psutil

# Garantir importações do pacote backend
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from athletemotion.infrastructure.backends import BackendRegistry
from athletemotion.infrastructure.hardware import hardware_manager

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("benchmark_matrix")

DEFAULT_MODELS = [
    "yolo11n-pose-320",
    "yolo11n-pose",
    "rtmpose-m",
]

DEFAULT_BACKENDS = [
    "dml",
    "openvino",
    "ort_cpu",
]

MODEL_PATHS = {
    "yolo11n-pose-320": "models/yolo11n-pose-320.onnx",
    "yolo11n-pose": "models/yolo11n-pose.onnx",
    "rtmpose-m": "models/rtmpose-m.onnx",
}


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    arr = np.array(values)
    return float(np.percentile(arr, pct))


def run_benchmark_cell(
    model_name: str,
    backend_name: str,
    frames: int = 300,
    warmup_runs: int = 10,
    synthetic_seed: int = 42,
) -> dict[str, Any]:
    """Executa o ensaio de uma única célula da matriz (modelo x backend)."""
    model_file = MODEL_PATHS.get(model_name, model_name)
    path = Path(model_file)
    if not path.exists():
        p_alt = Path(__file__).resolve().parent.parent / model_file
        if p_alt.exists():
            path = p_alt
        else:
            return {
                "model": model_name,
                "backend": backend_name,
                "status": "missing_model",
                "error": f"Ficheiro {model_file} não encontrado.",
            }

    try:
        backend = BackendRegistry.create(backend_name)
    except Exception as exc:
        return {
            "model": model_name,
            "backend": backend_name,
            "status": "backend_unavailable",
            "error": str(exc),
        }

    proc = psutil.Process()
    ram_before_mb = proc.memory_info().rss / (1024 * 1024)

    try:
        load_t0 = time.perf_counter()
        backend.load(str(path))
        load_ms = (time.perf_counter() - load_t0) * 1000.0

        warmup_ms = backend.warmup(runs=warmup_runs)

        shape = tuple(backend.info().details.get("input_shape", [1, 3, 320, 320]))
        rng = np.random.default_rng(synthetic_seed)
        dummy_tensor = rng.standard_normal(shape).astype(np.float32)

        latencies_ms: list[float] = []

        # Monitorização de CPU
        psutil.cpu_percent(interval=None)
        start_time = time.perf_counter()

        for _ in range(frames):
            t0 = time.perf_counter()
            _ = backend.infer(dummy_tensor)
            latencies_ms.append((time.perf_counter() - t0) * 1000.0)

        total_time_s = time.perf_counter() - start_time
        cpu_pct = psutil.cpu_percent(interval=None)
        ram_after_mb = proc.memory_info().rss / (1024 * 1024)

        backend.close()

        p50 = percentile(latencies_ms, 50.0)
        p95 = percentile(latencies_ms, 95.0)
        p99 = percentile(latencies_ms, 99.0)
        fps = frames / total_time_s if total_time_s > 0 else 0.0

        return {
            "model": model_name,
            "backend": backend_name,
            "status": "ok",
            "frames": frames,
            "shape": list(shape),
            "load_ms": round(load_ms, 2),
            "warmup_ms": round(warmup_ms, 2),
            "p50_ms": round(p50, 2),
            "p95_ms": round(p95, 2),
            "p99_ms": round(p99, 2),
            "fps": round(fps, 1),
            "cpu_percent": round(cpu_pct, 1),
            "ram_mb": round(ram_after_mb, 1),
            "ram_delta_mb": round(ram_after_mb - ram_before_mb, 1),
        }
    except Exception as exc:
        backend.close()
        return {
            "model": model_name,
            "backend": backend_name,
            "status": "failed",
            "error": str(exc),
        }


def format_markdown_table(results: list[dict[str, Any]]) -> str:
    lines = [
        "| Modelo | Backend | Resolução | Warmup (ms) | p50 (ms) | p95 (ms) | p99 (ms) | FPS | CPU % | RAM (MB) |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        if r.get("status") != "ok":
            lines.append(
                f"| {r.get('model')} | {r.get('backend')} | — | — | FALHOU ({r.get('error', 'desconhecido')}) | — | — | — | — | — |"
            )
            continue
        shape_str = f"{r['shape'][2]}x{r['shape'][3]}" if len(r["shape"]) >= 4 else str(r["shape"])
        lines.append(
            f"| `{r['model']}` | **{r['backend'].upper()}** | {shape_str} | {r['warmup_ms']} | {r['p50_ms']} | {r['p95_ms']} | {r['p99_ms']} | **{r['fps']}** | {r['cpu_percent']}% | {r['ram_mb']} |"
        )
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Matriz de benchmark de inferência.")
    parser.add_argument(
        "--models",
        default=",".join(DEFAULT_MODELS),
        help="Modelos separados por vírgula",
    )
    parser.add_argument(
        "--backends",
        default=",".join(DEFAULT_BACKENDS),
        help="Backends separados por vírgula (dml, openvino, ort_cpu)",
    )
    parser.add_argument("--frames", type=int, default=300, help="Número de fotogramas")
    parser.add_argument("--warmup", type=int, default=10, help="Número de runs de aquecimento")
    parser.add_argument("--out", type=str, default=None, help="Caminho do ficheiro de saída (.json ou .md)")
    args = parser.parse_args()

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    backends = [b.strip() for b in args.backends.split(",") if b.strip()]

    print("=" * 80)
    print("ATHLETEMOTION — MATRIZ DE BENCHMARK DE INFERÊNCIA")
    print(f"Hardware: {hardware_manager.physical_cores}C/{hardware_manager.logical_cores}T, DirectML={hardware_manager.has_directml}")
    print(f"Modelos: {models}")
    print(f"Backends: {backends}")
    print(f"Fotogramas por célula: {args.frames} (+ {args.warmup} aquecimento)")
    print("=" * 80)

    results: list[dict[str, Any]] = []

    for model in models:
        for backend in backends:
            print(f"--> A testar [{model}] no backend [{backend}] ({args.frames} frames)...", flush=True)
            res = run_benchmark_cell(
                model_name=model,
                backend_name=backend,
                frames=args.frames,
                warmup_runs=args.warmup,
            )
            results.append(res)
            if res.get("status") == "ok":
                print(f"    p50: {res['p50_ms']} ms | p95: {res['p95_ms']} ms | FPS: {res['fps']}")
            else:
                print(f"    ERRO: {res.get('error')}")

    md_table = format_markdown_table(results)
    print("\n" + "=" * 80)
    print("RESULTADOS (Markdown):")
    print("=" * 80)
    print(md_table)
    print("=" * 80)

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        if out_path.suffix.lower() == ".json":
            out_data = {
                "metadata": {
                    "physical_cores": hardware_manager.physical_cores,
                    "logical_cores": hardware_manager.logical_cores,
                    "has_directml": hardware_manager.has_directml,
                    "frames_per_cell": args.frames,
                    "warmup_runs": args.warmup,
                },
                "results": results,
                "markdown": md_table,
            }
            out_path.write_text(json.dumps(out_data, indent=2), encoding="utf-8")
            print(f"Resultados guardados em JSON: {out_path}")
        else:
            out_path.write_text(md_table, encoding="utf-8")
            print(f"Tabela guardada em Markdown: {out_path}")


if __name__ == "__main__":
    main()
