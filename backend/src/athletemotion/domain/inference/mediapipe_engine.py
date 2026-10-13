"""Motor MediaPipe Pose (Tasks API) com regras estritas de bike fit sagital.

Porque é que este motor foi reescrito: o `mediapipe` 1.1.0 **removeu** o módulo
`mp.solutions`. O motor antigo construía `mp.solutions.pose.Pose(...)` e, como a
construção falhava em silêncio, acabava a chamar o YOLO por baixo — ou seja, o
motor "mediapipe" nunca corria MediaPipe. Passou a usar a API atual
(`mp.tasks.vision.PoseLandmarker`), que também traz:

- Três tamanhos de rede (lite/full/heavy) selecionáveis sem mudar nada mais.
- Rastreio entre fotogramas (`detect_for_video`), que estabiliza a articulação
  mesmo quando o atleta passa por trás da perna ou de um reflexo.
"""
from __future__ import annotations

from collections import deque
import logging
import math
from pathlib import Path
from typing import Dict, Optional, Tuple
import cv2
import numpy as np

from src.domain.calculator import calculate_safe_angle, Point2D
from .base import BasePoseEngine, PoseEngineRegistry
from .types import InferenceOutput, Landmark2D, BiomechanicalAngles, SegmentValidation

logger = logging.getLogger("athlete_motion.mediapipe_engine")

# Nomes canónicos de juntas sagitais
SAGITTAL_JOINTS = [
    "hip", "knee", "ankle", "heel", "toe",
    "shoulder", "elbow", "wrist", "ear",
]

# Índices MediaPipe Pose (33 pontos) das juntas que interessam ao bike fit.
MP_INDEX = {
    "nose": 0,
    "left_ear": 7, "right_ear": 8,
    "left_shoulder": 11, "right_shoulder": 12,
    "left_elbow": 13, "right_elbow": 14,
    "left_wrist": 15, "right_wrist": 16,
    "left_hip": 23, "right_hip": 24,
    "left_knee": 25, "right_knee": 26,
    "left_ankle": 27, "right_ankle": 28,
    "left_heel": 29, "right_heel": 30,
    "left_foot_index": 31, "right_foot_index": 32,
}

# complexidade (compatibilidade) → ficheiro de modelo
COMPLEXITY_TO_MODEL = {
    0: "pose_landmarker_lite.task",
    1: "pose_landmarker_full.task",
    2: "pose_landmarker_heavy.task",
}

MODELS_DIR = Path(__file__).resolve().parents[3] / "models"


def resolve_landmarker_model(model_complexity: int = 2, model: Optional[str] = None) -> Optional[Path]:
    """Devolve o caminho do `.task` a usar, ou `None` se não existir nenhum."""
    if model:
        candidate = MODELS_DIR / model
        return candidate if candidate.exists() else None
    preferred = COMPLEXITY_TO_MODEL.get(int(model_complexity), COMPLEXITY_TO_MODEL[2])
    if (MODELS_DIR / preferred).exists():
        return MODELS_DIR / preferred
    # Recuo ordenado: heavy → full → lite
    for fallback in ("pose_landmarker_heavy.task", "pose_landmarker_full.task", "pose_landmarker_lite.task"):
        path = MODELS_DIR / fallback
        if path.exists():
            return path
    return None


class MediaPipePoseEngine(BasePoseEngine):
    def __init__(self, side: str = "right", model_complexity: int = 2, model: Optional[str] = None):
        super().__init__(name="mediapipe")
        self.side = side.lower()
        self.model_complexity = model_complexity
        self.model_name = model or COMPLEXITY_TO_MODEL.get(int(model_complexity), COMPLEXITY_TO_MODEL[2])
        self.pose = None
        self.is_legacy_mp = False
        self.backend = "none"
        self.last_timestamp_ms = -1

        # Histórico para validação de rigidez esquelética (janela móvel de 30 frames)
        self.femur_history: deque[float] = deque(maxlen=30)
        self.tibia_history: deque[float] = deque(maxlen=30)
        self.last_valid_landmarks: Optional[Dict[str, Landmark2D]] = None

        self._init_backend()

    # ----------------------------------------------------------------- backend
    def _init_backend(self) -> None:
        """Tenta a API Tasks (atual) e só depois a antiga `mp.solutions`."""
        try:
            import mediapipe as mp
        except Exception as err:
            logger.warning("MediaPipe indisponível: %s", err)
            return

        if hasattr(mp, "tasks"):
            model_path = resolve_landmarker_model(self.model_complexity, None)
            if model_path is not None:
                try:
                    BaseOptions = mp.tasks.BaseOptions
                    vision = mp.tasks.vision
                    options = vision.PoseLandmarkerOptions(
                        base_options=BaseOptions(model_asset_path=str(model_path)),
                        running_mode=vision.RunningMode.VIDEO,
                        num_poses=1,
                        min_pose_detection_confidence=0.5,
                        min_pose_presence_confidence=0.5,
                        min_tracking_confidence=0.5,
                        output_segmentation_masks=False,
                    )
                    self.pose = vision.PoseLandmarker.create_from_options(options)
                    self.backend = "tasks"
                    logger.info("MediaPipe Tasks PoseLandmarker criado (%s).", model_path.name)
                    return
                except Exception as err:
                    logger.warning("Falha a criar PoseLandmarker (%s): %s", model_path, err)

        # Compatibilidade com instalações antigas
        if hasattr(mp, "solutions") and hasattr(mp.solutions, "pose"):
            try:
                self.mp_pose = mp.solutions.pose
                self.pose = self.mp_pose.Pose(
                    static_image_mode=False,
                    model_complexity=self.model_complexity,
                    smooth_landmarks=True,
                    enable_segmentation=False,
                    min_detection_confidence=0.7,
                    min_tracking_confidence=0.7,
                )
                self.is_legacy_mp = True
                self.backend = "legacy"
                logger.info("MediaPipe Solutions Pose (legado) com complexidade %d.", self.model_complexity)
            except Exception as err:
                logger.warning("MediaPipe legado falhou: %s", err)

    @property
    def is_ready(self) -> bool:
        return self.pose is not None

    # ---------------------------------------------------------------- interface
    def set_side(self, side: str) -> None:
        self.side = side.lower()
        self.reset()

    def reset(self) -> None:
        self.femur_history.clear()
        self.tibia_history.clear()
        self.last_valid_landmarks = None
        self.last_timestamp_ms = -1

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

            femur_diff = abs(femur - med_femur) / med_femur if med_femur > 0 else 0.0
            tibia_diff = abs(tibia - med_tibia) / med_tibia if med_tibia > 0 else 0.0
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

    # ------------------------------------------------------------------ deteção
    def _detect_tasks(
        self, frame_bgr: np.ndarray, timestamp_ms: int
    ) -> Optional[Dict[str, Landmark2D]]:
        """Executa o landmarker (Tasks) e devolve os 33 pontos mapeados por nome.

        O `detect_for_video` exige timestamps ESTRITAMENTE crescentes; quando o
        cliente reenvia o mesmo instante (seeks, marcha-atrás) o valor é avançado
        em 1 ms em vez de provocar uma exceção.
        """
        import mediapipe as mp

        ts = int(timestamp_ms)
        if ts <= self.last_timestamp_ms:
            ts = self.last_timestamp_ms + 1
        self.last_timestamp_ms = ts

        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(frame_rgb))
        result = self.pose.detect_for_video(mp_image, ts)

        if not result or not result.pose_landmarks:
            return None

        lm = result.pose_landmarks[0]
        raw: Dict[str, Landmark2D] = {}
        for name, index in MP_INDEX.items():
            if index >= len(lm):
                continue
            point = lm[index]
            raw[name] = Landmark2D(
                x=float(np.clip(point.x, 0.0, 1.0)),
                y=float(np.clip(point.y, 0.0, 1.0)),
                z=float(point.z),
                visibility=float(np.clip(point.visibility, 0.0, 1.0)),
            )
        return raw

    def _detect_legacy(
        self, frame_bgr: np.ndarray, timestamp_ms: int
    ) -> Optional[Dict[str, Landmark2D]]:
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        results = self.pose.process(frame_rgb)
        if not results.pose_landmarks:
            return None
        lm = results.pose_landmarks.landmark
        raw: Dict[str, Landmark2D] = {}
        for name, index in MP_INDEX.items():
            if index >= len(lm):
                continue
            point = lm[index]
            raw[name] = Landmark2D(
                x=float(np.clip(point.x, 0.0, 1.0)),
                y=float(np.clip(point.y, 0.0, 1.0)),
                z=float(point.z),
                visibility=float(np.clip(point.visibility, 0.0, 1.0)),
            )
        return raw

    def _apply_side(self, raw: Dict[str, Landmark2D]) -> Dict[str, Landmark2D]:
        """Escolhe o lado observado e estima calcâneo/biqueira quando faltam.

        A estimativa do pé usa o tornozelo e a direção do movimento; sem ela o
        ângulo do tornozelo e o recuo do travessão não teriam ponto de referência.
        """
        side = self.side if self.side in ("left", "right") else "right"
        other = "left" if side == "right" else "right"

        resolved: Dict[str, Landmark2D] = {}
        for part, key in (
            ("hip", "hip"), ("knee", "knee"), ("ankle", "ankle"),
            ("shoulder", "shoulder"), ("elbow", "elbow"), ("wrist", "wrist"), ("ear", "ear"),
        ):
            primary = raw.get(f"{side}_{key}")
            secondary = raw.get(f"{other}_{key}")
            if primary is None:
                primary = secondary
            elif secondary is not None and primary.visibility < 0.20 and secondary.visibility > 0.50:
                primary = secondary
            if primary is not None:
                resolved[part] = primary

        # Calcâneo / biqueira: usa o do próprio lado se existir; senão estima do tornozelo.
        anchor = resolved.get("ankle")
        heel = raw.get(f"{side}_heel")
        toe = raw.get(f"{side}_foot_index")
        if anchor is not None:
            facing_right = True
            if "left_shoulder" in raw and "left_hip" in raw:
                facing_right = raw["left_shoulder"].x >= raw["left_hip"].x
            if heel is None:
                offset = -0.018 if facing_right else 0.018
                heel = Landmark2D(
                    x=float(np.clip(anchor.x + offset, 0.0, 1.0)),
                    y=float(np.clip(anchor.y + 0.012, 0.0, 1.0)),
                    visibility=float(anchor.visibility * 0.9),
                )
            if toe is None:
                offset = 0.035 if facing_right else -0.035
                toe = Landmark2D(
                    x=float(np.clip(anchor.x + offset, 0.0, 1.0)),
                    y=float(np.clip(anchor.y + 0.018, 0.0, 1.0)),
                    visibility=float(anchor.visibility * 0.9),
                )
        if heel is not None:
            resolved["heel"] = heel
        if toe is not None:
            resolved["toe"] = toe
        return resolved

    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        if not self.is_ready:
            if not hasattr(self, "_fallback_yolo") or self._fallback_yolo is None:
                from .yolo_engine import YOLO11PoseEngine
                self._fallback_yolo = YOLO11PoseEngine(side=self.side)
            self._fallback_yolo.set_side(self.side)
            res = self._fallback_yolo.process_frame(frame_bgr, timestamp_ms)
            res.engine_name = self.name
            return res

        try:
            raw = self._detect_tasks(frame_bgr, timestamp_ms) if self.backend == "tasks" \
                else self._detect_legacy(frame_bgr, timestamp_ms)
        except Exception as err:
            logger.warning("Falha na deteção MediaPipe: %s", err)
            raw = None

        if not raw:
            return InferenceOutput(
                engine_name=self.name,
                side=self.side,
                timestamp_ms=timestamp_ms,
                landmarks={},
                angles=BiomechanicalAngles(),
                validation=SegmentValidation(femur_length=0.0, tibia_length=0.0, femur_valid=False, tibia_valid=False),
            )

        landmarks = self._apply_side(raw)

        # Validação de integridade de segmentos rígidos
        if "hip" in landmarks and "knee" in landmarks and "ankle" in landmarks:
            val, is_valid = self._validate_rigid_segments(
                landmarks["hip"], landmarks["knee"], landmarks["ankle"]
            )
            if not is_valid and self.last_valid_landmarks is not None:
                # Interpolar suavemente com o último frame estável se houver salto anómalo
                for k in ("hip", "knee", "ankle"):
                    if k in self.last_valid_landmarks:
                        landmarks[k].x = landmarks[k].x * 0.3 + self.last_valid_landmarks[k].x * 0.7
                        landmarks[k].y = landmarks[k].y * 0.3 + self.last_valid_landmarks[k].y * 0.7
            else:
                self.last_valid_landmarks = landmarks
        else:
            val = SegmentValidation(
                femur_length=0.0, tibia_length=0.0, femur_valid=False, tibia_valid=False
            )

        # Cálculo Angular Biomecânico
        angles = BiomechanicalAngles()
        if "hip" in landmarks and "knee" in landmarks and "ankle" in landmarks:
            angles.knee = round(calculate_safe_angle(
                Point2D(landmarks["hip"].x, landmarks["hip"].y),
                Point2D(landmarks["knee"].x, landmarks["knee"].y),
                Point2D(landmarks["ankle"].x, landmarks["ankle"].y),
            ), 1)

        if "shoulder" in landmarks and "hip" in landmarks:
            dx = abs(landmarks["shoulder"].x - landmarks["hip"].x)
            dy = landmarks["hip"].y - landmarks["shoulder"].y
            angles.torso = round(math.degrees(math.atan2(dy, dx)), 1) if dx > 0 else 90.0

        if "shoulder" in landmarks and "elbow" in landmarks and "wrist" in landmarks:
            angles.arm_elbow = round(calculate_safe_angle(
                Point2D(landmarks["shoulder"].x, landmarks["shoulder"].y),
                Point2D(landmarks["elbow"].x, landmarks["elbow"].y),
                Point2D(landmarks["wrist"].x, landmarks["wrist"].y),
            ), 1)

        if "knee" in landmarks and "ankle" in landmarks and "toe" in landmarks:
            angles.ankle = round(calculate_safe_angle(
                Point2D(landmarks["knee"].x, landmarks["knee"].y),
                Point2D(landmarks["ankle"].x, landmarks["ankle"].y),
                Point2D(landmarks["toe"].x, landmarks["toe"].y),
            ), 1)

        return InferenceOutput(
            engine_name=self.name,
            side=self.side,
            timestamp_ms=timestamp_ms,
            landmarks=landmarks,
            angles=angles,
            validation=val,
            is_bdc=False,
            is_tdc=False,
            clock_position="N/A",
        )


# Registar no Factory
PoseEngineRegistry.register("mediapipe", MediaPipePoseEngine)
