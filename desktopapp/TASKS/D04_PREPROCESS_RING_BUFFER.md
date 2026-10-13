# D04 — Pré-processamento e ring buffer em memória partilhada

> **ID:** D04 · **Prioridade:** P0 · **Onda:** 1
> **Status:** 🔴 TODO · **Progresso:** 0/8 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D01 · **Bloqueia:** D05 · **Branch:** `feat/d04-preprocess-ring` · **PR:** —
> **Referência:** README_PLAN §4.1, §4.3 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
O processo de inferência é separado da UI/captura (isolamento de GIL e de falhas do driver DML). Frames devem circular **sem cópias** por `multiprocessing.shared_memory`. O pré-processamento de referência está em `athletemotion.domain.inference.onnx_utils` e a versão rápida em R14 (`preprocess_fast`).

## 2. Objetivo
`runtime/ring_buffer` (SPSC, *lock-free quando possível*) + `runtime/preprocess` (ROI + letterbox + blob) com equivalência numérica ao domínio, mais mensagens de controlo leves.

## 3. Âmbito
**Cria:** `runtime/ring_buffer/{shm_ring.py,layout.py,errors.py}`, `runtime/preprocess/{roi.py,letterbox.py,blob.py}`, `runtime/messages.py`, testes `tests/unit/ring_buffer`, `tests/perf/`.
**Não mexe:** processo de inferência (D05), captura (D03).

## 4. Subtarefas
- [ ] **1. Layout (`layout.py`):** cabeçalho fixo em memória partilhada (magic, versão, `n_slots`, `slot_bytes`, `w,h,c,dtype`, contadores `write_seq/read_seq`) + slots com metadados por slot (`seq`, `t_capture_ns`, `state`). Documentar o protocolo (diagrama no docstring/`docs`).
- [ ] **2. `ShmRing` (SPSC):** `create(name,...)` (dono), `attach(name)`, `acquire_write()`→view `np.ndarray` sobre o slot, `commit()`, `acquire_read(latest=True)` (devolve **o mais recente** e marca anteriores como descartados), `release()`, `close()`, `unlink()` (só dono). Contadores de *drops* e *overruns*. Barreiras de memória corretas (usar `struct`/`ctypes` atómicos ou `multiprocessing.Value` + *seq-lock*; justificar a escolha). Sem alocações por frame.
- [ ] **3. Testes de concorrência:** produtor e consumidor em processos distintos (`spawn`), 10 000 frames com padrão verificável (checksum por frame); nunca ler frame “rasgado” (seq-lock); `latest=True` nunca devolve mais antigo que o anterior lido; **sem leaks** (`SharedMemory` removida no fim, verificar nomes no sistema).
- [ ] **4. Shutdown seguro:** consumidor/produtor morrem a meio → dono limpa; `atexit` + *context manager*; teste que mata o consumidor (`terminate`) e confirma limpeza e ausência de bloqueio no produtor.
- [ ] **5. `preprocess/roi.py`:** recorte seguro (clamp), *padding* configurável (ex. 1.25 para RTMPose), devolve `Transform` (escala, offsets) para mapear de volta; **reutilizar** `athletemotion.domain.inference.onnx_utils` quando possível (importar; não copiar).
- [ ] **6. `letterbox.py` + `blob.py`:** letterbox para tamanho fixo (sem ampliar, como no domínio), conversão BGR→RGB, normalização `(x/255 - mean)/std` configurável, layout NCHW float32 **escrevendo num buffer pré-alocado** (sem `astype`/`transpose` com cópia); suporte a *affine* (RTMPose 192×256).
- [ ] **7. Equivalência e desempenho:** teste de equivalência numérica (±1e-6) contra `preprocess_roi_for_onnx` (domínio) para 20 frames/ROI; `pytest-benchmark` (`tests/perf`) a 720p/1080p → registar p50/p95 e comparar com o orçamento (≤ 2 ms em 720p; meta). Se não cumprir, registar e otimizar (`cv2.setNumThreads`, `cv2.resize` com `INTER_LINEAR`, evitar conversões).
- [ ] **8. Mensagens de controlo (`messages.py`):** dataclasses picklable pequenas (`FrameReady(slot,seq,t_capture_ns,roi)`, `Result(...)`, `Control(...)`, `Shutdown`) e canal `multiprocessing.Pipe/Queue(maxsize)`; **nunca** enviar frames por estes canais. Docs e board/changelog.

## 5. Critérios de aceitação
- 10 000 frames entre processos sem corrupção (0 erros de checksum) e sem leaks.
- Latência de escrita+leitura por frame < 0.2 ms (720p, medir).
- Equivalência numérica com o domínio ±1e-6.
- Pré-processamento 720p dentro do orçamento (ou desvio documentado com plano).
- `mypy --strict` limpo; sem PyQt.

## 6. Verificação
```powershell
cd desktopapp
pytest tests/unit/ring_buffer tests/unit/preprocess -q
pytest tests/perf -q --benchmark-only
```

## 7. Riscos / Fora de âmbito
- Atomicidade em Python é subtil: se *seq-lock* em Python puro não for fiável, usar extensão minimal (`ctypes` + `Interlocked*` do Windows) e documentar.
- 1 produtor/1 consumidor apenas (SPSC); multi-consumidor fora de âmbito.

## 8. Prompt específico
```text
Executa a tarefa D04 (desktopapp/TASKS/D04_PREPROCESS_RING_BUFFER.md) seguindo o Prompt mestre do desktop.
SPSC com latest-wins, sem frames rasgados, sem leaks de SharedMemory (dono único faz unlink). Pré-processamento sem alocações por frame e numericamente equivalente ao domínio. Mede tudo.
```

## 9. Evidências
_(testes concorrência, leaks, benchmark)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
