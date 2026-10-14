"""Deteção determinística do lado visível (sagital esquerdo ou direito) do ciclista.

Analisa a visibilidade diferencial dos marcos anatómicos homólogos e a orientação
cefálica (nariz vs orelhas/ombros) para inferir o perfil corporal visível de forma estável.
"""

from __future__ import annotations

from typing import Any


def _extract_landmark(lm_dict: dict[str, Any], name: str) -> tuple[float, float, float] | None:
    """Extrai com segurança (x, y, visibilidade) de diferentes formatos de marcos."""
    val = lm_dict.get(name)
    if val is None:
        return None
    if hasattr(val, "x") and hasattr(val, "y"):
        vis = getattr(val, "visibility", 1.0)
        return float(val.x), float(val.y), float(vis)
    if isinstance(val, (tuple, list)):
        x = float(val[0])
        y = float(val[1])
        vis = float(val[2]) if len(val) > 2 else 1.0
        return x, y, vis
    return None


def detect_visible_side(
    landmarks_history: list[dict[str, Any]],
    default_side: str = "right",
    min_confidence: float = 0.60,
) -> tuple[str, float]:
    """Determina se a câmara está a captar o lado esquerdo ("left") ou direito ("right") do atleta.

    Args:
        landmarks_history: Sequência temporal de dicionários de marcos.
        default_side: Lado por defeito caso os dados sejam ambíguos.
        min_confidence: Grau de confiança mínimo para recomendar a mudança.

    Returns:
        Tuplo contendo (lado_sugerido, confianca_0_a_1).
    """
    if not landmarks_history:
        return default_side, 0.50

    left_keys = ["left_shoulder", "left_hip", "left_knee", "left_ankle", "left_elbow", "left_wrist"]
    right_keys = ["right_shoulder", "right_hip", "right_knee", "right_ankle", "right_elbow", "right_wrist"]

    left_vis_scores: list[float] = []
    right_vis_scores: list[float] = []
    heading_votes: list[str] = []

    for frame_lms in landmarks_history:
        # 1. Medir visibilidade média do lado esquerdo e direito
        l_vis = [
            extracted[2]
            for k in left_keys
            if (extracted := _extract_landmark(frame_lms, k)) is not None
        ]
        r_vis = [
            extracted[2]
            for k in right_keys
            if (extracted := _extract_landmark(frame_lms, k)) is not None
        ]

        if l_vis:
            left_vis_scores.append(sum(l_vis) / len(l_vis))
        if r_vis:
            right_vis_scores.append(sum(r_vis) / len(r_vis))

        # 2. Sentido de marcha (cabeça vs tronco)
        nose = _extract_landmark(frame_lms, "nose")
        l_ear = _extract_landmark(frame_lms, "left_ear")
        r_ear = _extract_landmark(frame_lms, "right_ear")
        l_sh = _extract_landmark(frame_lms, "left_shoulder")
        r_sh = _extract_landmark(frame_lms, "right_shoulder")

        # Ponto de referência dorsal/posterior
        rear_x: float | None = None
        if l_ear and r_ear:
            rear_x = (l_ear[0] + r_ear[0]) / 2.0
        elif l_sh and r_sh:
            rear_x = (l_sh[0] + r_sh[0]) / 2.0
        elif l_sh:
            rear_x = l_sh[0]
        elif r_sh:
            rear_x = r_sh[0]

        if nose and rear_x is not None:
            # Comparação da orelha visível:
            l_ear_vis = l_ear[2] if l_ear else 0.0
            r_ear_vis = r_ear[2] if r_ear else 0.0

            if r_ear_vis > l_ear_vis + 0.15:
                heading_votes.append("right")
            elif l_ear_vis > r_ear_vis + 0.15:
                heading_votes.append("left")

    mean_left_vis = sum(left_vis_scores) / len(left_vis_scores) if left_vis_scores else 0.5
    mean_right_vis = sum(right_vis_scores) / len(right_vis_scores) if right_vis_scores else 0.5

    # Margem diferencial de visibilidade entre os dois lados
    vis_diff = mean_right_vis - mean_left_vis  # > 0 -> lado direito mais visível
    abs_diff = abs(vis_diff)

    # Concordância com votos craniofaciais
    right_votes = heading_votes.count("right")
    left_votes = heading_votes.count("left")
    total_votes = len(heading_votes)

    if vis_diff > 0.05:
        primary_candidate = "right"
    elif vis_diff < -0.05:
        primary_candidate = "left"
    else:
        # Se visibilidade está muito próxima, recorrer a votos craniofaciais
        if right_votes > left_votes:
            primary_candidate = "right"
        elif left_votes > right_votes:
            primary_candidate = "left"
        else:
            primary_candidate = default_side

    # Cálculo da confiança
    base_conf = 0.50 + min(0.40, abs_diff * 1.5)
    if total_votes > 0:
        vote_agreement = (
            right_votes / total_votes if primary_candidate == "right" else left_votes / total_votes
        )
        conf = round(base_conf * 0.7 + vote_agreement * 0.3, 2)
    else:
        conf = round(base_conf, 2)

    # Se a confiança for menor que min_confidence, mantém o default
    if conf < min_confidence:
        return default_side, conf

    return primary_candidate, conf
