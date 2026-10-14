"""Módulo de cálculo de métricas estatísticas para validação científica de motores (R17).

Implementa métricas determinísticas e sem enviesamentos para comparação entre
sistemas de visão artificial e verdade-terreno (goniómetros, marcadores ou sistemas óticos).
Calcula MAE, RMSE, viés sistemático, desvio padrão de diferenças, limites de concordância
de Bland-Altman a 95% (LoA) e correlação de Pearson.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np


@dataclass(frozen=True)
class ValidationMetrics:
    """Conjunto padronizado de métricas de validação científica para uma articulação."""

    mae: float
    rmse: float
    bias: float
    std_diff: float
    loa_lower: float
    loa_upper: float
    pearson_r: float
    pct_within_3deg: float
    pct_within_5deg: float
    n_samples: int

    def to_dict(self) -> dict[str, Any]:
        """Converte as métricas para dicionário estruturado."""
        return asdict(self)

    def is_acceptable(
        self,
        max_mae: float = 3.0,
        max_rmse: float = 4.0,
        max_bias: float = 1.5,
        min_r: float = 0.95,
    ) -> bool:
        """Avalia se as medições cumprem os critérios de aceitação clínica."""
        return (
            self.mae <= max_mae
            and self.rmse <= max_rmse
            and abs(self.bias) <= max_bias
            and self.pearson_r >= min_r
        )

    def summary_markdown(self, joint_name: str = "Joelho") -> str:
        """Gera sumário formatado em Markdown com semáforo de conformidade."""
        status_mae = "✅" if self.mae <= 3.0 else "❌"
        status_rmse = "✅" if self.rmse <= 4.0 else "❌"
        status_r = "✅" if self.pearson_r >= 0.95 else "❌"

        return (
            f"### Resultados de Validação — {joint_name}\n\n"
            f"- **Amostras ($n$):** {self.n_samples}\n"
            f"- **MAE:** {self.mae:.2f}° {status_mae} (meta: $\\le 3.0°$)\n"
            f"- **RMSE:** {self.rmse:.2f}° {status_rmse} (meta: $\\le 4.0°$)\n"
            f"- **Viés Sistemático:** {self.bias:+.2f}° (DP: {self.std_diff:.2f}°)\n"
            f"- **95% Limites de Concordância (LoA):** [{self.loa_lower:+.2f}°, {self.loa_upper:+.2f}°]\n"
            f"- **Correlação Pearson ($r$):** {self.pearson_r:.4f} {status_r} (meta: $\\ge 0.95$)\n"
            f"- **Acurácia $\\le 3.0°$:** {self.pct_within_3deg:.1f}%\n"
            f"- **Acurácia $\\le 5.0°$:** {self.pct_within_5deg:.1f}%\n"
        )


def compute_validation_metrics(
    ground_truth: Sequence[float],
    predicted: Sequence[float],
) -> ValidationMetrics:
    """Calcula todas as métricas estatísticas de concordância entre referência e estimativa.

    Args:
        ground_truth: Ângulos de referência verdade-terreno em graus.
        predicted: Ângulos estimados pelo motor de inferência em graus.

    Returns:
        Instância imutável de ValidationMetrics.

    Raises:
        ValueError: Se as sequências tiverem dimensões distintas ou forem vazias.
    """
    y_true = np.asarray(ground_truth, dtype=np.float64)
    y_pred = np.asarray(predicted, dtype=np.float64)

    if len(y_true) != len(y_pred):
        raise ValueError(
            f"Dimensões incompatíveis: ground_truth tem {len(y_true)} elementos e predicted tem {len(y_pred)}"
        )
    if len(y_true) == 0:
        raise ValueError("Não é possível calcular métricas sobre amostras vazias.")

    # Diferença ponto a ponto: erro = estimativa - referência
    diffs = y_pred - y_true
    abs_diffs = np.abs(diffs)

    mae = float(np.mean(abs_diffs))
    rmse = float(np.sqrt(np.mean(diffs**2)))
    bias = float(np.mean(diffs))

    # Desvio padrão das diferenças (com 1 grau de liberdade se n > 1)
    std_diff = float(np.std(diffs, ddof=1)) if len(diffs) > 1 else 0.0

    # Limites de concordância de 95% (Bland-Altman 1.96 * SD)
    loa_lower = float(bias - 1.96 * std_diff)
    loa_upper = float(bias + 1.96 * std_diff)

    # Coeficiente de correlação linear de Pearson
    if len(y_true) > 1 and np.std(y_true) > 1e-7 and np.std(y_pred) > 1e-7:
        r_matrix = np.corrcoef(y_true, y_pred)
        pearson_r = float(r_matrix[0, 1])
        if math.isnan(pearson_r):
            pearson_r = 1.0 if np.allclose(y_true, y_pred) else 0.0
    else:
        pearson_r = 1.0 if np.allclose(y_true, y_pred) else 0.0

    pct_within_3deg = float(np.mean(abs_diffs <= 3.0) * 100.0)
    pct_within_5deg = float(np.mean(abs_diffs <= 5.0) * 100.0)

    return ValidationMetrics(
        mae=mae,
        rmse=rmse,
        bias=bias,
        std_diff=std_diff,
        loa_lower=loa_lower,
        loa_upper=loa_upper,
        pearson_r=pearson_r,
        pct_within_3deg=pct_within_3deg,
        pct_within_5deg=pct_within_5deg,
        n_samples=len(y_true),
    )
