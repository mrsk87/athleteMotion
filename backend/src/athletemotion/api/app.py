"""Servidor principal FastAPI para Athlete Motion.

Desenvolvido segundo Clean Architecture, com persistência transacional ACID,
segurança robusta (Bearer Auth, CORS estrito, rate limiting, cabeçalhos OWASP,
erros normalizados RFC 7807) e rotas tipadas.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.openapi.utils import get_openapi

from athletemotion.api.health import health_router
from athletemotion.api.security import (
    RateLimitMiddleware,
    RequestIdMiddleware,
    SecurityHeadersMiddleware,
    get_or_create_api_token,
    require_api_token,
    setup_cors,
    setup_exception_handlers,
)
from athletemotion.api.v1.inference_ws import ws_router
from athletemotion.api.v1.router import api_v1_router
from athletemotion.config.settings import settings
from athletemotion.infrastructure.database import init_db
from athletemotion.logging_config import setup_logging
from athletemotion.schemas.fit import FrameValidationResponse
from athletemotion.services.engine_manager import EngineManager
from athletemotion.version import __version__

logger = logging.getLogger("athlete_motion.api.app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Ciclo de vida assíncrono do servidor: inicializa base de dados com ACID e gere EngineManager."""
    # 0. Inicializar subsistema de logging estruturado
    setup_logging(level="INFO", enable_file_logging=True)

    # 1. Inicializar base de dados SQLite com WAL e integridade referencial
    init_db()

    # 1.1. Executar purga de retenção RGPD para dados expirados
    try:
        from athletemotion.services.retention import purge_expired_data

        purge_stats = purge_expired_data()
        logger.info("Purga de dados RGPD executada no arranque: %s", purge_stats)
    except Exception as exc:
        logger.warning("Falha na purga de retenção durante o arranque: %s", exc)

    # 2. Inicializar token de autenticação de segurança
    get_or_create_api_token(settings)
    logger.info("Mecanismo de autenticação ativo. Token configurado com sucesso.")

    # 3. Inicializar gestor de concorrência de motores por sessão/ligação
    engine_manager = EngineManager(max_active_engines=settings.max_active_engines)
    app.state.engine_manager = engine_manager

    # 4. Aquecimento assíncrono opcional fora do caminho crítico
    if settings.warmup_on_start:

        async def _warmup_background():
            try:
                lease = await engine_manager.acquire("startup_warmup", "mediapipe", "right")
                ms = await lease.warmup()
                await engine_manager.release("startup_warmup")
                logger.info("Aquecimento inicial do motor concluído: %.1f ms.", ms)
            except (RuntimeError, OSError) as err:
                logger.warning("Aquecimento inicial em background falhou: %s", err)

        app.state.warmup_task = asyncio.create_task(_warmup_background())

    yield

    # 5. Encerramento rigoroso de todos os motores e threads de inferência
    await app.state.engine_manager.shutdown()


app = FastAPI(
    title="Athlete Motion API",
    description="API profissional de análise biomecânica e postural para ciclistas (BikeFit).",
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url="/redoc" if settings.enable_docs else None,
    openapi_url="/openapi.json" if settings.enable_docs else None,
)

# 1. Configurar CORS estrito e seguro
setup_cors(app, settings)

# 2. Registar Middlewares de Hardening (Ordem: Request ID -> Rate Limit -> Headers de Segurança)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware, app_settings=settings)
app.add_middleware(RequestIdMiddleware)

# 3. Registar Handlers globais de erro RFC 7807 (Problem Details)
setup_exception_handlers(app)


# 4. Esquema de autenticação Bearer na documentação OpenAPI
def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    openapi_schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )
    openapi_schema.setdefault("components", {})["securitySchemes"] = {
        "BearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "Token",
            "description": "Insira o token de segurança da API (Authorization: Bearer <token>)",
        }
    }
    openapi_schema["security"] = [{"BearerAuth": []}]
    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi

# Montar rotas da API v1 e WebSockets
app.include_router(health_router)
app.include_router(api_v1_router)
app.include_router(ws_router)


@app.get("/", tags=["system"])
def root():
    """Página raiz da API com metadados informativos em Português e Inglês."""
    return {
        "app": "Athlete Motion API",
        "description": "Análise Biomecânica de Postura Ciclística (BikeFit)",
        "version": __version__,
        "language_default": "pt",
        "documentation": "/docs" if settings.enable_docs else "disabled",
        "status": "online",
    }


@app.get("/health", tags=["system"])
def health_check():
    """Verificação de integridade operacional do backend (isento de autenticação)."""
    return {"status": "ok", "version": __version__}


@app.get(
    "/metrics",
    tags=["observability"],
    dependencies=[Depends(require_api_token)],
)
def prometheus_metrics():
    """Métricas operacionais de latência e throughput em formato Prometheus."""
    from fastapi.responses import PlainTextResponse

    from athletemotion.infrastructure.metrics import metrics

    return PlainTextResponse(
        content=metrics.generate_prometheus_text(),
        media_type="text/plain; version=0.0.4",
    )


@app.get("/api/version", tags=["system"])
def version_info():
    """Retorna a versão SemVer corrente lida da fonte única da verdade (isento de autenticação)."""
    return {"version": __version__}


@app.post(
    "/process_frame",
    response_model=FrameValidationResponse,
    dependencies=[Depends(require_api_token)],
    tags=["vision"],
    deprecated=True,
    summary="Validação de frame de imagem (Legado / Deprecated)",
)
async def process_frame(file: UploadFile = File(...)):
    """Valida e processa um frame de vídeo/imagem para análise postural com proteção estrita de memória.

    (Nota: Este endpoint está marcado como deprecated em favor do streaming WebSocket de baixa latência).
    """
    from athletemotion.api.validation.images import validate_and_decode_image

    max_bytes = settings.max_upload_bytes

    # 1. Verificação antecipada de Content-Length se reportado pelo cliente/navegador
    if file.size and file.size > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Tamanho de imagem excede o limite máximo permitido de {max_bytes} bytes.",
        )

    # 2. Leitura streaming em blocos com interrupção imediata ao exceder a quota
    chunk_size = 64 * 1024  # 64 KB
    buffer = bytearray()
    total_bytes = 0

    while chunk := await file.read(chunk_size):
        total_bytes += len(chunk)
        if total_bytes > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Tamanho de imagem excede o limite máximo permitido de {max_bytes} bytes.",
            )
        buffer.extend(chunk)

    contents = bytes(buffer)
    if not contents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ficheiro de imagem vazio / Empty image file.",
        )

    # 3. Validação de magic bytes, dimensões Pillow e decodificação defensiva BGR
    frame = validate_and_decode_image(contents)

    # Retorno estruturado confirmando validação e dimensões recebidas
    return {
        "status": "validated",
        "frame_width": int(frame.shape[1]),
        "frame_height": int(frame.shape[0]),
        "channels": int(frame.shape[2]),
        "message": "Frame recebido e validado com sucesso.",
    }


if __name__ == "__main__":
    uvicorn.run(
        "athletemotion.api.app:app", host=settings.host, port=settings.port, reload=settings.reload
    )
