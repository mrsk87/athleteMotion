# TAREFA 02: ARQUITETURA STRATEGY PATTERN & MEDIAPIPE SAGITAL RIGOROSO

> **Identificador:** `TASK_02_BACKEND_INFERENCE_STRATEGY_MEDIAPIPE`  
> **Prioridade:** P0 (Core de Inferência)  
> **Responsabilidade:** Criar a interface abstrata Strategy Pattern, estruturas de dados de pose e o motor MediaPipe Pose de alta precisão sagital com validação de segmento rígido e supressão contralateral.

---

## 1. OBJETIVO DA TAREFA
Implementar o núcleo de inferência em Python desacoplado através do padrão de desenho **Strategy**. O frontend poderá alterar o motor em execução a qualquer momento. O primeiro motor concreto a implementar é o **MediaPipe Pose** configurado para máxima precisão sagital (`model_complexity=2`, `confidence=0.7`), com regras biomecânicas estritas contra oclusão e troca de juntas (*joint swap*).

---

## 2. FICHEIROS A CRIAR

1. `src/domain/inference/types.py` (Modelos Pydantic / Dataclasses para resultados de inferência)
2. `src/domain/inference/base.py` (Interface `BasePoseEngine` e Strategy Factory)
3. `src/domain/inference/mediapipe_engine.py` (Implementação do motor MediaPipe)
4. `tests/unit/test_mediapipe_engine.py` (Testes unitários e biomecânicos)

---

## 3. MODELOS DE DADOS (`src/domain/inference/types.py`)

```python
"""Definições de tipos e estruturas de dados de inferência postural."""
from __future__ import annotations

from typing import Dict, Optional
from pydantic import BaseModel, Field


class Landmark2D(BaseModel):
    x: float = Field(..., ge=0.0, le=1.0, description="Coordenada X normalizada [0, 1]")
    y: float = Field(..., ge=0.0, le=1.0, description="Coordenada Y normalizada [0, 1]")
    z: float = Field(0.0, description="Profundidade Z relativa")
    visibility: float = Field(1.0, ge=0.0, le=1.0, description="Grau de confiança/visibilidade")


class SegmentValidation(BaseModel):
    femur_length: float
    tibia_length: float
    femur_valid: bool
    tibia_valid: bool
    segment_error_pct: float = 0.0


class BiomechanicalAngles(BaseModel):
    knee: Optional[float] = None
    torso: Optional[float] = None
    arm_elbow: Optional[float] = None
    shoulder: Optional[float] = None
    ankle: Optional[float] = None


class InferenceOutput(BaseModel):
    engine_name: str
    side: str  # "left" | "right"
    timestamp_ms: int
    landmarks: Dict[str, Landmark2D]
    angles: BiomechanicalAngles
    validation: SegmentValidation
    is_bdc: bool = False
    is_tdc: bool = False
    clock_position: str = "N/A"  # "12h", "3h", "6h", "9h"
```

---

## 4. INTERFACE BASE DO STRATEGY PATTERN (`src/domain/inference/base.py`)

```python
"""Interface Strategy para motores de visão computacional."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Dict, Type
import numpy as np

from .types import InferenceOutput


class BasePoseEngine(ABC):
    """Contrato abstrato que todos os motores de pose devem cumprir."""

    def __init__(self, name: str):
        self.name = name

    @abstractmethod
    def set_side(self, side: str) -> None:
        """Define o perfil observado ('left' ou 'right')."""
        pass

    @abstractmethod
    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        """Processa um frame de vídeo em formato BGR e retorna a telemetria padronizada."""
        pass

    @abstractmethod
    def reset(self) -> None:
        """Limpa estados internos (filtros temporais, histórico de segmentos)."""
        pass


class PoseEngineRegistry:
    """Registo e fábrica central de motores disponíveis."""

    _engines: Dict[str, Type[BasePoseEngine]] = {}
    _active_engine: Optional[BasePoseEngine] = None

    @classmethod
    def register(cls, name: str, engine_cls: Type[BasePoseEngine]) -> None:
        cls._engines[name] = engine_cls

    @classmethod
    def create(cls, name: str, **kwargs) -> BasePoseEngine:
        if name not in cls._engines:
            raise ValueError(f"Motor '{name}' não registado. Opções: {list(cls._engines.keys())}")
        return cls._engines[name](**kwargs)

    @classmethod
    def set_active(cls, engine: BasePoseEngine) -> None:
        cls._active_engine = engine

    @classmethod
    def get_active(cls) -> BasePoseEngine:
        if cls._active_engine is None:
            raise RuntimeError("Nenhum motor de inferência ativo no momento.")
        return cls._active_engine
```

---

## 5. MOTOR MEDIAPIPE SAGITAL RIGOROSO (`src/domain/inference/mediapipe_engine.py`)

O motor deve implementar os 3 requisitos biomecânicos estritos:
1. `model_complexity=2`, `min_detection_confidence=0.7`, `min_tracking_confidence=0.7`.
2. **Supressão Contralateral:** Se `side == 'right'`, anular landmarks esquerdos que estariam ocultos pelo quadro para impedir *joint swapping*.
3. **Validação de Segmento Rígido:** O comprimento euclidiano do fémur ($\overline{\text{Anca-Joelho}}$) e tíbia ($\overline{\text{Joelho-Tornozelo}}$) não pode variar mais de $\pm 12\%$ face à mediana histórica.

```python
"""Implementação do motor MediaPipe Pose com regras estritas de bike fit sagital."""
from __future__ import annotations

import math
from collections import deque
from typing import Dict, Optional, Tuple
import cv2
import mediapipe as mp
import numpy as np

from src.domain.calculator import calculate_safe_angle, Point2D
from .base import BasePoseEngine, PoseEngineRegistry
from .types import InferenceOutput, Landmark2D, BiomechanicalAngles, SegmentValidation


class MediaPipePoseEngine(BasePoseEngine):
    def __init__(self, side: str = "right"):
        super().__init__(name="mediapipe")
        self.side = side.lower()
        self.mp_pose = mp.solutions.pose
        self.pose = self.mp_pose.Pose(
            static_image_mode=False,
            model_complexity=2,           # MÁXIMA PRECISÃO SAGITAL
            smooth_landmarks=True,
            enable_segmentation=False,
            min_detection_confidence=0.7, # LIMIAR OBRIGATÓRIO
            min_tracking_confidence=0.7,  # LIMIAR OBRIGATÓRIO
        )
        
        # Histórico para validação de rigidez esquelética (janela móvel de 30 frames)
        self.femur_history: deque[float] = deque(maxlen=30)
        self.tibia_history: deque[float] = deque(maxlen=30)
        self.last_valid_landmarks: Optional[Dict[str, Landmark2D]] = None

    def set_side(self, side: str) -> None:
        self.side = side.lower()
        self.reset()

    def reset(self) -> None:
        self.femur_history.clear()
        self.tibia_history.clear()
        self.last_valid_landmarks = None

    def _dist(self, p1: Landmark2D, p2: Landmark2D) -> float:
        return math.hypot(p1.x - p2.x, p1.y - p2.y)

    def _validate_rigid_segments(
        self, hip: Landmark2D, knee: Landmark2D, ankle: Landmark2D
    ) -> Tuple[SegmentValidation, bool]:
        femur = self._dist(hip, knee)
        tibia = self._dist(knee, ankle)

        femur_valid = True
        tibia_valid = True
        err_pct = 0.0

        if len(self.femur_history) >= 5:
            med_femur = float(np.median(list(self.femur_history)))
            med_tibia = float(np.median(list(self.tibia_history)))

            femur_diff = abs(femur - med_femur) / med_femur
            tibia_diff = abs(tibia - med_tibia) / med_tibia
            err_pct = max(femur_diff, tibia_diff) * 100.0

            # Limiar anatómico rígido: máximo 12% de variação em perspetiva 2D
            if femur_diff > 0.12:
                femur_valid = False
            if tibia_diff > 0.12:
                tibia_valid = False

        if femur_valid and tibia_valid:
            self.femur_history.append(femur)
            self.tibia_history.append(tibia)

        val = SegmentValidation(
            femur_length=round(femur, 4),
            tibia_length=round(tibia, 4),
            femur_valid=femur_valid,
            tibia_valid=tibia_valid,
            segment_error_pct=round(err_pct, 2),
        )
        return val, (femur_valid and tibia_valid)

    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        # Conversão BGR -> RGB exigida pelo MediaPipe
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        results = self.pose.process(frame_rgb)

        raw_landmarks: Dict[str, Landmark2D] = {}
        if results.pose_landmarks:
            lm = results.pose_landmarks.landmark
            idx = self.mp_pose.PoseLandmark

            # Mapeamento estrito dependendo do lado sagital observado
            prefix = "RIGHT" if self.side == "right" else "LEFT"
            contra_prefix = "LEFT" if self.side == "right" else "RIGHT"

            hip_idx = getattr(idx, f"{prefix}_HIP")
            knee_idx = getattr(idx, f"{prefix}_KNEE")
            ankle_idx = getattr(idx, f"{prefix}_ANKLE")
            heel_idx = getattr(idx, f"{prefix}_HEEL")
            foot_idx = getattr(idx, f"{prefix}_FOOT_INDEX")
            shoulder_idx = getattr(idx, f"{prefix}_SHOULDER")
            elbow_idx = getattr(idx, f"{prefix}_ELBOW")
            wrist_idx = getattr(idx, f"{prefix}_WRIST")
            ear_idx = getattr(idx, f"{prefix}_EAR")

            raw_landmarks = {
                "hip": Landmark2D(x=lm[hip_idx].x, y=lm[hip_idx].y, z=lm[hip_idx].z, visibility=lm[hip_idx].visibility),
                "knee": Landmark2D(x=lm[knee_idx].x, y=lm[knee_idx].y, z=lm[knee_idx].z, visibility=lm[knee_idx].visibility),
                "ankle": Landmark2D(x=lm[ankle_idx].x, y=lm[ankle_idx].y, z=lm[ankle_idx].z, visibility=lm[ankle_idx].visibility),
                "heel": Landmark2D(x=lm[heel_idx].x, y=lm[heel_idx].y, z=lm[heel_idx].z, visibility=lm[heel_idx].visibility),
                "toe": Landmark2D(x=lm[foot_idx].x, y=lm[foot_idx].y, z=lm[foot_idx].z, visibility=lm[foot_idx].visibility),
                "shoulder": Landmark2D(x=lm[shoulder_idx].x, y=lm[shoulder_idx].y, z=lm[shoulder_idx].z, visibility=lm[shoulder_idx].visibility),
                "elbow": Landmark2D(x=lm[elbow_idx].x, y=lm[elbow_idx].y, z=lm[elbow_idx].z, visibility=lm[elbow_idx].visibility),
                "wrist": Landmark2D(x=lm[wrist_idx].x, y=lm[wrist_idx].y, z=lm[wrist_idx].z, visibility=lm[wrist_idx].visibility),
                "ear": Landmark2D(x=lm[ear_idx].x, y=lm[ear_idx].y, z=lm[ear_idx].z, visibility=lm[ear_idx].visibility),
            }

            # REGRA BIOMECÂNICA: Supressão Contralateral (Juntas ocultas pelo quadro são invalidadas)
            contra_hip_idx = getattr(idx, f"{contra_prefix}_HIP")
            contra_knee_idx = getattr(idx, f"{contra_prefix}_KNEE")
            # Forçar visibilidade nula para evitar qualquer inferência contralateral espúria
            lm[contra_hip_idx].visibility = 0.0
            lm[contra_knee_idx].visibility = 0.0

        # Validação de integridade de segmentos
        if "hip" in raw_landmarks and "knee" in raw_landmarks and "ankle" in raw_landmarks:
            val, is_valid = self._validate_rigid_segments(
                raw_landmarks["hip"], raw_landmarks["knee"], raw_landmarks["ankle"]
            )
            if not is_valid and self.last_valid_landmarks is not None:
                # Interpolar suavemente com o último frame estável se houver salto anómalo
                for k in ["hip", "knee", "ankle"]:
                    raw_landmarks[k].x = raw_landmarks[k].x * 0.3 + self.last_valid_landmarks[k].x * 0.7
                    raw_landmarks[k].y = raw_landmarks[k].y * 0.3 + self.last_valid_landmarks[k].y * 0.7
            else:
                self.last_valid_landmarks = raw_landmarks
        else:
            val = SegmentValidation(
                femur_length=0.0, tibia_length=0.0, femur_valid=False, tibia_valid=False
            )

        # Cálculo Angular de Alta Precisão
        angles = BiomechanicalAngles()
        if "hip" in raw_landmarks and "knee" in raw_landmarks and "ankle" in raw_landmarks:
            angles.knee = round(calculate_safe_angle(
                Point2D(raw_landmarks["hip"].x, raw_landmarks["hip"].y),
                Point2D(raw_landmarks["knee"].x, raw_landmarks["knee"].y),
                Point2D(raw_landmarks["ankle"].x, raw_landmarks["ankle"].y),
            ), 1)

        if "shoulder" in raw_landmarks and "hip" in raw_landmarks:
            # Tronco relativo à horizontal
            dx = abs(raw_landmarks["shoulder"].x - raw_landmarks["hip"].x)
            dy = raw_landmarks["hip"].y - raw_landmarks["shoulder"].y
            angles.torso = round(math.degrees(math.atan2(dy, dx)), 1) if dx > 0 else 90.0

        if "shoulder" in raw_landmarks and "elbow" in raw_landmarks and "wrist" in raw_landmarks:
            angles.arm_elbow = round(calculate_safe_angle(
                Point2D(raw_landmarks["shoulder"].x, raw_landmarks["shoulder"].y),
                Point2D(raw_landmarks["elbow"].x, raw_landmarks["elbow"].y),
                Point2D(raw_landmarks["wrist"].x, raw_landmarks["wrist"].y),
            ), 1)

        if "knee" in raw_landmarks and "ankle" in raw_landmarks and "toe" in raw_landmarks:
            angles.ankle = round(calculate_safe_angle(
                Point2D(raw_landmarks["knee"].x, raw_landmarks["knee"].y),
                Point2D(raw_landmarks["ankle"].x, raw_landmarks["ankle"].y),
                Point2D(raw_landmarks["toe"].x, raw_landmarks["toe"].y),
            ), 1)

        return InferenceOutput(
            engine_name=self.name,
            side=self.side,
            timestamp_ms=timestamp_ms,
            landmarks=raw_landmarks,
            angles=angles,
            validation=val,
            is_bdc=False,
            is_tdc=False,
            clock_position="N/A",
        )


# Registar no Factory
PoseEngineRegistry.register("mediapipe", MediaPipePoseEngine)
```

---

## 6. INSTRUÇÕES DE EXECUÇÃO PARA O AGENTE

1. Criar os ficheiros em `src/domain/inference/`.
2. Criar teste unitário em `tests/unit/test_mediapipe_engine.py` alimentando um frame sintético (preto com 3 pontos marcando fémur/tíbia).
3. Executar `pytest tests/unit/test_mediapipe_engine.py`.
4. **Critério de Saída:** O teste deve validar que:
   - A classe instancia com `model_complexity=2`.
   - Landmarks contralaterais são ignorados.
   - Deformações de segmento > 12% são flagradas por `femur_valid=False`.
