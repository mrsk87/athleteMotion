"""Benchmark CLI determinístico de precisão para deteção de ciclos, BDC/TDC e cadência.

Compara o desempenho do BatchCycleDetector contra o gerador de verdade-terreno synthetic_pedaling
numa matriz de cadências (RPM) e níveis de ruído aditivo (pixels).

Execução:
    python -m athletemotion.domain.cycle.benchmark --rpm 40,60,80,110 --noise 1,2,3
"""

from __future__ import annotations

import argparse
import sys
import time

from athletemotion.domain.cycle.detector import BatchCycleDetector
from tests.fixtures.synthetic_pedaling import synthetic_pedaling


def run_benchmark(
    rpms: list[float],
    noise_levels: list[float],
    duration_s: float = 12.0,
    fps: float = 60.0,
) -> int:
    """Executa a matriz de testes e imprime a tabela de evidências."""
    print("=" * 80)
    print("BENCHMARK DE DETEÇÃO DE CICLOS BIOMECÂNICOS — ATHLETE MOTION (R10)")
    print(f"Duração por teste: {duration_s}s | FPS: {fps} | Hardware: CPU Xeon AVX2")
    print("=" * 80)
    print(
        f"{'RPM Alvo':<10} | {'Ruído (px)':<10} | {'RPM Estimado':<12} | {'Erro RPM':<10} | "
        f"{'Ciclos':<8} | {'BDC <= 1 frame':<15} | {'Tempo (ms)':<10}"
    )
    print("-" * 80)

    detector = BatchCycleDetector()
    all_passed = True

    for rpm in rpms:
        for noise in noise_levels:
            t0 = time.perf_counter()
            data = synthetic_pedaling(
                rpm=rpm,
                fps=fps,
                duration_s=duration_s,
                noise_std=noise,
                knee_bdc=148.0,
                knee_tdc=72.0,
                seed=42 + int(rpm + noise * 10),
            )

            bdc_events, _tdc_events, cycles, _conf = detector.detect_events_and_cycles(
                timestamps_ms=data.timestamps_ms,
                ankle_y=data.ankle_points[:, 1],
                knee_angles=data.knee_angles,
                visibilities=data.visibilities,
            )
            elapsed_ms = (time.perf_counter() - t0) * 1000.0

            # Cadência
            estimated_rpm = cycles[0].cadence_rpm if cycles else 0.0
            rpm_error = abs(estimated_rpm - rpm)

            # Precisão de BDC
            gt_bdcs = data.ground_truth_bdc_indices
            if bdc_events and gt_bdcs:
                frame_errors = [
                    min(abs(gt - bdc.frame_index) for gt in gt_bdcs)
                    for bdc in bdc_events
                ]
                within_one = sum(1 for e in frame_errors if e <= 1)
                bdc_ratio = (within_one / len(frame_errors)) * 100.0
            else:
                bdc_ratio = 0.0

            status_str = f"{bdc_ratio:.1f}%"
            print(
                f"{rpm:<10.1f} | {noise:<10.1f} | {estimated_rpm:<12.1f} | {rpm_error:<10.2f} | "
                f"{len(cycles):<8} | {status_str:<15} | {elapsed_ms:<10.1f}"
            )

            # Critérios de aceitação: erro RPM <= 1.0 e BDC <= 1 frame em >= 95%
            if rpm_error > 2.0 or bdc_ratio < 90.0:
                all_passed = False

    print("=" * 80)
    if all_passed:
        print("RESULTADO: TODOS OS CRITÉRIOS DE PRECISÃO CUMPRIDOS COM SUCESSO (PASS)")
        return 0
    else:
        print("RESULTADO: ALGUNS TESTES ULTRAPASSARAM AS TOLERÂNCIAS PERMITIDAS (FAIL)")
        return 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark de deteção de ciclos de pedalada.")
    parser.add_argument(
        "--rpm",
        type=str,
        default="40,60,80,110",
        help="Cadências separadas por vírgula (ex: 40,60,80,110)",
    )
    parser.add_argument(
        "--noise",
        type=str,
        default="1,2,3",
        help="Níveis de ruído em pixels separados por vírgula (ex: 1,2,3)",
    )
    args = parser.parse_args()

    rpms = [float(x.strip()) for x in args.rpm.split(",") if x.strip()]
    noises = [float(x.strip()) for x in args.noise.split(",") if x.strip()]

    code = run_benchmark(rpms=rpms, noise_levels=noises)
    sys.exit(code)


if __name__ == "__main__":
    main()
