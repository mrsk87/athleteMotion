# R13 — Modelos: RTMPose Halpe26 real, associação de pessoa, manifest de modelos

> **ID:** R13 · **Prioridade:** P1 · **Onda:** 2
> **Status:** 🔴 TODO · **Progresso:** 0/9 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** R02, R03 · **Bloqueia:** R14, D06 · **Branch:** `feat/r13-models` · **PR:** —
> **Referência:** CODE_REVIEW §1.11, §2.8, §5.3 · **Decisão humana D1 (licença Ultralytics)** · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
- `rtmpose_engine.py` espera `models/rtmpose-m.onnx` (inexistente) e **cai silenciosamente para YOLO mantendo o nome `rtmpose`**; `api/v1/inference.py` só avisa nas notas.
- `yolo_engine._extract_person`: `argmax(conf)` sobre 8400 candidatos → o alvo pode saltar para outra pessoa; sem associação temporal.
- YOLO11-pose (COCO-17) não tem pontos do pé; RTMPose **Halpe26** tem `big_toe`, `small_toe`, `heel` (26 pontos).
- Pesos fora do Git (`.gitignore` ignora `*.onnx/*.pt/*.task`); sem manifest nem verificação de integridade.
- `requirements.txt` documenta o perigo `onnxruntime` vs `onnxruntime-directml`.

## 2. Objetivo
Modelo **com pés reais** integrado e verificável; escolha estável do atleta; gestão de pesos com checksum; **falha explícita** quando um modelo não está disponível.

## 3. Âmbito
**Cria:** `backend/models/manifest.json`, `athletemotion/domain/inference/model_zoo.py`, `athletemotion/domain/inference/target_selector.py`, `scripts/fetch_models.py`, `scripts/export_rtmpose.md` (procedimento), `domain/inference/halpe26.py` (mapeamento de keypoints).
**Altera:** `rtmpose_engine.py`, `yolo_engine.py`, `person_tracker.py`, `api/v1/inference.py`, `domain/inference/base.py`, testes.
**Não mexe:** backends/pipeline (R14), ângulos (R02).

## 4. Subtarefas
- [ ] **1. Manifest:** `models/manifest.json` — por modelo: `id, task, framework, url(s), sha256, size_bytes, license, input_shape, input_norm(mean,std), output_format, keypoint_layout, min_ort_version`. `model_zoo.verify(id)` calcula SHA-256 e compara; `scripts/fetch_models.py` descarrega com retoma e verifica; **não commitar pesos**. Preencher com hashes reais **apenas depois** de descarregar e calcular (nunca inventar hashes: se não for possível, `sha256: null` + aviso ruidoso e `verified:false`).
- [ ] **2. Decisão de licença D1:** se humano indicar que AGPL (Ultralytics) é inaceitável, marcar YOLO como `license_risk` no manifest e o motor `yolo_*` exibe aviso; propor RTMDet-tiny (Apache-2.0) como detetor alternativo (spike documentado em *Notas*, não implementar sem decisão).
- [ ] **3. Mapeamento Halpe26 (`halpe26.py`):** nomes e índices dos 26 pontos, esqueleto, pares esquerda/direita; teste de integridade (26 nomes únicos, simetria).
- [ ] **4. RTMPose real:** pré-processamento correto (recorte da caixa com *padding* 1.25, *affine* para 192×256, normalização mean/std do manifest), decode **SimCC** (argmax por eixo ÷ `simcc_split_ratio`, confiança = min/produto dos picos) e transformação inversa ao frame original (reutilizar `onnx_utils`, adicionando affine). Verificar com a imagem/amostra de referência do modelo (golden test com landmarks esperados ±2 px; se não houver golden, gerar a partir de execução de referência do `rtmlib` e registar procedência).
- [ ] **5. Sem fallback silencioso:** se `rtmpose` selecionado e o modelo/hash falhar → `PoseEngineRegistry.create` levanta `ModelUnavailableError`; `/inference/engines` marca `available=false`, `reason`; `switch_engine` devolve 409 com mensagem clara (R04 formato). Nome do motor reflete o que realmente corre (`engine_name` + `backend_model`).
- [ ] **6. `target_selector.py`:** escolher o atleta com score `w1·conf + w2·IoU(prev_box) + w3·proximidade ao centro previsto (Kalman) + w4·área`; *lock* no atleta após N frames estáveis; reatribuição só se a confiança do alvo cair < limiar durante M frames; parâmetros em dataclass. Substitui `argmax` em `_extract_person`. Teste com cenas sintéticas de 2 pessoas (passagem/oclusão).
- [ ] **7. Pós-processamento YOLO eficiente:** filtrar por `conf ≥ thr` **antes** de transpor/decodificar 8400×56; NMS (cv2.dnn.NMSBoxes) só se > 1 candidato; sem alocações grandes por frame (buffers reutilizados). Microbenchmark antes/depois.
- [ ] **8. `/inference/engines` honesto:** campos `available`, `reason`, `model_id`, `model_verified`, `license`, `provider_actual` (o provider realmente ativo após criar a sessão: DML/CPU), `warmup_ms`. Atualizar `schemas/inference.py` (retrocompatível).
- [ ] **9. Documentação:** `backend/models/README.md` com procedimento de obtenção/exportação (RTMPose-m/s Halpe26 → ONNX estático, `opset≥17`, `onnxsim`), tamanhos de entrada, licenças; marcar CODE_REVIEW §2.8/§5.3 `✅ Resolvido em R13`.

## 5. Critérios de aceitação
- Com modelo ausente: `GET /inference/engines` mostra `available=false` e seleção devolve 409 — **nunca** corre outro modelo com o nome trocado.
- Golden test RTMPose: erro médio < 2 px nos keypoints de referência.
- Cena de 2 pessoas: o alvo mantém-se correto em ≥ 95 % dos frames sintéticos.
- Ângulo do tornozelo com pés reais (Halpe26) disponível e `Landmark2D.estimated=False` para heel/toe.
- Microbenchmark do pós-processamento YOLO: ≥ 30 % menos tempo CPU (registar números).

## 6. Verificação
```powershell
cd backend
python scripts/fetch_models.py --verify
pytest tests -k "rtmpose or target_selector or model_zoo" -q; pytest -q
python scripts/benchmark_inference.py --engine rtmpose --frames 300
```

## 7. Riscos / Fora de âmbito
- Obtenção do ONNX RTMPose exige conversão/descarga externa: se o executor não tiver rede, **parar e perguntar**; não fabricar modelos nem hashes.
- Backends OpenVINO/ncnn, quantização → R14.

## 8. Prompt específico
```text
Executa a tarefa R13 (TASKS/REVIEW_2026/R13_MODELS_RTMPOSE_TRACKING_MANIFEST.md) seguindo o Prompt mestre.
Nunca inventes hashes SHA-256 nem pesos. Remove o fallback silencioso do RTMPose para YOLO. Implementa decode SimCC correto e testa com golden. Substitui argmax por seleção estável de alvo.
```

## 9. Evidências
_(hashes verificados, golden, benchmark antes/depois)_

## 10. Notas e Descobertas
_(vazio — incluir resposta D1 e procedência do golden)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
