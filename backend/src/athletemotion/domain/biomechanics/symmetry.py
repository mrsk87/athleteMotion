"""Cálculo do Índice de Simetria Bilateral (SI) entre membros inferiores."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SymmetryReport:
    joint_name: str
    left_value: float
    right_value: float
    symmetry_index: float
    classification: str
    recommendation_pt: str
    recommendation_en: str


def calculate_symmetry_index(left_val: float, right_val: float, joint_name: str = "joelho") -> SymmetryReport:
    """Calcula o Índice de Simetria Bilateral (SI) padrão da literatura biomecânica."""
    mean_val = (left_val + right_val) / 2.0
    si = 0.0 if mean_val == 0 else round((abs(left_val - right_val) / mean_val) * 100.0, 2)
    diff = round(abs(left_val - right_val), 1)

    if si <= 2.0:
        classification = "excelente"
        rec_pt = f"Excelente simetria bilateral em {joint_name} (diferença de apenas {diff}°). Sem necessidade de intervenção."
        rec_en = f"Excellent bilateral symmetry in {joint_name} (difference of only {diff}°). No intervention required."
    elif si <= 4.0:
        classification = "ligeira"
        rec_pt = f"Assimetria ligeira em {joint_name} ({diff}°). Verificar se os taquinhos dos sapatos estão simetricamente alinhados."
        rec_en = f"Mild asymmetry in {joint_name} ({diff}°). Check if shoe cleats are symmetrically positioned."
    else:
        classification = "significativa"
        side_lower = "direita" if right_val < left_val else "esquerda"
        side_lower_en = "right" if right_val < left_val else "left"
        rec_pt = (
            f"Assimetria significativa em {joint_name} ({diff}°, SI: {si}%). "
            f"A perna {side_lower} atinge menor amplitude/extensão. Recomenda-se avaliar dismetria "
            f"ou instalar calços de compensação de 1 a 2mm sob o taquinho da perna {side_lower}."
        )
        rec_en = (
            f"Significant asymmetry in {joint_name} ({diff}°, SI: {si}%). "
            f"The {side_lower_en} leg achieves less extension. Clinical assessment for leg length discrepancy "
            f"or adding 1-2mm cleat shims under the {side_lower_en} shoe is recommended."
        )

    return SymmetryReport(
        joint_name=joint_name,
        left_value=round(left_val, 1),
        right_value=round(right_val, 1),
        symmetry_index=si,
        classification=classification,
        recommendation_pt=rec_pt,
        recommendation_en=rec_en,
    )
