"""Identificadores canónicos de articulações e segmentos anatómicos para BikeFit."""

from __future__ import annotations

from enum import StrEnum


class JointId(StrEnum):
    """Identificadores canónicos e estáveis para articulações biomecânicas.

    Permitem desacoplar a lógica de regras e agregação dos rótulos traduzidos
    ou nomenclaturas de UI.
    """

    KNEE = "knee"
    TORSO = "torso"
    ELBOW = "elbow"
    ANKLE = "ankle"
    HIP = "hip"
    SHOULDER = "shoulder"

    @classmethod
    def from_name(cls, name: str) -> JointId | None:
        """Mapeia nomes comuns ou traduções legadas para o identificador estável."""
        cleaned = name.strip().lower()
        if "joelho" in cleaned or "knee" in cleaned:
            return cls.KNEE
        if "tronco" in cleaned or "costa" in cleaned or "torso" in cleaned or "back" in cleaned:
            return cls.TORSO
        if (
            "braço" in cleaned
            or "braco" in cleaned
            or "cotovelo" in cleaned
            or "elbow" in cleaned
            or "arm" in cleaned
        ):
            return cls.ELBOW
        if "tornozelo" in cleaned or "ankle" in cleaned:
            return cls.ANKLE
        if "anca" in cleaned or "quadril" in cleaned or "hip" in cleaned:
            return cls.HIP
        if "ombro" in cleaned or "shoulder" in cleaned:
            return cls.SHOULDER
        return None
