# ADR 003: Aceleração Bare-Metal com DirectML (GPU) e OpenVINO (CPU)

> **Status:** Aceite  
> **Data:** 2026-10-14  
> **Decisores:** Senior Core Developer, Equipa de Desempenho  
> **Referência:** R14, CODE_REVIEW §5.1, §5.2, §5.4  

---

## 1. Contexto e Formulação do Problema
O hardware de desenvolvimento e estúdio de referência consiste num processador Intel Xeon E5-1660 v3 (Haswell-E, 8C/16T, microarquitetura AVX2 sem VNNI) e numa placa gráfica AMD Radeon RX 580 (Polaris 20, 8 GB VRAM).
A inferência de modelos de pose estimation exigia atingir taxas de fotogramas superiores a 60 FPS (idealmente $> 100\text{ FPS}$) com latência p50 $< 10\text{ ms}$ para feed ao vivo. O framework ONNX Runtime com CUDA não suporta GPUs AMD Polaris sem ROcm (incompatível com Windows 10/11 para esta geração). O framework ncnn adiciona complexidade de compilação em C++ no ecossistema Python. A quantização INT8 foi sugerida mas não avaliada empiricamente.

---

## 2. Decisão Tomada
1. **GPU Primária via DirectML (`DmlExecutionProvider`):** Utilizar `onnxruntime-directml` com configuração otimizada: `enable_mem_pattern=False`, execução sequencial (`ORT_SEQUENTIAL`) e warmup obrigatório. A AMD Radeon RX 580 alcança **4.12 ms (241 FPS)** com YOLO11n e **8.20 ms (119 FPS)** com RTMPose-m.
2. **CPU Secundária via OpenVINO (`OpenVinoCPUBackend`):** Utilizar o OpenVINO 2026.4.1 com `PERFORMANCE_HINT=LATENCY` e cache de compilação em disco (`CACHE_DIR`). O Xeon Haswell-E atinge **12.04 ms (85.9 FPS)** em FP32, superando o runtime CPU padrão do ONNX Runtime (17.30 ms).
3. **Rejeição Técnica Formal de Quantização INT8 em Haswell-E:**
   O benchmark determinístico de 300 fotogramas provou que a quantização dinâmica INT8 no Xeon E5-1660 v3 é **2.2× mais lenta que FP32** (19.60 ms vs 8.91 ms, speedup de 0.45×) devido à ausência de instruções vetoriais VNNI na arquitetura Haswell, obrigando à emulação de GEMM por micro-operações AVX2. Mantém-se estritamente **FP32 nativo**.
4. **IOBinding:** Desativado por omissão após medição empírica provar ganho de $-0.31\%$ (adiciona ligeiro overhead de binding para tensores pequenos de pose).

---

## 3. Consequências e Trade-offs

### 3.1. Positivas (+)
- **Aproveitamento Máximo da GPU AMD:** Latências ultra-reduzidas na Radeon RX 580 sem dependência de drivers experimentais Linux/ROCm.
- **CPU Fallback Eficiente:** Em máquinas sem GPU dedicada, o OpenVINO garante cadência confortável $> 60\text{ FPS}$.
- **Decisão Guiada por Dados:** Evitou-se o antipadrão comum de aplicar quantização INT8 cega que degradaria o desempenho em 120%.

### 3.2. Negativas / Custos (-)
- Requer compilação/conversão inicial de modelos pelo OpenVINO (mitigada pela persistência de cache de modelos compilados).

---

## 4. Conformidade e Validação
Garantido por benchmarks em `backend/scripts/benchmark_matrix.py`, testes unitários em `tests/unit/test_r14_backends.py` e relatório em `docs/performance.md`.
