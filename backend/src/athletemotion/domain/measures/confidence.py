"""Módulo de cálculo de confiança e portão de qualidade (gating) para medições de BikeFit.

Garante que nenhuma recomendação clínica ou valor angular incerto é emitido sem
satisfazer o patamar mínimo de fiabilidade de 0.60 (60%).
"""

from __future__ import annotations

from dataclasses import dataclass

GATING_THRESHOLD: float = 0.60


@dataclass(frozen=True)
class MeasureConfidence:
    """Classificação de confiança multidimensional com portão de qualidade."""

    score: float
    factors: dict[str, float]
    withheld: bool = False
    withhold_reason: str | None = None

    def __post_init__(self) -> None:
        # Clamping de segurança
        bounded_score = max(0.0, min(1.0, float(self.score)))
        if bounded_score != self.score:
            object.__setattr__(self, "score", bounded_score)


def calculate_measure_confidence(
    visibility: float,
    cycles_count: int,
    periodicity_confidence: float = 1.0,
    calibration_quality: float = 1.0,
    model_agreement: float = 1.0,
    target_cycles_nominal: int = 5,
    min_threshold: float = GATING_THRESHOLD,
    metric_requires_calibration: bool = False,
) -> MeasureConfidence:
    """Calcula a pontuação composta de confiança e aplica o portão de qualidade (gating).

    Fatores considerados:
    1. visibility: Visibilidade média dos marcos articulares [0.0..1.0].
    2. cycles: Número de ciclos válidos normalizado face ao ideal (default 5 ciclos) [0.0..1.0].
    3. periodicity: Confiança espetral/autocorrelação da cadência da pedalada [0.0..1.0].
    4. calibration: Qualidade da calibração métrica [0.0..1.0].
    5. model_agreement: Concordância entre motores (ex: RTMPose vs YOLO) [0.0..1.0].

    Args:
        visibility: Grau de confiança/visibilidade média dos pontos chave.
        cycles_count: Contagem de rotações de pedalada válidas acumuladas.
        periodicity_confidence: Score de periodicidade da cadência.
        calibration_quality: Qualidade/presença de calibração espacial (1.0 se OK, 0.0 se ausente).
        model_agreement: Concordância entre estimadores (1.0 se verificado ou motor único).
        target_cycles_nominal: Meta mínima de ciclos para pontuação máxima.
        min_threshold: Limiar de gating abaixo do qual a medida é retida.
        metric_requires_calibration: True se a medida for dimensional (mm), exigindo calibração.

    Returns:
        MeasureConfidence com o score agregado, detalhe dos fatores e flag withheld.
    """
    v_norm = max(0.0, min(1.0, float(visibility)))
    c_norm = max(0.0, min(1.0, float(cycles_count) / max(1, target_cycles_nominal)))
    p_norm = max(0.0, min(1.0, float(periodicity_confidence)))
    cal_norm = max(0.0, min(1.0, float(calibration_quality)))
    agr_norm = max(0.0, min(1.0, float(model_agreement)))

    # Pesos estritos para medidas angulares vs métricas
    if metric_requires_calibration:
        # Se requer escala métrica em mm, a calibração tem peso crítico
        w_v, w_c, w_p, w_cal, w_agr = 0.25, 0.20, 0.15, 0.30, 0.10
    else:
        # Medidas angulares dependem de visibilidade e cadência estável
        w_v, w_c, w_p, w_cal, w_agr = 0.35, 0.25, 0.25, 0.05, 0.10

    weighted_score = (
        v_norm * w_v
        + c_norm * w_c
        + p_norm * w_p
        + cal_norm * w_cal
        + agr_norm * w_agr
    )

    # Penalização de gargalo se visibilidade for muito precária (< 0.40)
    if v_norm < 0.40:
        weighted_score *= (v_norm / 0.40)

    # Penalização por amostragem insuficiente de ciclos (< 3 ciclos)
    if cycles_count < 3:
        weighted_score *= max(0.2, cycles_count / 3.0)

    # Penalização se a cadência for francamente aperiódica (< 0.50)
    if p_norm < 0.50:
        weighted_score *= max(0.5, p_norm / 0.50)

    # Penalização se a métrica dimensional não tiver calibração
    if metric_requires_calibration and cal_norm <= 0.0:
        weighted_score = 0.0

    score = round(weighted_score, 3)
    factors = {
        "visibility": round(v_norm, 3),
        "cycles": round(c_norm, 3),
        "periodicity": round(p_norm, 3),
        "calibration": round(cal_norm, 3),
        "model_agreement": round(agr_norm, 3),
    }

    withheld = score < min_threshold
    reasons: list[str] = []
    if withheld:
        if v_norm < 0.5:
            reasons.append(f"baixa visibilidade dos marcos ({v_norm:.2f} < 0.50)")
        if c_norm < 0.6:
            reasons.append(f"amostragem insuficiente de ciclos ({cycles_count} < {target_cycles_nominal})")
        if p_norm < 0.5:
            reasons.append(f"cadência instável/aperiódica ({p_norm:.2f} < 0.50)")
        if metric_requires_calibration and cal_norm < 0.5:
            reasons.append("escala métrica não calibrada")
        if agr_norm < 0.6:
            reasons.append(f"divergência entre motores de inferência ({agr_norm:.2f})")
        if not reasons:
            reasons.append(f"pontuação de confiança composta ({score:.2f}) inferior ao limiar {min_threshold:.2f}")

    withhold_reason = "; ".join(reasons) if withheld else None

    return MeasureConfidence(
        score=score,
        factors=factors,
        withheld=withheld,
        withhold_reason=withhold_reason,
    )
