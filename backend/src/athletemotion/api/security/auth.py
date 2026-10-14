"""Mecanismos de autenticação e proteção por token (Bearer Auth).

Segurança local e em rede:
- No arranque local sem token configurado, gera um segredo criptográfico aleatório
  e guarda-o em APP_DATA_DIR/api_token para persistência transparente.
- Validação temporalmente constante via secrets.compare_digest contra timing attacks.
- Rotas públicas essenciais (/health, /api/version) são isentas de autenticação.
- Suporte a verificação de ligações WebSocket através de headers e subprotocolos.
"""

from __future__ import annotations

import contextlib
import logging
import secrets

from fastapi import HTTPException, Request, WebSocket, status
from fastapi.security import HTTPBearer

from athletemotion.config.paths import APP_DATA_DIR, ensure_app_directories
from athletemotion.config.settings import ApiSettings, settings

logger = logging.getLogger("athlete_motion.api.security.auth")

security_scheme = HTTPBearer(auto_error=False)

EXEMPT_PATHS = {
    "/",
    "/health",
    "/health/live",
    "/health/ready",
    "/api/version",
    "/docs",
    "/redoc",
    "/openapi.json",
}


def get_or_create_api_token(app_settings: ApiSettings = settings) -> str:
    """Devolve o token configurado ou gera/carrega um token local seguro."""
    if app_settings.api_token and app_settings.api_token.strip():
        return app_settings.api_token.strip()

    ensure_app_directories()
    token_file = APP_DATA_DIR / "api_token"

    if token_file.exists():
        token = token_file.read_text(encoding="utf-8").strip()
        if token:
            app_settings.api_token = token
            return token

    # Gerar token criptográfico forte de 32 bytes (256 bits)
    token = secrets.token_urlsafe(32)
    token_file.write_text(token, encoding="utf-8")
    with contextlib.suppress(OSError, NotImplementedError):
        # Definir permissões de leitura apenas para o utilizador atual (POSIX)
        token_file.chmod(0o600)

    logger.info("Token de API local gerado e gravado em: %s", token_file)
    app_settings.api_token = token
    return token


def require_api_token(request: Request) -> str:
    """Dependência FastAPI que exige e valida o cabeçalho Authorization Bearer."""
    # Rotas informativas e documentação isentas
    if request.url.path in EXEMPT_PATHS:
        return ""

    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autenticação necessária. Forneça o cabeçalho 'Authorization: Bearer <token>'.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    provided_token = auth_header[7:].strip()
    expected_token = get_or_create_api_token()

    if not secrets.compare_digest(provided_token, expected_token):
        logger.warning(
            "Tentativa de acesso não autorizada a '%s' a partir de %s.",
            request.url.path,
            request.client.host if request.client else "desconhecido",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticação inválido ou revogado.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return provided_token


def verify_websocket_token(websocket: WebSocket) -> bool:
    """Valida o token de uma ligação WebSocket através dos cabeçalhos."""
    expected_token = get_or_create_api_token()

    # 1. Verificar cabeçalho Authorization direto
    auth_header = websocket.headers.get("authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        if secrets.compare_digest(token, expected_token):
            return True

    # 2. Verificar Sec-WebSocket-Protocol (ex: "bearer, <token>")
    sec_proto = websocket.headers.get("sec-websocket-protocol")
    if sec_proto:
        parts = [p.strip() for p in sec_proto.split(",")]
        for p in parts:
            if secrets.compare_digest(p, expected_token):
                return True

    # 3. Cabeçalho personalizado x-api-token
    x_token = websocket.headers.get("x-api-token")
    return bool(x_token and secrets.compare_digest(x_token.strip(), expected_token))
