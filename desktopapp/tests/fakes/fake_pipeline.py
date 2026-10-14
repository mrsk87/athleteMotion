"""Pipeline falso para testes de UI: resultados determinísticos sem motor de inferência.

**Estado: provisório e assumido.** A D05 vai definir o contrato real do `Pipeline`
(estados, `subscribe`, `latest`); este dobre cobre hoje o que as vistas precisam para
serem testadas sem GPU, sem modelos e sem processos — e tem de ser **realinhado** com o
contrato da D05 quando ela fechar. A alternativa era deixar a UI da D07/D08 sem testes até
a D05 existir, o que deixaria a interface sem rede de segurança exatamente na fase em que
ela muda mais depressa.

O que ele reproduz de propósito, porque é o que a UI tem de saber desenhar:

- resultados que chegam a ritmo e com `t_capture_ns` (idade do resultado);
- **defasagem resultado ↔ frame** (`emit(frame_seq=...)`): a UI pode ter de escolher entre
  desenhar sobre o frame que gerou o resultado ou sobre o último frame (D05 §7);
- transições de estado, incluindo `DEGRADED` (watchdog caiu para CPU) e `FAILED`;
- um observador que rebenta não pode parar a entrega aos restantes.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Final

import numpy as np
import numpy.typing as npt

from athletemotion_desktop.runtime.messages import Result
from tests.fakes.synthetic import synthetic_landmark_sequence

FloatArray = npt.NDArray[np.float32]

#: Número de landmarks da pose sintética entregue às vistas.
FAKE_LANDMARK_COUNT: Final[int] = 26


class FakePipelineState(StrEnum):
    """Estados do pipeline (espelham os da D05 §3)."""

    STOPPED = "stopped"
    STARTING = "starting"
    WARMING = "warming"
    RUNNING = "running"
    DEGRADED = "degraded"
    FAILED = "failed"
    STOPPING = "stopping"


@dataclass(frozen=True, slots=True)
class FakeResultPayload:
    """Payload provisório de um resultado (substituído pelo da D05).

    Attributes:
        landmarks: pose `(N, 3)` em píxeis de quadro.
        angles_deg: ângulos articulares em graus, por nome.
        stages_ms: latência por estágio, em milissegundos.
    """

    landmarks: FloatArray
    angles_deg: dict[str, float]
    stages_ms: dict[str, float]


@dataclass
class FakePipelineStats:
    """Contadores observáveis do pipeline falso.

    Attributes:
        emitted: resultados entregues.
        subscriber_errors: observadores que levantaram exceção.
        state_changes: transições de estado efetuadas.
        frame_advances: quantas vezes o \"último frame\" avançou.
    """

    emitted: int = 0
    subscriber_errors: int = 0
    state_changes: int = 0
    frame_advances: int = 0


@dataclass
class FakePipeline:
    """Cliente de pipeline falso para testes de UI.

    Args:
        clock: relógio monótono em segundos (injetável para determinismo).
        landmark_count: número de landmarks dos resultados.
        angle_step_deg: passo entre resultados nos ângulos (dá uma série em movimento).
    """

    clock: Callable[[], float] = time.perf_counter
    landmark_count: int = FAKE_LANDMARK_COUNT
    angle_step_deg: float = 0.5
    stats: FakePipelineStats = field(default_factory=FakePipelineStats)

    def __post_init__(self) -> None:
        """Inicializa o estado e as listas de observadores."""
        self._state = FakePipelineState.STOPPED
        self._result_listeners: list[Callable[[Result[FakeResultPayload]], None]] = []
        self._state_listeners: list[Callable[[FakePipelineState, str], None]] = []
        self._source_id: str | None = None
        self._last_result: Result[FakeResultPayload] | None = None
        self._last_frame_seq: int | None = None
        self._emitted = 0

    # ------------------------------------------------------------- contrato

    @property
    def state(self) -> FakePipelineState:
        """Estado atual do pipeline."""
        return self._state

    @property
    def source_id(self) -> str | None:
        """Fonte em uso (`None` enquanto não arrancou)."""
        return self._source_id

    def start(self, source_id: str = "fake:0") -> None:
        """Arranca o pipeline, passando por `STARTING` e `WARMING` até `RUNNING`.

        Args:
            source_id: identificador da fonte (câmara ou ficheiro).

        Raises:
            RuntimeError: se o pipeline já estiver a correr.
        """
        if self._state not in {FakePipelineState.STOPPED, FakePipelineState.FAILED}:
            raise RuntimeError(
                f"O pipeline já está em '{self._state}'; pare-o antes de voltar a arrancar."
            )
        self._set_state(FakePipelineState.STARTING, f"fonte {source_id}")
        self._source_id = source_id
        self._set_state(FakePipelineState.WARMING, "a aquecer o motor")
        self._set_state(FakePipelineState.RUNNING, "primeiro resultado entregue")

    def stop(self, *, reason: str = "pedido do utilizador") -> None:
        """Pára o pipeline (transições `STOPPING` → `STOPPED`)."""
        if self._state is FakePipelineState.STOPPED:
            return
        self._set_state(FakePipelineState.STOPPING, reason)
        self._source_id = None
        self._set_state(FakePipelineState.STOPPED, reason)

    def subscribe(
        self, callback: Callable[[Result[FakeResultPayload]], None]
    ) -> Callable[[], None]:
        """Registra um observador de resultados.

        Args:
            callback: chamado por cada resultado entregue.

        Returns:
            Função que remove este observador (permite usá-la como cleanup de teste).
        """
        self._result_listeners.append(callback)

        def unsubscribe() -> None:
            """Remove o observador, se ainda estiver registado."""
            if callback in self._result_listeners:
                self._result_listeners.remove(callback)

        return unsubscribe

    def subscribe_state(self, callback: Callable[[FakePipelineState, str], None]) -> None:
        """Registra um observador de transições de estado.

        Args:
            callback: chamado com o estado novo e o motivo.
        """
        self._state_listeners.append(callback)

    def latest(self) -> tuple[int | None, Result[FakeResultPayload] | None]:
        """Devolve o último frame conhecido e o último resultado, para desenhar coerente.

        Returns:
            `(seq do último frame, último resultado)`. Quando os dois não correspondem, a
            vista tem de decidir entre desenhar sobre o frame que gerou o resultado ou
            extrapolar (é a situação real com *latest-frame-wins*).
        """
        return self._last_frame_seq, self._last_result

    # ------------------------------------------------------------- gatilhos de teste

    def emit(
        self,
        *,
        frame_seq: int | None = None,
        inference_ms: float = 3.0,
        stages_ms: dict[str, float] | None = None,
        capture_age_s: float = 0.0,
    ) -> Result[FakeResultPayload]:
        """Entrega um resultado sintético aos observadores.

        Args:
            frame_seq: sequência do frame atualmente apresentado (quando difere da do
                resultado, a vista está perante defasagem resultado ↔ frame);
            `None` usa a sequência do próprio resultado.
            inference_ms: tempo de inferência reportado no envelope.
            stages_ms: latência por estágio (por omissão, um valor por estágio típico).
            capture_age_s: idade do frame no instante da entrega.

        Returns:
            O resultado entregue.

        Raises:
            RuntimeError: se o pipeline não estiver a correr (entrega fora de contexto é
                um erro do teste, não uma situação a tolerar em silêncio).
        """
        if self._state not in {FakePipelineState.RUNNING, FakePipelineState.DEGRADED}:
            raise RuntimeError(
                f"Não se entrega resultados com o pipeline em '{self._state}'; arranque-o primeiro."
            )
        self._emitted += 1
        self._last_frame_seq = frame_seq if frame_seq is not None else self._emitted
        landmarks = synthetic_landmark_sequence(self._emitted, landmark_count=self.landmark_count)[
            -1
        ]
        payload = FakeResultPayload(
            landmarks=landmarks,
            angles_deg={
                "knee_left": 145.0 + self.angle_step_deg * self._emitted,
                "hip_left": 60.0 - self.angle_step_deg * self._emitted,
            },
            stages_ms=dict(
                stages_ms or {"capture": 3.0, "pre": 0.9, "pose": inference_ms, "post": 1.2}
            ),
        )
        result: Result[FakeResultPayload] = Result(
            seq=self._emitted,
            t_capture_ns=int((self.clock() - capture_age_s) * 1e9),
            inference_ms=inference_ms,
            payload=payload,
        )
        self._last_result = result
        self._deliver(result)
        return result

    def advance_frame(self, count: int = 1) -> int:
        """Faz avançar o \"último frame\" sem produzir resultado (para testar defasagem).

        Args:
            count: quantos frames avançar.

        Returns:
            A sequência do último frame depois do avanço.
        """
        current = self._last_frame_seq or 0
        self._last_frame_seq = current + count
        self.stats.frame_advances += count
        return self._last_frame_seq

    def degrade(self, reason: str) -> None:
        """Coloca o pipeline em `DEGRADED` (watchdog caiu para CPU).

        Args:
            reason: motivo legível (aparece na UI).
        """
        self._set_state(FakePipelineState.DEGRADED, reason)

    def fail(self, reason: str) -> None:
        """Coloca o pipeline em `FAILED` (o processo de inferência morreu).

        Args:
            reason: motivo legível (aparece na UI).
        """
        self._set_state(FakePipelineState.FAILED, reason)

    # ------------------------------------------------------------- interno

    def _set_state(self, state: FakePipelineState, reason: str) -> None:
        """Muda de estado e avisa os observadores (um observador avariado não trava a UI)."""
        self._state = state
        self.stats.state_changes += 1
        for listener in list(self._state_listeners):
            try:
                listener(state, reason)
            except Exception:  # noqa: BLE001 - um observador de teste avariado não é fatal
                self.stats.subscriber_errors += 1

    def _deliver(self, result: Result[FakeResultPayload]) -> None:
        """Entrega o resultado a todos os observadores, contando os que falham."""
        self.stats.emitted += 1
        for listener in list(self._result_listeners):
            try:
                listener(result)
            except Exception:  # noqa: BLE001 - idem: a entrega continua para os restantes
                self.stats.subscriber_errors += 1


__all__ = [
    "FAKE_LANDMARK_COUNT",
    "FakePipeline",
    "FakePipelineState",
    "FakePipelineStats",
    "FakeResultPayload",
]
