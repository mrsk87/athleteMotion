"""Motor de inferência RTMPose (MMPose) via DirectML — top-down com rastreio.

O RTMPose é um modelo **top-down**: não procura pessoas. Recebe um recorte com a
pessoa já enquadrada e devolve as articulações com grande precisão. O motor antigo
tratava-o como bottom-up e enviava-lhe o fotograma inteiro — com o `simplify` e o
tamanho errados o resultado era ruído. Aqui:

1. Um detetor leve (YOLO11-pose) encontra a caixa da pessoa.
2. O recorte é enviado ao RTMPose, que devolve SimCC (duas distribuições de
   probabilidade, uma por eixo) ou keypoints diretos.
3. Os pontos são re-mapeados para o fotograma original.

Sem `models/rtmpose-m.onnx` instalado o motor corre o detetor por baixo e mantém
o nome, para o frontend continuar a funcionar.
"""
from __future__ import annotations

import logging
import math
from collections.abc import Sequence
from pathlib import Path

import numpy as np
import onnxruntime as ort
from athletemotion.config.paths import MODELS_DIR
from athletemotion.domain.biomechanics.angles import compute_joint_angles
from athletemotion.domain.inference.foot_estimation import (
    determine_facing_direction,
    estimate_foot,
)
from athletemotion.domain.inference.stabilizer import (
    StabilizerState,
    stabilize,
)
from athletemotion.infrastructure.hardware import hardware_manager

from .base import BasePoseEngine, PoseEngineRegistry
from .onnx_utils import preprocess_roi_for_onnx
from .person_tracker import PersonTracker, box_to_pixels
from .types import InferenceOutput, Landmark2D

logger = logging.getLogger("athlete_motion.rtmpose_engine")

COCO_KP_NAMES = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]

DEFAULT_RTMPOSE_PATH = "models/rtmpose-m.onnx"
# RTMPose usa SimCC com fator de divisão 2.0 (a coordenada é o argmax/2).
SIMCC_SPLIT_RATIO = 2.0


def decode_simcc(axis_distribution: np.ndarray, input_length: int, split_ratio: float = SIMCC_SPLIT_RATIO) -> np.ndarray:
    """Converte a distribuição SimCC de um eixo em coordenadas normalizadas [0,1].

    `axis_distribution` tem forma [num_keypoints, bins]. Devolve [num_keypoints].
    """
    if axis_distribution.ndim != 2 or axis_distribution.shape[1] == 0:
        return np.zeros(axis_distribution.shape[0] if axis_distribution.ndim else 0, dtype=np.float32)
    indices = np.argmax(axis_distribution, axis=1).astype(np.float32)
    coords = indices / max(1e-6, split_ratio)
    return np.clip(coords / max(1, input_length), 0.0, 1.0)


class RTMPoseEngine(BasePoseEngine):
    """Motor RTMPose top-down com aceleração DirectML e deteção de apoio."""

    def __init__(
        self,
        model_path: str = DEFAULT_RTMPOSE_PATH,
        side: str = "right",
        use_gpu: bool = True,
        tracker: PersonTracker | None = None,
    ):
        super().__init__(name="rtmpose")
        self.side = side.lower()
        self.use_gpu = use_gpu
        p = Path(model_path)
        if not p.exists() and (MODELS_DIR / p.name).exists():
            p = MODELS_DIR / p.name
        self.model_path = p
        self.session: ort.InferenceSession | None = None
        self.input_name: str | None = None
        self.input_size = 256
        self.output_names: list[str] = []
        self.warmup_ms = 0.0

        # Rastreio partilhado com o detetor de apoio (a caixa vem do YOLO).
        self.tracker = tracker or PersonTracker(redetect_interval=12)
        self.stabilizer_state = StabilizerState()
        self._detector = None

        if not self.model_path.exists():
            logger.warning("Ficheiro RTMPose %s não encontrado. Usando fallback YOLO.", self.model_path)
            return

        session_opts = hardware_manager.create_session_options(gpu=use_gpu)
        providers = hardware_manager.get_execution_providers(gpu=use_gpu)
        try:
            self.session = ort.InferenceSession(str(self.model_path), sess_options=session_opts, providers=providers)
            self.input_name = self.session.get_inputs()[0].name
            shape = self.session.get_inputs()[0].shape
            dims = [d for d in shape if isinstance(d, int) and d > 0]
            self.input_size = int(dims[-1]) if dims else 256
            self.output_names = [o.name for o in self.session.get_outputs()]
            logger.info("RTMPose ONNX carregado (entrada %dpx, saídas: %s).", self.input_size, self.output_names)
            self.warmup_ms = hardware_manager.warmup_session(self.session, runs=1, input_name=self.input_name)
        except Exception as e:
            logger.error("Falha ao inicializar sessão ONNX para RTMPose: %s", e)
            self.session = None
            self.input_name = None

    # ------------------------------------------------------------------ interface
    def set_side(self, side: str) -> None:
        self.side = side.lower()
        self.reset()
        if self._detector is not None:
            self._detector.set_side(self.side)

    def reset(self) -> None:
        self.tracker.reset()
        self.stabilizer_state = StabilizerState()

    @property
    def is_ready(self) -> bool:
        return self.session is not None and self.input_name is not None

    def _fallback(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        """Sem modelo RTMPose, o detetor YOLO responde com precisão razoável."""
        if self._detector is None:
            from .yolo_engine import YOLO11PoseEngine

            self._detector = YOLO11PoseEngine(side=self.side, use_gpu=self.use_gpu)
        self._detector.set_side(self.side)
        result = self._detector.process_frame(frame_bgr, timestamp_ms)
        result.engine_name = self.name
        return result

    # ---------------------------------------------------------------- decodificação
    def _parse_outputs(
        self, outputs: Sequence[np.ndarray], rect, full_w: int, full_h: int
    ) -> dict[str, Landmark2D]:
        """Aceita SimCC (2 saídas) ou keypoints diretos [1, N, 3]."""
        landmarks_raw: dict[str, Landmark2D] = {}

        xs: np.ndarray | None = None
        ys: np.ndarray | None = None
        scores: np.ndarray | None = None

        if len(outputs) >= 2 and np.squeeze(outputs[0]).ndim == 2 and np.squeeze(outputs[1]).ndim == 2:
            # SimCC: por convenção (x, y) — se as formas indicarem o contrário, corrige-se.
            first = np.squeeze(outputs[0])
            second = np.squeeze(outputs[1])
            if first.shape[1] > second.shape[1]:
                xs, ys = decode_simcc(first, self.input_size), decode_simcc(second, self.input_size)
            else:
                ys, xs = decode_simcc(first, self.input_size), decode_simcc(second, self.input_size)
            scores = np.ones(len(xs), dtype=np.float32) * 0.85
        else:
            preds = np.squeeze(outputs[0])
            if preds.ndim == 2 and preds.shape[0] >= 17:
                xs = preds[:17, 0]
                ys = preds[:17, 1]
                scores = preds[:17, 2] if preds.shape[1] >= 3 else np.ones(17, dtype=np.float32)
            elif preds.ndim == 3 and preds.shape[0] == 1 and preds.shape[1] >= 17:
                xs = preds[0, :17, 0]
                ys = preds[0, :17, 1]
                scores = preds[0, :17, 2] if preds.shape[2] >= 3 else np.ones(17, dtype=np.float32)

        if xs is None or ys is None:
            return landmarks_raw

        off_x = float(rect[0]) if rect else 0.0
        off_y = float(rect[1]) if rect else 0.0
        rect_w = float(rect[2]) if rect else float(full_w)
        rect_h = float(rect[3]) if rect else float(full_h)

        side_prefix = "right" if self.side == "right" else "left"
        # Nome no esqueleto canónico ← nome no COCO
        joint_map = {
            "hip": f"{side_prefix}_hip",
            "knee": f"{side_prefix}_knee",
            "ankle": f"{side_prefix}_ankle",
            "shoulder": f"{side_prefix}_shoulder",
            "elbow": f"{side_prefix}_elbow",
            "wrist": f"{side_prefix}_wrist",
            "ear": f"{side_prefix}_ear",
        }
        wanted = {coco: joint for joint, coco in joint_map.items()}

        for i, coco_name in enumerate(COCO_KP_NAMES):
            joint = wanted.get(coco_name)
            if joint is None or i >= len(xs):
                continue
            # SimCC/keypoint direto → píxeis dentro do recorte → píxeis no fotograma inteiro.
            px = float(np.clip((float(xs[i]) * rect_w + off_x) / max(1, full_w), 0.0, 1.0))
            py = float(np.clip((float(ys[i]) * rect_h + off_y) / max(1, full_h), 0.0, 1.0))
            kconf = float(scores[i]) if scores is not None and i < len(scores) else 0.8
            landmarks_raw[joint] = Landmark2D(x=px, y=py, visibility=kconf)

        # Estimativa anatómica de pés calibrada pela tíbia em píxeis
        ankle = landmarks_raw.get(f"{side_prefix}_ankle")
        knee = landmarks_raw.get(f"{side_prefix}_knee")
        if ankle is not None:
            facing_right = determine_facing_direction(landmarks_raw, side=self.side)
            tibia_px = 0.0
            if knee is not None:
                tibia_px = math.hypot((knee.x - ankle.x) * float(full_w), (knee.y - ankle.y) * float(full_h))
            foot = estimate_foot(ankle, knee, facing_right, tibia_px, full_w, full_h)
            landmarks_raw["heel"] = foot["heel"]
            landmarks_raw["toe"] = foot["toe"]
            landmarks_raw[f"{side_prefix}_heel"] = foot["heel"]
            landmarks_raw[f"{side_prefix}_toe"] = foot["toe"]

        # Garantir aliases canónicos sem prefixo para o analisador biomecânico
        for part in ("hip", "knee", "ankle", "heel", "toe", "shoulder", "elbow", "wrist", "ear"):
            prefixed = f"{side_prefix}_{part}"
            if prefixed in landmarks_raw and part not in landmarks_raw:
                landmarks_raw[part] = landmarks_raw[prefixed]

        return landmarks_raw

    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        h_orig, w_orig = frame_bgr.shape[:2]

        if not self.is_ready:
            return self._fallback(frame_bgr, timestamp_ms)

        # 1. Onde está a pessoa? Usa a caixa em memória ou pede uma deteção.
        rect = None
        if self.tracker.has_box and not self.tracker.needs_full_frame():
            roi = self.tracker.roi_box()
            if roi is not None:
                rect = box_to_pixels(roi, w_orig, h_orig)
                self.tracker.note_roi_reuse()
        else:
            if self._detector is None:
                from .yolo_engine import YOLO11PoseEngine

                self._detector = YOLO11PoseEngine(side=self.side, use_gpu=self.use_gpu)
            detection = self._detector.process_frame(frame_bgr, timestamp_ms)
            if detection.landmarks:
                xs = [lm.x for lm in detection.landmarks.values()]
                ys = [lm.y for lm in detection.landmarks.values()]
                self.tracker.observe((min(xs), min(ys), max(xs), max(ys)), 1.0)
                roi = self.tracker.roi_box()
                if roi is not None:
                    rect = box_to_pixels(roi, w_orig, h_orig)

        if rect is None:
            self.tracker.tick(pose_found=False)
            return self._fallback(frame_bgr, timestamp_ms)

        # 2. Recorte → entrada fixa da rede
        input_tensor, ratio, (pad_w, pad_h), used_rect = preprocess_roi_for_onnx(
            frame_bgr, self.input_size, rect
        )

        outputs = self.session.run(None, {self.input_name: input_tensor})
        landmarks_raw = self._parse_outputs(outputs, used_rect, w_orig, h_orig)

        if not landmarks_raw:
            self.tracker.tick(pose_found=False)
            return self._fallback(frame_bgr, timestamp_ms)

        self.tracker.tick(pose_found=True)

        # Validação/estabilização de segmentos e ângulos em píxeis
        landmarks_raw, self.stabilizer_state, val = stabilize(
            landmarks_raw, self.stabilizer_state, w_orig, h_orig
        )
        angles = compute_joint_angles(landmarks_raw, w_orig, h_orig)

        return InferenceOutput(
            engine_name=self.name,
            side=self.side,
            timestamp_ms=timestamp_ms,
            landmarks=landmarks_raw,
            angles=angles,
            validation=val,
        )


PoseEngineRegistry.register("rtmpose", RTMPoseEngine)
