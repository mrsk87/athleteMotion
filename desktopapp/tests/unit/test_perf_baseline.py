"""Testes do portão de desempenho: orçamento absoluto e regressão relativa.

Um portão que nunca se viu falhar não é um portão — é uma fé. Estes testes exercitam
exatamente os dois modos de falha que a D14 exige que existam (orçamento excedido e
regressão acima da tolerância), além das situações em que a comparação **não** deve
acontecer (máquina diferente, métrica sem orçamento, amostra única).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.support.perf_baseline import (
    DEFAULT_TOLERANCE,
    ENFORCE_ENV,
    PATH_ENV,
    TOLERANCE_ENV,
    UPDATE_ENV,
    BaselineEntry,
    Measurement,
    PerfBaseline,
    PerfBaselineError,
    current_machine_signature,
)

SIGNATURE = "abc123def456"
OTHER_SIGNATURE = "999888777666"


def measurement(
    *,
    metric: str = "anel 720p",
    p50_ms: float = 0.02,
    p95_ms: float = 0.03,
    budget_ms: float | None = 0.2,
    samples: int = 1000,
    compare: bool = True,
) -> Measurement:
    """Cria uma medição de teste com valores realistas."""
    return Measurement(
        metric=metric,
        p50_ms=p50_ms,
        p95_ms=p95_ms,
        budget_ms=budget_ms,
        samples=samples,
        compare=compare,
    )


def write_baseline(
    path: Path, *, p50_ms: float = 0.02, p95_ms: float = 0.03, signature: str = SIGNATURE
) -> Path:
    """Grava uma baseline de uma métrica no caminho indicado."""
    document = {
        "schema_version": 1,
        "signature": signature,
        "metrics": {
            "anel 720p": BaselineEntry(
                metric="anel 720p",
                p50_ms=p50_ms,
                p95_ms=p95_ms,
                budget_ms=0.2,
                samples=1000,
                signature=signature,
                recorded_at="2026-10-14T10:00:00+00:00",
            ).to_json()
        },
    }
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


def gate(
    path: Path, *, enforce: bool = False, update: bool = False, tolerance: float = DEFAULT_TOLERANCE
) -> PerfBaseline:
    """Cria um portão apontado a uma baseline de teste."""
    return PerfBaseline(
        path,
        signature=SIGNATURE,
        tolerance=tolerance,
        enforce=enforce,
        update=update,
    )


def test_budget_is_enforced_even_without_baseline(tmp_path: Path) -> None:
    """O orçamento é um requisito de produto: falha mesmo sem baseline e sem imposição."""
    portao = gate(tmp_path / "baseline.json")

    with pytest.raises(PerfBaselineError, match=r"Orçamento excedido em 'anel 720p'"):
        portao.check(measurement(p50_ms=0.05, p95_ms=0.9, budget_ms=0.2))


def test_budget_failure_names_the_offending_percentile(tmp_path: Path) -> None:
    """A mensagem diz qual dos percentis falhou e com que valores."""
    portao = gate(tmp_path / "baseline.json")

    with pytest.raises(PerfBaselineError) as error:
        portao.check(measurement(p50_ms=0.21, p95_ms=0.25, budget_ms=0.2))

    message = str(error.value)
    assert "p50=0.2100" in message
    assert "orçamento de 0.2000" in message


def test_missing_baseline_is_reported_and_does_not_fail(tmp_path: Path) -> None:
    """Sem baseline a métrica é aprovada pelo orçamento, mas o estado fica explícito."""
    portao = gate(tmp_path / "baseline.json")

    comparison = portao.check(measurement())

    assert comparison.status == "sem_baseline"
    assert comparison.ok
    assert UPDATE_ENV in comparison.detail


def test_regression_of_thirty_percent_fails_when_enforced(tmp_path: Path) -> None:
    """Critério da D14: piorar 30 % o anel falha o portão (com a imposição ligada)."""
    path = write_baseline(tmp_path / "baseline.json", p95_ms=0.03)
    portao = gate(path, enforce=True)

    with pytest.raises(PerfBaselineError) as error:
        portao.check(measurement(p50_ms=0.025, p95_ms=0.039))

    message = str(error.value)
    assert "Regressão de desempenho em 'anel 720p'" in message
    assert "+30.0%" in message
    assert "tolerância 15%" in message


def test_regression_is_only_reported_without_enforcement(tmp_path: Path) -> None:
    """Sem imposição, a regressão fica visível e medida, mas não falha o teste."""
    path = write_baseline(tmp_path / "baseline.json", p95_ms=0.03)
    portao = gate(path, enforce=False)

    comparison = portao.check(measurement(p95_ms=0.06))

    assert comparison.status == "regressao"
    assert comparison.enforced is False
    assert comparison.delta_p95 == pytest.approx(1.0)
    assert f"{ENFORCE_ENV}=0" in comparison.detail


def test_change_within_tolerance_passes(tmp_path: Path) -> None:
    """Uma variação de 10 % cabe na tolerância de 15 %."""
    path = write_baseline(tmp_path / "baseline.json", p95_ms=0.03)
    portao = gate(path, enforce=True)

    comparison = portao.check(measurement(p50_ms=0.021, p95_ms=0.033))

    assert comparison.status == "ok"
    assert comparison.delta_p95 == pytest.approx(0.1)


def test_improvement_is_named_as_such(tmp_path: Path) -> None:
    """Ficar abaixo da baseline é reportado como melhoria, não como falha silenciosa."""
    path = write_baseline(tmp_path / "baseline.json", p95_ms=0.03)
    portao = gate(path, enforce=True)

    comparison = portao.check(measurement(p50_ms=0.01, p95_ms=0.015))

    assert comparison.status == "melhoria"
    assert comparison.delta_p95 == pytest.approx(-0.5)


def test_baseline_from_another_machine_is_not_compared(tmp_path: Path) -> None:
    """Uma baseline de outra máquina não é comparável — nem 6× pior deve falhar.

    Os valores medidos ficam **dentro** do orçamento de propósito: o que se prova aqui é
    que a comparação relativa é recusada, e não que o orçamento falhou primeiro.
    """
    path = write_baseline(tmp_path / "baseline.json", p95_ms=0.03, signature=OTHER_SIGNATURE)
    portao = gate(path, enforce=True)

    comparison = portao.check(measurement(p50_ms=0.15, p95_ms=0.19))

    assert comparison.status == "nao_comparavel"
    assert OTHER_SIGNATURE in comparison.detail
    assert SIGNATURE in comparison.detail


def test_budget_still_applies_when_the_baseline_is_not_comparable(tmp_path: Path) -> None:
    """A não-comparabilidade não dá carta branca: o orçamento continua a ser imposto."""
    path = write_baseline(tmp_path / "baseline.json", p95_ms=0.03, signature=OTHER_SIGNATURE)
    portao = gate(path, enforce=True)

    with pytest.raises(PerfBaselineError, match="Orçamento excedido"):
        portao.check(measurement(p50_ms=0.05, p95_ms=1.5, budget_ms=1.0))


def test_single_sample_metric_is_compared_with_the_budget_only(tmp_path: Path) -> None:
    """Uma medição de amostra única (arranque) não é comparada com a baseline."""
    portao = gate(tmp_path / "baseline.json", enforce=True)

    comparison = portao.check(
        measurement(
            metric="arranque",
            p50_ms=900.0,
            p95_ms=900.0,
            budget_ms=2000.0,
            samples=1,
            compare=False,
        )
    )

    assert comparison.status == "nao_comparavel"
    assert "amostra única" in comparison.detail


def test_metric_without_budget_is_informative_only(tmp_path: Path) -> None:
    """Uma métrica sem orçamento (débito de leitura) mede-se e reporta-se, sem falhar."""
    portao = gate(tmp_path / "baseline.json", enforce=True)

    comparison = portao.check(
        measurement(metric="débito ficheiro", p50_ms=80.0, p95_ms=95.0, budget_ms=None)
    )

    assert comparison.status == "sem_orcamento"
    assert comparison.ok


def test_baseline_is_written_atomically_and_only_in_update_mode(tmp_path: Path) -> None:
    """Sem modo de atualização nada é gravado; com ele, o ficheiro substitui-se de forma atómica."""
    path = tmp_path / "baseline.json"
    no_update = gate(path)
    no_update.check(measurement())

    assert no_update.save() is None
    assert not path.exists()

    updating = gate(path, update=True)
    updating.check(measurement(p50_ms=0.025, p95_ms=0.035))
    saved = updating.save()

    assert saved == path
    assert list(tmp_path.glob("*.tmp")) == []
    document = json.loads(path.read_text(encoding="utf-8"))
    assert document["signature"] == SIGNATURE
    assert document["metrics"]["anel 720p"]["p95_ms"] == pytest.approx(0.035)


def test_saved_baseline_is_read_back_and_compared(tmp_path: Path) -> None:
    """A baseline gravada é reutilizada na execução seguinte (ciclo completo)."""
    path = tmp_path / "baseline.json"
    recording = gate(path, update=True)
    recording.check(measurement(p50_ms=0.02, p95_ms=0.03))
    recording.save()

    comparison = gate(path, enforce=True).check(measurement(p50_ms=0.02, p95_ms=0.03))

    assert comparison.status == "ok"
    assert comparison.delta_p95 == pytest.approx(0.0)


def test_malformed_baseline_is_refused_with_context(tmp_path: Path) -> None:
    """Uma baseline inválida falha com explicação, em vez de ser ignorada em silêncio."""
    broken = tmp_path / "baseline.json"
    broken.write_text("não é json", encoding="utf-8")

    with pytest.raises(PerfBaselineError, match="não pôde ser lida"):
        gate(broken)


def test_baseline_with_unknown_schema_version_is_refused(tmp_path: Path) -> None:
    """Uma baseline de outra versão de formato é recusada (não mal interpretada)."""
    path = tmp_path / "baseline.json"
    payload = json.loads(write_baseline(path).read_text(encoding="utf-8"))
    payload["metrics"]["anel 720p"]["schema_version"] = 99
    path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(PerfBaselineError, match="versão de baseline 99"):
        gate(path)


def test_baseline_with_text_instead_of_number_is_refused(tmp_path: Path) -> None:
    """Um campo numérico preenchido com texto é reportado com o valor recebido."""
    path = tmp_path / "baseline.json"
    payload = json.loads(write_baseline(path).read_text(encoding="utf-8"))
    payload["metrics"]["anel 720p"]["p95_ms"] = "rápido"
    path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(PerfBaselineError, match="devia ser numérico"):
        gate(path)


def test_baseline_with_a_root_that_is_not_an_object_is_refused(tmp_path: Path) -> None:
    """Uma lista na raiz do ficheiro é um erro explicado, não um `AttributeError`."""
    path = tmp_path / "baseline.json"
    path.write_text("[1, 2, 3]", encoding="utf-8")

    with pytest.raises(PerfBaselineError, match="devia ser um objeto JSON"):
        gate(path)


def test_measurement_contract_is_validated() -> None:
    """Uma medição incoerente é recusada antes de chegar ao portão."""
    with pytest.raises(ValueError, match="0 amostras"):
        measurement(samples=0)
    with pytest.raises(ValueError, match="percentis negativos"):
        measurement(p50_ms=-0.1, p95_ms=0.1)
    with pytest.raises(ValueError, match="percentis estão invertidos"):
        measurement(p50_ms=0.5, p95_ms=0.1)
    with pytest.raises(ValueError, match="nenhum orçamento"):
        measurement(budget_ms=0.0)


def test_gate_reads_configuration_from_the_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """As variáveis de ambiente controlam caminho, tolerância, imposição e gravação."""
    path = tmp_path / "outra.json"
    monkeypatch.setenv(PATH_ENV, str(path))
    monkeypatch.setenv(TOLERANCE_ENV, "0.40")
    monkeypatch.setenv(ENFORCE_ENV, "true")
    monkeypatch.setenv(UPDATE_ENV, "sim")

    portao = PerfBaseline.from_environment()

    assert portao.path == path
    assert portao.tolerance == pytest.approx(0.40)
    assert portao.enforce is True
    assert portao.update is True


def test_gate_defaults_are_conservative(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Sem variáveis, o portão não impõe nem regrava: um teste normal nunca mexe na baseline."""
    for name in (PATH_ENV, TOLERANCE_ENV, ENFORCE_ENV, UPDATE_ENV):
        monkeypatch.delenv(name, raising=False)

    portao = PerfBaseline.from_environment()

    assert portao.tolerance == pytest.approx(DEFAULT_TOLERANCE)
    assert portao.enforce is False
    assert portao.update is False


def test_negative_tolerance_is_refused(tmp_path: Path) -> None:
    """Uma tolerância negativa tornaria qualquer medição uma regressão."""
    with pytest.raises(ValueError, match="não pode ser negativa"):
        gate(tmp_path / "baseline.json", tolerance=-0.1)


def test_report_lists_every_metric(tmp_path: Path) -> None:
    """O relatório de sessão resume todas as métricas medidas."""
    portao = gate(tmp_path / "baseline.json")
    portao.check(measurement(metric="anel 720p"))
    portao.check(measurement(metric="preprocess 720p", p50_ms=0.8, p95_ms=0.9, budget_ms=2.0))

    report = portao.report()

    assert "2 métricas" in report
    assert "anel 720p" in report
    assert "preprocess 720p" in report


def test_current_machine_signature_is_a_stable_non_empty_string() -> None:
    """A assinatura da máquina existe e é estável entre chamadas na mesma execução."""
    first = current_machine_signature()
    second = current_machine_signature()

    assert first
    assert first == second
