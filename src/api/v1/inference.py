"""Rotas REST para alternar motores de visão computacional em runtime."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, status

from src.infrastructure.hardware import hardware_manager
from src.domain.inference.base import PoseEngineRegistry
import src.domain.inference  # noqa: F401  Assegura que todos os motores estão registados no Factory
from src.domain.inference.yolo_engine import DEFAULT_MODEL_CANDIDATES, FAST_MODEL_CANDIDATES
from src.domain.inference.mediapipe_engine import resolve_landmarker_model
from src.schemas.inference import EngineListResponse, EngineInfo, SwitchEngineRequest

logger = logging.getLogger("athlete_motion.api.inference")

router = APIRouter(prefix="/inference", tags=["Inference Management"])


def _model_exists(candidates) -> bool:
    return any(Path(candidate).exists() for candidate in candidates)


def _ensure_active_engine():
    """Garante que existe um motor ativo e devolve-o."""
    try:
        return PoseEngineRegistry.get_active()
    except RuntimeError:
        engine = PoseEngineRegistry.create("mediapipe", side="right")
        PoseEngineRegistry.set_active(engine)
        logger.info("Motor padrão (MediaPipe) criado a pedido.")
        return engine


# Inicializar motor padrão (MediaPipe Pose sagital) no arranque do router
try:
    _default_engine = PoseEngineRegistry.create("mediapipe", side="right")
    PoseEngineRegistry.set_active(_default_engine)
except Exception as err:  # pragma: no cover - depende do ambiente
    logger.warning("Falha ao inicializar motor padrão na carga do router: %s", err)


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
    active = _ensure_active_engine()

    mp_model = resolve_landmarker_model(2)
    yolo_640 = _model_exists(DEFAULT_MODEL_CANDIDATES)
    yolo_fast = _model_exists(FAST_MODEL_CANDIDATES)

    engines_meta = [
        EngineInfo(
            name="mediapipe",
            display_name="MediaPipe Pose (Tasks — precisão)",
            description="Landmarker MediaPipe (heavy) com supressão contralateral e rigidez de fémur/tíbia a ±12%.",
            is_accelerated=False,
            hardware_provider=f"CPU ({hardware_manager.intra_op_threads} núcleos) · {mp_model.name}" if mp_model else "Modelo .task em falta — fallback YOLO",
            available=mp_model is not None,
            notes="Rede mais precisa para ângulos estáveis; mais lenta que o YOLO em GPU.",
        ),
        EngineInfo(
            name="yolo11_pose",
            display_name="YOLO11-Pose (DirectML GPU)",
            description="Rede YOLO11n-pose ONNX 640×640 acelerada na GPU, com rastreio por ROI entre deteções.",
            is_accelerated=hardware_manager.has_directml,
            hardware_provider=_yolo_provider(True, yolo_640),
            available=yolo_640,
            notes="Entrada 640px: máxima robustez; ~4× o custo da entrada 320px.",
        ),
        EngineInfo(
            name="yolo11_pose_fast",
            display_name="YOLO11-Pose Fast (320px + ROI)",
            description="Mesma rede com entrada 320×320 e rastreio por recorte: acompanha a pedalada sem atraso.",
            is_accelerated=hardware_manager.has_directml,
            hardware_provider=_yolo_provider(True, yolo_fast or yolo_640),
            available=(yolo_fast or yolo_640),
            notes="Preferido para tempo real. Se não existir o modelo 320, usa o 640.",
        ),
        EngineInfo(
            name="yolo11_pose_cpu",
            display_name="YOLO11-Pose (CPU AVX2)",
            description="YOLO11n-pose a correr nos núcleos físicos do processador quando não há GPU.",
            is_accelerated=True,
            hardware_provider=_yolo_provider(False, yolo_640),
            available=yolo_640,
            notes=f"intra_op={hardware_manager.intra_op_threads} threads.",
        ),
        EngineInfo(
            name="rtmpose",
            display_name="RTMPose (MMPose)",
            description="Focado em precisão e estabilidade rotacional de articulações em movimento rápido.",
            is_accelerated=hardware_manager.has_directml,
            hardware_provider="Modelo models/rtmpose-m.onnx em falta — fallback YOLO",
            available=Path("models/rtmpose-m.onnx").exists(),
            notes="Sem o ONNX do RTMPose o motor corre YOLO por baixo (nome do motor mantém-se).",
        ),
        EngineInfo(
            name="opencv_markers",
            display_name="Marcadores Físicos (Adesivos HSV)",
            description="Deteção de adesivos/marcadores fluorescentes no ciclista (requer marcadores físicos na pele/fato).",
            is_accelerated=True,
            hardware_provider="OpenCV Native",
            available=True,
            notes="O mais rápido de todos, mas exige marcadores físicos colados.",
        ),
    ]
    return EngineListResponse(
        active_engine=active.name,
        active_side=getattr(active, "side", "right"),
        available_engines=engines_meta,
        directml_available=hardware_manager.has_directml,
    )


@router.post("/engine/switch")
def switch_engine(payload: SwitchEngineRequest):
    """Altera o motor e perfil em runtime sem reiniciar a aplicação."""
    try:
        new_engine = PoseEngineRegistry.create(payload.engine, side=payload.side)
        PoseEngineRegistry.set_active(new_engine)
        return {
            "status": "success",
            "message": f"Motor alterado para '{payload.engine}' com perfil '{payload.side}'.",
            "active_engine": payload.engine,
            "active_side": payload.side,
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Falha ao carregar motor '{payload.engine}': {str(e)}",
        )


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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha no aquecimento do motor '{engine.name}': {err}",
        )
    return {
        "status": "success",
        "engine": engine.name,
        "warmup_ms": elapsed_ms,
        "backend": getattr(engine, "backend", "onnx"),
        "input_size": getattr(engine, "input_size", None),
    }
