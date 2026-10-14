# Testes, marcadores e portões de desempenho (desktop)

> **Tarefa:** D14 · **Protocolo:** [`../TASKS/00_PROTOCOLO_LLM.md`](../TASKS/00_PROTOCOLO_LLM.md) §5 · **Plano:** [`../README_PLAN.md`](../README_PLAN.md) §9

Esta página é o manual de quem vai correr, escrever ou reparar testes do desktop. O
objetivo não é descrever cada teste; é deixar escrito **o que cada portão garante**, o que
**não** garante, e como se age quando ele dispara.

---

## 1. Correr os testes

```powershell
cd desktopapp

# O que corre sempre (é o que o CI corre num PR):
pytest -m "not slow and not needs_camera and not directml" -q

# Tudo o que é possível nesta máquina, com cobertura:
pytest --cov -q

# Só uma família:
pytest tests/unit -q            # ou: pytest -m unit -q
pytest tests/integration -q
pytest tests/ui -q
pytest tests/perf -q -s         # imprime os p50/p95 medidos

# Qualidade estática (o mesmo que o CI):
ruff check src tests scripts ; ruff format --check src tests scripts ; mypy src tests
```

`QT_QPA_PLATFORM` é fixado em `offscreen` pelo `tests/conftest.py`: nenhum teste abre uma
janela, mesmo numa máquina com sessão gráfica.

## 2. Marcadores

| Marcador | Significado | Corre por omissão? |
|---|---|---|
| `unit` | unidade pura, sem I/O real | sim |
| `integration` | atravessa módulos, processos ou o arranque da aplicação | sim |
| `ui` | interface com `pytest-qt`, sempre `offscreen` | sim |
| `perf` | medição com orçamento (arranque, latência, FPS) | sim |
| `slow` | robustez de longa duração (minutos) — D13 | **não** (CI noturno) |
| `directml` | exige `onnxruntime-directml` | **não** (job manual) |
| `needs_camera` | exige câmara real ligada ao PC alvo | **não** (opt-in) |
| `no_leak_check` | dispensa o portão de fugas (só para testes que provocam fugas de propósito) | — |

`unit`, `integration`, `ui` e `perf` são atribuídos **pela pasta** (`tests/conftest.py`,
`pytest_collection_modifyitems`): um teste novo herda a marca certa sem ninguém se lembrar
de a escrever. Os restantes são explícitos no ficheiro, porque descrevem um requisito de
hardware/duração, não uma localização.

`--strict-markers` está ligado: um marcador escrito com erro **falha** em vez de ser
ignorado — era assim que um teste de GPU acabaria a correr no runner errado em silêncio.

### 2.1 Testes de câmara real

Ficam `skip` com instruções; correm quando **e só quando** o operador autoriza:

```powershell
$env:ATHLETEMOTION_TEST_CAMERA = "1"
$env:QT_QPA_PLATFORM = "offscreen"
pytest tests/integration/test_camera_live.py -q -s -m needs_camera
```

Produz o FPS efetivo, os frames entregues/descartados, os avisos do driver e a latência de
`read()` com frame pronto — os números que a D03 não pôde medir sem hardware.

## 3. Fakes: `tests/fakes/`

| Ficheiro | Reproduz | Não reproduz |
|---|---|---|
| `fake_camera.py` | drivers que mentem, escritas aceites e ignoradas, leituras que falham, câmara desligada, relógio controlado | a ótica, a exposição real, a largura de banda USB |
| `fake_backend.py` | latência, falha a meio da série, travamento, **sessão única** (como o DirectML) | o resultado real de qualquer modelo |
| `fake_pipeline.py` | ritmo de resultados, defasagem resultado ↔ frame, `DEGRADED`/`FAILED` | o pipeline da D05 (é provisório, ver o cabeçalho do módulo) |
| `synthetic.py` | vídeo com frames identificáveis, frames com textura, poses e séries de pedalada determinísticas | dados de atletas, valores clínicos |

**Regra ao escrever um fake novo:** ele existe para substituir o que o teste não controla
(hardware, tempo, driver). Se um test double substituir lógica do próprio projeto, o teste
passa a medir o fake — e é aí que a suíte fica verde e o produto avariado. O
`fake_backend.py` impõe a restrição de sessão única exatamente por isso: um pipeline que
paralelize a mesma sessão falha no teste, como falharia na RX 580.

Os fakes têm testes próprios (`tests/unit/test_fakes.py`): uma ferramenta de verificação
avariada é pior do que nenhuma, porque enfraquece em silêncio tudo o que depende dela.

## 4. Portão de fugas

Uma fixture `autouse` (`tests/conftest.py`) verifica no fim de **cada** teste que não
ficaram:

1. **processos filhos** vivos (até 2 s de tolerância para terminações em curso);
2. **segmentos de memória partilhada** criados durante o teste (intercetando
   `ShmRing.create` no lado do teste).

Quando o teste já falhou, a verificação é dispensada (o primeiro erro é o que interessa
ler). Um teste que provoque uma fuga de propósito marca-se com `@pytest.mark.no_leak_check`.

**O que este portão não vê:** um segmento criado *dentro* de um processo filho (o registo
é do processo de teste) — mas, no Windows, esse segmento só desaparece quando o último
handle fecha, pelo que o filho que não o fecha aparece na verificação de processos. E um
anel que deixe de estar referenciado é fechado pelo CPython antes da verificação: o que o
portão apanha é a fuga que importa — a que mantém a referência viva (uma lista, um
*dict*, um pipeline que não fecha).

## 5. Portões de desempenho e baseline

Cada métrica em `tests/perf/` é verificada duas vezes, com naturezas diferentes:

| Verificação | Natureza | Quando se impõe |
|---|---|---|
| **Orçamento absoluto** (`budget_ms`) | requisito de produto (`README_PLAN` §4.2) | **sempre**, em qualquer máquina |
| **Regressão relativa** (`tests/perf/baseline.json`) | tendência face à última medição **na mesma máquina** | só com `PERF_BASELINE_ENFORCE=1` |

```powershell
# Medir e imprimir (não impõe a regressão, não grava nada):
pytest tests/perf -q -s

# Impor a tolerância de 15 % (verificação séria, numa máquina calma):
$env:PERF_BASELINE_ENFORCE = "1"; pytest tests/perf -q -s

# Regravar a baseline (só depois de perceber a mudança):
$env:PERF_BASELINE_UPDATE = "1"; pytest tests/perf -q -s
```

### 5.1 Porque é que a imposição da regressão é opt-in

Uma medição de parede numa estação de trabalho que também compila, corre o browser e o
antivírus move-se em dezenas de por cento sem que nada tenha regredido: na D04, o mesmo
pré-processamento a 720p mediu p50 0,84 ms numa execução calma e 1,10 ms noutra (≈ 30 %).
Um portão que falha por isso é ruído com autoridade de portão. Por isso:

- o **orçamento** (o requisito) impõe-se sempre;
- a **regressão** só se impõe quando alguém pede (`PERF_BASELINE_ENFORCE=1`) numa execução
  dedicada — local ou num runner estável;
- no **CI**, a comparação é reportada (fica nos artefactos), não imposta.

### 5.2 Não se compara o que não é comparável

A baseline guarda a **assinatura de hardware** (`runtime/hardware/probe.py`, a mesma noção
de «máquina» usada pelo autotune) e a tolerância por omissão é 15 %. Se a assinatura da
máquina for diferente da gravada, a comparação é recusada com o motivo impresso — e o
orçamento continua a ser imposto. Consequência a conhecer: uma atualização de driver muda a
assinatura e a comparação relativa deixa de acontecer; preferimos não comparar a comparar
mal.

### 5.3 Como atualizar a baseline

1. Perceber a mudança: foi uma alteração real (isto é o que se quer registar) ou ruído de
   máquina (então a execução não era comparável)?
2. Correr `pytest tests/perf -q -s` com a máquina o mais calma possível, **sem** cobertura
   ligada (a cobertura distorce as medições).
3. Comparar com os valores anteriores e **justificar** no registo da tarefa (D14 §11 ou o
   registo de quem alterou o código).
4. Regravar com `PERF_BASELINE_UPDATE=1` e confirmar o `diff` do
   [`baseline.json`](../tests/perf/baseline.json).

Uma baseline regravada sem justificação é uma forma silenciosa de desligar o portão.

### 5.4 Portões ainda por existir

| Métrica | Falta | Onde entra |
|---|---|---|
| sobrecarga do pipeline ponta-a-ponta (com backend falso) | o `Pipeline` da D05 | D05/D12 |
| `paintGL` (desenho offscreen) | o canvas da D07 | D07 |
| robustez de 10+ min (RSS, descarte de frames) | — | D13 (`slow`) |

Estão listados aqui de propósito: um portão que se julga existente e não existe é pior do
que um portão assumidamente em falta.

## 6. Dados de teste

Regra e proveniência em [`../tests/data/README.md`](../tests/data/README.md). Resumo: dados
**gerados** (`tests/fakes/synthetic.py`) em vez de versionados; landmarks reais só
anonimizados e documentados; nada com significado clínico. A política é verificada por
teste (`tests/unit/test_synthetic_data.py`).

## 7. CI

[`.github/workflows/desktop-ci.yml`](../../.github/workflows/desktop-ci.yml) — Windows,
Python 3.11 e 3.12, e corre só quando `desktopapp/**` muda:

| Job | O que faz | Quando |
|---|---|---|
| `quality` | `ruff`, `ruff format --check`, `mypy --strict`, testes com cobertura (`fail_under = 88`), artefacto de cobertura | PR e push em `main` |
| `perf` | portões de desempenho (orçamentos absolutos) + artefactos de medição | PR e push em `main` |
| `soak` | suíte completa, incluindo `slow` | noturno e manual |
| `directml` | testes `directml` com o extra instalado (DirectML funciona em CPU/WARP no runner) | manual |
| `security` | `pip-audit --skip-editable` | PR e push em `main` |

Notas de manutenção:

- **Não existe `uv.lock`**: o ambiente é criado com `uv venv` + `uv pip install`, porque
  `uv sync --frozen` falharia sempre sem lockfile. Criar o lockfile é trabalho próprio (e
  desejável, para reprodutibilidade exata).
- Uma vulnerabilidade reportada pelo `pip-audit` **não** se silencia: ou se sobe a versão,
  ou se acrescenta `--ignore-vuln <ID>` no workflow com a justificação em comentário.
- O job `directml` não corre por omissão (o `onnxruntime-directml` é pesado e conflitua com
  o `onnxruntime` normal).
- Os jobs não validam o instalador nem o hardware alvo: isso é a D15 e uma checklist manual
  no PC do utilizador.
