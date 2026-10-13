# D10 — Persistência local, RGPD e sincronização opcional

> **ID:** D10 · **Prioridade:** P1 · **Onda:** 2
> **Status:** 🔴 TODO · **Progresso:** 0/8 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D01, R06, R07, R08 · **Bloqueia:** D11, D15 · **Branch:** `feat/d10-persistence-sync` · **PR:** —
> **Referência:** README_PLAN §7, §8; CODE_REVIEW §1.8 · **Decisão E4** · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
O desktop funciona **offline**. Deve reutilizar modelos/UoW/serviços do backend (R07/R08), consentimento/exportar/apagar (R06) e opcionalmente sincronizar com o backend (token R04, idempotência R08).

## 2. Objetivo
Persistência local em `%APPDATA%/AthleteMotion/athlete_motion.db` (SQLite WAL + Alembic), ações RGPD na UI, e `sync_service` com fila *outbox* idempotente.

## 3. Âmbito
**Cria:** `services/{data_service.py,privacy_ui_service.py,sync_service.py}`, `services/sync/{outbox.py,client.py,conflicts.py}`, `ui/views/{athletes_view.py,privacy_view.py,sync_view.py}`, testes.
**Reutiliza:** `athletemotion.infrastructure.*`, `services.session_service`, `services.privacy_service`.
**Não mexe:** migrações do backend (usa as do backend), endpoints do backend (se faltar `/sync/*`, abrir tarefa R19+).

## 4. Subtarefas
- [ ] **1. Inicialização da BD:** `alembic upgrade head` (programático) no arranque; **backup automático antes de migrar** (`.bak` com rotação 5); falha de migração → modo só-leitura + aviso (nunca perder dados). Caminho configurável; WAL; `synchronous=FULL` ao concluir sessão (R07).
- [ ] **2. `data_service`:** CRUD de atletas/bicicletas/sessões via serviços do backend; paginação; pesquisa; todas as operações **fora da main thread** (executor/QThreadPool) com *signals* para a UI.
- [ ] **3. Ingestão de séries em *chunks*:** gravação periódica de ciclos/medidas durante a sessão (D08) com transações pequenas; **não** guardar landmarks brutos sem consentimento de âmbito (`store_landmarks`).
- [ ] **4. RGPD na UI:** ecrã de privacidade — ver consentimentos, **retirar**, **exportar** (ZIP/JSON R06), **apagar** (hard, com confirmação dupla), política de retenção configurável + purga ao arranque; textos PT/EN.
- [ ] **5. Cifra:** usar `FieldCipher` do R06 (chave via DPAPI); teste de que valores sensíveis não estão em claro no ficheiro `.db`; fluxo de recuperação (aviso: perder a chave = perder dados) documentado.
- [ ] **6. Outbox/sync:** tabela `outbox` (`id`, `entity`, `payload`, `idempotency_key`, `attempts`, `next_try_at`, `status`); *worker* com *backoff* exponencial + *jitter*; cliente `httpx` com token (R04), TLS verificado (certificados pinados opcionais), `Idempotency-Key`; sincroniza **sessões consolidadas** (ciclos, médias, thumbnails opcionais), nunca vídeo; estados visíveis (pendentes/erros) em `sync_view`.
- [ ] **7. Conflitos:** `updated_at` + `device_id`; *last-writer-wins* por entidade com registo de conflitos; nunca apagar remoto sem confirmação explícita; testes com servidor de teste (FastAPI TestClient do backend em processo) incluindo falhas de rede, duplicados e reordenação.
- [ ] **8. Testes e docs:** migração de BD antiga (fixture), rollback atómico, exportação/apagamento reais (varrimento de `.db`+`-wal`), sync idempotente (reenviar 3× → 1 registo remoto). Atualizar `README_PLAN`, board/changelog.

## 5. Critérios de aceitação
- Arranque com BD antiga migra com backup; falha de migração não corrompe.
- Hard delete sem vestígios (varrimento de ficheiro); export completo e válido.
- Sync idempotente e resiliente a cortes; sem duplicados.
- Nenhuma operação de BD/rede na main thread (teste instrumentado).

## 6. Verificação
```powershell
cd desktopapp
pytest tests -k "data_service or privacy or sync or outbox" -q
```

## 7. Riscos / Fora de âmbito
- Se o backend não tiver `/sync/*`, esta tarefa fica com sync ⛔ e o resto 🔵: criar R19.
- Multi-utilizador e cloud fora de âmbito.

## 8. Prompt específico
```text
Executa a tarefa D10 (desktopapp/TASKS/D10_PERSISTENCE_GDPR_SYNC.md) seguindo o Prompt mestre do desktop.
Reutiliza os modelos/serviços do backend; backup antes de migrar; RGPD funcional (retirar/exportar/apagar real); outbox idempotente com backoff; nada de BD/rede na main thread.
```

## 9. Evidências
_(testes, varrimento de ficheiro, sync com falhas)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
