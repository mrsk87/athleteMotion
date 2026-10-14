"""Configuração partilhada dos testes da aplicação desktop.

Três regras são aplicadas a toda a suíte:
1. **Sem servidor gráfico**: a plataforma Qt usada é `offscreen` (protocolo §3, regra 8),
   salvo se o ambiente já definir outra.
2. **Sem dados reais**: qualquer teste que escreva definições/logs usa um `%APPDATA%`
   isolado, para nunca tocar em dados do utilizador.
3. **Sem fugas**: no fim de cada teste verifica-se que não ficaram processos filhos nem
   segmentos de memória partilhada vivos (D14 §3). A verificação é dispensada quando o
   teste já falhou — nesse caso o primeiro erro é o que interessa ler.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from pathlib import Path

import pytest

from tests.support.leaks import assert_no_leaks, record_ring_creations

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

#: Marcador aplicado automaticamente a cada pasta de testes.
#:
#: A alternativa seria escrever `pytestmark` em cada um dos ~360 ficheiros (e esquecê-lo no
#: próximo), pelo que a marcação é derivada da **localização**: a pasta já diz de que tipo
#: é o teste, e um teste novo herda a marca certa sem ninguém se lembrar dela.
_DIRECTORY_MARKERS: dict[str, str] = {
    "unit": "unit",
    "integration": "integration",
    "ui": "ui",
    "perf": "perf",
}


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Marca cada teste pelo tipo de pasta onde vive (`unit`, `integration`, `ui`, `perf`).

    Args:
        items: os testes recolhidos na sessão.
    """
    tests_root = Path(__file__).parent
    for item in items:
        try:
            relative_parts = item.path.relative_to(tests_root).parts
        except ValueError:  # pragma: no cover - testes fora da árvore `tests/`
            continue
        for part in relative_parts:
            marker = _DIRECTORY_MARKERS.get(part)
            if marker is not None:
                item.add_marker(getattr(pytest.mark, marker))
                break


@pytest.fixture
def isolated_app_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Isola `%APPDATA%` num diretório temporário do teste.

    Args:
        tmp_path: diretório temporário fornecido pelo pytest.
        monkeypatch: ajuda a substituir a variável de ambiente sem efeitos colaterais.

    Returns:
        A raiz de `%APPDATA%` isolada. O diretório de dados da aplicação é
        `<raiz>/AthleteMotion` (tal como em produção).
    """
    app_data_root = tmp_path / "AppData"
    app_data_root.mkdir()
    monkeypatch.setenv("APPDATA", str(app_data_root))
    return app_data_root


@pytest.fixture(autouse=True)
def guard_against_leaks(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> Iterator[None]:
    """Falha o teste que deixar processos ou segmentos de memória partilhada para trás.

    Aplica-se a toda a suíte (`autouse`), porque a fuga típica deste projeto não nasce no
    teste que falha: nasce num que passa e deixa um worker ou um segmento a segurar
    recursos que o teste seguinte herda. Marcar um teste com
    `@pytest.mark.no_leak_check` dispensa a verificação — é o que fazem os testes que
    provocam uma fuga de propósito para provar que o guarda a vê.

    Args:
        request: contexto do teste (para ler marcadores e o contador de falhas).
        monkeypatch: reverte a interceção de `ShmRing.create` no fim do teste.
    """
    if request.node.get_closest_marker("no_leak_check") is not None:
        yield
        return

    segment_names = record_ring_creations(monkeypatch)
    failures_before = request.session.testsfailed
    yield

    if request.session.testsfailed > failures_before:
        print("\n[fugas] verificação dispensada: o teste já falhou (ver o erro acima)")
        return
    assert_no_leaks(segments=segment_names)


@pytest.fixture
def clean_logging() -> Iterator[None]:
    """Garante que os handlers de logging geridos pela aplicação são removidos no fim."""
    from athletemotion_desktop.config.logging_setup import shutdown_logging

    shutdown_logging()
    yield
    shutdown_logging()
    logging.getLogger().setLevel(logging.WARNING)
