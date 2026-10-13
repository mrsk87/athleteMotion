"""Definições e configurações do servidor de API."""
from __future__ import annotations

import os
from pydantic import BaseModel, Field


class ApiSettings(BaseModel):
    """Configurações operacionais para FastAPI e servidor Uvicorn."""

    host: str = Field(
        default_factory=lambda: os.getenv("ATHLETE_HOST", "127.0.0.1"),
        description="Endereço de bind da API (127.0.0.1 por defeito para segurança local)",
    )
    port: int = Field(
        default_factory=lambda: int(os.getenv("ATHLETE_PORT", "8000")),
        description="Porto TCP de escuta",
    )
    reload: bool = Field(
        default_factory=lambda: os.getenv("ATHLETE_RELOAD", "false").lower() in ("true", "1"),
        description="Modo de recarregamento automático (apenas para desenvolvimento)",
    )


settings = ApiSettings()
