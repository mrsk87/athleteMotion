"""Rotas REST para alternar motores de visão computacional em runtime."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, status

import athletemotion.domain.inference  # noqa: F401  Assegura que todos os motores estão registados no Factory
from athletemotion.config.paths import MODELS_DIR
from athletemotion.domain.inference.base import PoseEngineRegistry
from athletemotion.domain.inference.mediapipe_engine import resolve_landmarker_model
from athletemotion.infrastructure.hardware import hardware_manager
from athletemotion.schemas.inference import (
    EngineInfo,
    EngineListResponse,
    SwitchEngineRequest,
)

logger = logging.getLogger("athlete_motion.api.inference")

router = APIRouter(prefix="/inference", tags=["Inference Management"])


def _model_exists(candidates) -> bool:
    return any(Path(c).exists() or (MODELS_DIR / Path(c).name).exists() for c in candidates)


def _ensure_active_engine():
    """Garante que existe um motor ativo e devolve-o."""
    try:
        return PoseEngineRegistry.get_active()
    except RuntimeError:
        engine = PoseEngineRegistry.create("mediapipe", side="right")
        PoseEngineRegistry.set_active(engine)
        logger.info("Motor padrão (MediaPipe) criado a pedido.")
        return engine


def _get_active_or_default() -> tuple[str, str]:
    """Retorna o nome e orientação do motor ativo sem forçar inicialização pesada."""
    try:
        active = PoseEngineRegistry.get_active()
        return active.name, getattr(active, "side", "right")
    except RuntimeError:
        return "mediapipe", "right"


def _yolo_provider(use_gpu: bool, model_present: bool) -> str:
    if not model_present:
        return "Modelo ONNX em falta — fallback sem deteção"
    if use_gpu and hardware_manager.has_directml:
        return "DirectML / DirectX 12"
    return "CPU AVX2"


@router.get("/engines", response_model=EngineListResponse)
def list_engines():
    """Lista motores disponíveis, o hardware real e se o ficheiro de pesos existe.

    `available=False` significa que o motor arranca mas corre o fallback: é a
    diferença entre "o motor existe" e "o motor tem os pesos que precisa".
    """
    active_name, active_side = _get_active_or_default()

    mp_model = resolve_landmarker_model(2)
    from athletemotion.domain.inference.model_zoo import verify_model

    yolo_640_ok, yolo_640_reason = verify_model("yolo11n-pose")
    yolo_fast_ok, yolo_fast_reason = verify_model("yolo11n-pose-320")
    rtmpose_ok, rtmpose_reason = verify_model("rtmpose-m-halpe26")

    provider_name = "DirectML GPU" if hardware_manager.has_directml else "CPU AVX2"

    engines_meta = [
        EngineInfo(
            name="mediapipe",
            display_name="MediaPipe Pose Tasks (Heavy)",
            description="Modelo oficial do Google em CPU com 33 landmarks corporais completos.",
            is_accelerated=False,
            hardware_provider=f"CPU ({hardware_manager.intra_op_threads} núcleos) · {mp_model.name if mp_model else 'Modelo ausente'}",
            available=mp_model is not None,
            reason=None if mp_model else "Ficheiro .task ausente",
            model_id="mediapipe-pose-heavy",
            model_verified=mp_model is not None,
            license="Apache-2.0",
            provider_actual="CPU",
            notes="Rede precisa para ângulos estáveis em CPU.",
        ),
        EngineInfo(
            name="yolo11_pose",
            display_name="YOLO11-Pose (DirectML GPU)",
            description="Rede YOLO11n-pose ONNX 640×640 acelerada na GPU com NMS e TargetSelector.",
            is_accelerated=hardware_manager.has_directml,
            hardware_provider=_yolo_provider(True, yolo_640_ok),
            available=yolo_640_ok,
            reason=None if yolo_640_ok else yolo_640_reason,
            model_id="yolo11n-pose",
            model_verified=yolo_640_ok,
            license="AGPL-3.0",
            provider_actual=provider_name,
            notes="Entrada 640px: máxima robustez anatómica.",
        ),
        EngineInfo(
            name="yolo11_pose_fast",
            display_name="YOLO11-Pose Fast (320px + ROI)",
            description="Rede YOLO11n-pose com entrada 320×320 e rastreio de ciclista em tempo real.",
            is_accelerated=hardware_manager.has_directml,
            hardware_provider=_yolo_provider(True, yolo_fast_ok or yolo_640_ok),
            available=(yolo_fast_ok or yolo_640_ok),
            reason=None if (yolo_fast_ok or yolo_640_ok) else yolo_fast_reason,
            model_id="yolo11n-pose-320",
            model_verified=yolo_fast_ok,
            license="AGPL-3.0",
            provider_actual=provider_name,
            notes="Preferido para tempo real sem latência.",
        ),
        EngineInfo(
            name="yolo11_pose_cpu",
            display_name="YOLO11-Pose (CPU AVX2)",
            description="YOLO11n-pose nos núcleos físicos do processador.",
            is_accelerated=True,
            hardware_provider=_yolo_provider(False, yolo_640_ok),
            available=yolo_640_ok,
            reason=None if yolo_640_ok else yolo_640_reason,
            model_id="yolo11n-pose",
            model_verified=yolo_640_ok,
            license="AGPL-3.0",
            provider_actual="CPU",
            notes=f"intra_op={hardware_manager.intra_op_threads} threads.",
        ),
        EngineInfo(
            name="rtmpose",
            display_name="RTMPose-m (Halpe26 / DirectML)",
            description="Top-down SimCC de alta precisão com 26 pontos Halpe26 e pés reais (calcanhar e biqueira).",
            is_accelerated=hardware_manager.has_directml,
            hardware_provider=f"{provider_name} · Halpe26",
            available=rtmpose_ok,
            reason=None if rtmpose_ok else rtmpose_reason,
            model_id="rtmpose-m-halpe26",
            model_verified=rtmpose_ok,
            license="Apache-2.0",
            provider_actual=provider_name,
            notes="Sem fallback disfarçado: fornece pontos anatómicos reais do pé.",
        ),
        EngineInfo(
            name="opencv_markers",
            display_name="Marcadores Físicos (Adesivos HSV)",
            description="Deteção de adesivos fluorescentes no ciclista.",
            is_accelerated=True,
            hardware_provider="OpenCV Native",
            available=True,
            model_id=None,
            model_verified=True,
            license="BSD-3-Clause",
            provider_actual="CPU Native",
            notes="O mais rápido de todos, exige marcadores físicos colados.",
        ),
    ]
    from athletemotion.infrastructure.autotune import get_active_profile

    return EngineListResponse(
        active_engine=active_name,
        active_side=active_side,
        available_engines=engines_meta,
        directml_available=hardware_manager.has_directml,
        hardware_profile=get_active_profile(),
    )


@router.post("/engine/switch")
def switch_engine(payload: SwitchEngineRequest):
    """Altera o motor e perfil em runtime sem reiniciar a aplicação."""
    from athletemotion.domain.inference.base import ModelUnavailableError

    try:
        new_engine = PoseEngineRegistry.create(
            payload.engine, side=payload.side, raise_on_unavailable=True
        )
        PoseEngineRegistry.set_active(new_engine)
        return {
            "status": "success",
            "message": f"Motor alterado para '{payload.engine}' com perfil '{payload.side}'.",
            "active_engine": payload.engine,
            "active_side": payload.side,
        }
    except ModelUnavailableError as err:
        logger.warning("Motor '%s' indisponível: %s", payload.engine, err.reason)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Motor '{payload.engine}' indisponível: {err.reason}",
        ) from err
    except ValueError as err:
        logger.exception("Motor inválido: %s", payload.engine)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        ) from err
    except Exception as err:
        logger.exception("Falha ao inicializar motor '%s'", payload.engine)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Não foi possível inicializar o motor '{payload.engine}'. Verifique a disponibilidade dos modelos.",
        ) from err


@router.post("/engine/warmup")
def warmup_engine():
    """Força a primeira inferência do motor ativo, fora do caminho crítico.

    Serve para o frontend pagar o arranque (DirectML compila o grafo; MediaPipe
    carrega o modelo) ANTES de o atleta começar a pedalar, em vez de no primeiro
    fotograma — que é quando o atraso se nota.
    """
    import time

    import numpy as np

    engine = _ensure_active_engine()
    frame = np.zeros((540, 960, 3), dtype=np.uint8)
    try:
        start = time.perf_counter()
        engine.process_frame(frame, 0)
        elapsed_ms = round((time.perf_counter() - start) * 1000.0, 1)
    except Exception as err:
        logger.exception("Falha no aquecimento do motor '%s'", engine.name)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha durante o procedimento de aquecimento do motor '{engine.name}'.",
        ) from err
    return {
        "status": "success",
        "engine": engine.name,
        "warmup_ms": elapsed_ms,
        "backend": getattr(engine, "backend", "onnx"),
        "input_size": getattr(engine, "input_size", None),
    }
