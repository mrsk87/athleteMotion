"""Executor e orquestrador de ensaios de validação científica (R17).

Executa bateria de testes de validação em lote a partir de conjuntos de dados em disco (.csv, .npz),
calcula métricas de fidelidade face à verdade-terreno, gera gráficos de Bland-Altman
e compila relatório formal em Markdown e JSON estruturado.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

from athletemotion.validation.bland_altman import generate_bland_altman_plot
from athletemotion.validation.metrics import compute_validation_metrics


def create_synthetic_validation_dataset(
    output_dir: Path | str,
    n_samples: int = 300,
    knee_noise_std: float = 1.2,
    knee_bias: float = 0.8,
    hip_noise_std: float = 1.5,
    hip_bias: float = -0.5,
) -> Path:
    """Cria um conjunto de dados sintético determinístico com erro conhecido injetado para testes."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    rng = np.random.RandomState(42)

    # 1. Trajetória dinâmica de joelho: 110° a 150°
    t = np.linspace(0, 6 * np.pi, n_samples)
    gt_knee = 130.0 + 20.0 * np.sin(t)
    pred_knee = gt_knee + knee_bias + rng.normal(0, knee_noise_std, n_samples)

    knee_csv = out / "knee_validation.csv"
    with open(knee_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["frame_index", "ground_truth", "predicted", "joint_name"])
        for i in range(n_samples):
            writer.writerow([i, f"{gt_knee[i]:.3f}", f"{pred_knee[i]:.3f}", "Joelho"])

    # 2. Trajetória de anca (hip): 40° a 55°
    gt_hip = 47.5 + 7.5 * np.sin(t + 0.5)
    pred_hip = gt_hip + hip_bias + rng.normal(0, hip_noise_std, n_samples)

    hip_npz = out / "hip_validation.npz"
    np.savez_compressed(
        hip_npz,
        ground_truth=gt_hip,
        predicted=pred_hip,
        joint_name="Anca",
    )

    return out


def load_dataset_file(file_path: Path) -> dict[str, Any]:
    """Carrega vetores de verdade-terreno e predição de ficheiro .csv ou .npz."""
    if file_path.suffix.lower() == ".csv":
        gt_list: list[float] = []
        pred_list: list[float] = []
        joint_name = file_path.stem.split("_")[0].capitalize()

        with open(file_path, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                gt_val = float(row.get("ground_truth") or row.get("gt_angle") or row.get("target") or 0.0)
                pred_val = float(row.get("predicted") or row.get("pred_angle") or row.get("estimate") or 0.0)
                gt_list.append(gt_val)
                pred_list.append(pred_val)
                if row.get("joint_name"):
                    joint_name = row["joint_name"]

        return {
            "name": file_path.stem,
            "joint_name": joint_name,
            "ground_truth": np.array(gt_list, dtype=np.float64),
            "predicted": np.array(pred_list, dtype=np.float64),
        }

    elif file_path.suffix.lower() == ".npz":
        data = np.load(file_path, allow_pickle=True)
        joint_name = str(data["joint_name"]) if "joint_name" in data else file_path.stem.capitalize()
        return {
            "name": file_path.stem,
            "joint_name": joint_name,
            "ground_truth": np.asarray(data["ground_truth"], dtype=np.float64),
            "predicted": np.asarray(data["predicted"], dtype=np.float64),
        }

    raise ValueError(f"Formato não suportado: {file_path.suffix}")


def run_validation_suite(
    dataset_dir: Path | str,
    output_dir: Path | str | None = None,
    engines: list[str] | None = None,
) -> dict[str, Any]:
    """Executa a bateria de validação em todos os ficheiros do diretório de dados."""
    ds_path = Path(dataset_dir)
    if not ds_path.is_dir():
        raise FileNotFoundError(f"Diretório de dataset não encontrado: {ds_path}")

    out_path = Path(output_dir) if output_dir else ds_path / "reports"
    out_path.mkdir(parents=True, exist_ok=True)

    files = sorted(list(ds_path.glob("*.csv")) + list(ds_path.glob("*.npz")))
    if not files:
        raise ValueError(f"Nenhum ficheiro .csv ou .npz encontrado em {ds_path}")

    results: dict[str, Any] = {
        "dataset_dir": str(ds_path),
        "engines": engines or ["default"],
        "trials": {},
        "all_passed": True,
    }

    markdown_lines = [
        "# Relatório de Validação Científica dos Motores de BikeFit",
        "",
        f"- **Dataset:** `{ds_path}`",
        f"- **Total de Ensaios:** {len(files)}",
        "",
        "| Ensaio / Articulação | N | MAE (°) | RMSE (°) | Viés (°) | 95% LoA (°) | Pearson r | Estado |",
        "|---|---|---|---|---|---|---|:---:|",
    ]

    for f in files:
        data = load_dataset_file(f)
        joint_name = data["joint_name"]
        gt = data["ground_truth"]
        pred = data["predicted"]

        metrics = compute_validation_metrics(gt, pred)
        passed = metrics.is_acceptable()
        if not passed:
            results["all_passed"] = False

        results["trials"][data["name"]] = {
            "joint_name": joint_name,
            "metrics": metrics.to_dict(),
            "passed": passed,
        }

        # Gerar gráfico de Bland-Altman
        plot_png = generate_bland_altman_plot(gt, pred, joint_name=joint_name)
        plot_file = out_path / f"bland_altman_{data['name']}.png"
        plot_file.write_bytes(plot_png)

        status_icon = "✅ PASS" if passed else "❌ FAIL"
        markdown_lines.append(
            f"| **{joint_name}** (`{f.name}`) | {metrics.n_samples} | "
            f"{metrics.mae:.2f} | {metrics.rmse:.2f} | {metrics.bias:+.2f} | "
            f"[{metrics.loa_lower:+.1f}, {metrics.loa_upper:+.1f}] | {metrics.pearson_r:.4f} | {status_icon} |"
        )

    markdown_lines.append("")
    markdown_lines.append("### Critérios de Aceitação Homologados")
    markdown_lines.append("- **MAE:** $\\le 3.0°$ (exatidão biomecânica)")
    markdown_lines.append("- **RMSE:** $\\le 4.0°$ (estabilidade sem saltos)")
    markdown_lines.append("- **Viés Absoluto:** $\\le 1.5°$ (ausência de erro sistemático)")
    markdown_lines.append("- **Correlação Pearson ($r$):** $\\ge 0.95$")

    report_md = "\n".join(markdown_lines)
    (out_path / "validation_report.md").write_text(report_md, encoding="utf-8")
    (out_path / "validation_results.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    return results


def main() -> None:
    """Entrypoint CLI para execução do runner de validação."""
    if hasattr(sys.stdout, "reconfigure"):
        import contextlib

        with contextlib.suppress(Exception):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Runner de Validação Científica do Athlete Motion")
    parser.add_argument("--dataset", required=False, help="Caminho para o diretório de dados (.csv/.npz)")
    parser.add_argument("--engines", default="yolo11_pose_fast,rtmpose", help="Motores a comparar")
    parser.add_argument("--out", default=None, help="Diretório de saída dos relatórios")
    parser.add_argument("--generate-synthetic", default=None, help="Gera dataset sintético no caminho especificado")

    args = parser.parse_args()

    if args.generate_synthetic:
        p = create_synthetic_validation_dataset(args.generate_synthetic)
        print(f"[OK] Dataset sintético criado com sucesso em: {p}")
        if not args.dataset:
            args.dataset = str(p)

    if not args.dataset:
        print("[ERRO] É necessário especificar --dataset ou --generate-synthetic.")
        sys.exit(1)

    engines_list = [e.strip() for e in args.engines.split(",") if e.strip()]
    res = run_validation_suite(args.dataset, output_dir=args.out, engines=engines_list)

    print("\n" + "=" * 70)
    print("ATHLETE MOTION -- RESUMO DA VALIDACAO CIENTIFICA")
    print("=" * 70)
    for trial_name, t_data in res["trials"].items():
        m = t_data["metrics"]
        st = "[PASS] APROVADO" if t_data["passed"] else "[FAIL] REJEITADO"
        print(
            f"* {t_data['joint_name']} ({trial_name}): MAE={m['mae']:.2f} deg | RMSE={m['rmse']:.2f} deg | "
            f"Vies={m['bias']:+.2f} deg | LoA=[{m['loa_lower']:+.1f} deg, {m['loa_upper']:+.1f} deg] | "
            f"r={m['pearson_r']:.4f} -> {st}"
        )
    print("=" * 70)
    print(f"Status Global: {'[PASS] CONFORME' if res['all_passed'] else '[FAIL] NAO CONFORME'}\n")


if __name__ == "__main__":
    main()
