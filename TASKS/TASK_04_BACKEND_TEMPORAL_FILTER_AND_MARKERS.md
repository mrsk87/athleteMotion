# TAREFA 04: FILTRAGEM TEMPORAL ONE-EURO & RASTREIO ÓTICO OPENCV

> **Identificador:** `TASK_04_BACKEND_TEMPORAL_FILTER_AND_MARKERS`  
> **Prioridade:** P1 (Precisão e Zero Jitter)  
> **Responsabilidade:** Implementar o Filtro One-Euro adaptativo para eliminação de jitter sem latência, e o módulo de visão clássica OpenCV para marcadores físicos (retrorefletores e cores HSV).

---

## 1. OBJETIVO DA TAREFA
1. **Filtro One-Euro:** Suprimir micro-vibrações (jitter) nas coordenadas dos landmarks geradas pelos modelos de IA, especialmente em momentos de velocidade angular reduzida (como o ponto morto superior TDC ou passagem do pé a 12h/6h), mantendo zero latência nas acelerações.
2. **Rastreio Ótico OpenCV Clássico:** Oferecer um método alternativo e determinístico baseado em marcadores adesivos físicos (retrorefletores ou autocolantes coloridos), imune a desvios de redes neuronais.

---

## 2. FORMULAÇÃO MATEMÁTICA DO FILTRO ONE-EURO

O Filtro One-Euro (Casiez et al., CHI 2012) usa uma frequência de corte adaptativa $f_c$ baseada na velocidade do movimento:

$$\dot{x}_t = \frac{x_t - \hat{x}_{t-1}}{\Delta t}$$
$$\hat{\dot{x}}_t = \text{LowPass}(\dot{x}_t, \alpha_d)$$
$$f_c = f_{c,min} + \beta |\hat{\dot{x}}_t|$$
$$\alpha = \frac{1}{1 + \frac{1}{2\pi f_c \Delta t}}$$
$$\hat{x}_t = \alpha x_t + (1 - \alpha) \hat{x}_{t-1}$$

### Parâmetros Calibrados para Ciclismo (60 a 120 RPM):
- $f_{c,min} = 1.0 \text{ Hz}$ (suprime tremores quando a perna desacelera ou o atleta está parado).
- $\beta = 0.007$ (aumenta rapidamente a frequência de corte quando a cadência é alta, evitando atraso na passagem pelo BDC).
- $d_{cutoff} = 1.0 \text{ Hz}$ (filtro da derivada de velocidade).

---

## 3. IMPLEMENTAÇÃO DO FILTRO ONE-EURO (`src/domain/inference/filters.py`)

Cria `src/domain/inference/filters.py`:

```python
"""Filtro temporal One-Euro para estabilização de landmarks biomecânicos."""
from __future__ import annotations

import math
from typing import Dict, Optional
from .types import Landmark2D


class LowPassFilter:
    def __init__(self, alpha: float = 0.5):
        self.alpha = alpha
        self.hat_x_prev: Optional[float] = None

    def reset(self):
        self.hat_x_prev = None

    def filter(self, x: float, alpha: Optional[float] = None) -> float:
        if alpha is not None:
            self.alpha = alpha
        if self.hat_x_prev is None:
            self.hat_x_prev = x
            return x
        hat_x = self.alpha * x + (1.0 - self.alpha) * self.hat_x_prev
        self.hat_x_prev = hat_x
        return hat_x


class OneEuroFilter1D:
    def __init__(self, min_cutoff: float = 1.0, beta: float = 0.007, d_cutoff: float = 1.0):
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.x_filter = LowPassFilter()
        self.dx_filter = LowPassFilter()
        self.t_prev: Optional[float] = None

    def reset(self):
        self.x_filter.reset()
        self.dx_filter.reset()
        self.t_prev = None

    def _alpha(self, cutoff: float, dt: float) -> float:
        tau = 1.0 / (2.0 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def filter(self, x: float, timestamp_sec: float) -> float:
        if self.t_prev is None:
            self.t_prev = timestamp_sec
            return self.x_filter.filter(x)

        dt = max(timestamp_sec - self.t_prev, 1e-4)
        self.t_prev = timestamp_sec

        # Estimar derivada (velocidade)
        prev_x = self.x_filter.hat_x_prev if self.x_filter.hat_x_prev is not None else x
        dx = (x - prev_x) / dt
        alpha_d = self._alpha(self.d_cutoff, dt)
        hat_dx = self.dx_filter.filter(dx, alpha_d)

        # Adaptar frequência de corte
        cutoff = self.min_cutoff + self.beta * abs(hat_dx)
        alpha = self._alpha(cutoff, dt)
        return self.x_filter.filter(x, alpha)


class LandmarkFilterPipeline:
    """Aplica filtros One-Euro independentes em X e Y para cada junta anatómica."""

    def __init__(self, min_cutoff: float = 1.0, beta: float = 0.007):
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.filters_x: Dict[str, OneEuroFilter1D] = {}
        self.filters_y: Dict[str, OneEuroFilter1D] = {}

    def reset(self):
        for f in self.filters_x.values():
            f.reset()
        for f in self.filters_y.values():
            f.reset()

    def filter_landmarks(self, landmarks: Dict[str, Landmark2D], timestamp_ms: int) -> Dict[str, Landmark2D]:
        t_sec = timestamp_ms / 1000.0
        filtered: Dict[str, Landmark2D] = {}

        for name, lm in landmarks.items():
            if name not in self.filters_x:
                self.filters_x[name] = OneEuroFilter1D(self.min_cutoff, self.beta)
                self.filters_y[name] = OneEuroFilter1D(self.min_cutoff, self.beta)

            smooth_x = self.filters_x[name].filter(lm.x, t_sec)
            smooth_y = self.filters_y[name].filter(lm.y, t_sec)

            filtered[name] = Landmark2D(
                x=float(smooth_x),
                y=float(smooth_y),
                z=lm.z,
                visibility=lm.visibility,
            )

        return filtered
```

---

## 4. MOTOR DE RASTREIO ÓTICO CLÁSSICO OPENCV (`src/domain/inference/opencv_tracker.py`)

Cria `src/domain/inference/opencv_tracker.py` para detetar marcadores retrorefletores ou de cor HSV (CromaTrack):

```python
"""Motor de visão clássica para deteção ótica determinística de marcadores físicos."""
from __future__ import annotations

from typing import Dict, List, Tuple
import cv2
import numpy as np

from src.domain.calculator import calculate_safe_angle, Point2D
from .base import BasePoseEngine, PoseEngineRegistry
from .types import InferenceOutput, Landmark2D, BiomechanicalAngles, SegmentValidation


class OpenCVClassicalTracker(BasePoseEngine):
    def __init__(self, side: str = "right", mode: str = "hsv"):
        super().__init__(name="opencv_markers")
        self.side = side.lower()
        self.mode = mode  # "hsv" ou "luma" (retrorefletor)
        
        # Intervalos HSV para marcadores coloridos comuns em bike fit:
        # Verde fluorescente: Joelho | Ciano: Tornozelo | Magenta/Laranja: Anca
        self.color_ranges = {
            "knee": (np.array([35, 80, 80]), np.array([85, 255, 255])),
            "ankle": (np.array([85, 80, 80]), np.array([125, 255, 255])),
            "hip": (np.array([140, 80, 80]), np.array([170, 255, 255])),
        }

    def set_side(self, side: str) -> None:
        self.side = side.lower()

    def reset(self) -> None:
        pass

    def _find_centroid(self, mask: np.ndarray, min_area: int = 15, max_area: int = 2500) -> Tuple[float, float, bool]:
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        best_c = None
        best_area = 0

        for c in contours:
            area = cv2.contourArea(c)
            if min_area <= area <= max_area and area > best_area:
                best_area = area
                best_c = c

        if best_c is not None:
            M = cv2.moments(best_c)
            if M["m00"] > 0:
                cx = float(M["m10"] / M["m00"])
                cy = float(M["m01"] / M["m00"])
                return cx, cy, True
        return 0.0, 0.0, False

    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        h, w = frame_bgr.shape[:2]
        landmarks: Dict[str, Landmark2D] = {}

        if self.mode == "hsv":
            hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
            for joint, (lower, upper) in self.color_ranges.items():
                mask = cv2.inRange(hsv, lower, upper)
                # Operação morfológica para limpar ruído
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
                mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
                cx, cy, found = self._find_centroid(mask)
                if found:
                    landmarks[joint] = Landmark2D(x=cx / w, y=cy / h, visibility=1.0)

        elif self.mode == "luma":
            # Retrorefletores: picos de intensidade luminosa em escala de cinzas
            gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
            _, thresh = cv2.threshold(gray, 220, 255, cv2.THRESH_BINARY)
            # Ordenar centróides verticalmente: Anca (mais alto), Joelho (médio), Tornozelo (mais baixo)
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            pts = []
            for c in contours:
                if 20 <= cv2.contourArea(c) <= 3000:
                    M = cv2.moments(c)
                    if M["m00"] > 0:
                        pts.append((float(M["m10"] / M["m00"]), float(M["m01"] / M["m00"])))

            pts.sort(key=lambda p: p[1])  # Ordenar por Y
            if len(pts) >= 3:
                landmarks["hip"] = Landmark2D(x=pts[0][0] / w, y=pts[0][1] / h, visibility=1.0)
                landmarks["knee"] = Landmark2D(x=pts[1][0] / w, y=pts[1][1] / h, visibility=1.0)
                landmarks["ankle"] = Landmark2D(x=pts[2][0] / w, y=pts[2][1] / h, visibility=1.0)

        # Calcular ângulo do joelho caso os 3 pontos existam
        angles = BiomechanicalAngles()
        if "hip" in landmarks and "knee" in landmarks and "ankle" in landmarks:
            angles.knee = round(calculate_safe_angle(
                Point2D(landmarks["hip"].x, landmarks["hip"].y),
                Point2D(landmarks["knee"].x, landmarks["knee"].y),
                Point2D(landmarks["ankle"].x, landmarks["ankle"].y),
            ), 1)

        val = SegmentValidation(femur_length=0.25, tibia_length=0.22, femur_valid=True, tibia_valid=True)

        return InferenceOutput(
            engine_name=self.name,
            side=self.side,
            timestamp_ms=timestamp_ms,
            landmarks=landmarks,
            angles=angles,
            validation=val,
        )


PoseEngineRegistry.register("opencv_markers", OpenCVClassicalTracker)
```

---

## 5. CRITÉRIOS DE ACEITAÇÃO
1. Teste unitário em `tests/unit/test_one_euro_filter.py` comprova que um sinal sintético com ruído gaussiano tem o desvio padrão reduzido em > 70% sem atraso de fase na transição de onda quadrada.
2. `OpenCVClassicalTracker` localiza pontos verdes/cianógenos em fotograma de teste e devolve ângulo do joelho correspondente.
