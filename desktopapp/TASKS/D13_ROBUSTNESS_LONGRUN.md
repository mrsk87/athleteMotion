# D13 — Robustez: crash handler, reconexão, recuperação de sessão e corridas longas

> **ID:** D13 · **Prioridade:** P1 · **Onda:** 4
> **Status:** 🔴 TODO · **Progresso:** 0/8 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D05, D08 · **Bloqueia:** D15 · **Branch:** `feat/d13-robustness` · **PR:** —
> **Referência:** README_PLAN §7 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
Sessões de bikefit duram minutos a dezenas de minutos, com câmara USB e driver DML. Falhas típicas: câmara desligada, driver reinicia (TDR), processo de inferência morre, falta de espaço em disco, bloqueios de UI, fugas de memória/handles.

## 2. Objetivo
Garantir **degradação graciosa e recuperação**: nada de perder uma sessão por falha técnica; **provar** estabilidade com corridas longas automatizadas.

## 3. Âmbito
**Cria:** `app/crash_report.py`, `services/session_recovery.py`, `runtime/health.py`, `tests/soak/*`, `scripts/soak_test.py`, `docs/robustness.md`.
**Altera:** `runtime/pipeline.py` (hooks), `runtime/capture/*` (estados), `ui/main_window.py` (barra de estado).
**Não mexe:** domínio.

## 4. Subtarefas
- [ ] **1. Crash report local:** `sys.excepthook` + `threading.excepthook` + `faulthandler`; diálogo “A aplicação encontrou um erro” com opção de **guardar pacote de diagnóstico** (`.zip`: logs, `hardware_info`, versões, perfil, últimas métricas — **sem dados do atleta**); nunca enviar para a rede automaticamente.
- [ ] **2. Recuperação de sessão:** `LiveSession` serializa estado a cada N s (checkpoint em `APP_DATA_DIR/recovery/`); ao arrancar após crash propõe “Retomar sessão”; testes de matar o processo a meio e retomar sem perda > N s.
- [ ] **3. Câmara:** perda/regresso de USB → pipeline em `RECONNECTING`, UI mostra estado sem congelar; ao voltar retoma automaticamente mantendo a sessão (marca “lacuna” nos dados e **invalida ciclos** que a atravessam).
- [ ] **4. Driver/GPU:** deteção de TDR/`DXGI_ERROR_DEVICE_REMOVED` (exceções ORT), reinício do worker, *fallback* CPU em `DEGRADED` com aviso persistente e opção de tentar voltar à GPU.
- [ ] **5. Recursos:** monitor de disco (aviso < 1 GB, bloqueia gravação < 200 MB), memória (RSS) com alerta de crescimento, *handles*; limites em *buffers* de séries (despejo para disco); política para sessões > 60 min.
- [ ] **6. UI watchdog:** medir bloqueios da *main thread* (`QTimer` heartbeat); se > 250 ms registar *stack* (via `faulthandler.dump_traceback_later`) e contar “jank”; relatório no D12.
- [ ] **7. Soak tests:** `scripts/soak_test.py` (FakeStream + pipeline real/fake) corre 30 min no CI noturno (marcado `slow`): RSS crescimento < 5 %, handles estáveis, 0 exceções, jank < 0.1 %; falhas injetadas (matar worker, cortar câmara fake, encher disco simulado) e o sistema recupera.
- [ ] **8. Docs:** `docs/robustness.md` (modos de falha, o que o utilizador vê, como recolher diagnóstico). Atualizar `README_PLAN`, board/changelog.

## 5. Critérios de aceitação
- Soak de 30 min passa com os limites definidos.
- Matar worker/câmara fake recupera sem perder a sessão (testes).
- Pacote de diagnóstico não contém PII (teste de varrimento por padrões de teste).
- Nenhuma exceção não tratada chega à consola em fluxos de falha previstos.

## 6. Verificação
```powershell
cd desktopapp
pytest tests -k "recovery or health or crash" -q
python scripts/soak_test.py --minutes 30 --inject kill_worker,cut_camera --report out/soak.json
```

## 7. Riscos / Fora de âmbito
- TDR real só reproduzível em hardware: registar comportamento observado; simular em testes.
- Telemetria remota fora de âmbito.

## 8. Prompt específico
```text
Executa a tarefa D13 (desktopapp/TASKS/D13_ROBUSTNESS_LONGRUN.md) seguindo o Prompt mestre do desktop.
Falhas injetadas devem recuperar sem perder a sessão. Pacote de diagnóstico sem PII e nunca enviado automaticamente. Prova com soak test de 30 min.
```

## 9. Evidências
_(relatório do soak, testes de recuperação)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
