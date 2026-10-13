"""A captura entrega frames — este é o formato em que o resto do `runtime/` os recebe.

O `Frame` é o contrato único entre a captura, o pré-processamento (D04) e a inferência
(D05). Duas decisões importantes estão aqui dentro:

1. **Os dados são uma vista só-leitura.** O produtor (thread de captura) continua a ser o
   dono do buffer e pode reutilizá-lo no frame seguinte (*latest-frame-wins*), mas um
   consumidor que tente escrever por engano falha imediatamente em vez de corromper o
   frame que outro consumidor está a ler.
2. **O instante de captura viaja com o frame** (`t_capture_ns`, relógio monotónico). É a
   única forma de corrigir a defasagem entre o resultado da inferência e a imagem que o
   gerou: medir o tempo no consumo daria sempre um valor otimista e errado.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

import numpy as np
from numpy.typing import NDArray

UInt8Image = NDArray[np.uint8]


class PixelFormat(StrEnum):
    """Formatos de pixel que o pipeline aceita.

    A ordem de canais é explícita porque OpenCV, os modelos (RGB) e o Qt divergem: um
    frame mal etiquetado produziria cores trocadas sem qualquer erro visível.
    """

    BGR24 = "bgr24"
    GRAY8 = "gray8"


#: Canais por formato — usado para validar a forma do buffer.
CHANNELS_PER_FORMAT: dict[PixelFormat, int] = {
    PixelFormat.BGR24: 3,
    PixelFormat.GRAY8: 1,
}


class FrameContractError(ValueError):
    """O frame viola o contrato (forma, tipo ou mutabilidade dos dados).

    Args:
        reason: explicação em PT-PT com o valor recebido e o esperado.
    """

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def read_only_view(buffer: UInt8Image) -> UInt8Image:
    """Devolve uma vista **sem permissão de escrita** sobre o buffer do produtor.

    Args:
        buffer: buffer do produtor (continua a pertencer-lhe).

    Returns:
        Vista que partilha a memória mas recusa escritas — o produtor pode voltar a
        escrever no seu próprio buffer, o consumidor não consegue fazê-lo por acidente.
    """
    view: UInt8Image = buffer.view()
    view.setflags(write=False)
    return view


@dataclass(frozen=True, slots=True, eq=False)
class Frame:
    """Um frame entregue por uma fonte de captura.

    Attributes:
        index: número sequencial do frame na fonte (ficheiros: posição no ficheiro;
            câmaras: contagem desde a abertura).
        t_capture_ns: instante da captura, em `time.perf_counter_ns()` monotónico.
        width: largura em píxeis (a **real**, não a pedida).
        height: altura em píxeis (a real).
        pixel_format: ordem de canais e profundidade dos dados.
        data: vista só-leitura sobre os píxeis; válida até a fonte entregar o frame
            seguinte (o produtor reutiliza o buffer).
        source_id: identificação da origem (`camera:0`, `file:<nome>`), para diagnóstico.
    """

    index: int
    t_capture_ns: int
    width: int
    height: int
    pixel_format: PixelFormat
    data: UInt8Image
    source_id: str

    #: O frame não é *hashable*: o buffer é partilhado com o produtor e muda debaixo dos
    #: pés de quem o observa. Comparar píxeis com `==` também devolveria um `ndarray` e
    #: não um `bool`, pelo que a igualdade é definida explicitamente abaixo.
    __hash__ = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        """Valida o contrato — melhor falhar na origem do que 200 linhas depois.

        Raises:
            FrameContractError: se a forma, o tipo ou a mutabilidade não corresponderem
                ao formato de pixel declarado.
        """
        if self.index < 0:
            raise FrameContractError(f"índice do frame {self.index} é negativo")
        if self.t_capture_ns <= 0:
            raise FrameContractError(
                f"instante de captura {self.t_capture_ns} deve ser um valor monotónico positivo"
            )
        if self.width <= 0 or self.height <= 0:
            raise FrameContractError(
                f"dimensões {self.width}x{self.height} inválidas (esperado > 0 em ambos)"
            )
        if self.data.dtype != np.uint8:
            raise FrameContractError(
                f"píxeis em {self.data.dtype}, esperado uint8 (o pipeline assume 8 bits por canal)"
            )

        expected_channels = CHANNELS_PER_FORMAT[self.pixel_format]
        expected_shape = (
            (self.height, self.width)
            if expected_channels == 1
            else (self.height, self.width, expected_channels)
        )
        if self.data.shape != expected_shape:
            raise FrameContractError(
                f"píxeis com forma {self.data.shape}, esperado {expected_shape} "
                f"para {self.width}x{self.height} em {self.pixel_format.value}"
            )
        if self.data.flags.writeable:
            raise FrameContractError(
                "os píxeis do frame têm de ser uma vista só-leitura "
                "(use `read_only_view` para os entregar)"
            )
        if self.data.base is None:
            raise FrameContractError(
                "os píxeis do frame têm de ser uma vista sobre o buffer do produtor, "
                "não uma cópia própria"
            )

    @property
    def channels(self) -> int:
        """Número de canais do frame."""
        return CHANNELS_PER_FORMAT[self.pixel_format]

    @property
    def shape(self) -> tuple[int, ...]:
        """Forma dos píxeis (com canais explícitos apenas quando existem)."""
        return tuple(self.data.shape)

    @property
    def size_bytes(self) -> int:
        """Tamanho dos píxeis em bytes."""
        return int(self.data.nbytes)

    def age_ms(self, now_ns: int) -> float:
        """Idade do frame face a um instante de referência.

        Args:
            now_ns: instante atual em `time.perf_counter_ns()`.

        Returns:
            Idade em milissegundos (pode ser negativa se `now_ns` vier de outro relógio).
        """
        return (now_ns - self.t_capture_ns) / 1e6

    def __eq__(self, other: object) -> bool:
        """Compara metadados **e** píxeis (o frame representa um conteúdo, não um buffer)."""
        if not isinstance(other, Frame):
            return NotImplemented
        return (
            self.index == other.index
            and self.t_capture_ns == other.t_capture_ns
            and self.width == other.width
            and self.height == other.height
            and self.pixel_format is other.pixel_format
            and self.source_id == other.source_id
            and np.array_equal(self.data, other.data)
        )
