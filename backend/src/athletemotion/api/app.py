"""Servidor principal FastAPI para Athlete Motion.

Desenvolvido segundo Clean Architecture, com persistência transacional ACID,
validação de uploads, suporte bilingue (Português língua-mãe) e rotas tipadas.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware

from athletemotion.api.v1.inference_ws import ws_router
from athletemotion.api.v1.router import api_v1_router
from athletemotion.infrastructure.database import init_db
from athletemotion.schemas.fit import FrameValidationResponse
from athletemotion.version import __version__
from athletemotion.config.settings import settings

# Limites de segurança para upload de imagens
MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
ALLOWED_MAGIC_SIGNATURES = [
    b"\xff\xd8\xff",       # JPEG / JPG
    b"\x89PNG\r\n\x1a\n",  # PNG
    b"RIFF",               # WebP
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Ciclo de vida assíncrono do servidor: inicializa base de dados com ACID."""
    # Inicializar base de dados SQLite com WAL e integridade referencial
    init_db()
    yield


app = FastAPI(
    title="Athlete Motion API",
    description="API profissional de análise biomecânica e postural para ciclistas (BikeFit).",
    version=__version__,
    lifespan=lifespan,
)

# Configurar origens CORS permitidas (suporte a PC, telemóvel e rede local)
raw_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173,http://127.0.0.1:5173",
)
allowed_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins else ["*"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+):.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Montar rotas da API v1 e WebSockets
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
        "documentation": "/docs",
        "status": "online",
    }


@app.get("/health", tags=["system"])
def health_check():
    """Verificação de integridade operacional do backend."""
    return {"status": "ok", "version": __version__}


@app.get("/api/version", tags=["system"])
def version_info():
    """Retorna a versão SemVer corrente lida da fonte única da verdade."""
    return {"version": __version__}


@app.post("/process_frame", response_model=FrameValidationResponse, tags=["vision"])
async def process_frame(file: UploadFile = File(...)):
    """Valida e processa um frame de vídeo/imagem para análise postural segura."""
    # 1. Validação de tamanho e conteúdo
    contents = await file.read()
    if not contents or len(contents) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ficheiro de imagem vazio / Empty image file.",
        )

    if len(contents) > MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Tamanho de imagem excede o limite máximo permitido de 5 MB.",
        )

    # 2. Validação de assinatura de bytes (Magic Bytes)
    is_valid_signature = any(contents.startswith(sig) for sig in ALLOWED_MAGIC_SIGNATURES)
    if not is_valid_signature:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Formato de imagem não suportado. Envie ficheiros JPEG, PNG ou WebP válidos.",
        )

    # 3. Decodificação segura da imagem com OpenCV
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if frame is None or frame.shape[0] == 0 or frame.shape[1] == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Não foi possível decodificar os dados de imagem enviados.",
        )

    # Retorno estruturado confirmando validação e dimensões recebidas
    return {
        "status": "validated",
        "frame_width": int(frame.shape[1]),
        "frame_height": int(frame.shape[0]),
        "channels": int(frame.shape[2]),
        "message": "Frame recebido e validado com sucesso.",
    }


if __name__ == "__main__":
    uvicorn.run("athletemotion.api.app:app", host=settings.host, port=settings.port, reload=settings.reload)
