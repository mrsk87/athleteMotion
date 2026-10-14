"""Middleware de limitação de taxa (Rate Limiting) em memória.

Implementa o algoritmo Sliding Window por IP/cliente sem dependências externas:
- Janela deslizante de 60 segundos com limpeza automática de registos expirados.
- Limite global configurável (padrão 120 req/min).
- Limite estrito para rotas pesadas de exportação e troca de hardware (padrão 10 req/min).
- Resposta 429 Too Many Requests com cabeçalho Retry-After e formato RFC 7807.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from athletemotion.api.security.errors import create_problem_response
from athletemotion.config.settings import ApiSettings, settings

logger = logging.getLogger("athlete_motion.api.security.rate_limit")

STRICT_ROUTE_PATTERNS = [
    re.compile(r"^/api/v1/sessions/.+/pdf$"),
    re.compile(r"^/api/v1/video/export-gif$"),
    re.compile(r"^/api/v1/inference/engine/switch$"),
]


class SlidingWindowRateLimiter:
    """Gestor de janelas deslizantes de tráfego por identificador de cliente."""

    def __init__(self) -> None:
        self._history: dict[str, list[float]] = {}
        self._lock = asyncio.Lock()

    async def check(
        self, key: str, max_requests: int, window_seconds: float = 60.0
    ) -> tuple[bool, int]:
        """Verifica se o cliente pode realizar a requisição na janela corrente."""
        now = time.monotonic()
        cutoff = now - window_seconds

        async with self._lock:
            records = self._history.setdefault(key, [])
            # Purga requisições anteriores ao corte da janela
            valid = [ts for ts in records if ts > cutoff]
            self._history[key] = valid

            if len(valid) >= max_requests:
                oldest = valid[0]
                retry_after = max(1, int(window_seconds - (now - oldest)))
                return False, retry_after

            valid.append(now)
            return True, 0

    def reset(self) -> None:
        """Limpa todo o histórico em memória (útil para testes)."""
        self._history.clear()


rate_limiter = SlidingWindowRateLimiter()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Interceta requisições HTTP e impõe limites de taxa antes do processamento."""

    def __init__(self, app, app_settings: ApiSettings = settings) -> None:
        super().__init__(app)
        self.settings = app_settings

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        # Isentar documentação, health check e WebSockets (geridos no próprio canal)
        if (
            path in ("/health", "/api/version", "/docs", "/redoc", "/openapi.json")
            or request.scope.get("type") == "websocket"
        ):
            return await call_next(request)

        # Identificar cliente por token ou IP remoto
        client_ip = request.client.host if request.client else "127.0.0.1"
        auth_header = request.headers.get("Authorization", "")
        client_key = auth_header if auth_header.startswith("Bearer ") else client_ip

        # Determinar limite aplicável (estrito vs global)
        is_strict = any(pattern.match(path) for pattern in STRICT_ROUTE_PATTERNS)
        max_allowed = (
            self.settings.rate_limit_strict_per_minute
            if is_strict
            else self.settings.rate_limit_per_minute
        )

        bucket_key = f"{client_key}:{'strict' if is_strict else 'global'}"
        allowed, retry_after = await rate_limiter.check(
            bucket_key, max_allowed, window_seconds=60.0
        )

        if not allowed:
            logger.warning(
                "Rate limit excedido para %s na rota '%s' (limite: %d/min). Retry-After: %ds",
                client_ip,
                path,
                max_allowed,
                retry_after,
            )
            request_id = getattr(request.state, "request_id", None) or "rate-limited"
            response = create_problem_response(
                status_code=429,
                detail=f"Limite de requisições excedido ({max_allowed}/min). Tente novamente em {retry_after} segundos.",
                instance=path,
                request_id=request_id,
                title="Too Many Requests",
            )
            response.headers["Retry-After"] = str(retry_after)
            return response

        return await call_next(request)
