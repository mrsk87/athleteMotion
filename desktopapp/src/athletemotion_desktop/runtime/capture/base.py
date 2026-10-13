"""Fontes de frames: o contrato comum e a base com thread de captura dedicada.

Duas razões para existir uma thread de captura própria (e não ler no consumidor):

1. **A captura nunca pode ser o gargalo.** O consumidor (pré-processamento → inferência)
   tem um orçamento de milissegundos por frame; se fosse ele a fazer `cap.read()`, o tempo
   de descodificação MJPG entrava nesse orçamento.
2. **Latência mínima exige descartar.** Entre dois `read()` do consumidor a câmara pode
   ter produzido vários frames. Guardar todos criaria uma fila que cresce sem fim e o
   *lag* acumulado deixaria de ser corrigível. A base guarda **apenas o último** e conta
   os que substituiu: é o *latest-frame-wins* que o protocolo do desktop exige (§3, regra 5).
"""

from __future__ import annotations

import logging
import threading
import time
from abc import ABC, abstractmethod
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Final, Literal, Protocol, runtime_checkable

import numpy as np

from athletemotion_desktop.runtime.capture.frame import Frame, PixelFormat, read_only_view

logger = logging.getLogger(__name__)

#: Quantos frames entram na medição de FPS efetivo (janela móvel).
FPS_WINDOW_SIZE: Final[int] = 60

#: Abaixo desta fração do FPS pedido, o valor real é reportado como aviso na `SourceInfo`.
FPS_WARNING_RATIO: Final[float] = 0.90

#: Leituras consecutivas com falha antes de se tentar reabrir o dispositivo.
FAILURES_BEFORE_RECONNECT: Final[int] = 3

#: Espera entre leituras falhadas, quando ainda não vale a pena reabrir.
FAILURE_RETRY_DELAY_S: Final[float] = 0.02

#: *Backoff* da reconexão: 0,5 s → 1 s → 2 s → 4 s (limitado).
BACKOFF_INITIAL_S: Final[float] = 0.5
BACKOFF_MAX_S: Final[float] = 4.0

#: Tentativas de reabertura antes de a fonte declarar falha definitiva.
DEFAULT_MAX_RECONNECT_ATTEMPTS: Final[int] = 5

#: Tempo máximo a esperar pelo primeiro frame ao abrir.
DEFAULT_OPEN_TIMEOUT_S: Final[float] = 8.0

#: Tempo máximo a esperar pela thread de captura no encerramento.
CLOSE_JOIN_TIMEOUT_S: Final[float] = 3.0


class CaptureState(StrEnum):
    """Estados possíveis de uma fonte de captura."""

    CLOSED = "closed"
    OPENING = "opening"
    READING = "reading"
    RECONNECTING = "reconnecting"
    FAILED = "failed"


class CaptureSourceError(RuntimeError):
    """Falha de uma fonte de captura, com contexto suficiente para o diagnóstico.

    Args:
        source_id: identificação da fonte.
        reason: explicação em PT-PT (o que falhou e o que era esperado).
    """

    def __init__(self, source_id: str, reason: str) -> None:
        super().__init__(f"[{source_id}] {reason}")
        self.source_id = source_id
        self.reason = reason


class CaptureOpenError(CaptureSourceError):
    """A fonte não pôde ser aberta (inexistente, ocupada ou sem frames)."""


@dataclass(frozen=True, slots=True)
class SourceInfo:
    """O que a fonte **realmente** entrega (nunca o que foi pedido).

    Attributes:
        source_id: identificação da fonte (`camera:0`, `file:clip.mp4`).
        kind: tipo de origem.
        width: largura efetiva em píxeis.
        height: altura efetiva em píxeis.
        fps: taxa de quadros efetiva (medida, quando já há amostras).
        requested_fps: taxa pedida na configuração, quando aplicável.
        pixel_format: formato dos píxeis entregues.
        fourcc: código FOURCC efetivo do dispositivo, quando legível.
        backend: backend de captura usado (ex.: `dshow`, `msmf`, `file`).
        frame_count: número de frames do ficheiro, quando aplicável.
        duration_s: duração do ficheiro em segundos, quando aplicável.
        warnings: avisos acumulados (resoluções/FPS divergentes, controlos não suportados).
    """

    source_id: str
    kind: Literal["camera", "file"]
    width: int
    height: int
    fps: float
    requested_fps: float | None
    pixel_format: PixelFormat
    fourcc: str | None
    backend: str | None
    frame_count: int | None = None
    duration_s: float | None = None
    warnings: tuple[str, ...] = ()

    @property
    def resolution(self) -> str:
        """Resolução efetiva como `1280x720`."""
        return f"{self.width}x{self.height}"


@dataclass(slots=True)
class CaptureStats:
    """Telemetria de uma fonte de captura.

    Attributes:
        frames_captured: frames obtidos do dispositivo.
        frames_delivered: frames devolvidos a `read()`.
        frames_dropped: frames capturados que o consumidor nunca leu (substituídos).
        read_failures: leituras falhadas do dispositivo.
        reconnects: reaberturas bem-sucedidas após falha.
        effective_fps: FPS efetivo medido na última janela.
    """

    frames_captured: int = 0
    frames_delivered: int = 0
    frames_dropped: int = 0
    read_failures: int = 0
    reconnects: int = 0
    effective_fps: float = 0.0


@runtime_checkable
class CaptureSource(Protocol):
    """Contrato mínimo que qualquer fonte de frames do projeto cumpre.

    Implementações: `CameraSource` (câmara USB) e `FileSource` (ficheiro de vídeo).
    Todas entregam `Frame` imutáveis com instante de captura e nunca bloqueiam o
    consumidor para além do `timeout_ms` pedido.
    """

    @property
    def state(self) -> CaptureState:
        """Estado atual da fonte."""
        ...

    def open(self, *, timeout_s: float | None = None) -> SourceInfo:
        """Abre a fonte e devolve o que ela realmente entrega."""
        ...

    def read(self, *, timeout_ms: int = 0) -> Frame | None:
        """Devolve o frame mais recente, ou `None` se não houver nenhum no prazo dado."""
        ...

    def close(self) -> None:
        """Liberta o dispositivo e os recursos associados (idempotente)."""
        ...

    def info(self) -> SourceInfo:
        """Informação atual da fonte (dimensões/FPS efetivos e avisos)."""
        ...


class ThreadedCaptureSource(ABC):
    """Base para fontes que capturam numa thread própria com *latest-frame-wins*.

    As subclasses implementam apenas três coisas: abrir o dispositivo
    (`_open_device`), preencher um buffer (`_read_into`) e libertá-lo
    (`_release_device`). A thread, o descarte, a medição de FPS, a reconexão com
    *backoff* e a máquina de estados ficam aqui — iguais para a câmara e para qualquer
    fonte futura (RTSP/NDI, por exemplo).

    Args:
        source_id: identificação da fonte.
        requested_fps: FPS pedido (usado nos avisos de divergência), se aplicável.
        pixel_format: formato entregue (por omissão BGR24, o do OpenCV).
        max_reconnect_attempts: reaberturas antes de declarar falha definitiva.
        open_timeout_s: tempo máximo a esperar pelo primeiro frame ao abrir.
    """

    def __init__(
        self,
        source_id: str,
        *,
        requested_fps: float | None = None,
        pixel_format: PixelFormat = PixelFormat.BGR24,
        max_reconnect_attempts: int = DEFAULT_MAX_RECONNECT_ATTEMPTS,
        open_timeout_s: float = DEFAULT_OPEN_TIMEOUT_S,
    ) -> None:
        self._source_id = source_id
        self._requested_fps = requested_fps
        self._pixel_format = pixel_format
        self._max_reconnect_attempts = max(0, max_reconnect_attempts)
        self._open_timeout_s = open_timeout_s

        self._state = CaptureState.CLOSED
        self._info: SourceInfo | None = None
        self._buffer: np.ndarray | None = None
        self._latest: Frame | None = None
        self._stats = CaptureStats()
        self._warnings: list[str] = []
        self._last_error: str | None = None
        self._frame_index = 0
        self._fps_warned = False

        self._condition = threading.Condition()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._state_listeners: list[Callable[[CaptureState, str], None]] = []
        self._capture_times: deque[int] = deque(maxlen=FPS_WINDOW_SIZE)

    # ------------------------------------------------------------------ contrato

    @property
    def state(self) -> CaptureState:
        """Estado atual da fonte."""
        return self._state

    @property
    def source_id(self) -> str:
        """Identificação da fonte."""
        return self._source_id

    @property
    def last_error(self) -> str | None:
        """Motivo da última falha, quando existir."""
        return self._last_error

    @property
    def has_frame(self) -> bool:
        """Indica se existe um frame capturado ainda não entregue."""
        with self._condition:
            return self._latest is not None

    def add_state_listener(self, listener: Callable[[CaptureState, str], None]) -> None:
        """Registra um observador de mudanças de estado.

        Args:
            listener: função chamada com o novo estado e uma descrição em PT-PT. É
                invocada fora dos *locks*, para que um observador lento não bloqueie a
                captura.
        """
        self._state_listeners.append(listener)

    def add_warning(self, warning: str) -> None:
        """Acrescenta um aviso (uma única vez) à informação da fonte.

        Args:
            warning: texto em PT-PT, com o valor recebido e o esperado.
        """
        with self._condition:
            if warning in self._warnings:
                return
            self._warnings.append(warning)
        logger.warning("Fonte '%s': %s", self._source_id, warning)

    def open(self, *, timeout_s: float | None = None) -> SourceInfo:
        """Abre o dispositivo e arranca a thread de captura.

        Args:
            timeout_s: tempo máximo a esperar pelo primeiro frame (por omissão o da
                construção da instância).

        Returns:
            A `SourceInfo` com os valores efetivos do dispositivo.

        Raises:
            CaptureOpenError: se o dispositivo não abrir ou não entregar nenhum frame
                dentro do prazo (a razão fica em `last_error`).
            CaptureSourceError: se a fonte já estiver aberta.
        """
        if self._state not in (CaptureState.CLOSED, CaptureState.FAILED):
            raise CaptureSourceError(
                self._source_id, f"a fonte já está aberta ({self._state.value})"
            )

        grace = self._open_timeout_s if timeout_s is None else timeout_s
        self._set_state(CaptureState.OPENING, "a abrir o dispositivo")
        try:
            info = self._open_device()
        except CaptureSourceError as exc:
            # A razão fica também em `last_error`: quem chama pode tratar a exceção e
            # ainda precisar de a mostrar (ou registar) mais tarde.
            self._last_error = exc.reason
            self._set_state(CaptureState.FAILED, exc.reason)
            raise

        self._info = info
        self._allocate_buffer(info)
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._capture_loop, name=f"capture-{self._source_id}", daemon=True
        )
        self._thread.start()

        deadline = time.perf_counter() + grace
        with self._condition:
            while self._latest is None and self._state not in (
                CaptureState.FAILED,
                CaptureState.CLOSED,
            ):
                remaining = deadline - time.perf_counter()
                if remaining <= 0:
                    break
                self._condition.wait(remaining)

        if self._latest is None:
            reason = (
                f"o dispositivo falhou ao abrir: {self._last_error}"
                if self._state is CaptureState.FAILED and self._last_error
                else (
                    f"nenhum frame em {grace:.1f} s ({info.resolution}); "
                    "verifique a ligação, o índice do dispositivo ou se está ocupado"
                )
            )
            self._stop_capture()
            self._set_state(CaptureState.FAILED, reason)
            raise CaptureOpenError(self._source_id, reason)

        self._last_error = None
        logger.info(
            "Fonte '%s' aberta: %s @ %.1f FPS (%s).",
            self._source_id,
            info.resolution,
            info.fps,
            info.backend or "backend por omissão",
        )
        return self.info()

    def read(self, *, timeout_ms: int = 0) -> Frame | None:
        """Devolve o frame **mais recente** disponível.

        Nunca devolve um frame mais antigo do que o último escrito: entre dois `read()`
        os frames intermédios são substituídos e contados em `frames_dropped`.

        Args:
            timeout_ms: espera máxima em milissegundos (0 = não bloqueia).

        Returns:
            O frame mais recente, ou `None` se não houver nenhum no prazo (fonte fechada,
            em falha ou sem frames novos).
        """
        deadline = time.perf_counter() + timeout_ms / 1000.0
        with self._condition:
            while self._latest is None:
                if self._state in (CaptureState.CLOSED, CaptureState.FAILED):
                    return None
                if timeout_ms <= 0:
                    return None
                remaining = deadline - time.perf_counter()
                if remaining <= 0:
                    return None
                self._condition.wait(remaining)
            frame = self._latest
            self._latest = None
            self._stats.frames_delivered += 1
            return frame

    def close(self) -> None:
        """Para a thread de captura e liberta o dispositivo (idempotente)."""
        self._stop_capture()
        with self._condition:
            self._latest = None
            self._condition.notify_all()
        self._set_state(CaptureState.CLOSED, "fonte fechada")

    def info(self) -> SourceInfo:
        """Informação atual da fonte, com o FPS efetivo já medido.

        Returns:
            A `SourceInfo` da abertura, atualizada com o FPS medido e os avisos
            acumulados (nunca com os valores pedidos por cima dos reais).

        Raises:
            CaptureSourceError: se a fonte nunca foi aberta.
        """
        if self._info is None:
            raise CaptureSourceError(self._source_id, "a fonte ainda não foi aberta")
        effective = self.effective_fps
        return replace(
            self._info,
            fps=effective if effective > 0 else self._info.fps,
            warnings=tuple(self._warnings),
        )

    def stats(self) -> CaptureStats:
        """Devolve um instantâneo da telemetria (incluindo o FPS efetivo)."""
        with self._condition:
            return CaptureStats(
                frames_captured=self._stats.frames_captured,
                frames_delivered=self._stats.frames_delivered,
                frames_dropped=self._stats.frames_dropped,
                read_failures=self._stats.read_failures,
                reconnects=self._stats.reconnects,
                effective_fps=self._compute_fps(),
            )

    @property
    def effective_fps(self) -> float:
        """FPS efetivo medido numa janela móvel (0.0 enquanto não há amostras)."""
        with self._condition:
            return self._compute_fps()

    # ------------------------------------------------------------------ hooks

    @abstractmethod
    def _open_device(self) -> SourceInfo:
        """Abre o dispositivo e devolve o que ele realmente entrega."""

    @abstractmethod
    def _read_into(self, buffer: np.ndarray) -> bool:
        """Preenche `buffer` com o frame seguinte.

        Args:
            buffer: buffer de destino, com a forma declarada em `_open_device`.

        Returns:
            `True` quando um frame foi escrito; `False` quando o dispositivo não
            entregou nada (câmara desconectada, por exemplo) — a base decide então se
            tenta reabrir.
        """

    @abstractmethod
    def _release_device(self) -> None:
        """Liberta o dispositivo (nunca levanta exceção)."""

    def _device_description(self) -> str:
        """Descrição curta do dispositivo para os avisos de reconexão."""
        return "dispositivo"

    # ------------------------------------------------------------------ internos

    def _allocate_buffer(self, info: SourceInfo) -> None:
        """Aloca o buffer reutilizado por todos os frames (sem alocação por frame)."""
        shape: tuple[int, ...] = (
            (info.height, info.width)
            if info.pixel_format is PixelFormat.GRAY8
            else (info.height, info.width, 3)
        )
        self._buffer = np.empty(shape, dtype=np.uint8)

    def _capture_loop(self) -> None:
        """Laço da thread de captura: ler, publicar, recuperar de falhas."""
        buffer = self._buffer
        assert buffer is not None  # garantido por `open()`
        consecutive_failures = 0
        attempt = 0
        while not self._stop.is_set():
            captured = False
            try:
                captured = self._read_into(buffer)
            except CaptureSourceError as exc:
                self._last_error = exc.reason
                logger.warning("Leitura falhou em '%s': %s", self._source_id, exc.reason)

            if captured:
                consecutive_failures = 0
                attempt = 0
                self._publish(buffer)
                continue

            with self._condition:
                self._stats.read_failures += 1
            consecutive_failures += 1
            if consecutive_failures < FAILURES_BEFORE_RECONNECT:
                # `wait` em vez de `sleep`: o encerramento interrompe a espera.
                self._stop.wait(FAILURE_RETRY_DELAY_S)
                continue

            if attempt >= self._max_reconnect_attempts:
                self._fail(
                    f"{self._device_description()} deixou de entregar frames e "
                    f"{self._max_reconnect_attempts} tentativas de reconexão falharam "
                    f"({self._last_error or 'sem detalhe'})"
                )
                return

            attempt += 1
            if self._reconnect(attempt - 1):
                consecutive_failures = 0
                buffer = self._buffer
                assert buffer is not None

    def _publish(self, buffer: np.ndarray) -> None:
        """Publica o frame acabado de capturar (substitui o anterior, se não lido)."""
        self._frame_index += 1
        captured_ns = time.perf_counter_ns()
        frame = Frame(
            index=self._frame_index,
            t_capture_ns=captured_ns,
            width=buffer.shape[1],
            height=buffer.shape[0],
            pixel_format=self._pixel_format,
            data=read_only_view(buffer),
            source_id=self._source_id,
        )
        became_reading = False
        slow_fps: float | None = None
        with self._condition:
            if self._latest is not None:
                # O consumidor não leu o frame anterior: fica registado como perdido, em
                # vez de invisível (é o número que mostra se o consumidor está atrasado).
                self._stats.frames_dropped += 1
            self._latest = frame
            self._stats.frames_captured += 1
            self._capture_times.append(captured_ns)
            if self._state is not CaptureState.READING:
                became_reading = True
                self._state = CaptureState.READING
            if (
                not self._fps_warned
                and self._requested_fps
                and len(self._capture_times) >= FPS_WINDOW_SIZE
            ):
                measured = self._compute_fps()
                if 0 < measured < FPS_WARNING_RATIO * self._requested_fps:
                    self._fps_warned = True
                    slow_fps = measured
            self._condition.notify_all()
        if became_reading:
            logger.debug("Fonte '%s': primeiro frame capturado.", self._source_id)
            self._notify_listeners(CaptureState.READING, "a capturar frames")
        if slow_fps is not None:
            # Aviso emitido fora do *lock* (o registo de avisos adquire-o). Uma câmara que
            # entrega 15 FPS quando se pediram 60 explica metade dos problemas de fluidez.
            self.add_warning(
                f"A taxa efetiva ({slow_fps:.1f} FPS) está abaixo de "
                f"{FPS_WARNING_RATIO:.0%} dos {self._requested_fps:.0f} FPS pedidos: "
                "o modo pedido pode não estar a ser respeitado pelo driver."
            )

    def _reconnect(self, attempt: int) -> bool:
        """Tenta reabrir o dispositivo com *backoff* exponencial.

        Args:
            attempt: número da tentativa (0 é a primeira).

        Returns:
            `True` se o dispositivo foi reaberto (o buffer pode ter sido realocado para
            a nova resolução), `False` se a tentativa falhou.
        """
        delay = min(BACKOFF_INITIAL_S * (2**attempt), BACKOFF_MAX_S)
        self._set_state(
            CaptureState.RECONNECTING,
            f"{self._device_description()} sem frames: nova tentativa em {delay:.1f} s",
        )
        # `Event.wait` em vez de `time.sleep`: o encerramento interrompe o *backoff*.
        if self._stop.wait(delay):
            return False

        self._release_safely()
        try:
            info = self._open_device()
        except CaptureSourceError as exc:
            # A causa-raiz (por exemplo, um frame com forma inesperada) é mais útil do que
            # "não abriu": só se regista a falha da reconexão quando ainda não há causa.
            if self._last_error is None:
                self._last_error = exc.reason
            logger.warning("Reconexão de '%s' falhou: %s", self._source_id, exc.reason)
            return False

        self._info = info
        if self._buffer is None or self._buffer.shape[:2] != (info.height, info.width):
            logger.info(
                "Reconexão de '%s' com resolução diferente: %s.",
                self._source_id,
                info.resolution,
            )
            self._allocate_buffer(info)
        with self._condition:
            self._stats.reconnects += 1
        logger.info("Fonte '%s' reconectada (%s).", self._source_id, info.resolution)
        return True

    def _fail(self, reason: str) -> None:
        """Declara a fonte em falha definitiva e acorda quem espera por frames."""
        if self._stop.is_set():
            self._release_safely()
            self.close()
            return
        self._last_error = reason
        self._release_safely()
        self._set_state(CaptureState.FAILED, reason)
        with self._condition:
            self._condition.notify_all()

    def _stop_capture(self) -> None:
        """Para a thread de captura e liberta o dispositivo (sem mudar de estado)."""
        self._stop.set()
        thread = self._thread
        self._thread = None
        if thread is not None and thread.is_alive():
            if thread is not threading.current_thread():
                thread.join(timeout=CLOSE_JOIN_TIMEOUT_S)
            if thread.is_alive():
                logger.warning(
                    "Thread de captura de '%s' não terminou em %.1f s.",
                    self._source_id,
                    CLOSE_JOIN_TIMEOUT_S,
                )
        self._release_safely()

    def _release_safely(self) -> None:
        """Liberta o dispositivo; uma falha de libertação é registada, nunca propagada.

        Um erro no `release` do driver não pode impedir o encerramento do processo, mas
        também não pode passar em silêncio: fica em `error` com a fonte identificada.
        """
        try:
            self._release_device()
        except Exception as exc:  # noqa: BLE001 - libertar recursos nunca propaga
            logger.error("Falha ao libertar '%s': %s", self._source_id, exc)

    def _compute_fps(self) -> float:
        """Calcula o FPS efetivo a partir da janela de instantes de captura."""
        if len(self._capture_times) < 2:
            return 0.0
        span_ns = self._capture_times[-1] - self._capture_times[0]
        if span_ns <= 0:
            return 0.0
        return (len(self._capture_times) - 1) * 1e9 / span_ns

    def _set_state(self, new_state: CaptureState, reason: str) -> None:
        """Muda o estado e notifica (notificação feita fora do *lock*)."""
        with self._condition:
            if self._state is new_state:
                return
            logger.debug(
                "Fonte '%s': %s → %s (%s)",
                self._source_id,
                self._state.value,
                new_state.value,
                reason,
            )
            self._state = new_state
            self._condition.notify_all()
        self._notify_listeners(new_state, reason)

    def _notify_listeners(self, new_state: CaptureState, reason: str) -> None:
        """Notifica os observadores; um observador que rebente não derruba a captura."""
        for listener in list(self._state_listeners):
            try:
                listener(new_state, reason)
            except Exception as exc:  # noqa: BLE001 - um observador não derruba a captura
                logger.error("Observador de estado de '%s' falhou: %s", self._source_id, exc)
