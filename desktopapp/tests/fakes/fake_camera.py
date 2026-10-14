"""Dobres de teste da captura: dispositivo simulado e fonte determinística.

Nenhum teste deste pacote toca em hardware ou em `cv2.VideoCapture` real: nos testes de
câmara injeta-se um `FakeCaptureDevice` que reproduz o comportamento (e os defeitos) de um
driver — valores que mentem, leituras que falham, propriedades que nunca foram escritas. É
a única forma de testar o código que existe exatamente para lidar com esses casos.
"""

from __future__ import annotations

import time
from collections.abc import Mapping, Sequence

import numpy as np
from numpy.typing import NDArray

from athletemotion_desktop.runtime.capture.base import (
    SourceInfo,
    ThreadedCaptureSource,
)
from athletemotion_desktop.runtime.capture.frame import PixelFormat

UInt8Image = NDArray[np.uint8]


class FakeCaptureDevice:
    """Dispositivo de captura simulado, com propriedades e falhas controladas.

    Args:
        properties: valores iniciais das propriedades (`CAP_PROP_*` → valor).
        frame_value: valor constante escrito nos píxeis de cada frame (0–255).
        width: largura dos frames entregues.
        height: altura dos frames entregues.
        opened: resposta de `isOpened()`.
        accept_writes: quando `False`, `set()` devolve `False` (driver que recusa tudo).
        read_failures: número de leituras seguidas que falham, por contagem de chamadas;
            `None` desativa as falhas.
        frames_available: número de frames que o dispositivo entrega antes de falhar
            (usado para simular a câmara a ser desligada).
        frame_delay_s: atraso simulado de cada leitura.
    """

    def __init__(
        self,
        *,
        properties: Mapping[int, float] | None = None,
        frame_value: int = 7,
        width: int = 4,
        height: int = 3,
        opened: bool = True,
        accept_writes: bool = True,
        echo_writes: bool = True,
        read_failures: Sequence[int] | None = None,
        frames_available: int | None = None,
        frame_delay_s: float = 0.0,
    ) -> None:
        self.properties: dict[int, float] = dict(properties or {})
        self.written: dict[int, float] = {}
        self.frame_value = frame_value
        self.width = width
        self.height = height
        self._opened = opened
        self.accept_writes = accept_writes
        # Um driver real aceita a escrita e continua a reportar o que o hardware faz
        # (`echo_writes=False` modela exatamente isso: aceitar não é obedecer).
        self.echo_writes = echo_writes
        self._read_failures = set(read_failures or ())
        self._read_calls = 0
        self.frames_available = frames_available
        self.frames_read = 0
        self.frame_delay_s = frame_delay_s
        self.released = False

    def isOpened(self) -> bool:
        """Indica se o dispositivo está aberto."""
        return self._opened and not self.released

    def get(self, prop_id: int) -> float:
        """Lê uma propriedade (devolve 0.0 quando nunca foi definida)."""
        return float(self.properties.get(prop_id, 0.0))

    def set(self, prop_id: int, value: float) -> bool:
        """Escreve uma propriedade, registando a tentativa para inspeção nos testes."""
        if not self.accept_writes or self.released:
            return False
        self.written[prop_id] = value
        if self.echo_writes:
            self.properties[prop_id] = value
        return True

    def _blank(self, image: UInt8Image | None) -> UInt8Image:
        """Frame devolvido quando a leitura falha (o OpenCV devolve o destino tal como está)."""
        if image is not None:
            return image
        return np.zeros((self.height, self.width, 3), dtype=np.uint8)

    def read(self, image: UInt8Image | None = None) -> tuple[bool, UInt8Image]:
        """Entrega um frame constante, ou falha conforme a configuração.

        O buffer fornecido só é usado quando a forma corresponde ao que o "hardware"
        entrega. Quando não corresponde (o caso de uma câmara que mudou de modo sem
        avisar), o dispositivo devolve um frame próprio — é assim que o chamador deteta a
        mudança em vez de receber píxeis de uma resolução diferente.
        """
        self._read_calls += 1
        if self.frame_delay_s > 0:
            time.sleep(self.frame_delay_s)
        exhausted = self.frames_available is not None and self.frames_read >= self.frames_available
        if self._read_calls in self._read_failures or exhausted:
            return False, self._blank(image)
        self.frames_read += 1
        own_shape = (self.height, self.width, 3)
        if image is not None and image.shape == own_shape:
            image[:] = self.frame_value
            return True, image
        return True, np.full(own_shape, self.frame_value, dtype=np.uint8)

    def release(self) -> None:
        """Marca o dispositivo como fechado."""
        self.released = True


class FakeSource(ThreadedCaptureSource):
    """Fonte determinística para testar a base (thread, descarte, reconexão).

    Args:
        width: largura dos frames.
        height: altura dos frames.
        period_s: intervalo entre frames capturados.
        requested_fps: FPS declarado como pedido (para os avisos de desempenho).
        open_error: quando definido, `_open_device` levanta esta exceção (simula falha de
            abertura ou de reconexão).
        fail_after: número de frames entregues antes de a captura começar a falhar.
        clock: injeção de relógio (permite testar sem esperar de verdade).
    """

    def __init__(
        self,
        *,
        width: int = 4,
        height: int = 3,
        period_s: float = 0.005,
        requested_fps: float | None = 60.0,
        open_error: Exception | None = None,
        fail_after: int | None = None,
        max_reconnect_attempts: int = 2,
        open_timeout_s: float = 1.0,
    ) -> None:
        super().__init__(
            "fake:0",
            requested_fps=requested_fps,
            max_reconnect_attempts=max_reconnect_attempts,
            open_timeout_s=open_timeout_s,
        )
        self.width = width
        self.height = height
        self.period_s = period_s
        self.open_error = open_error
        self.fail_after = fail_after
        self.opens = 0
        self.releases = 0
        self.captured = 0

    def _open_device(self) -> SourceInfo:
        self.opens += 1
        if self.open_error is not None:
            raise self.open_error
        return SourceInfo(
            source_id=self.source_id,
            kind="camera",
            width=self.width,
            height=self.height,
            fps=self._requested_fps or 0.0,
            requested_fps=self._requested_fps,
            pixel_format=PixelFormat.BGR24,
            fourcc=None,
            backend="fake",
        )

    def _read_into(self, buffer: UInt8Image) -> bool:
        if self.fail_after is not None and self.captured >= self.fail_after:
            return False
        self.captured += 1
        buffer[:] = self.captured % 256
        if self.period_s > 0:
            # Espera interruptível: um teste que feche a fonte não fica preso aqui.
            self._stop.wait(self.period_s)
        return True

    def _release_device(self) -> None:
        self.releases += 1


class FakeClock:
    """Relógio controlado para testes que precisam de medir FPS sem esperar.

    Args:
        start_ns: instante inicial.
        step_ns: incremento aplicado em cada `perf_counter_ns()`.
    """

    def __init__(self, *, start_ns: int = 1_000_000_000, step_ns: int = 16_666_667) -> None:
        self.now_ns = start_ns
        self.step_ns = step_ns

    def perf_counter_ns(self) -> int:
        """Devolve o instante atual e avança o relógio."""
        current = self.now_ns
        self.now_ns += self.step_ns
        return current


def make_source_info(**overrides: object) -> SourceInfo:
    """Cria uma `SourceInfo` com valores de teste, permitindo sobrepor campos."""
    base: dict[str, object] = {
        "source_id": "camera:0",
        "kind": "camera",
        "width": 1280,
        "height": 720,
        "fps": 60.0,
        "requested_fps": 60.0,
        "pixel_format": PixelFormat.BGR24,
        "fourcc": "MJPG",
        "backend": "dshow",
    }
    base.update(overrides)
    return SourceInfo(**base)  # type: ignore[arg-type]


def camera_properties(
    *, width: int = 1280, height: int = 720, fps: float = 60.0, fourcc: str = "MJPG"
) -> dict[int, float]:
    """Constrói o mapa de propriedades de um driver que respeita o que se lhe pede."""
    import cv2

    from athletemotion_desktop.runtime.capture.device import fourcc_to_code

    return {
        cv2.CAP_PROP_FRAME_WIDTH: float(width),
        cv2.CAP_PROP_FRAME_HEIGHT: float(height),
        cv2.CAP_PROP_FPS: float(fps),
        cv2.CAP_PROP_FOURCC: float(fourcc_to_code(fourcc)),
        cv2.CAP_PROP_BUFFERSIZE: 1.0,
    }


def fake_camera(
    *,
    width: int = 1280,
    height: int = 720,
    fps: float = 60.0,
    fourcc: str = "MJPG",
    **device_options: object,
) -> FakeCaptureDevice:
    """Câmara simulada coerente: reporta e entrega a mesma resolução.

    Args:
        width: largura reportada **e** entregue.
        height: altura reportada **e** entregue.
        fps: FPS reportado pelo driver.
        fourcc: formato reportado pelo driver.
        device_options: restantes opções do `FakeCaptureDevice` (ex.: `echo_writes`).

    Returns:
        O dispositivo simulado.
    """
    return FakeCaptureDevice(
        properties=camera_properties(width=width, height=height, fps=fps, fourcc=fourcc),
        width=width,
        height=height,
        **device_options,  # type: ignore[arg-type]
    )


__all__ = [
    "FakeCaptureDevice",
    "FakeClock",
    "FakeSource",
    "camera_properties",
    "fake_camera",
    "make_source_info",
]
