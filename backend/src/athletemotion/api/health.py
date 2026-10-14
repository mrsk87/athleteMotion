"""Endpoints de verificação de integridade e prontidão do serviço (Liveness e Readiness).

- /health/live: Probe de processo vivo (Liveness). Retorna 200 OK imediatamente.
- /health/ready: Probe de prontidão operacional (Readiness). Valida conexão ativa à base de dados,
  estado do motor de inferência e versão do sistema sem vazar segredos nem dados sensíveis.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import text

from athletemotion.infrastructure.database import get_db
from athletemotion.version import __version__

logger = logging.getLogger("athlete_motion.api.health")
health_router = APIRouter(tags=["Health"])


@health_router.get("/health/live", summary="Liveness Probe")
def liveness_probe() -> dict[str, str]:
    """Confirma que o processo da API está em execução e a responder a pedidos HTTP."""
    return {"status": "alive"}


@health_router.get("/health/ready", summary="Readiness Probe")
def readiness_probe(request: Request, response: Response) -> dict[str, Any]:
    """Verifica a prontidão dos subsistemas críticos (base de dados e motores)."""
    checks: dict[str, Any] = {
        "status": "ready",
        "version": __version__,
        "database": "unknown",
        "engine_manager": "unknown",
    }
    is_ready = True

    # 1. Verificação de integridade da base de dados
    try:
        db = next(get_db())
        try:
            db.execute(text("SELECT 1;"))
            checks["database"] = "ok"
        finally:
            db.close()
    except Exception as err:
        logger.error("Readiness check: Base de dados indisponível: %s", err)
        checks["database"] = "unreachable"
        is_ready = False

    # 2. Verificação do gestor de motores de inferência
    try:
        app_state = getattr(request.app, "state", None)
        if app_state and getattr(app_state, "engine_manager", None) is not None:
            engine_mgr = app_state.engine_manager
            checks["engine_manager"] = "ok"
            checks["active_leases"] = engine_mgr.active_count
        else:
            checks["engine_manager"] = "not_initialized"
            is_ready = False
    except Exception as err:
        logger.warning("Readiness check: Falha ao inspecionar gestor de motores: %s", err)
        checks["engine_manager"] = "error"
        is_ready = False

    if not is_ready:
        checks["status"] = "unhealthy"
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return checks
