"""Leitura de câmaras USB/UVC através do OpenCV (`DirectShow` ou `Media Foundation`).

O que este módulo faz de diferente de um `cv2.VideoCapture` cru:

- **Configura e verifica.** Pedir 1920×1080@60 não garante 1920×1080@60: a câmara aceita o
  modo mais próximo (ou ignora o pedido). Os valores **reais** são lidos de volta e as
  divergências viajam como avisos na `SourceInfo` — o autotune (R14) e a UI decidem com
  números verdadeiros.
- **Não acumula latência.** `CAP_PROP_BUFFERSIZE=1` pede ao driver que descarte frames
  antigos, e a base guarda apenas o último — uma fila de frames seria *lag* irrecuperável.
- **Reconecta sozinha.** Uma câmara USB que se desliga a meio de uma sessão (cabo, hub,
  suspensão do Windows) não pode obrigar a reiniciar a aplicação: a fonte entra em
  `RECONNECTING`, tenta reabrir com *backoff* e volta a ler com os mesmos controlos.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy as np

from athletemotion_desktop.runtime.capture.base import (
    CaptureOpenError,
    CaptureSourceError,
    SourceInfo,
    ThreadedCaptureSource,
)
from athletemotion_desktop.runtime.capture.controls import (
    CameraControl,
    CameraPreset,
    ControlCapability,
    apply_preset,
    capture_preset,
    lock_exposure,
    probe_controls,
    set_control,
)
from athletemotion_desktop.runtime.capture.device import (
    CAMERA_BACKEND_LABELS,
    CameraBackend,
    CaptureDevice,
    fourcc_to_code,
    fourcc_to_text,
    open_camera,
)
from athletemotion_desktop.runtime.capture.frame import PixelFormat

logger = logging.getLogger(__name__)

#: Código FOURCC com que se pede compressão na câmara: sem MJPG, o UVC entrega
#: JPEG/YUYV não comprimido e 720p60 não cabe no orçamento da porta USB.
DEFAULT_FOURCC: Final[str] = "MJPG"

#: Frames antigos que o driver pode guardar. 1 = só o mais recente.
DEFAULT_BUFFER_SIZE: Final[int] = 1


@dataclass(frozen=True, slots=True)
class CameraConfig:
    """Configuração pedida a uma câmara (o que se pede, não o que se obtém).

    Attributes:
        index: índice do dispositivo no sistema.
        width: largura pretendida em píxeis.
        height: altura pretendida em píxeis.
        fps: taxa de quadros pretendida.
        fourcc: compressão pretendida (`MJPG` por omissão).
        backend: backend do OpenCV a usar.
        buffer_size: frames que o driver pode guardar internamente.
        lock_exposure_on_open: travar a exposição ao abrir (evita variabilidade entre frames).
        max_reconnect_attempts: reaberturas antes de declarar falha definitiva.
        open_timeout_s: tempo máximo a esperar pelo primeiro frame.
    """

    index: int = 0
    width: int = 1280
    height: int = 720
    fps: int = 60
    fourcc: str = DEFAULT_FOURCC
    backend: CameraBackend = CameraBackend.DSHOW
    buffer_size: int = DEFAULT_BUFFER_SIZE
    lock_exposure_on_open: bool = False
    max_reconnect_attempts: int = 5
    open_timeout_s: float = 8.0

    @property
    def resolution(self) -> str:
        """Resolução pedida como `1280x720`."""
        return f"{self.width}x{self.height}"


class CameraSource(ThreadedCaptureSource):
    """Fonte de frames de uma câmara, com valores reais, controlos e reconexão.

    Args:
        config: configuração pedida à câmara.
        device_factory: fábrica do dispositivo (nos testes injeta-se um simulado; em
            produção abre um `cv2.VideoCapture`).
    """

    def __init__(
        self,
        config: CameraConfig | None = None,
        *,
        device_factory: Callable[[int, CameraBackend], CaptureDevice] | None = None,
    ) -> None:
        self._config = config or CameraConfig()
        super().__init__(
            f"camera:{self._config.index}",
            requested_fps=float(self._config.fps),
            max_reconnect_attempts=self._config.max_reconnect_attempts,
            open_timeout_s=self._config.open_timeout_s,
        )
        self._device_factory = device_factory or open_camera
        self._device: CaptureDevice | None = None
        self._capabilities: dict[CameraControl, ControlCapability] = {}

    @property
    def config(self) -> CameraConfig:
        """Configuração pedida à câmara."""
        return self._config

    @property
    def capabilities(self) -> Mapping[CameraControl, ControlCapability]:
        """Controlos verificados do dispositivo (vazio antes da primeira abertura)."""
        return dict(self._capabilities)

    # ------------------------------------------------------------------ controlos

    def set_control(self, control: CameraControl, value: float) -> bool:
        """Aplica um valor a um controlo suportado.

        Args:
            control: controlo a alterar.
            value: valor pretendido.

        Returns:
            `True` quando o driver aceitou a escrita.

        Raises:
            CaptureSourceError: se o dispositivo não estiver aberto.
        """
        return set_control(self._require_device(), self._capabilities, control, value)

    def lock_exposure(self) -> float | None:
        """Trava a exposição no valor atual da automática.

        Returns:
            O valor fixado, ou `None` quando o dispositivo não permite controlar a
            exposição (caso comum em webcams — fica reportado, não inventado).
        """
        value = lock_exposure(self._require_device(), self._capabilities)
        if value is None:
            self.add_warning(
                "A exposição automática desta câmara não pode ser desligada: "
                "o brilho dos frames pode variar durante a sessão."
            )
        return value

    def save_preset(self, name: str) -> CameraPreset:
        """Fotografa os controlos suportados num preset reutilizável.

        Args:
            name: nome do preset.

        Returns:
            O preset criado (não é gravado em disco aqui; ver `controls.save_presets`).
        """
        return capture_preset(name, self.source_id, self._capabilities)

    def apply_preset(self, preset: CameraPreset) -> tuple[CameraControl, ...]:
        """Aplica um preset devolvendo os controlos que não puderam ser aplicados."""
        return apply_preset(self._require_device(), self._capabilities, preset)

    # ------------------------------------------------------------------ hooks

    def _require_device(self) -> CaptureDevice:
        """Devolve o dispositivo aberto, falhando de forma explícita se não existir."""
        if self._device is None:
            raise CaptureSourceError(self.source_id, "a câmara não está aberta")
        return self._device

    def _open_device(self) -> SourceInfo:
        """Abre a câmara, aplica a configuração pedida e lê o que ela realmente entrega.

        Returns:
            A `SourceInfo` com resolução, FPS e FOURCC **efetivos**, mais os avisos de
            divergência face ao pedido.

        Raises:
            CaptureOpenError: se o índice não corresponder a nenhuma câmara utilizável.
        """
        device = self._device_factory(self._config.index, self._config.backend)
        self._device = device
        if not device.isOpened():
            device.release()
            self._device = None
            raise CaptureOpenError(
                self.source_id,
                f"não foi possível abrir a câmara no índice {self._config.index} "
                f"com {CAMERA_BACKEND_LABELS[self._config.backend]} "
                "(índice errado, câmara em uso por outra aplicação ou sem permissão)",
            )

        device.set(cv2.CAP_PROP_FOURCC, float(fourcc_to_code(self._config.fourcc.strip()[:4])))
        device.set(cv2.CAP_PROP_FRAME_WIDTH, float(self._config.width))
        device.set(cv2.CAP_PROP_FRAME_HEIGHT, float(self._config.height))
        device.set(cv2.CAP_PROP_FPS, float(self._config.fps))
        # Pede ao driver que não acumule frames antigos (latência irrecuperável).
        device.set(cv2.CAP_PROP_BUFFERSIZE, float(self._config.buffer_size))

        real_width = round(device.get(cv2.CAP_PROP_FRAME_WIDTH))
        real_height = round(device.get(cv2.CAP_PROP_FRAME_HEIGHT))
        real_fps = float(device.get(cv2.CAP_PROP_FPS))
        real_fourcc = fourcc_to_text(device.get(cv2.CAP_PROP_FOURCC))
        # Lido para ficar no registo: um buffer interno grande explica *lag* súbito sem
        # qualquer outro sintoma visível.
        driver_buffer = round(device.get(cv2.CAP_PROP_BUFFERSIZE))

        self._warn_about_divergences(real_width, real_height, real_fps, real_fourcc, driver_buffer)

        if not self._capabilities:
            self._capabilities = probe_controls(device)
        if self._config.lock_exposure_on_open:
            self.lock_exposure()

        return SourceInfo(
            source_id=self.source_id,
            kind="camera",
            width=real_width or self._config.width,
            height=real_height or self._config.height,
            fps=real_fps if real_fps > 0 else float(self._config.fps),
            requested_fps=float(self._config.fps),
            pixel_format=PixelFormat.BGR24,
            fourcc=real_fourcc,
            backend=self._config.backend.value,
        )

    def _read_into(self, buffer: np.ndarray) -> bool:
        """Lê o frame seguinte para o buffer da base.

        Args:
            buffer: buffer de destino (forma já validada em `_open_device`).

        Returns:
            `True` se um frame foi escrito; `False` se a câmara não entregou nada.

        Raises:
            CaptureSourceError: se o driver escrever um frame com forma inesperada
                (mudança de resolução sem reconexão), em vez de entregar píxeis truncados.
        """
        device = self._require_device()
        ok, frame = device.read(buffer)
        if not ok:
            return False
        if frame is not buffer and not np.shares_memory(frame, buffer):
            # Alguns backends ignoram o buffer fornecido e devolvem um frame novo.
            if frame.shape != buffer.shape:
                raise CaptureSourceError(
                    self.source_id,
                    f"a câmara passou a entregar {frame.shape} em vez de {buffer.shape} "
                    "sem reconexão: a mudança de modo tem de ser reaberta",
                )
            np.copyto(buffer, frame)
        return True

    def _release_device(self) -> None:
        """Fecha o dispositivo e esquece os controlos (mudam com a reabertura)."""
        device = self._device
        self._device = None
        if device is not None:
            device.release()

    def _device_description(self) -> str:
        """Descrição do dispositivo usada nos avisos de reconexão."""
        return f"a câmara {self._config.index}"

    def _warn_about_divergences(
        self,
        real_width: int,
        real_height: int,
        real_fps: float,
        real_fourcc: str | None,
        driver_buffer: int,
    ) -> None:
        """Compara o pedido com o obtido e regista cada divergência como aviso.

        Args:
            real_width: largura efetiva lida do dispositivo.
            real_height: altura efetiva lida do dispositivo.
            real_fps: FPS efetivo declarado pelo driver.
            real_fourcc: FOURCC efetivo, quando legível.
            driver_buffer: tamanho do buffer interno reportado pelo driver.
        """
        if (real_width, real_height) != (self._config.width, self._config.height):
            self.add_warning(
                f"A câmara entregou {real_width}x{real_height} em vez de "
                f"{self._config.resolution}: foi aplicado o modo mais próximo suportado."
            )
        if real_fps > 0 and self._config.fps > 0 and abs(real_fps - self._config.fps) > 0.5:
            self.add_warning(
                f"A câmara declarou {real_fps:.1f} FPS em vez dos {self._config.fps} pedidos."
            )
        if real_fourcc is not None and real_fourcc.upper() != self._config.fourcc.upper():
            self.add_warning(
                f"A câmara usa o formato '{real_fourcc}' em vez de '{self._config.fourcc}': "
                "sem compressão na câmara a 720p60 a ligação USB pode não ter largura de banda."
            )
        if driver_buffer > self._config.buffer_size:
            self.add_warning(
                f"O driver mantém um buffer de {driver_buffer} frames "
                f"(pedido {self._config.buffer_size}): acrescenta latência fixa."
            )


def measure_camera(
    config: CameraConfig,
    seconds: float,
    *,
    device_factory: Callable[[int, CameraBackend], CaptureDevice] | None = None,
) -> tuple[SourceInfo, float, int, int, int]:
    """Abre a câmara, mede o FPS efetivo durante `seconds` e fecha-a.

    Args:
        config: configuração pedida.
        seconds: duração da medição.
        device_factory: fábrica do dispositivo (testes).

    Returns:
        A `SourceInfo` final, o FPS efetivo medido, os frames capturados, os entregues e
        os descartados.
    """
    source = CameraSource(config, device_factory=device_factory)
    source.open()
    try:
        # Consome os frames como o pipeline faria: se aqui se lesse tudo de imediato, a
        # medição diria que a câmara entrega tudo o que capta (não é o caso real).
        deadline = time.perf_counter() + seconds
        while time.perf_counter() < deadline:
            source.read(timeout_ms=100)
        stats = source.stats()
        return (
            source.info(),
            stats.effective_fps,
            stats.frames_captured,
            stats.frames_delivered,
            stats.frames_dropped,
        )
    finally:
        source.close()


def _parse_size(text: str) -> tuple[int, int]:
    """Interpreta `1280x720` numa resolução.

    Raises:
        argparse.ArgumentTypeError: se o formato não for `LARGURAxALTURA`.
    """
    parts = text.lower().split("x")
    if len(parts) != 2 or not all(part.isdigit() for part in parts):
        raise argparse.ArgumentTypeError(f"resolução inválida '{text}' (esperado LARGURAxALTURA)")
    return int(parts[0]), int(parts[1])


def build_argument_parser() -> argparse.ArgumentParser:
    """Constrói o analisador de argumentos da medição de câmara por CLI."""
    parser = argparse.ArgumentParser(
        prog="python -m athletemotion_desktop.runtime.capture.camera",
        description=(
            "Abre uma câmara, aplica a configuração pedida e mede o que ela realmente entrega."
        ),
    )
    parser.add_argument("--index", type=int, default=0, help="índice da câmara (por omissão 0)")
    parser.add_argument(
        "--fourcc", default=DEFAULT_FOURCC, help="compressão pedida (por omissão MJPG)"
    )
    parser.add_argument(
        "--size", type=_parse_size, default=(1280, 720), help="resolução pretendida"
    )
    parser.add_argument("--fps", type=int, default=60, help="FPS pretendido")
    parser.add_argument(
        "--backend",
        choices=[backend.value for backend in CameraBackend],
        default=CameraBackend.DSHOW.value,
        help="backend do OpenCV (por omissão DirectShow)",
    )
    parser.add_argument("--seconds", type=float, default=10.0, help="duração da medição")
    parser.add_argument(
        "--lock-exposure",
        action="store_true",
        help="travar a exposição no valor atual da automática",
    )
    parser.add_argument("--list", action="store_true", help="listar as câmaras e sair")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Ponto de entrada da medição de câmara por CLI.

    Args:
        argv: argumentos (por omissão os da linha de comandos).

    Returns:
        Código de saída: 0 em sucesso, 1 quando a câmara não abre ou não entrega frames.
    """
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    arguments = build_argument_parser().parse_args(argv)

    if arguments.list:
        from athletemotion_desktop.runtime.capture.devices import print_devices

        return print_devices()

    width, height = arguments.size
    config = CameraConfig(
        index=arguments.index,
        width=width,
        height=height,
        fps=arguments.fps,
        fourcc=arguments.fourcc,
        backend=CameraBackend(arguments.backend),
        lock_exposure_on_open=bool(arguments.lock_exposure),
    )

    try:
        info, measured_fps, captured, delivered, dropped = measure_camera(config, arguments.seconds)
    except CaptureOpenError as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return 1

    print(
        f"câmara {arguments.index}: {info.resolution} @ {info.fps:.1f} FPS "
        f"({info.fourcc or 'formato não reportado'}, {info.backend})"
    )
    print(
        f"medido em {arguments.seconds:.1f} s: {measured_fps:.1f} FPS efetivos, "
        f"{captured} capturados, {delivered} entregues, {dropped} descartados "
        "(descartados = consumidor mais lento que a câmara)"
    )
    for warning in info.warnings:
        print(f"aviso: {warning}")
    return 0 if captured > 0 else 1


if __name__ == "__main__":  # pragma: no cover - entrada de CLI
    sys.exit(main())
