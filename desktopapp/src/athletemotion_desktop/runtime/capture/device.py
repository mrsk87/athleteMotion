"""O dispositivo de captura: contrato mínimo e adaptador do OpenCV.

Este módulo é a **única** fronteira do pacote com o `cv2.VideoCapture`. Duas razões:

1. **Testabilidade.** `CameraSource`, `FileSource` e `controls` dependem do protocolo
   `CaptureDevice`, não da biblioteca: nos testes injeta-se um dispositivo simulado que
   reproduz as respostas reais de um driver (incluindo as que mentem), sem substituir o
   `cv2` nem depender de hardware.
2. **Tipos verificáveis.** As assinaturas do `cv2` são genéricas (`Mat`/`Any`) e não
   cumprem um protocolo próprio; o adaptador resolve a conversão num só lugar, com um
   `cast` explícito em vez de *ignores* espalhados.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Final, Protocol, cast

import cv2
import numpy as np
from numpy.typing import NDArray

UInt8Image = NDArray[np.uint8]


class CameraBackend(StrEnum):
    """Backend de captura do OpenCV no Windows.

    Vive neste módulo (e não em `camera.py`) porque é a `open_camera` que o usa para
    escolher a *flag* do OpenCV: mantê-lo junto evita que a camada da câmara tenha de
    importar o adaptador e vice-versa.
    """

    DSHOW = "dshow"
    MSMF = "msmf"
    ANY = "any"


CAMERA_BACKEND_LABELS: Final[dict[CameraBackend, str]] = {
    CameraBackend.DSHOW: "DirectShow",
    CameraBackend.MSMF: "Media Foundation",
    CameraBackend.ANY: "backend por omissão",
}

_BACKEND_FLAGS: Final[dict[CameraBackend, int]] = {
    CameraBackend.DSHOW: cv2.CAP_DSHOW,
    CameraBackend.MSMF: cv2.CAP_MSMF,
    CameraBackend.ANY: cv2.CAP_ANY,
}


class CaptureDevice(Protocol):
    """Superfície mínima do dispositivo de captura (o que o OpenCV expõe).

    Os nomes `isOpened`/`get`/`set`/`read`/`release` mantêm-se iguais aos do OpenCV de
    propósito: um nome "mais Python" obrigaria a uma camada de tradução em todos os pontos
    de chamada e a distinguir dois objetos que são o mesmo.
    """

    def isOpened(self) -> bool:
        """Indica se o dispositivo está aberto."""
        ...

    def get(self, prop_id: int) -> float:
        """Lê uma propriedade do dispositivo."""
        ...

    def set(self, prop_id: int, value: float) -> bool:
        """Escreve uma propriedade do dispositivo, indicando se foi aceite."""
        ...

    def read(self, image: UInt8Image | None = None) -> tuple[bool, UInt8Image]:
        """Lê um frame (para `image`, quando fornecido), devolvendo `(ok, frame)`."""
        ...

    def release(self) -> None:
        """Fecha o dispositivo."""
        ...


class OpenCVCapture:
    """Adaptador de `cv2.VideoCapture` ao protocolo `CaptureDevice`.

    Args:
        capture: objeto do OpenCV já criado (câmara ou ficheiro).
    """

    def __init__(self, capture: cv2.VideoCapture) -> None:
        self._capture = capture

    def isOpened(self) -> bool:
        """Indica se o dispositivo está aberto."""
        return bool(self._capture.isOpened())

    def get(self, prop_id: int) -> float:
        """Lê uma propriedade do dispositivo, sempre como `float`."""
        return float(self._capture.get(prop_id))

    def set(self, prop_id: int, value: float) -> bool:
        """Escreve uma propriedade do dispositivo, sempre como `bool`."""
        return bool(self._capture.set(prop_id, value))

    def read(self, image: UInt8Image | None = None) -> tuple[bool, UInt8Image]:
        """Lê um frame, escrevendo-o em `image` quando fornecido.

        Args:
            image: buffer de destino pré-alocado (evita uma alocação por frame).

        Returns:
            `(ok, frame)`. Quando `image` é fornecido, o OpenCV escreve nele e devolve-o;
            o adaptador normaliza o tipo declarado nas *stubs* (`Mat`) para `ndarray`
            `uint8`, que é o que o pipeline usa.
        """
        if image is None:
            ok, frame = self._capture.read()
        else:
            ok, frame = self._capture.read(image)
        return bool(ok), cast(UInt8Image, frame)

    def release(self) -> None:
        """Fecha o dispositivo."""
        self._capture.release()


def open_camera(index: int, backend: CameraBackend) -> CaptureDevice:
    """Abre uma câmara com o backend pedido.

    Args:
        index: índice do dispositivo no sistema.
        backend: backend de captura a usar.

    Returns:
        O dispositivo adaptado ao protocolo `CaptureDevice`.
    """
    return OpenCVCapture(cv2.VideoCapture(index, _BACKEND_FLAGS[backend]))


def open_file(path: str) -> CaptureDevice:
    """Abre um ficheiro de vídeo.

    Args:
        path: caminho do ficheiro.

    Returns:
        O dispositivo adaptado ao protocolo `CaptureDevice`.
    """
    return OpenCVCapture(cv2.VideoCapture(path))


def fourcc_to_code(text: str) -> int:
    """Codifica um FOURCC de 4 caracteres no inteiro que o OpenCV espera.

    Implementado aqui (e não com `cv2.VideoWriter_fourcc`) porque essa função não existe
    nas *stubs* de tipos do OpenCV, e usá-la obrigaria a um `ignore` que esconderia erros
    reais. A codificação é a mesma: `c0 | c1<<8 | c2<<16 | c3<<24`.

    Args:
        text: código com exatamente 4 caracteres (ex.: `MJPG`).

    Returns:
        O valor inteiro correspondente.

    Raises:
        ValueError: se o código não tiver 4 caracteres.
    """
    if len(text) != 4:
        raise ValueError(f"FOURCC '{text}' tem {len(text)} caracteres (esperado 4)")
    return sum(ord(character) << (8 * position) for position, character in enumerate(text))


def fourcc_to_text(value: float) -> str | None:
    """Descodifica o inteiro FOURCC devolvido pelo OpenCV (`1667788148` → `MJPG`).

    Args:
        value: valor lido de `CAP_PROP_FOURCC`.

    Returns:
        O código de 4 caracteres, ou `None` quando o driver devolve 0 (não reporta).
    """
    code = int(value)
    if code <= 0:
        return None
    text = "".join(chr((code >> (8 * shift)) & 0xFF) for shift in range(4))
    if not text.isprintable():
        return None
    return text
