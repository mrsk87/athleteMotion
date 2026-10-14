"""Schemas genéricos para paginação por cursor e limites controlados."""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """Envelope de resposta paginada com cursor temporal e contagem total."""

    items: list[T] = Field(..., description="Elementos da página atual")
    total: int = Field(..., ge=0, description="Contagem total de registos existentes")
    next_cursor: str | None = Field(
        default=None, description="Cursor opaco para obtenção da página subsequente"
    )
    limit: int = Field(..., ge=1, le=100, description="Tamanho máximo solicitado para a página")
