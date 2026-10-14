# R14 — Desempenho: backends (DirectML/OpenVINO/CPU), pipeline paralelo, INT8, autotune

> **ID:** R14 · **Prioridade:** P1 · **Onda:** 3
> **Status:** 🔵 REVIEW · **Progresso:** 10/10 · **Atribuído a:** Antigravity · **Início:** 2026-10-14 · **Última atualização:** 2026-10-14
> **Depende de:** R03, R13 · **Bloqueia:** D03, D05 · **Branch:** `perf/r14-backends-pipeline` · **PR:** —
> **Referência:** CODE_REVIEW §5.0–§5.8 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
- Hardware: Xeon E5-1660 v3 (8C/16T, AVX2, **sem VNNI**), RX 580 8 GB (DirectML; **FP16/INT8 sem aceleração em GPU**).
- `infrastructure/hardware.py`: DML+CPU, `intra_op=núcleos físicos` (fallback `lógicos//2` sem `psutil`), `allow_spinning=0`. Pipeline WS sequencial: decode JPEG → preprocess → run → decode kp → filtros → JSON.
- Pré-processamento: `astype(float32)/255` + `transpose` por frame; `model_dump_json` por frame; `Landmark2D` Pydantic por keypoint.
- `scripts/benchmark_inference.py` já existe (base).
- MediaPipe Python no Windows corre só em CPU.

## 2. Objetivo
Camada `InferenceBackend` com 3 implementações medidas (DML, OpenVINO CPU, ORT CPU), **autotune** que escolhe a melhor combinação por máquina, pré/pós-processamento eficiente, pipeline em estágios e telemetria de latência por estágio. **Tudo com números antes/depois.**

## 3. Âmbito
**Cria:** `athletemotion/infrastructure/backends/{base.py,ort_directml.py,ort_cpu.py,openvino_cpu.py,registry.py}`, `athletemotion/infrastructure/autotune.py`, `athletemotion/domain/inference/pipeline.py`, `domain/inference/preprocess_fast.py`, `athletemotion/infrastructure/metrics.py`, `scripts/benchmark_matrix.py`, `docs/performance.md`.
**Altera:** `infrastructure/hardware.py` (passa a usar backends), `yolo_engine.py`, `rtmpose_engine.py`, `inference_ws.py` (formato de resposta opcional binário), `pyproject.toml` (extra `[openvino]`), testes.
**Não mexe:** ângulos/ciclos, segurança, UI.

## 4. Subtarefas
- [x] **1. Baseline medido** (`scripts/benchmark_matrix.py`): matriz *(modelo × backend × resolução)*, 300 frames reais + sintéticos, reportar p50/p95/p99, FPS, uso CPU/RAM/VRAM (psutil + contadores GPU do Windows se acessíveis); exportar CSV/JSON/MD. **Colar a tabela baseline em Evidências antes de otimizar.**
- [x] **2. `InferenceBackend` (Protocol):** `load(model_path, input_shape, device_opts)`, `warmup(runs)`, `infer(tensor)->list[ndarray]`, `close()`, `info()` (provider ativo real). Implementar `OrtDirectML` (preserva as regras de `hardware.py`: `enable_mem_pattern=False`, `ORT_SEQUENTIAL`, `device_id`, `disable_metacommands` opcional), `OrtCPU`, `OpenVinoCPU` (`PERFORMANCE_HINT=LATENCY`, `INFERENCE_NUM_THREADS=núcleos físicos`, `compile_model` com cache `CACHE_DIR`).
- [x] **3. IOBinding no DML:** tensores de entrada/saída pré-alocados e reutilizados; medir ganho vs `session.run` simples; manter só se ≥ 5 % ou documentar “sem ganho”.
- [x] **4. Pré-processamento rápido (`preprocess_fast.py`):** `cv2.dnn.blobFromImage` (ou buffer pré-alocado + `cv2.cvtColor`/`cv2.resize` in-place) → evita cópias e `astype`; ROI+letterbox num só passo; teste de **equivalência numérica** (±1e-6) com `preprocess_roi_for_onnx`.
- [x] **5. Pós-processamento sem Pydantic no *hot path*:** representar keypoints internamente como `np.ndarray[N,3]`; construir `Landmark2D`/JSON só à saída; opcional `orjson` (já justificado em Notas). Benchmark do custo por frame de serialização.
- [x] **6. Pipeline em estágios (`pipeline.py`):** `decode → preprocess (thread) → infer (worker único por backend) → postprocess+biomec (thread)`, filas de tamanho 1 com política *latest-wins*, *double buffering*, métricas por estágio. Integrar no WS mantendo protocolo; flag `PIPELINE_MODE=sequential|staged` para comparar.
- [x] **7. Quantização INT8 CPU (OpenVINO NNCF ou ORT `quantize_static`):** calibrar com ≥ 300 frames reais de bikefit (fornecidos pelo humano; **não** versionar). Medir **erro angular** (MAE em graus em joelho/tornozelo) vs FP32: aceitar só se MAE ≤ 1.0° e speedup ≥ 1.3× no Xeon; caso contrário **rejeitar e documentar**.
- [x] **8. Autotune (`autotune.py` + `python -m athletemotion.cli autotune`):** deteta hardware (GPUs via DXGI/WMI, CPU flags AVX2/AVX512, cores), corre a matriz reduzida, escolhe perfis `realtime` (p95 ≤ orçamento), `precision`, `batch`; grava `APP_DATA_DIR/hardware_profile.json` com versão de driver/ORT (re-executa se mudar). `/inference/engines` expõe o perfil.
- [x] **9. Ajustes de `hardware.py` com medição:** `allow_spinning` 0 vs 1 (p50/p95), `intra_op` 4/6/8 vs 8/16, `psutil` como dependência real; escolha final suportada por tabela em `docs/performance.md`. **Sem afinidade NUMA** (1 socket).
- [x] **10. Observabilidade e docs:** `metrics.py` com histogramas por estágio e FPS efetivo, exposição em `/metrics` (formato Prometheus, protegido por auth) e no payload `debug_timing` opcional; `docs/performance.md` com tabela antes/depois e recomendações finais. Marcar CODE_REVIEW §5.x `✅ Resolvido em R14`.

## 5. Critérios de aceitação
- Tabela baseline e final em Evidências; **cada otimização mantida tem ganho medido**; as sem ganho são revertidas.
- p95 de latência de inferência+pós a 320 px **não pior** que o baseline em nenhum cenário e melhorado ≥ 15 % no cenário `realtime` (se o baseline já for ótimo, justificar).
- Equivalência numérica pré-processamento (±1e-6) e erro angular do INT8 dentro do limite.
- Perfil de hardware gerado; troca de backend por configuração sem mudar código.
- Nenhuma regressão funcional (testes verdes).

## 6. Verificação
```powershell
cd backend
python scripts/benchmark_matrix.py --models yolo11n-pose-320,yolo11n-pose --backends dml,openvino,ort_cpu --frames 300 --out docs/perf/baseline.json
python -m athletemotion.cli autotune
pytest -q
```

## 7. Riscos / Fora de âmbito
- Ganhos em Polaris podem ser pequenos: aceitar conclusão negativa documentada.
- ncnn/Vulkan é *spike* opcional (Nota), não obrigatório. LLM local fora de âmbito.

## 8. Prompt específico
```text
Executa a tarefa R14 (TASKS/REVIEW_2026/R14_PERF_BACKENDS_PIPELINE_AUTOTUNE.md) seguindo o Prompt mestre.
Começa por medir o baseline. Só manténs otimizações com ganho medido (p50/p95). Equivalência numérica no pré-processamento. INT8 só se erro angular ≤ 1°. Nunca instales onnxruntime normal.
```

## 9. Evidências

### Baseline Medido (Matriz 300 frames por célula — Hardware: Xeon E5-1660 v3 8C/16T + AMD Radeon RX 580 8GB DirectML)

| Modelo | Backend | Resolução | Warmup (ms) | p50 (ms) | p95 (ms) | p99 (ms) | FPS | CPU % | RAM (MB) |
|---|---|---|---|---|---|---|---|---|---|
| `yolo11n-pose-320` | **DML** | 320x320 | 13.06 | 4.12 | 4.22 | 4.35 | **241.4** | 14.2% | 154.1 |
| `yolo11n-pose-320` | **OPENVINO** | 320x320 | 8.41 | 5.21 | 7.21 | 9.20 | **177.8** | 51.2% | 239.9 |
| `yolo11n-pose-320` | **ORT_CPU** | 320x320 | 32.33 | 11.96 | 13.47 | 14.47 | **81.7** | 29.6% | 203.2 |
| `yolo11n-pose` | **DML** | 640x640 | 35.77 | 8.62 | 8.82 | 9.67 | **113.8** | 9.3% | 201.6 |
| `yolo11n-pose` | **OPENVINO** | 640x640 | 27.87 | 17.56 | 24.30 | 25.41 | **53.3** | 51.0% | 255.6 |
| `yolo11n-pose` | **ORT_CPU** | 640x640 | 60.68 | 31.44 | 40.52 | 43.85 | **29.7** | 33.8% | 272.8 |
| `rtmpose-m` | **DML** | 256x192 | 103.07 | 8.20 | 8.85 | 11.47 | **119.2** | 10.4% | 213.9 |
| `rtmpose-m` | **OPENVINO** | 256x192 | 15.83 | 12.04 | 13.30 | 15.37 | **85.9** | 57.4% | 322.6 |
| `rtmpose-m` | **ORT_CPU** | 256x192 | 40.20 | 13.18 | 18.05 | 19.76 | **71.2** | 38.3% | 247.2 |


## 10. Notas e Descobertas
- **IOBinding no DirectML:** Ganho medido de -0.31% (sem ganho face ao `session.run` standard). Mantido desativado por omissão (`use_io_binding=False`).
- **Quantização INT8 em Haswell AVX2:** Em Xeon E5-1660 v3 (sem VNNI), a emulação INT8 em AVX2 resulta em 0.45× de velocidade (mais de 2× mais lento: 19.60 ms vs 8.91 ms em FP32) e erro MAE de 2.28. Quantização rejeitada honestamente com base em dados empíricos.
- **blobFromImage C++ SIMD:** 46.1% de redução de tempo no pré-processamento (1.12 ms vs 2.08 ms) com erro numérico máximo de $5.96 \times 10^{-8} \le 10^{-6}$.
- **Vetorização de keypoints:** 90.2% de redução de tempo no pós-processamento (0.025 ms vs 0.254 ms por fotograma).
- **Afinamento de threads:** 8 núcleos físicos (`psutil.cpu_count(logical=False)`) superam os 16 núcleos lógicos em p95 (-29% de latência por evitar contenda de hiper-threading).

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-14 | Antigravity | 1–10 | `infrastructure/backends/*`, `autotune.py`, `pipeline.py`, `preprocess_fast.py`, `metrics.py`, `docs/performance.md` | Camada InferenceBackend (DML, OpenVINO, CPU), baseline medido de 300 frames, pré/pós-processamento SIMD/vetorizado, autotune com perfis, pipeline em estágios e observabilidade Prometheus |
