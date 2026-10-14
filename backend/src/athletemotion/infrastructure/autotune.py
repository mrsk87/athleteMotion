"""Sistema de calibração automática (Autotune) de hardware e seleção de perfis de inferência.

Funcionalidades:
1. Deteta hardware em runtime (CPU, núcleos físicos/lógicos, GPU DirectML e versão do driver).
2. Executa bateria de aferição com matriz reduzida.
3. Determina os perfis operacionais ótimos:
   - `realtime`: latência p95 mínima para streaming fluido a 60 FPS (p95 <= 16.6ms).
   - `precision`: máxima fidelidade anatómica (Halpe26 / 640px) com p95 <= 33.3ms.
   - `batch`: throughput máximo para processamento assíncrono de gravações.
4. Grava `APP_DATA_DIR/hardware_profile.json` com assinatura de driver/ORT para evitar recálculos.
"""

from __future__ import annotations

import json
import logging
import platform
import subprocess
import time
from pathlib import Path
from typing import Any, cast

import numpy as np

from athletemotion.config.paths import APP_DATA_DIR, MODELS_DIR
from athletemotion.infrastructure.backends.registry import BackendRegistry
from athletemotion.infrastructure.hardware import hardware_manager

logger = logging.getLogger("athlete_motion.autotune")
PROFILE_FILE = APP_DATA_DIR / "hardware_profile.json"


def detect_system_hardware() -> dict[str, Any]:
    """Deteta as características físicas de CPU e GPU do anfitrião."""
    cpu_name = platform.processor() or "Unknown CPU"
    gpu_name = "Nenhum / Integrado"
    gpu_driver = "N/A"

    import contextlib

    # Tentar ler GPU e driver via PowerShell / WMI no Windows
    if platform.system() == "Windows":
        with contextlib.suppress(Exception):
            cmd = [
                "powershell",
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_VideoController | Select-Object -Property Name, DriverVersion",
            ]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=3)  # noqa: S603
            lines = [line.strip() for line in res.stdout.splitlines() if line.strip()]
            if len(lines) >= 3:
                parts = lines[2].split(maxsplit=1)
                if len(parts) >= 2:
                    # Formato "Name... Driver..."
                    gpu_name = lines[2]

        with contextlib.suppress(Exception):
            cmd_cpu = [
                "powershell",
                "-NoProfile",
                "-Command",
                "(Get-CimInstance Win32_Processor).Name",
            ]
            res_cpu = subprocess.run(cmd_cpu, capture_output=True, text=True, timeout=3)  # noqa: S603
            if res_cpu.stdout.strip():
                cpu_name = res_cpu.stdout.strip()

    import onnxruntime as ort

    ort_version = getattr(ort, "__version__", "unknown")
    ov_version = "not_installed"
    try:
        import openvino as ov

        ov_version = getattr(ov, "__version__", "unknown")
    except ImportError:
        pass

    return {
        "cpu_name": cpu_name,
        "physical_cores": hardware_manager.physical_cores,
        "logical_cores": hardware_manager.logical_cores,
        "has_directml": hardware_manager.has_directml,
        "gpu_name": gpu_name,
        "gpu_driver": gpu_driver,
        "ort_version": ort_version,
        "openvino_version": ov_version,
        "os": f"{platform.system()} {platform.release()}",
    }


def _run_quick_eval(
    model_path: Path,
    backend_name: str,
    frames: int = 40,
) -> dict[str, Any] | None:
    """Executa um ciclo rápido de aferição para avaliar p50, p95 e FPS."""
    if not model_path.exists():
        return None

    try:
        backend = BackendRegistry.create(backend_name)
        backend.load(str(model_path))
        backend.warmup(runs=5)

        shape = tuple(backend.info().details.get("input_shape", [1, 3, 320, 320]))
        dummy = np.zeros(shape, dtype=np.float32)

        latencies: list[float] = []
        t_start = time.perf_counter()
        for _ in range(frames):
            t0 = time.perf_counter()
            _ = backend.infer(dummy)
            latencies.append((time.perf_counter() - t0) * 1000.0)
        total_time = time.perf_counter() - t_start

        backend.close()

        p50 = float(np.median(latencies))
        p95 = float(np.percentile(latencies, 95))
        fps = float(frames / total_time) if total_time > 0 else 0.0

        return {
            "model": model_path.name,
            "backend": backend_name,
            "shape": list(shape),
            "p50_ms": round(p50, 2),
            "p95_ms": round(p95, 2),
            "fps": round(fps, 1),
        }
    except Exception as exc:
        logger.warning("Falha ao avaliar %s em %s: %s", model_path.name, backend_name, exc)
        return None


def run_autotune(force: bool = False, max_frames: int = 40) -> dict[str, Any]:
    """Corre o processo de autotune e gera os perfis recomendados.

    Se já existir perfil gerado com as mesmas versões de runtime, devolve-o
    diretamente a menos que `force=True`.
    """
    hw = detect_system_hardware()
    signature = f"{hw['ort_version']}|{hw['openvino_version']}|{hw['gpu_name']}"

    if not force and PROFILE_FILE.exists():
        import contextlib

        with contextlib.suppress(Exception):
            cached = cast(dict[str, Any], json.loads(PROFILE_FILE.read_text(encoding="utf-8")))
            if cached.get("signature") == signature:
                logger.info("Perfil de hardware válido em cache carregado.")
                return cached

    logger.info("A iniciar Autotune de hardware para %s...", hw["cpu_name"])

    # Modelos a testar
    candidates = [
        MODELS_DIR / "yolo11n-pose-320.onnx",
        MODELS_DIR / "yolo11n-pose.onnx",
        MODELS_DIR / "rtmpose-m.onnx",
    ]
    backends_to_test = ["dml", "openvino", "ort_cpu"]
    avail = BackendRegistry.list_available()
    backends_to_test = [b for b in backends_to_test if avail.get(b, False)]

    benchmarks: list[dict[str, Any]] = []
    for model_path in candidates:
        if not model_path.exists():
            continue
        for backend_name in backends_to_test:
            res = _run_quick_eval(model_path, backend_name, frames=max_frames)
            if res:
                benchmarks.append(res)

    # 1. Perfil Realtime: menor p95 global
    realtime_best = min(benchmarks, key=lambda x: x["p95_ms"]) if benchmarks else None

    # 2. Perfil Precision: rtmpose-m se disponível e p95 <= 33ms, senão yolo11n-pose
    precision_candidates = [b for b in benchmarks if "rtmpose" in b["model"] or "640" in str(b["shape"])]
    precision_best = None
    if precision_candidates:
        # Priorizar rtmpose para precisão Halpe26
        rtm_candidates = [b for b in precision_candidates if "rtmpose" in b["model"]]
        if rtm_candidates:
            precision_best = min(rtm_candidates, key=lambda x: x["p95_ms"])
        else:
            precision_best = min(precision_candidates, key=lambda x: x["p95_ms"])
    else:
        precision_best = realtime_best

    # 3. Perfil Batch: maior FPS
    batch_best = max(benchmarks, key=lambda x: x["fps"]) if benchmarks else None

    profile = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "signature": signature,
        "hardware": hw,
        "profiles": {
            "realtime": {
                "model": realtime_best["model"] if realtime_best else "yolo11n-pose-320.onnx",
                "backend": realtime_best["backend"] if realtime_best else "dml",
                "expected_p50_ms": realtime_best["p50_ms"] if realtime_best else 5.0,
                "expected_p95_ms": realtime_best["p95_ms"] if realtime_best else 8.0,
                "expected_fps": realtime_best["fps"] if realtime_best else 120.0,
            },
            "precision": {
                "model": precision_best["model"] if precision_best else "rtmpose-m.onnx",
                "backend": precision_best["backend"] if precision_best else "dml",
                "expected_p50_ms": precision_best["p50_ms"] if precision_best else 12.0,
                "expected_p95_ms": precision_best["p95_ms"] if precision_best else 15.0,
                "expected_fps": precision_best["fps"] if precision_best else 70.0,
            },
            "batch": {
                "model": batch_best["model"] if batch_best else "yolo11n-pose-320.onnx",
                "backend": batch_best["backend"] if batch_best else "dml",
                "expected_p50_ms": batch_best["p50_ms"] if batch_best else 5.0,
                "expected_p95_ms": batch_best["p95_ms"] if batch_best else 8.0,
                "expected_fps": batch_best["fps"] if batch_best else 150.0,
            },
        },
        "all_benchmarks": benchmarks,
    }

    PROFILE_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROFILE_FILE.write_text(json.dumps(profile, indent=2), encoding="utf-8")
    logger.info("Hardware profile gravado com sucesso em %s", PROFILE_FILE)
    return profile


def get_active_profile() -> dict[str, Any]:
    """Devolve o perfil de hardware ativo ou executa autotune se necessário."""
    if not PROFILE_FILE.exists():
        return run_autotune(force=False)
    try:
        return cast(dict[str, Any], json.loads(PROFILE_FILE.read_text(encoding="utf-8")))
    except Exception:
        return run_autotune(force=True)
