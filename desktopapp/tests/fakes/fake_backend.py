"""Motor de inferência falso: latência, falhas e restrições do hardware, controladas.

O que este dobre reproduz não é o resultado da inferência (isso é do domínio), mas o
**comportamento** que o pipeline tem de saber tolerar:

- latência configurável (para medir *backpressure*, idade do resultado e FPS efetivo);
- falha a meio da série (para o watchdog e o estado `DEGRADED`);
- travamento que não devolve nada (para provar que a UI não bloqueia);
- **uma passagem de inferência de cada vez** — como o DirectML, que não suporta `Run()`
  concorrente na mesma sessão (`README_PLAN` §4.1). Um pipeline que paralelize a mesma
  sessão falha aqui de forma determinística, em vez de corromper resultados no PC alvo.

Implementa o `InferenceBackend` do próprio projeto (`runtime/backends/base.py`), pelo que
substituir o motor falso pelo real não exige mudar o pipeline.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Final

import numpy as np
import numpy.typing as npt

from tests.fakes.synthetic import synthetic_landmark_sequence

FloatTensor = npt.NDArray[np.float32]

#: Número de landmarks do modelo principal de bikefit (RTMPose Halpe26).
DEFAULT_LANDMARK_COUNT: Final[int] = 26


class FakeBackendError(RuntimeError):
    """Falha injetada no motor falso (o análogo a um erro do runtime ONNX)."""


class ConcurrentInferenceError(FakeBackendError):
    """Duas passagens de inferência em simultâneo na mesma sessão.

    O DirectML não o permite; o motor falso também não, e falha alto para que o defeito
    apareça num teste e não no hardware do utilizador.
    """


def pose_outputs(landmarks: npt.ArrayLike) -> list[FloatTensor]:
    """Empacota landmarks em `[1, N, 3]` (formato de conveniência da pose).

    Args:
        landmarks: array ou sequência de `(x, y, confiança)`.

    Returns:
        Lista com um único tensor `float32` de forma `(1, N, 3)`.
    """
    array: FloatTensor = np.asarray(landmarks, dtype=np.float32)
    if array.ndim != 2 or array.shape[1] != 3:
        raise ValueError(
            f"Landmarks deviam ter forma (N, 3) — (x, y, confiança) — mas têm {array.shape}."
        )
    return [array.reshape(1, *array.shape)]


@dataclass
class FakeBackendStats:
    """Contadores do motor falso, para asserções sobre o que o pipeline fez.

    Attributes:
        loads: chamadas a `load_model`.
        inferences: chamadas a `infer` que chegaram ao fim.
        failures: chamadas a `infer` que terminaram em falha injetada.
        releases: chamadas a `release`.
        max_concurrent: número máximo de inferências simultâneas observado.
        last_tensor_shape: forma do último tensor recebido.
    """

    loads: int = 0
    inferences: int = 0
    failures: int = 0
    releases: int = 0
    max_concurrent: int = 0
    last_tensor_shape: tuple[int, ...] | None = None


@dataclass
class FakeBackend:
    """Motor de inferência falso, determinístico e configurável.

    Args:
        name: nome reportado pelo motor (aparece no diagnóstico/telemetria).
        latency_s: latência simulada de cada `infer`.
        available: resposta de `is_available` (para testar o caminho \"sem GPU\").
        fail_after: número de inferências bem-sucedidas antes de começar a falhar;
            `None` desativa a falha.
        failure: exceção a lançar quando a falha é injetada.
        stall_event: quando definido, `infer` fica bloqueado até o evento ser libertado
            (simula o driver preso). O travamento respeita o `wait`, pelo que o teste
            pode libertá-lo no fim e nunca fica preso a limpar recursos.
        landmark_count: número de landmarks dos resultados por omissão.
        enforce_single_session: recusa inferências concorrentes (como o DirectML).
        output_factory: substitui a construção dos resultados por omissão.
    """

    name: str = "fake"
    latency_s: float = 0.0
    available: bool = True
    fail_after: int | None = None
    failure: BaseException | None = None
    stall_event: threading.Event | None = None
    landmark_count: int = DEFAULT_LANDMARK_COUNT
    enforce_single_session: bool = True
    output_factory: Callable[[FloatTensor], list[FloatTensor]] | None = None
    stats: FakeBackendStats = field(default_factory=FakeBackendStats)

    def __post_init__(self) -> None:
        """Prepara o estado interno de sincronização."""
        self._active = 0
        self._guard = threading.Lock()
        self._pose_cache: FloatTensor | None = None
        self._released = False
        self.last_model_path: str | None = None

    # ------------------------------------------------------------- protocolo

    @property
    def is_available(self) -> bool:
        """Indica se este motor pode ser usado (a resposta é configurável)."""
        return self.available and not self._released

    def load_model(self, model_path: str) -> None:
        """Registra o carregamento do modelo.

        Args:
            model_path: caminho que o pipeline pediu (é guardado para asserções).

        Raises:
            FakeBackendError: se o motor estiver indisponível.
        """
        if not self.available:
            raise FakeBackendError(
                f"O motor '{self.name}' está marcado como indisponível; nenhum modelo "
                f"pode ser carregado (pedido: {model_path})."
            )
        self.last_model_path = model_path
        self.stats.loads += 1

    def infer(self, tensor: FloatTensor) -> list[FloatTensor]:
        """Devolve a pose sintética do frame, com a latência configurada.

        Args:
            tensor: tensor de entrada `(B, C, H, W)` já pré-processado.

        Returns:
            Lista com o tensor de landmarks `(1, N, 3)`.

        Raises:
            ConcurrentInferenceError: quando duas passagens se sobrepõem e o motor
                impõe o modelo de sessão única (o comportamento do DirectML).
            FakeBackendError: quando a falha injetada é acionada.
        """
        if self._released:
            raise FakeBackendError(f"O motor '{self.name}' foi libertado e já não aceita trabalho.")
        if tensor.ndim != 4:
            raise ValueError(
                f"O motor '{self.name}' espera um tensor (B, C, H, W); recebeu {tensor.shape}."
            )
        self._enter()
        try:
            self.stats.last_tensor_shape = tuple(int(size) for size in tensor.shape)
            if self.stall_event is not None:
                self.stall_event.wait(timeout=30.0)  # pragma: no cover - libertado pelo teste
            if self.latency_s > 0:
                time.sleep(self.latency_s)
            if self.fail_after is not None and self.stats.inferences >= self.fail_after:
                self.stats.failures += 1
                raise self.failure or FakeBackendError(
                    f"Falha simulada do motor '{self.name}' "
                    f"(após {self.stats.inferences} inferências válidas)."
                )
            self.stats.inferences += 1
            if self.output_factory is not None:
                return self.output_factory(tensor)
            return pose_outputs(self._synthetic_pose())
        finally:
            self._exit()

    def release(self) -> None:
        """Fecha o motor, marcando-o como indisponível para trabalho novo."""
        self.stats.releases += 1
        self._released = True

    # ------------------------------------------------------------- auxiliares

    def _synthetic_pose(self) -> FloatTensor:
        """Pose sintética estável (é calculada uma vez: o falso não deve ser caro)."""
        if self._pose_cache is None:
            sequence = synthetic_landmark_sequence(1, landmark_count=self.landmark_count)
            self._pose_cache = sequence[0]
        return self._pose_cache

    def _enter(self) -> None:
        """Registra o início de uma inferência, recusando sobreposições quando exigido."""
        with self._guard:
            if self.enforce_single_session and self._active > 0:
                raise ConcurrentInferenceError(
                    "Duas passagens de inferência em simultâneo na mesma sessão "
                    f"(motor '{self.name}'): o DirectML não o permite e o pipeline deve "
                    "serializar o acesso ao motor."
                )
            self._active += 1
            self.stats.max_concurrent = max(self.stats.max_concurrent, self._active)

    def _exit(self) -> None:
        """Registra o fim de uma inferência."""
        with self._guard:
            self._active -= 1


__all__ = [
    "DEFAULT_LANDMARK_COUNT",
    "ConcurrentInferenceError",
    "FakeBackend",
    "FakeBackendError",
    "FakeBackendStats",
    "FloatTensor",
    "pose_outputs",
]
