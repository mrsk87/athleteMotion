# CODE REVIEW SÉNIOR — Athlete Motion (BikeFit)

> **Status:** 🟢 CONCLUÍDO (18/18 tarefas implementadas e em revisão) · **Última atualização:** 2026-10-14 · **Revisto contra o código em:** 2026-10-14
> **Plano de execução:** [`TASKS/REVIEW_2026/STATUS_BOARD.md`](TASKS/REVIEW_2026/STATUS_BOARD.md) (tarefas R01–R18) · **Protocolo para LLMs:** [`00_PROTOCOLO_LLM.md`](TASKS/REVIEW_2026/00_PROTOCOLO_LLM.md) · **Desktop:** [`desktopapp/TASKS/STATUS_BOARD.md`](desktopapp/TASKS/STATUS_BOARD.md)
> **Convenção:** quando um achado é resolvido, a tarefa marca-o aqui com `✅ Resolvido em Rxx` (ver protocolo §3.3).

| Secção do review | Tarefa(s) | Estado |
|---|---|---|
| §1.1–1.2, 1.6–1.7, 1.10 Segurança base | R04 | 🟢 (R04 ✅) |
| §1.3–1.5, 1.9 Upload/WS/GIF/validação | R05 | 🟢 (R05 ✅) |
| §1.8 RGPD | R06 | 🟢 (R06 ✅) |
| §1.11, 2.12, 2.13 Cadeia/CI/observabilidade | R15 | 🟢 (R15 ✅) |
| §2.1, 2.2, 2.7 Ângulos, pés, estabilizador | R02 | 🟢 (R02 ✅) |
| §2.3, 4.1 BDC/ciclos | R10 | 🟢 (R10 ✅) |
| §2.4, 5.6 AI Coach | R09 | 🟢 (R09 ✅) |
| §2.5, 2.6 Concorrência/lifespan | R03 | 🟢 (R03 ✅) |
| §2.8, 5.3 Modelos/tracking | R13 | 🟢 (R13 ✅) |
| §2.9 Serviço de sessões | R08 | 🟢 (R08 ✅) |
| §2.10 Base de dados | R07 | 🟢 (R07 ✅) |
| §2.11, 6 Estrutura/Documentação | R01, R18 | 🟢 (R01 ✅, R18 ✅) |
| §3 Frontend | R16 | 🟢 (R16 ✅) |
| §4.2 Calibração | R11 | 🟢 (R11 ✅) |
| §4.3, 4.4 Medidas/qualidade | R12 | 🟢 (R12 ✅) |
| §4.6, 4.7 Relatório/validação | R17 | 🟢 (R17 ✅) |
| §5.0–5.8 Hardware/desempenho | R14 | 🟢 (R14 ✅) |

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

### 1.1 [P0] Sem autenticação/autorização em toda a API · ✅ Resolvido em R04
- Nenhum endpoint (`/api/v1/athletes`, `/sessions`, `/inference/engine/switch`, `/ws/live-inference`) exige identidade. Qualquer dispositivo na rede (o servidor liga a `0.0.0.0`, ver `server.py:138`) lê/apaga dados de atletas e **troca o motor de IA global**.
- IDs são UUID (difíceis de adivinhar) mas isso **não é controlo de acesso** (IDOR).
- **Fazer:**
  - Modo local: ligar a `127.0.0.1` por omissão; `0.0.0.0` só com flag explícita (`--lan`).
  - Autenticação: token local gerado no arranque (header `Authorization: Bearer`) ou, se for multi-utilizador, OAuth2/JWT (`fastapi.security`) com `owner_id` em `athletes` e filtro por owner em **todas** as queries.
  - Proteger `/docs` e `/openapi.json` fora de modo desenvolvimento.

### 1.2 [P0] CORS inseguro/incoerente — `server.py:47-60` · ✅ Resolvido em R04
- `allow_origins=["*"]` como fallback **combinado com** `allow_credentials=True` é inválido/perigoso.
- `allow_origin_regex` aceita **qualquer** IP `192.168.x.x`/`10.x.x.x` em **qualquer** porta → qualquer página aberta na LAN pode chamar a API.
- `allow_methods=["*"]`, `allow_headers=["*"]`.
- **Fazer:** lista explícita de origens por ambiente (`.env`), métodos/headers mínimos, `allow_credentials` só se usar cookies; nunca fallback para `*`.

### 1.3 [P0] WebSocket `/ws/live-inference` sem proteção · ✅ Resolvido em R05
Ficheiro `src/api/v1/inference_ws.py`:
- Sem verificação de **Origin**, sem autenticação, sem limite de ligações simultâneas.
- Sem limite de tamanho da mensagem binária (`raw_bytes`) → DoS por memória/CPU (descodificação JPEG arbitrária com `cv2.imdecode`).
- Não valida magic bytes nem dimensões máximas da imagem (decompression bomb: JPEG 30000×30000).
- Comando `set_engine` aceita `name` arbitrário do cliente e **altera o motor global** para todos os clientes (linhas 158-167).
- Erros engolidos com `logger.debug` (linhas 117, 170) — falhas invisíveis em produção.
- **Fazer:** `max_size` do WS (uvicorn `--ws-max-size`), validar Origin/token no `accept`, limitar a 1–2 sessões, validar JPEG (SOI `FFD8`) e `w*h` ≤ limite antes de decodificar, whitelist de motores (`PoseEngineRegistry.names()`), níveis de log adequados.

### 1.4 [P0] `/process_frame` lê o ficheiro inteiro antes de validar tamanho — `server.py:96-107` · ✅ Resolvido em R05
- `await file.read()` carrega **tudo** para memória e só depois compara com 5 MB. O comentário do `ARCHITECTURE.md` ("blindado contra DoS") não corresponde ao código.
- **Fazer:** ler em *chunks* com contador e abortar ao ultrapassar o limite; limite também no reverse proxy (`client_max_body_size`) / Starlette middleware; validar `w*h` depois do decode; ver 1.7 (rate limit).
- Além disso o endpoint não faz inferência (só valida) — remover ou integrar com o motor, para não ser superfície morta.

### 1.5 [P1] `/video/export-gif` — `src/api/v1/video.py` · ✅ Resolvido em R05
- `frames: List[str]` com até 120 base64 **sem limite de tamanho por frame/total** → centenas de MB por pedido.
- `Image.open` sem `Image.MAX_IMAGE_PIXELS` controlado → *decompression bomb*.
- `async def` com trabalho CPU pesado (LANCZOS + GIF `optimize=True`) **bloqueia o event loop** de toda a API/WS.
- `detail=f"... {str(e)}"` devolve texto de exceção interna ao cliente.
- **Fazer:** limitar tamanho total do body, `Image.MAX_IMAGE_PIXELS`, `def` síncrono (threadpool) ou `run_in_executor`/`anyio.to_thread`, mensagens de erro genéricas.

### 1.6 [P1] Fuga de detalhes internos · ✅ Resolvido em R04
- `inference.py:144` → `f"Falha ao carregar motor ... {str(e)}"`; `inference.py:169` idem. Devolver ID de erro e registar o detalhe no log.
- Criar *exception handlers* globais com formato único de erro (RFC 7807 `application/problem+json`).

### 1.7 [P1] Sem rate limiting nem limites de recursos · ✅ Resolvido em R04
- Adicionar `slowapi`/middleware de limitação por IP/token em endpoints de escrita, PDF, GIF e WS.
- Timeout de pedido, limite de concorrência de inferência (semáforo).

### 1.8 [P1] Dados pessoais / RGPD (atletas) · ✅ Resolvido em R06
- Implementado consentimento informado obrigatório em `POST /athletes` com validação de versão e escopos legais (`processing`, `store_landmarks`, `retention_extended`).
- Minimização estrita de dados: `raw_landmarks_json` descartado por omissão nas sessões e snapshots; apenas guardado se houver consentimento explícito e `store_landmarks=True`.
- Atualização e revogação de consentimento com `PATCH /athletes/{id}/consent`: revogação de `store_landmarks` purga imediatamente todos os keypoints biométricos gravados em sessões passadas.
- Exportação integral portável (Art. 15 e 20) com `GET /athletes/{id}/export` devolvendo pacote estruturado em JSON com `schema_version: "1.0"` e dados descriptografados.
- Apagamento em conformidade com o Art. 17: `DELETE /athletes/{id}?hard=false` (soft delete com expiração agendada) e `DELETE /athletes/{id}?hard=true` (remoção em cascata com `PRAGMA secure_delete = ON`, `PRAGMA wal_checkpoint(TRUNCATE)` e `VACUUM` sem deixar vestígios em disco).
- Retenção programada em `athletemotion.services.retention` (executada no lifespan e via CLI `python -m athletemotion.cli purge --retention-months 24`).
- Cifra em repouso a nível de campo (`FieldCipher` com Fernet AES-128-CBC + HMAC-SHA256, tokens `enc:v1:...`) para campos sensíveis (`email` e `raw_landmarks_json`).
- Documentação oficial de privacidade e termos versionados (PT/EN) em `docs/privacy.md`.

### 1.9 [P1] Validação de entrada · ✅ Resolvido em R05

- `sessions.py`: `kops_offset`, `saddle_drop`, `cadence_rpm`, `power_watts` sem limites (`Query(..., ge=, le=)`). `lang` aceita qualquer string.
- `SnapshotCreate.raw_landmarks` sem limite de tamanho → inserção de JSON gigante em `Text`.
- Query params de PDF são "dados clínicos" entregues pelo cliente sem validação.
- `reportlab`: confirmar que nomes/recomendações passam por `xml.sax.saxutils.escape` antes de `Paragraph(...)` (o Paragraph interpreta markup).

### 1.10 [P2] Cabeçalhos e transporte · ✅ Resolvido em R04
- Sem HTTPS/WSS: `inferenceStore.js:8` usa `ws://localhost:8000`. Para uso em LAN (telemóvel) é necessário TLS (mkcert/caddy) — **`getUserMedia` só funciona em contexto seguro** fora de `localhost`.
- Adicionar `SecurityHeadersMiddleware` (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy: camera=(self)`).
- Frontend: `HelpTip` usa `v-html` — hoje com SVG estático (ok), mas manter *lint rule* que proíba `v-html` com dados dinâmicos.

### 1.11 [P2] Cadeia de fornecimento · ✅ Resolvido em R15
- `requirements.txt` com `>=` sem tecto; existe `uv.lock` mas CI instala de `requirements.txt` (não reprodutível). Fixar versões (ou usar `uv sync --frozen` no CI).
- Pesos de modelos (`*.onnx`, `*.task`, `*.pt`) vêm de fora do repo → adicionar `models/manifest.json` com **URL + SHA-256** e verificação no arranque (evita modelo adulterado).
- Ativar `pip-audit`, `npm audit`, Dependabot e CodeQL.
- `pytest`, `httpx`, `pytest-asyncio` estão em `requirements.txt` de produção → separar em `requirements-dev.txt`.

---

## 2. CORREÇÃO / BOAS PRÁTICAS NO BACKEND

### 2.1 [P0] Ângulos do MediaPipe calculados em coordenadas normalizadas — `mediapipe_engine.py:355-380` · ✅ Resolvido em R02
`calculate_safe_angle` recebe `x,y ∈ [0,1]` **sem multiplicar por largura/altura**. Num frame 16:9 o eixo X está comprimido ~1.78× face ao Y → **todos os ângulos (joelho, cotovelo, tornozelo, tronco) ficam distorcidos**. O `yolo_engine.py` faz bem (`to_pt` multiplica por `full_w/full_h`, linha 274), o que significa que os dois motores dão números diferentes para a mesma pose.
- **Fazer:** passar `frame_w/frame_h` e converter para pixels antes de qualquer ângulo ou distância; o mesmo em `_validate_rigid_segments` (usa `math.hypot` em normalizado, a tolerância de 12% é afetada). Criar um único `compute_angles(landmarks, w, h)` no domínio e **remover a duplicação** dos três motores. Adicionar teste de regressão com frame 1920×1080 vs 1080×1080.

### 2.2 [P0] Calcanhar/biqueira "inventados" com offsets fixos — `yolo_engine.py:235-251`, `mediapipe_engine.py:287-300` · ✅ Resolvido em R02
- `toe_offset_x = 0.035`, `heel_offset_x = -0.018` em unidades normalizadas **não escalam** com a distância câmara-atleta nem com a resolução → o **ângulo do tornozelo** e o **recuo do cleat** que daí saem não têm significado físico.
- YOLO11-pose (COCO-17) **não tem pontos de pé**.
- **Fazer:** usar modelos com pés (RTMPose **Halpe26 / Body8-Halpe26** ou **RTMW / Wholebody**, 133 pts) — ver secção 5; se se mantiver estimativa, escalar pela tíbia (`foot_len ≈ 0.28·altura`, `tibia_px`) e **marcar `visibility=0` e `estimated=True`** para a UI não apresentar como medido.

### 2.3 [P0] Diagnóstico por **média de todos os snapshots** — `sessions.py:116-124` · ✅ Resolvido em R10
- A extensão do joelho de referência (145–155°, Holmes 25–35° de flexão) aplica-se **ao ponto morto inferior (BDC)**. Implementada deteção pura de ciclos de pedalada (`BatchCycleDetector` e `OnlineCycleDetector`), cálculo de cadência via autocorrelação e FFT, refinamento de BDC por pico de extensão do joelho (±80 ms) e agregação estatística com identificação de proveniência (`cycle_detection` vs `manual_snapshots`). O snapshot manual mantém-se como fallback gracioso quando há menos de 5 ciclos válidos.

### 2.4 [P0] AI Coach inventa dados — `ai_coach.py:33-34` · ✅ Resolvido em R09
- Se o joelho/costas não existirem, o código assume `148.0°` e `45.0°` e emite "Parabéns… perfeitamente alinhada". **Resultado clínico falso quando falta medição.**
- Pesquisa por `"joelho"/"costas"` em texto PT: quebra com `lang=en` ou renomeações.
- EN: `kops_data.get('actionPt', ...)` — chave inexistente; mensagem sem número.
- Nome "IA" engana: é um *template* determinístico. Sem chave de API (a situação atual), a opção correta é **manter regras determinísticas** (números sempre vindos do domínio), e, opcionalmente, **LLM local** (llama.cpp/Ollama, Qwen2.5-7B Q4) apenas para *reformular* texto, nunca para calcular. Ver 5.6.
- **Fazer:** devolver `None`/"dados insuficientes"; usar `joint_id` estável (enum), não rótulo traduzido; i18n com ficheiros `.po/.json` em vez de f-strings inline.

### 2.5 [P0] Estado global partilhado entre clientes — `PoseEngineRegistry.active`, `inference_ws.py`, `inference.py` · ✅ Resolvido em R03
- Há **um único motor ativo global**. Dois ligações WS partilham: filtro (já por ligação ✔), mas **motor, `tracker`, `femur_history`, `last_timestamp_ms`** não. O modo `VIDEO` do MediaPipe exige timestamps estritamente crescentes por instância → dois clientes corrompem-se.
- `hardware.py:8-9` documenta que **chamadas concorrentes ao mesmo `Run()` DirectML não são suportadas**, mas `_warmup` (executor) e `inference_worker` (executor) podem correr em simultâneo sobre o mesmo motor (por ex. `warmup` + frame).
- `set_engine` por WS muda o motor global para todos.
- **Fazer:** motor **por ligação/sessão** (`EngineSession`), com `asyncio.Lock`/executor de 1 thread dedicado por motor para serializar `Run()`; pool de modelos partilhados (pesos) mas **estado separado**; remover `PoseEngineRegistry.set_active` do caminho do WS.

### 2.6 [P1] Efeitos laterais na importação — `inference.py:36-41` · ✅ Resolvido em R03
Criar o motor MediaPipe (carrega 30 MB .task) ao importar o router atrasa arranque e testes e engole falhas (`except Exception`). Mover para `lifespan` do FastAPI (`app.state.engines`), com *warmup* assíncrono.

### 2.7 [P1] Segmentos rígidos mutam landmarks e estado — `mediapipe_engine.py:337-352` · ✅ Resolvido em R02
- Mutação in-place (`landmarks[k].x = ...`) de objetos que também estão em `last_valid_landmarks` → o "último válido" fica contaminado.
- Quando **inválido sem histórico** não se atualiza `last_valid`, quando válido também só no `else`; a lógica do ramo `else` mistura casos. Reescrever como função pura `stabilize(landmarks, state) -> (landmarks, state)` com testes.

### 2.8 [P1] YOLO sem NMS e escolha da "pessoa de maior confiança" — `yolo_engine.py:158-165` · ✅ Resolvido em R13
- Implementado `TargetSelector` com função de pontuação ponderada ($w_1 \cdot \text{conf} + w_2 \cdot \text{IoU} + w_3 \cdot \text{dist\_centro} + w_4 \cdot \text{razão\_área}$) e bloqueio temporal (*lock-in*) após 5 fotogramas estáveis, prevenindo saltos entre o atleta e espectadores de fundo.
- Otimização de pós-processamento: filtragem por `conf >= min_confidence` antes da transposição matricial da saída [56, 8400], e supressão de não-máximos (`cv2.dnn.NMSBoxes`) ativada apenas quando existem múltiplos candidatos viáveis ($K > 1$).
- Suporte a metadados de licença com aviso explícito de risco copyleft (`license_risk = True` para AGPL-3.0).

### 2.9 [P1] Sessões/Reports duplicados e lógica na camada API — `sessions.py` · ✅ Resolvido em R08
- Extraído `ReportBuilder` (`report_builder.py`) centralizando `resolve_modality` e `build_diagnostics` (DRY completo em rotas, PDF e AI Coach).
- Extraído `SessionService` (`session_service.py`) desacoplado de HTTP com máquina de estados explícita (`IN_PROGRESS → COMPLETED | CANCELLED`), levantando `InvalidSessionStateTransitionError` (HTTP 409 Conflict).
- `complete_fit_session` tornado estritamente idempotente (sessões já concluídas retornam o mesmo relatório sem mutação).
- Ingestão em lote atómica com `POST /sessions/{id}/snapshots:batch` (até 500 snapshots em transação única em < 300 ms).
- Paginação por cursor temporal e limite em `GET /sessions/by-athlete/{id}` mantendo compatibilidade retroativa.

### 2.10 [P1] Base de dados · ✅ Resolvido em R07
- Faltam índices: `posture_snapshots(session_id)`, `fit_sessions(athlete_id, started_at)`, `bikes(athlete_id)`.
- Migrações *ad hoc* (`_ADDED_COLUMNS` em `database.py:164`) → adotar **Alembic**. `declarative_base()` legado → `DeclarativeBase` (SQLAlchemy 2.0) com `Mapped[...]`.
- `PRAGMA synchronous = NORMAL` + WAL é aceitável, mas o comentário "DURABILIDADE" é enganador (NORMAL pode perder as últimas transações num crash de energia; usar `FULL` para dados clínicos finais).
- Caminho do DB fixo na raiz do projeto: tornar configurável (`ATHLETE_DB_URL`) e, em produção/desktop, em `%APPDATA%`.
- `AthleteModel` sem `deleted_at`, `consent_at`, `owner_id`.

### 2.11 [P2] Estrutura do repositório · ✅ Resolvido em R01 e R18
- Raiz limpa e reorganizada em `backend/`, `frontend/web` e `desktopapp/` (R01).
- Entry point unificado via `python -m athletemotion.api` e scripts padronizados de conveniência.
- Documentação consolidada em `docs/` com inventário em `docs/README.md`, arquitetura viva com diagramas Mermaid em `docs/architecture.md`, 7 ADRs fundamentais (ADR 001 a 007 cobrindo as decisões D1 a D4), runbook operacional `docs/runbook.md`, glossário `docs/glossary.md` e arquivo de legados em `docs/archive/` (R18).
- `pyproject.toml` unificado com extras padronizados e dependências sincronizadas.

### 2.12 [P2] Observabilidade · ✅ Resolvido em R15
- Logging estruturado (JSON) com `request_id`, tempo por estágio (decode / preprocess / infer / decode-kp / filter / send). Expor `/metrics` (Prometheus) com histograma de latência por motor — o `benchmark_inference.py` já é um bom ponto de partida; levar o mesmo para runtime.
- Health: `/health/ready` que verifica modelos carregados e provider ativo (hoje devolve `ok` fixo).

### 2.13 [P2] Qualidade/CI — `.github/workflows/ci.yml` · ✅ Resolvido em R15
- **Job backend em `ubuntu-latest` instala `onnxruntime-directml`** (só tem wheels Windows) → falha provável. Usar `windows-latest` ou instalar `onnxruntime` CPU em CI via extra.
- Sem `ruff`, `black`/`ruff format`, `mypy/pyright`, cobertura mínima (`--cov-fail-under`), `pip-audit`, lint/test de frontend (`npm run lint`, `vitest`), `Playwright` e2e, `CodeQL`.
- Testes: só 7 ficheiros; faltam testes de WS, de concorrência, de aspect-ratio (2.1), de BDC, de limites de upload, de PDF.
- Tipagem: `from __future__ import annotations` por todo o lado mas sem verificação estática → ativar `mypy --strict` em `domain/`.

---

## 3. FRONTEND (`frontend/mediapipe`) · ✅ Resolvido em R16

- **[P1] Monólito resolvido e composables:** Monólito desacoplado e decomposto em *composables* puros e modulares (`useCamera.js`, `useInferenceSocket.js`, `useSessionRecorder.js`, `useCycleDisplay.js`).
- **[P1] Privacidade e RGPD:** Dados pessoais (PII) do atleta, perfil antropométrico e sessões de linha de base totalmente migrados de `localStorage` para `secureStorage.js` sobre IndexedDB (com cifra opcional WebCrypto AES-GCM 256-bit e chave derivada PBKDF2), com rotina de migração única que purga cópias antigas do `localStorage`.
- **[P1] Fila Offline Resiliente:** Criado `syncQueue.js` persistente em IndexedDB com retry exponencial com jitter, cabeçalhos `Idempotency-Key` (R08) e suporte a ingestão em lote (`snapshots:batch`). Fim absoluto de `.catch(() => {})` silenciosos: erros de rede e sincronização disparam toasts e alertas no HUD.
- **[P2] Autenticação e Segurança:** Criado `authToken.js` gerindo Bearer token em memória volátil, interceptores Axios com injeção automática de `Authorization`, tratamento padronizado de HTTP 401 e 429 (`Retry-After`), e WebSocket seguro com `wss://` e query param `?token=`.
- **[P2] Tipos da API e Testes:** Configurado `vitest` + `@vue/test-utils` com testes de caracterização e unitários completos (15/15 testes verdes); gerador de definições TypeScript a partir do OpenAPI (`scripts/generate-api-types.mjs` / `npm run gen:api`).
- **[P2] Compressão de Frames Off-Thread:** Criado Web Worker `frameEncoder.worker.js` usando `OffscreenCanvas` e `createImageBitmap` para redimensionar (largura máx. 640) e codificar JPEG (qualidade 0.75) sem bloquear o thread principal da interface.
- **[P2] Consumo Retrocompatível dos Novos Contratos:** Renderização visual tracejada e semitransparente com etiqueta `(est.)` para marcos com `estimated=true` em `canvasOverlayRenderer.js`, supressão honesta sem métricas fictícias quando `withheld=true`, e telemetria de ciclo de pedalada (BDC/TDC e posição de relógio).
- **[P3] Acessibilidade e i18n:** Teste automatizado de paridade estrita entre dicionários PT e EN (`tests/unit/i18n.spec.js`), corrigindo chaves ausentes. 14 scripts de verificação do frontend (1200+ asserções) e build de produção 100% verdes.

---

## 4. NOVAS FUNCIONALIDADES PARA O BIKEFIT

> **Nota:** o frontend já contém protótipos de várias destas ideias (`pedalStrokeTracker.js`, `kopsAnalyzer.js`, `spatialCalibrator.js`, `wheelCalibratorHandler.js`, `frontalPlaneAnalyzer.js`, `asymmetryCalculator.js`, `bleSensorManager.js`, `chroma/*`). O problema é que a lógica biomecânica está **duplicada em JS e Python** e não é testada em conjunto. Recomendação: mover a lógica de medição para o **domínio Python partilhado** (backend + desktop) e deixar o frontend só para visualização. O frontend só mantém o que é puramente de UI.

### 4.1 [P0→P1] Deteção automática do ciclo de pedalada (BDC/TDC) · ✅ Resolvido em R10
- Sinal: trajetória vertical do **tornozelo/calcanhar** e ângulo do joelho filtrados com Savitzky-Golay / Butterworth zero-phase. Máximos e mínimos locais validados por periodicidade temporal e cadência via **autocorrelação ponderada + FFT** com score de confiança.
- Por ciclo: ângulo do joelho no **BDC** (refinado pelo pico de extensão em janela de ±80 ms), no **TDC** (máxima flexão), amplitude de joelho (ROM), descarte automático de ciclos com duração anómala (>35% da mediana), ROM insuficiente (<35°) ou baixa visibilidade (<0.5).
- Agregação de sessão: médias, desvios e medianas com remoção de outliers via MAD.
- Preenchimento em tempo real de `is_bdc`, `is_tdc` e `clock_position` (1h..12h) no WebSocket (`OnlineCycleDetector`).
- Documentação técnica completa em `docs/cycle-detection.md` e ferramenta CLI de benchmark em `athletemotion.domain.cycle.benchmark`.

### 4.2 [P0→P1] Calibração e escala · ✅ Resolvido em R11
- Implementado subsistema puro de calibração espacial (`athletemotion.domain.calibration`) sem dependências de frameworks.
- Deteção fiduciária por marcador ArUco (DICT_4X4_50 com lado nominal de 100 mm por defeito), garantindo erro métrico < 1% e cálculo de pose 3D (Roll e Yaw) via `solvePnP`.
- Métodos auxiliares: calibração por pedivela (endpoints 3h-9h e ajuste circular por mínimos quadrados a nuvem de pontos de pedalada) e por roda (ajuste de elipse com estimativa de yaw oblíquo via razão de eixos).
- Desdistorção ótica de lente (`undistort_points`) aplicando correção OpenCV pinhole diretamente aos pontos articulares (keypoints) sem reprocessar frames completos.
- Propagação estrita de incerteza em `ScaleCalibration` e `CoordinateTransformer`: cada medição em mm inclui a sua incerteza expandida ($\pm \sigma$). Sem calibração métrica válida ativa, o sistema não emite milímetros (`None`), prevenindo diagnósticos fictícios.
- Alertas bilingues estruturados (`HIGH_ROLL` para $|roll| > 3.0^\circ$, `HIGH_YAW` para $|yaw| > 8.0^\circ$, `LOW_SHARPNESS`, `SMALL_MARKER`).
- `evaluate_kops_alignment` atualizado com suporte a incerteza de medição mantendo retrocompatibilidade.
- Tabela relacional `camera_profiles` (migração Alembic `0005_camera_profiles`) e endpoints REST em `api/v1/calibration.py`.
- Ferramenta de validação CLI `python -m athletemotion.domain.calibration.selftest` e documentação técnica `docs/calibration.md`.

### 4.3 [P1] Medidas bikefit adicionais · ✅ Resolvido em R12
- Implementado subsistema puro `athletemotion.domain.measures.sagittal` com reamostragem a 100 pontos da rotação 0–360° para joelho, anca, tornozelo, ombro e cotovelo, calculando amplitude ROM e fase de pico.
- Medidas estáticas derivadas em milímetros com incerteza estrita propagada a partir da calibração R11 (`kops_setback`, `saddle_to_bar_drop`, `reach`); medidas retidas (`None` + motivo) se a calibração for ausente.
- Análise de vista frontal em `athletemotion.domain.measures.frontal`: queda pélvica (*hip drop* com detecção de oscilação $>2.5^\circ$), oscilação lateral (*lateral sway* em mm), *knee tracking* dinâmico (varo/valgo face ao eixo anca-tornozelo), Fator Q dinâmico e simetria bilateral (SI).
- Deteção e quantificação estatística de fadiga e deriva (*drift*) em `athletemotion.domain.measures.fatigue` comparando o 1.º vs último terço da sessão com teste não-paramétrico de Mann-Whitney U.
- Limiares biomecânicos em `thresholds.py` enriquecidos com fontes bibliográficas verificáveis (*Holmes 1994, Bini 2011, Silberman 2005, Pruitt 2006, Burke 2003*) e marcação honesta `empirical/unverified` quando não indexado; adaptação dinâmica por *FitGoal* (conforto/aero/performance) e histórico de lesões (*InjuryFlag*).

### 4.4 [P1] Qualidade da medição · ✅ Resolvido em R12
- Portão de qualidade (*quality gating*) em `athletemotion.domain.measures.confidence` com score composto baseado em visibilidade, amostragem de ciclos, periodicidade espetral e concordância de motores. Limiar mínimo estrito de 0.60: nenhuma recomendação ou medida incerta é emitida sem validação (`withheld=True`).
- Deteção automática e estável do lado visível (`detect_visible_side`) através da visibilidade diferencial dos membros e alinhamento craniofacial (nariz vs orelhas/ombros).
- Filtro de Kalman cinemático 2D (`kalman_skeleton.py`) com ponderação dinâmica de ruído pela visibilidade e restrição anatómica de comprimento de segmentos (fémur e tíbia com tolerância de $\pm 8\%$), reduzindo o RMSE do ângulo articular do joelho em mais de 50% sob ruído e oclusões pontuais.
- Documentação técnica consolidada em `docs/measures.md` e esquemas Pydantic completos em `schemas/measures.py`. 31 novos testes unitários com 100% de aprovação.

### 4.5 [P2] Marcadores e equipamento
- Modo `opencv_markers` existe: melhorar com **marcadores retro-refletores + ArUco** nas articulações (trocânter, côndilo femoral lateral, maléolo lateral, 5.º metatarso) → precisão sub-grau, referência "ouro" para validar os modelos sem marcadores.
- Detetar o **selim** e o **guiador** por segmentação/keypoints de bicicleta (YOLO-seg ou keypoint custom) para medir setback/reach automaticamente.

### 4.6 [P2] Relatório e experiência · ✅ Resolvido em R17
- Implementado novo pipeline em `athletemotion.services.reporting.pdf` usando ReportLab com geração em ~0.18s para 300+ ciclos (< 3.0s de orçamento).
- Rastreabilidade integral via `Provenance` (versão da app, git commit SHA lido diretamente de `.git/HEAD` em < 1ms sem subprocessos, hashes criptográficos de modelos, tipo de calibração, contagem de ciclos) persistido em JSON e no rodapé do PDF.
- Gráficos biomecânicos thread-safe em `charts.py` via Matplotlib `FigureCanvasAgg` (OO API pura, sem estado global pyplot): curvas angulares médias $\pm 1$ DP com banda alvo ergonómica, histograma de BDC e deriva temporal de fadiga.
- Tabelas dinâmicas de articulações com incerteza propagada ($\pm U$) e score de confiança percentual (0–100%), caixa explícita de medidas retidas (*withheld*) sem valores fictícios, checklist prática de oficina em mm e aviso legal bilingue PT/EN. `report_generator.py` mantido como shim retrocompatível.
- Exportações abertas interoperáveis em `api/v1/sessions.py`: `GET /api/v1/sessions/{id}/export.csv` (séries temporais e ciclos com streaming generator) e `GET /api/v1/sessions/{id}/export.json` (schema_version 1.0.0 com minimização de PII).

### 4.7 [P2] Validação científica · ✅ Resolvido em R17
- Protocolo formal de estudo clínico e validação experimental em `athletemotion/validation/protocol.md` ($n \ge 15$, goniómetro digital / Vicon 3D, critérios de aceitação: MAE $\le 3.0^\circ$, RMSE $\le 4.0^\circ$, viés $\le 1.5^\circ$, Pearson $r \ge 0.95$, LoA 95% $\le \pm 5.0^\circ$).
- Ferramentas estatísticas determinísticas em `athletemotion/validation/metrics.py` e `bland_altman.py` (estatísticas e renderizador PNG de Bland-Altman).
- Runner CLI automatizado em `athletemotion/validation/runner.py` gerando relatórios em Markdown, JSON e gráficos por motor com validação determinística contra verdade-terreno sintética (recuperação de erro injetado com desvio $\le 0.03^\circ \le 0.1^\circ$).
- Documentação técnica e guia de reprodução em `docs/validation/README.md`.

---

## 5. MODELOS E APROVEITAMENTO DO HARDWARE (RX 580 + Xeon AVX2)

### 5.0 Realidades do hardware
- **RX 580 (Polaris/GCN4):** sem ROCm no Windows, **sem Tensor/INT8/FP16 acelerado** (FP16 corre a taxa 1:1 — sem ganho). **DirectML** funciona; **Vulkan** (via **ncnn**) costuma ser muito competitivo em Polaris para CNNs pequenas. Cuidado: memória 4/8 GB.
- **Xeon AVX2 (provável Haswell/Broadwell):** sem AVX-512/VNNI, mas **OpenVINO** (CPU) e **ORT CPU** com `intra_op = núcleos físicos` rendem bem; INT8 por AVX2 dá ~1.3–1.8× sobre FP32.
- **MediaPipe Tasks no Windows corre só em CPU** (o delegate GPU não existe no Python Windows). Por isso `pose_landmarker_heavy` (30 MB) compete com a GPU livre sem aproveitá-la.
- Não prometer FPS: **medir** com `scripts/benchmark_inference.py` (p50/p95) por combinação (modelo × provider × resolução).

### 5.1 [P1] Estratégia multi-backend com auto-seleção · ✅ Resolvido em R14
Criar `InferenceBackend` (Protocol) com implementações: `OrtDirectML`, `OrtCPU`, `OpenVINO` (CPU/iGPU), `NcnnVulkan` (opcional). Um **autotune no 1.º arranque** corre o benchmark e grava `hardware_profile.json` (backend e resolução ótimos). O `HardwareManager` atual (só DML/CPU) passa a ser um deles.

### 5.2 [P1] Pipeline paralelo em estágios (CPU ‖ GPU) · ✅ Resolvido em R14
Hoje tudo é sequencial por frame no mesmo executor: `decode → preprocess → run → decode-kp → filtros → send`. Reorganizar em *workers*:
1. **Captura/decodificação** (thread; no desktop: `cv2.VideoCapture` com MJPG, buffer 1).
2. **Pré-processamento** (CPU, OpenCV com `cv2.setNumThreads`, `cv2.dnn.blobFromImage` — evita o `astype(float32)/255` + `transpose` manual por frame).
3. **Inferência** (GPU DML; **IOBinding** com tensores pré-alocados, sem cópias extra).
4. **Pós-processamento + biomecânica** (CPU, em paralelo com o frame seguinte na GPU).
5. **Telemetria/render**.
Com *double buffering* a GPU nunca espera pela CPU; o objetivo é ocupar GPU e CPU ao mesmo tempo (hoje a CPU Xeon está quase ociosa durante a inferência na GPU).

### 5.3 [P1] Detetor + pose em dois modelos (o que o RTMPose já pretende) · ✅ Resolvido em R13
- Eliminado o fallback silencioso para YOLO: sem modelo ou com hash adulterado, o sistema levanta `ModelUnavailableError`, `/inference/engines` marca `available=False` com o motivo (`reason`), e `/inference/engine/switch` devolve HTTP 409 Conflict.
- Integração do modelo oficial **RTMPose-m Body8 Halpe26** (256×192, SimCC split ratio 2.0) com licença **Apache-2.0** permissiva:
  - Fornece pontos anatómicos **reais** para o calcanhar (`left_heel`, `right_heel`) e biqueira (`left_big_toe`, `right_big_toe`, `small_toe`) com `estimated=False`, permitindo a medição precisa da dorsiflexão do tornozelo e do recuo de cleat sem heurísticas artificiais.
  - Pré-processamento afim top-down padronizado (padding 1.25) e remapeamento inverso direto.
- Criado o catálogo e manifesto centralizado `backend/models/manifest.json` com somas de verificação criptográficas SHA-256 e utilitário CLI `scripts/fetch_models.py` para verificação e descarga automatizada.

### 5.4 [P1] Quantização e otimização de grafo · ✅ Resolvido em R14
- **CPU (Xeon):** INT8 estático com calibração em frames reais de bike (ORT `quantize_static` / OpenVINO **NNCF**); comparar erro nos keypoints (PCK/MAE em graus). Medido em R14: Haswell sem VNNI resulta em 0.45× de velocidade (mais lento) e erro MAE 2.28; quantização rejeitada e mantido FP32 nativo.
- **GPU (RX 580):** manter **FP32/FP16 sem esperar ganho de FP16**; testar `disable_metacommands`, `device_id`, e `ORT_ENABLE_ALL` vs `BASIC` (já há `disable_metacommands` no código). Compilar/guardar o grafo otimizado (`optimized_model_filepath`) para reduzir o *warmup* de arranque.
- Pré-aquecimento persistente (cache): DML recompila a cada arranque; manter a sessão viva.

### 5.5 [P1] Reduzir trabalho inútil por frame · ✅ Resolvido em R14
- **ROI + redetect adaptativo** (existe): subir `redetect_interval` quando o movimento é pequeno; usar fluxo ótico (`cv2.calcOpticalFlowPyrLK`) ou Kalman para prever a caixa.
- **Frame skipping inteligente**: se o atleta está parado, baixar a taxa de inferência; se pedala, subir.
- **Resolução adaptativa**: 320 por omissão; 416/640 apenas quando a confiança dos keypoints cai.
- **Downscale antes do JPEG** no cliente e **evitar decodificar JPEG no servidor** se possível: no desktop usar frames BGR/NV12 diretamente (zero-copy via memória partilhada).
- Evitar `Landmark2D` Pydantic por keypoint em *hot path* (alocações); usar `np.ndarray [N,3]` internamente e só serializar à saída.
- `result.model_dump_json()` por frame → usar `orjson` / struct binário (msgpack) no WS.

### 5.6 [P2] LLM local opcional (sem chaves API)
Sem chaves de API, usar **llama.cpp (Vulkan)** ou **Ollama** com um modelo 3–8B Q4 **apenas** para linguagem natural do parecer (números fixos vindos do domínio). Em RX 580 corre via Vulkan; **não bloquear o pipeline de visão**: executar em processo separado, com prioridade baixa, e só no fim da sessão. Rever 2.4 antes (nunca deixar o LLM inventar medidas).

### 5.7 [P2] Parâmetros de sessão ONNX a rever em `hardware.py` · ✅ Resolvido em R14
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

## 6. REESTRUTURAÇÃO PROPOSTA (frontend / backend / desktopapp) — ✅ Resolvido em R01

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
