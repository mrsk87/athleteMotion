# AUDITORIA SÉNIOR DA DOCUMENTAÇÃO vs. CÓDIGO REAL

> **Data:** 13 de Outubro de 2026
> **Âmbito:** todos os `.md` do projeto (`README.md`, `ARCHITECTURE.md`, `STANDARDS.md`, `CONTRIBUTING.md`, `STATUS.md`, `REFACTOR_PLAN.md`, `TASKS/*.md`, `frontend/mediapipe/README.md`)
> **Método:** leitura integral dos documentos + execução das verificações que os próprios documentos exigem (`npm run verify`, `npm run lint`, `npm run build`, `pytest`), com inspeção do código-fonte citado.
> **Regra aplicada:** nada aqui é "opinião de estilo" — cada linha tem um comando ou um ficheiro:linha por trás.

---

## 1. Veredito em três linhas

1. A documentação **descreve uma arquitetura que existe de facto em código** (motores Strategy, DirectML, WebSocket, Pinia, ECharts, workbench) — mas com **números desatualizados, links mortos e duas verificações oficiais em vermelho**.
2. A "Regra de Ouro" do repositório (atualizar `STATUS.md` a cada alteração) está **quebrada para todo o subsistema novo de inferência** — que continua **por commitar**.
3. O backend **não arranca em ambientes sem `onnxruntime`/`mediapipe`** (o import de inferência está no caminho crítico de `server.py`), e o `pyproject.toml` usado pelo `uv run` documentado **não contém as dependências de inferência**.

---

## 2. Evidência executada (estado real, hoje)

| Comando | Resultado real | O que a documentação afirma |
| :--- | :--- | :--- |
| `npm run verify` | **exit 1** — falha em `verify:theme` (3 verificações) e a cadeia `&&` nem chega a `help/aero/estimates/convergence/equipment/positions/profiles/chroma` | `ROADMAP_MESTRE §6.3`: "12 suites, 0 erros"; `REFACTOR_PLAN §Fatia 1`: "12 suites completas aprovadas" |
| `verify:coherence … verify:chroma` (individualmente) | 11/12 verdes; **1093 asserções PASS** no total | `STATUS.md`: 688 (cabeçalho) vs 1054 / 1030 / 981 / 894 / 859 (changelog); `ROADMAP`: playback 54 e full-analysis 91 |
| `npm run lint -- --no-fix` | **0 erros** ✅ | Confere (REFACTOR_PLAN §1) |
| `npm run build` | **OK** (30,7 s, `dist/` gerado) ✅ | Confere |
| `pytest tests -q` | **ImportError** — `No module named 'onnxruntime'` (nenhum teste corre) | `STATUS.md`: "20/20 testes aprovados"; `ROADMAP §6.3`: "26 testes" |
| Funções de teste existentes (`grep -c "^def test_"`) | **27** | 20 (STATUS) ou 26 (ROADMAP) — ambos errados |
| Dependências no `.venv` local | `onnxruntime` ❌, `mediapipe` ❌, `scipy` ❌ (presentes: `cv2 5.0.0`, `numpy 2.5.4`, `fastapi 0.143.0`) | `TASK_01` dá como concluído ("[SUCESSO] DirectML detetado") |

**Contagem por suite (medida):** coherence 26 · playback 162 · full-analysis 215 · theme 68 (3 FAIL) · help 65 · aero 79 · estimates 74 · convergence 46 · equipment 104 · positions 136 · profiles 47 · chroma 71.

### 2.1 As 3 falhas reais de `verify:theme`

| Verificação | Causa medida | Natureza |
| :--- | :--- | :--- |
| "nenhuma cor fixa em 17 ficheiros CSS de componentes" | [VideoScrubberBar.css:9-14](frontend/mediapipe/src/components/LiveCameraCapture/components/VideoScrubberBar/VideoScrubberBar.css#L9-L14) usa *fallbacks* hex (`var(--accent-hover, #0284c7)`, `rgba(…)`) | **Regressão da Fatia 1** da refatoração — viola a regra do tema declarada em `STATUS.md`/`verify:theme` |
| "a etiqueta de corpo incompleto ocupa a sua própria linha" | [camera-hud.css:156](frontend/mediapipe/src/components/LiveCameraCapture/styles/camera-hud.css#L156) e [camera-hud.css:321](frontend/mediapipe/src/components/LiveCameraCapture/styles/camera-hud.css#L321) perderam o `flex: 1 1 100%` | **Regressão funcional real** (a lista longa volta a espremer a faixa do HUD) |
| "o HUD vive dentro do vídeo" | O HUD passou a ser `camera-hud-container` **fora** de `.video-canvas-container` ([LiveCameraCapture.html:567](frontend/mediapipe/src/components/LiveCameraCapture/LiveCameraCapture.html#L567) vs [:674](frontend/mediapipe/src/components/LiveCameraCapture/LiveCameraCapture.html#L674)); `.camera-hud-overlay` ficou CSS morto ([camera-hud.css:48](frontend/mediapipe/src/components/LiveCameraCapture/styles/camera-hud.css#L48)) | **Asserção desatualizada** face à decisão de produto (HUD em 4 posições + pílula de restauro) |

> Consequência de engenharia: como o `npm run verify` é encadeado com `&&`, **o vermelho esconde a saúde das 8 suites seguintes**. Um CI que confie nesta cadeia fica cego.

---

## 3. Matriz de rastreabilidade: o que está escrito → o que existe

### 3.1 `TASKS/TASK_01…TASK_05` (backend)

| Requisito escrito | Estado verificado | Evidência |
| :--- | :--- | :--- |
| `requirements.txt` com DirectML/MediaPipe/scipy/websockets | 🟢 Existe, **com desvios**: sem `<2.0.0` no numpy, `opencv>=4.8` em vez de `4.9.0.80`, `onnx>=1.16` acrescentado | [requirements.txt](requirements.txt) |
| `src/infrastructure/hardware.py` | 🟢 Existe (`HardwareManager`, intra=8/inter=2, DmlExecutionProvider) | [hardware.py](src/infrastructure/hardware.py) |
| `scripts/verify_directml_hardware.py` | 🟢 Existe — **não executável aqui** (sem `onnxruntime`) | [verify_directml_hardware.py](scripts/verify_directml_hardware.py) |
| `scripts/download_models.py` (TASK_01 §2.4) | 🔴 **Não existe** | `ls scripts/` |
| `src/domain/inference/{types,base,mediapipe_engine}` | 🟢 Existem; MediaPipe com `model_complexity=2`, validação rígida ±12%, reset por lado | [mediapipe_engine.py](src/domain/inference/mediapipe_engine.py) |
| `tests/unit/test_mediapipe_engine.py` | 🟢 Existe (instanciação, lado, rigidez >12%) | [test_mediapipe_engine.py](tests/unit/test_mediapipe_engine.py) |
| TASK_03: `onnx_utils`, `yolo_engine`, `rtmpose_engine`, `export_yolo_onnx.py`, `models/yolo11n-pose.onnx` | 🟢 Todos existem (ONNX 11,8 MB); **`models/rtmpose-m.onnx` não existe** → motor RTMPose responde sempre em fallback vazio | `ls models/` |
| TASK_04: `filters.py` (One-Euro) + `opencv_tracker.py` | 🟢 Existem | [filters.py](src/domain/inference/filters.py) |
| TASK_04 critério 1: `tests/unit/test_one_euro_filter.py` | 🔴 **Não existe** — a formulação matemática do One-Euro **não tem um único teste** | `ls tests/unit/` |
| TASK_04 critério 2: teste de marcadores HSV | 🔴 **Não existe** | `ls tests/` |
| TASK_05: `schemas/inference.py`, `api/v1/inference.py`, `api/v1/inference_ws.py`, `router.py`, `server.py` | 🟢 Todos existem e montados; WS com *producer-consumer* + `latest_frame` + `asyncio.Event` real | [inference_ws.py](src/api/v1/inference_ws.py) |
| TASK_05 §3: 4 motores | 🟡 A API anuncia **5** (`yolo11_pose_cpu` a mais) e o `smoothing`/`use_directml`/`rigid_segment_check` do protocolo não têm efeito | [inference.py:48](src/api/v1/inference.py#L48) |

### 3.2 `TASKS/TASK_06…TASK_09` + `REFACTOR_PLAN` (frontend)

| Requisito escrito | Estado verificado | Evidência |
| :--- | :--- | :--- |
| `video/VideoPlayerVLC.vue`, `TimelineScrubberAB.vue`, `composables/useVideoPlayback.js` | 🟢 Existem (720 / 206 / 125 linhas) | `wc -l` |
| `video/BiomechanicalOverlayCanvas.vue`, `composables/useFootOrbitTrail.js` | 🟢 Existem (313 / 76 linhas) | `wc -l` |
| TASK_07 §2.3 `composables/useSkeletonRenderer.js` | 🔴 **Não existe** (desenho de ossos inlined no `.vue`) | `ls src/composables` |
| `telemetry/TelemetrySyncChart.vue` com ECharts e faixa 145–155° + cursor | 🟢 Existe; `echarts ^5.6.0` instalado e a correr (`echarts.init`) | [TelemetrySyncChart.vue](frontend/mediapipe/src/components/telemetry/TelemetrySyncChart.vue) |
| TASK_08 §2 `npm install echarts vue-echarts` | 🟡 `vue-echarts` **não instalado** (uso direto da API `echarts` — aceitável, mas desvia do spec) | `package.json` |
| TASK_08 §2.3 `composables/useCadenceAndDiagnostics.js` | 🔴 **Não existe** (cadência/BDC calculados dentro do `.vue`) | `ls src/composables` |
| `telemetry/BiomechanicalStatsDashboard.vue` | 🟢 Existe (185 linhas) | `wc -l` |
| TASK_09: Pinia instalada + `main.js` com `createPinia()` + `stores/inferenceStore.js` | 🟢 Feito (213 linhas), com `setUint32(0, ts, false)` = big-endian, coerente com o `struct.unpack(">I")` do backend | [main.js](frontend/mediapipe/src/main.js), [inferenceStore.js](frontend/mediapipe/src/stores/inferenceStore.js) |
| TASK_09 Etapa 3: integração na vista principal | 🟢 Feito via `BiomechanicalWorkbench.vue` ligado a [HomeView.html:92](frontend/mediapipe/src/views/HomeView.html#L92) | `grep` |
| TASK_09 Etapa 4 / REFACTOR_PLAN §3: monólito desmontado (≤200–250 linhas/ficheiro) | 🔴 **Não iniciado — e a crescer**: `LiveCameraCapture.js` **4050** linhas (doc diz 3354 → depois 3533), `.html` **2063** (doc dizia 1951), `video-analysis.css` **3802** (doc dizia 3113) | `wc -l` |
| REFACTOR_PLAN Fatias 2–10 | 🔴 Nenhuma iniciada (só a Fatia 1, que é a que quebrou `verify:theme`) | árvore de `src/` |

### 3.3 `ROADMAP_MESTRE §5` (Definição de Pronto) e §6 (checkpoints)

| Critério de aceitação global | Estado | Evidência |
| :--- | :--- | :--- |
| §5.4 "A faixa BDC 145–155° sinalizada no momento exato … sem falsos disparos" | 🔴 **Não implementado**: `is_bdc=False` e `clock_position="N/A"` **hardcoded**; o WS nunca preenche `pedal_phase`; `InferenceOutput` não tem `frame_idx`, `pedal_phase` nem `occlusion_suppressed` | [mediapipe_engine.py:208](src/domain/inference/mediapipe_engine.py#L208), [types.py](src/domain/inference/types.py) |
| §4.1 protocolo REST (`use_directml`, `rigid_segment_check`) | 🔴 Ausente do schema; `smoothing` é aceite e **ignorado** (o WS aplica sempre um One-Euro global fixo `1.2/0.05`) | [schemas/inference.py:26](src/schemas/inference.py#L26), [inference_ws.py](src/api/v1/inference_ws.py) |
| §4.2 telemetria (formato do pacote) | 🟡 Coerente em `[4B timestamp][JPEG]` e big-endian; mas o texto do roadmap diz "µs" e o código usa ms; o JSON prometido tem campos que o motor não produz | `inference_ws.py`, `inferenceStore.js` |
| §6.1/§6.2 checkpoints marcados `[x]` | 🟢 Os **comportamentos** existem (seletor de lado 3 vias, playhead A-B, dedupe de frames, 480p @ JPEG 0.58, botão de limpar gráfico, controlo de tamanho do palco) | `BiomechanicalWorkbench.vue`, `BiomechanicalOverlayCanvas.vue` |
| §6.3 "26 testes aprovados" | 🔴 Inverificável aqui (deps ausentes) e desalinhado com o próprio repo (27 funções; STATUS diz 20) | `pytest`, `grep` |

---

## 4. Defeitos por severidade (com causa, não sintoma)

### P0 — bloqueadores

1. **Import de inferência no caminho crítico derruba a API inteira.**
   `server.py` → `inference_ws` → `domain/inference/__init__` → `yolo_engine` → `import onnxruntime` (nível de módulo), e `mediapipe_engine` → `import mediapipe`.
   Sem GPU ORT/MediaPipe, perdem-se também atletas, bicicletas, sessões, PDF — funcionalidades que nada têm a ver com IA. Reproduzido: `pytest tests -q` → ImportError.
   **Correção:** import tardio + registo condicional (só regista o motor cuja dependência importa) + `/engines` a reportar `available: false`.
2. **Duas fontes de verdade para dependências Python.** O fluxo documentado (`uv run`, `STATUS.md`) resolve por [pyproject.toml](pyproject.toml), que **não** tem `onnxruntime-directml`, `mediapipe`, `scipy`, `websockets` nem `onnx`. Instalar por `requirements.txt` e correr por `uv run` são ambientes diferentes.
3. **`npm run verify` vermelho** (3 falhas em `verify:theme`) — e a cadeia `&&` mascara o resto. Ver §2.1.
4. **Regra de Ouro violada:** nenhum registo em `STATUS.md` para hardware/inference engines/WS/workbench/Pinia/ECharts; o último changelog corresponde ao último commit (`fa3116e`), enquanto **todo** o subsistema novo está por commitar (`??`/` M` no `git status`).

### P1 — qualidade e defeitos latentes

5. **RTMPose anunciado mas inoperante:** `models/rtmpose-m.onnx` ausente → resposta vazia silenciosa; a UI oferece o motor como se funcionasse.
6. **`smoothing` aceite e ignorado** (a promessa "one_euro | kalman | none" é decorativa).
7. **Fase do pedalar (12h/3h/6h/9h) não chega ao backend** — o frontend tem toda a lógica (`crankPhaseTracker.js`), o contrato do backend anuncia `pedal_phase`, e o campo fica sempre no valor por omissão.
8. **YOLO `best_det` sem limiar de confiança:** apanha sempre a "melhor" deteção, mesmo com score ~0 → telemetria inventada em frames sem ciclista.
9. **Testes ausentes para o One-Euro e para o OpenCV tracker** (TASK_04 critérios 1 e 2) — a matemática mais sensível do backend não tem rede de segurança.

### P2 — documentação

10. **Links mortos:** `README.md` e `CONTRIBUTING.md` apontam para `CODE_REVIEW.md` (**apagado**) e o README publicita `IMPLEMENTATION_PROMPTS/` (**6 ficheiros apagados**).
11. **Versões contraditórias:** `README` diz `0.1.0`, `ARCHITECTURE` diz "Versão Arquitetural `0.2.0`", `VERSION`/`pyproject`/`package.json` dizem `0.3.0`.
12. **`ARCHITECTURE.md` desatualizado por inteiro:** descreve o backend como "MediaPipe WebAssembly + OpenCV", caminhos `src/components/LiveCameraCapture.vue` (hoje pastas), e **não menciona** Strategy engines, DirectML, WebSocket, Pinia, ECharts, workbench — a maior mudança arquitetural do último mês está fora do documento de arquitetura.
13. **Números de asserções divergentes entre documentos** (688 / 859 / 894 / 981 / 1030 / 1054 vs. 1093 medidos agora) — e `profiles`/`chroma` usam formato `✔` (não contam no `grep PASS`), o que explica parte da confusão histórica.
14. `frontend/mediapipe/README.md` continua o boilerplate do Vue CLI (sem referência a `npm run verify`, motores ou workbench).
15. **`STATUS.md` tem o changelog duplicado:** há **duas secções `### [Unreleased] - 2026-10-11` idênticas** (linhas 110 e 142), com os blocos `FIX-67`/`FIX-68`/`FEAT-63` repetidos palavra por palavra (`grep -c FIX-67` → 4 ocorrências para 2 correções). O changelog deixa de servir de histórico fiável. — ✅ **Resolvido a 2026-10-13** (ver §9).
16. **12 referências a `IMPLEMENTATION_PROMPTS/`** no `STATUS.md` (docs 07 a 14) apontam para ficheiros apagados — a rastreabilidade "requisito → implementação" morreu com a pasta. — 🟡 **Por decidir** (ver §9).
17. **Portas contraditórias:** `README.md` manda servir o frontend em `:8080`, `STATUS.md §2` declara `:8081` (e ainda `192.168.31.127:8081`).

---

## 5. Preenchimento obrigatório da "REGRA DE OURO"

`STATUS.md` precisa, no mínimo:

- **Secção 4 (matriz de componentes):** linhas para *Gestor de Hardware DirectML*, *Strategy Registry + 5 motores*, *Filtro One-Euro*, *WebSocket `/ws/live-inference`*, *Workbench Biomecânico*, *Pinia `inferenceStore`*, *Gráfico ECharts*, *Dashboard estatístico*.
- **Secção 5 (changelog):** entradas para `FEAT-*` do pipeline de inferência (com a prova medida: 3,33 ms/frame, 480p JPEG 0.58, `isAwaitingInference`).
- **Cabeçalho:** substituir "20/20 Testes Pytest" e "688 asserções" pelos valores que passarem a ser verdadeiros após fechar o P0.

---

## 6. O que falta implementar (lista fechada)

**Backend**
1. `scripts/download_models.py` (TASK_01 §2.4).
2. `tests/unit/test_one_euro_filter.py` (redução de desvio-padrão > 70% sem atraso de fase) e teste dos marcadores HSV (TASK_04).
3. Import tardio das dependências de IA + registo condicional de motores (P0 §1).
4. `pyproject.toml` alinhado com `requirements.txt` (fonte única de verdade).
5. Fase do pedalar no backend: `frame_idx`, `pedal_phase.clock_position`, `is_bdc`/`is_tdc` reais (ROADMAP DoD §5.4).
6. `smoothing` funcional (`one_euro` | `none`; `kalman` se for para cumprir o protocolo) e `use_directml`/`rigid_segment_check` no schema.
7. Limiar de confiança no `best_det` do YOLO; `models/rtmpose-m.onnx` ou remover o motor da lista enquanto não existir.

**Frontend**
8. `composables/useSkeletonRenderer.js` (TASK_07 §2.3) e `composables/useCadenceAndDiagnostics.js` (TASK_08 §2.3).
9. Fechar as 3 falhas de `verify:theme` (§2.1) — duas são correções reais, uma exige decidir se a asserção do HUD é reescrita.
10. REFACTOR_PLAN Fatias 2–10 (o alvo "≤250 linhas/ficheiro" está a **afastar-se**: `LiveCameraCapture.js` cresceu para 4050 linhas).
11. i18n: há strings novas do workbench hardcoded no `.vue` (o `STANDARDS.md §4.2` proíbe texto visível fora do i18n) — auditar `BiomechanicalWorkbench.vue`, `TelemetrySyncChart.vue`, `BiomechanicalStatsDashboard.vue`.

**Governança**
12. Commitar o subsistema novo (hoje 100% por commitar) e registá-lo em `STATUS.md` no mesmo passo.
13. Corrigir `README.md`/`CONTRIBUTING.md` (links apagados, versão), deduplicar as duas secções `[Unreleased]` do `STATUS.md` e reescrever `ARCHITECTURE.md` com a camada de inferência (Strategy/DirectML/WebSocket/Pinia/ECharts).
14. Decidir o destino de `IMPLEMENTATION_PROMPTS/`: ou a pasta volta (é citada 12 vezes no `STATUS.md`), ou as 12 referências passam a apontar para `TASKS/`.

---

## 7. Ordem recomendada (fatias atómicas, no espírito ACID do `REFACTOR_PLAN`)

| # | Fatia | Verificação de saída |
| :-: | :--- | :--- |
| 1 | Import tardio + registo condicional de motores | `pytest tests` corre em ambiente sem DirectML; `/engines` marca `available:false` |
| 2 | `pyproject.toml` ↔ `requirements.txt` alinhados | `uv run python -c "import server"` sem erros |
| 3 | Repor `verify:theme` verde (2 correções + 1 asserção) | `npm run verify` exit 0 |
| 4 | Testes One-Euro + marcadores HSV | `pytest tests/unit/test_one_euro_filter.py` verde |
| 5 | Fase do pedalar no backend | telemetria com `clock_position` ≠ "N/A" e `is_bdc` a alternar |
| 6 | `download_models.py` + flag de disponibilidade do RTMPose | script corre; motor indisponível não é oferecido |
| 7 | Testes de contrato do workbench (i18n + tema) | `npm run verify` verde e sem strings hardcoded |
| 8 | Commit + entrada em `STATUS.md` | Regra de Ouro cumprida |

---

## 8. Limites desta auditoria (declarados, não escondidos)

_(ver §9 para o que já foi corrigido depois desta data)_

- **Não foi possível executar o backend**: `onnxruntime`, `mediapipe` e `scipy` não estão instalados neste ambiente, e `onnxruntime-directml` não é instalável fora do Windows com GPU. Por isso as contagens de `pytest` foram verificadas **por inspeção** (27 funções) e não por execução — o P0 §1 está, no entanto, **reproduzido** (ImportError).
- **Não foi feita verificação no browser** (DirectML 3,33 ms, 35–40 FPS, 480p JPEG 0.58): são afirmações do `ROADMAP §6.2`/`STATUS.md` que exigem a máquina com a RX 580; ficam **não verificadas** aqui, não "falsas".
- As contagens de `npm run verify` são de hoje e mudam com o working tree (todo o subsistema novo está por commitar).

---

## 9. Registo das correções posteriores (2026-10-13)

O que foi fechado no mesmo dia, no `STATUS.md` (Regra de Ouro):

| Achado desta auditoria | Estado | Prova |
| :--- | :---: | :--- |
| §4.15 changelog duplicado (duas secções `[Unreleased]` iguais) e §4.16 artefacto de ferramenta dentro do texto | ✅ Corrigido | 6 entradas + 1 cabeçalho duplicados removidos depois de provada a igualdade bloco a bloco; o parágrafo único do `FEAT-59` antigo foi preservado; `grep` de artefactos = 0; ficheiro passou de 360 → 309 linhas (com o registo novo: **334**) |
| §4.10/§4.11 números e versões contraditórios | 🟡 Parcial | cabeçalho passou a mostrar **1093 asserções medidas** (com `verify:theme` em vermelho) e o estado **bloqueado** do `pytest`; `README.md`/`ARCHITECTURE.md` ainda por corrigir |
| §4.13 nenhum registo do subsistema novo | ✅ Corrigido | nova secção **`### [Unreleased] - 2026-10-13`** com `FIX-69` (registo + inventário medido) e `FEAT-69` a `FEAT-71` (inferência, WebSocket, frontend modular, scripts de verificação) |
| §4 (matriz) componentes novos ausentes | ✅ Corrigido | **12 linhas novas** na tabela da secção 4 (motor Strategy, hardware DirectML, WebSocket, One-Euro, workbench, leitor VLC, overlay/órbita, ECharts, dashboard, Pinia, 12 suites, auditoria) — tabela validada sem linhas malformadas |
| §4.1, §4.2, §4.4, §4.5, §4.6, §4.7, §5, §6 | 🔴 Aberto | os vermelhos de `verify:theme`, o import de inferência no caminho crítico, a divergência `pyproject.toml` ↔ `requirements.txt`, a fase do pedalar no backend, os testes em falta e as Fatias 2–10 do `REFACTOR_PLAN` continuam por fazer |

**Nada foi commitado** — o registo descreve o working tree tal como está; a decisão de o levar a `main` é do utilizador.
