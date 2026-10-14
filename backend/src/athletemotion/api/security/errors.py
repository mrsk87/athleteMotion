"""Tratamento padronizado de erros e exceções segundo a RFC 7807 (Problem Details).

Garante:
1. Respostas de erro consistentes em application/problem+json.
2. Identificador de rastreabilidade único (request_id / X-Request-ID).
3. Prevenção absoluta de vazamento de detalhes internos do sistema (tracebacks, str(e), nomes de tabelas).
4. Registo completo de exceções no servidor para depuração.
"""

from __future__ import annotations

import http
import logging
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger("athlete_motion.api.security.errors")


def create_problem_response(
    status_code: int,
    detail: str,
    instance: str,
    request_id: str,
    type_uri: str = "about:blank",
    title: str | None = None,
    extra: dict[str, Any] | None = None,
) -> JSONResponse:
    """Cria uma resposta JSON no formato canónico RFC 7807 Problem Details."""
    if title is None:
        try:
            title = http.HTTPStatus(status_code).phrase
        except ValueError:
            title = "Error"

    payload: dict[str, Any] = {
        "type": type_uri,
        "title": title,
        "status": status_code,
        "detail": detail,
        "instance": instance,
        "request_id": request_id,
    }
    if extra:
        payload.update(extra)

    return JSONResponse(
        status_code=status_code,
        content=payload,
        media_type="application/problem+json",
        headers={"X-Request-ID": request_id},
    )


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Atribui e propaga um identificador único de rastreabilidade (X-Request-ID)."""

    async def dispatch(self, request: Request, call_next) -> Response:
        incoming_id = request.headers.get("X-Request-ID")
        request_id = incoming_id if incoming_id and len(incoming_id) <= 64 else str(uuid.uuid4())
        request.state.request_id = request_id

        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


def _get_request_id(request: Request) -> str:
    """Recupera o request_id do estado do request ou gera um novo de contingência."""
    return getattr(request.state, "request_id", None) or str(uuid.uuid4())


async def http_exception_handler(
    request: Request, exc: HTTPException | StarletteHTTPException
) -> JSONResponse:
    """Handler para exceções HTTP lançadas explicitamente."""
    request_id = _get_request_id(request)
    headers = getattr(exc, "headers", None)

    response = create_problem_response(
        status_code=exc.status_code,
        detail=str(exc.detail),
        instance=request.url.path,
        request_id=request_id,
    )
    if headers:
        for k, v in headers.items():
            response.headers[k] = v
    return response


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Handler para erros de validação de schemas Pydantic e tipos de entrada."""
    request_id = _get_request_id(request)
    errors = exc.errors()
    # Resumo limpo sem vazar estruturas confidenciais
    sanitized_errors = [
        {"field": ".".join(str(loc) for loc in err.get("loc", [])), "message": err.get("msg", "")}
        for err in errors
    ]
    return create_problem_response(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="Os dados enviados na requisição são inválidos.",
        instance=request.url.path,
        request_id=request_id,
        extra={"validation_errors": sanitized_errors},
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handler global para exceções não tratadas (500). Nunca vaza str(exc) para o cliente."""
    request_id = _get_request_id(request)
    logger.exception(
        "Exceção não tratada na rota '%s' [request_id=%s]", request.url.path, request_id
    )

    return create_problem_response(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Ocorreu um erro interno no processamento do servidor.",
        instance=request.url.path,
        request_id=request_id,
    )


async def image_validation_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handler para exceções de validação e descompressão de imagem."""

    request_id = _get_request_id(request)
    status_code = getattr(exc, "status_code", status.HTTP_422_UNPROCESSABLE_ENTITY)
    message = getattr(exc, "message", "Erro na validação do ficheiro de imagem.")

    return create_problem_response(
        status_code=status_code,
        detail=message,
        instance=request.url.path,
        request_id=request_id,
    )


def setup_exception_handlers(app: FastAPI) -> None:
    """Regista os handlers RFC 7807 na aplicação FastAPI."""
    from athletemotion.api.validation.images import ImageValidationError

    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(ImageValidationError, image_validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
