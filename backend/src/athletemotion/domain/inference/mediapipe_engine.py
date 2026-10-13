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

import logging
import math
from collections import deque
from pathlib import Path

import cv2
import numpy as np
from athletemotion.domain.biomechanics.angles import compute_joint_angles
from athletemotion.domain.inference.foot_estimation import (
    determine_facing_direction,
    estimate_foot,
)
from athletemotion.domain.inference.stabilizer import (
    StabilizerState,
    stabilize,
)

from .base import BasePoseEngine, PoseEngineRegistry
from .types import BiomechanicalAngles, InferenceOutput, Landmark2D, SegmentValidation

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

from athletemotion.config.paths import MODELS_DIR


def resolve_landmarker_model(model_complexity: int = 2, model: str | None = None) -> Path | None:
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
    def __init__(self, side: str = "right", model_complexity: int = 2, model: str | None = None):
        super().__init__(name="mediapipe")
        self.side = side.lower()
        self.model_complexity = model_complexity
        self.model_name = model or COMPLEXITY_TO_MODEL.get(int(model_complexity), COMPLEXITY_TO_MODEL[2])
        self.pose = None
        self.is_legacy_mp = False
        self.backend = "none"
        self.last_timestamp_ms = -1

        # Estado imutável do estabilizador de segmentos esqueléticos
        self.stabilizer_state = StabilizerState()

        self._init_backend()

    @property
    def femur_history(self) -> deque[float]:
        return deque(self.stabilizer_state.femur_history, maxlen=30)

    @property
    def tibia_history(self) -> deque[float]:
        return deque(self.stabilizer_state.tibia_history, maxlen=30)

    @property
    def last_valid_landmarks(self) -> dict[str, Landmark2D] | None:
        return self.stabilizer_state.last_valid_landmarks

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
        self.stabilizer_state = StabilizerState()
        self.last_timestamp_ms = -1

    def _validate_rigid_segments(
        self, hip: Landmark2D, knee: Landmark2D, ankle: Landmark2D, w: int = 1920, h: int = 1080
    ) -> tuple[SegmentValidation, bool]:
        """Valida a consistência biomecânica dos segmentos do membro inferior."""
        lms = {"hip": hip, "knee": knee, "ankle": ankle}
        _, self.stabilizer_state, val = stabilize(lms, self.stabilizer_state, w, h)
        return val, (val.femur_valid and val.tibia_valid)

    # ------------------------------------------------------------------ deteção
    def _detect_tasks(
        self, frame_bgr: np.ndarray, timestamp_ms: int
    ) -> dict[str, Landmark2D] | None:
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
        raw: dict[str, Landmark2D] = {}
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
    ) -> dict[str, Landmark2D] | None:
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        results = self.pose.process(frame_rgb)
        if not results.pose_landmarks:
            return None
        lm = results.pose_landmarks.landmark
        raw: dict[str, Landmark2D] = {}
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

    def _apply_side(
        self, raw: dict[str, Landmark2D], w: int = 1920, h: int = 1080
    ) -> dict[str, Landmark2D]:
        """Escolhe o lado observado e estima calcâneo/biqueira quando faltam ou com baixa confiança.

        A estimativa do pé escala rigorosamente com o comprimento da tíbia em píxeis
        e marca os pontos como estimados (estimated=True).
        """
        side = self.side if self.side in ("left", "right") else "right"
        other = "left" if side == "right" else "right"

        resolved: dict[str, Landmark2D] = {}
        for part, key in (
            ("hip", "hip"), ("knee", "knee"), ("ankle", "ankle"),
            ("shoulder", "shoulder"), ("elbow", "elbow"), ("wrist", "wrist"), ("ear", "ear"),
        ):
            primary = raw.get(f"{side}_{key}")
            secondary = raw.get(f"{other}_{key}")
            if primary is None or secondary is not None and primary.visibility < 0.20 and secondary.visibility > 0.50:
                primary = secondary
            if primary is not None:
                resolved[part] = primary

        # Calcâneo / biqueira: se existirem com visibilidade >= 0.20, usa-os; senão estima da tíbia
        anchor = resolved.get("ankle")
        heel = raw.get(f"{side}_heel")
        toe = raw.get(f"{side}_foot_index")

        has_valid_heel = heel is not None and heel.visibility >= 0.20
        has_valid_toe = toe is not None and toe.visibility >= 0.20

        if has_valid_heel and has_valid_toe and heel is not None and toe is not None:
            resolved["heel"] = heel
            resolved["toe"] = toe
        elif anchor is not None:
            knee = resolved.get("knee")
            facing_right = determine_facing_direction(raw, side=side)
            tibia_px = 0.0
            if knee is not None:
                tibia_px = math.hypot((knee.x - anchor.x) * float(w), (knee.y - anchor.y) * float(h))
            estimated_foot = estimate_foot(anchor, knee, facing_right, tibia_px, w, h)
            resolved["heel"] = heel if (has_valid_heel and heel is not None) else estimated_foot["heel"]
            resolved["toe"] = toe if (has_valid_toe and toe is not None) else estimated_foot["toe"]

        return resolved

    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        h_orig, w_orig = frame_bgr.shape[:2]

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

        landmarks = self._apply_side(raw, w_orig, h_orig)

        # Validação e estabilização de integridade de segmentos rígidos (função pura em píxeis)
        landmarks, self.stabilizer_state, val = stabilize(
            landmarks, self.stabilizer_state, w_orig, h_orig
        )

        # Cálculo Angular Biomecânico em píxeis (imune a distorções de proporção de ecrã)
        angles = compute_joint_angles(landmarks, w_orig, h_orig)

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
