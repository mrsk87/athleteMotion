"""Motor de inferência RTMPose (MMPose / Halpe26) com aceleração DirectML e pés reais.

O RTMPose é uma arquitetura top-down de alta fidelidade:
1. Recebe a caixa delimitadora do ciclista a partir do detetor de apoio ou rastreador.
2. Recorta e aplica transformação afim com preservação de aspeto anatómico (padding 1.25, 192x256).
3. Efetua inferência ONNX produzindo representações SimCC (eixos X e Y independentes).
4. Decodifica os 26 pontos anatómicos do padrão Halpe26, incluindo calcanhar e biqueira reais (estimated=False).
5. Aplica a transformação afim inversa para remapear as coordenadas ao fotograma original.

Caso o modelo ONNX não esteja disponível, o motor NÃO executa fallback silencioso disfarçado:
declara-se indisponível com motivo explícito e levanta ModelUnavailableError.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import onnxruntime as ort

from athletemotion.config.paths import MODELS_DIR
from athletemotion.domain.biomechanics.angles import compute_joint_angles
from athletemotion.domain.inference.base import (
    BasePoseEngine,
    ModelUnavailableError,
    PoseEngineRegistry,
)
from athletemotion.domain.inference.halpe26 import (
    HALPE26_KEYPOINTS,
    get_side_indices,
)
from athletemotion.domain.inference.model_zoo import get_model_metadata, verify_model
from athletemotion.domain.inference.onnx_utils import (
    preprocess_topdown_affine,
    transform_points_affine,
)
from athletemotion.domain.inference.person_tracker import PersonTracker
from athletemotion.domain.inference.stabilizer import (
    StabilizerState,
    stabilize,
)
from athletemotion.domain.inference.types import (
    BiomechanicalAngles,
    InferenceOutput,
    Landmark2D,
    SegmentValidation,
)
from athletemotion.infrastructure.hardware import hardware_manager

logger = logging.getLogger("athlete_motion.rtmpose_engine")

DEFAULT_RTMPOSE_MODEL_ID = "rtmpose-m-halpe26"
DEFAULT_RTMPOSE_FILENAME = "rtmpose-m.onnx"
SIMCC_SPLIT_RATIO = 2.0


def decode_simcc_predictions(
    simcc_x: np.ndarray,
    simcc_y: np.ndarray,
    split_ratio: float = SIMCC_SPLIT_RATIO,
) -> tuple[np.ndarray, np.ndarray]:
    """Decodifica as distribuições SimCC nos eixos X e Y para coordenadas no espaço de entrada do modelo.

    Args:
        simcc_x: Distribuição horizontal com forma [1, N_kpts, W_bins] ou [N_kpts, W_bins].
        simcc_y: Distribuição vertical com forma [1, N_kpts, H_bins] ou [N_kpts, H_bins].
        split_ratio: Fator de subdivisão do SimCC (por defeito 2.0).

    Returns:
        (points_xy [N_kpts, 2], scores [N_kpts])
    """
    x_dist = np.squeeze(simcc_x)
    y_dist = np.squeeze(simcc_y)

    if x_dist.ndim != 2 or y_dist.ndim != 2:
        num_k = x_dist.shape[0] if x_dist.ndim >= 1 else 26
        return np.zeros((num_k, 2), dtype=np.float32), np.zeros(num_k, dtype=np.float32)

    x_locs = np.argmax(x_dist, axis=-1).astype(np.float32) / max(1e-6, split_ratio)
    y_locs = np.argmax(y_dist, axis=-1).astype(np.float32) / max(1e-6, split_ratio)

    x_max = np.max(x_dist, axis=-1)
    y_max = np.max(y_dist, axis=-1)
    # Normalização suave de confiança
    scores = np.clip((x_max + y_max) * 5.0 + 0.5, 0.05, 1.0).astype(np.float32)

    points_xy = np.stack([x_locs, y_locs], axis=-1)
    return points_xy, scores


def decode_simcc(
    axis_distribution: np.ndarray, input_length: int, split_ratio: float = SIMCC_SPLIT_RATIO
) -> np.ndarray:
    """Converte a distribuição SimCC de um eixo em coordenadas normalizadas [0,1].

    `axis_distribution` tem forma [num_keypoints, bins]. Devolve [num_keypoints].
    """
    if axis_distribution.ndim != 2 or axis_distribution.shape[1] == 0:
        return np.zeros(
            axis_distribution.shape[0] if axis_distribution.ndim else 0, dtype=np.float32
        )
    indices = np.argmax(axis_distribution, axis=1).astype(np.float32)
    coords = indices / max(1e-6, split_ratio)
    return np.clip(coords / max(1, input_length), 0.0, 1.0)


class RTMPoseEngine(BasePoseEngine):
    """Motor top-down RTMPose Halpe26 com suporte a DirectML e pontos reais do pé."""

    def __init__(
        self,
        model_id: str = DEFAULT_RTMPOSE_MODEL_ID,
        side: str = "right",
        use_gpu: bool = True,
        tracker: PersonTracker | None = None,
        raise_on_unavailable: bool = False,
        model_path: str | None = None,
    ):
        super().__init__(name="rtmpose")
        self.model_id = model_id
        self.side = side.lower()
        self.use_gpu = use_gpu
        self.license = "Apache-2.0"
        self.license_risk = False

        if model_path is not None:
            p = Path(model_path)
            self.model_path = p if p.exists() else (MODELS_DIR / p.name)
            self.metadata = None
        else:
            self.metadata = get_model_metadata(model_id)
            filename = self.metadata.filename if self.metadata else DEFAULT_RTMPOSE_FILENAME
            self.model_path = MODELS_DIR / filename
        self.session: ort.InferenceSession | None = None
        self.input_name: str | None = None
        self.input_width: int = 192
        self.input_height: int = 256
        self.output_names: list[str] = []
        self.warmup_ms: float = 0.0
        self.provider_actual: str = "CPU"
        self.unavailable_reason: str | None = None

        self.tracker = tracker or PersonTracker(redetect_interval=12)
        self.stabilizer_state = StabilizerState()
        self._detector = None

        self._initialize_session(raise_on_unavailable)

    def _initialize_session(self, raise_on_unavailable: bool) -> None:
        """Carrega a sessão ONNX Runtime e valida integridade contra o manifesto."""
        if self.metadata is None and self.model_id != DEFAULT_RTMPOSE_MODEL_ID:
            reason = f"Modelo '{self.model_id}' não catalogado no manifesto."
            self.unavailable_reason = reason
            logger.warning("RTMPose não disponível: %s", reason)
            if raise_on_unavailable:
                raise ModelUnavailableError(self.name, reason, self.model_id)
            return

        if not self.model_path.exists():
            reason = f"Ficheiro '{self.model_path}' não encontrado."
            self.unavailable_reason = reason
            logger.warning("RTMPose não disponível: %s", reason)
            if raise_on_unavailable:
                raise ModelUnavailableError(self.name, reason, self.model_id)
            return

        if self.metadata is not None:
            is_valid, reason = verify_model(self.model_id)
            if not is_valid:
                self.unavailable_reason = reason
                logger.warning("RTMPose não disponível: %s", reason)
                if raise_on_unavailable:
                    raise ModelUnavailableError(self.name, reason, self.model_id)
                return

        session_opts = hardware_manager.create_session_options(gpu=self.use_gpu)
        providers = hardware_manager.get_execution_providers(gpu=self.use_gpu)
        try:
            self.session = ort.InferenceSession(
                str(self.model_path), sess_options=session_opts, providers=providers
            )
            self.input_name = self.session.get_inputs()[0].name
            shape = self.session.get_inputs()[0].shape
            # Formato típico MMPose: ['batch', 3, 256, 192] -> H=256, W=192
            if len(shape) == 4:
                h_val = shape[2]
                w_val = shape[3]
                if isinstance(h_val, int) and h_val > 0:
                    self.input_height = h_val
                if isinstance(w_val, int) and w_val > 0:
                    self.input_width = w_val

            self.output_names = [o.name for o in self.session.get_outputs()]
            active_providers = self.session.get_providers()
            self.provider_actual = active_providers[0] if active_providers else "Unknown"

            logger.info(
                "RTMPose Halpe26 carregado com sucesso (%s, entrada %dx%d, saídas: %s).",
                self.provider_actual,
                self.input_width,
                self.input_height,
                self.output_names,
            )
            self.warmup_ms = hardware_manager.warmup_session(
                self.session, runs=1, input_name=self.input_name
            )
        except Exception as err:
            self.unavailable_reason = f"Falha na inicialização ONNX: {err}"
            logger.error("Falha ao inicializar sessão ONNX para RTMPose: %s", err)
            self.session = None
            if raise_on_unavailable:
                raise ModelUnavailableError(self.name, str(err), self.model_id) from err

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

    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        """Processa um frame de vídeo via pipeline top-down RTMPose."""
        if not self.is_ready:
            raise ModelUnavailableError(
                self.name,
                self.unavailable_reason or "Motor RTMPose não carregado ou pesos em falta.",
                self.model_id,
            )

        h_orig, w_orig = frame_bgr.shape[:2]

        # 1. Determinar caixa do ciclista: via tracker ou detector leve
        bbox_xyxy: tuple[float, float, float, float] | None = None
        if self.tracker.has_box and not self.tracker.needs_full_frame():
            roi = self.tracker.roi_box()
            if roi is not None:
                # Converte coordenadas normalizadas [0, 1] em pixels (x1, y1, x2, y2)
                bbox_xyxy = (
                    roi[0] * w_orig,
                    roi[1] * h_orig,
                    roi[2] * w_orig,
                    roi[3] * h_orig,
                )
                self.tracker.note_roi_reuse()
        else:
            if self._detector is None:
                from .yolo_engine import YOLO11PoseEngine

                self._detector = YOLO11PoseEngine(side=self.side, use_gpu=self.use_gpu)

            detection = self._detector.process_frame(frame_bgr, timestamp_ms)
            if detection.landmarks:
                xs = [lm.x for lm in detection.landmarks.values()]
                ys = [lm.y for lm in detection.landmarks.values()]
                norm_box = (min(xs), min(ys), max(xs), max(ys))
                self.tracker.observe(norm_box, score=1.0)
                roi = self.tracker.roi_box()
                if roi is not None:
                    bbox_xyxy = (
                        roi[0] * w_orig,
                        roi[1] * h_orig,
                        roi[2] * w_orig,
                        roi[3] * h_orig,
                    )

        if bbox_xyxy is None:
            self.tracker.tick(pose_found=False)
            return self._empty_output(timestamp_ms)

        # 2. Recorte afim top-down padronizado
        tensor, _m_mat, m_inv = preprocess_topdown_affine(
            frame_bgr,
            bbox_xyxy,
            target_wh=(self.input_width, self.input_height),
            padding=1.25,
        )

        # 3. Inferência ONNX SimCC
        try:
            outputs = self.session.run(None, {self.input_name: tensor})
        except Exception as err:
            logger.error("Erro na inferência ONNX do RTMPose: %s", err)
            self.tracker.tick(pose_found=False)
            return self._empty_output(timestamp_ms)

        simcc_x = outputs[0]
        simcc_y = outputs[1]

        # 4. Decodificação SimCC e re-mapeamento afim
        kpts_model, scores = decode_simcc_predictions(simcc_x, simcc_y)
        kpts_orig = transform_points_affine(kpts_model, m_inv)

        # 5. Mapeamento para Landmark2D com pés reais Halpe26
        norm_xs = np.clip(kpts_orig[:, 0] / max(1, w_orig), 0.0, 1.0)
        norm_ys = np.clip(kpts_orig[:, 1] / max(1, h_orig), 0.0, 1.0)

        landmarks_raw: dict[str, Landmark2D] = {}
        side_indices = get_side_indices(self.side)

        for i, name in enumerate(HALPE26_KEYPOINTS):
            if i >= len(kpts_orig):
                continue
            conf = float(scores[i]) if i < len(scores) else 0.8
            # Os pontos do pé no Halpe26 são REAIS, não estimados!
            landmarks_raw[name] = Landmark2D(
                x=float(norm_xs[i]),
                y=float(norm_ys[i]),
                visibility=conf,
                estimated=False,
            )

        # Mapeamento dos aliases anatómicos canónicos do lado observado
        for canonical_name, halpe_idx in side_indices.items():
            if halpe_idx < len(kpts_orig):
                conf = float(scores[halpe_idx]) if halpe_idx < len(scores) else 0.8
                landmarks_raw[canonical_name] = Landmark2D(
                    x=float(norm_xs[halpe_idx]),
                    y=float(norm_ys[halpe_idx]),
                    visibility=conf,
                    estimated=False,
                )

        self.tracker.tick(pose_found=True)

        # 6. Estabilização e cálculo biomecânico em pixels
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
