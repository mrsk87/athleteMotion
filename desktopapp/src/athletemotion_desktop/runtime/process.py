"""Execução de comandos externos com limites explícitos (sem Qt).

O módulo existe para que **todos** os consumidores (sonda de hardware, enumeração de
câmaras) partilhem o mesmo comportamento perante falhas: um comando ausente, expirado ou
bloqueado por política do sistema nunca lança exceção nem devolve saída inventada — devolve
`None` e deixa a razão no log. Duplicar esta lógica por módulo garantiria divergências
silenciosas (por exemplo, um a tratar o código 1 do PowerShell como erro e outro não).
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from collections.abc import Sequence
from typing import Final

logger = logging.getLogger(__name__)

#: Limite por omissão de uma chamada externa. Comandos de gestão do Windows
#: (`Get-CimInstance`, `Get-PnpDevice`) podem levar segundos no primeiro arranque da
#: sessão, mas nunca devem bloquear quem chamou indefinidamente.
EXTERNAL_COMMAND_TIMEOUT_SECONDS: Final[float] = 10.0


def run_external_command(
    command: Sequence[str], timeout: float = EXTERNAL_COMMAND_TIMEOUT_SECONDS
) -> str | None:
    """Executa um comando externo devolvendo o `stdout`.

    Args:
        command: comando e argumentos a executar.
        timeout: limite em segundos.

    Returns:
        `stdout` em texto, ou `None` se o comando não existir, expirar ou falhar
        (a razão fica no log, nunca propagada como exceção).
    """
    if not command:
        raise ValueError("O comando a executar não pode ser uma sequência vazia.")
    if shutil.which(command[0]) is None:
        logger.debug("Comando '%s' indisponível neste sistema.", command[0])
        return None
    try:
        completed = subprocess.run(
            list(command),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            # Sem janela de consola a piscar quando a app corre em modo gráfico.
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("Falha ao executar '%s': %s", " ".join(command), exc)
        return None

    if completed.returncode != 0:
        # O PowerShell devolve código 1 em erros *não-terminantes* (por exemplo, sem
        # permissão em subchaves do registo) mesmo produzindo saída válida. Quando há
        # `stdout` útil, aproveita-se: a mensagem de erro fica só em `debug` para
        # diagnóstico. Sem saída, o comando falhou mesmo e o registo sobe a `warning`.
        stderr_excerpt = (completed.stderr or "").strip().splitlines()
        log_message = "Comando '%s' terminou com código %d: %s"
        log_args = (
            " ".join(command),
            completed.returncode,
            stderr_excerpt[-1][:200] if stderr_excerpt else "(sem mensagem)",
        )
        if (completed.stdout or "").strip():
            logger.debug(log_message, *log_args)
        else:
            logger.warning(log_message, *log_args)
            return None
    return completed.stdout
