"""Servidor WebSocket de streaming para análise postural em tempo real.

Desenho de tempo real:
- O cliente substitui SEMPRE o fotograma pendente pelo mais recente: se a GPU está
  ocupada, o fotograma antigo é descartado (nunca se acumula fila — é isso que
  produz a sensação de atraso a acompanhar o movimento).
- O filtro One-Euro é POR LIGAÇÃO (antes era global: dois clientes ao mesmo tempo
  contaminavam a suavização um do outro).
- O motor é aquecido na ligação e a cada troca, para o custo do arranque do
  DirectML/MediaPipe não cair no primeiro fotograma do atleta.
"""
from __future__ import annotations

import asyncio
import json
import logging
import struct
import time

import cv2
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from src.domain.inference.base import PoseEngineRegistry
import src.domain.inference  # noqa: F401  Registo dos motores
from src.domain.inference.filters import LandmarkFilterPipeline

logger = logging.getLogger("athlete_motion.api.inference_ws")
ws_router = APIRouter()


async def _ensure_engine(side: str = "right"):
    """Devolve o motor ativo, criando o padrão se ainda não existir."""
    try:
        return PoseEngineRegistry.get_active()
    except RuntimeError:
        engine = PoseEngineRegistry.create("mediapipe", side=side)
        PoseEngineRegistry.set_active(engine)
        logger.info("Motor padrão criado pela ligação WebSocket: %s", engine.name)
        return engine


async def _warmup(engine, loop) -> float:
    """Paga o arranque do motor fora do caminho crítico. Devolve ms gastos."""
    frame = np.zeros((540, 960, 3), dtype=np.uint8)

    def _run() -> float:
        start = time.perf_counter()
        engine.process_frame(frame, 0)
        return round((time.perf_counter() - start) * 1000.0, 1)

    try:
        return await loop.run_in_executor(None, _run)
    except Exception as err:  # pragma: no cover - aquecimento é best-effort
        logger.debug("Aquecimento do motor falhou: %s", err)
        return 0.0


@ws_router.websocket("/ws/live-inference")
async def websocket_inference_endpoint(websocket: WebSocket):
    """Canal bidirecional de streaming de vídeo e telemetria síncrona."""
    await websocket.accept()
    # Filtro próprio desta ligação: dois clientes nunca partilham o estado de suavização.
    landmark_filter = LandmarkFilterPipeline(min_cutoff=1.2, beta=0.05)
    landmark_filter.reset()
    loop = asyncio.get_running_loop()

    logger.info("Cliente WebSocket conectado a /ws/live-inference.")

    latest_frame = None
    new_frame_event = asyncio.Event()
    is_active = True

    # O motor é aquecido JÁ, na ligação: o custo de arranque (compilação do grafo do
    # DirectML, carregamento do modelo MediaPipe) sai do caminho crítico e o primeiro
    # fotograma do atleta já encontra a rede quente. Não se envia mensagem espontânea
    # para não alterar o protocolo pedido/resposta (o cliente pode pedir `warmup`).
    engine = await _ensure_engine()
    warmup_ms = await _warmup(engine, loop)
    logger.info("Motor '%s' pronto (aquecimento: %.1f ms).", engine.name, warmup_ms)

    async def inference_worker():
        nonlocal latest_frame, engine
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
                nparr = np.frombuffer(jpeg_data, np.uint8)
                frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if frame_bgr is None or frame_bgr.size == 0:
                    continue

                # Inferência executada no threadpool para não bloquear o event loop
                result = await loop.run_in_executor(None, engine.process_frame, frame_bgr, timestamp_ms)

                # Aplicar One-Euro Filter para suprimir jitter
                if result.landmarks:
                    result.landmarks = landmark_filter.filter_landmarks(result.landmarks, timestamp_ms)

                # Enviar telemetria calculada de volta ao cliente se a ligação ainda estiver ativa
                if is_active:
                    await websocket.send_text(result.model_dump_json())

            except asyncio.CancelledError:
                break
            except Exception as e:
                if is_active:
                    logger.debug("Erro na tarefa de inferência worker: %s", e)

    worker_task = asyncio.create_task(inference_worker())

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                logger.info("Cliente WebSocket desconectou (código %s).", message.get("code", 1000))
                break

            if "bytes" in message and message["bytes"]:
                raw_bytes = message["bytes"]
                if len(raw_bytes) < 5:
                    continue

                # Extrair timestamp_ms (primeiros 4 bytes uint32 big-endian)
                timestamp_ms = struct.unpack(">I", raw_bytes[:4])[0]
                if timestamp_ms == 0:
                    timestamp_ms = int(time.perf_counter() * 1000)

                # Substitui imediatamente o frame anterior: descarta atrasos de fila e garante que a GPU
                # processa sempre o fotograma mais recente
                latest_frame = (raw_bytes, timestamp_ms)
                new_frame_event.set()

            elif "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                    command = data.get("type")

                    if command == "set_side":
                        side = data.get("side", "right")
                        engine.set_side(side)
                        landmark_filter.reset()
                        await websocket.send_json({"status": "ok", "side_updated": side})

                    elif command == "warmup":
                        ms = await _warmup(engine, loop)
                        await websocket.send_json({"status": "ok", "warmup_ms": ms, "engine": engine.name})

                    elif command == "set_engine":
                        name = data.get("engine")
                        side = data.get("side", "right")
                        engine = PoseEngineRegistry.create(name, side=side)
                        PoseEngineRegistry.set_active(engine)
                        landmark_filter.reset()
                        ms = await _warmup(engine, loop)
                        await websocket.send_json(
                            {"status": "ok", "engine": engine.name, "warmup_ms": ms}
                        )

                except Exception as err:
                    logger.debug("Erro ao processar comando de texto WebSocket: %s", err)

    except (WebSocketDisconnect, ConnectionResetError):
        logger.info("Cliente WebSocket desconectado normalmente.")
    except RuntimeError as e:
        if "disconnect message has been received" in str(e):
            logger.info("Cliente WebSocket desconectado normalmente.")
        else:
            logger.warning("Erro de execução no WebSocket: %s", e)
    except Exception as e:
        logger.warning("Exceção no WebSocket de inferência: %s", e)
    finally:
        is_active = False
        new_frame_event.set()
        worker_task.cancel()
        try:
            await worker_task
        except asyncio.CancelledError:
            pass
        try:
            await websocket.close()
        except Exception:
            pass
