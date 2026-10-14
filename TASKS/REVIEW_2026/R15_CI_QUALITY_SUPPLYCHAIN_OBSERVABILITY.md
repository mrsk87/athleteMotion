# R15 — CI, qualidade de código, cadeia de fornecimento e observabilidade

> **ID:** R15 · **Prioridade:** P1 · **Onda:** 1
> **Status:** 🔵 REVIEW · **Progresso:** 9/9 · **Atribuído a:** Antigravity · **Início:** 2026-10-13 · **Última atualização:** 2026-10-13
> **Depende de:** R01 · **Bloqueia:** — · **Branch:** `chore/r15-ci-quality` · **PR:** —
> **Referência:** CODE_REVIEW §1.11, §2.12, §2.13 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar em `.github/workflows/ci.yml`, `release.yml`)
- Job backend em `ubuntu-latest` instala `requirements.txt` com `onnxruntime-directml` (wheels só Windows) → falha provável.
- Sem `ruff`, `mypy`, cobertura mínima, `pip-audit`, `npm audit`, CodeQL, Dependabot, lint/test de frontend.
- Dependências com `>=` sem tecto; `uv.lock` existe mas o CI instala de `requirements.txt`.
- `pytest/httpx/pytest-asyncio` em produção (R01 já separa em extras).

## 2. Objetivo
Pipeline de CI **reprodutível e rigoroso** (Windows para o backend com DirectML), qualidade estática, auditoria de dependências, relatórios de cobertura e logging estruturado.

## 3. Âmbito
**Cria/Altera:** `.github/workflows/{ci.yml,release.yml,codeql.yml}`, `.github/dependabot.yml`, `backend/pyproject.toml` (ruff/mypy/coverage/pytest config), `.pre-commit-config.yaml`, `athletemotion/logging_config.py`, `athletemotion/api/health.py`.
**Não mexe:** lógica de negócio (apenas correções triviais exigidas por lint, em commits separados `style:`).

## 4. Subtarefas
- [x] **1. Matriz de CI:** backend em **`windows-latest`** (Python 3.11 e 3.12) com `pip install -e ".[dev,directml]"`; job extra `ubuntu-latest` com CPU sem DirectML só para o domínio puro (`pytest tests/unit/ -v`). Marcadores pytest: `directml`, `slow`, `integration`.
- [x] **2. Ruff:** configuração em `pyproject.toml` (`select = ["E","F","I","B","UP","S","C4","SIM","RUF"]`, `S` com exceções justificadas para testes e scripts); `ruff format` e `ruff check` com 0 violações em 87 ficheiros.
- [x] **3. mypy:** `strict = true` para `athletemotion/domain/biomechanics/**` e `athletemotion/schemas/**`; zero erros em 12 source files sob `--strict`.
- [x] **4. Cobertura:** `pytest --cov=athletemotion --cov-fail-under=70`; baseline medido a 75.68%; relatório XML (`coverage.xml`) carregado como artefacto no CI.
- [x] **5. Auditoria:** `pip-audit` ativo (zero vulnerabilidades conhecidas), `dependabot.yml` semanal (pip, npm, github-actions), `codeql.yml` ativo (Python + JS).
- [x] **6. Frontend no CI:** `npm ci`, `npm run build`, `npm run verify` e `npm audit --omit=dev --audit-level=high` com cache npm no `ci.yml`.
- [x] **7. Pre-commit:** `.pre-commit-config.yaml` com bloqueio de ficheiros grandes (`check-added-large-files --maxkb=1000`), `ruff`, `ruff-format` e `semver-check`; `scripts/install_hooks.py` atualizado.
- [x] **8. Logging e saúde:** `logging_config.py` com formato JSON estruturado (`timestamp`, `level`, `name`, `message`, `request_id`, telemetria) e rotação de ficheiros (10MB, 5 backups); `/health/live` e `/health/ready` (validação de BD e EngineManager) com 5 novos testes de integração.
- [x] **9. Documentação:** `docs/quality.md` criado, badges no `README.md`, marcação no `CODE_REVIEW.md` (§1.11, §2.12, §2.13).

## 5. Critérios de aceitação
- CI verde em PR limpo no Windows e Ubuntu (domínio).
- Falha em: lint, tipos (domain), cobertura abaixo do mínimo, vulnerabilidade alta, segredo detetado, ficheiro > 1 MB de modelo.
- Nenhum `requirements.txt` usado no CI; builds reprodutíveis pelo lock.
- `/health/ready` reflete modelos ausentes (503) — testado.

## 6. Verificação
```powershell
cd backend
uv sync --frozen --extra dev
ruff check .; ruff format --check .; mypy src/athletemotion/domain src/athletemotion/schemas
pytest --cov=athletemotion --cov-report=term-missing -q
pip-audit
```

## 7. Riscos / Fora de âmbito
- Muitas violações iniciais do `ruff`: aplicar `--fix` seguro e commits separados; **não** misturar com mudanças funcionais.
- Runners Windows são mais lentos: usar cache `uv`.

## 8. Prompt específico
```text
Executa a tarefa R15 (TASKS/REVIEW_2026/R15_CI_QUALITY_SUPPLYCHAIN_OBSERVABILITY.md) seguindo o Prompt mestre.
Backend em windows-latest com uv.lock. Separa commits de estilo dos funcionais. Define o mínimo de cobertura a partir do baseline medido, não de um número inventado.
```

## 9. Evidências
- Suíte completa de testes: 88 passed, 0 failed em 10.08s.
- Cobertura de testes: 75.68% (portão obrigatório fail-under de 70% cumprido).
- Ruff linter: 87 files verificados, 0 avisos.
- Ruff formatter: 87 files verificados, 0 divergências.
- Mypy `--strict` em `domain/biomechanics` e `schemas`: 12 source files verificados, 0 erros.
- Pip-audit: 0 vulnerabilidades conhecidas nas dependências ativas.

## 10. Notas e Descobertas
- Os pacotes iniciais com CVE eram `pip` (24.0) e `setuptools` (79.0.1) instalados por defeito no `.venv`. A sua atualização para as versões mais recentes sanou todas as vulnerabilidades.
- O pipeline no GitHub Actions separa `windows-latest` (que suporta o wheel nativo de DirectML) do runner `ubuntu-latest` que corre o domínio e testes unitários apenas com o extra `dev` (sem tentar instalar rodas DirectML do Windows).

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-13 | Antigravity | 1–9 | `.github/*`, `pyproject.toml`, `.pre-commit-config.yaml`, `logging_config.py`, `health.py`, `docs/quality.md` | Implementação completa dos portões de qualidade, CI híbrido, auditoria, observabilidade JSON, health probes e testes |
