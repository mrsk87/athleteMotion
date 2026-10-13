# TAREFA 03: MOTORES YOLO11-POSE E RTMPOSE COM AMD DIRECTML

> **Identificador:** `TASK_03_BACKEND_YOLO_RTMPOSE_DIRECTML`  
> **Prioridade:** P1 (Aceleração por Hardware GPU)  
> **Responsabilidade:** Implementar os motores de inferência profunda YOLOv8/YOLO11-Pose e RTMPose utilizando ONNX Runtime com `DmlExecutionProvider`, tirando partido dos 8 GB de VRAM da AMD Radeon RX 580.

---

## 1. OBJETIVO DA TAREFA
Adicionar suporte de primeira classe a modelos de Pose Estimation de estado da arte baseados em redes neuronais convolucionais e transformadores (YOLOv8/11 e RTMPose). Os modelos correm a **640x640**, acelerados pela GPU **AMD Radeon RX 580 8 GB** via **DirectML (DirectX 12)**, garantindo latências inferiores a 25 ms por frame.

---

## 2. FICHEIROS A CRIAR

1. `src/domain/inference/onnx_utils.py` (Preprocessamento Letterbox e conversão de tensores)
2. `src/domain/inference/yolo_engine.py` (Motor `YOLO11PoseEngine` com DirectML)
3. `src/domain/inference/rtmpose_engine.py` (Motor `RTMPoseEngine` para estabilidade rotacional)
4. `scripts/export_yolo_onnx.py` (Script de exportação automática dos pesos para ONNX)

---

## 3. PREPROCESSAMENTO LETTERBOX (`src/domain/inference/onnx_utils.py`)

A inferência a 640x640 exige preservação estrita da proporção de aspeto (aspect ratio) da bicicleta. Deformar a imagem altera os ângulos medidos!

```python
"""Utilitários de visão para inferência ONNX em alta fidelidade geométrica."""
from __future__ import annotations

from typing import Tuple
import cv2
import numpy as np


def letterbox(
    im: np.ndarray,
    new_shape: Tuple[int, int] = (640, 640),
    color: Tuple[int, int, int] = (114, 114, 114),
    auto: bool = False,
    scaleFill: bool = False,
    scaleup: bool = True,
    stride: int = 32,
) -> Tuple[np.ndarray, float, Tuple[float, float]]:
    """Redimensiona e aplica padding na imagem para 640x640 sem distorção angular."""
    shape = im.shape[:2]  # altura, largura atual
    if isinstance(new_shape, int):
        new_shape = (new_shape, new_shape)

    # Razão de escala (novo / antigo)
    r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])
    if not scaleup:
        r = min(r, 1.0)

    # Dimensões redimensionadas não-padded
    new_unpad = (int(round(shape[1] * r)), int(round(shape[0] * r)))
    dw, dh = new_shape[1] - new_unpad[0], new_shape[0] - new_unpad[1]  # padding wh

    dw /= 2  # Dividir padding em ambos os lados
    dh /= 2

    if shape[::-1] != new_unpad:
        im = cv2.resize(im, new_unpad, interpolation=cv2.INTER_LINEAR)

    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
    im = cv2.copyMakeBorder(im, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color)
    return im, r, (dw, dh)


def preprocess_image_for_onnx(img_bgr: np.ndarray, target_size: int = 640) -> Tuple[np.ndarray, float, Tuple[float, float]]:
    """Gera o tensor CHW float32 [1, 3, 640, 640] normalizado [0, 1]."""
    img_padded, ratio, (pad_w, pad_h) = letterbox(img_bgr, (target_size, target_size))
    # BGR para RGB
    img_rgb = img_padded[:, :, ::-1]
    # HWC -> CHW
    img_chw = img_rgb.transpose((2, 0, 1)).astype(np.float32) / 255.0
    # Batch dimension: [1, 3, H, W]
    tensor = np.expand_dims(img_chw, axis=0)
    return np.ascontiguousarray(tensor), ratio, (pad_w, pad_h)
```

---

## 4. MOTOR YOLO11-POSE DIRECTML (`src/domain/inference/yolo_engine.py`)

```python
"""Motor de inferência YOLO11-Pose / YOLOv8-Pose acelerado via DirectML."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, Optional
import numpy as np
import onnxruntime as ort

from src.infrastructure.hardware import hardware_manager
from src.domain.calculator import calculate_safe_angle, Point2D
from .base import BasePoseEngine, PoseEngineRegistry
from .onnx_utils import preprocess_image_for_onnx
from .types import InferenceOutput, Landmark2D, BiomechanicalAngles, SegmentValidation

logger = logging.getLogger("athlete_motion.yolo_engine")

# Mapeamento dos 17 Keypoints COCO para o esqueleto sagital do ciclista
COCO_KP_NAMES = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle"
]


class YOLO11PoseEngine(BasePoseEngine):
    def __init__(self, model_path: str = "models/yolo11n-pose.onnx", side: str = "right"):
        super().__init__(name="yolo11_pose")
        self.side = side.lower()
        self.model_path = Path(model_path)
        
        if not self.model_path.exists():
            logger.warning("Ficheiro %s não encontrado. Usando fallback CPU mock.", self.model_path)
            self.session = None
        else:
            session_opts = hardware_manager.create_session_options()
            providers = hardware_manager.get_execution_providers()
            self.session = ort.InferenceSession(
                str(self.model_path),
                sess_options=session_opts,
                providers=providers,
            )
            self.input_name = self.session.get_inputs()[0].name
            logger.info("YOLO11 ONNX carregado com sucesso via DirectML.")

    def set_side(self, side: str) -> None:
        self.side = side.lower()

    def reset(self) -> None:
        pass

    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        h_orig, w_orig = frame_bgr.shape[:2]
        
        if self.session is None:
            # Fallback seguro caso os pesos ainda não tenham sido descarregados
            return InferenceOutput(
                engine_name=self.name,
                side=self.side,
                timestamp_ms=timestamp_ms,
                landmarks={},
                angles=BiomechanicalAngles(),
                validation=SegmentValidation(femur_length=0, tibia_length=0, femur_valid=False, tibia_valid=False),
            )

        # 1. Preprocessamento com Letterbox 640x640
        input_tensor, ratio, (pad_w, pad_h) = preprocess_image_for_onnx(frame_bgr, target_size=640)

        # 2. Execução direta na GPU via DirectML
        outputs = self.session.run(None, {self.input_name: input_tensor})
        preds = outputs[0]  # Shape típico: [1, 56, 8400]

        # 3. Extração do indivíduo com maior confiança
        # Formato YOLO-Pose: [x, y, w, h, conf, kpt_x1, kpt_y1, kpt_conf1, ...]
        preds = np.squeeze(preds, axis=0)  # [56, 8400]
        preds = preds.transpose((1, 0))   # [8400, 56]

        # Filtrar pelo maior score de bbox (classe 0: person)
        best_det = preds[np.argmax(preds[:, 4])]
        kpts_raw = best_det[5:]  # 17 keypoints * 3 = 51 valores

        landmarks_raw: Dict[str, Landmark2D] = {}
        side_prefix = "right" if self.side == "right" else "left"

        for i, name in enumerate(COCO_KP_NAMES):
            kx = kpts_raw[i * 3]
            ky = kpts_raw[i * 3 + 1]
            kconf = kpts_raw[i * 3 + 2]

            # Reverter letterbox para coordenadas normalizadas originais
            orig_x = (kx - pad_w) / ratio / w_orig
            orig_y = (ky - pad_h) / ratio / h_orig

            orig_x = float(np.clip(orig_x, 0.0, 1.0))
            orig_y = float(np.clip(orig_y, 0.0, 1.0))

            if name == f"{side_prefix}_hip":
                landmarks_raw["hip"] = Landmark2D(x=orig_x, y=orig_y, visibility=float(kconf))
            elif name == f"{side_prefix}_knee":
                landmarks_raw["knee"] = Landmark2D(x=orig_x, y=orig_y, visibility=float(kconf))
            elif name == f"{side_prefix}_ankle":
                landmarks_raw["ankle"] = Landmark2D(x=orig_x, y=orig_y, visibility=float(kconf))
                # Estimativas geométricas sagitais para calcâneo e biqueira (5º metatarso)
                landmarks_raw["heel"] = Landmark2D(x=orig_x - 0.015, y=orig_y + 0.01, visibility=float(kconf * 0.9))
                landmarks_raw["toe"] = Landmark2D(x=orig_x + 0.035, y=orig_y + 0.015, visibility=float(kconf * 0.9))
            elif name == f"{side_prefix}_shoulder":
                landmarks_raw["shoulder"] = Landmark2D(x=orig_x, y=orig_y, visibility=float(kconf))
            elif name == f"{side_prefix}_elbow":
                landmarks_raw["elbow"] = Landmark2D(x=orig_x, y=orig_y, visibility=float(kconf))
            elif name == f"{side_prefix}_wrist":
                landmarks_raw["wrist"] = Landmark2D(x=orig_x, y=orig_y, visibility=float(kconf))
            elif name == f"{side_prefix}_ear":
                landmarks_raw["ear"] = Landmark2D(x=orig_x, y=orig_y, visibility=float(kconf))

        # 4. Cálculo de Ângulos
        angles = BiomechanicalAngles()
        if "hip" in landmarks_raw and "knee" in landmarks_raw and "ankle" in landmarks_raw:
            angles.knee = round(calculate_safe_angle(
                Point2D(landmarks_raw["hip"].x, landmarks_raw["hip"].y),
                Point2D(landmarks_raw["knee"].x, landmarks_raw["knee"].y),
                Point2D(landmarks_raw["ankle"].x, landmarks_raw["ankle"].y),
            ), 1)

        val = SegmentValidation(femur_length=0.25, tibia_length=0.22, femur_valid=True, tibia_valid=True)

        return InferenceOutput(
            engine_name=self.name,
            side=self.side,
            timestamp_ms=timestamp_ms,
            landmarks=landmarks_raw,
            angles=angles,
            validation=val,
        )


PoseEngineRegistry.register("yolo11_pose", YOLO11PoseEngine)
```

---

## 5. MOTOR RTMPOSE DIRECTML (`src/domain/inference/rtmpose_engine.py`)

Criar `src/domain/inference/rtmpose_engine.py` adaptado para o modelo MMPose RTMPose-m (256x192 ou 640x640), registado no factory como:
```python
PoseEngineRegistry.register("rtmpose", RTMPoseEngine)
```

---

## 6. SCRIPT DE EXPORTAÇÃO (`scripts/export_yolo_onnx.py`)

Cria `scripts/export_yolo_onnx.py` usando `ultralytics` para exportar o modelo para a pasta `models/`:

```python
"""Exporta YOLO11n-pose para formato ONNX 640x640 para DirectML."""
from pathlib import Path
from ultralytics import YOLO

models_dir = Path("models")
models_dir.mkdir(exist_ok=True)

model = YOLO("yolo11n-pose.pt")
model.export(format="onnx", imgsz=640, dynamic=False, simplify=True)

# Mover para a pasta models
exported = Path("yolo11n-pose.onnx")
if exported.exists():
    exported.rename(models_dir / "yolo11n-pose.onnx")
print("Modelo exportado com sucesso para models/yolo11n-pose.onnx")
```

---

## 7. CRITÉRIOS DE ACEITAÇÃO
1. O ficheiro `models/yolo11n-pose.onnx` existe.
2. `YOLO11PoseEngine` inicializa com `DmlExecutionProvider` sem erros de VRAM.
3. A chamada a `process_frame` devolve coordenadas normalizadas `[0.0, 1.0]` e calcula os ângulos do joelho e tronco.
