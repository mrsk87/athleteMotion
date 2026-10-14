"""Geração de gráficos biomecânicos thread-safe para relatórios PDF (R17).

Utiliza a API Orientada a Objetos do Matplotlib com o backend puro 'Agg' (sem pyplot),
garantindo total isolamento de estado entre threads concorrentes e execução sem bloqueios.
Produz gráficos compactos, legíveis e com estética moderna para integração em relatórios PDF.
"""

from __future__ import annotations

import io
from collections.abc import Sequence
from typing import Any

import numpy as np
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure


def generate_cycle_curve_chart(
    mean_trajectory: Sequence[float] | np.ndarray[Any, Any],
    std_trajectory: Sequence[float] | np.ndarray[Any, Any] | None = None,
    joint_name: str = "Joelho",
    target_min: float | None = 145.0,
    target_max: float | None = 155.0,
    language: str = "pt",
) -> bytes:
    """Gera curva cinemática média do ciclo (0-100% da revolução) com banda de desvio padrão.

    Args:
        mean_trajectory: Amostras ao longo do ciclo (tamanho típico: 100 pontos).
        std_trajectory: Desvio-padrão amostral ponto a ponto (opcional).
        joint_name: Nome legível da articulação analisada.
        target_min: Limite inferior da faixa ergonómica recomendada (opcional).
        target_max: Limite superior da faixa ergonómica recomendada (opcional).
        language: 'pt' ou 'en' para textos e legendas.

    Returns:
        Bytes da imagem PNG renderizada em memória.
    """
    is_pt = language.lower() == "pt"
    y_mean = np.asarray(mean_trajectory, dtype=np.float64)
    n_points = len(y_mean)
    x = np.linspace(0.0, 100.0, num=n_points)

    fig = Figure(figsize=(6.2, 2.6), dpi=150, facecolor="#ffffff")
    FigureCanvasAgg(fig)
    ax = fig.add_subplot(111)

    # Estilização moderna e limpa
    ax.set_facecolor("#f8fafc")
    ax.grid(True, linestyle="--", alpha=0.5, color="#cbd5e1")
    for spine in ax.spines.values():
        spine.set_color("#cbd5e1")

    # Faixa ergonómica alvo se definida
    if target_min is not None and target_max is not None:
        ax.axhspan(
            target_min,
            target_max,
            color="#22c55e",
            alpha=0.15,
            label="Faixa Alvo (Target)" if is_pt else "Target Band",
        )
        ax.axhline(target_min, color="#16a34a", linestyle=":", linewidth=0.8, alpha=0.7)
        ax.axhline(target_max, color="#16a34a", linestyle=":", linewidth=0.8, alpha=0.7)

    # Banda de incerteza/dispersão (média ± 1 DP)
    if std_trajectory is not None and len(std_trajectory) == n_points:
        y_std = np.asarray(std_trajectory, dtype=np.float64)
        ax.fill_between(
            x,
            y_mean - y_std,
            y_mean + y_std,
            color="#3b82f6",
            alpha=0.20,
            label="Dispersão (±1 DP)" if is_pt else "Dispersion (±1 SD)",
        )

    # Trajetória média
    label_traj = f"Média {joint_name}" if is_pt else f"Mean {joint_name}"
    ax.plot(x, y_mean, color="#1d4ed8", linewidth=2.0, label=label_traj)

    # Marcação de pontos anatómicos BDC (fundo) e TDC (topo)
    ax.axvline(
        50.0,
        color="#94a3b8",
        linestyle="--",
        linewidth=0.8,
        label="BDC (~6h)" if is_pt else "BDC (~6 o'clock)",
    )

    title = (
        f"Perfil Angular por Ciclo de Pedalada — {joint_name}"
        if is_pt
        else f"Pedal Cycle Angle Profile — {joint_name}"
    )
    ax.set_title(title, fontsize=10, fontweight="bold", color="#0f172a", pad=8)
    ax.set_xlabel(
        "Fase da Pedalada (%)" if is_pt else "Pedal Phase (%)", fontsize=8, color="#475569"
    )
    ax.set_ylabel("Ângulo (°)" if is_pt else "Angle (deg)", fontsize=8, color="#475569")
    ax.set_xlim(0, 100)
    ax.tick_params(axis="both", labelsize=8, colors="#475569")
    ax.legend(loc="upper right", fontsize=7, framealpha=0.85, facecolor="#ffffff")

    fig.tight_layout(pad=1.0)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    buf.seek(0)
    return buf.getvalue()


def generate_bdc_distribution_histogram(
    bdc_angles: Sequence[float],
    target_min: float = 145.0,
    target_max: float = 155.0,
    language: str = "pt",
) -> bytes:
    """Gera histograma de distribuição dos ângulos no Ponto Morto Inferior (BDC) entre ciclos."""
    is_pt = language.lower() == "pt"
    angles = np.asarray(bdc_angles, dtype=np.float64)
    if len(angles) == 0:
        angles = np.array([150.0], dtype=np.float64)

    fig = Figure(figsize=(3.1, 2.3), dpi=150, facecolor="#ffffff")
    FigureCanvasAgg(fig)
    ax = fig.add_subplot(111)

    ax.set_facecolor("#f8fafc")
    ax.grid(True, linestyle="--", alpha=0.4, color="#cbd5e1")
    for spine in ax.spines.values():
        spine.set_color("#cbd5e1")

    # Faixa alvo
    ax.axvspan(target_min, target_max, color="#22c55e", alpha=0.15)
    ax.axvline(target_min, color="#16a34a", linestyle=":", linewidth=0.8)
    ax.axvline(target_max, color="#16a34a", linestyle=":", linewidth=0.8)

    # Histograma
    n_bins = max(5, min(15, len(angles) // 2))
    ax.hist(angles, bins=n_bins, color="#3b82f6", edgecolor="#1d4ed8", alpha=0.75, rwidth=0.85)

    # Linha da mediana
    median_val = float(np.median(angles))
    ax.axvline(
        median_val,
        color="#dc2626",
        linestyle="-",
        linewidth=1.5,
        label=f"Mediana: {median_val:.1f}°" if is_pt else f"Median: {median_val:.1f}°",
    )

    title = "Distribuição BDC Joelho" if is_pt else "BDC Knee Distribution"
    ax.set_title(title, fontsize=9, fontweight="bold", color="#0f172a", pad=6)
    ax.set_xlabel("Ângulo (°)" if is_pt else "Angle (deg)", fontsize=8, color="#475569")
    ax.set_ylabel("Frequência" if is_pt else "Frequency", fontsize=8, color="#475569")
    ax.tick_params(axis="both", labelsize=7, colors="#475569")
    ax.legend(loc="upper right", fontsize=6.5, framealpha=0.9, facecolor="#ffffff")

    fig.tight_layout(pad=0.8)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    buf.seek(0)
    return buf.getvalue()


def generate_fatigue_trend_chart(
    cycles: Sequence[int],
    bdc_angles: Sequence[float],
    language: str = "pt",
) -> bytes:
    """Gera gráfico de dispersão e linha de tendência de fadiga/deriva angular ao longo dos ciclos."""
    is_pt = language.lower() == "pt"
    x = np.asarray(cycles, dtype=np.float64)
    y = np.asarray(bdc_angles, dtype=np.float64)

    if len(x) == 0:
        x = np.array([1.0], dtype=np.float64)
        y = np.array([150.0], dtype=np.float64)

    fig = Figure(figsize=(3.1, 2.3), dpi=150, facecolor="#ffffff")
    FigureCanvasAgg(fig)
    ax = fig.add_subplot(111)

    ax.set_facecolor("#f8fafc")
    ax.grid(True, linestyle="--", alpha=0.4, color="#cbd5e1")
    for spine in ax.spines.values():
        spine.set_color("#cbd5e1")

    # Pontos de cada ciclo
    ax.scatter(x, y, color="#6366f1", alpha=0.7, s=18, edgecolors="none")

    # Linha de tendência linear se houver pelo menos 3 pontos
    if len(x) >= 3 and np.std(x) > 1e-6:
        p = np.polyfit(x, y, 1)
        trend_y = np.polyval(p, x)
        slope = p[0]
        label_trend = (
            f"Deriva: {slope * 100:.2f}°/100c"
            if is_pt
            else f"Drift: {slope * 100:.2f}°/100c"
        )
        ax.plot(x, trend_y, color="#4338ca", linestyle="-", linewidth=1.5, label=label_trend)
        ax.legend(loc="upper right", fontsize=6.5, framealpha=0.9, facecolor="#ffffff")

    title = "Evolução Temporal BDC" if is_pt else "BDC Temporal Evolution"
    ax.set_title(title, fontsize=9, fontweight="bold", color="#0f172a", pad=6)
    ax.set_xlabel("N.º Ciclo" if is_pt else "Cycle #", fontsize=8, color="#475569")
    ax.set_ylabel("Ângulo (°)" if is_pt else "Angle (deg)", fontsize=8, color="#475569")
    ax.tick_params(axis="both", labelsize=7, colors="#475569")

    fig.tight_layout(pad=0.8)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    buf.seek(0)
    return buf.getvalue()
