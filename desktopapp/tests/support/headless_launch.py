"""Lançador headless da aplicação desktop para testes de arranque.

Executa o `main()` **real** num subprocesso, substituindo apenas o ciclo de
eventos do Qt por um retorno imediato. É assim que os testes conseguem medir o
arranque sem ficar bloqueados à espera de interação do utilizador.

Porque um subprocesso?
    O arranque real ativa o `faulthandler`, define o método `spawn` do
    multiprocessing e cria o bloqueio de instância única — efeitos de processo
    que não devem ser reproduzidos dentro do processo do pytest.

Uso:
    python tests/support/headless_launch.py --app-data <diretório>
    python tests/support/headless_launch.py --app-data <diretório> --signal-on-ready SIGINT

Saída (stdout), numa linha própria:
    STARTUP_REPORT {"exit_code": 0, "startup_ms": 812.5, "shutdown_ms": 214.0}
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import threading
import time

#: Prefixo da linha de relatório, para ser encontrada entre as linhas de log.
STARTUP_REPORT_PREFIX = "STARTUP_REPORT "

# Marcado o mais cedo possível: mede o arranque desde o início do interpretador,
# incluindo a importação do PyQt6 (o pior caso realista para o utilizador).
_PROCESS_START_REFERENCE = time.perf_counter()

#: Instantes (perf_counter) em que o sinal de encerramento foi pedido.
_SIGNAL_REQUESTED_AT: list[float] = []

#: Limite de segurança para o modo interativo: se a aplicação não encerrar após o
#: sinal, o processo é terminado para o teste não ficar pendurado.
_WATCHDOG_MS = 20000

#: Intervalo de verificação de que a aplicação já instalou os seus handlers de sinal.
_READINESS_POLL_MS = 50


def _build_arguments() -> argparse.Namespace:
    """Lê os argumentos de linha de comandos do lançador."""
    parser = argparse.ArgumentParser(description="Arranque headless do Athlete Motion Desktop")
    parser.add_argument(
        "--app-data",
        required=True,
        help="Diretório a usar como %%APPDATA%% (isola definições e logs do teste).",
    )
    parser.add_argument(
        "--signal-on-ready",
        choices=["SIGINT", "SIGTERM"],
        help="Arranca com o ciclo de eventos real e entrega este sinal à aplicação já pronta.",
    )
    return parser.parse_args()


def _deliver_signal_from_thread(signal_name: str) -> None:
    """Entrega o sinal a partir de uma thread secundária.

    É o cenário que interessa testar: o sinal chega enquanto a thread principal
    está bloqueada no ciclo de eventos do Qt, pelo que só é despachado quando o
    interpretador volta a executar *bytecode* (garantido pelo temporizador de
    despertar da aplicação).
    """
    signal_number = getattr(signal, signal_name)

    def _deliver() -> None:
        time.sleep(0.05)
        _SIGNAL_REQUESTED_AT.append(time.perf_counter())
        signal.raise_signal(signal_number)

    threading.Thread(target=_deliver, name="test-signal-delivery", daemon=True).start()


def _abort_stuck_application() -> None:
    """Termina o processo de teste se a aplicação não encerrar após o sinal.

    Impede que uma regressão no encerramento deixe a suíte de testes pendurada.
    """
    print("WATCHDOG: a aplicação não encerrou após o sinal", file=sys.stderr)
    os._exit(9)


def _shutdown_handlers_installed(signal_name: str) -> bool:
    """Indica se a aplicação já instalou o seu próprio handler para o sinal.

    Evita depender de um atraso fixo: o sinal só é entregue quando a aplicação
    está realmente pronta para o tratar.
    """
    handler = signal.getsignal(getattr(signal, signal_name))
    ignorable_defaults = (signal.SIG_DFL, signal.SIG_IGN, signal.default_int_handler)
    return handler not in ignorable_defaults


def main() -> int:
    """Arranca a aplicação sem ciclo de eventos e imprime o relatório de arranque.

    Returns:
        Código de saída do lançador (0 quando o relatório foi produzido).
    """
    arguments = _build_arguments()
    os.environ["APPDATA"] = arguments.app_data
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

    from PyQt6.QtCore import QTimer
    from PyQt6.QtWidgets import QApplication

    import athletemotion_desktop.app as desktop_app

    if arguments.signal_on_ready is None:

        class HeadlessApplication(QApplication):
            """`QApplication` que não entra no ciclo de eventos (devolve logo 0)."""

            def exec(self) -> int:  # type: ignore[override]  # stubs do PyQt6 declaram `exec` estático
                return 0

        # A aplicação usa o nome global `QApplication`; substituí-lo aqui evita ter de
        # existirem caminhos alternativos no código de produção só para os testes.
        # O nome não é exportado explicitamente pelo módulo, mas em execução a
        # atribuição é exatamente o global que a aplicação usa no arranque.
        desktop_app.QApplication = HeadlessApplication  # type: ignore[attr-defined]
    else:
        requested_signal_name = str(arguments.signal_on_ready)

        class SignalApplication(QApplication):
            """Aplicação com o ciclo de eventos real, que recebe um sinal já pronta.

            Os temporizadores só podem ser usados depois de existir um
            `QApplication`, pelo que a entrega é agendada no construtor.
            """

            def __init__(self, arguments: list[str]) -> None:
                super().__init__(arguments)
                self._readiness_timer = QTimer(self)
                self._readiness_timer.setInterval(_READINESS_POLL_MS)
                self._readiness_timer.timeout.connect(self._deliver_when_ready)
                self._readiness_timer.start()
                QTimer.singleShot(_WATCHDOG_MS, _abort_stuck_application)

            def _deliver_when_ready(self) -> None:
                """Entrega o sinal assim que a aplicação instala o seu handler."""
                if not _shutdown_handlers_installed(requested_signal_name):
                    return
                self._readiness_timer.stop()
                _deliver_signal_from_thread(requested_signal_name)

        desktop_app.QApplication = SignalApplication  # type: ignore[attr-defined,assignment]

    # Os argumentos do lançador não devem chegar ao Qt (seriam interpretados como
    # opções desconhecidas da aplicação).
    sys.argv = [sys.argv[0]]
    exit_code = desktop_app.main()

    report: dict[str, float | int] = {
        "exit_code": exit_code,
        "startup_ms": (time.perf_counter() - _PROCESS_START_REFERENCE) * 1000,
    }
    if _SIGNAL_REQUESTED_AT:
        report["shutdown_ms"] = (time.perf_counter() - _SIGNAL_REQUESTED_AT[0]) * 1000
    print(f"{STARTUP_REPORT_PREFIX}{json.dumps(report)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
