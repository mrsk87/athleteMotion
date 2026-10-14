"""Análise e gráficos de concordância de Bland-Altman para validação biomecânica (R17).

Implementa a metodologia estatística de Bland & Altman (1986, 1999) para avaliação
de concordância entre dois métodos de medição clínica sem assumir correlação espúria.
Produz gráficos de alta definição utilizando a API Orientada a Objetos do Matplotlib (Agg).
"""

from __future__ import annotations

import io
from collections.abc import Sequence

import numpy as np
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure

from athletemotion.validation.metrics import compute_validation_metrics


def compute_bland_altman_stats(
    ground_truth: Sequence[float],
    predicted: Sequence[float],
) -> dict[str, float]:
    """Calcula as grandezas estatísticas essenciais do teste de Bland-Altman."""
    metrics = compute_validation_metrics(ground_truth, predicted)
    y_true = np.asarray(ground_truth, dtype=np.float64)
    y_pred = np.asarray(predicted, dtype=np.float64)
    means = (y_true + y_pred) / 2.0
    diffs = y_pred - y_true

    return {
        "n": float(len(y_true)),
        "bias": metrics.bias,
        "std_diff": metrics.std_diff,
        "loa_lower": metrics.loa_lower,
        "loa_upper": metrics.loa_upper,
        "mean_min": float(np.min(means)),
        "mean_max": float(np.max(means)),
        "diff_min": float(np.min(diffs)),
        "diff_max": float(np.max(diffs)),
    }


def generate_bland_altman_plot(
    ground_truth: Sequence[float],
    predicted: Sequence[float],
    joint_name: str = "Joelho",
    units: str = "°",
    language: str = "pt",
) -> bytes:
    """Gera gráfico formal de Bland-Altman (Diferença vs Média) em PNG."""
    is_pt = language.lower() == "pt"
    y_true = np.asarray(ground_truth, dtype=np.float64)
    y_pred = np.asarray(predicted, dtype=np.float64)

    if len(y_true) != len(y_pred) or len(y_true) == 0:
        raise ValueError("Sequências inválidas para gráfico de Bland-Altman.")

    means = (y_true + y_pred) / 2.0
    diffs = y_pred - y_true

    bias = float(np.mean(diffs))
    std = float(np.std(diffs, ddof=1)) if len(diffs) > 1 else 0.0
    loa_upper = bias + 1.96 * std
    loa_lower = bias - 1.96 * std

    fig = Figure(figsize=(6.4, 3.8), dpi=150, facecolor="#ffffff")
    FigureCanvasAgg(fig)
    ax = fig.add_subplot(111)

    ax.set_facecolor("#f8fafc")
    ax.grid(True, linestyle="--", alpha=0.5, color="#cbd5e1")
    for spine in ax.spines.values():
        spine.set_color("#cbd5e1")

    # Linha zero de referência (concordância perfeita)
    ax.axhline(0.0, color="#64748b", linestyle=":", linewidth=1.0)

    # Faixa sombreada de 95% LoA
    ax.axhspan(loa_lower, loa_upper, color="#3b82f6", alpha=0.08)

    # Pontos de dispersão
    ax.scatter(means, diffs, color="#2563eb", alpha=0.65, s=26, edgecolors="none")

    # Linha de viés médio (Bias)
    label_bias = f"Viés Médio: {bias:+.2f}{units}" if is_pt else f"Mean Bias: {bias:+.2f}{units}"
    ax.axhline(bias, color="#dc2626", linestyle="-", linewidth=1.6, label=label_bias)

    # Linhas de limites de concordância (+1.96 DP e -1.96 DP)
    label_upper = (
        f"+1.96 DP: {loa_upper:+.2f}{units}" if is_pt else f"+1.96 SD: {loa_upper:+.2f}{units}"
    )
    label_lower = (
        f"-1.96 DP: {loa_lower:+.2f}{units}" if is_pt else f"-1.96 SD: {loa_lower:+.2f}{units}"
    )
    ax.axhline(loa_upper, color="#059669", linestyle="--", linewidth=1.3, label=label_upper)
    ax.axhline(loa_lower, color="#059669", linestyle="--", linewidth=1.3, label=label_lower)

    title = (
        f"Concordância de Bland-Altman — {joint_name} (n={len(y_true)})"
        if is_pt
        else f"Bland-Altman Agreement Plot — {joint_name} (n={len(y_true)})"
    )
    ax.set_title(title, fontsize=10, fontweight="bold", color="#0f172a", pad=8)
    ax.set_xlabel(
        f"Média entre Métodos [{units}]" if is_pt else f"Mean of Methods [{units}]",
        fontsize=8.5,
        color="#334155",
    )
    ax.set_ylabel(
        f"Diferença (Estimado - Referência) [{units}]"
        if is_pt
        else f"Difference (Predicted - Reference) [{units}]",
        fontsize=8.5,
        color="#334155",
    )
    ax.tick_params(axis="both", labelsize=8, colors="#334155")
    ax.legend(loc="upper right", fontsize=7.5, framealpha=0.9, facecolor="#ffffff")

    fig.tight_layout(pad=1.0)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    buf.seek(0)
    return buf.getvalue()
