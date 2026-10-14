# R06 — Privacidade e RGPD: consentimento, exportação, apagamento, cifra

> **ID:** R06 · **Prioridade:** P1 · **Onda:** 2
> **Status:** 🔵 REVIEW · **Progresso:** 8/8 · **Atribuído a:** Antigravity · **Início:** 2026-10-14 · **Última atualização:** 2026-10-14
> **Depende de:** R01, R07 · **Bloqueia:** — · **Branch:** `feat/r06-gdpr` · **PR:** —
> **Referência:** CODE_REVIEW §1.8 · **Decisão humana D3** · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
- `AthleteModel`: `name`, `email`, medidas corporais em SQLite em claro. `PostureSnapshotModel.raw_landmarks_json` (dados biométricos, RGPD art. 9). Sem consentimento, sem exportar, sem apagar, sem retenção.
- Frontend guarda perfis em `localStorage` (tratado em R16).
- `ondelete="CASCADE"` existe nas FKs; SQLite com `foreign_keys=ON` — verificar que o apagamento remove também snapshots; WAL pode reter páginas apagadas.

## 2. Objetivo
Cumprir direitos básicos do titular dos dados e minimizar dados guardados.

## 3. Âmbito
**Cria:** `athletemotion/services/privacy_service.py`, `athletemotion/services/retention.py`, `athletemotion/api/v1/privacy.py`, `athletemotion/infrastructure/security/cipher.py`, `athletemotion/cli.py`, migração Alembic `0004_privacy_gdpr_fields.py`, `docs/privacy.md`, `tests/integration/test_privacy_gdpr.py`.
**Altera:** `infrastructure/models.py` (campos e tipos cifrados), `schemas/fit.py` (athlete e consent), `api/v1/athletes.py`, `api/v1/sessions.py`, `api/app.py`, `services/session_service.py`, testes existentes.
**Não mexe:** frontend (R16), lógica biomecânica.

## 4. Subtarefas
- [x] **1. Modelo de dados (migração):** `athletes` ganha `consent_at (DateTime null)`, `consent_version (String)`, `consent_scope (JSON/Text)` (ex.: `["processing","store_landmarks"]`), `deleted_at (null)`, `retention_until (null)`. `fit_sessions` ganha `store_landmarks (bool, default False)`. Migração Alembic `0004_privacy_gdpr_fields.py` criada e aplicada.
- [x] **2. Consentimento:** `POST /athletes` exige `consent` (versão + âmbito); sem consentimento → 422. `PATCH /athletes/{id}/consent` (retirar → apaga `raw_landmarks_json` das sessões e marca `store_landmarks=False`). Texto do consentimento versionado em `docs/privacy.md` (PT/EN).
- [x] **3. Minimização:** por defeito **não** guardar `raw_landmarks_json` (só se `store_landmarks`); `email` opcional; endpoint de ingestão de snapshots ignora `raw_landmarks` se não houver consentimento de âmbito.
- [x] **4. Exportação:** `GET /athletes/{id}/export` → JSON com atleta, bicicletas, sessões, snapshots, diagnósticos (formato documentado, `schema_version: "1.0"`). Decifra dados transparentemente na exportação.
- [x] **5. Apagamento:** `DELETE /athletes/{id}?hard=true` (padrão **soft** com `deleted_at` + purga agendada; **hard** imediato). Hard delete: remover linhas em cascata, `PRAGMA secure_delete = ON`, `PRAGMA wal_checkpoint(TRUNCATE)` e `VACUUM`. Testado com varrimento de disco (bytes brutos de `.db` e `.db-wal` sem vestígios).
- [x] **6. Retenção:** tarefa de purga (`services/retention.py`, chamada no `lifespan` e via CLI `python -m athletemotion.cli purge`) que apaga/anonimiza sessões após `retention_until` (default configurável, ex. 24 meses).
- [x] **7. Cifra (conforme D3):** **cifra a nível de campo** (`email`, `raw_landmarks_json`) com `cryptography.Fernet`, chave em `ATHLETE_DATA_CIPHER_KEY` ou `%APPDATA%/AthleteMotion/keys/field_cipher.key`. Interface `FieldCipher` com tipos SQLAlchemy `EncryptedString` e `EncryptedText` com prefixo `enc:v1:`.
- [x] **8. Testes + docs:** 8 testes de integração em `test_privacy_gdpr.py` cobrindo consentimento obrigatório, retirada, export completo, hard delete real com varrimento de disco/WAL, retenção, cifra em repouso. `docs/privacy.md` com tabela de dados, finalidade, base legal, retenção. CODE_REVIEW §1.8 marcado `✅ Resolvido em R06`.

## 5. Critérios de aceitação
- Criar atleta sem consentimento → 422; retirar consentimento remove landmarks.
- `export` devolve todos os dados do titular e é reimportável como JSON válido (validado por schema).
- Hard delete deixa 0 vestígios (teste de varrimento do ficheiro BD+WAL).
- Campos sensíveis cifrados em repouso (teste inspeciona o valor bruto na BD).

## 6. Verificação
```powershell
cd backend
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m pytest tests/integration/test_privacy_gdpr.py -v
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\ruff.exe check .
.\.venv\Scripts\mypy.exe src/athletemotion/schemas src/athletemotion/domain/biomechanics src/athletemotion/services/privacy_service.py src/athletemotion/services/retention.py src/athletemotion/infrastructure/security/cipher.py
```

## 7. Riscos / Fora de âmbito
- Aconselhamento jurídico não incluído: os textos são modelo, sujeitos a revisão legal.
- Decisão D3: Optou-se por Field-Level Encryption (`FieldCipher`) para portabilidade universal no Windows sem dependências de C/C++ de compilação do SQLCipher.

## 8. Prompt específico
```text
Executa a tarefa R06 (TASKS/REVIEW_2026/R06_PRIVACY_GDPR.md) seguindo o Prompt mestre. Depende de R07 (Alembic) — confirma que está 🟢/🔵 no board.
Implementa consentimento, minimização, exportação, apagamento real (incluindo WAL), retenção e cifra de campo. Pergunta ao humano sobre D3 antes de escolher SQLCipher.
```

## 9. Evidências
- **Alembic:** Migração `0004_privacy_gdpr_fields.py` aplicada com sucesso (`upgrade head`).
- **Testes de Integração:** 8/8 testes específicos em `test_privacy_gdpr.py` passaram em 1.09s.
- **Suite Completa:** 132 testes passaram em 13.03s com 0 falhas e 0 erros.
- **Varrimento Físico:** `test_hard_delete_and_physical_disk_sweep` validou diretamente a ausência dos bytes do ciclista no ficheiro `.db` e `.db-wal` após hard delete.
- **Inspeção de Repouso:** Consulta raw SQLite confirmou que o email é persistido como ciphertext iniciado por `enc:v1:`.
- **Linters:** `ruff check` passou com 0 erros; `mypy` estrito passou com 0 erros em 18 ficheiros de domínio/schemas/segurança.

## 10. Notas e Descobertas
- A decisão D3 (cifra a nível de campo via `cryptography.Fernet`) evitou dependências de compilação C/C++ do SQLite no Windows e garantiu interoperabilidade imediata com o SQLAlchemy 2.0 através dos decorators `EncryptedString` e `EncryptedText`.
- A revogação do âmbito `store_landmarks` executa atualização atómica em lote nos snapshots da sessão, definindo `raw_landmarks_json = NULL` em transação isolada.

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-14 | Antigravity | 1, 7 | `models.py`, `cipher.py`, `0004_privacy_gdpr_fields.py` | Campos de consentimento/retenção e tipos de cifra a nível de campo (`EncryptedString`/`EncryptedText`). |
| 2026-10-14 | Antigravity | 2, 3 | `schemas/fit.py`, `session_service.py`, `athletes.py`, `sessions.py` | Consentimento obrigatório, verificação de escopos e minimização de dados em snapshots. |
| 2026-10-14 | Antigravity | 4, 5 | `services/privacy_service.py`, `api/v1/privacy.py`, `api/v1/router.py` | Exportação estruturada (Art. 15/20) e soft/hard delete com truncatura WAL e vacuum. |
| 2026-10-14 | Antigravity | 6 | `services/retention.py`, `cli.py`, `api/app.py` | Purga automática de retenção no arranque e CLI operacional `python -m athletemotion.cli purge`. |
| 2026-10-14 | Antigravity | 8 | `test_privacy_gdpr.py`, `docs/privacy.md`, `CODE_REVIEW.md` | Suite completa de 8 testes de integração, documentação legal e resolução de §1.8. |
