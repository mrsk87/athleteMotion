# R15 — CI, qualidade de código, cadeia de fornecimento e observabilidade

> **ID:** R15 · **Prioridade:** P1 · **Onda:** 1
> **Status:** 🔴 TODO · **Progresso:** 0/9 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
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
- [ ] **1. Matriz de CI:** backend em **`windows-latest`** (Python 3.11 e 3.12) com `uv sync --frozen --extra dev --extra directml`; job extra `ubuntu-latest` com extra `cpu` (ORT CPU) só para o domínio puro (`pytest -m "not directml"`). Marcadores pytest: `directml`, `slow`, `integration`.
- [ ] **2. Ruff:** configuração em `pyproject` (`select = ["E","F","I","B","UP","S","C4","SIM","RUF"]`, `S` com exceções justificadas para testes); `ruff format`. Corrigir violações em commits `style:` separados.
- [ ] **3. mypy:** `strict = true` para `athletemotion/domain/**` e `athletemotion/schemas/**`; modo normal no resto; `# type: ignore` só com código e justificação. Subir gradualmente (lista de módulos em `[[tool.mypy.overrides]]`).
- [ ] **4. Cobertura:** `pytest --cov=athletemotion --cov-fail-under=<baseline arredondado -2>`; relatório XML/HTML como artefacto; objetivo de ≥ 85 % em `domain/` (meta, tabela de evolução em `docs/quality.md`).
- [ ] **5. Auditoria:** `pip-audit` (backend, falha em HIGH/CRITICAL), `npm audit --omit=dev --audit-level=high` (frontend), `gitleaks` (segredos), CodeQL (Python + JS), Dependabot semanal (pip, npm, github-actions). Fixar versões: `uv.lock` é fonte; remover instalação por `requirements.txt` do CI.
- [ ] **6. Frontend no CI:** `npm ci`, `npm run lint`, `npm run test` (se R16 já criou), `npm run build`; cache npm; verificação de que `VERSION` == `package.json` (mantida).
- [ ] **7. Pre-commit:** `.pre-commit-config.yaml` (ruff, ruff-format, end-of-file, trailing-whitespace, `check-added-large-files --maxkb=1000` para impedir pesos de modelos, `detect-secrets`); `scripts/install_hooks.py` integra.
- [ ] **8. Logging e saúde:** `logging_config.py` com formato JSON (`structlog` ou `logging` + `python-json-logger`), `request_id` (R04), níveis por módulo, rotação de ficheiros em `APP_DATA_DIR/logs`; `/health/live` (processo) e `/health/ready` (BD ok + motores/modelos disponíveis + versão), sem dados sensíveis.
- [ ] **9. Documentação:** `docs/quality.md` (como correr tudo localmente, políticas de lint/tipos, como atualizar dependências), badge de CI no `README`. Marcar CODE_REVIEW §1.11/2.12/2.13 `✅ Resolvido em R15`.

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
_(runs de CI, baseline de cobertura, saída pip-audit)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
