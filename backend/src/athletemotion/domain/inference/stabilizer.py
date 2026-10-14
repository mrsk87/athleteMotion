"""Módulo de estabilização de segmentos anatómicos rígidos (função pura).

Na biomecânica do ciclismo no plano sagital (2D), o fémur e a tíbia comportam-se
como corpos rígidos cujo comprimento projetado varia dentro de uma margem estreita
(máx ~12% de variação por rotação pélvica/perspetiva). Variações superiores indicam
quase invariavelmente saltos espúrios ('jitter' ou 'swap' de membros) do modelo de IA.

Princípios de Engenharia (AGENTS.md):
1. Função estritamente pura sem efeitos colaterais: stabilize(landmarks, state, ...)
   devolve (stabilized_landmarks, new_state, validation).
2. Imutabilidade: nenhum objeto Landmark2D de entrada é alterado in-place.
3. Cálculos de distância euclidiana exclusivamente em píxeis reais da imagem.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass

import numpy as np

from athletemotion.domain.inference.types import Landmark2D, SegmentValidation


@dataclass(frozen=True)
class StabilizerParams:
    """Parâmetros de configuração do estabilizador de segmentos rígidos."""

    rigid_tolerance_pct: float = 12.0
    history_window: int = 15
    min_samples_for_validation: int = 5
    smoothing_alpha: float = 0.3  # peso do frame atual (1-alpha para o último válido)


@dataclass(frozen=True)
class StabilizerState:
    """Estado imutável do estabilizador entre fotogramas sequenciais."""

    femur_history: tuple[float, ...] = ()
    tibia_history: tuple[float, ...] = ()
    last_valid_landmarks: dict[str, Landmark2D] | None = None


DEFAULT_STABILIZER_PARAMS = StabilizerParams()


def stabilize(
    landmarks: Mapping[str, Landmark2D],
    state: StabilizerState,
    w: int,
    h: int,
    params: StabilizerParams | None = None,
) -> tuple[dict[str, Landmark2D], StabilizerState, SegmentValidation]:
    """Valida e estabiliza segmentos rígidos do membro inferior sem mutação de estado.

    Args:
        landmarks: Dicionário de marcos anatómicos do fotograma atual.
        state: Estado imutável anterior contendo históricos de comprimentos.
        w: Largura do fotograma em píxeis.
        h: Altura do fotograma em píxeis.
        params: Parâmetros configuráveis de tolerância e suavização.

    Returns:
        Tuplo (landmarks_estabilizados, novo_estado, validacao_de_segmento).
    """
    cfg = params or DEFAULT_STABILIZER_PARAMS
    width = float(max(1, w))
    height = float(max(1, h))

    # Cria cópia superficial rasa do dicionário com cópias dos marcos
    output_landmarks: dict[str, Landmark2D] = {k: lm.model_copy() for k, lm in landmarks.items()}

    hip = output_landmarks.get("hip")
    knee = output_landmarks.get("knee")
    ankle = output_landmarks.get("ankle")

    # Caso faltem marcos essenciais da perna
    if hip is None or knee is None or ankle is None:
        val = SegmentValidation(
            femur_length=0.0,
            tibia_length=0.0,
            femur_valid=False,
            tibia_valid=False,
            segment_error_pct=0.0,
        )
        return output_landmarks, state, val

    # Comprimentos reais em píxeis
    femur_px = math.hypot((hip.x - knee.x) * width, (hip.y - knee.y) * height)
    tibia_px = math.hypot((knee.x - ankle.x) * width, (knee.y - ankle.y) * height)

    femur_valid = True
    tibia_valid = True
    err_pct = 0.0

    # Validação contra a mediana histórica
    if (
        len(state.femur_history) >= cfg.min_samples_for_validation
        and len(state.tibia_history) >= cfg.min_samples_for_validation
    ):
        med_femur = float(np.median(state.femur_history))
        med_tibia = float(np.median(state.tibia_history))

        femur_diff = abs(femur_px - med_femur) / med_femur if med_femur > 0.0 else 0.0
        tibia_diff = abs(tibia_px - med_tibia) / med_tibia if med_tibia > 0.0 else 0.0
        err_pct = max(femur_diff, tibia_diff) * 100.0

        tol = cfg.rigid_tolerance_pct / 100.0
        if femur_diff > tol:
            femur_valid = False
        if tibia_diff > tol:
            tibia_valid = False

    is_overall_valid = femur_valid and tibia_valid

    if is_overall_valid:
        # Estado válido: acrescenta ao histórico mantendo tamanho máximo
        new_femur_hist = (*state.femur_history, femur_px)[-cfg.history_window :]
        new_tibia_hist = (*state.tibia_history, tibia_px)[-cfg.history_window :]
        # Salva cópia imutável dos landmarks válidos
        saved_valid = {k: lm.model_copy() for k, lm in output_landmarks.items()}
        new_state = StabilizerState(
            femur_history=new_femur_hist,
            tibia_history=new_tibia_hist,
            last_valid_landmarks=saved_valid,
        )
    else:
        # Salto anómalo detetado: se existir frame válido anterior, interpola
        if state.last_valid_landmarks is not None:
            alpha = cfg.smoothing_alpha
            beta = 1.0 - alpha
            for k in ("hip", "knee", "ankle"):
                if k in output_landmarks and k in state.last_valid_landmarks:
                    curr = output_landmarks[k]
                    last = state.last_valid_landmarks[k]
                    output_landmarks[k] = Landmark2D(
                        x=float(np.clip(curr.x * alpha + last.x * beta, 0.0, 1.0)),
                        y=float(np.clip(curr.y * alpha + last.y * beta, 0.0, 1.0)),
                        z=float(curr.z * alpha + last.z * beta),
                        visibility=float(min(curr.visibility, last.visibility)),
                        estimated=True,
                    )
        # Mantém histórico existente sem contaminar com medição espúria
        new_state = state

    val = SegmentValidation(
        femur_length=round(femur_px, 2),
        tibia_length=round(tibia_px, 2),
        femur_valid=femur_valid,
        tibia_valid=tibia_valid,
        segment_error_pct=round(err_pct, 2),
    )

    return output_landmarks, new_state, val
