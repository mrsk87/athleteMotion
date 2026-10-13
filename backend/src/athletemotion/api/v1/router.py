"""Agregador principal de rotas da API v1."""
from __future__ import annotations

from fastapi import APIRouter

from .athletes import router as athletes_router
from .bikes import router as bikes_router
from .biomechanics import router as biomechanics_router
from .sessions import router as sessions_router
from .video import router as video_router
from .inference import router as inference_router

api_v1_router = APIRouter(prefix="/api/v1")

api_v1_router.include_router(athletes_router)
api_v1_router.include_router(bikes_router)
api_v1_router.include_router(biomechanics_router)
api_v1_router.include_router(sessions_router)
api_v1_router.include_router(video_router)
api_v1_router.include_router(inference_router)

