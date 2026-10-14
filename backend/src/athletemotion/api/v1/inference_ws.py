"""Servidor WebSocket de streaming para análise postural em tempo real.

Desenho de concorrência e isolamento (R03):
- Cada ligação WebSocket possui uma concessão isolada de motor (EngineLease) com
  executor de worker único dedicado, garantindo que nem o estado temporal (timestamps,
  histórico de segmentos) nem a sessão DirectML/MediaPipe são partilhados entre clientes.
- O filtro One-Euro é estritamente por ligação.
- Substituição imediata do fotograma pendente pelo mais recente (latest-frame-wins):
  evita acumulação de atraso mantendo telemetria fluida em tempo real.
- Falhas na inferência geram log com logger.exception e resposta estruturada sem
  vazar detalhes internos do sistema.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import secrets
import struct
import time
import uuid
from typing import Literal

import cv2
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ValidationError

import athletemotion.domain.inference  # noqa: F401  Garante o registo de todos os motores
from athletemotion.api.security.auth import (
    get_or_create_api_token,
    verify_websocket_token,
)
from athletemotion.config.settings import settings
from athletemotion.domain.cycle import OnlineCycleDetector, PedalingSample
from athletemotion.domain.inference.filters import LandmarkFilterPipeline
from athletemotion.infrastructure.metrics import metrics
from athletemotion.services.engine_manager import (
    EngineLimitExceededError,
    EngineManager,
)

logger = logging.getLogger("athlete_motion.api.inference_ws")
ws_router = APIRouter()

_fallback_engine_manager: EngineManager | None = None
_active_ws_connections: set[str] = set()
_ws_connections_lock = asyncio.Lock()


class WSCommandPayload(BaseModel):
    """Schema Pydantic restrito para comandos de controlo via WebSocket."""

    type: Literal["set_side", "warmup", "set_engine"]
    side: Literal["left", "right"] | None = None
    engine: str | None = None


def _get_engine_manager(app) -> EngineManager:
    """Devolve o EngineManager do estado da aplicação ou fallback de processo."""
    global _fallback_engine_manager
    if (
        hasattr(app, "state")
        and hasattr(app.state, "engine_manager")
        and app.state.engine_manager is not None
    ):
        return app.state.engine_manager
    if _fallback_engine_manager is None:
        _fallback_engine_manager = EngineManager(max_active_engines=settings.max_active_engines)
    return _fallback_engine_manager


@ws_router.websocket("/ws/live-inference")
async def websocket_inference_endpoint(websocket: WebSocket):
    """Canal bidirecional de streaming de vídeo e telemetria síncrona isolado por cliente."""
    # 0. Verificação de cabeçalho Origin se fornecido pelo browser
    origin = websocket.headers.get("origin")
    if origin and origin not in settings.allowed_origins:
        logger.warning("Origem rejeitada no WebSocket handshake: %s", origin)
        await websocket.close(code=1008)
        return

    # 1. Verificação de autenticação de segurança
    is_authenticated = verify_websocket_token(websocket)
    if not is_authenticated:
        # Se os cabeçalhos não trazem token, aceita e aguarda 1ª mensagem com {"token": "..."}
        await websocket.accept()
        try:
            raw_init = await asyncio.wait_for(websocket.receive_text(), timeout=3.0)
            data = json.loads(raw_init)
            token = data.get("token") or data.get("api_token")
            expected_token = get_or_create_api_token()
            if token and secrets.compare_digest(token.strip(), expected_token):
                is_authenticated = True
                await websocket.send_json({"status": "ok", "message": "Autenticado com sucesso."})
        except (json.JSONDecodeError, TimeoutError, KeyError, ValueError, RuntimeError):
            is_authenticated = False

        if not is_authenticated:
            logger.warning("Ligação WebSocket rejeitada por falta de credenciais válidas.")
            try:
                await websocket.send_json({"status": "error", "code": "unauthorized"})
                await websocket.close(code=1008)
            except (WebSocketDisconnect, RuntimeError, OSError):
                pass
            return
    else:
        await websocket.accept()

    connection_id = str(uuid.uuid4())

    # 2. Limite global de ligações concorrentes
    async with _ws_connections_lock:
        if len(_active_ws_connections) >= settings.ws_max_connections:
            logger.warning(
                "Limite de ligações WebSocket atingido (%d)", settings.ws_max_connections
            )
            with contextlib.suppress(WebSocketDisconnect, RuntimeError, OSError):
                await websocket.close(code=1013)  # 1013: Try Again Later
            return
        _active_ws_connections.add(connection_id)

    engine_manager = _get_engine_manager(websocket.app)

    # Filtro One-Euro próprio desta ligação
    landmark_filter = LandmarkFilterPipeline(min_cutoff=1.2, beta=0.05)
    landmark_filter.reset()

    # Detetor de ciclos online por ligação (R10)
    cycle_detector = OnlineCycleDetector()

    # Estatísticas e métricas operacionais da ligação
    frames_received = 0
    frames_processed = 0
    frames_dropped = 0
    inference_errors = 0
    invalid_consecutive_frames = 0
    max_msg_size = settings.ws_max_message_bytes

    try:
        lease = await engine_manager.acquire(connection_id, "mediapipe", side="right")
    except EngineLimitExceededError as err:
        logger.warning("Rejeitada ligação WS %s por excesso de limite: %s", connection_id, err)
        await websocket.send_json({"status": "error", "code": "engine_limit_exceeded"})
        await websocket.close(code=1008)
        return
    except Exception:
        logger.exception("Falha ao alocar motor inicial para %s", connection_id)
        await websocket.close(code=1011)
        return

    warmup_ms = await lease.warmup()
    logger.info(
        "Cliente WebSocket conectado [conn=%s] com motor '%s' (aquecimento: %.1f ms).",
        connection_id,
        lease.engine_name,
        warmup_ms,
    )

    latest_frame = None
    new_frame_event = asyncio.Event()
    is_active = True

    async def inference_worker():
        nonlocal latest_frame, lease, frames_processed, inference_errors
        while is_active:
            try:
                await new_frame_event.wait()
                new_frame_event.clear()

                frame_data = latest_frame
                if frame_data is None:
                    continue

                raw_bytes, timestamp_ms = frame_data
                jpeg_data = raw_bytes[4:]

                # Descodificar JPEG diretamente em memória usando OpenCV
                t_dec0 = time.perf_counter()
                nparr = np.frombuffer(jpeg_data, np.uint8)
                frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                t_decode_ms = (time.perf_counter() - t_dec0) * 1000.0
                if frame_bgr is None or frame_bgr.size == 0:
                    continue

                # Inferência executada de forma estritamente serializada no executor da lease
                t_inf0 = time.perf_counter()
                result = await lease.process_frame(frame_bgr, timestamp_ms)
                t_infer_ms = (time.perf_counter() - t_inf0) * 1000.0
                frames_processed += 1

                metrics.record_frame(
                    lease.engine_name,
                    {
                        "decode_ms": t_decode_ms,
                        "infer_ms": t_infer_ms,
                        "total_ms": t_decode_ms + t_infer_ms,
                    },
                )

                # Aplicar One-Euro Filter para suprimir jitter
                if result.landmarks:
                    result.landmarks = landmark_filter.filter_landmarks(
                        result.landmarks, timestamp_ms
                    )

                # Deteção online de ciclos, BDC/TDC e posição angular do crenque (R10)
                ankle_lm = result.landmarks.get("ankle")
                if ankle_lm is not None:
                    h_frame, w_frame = frame_bgr.shape[:2]
                    sample = PedalingSample(
                        frame_index=frames_processed,
                        timestamp_ms=float(timestamp_ms),
                        ankle_y=float(ankle_lm.y * h_frame),
                        ankle_x=float(ankle_lm.x * w_frame),
                        knee_angle=result.angles.knee,
                        visibility=float(ankle_lm.visibility),
                    )
                    _, clock_pos, is_bdc, is_tdc = cycle_detector.push(sample)
                    result.is_bdc = is_bdc
                    result.is_tdc = is_tdc
                    result.clock_position = f"{round(clock_pos)}h"

                # Enviar telemetria calculada de volta ao cliente se a ligação ainda estiver ativa
                if is_active:
                    await websocket.send_text(result.model_dump_json())

            except asyncio.CancelledError:
                break
            except Exception:
                inference_errors += 1
                if is_active:
                    logger.exception(
                        "Erro na inferência worker [conn=%s, motor=%s]",
                        connection_id,
                        lease.engine_name,
                    )
                    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
                        await websocket.send_json({"status": "error", "code": "engine_failed"})

    worker_task = asyncio.create_task(inference_worker())

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                logger.info(
                    "Cliente WebSocket desconectou (código %s).",
                    message.get("code", 1000),
                )
                break

            if message.get("bytes"):
                raw_bytes = message["bytes"]
                if len(raw_bytes) > max_msg_size:
                    logger.warning(
                        "Mensagem binária WebSocket excedeu o limite máximo (%d > %d bytes) [conn=%s]",
                        len(raw_bytes),
                        max_msg_size,
                        connection_id,
                    )
                    await websocket.close(code=1009)  # Message Too Big
                    break

                if len(raw_bytes) < 6 or not raw_bytes[4:].startswith(b"\xff\xd8"):
                    invalid_consecutive_frames += 1
                    if invalid_consecutive_frames >= 5:
                        logger.warning(
                            "Encerrando WebSocket [conn=%s]: 5 frames consecutivos inválidos (sem cabeçalho JPEG SOI).",
                            connection_id,
                        )
                        await websocket.close(code=1003)  # Unsupported Data
                        break
                    continue

                invalid_consecutive_frames = 0
                frames_received += 1
                if latest_frame is not None and new_frame_event.is_set():
                    frames_dropped += 1
                    metrics.record_drop(lease.engine_name)

                # Extrair timestamp_ms (primeiros 4 bytes uint32 big-endian)
                timestamp_ms = struct.unpack(">I", raw_bytes[:4])[0]
                if timestamp_ms == 0:
                    timestamp_ms = int(time.perf_counter() * 1000)

                # Substitui imediatamente o frame anterior: descarta atrasos de fila
                latest_frame = (raw_bytes, timestamp_ms)
                new_frame_event.set()

            elif message.get("text"):
                text_msg = message["text"]
                if len(text_msg) > max_msg_size:
                    logger.warning(
                        "Mensagem de texto WebSocket excedeu o limite máximo (%d > %d bytes) [conn=%s]",
                        len(text_msg),
                        max_msg_size,
                        connection_id,
                    )
                    await websocket.close(code=1009)
                    break

                try:
                    cmd = WSCommandPayload.model_validate_json(text_msg)
                except ValidationError as val_err:
                    logger.debug("Comando WebSocket com payload inválido: %s", val_err)
                    await websocket.send_json({"status": "error", "code": "invalid_command"})
                    continue

                if cmd.type == "set_side":
                    side = cmd.side or "right"
                    lease.set_side(side)
                    landmark_filter.reset()
                    cycle_detector.reset()
                    await websocket.send_json({"status": "ok", "side_updated": side})

                elif cmd.type == "warmup":
                    ms = await lease.warmup()
                    await websocket.send_json(
                        {
                            "status": "ok",
                            "warmup_ms": ms,
                            "engine": lease.engine_name,
                        }
                    )

                elif cmd.type == "set_engine":
                    if not cmd.engine:
                        await websocket.send_json({"status": "error", "code": "missing_engine"})
                        continue
                    side = cmd.side or lease.side
                    try:
                        lease = await engine_manager.acquire(connection_id, cmd.engine, side=side)
                        landmark_filter.reset()
                        cycle_detector.reset()
                        ms = await lease.warmup()
                        await websocket.send_json(
                            {
                                "status": "ok",
                                "engine": lease.engine_name,
                                "warmup_ms": ms,
                            }
                        )
                    except (ValueError, EngineLimitExceededError) as err:
                        await websocket.send_json(
                            {
                                "status": "error",
                                "code": "engine_switch_failed",
                                "message": str(err),
                            }
                        )

    except (WebSocketDisconnect, ConnectionResetError):
        logger.info("Cliente WebSocket desconectado normalmente [conn=%s].", connection_id)
    except RuntimeError as e:
        if "disconnect message has been received" in str(e):
            logger.info("Cliente WebSocket desconectado normalmente [conn=%s].", connection_id)
        else:
            logger.warning("Erro de execução no WebSocket [conn=%s]: %s", connection_id, e)
    except OSError as e:
        logger.warning(
            "Exceção de rede/socket no WebSocket de inferência [conn=%s]: %s",
            connection_id,
            e,
        )
    finally:
        is_active = False
        new_frame_event.set()
        worker_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await worker_task
        await engine_manager.release(connection_id)
        async with _ws_connections_lock:
            _active_ws_connections.discard(connection_id)
        logger.info(
            "Sessão WS concluída [conn=%s]: recebidos=%d, processados=%d, descartados=%d, erros=%d",
            connection_id,
            frames_received,
            frames_processed,
            frames_dropped,
            inference_errors,
        )
        with contextlib.suppress(WebSocketDisconnect, RuntimeError, OSError):
            await websocket.close()
