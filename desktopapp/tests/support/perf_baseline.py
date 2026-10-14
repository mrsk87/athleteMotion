"""Portão de desempenho com baseline registada.

Duas verificações de naturezas diferentes coexistem aqui, e convém não as confundir:

1. **Orçamento absoluto** (`budget_ms`): o requisito do plano (p. ex. pré-processamento a
   720p ≤ 2 ms). É imposto **sempre**, em qualquer máquina, porque é um requisito de
   produto e não uma comparação.
2. **Regressão relativa** (`baseline.json`): compara a medição com o último valor
   registado *na mesma máquina*. Só faz sentido quando as duas medições são
   comparáveis, e é isso que a assinatura de hardware decide.

Porque a imposição da regressão é opt-in (`PERF_BASELINE_ENFORCE=1`): uma alteração de
carga, de *turbo* ou de outro agente a compilar na mesma máquina move uma medição de
parede em dezenas de por cento (na D04 o mesmo pré-processamento mediu p50 0,84 ms e
1,10 ms em execuções distintas). Falhar por omissão com esses valores seria ruído
disfarçado de portão; o que o portão relativo serve é uma execução dedicada (runner
estável ou verificação local intencional), onde `PERF_BASELINE_ENFORCE=1` o impõe.

Variáveis de ambiente:

- `PERF_BASELINE_UPDATE=1` — regrava as entradas medidas (com `fsync` e substituição
  atómica) e avisa no fim. Sem isto, a baseline **nunca** é alterada por uma execução
  normal de testes.
- `PERF_BASELINE_ENFORCE=1` — impõe a tolerância de regressão. Por omissão a comparação
  é apenas reportada (com o desvio medido) e não falha o teste.
- `PERF_BASELINE_TOLERANCE=0.30` — tolerância relativa de regressão (por omissão 15 %,
  o critério da tarefa D14).
- `PERF_BASELINE_PATH=<ficheiro>` — baseline alternativa (usada pelos próprios testes
  deste portão e por demonstrações de regressão em diretório temporário).
"""

from __future__ import annotations

import functools
import json
import logging
import os
import platform
import tempfile
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

logger = logging.getLogger(__name__)

#: Ficheiro da baseline versionada (referência da máquina de desenvolvimento).
DEFAULT_BASELINE_PATH: Final[Path] = Path(__file__).resolve().parents[1] / "perf" / "baseline.json"

UPDATE_ENV: Final[str] = "PERF_BASELINE_UPDATE"
ENFORCE_ENV: Final[str] = "PERF_BASELINE_ENFORCE"
TOLERANCE_ENV: Final[str] = "PERF_BASELINE_TOLERANCE"
PATH_ENV: Final[str] = "PERF_BASELINE_PATH"

#: Critério da tarefa D14: falhar se a medição ficar > 15 % pior.
DEFAULT_TOLERANCE: Final[float] = 0.15

#: Valores de `PERF_BASELINE_*` aceites como \"ligado\".
_TRUTHY: Final[frozenset[str]] = frozenset({"1", "true", "yes", "on", "sim"})

#: Versão do formato da baseline: uma baseline antiga é ignorada (e não mal interpretada).
BASELINE_SCHEMA_VERSION: Final[int] = 1


class PerfBaselineError(AssertionError):
    """Falha do portão de desempenho.

    Herda de `AssertionError` de propósito: um portão de desempenho é uma asserção, e o
    pytest deve reportá-lo como tal (e não como um erro de infraestrutura de teste).
    """


@dataclass(frozen=True)
class Measurement:
    """Uma medição de desempenho de um estágio, pronta a comparar.

    Args:
        metric: nome estável da métrica (a chave na baseline).
        p50_ms: mediana da latência, em milissegundos.
        p95_ms: percentil 95 da latência, em milissegundos (a cauda é o que interessa
            num pipeline de tempo real).
        budget_ms: orçamento do plano; `None` quando a métrica é apenas informativa.
        samples: número de amostras que sustentam os percentis.
        unit: unidade da grandeza (por omissão ms; o arranque também é ms).
        compare: quando `False`, a métrica é medida e registada mas não é comparada com a
            baseline (casos de amostra única, dominados por cache de ficheiros/AV).
    """

    metric: str
    p50_ms: float
    p95_ms: float
    budget_ms: float | None
    samples: int
    unit: str = "ms"
    compare: bool = True

    def __post_init__(self) -> None:
        """Valida a coerência da medição antes de a comparar com o orçamento."""
        if self.samples < 1:
            raise ValueError(
                f"A medição '{self.metric}' tem {self.samples} amostras; uma métrica de "
                "desempenho precisa de pelo menos uma amostra para significar algo."
            )
        if self.p50_ms < 0 or self.p95_ms < 0:
            raise ValueError(
                f"A medição '{self.metric}' tem percentis negativos "
                f"(p50={self.p50_ms}, p95={self.p95_ms}): nenhuma latência é negativa."
            )
        if self.p50_ms > self.p95_ms:
            raise ValueError(
                f"A medição '{self.metric}' tem p50 ({self.p50_ms}) maior que p95 "
                f"({self.p95_ms}): os percentis estão invertidos."
            )
        if self.budget_ms is not None and self.budget_ms <= 0:
            raise ValueError(
                f"A medição '{self.metric}' tem orçamento {self.budget_ms}; nenhum "
                "orçamento de latência é zero ou negativo."
            )

    def to_json(self) -> dict[str, object]:
        """Serializa a medição num dicionário de tipos JSON simples."""
        return dict(asdict(self))


@dataclass(frozen=True)
class BaselineEntry:
    """Entrada de baseline: a última medição registada para uma métrica.

    Args:
        metric: nome da métrica.
        p50_ms: mediana registada.
        p95_ms: percentil 95 registado.
        budget_ms: orçamento em vigor quando a entrada foi gravada.
        samples: amostras dessa medição.
        signature: assinatura de hardware em que foi medida.
        recorded_at: instante ISO-8601 (UTC) da gravação.
        schema_version: versão do formato.
    """

    metric: str
    p50_ms: float
    p95_ms: float
    budget_ms: float | None
    samples: int
    signature: str
    recorded_at: str
    schema_version: int = BASELINE_SCHEMA_VERSION
    unit: str = "ms"

    @classmethod
    def from_json(cls, metric: str, payload: object) -> BaselineEntry:
        """Reconstrói uma entrada a partir do JSON, recusando o que não conseguir validar.

        Args:
            metric: chave sob a qual a entrada estava guardada.
            payload: objeto JSON da entrada.

        Returns:
            A entrada validada.

        Raises:
            PerfBaselineError: se o objeto não tiver a forma esperada.
        """
        if not isinstance(payload, dict):
            raise PerfBaselineError(
                f"Entrada '{metric}' da baseline não é um objeto JSON, mas {type(payload).__name__}."
            )
        version = payload.get("schema_version", BASELINE_SCHEMA_VERSION)
        if version != BASELINE_SCHEMA_VERSION:
            raise PerfBaselineError(
                f"Entrada '{metric}' usa a versão de baseline {version!r}; esta versão do "
                f"portão só sabe ler a {BASELINE_SCHEMA_VERSION}. Regrave-a com "
                f"{UPDATE_ENV}=1."
            )
        try:
            p50_ms = float(_require_number(payload, "p50_ms", metric))
            p95_ms = float(_require_number(payload, "p95_ms", metric))
            samples = int(_require_number(payload, "samples", metric))
            signature = str(payload["signature"])
        except KeyError as exc:
            raise PerfBaselineError(
                f"Entrada '{metric}' da baseline não tem o campo {exc.args[0]!r}."
            ) from exc

        raw_budget = payload.get("budget_ms")
        budget_ms = (
            None if raw_budget is None else float(_require_number(payload, "budget_ms", metric))
        )
        return cls(
            metric=metric,
            p50_ms=p50_ms,
            p95_ms=p95_ms,
            budget_ms=budget_ms,
            samples=samples,
            signature=signature,
            recorded_at=str(payload.get("recorded_at", "")),
            unit=str(payload.get("unit", "ms")),
        )

    @classmethod
    def from_measurement(cls, measurement: Measurement, signature: str) -> BaselineEntry:
        """Converte uma medição na entrada de baseline correspondente."""
        return cls(
            metric=measurement.metric,
            p50_ms=measurement.p50_ms,
            p95_ms=measurement.p95_ms,
            budget_ms=measurement.budget_ms,
            samples=measurement.samples,
            signature=signature,
            recorded_at=datetime.now(UTC).isoformat(timespec="seconds"),
            unit=measurement.unit,
        )

    def to_json(self) -> dict[str, object]:
        """Serializa a entrada num dicionário de tipos JSON simples."""
        return dict(asdict(self))


@dataclass(frozen=True)
class Comparison:
    """Resultado da comparação de uma medição com o orçamento e com a baseline.

    Args:
        measurement: a medição comparada.
        status: `ok`, `sem_baseline`, `sem_orcamento`, `nao_comparavel`, `regressao` ou
            `melhoria`.
        detail: explicação legível do estado (é o que aparece no relatório da sessão).
        delta_p95: variação relativa do p95 face à baseline (`None` quando não há
            comparação possível).
        enforced: `True` quando a tolerância de regressão foi efetivamente imposta.
    """

    measurement: Measurement
    status: str
    detail: str
    delta_p95: float | None = None
    enforced: bool = False

    @property
    def ok(self) -> bool:
        """Indica se a comparação terminou sem desvio relevante."""
        return self.status in {"ok", "melhoria", "sem_orcamento", "sem_baseline", "nao_comparavel"}


def _require_number(payload: dict[str, object], key: str, metric: str) -> float:
    """Lê um número obrigatório do JSON, com erro explicativo quando falta ou mente."""
    if key not in payload:
        raise KeyError(key)
    value = payload[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PerfBaselineError(
            f"Campo '{key}' da métrica '{metric}' devia ser numérico, mas é "
            f"{type(value).__name__} ({value!r})."
        )
    return float(value)


def _env_flag(name: str) -> bool:
    """Interpreta uma variável de ambiente booleana (ausente = desligado)."""
    raw = os.environ.get(name, "")
    return raw.strip().lower() in _TRUTHY


@functools.lru_cache(maxsize=1)
def current_machine_signature() -> str:
    """Assinatura da máquina atual, pela mesma noção de hardware que o autotune (D02).

    O resultado é memorizado: a sonda completa consulta o Windows (PowerShell/registo) e
    o hardware não muda a meio de uma execução de testes.

    Usa-se `build_hardware_signature` e não uma impressão própria para que \"a mesma
    máquina\" signifique a mesma coisa em todo o projeto. A consequência a conhecer: uma
    atualização de driver muda a assinatura e a comparação relativa deixa de ser feita
    (fica só o orçamento absoluto) — preferimos não comparar a comparar mal.

    Returns:
        A assinatura SHA-256 truncada. Quando a sonda de hardware falha por completo, o
        resultado é `cpu:<modelo>|<núcleos lógicos>`: pior, mas ainda discriminante.
    """
    try:
        from athletemotion_desktop.runtime.hardware.probe import collect_hardware_info

        return collect_hardware_info().signature
    except Exception as exc:  # noqa: BLE001 - a sonda pode falhar por N razões ambientais
        logger.warning("Sonda de hardware indisponível para a assinatura de desempenho: %s", exc)
        return f"cpu:{platform.processor()}|{os.cpu_count()}"


class PerfBaseline:
    """Compara medições com uma baseline, impondo orçamentos e (opcionalmente) tolerância.

    Args:
        path: ficheiro JSON da baseline.
        signature: assinatura da máquina atual.
        tolerance: tolerância relativa de regressão (0,15 = 15 %).
        enforce: impõe a tolerância (falha o teste) em vez de apenas reportar.
        update: regrava as medições no fim da sessão.
    """

    def __init__(
        self,
        path: Path = DEFAULT_BASELINE_PATH,
        *,
        signature: str,
        tolerance: float = DEFAULT_TOLERANCE,
        enforce: bool = False,
        update: bool = False,
    ) -> None:
        if tolerance < 0:
            raise ValueError(f"A tolerância de regressão não pode ser negativa ({tolerance}).")
        self.path = path
        self.signature = signature
        self.tolerance = tolerance
        self.enforce = enforce
        self.update = update
        self.comparisons: list[Comparison] = []
        self._entries: dict[str, BaselineEntry] = self._read_entries()
        self._recorded: dict[str, BaselineEntry] = {}

    @classmethod
    def from_environment(cls, path: Path | None = None) -> PerfBaseline:
        """Constrói o portão a partir das variáveis de ambiente da sessão de testes.

        Args:
            path: baseline explícita; por omissão usa `PERF_BASELINE_PATH` ou a versionada.

        Returns:
            O portão configurado.
        """
        resolved = path
        if resolved is None:
            from_env = os.environ.get(PATH_ENV)
            resolved = Path(from_env) if from_env else DEFAULT_BASELINE_PATH
        tolerance_raw = os.environ.get(TOLERANCE_ENV)
        tolerance = DEFAULT_TOLERANCE if tolerance_raw is None else float(tolerance_raw)
        return cls(
            resolved,
            signature=current_machine_signature(),
            tolerance=tolerance,
            enforce=_env_flag(ENFORCE_ENV),
            update=_env_flag(UPDATE_ENV),
        )

    def _read_entries(self) -> dict[str, BaselineEntry]:
        """Lê as entradas da baseline; um ficheiro ausente não é erro (é o 1.º uso)."""
        if not self.path.is_file():
            return {}
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise PerfBaselineError(
                f"A baseline de desempenho em {self.path} não pôde ser lida ({exc}). "
                f"Regrave-a com {UPDATE_ENV}=1 ou remova o ficheiro."
            ) from exc
        if not isinstance(raw, dict):
            raise PerfBaselineError(
                f"A baseline em {self.path} devia ser um objeto JSON com as métricas na raiz, "
                f"mas é {type(raw).__name__}."
            )
        metrics = raw.get("metrics", raw)
        if not isinstance(metrics, dict):
            raise PerfBaselineError(
                f"A chave 'metrics' da baseline em {self.path} devia ser um objeto JSON, mas é "
                f"{type(metrics).__name__}."
            )
        entries: dict[str, BaselineEntry] = {}
        for metric, payload in metrics.items():
            if not isinstance(metric, str):
                raise PerfBaselineError(
                    f"A baseline em {self.path} tem uma métrica com nome não textual ({metric!r})."
                )
            entries[metric] = BaselineEntry.from_json(metric, payload)
        return entries

    def check(self, measurement: Measurement) -> Comparison:
        """Impõe o orçamento e compara a medição com a baseline, registando o resultado.

        Args:
            measurement: medição a verificar.

        Returns:
            A comparação efetuada (também fica guardada em `comparisons` para o relatório).

        Raises:
            PerfBaselineError: quando o orçamento é excedido, ou quando a tolerância de
                regressão é ultrapassada **e** a imposição está ativa.
        """
        self._enforce_budget(measurement)
        comparison = self._compare(measurement)
        self.comparisons.append(comparison)
        if comparison.delta_p95 is None:
            print(f"[perf] {measurement.metric}: {comparison.status} — {comparison.detail}")
        else:
            print(
                f"[perf] {measurement.metric}: p50={measurement.p50_ms:.4f} ms "
                f"p95={measurement.p95_ms:.4f} ms · {comparison.status} — {comparison.detail}"
            )
        if self.update:
            self._recorded[measurement.metric] = BaselineEntry.from_measurement(
                measurement, self.signature
            )
        return comparison

    def _enforce_budget(self, measurement: Measurement) -> None:
        """Falha quando a medição excede o orçamento do plano (independe da máquina)."""
        budget = measurement.budget_ms
        if budget is None:
            return
        for label, observed in (("p50", measurement.p50_ms), ("p95", measurement.p95_ms)):
            if observed >= budget:
                raise PerfBaselineError(
                    f"Orçamento excedido em '{measurement.metric}': {label}={observed:.4f} "
                    f"{measurement.unit} contra o orçamento de {budget:.4f} {measurement.unit} "
                    f"({measurement.samples} amostras). O orçamento é o requisito; a baseline "
                    "não o substitui."
                )

    def _compare(self, measurement: Measurement) -> Comparison:
        """Compara com a baseline, sem impor nada (a imposição é decidida pelo chamador)."""
        if measurement.budget_ms is None:
            return Comparison(
                measurement=measurement,
                status="sem_orcamento",
                detail="métrica informativa: não tem orçamento nem regressão associados",
            )
        if not measurement.compare:
            return Comparison(
                measurement=measurement,
                status="nao_comparavel",
                detail="medição de amostra única: comparada com o orçamento, não com a baseline",
            )
        entry = self._entries.get(measurement.metric)
        if entry is None:
            return Comparison(
                measurement=measurement,
                status="sem_baseline",
                detail=(
                    f"sem baseline registada para esta métrica; grave-a com {UPDATE_ENV}=1 "
                    "(execução dedicada, máquina descarregada)"
                ),
            )
        if entry.signature != self.signature:
            return Comparison(
                measurement=measurement,
                status="nao_comparavel",
                detail=(
                    f"baseline gravada noutra máquina (assinatura {entry.signature} ≠ "
                    f"{self.signature}); só o orçamento absoluto é verificado"
                ),
            )

        delta = (measurement.p95_ms - entry.p95_ms) / entry.p95_ms if entry.p95_ms > 0 else 0.0
        threshold = entry.p95_ms * (1.0 + self.tolerance)
        if measurement.p95_ms > threshold:
            detail = (
                f"p95 {measurement.p95_ms:.4f} ms contra baseline {entry.p95_ms:.4f} ms "
                f"({delta:+.1%}, tolerância {self.tolerance:.0%}, gravada em "
                f"{entry.recorded_at or 'data desconhecida'})"
            )
            if self.enforce:
                raise PerfBaselineError(
                    f"Regressão de desempenho em '{measurement.metric}': {detail}. "
                    f"Se a regressão for um custo aceite, regrave a baseline com "
                    f"{UPDATE_ENV}=1 e justifique no registo da tarefa."
                )
            return Comparison(
                measurement=measurement,
                status="regressao",
                detail=f"{detail} — não imposta ({ENFORCE_ENV}=0)",
                delta_p95=delta,
                enforced=False,
            )
        if delta < 0:
            return Comparison(
                measurement=measurement,
                status="melhoria",
                detail=f"{abs(delta):.1%} melhor que a baseline ({entry.p95_ms:.4f} ms)",
                delta_p95=delta,
            )
        return Comparison(
            measurement=measurement,
            status="ok",
            detail=f"dentro da tolerância de {self.tolerance:.0%} ({delta:+.1%})",
            delta_p95=delta,
        )

    def save(self) -> Path | None:
        """Grava as medições registadas, com substituição atómica.

        Escreve primeiro para um ficheiro temporário **no mesmo diretório** e só depois o
        substitui (`os.replace`), seguindo a regra de atomicidade da AGENTS.md §2.1: uma
        interrupção nunca deixa uma baseline truncada a ser lida na execução seguinte.

        Returns:
            O caminho gravado, ou `None` quando não havia nada para gravar.
        """
        if not self.update or not self._recorded:
            return None
        entries = dict(self._entries)
        entries.update(self._recorded)
        document: dict[str, object] = {
            "schema_version": BASELINE_SCHEMA_VERSION,
            "signature": self.signature,
            "tolerance": self.tolerance,
            "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "metrics": {name: entry.to_json() for name, entry in sorted(entries.items())},
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        handle, temp_name = tempfile.mkstemp(
            dir=str(self.path.parent), prefix=f".{self.path.name}.", suffix=".tmp"
        )
        temp_path = Path(temp_name)
        try:
            with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_path, self.path)
        except BaseException:
            temp_path.unlink(missing_ok=True)
            raise
        print(f"[perf] baseline regravada em {self.path} ({len(self._recorded)} métricas)")
        return self.path

    def report(self) -> str:
        """Resumo legível das comparações da sessão (usado no fim da execução de perf)."""
        if not self.comparisons:
            return "Nenhuma métrica de desempenho foi medida."
        lines = [f"Portão de desempenho — {len(self.comparisons)} métricas:"]
        for comparison in self.comparisons:
            measurement = comparison.measurement
            p95 = f"p95={measurement.p95_ms:.4f} {measurement.unit}"
            lines.append(f"  {measurement.metric:<34} {p95:>18}  {comparison.status}")
            lines.append(f"  {'':<34} {comparison.detail}")
        return "\n".join(lines)


__all__ = [
    "BASELINE_SCHEMA_VERSION",
    "DEFAULT_BASELINE_PATH",
    "DEFAULT_TOLERANCE",
    "ENFORCE_ENV",
    "PATH_ENV",
    "TOLERANCE_ENV",
    "UPDATE_ENV",
    "BaselineEntry",
    "Comparison",
    "Measurement",
    "PerfBaseline",
    "PerfBaselineError",
    "current_machine_signature",
]
