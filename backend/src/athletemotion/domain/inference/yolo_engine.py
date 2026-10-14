"""Motor de inferência YOLO11-Pose / YOLOv8-Pose acelerado via DirectML.

Três mudanças que tornam o motor "instantâneo" a acompanhar a pedalada:

1. **Tamanho de entrada lido do modelo.** O motor já não assume 640×640; lê a forma
   estática da sessão ONNX. Assim um modelo exportado a 320×320 corre a ~1/4 do
   custo sem alterar uma linha de código.
2. **Rastreio por ROI.** A deteção em fotograma inteiro só corre quando é precisa
   (ver `PersonTracker`); nos restantes fotogramas a rede vê um recorte pequeno à
   volta da pessoa, onde ela aparece grande — mais preciso E mais barato.
3. **Aquecimento na construção.** A primeira passagem do DirectML (compilação do
   grafo) é paga no arranque, não no primeiro fotograma do atleta.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Sequence
from pathlib import Path

import cv2
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
from athletemotion.domain.inference.target_selector import DetectionCandidate, TargetSelector
from athletemotion.infrastructure.hardware import hardware_manager

from .base import BasePoseEngine, PoseEngineRegistry
from .person_tracker import PersonTracker, box_to_pixels
from .preprocess_fast import fast_preprocess_roi
from .types import BiomechanicalAngles, InferenceOutput, Landmark2D, SegmentValidation

logger = logging.getLogger("athlete_motion.yolo_engine")

# Mapeamento dos 17 Keypoints COCO para o esqueleto sagital do ciclista
COCO_KP_NAMES = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
]

# Ordem de preferência quando há mais do que um modelo exportado.
DEFAULT_MODEL_CANDIDATES = (
    "models/yolo11n-pose.onnx",
    "yolo11n-pose.onnx",
)
FAST_MODEL_CANDIDATES = (
    "models/yolo11n-pose-320.onnx",
    "models/yolo11n-pose-416.onnx",
)


def _static_input_size(session: ort.InferenceSession) -> int | None:
    """Lê o lado quadrado estático da entrada da sessão (ou `None` se dinâmico)."""
    try:
        shape = session.get_inputs()[0].shape
    except Exception:
        return None
    dims = [d for d in shape if isinstance(d, int) and d > 0]
    if not dims:
        return None
    return int(dims[-1])


class YOLO11PoseEngine(BasePoseEngine):
    def __init__(
        self,
        model_path: str | None = None,
        side: str = "right",
        use_gpu: bool = True,
        tracking: bool = True,
        redetect_interval: int = 15,
        min_confidence: float = 0.25,
        warmup: bool = True,
        prefer_fast_model: bool = False,
        name: str | None = None,
    ):
        # O nome distingue a variante para a telemetria: o painel tem de saber se os
        # números que está a ver vêm da rede a 640px ou da rede rápida a 320px.
        engine_name = name or ("yolo11_pose" if use_gpu else "yolo11_pose_cpu")
        super().__init__(name=engine_name)
        self.side = side.lower()
        self.use_gpu = use_gpu
        self.tracking = bool(tracking)
        self.min_confidence = float(min_confidence)
        self.prefer_fast_model = bool(prefer_fast_model)

        self.license = "AGPL-3.0"
        self.license_risk = True
        self.model_path = self._resolve_model_path(model_path, prefer_fast_model)
        self.session: ort.InferenceSession | None = None
        self.input_name: str | None = None
        self.input_size = 640
        self.warmup_ms = 0.0

        self.tracker = PersonTracker(redetect_interval=redetect_interval)
        self.target_selector = TargetSelector()
        self.stabilizer_state = StabilizerState()

        if self.model_path is None or not self.model_path.exists():
            logger.warning(
                "Modelo YOLO-Pose não encontrado (%s). Usando fallback seguro.", model_path
            )
            return

        session_opts = hardware_manager.create_session_options(gpu=use_gpu)
        providers = hardware_manager.get_execution_providers(gpu=use_gpu)
        try:
            self.session = ort.InferenceSession(
                str(self.model_path),
                sess_options=session_opts,
                providers=providers,
            )
            self.input_name = self.session.get_inputs()[0].name
            self.input_size = _static_input_size(self.session) or 640
            logger.info(
                "YOLO11 ONNX carregado (%s, entrada %dpx): %s",
                "DirectML GPU" if use_gpu else "CPU AVX2",
                self.input_size,
                self.model_path,
            )
            if warmup:
                self.warmup_ms = hardware_manager.warmup_session(
                    self.session, runs=1, input_name=self.input_name
                )
        except Exception as e:
            logger.error("Falha ao inicializar sessão ONNX para YOLO11: %s", e)
            self.session = None
            self.input_name = None

    @staticmethod
    def _resolve_model_path(explicit: str | None, prefer_fast: bool) -> Path | None:
        if explicit:
            return Path(explicit)
        candidates = (
            (FAST_MODEL_CANDIDATES + DEFAULT_MODEL_CANDIDATES)
            if prefer_fast
            else DEFAULT_MODEL_CANDIDATES
        )
        for candidate in candidates:
            p = Path(candidate)
            if p.exists():
                return p
            model_candidate = MODELS_DIR / p.name
            if model_candidate.exists():
                return model_candidate
        return MODELS_DIR / Path(DEFAULT_MODEL_CANDIDATES[0]).name

    # ------------------------------------------------------------------ interface
    def set_side(self, side: str) -> None:
        self.side = side.lower()
        self.reset()

    def reset(self) -> None:
        self.tracker.reset()
        self.target_selector.reset()
        self.stabilizer_state = StabilizerState()

    @property
    def is_ready(self) -> bool:
        return self.session is not None and self.input_name is not None

    # -------------------------------------------------------------------- decode
    def _empty_output(self, timestamp_ms: int) -> InferenceOutput:
        return InferenceOutput(
            engine_name=self.name,
            side=self.side,
            timestamp_ms=timestamp_ms,
            landmarks={},
            angles=BiomechanicalAngles(),
            validation=SegmentValidation(
                femur_length=0, tibia_length=0, femur_valid=False, tibia_valid=False
            ),
        )

    def _to_normalized_box(
        self,
        pred_row: np.ndarray,
        ratio: float,
        pad: tuple[float, float],
        rect: Sequence[int] | None,
        full_w: int,
        full_h: int,
    ) -> tuple[float, float, float, float]:
        """Converte caixa delimitadora (cx, cy, w, h) para caixa normalizada (x1, y1, x2, y2)."""
        pad_w, pad_h = pad
        cx, cy, bw, bh = (float(v) for v in pred_row[0:4])
        crop_cx = (cx - pad_w) / ratio if ratio > 0 else 0.0
        crop_cy = (cy - pad_h) / ratio if ratio > 0 else 0.0
        crop_w = bw / ratio if ratio > 0 else 0.0
        crop_h = bh / ratio if ratio > 0 else 0.0

        off_x = float(rect[0]) if rect else 0.0
        off_y = float(rect[1]) if rect else 0.0
        x1 = (crop_cx - crop_w / 2.0 + off_x) / max(1, full_w)
        y1 = (crop_cy - crop_h / 2.0 + off_y) / max(1, full_h)
        x2 = (crop_cx + crop_w / 2.0 + off_x) / max(1, full_w)
        y2 = (crop_cy + crop_h / 2.0 + off_y) / max(1, full_h)
        return (
            float(np.clip(x1, 0.0, 1.0)),
            float(np.clip(y1, 0.0, 1.0)),
            float(np.clip(x2, 0.0, 1.0)),
            float(np.clip(y2, 0.0, 1.0)),
        )

    def _decode_keypoints(
        self,
        best: np.ndarray,
        ratio: float,
        pad: tuple[float, float],
        rect,
        full_w: int,
        full_h: int,
    ) -> dict[str, Landmark2D]:
        pad_w, pad_h = pad
        off_x = float(rect[0]) if rect else 0.0
        off_y = float(rect[1]) if rect else 0.0
        kpts_raw = best[5:]

        # Otimização sénior (R14): transformação vetorial direta em NumPy
        kpts = kpts_raw.reshape(-1, 3).copy()
        if ratio > 0:
            kpts[:, 0] = (kpts[:, 0] - pad_w) / ratio + off_x
            kpts[:, 1] = (kpts[:, 1] - pad_h) / ratio + off_y
        kpts[:, 0] = np.clip(kpts[:, 0] / max(1, full_w), 0.0, 1.0)
        kpts[:, 1] = np.clip(kpts[:, 1] / max(1, full_h), 0.0, 1.0)
        kpts[:, 2] = np.clip(kpts[:, 2], 0.0, 1.0)

        landmarks_raw: dict[str, Landmark2D] = {
            name: Landmark2D(
                x=float(kpts[i, 0]),
                y=float(kpts[i, 1]),
                visibility=float(kpts[i, 2]),
            )
            for i, name in enumerate(COCO_KP_NAMES)
        }
        return landmarks_raw

    def _add_foot_estimates(
        self, landmarks_raw: dict[str, Landmark2D], full_w: int, full_h: int
    ) -> None:
        """Calcâneo e biqueira estimados proporcionalmente à tíbia em píxeis.

        Garante invariância à distância da câmara e atribui explicitamente estimated=True.
        """
        w = float(max(1, full_w))
        h = float(max(1, full_h))

        for prefix in ("left", "right"):
            ankle = landmarks_raw.get(f"{prefix}_ankle")
            if ankle is None:
                continue
            knee = landmarks_raw.get(f"{prefix}_knee")
            facing_right = determine_facing_direction(landmarks_raw, side=prefix)
            tibia_px = 0.0
            if knee is not None:
                tibia_px = math.hypot((knee.x - ankle.x) * w, (knee.y - ankle.y) * h)

            foot = estimate_foot(ankle, knee, facing_right, tibia_px, full_w, full_h)
            landmarks_raw[f"{prefix}_heel"] = foot["heel"]
            landmarks_raw[f"{prefix}_toe"] = foot["toe"]

    def _apply_side_aliases(self, landmarks_raw: dict[str, Landmark2D]) -> None:
        side_prefix = "right" if self.side == "right" else "left"
        other_prefix = "left" if self.side == "right" else "right"

        for part in ["hip", "knee", "ankle", "heel", "toe", "shoulder", "elbow", "wrist", "ear"]:
            target_key = f"{side_prefix}_{part}"
            if target_key not in landmarks_raw:
                continue
            active_lm = landmarks_raw[target_key]
            other_key = f"{other_prefix}_{part}"
            # Apoio adaptativo se o lado ativo estiver ocluso (<0.20) mas o contralateral visível (>0.50)
            if (
                active_lm.visibility < 0.20
                and other_key in landmarks_raw
                and landmarks_raw[other_key].visibility > 0.50
            ):
                landmarks_raw[part] = landmarks_raw[other_key]
            else:
                landmarks_raw[part] = active_lm

    # ------------------------------------------------------------- biomecânica
    def _compute_angles(
        self, landmarks_raw: dict[str, Landmark2D], full_w: int, full_h: int
    ) -> tuple[dict[str, Landmark2D], BiomechanicalAngles, SegmentValidation]:
        """Estabiliza os segmentos anatómicos e calcula ângulos em píxeis."""
        stabilized_lms, self.stabilizer_state, val = stabilize(
            landmarks_raw, self.stabilizer_state, full_w, full_h
        )
        angles = compute_joint_angles(stabilized_lms, full_w, full_h)
        return stabilized_lms, angles, val

    # ------------------------------------------------------------------ process
    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        h_orig, w_orig = frame_bgr.shape[:2]

        if not self.is_ready:
            # Fallback seguro caso os pesos ainda não tenham sido descarregados
            return self._empty_output(timestamp_ms)

        # 1. Decidir o recorte. Sem rastreio, ou quando o rastreio pede, é fotograma inteiro.
        rect: Sequence[int] | None = None
        used_tracker = False
        if self.tracking and not self.tracker.needs_full_frame():
            roi = self.tracker.roi_box()
            if roi is not None:
                rect = box_to_pixels(roi, w_orig, h_orig)
                used_tracker = True
                self.tracker.note_roi_reuse()

        # 2. Pré-processamento: recorte + letterbox rápido para o tamanho FIXO da rede.
        input_tensor, ratio, (pad_w, pad_h), used_rect = fast_preprocess_roi(
            frame_bgr, self.input_size, rect
        )

        # 3. Execução na GPU via DirectML (ou CPU AVX2)
        outputs = self.session.run(None, {self.input_name: input_tensor})
        raw_preds = np.squeeze(outputs[0], axis=0)  # [56, 8400]
        if raw_preds.ndim != 2 or raw_preds.shape[0] < 5:
            self.tracker.tick(pose_found=False)
            return self._empty_output(timestamp_ms)

        # Otimização sénior (R13): filtrar por confiança antes de transpor e alocar 8400 candidatos
        confidences = raw_preds[4, :]
        mask = confidences >= self.min_confidence
        if not np.any(mask):
            self.tracker.tick(pose_found=False)
            return self._empty_output(timestamp_ms)

        # Transpõe apenas os candidatos válidos (K << 8400)
        filtered = raw_preds[:, mask].T  # [K, 56]

        candidates: list[DetectionCandidate] = []
        if filtered.shape[0] == 1:
            box = self._to_normalized_box(filtered[0], ratio, (pad_w, pad_h), used_rect, w_orig, h_orig)
            candidates.append(DetectionCandidate(box=box, confidence=float(filtered[0, 4]), keypoints=filtered[0]))
        else:
            boxes_px: list[list[int]] = []
            scores: list[float] = []
            for i in range(filtered.shape[0]):
                cx, cy, bw, bh = (float(v) for v in filtered[i, :4])
                boxes_px.append([int(cx - bw / 2.0), int(cy - bh / 2.0), int(bw), int(bh)])
                scores.append(float(filtered[i, 4]))
            indices = cv2.dnn.NMSBoxes(boxes_px, scores, score_threshold=self.min_confidence, nms_threshold=0.45)
            if len(indices) > 0:
                indices_flat = np.array(indices).flatten()
                for idx in indices_flat:
                    box = self._to_normalized_box(filtered[idx], ratio, (pad_w, pad_h), used_rect, w_orig, h_orig)
                    candidates.append(DetectionCandidate(box=box, confidence=scores[idx], keypoints=filtered[idx]))

        if not candidates:
            self.tracker.tick(pose_found=False)
            return self._empty_output(timestamp_ms)

        # Seleção e associação temporal robusta do ciclista
        selected = self.target_selector.select_target(candidates)
        if selected is None or selected.keypoints is None:
            self.tracker.tick(pose_found=False)
            return self._empty_output(timestamp_ms)

        best = selected.keypoints
        box = selected.box

        if self.tracking and not used_tracker:
            # Deteção nova em fotograma inteiro: reinicia o contador de idade da caixa.
            self.tracker.observe(box, score=float(best[4]))
        elif self.tracking:
            # Recorte reutilizado: é um fotograma sem deteção nova.
            self.tracker.tick(pose_found=True)

        landmarks_raw = self._decode_keypoints(
            best, ratio, (pad_w, pad_h), used_rect, w_orig, h_orig
        )
        self._add_foot_estimates(landmarks_raw, w_orig, h_orig)
        self._apply_side_aliases(landmarks_raw)
        landmarks_raw, angles, val = self._compute_angles(landmarks_raw, w_orig, h_orig)

        return InferenceOutput(
            engine_name=self.name,
            side=self.side,
            timestamp_ms=timestamp_ms,
            landmarks=landmarks_raw,
            angles=angles,
            validation=val,
        )


PoseEngineRegistry.register("yolo11_pose", YOLO11PoseEngine)
PoseEngineRegistry.register(
    "yolo11_pose_cpu", lambda **kwargs: YOLO11PoseEngine(use_gpu=False, **kwargs)
)
PoseEngineRegistry.register(
    "yolo11_pose_fast",
    lambda **kwargs: YOLO11PoseEngine(
        use_gpu=True, prefer_fast_model=True, tracking=True, name="yolo11_pose_fast", **kwargs
    ),
)
