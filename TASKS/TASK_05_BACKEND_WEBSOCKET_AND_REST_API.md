# TAREFA 05: ENDPOINTS REST & WEBSOCKET STREAMING DE TELEMETRIA

> **Identificador:** `TASK_05_BACKEND_WEBSOCKET_AND_REST_API`  
> **Prioridade:** P0 (Camada de Comunicação)  
> **Responsabilidade:** Criar a API REST para gestão dos motores em runtime e o servidor WebSocket de alta velocidade para receção de frames e envio de telemetria biomecânica síncrona.

---

## 1. OBJETIVO DA TAREFA
Construir a camada de comunicação assíncrona entre o backend Python e o frontend Vue 3:
1. **REST API (`/api/v1/inference/...`):** Permite inspecionar hardware e alterar o motor de inferência ativo (`mediapipe`, `yolo11_pose`, `rtmpose`, `opencv_markers`) dinamicamente, sem reiniciar o serviço.
2. **WebSocket (`/ws/live-inference`):** Recebe o fluxo contínuo de frames do cliente (câmara ou ficheiro de vídeo), executa a inferência, aplica o filtro One-Euro e devolve a matriz de telemetria a 30-60 FPS com latência inferior a 33 ms.

---

## 2. FICHEIROS A CRIAR / ATUALIZAR

1. `src/schemas/inference.py` (Esquemas Pydantic para requisição e resposta REST)
2. `src/api/v1/inference.py` (Rotas REST de troca de motor e listagem)
3. `src/api/v1/inference_ws.py` (Endpoint WebSocket assíncrono para streaming)
4. `src/api/v1/router.py` (Inclusão das novas rotas)
5. `server.py` (Registo do endpoint WebSocket)

---

## 3. ESQUEMAS PYDANTIC (`src/schemas/inference.py`)

```python
"""Esquemas de dados para a API de inferência biomecânica."""
from typing import List, Optional
from pydantic import BaseModel, Field


class EngineInfo(BaseModel):
    name: str
    display_name: str
    description: str
    is_accelerated: bool
    hardware_provider: str


class EngineListResponse(BaseModel):
    active_engine: str
    active_side: str
    available_engines: List[EngineInfo]
    directml_available: bool


class SwitchEngineRequest(BaseModel):
    engine: str = Field(..., description="Nome do motor: 'mediapipe', 'yolo11_pose', 'rtmpose', 'opencv_markers'")
    side: str = Field("right", description="Lado observado: 'left' ou 'right'")
    smoothing: str = Field("one_euro", description="Modo de suavização: 'one_euro', 'none'")
```

---

## 4. ROTAS REST DE CONTROLO (`src/api/v1/inference.py`)

```python
"""Rotas REST para alternar motores de visão computacional em runtime."""
from fastapi import APIRouter, HTTPException, status
from src.infrastructure.hardware import hardware_manager
from src.domain.inference.base import PoseEngineRegistry
from src.domain.inference.mediapipe_engine import MediaPipePoseEngine
from src.schemas.inference import EngineListResponse, EngineInfo, SwitchEngineRequest

router = APIRouter(prefix="/inference", tags=["Inference Management"])

# Inicializar motor padrão (MediaPipe Pose sagital)
try:
    default_engine = PoseEngineRegistry.create("mediapipe", side="right")
    PoseEngineRegistry.set_active(default_engine)
except Exception:
    pass


@router.get("/engines", response_model=EngineListResponse)
def list_engines():
    """Lista motores disponíveis e informa sobre aceleração DirectML na AMD RX 580."""
    active = PoseEngineRegistry.get_active()
    engines_meta = [
        EngineInfo(
            name="mediapipe",
            display_name="MediaPipe Pose (Sagital Pro)",
            description="Modelo de alta precisão sagital com complexidade 2 e supressão contralateral.",
            is_accelerated=True,
            hardware_provider="CPU AVX2 (Xeon 8C/16T)",
        ),
        EngineInfo(
            name="yolo11_pose",
            display_name="YOLO11-Pose (ONNX 640x640)",
            description="Rede neuronal profunda acelerada na GPU AMD RX 580 com 8GB VRAM.",
            is_accelerated=hardware_manager.has_directml,
            hardware_provider="DirectML / DirectX 12" if hardware_manager.has_directml else "CPU Fallback",
        ),
        EngineInfo(
            name="rtmpose",
            display_name="RTMPose (MMPose)",
            description="Focado em precisão e estabilidade rotacional de articulações em movimento rápido.",
            is_accelerated=hardware_manager.has_directml,
            hardware_provider="DirectML / DirectX 12" if hardware_manager.has_directml else "CPU Fallback",
        ),
        EngineInfo(
            name="opencv_markers",
            display_name="Rastreio Ótico OpenCV",
            description="Deteção determinística de marcadores retrorefletores e autocolantes coloridos.",
            is_accelerated=True,
            hardware_provider="OpenCV Native",
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
```

---

## 5. SERVIDOR WEBSOCKET ASSÍNCRONO (`src/api/v1/inference_ws.py`)

O endpoint recebe frames via WebSocket. Suporta:
- Mensagens de bytes (JPEG com cabeçalho de timestamp de 4 bytes)
- Mensagens de controlo em JSON (`{"type": "set_side", "side": "left"}`)
- Supressão de acúmulo de fila (Backpressure Protection).

```python
"""Servidor WebSocket de streaming para análise postural em tempo real."""
import asyncio
import struct
import cv2
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from src.domain.inference.base import PoseEngineRegistry
from src.domain.inference.filters import LandmarkFilterPipeline

ws_router = APIRouter()

# Instância única de filtro temporal
landmark_filter = LandmarkFilterPipeline(min_cutoff=1.0, beta=0.007)


@ws_router.websocket("/ws/live-inference")
async def websocket_inference_endpoint(websocket: WebSocket):
    """Canal bidirecional de streaming de vídeo e telemetria."""
    await websocket.accept()
    landmark_filter.reset()

    try:
        while True:
            # Receber mensagem (binária ou texto)
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                raw_bytes = message["bytes"]
                if len(raw_bytes) < 5:
                    continue

                # Extrair timestamp_ms (primeiros 4 bytes uint32 big-endian)
                timestamp_ms = struct.unpack(">I", raw_bytes[:4])[0]
                jpeg_data = raw_bytes[4:]

                # Descodificar JPEG diretamente em memória usando OpenCV
                nparr = np.frombuffer(jpeg_data, np.uint8)
                frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if frame_bgr is None or frame_bgr.size == 0:
                    continue

                # Obter motor ativo atual
                engine = PoseEngineRegistry.get_active()

                # Inferência (executada no threadpool para não bloquear o event loop)
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(None, engine.process_frame, frame_bgr, timestamp_ms)

                # Aplicar One-Euro Filter para suprimir jitter
                smooth_landmarks = landmark_filter.filter_landmarks(result.landmarks, timestamp_ms)
                result.landmarks = smooth_landmarks

                # Enviar telemetria calculada de volta ao cliente
                await websocket.send_text(result.model_dump_json())

            elif "text" in message and message["text"]:
                # Processar mensagens de comando JSON
                import json
                try:
                    data = json.loads(message["text"])
                    if data.get("type") == "set_side":
                        engine = PoseEngineRegistry.get_active()
                        engine.set_side(data.get("side", "right"))
                        landmark_filter.reset()
                        await websocket.send_json({"status": "ok", "side_updated": data.get("side")})
                except Exception:
                    pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.close()
        except Exception:
            pass
```

---

## 6. INTEGRAÇÃO NO `server.py`
No `server.py`:
```python
from src.api.v1.inference import router as inference_router
from src.api.v1.inference_ws import ws_router

app.include_router(inference_router, prefix="/api/v1")
app.include_router(ws_router)
```

---

## 7. CRITÉRIOS DE ACEITAÇÃO
1. `GET /api/v1/inference/engines` responde código 200 com a lista dos 4 motores e o estado do DirectML.
2. `POST /api/v1/inference/engine/switch` com `{"engine": "mediapipe", "side": "left"}` altera o estado imediatamente.
3. Teste de WebSocket simulado com frames JPEG de teste conecta, processa e responde JSON contendo os ângulos `knee` e `torso`.
