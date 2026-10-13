# R06 — Privacidade e RGPD: consentimento, exportação, apagamento, cifra

> **ID:** R06 · **Prioridade:** P1 · **Onda:** 2
> **Status:** 🔴 TODO · **Progresso:** 0/8 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** R01, R07 · **Bloqueia:** — · **Branch:** `feat/r06-gdpr` · **PR:** —
> **Referência:** CODE_REVIEW §1.8 · **Decisão humana D3** · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
- `AthleteModel`: `name`, `email`, medidas corporais em SQLite em claro. `PostureSnapshotModel.raw_landmarks_json` (dados biométricos, RGPD art. 9). Sem consentimento, sem exportar, sem apagar, sem retenção.
- Frontend guarda perfis em `localStorage` (tratado em R16).
- `ondelete="CASCADE"` existe nas FKs; SQLite com `foreign_keys=ON` — verificar que o apagamento remove também snapshots; WAL pode reter páginas apagadas.

## 2. Objetivo
Cumprir direitos básicos do titular dos dados e minimizar dados guardados.

## 3. Âmbito
**Cria:** `athletemotion/services/privacy_service.py`, `athletemotion/api/v1/privacy.py`, migração Alembic (de R07), `docs/privacy.md`.
**Altera:** `infrastructure/database.py` (campos), `schemas/fit.py` (athlete), `api/v1/athletes.py`, testes.
**Não mexe:** frontend (R16), lógica biomecânica.

## 4. Subtarefas
- [ ] **1. Modelo de dados (migração):** `athletes` ganha `consent_at (DateTime null)`, `consent_version (String)`, `consent_scope (JSON/Text)` (ex.: `["processing","store_landmarks"]`), `deleted_at (null)`, `retention_until (null)`. `fit_sessions` ganha `store_landmarks (bool, default False)`.
- [ ] **2. Consentimento:** `POST /athletes` exige `consent` (versão + âmbito); sem consentimento → 422. `PATCH /athletes/{id}/consent` (retirar → apaga `raw_landmarks_json` das sessões e marca `store_landmarks=False`). Texto do consentimento versionado em `docs/privacy.md` (PT/EN).
- [ ] **3. Minimização:** por defeito **não** guardar `raw_landmarks_json` (só se `store_landmarks`); `email` opcional; endpoint de ingestão de snapshots ignora `raw_landmarks` se não houver consentimento de âmbito.
- [ ] **4. Exportação:** `GET /athletes/{id}/export` → ZIP/JSON com atleta, bicicletas, sessões, snapshots, diagnósticos (formato documentado, `schema_version`). Gerado em *stream*, com limite de tamanho.
- [ ] **5. Apagamento:** `DELETE /athletes/{id}?hard=true` (padrão **soft** com `deleted_at` + purga agendada; **hard** imediato). Hard delete: remover linhas, `PRAGMA wal_checkpoint(TRUNCATE)` e `VACUUM` (ou `secure_delete=ON`), e apagar ficheiros associados (PDFs/GIFs em cache, se existirem). Teste: após hard delete nenhum dado do atleta existe (consulta direta ao SQLite e *grep* no ficheiro `.db`/`-wal` pelo nome/email de teste).
- [ ] **6. Retenção:** tarefa de purga (`services/retention.py`, chamada no `lifespan` e via CLI `python -m athletemotion.cli purge`) que apaga/anonimiza sessões após `retention_until` (default configurável, ex. 24 meses).
- [ ] **7. Cifra (conforme D3):** (a) se SQLCipher aprovado: `sqlcipher3`/`pysqlcipher3` com chave em `APP_DATA_DIR` protegida por DPAPI (Windows `win32crypt`) — avaliar viabilidade no ambiente e registar; (b) caso contrário **cifra a nível de campo** (`email`, `raw_landmarks_json`) com `cryptography.Fernet`, chave em DPAPI/`keyring`. Interface única `FieldCipher` para trocar depois. Nunca commitar chaves.
- [ ] **8. Testes + docs:** testes para consentimento obrigatório, retirada, export completo/estável, hard delete real, retenção, cifra (valor em BD ≠ valor claro). `docs/privacy.md` com tabela de dados, finalidade, base legal, retenção. Marcar CODE_REVIEW §1.8 `✅ Resolvido em R06`.

## 5. Critérios de aceitação
- Criar atleta sem consentimento → 422; retirar consentimento remove landmarks.
- `export` devolve todos os dados do titular e é reimportável como JSON válido (validado por schema).
- Hard delete deixa 0 vestígios (teste de varrimento do ficheiro BD+WAL).
- Campos sensíveis cifrados em repouso (teste inspeciona o valor bruto na BD).

## 6. Verificação
```powershell
cd backend
alembic upgrade head
pytest tests -k "privacy or gdpr" -q; pytest -q
```

## 7. Riscos / Fora de âmbito
- Aconselhamento jurídico não incluído: os textos são modelo, sujeitos a revisão legal.
- `SQLCipher` pode não ter wheels para a versão de Python usada: cair em cifra de campo.

## 8. Prompt específico
```text
Executa a tarefa R06 (TASKS/REVIEW_2026/R06_PRIVACY_GDPR.md) seguindo o Prompt mestre. Depende de R07 (Alembic) — confirma que está 🟢/🔵 no board.
Implementa consentimento, minimização, exportação, apagamento real (incluindo WAL), retenção e cifra de campo. Pergunta ao humano sobre D3 antes de escolher SQLCipher.
```

## 9. Evidências
_(testes; varrimento do .db/-wal)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
