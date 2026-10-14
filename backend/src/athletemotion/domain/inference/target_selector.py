"""Seletor e associador temporal de atletas para evitar saltos de alvo em deteções multi-pessoa.

Substitui a seleção ingénua por argmax(confiança) por uma função de pontuação ponderada
combinando confiança, sobreposição espacial (IoU), consistência de área e proximidade
cinemática ao centro estimado do ciclista.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class TargetSelectorConfig:
    """Parâmetros de configuração do algoritmo de seleção e bloqueio do ciclista."""

    w_conf: float = 0.25  # Peso da confiança intrínseca da deteção
    w_iou: float = 0.40  # Peso da sobreposição IoU com a caixa do frame anterior
    w_dist: float = 0.20  # Peso da proximidade ao centro previsto
    w_area: float = 0.15  # Peso da consistência de escala/área
    min_conf_threshold: float = 0.35  # Limiar mínimo de confiança para aceitação
    min_match_score: float = 0.30  # Pontuação mínima combinada para associação
    lock_frames: int = 5  # Número de frames consecutivos para bloquear o alvo
    max_lost_frames: int = 10  # Tolerância a oclusões antes de perder o ciclista


@dataclass
class DetectionCandidate:
    """Candidato a pessoa detetada no fotograma."""

    box: tuple[float, float, float, float]  # (x1, y1, x2, y2) em coordenadas normalizadas ou px
    confidence: float
    keypoints: np.ndarray | None = None
    candidate_id: int = 0

    @property
    def area(self) -> float:
        w = max(0.0, self.box[2] - self.box[0])
        h = max(0.0, self.box[3] - self.box[1])
        return w * h

    @property
    def center(self) -> tuple[float, float]:
        cx = (self.box[0] + self.box[2]) / 2.0
        cy = (self.box[1] + self.box[3]) / 2.0
        return cx, cy


def compute_iou(
    box_a: tuple[float, float, float, float], box_b: tuple[float, float, float, float]
) -> float:
    """Calcula a métrica Intersection over Union (IoU) entre duas caixas delimitadoras."""
    xa1, ya1, xa2, ya2 = box_a
    xb1, yb1, xb2, yb2 = box_b

    inter_x1 = max(xa1, xb1)
    inter_y1 = max(ya1, yb1)
    inter_x2 = min(xa2, xb2)
    inter_y2 = min(ya2, yb2)

    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    area_a = max(0.0, xa2 - xa1) * max(0.0, ya2 - ya1)
    area_b = max(0.0, xb2 - xb1) * max(0.0, yb2 - yb1)
    union_area = area_a + area_b - inter_area

    if union_area <= 1e-7:
        return 0.0
    return float(inter_area / union_area)


class TargetSelector:
    """Mantém a identidade estável do atleta alvo e evita alternâncias erráticas em cenas movimentadas."""

    def __init__(self, config: TargetSelectorConfig | None = None) -> None:
        self.config = config or TargetSelectorConfig()
        self.active_box: tuple[float, float, float, float] | None = None
        self.center: tuple[float, float] | None = None
        self.velocity: tuple[float, float] = (0.0, 0.0)
        self.consecutive_tracked_frames: int = 0
        self.consecutive_lost_frames: int = 0
        self.is_locked: bool = False

    def reset(self) -> None:
        """Reinicia o estado interno do associador temporal."""
        self.active_box = None
        self.center = None
        self.velocity = (0.0, 0.0)
        self.consecutive_tracked_frames = 0
        self.consecutive_lost_frames = 0
        self.is_locked = False

    def select_target(
        self, candidates: Sequence[DetectionCandidate]
    ) -> DetectionCandidate | None:
        """Seleciona o candidato mais provável a corresponder ao ciclista em análise.

        Args:
            candidates: Lista de candidatos detetados no frame atual.

        Returns:
            O candidato selecionado, ou None se nenhum corresponder e o alvo estiver perdido.
        """
        valid_candidates = [
            c for c in candidates if c.confidence >= self.config.min_conf_threshold
        ]

        if not valid_candidates:
            self._handle_missed_frame()
            return None

        # 1. Primeiro frame ou alvo não bloqueado/perdido
        if self.active_box is None:
            # Seleciona o candidato com maior confiança (ou maior área central)
            best = max(valid_candidates, key=lambda c: c.confidence)
            self._update_target(best)
            return best

        # 2. Já existe um alvo em seguimento: estimar centro previsto
        pred_cx = self.center[0] + self.velocity[0] if self.center else 0.0
        pred_cy = self.center[1] + self.velocity[1] if self.center else 0.0

        prev_w = max(1e-4, self.active_box[2] - self.active_box[0])
        prev_h = max(1e-4, self.active_box[3] - self.active_box[1])
        diag = math.hypot(prev_w, prev_h)

        best_candidate: DetectionCandidate | None = None
        best_score = -1.0

        for cand in valid_candidates:
            iou = compute_iou(self.active_box, cand.box)
            c_cx, c_cy = cand.center
            dist = math.hypot(c_cx - pred_cx, c_cy - pred_cy)
            dist_score = max(0.0, 1.0 - (dist / max(diag * 1.5, 1e-4)))

            cand_area = cand.area
            prev_area = prev_w * prev_h
            area_ratio = min(cand_area, prev_area) / max(cand_area, prev_area, 1e-6)

            score = (
                self.config.w_conf * cand.confidence
                + self.config.w_iou * iou
                + self.config.w_dist * dist_score
                + self.config.w_area * area_ratio
            )

            if score > best_score:
                best_score = score
                best_candidate = cand

        # 3. Decisão de associação
        if best_candidate is not None and best_score >= self.config.min_match_score:
            self._update_target(best_candidate)
            return best_candidate

        # 4. Nenhum candidato atingiu a pontuação mínima de correspondência
        self._handle_missed_frame()

        # Se não estava bloqueado e perdeu, reinicia no candidato com maior confiança
        if not self.is_locked:
            fallback = max(valid_candidates, key=lambda c: c.confidence)
            self._update_target(fallback)
            return fallback

        # Se estava bloqueado, não salta para um espectador qualquer a menos que esgote max_lost_frames
        if self.consecutive_lost_frames >= self.config.max_lost_frames:
            self.reset()
            fallback = max(valid_candidates, key=lambda c: c.confidence)
            self._update_target(fallback)
            return fallback

        return None

    def _update_target(self, candidate: DetectionCandidate) -> None:
        new_cx, new_cy = candidate.center
        if self.center is not None:
            # Filtro alfa para velocidade média
            vx = new_cx - self.center[0]
            vy = new_cy - self.center[1]
            self.velocity = (
                0.7 * self.velocity[0] + 0.3 * vx,
                0.7 * self.velocity[1] + 0.3 * vy,
            )
        else:
            self.velocity = (0.0, 0.0)

        self.active_box = candidate.box
        self.center = (new_cx, new_cy)
        self.consecutive_lost_frames = 0
        self.consecutive_tracked_frames += 1

        if self.consecutive_tracked_frames >= self.config.lock_frames:
            self.is_locked = True

    def _handle_missed_frame(self) -> None:
        self.consecutive_lost_frames += 1
        if self.consecutive_lost_frames >= self.config.max_lost_frames:
            self.reset()
