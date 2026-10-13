# CODE REVIEW SÉNIOR — Athlete Motion (BikeFit)

> **Status:** 🟡 EM IMPLEMENTAÇÃO (0/18 tarefas concluídas) · **Última atualização:** 2026-10-13 · **Revisto contra o código em:** 2026-10-13
> **Plano de execução:** [`TASKS/REVIEW_2026/STATUS_BOARD.md`](TASKS/REVIEW_2026/STATUS_BOARD.md) (tarefas R01–R18) · **Protocolo para LLMs:** [`00_PROTOCOLO_LLM.md`](TASKS/REVIEW_2026/00_PROTOCOLO_LLM.md) · **Desktop:** [`desktopapp/TASKS/STATUS_BOARD.md`](desktopapp/TASKS/STATUS_BOARD.md)
> **Convenção:** quando um achado é resolvido, a tarefa marca-o aqui com `✅ Resolvido em Rxx` (ver protocolo §3.3).

| Secção do review | Tarefa(s) | Estado |
|---|---|---|
| §1.1–1.2, 1.6–1.7, 1.10 Segurança base | R04 | 🔴 |
| §1.3–1.5, 1.9 Upload/WS/GIF/validação | R05 | 🔴 |
| §1.8 RGPD | R06 | 🔴 |
| §1.11, 2.12, 2.13 Cadeia/CI/observabilidade | R15 | 🔴 |
| §2.1, 2.2, 2.7 Ângulos, pés, estabilizador | R02 | 🔴 |
| §2.3, 4.1 BDC/ciclos | R10 | 🔴 |
| §2.4, 5.6 AI Coach | R09 | 🔴 |
| §2.5, 2.6 Concorrência/lifespan | R03 | 🔴 |
| §2.8, 5.3 Modelos/tracking | R13 | 🔴 |
| §2.9 Serviço de sessões | R08 | 🔴 |
| §2.10 Base de dados | R07 | 🔴 |
| §2.11, 6 Estrutura/Documentação | R01, R18 | 🔴 |
| §3 Frontend | R16 | 🔴 |
| §4.2 Calibração | R11 | 🔴 |
| §4.3, 4.4 Medidas/qualidade | R12 | 🔴 |
| §4.6, 4.7 Relatório/validação | R17 | 🔴 |
| §5.0–5.8 Hardware/desempenho | R14 | 🔴 |

> Revisão feita sobre o código real do repositório (backend `src/`, `server.py`, motores de inferência, base de dados, CI e frontend `frontend/mediapipe/`).
> Prioridades: **P0** = corrigir já (bug de correção/segurança grave) · **P1** = próximo sprint · **P2** = planeado · **P3** = melhoria.
> Hardware de referência (de `requirements.txt` / `hardware.py`): **AMD Radeon RX 580 (Polaris) + Intel Xeon AVX2**, Windows, DirectML.

---

## 0. Resumo executivo

| Área | Estado | Comentário |
|---|---|---|
| Arquitetura (Clean/Hexagonal) | 🟢 Boa base | Domínio separado, registry de motores, UoW, `hardware.py` bem pensado. |
| Correção biomecânica | 🔴 Problemas sérios | Ângulos MediaPipe em coordenadas normalizadas, calcanhar/biqueira "inventados", média de todos os frames em vez de BDC. |
| Segurança | 🔴 Sem autenticação, CORS permissivo, DoS e dados pessoais | Ver secção 1. |
| Concorrência/Inferência | 🟠 Motor global partilhado entre clientes | Race conditions e uso concorrente de uma sessão DirectML. |
| Aproveitamento do hardware | 🟠 Parcial | Só YOLO11n em DML; CPU Xeon sem OpenVINO; sem pipeline paralelo; MediaPipe só CPU. |
| Qualidade/CI | 🟠 | CI provavelmente falha em Ubuntu (`onnxruntime-directml`), sem lint/tipos/audit. |
| Frontend | 🟠 | Componente monolítico (`LiveCameraCapture.js` > 4000 linhas), PII em `localStorage`. |

---

## 1. SEGURANÇA

### 1.1 [P0] Sem autenticação/autorização em toda a API
- Nenhum endpoint (`/api/v1/athletes`, `/sessions`, `/inference/engine/switch`, `/ws/live-inference`) exige identidade. Qualquer dispositivo na rede (o servidor liga a `0.0.0.0`, ver `server.py:138`) lê/apaga dados de atletas e **troca o motor de IA global**.
- IDs são UUID (difíceis de adivinhar) mas isso **não é controlo de acesso** (IDOR).
- **Fazer:**
  - Modo local: ligar a `127.0.0.1` por omissão; `0.0.0.0` só com flag explícita (`--lan`).
  - Autenticação: token local gerado no arranque (header `Authorization: Bearer`) ou, se for multi-utilizador, OAuth2/JWT (`fastapi.security`) com `owner_id` em `athletes` e filtro por owner em **todas** as queries.
  - Proteger `/docs` e `/openapi.json` fora de modo desenvolvimento.

### 1.2 [P0] CORS inseguro/incoerente — `server.py:47-60`
- `allow_origins=["*"]` como fallback **combinado com** `allow_credentials=True` é inválido/perigoso.
- `allow_origin_regex` aceita **qualquer** IP `192.168.x.x`/`10.x.x.x` em **qualquer** porta → qualquer página aberta na LAN pode chamar a API.
- `allow_methods=["*"]`, `allow_headers=["*"]`.
- **Fazer:** lista explícita de origens por ambiente (`.env`), métodos/headers mínimos, `allow_credentials` só se usar cookies; nunca fallback para `*`.

### 1.3 [P0] WebSocket `/ws/live-inference` sem proteção
Ficheiro `src/api/v1/inference_ws.py`:
- Sem verificação de **Origin**, sem autenticação, sem limite de ligações simultâneas.
- Sem limite de tamanho da mensagem binária (`raw_bytes`) → DoS por memória/CPU (descodificação JPEG arbitrária com `cv2.imdecode`).
- Não valida magic bytes nem dimensões máximas da imagem (decompression bomb: JPEG 30000×30000).
- Comando `set_engine` aceita `name` arbitrário do cliente e **altera o motor global** para todos os clientes (linhas 158-167).
- Erros engolidos com `logger.debug` (linhas 117, 170) — falhas invisíveis em produção.
- **Fazer:** `max_size` do WS (uvicorn `--ws-max-size`), validar Origin/token no `accept`, limitar a 1–2 sessões, validar JPEG (SOI `FFD8`) e `w*h` ≤ limite antes de decodificar, whitelist de motores (`PoseEngineRegistry.names()`), níveis de log adequados.

### 1.4 [P0] `/process_frame` lê o ficheiro inteiro antes de validar tamanho — `server.py:96-107`
- `await file.read()` carrega **tudo** para memória e só depois compara com 5 MB. O comentário do `ARCHITECTURE.md` ("blindado contra DoS") não corresponde ao código.
- **Fazer:** ler em *chunks* com contador e abortar ao ultrapassar o limite; limite também no reverse proxy (`client_max_body_size`) / Starlette middleware; validar `w*h` depois do decode; ver 1.7 (rate limit).
- Além disso o endpoint não faz inferência (só valida) — remover ou integrar com o motor, para não ser superfície morta.

### 1.5 [P1] `/video/export-gif` — `src/api/v1/video.py`
- `frames: List[str]` com até 120 base64 **sem limite de tamanho por frame/total** → centenas de MB por pedido.
- `Image.open` sem `Image.MAX_IMAGE_PIXELS` controlado → *decompression bomb*.
- `async def` com trabalho CPU pesado (LANCZOS + GIF `optimize=True`) **bloqueia o event loop** de toda a API/WS.
- `detail=f"... {str(e)}"` devolve texto de exceção interna ao cliente.
- **Fazer:** limitar tamanho total do body, `Image.MAX_IMAGE_PIXELS`, `def` síncrono (threadpool) ou `run_in_executor`/`anyio.to_thread`, mensagens de erro genéricas.

### 1.6 [P1] Fuga de detalhes internos
- `inference.py:144` → `f"Falha ao carregar motor ... {str(e)}"`; `inference.py:169` idem. Devolver ID de erro e registar o detalhe no log.
- Criar *exception handlers* globais com formato único de erro (RFC 7807 `application/problem+json`).

### 1.7 [P1] Sem rate limiting nem limites de recursos
- Adicionar `slowapi`/middleware de limitação por IP/token em endpoints de escrita, PDF, GIF e WS.
- Timeout de pedido, limite de concorrência de inferência (semáforo).

### 1.8 [P1] Dados pessoais / RGPD (atletas)
- `AthleteModel` guarda `name`, `email`, medidas corporais, em SQLite **não cifrado** (`athlete_motion.db`). O frontend guarda o perfil do atleta em `localStorage` em claro (`LiveCameraCapture.js:3534-3600`, `athleteProfiles.js`).
- Não existe endpoint de **exportação** nem **apagamento** (direito ao esquecimento) nem consentimento registado. As imagens/landmarks (`raw_landmarks_json`) são dados biométricos → dados sensíveis (RGPD art. 9).
- **Fazer:** campo de consentimento + data; `DELETE /athletes/{id}` com *hard delete* verificado (incluindo WAL); `GET /athletes/{id}/export`; política de retenção; cifrar o DB (SQLCipher) ou no mínimo cifrar `email`/`raw_landmarks_json`; não persistir vídeo/frames por omissão; mover perfis do `localStorage` para IndexedDB cifrado (WebCrypto) ou para o backend autenticado.

### 1.9 [P1] Validação de entrada
- `sessions.py`: `kops_offset`, `saddle_drop`, `cadence_rpm`, `power_watts` sem limites (`Query(..., ge=, le=)`). `lang` aceita qualquer string.
- `SnapshotCreate.raw_landmarks` sem limite de tamanho → inserção de JSON gigante em `Text`.
- Query params de PDF são "dados clínicos" entregues pelo cliente sem validação.
- `reportlab`: confirmar que nomes/recomendações passam por `xml.sax.saxutils.escape` antes de `Paragraph(...)` (o Paragraph interpreta markup).

### 1.10 [P2] Cabeçalhos e transporte
- Sem HTTPS/WSS: `inferenceStore.js:8` usa `ws://localhost:8000`. Para uso em LAN (telemóvel) é necessário TLS (mkcert/caddy) — **`getUserMedia` só funciona em contexto seguro** fora de `localhost`.
- Adicionar `SecurityHeadersMiddleware` (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy: camera=(self)`).
- Frontend: `HelpTip` usa `v-html` — hoje com SVG estático (ok), mas manter *lint rule* que proíba `v-html` com dados dinâmicos.

### 1.11 [P2] Cadeia de fornecimento
- `requirements.txt` com `>=` sem tecto; existe `uv.lock` mas CI instala de `requirements.txt` (não reprodutível). Fixar versões (ou usar `uv sync --frozen` no CI).
- Pesos de modelos (`*.onnx`, `*.task`, `*.pt`) vêm de fora do repo → adicionar `models/manifest.json` com **URL + SHA-256** e verificação no arranque (evita modelo adulterado).
- Ativar `pip-audit`, `npm audit`, Dependabot e CodeQL.
- `pytest`, `httpx`, `pytest-asyncio` estão em `requirements.txt` de produção → separar em `requirements-dev.txt`.

---

## 2. CORREÇÃO / BOAS PRÁTICAS NO BACKEND

### 2.1 [P0] Ângulos do MediaPipe calculados em coordenadas normalizadas — `mediapipe_engine.py:355-380`
`calculate_safe_angle` recebe `x,y ∈ [0,1]` **sem multiplicar por largura/altura**. Num frame 16:9 o eixo X está comprimido ~1.78× face ao Y → **todos os ângulos (joelho, cotovelo, tornozelo, tronco) ficam distorcidos**. O `yolo_engine.py` faz bem (`to_pt` multiplica por `full_w/full_h`, linha 274), o que significa que os dois motores dão números diferentes para a mesma pose.
- **Fazer:** passar `frame_w/frame_h` e converter para pixels antes de qualquer ângulo ou distância; o mesmo em `_validate_rigid_segments` (usa `math.hypot` em normalizado, a tolerância de 12% é afetada). Criar um único `compute_angles(landmarks, w, h)` no domínio e **remover a duplicação** dos três motores. Adicionar teste de regressão com frame 1920×1080 vs 1080×1080.

### 2.2 [P0] Calcanhar/biqueira "inventados" com offsets fixos — `yolo_engine.py:235-251`, `mediapipe_engine.py:287-300`
- `toe_offset_x = 0.035`, `heel_offset_x = -0.018` em unidades normalizadas **não escalam** com a distância câmara-atleta nem com a resolução → o **ângulo do tornozelo** e o **recuo do cleat** que daí saem não têm significado físico.
- YOLO11-pose (COCO-17) **não tem pontos de pé**.
- **Fazer:** usar modelos com pés (RTMPose **Halpe26 / Body8-Halpe26** ou **RTMW / Wholebody**, 133 pts) — ver secção 5; se se mantiver estimativa, escalar pela tíbia (`foot_len ≈ 0.28·altura`, `tibia_px`) e **marcar `visibility=0` e `estimated=True`** para a UI não apresentar como medido.

### 2.3 [P0] Diagnóstico por **média de todos os snapshots** — `sessions.py:116-124`
- A extensão do joelho de referência (145–155°, Holmes 25–35° de flexão) aplica-se **ao ponto morto inferior (BDC)**. A média dos snapshots só é válida se cada snapshot for no BDC. Hoje os snapshots são tirados **manualmente** (`captureSnapshot`, botão) → o resultado depende do operador; `is_bdc` nunca é calculado (`mediapipe_engine.py:389` fixa `False`; só `types.py` e o store o referem).
- **Fazer:** detetar o ciclo de pedalada automaticamente (ver 4.1), guardar **ângulo no BDC/TDC por ciclo** e reportar média ± desvio + nº de ciclos; o snapshot manual passa a ser opcional.

### 2.4 [P0] AI Coach inventa dados — `ai_coach.py:33-34`
- Se o joelho/costas não existirem, o código assume `148.0°` e `45.0°` e emite "Parabéns… perfeitamente alinhada". **Resultado clínico falso quando falta medição.**
- Pesquisa por `"joelho"/"costas"` em texto PT: quebra com `lang=en` ou renomeações.
- EN: `kops_data.get('actionPt', ...)` — chave inexistente; mensagem sem número.
- Nome "IA" engana: é um *template* determinístico. Sem chave de API (a situação atual), a opção correta é **manter regras determinísticas** (números sempre vindos do domínio), e, opcionalmente, **LLM local** (llama.cpp/Ollama, Qwen2.5-7B Q4) apenas para *reformular* texto, nunca para calcular. Ver 5.6.
- **Fazer:** devolver `None`/"dados insuficientes"; usar `joint_id` estável (enum), não rótulo traduzido; i18n com ficheiros `.po/.json` em vez de f-strings inline.

### 2.5 [P0] Estado global partilhado entre clientes — `PoseEngineRegistry.active`, `inference_ws.py`, `inference.py`
- Há **um único motor ativo global**. Dois ligações WS partilham: filtro (já por ligação ✔), mas **motor, `tracker`, `femur_history`, `last_timestamp_ms`** não. O modo `VIDEO` do MediaPipe exige timestamps estritamente crescentes por instância → dois clientes corrompem-se.
- `hardware.py:8-9` documenta que **chamadas concorrentes ao mesmo `Run()` DirectML não são suportadas**, mas `_warmup` (executor) e `inference_worker` (executor) podem correr em simultâneo sobre o mesmo motor (por ex. `warmup` + frame).
- `set_engine` por WS muda o motor global para todos.
- **Fazer:** motor **por ligação/sessão** (`EngineSession`), com `asyncio.Lock`/executor de 1 thread dedicado por motor para serializar `Run()`; pool de modelos partilhados (pesos) mas **estado separado**; remover `PoseEngineRegistry.set_active` do caminho do WS.

### 2.6 [P1] Efeitos laterais na importação — `inference.py:36-41`
Criar o motor MediaPipe (carrega 30 MB .task) ao importar o router atrasa arranque e testes e engole falhas (`except Exception`). Mover para `lifespan` do FastAPI (`app.state.engines`), com *warmup* assíncrono.

### 2.7 [P1] Segmentos rígidos mutam landmarks e estado — `mediapipe_engine.py:337-352`
- Mutação in-place (`landmarks[k].x = ...`) de objetos que também estão em `last_valid_landmarks` → o "último válido" fica contaminado.
- Quando **inválido sem histórico** não se atualiza `last_valid`, quando válido também só no `else`; a lógica do ramo `else` mistura casos. Reescrever como função pura `stabilize(landmarks, state) -> (landmarks, state)` com testes.

### 2.8 [P1] YOLO sem NMS e escolha da "pessoa de maior confiança" — `yolo_engine.py:158-165`
- `argmax(conf)` sobre 8400 candidatos: com público/outra pessoa na imagem, o alvo salta. Sem associação temporal (IoU com a caixa anterior do `PersonTracker`).
- Pós-processamento em NumPy sobre `[8400,56]` por frame; exportar o ONNX com NMS/top-k embebido ou filtrar por `conf>thr` antes da transposição.
- **Fazer:** associação por IoU + distância ao centro previsto (Kalman), escolher o alvo com *score* combinado; `min_confidence` por keypoint ≠ por pessoa.

### 2.9 [P1] Sessões/Reports duplicados e lógica na camada API — `sessions.py`
- O bloco "resolver modalidade → `evaluate_posture_angles` → construir DiagnosticItem → compliance" repete-se 4×. Extrair `SessionReportService` (camada de aplicação) e testar sem HTTP.
- `if payload.knee_angle:` (linha 88) trata `0.0` como falso; usar `is not None`.
- `complete_fit_session` não é **idempotente** nem verifica `status`: recompleta/sobrescreve uma sessão já concluída ou cancelada.
- `get_athlete_sessions` sem paginação; `FitSessionModel.started_at` etc. com `datetime` UTC *aware* gravado em SQLite como *naive* → comparações inconsistentes.
- `PostureSnapshot` por HTTP a cada amostra: usar `POST /snapshots:batch` ou gravar via WS.

### 2.10 [P1] Base de dados
- Faltam índices: `posture_snapshots(session_id)`, `fit_sessions(athlete_id, started_at)`, `bikes(athlete_id)`.
- Migrações *ad hoc* (`_ADDED_COLUMNS` em `database.py:164`) → adotar **Alembic**. `declarative_base()` legado → `DeclarativeBase` (SQLAlchemy 2.0) com `Mapped[...]`.
- `PRAGMA synchronous = NORMAL` + WAL é aceitável, mas o comentário "DURABILIDADE" é enganador (NORMAL pode perder as últimas transações num crash de energia; usar `FULL` para dados clínicos finais).
- Caminho do DB fixo na raiz do projeto: tornar configurável (`ATHLETE_DB_URL`) e, em produção/desktop, em `%APPDATA%`.
- `AthleteModel` sem `deleted_at`, `consent_at`, `owner_id`.

### 2.11 [P2] Estrutura do repositório
- Raiz com **dois ambientes virtuais** (`.venv/` e `bin/ lib64 share pyvenv.cfg`), `__pycache__/`, `.pytest_cache/`, `athlete_motion.db*` (com ~1.2 MB de WAL): limpar e excluir; manter só `.venv`.
- Entry points redundantes: `main.py`, `server.py`, `start.py`, `start.bat`, `start.ps1`. Manter **um** (`python -m athletemotion.api`).
- Documentação duplicada/volumosa (`STATUS.md` 116 KB, `AUDITORIA_DOCS_SENIOR.md`, `REFACTOR_PLAN.md`, `ARCHITECTURE.md`...). Consolidar em `docs/` com ADRs.
- `pyproject.toml` existe mas `requirements.txt` é a fonte efetiva; unificar no `pyproject.toml` (+ `uv.lock`) com extras `[dev]`, `[directml]`, `[openvino]`.

### 2.12 [P2] Observabilidade
- Logging estruturado (JSON) com `request_id`, tempo por estágio (decode / preprocess / infer / decode-kp / filter / send). Expor `/metrics` (Prometheus) com histograma de latência por motor — o `benchmark_inference.py` já é um bom ponto de partida; levar o mesmo para runtime.
- Health: `/health/ready` que verifica modelos carregados e provider ativo (hoje devolve `ok` fixo).

### 2.13 [P2] Qualidade/CI — `.github/workflows/ci.yml`
- **Job backend em `ubuntu-latest` instala `onnxruntime-directml`** (só tem wheels Windows) → falha provável. Usar `windows-latest` ou instalar `onnxruntime` CPU em CI via extra.
- Sem `ruff`, `black`/`ruff format`, `mypy/pyright`, cobertura mínima (`--cov-fail-under`), `pip-audit`, lint/test de frontend (`npm run lint`, `vitest`), `Playwright` e2e, `CodeQL`.
- Testes: só 7 ficheiros; faltam testes de WS, de concorrência, de aspect-ratio (2.1), de BDC, de limites de upload, de PDF.
- Tipagem: `from __future__ import annotations` por todo o lado mas sem verificação estática → ativar `mypy --strict` em `domain/`.

---

## 3. FRONTEND (`frontend/mediapipe`)

- **[P1] Monólito:** `LiveCameraCapture.js` > 4000 linhas (referências até à linha 4037) + `LiveCameraCapture.html` com 1800+ linhas. Dividir em *composables* (`useCamera`, `useInferenceSocket`, `useBdcDetector`, `useSessionRecorder`) e componentes; já existem `modules/`, continuar a extração.
- **[P1] Privacidade:** perfis de atleta, baseline e sessões em `localStorage`; migrar para IndexedDB (já usado em `offlineStorage.js`) com cifragem opcional.
- **[P1] Offline:** `api.recordSnapshot(...).catch(() => {})` (`LiveCameraCapture.js:2478`) engole erros; adicionar fila persistente com *retry/backoff* e indicador de estado de sincronização.
- **[P2]** `process.env.VUE_APP_*` (vue-cli) vs Vite: confirmar tooling; centralizar config (`.env.*`), `wss://` em produção.
- **[P2]** Migrar para **TypeScript** gradualmente (tipos da API gerados do OpenAPI com `openapi-typescript`); testes com `vitest` + `@vue/test-utils`.
- **[P2]** Enviar frames ao WS como **JPEG qualidade ~0.7–0.8 a resolução reduzida (ex. 640 largura)** + `createImageBitmap`/`OffscreenCanvas` em Web Worker para não bloquear o thread de UI; usar `requestVideoFrameCallback` para sincronizar com o vídeo.
- **[P3]** Acessibilidade (ARIA nos HUD/alertas, contraste) e i18n com `vue-i18n` formal (hoje `i18n.js` tem ~650 linhas de dicionário manual).

---

## 4. NOVAS FUNCIONALIDADES PARA O BIKEFIT

> **Nota:** o frontend já contém protótipos de várias destas ideias (`pedalStrokeTracker.js`, `kopsAnalyzer.js`, `spatialCalibrator.js`, `wheelCalibratorHandler.js`, `frontalPlaneAnalyzer.js`, `asymmetryCalculator.js`, `bleSensorManager.js`, `chroma/*`). O problema é que a lógica biomecânica está **duplicada em JS e Python** e não é testada em conjunto. Recomendação: mover a lógica de medição para o **domínio Python partilhado** (backend + desktop) e deixar o frontend só para visualização. O frontend só mantém o que é puramente de UI.

### 4.1 [P0→P1] Deteção automática do ciclo de pedalada (BDC/TDC)
- Sinal: trajetória vertical do **tornozelo/calcanhar** (e/ou ângulo do joelho) filtrada (One-Euro/Savitzky-Golay). Máximos/mínimos locais com *prominence*; verificar periodicidade por **autocorrelação/FFT** → cadência (RPM) sem sensor.
- Por ciclo: ângulo do joelho no **BDC** (extensão máx.), no **TDC** (flexão máx.), amplitude do tornozelo, ângulo da anca no TDC, ângulo do tronco/ombro/cotovelo médio.
- Relatório com média ± DP e nº de ciclos válidos; descarte de ciclos com visibilidade baixa.
- Preencher `is_bdc / is_tdc / clock_position` (hoje campos mortos).

### 4.2 [P0→P1] Calibração e escala
- Converter pixels em mm: marcador de referência (ex. **ArUco/AprilTag** de 100 mm colado ao quadro), ou comprimento de **pedivela** conhecido (já está em `BikeModel.crank_length_mm`) e diâmetro de roda 700c/29" (≈ 622 mm de aro) detetado por Hough/segmentação.
- Verificar **perpendicularidade da câmara**: estimar inclinação do quadro (linha do tubo horizontal da roda) e **avisar** quando |roll| ou |yaw| exceder limites; usar acelerómetro/giroscópio do telemóvel (DeviceOrientation) para correção de *roll*.
- Corrigir distorção de lente (calibração com xadrez OpenCV, guardar `camera_profile`).
- Resultado: KOPS, *setback*, *reach*, *stack*, altura do selim e *saddle drop* em **mm reais** (hoje o `kops_offset` vem como parâmetro de cliente sem calibração).

### 4.3 [P1] Medidas bikefit adicionais
- Ângulos: **anca** (tronco–fémur), **ombro** (tronco–braço), **cotovelo**, **tornozelo** (dorsiflexão) ao longo do ciclo (curva completa 0–360°), *knee-over-pedal-spindle* dinâmico.
- **Vista frontal/posterior** (câmara de frente): joelho varo/valgo (`alignment.py` já tem avaliação), *hip drop*/oscilação pélvica, *lateral sway*, largura de stance (Q-factor), assimetria L/R (`symmetry.py` existente, ligar a dados reais).
- **Vista dinâmica sob carga**: derivação de fadiga — comparar ângulos 1.º vs último minuto (drift).
- **Antes/Depois**: comparação lado-a-lado e *overlay* com sincronização por ciclo (existe `SessionComparator`; alimentar com ciclos, não snapshots).
- Recomendações com **delta em mm** (ex. "subir selim 6 mm") derivadas do modelo trigonométrico e mostrando incerteza (±).
- Perfil por modalidade já existe (Road/MTB/TT/Gravel) → acrescentar *fit goal* (conforto / performance / aero) e histórico de lesões que altera limiares.

### 4.4 [P1] Qualidade da medição
- Cada medida com **confiança** (visibilidade média dos keypoints, nº de ciclos, erro estimado) e *gating*: não mostrar valor se confiança < limiar.
- Detetar oclusão da perna próxima da câmara (perna do lado oposto cruza); aplicar o lado correto (`set_side`) automaticamente a partir da posição do ombro/nariz.
- Fusão temporal: **Kalman** por articulação com modelo de restrição de comprimento de segmento (fémur/tíbia constantes em 3D → elipse em 2D se a câmara não for perfeitamente sagital).
- Opção de **3D lifting** (MotionBERT / VideoPose3D leve) para corrigir perspetiva em vista não-perfeitamente-lateral; só se medido benefício.

### 4.5 [P2] Marcadores e equipamento
- Modo `opencv_markers` existe: melhorar com **marcadores retro-refletores + ArUco** nas articulações (trocânter, côndilo femoral lateral, maléolo lateral, 5.º metatarso) → precisão sub-grau, referência "ouro" para validar os modelos sem marcadores.
- Detetar o **selim** e o **guiador** por segmentação/keypoints de bicicleta (YOLO-seg ou keypoint custom) para medir setback/reach automaticamente.

### 4.6 [P2] Relatório e experiência
- PDF com gráficos de curvas por ciclo, imagens-chave (BDC/TDC anotadas), tabela antes/depois, assinatura/versão do modelo e parâmetros de calibração (rastreabilidade).
- Exportar **CSV/JSON/FIT-like** das séries temporais; API de integração (webhook) e *share link* assinado e expirável.
- Modo "sessão guiada" (wizard): enquadramento → calibração → aquecimento 30 s → 60 s de medição → relatório.

### 4.7 [P2] Validação científica
- Dataset interno com goniómetro/marcadores como verdade-terreno; reportar **MAE/Bland-Altman** por articulação e por modelo. Sem isto os limiares (145–155°…) são aplicados a medidas de erro desconhecido.
- Documentar fontes dos limiares (Holmes 1994, Bini, Silberman 2005, Peveler) em `thresholds.py` e no relatório.

---

## 5. MODELOS E APROVEITAMENTO DO HARDWARE (RX 580 + Xeon AVX2)

### 5.0 Realidades do hardware
- **RX 580 (Polaris/GCN4):** sem ROCm no Windows, **sem Tensor/INT8/FP16 acelerado** (FP16 corre a taxa 1:1 — sem ganho). **DirectML** funciona; **Vulkan** (via **ncnn**) costuma ser muito competitivo em Polaris para CNNs pequenas. Cuidado: memória 4/8 GB.
- **Xeon AVX2 (provável Haswell/Broadwell):** sem AVX-512/VNNI, mas **OpenVINO** (CPU) e **ORT CPU** com `intra_op = núcleos físicos` rendem bem; INT8 por AVX2 dá ~1.3–1.8× sobre FP32.
- **MediaPipe Tasks no Windows corre só em CPU** (o delegate GPU não existe no Python Windows). Por isso `pose_landmarker_heavy` (30 MB) compete com a GPU livre sem aproveitá-la.
- Não prometer FPS: **medir** com `scripts/benchmark_inference.py` (p50/p95) por combinação (modelo × provider × resolução).

### 5.1 [P1] Estratégia multi-backend com auto-seleção
Criar `InferenceBackend` (Protocol) com implementações: `OrtDirectML`, `OrtCPU`, `OpenVINO` (CPU/iGPU), `NcnnVulkan` (opcional). Um **autotune no 1.º arranque** corre o benchmark e grava `hardware_profile.json` (backend e resolução ótimos). O `HardwareManager` atual (só DML/CPU) passa a ser um deles.

### 5.2 [P1] Pipeline paralelo em estágios (CPU ‖ GPU)
Hoje tudo é sequencial por frame no mesmo executor: `decode → preprocess → run → decode-kp → filtros → send`. Reorganizar em *workers*:
1. **Captura/decodificação** (thread; no desktop: `cv2.VideoCapture` com MJPG, buffer 1).
2. **Pré-processamento** (CPU, OpenCV com `cv2.setNumThreads`, `cv2.dnn.blobFromImage` — evita o `astype(float32)/255` + `transpose` manual por frame).
3. **Inferência** (GPU DML; **IOBinding** com tensores pré-alocados, sem cópias extra).
4. **Pós-processamento + biomecânica** (CPU, em paralelo com o frame seguinte na GPU).
5. **Telemetria/render**.
Com *double buffering* a GPU nunca espera pela CPU; o objetivo é ocupar GPU e CPU ao mesmo tempo (hoje a CPU Xeon está quase ociosa durante a inferência na GPU).

### 5.3 [P1] Detetor + pose em dois modelos (o que o RTMPose já pretende)
- `rtmpose_engine.py` espera `models/rtmpose-m.onnx` (inexistente → corre YOLO escondido com nome `rtmpose`: **o utilizador pensa que usa RTMPose e não usa**; `inference.py:107` avisa só nas notas). Falhar de forma explícita (`available=False` e **bloquear seleção**) em vez de *fallback* silencioso.
- Modelo recomendado: **RTMPose-m (ou -s) Halpe26** (inclui calcanhar, hálux e 5.º dedo → resolve 2.2) via **`rtmlib`** (ONNX Runtime, sem `mmcv`) com o detetor **YOLO11n** (só 1 pessoa, a cada N frames) + **tracker por ROI** (já existe `PersonTracker`).
- Alternativas a medir: **YOLO11s-pose** (mais preciso que n), **ViTPose-S/B** (maior precisão; B provavelmente pesado para RX 580), **RTMO** (one-stage, sem detetor), **MoveNet Thunder** (leve), **Sapiens** (só se houver GPU maior).
- Exportar com **tamanhos fixos** (256×192 para RTMPose; 320/416/512 para YOLO) e `opset 17+`; simplificar com `onnxsim`; **batch=1 estático** (DML gosta de formas estáticas).

### 5.4 [P1] Quantização e otimização de grafo
- **CPU (Xeon):** INT8 estático com calibração em frames reais de bike (ORT `quantize_static` / OpenVINO **NNCF**); comparar erro nos keypoints (PCK/MAE em graus).
- **GPU (RX 580):** manter **FP32/FP16 sem esperar ganho de FP16**; testar `disable_metacommands`, `device_id`, e `ORT_ENABLE_ALL` vs `BASIC` (já há `disable_metacommands` no código). Compilar/guardar o grafo otimizado (`optimized_model_filepath`) para reduzir o *warmup* de arranque.
- Pré-aquecimento persistente (cache): DML recompila a cada arranque; manter a sessão viva.

### 5.5 [P1] Reduzir trabalho inútil por frame
- **ROI + redetect adaptativo** (existe): subir `redetect_interval` quando o movimento é pequeno; usar fluxo ótico (`cv2.calcOpticalFlowPyrLK`) ou Kalman para prever a caixa.
- **Frame skipping inteligente**: se o atleta está parado, baixar a taxa de inferência; se pedala, subir.
- **Resolução adaptativa**: 320 por omissão; 416/640 apenas quando a confiança dos keypoints cai.
- **Downscale antes do JPEG** no cliente e **evitar decodificar JPEG no servidor** se possível: no desktop usar frames BGR/NV12 diretamente (zero-copy via memória partilhada).
- Evitar `Landmark2D` Pydantic por keypoint em *hot path* (alocações); usar `np.ndarray [N,3]` internamente e só serializar à saída.
- `result.model_dump_json()` por frame → usar `orjson` / struct binário (msgpack) no WS.

### 5.6 [P2] LLM local opcional (sem chaves API)
Sem chaves de API, usar **llama.cpp (Vulkan)** ou **Ollama** com um modelo 3–8B Q4 **apenas** para linguagem natural do parecer (números fixos vindos do domínio). Em RX 580 corre via Vulkan; **não bloquear o pipeline de visão**: executar em processo separado, com prioridade baixa, e só no fim da sessão. Rever 2.4 antes (nunca deixar o LLM inventar medidas).

### 5.7 [P2] Parâmetros de sessão ONNX a rever em `hardware.py`
- `physical_cores` por fallback `lógicos//2` (sem `psutil`): adicionar `psutil` como dependência real. Em Windows com multi-socket Xeon, considerar **afinidade NUMA** e *pinning* do processo de inferência a um nó.
- `allow_spinning=0` reduz CPU mas pode aumentar latência p50; **medir** p50/p95 e expor como opção.
- Duas sessões em paralelo (detetor + pose) na mesma GPU: avaliar *streams* DML separados vs. serializar.

### 5.8 Tabela de decisão (a confirmar com benchmark)

| Cenário | Backend sugerido | Notas |
|---|---|---|
| Tempo real, RX 580 livre | ORT-DML, YOLO11n-pose 320 + ROI | O atual `yolo11_pose_fast` |
| Precisão (análise de BDC) | RTMPose-m Halpe26 256×192 em DML | Pés reais; detetor a cada 10–15 frames |
| Sem GPU / GPU ocupada | OpenVINO CPU INT8 | Núcleos físicos do Xeon |
| Análise offline de vídeo | Batch + pipeline paralelo CPU/GPU | Prioriza *throughput* |
| Validação científica | Marcadores ArUco + RTMPose | Ground-truth |

---

## 6. REESTRUTURAÇÃO PROPOSTA (frontend / backend / desktopapp)

Estado atual: o backend vive na **raiz** (`src/`, `server.py`, `main.py`, `models/`, `scripts/`, `tests/`, `athlete_motion.db`) e o frontend em `frontend/mediapipe/`. Destino:

```
athleteMotion/
├─ backend/                 # (git mv de src, server.py, main.py, tests, scripts, models, pyproject, uv.lock, VERSION)
│  ├─ src/athletemotion/    # pacote instalável: api/, domain/, infrastructure/, schemas/, services/
│  ├─ models/               # pesos + manifest.json (SHA-256)
│  ├─ migrations/           # Alembic
│  └─ tests/
├─ frontend/                # (hoje frontend/mediapipe → frontend/web)
├─ desktopapp/              # NOVO — PyQt6 (ver desktopapp/README_PLAN.md)
├─ docs/                    # ARCHITECTURE, ADRs, STATUS consolidados
└─ .github/workflows/       # jobs por pasta (paths filter)
```

Pontos de atenção na migração (fazer num PR dedicado, só `git mv` + imports, sem mudar lógica):
1. Transformar `src/` em pacote `athletemotion` (`pyproject.toml` com `[project]` e `packages`), para o **desktop reutilizar o domínio** (`pip install -e backend`) sem copiar código.
2. Atualizar `ci.yml` (`working-directory`), `release.yml`, `VERSION`/`package.json` check, `start.*`, `scripts/bump_version.py`, imports relativos (`...domain`) e `ROOT_DIR` em `database.py` (usa `parents[2]`).
3. Mover `athlete_motion.db*` para fora do repositório (`%APPDATA%/AthleteMotion/`).
4. Apagar `bin/`, `lib64`, `share/`, `pyvenv.cfg` (venv acidental) e `__pycache__`.

---

## 7. PLANO DE EXECUÇÃO SUGERIDO

| Sprint | Entregas |
|---|---|
| **1 (P0)** | Aspect ratio nos ângulos (2.1) · remover offsets de pé fixos/marcar estimado (2.2) · AI coach sem valores por defeito (2.4) · motor por ligação + lock (2.5) · bind `127.0.0.1` + auth por token + CORS estrito (1.1-1.3) · limites de upload/WS/GIF (1.3-1.5) · CI corrigido (2.13) |
| **2 (P1)** | Deteção BDC/TDC e ciclos (4.1) · RTMPose Halpe26 real + falha explícita sem modelo (5.3) · pipeline paralelo (5.2) · RGPD: consentimento/export/apagar (1.8) · Alembic + índices (2.10) · refactor `sessions.py` (2.9) · testes WS/concorrência |
| **3 (P1/P2)** | Calibração ArUco/pedivela (4.2) · vista frontal + simetria (4.3) · OpenVINO + INT8 + autotune (5.1, 5.4) · observabilidade (2.12) · reestruturação de pastas (6) · início do `desktopapp` |
| **4 (P2/P3)** | Validação com ground-truth (4.7) · LLM local opcional (5.6) · TypeScript/Vitest/Playwright · acessibilidade |

---

## 8. Checklist rápida de aceitação (Definition of Done para cada correção)
- [ ] Teste unitário/regressão que falha antes e passa depois.
- [ ] `ruff` + `mypy` sem erros no módulo alterado.
- [ ] Sem novos `except Exception` silenciosos; logs com nível correto.
- [ ] Benchmark (p50/p95) antes/depois para alterações de inferência.
- [ ] Atualização de documentação (ARCHITECTURE/ADR) quando muda comportamento.
