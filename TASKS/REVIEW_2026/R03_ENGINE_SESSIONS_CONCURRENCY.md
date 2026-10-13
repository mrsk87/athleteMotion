# R03 — Motor por ligação, concorrência DirectML, lifespan e arranque

> **ID:** R03 · **Prioridade:** P0 · **Onda:** 1
> **Status:** 🔴 TODO · **Progresso:** 0/8 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** R01 · **Bloqueia:** R13, R14 · **Branch:** `fix/r03-engine-sessions` · **PR:** —
> **Referência:** CODE_REVIEW §2.5, §2.6 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
- `PoseEngineRegistry.get_active/set_active` guarda **um motor global**. `api/v1/inference_ws.py` e `api/v1/inference.py` usam-no; `set_engine` por WS troca o motor para **todos** os clientes.
- Estado por motor partilhado entre ligações: `PersonTracker`, `femur_history`, `last_timestamp_ms` (MediaPipe VIDEO mode exige timestamps estritamente crescentes por instância).
- `hardware.py` documenta: **`Run()` concorrente na mesma sessão DirectML não é suportado**. Hoje `_warmup()` e `inference_worker` usam `loop.run_in_executor(None, ...)` (pool partilhado) sobre o mesmo motor.
- `inference.py` cria o motor MediaPipe **na importação** do router (carrega o `.task`, engole falhas).

## 2. Objetivo
Cada ligação WS (e cada sessão de vídeo) tem o **seu** motor/estado; pesos/sessões ONNX caros são partilháveis só de forma segura; inferência **serializada por sessão ORT**; nada pesado na importação; `lifespan` gere criação/fecho.

## 3. Âmbito
**Cria:** `athletemotion/api/engine_manager.py` (ou `services/engine_manager.py`), `athletemotion/domain/inference/session_pool.py`.
**Altera:** `api/v1/inference.py`, `api/v1/inference_ws.py`, `domain/inference/base.py` (Registry), `api/app.py` (lifespan), testes.
**Não mexe:** formatos de payload (retrocompatível), segurança/auth (R04/R05) — mas deixar *hooks* (`connection_id`).

## 4. Subtarefas
- [ ] **1. Testes primeiro** (`tests/integration/test_ws_isolation.py`): duas ligações WS simultâneas com motores diferentes não se afetam; `set_engine` numa não altera a outra; timestamps repetidos numa ligação não rebentam a outra. (Usar motor *fake* determinístico registado só nos testes.)
- [ ] **2. `PoseEngineRegistry`:** separar **factory** (`create(name, **kw)`, `names()`) de **estado ativo**. Remover `set_active/get_active` do caminho do WS; manter apenas um “motor por defeito” para REST (`/inference/engines`) via `EngineManager`.
- [ ] **3. `EngineManager`:** `acquire(connection_id, engine_name, side) -> EngineLease`, `release(lease)`; limite configurável de motores simultâneos (`MAX_ACTIVE_ENGINES`, default 2) com erro claro; cria motor novo por lease; **whitelist** por `PoseEngineRegistry.names()` (nome desconhecido → `ValueError` tratado, nunca criar por string do cliente).
- [ ] **4. Serialização por sessão ORT:** `SessionPool`/`InferenceExecutor` — **um `ThreadPoolExecutor(max_workers=1)` por motor (lease)**; `process_frame` e `warmup` passam sempre por ele. Proibido `run_in_executor(None, …)` para inferência. Teste: contador de concorrência dentro de um motor *fake* nunca > 1.
- [ ] **5. Partilha segura de pesos:** carregar o modelo ONNX **uma vez** por (modelo, provider) quando for possível (`InferenceSession` por lease é aceitável se a memória o permitir — medir VRAM com 2 leases em RX 580 8 GB e registar em *Evidências*). Documentar a decisão em *Notas*.
- [ ] **6. `lifespan`:** criar `EngineManager` em `app.state`, **aquecimento do motor por defeito de forma assíncrona e opcional** (`WARMUP_ON_START`), fechar tudo no shutdown (`close()` nos motores e executors). Remover criação do motor na importação de `inference.py`.
- [ ] **7. Erros e logs:** exceções do worker WS → `logger.exception` (não `debug`); contador de frames descartados e de erros por ligação; enviar ao cliente `{"status":"error","code":"engine_failed"}` sem texto interno.
- [ ] **8. Documentar** o modelo de concorrência em `ARCHITECTURE.md` (diagrama curto) e marcar CODE_REVIEW §2.5/§2.6 `✅ Resolvido em R03`.

## 5. Critérios de aceitação
- Teste de isolamento (passo 1) falha antes, passa depois.
- Importar `athletemotion.api.app` **não** carrega modelos (medir tempo de importação < 1 s sem pesos; teste com *monkeypatch*).
- Em carga (2 clientes WS a 30 FPS sintéticos durante 60 s): 0 exceções, 0 ligações cruzadas, sem crescimento de memória > 5 %.
- Nenhum `run_in_executor(None, …)` em código de inferência (`grep`).
- `GET /api/v1/inference/engines` continua a responder com o mesmo schema.

## 6. Verificação
```powershell
cd backend
pytest tests/integration/test_ws_isolation.py -q
pytest -q
python scripts/benchmark_inference.py --help
```

## 7. Riscos / Fora de âmbito
- 2 sessões DML em simultâneo podem exceder VRAM ou ser mais lentas que uma só: se medir pior, **limitar a 1 lease DML** e fazer a 2.ª cair em CPU, documentado.
- Autenticação do WS é R04/R05; backends novos (OpenVINO) é R14.

## 8. Prompt específico
```text
Executa a tarefa R03 (TASKS/REVIEW_2026/R03_ENGINE_SESSIONS_CONCURRENCY.md) seguindo o Prompt mestre.
Garante isolamento total de estado entre ligações e inferência serializada por sessão ORT (1 worker por motor).
Não mudes os payloads do WS/REST. Mede a VRAM com 2 motores DirectML e regista.
```

## 9. Evidências
_(testes, tempos de importação, carga 2 clientes, VRAM)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
