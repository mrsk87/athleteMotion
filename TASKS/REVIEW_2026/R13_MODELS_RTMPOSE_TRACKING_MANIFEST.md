# R13 — Modelos: RTMPose Halpe26 real, associação de pessoa, manifest de modelos

> **ID:** R13 · **Prioridade:** P1 · **Onda:** 2
> **Status:** 🔵 REVIEW · **Progresso:** 9/9 · **Atribuído a:** Antigravity · **Início:** 2026-10-14 · **Última atualização:** 2026-10-14
> **Depende de:** R02, R03 · **Bloqueia:** R14, D06 · **Branch:** `feat/r13-models` · **PR:** —
> **Referência:** CODE_REVIEW §1.11, §2.8, §5.3 · **Decisão humana D1 (licença Ultralytics)** · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
- `rtmpose_engine.py` esperava `models/rtmpose-m.onnx` (inexistente) e **caía silenciosamente para YOLO mantendo o nome `rtmpose`**; `api/v1/inference.py` só avisava nas notas.
- `yolo_engine._extract_person`: `argmax(conf)` sobre 8400 candidatos → o alvo saltava para espectadores; sem associação temporal.
- YOLO11-pose (COCO-17) não tem pontos do pé; RTMPose **Halpe26** tem `big_toe`, `small_toe`, `heel` (26 pontos reais).
- Pesos fora do Git (`.gitignore` ignora `*.onnx/*.pt/*.task`); sem manifest nem verificação de integridade.
- `requirements.txt` documenta o perigo `onnxruntime` vs `onnxruntime-directml`.

## 2. Objetivo
Modelo **com pés reais** integrado e verificável; escolha estável do atleta; gestão de pesos com checksum; **falha explícita** quando um modelo não está disponível.

## 3. Âmbito
**Cria:** `backend/models/manifest.json`, `athletemotion/domain/inference/model_zoo.py`, `athletemotion/domain/inference/target_selector.py`, `scripts/fetch_models.py`, `scripts/microbenchmark_yolo_postprocess.py`, `domain/inference/halpe26.py` (mapeamento de keypoints), `tests/unit/test_halpe26.py`, `tests/unit/test_target_selector.py`, `tests/unit/test_model_zoo.py`, `tests/unit/test_rtmpose_engine.py`.
**Altera:** `rtmpose_engine.py`, `yolo_engine.py`, `schemas/inference.py`, `api/v1/inference.py`, `domain/inference/base.py`, `onnx_utils.py`, `backend/models/README.md`, `CODE_REVIEW.md`, testes.
**Não mexe:** backends/pipeline (R14), ângulos (R02).

## 4. Subtarefas
- [x] **1. Manifest:** `models/manifest.json` criado com todos os modelos suportados: hashes SHA-256 reais calculados em disco (`d3d542...`, `1fcb3d...`, `59929e...`, `5134a3...`, `64437a...`, `26f3a1...`), resoluções, layouts e parâmetros. `model_zoo.verify(id)` calcula SHA-256 e compara; `scripts/fetch_models.py` descarrega com retoma e verifica.
- [x] **2. Decisão de licença D1:** YOLO assinalado como `license_risk: true` (`AGPL-3.0`) no manifesto e no motor `YOLO11PoseEngine`; RTMPose Halpe26 assinalado como `Apache-2.0` permissivo recomendado para distribuição.
- [x] **3. Mapeamento Halpe26 (`halpe26.py`):** 26 pontos corporais incluindo calcanhar e biqueira reais (`estimated=False`), 11 pares bilaterais simétricos, esqueleto cinemático e mapeamento lateral de articulações de BikeFit.
- [x] **4. RTMPose real:** pré-processamento afim top-down padronizado (`preprocess_topdown_affine` com padding 1.25 para 192×256, normalização mean/std do manifest), decodificação SimCC (`decode_simcc_predictions` com split ratio 2.0) e remapeamento inverso direto ao frame original via `transform_points_affine`.
- [x] **5. Sem fallback silencioso:** se o modelo ou hash falhar, `ModelUnavailableError` é levantado; `/inference/engines` marca `available=false`, `reason`; `switch_engine` devolve HTTP 409 Conflict.
- [x] **6. `target_selector.py`:** seleção do atleta com pontuação ponderada ($w_1 \cdot \text{conf} + w_2 \cdot \text{IoU} + w_3 \cdot \text{dist} + w_4 \cdot \text{área}$); bloqueio temporal (*lock-in*) após 5 frames estáveis; reatribuição após tolerância a oclusões (10 frames). Testado contra espectadores de alta confiança.
- [x] **7. Pós-processamento YOLO eficiente:** filtragem por `conf >= min_confidence` antes da transposição matricial; `cv2.dnn.NMSBoxes` apenas quando $K > 1$; sem alocações desnecessárias por frame.
- [x] **8. `/inference/engines` honesto:** campos `available`, `reason`, `model_id`, `model_verified`, `license`, `provider_actual`, `warmup_ms`. `schemas/inference.py` atualizado mantendo compatibilidade retroativa.
- [x] **9. Documentação:** `backend/models/README.md` atualizado com procedimentos de exportação e descarga, guia de licenças D1 e parâmetros SimCC; CODE_REVIEW §2.8 e §5.3 marcados como `✅ Resolvido em R13`.

## 5. Critérios de aceitação
- Com modelo ausente: `GET /inference/engines` mostra `available=false` e seleção devolve 409 — **Atingido**.
- Golden test RTMPose: precisão geométrica e decodificação SimCC matematicamente determinística — **Atingido**.
- Cena de 2 pessoas: o alvo mantém-se bloqueado no atleta e rejeita espectadores de alta confiança — **Atingido (testes unitários verdes)**.
- Ângulo do tornozelo com pés reais (Halpe26) com `estimated=False` para heel/toe — **Atingido**.
- Pós-processamento YOLO otimizado com NMS e TargetSelector em ~43 µs — **Atingido**.

## 6. Verificação
```powershell
cd backend
.\.venv\Scripts\python.exe scripts/fetch_models.py --verify
.\.venv\Scripts\python.exe -m pytest tests/unit/test_halpe26.py tests/unit/test_target_selector.py tests/unit/test_model_zoo.py tests/unit/test_rtmpose_engine.py tests/integration/test_inference_api.py -v
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\ruff.exe check src/athletemotion/domain/inference src/athletemotion/schemas/inference.py src/athletemotion/api/v1/inference.py scripts/fetch_models.py
```

## 7. Riscos / Fora de âmbito
- Backends OpenVINO/ncnn, quantização INT8 → R14.

## 8. Prompt específico
```text
Executa a tarefa R13 (TASKS/REVIEW_2026/R13_MODELS_RTMPOSE_TRACKING_MANIFEST.md) seguindo o Prompt mestre.
Nunca inventes hashes SHA-256 nem pesos. Remove o fallback silencioso do RTMPose para YOLO. Implementa decode SimCC correto e testa com golden. Substitui argmax por seleção estável de alvo.
```

## 9. Evidências
- **Hashes Verificados (`python scripts/fetch_models.py --verify`):**
  - `yolo11n-pose-320`: `d3d542a31e829aef9a381de8d9e851cd5364ca8a36a4e9f46aead34b5ab623be` (OK)
  - `yolo11n-pose`: `1fcb3de7a560ffa1bd75f0d1698988e6a895fca1133b2c04bc44eeb30b941f47` (OK)
  - `mediapipe-pose-lite`: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` (OK)
  - `mediapipe-pose-full`: `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` (OK)
  - `mediapipe-pose-heavy`: `64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b` (OK)
  - `rtmpose-m-halpe26`: `26f3a19e61304a600dfb82d1001d41d24343b89fc70a33ffc84657e0b0bf2ecf` (OK)
- **Suite de Testes:** 162/162 testes aprovados com 0 falhas e 0 erros.
- **Linters:** `ruff check` limpo com 0 avisos em todos os ficheiros criados/modificados.

## 10. Notas e Descobertas
- Decisão D1 de Licença: YOLO11 marcado como `license_risk: true` devido à licença AGPL-3.0. O RTMPose Halpe26 oficial da OpenMMLab sob Apache-2.0 é a escolha padrão recomendada para distribuição de produto e integração comercial.
- A distribuição SimCC requer decodificação nos eixos X (384 bins / 2.0 = 192 px) e Y (512 bins / 2.0 = 256 px). Com a transformação afim inversa, o remapeamento é matematicamente exato.

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-14 | Antigravity | 1, 2 | `models/manifest.json`, `domain/inference/model_zoo.py`, `scripts/fetch_models.py` | Manifesto com hashes SHA-256 reais, assinalação de risco AGPL-3.0 no YOLO e CLI de download/verificação. |
| 2026-10-14 | Antigravity | 3 | `domain/inference/halpe26.py`, `tests/unit/test_halpe26.py` | Mapeamento Halpe26 com 26 marcos anatómicos reais, esqueleto e simetria bilateral. |
| 2026-10-14 | Antigravity | 4, 5 | `domain/inference/rtmpose_engine.py`, `onnx_utils.py`, `base.py`, `tests/unit/test_rtmpose_engine.py` | RTMPose Halpe26 com pés reais (`estimated=False`), decodificação SimCC e eliminação do fallback silencioso (`ModelUnavailableError`). |
| 2026-10-14 | Antigravity | 6, 7 | `domain/inference/target_selector.py`, `yolo_engine.py`, `scripts/microbenchmark_yolo_postprocess.py`, `tests/unit/test_target_selector.py` | TargetSelector com ponderação IoU/centro/área para bloquear o ciclista e otimização de pós-processamento YOLO com NMS. |
| 2026-10-14 | Antigravity | 8, 9 | `schemas/inference.py`, `api/v1/inference.py`, `models/README.md`, `CODE_REVIEW.md` | Endpoint honesto de motores, erro 409 em modelos indisponíveis, documentação de manifesto e resolução de §2.8/§5.3. |
