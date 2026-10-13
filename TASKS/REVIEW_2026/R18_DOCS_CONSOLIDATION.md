# R18 — Consolidação de documentação e ADRs

> **ID:** R18 · **Prioridade:** P2 · **Onda:** 0 (pode correr em paralelo com R01, só docs)
> **Status:** 🔴 TODO · **Progresso:** 0/6 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** — · **Bloqueia:** — · **Branch:** `docs/r18-consolidation` · **PR:** —
> **Referência:** CODE_REVIEW §2.11 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
Na raiz: `ARCHITECTURE.md`, `AUDITORIA_DOCS_SENIOR.md`, `CONTRIBUTING.md`, `README.md`, `REFACTOR_PLAN.md`, `STANDARDS.md`, `STATUS.md` (≈ 116 KB), `TASKS/ROADMAP_MESTRE.md`, `TASK_01..09_*`. Há sobreposição e partes desatualizadas (ex.: `ARCHITECTURE.md` afirma `/process_frame` "blindado contra DoS" e inferência apenas no browser, o que já não corresponde).

## 2. Objetivo
Documentação **única, atual e navegável** em `docs/`, com registo de decisões (ADR) e cada documento com cabeçalho de estado.

## 3. Âmbito
**Cria:** `docs/{README.md,architecture.md,adr/,runbook.md,glossary.md}`, `docs/adr/000-template.md`.
**Altera:** documentos da raiz (movidos/arquivados), `README.md` raiz (curto, com links).
**Não mexe:** código; `TASKS/REVIEW_2026/*` (apenas links).

## 4. Subtarefas
- [ ] **1. Inventário:** tabela em `docs/README.md` com cada documento existente: propósito, estado (`vigente|obsoleto|histórico`), destino (manter/fundir/arquivar). Verificar afirmações contra o código **atual** (marcar divergências).
- [ ] **2. Cabeçalho padrão** em todos os `.md` vigentes: `> **Status:** ... · **Versão:** ... · **Última atualização:** ISO · **Responsável:** ... · **Revisto contra o código em:** <git sha>`. Regra: quem altera código descrito tem de atualizar o cabeçalho (ver protocolo §3.4).
- [ ] **3. `docs/architecture.md`:** fundir `ARCHITECTURE.md` + partes úteis de `REFACTOR_PLAN.md`/`STATUS.md`; diagramas (mermaid) atualizados: camadas, fluxo WS, concorrência (R03), pipeline (R14), modelo de dados (R07). Marcar secções que dependem de tarefas ainda não concluídas com `⚠ alvo (ver Rxx)`.
- [ ] **4. ADRs iniciais** (`docs/adr/NNN-titulo.md`, formato: contexto, decisão, consequências, estado): 001 estrutura monorepo; 002 token local vs OAuth (D2); 003 DirectML vs OpenVINO vs ncnn; 004 licença Ultralytics (D1); 005 cifra de BD (D3); 006 convenção de ângulos (internos) e unidades; 007 domínio partilhado web/desktop.
- [ ] **5. Arquivo:** mover documentos históricos para `docs/archive/` com nota no topo ("obsoleto desde …, substituído por …"); `STATUS.md` gigante → resumo em `docs/status.md` + original em arquivo. Atualizar links internos (verificar com `markdown-link-check`).
- [ ] **6. README raiz e CONTRIBUTING:** `README.md` ≤ 150 linhas (o que é, como correr backend/frontend/desktop, links para `docs/`); `CONTRIBUTING.md` com o fluxo de tarefas (`TASKS/REVIEW_2026`), Conventional Commits e regras do protocolo. Marcar CODE_REVIEW §2.11 (documentação) `✅ Resolvido em R18`.

## 5. Critérios de aceitação
- Nenhum documento vigente com afirmações contraditórias ao código (checklist de verificação em *Evidências*).
- Todos os links internos válidos; todos os `.md` vigentes com cabeçalho padrão.
- ≥ 7 ADRs criadas; decisões D1–D4 do board referenciadas.

## 6. Verificação
```powershell
npx markdown-link-check -q README.md docs/**/*.md
Select-String -Path docs\**\*.md -Pattern "Última atualização" | Measure-Object
```

## 7. Riscos / Fora de âmbito
- Não apagar histórico: **arquivar**, nunca eliminar. Conflitos com R01 (movimentos) → fazer rebase e corrigir caminhos.

## 8. Prompt específico
```text
Executa a tarefa R18 (TASKS/REVIEW_2026/R18_DOCS_CONSOLIDATION.md) seguindo o Prompt mestre.
Verifica cada afirmação dos documentos contra o código atual antes de a manter. Arquiva em vez de apagar. Cabeçalho padrão em todos os .md vigentes.
```

## 9. Evidências
_(inventário, output do link check)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
