# Athlete Motion Desktop — Plano de Implementação (Python + PyQt6)

> **Status:** 🟡 EM CURSO (0/16 concluídas, 2 em REVIEW) · **Última atualização:** 2026-10-13 · **Hardware de referência:** Xeon E5-1660 v3 (8C/16T, AVX2) + RX 580 8 GB
> **Tarefas para LLMs:** [`TASKS/STATUS_BOARD.md`](TASKS/STATUS_BOARD.md) · **Protocolo:** [`TASKS/00_PROTOCOLO_LLM.md`](TASKS/00_PROTOCOLO_LLM.md) · **Pré-requisitos do backend:** [`../TASKS/REVIEW_2026/STATUS_BOARD.md`](../TASKS/REVIEW_2026/STATUS_BOARD.md)
> **Regra:** quem conclui ou altera uma tarefa atualiza este cabeçalho e a tabela abaixo (§12 → coluna *Tarefas*).

| Fase (§12) | Tarefas | Estado |
|---|---|---|
| 0 Preparação | D01, D14 | 🔴 |
| 1 Runtime mínimo | D03, D04, D07 | 🔴 |
| 2 Pipeline paralelo | D05 | 🔴 |
| 3 Modelo com pés | D06 (+R13) | 🔴 |
| 4 Autotune e backends | D02 (🔵 REVIEW · 7/7), D12 (+R14) | 🟡 |
| 5 Bikefit completo | D08, D09, D11 (+R10–R12, R17) | 🔴 |
| 6 Persistência e sync | D10 (+R06–R08) | 🔴 |
| 7 Robustez e release | D13, D15 | 🔴 |
| 8 Extras | D16 | 🔴 |

> Objetivo: aplicação **desktop nativa Windows** que extrai o **máximo desempenho do PC físico** (AMD Radeon RX 580 + Intel Xeon AVX2) para correr YOLO, RTMPose e outros modelos em tempo real, sem o custo do browser, de JPEG sobre WebSocket e do event loop do FastAPI.
> Pasta: `desktopapp/` (irmã de `frontend/` e `backend/`). Ver estrutura de repositório em [`../CODE_REVIEW.md`](../CODE_REVIEW.md) §6.
> Pré-requisito: ler `CODE_REVIEW.md` — as correções **P0** do domínio (aspect-ratio, pés, BDC) devem estar feitas **antes** de o desktop as herdar.

---

## 1. Objetivos e não-objetivos

**Objetivos**
1. Latência câmara→ecrã **< 40 ms** (meta; a medir) a 30–60 FPS, sem quebras de *frame pacing*.
2. Usar **GPU e CPU em simultâneo** (pipeline em estágios), com seleção automática do melhor backend por máquina.
3. Funcionar **offline** (modelos locais, SQLite local) e **sincronizar opcionalmente** com o backend.
4. Reutilizar **100% do domínio** do backend (ângulos, thresholds, diagnósticos, PDF) — zero duplicação.
5. Análise de vídeo gravado (batch) e ao vivo (câmara USB/UVC).

**Não-objetivos (v1)**: multi-utilizador/cloud, mobile, 3D completo, treino de modelos.

**Dados:** sem chaves API → nenhum serviço pago. LLM apenas **opcional e local** (ver §10).

---

## 2. Stack tecnológica

| Camada | Escolha | Porquê |
|---|---|---|
| UI | **PyQt6** (Qt 6.7+) | Nativo, `QOpenGLWidget`/`QRhi`, sinais thread-safe. |
| Gráficos de séries | **pyqtgraph** | Muito mais rápido que matplotlib em tempo real. |
| Vídeo/câmara | **OpenCV** (`CAP_DSHOW`/`CAP_MSMF`, MJPG) ; alternativa `QtMultimedia`; **PyAV** para ficheiros | Controlo de FOURCC/FPS/buffer. |
| Inferência GPU | **ONNX Runtime DirectML** (`onnxruntime-directml`) | Funciona em Polaris. |
| Inferência CPU | **OpenVINO** (+ ORT CPU como fallback) | Melhor desempenho em Xeon. |
| Opcional GPU | **ncnn + Vulkan** | Frequentemente mais rápido em RX 580 para CNN pequenas; avaliar. |
| Pose | **RTMPose-m Halpe26** via `rtmlib` ; detetor **YOLO11n/s-pose**; MediaPipe (CPU) opcional | Pés reais (calcanhar/hálux). |
| Tracking/filtros | OneEuro + Kalman (domínio) | Já existe `filters.py`. |
| Persistência | SQLite (SQLAlchemy 2) + Alembic, partilha dos modelos do backend | |
| Relatórios | `reportlab` (do backend) + `QPdfWriter` para pré-visualização | |
| Empacotamento | **PyInstaller** (onedir) ou **Nuitka** + **Inno Setup** | |
| Testes | `pytest`, `pytest-qt`, `pytest-benchmark` | |
| Qualidade | `ruff`, `mypy`, `pre-commit` | |

Python **3.11** ou **3.12** (compatibilidade ORT/OpenVINO/PyQt6). Gerir com `uv`.

> ⚠ `onnxruntime` e `onnxruntime-directml` **não podem coexistir** no mesmo venv (o normal substitui o DML). O instalador/`pyproject` deve fixar apenas `onnxruntime-directml`, tal como já avisa `requirements.txt`. OpenVINO instala-se em paralelo sem conflito (usa o próprio runtime).

---

## 3. Estrutura de pastas

```
desktopapp/
├─ README_PLAN.md                 # este ficheiro
├─ pyproject.toml                 # deps: athletemotion (editável do backend), PyQt6, pyqtgraph, ...
├─ src/athletemotion_desktop/
│  ├─ __main__.py                 # entry point: python -m athletemotion_desktop
│  ├─ app.py                      # QApplication, tema, i18n, logging, crash handler
│  ├─ config/                     # settings (pydantic-settings), paths (%APPDATA%), hardware_profile.json
│  ├─ runtime/                    # ★ motor de tempo real (sem Qt)
│  │  ├─ pipeline.py              # orquestra estágios e filas
│  │  ├─ capture.py               # CaptureWorker (câmara/ficheiro)
│  │  ├─ preprocess.py            # letterbox, ROI, blobFromImage
│  │  ├─ inference_worker.py      # processo(s) de inferência
│  │  ├─ postprocess.py           # decode keypoints, NMS, tracking
│  │  ├─ ring_buffer.py           # memória partilhada (multiprocessing.shared_memory)
│  │  ├─ backends/
│  │  │  ├─ base.py               # Protocol InferenceBackend
│  │  │  ├─ ort_directml.py
│  │  │  ├─ ort_cpu.py
│  │  │  ├─ openvino_cpu.py
│  │  │  └─ ncnn_vulkan.py        # opcional
│  │  ├─ models/                  # model zoo: registry + manifest (SHA-256) + downloader
│  │  ├─ autotune.py              # benchmark no 1.º arranque → hardware_profile.json
│  │  └─ metrics.py               # latência por estágio, FPS, p50/p95
│  ├─ domain_bridge/              # adaptadores para `athletemotion.domain` (BDC, ângulos, diagnósticos)
│  ├─ services/
│  │  ├─ session_service.py       # ciclo de vida da sessão (usa UoW do backend)
│  │  ├─ calibration_service.py   # ArUco / pedivela / lente
│  │  ├─ report_service.py        # PDF/CSV/JSON
│  │  └─ sync_service.py          # opcional: REST para o backend (fila persistente)
│  ├─ ui/
│  │  ├─ main_window.py
│  │  ├─ views/                   # onboarding, live, video_analysis, report, settings, benchmark
│  │  ├─ widgets/                 # video_canvas.py (QOpenGLWidget), angle_hud.py, plots.py
│  │  ├─ viewmodels/              # estado/sinais por vista (MVVM leve)
│  │  ├─ theme/                   # QSS + paleta dark
│  │  └─ i18n/                    # .ts/.qm (pt, en)
│  └─ resources/                  # ícones, qrc
├─ tests/
│  ├─ unit/ ; integration/ ; ui/ (pytest-qt) ; perf/ (pytest-benchmark)
├─ scripts/
│  ├─ benchmark.py ; export_models.py ; build_exe.py ; make_installer.iss
└─ packaging/                     # spec PyInstaller, ícone, metadados do instalador
```

**Regra de dependências:** `ui → services → runtime/domain_bridge → athletemotion.domain`. O módulo `runtime/` **não importa Qt**; comunica por filas/memória partilhada, para ser testável sem UI e reutilizável por CLI.

**Domínio partilhado:** o backend torna-se pacote instalável (`athletemotion`, ver CODE_REVIEW §6); o desktop faz `pip install -e ../backend` (ou dependência por caminho em `pyproject`). Proibido copiar `calculator.py`, `biomechanics/`, `inference/` para o desktop.

---

## 4. Arquitetura de tempo real (o coração do desempenho)

### 4.1 Processos e threads

```
 ┌───────────────┐   shm ring    ┌───────────────────┐   shm    ┌──────────────────────┐   Qt signal   ┌───────────┐
 │ Capture thread│ ─────────────►│ Preprocess (CPU)  │ ────────►│ Inference PROCESS    │ ─────────────►│  UI (Qt)  │
 │ cv2/DSHOW MJPG│  frames BGR   │ ROI + letterbox   │ tensors  │ DML/OpenVINO/NCNN    │  keypoints    │ OpenGL    │
 └───────────────┘               └───────────────────┘          │ detector(N) + pose   │               └─────▲─────┘
                                                                └──────────┬───────────┘                     │
                                                                           ▼                                 │
                                                                ┌──────────────────────┐                     │
                                                                │ Post + Biomech (CPU) │ ───── métricas ─────┘
                                                                │ decode, track, BDC   │
                                                                └──────────────────────┘
```

Princípios:
1. **Processo de inferência separado** (`multiprocessing`, `spawn`) → sem GIL, e um crash do driver DML não derruba a UI. Comunicação por **`multiprocessing.shared_memory`** (frame em ring buffer de 3–4 slots, *zero-copy*), metadados por `Pipe`/`Queue` pequenas.
2. **Fila de tamanho 1 com descarte do mais antigo** (*latest-frame-wins*) entre captura→inferência: nunca acumula latência. A UI mostra sempre o último resultado; o desfasagem resultado↔imagem corrige-se com *timestamps* (desenhar o esqueleto sobre o frame que o gerou, ou extrapolar com Kalman).
3. **Double-buffering GPU/CPU**: enquanto a GPU infere o frame *N*, a CPU pré-processa *N+1* e pós-processa *N−1*.
4. **Uma sessão ORT/DML por modelo e por thread** (DML não suporta `Run()` concorrente na mesma sessão — documentado em `hardware.py`). Detetor e pose podem ficar em sessões distintas, serializadas por *lock* ou em *threads* dedicadas.
5. **Detetor intermitente**: o detetor de pessoa corre a cada *N* frames (adaptativo); entre eles, **ROI previsto** (Kalman/optical flow) → o modelo de pose vê um recorte pequeno (mais preciso e mais barato). Reaproveitar `PersonTracker`.
6. **Renderização**: `QOpenGLWidget` com textura atualizada (`glTexSubImage2D`), esqueleto/HUD por `QPainter` sobre GL ou shader. Evitar `QImage→QPixmap` por frame em CPU.
7. **Prioridades/afinidade**: no Windows, `SetPriorityClass` (ABOVE_NORMAL) no processo de inferência; *pinning* de threads aos núcleos físicos (`psutil.Process().cpu_affinity()`), considerar **NUMA** em Xeon multi-socket.

### 4.2 Orçamento de latência (alvo a 60 FPS = 16.6 ms/frame; **a validar com benchmark**)

| Estágio | Orçamento | Notas |
|---|---|---|
| Captura (MJPG decode) | ≤ 3 ms | `CAP_PROP_BUFFERSIZE=1`, FOURCC MJPG, 720p60 ou 1080p30 |
| Pré-processamento | ≤ 2 ms | ROI+letterbox, `cv2.dnn.blobFromImage`, thread própria |
| Inferência pose (GPU) | ≤ 8 ms | Depende do modelo/resolução → autotune |
| Detetor (1 em N frames) | amortizado ≤ 1 ms | |
| Pós-processo + BDC + filtros | ≤ 1.5 ms | NumPy vetorizado; sem Pydantic no *hot path* |
| Render UI | ≤ 3 ms | GL |

Os valores são **metas**, não resultados. O ecrã *Benchmark* (§7) mede e mostra o real em cada máquina.

### 4.3 Camada de backends (`InferenceBackend`)

```python
class InferenceBackend(Protocol):
    name: str
    def load(self, model_path: Path, input_shape: tuple[int, ...], *, device: str) -> None: ...
    def warmup(self, runs: int = 3) -> float: ...
    def infer(self, tensor: np.ndarray) -> list[np.ndarray]: ...   # sem alocações novas (IOBinding / buffers fixos)
    def close(self) -> None: ...
```

- **OrtDirectML**: `DmlExecutionProvider` com `device_id` escolhido pelo autotune; `enable_mem_pattern=False`, `ORT_SEQUENTIAL`; **IOBinding** com tensores pré-alocados; guardar grafo otimizado (`optimized_model_filepath`) para reduzir *warmup*.
- **OpenVINO**: `ov.compile_model(..., "CPU")` com `PERFORMANCE_HINT=LATENCY`, `INFERENCE_NUM_THREADS=núcleos_físicos`, INT8 via **NNCF** (PTQ) calibrado com frames reais de bikefit. Opcional: `GPU` se existir iGPU Intel.
- **OrtCPU**: `intra_op = núcleos físicos`, `inter_op = 1` (já em `hardware.py`).
- **NcnnVulkan** (spike): converter ONNX→ncnn (`pnnx`), comparar com DML em RX 580.
- O `HardwareManager` atual do backend é reutilizado/extendido, não duplicado.

### 4.4 Autotune (1.º arranque e sob pedido)
1. Detetar hardware: GPUs (DXGI/`wmi`/`dxdiag` parse), VRAM, CPU (`py-cpuinfo`: AVX2/AVX-512/VNNI), núcleos físicos/lógicos, NUMA.
2. Para cada combinação *(modelo × backend × resolução)* correr N frames sintéticos + N frames reais de uma amostra incluída → **p50/p95 de latência, FPS, uso de VRAM/CPU**.
3. Escolher o perfil: *Tempo real* (p95 < budget), *Precisão* (maior modelo dentro de 30 FPS), *Batch* (máximo *throughput*).
4. Gravar `hardware_profile.json` (versionado por driver/ORT) e re-executar se mudar o driver/GPU.
5. Mostrar no ecrã de configurações com gráfico e permitir *override* manual.

---

## 5. Modelos (model zoo)

| ID | Função | Modelo | Resolução | Backends alvo | Notas |
|---|---|---|---|---|---|
| `det_yolo11n` | Deteção de pessoa | YOLO11n(-pose) | 320/416 | DML, OV | Corre a cada N frames |
| `pose_yolo11n_320` | Pose rápida (COCO-17) | YOLO11n-pose | 320 | DML, OV | Já existe no repo; sem pés |
| `pose_yolo11s` | Pose precisa (COCO-17) | YOLO11s-pose | 416/640 | DML | A medir |
| `pose_rtmpose_m_halpe26` | **Pose com pés** | RTMPose-m Halpe26 | 256×192 | DML, OV | **Modelo principal do bikefit** |
| `pose_rtmpose_s_halpe26` | Versão leve | RTMPose-s Halpe26 | 256×192 | DML, OV, CPU INT8 | Para CPU/portáteis |
| `pose_mediapipe_heavy` | Alternativa CPU | MediaPipe heavy | — | CPU | Sem GPU no Windows |
| `pose_vitpose_s/b` | Alta precisão (offline) | ViTPose | 256×192 | DML | Análise offline |
| `seg_bike` (futuro) | Selim/guiador/roda | YOLO-seg/keypoints | — | DML | Medidas automáticas |

Gestão:
- `models/manifest.json` com **URL, SHA-256, licença, tamanho, input shape, formato**; *downloader* com retoma e verificação; nada de pesos no Git.
- Exportação reprodutível (`scripts/export_models.py`): ONNX **estático** (batch=1), `opset ≥ 17`, `onnxsim`; versões FP32 e INT8 (calibração).
- **Falha explícita** se um modelo selecionado não existir (nunca *fallback* silencioso com nome trocado — ver CODE_REVIEW §5.3).
- Verificação de **licenças** (Ultralytics é AGPL-3.0: avaliar implicações para distribuição comercial; RTMPose/MMPose = Apache-2.0).

---

## 6. Domínio e funcionalidades bikefit no desktop

Reutilizar do pacote `athletemotion` (após correções P0):
- `domain.calculator`, `domain.biomechanics.*` (thresholds, fitting, posture, alignment, symmetry, diagnostics).
- **Novo no domínio partilhado** (usado também pelo backend/web):
  - `cycle_detector.py`: deteção de ciclos, BDC/TDC, cadência, métricas por ciclo (ver CODE_REVIEW §4.1).
  - `calibration.py`: pixel↔mm (ArUco/pedivela/roda), correção de lente, *roll* da câmara.
  - `quality.py`: confiança por medida, gating, ciclos descartados.
  - `kalman_skeleton.py`: filtro com restrição de comprimento de segmentos.

UI (vistas):
1. **Onboarding do atleta** (+ consentimento RGPD, dados antropométricos, bicicleta).
2. **Calibração guiada** (enquadramento, marcador, perpendicularidade, lente).
3. **Live**: vídeo + esqueleto + HUD de ângulos + curvas por ciclo + indicadores BDC/TDC + qualidade do sinal + cadência.
4. **Análise de vídeo** gravado: *scrubber*, câmara lenta, A/B, comparação antes/depois, exportar clipes anotados (usar `PyAV`/`ffmpeg` com **encoder por hardware** — AMF no RX 580 — para exportação rápida).
5. **Relatório**: PDF/CSV/JSON, gráficos por ciclo, imagens-chave, rastreabilidade (modelo, versão, calibração).
6. **Benchmark & Diagnóstico**: autotune, latências por estágio, FPS, VRAM, temperatura (se disponível), logs.
7. **Definições**: backend/modelo, câmara (resolução/FPS/exposição fixa), idioma, tema, sincronização.

Câmara: **exposição e ganho manuais** (evita *auto-exposure flicker* e desfoque), FPS fixo, MJPG; verificar que `CAP_PROP_*` são aceites e registar o que a câmara realmente entregou.

---

## 7. Observabilidade e robustez

- `metrics.py`: histogramas por estágio (captura, pré, infer, pós, render), FPS efetivo, *drops*; painel *overlay* ativável (F12).
- Logging estruturado (JSON) rotativo em `%APPDATA%/AthleteMotion/logs`; **crash handler** (`sys.excepthook` + `faulthandler`), relatório de erro local.
- **Watchdog**: se o processo de inferência não responde em X ms → reinicia o backend e cai para CPU com aviso na UI.
- Recuperação de câmara desligada (USB) com *reconnect*.
- Limites de memória: ring buffers de tamanho fixo; sem crescimento de listas durante sessões longas (gravar séries em *chunks* para SQLite/Parquet).
- Privacidade por omissão: **não gravar vídeo** sem opção explícita; dados em `%APPDATA%`; opção de cifrar a BD.

---

## 8. Integração com o backend (modo híbrido)

- O desktop funciona **sozinho**. Sincronização opcional: `sync_service` com fila persistente (tabela *outbox*), **retry/backoff**, idempotência (`Idempotency-Key`), autenticação por token (ver CODE_REVIEW §1.1).
- API de sync mínima: `POST /sync/sessions` (upload de sessão consolidada: ciclos, médias, thumbnails), `GET /sync/athletes`.
- Conflitos: *last-writer-wins* por `updated_at` com `device_id`; nunca apagar remotamente sem confirmação.
- O desktop também pode expor (opcional) **API local** em `127.0.0.1` para a UI web conectar-se ao motor desktop (substitui o WS FastAPI com JPEG) — fase tardia.

---

## 9. Qualidade, testes e CI

- **Unit**: pré/pós-processamento (comparar com *golden outputs*), decode SimCC/YOLO, cycle detector (sinais sintéticos senoidais com ruído), calibração.
- **Regressão numérica**: mesma pose em 16:9 e 1:1 devolve os **mesmos ângulos** (CODE_REVIEW §2.1).
- **Integração**: pipeline com vídeo de teste → resultados determinísticos (tolerâncias).
- **UI**: `pytest-qt` (headless com `QT_QPA_PLATFORM=offscreen`).
- **Performance**: `pytest-benchmark` com limites (p95) em runner Windows; **falha o CI** se regredir > X%.
- **Concorrência**: testes de *shutdown* limpo, *backpressure*, perda de câmara, reinício do processo de inferência.
- CI: `windows-latest` (DirectML funciona em CPU/WARP para testes funcionais), `ruff`, `mypy --strict` em `runtime/`, cobertura mínima, `pip-audit`.

---

## 10. LLM local opcional (sem chaves de API)

- `llama.cpp` (Vulkan) ou `Ollama` como **processo externo opcional**; modelo 3–8B quantizado Q4 (ex. Qwen2.5/Llama 3.x) para **reformular** o parecer; os números vêm sempre do domínio (template + valores validados).
- Executar **apenas fora da sessão ao vivo** (a GPU pertence ao pipeline de visão); prioridade baixa; *timeout* e *fallback* para o texto determinístico.
- Desligado por omissão; a app funciona 100% sem ele.

---

## 11. Empacotamento e distribuição

1. **PyInstaller onedir** (arranque rápido) com *hooks* para `onnxruntime`, `openvino`, `cv2`, PyQt6 plugins (`platforms`, `imageformats`, `multimedia`).
2. Modelos **fora do executável** (download no 1.º arranque com verificação SHA-256, ou instalador "offline" que os inclui).
3. **Inno Setup** → `AthleteMotionSetup.exe`; instalação por utilizador (sem admin), dados em `%APPDATA%`.
4. Assinatura de código (certificado) e *SmartScreen*; *auto-update* simples (verificar versão + download assinado) — fase tardia.
5. Compatibilidade: Windows 10 22H2/11; DirectX 12 + driver AMD Adrenalin atual; fallback CPU se não houver DX12.
6. Versão: partilhar o `VERSION` do monorepo (SemVer) e incluir no relatório.

---

## 12. Roadmap por fases

| Fase | Duração (est.) | Entregas | Critério de saída |
|---|---|---|---|
| **0 — Preparação** 🔵 | 1 sem | Estrutura de pastas ✅, `pyproject` do desktop ✅, `ruff/mypy` ✅, i18n PT/EN ✅, logging/crash/ACID locais ✅, testes (43) ✅ · backend como pacote `athletemotion` 🟡 (R01 em curso, pacote já importável), CI Windows ⏸️ (D14) | `python -m athletemotion_desktop` abre janela em 812–1014 ms (< 2 s) e fecha limpa ✅; testes correm no CI ⏸️ |
| **1 — Runtime mínimo** | 2 sem | Captura + pré + `OrtDirectML` + YOLO11n-pose 320 + overlay GL simples; métricas por estágio | 30 FPS estáveis, latência medida, sem fugas de memória em 30 min |
| **2 — Pipeline paralelo** | 2 sem | Processo de inferência + shared memory + latest-frame-wins + double buffering + watchdog | Latência p95 reduzida vs. fase 1; UI nunca bloqueia |
| **3 — Modelo com pés** | 2 sem | RTMPose Halpe26 + detetor intermitente + ROI tracking + model zoo/manifest | Ângulo de tornozelo com pés reais; falha explícita sem modelo |
| **4 — Autotune e backends** | 2 sem | OpenVINO CPU (FP32→INT8), seleção automática, ecrã Benchmark | `hardware_profile.json` gerado; INT8 com erro angular dentro da tolerância |
| **5 — Bikefit completo** | 3 sem | Cycle detector (BDC/TDC), calibração, qualidade, vistas Live/Vídeo/Relatório/Onboarding, PDF | Sessão completa ponta-a-ponta com relatório rastreável |
| **6 — Persistência e sync** | 1–2 sem | SQLite + Alembic, RGPD (exportar/apagar), `sync_service` opcional | Operação offline total; sync idempotente |
| **7 — Robustez e release** | 2 sem | Crash handler, reconnect câmara, testes de longa duração, PyInstaller + Inno, validação com ground-truth | Instalador testado em máquina limpa |
| **8 — Extras** | contínuo | ncnn/Vulkan, ViTPose offline, LLM local, seg. de bicicleta, API local para a web | Por prioridade |

---

## 13. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| DirectML em Polaris instável/lento com certos operadores | Alto | Autotune + fallback OpenVINO/CPU; spike de ncnn/Vulkan na Fase 4 |
| Sem ganho de FP16/INT8 na RX 580 | Médio | Não depender de quantização na GPU; INT8 só no CPU |
| Conflito `onnxruntime` vs `onnxruntime-directml` | Médio | Dependência única no `pyproject`; teste de importação no CI e no instalador |
| Qualidade das câmeras USB (auto-exposição, compressão) | Alto | Controlo manual de exposição; guia de montagem; aviso de qualidade |
| Licença AGPL do Ultralytics | Alto (se comercial) | Rever; alternativa RTMDet/RTMPose (Apache-2.0) ou licença comercial |
| Complexidade multiprocessing + shared memory no Windows (`spawn`) | Médio | Isolar em `runtime/`, testes de ciclo de vida, `freeze_support()` |
| Erro dos modelos sem validação | Alto | Ground-truth com marcadores; reportar incerteza; gating por confiança |
| Domínio duplicado web/desktop | Médio | Pacote `athletemotion` único; frontend só visual |

---

## 14. Definition of Done (por funcionalidade)
- [ ] Testes (unit + integração) e regressão numérica.
- [ ] Métricas de latência (p50/p95) registadas antes/depois.
- [ ] `ruff` + `mypy` limpos; sem `except Exception` silencioso.
- [ ] Sem fugas de memória/handles em sessão de 30+ min.
- [ ] Documentado (ADR curto) e traduzido (pt/en).

---

## 15. Primeiros passos concretos (checklist da Fase 0)
1. 🟡 Criar `backend/` com `git mv` (ver CODE_REVIEW §6) e transformar `src/` em pacote `athletemotion` — **R01 em 🟡 IN_PROGRESS** (executada em paralelo por Antigravity em 2026-10-13): `backend/src/athletemotion` já existe e importa a partir do desktop; falta a R01 fechar para declarar `athletemotion @ file:../backend` no `pyproject.toml` do desktop.
2. 🔵 `desktopapp/pyproject.toml` com dependências: `PyQt6`, `pyqtgraph`, `numpy`, `opencv-python`, `psutil`, `py-cpuinfo`, `pydantic-settings` (+ extras `directml`, `openvino` e `dev`) — falta `onnxruntime-directml`/`openvino`/`rtmlib`/`athletemotion`, que entram em D05/D06.
3. ✅ `uv venv --python 3.11 && uv pip install -e .[dev]` (executado; o `-e ../backend` aguarda R01).
4. ✅ `python -m athletemotion_desktop` → janela com tema escuro, navegação, telemetria de sistema e **diagnóstico de hardware** (§4.4: GPU/VRAM, CPU/AVX2, providers ORT/OpenVINO, perfil de autotune e *override* manual) — **D02 em 🔵 REVIEW (7/7)**; falta `onnxruntime-directml` no ambiente, que só entra com a R01 fechada (a vista reporta-o como erro bloqueante com instrução de resolução).
5. Portar `scripts/benchmark_inference.py` para `desktopapp/scripts/benchmark.py` usando a interface `InferenceBackend`.
6. Abrir issues/ADRs para: formato do ring buffer, política de descarte, formato do manifest de modelos.
