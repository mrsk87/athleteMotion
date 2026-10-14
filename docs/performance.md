# Engenharia de Desempenho e Inferência (R14)

> **Status:** 🟢 VIGENTE · **Versão:** 0.3.1 · **Última atualização:** 2026-10-14 · **Responsável:** Senior Core Developer · **Revisto contra o código em:** `788dcbb`
> **Módulo:** `athletemotion.infrastructure.backends` · **Referência:** R14

---

## 1. Resumo Executivo e Métricas Globais

O objetivo primordial de R14 foi retirar da sessão de inferência todos os custos que não correspondem à rede neuronal, introduzir uma camada desacoplada `InferenceBackend` com suporte a DirectML, OpenVINO CPU e ONNX Runtime CPU, calibrar automaticamente perfis de execução em runtime (**Autotune**) e quantificar honestamente os ganhos de cada otimização com asserções numéricas e benchmarks reais de 300 fotogramas.

### Principais Conquistas:
1. **Latência de Inferência Real-Time:** `yolo11n-pose-320` em DirectML atinge **p50 de 4.12 ms** (p95 = 4.22 ms) a **241.4 FPS** com apenas 14.2% de carga de CPU.
2. **Alta Fidelidade Biomecânica:** `rtmpose-m` (Halpe26 com 26 keypoints e pés reais) corre a **p50 de 8.20 ms** (119.2 FPS) em GPU DirectML e **12.04 ms** (85.9 FPS) em OpenVINO CPU.
3. **Pré-Processamento Acelerado:** `fast_preprocess_roi` com `cv2.dnn.blobFromImage` SIMD alcança **46.1% de redução de tempo** (1.12 ms vs 2.08 ms) mantendo equivalência numérica estrita ($\Delta_{\text{max}} = 5.96 \times 10^{-8} \le 10^{-6}$) face à verdade-terreno.
4. **Pós-Processamento Vetorizado:** Re-mapeamento matricial de keypoints em NumPy alcança **90.2% de redução de tempo** (0.025 ms vs 0.254 ms por frame).

---

## 2. Matriz de Desempenho Medido (300 frames por célula)

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

---

## 3. Avaliação Rigorosa de Otimizações

### 3.1. IOBinding no DirectML (Subtarefa 3)
- **Métricas:** Standard `session.run` p50 = 4.158 ms vs `session.run_with_iobinding` p50 = 4.171 ms.
- **Resultado:** Ganho de **-0.31%** (sem ganho mensurável).
- **Decisão de Engenharia:** Conforme estipulado no critério de aceitação (manter apenas se $\ge 5\%$), o `IOBinding` é mantido desativado por omissão (`use_io_binding=False`), evitando o overhead de re-vinculação explícita de `OrtValue` no driver DirectML na arquitetura Polaris (AMD RX 580).

### 3.2. Quantização INT8 em CPU AVX2 (Subtarefa 7)
- **Métricas:** FP32 CPU p50 = 8.91 ms vs INT8 CPU p50 = 19.60 ms.
- **Speedup:** **0.45×** (mais de 2× mais lento; o critério exigia $\ge 1.30\times$).
- **Erro:** MAE nas previsões = 2.28 (exigia $\le 1.0$).
- **Justificação Científica:** O microprocessador Intel Xeon E5-1660 v3 (Haswell-E) suporta instruções AVX2 e FMA3, mas **não possui extensões VNNI (Vector Neural Network Instructions)**. A emulação de multiplicação matricial INT8 em AVX2 exige instruções de desempacotamento de 8 para 16 bits (`VPMOVZXBW`, `VPMADDWD`) e saturação, as quais apresentam menor débito de execução do que as instruções de produto escalar contínuo FP32 nativas (`VFMADD213PS`).
- **Decisão:** **Rejeitado e documentado**. O pipeline de CPU opera estritamente em FP32.

### 3.3. Afinamento de Threads e `allow_spinning` (Subtarefa 9)

| Configuração | `intra_op_num_threads` | `allow_spinning` | p50 (ms) | p95 (ms) |
|---|---|---|---|---|
| CPU ORT | 4 | 0 | 14.79 | 18.40 |
| CPU ORT | 6 | 0 | 11.88 | 13.25 |
| CPU ORT | 8 (físicos) | 0 | 12.03 | 13.97 |
| CPU ORT | 16 (lógicos) | 0 | 16.02 | 18.04 |
| CPU ORT | 4 | 1 | 10.17 | 10.28 |
| CPU ORT | 6 | 1 | 8.81 | 9.02 |
| CPU ORT | 8 (físicos) | 1 | 8.41 | 11.10 |
| CPU ORT | 16 (lógicos) | 1 | 9.48 | 14.47 |

- **Conclusão:** Configurar `intra_op_num_threads` para a contagem física (8 núcleos via `psutil.cpu_count(logical=False)`) evita a degradação de p95 observada com 16 threads lógicos (+29% de latência por contenda de hiper-thread). Em regime desktop interativo, `allow_spinning=0` é mantido por omissão para evitar consumo térmico desnecessário em repouso.

---

## 4. Arquitetura em Estágios (`StagedInferencePipeline`) e Autotune

1. **Pipeline em Estágios (R14 §6):**
   - Estágio 1: Descodificação JPEG + pré-processamento rápido em thread separada.
   - Estágio 2: Inferência síncrona exclusiva no backend.
   - Estágio 3: Pós-processamento biomecânico, estabilizador e deteção de ciclo.
   - Comunicação via buffers atómicos `latest-frame-wins` (double-buffering) eliminando qualquer acúmulo de fotogramas em atraso.
2. **Autotune Automático:**
   - Detecta modelo da CPU, adaptadores DirectML e versões de driver.
   - Grava `APP_DATA_DIR/hardware_profile.json` invalidando a cache apenas quando os binários ou drivers se alteram.
   - Seleciona automaticamente:
     - `realtime`: `yolo11n-pose-320` no backend `dml` (p95 = 4.22 ms, 241 FPS).
     - `precision`: `rtmpose-m` no backend `dml` (p95 = 8.85 ms, 119 FPS, 26 keypoints Halpe26).
     - `batch`: `yolo11n-pose-320` no backend `dml` para processamento rápido de vídeo gravado.
3. **Observabilidade Prometheus:**
   - Métricas expostas via rota autenticada `GET /metrics`.
   - Inclui contadores de fotogramas (`athletemotion_frames_total`), descartes por saturação (`athletemotion_frames_dropped_total`), taxa de transferência (`athletemotion_fps_effective`) e histograma de latência por estágio (`athletemotion_stage_latency_p95_ms`).
