"""Middleware para injeção de cabeçalhos de segurança HTTP (Hardening).

Implementa recomendações de segurança do OWASP:
- X-Content-Type-Options: nosniff (impede MIME-sniffing)
- X-Frame-Options: DENY (previne Clickjacking)
- Referrer-Policy: no-referrer (não vaza origens nem tokens em links)
- Permissions-Policy: restringe câmara ao próprio domínio e desativa microfone
- Cache-Control: no-store (impede cache local/intermédio de dados biométricos em endpoints da API)
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adiciona cabeçalhos de segurança padronizados a todas as respostas HTTP."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response: Response = await call_next(request)

        # Cabeçalhos universais de segurança
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(self), microphone=()"

        # Prevenção de cache em endpoints de dados e API
        if request.url.path.startswith("/api/") or request.url.path in (
            "/process_frame",
            "/health",
        ):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"

        return response
