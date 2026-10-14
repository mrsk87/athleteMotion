# D14 — Testes (pytest-qt), portões de desempenho e CI Windows

> **ID:** D14 · **Prioridade:** P0 · **Onda:** 0 (após D01)
> **Status:** 🔵 REVIEW · **Progresso:** 7/7 · **Atribuído a:** Buffy (Codebuff) · **Início:** 2026-10-14 · **Última atualização:** 2026-10-14
> **Depende de:** D01 · **Bloqueia:** — (apoia todas) · **Branch:** `fix/r03-engine-sessions` (checkout partilhado) · **PR:** —
> **Referência:** README_PLAN §9 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
Sem infraestrutura de testes robusta, os módulos de tempo real (multiprocessing, shared memory, Qt) regridem silenciosamente. O CI do backend (R15) corre em Windows; o desktop precisa do seu.

## 2. Objetivo
Infraestrutura de testes partilhada (fixtures, fakes), marcadores, portões de desempenho (benchmarks com limites) e workflow de CI Windows para o desktop.

## 3. Âmbito
**Cria:** `tests/conftest.py`, `tests/fakes/{fake_camera.py,fake_backend.py,fake_pipeline.py}`, `tests/data/` (landmarks `.npz`, vídeo sintético gerado), `tests/perf/`, `.github/workflows/desktop-ci.yml`, `pyproject` (config pytest/ruff/mypy/coverage), `docs/testing.md`.
**Não mexe:** código de produção (exceto *hooks* de teste mínimos).

**Desvios ao âmbito (justificados):**
- `tests/support/fake_capture.py` **foi movido** para `tests/fakes/fake_camera.py` (com `git mv`) e os 5 ficheiros que o importavam foram atualizados: a tarefa pede uma pasta de fakes, e manter duas (a antiga `support/` e a nova `fakes/`) garantia que a próxima pessoa acrescentaria um dobre no sítio errado. Zero duplicação.
- `tests/support/{perf_baseline.py,leaks.py}` acrescentados: o portão de desempenho e o guarda de fugas são **lógica de verificação reutilizável**, e não código de teste descartável. Tê-los em módulos próprios é o que permite testá-los unitariamente (`tests/unit/test_perf_baseline.py`, `tests/unit/test_leak_guard.py`) — um portão que nunca se viu falhar não é um portão.
- `tests/integration/test_camera_live.py` acrescentado: a D03 fechou com a verificação em câmara real **por fazer** (§9.4 daquela tarefa). Passa a ser um comando no PC alvo, marcado `needs_camera` e opt-in, em vez de uma nota de rodapé.
- `desktopapp/.gitignore`: `data/` → `/data/` (uma regra sem barra engolia `tests/data`, que é versionada) e novas entradas para artefactos de teste (`.benchmarks/`, `coverage.xml`, `benchmark.json`).
- `pyproject.toml`: `pytest-timeout` acrescentado às dependências de desenvolvimento — é o mecanismo pedido em §4.1 para impedir que um *hang* de multiprocessing/Qt bloqueie o CI durante horas.
- Não se tocou em código de produção (a interceção de `ShmRing.create` para o registo de segmentos vive no teste, não no `ShmRing`).

## 4. Subtarefas
- [x] **1. Config pytest:** marcadores `unit`, `integration`, `ui`, `perf`, `slow`, `directml`, `needs_camera` (+ `no_leak_check`), `--strict-markers`, `QT_QPA_PLATFORM=offscreen` por omissão, `pytest-timeout` (`--timeout=300`, método `thread`) e configuração de cobertura com `fail_under = 88` (medido 91,6 %).
- [x] **2. Fakes determinísticos:** `FakeCamera`/`FakeCaptureDevice`/`FakeClock` (padrão + timestamps, controla *drops*/reconexão), `FakeBackend` (latência, falha injetada, travamento, **sessão única** como o DirectML), `FakePipeline` (ritmo, defasagem resultado↔frame, `DEGRADED`/`FAILED`) e geradores sintéticos em `tests/fakes/synthetic.py`.
- [x] **3. Fixture de limpeza:** fixture `autouse` que no fim de cada teste verifica ausência de **processos filhos** e de **segmentos de memória partilhada** órfãos, com `assert_no_leaks()`; dispensa-se quando o teste já falhou e por `@pytest.mark.no_leak_check`.
- [x] **4. Dados de teste:** vídeo sintético gerado em tempo de execução, frames/poses/séries determinísticos; `tests/data/README.md` com a política de proveniência e o que falta (landmarks anonimizados do humano); política verificada por teste.
- [x] **5. Portões de desempenho:** `tests/perf/baseline.json` com as métricas medidas, tolerância de 15 % imposta por `PERF_BASELINE_ENFORCE=1` e **orçamento absoluto sempre imposto**; comparação recusada quando a assinatura de hardware é diferente (ver §10.2); relatório de sessão impresso no fim.
- [x] **6. CI (`desktop-ci.yml`):** `windows-latest`, Python 3.11/3.12, `uv venv` + `uv pip install -e ".[dev]"`, `ruff`/`ruff format`/`mypy --strict`, testes com cobertura e artefactos, job de desempenho, job noturno com `slow`, job manual `directml` e `pip-audit`.
- [x] **7. Docs:** `docs/testing.md` (como correr, marcadores, fakes, política de desempenho e como atualizar a baseline), `README_PLAN` §9/§12/§15, board, changelog e este registo.

## 5. Critérios de aceitação
- ✅ **Falha ao introduzir um *leak* deliberado:** com um teste temporário que deixa um segmento vivo (referenciado) e um processo a dormir, o portão falha os dois com identificação (`[memoria-partilhada]` e `[processo]`) e a execução termina com código 1 — ver 9.3.
- ✅ **Falha ao piorar 30 % o anel:** mecanismo provado ao nível do limiar (`test_regression_of_thirty_percent_fails_when_enforced`: +30,0 % ⇒ `PerfBaselineError`) e demonstrado ponta-a-ponta com uma baseline de prova 30 % melhor (9.4). O ruído da máquina, que é outra coisa, fica medido e documentado (§10.1).
- ✅ **Nenhum teste depende de câmara/GPU por omissão:** `needs_camera` (opt-in explícito por variável de ambiente) e `directml` excluídos do CI de PR; a suíte corre sem hardware.
- ✅ **Testes não deixam processos/ficheiros temporários:** verificação automática em todos os testes + artefactos de ferramentas fora do Git.

## 6. Verificação
```powershell
cd desktopapp
$env:QT_QPA_PLATFORM="offscreen"
python -m pytest -m "not slow and not needs_camera and not directml" -q --cov    # 395 passed, 2 deselected
python -m pytest tests/perf -q -s                                               # impressão do p50/p95 + baseline
ruff check src tests scripts ; ruff format --check src tests scripts ; mypy src tests
$env:PERF_BASELINE_UPDATE="1"; python -m pytest tests/perf -q -s                # regravar baseline (com justificação)
```

## 7. Riscos / Fora de âmbito
- Benchmarks em CI partilhado são ruidosos: orçamentos folgados + tendência, nunca valores absolutos comparados entre máquinas (§10.1 e `docs/testing.md` §5).
- Testes end-to-end com câmara real continuam a ser **manuais** (`tests/integration/test_camera_live.py`), por dependerem do hardware do PC alvo.
- Não coberto aqui: instalador/pacote (D15), robustez de minutos (D13, marcador `slow` já pronto) e a validação científica com *ground-truth* (R17).

## 8. Prompt específico
```text
Executa a tarefa D14 (desktopapp/TASKS/D14_TESTING_CI.md) seguindo o Prompt mestre do desktop.
Fakes determinísticos; fixture que falha em leaks de processos/SharedMemory; limites de desempenho com baseline; CI em Windows. Não versiones dados pesados.
```

## 9. Evidências

### 9.1. Suíte, cobertura e qualidade estática
```
pytest -m "not slow and not needs_camera and not directml" -q --cov
  395 passed, 2 deselected in 49.45s          (339 testes na D03; +56 desta tarefa)
  Required test coverage of 88.0% reached. Total coverage: 91.60%
ruff check src tests scripts            → All checks passed!
ruff format --check src tests scripts   → 103 files already formatted
mypy src tests                          → Success: no issues found in 102 source files
```
Cobertura medida ligeiramente abaixo da D03 (91,60 % vs 91,9 %) porque as linhas novas são quase todas de *testes* (fora da cobertura) e o teto de 88 % fica 3,6 pontos abaixo do medido: um módulo novo sem testes acciona-o, uma oscilação de refactor não.

### 9.2. Marcadores aplicados por pasta
```
pytest -m needs_camera -q -rs
  2 skipped: "teste com câmara real: defina ATHLETEMOTION_TEST_CAMERA=1 no PC alvo para o correr"
```
`unit`, `integration`, `ui` e `perf` são atribuídos pela pasta em `pytest_collection_modifyitems` (um teste novo herda a marca certa); `needs_camera` e `directml` são explícitos, porque descrevem um requisito de hardware.

### 9.3. O guarda de fugas **falha** quando deve (prova com ficheiro temporário, já removido)
```
tests/unit/test_zz_fuga_deliberada.py:
  E  LeakDetectedError: O teste deixou 1 recurso(s) vivo(s):
  E    - [memoria-partilhada] o segmento 'psm_amring_frames_24808_43465f67' continua a existir:
  E      falta `unlink()`/`shutdown()` no dono (quem cria é quem remove)
  E  LeakDetectedError: O teste deixou 1 recurso(s) vivo(s):
  E    - [processo] processo 24564 ('python.exe') continua a correr: ... spawn_main(parent_pid=24808)
  3 passed, 3 errors · exit code 1
```
Descoberta registada em §10.3: um anel cuja última referência morre é fechado pelo CPython **antes** da verificação (o `atexit`/handle desaparece), pelo que a prova do caso de memória partilhada exige que o anel continue referenciado — que é exatamente a forma de uma fuga real (uma lista/`dict`/pipeline que nunca fecha).

### 9.4. O portão de desempenho **falha** numa regressão
```
baseline de prova: "anel SPSC 720p" p95=0.014 ms (a baseline real 30 % melhor)
PERF_BASELINE_ENFORCE=1 PERF_BASELINE_PATH=.prova/regressao_baseline.json pytest tests/perf/test_ring_buffer_perf.py
  E  PerfBaselineError: Regressão de desempenho em 'anel SPSC 720p (escrita+leitura)':
  E    p95 0.0269 ms contra baseline 0.0140 ms (+92.1%, tolerância 15%, gravada em 2026-10-13T23:57:0…)
  1 failed, 1 passed · exit code 1
```
O limiar de 30 % é verificado ao nível do mecanismo (`tests/unit/test_perf_baseline.py::test_regression_of_thirty_percent_fails_when_enforced`), onde a medição é determinística: não depende do ruído desta máquina.

### 9.5. Baseline gravada (execução dedicada de `tests/perf`)
```
PERF_BASELINE_UPDATE=1 pytest tests/perf -q -s
  captura read() com frame pronto      p95=0.0905 ms  (orçamento 1 ms)
  captura ficheiro 320x240 (débito)    p95=150.04 ms  (informativa, sem orçamento)
  preprocess 720p->320                 p95=1.2275 ms  (orçamento 2 ms)
  preprocess 1080p->640                p95=3.9917 ms  (orçamento 10 ms)
  preprocess rt 192x256                p95=0.4218 ms  (orçamento 2 ms)
  anel SPSC 720p (escrita+leitura)     p95=0.0182 ms  (orçamento 0,2 ms)
  arranque da aplicação (subprocesso)  p95=868.8 ms   (orçamento 2000 ms; amostra única)
  baseline regravada em tests/perf/baseline.json (7 métricas, assinatura 69e277454450b10b)
```
A baseline guarda a assinatura de hardware e o instante de gravação de cada métrica: uma comparação entre máquinas diferentes é **recusada com o motivo**, em vez de produzida com uma diferença sem sentido.

### 9.6. Custo do guarda de fugas
```
guarda de fugas: 6.410 ms por teste (n=300)
```
≈ 2,5 s em 395 testes (5 % da suíte de 49 s) — o preço de o guarda correr em *todos* os testes em vez de só onde alguém se lembra de o pedir. Medido com `grace_s=0`, ou seja, o pior caso de "sem fugas".

### 9.7. Fakes testados
`tests/unit/test_fakes.py` (16 testes) prova que os dobres fazem o que dizem: a latência foi realmente gasta, a falha injetada chega depois de N inferências válidas, o travamento obriga a segunda inferência a falhar **durante** a primeira (o comportamento do DirectML), o observador avariado não impede a entrega aos restantes, e `latest()` expõe a defasagem resultado↔frame.

### 9.8. Workflow de CI
`desktop-ci.yml` validado por *parse* (PyYAML: 5 jobs, `runs-on: windows-latest` em todos) e por revisão dos comandos. **Não executado num runner GitHub nesta sessão** — ver §10.4.

## 10. Notas e Descobertas

### 10.1. A comparação de desempenho relativa é opt-in — e porquê
Uma medição de parede numa estação de trabalho que também compila, corre browser e antivírus move-se em dezenas de por cento sem nada ter regredido: na D04 o mesmo pré-processamento mediu p50 0,84 ms e 1,10 ms em execuções distintas (≈ 30 %). Impor 15 % por omissão seria um portão que falha ao ritmo da máquina. Decisão: **o orçamento absoluto impõe-se sempre** (é o requisito) e a **regressão relativa** só se impõe com `PERF_BASELINE_ENFORCE=1`, numa execução dedicada; no CI é reportada e publicada em artefacto. A tolerância (15 %) e o caminho da baseline continuam configuráveis por ambiente, para quando existir um runner estável.

### 10.2. Comparar máquinas diferentes não é comparar
A baseline usa a mesma noção de "máquina" do autotune (`build_hardware_signature`: CPU, núcleos, GPUs/driver, providers ORT/OpenVINO). Se a assinatura diferir, a comparação é recusada com o motivo impresso e o orçamento continua a ser imposto. Efeito colateral aceite e documentado: uma atualização de driver invalida a comparação relativa (preferimos não comparar a comparar mal).

### 10.3. Um anel sem referências fecha-se sozinho — o guarda apanha o que importa
A primeira versão da prova de fuga falhou em silêncio: um `ShmRing.create()` sem `shutdown()` foi **fechado pelo CPython** ao sair de âmbito (o handle fecha e, no Windows, o segmento desaparece) antes de o guarda verificar. A fuga que este portão tem de apanhar é a outra: a que mantém a referência viva (uma lista, um `dict`, um pipeline que não fecha) ou que deixa um **processo** a segurar o segmento. Com o anel referenciado num contentor de módulo, o guarda falha como deve (§9.3). Fica registado como limitação conhecida: segmentos criados em processos filhos não são vistos pelo registo (mas os filhos são).

### 10.4. Testar o CI sem CI
Nesta sessão não havia runner GitHub. O que ficou verificado: (a) o YAML é sintaticamente válido e todos os jobs declaram `windows-latest`; (b) cada comando do workflow foi executado localmente na mesma forma (`ruff check src tests scripts`, `ruff format --check …`, `mypy src tests`, `pytest -m "not slow and not needs_camera and not directml" --cov`, `pytest tests/perf`); (c) `pip-audit` **não** foi executado (exige rede e auditoria de dependências) e o job de `directml` também não — seria preciso o extra instalado. Estes dois passos são os únicos pontos cegos, e estão declarados.

### 10.5. `uv sync --frozen` não é usável ainda
Não existe `uv.lock` no projeto (o `pyproject.toml` fixa as dependências, não as versões resolvidas). O workflow usa `uv venv` + `uv pip install -e ".[dev]"` e traz um comentário a explicar porquê; criar o lockfile é um passo próprio (reprodutibilidade exata), não um detalhe desta tarefa.

### 10.6. Timeout sem `sleep` cego
`--timeout=300` com o método `thread` do `pytest-timeout` (o `signal` não serve no Windows para este efeito) cobre hangs de multiprocessing e de Qt, e imprime a *stack* do que ficou preso antes de abortar — um CI que fica pendurado 6 horas não diz nada a ninguém.

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-14 | Buffy (Codebuff) | 5 | `tests/support/perf_baseline.py`, `tests/unit/test_perf_baseline.py`, `tests/perf/{conftest.py,baseline.json,test_ring_buffer_perf.py,test_preprocess_perf.py,test_capture_perf.py,test_startup_time.py}` | Portão de desempenho com orçamento absoluto sempre imposto e regressão relativa opt-in contra baseline por máquina; 23 testes do próprio portão (limiar de 30 %, recusa entre máquinas, gravação atómica, baseline inválida) |
| 2026-10-14 | Buffy (Codebuff) | 3 | `tests/support/leaks.py`, `tests/conftest.py`, `tests/unit/test_leak_guard.py` | Guarda de fugas (processos + segmentos de memória partilhada) aplicado a todos os testes, com dispensa explícita quando o teste já falhou ou por marcador; 8 testes, incluindo a prova de que deteta as duas naturezas |
| 2026-10-14 | Buffy (Codebuff) | 2 | `tests/fakes/{__init__.py,fake_camera.py,fake_backend.py,fake_pipeline.py,synthetic.py}`, `tests/unit/{test_fakes.py,test_synthetic_data.py}`, `tests/support/fake_capture.py` (movido) | Fakes determinísticos reutilizáveis (câmara, backend com sessão única, pipeline provisório) e geradores sintéticos; captura passou a usar a pasta única de fakes; 25 testes novos dos dobres e dos dados |
| 2026-10-14 | Buffy (Codebuff) | 4 | `tests/data/{README.md,.gitignore}`, `desktopapp/.gitignore` | Política de proveniência dos dados (gerar em vez de versionar; landmarks anonimizados pendentes do humano) verificada por teste; corrigida a regra `data/` que engolia `tests/data` |
| 2026-10-14 | Buffy (Codebuff) | 1 | `pyproject.toml`, `tests/conftest.py` | Marcadores (incluindo os atribuídos por pasta), `--strict-markers`, `pytest-timeout`, cobertura com teto de 88 % e `pytest-timeout` nas dependências de desenvolvimento |
| 2026-10-14 | Buffy (Codebuff) | 6–7 | `.github/workflows/desktop-ci.yml`, `desktopapp/docs/testing.md`, `tests/integration/test_camera_live.py`, `TASKS/*`, `README.md`, `README_PLAN.md` | CI Windows (qualidade, desempenho, noturno, DirectML manual, auditoria), manual de testes e o teste de câmara real que a D03 deixou pendente |
