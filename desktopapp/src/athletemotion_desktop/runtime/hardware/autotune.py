"""Execução do autotune num processo separado, cancelável.

O autotune corre o benchmark do backend (`athletemotion.infrastructure.autotune`,
tarefa R14) num **processo independente**: os laços de medição consomem GPU e CPU
durante minutos e nunca podem correr na thread da interface nem dentro do processo
gráfico.

Este módulo não importa Qt (regra de `runtime/`); quem o usa (o *view-model* de
Definições) limita-se a fazer `poll()` periodicamente a partir da thread da UI, o
que mantém o ciclo de eventos responsivo.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import queue
import subprocess
import sys
import threading
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from athletemotion_desktop.runtime.hardware.profile import (
    AUTOTUNE_MODULE,
    AutotuneUnavailableError,
)

logger = logging.getLogger(__name__)

#: Tempo máximo de espera pelo encerramento amigável antes de forçar a terminação.
TERMINATION_GRACE_SECONDS: Final[float] = 5.0


@dataclass(frozen=True)
class AutotuneProgress:
    """Progresso reportado pelo processo de autotune."""

    stage: str
    fraction: float
    message: str

    @property
    def percent(self) -> int:
        """Progresso em percentagem inteira (0–100), seguro para a barra da UI."""
        return max(0, min(100, round(self.fraction * 100)))


def autotune_module_available() -> bool:
    """Indica se o módulo do autotune do backend está disponível.

    Returns:
        `True` quando `athletemotion.infrastructure.autotune` pode ser importado.
        Um pacote `athletemotion` ausente ou incompleto devolve `False` (é a
        situação atual enquanto R01/R14 não fecharem), sem propagar exceções.
    """
    try:
        return importlib.util.find_spec(AUTOTUNE_MODULE) is not None
    except (ImportError, ValueError, ModuleNotFoundError):
        return False


def parse_progress_line(line: str) -> AutotuneProgress | None:
    """Interpreta uma linha de progresso do autotune.

    Formato esperado (uma linha JSON por atualização):
    `{"stage": "medir_dml_320", "fraction": 0.42, "message": "A medir 320 px"}`

    Args:
        line: linha lida do `stdout` do subprocesso.

    Returns:
        `AutotuneProgress` ou `None` se a linha não for progresso válido.
    """
    stripped = line.strip()
    if not stripped.startswith("{"):
        return None
    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError:
        logger.debug("Linha de progresso do autotune ignorada (JSON inválido): %s", stripped[:120])
        return None
    if not isinstance(payload, dict):
        return None

    stage = str(payload.get("stage", "autotune"))
    try:
        fraction = float(payload.get("fraction", 0.0))
    except (TypeError, ValueError):
        logger.debug("Fração de progresso inválida no autotune: %r", payload.get("fraction"))
        return None

    return AutotuneProgress(
        stage=stage,
        fraction=max(0.0, min(1.0, fraction)),
        message=str(payload.get("message", "")),
    )


class AutotuneProcess:
    """Gere a execução do autotune num subprocesso, com progresso e cancelamento.

    O processo é lançado com `Popen` e o `stdout` é lido por uma thread dedicada
    para uma fila: assim `poll()` nunca bloqueia, mesmo que o autotune fique longo
    tempo sem escrever.
    """

    def __init__(
        self,
        profile_file: Path,
        command: Sequence[str] | None = None,
    ) -> None:
        """Prepara a execução do autotune.

        Args:
            profile_file: ficheiro `hardware_profile.json` a escrever pelo autotune.
            command: comando alternativo (usado nos testes); por omissão executa
                `python -m athletemotion.infrastructure.autotune`.
        """
        self._profile_file = profile_file
        #: Só o comando por omissão depende do módulo do backend; comandos injetados
        #: (testes) não são pré-validados contra o módulo real.
        self._uses_backend_module = command is None
        self._command: list[str] = list(command) if command is not None else [
            sys.executable,
            "-m",
            AUTOTUNE_MODULE,
            "--output",
            str(profile_file),
            "--json-progress",
        ]
        self._process: subprocess.Popen[str] | None = None
        self._progress_queue: queue.Queue[AutotuneProgress] = queue.Queue()
        self._reader_thread: threading.Thread | None = None
        self._stderr_lines: list[str] = []
        self._stderr_thread: threading.Thread | None = None

    @property
    def profile_file(self) -> Path:
        """Ficheiro de perfil que o autotune irá escrever."""
        return self._profile_file

    @property
    def command(self) -> tuple[str, ...]:
        """Comando efetivamente executado."""
        return tuple(self._command)

    @property
    def is_running(self) -> bool:
        """Indica se o processo de autotune está a correr."""
        return self._process is not None and self._process.poll() is None

    @property
    def exit_code(self) -> int | None:
        """Código de saída do processo, ou `None` enquanto estiver a correr."""
        return None if self._process is None else self._process.poll()

    @property
    def stderr_tail(self) -> str:
        """Últimas linhas de erro do subprocesso (para diagnóstico na UI)."""
        return "\n".join(self._stderr_lines[-5:])

    def start(self) -> None:
        """Lança o autotune num subprocesso.

        Raises:
            AutotuneUnavailableError: se o módulo do autotune (R14) não existir ou
                se o processo não puder ser criado.
            RuntimeError: se já existir uma execução em curso nesta instância.
        """
        if self.is_running:
            raise RuntimeError("O autotune já está em execução.")

        if self._uses_backend_module and not autotune_module_available():
            raise AutotuneUnavailableError(
                "O autotune não está disponível: o módulo "
                f"'{AUTOTUNE_MODULE}' ainda não existe neste ambiente "
                "(depende das tarefas R01/R14 do backend). "
                "A aplicação continua a funcionar com as definições manuais."
            )

        try:
            self._process = subprocess.Popen(
                self._command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except OSError as exc:
            raise AutotuneUnavailableError(
                f"Não foi possível lançar o autotune ({exc})."
            ) from exc

        self._progress_queue = queue.Queue()
        self._stderr_lines = []
        self._reader_thread = threading.Thread(
            target=self._read_stdout, name="autotune-progress", daemon=True
        )
        self._reader_thread.start()
        self._stderr_thread = threading.Thread(
            target=self._read_stderr, name="autotune-stderr", daemon=True
        )
        self._stderr_thread.start()
        logger.info("Autotune lançado: %s", " ".join(self._command))

    def poll_progress(self) -> AutotuneProgress | None:
        """Devolve a atualização de progresso mais recente disponível.

        Returns:
            A última `AutotuneProgress` recebida desde a chamada anterior, ou `None`
            se não houver novidades. Não bloqueia.
        """
        latest: AutotuneProgress | None = None
        while True:
            try:
                latest = self._progress_queue.get_nowait()
            except queue.Empty:
                return latest

    def cancel(self) -> None:
        """Pede o cancelamento do autotune e espera pelo fim do processo."""
        if self._process is None or self._process.poll() is not None:
            return
        logger.info("A cancelar o autotune (pid %d).", self._process.pid)
        self._process.terminate()
        try:
            self._process.wait(timeout=TERMINATION_GRACE_SECONDS)
        except subprocess.TimeoutExpired:
            logger.warning("O autotune não terminou após o pedido; a forçar a terminação.")
            self._process.kill()
            self._process.wait(timeout=TERMINATION_GRACE_SECONDS)

    def wait(self, timeout: float | None = None) -> int | None:
        """Espera pelo fim do processo (usado em testes e no fecho da aplicação)."""
        if self._process is None:
            return None
        try:
            return self._process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            return None

    def _read_stdout(self) -> None:
        """Lê o `stdout` do subprocesso e publica o progresso na fila."""
        process = self._process
        if process is None or process.stdout is None:
            return
        for line in process.stdout:
            progress = parse_progress_line(line)
            if progress is not None:
                self._progress_queue.put(progress)

    def _read_stderr(self) -> None:
        """Guarda as últimas linhas de erro do subprocesso."""
        process = self._process
        if process is None or process.stderr is None:
            return
        for line in process.stderr:
            stripped = line.rstrip()
            if stripped:
                self._stderr_lines.append(stripped)
