"""Infraestrutura dos portões de desempenho (D14 §5).

O portão é **um por sessão**: a baseline é lida uma vez, todas as métricas ficam
registadas e o resumo é impresso no fim (mesmo que um teste falhe a meio), porque um
número medido e não mostrado é um número que ninguém vê — e é o número que interessa
quando um portão dispara.

Política da baseline: ver a documentação em `tests/support/perf_baseline.py` e
`docs/testing.md`. Resumo: orçamento absoluto sempre imposto; comparação com a baseline
relativa só na mesma máquina e só com `PERF_BASELINE_ENFORCE=1`; gravação só com
`PERF_BASELINE_UPDATE=1`.
"""

from __future__ import annotations

import pytest

from tests.support.perf_baseline import PerfBaseline

#: Portão da sessão atual (`None` antes de a primeira fixture ser pedida).
_gate: PerfBaseline | None = None


@pytest.fixture(scope="session")
def perf_gate() -> PerfBaseline:
    """Portão de desempenho da sessão, configurado pelo ambiente.

    Returns:
        O portão partilhado por todos os testes de desempenho desta sessão.
    """
    global _gate
    if _gate is None:
        _gate = PerfBaseline.from_environment()
    return _gate


def pytest_terminal_summary(terminalreporter: pytest.TerminalReporter) -> None:
    """Imprime o resumo dos portões de desempenho e regrava a baseline quando pedido.

    Args:
        terminalreporter: reporter do pytest usado para escrever no fim da execução.
    """
    if _gate is None:
        return
    _gate.save()
    terminalreporter.write_sep("=", "portão de desempenho")
    terminalreporter.write_line(_gate.report())
