"""Recortes (ROI) e o mapeamento de coordenadas entre o modelo e a frame original.

**Porquê este módulo existe:** o que entra no modelo não é a frame inteira mas um
recorte da pessoa. Sem uma conversão explícita e testada de coordenadas, cada
keypoint que volta do modelo seria colocado no sítio errado — um erro que só se nota
quando os ângulos articulares saem absurdos, muito longe da sua causa.

**Convenção de mapeamento (idêntica à do domínio partilhado):** o backend converte
keypoints com ``x_frame = (x_modelo - pad) / escala + offset_do_recorte``
(ver ``yolo_engine._extract_person`` e ``rtmpose_engine``). O desktop usa a mesma
fórmula — incluindo o *padding fracionário* e não o inteiro realmente aplicado — para
que os dois caminhos produzam exatamente as mesmas coordenadas. Divergir aqui seria
introduzir um erro sistemático de ~0,5 px entre web e desktop.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt


@dataclass(frozen=True, slots=True)
class Roi:
    """Recorte retangular em píxeis da frame original.

    Attributes:
        x: coordenada horizontal do canto superior esquerdo.
        y: coordenada vertical do canto superior esquerdo.
        width: largura em píxeis.
        height: altura em píxeis.
    """

    x: int
    y: int
    width: int
    height: int

    def as_tuple(self) -> tuple[int, int, int, int]:
        """Devolve ``(x, y, largura, altura)``, o formato usado pelo domínio."""
        return (self.x, self.y, self.width, self.height)

    def to_slice(self) -> tuple[slice, slice]:
        """Devolve as fatias NumPy do recorte (vista, sem cópia)."""
        return (slice(self.y, self.y + self.height), slice(self.x, self.x + self.width))

    def clamp(self, frame_width: int, frame_height: int) -> Roi:
        """Recorta o ROI para dentro da frame, com pelo menos 1x1 píxel.

        Mesma semântica do domínio (`crop_frame`): um ROI parcialmente fora da imagem
        é aparado em vez de rejeitado — perder a pessoa inteira por 3 píxeis fora do
        ecrã seria pior do que analisar a parte visível.

        Args:
            frame_width: largura da frame original.
            frame_height: altura da frame original.

        Returns:
            O ROI dentro dos limites da frame.

        Raises:
            ValueError: se as dimensões da frame não forem positivas.
        """
        if frame_width <= 0 or frame_height <= 0:
            raise ValueError(
                f"Dimensões de frame inválidas: {frame_width}x{frame_height} (positivas)."
            )
        x = max(0, min(frame_width - 1, self.x))
        y = max(0, min(frame_height - 1, self.y))
        width = max(1, min(frame_width - x, self.width))
        height = max(1, min(frame_height - y, self.height))
        return Roi(x=x, y=y, width=width, height=height)

    def expanded(self, padding_ratio: float, frame_width: int, frame_height: int) -> Roi:
        """Alarga o ROI em torno do centro e volta a apará-lo aos limites da frame.

        É o *padding* usado pelo RTMPose (``1.25`` = mais 25 % de contexto à volta da
        pessoa): dar contexto ao modelo evita cortar ombros ou pés na borda do recorte.

        Args:
            padding_ratio: fator de alargamento (1.0 = sem alteração).
            frame_width: largura da frame original.
            frame_height: altura da frame original.

        Returns:
            O ROI alargado, dentro da frame.

        Raises:
            ValueError: se `padding_ratio` for menor que 1.
        """
        if padding_ratio < 1.0:
            raise ValueError(
                f"padding_ratio={padding_ratio} reduziria o recorte; use >= 1.0 "
                "(1.25 é o valor do RTMPose)."
            )
        center_x = self.x + self.width / 2.0
        center_y = self.y + self.height / 2.0
        new_width = round(self.width * padding_ratio)
        new_height = round(self.height * padding_ratio)
        expanded = Roi(
            x=round(center_x - new_width / 2.0),
            y=round(center_y - new_height / 2.0),
            width=new_width,
            height=new_height,
        )
        return expanded.clamp(frame_width, frame_height)


@dataclass(frozen=True, slots=True)
class Transform:
    """Mapeamento entre coordenadas do modelo e da frame original.

    Attributes:
        roi: recorte aplicado à frame (``x``/``y`` são o offset a somar).
        scale: razão de escala aplicada no letterbox (`ratio` do domínio).
        pad_x: padding horizontal fracionário devolvido pelo letterbox.
        pad_y: padding vertical fracionário devolvido pelo letterbox.
        target_width: largura da entrada do modelo.
        target_height: altura da entrada do modelo.
    """

    roi: Roi
    scale: float
    pad_x: float
    pad_y: float
    target_width: int
    target_height: int

    def __post_init__(self) -> None:
        """Recusa escalas não positivas, que tornariam o mapeamento indefinido.

        Raises:
            ValueError: se `scale` não for positivo.
        """
        if self.scale <= 0.0:
            raise ValueError(
                f"Escala inválida no transform: {self.scale} (tem de ser positiva para "
                "as coordenadas do modelo poderem ser convertidas)."
            )

    def model_to_frame_point(self, x: float, y: float) -> tuple[float, float]:
        """Converte um ponto do espaço do modelo para coordenadas da frame original.

        Args:
            x: coordenada horizontal no espaço do modelo (píxeis da entrada).
            y: coordenada vertical no espaço do modelo (píxeis da entrada).

        Returns:
            Par ``(x, y)`` em píxeis da frame original.
        """
        frame_x = (x - self.pad_x) / self.scale + self.roi.x
        frame_y = (y - self.pad_y) / self.scale + self.roi.y
        return (float(frame_x), float(frame_y))

    def model_to_frame(self, points: npt.NDArray[np.floating]) -> npt.NDArray[np.float32]:
        """Converte uma matriz ``(N, 2)`` de pontos do modelo para a frame original.

        Args:
            points: matriz ``(N, 2)`` em coordenadas do modelo.

        Returns:
            Matriz ``(N, 2)`` float32 em píxeis da frame original.

        Raises:
            ValueError: se a forma da matriz não for ``(N, 2)``.
        """
        array = np.asarray(points, dtype=np.float32)
        if array.ndim != 2 or array.shape[1] != 2:
            raise ValueError(f"Esperava uma matriz (N, 2) de pontos, recebi a forma {array.shape}.")
        result = (array - np.array([self.pad_x, self.pad_y], dtype=np.float32)) / np.float32(
            self.scale
        )
        return np.ascontiguousarray(result + np.array([self.roi.x, self.roi.y], dtype=np.float32))

    def frame_to_model_point(self, x: float, y: float) -> tuple[float, float]:
        """Converte um ponto da frame original para o espaço do modelo (inverso exato).

        Usado para dar ao modelo uma região de interesse em coordenadas da sua entrada
        (por exemplo, para preencher um *heat map* de priors).

        Args:
            x: coordenada horizontal em píxeis da frame original.
            y: coordenada vertical em píxeis da frame original.

        Returns:
            Par ``(x, y)`` em píxeis do espaço do modelo.
        """
        model_x = (x - self.roi.x) * self.scale + self.pad_x
        model_y = (y - self.roi.y) * self.scale + self.pad_y
        return (float(model_x), float(model_y))


def clamp_roi(rect: tuple[int, int, int, int], frame_width: int, frame_height: int) -> Roi:
    """Apara um retângulo ``(x, y, largura, altura)`` aos limites da frame.

    Args:
        rect: retângulo em píxeis (formato do domínio).
        frame_width: largura da frame.
        frame_height: altura da frame.

    Returns:
        O ROI aparado.
    """
    x, y, width, height = rect
    return Roi(x=x, y=y, width=width, height=height).clamp(frame_width, frame_height)


def crop_roi(
    frame: npt.NDArray[np.uint8], roi: Roi | None, *, frame_size: tuple[int, int] | None = None
) -> npt.NDArray[np.uint8]:
    """Recorta a frame ao ROI, devolvendo uma **vista** (sem cópia de píxeis).

    Args:
        frame: imagem BGR ``(H, W, 3)``.
        roi: recorte a aplicar; `None` devolve a frame inteira.
        frame_size: par ``(largura, altura)`` quando se quer validar o ROI contra um
            tamanho diferente do real (usado nos testes); por omissão usa a frame.

    Returns:
        A vista do recorte (ou a própria frame quando `roi` é `None`).

    Raises:
        ValueError: se a frame não tiver 3 dimensões.
    """
    if frame.ndim != 3:
        raise ValueError(
            f"Esperava uma imagem (altura, largura, canais), recebi forma {frame.shape}."
        )
    if roi is None:
        return frame

    height, width = frame.shape[:2]
    expected_width, expected_height = frame_size or (width, height)
    clamped = roi.clamp(expected_width, expected_height)
    rows, columns = clamped.to_slice()
    return frame[rows, columns]
