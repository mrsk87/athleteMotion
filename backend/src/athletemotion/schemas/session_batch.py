"""Schemas para operações de ingestão em lote (batch) de snapshots de postura."""

from __future__ import annotations

from pydantic import BaseModel, Field

from athletemotion.schemas.fit import SnapshotCreate, SnapshotResponse


class SnapshotBatchCreate(BaseModel):
    """Payload de ingestão atómica em lote de snapshots capturados."""

    snapshots: list[SnapshotCreate] = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Lista de snapshots a persistir em lote (máximo 500 por transação)",
    )


class SnapshotBatchResponse(BaseModel):
    """Resultado da ingestão atómica em lote de snapshots."""

    session_id: str = Field(..., description="Identificador da sessão associada")
    inserted_count: int = Field(..., ge=0, description="Número de snapshots persistidos com sucesso")
    snapshots: list[SnapshotResponse] = Field(
        default_factory=list, description="Lista de registos criados"
    )
