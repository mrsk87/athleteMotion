# D04 — Pré-processamento e ring buffer em memória partilhada

> **ID:** D04 · **Prioridade:** P0 · **Onda:** 1
> **Status:** 🔵 REVIEW · **Progresso:** 8/8 · **Atribuído a:** Buffy (Codebuff) · **Início:** 2026-10-13 · **Última atualização:** 2026-10-13
> **Depende de:** D01 · **Bloqueia:** D05 · **Branch:** `fix/r03-engine-sessions` (checkout partilhado) · **PR:** —
> **Referência:** README_PLAN §4.1, §4.3 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
O processo de inferência é separado da UI/captura (isolamento de GIL e de falhas do driver DML). Frames devem circular **sem cópias** por `multiprocessing.shared_memory`. O pré-processamento de referência está em `athletemotion.domain.inference.onnx_utils` e a versão rápida em R14 (`preprocess_fast`).

## 2. Objetivo
`runtime/ring_buffer` (SPSC, *lock-free quando possível*) + `runtime/preprocess` (ROI + letterbox + blob) com equivalência numérica ao domínio, mais mensagens de controlo leves.

## 3. Âmbito
**Cria:** `runtime/ring_buffer/{shm_ring.py,layout.py,errors.py}`, `runtime/preprocess/{roi.py,letterbox.py,blob.py}`, `runtime/messages.py`, testes `tests/unit/ring_buffer`, `tests/perf/`.
**Não mexe:** processo de inferência (D05), captura (D03).

**Desvios ao âmbito (justificados):**
- `runtime/preprocess/pipeline.py` foi acrescentado: sem ele, cada consumidor (D05, D08, D09) repetiria a orquestração ROI→letterbox→blob e alocaria buffers por frame — exatamente o que a tarefa proíbe. É o ponto de entrada (`Preprocessor`), com os três módulos por baixo.
- `runtime/ring_buffer/__init__.py` foi criado (só `docstring`): o pacote existia como *namespace package* implícito, o que é invisível para o empacotador do D15 e para a regra «sem re-exportações» do resto do `runtime/`.
- `tests/support/domain_reference.py` centraliza o carregamento do domínio por `PYTHONPATH` (com `skipif` quando ausente) para os testes de equivalência não dependerem da instalação editável da R01.

## 4. Subtarefas
- [x] **1. Layout (`layout.py`):** cabeçalho fixo (magic, `layout_version`, `n_slots`, `slot_bytes`, dimensões/dtype do frame e contadores `write_seq/read_seq/frames_*`) derivado de um único `struct.Struct`, com tabela `campo → (offset, formato)` construída a partir do formato declarado (cabeçalho e offsets nunca divergem). Registos por slot (`seq`, `t_capture_ns`, `state` ∈ `EMPTY|READY|READING`) e ajuste da geometria aos offsets do `struct`.
  - *Alocação:* `SharedMemory` + `np.ndarray(view)` sobre o segmento — **sem extensão nativa**: ver 10.1 (atomicidade) e 9.7 (desvio medido quanto ao `ctypes`/`Value`).
- [x] **2. `ShmRing` (SPSC):** `create()` (dono, `n_slots=3`), `attach()` (sem posse, valida magic/versão/geometria/tamanho antes de usar), `acquire_write()` → `FrameSlot` com vista `np.ndarray`, `commit(t_capture_ns=...)`, `acquire_read(latest=True|False)`, `release(slot)`, `close()`, `unlink()` (recusado a não-donos), `shutdown()`, `stats()` (`RingStats`) e `read_slot()` para inspeção em testes. `RingBufferFullError` quando todos os slots estão arrendados, com contagem em `frames_overrun`. Sem alocações por frame.
- [x] **3. Testes de concorrência:** produtor e consumidor em **processos distintos** (`spawn`), 10 000 frames com padrão verificável por frame, verificação de *checksum* do lado do consumidor; `latest=True` nunca devolve mais antigo que o anteriormente lido; segmento removido no fim (sem fugas).
- [x] **4. Shutdown seguro:** *context manager* + `atexit` (dono único faz `unlink`, silencioso se o segmento já não existir); teste que mata o consumidor a meio (`terminate`) e confirma que o produtor continua sem bloquear e que a memória é libertada.
- [x] **5. `preprocess/roi.py`:** `clamp_roi()` (encosta à frame, nunca rebenta) + `Roi.with_padding(1.25)` para o RTMPose, `crop_roi()` (vista quando possível, cópia só se necessário) e `Transform` com `to_model()`/`to_frame()` (mapeamento inverso de coordenadas, sem Pydantic no *hot path*).
- [x] **6. `letterbox.py` + `blob.py`:** `letterbox_geometry()` (escala **sem ampliar**, como no domínio: `min(target/w, target/h)` limitado a 1.0) e `letterbox_into()` (canvas pré-alocada, `INTER_LINEAR`, padding por `fill_value`); `canvas_to_nchw_float32()` escreve BGR→RGB + normalização `(x*input_scale - mean)/std` diretamente no buffer NCHW de destino (sem `astype`/`transpose` com cópia) e suporta entradas retangulares (192×256).
- [x] **7. Equivalência e desempenho:** `tests/unit/preprocess/test_equivalence.py` compara 21 frames/ROI (incluindo degenerados e fora da frame) com `preprocess_roi_for_onnx` do domínio; `tests/perf/` mede 720p, 1080p, RTMPose e o anel, com p50/p95 contra os orçamentos (ver 9.2–9.4).
- [x] **8. Mensagens de controlo (`messages.py`):** `FrameReady`, `Result[T]`, `Control`+`ControlKind` (`StrEnum`), `Shutdown`, `ControlQueue/ResultQueue/EventQueue` com `maxsize` e teste que recusa envio acima do limite; **nunca** frames por estes canais (teste de tamanho máximo de mensagem). Docs/board/changelog.

## 5. Critérios de aceitação
- ✅ **10 000 frames entre processos sem corrupção (0 erros de checksum) e sem fugas** — `tests/unit/ring_buffer/test_cross_process.py` (ver 9.1).
- ✅ **Latência de escrita+leitura por frame < 0,2 ms (720p, medir)** — medido **p50 0,0178 ms / p95 0,0302 ms** (ver 9.3).
- ✅ **Equivalência numérica com o domínio ±1e-6** — diferença máxima medida **0,000e+00** (bit-idêntico) em 21 comparações a 320×320 e 640×640 (ver 9.2).
- ✅ **Pré-processamento 720p dentro do orçamento** — p50 0,836 ms / p95 0,946 ms (orçamento 2 ms) (ver 9.2).
- ✅ **`mypy --strict` limpo; sem PyQt** — `Success: no issues found in 71 source files`; teste que garante que nenhum módulo de `runtime/` importa PyQt (9.5).

## 6. Verificação
```powershell
cd desktopapp
$env:QT_QPA_PLATFORM="offscreen"
python -m pytest tests -q                                             # 225 passed
python -m pytest tests/unit/ring_buffer tests/unit/preprocess -q
python -m pytest tests/perf -q -s                                     # imprime p50/p95
python -m pytest tests -q --cov=athletemotion_desktop.runtime.ring_buffer `
  --cov=athletemotion_desktop.runtime.preprocess --cov-report=term-missing
ruff check src tests ; ruff format --check src tests scripts ; mypy src tests   # limpos
```

## 7. Riscos / Fora de âmbito
- **Atomicidade em Python puro:** a alternativa «extensão minimal (`ctypes` + `Interlocked*`)» **não** foi implementada. Justificação e medição em 9.7/10.1: o protocolo de *claim-then-verify* descarta a janela de cruzamento em vez de a tornar atómica, e o custo observado dessa janela foi de 0,8 % de frames descartados (83/10 000) sem **um único** frame rasgado entregue. Se o D13 (robustez) mostrar que 0,8 % de descarte afeta medições, o caminho é *seqlock* com barreira (`ctypes`), não mais tentativas.
- 1 produtor/1 consumidor apenas (SPSC); multi-consumidor fora de âmbito (levantaria `RingBufferStateError`).

## 8. Prompt específico
```text
Executa a tarefa D04 (desktopapp/TASKS/D04_PREPROCESS_RING_BUFFER.md) seguindo o Prompt mestre do desktop.
SPSC com latest-wins, sem frames rasgados, sem leaks de SharedMemory (dono único faz unlink). Pré-processamento sem alocações por frame e numericamente equivalente ao domínio. Mede tudo.
```

## 9. Evidências

### 9.1. 10 000 frames entre processos (`spawn`), com verificação de integridade
```
tests/unit/ring_buffer/test_cross_process.py
[anel] escritos=10000 aceites=3689 descartados=83 saltados=0 descartados_pelo_produtor=6310
0 frames rasgados · 0 erros de checksum · segmento removido no fim
```
O produtor corre sem pausas e o consumidor é deliberadamente mais lento (é este o cenário de tempo real: *latest-frame-wins*). Os **83 descartados (0,8 %)** são os frames cujo slot foi reclamado pelo consumidor no instante em que o produtor o reutilizava — o protocolo prefere descartar a entregar um frame possivelmente rasgado (10.1). Os 6 310 «descartados pelo produtor» são frames que o produtor publicou em slots reutilizados sem serem lidos: perda *esperada* por desenho, contada em `frames_dropped`.

### 9.2. Equivalência numérica com o domínio (`±1e-6`, 21 frames/ROI)
```
[equivalência 640x640] comparações=21 diferença máxima=0.000e+00 (critério 1e-06)
[equivalência 320x320] comparações=21 diferença máxima=0.000e+00 (critério 1e-06)
```
Inclui ROIs encostados às bordas, a começar fora da frame, maiores que a frame, panorâmicos, verticais e degenerados (1×1). O resultado é **bit-idêntico**, e há um teste separado (`test_tensors_are_bit_identical_to_the_domain`) que falha se alguém introduzir uma divergência minúscula sem a discutir.

### 9.3. Orçamentos de desempenho (medidos nesta máquina: Xeon E5-1660 v3)
```
[preprocess 720p->320]    p50=0.836 ms p95=0.946 ms  n=1115  (orçamento 2,0 ms)  ✅
[preprocess 1080p->640]   p50=2.756 ms p95=3.234 ms  n=378   (33 ms/frame a 30 FPS) ✅
[preprocess rt 192x256]   p50=0.429 ms                (orçamento 2,0 ms)        ✅
[anel 720p]               p50=0.0178 ms p95=0.0302 ms n=40819 (orçamento 0,2 ms) ✅
```

> Repetindo a medição com a máquina mais carregada (a suíte completa a correr), o 720p sobe para **p50 1,096 ms / p95 1,130 ms** e o 1080p para 3,109 ms — ou seja, o p50 varia 0,84–1,10 ms entre execuções sem nunca se aproximar do orçamento de 2 ms. O portão verifica o **orçamento** (p50 e p95 < 2 ms); apertá-lo para metade do orçamento tornava uma variação de turbo/load numa falha sem relação com o requisito.
O anel custa **~0,02 ms por frame** (0,1 % do orçamento de 16,6 ms), ou seja, a contabilidade de slots/semáforos não é o gargalo. A 1080p o pré-processamento sobe para 2,8 ms de mediana: continua dentro de 1/10 do orçamento de 30 FPS, e o número fica registado para o autotune (R14/D12) decidir resolução por máquina.

### 9.4. Cobertura dos módulos novos
```
Name                                                     Stmts   Miss  Cover   Missing
src\...\runtime\preprocess\{blob,letterbox,roi}.py           152      0   100%
src\...\runtime\preprocess\pipeline.py                        66      1    98%   125
src\...\runtime\ring_buffer\errors.py                         32      0   100%
src\...\runtime\ring_buffer\layout.py                        143      1    99%   566
src\...\runtime\ring_buffer\shm_ring.py                      313     16    95%   (defensivo/POSIX/corrida atómica)
TOTAL                                                        706     18    97%
```
Linhas não cobertas são caminhos que **não pertencem ao fluxo real**: enumeração de segmentos em `/dev/shm` (Windows não tem), guardas defensivas marcadas com `pragma: no cover` e as duas janelas de corrida que o teste de dois processos já cobre estatisticamente.

### 9.5. Verificação estática (portão da AGENTS.md §5.3)
```
ruff format --check src tests scripts → 71 files already formatted
ruff check src tests                 → All checks passed!
mypy src tests                       → Success: no issues found in 71 source files
```
`mypy` corre agora também sobre `tests/` (48 erros corrigidos, incluindo 25 pré-existentes da D02): o portão vale para tudo o que é submetido, não só para `src/`.

### 9.6. `runtime/` continua sem Qt
Nenhum módulo de `runtime/` importa PyQt6 (verificado por teste), pelo que o pacote é utilizável por CLI e pelo processo de inferência sem carregar a UI.

### 9.7. Desvio medido ao «caminho principal» do protocolo
O protocolo sugeria `ctypes`/`Interlocked*` se o *seq-lock* em Python não fosse fiável. Optou-se por **não** introduzir extensão nativa: (a) o produtor nunca escreve num slot marcado `READING`; (b) o consumidor **reclama primeiro e verifica depois**, pelo que a janela de cruzamento termina em descarte, não em leitura rasgada; (c) `release()` devolve a estabilidade do frame para que o consumidor decida com o dado na mão. Medição da janela: 0,8 % de descarte, 0 frames rasgados (9.1).

## 10. Notas e Descobertas
- **A marca `READY→READING` não é atómica e descobrimo-lo com o teste de dois processos.** A primeira versão escolhia o slot e só depois o marcava: existia uma janela em que o consumidor escolhia um slot que o produtor estava prestes a reutilizar, e o consumidor podia ler um frame meio escrito. A correção foi inverter a ordem (**reclamar o slot primeiro, ler os metadados depois**) e transformar a falha de estabilidade num valor de retorno (`release() -> bool`) em vez de uma exceção — o consumidor decide se usa o resultado depois de o trabalho estar feito. Com o protocolo anterior o teste de 10 000 frames apanhava o defeito de forma intermitente; com o novo, zero rasgos.
- **`release()` mudou de contrato:** devolve `True` quando o frame se manteve íntegro durante toda a lease. Um slot cujo frame foi substituído volta a `READY` (não a `EMPTY`): contém um frame publicado que ninguém leu, e o produtor pode reutilizá-lo contando‑o como perdido.
- **`attach()` valida antes de usar:** magic, `layout_version`, geometria e tamanho mínimo do segmento. No Windows o segmento é **maior** do que o pedido (arredondamento à granularidade de página), pelo que a comparação é «≥», com a razão documentada no código.
- **Sem nomes de segmentos no Windows:** não existe `/dev/shm`, logo `list_ring_names()` devolve `()`; a deteção por nome (`segment_exists`) é o caminho suportado e é o que os testes usam para provar que não há fugas.
- **`atexit` é rede de segurança, não o caminho principal:** o dono remove o segmento no `shutdown()`/`__exit__`; o `atexit` só cobre um encerramento anormal e é silencioso se o segmento já não existir (dois `shutdown` durante o fecho não devem produzir erros).
- **Texto de `runtime/` fica em PT-PT nos dois idiomas.** Pela regra 1 do protocolo, `runtime/` não pode importar PyQt, logo não usa `tr()`. As mensagens de erro/exceções destes módulos são técnicas e destinam-se a logs e relatórios de suporte; fica registado como trabalho do **D14** (tal como os avisos de diagnóstico da D02) decidir a política de i18n do `runtime/`.
- **A equivalência só faz sentido com o domínio presente:** os testes usam `tests/support/domain_reference.py` e ficam `skipif` quando `athletemotion` não está acessível. Sem a R01 fechada isto significaria verificação silenciosamente ignorada, pelo que o número do 9.2 foi obtido com o domínio carregado (`21 comparações` × 2 tamanhos, não 0).

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-13 | Buffy (Codebuff) | 1–2 | `runtime/ring_buffer/{layout.py,shm_ring.py,errors.py}`, `runtime/ring_buffer/__init__.py`, `tests/unit/ring_buffer/{test_layout.py,test_shm_ring.py}` | Anel SPSC em `SharedMemory` com cabeçalho derivado do `struct`, contadores de telemetria, posse única (`unlink`), exceções de domínio tipadas e `stats()`; 6 exceções (`LayoutError`, `OwnershipError`, `ClosedError`, `StateError`, `FullError`, `TornFrameError`) |
| 2026-10-13 | Buffy (Codebuff) | 3–4 | `runtime/ring_buffer/shm_ring.py`, `tests/unit/ring_buffer/test_cross_process.py` | Teste de dois processos (`spawn`) com 10 000 frames e verificação de integridade; teste que mata o consumidor e confirma que o produtor não bloqueia nem deixa o segmento no sistema; corrigido o defeito de janela não-atómica (reclamar antes de verificar) e `release()` passou a devolver estabilidade |
| 2026-10-13 | Buffy (Codebuff) | 5–6 | `runtime/preprocess/{roi.py,letterbox.py,blob.py,pipeline.py,__init__.py}`, `tests/unit/preprocess/{test_roi.py,test_letterbox_blob.py,test_pipeline.py}` | ROI com *clamp*/padding e mapeamento inverso; letterbox sem ampliar em canvas pré-alocada; BGR→RGB + `(x/255 - mean)/std` escritos diretamente no NCHW de destino (sem cópias intermedias); `Preprocessor` reutiliza buffers por frame |
| 2026-10-13 | Buffy (Codebuff) | 7 | `tests/unit/preprocess/test_equivalence.py`, `tests/perf/{test_preprocess_perf.py,test_ring_buffer_perf.py}`, `tests/support/domain_reference.py` | Equivalência bit-idêntica com `preprocess_roi_for_onnx` (21 frames/ROI, 2 tamanhos) e portões de desempenho com p50/p95 contra os orçamentos (anel 0,018 ms; 720p 0,84 ms; 1080p 2,76 ms) |
| 2026-10-13 | Buffy (Codebuff) | 8 | `runtime/messages.py`, `tests/unit/test_messages.py` | Mensagens de controlo picklable e minúsculas (`FrameReady`, `Result[T]`, `Control`+`ControlKind`, `Shutdown`) e fábricas de filas com `maxsize`, com teste que prova que não transportam frames |
| 2026-10-13 | Buffy (Codebuff) | 7–8 | `tests/*`, `desktopapp/TASKS/*`, `README.md`, `README_PLAN.md` | `mypy --strict` estendido a `tests/` (48 erros corrigidos, 25 deles pré-existentes); estado, board e changelog atualizados com as medições desta tarefa |
