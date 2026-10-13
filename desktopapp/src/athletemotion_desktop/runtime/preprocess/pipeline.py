"""Composição do pré-processamento com buffers reutilizados (*steady state* sem alocação).

Este módulo junta as três peças — recorte (`roi`), letterbox (`letterbox`) e conversão
para tensor (`blob`) — num objeto que **aloca uma vez** e depois só escreve:

1. :class:`Preprocessor` aloca a canvas uint8 e o tensor float32 no construtor;
2. cada frame redimensiona o recorte para dentro da canvas e converte os três canais
   para dentro do tensor;
3. o objeto devolvido dá acesso ao tensor (para o modelo), à canvas (para o HUD, se
   for preciso) e ao :class:`Transform` (para trazer keypoints de volta à frame).

**Porquê o valor devolvido é reutilizado:** o tensor e a canvas devolvidos apontam para
os mesmos buffers de um frame para o outro. Quem precisa de os guardar tem de copiar —
está dito no docstring de :class:`PreparedFrame`, para não haver surpresas em código
que junte resultados de vários frames.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np
import numpy.typing as npt

from athletemotion_desktop.runtime.preprocess import blob, letterbox
from athletemotion_desktop.runtime.preprocess.letterbox import LetterboxGeometry
from athletemotion_desktop.runtime.preprocess.roi import Roi, Transform, crop_roi

#: Entrada do RTMPose (largura x altura): a proporção retangular faz parte do modelo,
#: não é uma preferência de desempenho.
RTMPOSE_INPUT_SIZE: tuple[int, int] = (192, 256)

#: Entrada dos YOLO do projeto.
YOLO_INPUT_SIZE: tuple[int, int] = (640, 640)


@dataclass(frozen=True, slots=True)
class PreprocessRequest:
    """Parâmetros do pré-processamento (o que o olho humano não vê mas o modelo sente).

    Attributes:
        target_size: par ``(largura, altura)`` da entrada do modelo.
        padding_ratio: alargamento do ROI em torno do centro (1.25 no RTMPose).
        scale_up: permitir ampliar recortes pequenos (por omissão `False`, como no
            domínio: ampliar inventa píxeis).
        channel_order: ordem dos canais entregues ao modelo.
        input_scale: fator multiplicativo inicial (``1/255`` normaliza para [0, 1]).
        mean: média por canal (subtraída depois da escala).
        std: desvio-padrão por canal (divisor).
        pad_color: cor do padding.
    """

    target_size: tuple[int, int] = YOLO_INPUT_SIZE
    padding_ratio: float = 1.0
    scale_up: bool = False
    channel_order: blob.ChannelOrder = "rgb"
    input_scale: float = blob.DEFAULT_INPUT_SCALE
    mean: tuple[float, float, float] = (0.0, 0.0, 0.0)
    std: tuple[float, float, float] = (1.0, 1.0, 1.0)
    pad_color: tuple[int, int, int] = letterbox.DEFAULT_PAD_COLOR

    def with_size(self, target_size: tuple[int, int]) -> PreprocessRequest:
        """Devolve uma cópia do pedido com outra resolução de entrada.

        Args:
            target_size: novo par ``(largura, altura)``.

        Returns:
            Novo pedido (o original é imutável, logo seguro para partilhar).
        """
        return replace(self, target_size=target_size)


@dataclass(frozen=True, slots=True)
class PreparedFrame:
    """Resultado do pré-processamento de um frame.

    **Atenção:** `blob` e `canvas` apontam para os buffers internos do
    :class:`Preprocessor` e são reescritos no frame seguinte. Para guardar o
    resultado, copiar (``blob.copy()``).

    Attributes:
        blob: tensor ``(1, 3, altura, largura)`` float32 pronto para o modelo.
        canvas: imagem ``(altura, largura, 3)`` uint8 que o modelo vê (útil para HUD
            e para depuração de recortes errados).
        transform: mapeamento das coordenadas do modelo para a frame original.
        roi: recorte efetivamente usado (já aparado aos limites da frame).
        geometry: geometria do letterbox aplicado.
    """

    blob: npt.NDArray[np.float32]
    canvas: npt.NDArray[np.uint8]
    transform: Transform
    roi: Roi | None
    geometry: LetterboxGeometry


class Preprocessor:
    """Pré-processador com buffers próprios, reutilizáveis frame a frame."""

    def __init__(self, request: PreprocessRequest | None = None) -> None:
        """Aloca a canvas e o tensor para o pedido indicado.

        Args:
            request: parâmetros do pré-processamento (por omissão, YOLO 640x640).

        Raises:
            ValueError: se as dimensões pedidas não forem positivas.
        """
        self._request = request or PreprocessRequest()
        target_width, target_height = self._request.target_size
        self._canvas: npt.NDArray[np.uint8] = np.empty(
            (target_height, target_width, 3), dtype=np.uint8
        )
        self._blob: npt.NDArray[np.float32] = np.empty(
            blob.blob_shape(target_width, target_height), dtype=np.float32
        )
        self._prepare_mean_std = any(value != 0.0 for value in self._request.mean) or any(
            value != 1.0 for value in self._request.std
        )

    @property
    def request(self) -> PreprocessRequest:
        """Parâmetros atuais do pré-processamento."""
        return self._request

    @property
    def canvas(self) -> npt.NDArray[np.uint8]:
        """Canvas interna (reescrita a cada `prepare`)."""
        return self._canvas

    @property
    def blob(self) -> npt.NDArray[np.float32]:
        """Tensor interno (reescrito a cada `prepare`)."""
        return self._blob

    def configure(self, request: PreprocessRequest) -> None:
        """Aplica novos parâmetros, realocando os buffers só quando necessário.

        Args:
            request: novos parâmetros.

        Raises:
            ValueError: se as dimensões pedidas não forem positivas.
        """
        if request.target_size != self._request.target_size:
            target_width, target_height = request.target_size
            self._canvas = np.empty((target_height, target_width, 3), dtype=np.uint8)
            self._blob = np.empty(blob.blob_shape(target_width, target_height), dtype=np.float32)
        self._request = request
        self._prepare_mean_std = any(value != 0.0 for value in request.mean) or any(
            value != 1.0 for value in request.std
        )

    def prepare(self, frame: npt.NDArray[np.uint8], roi: Roi | None = None) -> PreparedFrame:
        """Prepara um frame BGR para o modelo.

        Args:
            frame: imagem BGR ``(altura, largura, 3)`` uint8 (a frame do anel).
            roi: recorte da pessoa; `None` usa a frame inteira. Quando
                ``padding_ratio > 1`` o recorte é alargado em torno do centro e aparado
                à frame.

        Returns:
            O tensor, a canvas e o transform do frame.

        Raises:
            ValueError: se a frame não tiver 3 dimensões ou se o ROI já aparado não
                couber na frame (frame degenerada de altura/largura nulas).
        """
        request = self._request
        effective_roi = roi
        if roi is not None:
            frame_height, frame_width = frame.shape[:2]
            if request.padding_ratio > 1.0:
                effective_roi = roi.expanded(request.padding_ratio, frame_width, frame_height)
            else:
                effective_roi = roi.clamp(frame_width, frame_height)

        crop = crop_roi(frame, effective_roi)
        target_width, target_height = request.target_size
        geometry = letterbox.letterbox_geometry(
            crop.shape[1],
            crop.shape[0],
            target_width,
            target_height,
            scale_up=request.scale_up,
        )
        letterbox.letterbox_into(crop, self._canvas, geometry, pad_color=request.pad_color)
        blob.canvas_to_nchw_float32(
            self._canvas,
            self._blob,
            channel_order=request.channel_order,
            input_scale=request.input_scale,
            mean=request.mean,
            std=request.std,
            apply_mean_std=self._prepare_mean_std,
        )

        transform = Transform(
            roi=effective_roi or Roi(x=0, y=0, width=frame.shape[1], height=frame.shape[0]),
            scale=geometry.scale,
            pad_x=geometry.pad_x,
            pad_y=geometry.pad_y,
            target_width=target_width,
            target_height=target_height,
        )
        return PreparedFrame(
            blob=self._blob,
            canvas=self._canvas,
            transform=transform,
            roi=effective_roi,
            geometry=geometry,
        )
