# R07 — Base de dados: Alembic, índices, SQLAlchemy 2, configuração e durabilidade

> **ID:** R07 · **Prioridade:** P1 · **Onda:** 1
> **Status:** 🔴 TODO · **Progresso:** 0/8 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** R01 · **Bloqueia:** R06, R08 · **Branch:** `feat/r07-db-alembic` · **PR:** —
> **Referência:** CODE_REVIEW §2.10 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar em `infrastructure/database.py`)
- Migração *ad hoc* `_ADDED_COLUMNS` + `ALTER TABLE` em `init_db()`.
- `declarative_base()` legado e `Column(...)` sem `Mapped[]`.
- Sem índices em `posture_snapshots.session_id`, `fit_sessions(athlete_id, started_at)`, `bikes.athlete_id`.
- `PRAGMA synchronous=NORMAL` descrito como "DURABILIDADE".
- Datas `datetime.now(timezone.utc)` guardadas no SQLite como *naive*.
- Caminho do DB fixo na raiz (R01 já introduz `DATABASE_URL` configurável).

## 2. Objetivo
Esquema versionado e reprodutível, consultas rápidas, datas consistentes e durabilidade explícita.

## 3. Âmbito
**Cria:** `backend/alembic.ini`, `backend/migrations/` (env.py, versions/), `athletemotion/infrastructure/types.py` (TypeDecorator UTC).
**Altera:** `infrastructure/database.py` (→ pode dividir em `models.py`, `session.py`), `infrastructure/uow.py`, testes/conftest.
**Não mexe:** schemas Pydantic, API.

## 4. Subtarefas
- [ ] **1. Baseline Alembic:** `alembic init`, `env.py` usa `Settings.DATABASE_URL` e `Base.metadata`; `render_as_batch=True` (SQLite). Gerar migração **`0001_baseline`** que reproduz o esquema atual (incluindo as 4 colunas de `_ADDED_COLUMNS`). Procedimento para BDs existentes: `alembic stamp 0001` (documentar em `docs/database.md`).
- [ ] **2. Remover `_ensure_added_columns`/`_ADDED_COLUMNS`:** `init_db()` passa a `alembic upgrade head` programático (ou só `create_all` em testes). Teste: partir de uma BD criada com o esquema antigo (fixture) e chegar a `head` sem perda de dados.
- [ ] **3. SQLAlchemy 2.0 declarativo:** `class Base(DeclarativeBase)`, modelos com `Mapped[...]`/`mapped_column`, `relationship` tipadas; dividir `models.py` / `session.py` / `engine.py`. Sem alterar nomes de tabelas/colunas.
- [ ] **4. Índices e constraints (migração `0002`):** `ix_posture_snapshots_session_id`, `ix_fit_sessions_athlete_started (athlete_id, started_at DESC)`, `ix_bikes_athlete_id`; `CheckConstraint` para `status IN ('IN_PROGRESS','COMPLETED','CANCELLED')`, `flexibility`, `riding_style`, intervalos de ângulos `0..360`. Verificar com `EXPLAIN QUERY PLAN` (colar em *Evidências*).
- [ ] **5. Datas UTC consistentes:** `TypeDecorator` `UTCDateTime` (guarda UTC, devolve *aware*); trocar colunas `DateTime`. Teste de ida-e-volta com tzinfo.
- [ ] **6. Pragmas e durabilidade:** manter WAL e `foreign_keys=ON`; `synchronous`: **`NORMAL` para snapshots ao vivo, `FULL` ao completar sessão** (contexto/UoW marca "commit crítico" → `PRAGMA synchronous=FULL` temporário) ou configurável por `DB_SYNCHRONOUS`; `busy_timeout`; corrigir comentários enganadores. `PRAGMA optimize` no shutdown.
- [ ] **7. UoW e sessões:** rever `uow.py`: `expire_on_commit=False` onde convém, rollback em exceção, nunca *swallow*; `get_db()` mantém-se. Testes de rollback atómico (falha a meio de `complete_fit_session` não deixa estado parcial).
- [ ] **8. Documentação e CI:** `docs/database.md` (diagrama ER atual, fluxo de migração, backup `sqlite3 .backup`); script `scripts/backup_db.py`; passo de CI `alembic upgrade head` + `alembic check` (modelos == migrações). Marcar CODE_REVIEW §2.10 `✅ Resolvido em R07`.

## 5. Critérios de aceitação
- `alembic upgrade head` em BD vazia e em BD antiga (fixture) → ambas chegam ao mesmo esquema (comparar `sqlite_master`).
- `alembic check` sem diferenças.
- Consultas de listagem de sessões/snapshots usam índice (`SEARCH ... USING INDEX`).
- Todos os testes existentes continuam verdes; 0 `declarative_base` no código.

## 6. Verificação
```powershell
cd backend
alembic upgrade head; alembic check
pytest -q
sqlite3 $env:ATHLETE_DATA_DIR\athlete_motion.db "EXPLAIN QUERY PLAN SELECT * FROM posture_snapshots WHERE session_id='x';"
```

## 7. Riscos / Fora de âmbito
- **Fazer cópia de segurança da BD real antes de qualquer migração** (`scripts/backup_db.py`).
- Campos de RGPD são R06 (migração `0003` lá); migração para PostgreSQL fora de âmbito.

## 8. Prompt específico
```text
Executa a tarefa R07 (TASKS/REVIEW_2026/R07_DATABASE_ALEMBIC_INDEXES.md) seguindo o Prompt mestre.
Gera um baseline Alembic fiel ao esquema atual ANTES de mexer em modelos. Nunca alteres nomes de tabelas/colunas. Faz backup da BD real. Prova com EXPLAIN que os índices são usados.
```

## 9. Evidências
_(alembic upgrade/check, EXPLAIN, testes)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
