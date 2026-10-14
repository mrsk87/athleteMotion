"""Pacote do Treinador Biomecânico determinístico (Coach Service).

Substitui o antigo gerador por templates hardcoded, garantindo:
- Ausência total de valores inventados ou fixados arbitrariamente;
- Catálogo i18n em ficheiros externos JSON (PT/EN);
- Avaliação por identificadores canónicos (JointId) em vez de rótulos em texto;
- Rastreabilidade de qualidade de dados (DataQualityReport);
- Contrato estrito para futuro rewriter LLM com verificação de fidelidade numérica.
"""

from __future__ import annotations

from .narrative import CoachContext, build_coach_report, load_translations
from .rewriter import NarrativeRewriter, NoopRewriter, verify_numeric_fidelity
from .rules import Finding, assess_elbow, assess_knee, assess_torso

__all__ = [
    "CoachContext",
    "Finding",
    "NarrativeRewriter",
    "NoopRewriter",
    "assess_elbow",
    "assess_knee",
    "assess_torso",
    "build_coach_report",
    "load_translations",
    "verify_numeric_fidelity",
]
