"""Ponto de extensão para reformulação narrativa (Narrative Rewriter).

Define a interface estrita (Protocol) para possíveis rewriters de linguagem natural
(ex.: LLM local futuro), garantindo que nenhuma métrica ou número biomecânico seja alterado.
"""

from __future__ import annotations

import re
from typing import Any, Protocol


def extract_numbers(text: str) -> list[float]:
    """Extrai todos os números com ou sem decimais de uma string para validação de fidelidade."""
    # Encontra números inteiros ou com ponto/vírgula decimal (ex.: 148.5, 12, 10-20)
    tokens = re.findall(r"\b\d+(?:[.,]\d+)?\b", text)
    numbers: list[float] = []
    for token in tokens:
        try:
            numbers.append(float(token.replace(",", ".")))
        except ValueError:
            continue
    return sorted(numbers)


def verify_numeric_fidelity(original: str, rewritten: str) -> bool:
    """Verifica se todos os números presentes no rascunho determinístico foram preservados no texto reescrito."""
    original_numbers = extract_numbers(original)
    rewritten_numbers = set(extract_numbers(rewritten))
    return all(num in rewritten_numbers for num in original_numbers)


class NarrativeRewriter(Protocol):
    """Protocolo de reescrita estilística de pareceres sem mutação de factos clínicos."""

    def rewrite(self, draft: str, facts: dict[str, Any]) -> str:
        """Reescreve o rascunho preservando todos os factos e números determinísticos."""
        ...


class NoopRewriter:
    """Implementação padrão sem efeitos (identidade). Retorna exatamente o rascunho das regras."""

    def rewrite(self, draft: str, facts: dict[str, Any]) -> str:
        return draft
