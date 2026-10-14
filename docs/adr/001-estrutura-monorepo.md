# ADR 001: Estrutura Monorepo Unificada (backend, frontend, desktopapp)

> **Status:** Aceite  
> **Data:** 2026-10-13  
> **Decisores:** Senior Core Developer, Equipa de Arquitetura  
> **Referência:** R01, CODE_REVIEW §2.1  

---

## 1. Contexto e Formulação do Problema
O repositório continha ficheiros de backend na raiz (`src/`, `server.py`, `scripts/`, `models/`), testes soltos (`tests/`) e frontend isolado em pasta aninhada (`frontend/mediapipe/`). Esta estrutura gerava ambiguidades de importação no Python, conflitos de ambiente virtual, duplicação de configurações de CI e dificultava o desenvolvimento conjunto da aplicação Desktop (`desktopapp/`).

---

## 2. Decisão Tomada
Reestruturar o repositório como um monorepo modular e coeso:
1. `backend/`: Código Python empacotado em `backend/src/athletemotion` com `pyproject.toml`, testes organizados em `backend/tests/` (unit, integration, e2e) e scripts operacionais em `backend/scripts/`.
2. `frontend/web/`: Aplicação web cliente (Vue 3, Pinia, ECharts) com tooling próprio (`package.json`, Vite, Vitest).
3. `desktopapp/`: Aplicação nativa Desktop em PyQt6 para o posto de ensaio em estúdio.
4. `docs/`: Documentação técnica central e ADRs.

---

## 3. Consequências e Trade-offs

### 3.1. Positivas (+)
- **Isolamento de Dependências:** O backend e o frontend possuem os seus próprios manifestos e fechaduras de versão independentes.
- **Imports Canónicos e Estáveis:** Todos os ficheiros Python usam `from athletemotion.<camada> import ...`, eliminando truques de `sys.path`.
- **CI Padronizado:** Matriz de testes no GitHub Actions executa pipelines de backend e frontend em paralelo com caminhos delimitados.

### 3.2. Negativas / Custos (-)
- Desenvolvedores precisam de executar comandos dentro de `backend/` ou `frontend/web/` respetivamente.

---

## 4. Conformidade e Validação
Garantido pela execução com sucesso de `pytest` com pacote `athletemotion` instalado em modo editável (`pip install -e .`) e `npm run build` no frontend.
