# R08 — Serviço de relatórios/sessões: DRY, idempotência, paginação, batch

> **ID:** R08 · **Prioridade:** P1 · **Onda:** 2
> **Status:** 🔴 TODO · **Progresso:** 0/8 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** R01, R07 · **Bloqueia:** R10 (consumo de ciclos), R17 · **Branch:** `refactor/r08-session-service` · **PR:** —
> **Referência:** CODE_REVIEW §2.9 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar em `api/v1/sessions.py`)
- Bloco "modalidade → `evaluate_posture_angles` → `DiagnosticItem` → compliance" repetido 4× (`complete`, `report`, `pdf`, `ai-coach`).
- `if payload.knee_angle:` trata 0.0 como falso.
- `complete_fit_session` não verifica estado: recomplete sobrescreve sessão `COMPLETED`/`CANCELLED`.
- Sem paginação em `by-athlete`; uma chamada HTTP por snapshot.
- Lógica de domínio/orquestração dentro de rotas.

## 2. Objetivo
Camada de aplicação testável sem HTTP; rotas finas; operações idempotentes e eficientes.

## 3. Âmbito
**Cria:** `athletemotion/services/session_service.py`, `services/report_builder.py`, `schemas/pagination.py`, `schemas/session_batch.py`.
**Altera:** `api/v1/sessions.py`, `schemas/fit.py`, testes.
**Não mexe:** modelo de BD (R07), PDF (R17), AI coach (R09), validação de limites (R05 — apenas reutilizar).

## 4. Subtarefas
- [ ] **1. Testes de caracterização:** gravar o comportamento atual (JSON de resposta de `complete`, `report`) com dados fixos; devem manter-se iguais após o refactor (exceto correções declaradas).
- [ ] **2. `ReportBuilder`:** função/classe pura `build_diagnostics(modality, measured, bike, theoretical) -> DiagnosticsBundle` (diagnósticos + % de conformidade) usada pelas 4 rotas. `resolve_modality(bike_type) -> RidingStyle` central (com *log* quando cai no default `ROAD`, em vez de silenciar).
- [ ] **3. `SessionService`:** `start`, `add_snapshots(batch)`, `complete`, `cancel`, `get_report`, `list_by_athlete(page)`; usa UoW; máquina de estados explícita `IN_PROGRESS → COMPLETED|CANCELLED` (transições inválidas → `409 Conflict` problem+json).
- [ ] **4. Idempotência:** `complete` numa sessão já `COMPLETED` devolve o **mesmo** relatório (200) sem recalcular nem mudar `completed_at`; cabeçalho opcional `Idempotency-Key` em `POST /sessions` e `/snapshots:batch` (tabela `idempotency_keys` ou cache com TTL; migração via R07).
- [ ] **5. Correções:** `is not None` em vez de truthiness; ignorar `0`/valores impossíveis nas médias (documentar: `0` ≠ medido); `compliance_percentage` sem divisão enganosa quando não há diagnósticos (devolver `None`, não 0 %).
- [ ] **6. Batch de snapshots:** `POST /sessions/{id}/snapshots:batch` (≤ 500 itens, validação R05) numa só transação; manter `POST .../snapshot` como alias que chama o serviço. Teste de desempenho: 500 inserções < 200 ms.
- [ ] **7. Paginação:** `GET /sessions/by-athlete/{id}?limit=&cursor=` (cursor por `(started_at,id)`), resposta `{items,next_cursor}`; limite máx. 100. Contrato antigo (lista) mantido atrás de `?legacy=true` por 1 versão ou documentado como *breaking* (`BREAKING CHANGE:` no commit + nota no CHANGELOG).
- [ ] **8. Documentação:** OpenAPI com exemplos; tabela de estados; marcar CODE_REVIEW §2.9 `✅ Resolvido em R08`; atualizar `ARCHITECTURE.md`.

## 5. Critérios de aceitação
- As 4 rotas usam `ReportBuilder` (grep: `evaluate_posture_angles(` aparece 1× fora de testes).
- Testes de caracterização verdes; recomplete é idempotente; transições inválidas → 409.
- `sessions.py` < 150 linhas (só roteamento).
- Batch de 500 snapshots numa transação (verificar via contagem de `COMMIT`).

## 6. Verificação
```powershell
cd backend
pytest tests -k "session" -q; pytest -q
wc -l src/athletemotion/api/v1/sessions.py
```

## 7. Riscos / Fora de âmbito
- Mudança de contrato de paginação afeta o frontend (`api.js`): atualizar apenas o mínimo ou manter *legacy*; refactor completo em R16.
- Não alterar fórmulas biomecânicas.

## 8. Prompt específico
```text
Executa a tarefa R08 (TASKS/REVIEW_2026/R08_SESSIONS_SERVICE_REFACTOR.md) seguindo o Prompt mestre.
Escreve primeiro testes de caracterização das respostas atuais. Rotas finas, serviço puro, idempotência no complete, 409 em transições inválidas. Sem tocar em fórmulas de domínio.
```

## 9. Evidências
_(testes, contagem de linhas, benchmark batch)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
