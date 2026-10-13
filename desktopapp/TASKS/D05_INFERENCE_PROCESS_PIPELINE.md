# D05 — Processo de inferência, pipeline em estágios e watchdog

> **ID:** D05 · **Prioridade:** P0 · **Onda:** 2
> **Status:** 🔴 TODO · **Progresso:** 0/9 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D03, D04, R14 (e R03/R13) · **Bloqueia:** D08, D09, D12, D13, D16 · **Branch:** `feat/d05-inference-pipeline` · **PR:** —
> **Referência:** README_PLAN §4.1–4.3 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
Backends (`InferenceBackend`: DML/OpenVINO/CPU), `PersonTracker`/`target_selector`, estabilizador e ângulos vêm do pacote `athletemotion` (R02, R13, R14). O desktop deve orquestrar: captura → ring → **processo de inferência** (detetor intermitente + pose por ROI) → pós-processamento/biomecânica → UI. DML não permite `Run()` concorrente na mesma sessão.

## 2. Objetivo
`runtime/pipeline` que corre a inferência num **processo isolado** com *latest-frame-wins*, *double buffering*, métricas por estágio e **watchdog** com *fallback* para CPU.

## 3. Âmbito
**Cria:** `runtime/inference_worker.py`, `runtime/pipeline.py`, `runtime/results.py`, `runtime/watchdog.py`, `runtime/metrics.py`, `runtime/engine_factory.py`, testes.
**Altera:** `runtime/messages.py` (D04).
**Não mexe:** backends (R14), UI (D07/D08), captura (D03).

## 4. Subtarefas
- [ ] **1. `engine_factory.py`:** constrói motor/backends a partir de `Settings` + `hardware_profile` (D02), usando **apenas** classes do `athletemotion` (sem duplicar); resolve modelos via model zoo (D06 ou manifest R13); se modelo indisponível → `ModelUnavailableError` (nunca *fallback* silencioso).
- [ ] **2. `inference_worker.py` (processo `spawn`):** abre `ShmRing` (attach), carrega backend e **faz *warmup* antes de sinalizar `READY`**; laço: `acquire_read(latest=True)` → pré-processo (D04) → (detetor se `frame_idx % N==0` ou sem alvo) → pose na ROI → pós-processo (decode, `target_selector`, `stabilize`, ângulos R02) → `Result` pequeno (landmarks `[N,3]`, ângulos, timings por estágio, `t_capture_ns`) para a UI. **Uma sessão por thread; sem concorrência no mesmo `Run()`.**
- [ ] **3. `pipeline.py` (lado cliente):** `Pipeline.start(source, settings)`, `.stop()`, `.set_engine(...)` (reinicia worker), `.subscribe(callback)`; liga `CaptureSource` → `ShmRing`; estados `STARTING/WARMING/RUNNING/DEGRADED/FAILED/STOPPING`; backpressure: se o worker está ocupado, o frame novo **substitui** o pendente (contar *drops*).
- [ ] **4. Pré/pós em paralelo à GPU:** thread de pré-processamento no worker em *double buffering* (enquanto o backend infere N, o pré-processo prepara N+1 e o pós-processo trata N−1); medir ganho vs sequencial (flag `PIPELINE_MODE`). Manter só se p95 melhorar.
- [ ] **5. Métricas (`metrics.py`):** histogramas p50/p95/p99 por estágio (`capture,pre,detect,pose,post,send,ui`), FPS efetivo, *drops*, idade do resultado (`now - t_capture`); API de leitura para D12; sem custo relevante (< 0.2 ms/frame).
- [ ] **6. Watchdog:** *heartbeat* do worker (≥ 1 resultado em `T` ms ou ping); se falha → reinicia (1×) → se falhar de novo, **troca para CPU/OpenVINO** com estado `DEGRADED` e aviso à UI; se o processo morrer (driver DML), UI mantém-se viva. Teste simulando `kill` do worker e travão artificial.
- [ ] **7. Sincronização resultado↔frame:** cada `Result` leva `t_capture_ns`; API `Pipeline.latest()` devolve `(frame_preview?, result)` coerentes; opção de **extrapolação** (Kalman do R12) para compensar latência; documentar a política (desenhar sobre o frame que gerou o resultado vs. último frame).
- [ ] **8. Shutdown/estado limpo:** `stop()` termina worker, fecha ring (dono faz `unlink`), 0 processos órfãos, 0 `SharedMemory` órfãs; teste repetido 50× arranque/paragem sem leaks de handles (contar com `psutil`).
- [ ] **9. Benchmarks reais:** correr 5 min com câmara real e com ficheiro; tabela de latências por estágio e FPS (RX 580 DML vs OpenVINO CPU) comparada com o orçamento do `README_PLAN` §4.2 (metas). Atualizar `README_PLAN` §4.2 com **valores medidos** e board/changelog.

## 5. Critérios de aceitação
- Pipeline estável ≥ 30 FPS em 720p durante 10 min sem *drops* anómalos nem crescimento de RSS > 5 %.
- Idade do resultado p95 ≤ meta do orçamento (ou desvio documentado + plano).
- `kill` do worker → recuperação automática; falha repetida → CPU em `DEGRADED`.
- 50 ciclos arranque/paragem sem leaks de processos/memória partilhada.
- Nenhum PyQt em `runtime/`.

## 6. Verificação
```powershell
cd desktopapp
pytest tests/integration/pipeline -q
python -m athletemotion_desktop.runtime.pipeline --source file:tests/data/sample.mp4 --seconds 60 --report
python -m athletemotion_desktop.runtime.pipeline --source camera:0 --seconds 300 --report
```

## 7. Riscos / Fora de âmbito
- Dois modelos em DML na mesma GPU podem competir: serializar no worker e medir.
- UI, gráficos, domínio de ciclos (D07/D08).

## 8. Prompt específico
```text
Executa a tarefa D05 (desktopapp/TASKS/D05_INFERENCE_PROCESS_PIPELINE.md) seguindo o Prompt mestre do desktop.
Reutiliza athletemotion (backends, tracker, ângulos). Worker em processo spawn, warmup antes de READY, latest-wins, watchdog com fallback para CPU. Sem fallback silencioso de modelo. Regista as latências medidas por estágio.
```

## 9. Evidências
_(tabelas de latência por estágio, testes de leaks, kill/recover)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
