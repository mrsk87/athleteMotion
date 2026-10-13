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
from pathlib import Path
from typing import Dict, Optional, Sequence, Tuple
import numpy as np
import onnxruntime as ort

from src.infrastructure.hardware import hardware_manager
from src.domain.calculator import calculate_safe_angle, Point2D
from .base import BasePoseEngine, PoseEngineRegistry
from .onnx_utils import preprocess_roi_for_onnx
from .person_tracker import PersonTracker, box_to_pixels
from .types import InferenceOutput, Landmark2D, BiomechanicalAngles, SegmentValidation

logger = logging.getLogger("athlete_motion.yolo_engine")

# Mapeamento dos 17 Keypoints COCO para o esqueleto sagital do ciclista
COCO_KP_NAMES = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
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


def _static_input_size(session: ort.InferenceSession) -> Optional[int]:
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
        model_path: Optional[str] = None,
        side: str = "right",
        use_gpu: bool = True,
        tracking: bool = True,
        redetect_interval: int = 15,
        min_confidence: float = 0.25,
        warmup: bool = True,
        prefer_fast_model: bool = False,
        name: Optional[str] = None,
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

        self.model_path = self._resolve_model_path(model_path, prefer_fast_model)
        self.session: Optional[ort.InferenceSession] = None
        self.input_name: Optional[str] = None
        self.input_size = 640
        self.warmup_ms = 0.0

        self.tracker = PersonTracker(redetect_interval=redetect_interval)

        if self.model_path is None or not self.model_path.exists():
            logger.warning("Modelo YOLO-Pose não encontrado (%s). Usando fallback seguro.", model_path)
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
                self.warmup_ms = hardware_manager.warmup_session(self.session, runs=1, input_name=self.input_name)
        except Exception as e:
            logger.error("Falha ao inicializar sessão ONNX para YOLO11: %s", e)
            self.session = None
            self.input_name = None

    @staticmethod
    def _resolve_model_path(explicit: Optional[str], prefer_fast: bool) -> Optional[Path]:
        if explicit:
            return Path(explicit)
        candidates = (FAST_MODEL_CANDIDATES + DEFAULT_MODEL_CANDIDATES) if prefer_fast \
            else DEFAULT_MODEL_CANDIDATES
        for candidate in candidates:
            path = Path(candidate)
            if path.exists():
                return path
        return Path(DEFAULT_MODEL_CANDIDATES[0])

    # ------------------------------------------------------------------ interface
    def set_side(self, side: str) -> None:
        self.side = side.lower()
        self.tracker.reset()

    def reset(self) -> None:
        self.tracker.reset()

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
            validation=SegmentValidation(femur_length=0, tibia_length=0, femur_valid=False, tibia_valid=False),
        )

    def _extract_person(
        self, preds: np.ndarray, ratio: float, pad: Tuple[float, float], rect, full_w: int, full_h: int
    ) -> Optional[Tuple[np.ndarray, Tuple[float, float, float, float]]]:
        """Escolhe a pessoa com maior confiança e devolve (keypoints, caixa normalizada)."""
        if preds.shape[0] < 5:
            return None

        best_index = int(np.argmax(preds[:, 4]))
        best = preds[best_index]
        if float(best[4]) < self.min_confidence:
            return None

        pad_w, pad_h = pad
        # Caixa (cx, cy, w, h) no espaço da entrada → espaço do recorte → fotograma inteiro.
        cx, cy, bw, bh = (float(v) for v in best[0:4])
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
        box = (
            float(np.clip(x1, 0.0, 1.0)),
            float(np.clip(y1, 0.0, 1.0)),
            float(np.clip(x2, 0.0, 1.0)),
            float(np.clip(y2, 0.0, 1.0)),
        )
        return best, box

    def _decode_keypoints(
        self,
        best: np.ndarray,
        ratio: float,
        pad: Tuple[float, float],
        rect,
        full_w: int,
        full_h: int,
    ) -> Dict[str, Landmark2D]:
        pad_w, pad_h = pad
        off_x = float(rect[0]) if rect else 0.0
        off_y = float(rect[1]) if rect else 0.0
        kpts_raw = best[5:]

        landmarks_raw: Dict[str, Landmark2D] = {}
        for i, name in enumerate(COCO_KP_NAMES):
            kx = float(kpts_raw[i * 3])
            ky = float(kpts_raw[i * 3 + 1])
            kconf = float(kpts_raw[i * 3 + 2])

            crop_x = (kx - pad_w) / ratio if ratio > 0 else 0.0
            crop_y = (ky - pad_h) / ratio if ratio > 0 else 0.0
            orig_x = (crop_x + off_x) / max(1, full_w)
            orig_y = (crop_y + off_y) / max(1, full_h)

            landmarks_raw[name] = Landmark2D(
                x=float(np.clip(orig_x, 0.0, 1.0)),
                y=float(np.clip(orig_y, 0.0, 1.0)),
                visibility=float(np.clip(kconf, 0.0, 1.0)),
            )
        return landmarks_raw

    def _add_foot_estimates(self, landmarks_raw: Dict[str, Landmark2D]) -> None:
        """Calcâneo e biqueira estimados a partir do tornozelo, na direção do movimento.

        O lado para onde o atleta pedala decide o sinal do deslocamento: é o que faz o
        recuo da sapatilha/travessão (cleat) medir a direção certa.
        """
        facing_right = True
        if "left_shoulder" in landmarks_raw and "left_hip" in landmarks_raw:
            facing_right = landmarks_raw["left_shoulder"].x >= landmarks_raw["left_hip"].x
        elif "right_shoulder" in landmarks_raw and "right_hip" in landmarks_raw:
            facing_right = landmarks_raw["right_shoulder"].x >= landmarks_raw["right_hip"].x
        elif "nose" in landmarks_raw and "left_ear" in landmarks_raw:
            facing_right = landmarks_raw["nose"].x >= landmarks_raw["left_ear"].x

        toe_offset_x = 0.035 if facing_right else -0.035
        heel_offset_x = -0.018 if facing_right else 0.018

        for prefix in ("left", "right"):
            ankle = landmarks_raw.get(f"{prefix}_ankle")
            if ankle is None:
                continue
            landmarks_raw[f"{prefix}_heel"] = Landmark2D(
                x=float(np.clip(ankle.x + heel_offset_x, 0.0, 1.0)),
                y=float(np.clip(ankle.y + 0.012, 0.0, 1.0)),
                visibility=float(ankle.visibility * 0.9),
            )
            landmarks_raw[f"{prefix}_toe"] = Landmark2D(
                x=float(np.clip(ankle.x + toe_offset_x, 0.0, 1.0)),
                y=float(np.clip(ankle.y + 0.018, 0.0, 1.0)),
                visibility=float(ankle.visibility * 0.9),
            )

    def _apply_side_aliases(self, landmarks_raw: Dict[str, Landmark2D]) -> None:
        side_prefix = "right" if self.side == "right" else "left"
        other_prefix = "left" if self.side == "right" else "right"

        for part in ["hip", "knee", "ankle", "heel", "toe", "shoulder", "elbow", "wrist", "ear"]:
            target_key = f"{side_prefix}_{part}"
            if target_key not in landmarks_raw:
                continue
            active_lm = landmarks_raw[target_key]
            other_key = f"{other_prefix}_{part}"
            # Apoio adaptativo se o lado ativo estiver ocluso (<0.20) mas o contralateral visível (>0.50)
            if active_lm.visibility < 0.20 and other_key in landmarks_raw and landmarks_raw[other_key].visibility > 0.50:
                landmarks_raw[part] = landmarks_raw[other_key]
            else:
                landmarks_raw[part] = active_lm

    # ------------------------------------------------------------- biomecânica
    def _compute_angles(
        self, landmarks_raw: Dict[str, Landmark2D], full_w: int, full_h: int
    ) -> Tuple[BiomechanicalAngles, SegmentValidation]:
        angles = BiomechanicalAngles()
        to_pt = lambda name: Point2D(landmarks_raw[name].x * full_w, landmarks_raw[name].y * full_h)

        if "hip" in landmarks_raw and "knee" in landmarks_raw and "ankle" in landmarks_raw:
            if all(landmarks_raw[k].visibility >= 0.20 for k in ("hip", "knee", "ankle")):
                angles.knee = round(calculate_safe_angle(
                    to_pt("hip"), to_pt("knee"), to_pt("ankle"),
                ), 1)

        if "shoulder" in landmarks_raw and "hip" in landmarks_raw:
            if all(landmarks_raw[k].visibility >= 0.20 for k in ("shoulder", "hip")):
                dx = abs(landmarks_raw["shoulder"].x - landmarks_raw["hip"].x) * full_w
                dy = (landmarks_raw["hip"].y - landmarks_raw["shoulder"].y) * full_h
                angles.torso = round(float(np.degrees(np.arctan2(dy, dx))), 1) if dx > 0 else 90.0

        if "shoulder" in landmarks_raw and "elbow" in landmarks_raw and "wrist" in landmarks_raw:
            if all(landmarks_raw[k].visibility >= 0.20 for k in ("shoulder", "elbow", "wrist")):
                angles.arm_elbow = round(calculate_safe_angle(
                    to_pt("shoulder"), to_pt("elbow"), to_pt("wrist"),
                ), 1)

        femur_len = 0.0
        tibia_len = 0.0
        if "hip" in landmarks_raw and "knee" in landmarks_raw:
            femur_len = float(np.hypot(
                landmarks_raw["hip"].x - landmarks_raw["knee"].x,
                landmarks_raw["hip"].y - landmarks_raw["knee"].y,
            ))
        if "knee" in landmarks_raw and "ankle" in landmarks_raw:
            tibia_len = float(np.hypot(
                landmarks_raw["knee"].x - landmarks_raw["ankle"].x,
                landmarks_raw["knee"].y - landmarks_raw["ankle"].y,
            ))

        val = SegmentValidation(
            femur_length=round(femur_len, 3),
            tibia_length=round(tibia_len, 3),
            femur_valid=femur_len > 0.05,
            tibia_valid=tibia_len > 0.05,
        )
        return angles, val

    # ------------------------------------------------------------------ process
    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        h_orig, w_orig = frame_bgr.shape[:2]

        if not self.is_ready:
            # Fallback seguro caso os pesos ainda não tenham sido descarregados
            return self._empty_output(timestamp_ms)

        # 1. Decidir o recorte. Sem rastreio, ou quando o rastreio pede, é fotograma inteiro.
        rect: Optional[Sequence[int]] = None
        used_tracker = False
        if self.tracking:
            if not self.tracker.needs_full_frame():
                roi = self.tracker.roi_box()
                if roi is not None:
                    rect = box_to_pixels(roi, w_orig, h_orig)
                    used_tracker = True
                    self.tracker.note_roi_reuse()

        # 2. Pré-processamento: recorte + letterbox para o tamanho FIXO da rede.
        input_tensor, ratio, (pad_w, pad_h), used_rect = preprocess_roi_for_onnx(
            frame_bgr, self.input_size, rect
        )

        # 3. Execução na GPU via DirectML (ou CPU AVX2)
        outputs = self.session.run(None, {self.input_name: input_tensor})
        preds = np.squeeze(outputs[0], axis=0)  # [56, 8400]
        if preds.ndim != 2:
            self.tracker.tick(pose_found=False)
            return self._empty_output(timestamp_ms)
        preds = preds.transpose((1, 0))  # [8400, 56]

        found = self._extract_person(preds, ratio, (pad_w, pad_h), used_rect, w_orig, h_orig)
        if found is None:
            self.tracker.tick(pose_found=False)
            return self._empty_output(timestamp_ms)

        best, box = found
        if self.tracking and not used_tracker:
            # Deteção nova em fotograma inteiro: reinicia o contador de idade da caixa.
            self.tracker.observe(box, score=float(best[4]))
        elif self.tracking:
            # Recorte reutilizado: é um fotograma sem deteção nova.
            self.tracker.tick(pose_found=True)

        landmarks_raw = self._decode_keypoints(best, ratio, (pad_w, pad_h), used_rect, w_orig, h_orig)
        self._add_foot_estimates(landmarks_raw)
        self._apply_side_aliases(landmarks_raw)
        angles, val = self._compute_angles(landmarks_raw, w_orig, h_orig)

        return InferenceOutput(
            engine_name=self.name,
            side=self.side,
            timestamp_ms=timestamp_ms,
            landmarks=landmarks_raw,
            angles=angles,
            validation=val,
        )


PoseEngineRegistry.register("yolo11_pose", YOLO11PoseEngine)
PoseEngineRegistry.register("yolo11_pose_cpu", lambda **kwargs: YOLO11PoseEngine(use_gpu=False, **kwargs))
PoseEngineRegistry.register(
    "yolo11_pose_fast",
    lambda **kwargs: YOLO11PoseEngine(
        use_gpu=True, prefer_fast_model=True, tracking=True, name="yolo11_pose_fast", **kwargs
    ),
)
