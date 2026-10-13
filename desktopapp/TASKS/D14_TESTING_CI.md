# D14 — Testes (pytest-qt), portões de desempenho e CI Windows

> **ID:** D14 · **Prioridade:** P0 · **Onda:** 0 (após D01)
> **Status:** 🔴 TODO · **Progresso:** 0/7 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D01 · **Bloqueia:** — (apoia todas) · **Branch:** `chore/d14-testing-ci` · **PR:** —
> **Referência:** README_PLAN §9 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
Sem infraestrutura de testes robusta, os módulos de tempo real (multiprocessing, shared memory, Qt) regridem silenciosamente. O CI do backend (R15) corre em Windows; o desktop precisa do seu.

## 2. Objetivo
Infraestrutura de testes partilhada (fixtures, fakes), marcadores, portões de desempenho (benchmarks com limites) e workflow de CI Windows para o desktop.

## 3. Âmbito
**Cria:** `tests/conftest.py`, `tests/fakes/{fake_camera.py,fake_backend.py,fake_pipeline.py}`, `tests/data/` (landmarks `.npz`, vídeo sintético gerado), `tests/perf/`, `.github/workflows/desktop-ci.yml`, `pyproject` (config pytest/ruff/mypy/coverage), `docs/testing.md`.
**Não mexe:** código de produção (exceto *hooks* de teste mínimos).

## 4. Subtarefas
- [ ] **1. Config pytest:** marcadores `unit`, `integration`, `ui`, `perf`, `slow`, `directml`, `needs_camera`; `-p no:cacheprovider` opcional; `QT_QPA_PLATFORM=offscreen` por defeito; *timeouts* (`pytest-timeout`) para evitar *hangs* de multiprocessing; `--strict-markers`.
- [ ] **2. Fakes determinísticos:** `FakeCamera` (padrão + timestamps, controla *drops*/reconexão), `FakeBackend` (latência configurável, devolve keypoints sintéticos), `FakePipeline`; geradores sintéticos reutilizam o `synthetic_pedaling` do backend (R10).
- [ ] **3. Fixtures de limpeza:** *fixture* autouse que após cada teste verifica **ausência de processos filhos e `SharedMemory` órfãos** e falha o teste se existirem; utilitário `assert_no_leaks()`.
- [ ] **4. Dados de teste:** gerar (não versionar pesados) vídeo sintético curto com ffmpeg/OpenCV; `.npz` de landmarks reais **anonimizados** (apenas coordenadas) fornecidos pelo humano; documentar proveniência.
- [ ] **5. Portões de desempenho (`tests/perf`):** `pytest-benchmark` com limites (`max` p95) para ring buffer, pré-processamento, overhead do pipeline (com backend fake), `paintGL` (offscreen aproximado); *baseline* gravada em `tests/perf/baseline.json`; falha se > 15 % pior (configurável); execução em runner Windows dedicado/estável (aviso de ruído).
- [ ] **6. CI (`desktop-ci.yml`):** `windows-latest`, Python 3.11/3.12, `uv sync --frozen`, `ruff check/format`, `mypy` (strict em `runtime/`, `domain_bridge/`), `pytest -m "not slow and not needs_camera and not directml"` com cobertura (`--cov-fail-under` do baseline), upload de artefactos (cobertura, relatórios perf); *job* noturno com `slow` (soak D13) e `directml` quando houver runner; `pip-audit`.
- [ ] **7. Docs:** `docs/testing.md` (como correr localmente, marcadores, como criar fakes, política de perf, como atualizar baseline com justificação). Atualizar `README_PLAN`, board/changelog.

## 5. Critérios de aceitação
- CI verde num PR de exemplo; falha ao introduzir um *leak* de `SharedMemory` deliberado e ao piorar 30 % o benchmark do ring buffer.
- Nenhum teste depende de câmara/GPU por defeito.
- Testes não deixam processos/ficheiros temporários.

## 6. Verificação
```powershell
cd desktopapp
pytest -m "not slow and not needs_camera and not directml" -q --cov=athletemotion_desktop
pytest tests/perf -q --benchmark-compare
```

## 7. Riscos / Fora de âmbito
- Benchmarks em CI partilhado são ruidosos: usar limites folgados + tendência, não valores absolutos.
- Testes e2e com câmara real são manuais (checklist nas tarefas).

## 8. Prompt específico
```text
Executa a tarefa D14 (desktopapp/TASKS/D14_TESTING_CI.md) seguindo o Prompt mestre do desktop.
Fakes determinísticos; fixture que falha em leaks de processos/SharedMemory; limites de desempenho com baseline; CI em Windows. Não versiones dados pesados.
```

## 9. Evidências
_(CI verde, prova de falha em leak/regressão)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
