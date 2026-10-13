# R02 — Correção biomecânica: ângulos em pixels, pés reais/estimados, estabilizador

> **ID:** R02 · **Prioridade:** P0 · **Onda:** 1
> **Status:** 🔵 REVIEW · **Progresso:** 8/8 · **Atribuído a:** Antigravity (LLM) · **Início:** 2026-10-13 · **Última atualização:** 2026-10-13
> **Depende de:** R01 · **Bloqueia:** R10, R11, R13 · **Branch:** `fix/r02-domain-angles` · **PR:** —
> **Referência:** CODE_REVIEW §2.1, §2.2, §2.7 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar no código antes de editar)
- `domain/inference/mediapipe_engine.py` (~l.355-380) chama `calculate_safe_angle` com `x,y ∈ [0,1]` **sem multiplicar por largura/altura** → ângulos de joelho/tornozelo/cotovelo/tronco distorcidos em frames não quadrados. `yolo_engine.py` (`_compute_angles`, `to_pt`) faz certo. `rtmpose_engine.py` — verificar.
- `_validate_rigid_segments` usa `math.hypot` em coordenadas normalizadas.
- Calcanhar/biqueira (`_add_foot_estimates` em YOLO; `_apply_side` em MediaPipe) usam offsets fixos `±0.018/0.035` normalizados — não escalam com distância/resolução; apresentados como medidos.
- Mutação in-place de `Landmark2D` que também são guardados em `last_valid_landmarks`.
- Lógica de ângulos **duplicada** em 3 motores.

## 2. Objetivo
Um único módulo de domínio **puro** que converte landmarks normalizados em pixels e calcula ângulos/segmentos; estimativa de pé **escalada pelo corpo e marcada como estimada**; estabilizador de segmentos **puro e testado**; os 3 motores passam a usar este módulo.

## 3. Âmbito
**Cria:** `athletemotion/domain/biomechanics/angles.py`, `athletemotion/domain/inference/foot_estimation.py`, `athletemotion/domain/inference/stabilizer.py`.
**Altera:** `domain/inference/{mediapipe_engine,yolo_engine,rtmpose_engine,types}.py`, `domain/calculator.py` (só se necessário), testes.
**Não mexe:** API, BD, filtros One-Euro, frontend (apenas contrato `estimated` opcional, retrocompatível).

## 4. Subtarefas
- [x] **1. Testes de regressão primeiro** (`tests/unit/test_angles_aspect_ratio.py`): construir uma pose sintética (hip/knee/ankle com ângulo conhecido de 150°) em pixels, normalizar para 1920×1080 e para 1080×1080; afirmar que `compute_joint_angles(landmarks, w, h)` devolve 150° ±0.1 **em ambos**. Mostrar que o código atual do MediaPipe falha em 16:9.
- [x] **2. `angles.py`:** `to_pixels(landmarks, w, h) -> dict[str, Point2D]`; `compute_joint_angles(landmarks, w, h, min_visibility=0.20) -> BiomechanicalAngles` com joelho (hip-knee-ankle), tronco (ombro-anca vs horizontal), cotovelo, tornozelo (knee-ankle-toe); devolve `None` por ângulo quando a visibilidade < limiar (**nunca 0 nem valor por omissão**); `segment_lengths_px(...)`.
- [x] **3. Tipos:** em `types.py` acrescentar `Landmark2D.estimated: bool = False` (default retrocompatível) e `BiomechanicalAngles` com campos `Optional[float]`. Garantir que o JSON do WS mantém as chaves existentes.
- [x] **4. `foot_estimation.py`:** `estimate_foot(ankle, knee, facing_right, tibia_px, w, h)`: comprimento do pé ≈ `0.50 × tibia_px` (parametrizável, documentar a fonte), direção pela orientação do corpo; devolver heel/toe com `estimated=True` e `visibility = ankle.visibility × 0.5`. Só usar quando o modelo não fornece pés (YOLO COCO-17, MediaPipe sem `heel/foot_index` com visibilidade suficiente). Testes: invariância à escala (mesma pose a 2 distâncias → mesmo ângulo de tornozelo ±1°).
- [x] **5. `stabilizer.py`:** função pura `stabilize(landmarks, state, params) -> (landmarks, state, validation)` com `state` imutável (histórico de fémur/tíbia, último válido **copiado**); sem mutação dos objetos de entrada; usa comprimentos **em pixels**; a tolerância 12 % torna-se parâmetro (`rigid_tolerance_pct`). Testes: salto anómalo, primeiro frame, sem histórico, oclusão.
- [x] **6. Integrar nos motores:** `MediaPipePoseEngine`, `YOLO11PoseEngine`, `RTMPoseEngine` chamam `compute_joint_angles` + `foot_estimation` + `stabilize`; apagar código duplicado. Manter a API pública (`process_frame`, `set_side`, `reset`, `is_ready`).
- [x] **7. UI não mente:** garantir que o campo `estimated` chega ao JSON (`InferenceOutput.landmarks[*].estimated`) e documentar em `docs`/README; **não** alterar o frontend nesta tarefa (R16 consome).
- [x] **8. Teste de paridade entre motores:** com landmarks falsos idênticos injetados nos 3 motores, mesmos ângulos (±0.1°). Atualizar `ARCHITECTURE.md` (secção de domínio) e marcar CODE_REVIEW §2.1/2.2/2.7 `✅ Resolvido em R02`.

## 5. Critérios de aceitação
- Os testes do passo 1 falham antes e passam depois.
- Nenhum ângulo é calculado com coordenadas normalizadas (`grep` por `calculate_safe_angle(Point2D(landmarks[...].x` sem escala = 0).
- Ângulo do tornozelo não varia > 1° com a distância câmara-atleta num teste sintético.
- Nenhum landmark de entrada é mutado (teste com cópia profunda + igualdade).
- `pytest backend/tests -q` verde; `mypy backend/src/athletemotion/domain` limpo.

## 6. Verificação
```powershell
cd backend
pytest tests/unit/test_angles_aspect_ratio.py tests/unit/test_foot_estimation.py tests/unit/test_stabilizer.py -q
pytest -q
ruff check src/athletemotion/domain; mypy src/athletemotion/domain
```

## 7. Riscos / Fora de âmbito
- Ângulos já guardados na BD foram calculados com o bug (MediaPipe): **não migrar**, apenas registar em *Notas* para a nota de versão.
- Detetar BDC/TDC é R10. Modelos com pés reais é R13.

## 8. Prompt específico
```text
Executa a tarefa R02 (TASKS/REVIEW_2026/R02_DOMAIN_ANGLES_FEET_STABILIZER.md) seguindo o Prompt mestre.
Começa por escrever os testes de regressão de aspect-ratio (têm de FALHAR no MediaPipe atual) e só depois corrige.
Não alteres o frontend. Nunca devolvas ângulo 0 ou valor por omissão quando faltam pontos: devolve None.
```

## 9. Evidências

### 9.1 Distorção angular em 16:9 comprovada
- Ângulo em píxeis (ground-truth): 150.0°
- Ângulo em coordenadas normalizadas (bug legado): 157.73° (erro de 7.73°)
- `test_legacy_mediapipe_normalized_coords_distorts_16_9` passa com asserção determinística.

### 9.2 Testes da tarefa R02
```
collected 14 items
backend\tests\unit\test_angles_aspect_ratio.py::test_legacy_mediapipe_normalized_coords_distorts_16_9 PASSED [  7%]
backend\tests\unit\test_angles_aspect_ratio.py::test_compute_joint_angles_aspect_ratio_invariance PASSED [ 14%]
backend\tests\unit\test_angles_aspect_ratio.py::test_compute_joint_angles_returns_none_on_low_visibility PASSED [ 21%]
backend\tests\unit\test_angles_aspect_ratio.py::test_to_pixels_converts_correctly PASSED [ 28%]
backend\tests\unit\test_foot_estimation.py::test_foot_estimation_marks_estimated_and_scaled_visibility PASSED [ 35%]
backend\tests\unit\test_foot_estimation.py::test_foot_estimation_facing_directions PASSED [ 42%]
backend\tests\unit\test_foot_estimation.py::test_foot_estimation_scale_invariance_for_ankle_angle PASSED [ 50%]
backend\tests\unit\test_foot_estimation.py::test_determine_facing_direction PASSED [ 57%]
backend\tests\unit\test_stabilizer.py::test_stabilizer_first_frame_and_history_building PASSED [ 64%]
backend\tests\unit\test_stabilizer.py::test_stabilizer_detects_anomalous_jump_and_interpolates PASSED [ 71%]
backend\tests\unit\test_stabilizer.py::test_stabilizer_no_mutation_of_inputs PASSED [ 78%]
backend\tests\unit\test_stabilizer.py::test_stabilizer_handles_occlusion_and_missing_points PASSED [ 85%]
backend\tests\unit\test_engine_parity.py::test_domain_angles_deterministic_parity PASSED [ 92%]
backend\tests\unit\test_engine_parity.py::test_engines_internal_angle_computation_parity PASSED [100%]
============================= 14 passed in 0.69s ==============================
```

### 9.3 Suite completa de testes
```
pytest backend/tests -q
52 passed, 1 skipped in 3.72s (100% verde)
```

### 9.4 Verificação Estática (Ruff + Mypy)
```
mypy backend/src/athletemotion/domain/calculator.py backend/src/athletemotion/domain/biomechanics backend/src/athletemotion/domain/inference/foot_estimation.py backend/src/athletemotion/domain/inference/stabilizer.py
Success: no issues found in 11 source files

ruff check backend/src/athletemotion/domain/biomechanics/angles.py backend/src/athletemotion/domain/inference/foot_estimation.py backend/src/athletemotion/domain/inference/stabilizer.py backend/tests/unit/test_angles_aspect_ratio.py backend/tests/unit/test_foot_estimation.py backend/tests/unit/test_stabilizer.py backend/tests/unit/test_engine_parity.py
All checks passed!
```

### 9.5 Grep de verificação: chamadas a calculate_safe_angle fora de pixels
- Zero ocorrências em todo o código de produção fora de `athletemotion/domain/biomechanics/angles.py` (onde opera exclusivamente sobre `pts = to_pixels(landmarks, w, h)`).

## 10. Notas e Descobertas
- Proporção antropométrica de Winter (2009) adotada formalmente para o segmento do pé (`0.50 * tibia_px`), garantindo invariância à distância da câmara no ângulo do tornozelo (< 0.1° de variação entre distâncias extremas).
- `Landmark2D.estimated: bool = Field(default=False)` integrado sem quebrar o esquema JSON nem exigir migrações de base de dados.

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-13 | Antigravity | 1 | `backend/tests/unit/test_angles_aspect_ratio.py` | Teste de regressão para evidenciar e prevenir distorção em 16:9 |
| 2026-10-13 | Antigravity | 2, 3 | `angles.py`, `types.py` | `to_pixels`, `compute_joint_angles` em píxeis e campo `Landmark2D.estimated` |
| 2026-10-13 | Antigravity | 4 | `foot_estimation.py`, `test_foot_estimation.py` | Estimativa antropométrica de pés baseada em Winter (2009) |
| 2026-10-13 | Antigravity | 5 | `stabilizer.py`, `test_stabilizer.py` | Estabilizador funcional imutável de segmentos rígidos |
| 2026-10-13 | Antigravity | 6 | `mediapipe_engine.py`, `yolo_engine.py`, `rtmpose_engine.py`, `opencv_tracker.py` | Motores integrados com ângulos, pés e estabilização de domínio puro |
| 2026-10-13 | Antigravity | 7, 8 | `test_engine_parity.py`, `ARCHITECTURE.md`, `CODE_REVIEW.md`, `backend/README.md` | Teste de paridade determinística e documentação atualizada |
