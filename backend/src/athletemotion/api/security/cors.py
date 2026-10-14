"""Configuração estrita e declarativa de CORS (Cross-Origin Resource Sharing).

Evita configurações inseguras:
- Sem wildcard '*' com credenciais ativas.
- Sem expressões regulares excessivamente permissivas que permitam qualquer origem na LAN.
- Origens expressamente declaradas nas configurações do ambiente (ALLOWED_ORIGINS).
- Métodos e cabeçalhos restritos ao essencial da API REST e WebSockets.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from athletemotion.config.settings import ApiSettings, settings

ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
ALLOWED_HEADERS = ["Authorization", "Content-Type", "X-Request-ID", "Accept"]
EXPOSED_HEADERS = ["X-Request-ID"]


def setup_cors(app: FastAPI, app_settings: ApiSettings = settings) -> None:
    """Configura o middleware de CORS de forma restritiva e segura."""
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.allowed_origins,
        allow_credentials=False,
        allow_methods=ALLOWED_METHODS,
        allow_headers=ALLOWED_HEADERS,
        expose_headers=EXPOSED_HEADERS,
    )
