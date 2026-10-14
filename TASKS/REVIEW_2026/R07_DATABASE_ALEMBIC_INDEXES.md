# R07 — Base de dados: Alembic, índices, SQLAlchemy 2, configuração e durabilidade

> **ID:** R07 · **Prioridade:** P1 · **Onda:** 1
> **Status:** 🔵 REVIEW · **Progresso:** 8/8 · **Atribuído a:** Antigravity (LLM) · **Início:** 2026-10-13 · **Última atualização:** 2026-10-13
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
**Cria:** `backend/alembic.ini`, `backend/migrations/` (env.py, versions/), `athletemotion/infrastructure/{models.py,types.py,backup.py}`, `scripts/backup_db.py`, `docs/database.md`.
**Altera:** `infrastructure/database.py`, `infrastructure/uow.py`, testes/conftest.
**Não mexe:** schemas Pydantic, API.

## 4. Subtarefas
- [x] **1. Baseline Alembic:** `alembic init`, `env.py` configurado com `render_as_batch=True` (SQLite) e suporte a connection compartilhada; gerada migração baseline `0001_baseline.py` e documentado procedimento de stamp em `docs/database.md`.
- [x] **2. Remover `_ensure_added_columns`/`_ADDED_COLUMNS`:** `init_db()` passa a executar `run_alembic_migrations()` programaticamente até `head`; migração `0002_handlebar_and_cleats.py` adiciona colunas de forma versionada; teste de migração a partir de base legada passando com sucesso.
- [x] **3. SQLAlchemy 2.0 declarativo:** Criado `athletemotion/infrastructure/models.py` com `class Base(DeclarativeBase)`, `Mapped[...]`, `mapped_column(Float, ...)` e relationships estritamente tipadas.
- [x] **4. Índices e constraints (migração `0003`):** Criados índices `ix_posture_snapshots_session_id`, `ix_fit_sessions_athlete_started`, `ix_bikes_athlete_id` e check constraints de domínio. Comprovado com `EXPLAIN QUERY PLAN`.
- [x] **5. Datas UTC consistentes:** Criado `UTCDateTime` (TypeDecorator) em `athletemotion/infrastructure/types.py` forçando fuso horário UTC (tz-aware) na leitura e escrita; validado com teste unitário.
- [x] **6. Pragmas e durabilidade:** Mantidos `PRAGMA foreign_keys = ON;`, `PRAGMA journal_mode = WAL;`, `PRAGMA synchronous = NORMAL;`, `PRAGMA busy_timeout = 30000;`; adicionadas funções `force_db_sync()` e `optimize_database()`.
- [x] **7. UoW e sessões:** `expire_on_commit=False` configurado em `SessionLocal`; testes de rollback atómico em caso de falha adicionados e aprovados.
- [x] **8. Documentação e Scripts:** Criado `docs/database.md` com diagrama ER e documentação de migração/backup; criado `scripts/backup_db.py` e módulo `athletemotion/infrastructure/backup.py` usando `sqlite3.Connection.backup()`. Marcado CODE_REVIEW §2.10 `✅ Resolvido em R07`.

## 5. Critérios de aceitação
- `alembic upgrade head` em BD vazia e em BD antiga (fixture) funcionam deterministicamente.
- `alembic check` sem diferenças (`No new upgrade operations detected`).
- Consultas de listagem usam índice (`SEARCH ... USING INDEX`).
- Todos os testes existentes continuam verdes (83/83); 0 `declarative_base` no código.

## 6. Verificação
```powershell
cd backend
alembic upgrade head; alembic check
pytest tests/integration/test_database.py -v; pytest -q
```

## 7. Riscos / Fora de âmbito
- Migrações para PostgreSQL fora de âmbito.
- Dados pessoais e GDPR abordados na tarefa subsequente R06.

## 8. Prompt específico
```text
Executa a tarefa R07 (TASKS/REVIEW_2026/R07_DATABASE_ALEMBIC_INDEXES.md) seguindo o Prompt mestre.
Gera um baseline Alembic fiel ao esquema atual ANTES de mexer em modelos. Nunca alteres nomes de tabelas/colunas. Faz backup da BD real. Prova com EXPLAIN que os índices são usados.
```

## 9. Evidências
- **Alembic Check:**
  ```text
  No new upgrade operations detected.
  ```
- **EXPLAIN QUERY PLAN:**
  ```text
  1. Snapshots por session_id:
     SEARCH posture_snapshots USING INDEX ix_posture_snapshots_session_id (session_id=?)
  2. Sessões por athlete_id ordenadas por started_at:
     SEARCH fit_sessions USING INDEX ix_fit_sessions_athlete_started (athlete_id=?)
  3. Bikes por athlete_id:
     SEARCH bikes USING INDEX ix_bikes_athlete_id (athlete_id=?)
  ```
- **Suíte de Testes:** 83 testes executados e 100% aprovados (`83 passed, 2 warnings in 9.27s`).
- **Verificação Estática:** 0 erros no Ruff (`ruff check` limpo em todos os módulos).

## 10. Notas e Descobertas
- **Partilha de Conexão no Alembic:** Para evitar problemas de interpolação de URLs do Windows e concorrência no SQLite, o `database.py` injeta a conexão ativa diretamente em `alembic_cfg.attributes['connection']`, permitindo transações transicionais seguras em memória e em disco.
- **Auto-Stamp Defensivo:** Na presença de bases de dados existentes sem metadados de migração, o sistema inspeciona a tabela `bikes` e executa automaticamente o stamp apropriado antes de aplicar o upgrade para `head`.

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-13 | Antigravity (LLM) | 1-8 | `alembic.ini`, `migrations/*`, `infrastructure/models.py`, `infrastructure/database.py`, `infrastructure/types.py`, `infrastructure/backup.py`, `scripts/backup_db.py`, `docs/database.md`, `tests/integration/test_database.py` | Migrações Alembic completas, modelos SQLAlchemy 2.0 (Mapped), índices otimizados, UTCDateTime e 83/83 testes verdes |

