# Guia de Contribuição / Contributing Guide — Athlete Motion

> **Status:** 🟢 VIGENTE · **Versão:** 0.3.1 · **Última atualização:** 2026-10-14 · **Responsável:** Senior Core Developer  
> **Língua Principal:** Português (PT) | **Secondary:** English (EN)  
> **Padrão de Versionamento:** Semantic Versioning 2.0.0 (`MAJOR.MINOR.PATCH`)

---

## 1. Princípios de Engenharia (Senior Core Developer)

Todo o código submetido ao repositório deve respeitar escrupulosamente as diretrizes de [AGENTS.md](AGENTS.md):
1. **Rigor e Clareza:** Zero placebos, sem números inventados, sem mocks disfarçados de lógica real.
2. **Separação Rígida de Responsabilidades (SoC):** O domínio biomecânico puro (`athletemotion.domain`) nunca importa frameworks web (FastAPI), bases de dados (SQLAlchemy) ou bibliotecas de UI (PyQt6).
3. **Propriedades ACID:** Todas as mutações de persistência ocorrem sob transações atómicas com integridade referencial ativa e Write-Ahead Logging (WAL).
4. **Tipagem Estrita e Completa:** Argumentos, retornos e estruturas devem conter anotações completas de tipagem Python (`typing`, `Pydantic`, `numpy.typing.NDArray`).

---

## 2. Fluxo de Trabalho (Git Workflow)

1. Crie um branch descritivo a partir de `main`:
   - `git checkout -b feat/rXX-nome-da-tarefa`
   - `git checkout -b fix/descricao-do-bug`
2. Mantenha os commits atómicos, sequenciais e em conformidade com **Conventional Commits**:
   - `feat:` Novas funcionalidades ou motores.
   - `fix:` Correções de bugs.
   - `docs:` Alterações puras de documentação.
   - `refactor:` Alterações de código sem alteração de comportamento.
   - `perf:` Otimizações comprovadas com métricas de benchmark.
   - `test:` Adição ou correção de testes.
3. Toda a alteração relevante deve adicionar uma linha no topo de [`TASKS/REVIEW_2026/CHANGELOG.md`](TASKS/REVIEW_2026/CHANGELOG.md).

---

## 3. Portões de Qualidade Locais (Obrigatórios antes do Push)

Antes de abrir um Pull Request ou commitar, execute a suite completa de verificação:

```powershell
cd backend
# 1. Testes unitários e integração (218 testes devem passar)
pytest -q

# 2. Linter e formatação (zero avisos)
ruff check src/ tests/
ruff format --check src/ tests/

# 3. Tipagem estrita no domínio puro e schemas
mypy --strict src/athletemotion/domain/ src/athletemotion/services/reporting/ src/athletemotion/validation/
```

No frontend:
```powershell
cd frontend/web
npm run lint
npm run build
```

---

## 4. Documentação de Apoio

- 📖 **[Índice Central de Documentação](docs/README.md):** Mapa consolidado de todos os manuais técnicos.
- 🏛️ **[Arquitetura Global do Sistema](docs/architecture.md):** Diagramas Mermaid de camadas e fluxos de dados.
- 📐 **[ADRs (Architecture Decision Records)](docs/adr/):** Decisões fundamentais de arquitetura documentadas.
- ⚙️ **[Manual Operacional (Runbook)](docs/runbook.md):** Procedimentos operacionais detalhados.
