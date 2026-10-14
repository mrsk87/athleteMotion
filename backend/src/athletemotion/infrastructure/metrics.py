"""Sistema de métricas e observabilidade de desempenho e inferência.

Mantém contadores e histogramas de latência por estágio do pipeline (decode, preprocess,
infer, postprocess) e expõe métricas em formato padronizado Prometheus.
"""

from __future__ import annotations

import threading
from collections import defaultdict
from typing import Any


class MetricsRegistry:
    """Registo em memória com proteção de concorrência por thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._frames_total: dict[str, int] = defaultdict(int)
        self._frames_dropped: dict[str, int] = defaultdict(int)
        self._fps_gauge: dict[str, float] = defaultdict(float)
        self._stage_latencies: dict[str, dict[str, list[float]]] = defaultdict(
            lambda: defaultdict(list)
        )
        self._max_history = 300

    def record_frame(self, engine: str, stage_timings: dict[str, float]) -> None:
        """Regista latências por estágio para um fotograma processado."""
        with self._lock:
            self._frames_total[engine] += 1
            for stage, ms in stage_timings.items():
                lst = self._stage_latencies[engine][stage]
                lst.append(ms)
                if len(lst) > self._max_history:
                    lst.pop(0)

    def record_drop(self, engine: str) -> None:
        """Regista descarte de fotograma por política latest-wins."""
        with self._lock:
            self._frames_dropped[engine] += 1

    def set_fps(self, engine: str, fps: float) -> None:
        """Atualiza o FPS instantâneo medido."""
        with self._lock:
            self._fps_gauge[engine] = round(fps, 1)

    def get_summary(self, engine: str) -> dict[str, Any]:
        """Devolve resumo estatístico de latência e FPS para o motor."""
        with self._lock:
            total = self._frames_total.get(engine, 0)
            dropped = self._frames_dropped.get(engine, 0)
            fps = self._fps_gauge.get(engine, 0.0)
            stages = {}
            for stage, vals in self._stage_latencies.get(engine, {}).items():
                if vals:
                    sorted_vals = sorted(vals)
                    p50_idx = int(0.50 * (len(sorted_vals) - 1))
                    p95_idx = int(0.95 * (len(sorted_vals) - 1))
                    stages[stage] = {
                        "p50_ms": round(sorted_vals[p50_idx], 2),
                        "p95_ms": round(sorted_vals[p95_idx], 2),
                    }
            return {
                "engine": engine,
                "frames_total": total,
                "frames_dropped": dropped,
                "fps": fps,
                "stages": stages,
            }

    def generate_prometheus_text(self) -> str:
        """Gera payload textual em formato Prometheus (OpenMetrics)."""
        lines = [
            "# HELP athletemotion_frames_total Total de fotogramas processados por motor",
            "# TYPE athletemotion_frames_total counter",
        ]
        with self._lock:
            for eng, count in self._frames_total.items():
                lines.append(f'athletemotion_frames_total{{engine="{eng}"}} {count}')

            lines.extend([
                "# HELP athletemotion_frames_dropped_total Total de fotogramas descartados por saturação",
                "# TYPE athletemotion_frames_dropped_total counter",
            ])
            for eng, dropped in self._frames_dropped.items():
                lines.append(f'athletemotion_frames_dropped_total{{engine="{eng}"}} {dropped}')

            lines.extend([
                "# HELP athletemotion_fps_effective FPS efetivo de inferência",
                "# TYPE athletemotion_fps_effective gauge",
            ])
            for eng, fps in self._fps_gauge.items():
                lines.append(f'athletemotion_fps_effective{{engine="{eng}"}} {fps}')

            lines.extend([
                "# HELP athletemotion_stage_latency_p95_ms Latência p95 por estágio do pipeline em ms",
                "# TYPE athletemotion_stage_latency_p95_ms gauge",
            ])
            for eng, stage_dict in self._stage_latencies.items():
                for stage, vals in stage_dict.items():
                    if vals:
                        sorted_vals = sorted(vals)
                        p95 = sorted_vals[int(0.95 * (len(sorted_vals) - 1))]
                        lines.append(
                            f'athletemotion_stage_latency_p95_ms{{engine="{eng}",stage="{stage}"}} {round(p95, 2)}'
                        )

        return "\n".join(lines) + "\n"


# Instância singleton global de telemetria
metrics = MetricsRegistry()
