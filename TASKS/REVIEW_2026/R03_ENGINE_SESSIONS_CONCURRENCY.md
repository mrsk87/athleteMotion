# R03 — Motor por ligação, concorrência DirectML, lifespan e arranque

> **ID:** R03 · **Prioridade:** P0 · **Onda:** 1
> **Status:** 🔵 REVIEW · **Progresso:** 8/8 · **Atribuído a:** Antigravity (LLM) · **Início:** 2026-10-13 · **Última atualização:** 2026-10-13
> **Depende de:** R01 · **Bloqueia:** R13, R14 · **Branch:** `fix/r03-engine-sessions` · **PR:** —
> **Referência:** CODE_REVIEW §2.5, §2.6 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificado)
- `PoseEngineRegistry.get_active/set_active` guardava um motor global. `api/v1/inference_ws.py` e `api/v1/inference.py` usavam-no; `set_engine` por WS trocava o motor para todos os clientes.
- Estado por motor era partilhado entre ligações: `PersonTracker`, `femur_history`, `last_timestamp_ms` (MediaPipe VIDEO mode exige timestamps estritamente crescentes por instância).
- `hardware.py` documenta: `Run()` concorrente na mesma sessão DirectML não é suportado. `_warmup()` e `inference_worker` usavam `loop.run_in_executor(None, ...)` sobre o mesmo motor.
- `inference.py` criava o motor MediaPipe na importação do router (carregando o `.task` de forma prematura e engolindo falhas).

## 2. Objetivo
Cada ligação WS (e cada sessão de vídeo) tem o seu motor/estado isolado (`EngineLease`); inferência serializada estritamente por sessão através de `InferenceExecutor` dedicado (1 worker thread); nada pesado na importação; `lifespan` gere criação e fecho ordenado.

## 3. Âmbito
**Criou:** `athletemotion/services/engine_manager.py`, `athletemotion/domain/inference/session_pool.py`.
**Alterou:** `api/v1/inference.py`, `api/v1/inference_ws.py`, `domain/inference/base.py` (Registry), `api/app.py` (lifespan), `config/settings.py`, testes.
**Não mexeu:** formatos de payload (100% retrocompatíveis), segurança/auth (R04/R05).

## 4. Subtarefas
- [x] **1. Testes primeiro** (`tests/integration/test_ws_isolation.py`): duas ligações WS simultâneas com motores diferentes não se afetam; `set_engine` numa não altera a outra; timestamps independentes; serialização estrita testada com motor fake determinístico.
- [x] **2. `PoseEngineRegistry`:** separar **factory** (`create(name, **kw)`, `names()`) de **estado ativo**. `get_active/set_active` mantidos apenas para retrocompatibilidade legada com marcação explícita; caminho WS e gestão ativa migrados para `EngineManager`.
- [x] **3. `EngineManager`:** `acquire(connection_id, engine_name, side) -> EngineLease`, `release(connection_id)`; limite configurável de motores simultâneos (`MAX_ACTIVE_ENGINES`, default 2) com erro claro; whitelist estrita por `PoseEngineRegistry.names()` (nomes inválidos rejeitados sem criação arbitrária).
- [x] **4. Serialização por sessão ORT:** `SessionPool`/`InferenceExecutor` — um `ThreadPoolExecutor(max_workers=1)` dedicado por motor (lease); `process_frame` e `warmup` passam sempre por ele. Proibido `run_in_executor(None, …)` para inferência. Testado e comprovado que `max_concurrent_calls <= 1`.
- [x] **5. Partilha segura de pesos:** Carregamento isolado por lease com executor dedicado. DirectML corre em sessões serializadas sem concorrência direta no grafo.
- [x] **6. `lifespan`:** criar `EngineManager` em `app.state`, aquecimento opcional e assíncrono (`WARMUP_ON_START`), encerramento rigoroso no shutdown (`shutdown()` liberta leases e executors). Removida instanciação prematura de MediaPipe na importação de `inference.py`.
- [x] **7. Erros e logs:** exceções do worker WS reportadas via `logger.exception`; contadores por ligação de fotogramas recebidos, processados, descartados e erros; envio ao cliente de erro sanitizado `{"status":"error","code":"engine_failed"}`.
- [x] **8. Documentar** o modelo de concorrência em `ARCHITECTURE.md` (diagrama Mermaid e descrição técnica) e marcar CODE_REVIEW §2.5/§2.6 `✅ Resolvido em R03`.

## 5. Critérios de aceitação
- Testes de isolamento (`test_ws_isolation.py`) passam a 100% (7/7 verdes).
- Importar `athletemotion.api.app` não instancia modelos de inferência (comprovado por teste unitário `test_import_no_heavy_engine_created`).
- Nenhum `run_in_executor(None, …)` em código de inferência (`grep` limpo, apenas executor dedicado em `session_pool.py`).
- `GET /api/v1/inference/engines` continua a responder com o schema exato.
- Toda a suíte de testes do backend passa sem regressões (60/60 verdes).

## 6. Verificação
```powershell
cd backend
pytest tests/integration/test_ws_isolation.py -v
pytest -q
python scripts/benchmark_inference.py --help
ruff check src/athletemotion/domain/inference/session_pool.py src/athletemotion/services/engine_manager.py src/athletemotion/api/v1/inference_ws.py tests/integration/test_ws_isolation.py
```

## 7. Riscos / Fora de âmbito
- Autenticação e rate-limit do WS remetidos para R04/R05.
- Novos backends de execução (OpenVINO / FP16) remetidos para R14.

## 8. Evidências
```text
======================== 7 passed, 1 warning in 4.00s =========================
tests/integration/test_ws_isolation.py::test_ws_connections_have_isolated_engines PASSED
tests/integration/test_ws_isolation.py::test_ws_set_side_isolation PASSED
tests/integration/test_ws_isolation.py::test_ws_whitelist_engine_rejection PASSED
tests/integration/test_ws_isolation.py::test_inference_strictly_serialized_in_lease PASSED
tests/integration/test_ws_isolation.py::test_engine_manager_limits PASSED
tests/integration/test_ws_isolation.py::test_rest_engines_endpoint PASSED
tests/integration/test_ws_isolation.py::test_import_no_heavy_engine_created PASSED

======================== 60 passed, 1 warning in 7.30s =========================

Grep por run_in_executor(None, ...):
0 ocorrências encontradas. Única chamada de run_in_executor é sobre o worker thread dedicado do InferenceExecutor.

Ruff:
All checks passed!
4 files already formatted.
```

## 9. Notas e Descobertas
- A remoção da instanciação antecipada de MediaPipe na importação do router `inference.py` eliminou o carregamento desnecessário de grafos TFLite no arranque de testes e da API.
- Starlette `TestClient` opera em modo síncrono; ao isolar o loop assíncrono e delegar inferência a workers dedicados de 1 thread, o throughput estabilizou e as corridas críticas entre conexões foram eliminadas.

## 10. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-13 | Antigravity | 1-8 | `session_pool.py`, `engine_manager.py`, `inference_ws.py`, `inference.py`, `app.py`, `test_ws_isolation.py`, `ARCHITECTURE.md`, `CODE_REVIEW.md` | Implementação completa do isolamento de motores por sessão, executores de 1 worker dedicado por lease, gestão via lifespan e 7 novos testes de integração (60/60 verdes). |
