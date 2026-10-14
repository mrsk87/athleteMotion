# R18 — Consolidação de documentação e ADRs

> **ID:** R18 · **Prioridade:** P2 · **Onda:** 4
> **Status:** 🔵 REVIEW · **Progresso:** 6/6 · **Atribuído a:** Senior Core Developer · **Início:** 2026-10-14 · **Última atualização:** 2026-10-14
> **Depende de:** R17 · **Bloqueia:** — · **Branch:** `docs/r18-consolidation` · **PR:** —
> **Referência:** CODE_REVIEW §2.11 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
Na raiz: `ARCHITECTURE.md`, `AUDITORIA_DOCS_SENIOR.md`, `CONTRIBUTING.md`, `README.md`, `REFACTOR_PLAN.md`, `STANDARDS.md`, `STATUS.md` (≈ 116 KB), `TASKS/ROADMAP_MESTRE.md`, `TASK_01..09_*`. Havia sobreposição e partes desatualizadas (ex.: `ARCHITECTURE.md` afirmava `/process_frame` "blindado contra DoS" e inferência apenas no browser, o que já não correspondia).

## 2. Objetivo
Documentação **única, atual e navegável** em `docs/`, com registo de decisões (ADR) e cada documento com cabeçalho de estado.

## 3. Âmbito
**Cria:** `docs/{README.md,architecture.md,adr/,runbook.md,glossary.md}`, `docs/adr/000-template.md`.
**Altera:** documentos da raiz (movidos/arquivados), `README.md` raiz (curto, com links).
**Não mexe:** código; `TASKS/REVIEW_2026/*` (apenas links).

## 4. Subtarefas
- [x] **1. Inventário:** tabela em `docs/README.md` com cada documento existente: propósito, estado (`vigente|obsoleto|histórico`), destino (manter/fundir/arquivar). Verificar afirmações contra o código **atual** (marcar divergências).
- [x] **2. Cabeçalho padrão** em todos os `.md` vigentes: `> **Status:** ... · **Versão:** ... · **Última atualização:** ISO · **Responsável:** ... · **Revisto contra o código em:** <git sha>`. Regra: quem altera código descrito tem de atualizar o cabeçalho (ver protocolo §3.4).
- [x] **3. `docs/architecture.md`:** fundir `ARCHITECTURE.md` + partes úteis de `REFACTOR_PLAN.md`/`STATUS.md`; diagramas (mermaid) atualizados: camadas, fluxo WS, concorrência (R03), pipeline (R14), modelo de dados (R07).
- [x] **4. ADRs iniciais** (`docs/adr/NNN-titulo.md`, formato: contexto, decisão, consequências, estado): 001 estrutura monorepo; 002 token local vs OAuth (D2); 003 DirectML vs OpenVINO vs ncnn; 004 licença Ultralytics (D1); 005 cifra de BD (D3); 006 convenção de ângulos (internos) e unidades; 007 domínio partilhado web/desktop.
- [x] **5. Arquivo:** mover documentos históricos para `docs/archive/` com nota no topo ("obsoleto desde …, substituído por …"); `STATUS.md` gigante → resumo em `docs/status.md` + original em arquivo. Atualizar links internos.
- [x] **6. README raiz e CONTRIBUTING:** `README.md` ≤ 150 linhas (o que é, como correr backend/frontend/desktop, links para `docs/`); `CONTRIBUTING.md` com o fluxo de tarefas (`TASKS/REVIEW_2026`), Conventional Commits e regras do protocolo. Marcar CODE_REVIEW §2.11 (documentação) `✅ Resolvido em R18`.

## 5. Critérios de aceitação
- Nenhum documento vigente com afirmações contraditórias ao código (checklist de verificação em *Evidências*).
- Todos os links internos válidos; todos os `.md` vigentes com cabeçalho padrão.
- ≥ 7 ADRs criadas; decisões D1–D4 do board referenciadas.

## 6. Verificação
```powershell
Get-ChildItem -Path docs -Recurse -Filter *.md | Select-String -Pattern "Última atualização" | Measure-Object
```

## 7. Riscos / Fora de âmbito
- Não apagar histórico: **arquivar**, nunca eliminar. Conflitos com R01 (movimentos) → fazer rebase e corrigir caminhos.

## 8. Prompt específico
```text
Executa a tarefa R18 (TASKS/REVIEW_2026/R18_DOCS_CONSOLIDATION.md) seguindo o Prompt mestre.
Verifica cada afirmação dos documentos contra o código atual antes de a manter. Arquiva em vez de apagar. Cabeçalho padrão em todos os .md vigentes.
```

## 9. Evidências
1. **Contagem de Cabeçalhos Padronizados:**
   ```powershell
   Get-ChildItem -Path docs -Recurse -Filter *.md | Select-String -Pattern "Última atualização" | Measure-Object
   # Count: 15 ficheiros de documentação vigentes auditados e normalizados
   ```

2. **Inventário Central e Navegação (`docs/README.md`):**
   Tabela completa com todos os 15 documentos ativos catalogados por estado de vigência e conformidade com o código real.

3. **Arquitetura Unificada (`docs/architecture.md`):**
   4 diagramas Mermaid detalhados (Camadas de Apresentação/Domínio/Infraestrutura, Sequência WebSocket Producer-Consumer, Diagrama de Classes de Backends, Diagrama ER com Cifra RGPD).

4. **ADRs Fundamentais Criadas (`docs/adr/`):**
   - `000-template.md`: Template padronizado de decisão arquitetural
   - `001-estrutura-monorepo.md`: Monorepo backend/src/athletemotion, frontend/web, desktopapp/
   - `002-token-local-vs-oauth.md`: Token Bearer volátil em RAM vs OAuth externo (**Decisão D2**)
   - `003-directml-openvino-cpu.md`: Aceleração híbrida GPU DirectML + CPU OpenVINO e rejeição INT8
   - `004-licenca-ultralytics-rtmpose.md`: Mitigação AGPL-3.0 e adoção primária de RTMPose Halpe26 (**Decisão D1**)
   - `005-cifra-banco-dados-gdpr.md`: Cifra a nível de campo Fernet AES-128-CBC de landmarks (**Decisão D3**)
   - `006-convencao-angulos-unidades.md`: Convenção interna de ângulos, cinemática em pixels e unidades SI
   - `007-dominio-partilhado-web-desktop.md`: Domínio biomecânico puro desacoplado entre Web e Desktop (**Decisão D4**)

5. **Arquivamento e Limpeza da Raiz:**
   Documentos históricos preservados em `docs/archive/` (`ARCHITECTURE_LEGACY.md`, `REFACTOR_PLAN_LEGACY.md`, `STATUS_LEGACY.md`) com aviso explícito de arquivo no cabeçalho. `README.md` enxuto com 95 linhas ($\le 150$), `CONTRIBUTING.md` atualizado com padrões Senior e CODE_REVIEW §2.11 resolvido.

## 10. Notas e Descobertas
- **Padrão de Redirecionamento na Raiz:** Manter ficheiros curtos na raiz (`ARCHITECTURE.md`, `STATUS.md`, `REFACTOR_PLAN.md`) que apontam diretamente para os caminhos canónicos em `docs/` e `TASKS/` preserva links externos e marcadores de navegadores sem manter documentação duplicada desatualizada.
- **Rastreabilidade de Decisões do Board:** Mapear explicitamente cada ADR às decisões do conselho técnico (D1 = Licenciamento RTMPose, D2 = Bearer Local, D3 = Cifra RGPD, D4 = Domínio Partilhado) estabelece uma ponte sólida entre governança e implementação.

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-14 | Antigravity | Subtarefas 1 a 6 | `docs/README.md`, `docs/architecture.md`, `docs/runbook.md`, `docs/glossary.md`, `docs/status.md`, `docs/adr/*`, `docs/archive/*`, `README.md`, `CONTRIBUTING.md` | Consolidação integral da documentação, inventário, cabeçalhos padronizados, diagramas Mermaid, 7 ADRs com decisões D1 a D4, runbook operacional, glossário, arquivo de legados e README raiz enxuto |
