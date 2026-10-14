"""Pacote de segurança da API (Athlete Motion Security Baseline)."""

from __future__ import annotations

from .auth import get_or_create_api_token, require_api_token, verify_websocket_token
from .cors import setup_cors
from .errors import RequestIdMiddleware, setup_exception_handlers
from .headers import SecurityHeadersMiddleware
from .rate_limit import RateLimitMiddleware, rate_limiter

__all__ = [
    "RateLimitMiddleware",
    "RequestIdMiddleware",
    "SecurityHeadersMiddleware",
    "get_or_create_api_token",
    "rate_limiter",
    "require_api_token",
    "setup_cors",
    "setup_exception_handlers",
    "verify_websocket_token",
]
