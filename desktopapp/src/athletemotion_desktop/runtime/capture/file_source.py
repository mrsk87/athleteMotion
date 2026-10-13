"""Leitura de ficheiros de vídeo como fonte de frames (análise e *batch*).

Diferenças de desenho face à câmara, e porquê:

- **Sem thread.** Numa câmara a thread existe para descartar frames que o consumidor não
  acompanha; num ficheiro isso destruiria a análise (um relatório não pode saltar frames
  porque o disco estava lento). Aqui o consumidor manda: cada `read()` devolve exatamente o
  frame seguinte, e `step(±n)` devolve exatamente o N-ésimo.
- **Ritmo opcional.** `realtime=True` reproduz a cadência do ficheiro (velocidade ajustável
  de 0,1× a 2×); `realtime=False` corre tão rápido quanto o disco permitir, que é o modo
  correto para analisar ou calibrar um vídeo inteiro.
- **`t_capture_ns` continua no relógio de parede** (o instante da leitura), para que a
  idade de um frame signifique a mesma coisa em qualquer fonte. A posição exata dentro do
  ficheiro é dada por `Frame.index`, que é o número do frame — não se perde informação.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import cv2
import numpy as np

from athletemotion_desktop.runtime.capture.base import (
    CaptureOpenError,
    CaptureSourceError,
    CaptureState,
    CaptureStats,
    SourceInfo,
)
from athletemotion_desktop.runtime.capture.device import CaptureDevice, open_file
from athletemotion_desktop.runtime.capture.frame import Frame, PixelFormat, read_only_view

logger = logging.getLogger(__name__)

#: Limites de velocidade de reprodução. Acima de 2× o consumidor deixa de acompanhar a
#: análise; abaixo de 0,1× é equivalente a passo manual.
MIN_SPEED: Final[float] = 0.1
MAX_SPEED: Final[float] = 2.0

#: FPS assumido quando o contentor não declara nenhum (raro, mas acontece em webm crus).
FALLBACK_FPS: Final[float] = 30.0


def _default_device_factory(path: str) -> CaptureDevice:
    """Abre um ficheiro de vídeo (fábrica de produção)."""
    return open_file(path)


@dataclass(frozen=True, slots=True)
class LoopRange:
    """Intervalo A-B de reprodução (frames inclusivos).

    Attributes:
        start_frame: primeiro frame do intervalo.
        end_frame: último frame do intervalo.
    """

    start_frame: int
    end_frame: int

    def __post_init__(self) -> None:
        """Valida a ordem do intervalo.

        Raises:
            ValueError: se o fim for anterior ao início.
        """
        if self.end_frame < self.start_frame:
            raise ValueError(
                f"intervalo A-B inválido: fim {self.end_frame} é anterior ao início "
                f"{self.start_frame}"
            )

    @property
    def frame_count(self) -> int:
        """Número de frames do intervalo (inclusivo)."""
        return self.end_frame - self.start_frame + 1


class FileSource:
    """Fonte de frames de um ficheiro de vídeo, com controlo exato de posição.

    Args:
        path: caminho do ficheiro de vídeo.
        realtime: quando `True`, respeita a cadência do ficheiro; quando `False`, lê o
            mais rápido possível (modo de análise).
        speed: velocidade de reprodução (0,1× a 2×) quando `realtime=True`.
        loop: intervalo A-B inicial, quando se quer repetir uma pedalada específica.
        device_factory: fábrica do dispositivo (testes injetam um simulado).
    """

    def __init__(
        self,
        path: Path | str,
        *,
        realtime: bool = True,
        speed: float = 1.0,
        loop: LoopRange | None = None,
        device_factory: Callable[[str], CaptureDevice] | None = None,
    ) -> None:
        self._path = Path(path)
        self._realtime = realtime
        self._device_factory = device_factory or _default_device_factory
        self._speed = 1.0
        self._validate_speed(speed)
        self._speed = speed

        self._state = CaptureState.CLOSED
        self._capture: CaptureDevice | None = None
        self._buffer: np.ndarray | None = None
        self._info: SourceInfo | None = None
        self._fps = 0.0
        self._frame_count = 0
        self._next_index = 0
        self._last_index = -1
        self._at_end = False
        self._loop: LoopRange | None = None
        self._stats = CaptureStats()
        self._wake = threading.Event()

        # Origem da cadência: instante de parede e índice do ficheiro a partir do qual se
        # conta. Reiniciada a cada `seek`, para que a cadência continue correta depois de
        # um salto (senão o motor acharia que o frame 5 000 já devia ter passado).
        self._pacing_origin_ns = 0
        self._pacing_origin_index = 0

        if loop is not None:
            self._loop = loop

    # ------------------------------------------------------------------ contrato

    @property
    def state(self) -> CaptureState:
        """Estado atual da fonte."""
        return self._state

    @property
    def source_id(self) -> str:
        """Identificação da fonte (`file:<nome>`)."""
        return f"file:{self._path.name}"

    @property
    def path(self) -> Path:
        """Caminho do ficheiro lido."""
        return self._path

    @property
    def index(self) -> int:
        """Índice do último frame devolvido (-1 antes do primeiro)."""
        return self._last_index

    @property
    def next_index(self) -> int:
        """Índice do frame que o próximo `read()` devolve."""
        return self._next_index

    @property
    def at_end(self) -> bool:
        """Indica se o ficheiro chegou ao fim (sem intervalo A-B ativo)."""
        return self._at_end

    @property
    def speed(self) -> float:
        """Velocidade de reprodução atual."""
        return self._speed

    @property
    def loop(self) -> LoopRange | None:
        """Intervalo A-B ativo, quando existe."""
        return self._loop

    def open(self, *, timeout_s: float | None = None) -> SourceInfo:
        """Abre o ficheiro e lê os seus metadados.

        Args:
            timeout_s: ignorado (um ficheiro local não bloqueia); existe para cumprir o
                mesmo contrato das câmaras.

        Returns:
            A `SourceInfo` com resolução, FPS declarado, número de frames e duração.

        Raises:
            CaptureOpenError: se o ficheiro não existir ou não puder ser descodificado.
        """
        del timeout_s  # contrato comum; não se aplica a ficheiros locais
        if self._state is not CaptureState.CLOSED:
            raise CaptureSourceError(
                self.source_id, f"a fonte já está aberta ({self._state.value})"
            )
        if not self._path.is_file():
            raise CaptureOpenError(self.source_id, f"o ficheiro '{self._path}' não existe")

        capture = self._device_factory(str(self._path))
        if not capture.isOpened():
            capture.release()
            raise CaptureOpenError(
                self.source_id,
                f"não foi possível descodificar '{self._path}' "
                "(formato não suportado ou ficheiro corrompido)",
            )

        self._capture = capture
        self._fps = float(capture.get(cv2.CAP_PROP_FPS))
        self._frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        width = round(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = round(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if width <= 0 or height <= 0:
            capture.release()
            self._capture = None
            raise CaptureOpenError(
                self.source_id,
                f"'{self._path}' não reporta resolução válida "
                f"(obtido {width}x{height}); o ficheiro pode estar truncado",
            )

        self._buffer = np.empty((height, width, 3), dtype=np.uint8)
        self._next_index = 0
        self._last_index = -1
        self._at_end = False
        self._stats = CaptureStats()
        self._reset_pacing()
        self._validate_loop_against_file()

        if self._fps <= 0:
            logger.warning(
                "O ficheiro '%s' não declara FPS: a cadência usa %.1f FPS por omissão.",
                self._path,
                FALLBACK_FPS,
            )

        declared_fps = self._fps if self._fps > 0 else FALLBACK_FPS
        self._info = SourceInfo(
            source_id=self.source_id,
            kind="file",
            width=width,
            height=height,
            fps=declared_fps,
            requested_fps=None,
            pixel_format=PixelFormat.BGR24,
            fourcc=None,
            backend="file",
            frame_count=self._frame_count,
            duration_s=(self._frame_count / declared_fps) if self._frame_count else None,
        )
        self._state = CaptureState.READING
        logger.info(
            "Ficheiro '%s' aberto: %s @ %.2f FPS, %d frames.",
            self._path.name,
            self._info.resolution,
            declared_fps,
            self._frame_count,
        )
        return self._info

    def read(self, *, timeout_ms: int = 0) -> Frame | None:
        """Devolve o frame seguinte do ficheiro.

        Args:
            timeout_ms: limite de espera da cadência em milissegundos (0 = sem limite). A
                semântica é "esperar até o frame estar no seu instante", não "desistir se
                não houver frame novo" — num ficheiro o frame seguinte existe sempre até ao
                fim.

        Returns:
            O frame seguinte, ou `None` no fim do ficheiro (ver `at_end`).
        """
        self._require_open()
        if self._at_end:
            return None
        if not self._wait_for_pacing(timeout_ms):
            return None
        return self._read_frame()

    def step(self, count: int = 1) -> Frame | None:
        """Avança ou recua exatamente `count` frames e devolve o frame de destino.

        Args:
            count: número de frames a mover (positivo avança, negativo recua).

        Returns:
            O frame de destino, ou `None` quando o destino está fora do ficheiro.

        Raises:
            ValueError: se `count` for 0 (não moveria nada e devolveria o frame atual,
                o que esconderia um erro de chamada).
        """
        self._require_open()
        if count == 0:
            raise ValueError("`step(0)` não move a posição: use `read()` para o frame atual")
        target = self._last_index + count
        if target < 0:
            raise CaptureSourceError(
                self.source_id,
                f"passo de {count} a partir do frame {self._last_index} sairia antes do "
                "início do ficheiro",
            )
        if not self.seek(frame=target):
            return None
        # `step` é análise, não reprodução: não faz sentido esperar pela cadência.
        return self._read_frame()

    def seek(self, *, frame: int | None = None, ms: float | None = None) -> bool:
        """Posiciona a fonte num frame (ou instante) do ficheiro.

        Args:
            frame: índice do frame de destino.
            ms: instante de destino em milissegundos (convertido em frame pelo FPS).

        Returns:
            `True` se a posição foi aplicada e confirmada pelo descodificador.

        Raises:
            CaptureSourceError: se a fonte não estiver aberta, se nenhum destino (ou
                ambos) for indicado, ou se o destino estiver fora do ficheiro.
        """
        self._require_open()
        if (frame is None) == (ms is None):
            raise CaptureSourceError(
                self.source_id, "indique exatamente um destino: `frame` ou `ms`"
            )

        if frame is None:
            assert ms is not None
            fps = self._fps if self._fps > 0 else FALLBACK_FPS
            frame = round(ms * fps / 1000.0)

        assert frame is not None
        if frame < 0 or (self._frame_count > 0 and frame >= self._frame_count):
            upper = self._frame_count - 1 if self._frame_count > 0 else "desconhecido"
            raise CaptureSourceError(
                self.source_id,
                f"frame {frame} está fora do ficheiro (intervalo válido: 0..{upper})",
            )

        capture = self._require_capture()
        applied = capture.set(cv2.CAP_PROP_POS_FRAMES, float(frame))
        reported = int(capture.get(cv2.CAP_PROP_POS_FRAMES))
        if reported != frame:
            # Alguns descodificadores ajustam para o *keyframe* anterior. Seguir o que o
            # dispositivo reporta (e dizê-lo) é a única forma honesta de garantir que
            # `step` devolve o frame certo.
            logger.warning(
                "O descodificador posicionou-se no frame %d em vez de %d (pedido).",
                reported,
                frame,
            )
        if not applied and reported != frame:
            return False

        self._next_index = reported
        self._last_index = reported - 1
        self._at_end = False
        self._reset_pacing()
        return True

    def set_speed(self, speed: float) -> None:
        """Altera a velocidade de reprodução em tempo real.

        Args:
            speed: nova velocidade (0,1× a 2×).

        Raises:
            ValueError: se a velocidade estiver fora dos limites suportados.
        """
        self._validate_speed(speed)
        self._speed = speed
        # Reancorar sem salto: a partir de agora a cadência conta do frame que vai sair.
        self._reset_pacing()

    def set_loop(self, loop: LoopRange | None) -> None:
        """Ativa ou desativa um intervalo A-B.

        Ativar um intervalo **posiciona a fonte no início dele**: quem marca uma pedalada
        (A) e um fim (B) espera ver exatamente essa pedalada a seguir, não o resto do
        vídeo até lá chegar.

        Args:
            loop: intervalo a repetir, ou `None` para desativar.

        Raises:
            CaptureSourceError: se o intervalo não estiver aberto ou sair fora do ficheiro.
        """
        self._require_open()
        self._loop = loop
        self._validate_loop_against_file()
        if loop is not None:
            self.seek(frame=loop.start_frame)

    def clear_loop(self) -> None:
        """Desativa o intervalo A-B (a reprodução continua até ao fim)."""
        self._loop = None

    def close(self) -> None:
        """Fecha o ficheiro e liberta o buffer (idempotente)."""
        capture = self._capture
        self._capture = None
        self._buffer = None
        if capture is not None:
            capture.release()
        # Acorda quem estiver à espera da cadência, para o encerramento não ficar preso.
        self._wake.set()
        if self._state is not CaptureState.CLOSED:
            self._state = CaptureState.CLOSED
            logger.debug("Fonte '%s' fechada.", self.source_id)

    def info(self) -> SourceInfo:
        """Informação do ficheiro aberto.

        Raises:
            CaptureSourceError: se ainda não foi aberto.
        """
        if self._info is None:
            raise CaptureSourceError(self.source_id, "a fonte ainda não foi aberta")
        return self._info

    def stats(self) -> CaptureStats:
        """Telemetria da leitura (frames lidos e entregues)."""
        return CaptureStats(
            frames_captured=self._stats.frames_captured,
            frames_delivered=self._stats.frames_delivered,
            frames_dropped=0,
            read_failures=self._stats.read_failures,
            reconnects=0,
            effective_fps=self._fps if self._fps > 0 else FALLBACK_FPS,
        )

    # ------------------------------------------------------------------ internos

    def _require_open(self) -> None:
        """Falha explicitamente se a fonte não estiver aberta."""
        if self._state is not CaptureState.READING or self._capture is None:
            raise CaptureSourceError(self.source_id, "a fonte não está aberta")

    def _require_capture(self) -> CaptureDevice:
        """Devolve o dispositivo aberto (uso interno após `_require_open`)."""
        assert self._capture is not None
        return self._capture

    def _validate_speed(self, speed: float) -> None:
        """Valida a velocidade pedida.

        Raises:
            ValueError: se estiver fora de `MIN_SPEED…MAX_SPEED`.
        """
        if not MIN_SPEED <= speed <= MAX_SPEED:
            raise ValueError(
                f"velocidade {speed} fora do intervalo suportado ({MIN_SPEED}–{MAX_SPEED}×)"
            )

    def _validate_loop_against_file(self) -> None:
        """Confirma que o intervalo A-B cabe no ficheiro aberto.

        Raises:
            CaptureSourceError: se o intervalo sair fora do ficheiro.
        """
        loop = self._loop
        if loop is None or self._frame_count <= 0:
            return
        if loop.end_frame >= self._frame_count:
            raise CaptureSourceError(
                self.source_id,
                f"intervalo A-B até ao frame {loop.end_frame} ultrapassa o ficheiro "
                f"({self._frame_count} frames, últimos índices 0..{self._frame_count - 1})",
            )

    def _reset_pacing(self) -> None:
        """Reancora a cadência no instante e no frame atuais."""
        self._pacing_origin_ns = time.perf_counter_ns()
        self._pacing_origin_index = self._next_index
        self._wake.clear()

    def _wait_for_pacing(self, timeout_ms: int) -> bool:
        """Espera até o próximo frame estar no seu instante de reprodução.

        Args:
            timeout_ms: limite de espera (0 = sem limite).

        Returns:
            `True` quando se pode ler; `False` quando o limite foi atingido ou a fonte
            foi fechada durante a espera.
        """
        if not self._realtime:
            return True
        fps = self._fps if self._fps > 0 else FALLBACK_FPS
        frame_offset = self._next_index - self._pacing_origin_index
        due_ns = self._pacing_origin_ns + int(frame_offset * 1e9 / (fps * self._speed))
        remaining_s = (due_ns - time.perf_counter_ns()) / 1e9
        if remaining_s <= 0:
            return True
        if timeout_ms > 0 and remaining_s * 1000.0 > timeout_ms:
            return False
        # `Event.wait` (em vez de `sleep`) para o encerramento interromper a espera.
        return not self._wake.wait(remaining_s)

    def _read_frame(self) -> Frame | None:
        """Lê o frame na posição atual e devolve-o como `Frame` imutável."""
        capture = self._require_capture()
        buffer = self._buffer
        assert buffer is not None  # garantido por `open()`

        if self._loop is not None and self._next_index > self._loop.end_frame:
            self.seek(frame=self._loop.start_frame)
            capture = self._require_capture()

        ok, frame = capture.read(buffer)
        if not ok:
            self._at_end = True
            logger.debug("Fim do ficheiro '%s' no frame %d.", self._path.name, self._next_index)
            return None

        if frame is not buffer and not np.shares_memory(frame, buffer):
            if frame.shape != buffer.shape:
                # Resolução que muda a meio do ficheiro: raro, mas acontece em contentores
                # concatenados. Falhar é melhor do que devolver píxeis truncados.
                self._stats.read_failures += 1
                raise CaptureSourceError(
                    self.source_id,
                    f"o ficheiro mudou de resolução no frame {self._next_index}: "
                    f"{frame.shape} em vez de {buffer.shape}",
                )
            np.copyto(buffer, frame)

        index = self._next_index
        frame_result = Frame(
            index=index,
            t_capture_ns=time.perf_counter_ns(),
            width=buffer.shape[1],
            height=buffer.shape[0],
            pixel_format=PixelFormat.BGR24,
            data=read_only_view(buffer),
            source_id=self.source_id,
        )
        self._next_index += 1
        self._last_index = index
        self._stats.frames_captured += 1
        self._stats.frames_delivered += 1
        return frame_result
