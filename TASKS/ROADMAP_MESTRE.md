# ROADMAP MESTRE: ARQUITETURA DE INFERÊNCIA MULTI-ENGINE & FRONTEND VUE 3 BIOMECÂNICO

> **Autor:** Engenheiro de Software Sénior & Especialista em Visão por Computador e Biomecânica Aplicada  
> **Destinatário:** Engenheiros de Implementação / Agentes LLM  
> **Alvo:** Sistema de Análise Biomecânica de Alta Performance (BikeFit)  
> **Hardware de Referência:** Intel Xeon E5-1660 v3 (8C/16T, AVX2) | AMD Radeon RX 580 8 GB (DirectML) | 32 GB DDR4  
> **Data:** Outubro de 2026 | **Estado:** Planeamento & Arquitetura de Produção

---

## 1. DIAGNÓSTICO E AUDITORIA CRÍTICA DA ARQUITETURA ATUAL

### 1.1 Estado do Backend Python (`src/`, `server.py`)
- **Gargalo Central:** O backend atual é exclusivamente transacional (CRUD SQLite de atletas, bicicletas e sessões com geração de PDF/GIF). **Não possui qualquer pipeline de inferência de visão computacional**.
- **Dependências Incompletas:** O `requirements.txt` atual possui apenas FastAPI, OpenCV básico e Pillow. Faltam `onnxruntime-directml`, `mediapipe` (Python), `scipy`, `websockets` e utilitários de filtragem temporal.
- **Subutilização de Hardware:** O hardware do utilizador (CPU 8C/16T com AVX2 e GPU AMD RX 580 de 8 GB VRAM) está **100% ocioso** em tarefas de IA, pois a inferência atual é executada apenas no browser via WebAssembly single-threaded.
- **Ponto Forte:** O domínio biomecânico (`src/domain/calculator.py` e `src/domain/biomechanics/`) possui funções matemáticas puras bem documentadas (com clamping para evitar NaN no cálculo de ângulos) e limiares ergonómicos claros (Holmes, Pruitt, Burke).

### 1.2 Estado do Frontend Vue (`frontend/mediapipe/`)
- **Monólito Excessivo:** O componente `LiveCameraCapture.js` (160 KB) e `LiveCameraCapture.html` (107 KB) concentram captura de câmara, leitura WebAssembly de MediaPipe, manipulação direta de Canvas 2D, síntese de voz, exportação de GIF e lógica de ecrã.
- **Sincronização Frágil de Vídeo/Gráfico:** O gráfico em `anglesTimelineChart.js` é desenhado manualmente em Canvas 2D frame a frame, sem biblioteca gráfica reativa (Chart.js ou ECharts), gerando dessincronização entre o relógio do vídeo HTML5 e o cursor vermelho do gráfico.
- **Ausência de Gestor de Estado:** O projeto usa Vue 3 (`createApp`) mas não tem Pinia instalado. O estado é gerido em variáveis reativas locais do componente ou passadas por dezenas de callbacks.
- **Reprodução de Vídeo:** O upload de vídeo passa por canvas intermediários que podem introduzir atrasos de descodificação ou perdas de taxa de quadros (framerate mismatch).

---

## 2. ARQUITETURA ALVO DESACOPLADA (TARGET STATE)

```
+-----------------------------------------------------------------------------------------+
|                                    HARDWARE HOST                                        |
|  CPU: Intel Xeon E5-1660 v3 (AVX2, 8C/16T)  |  GPU: AMD Radeon RX 580 8GB (DirectX 12)   |
+-----------------------------------------------------------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------------+
|                                 PYTHON BACKEND (FastAPI)                                |
|                                                                                         |
|  [REST API: /api/v1/...]               [WebSocket Server: /ws/live-inference]           |
|  - Metadados de Sessões                - Streaming Bidirecional (Frames In -> Telemetria)|
|  - Switch de Engine em Runtime         - Protocolo Binário/JSON de Baixa Latência       |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  |                MOTOR UNIFICADO DE INFERÊNCIA (Strategy Pattern)                   |  |
|  |                                                                                   |  |
|  |  +---------------------+  +--------------------+  +----------------------------+  |  |
|  |  | MediaPipePoseEngine |  |  YOLO11PoseEngine  |  |       RTMPoseEngine        |  |  |
|  |  | - complexity=2      |  |  - ONNX DirectML   |  |  - ONNX DirectML           |  |  |
|  |  | - Sagittal Filter   |  |  - 640x640 Input   |  |  - Rotações Estáveis       |  |  |
|  |  | - Rigid Segment Chk |  |  - DmlProvider     |  |  - DmlProvider             |  |  |
|  |  +---------------------+  +--------------------+  +----------------------------+  |  |
|  |                                                                                   |  |
|  |  +---------------------------------------------+  +----------------------------+  |  |
|  |  |            OneEuroFilter (x, y)             |  |   OpenCVClassicalTracker   |  |  |
|  |  |   Supressão Temporal de Jitter (Zero Lag)   |  |   Luminância & Marcador HSV|  |  |
|  |  +---------------------------------------------+  +----------------------------+  |  |
|  +-----------------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------------+
                                           ^
                          WebSocket / REST | (JSON Telemetry + Matrices)
                                           v
+-----------------------------------------------------------------------------------------+
|                                  FRONTEND (Vue 3 + Vite/CLI)                            |
|                                                                                         |
|  [Pinia Stores] : useInferenceStore | useVideoPlayerStore | useBiomechanicsStore        |
|                                                                                         |
|  +------------------------------------+   +------------------------------------------+  |
|  |       <VideoPlayerVLC.vue>         |   |    <BiomechanicalOverlayCanvas.vue>      |  |
|  |  - Lossless Blob URL / File API    |   |  - Esqueleto Biomecânico em Tempo Real   |  |
|  |  - Timeline com Seletor Loop A-B   |   |  - Motion Trail Órbita do Pé (Fade)      |  |
|  |  - Velocidades 0.1x a 2.0x         |   |  - Indicador Dinâmico de Fase (BDC/TDC)  |  |
|  |  - Passo Frame-a-Frame (Step +/-)  |   |                                          |  |
|  +------------------------------------+   +------------------------------------------+  |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  |      <TelemetrySyncChart.vue> (Apache ECharts / Chart.js)                         |  |
|  |  - Curvas de Ângulos (Joelho, Tronco, Cotovelo, Pescoço) Sincronizadas            |  |
|  |  - Faixa Alvo de Joelho no BDC: 145° - 155° (Tracejado Verde Destaque)             |  |
|  |  - Cursor Vertical Vermelho Sincronizado ao Frame Atual                           |  |
|  +-----------------------------------------------------------------------------------+  |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  |      <BiomechanicalStatsDashboard.vue>                                            |  |
|  |  - Cadência (RPM)  |  - BDC Médio  |  - Oscilação Tronco  |  - Diagnóstico Selim  |  |
|  +-----------------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------------+
```

---

## 3. MAPA DE EXECUÇÃO DAS TAREFAS (TASK ROADMAP)

Cada ficheiro `.md` na diretoria `TASKS/` é uma especificação autónoma e executável, planeada para que um agente LLM a implemente sem ambiguidades:

| Ficheiro de Tarefa | Título & Escopo | Prioridade | Dependências |
|---|---|---|---|
| [`TASK_01_BACKEND_DIRECTML_ENVIRONMENT.md`](./TASK_01_BACKEND_DIRECTML_ENVIRONMENT.md) | Configuração de Dependências, DirectML e Hardware (Xeon AVX2 + RX 580) | P0 (Bloqueador) | Nenhuma |
| [`TASK_02_BACKEND_INFERENCE_STRATEGY_MEDIAPIPE.md`](./TASK_02_BACKEND_INFERENCE_STRATEGY_MEDIAPIPE.md) | Strategy Pattern Base + Engine MediaPipe Pose Sagital Rigoroso | P0 (Core) | TASK_01 |
| [`TASK_03_BACKEND_YOLO_RTMPOSE_DIRECTML.md`](./TASK_03_BACKEND_YOLO_RTMPOSE_DIRECTML.md) | Motores YOLO11-Pose e RTMPose via ONNX Runtime DirectML | P1 (Aceleração) | TASK_01, TASK_02 |
| [`TASK_04_BACKEND_TEMPORAL_FILTER_AND_MARKERS.md`](./TASK_04_BACKEND_TEMPORAL_FILTER_AND_MARKERS.md) | Filtro One-Euro Temporal + Rastreio Ótico OpenCV (HSV/Luma) | P1 (Qualidade) | TASK_02 |
| [`TASK_05_BACKEND_WEBSOCKET_AND_REST_API.md`](./TASK_05_BACKEND_WEBSOCKET_AND_REST_API.md) | Endpoints WebSocket e REST para Troca de Engine e Streaming | P0 (Comunicação) | TASK_02, TASK_03, TASK_04 |
| [`TASK_06_FRONTEND_PLAYER_VLC_A_B_LOOP.md`](./TASK_06_FRONTEND_PLAYER_VLC_A_B_LOOP.md) | Leitor de Vídeo VLC em Vue 3 (Blob Lossless, Loop A-B, Frame Step) | P0 (Frontend Core) | Nenhuma |
| [`TASK_07_FRONTEND_CANVAS_OVERLAY_AND_FOOT_ORBIT.md`](./TASK_07_FRONTEND_CANVAS_OVERLAY_AND_FOOT_ORBIT.md) | Canvas de Sobreposição: Esqueleto Biomecânico e Trajetória Orbital do Pé | P0 (Visualização) | TASK_06 |
| [`TASK_08_FRONTEND_TELEMETRY_CHART_AND_DASHBOARD.md`](./TASK_08_FRONTEND_TELEMETRY_CHART_AND_DASHBOARD.md) | Gráfico Sincronizado (ECharts/Chart.js) com Faixa BDC 145°-155° e Dashboard | P0 (Telemetria) | TASK_06, TASK_07 |
| [`TASK_09_FRONTEND_PINIA_STORE_AND_INTEGRATION.md`](./TASK_09_FRONTEND_PINIA_STORE_AND_INTEGRATION.md) | Pinia Store, Cliente WebSocket Resiliente e Desacoplamento do Monólito | P1 (Integração) | TASK_05, TASK_06, TASK_07, TASK_08 |

---

## 4. ESPECIFICAÇÃO DE PROTOCOLO DE COMUNICAÇÃO

### 4.1 REST API: Controlo de Motor em Runtime
- `GET /api/v1/inference/engines`: Lista motores disponíveis e capacidades de aceleração (DirectML, CPU AVX2).
- `POST /api/v1/inference/engine/switch`: Altera o motor ativo instantaneamente sem reiniciar a aplicação.
  ```json
  {
    "engine": "yolo11_pose", // "mediapipe" | "yolo11_pose" | "rtmpose" | "opencv_markers"
    "side": "right",         // "left" | "right"
    "use_directml": true,
    "smoothing": "one_euro",  // "one_euro" | "kalman" | "none"
    "rigid_segment_check": true
  }
  ```

### 4.2 WebSocket: Streaming Assíncrono (`/ws/live-inference`)
- **Cliente -> Servidor:**
  - Envio de frame de vídeo comprimido (JPEG em blob binário) com cabeçalho de timestamp em microssegundos: `[4 bytes: timestamp_ms (uint32)][resto: jpeg_bytes]`.
  - Ou evento JSON de configuração: `{"type": "set_side", "side": "left"}`.
- **Servidor -> Cliente:**
  - Mensagem JSON de telemetria biomecânica com matriz de coordenadas normalizadas e ângulos pré-calculados:
  ```json
  {
    "timestamp_ms": 12450,
    "frame_idx": 372,
    "engine_active": "yolo11_pose",
    "side": "right",
    "landmarks": {
      "hip": {"x": 0.482, "y": 0.412, "confidence": 0.94},
      "knee": {"x": 0.521, "y": 0.618, "confidence": 0.91},
      "ankle": {"x": 0.495, "y": 0.812, "confidence": 0.89},
      "heel": {"x": 0.470, "y": 0.825, "confidence": 0.85},
      "toe": {"x": 0.560, "y": 0.835, "confidence": 0.88},
      "shoulder": {"x": 0.410, "y": 0.310, "confidence": 0.95},
      "elbow": {"x": 0.360, "y": 0.420, "confidence": 0.92},
      "wrist": {"x": 0.310, "y": 0.490, "confidence": 0.90},
      "ear": {"x": 0.395, "y": 0.230, "confidence": 0.87}
    },
    "angles": {
      "knee": 148.5,
      "torso": 44.2,
      "elbow": 156.0,
      "shoulder": 84.1,
      "ankle": 96.2
    },
    "pedal_phase": {
      "clock_position": "6h",
      "is_bdc": true,
      "is_tdc": false
    },
    "validation": {
      "femur_valid": true,
      "tibia_valid": true,
      "occlusion_suppressed": true
    }
  }
  ```

---

## 5. CRITÉRIOS DE ACEITAÇÃO GLOBAL (DEFINITION OF DONE)

1. **Zero Degradação de CPU:** O processo Python com DirectML não deve exceder 25% de uso contínuo de CPU no Xeon E5-1660 v3 durante inferência a 30 FPS.
2. **Utilização Efetiva de VRAM:** A GPU AMD RX 580 deve alocar entre 1.5 GB e 3.5 GB de VRAM via DirectML para o pipeline YOLO/RTMPose sem memory leaks.
3. **Latência de Processamento:** Latência de inferência + filtragem por frame inferior a 33 ms (garantindo processamento fluido a 30+ FPS).
4. **Precisão Biomecânica:** A faixa do BDC (145°-155°) deve ser sinalizada no momento exato em que a distância vertical anca-tornozelo atinge a extensão máxima da pedalada, sem falsos disparos no retorno ascendente.
5. **Zero Perdas no Leitor VLC:** Reprodução via Blob URL no frontend a 100% da resolução nativa sem re-renderização compressiva.
6. **Código Intacto:** O código pré-existente só é alterado durante a execução de cada tarefa individual planejada, garantindo estabilidade e retrocompatibilidade com a base de dados SQLite ACID existente.

---

## 6. REGISTO DE EXECUÇÃO & CHECKPOINT ATUAL

### 6.1 Concluído com Sucesso e Testado
- [x] **Seleção de Lado do Corpo na Bancada DirectML:**
  - Seletor de 3 vias na barra lateral: `[◀ Esquerdo] [Direito ▶] [Ambos]`.
  - [BiomechanicalOverlayCanvas.vue](file:///d:/Projects/athleteMotion/frontend/mediapipe/src/components/video/BiomechanicalOverlayCanvas.vue): filtragem estrita de articulações e ossos para desenhar apenas o perfil escolhido, eliminando círculos duplicados e poluição contralateral sobre o ciclista.
  - Sincronização reativa do rastro de órbita do pé com o tornozelo do lado selecionado e reset limpo ao alternar de perfil.
  - Badges de ângulo (joelho e tronco) ancorados na articulação ativa com fundo em cápsula de alto contraste.
- [x] **Cursor Temporal (Playhead) & Loop A-B na Linha do Tempo:**
  - [VideoScrubberBar.html](file:///d:/Projects/athleteMotion/frontend/mediapipe/src/components/LiveCameraCapture/components/VideoScrubberBar/VideoScrubberBar.html) & [VideoScrubberBar.css](file:///d:/Projects/athleteMotion/frontend/mediapipe/src/components/LiveCameraCapture/components/VideoScrubberBar/VideoScrubberBar.css): Cursor playhead tátil iluminado (`.vsc-playhead-pin`) com indicador de posição e gradiente ciano de preenchimento (`.vsc-timeline-fill`).
  - Resolução dos tokens de CSS e compatibilidade com o tema escuro/sóbrio.
  - Marcadores de início `[🚩 Ponto A]` e fim `[🚩 Ponto B]` com pinos identificados (`A` verde e `B` vermelho), realce âmbar da faixa de repetição e ciclo contínuo sem solavancos.
- [x] **Desacoplamento de Vídeo vs Inferência:**
  - Vídeo corre a 60 FPS fluídos sem atrasos artificiais do motor de pose.
- [x] **Testes Automatizados:**
  - `npm run lint`: 0 erros.
  - `npm run verify:playback`: 54 asserções aprovadas.
  - `python -m pytest tests`: 26 testes unitários e de integração aprovados.

---

### 6.2 Implementação Concluída Nesta Etapa

1. [x] **Aceleração do YOLO e Desacoplamento Zero-Latency (GPU DirectML / AMD RX 580):**
   - **Backend (`src/api/v1/inference_ws.py`):** Implementado padrão *Producer-Consumer* com descarte automático de frames acumulados (`Event` assíncrono e `latest_frame`). O backend nunca enfileira frames desatualizados e processa sempre o fotograma mais recente da GPU em tempo real.
   - **Frontend (`BiomechanicalWorkbench.vue`):** Resolução adaptativa a 480p com compressão JPEG a 0.58; sincronização rigorosa com `isAwaitingInference` e `inferenceStore.onFrameTelemetry`, garantindo cadência imediata (~35-40 FPS) sem sobrecarregar a fila do navegador nem introduzir atraso artificial.
   - **Verificação de Hardware:** Confirmado `DmlExecutionProvider` na GPU AMD RX 580 com latência média de 3.33 ms por inferência.

2. [x] **Desbloqueio do Card "Análise Integral do Vídeo" e Fluxo Intuitivo:**
   - **Estado Pendente Claro:** No `FinalPrescriptionEngine`, quando nenhuma análise foi arrancada, o veredicto agora indica *«Análise Pendente»* (com badge neutro `Pendente`) em vez de *«Análise em curso»*.
   - **Botão Hero `▶ Iniciar Análise Integral`:** Adicionado diretamente no cartão de resumo no painel lateral de `LiveCameraCapture`, permitindo ao utilizador disparar a análise das pedaladas em qualquer momento com um clique.
   - **Auto-preenchimento Não-Bloqueante:** `requestFullVideoAnalysis()` preenche automaticamente o peso e calçado a partir do passo 1 da sessão e arranca a análise diretamente.

3. [x] **Restauro e Alternância do HUD da Câmara:**
   - Adicionado botão `👁️ Mostrar HUD / 📍 HUD` na barra superior de modos (`source-mode-bar`).
   - Adicionada pílula flutuante de restauro `.hud-restore-pill` sobre o viewport sempre que `hudPosition === 'hidden'`, permitindo reativar o HUD instantaneamente com 1 clique.
   - Persistência e ciclo de 4 posições (Topo, Base, Sobre o Vídeo, Oculto) totalmente operacionais.

4. [x] **Botão de Limpeza do Gráfico:**
   - Integrado botão `🗑️ Limpar Gráfico` em `TelemetrySyncChart.vue` ligado a `onClearChart` e `inferenceStore.clearTelemetry()`.

5. [x] **Ajuste Dinâmico e Controlo Livre de Tamanho do Vídeo (Vertical & Horizontal):**
   - **Substituição de 'Resolução' por Tamanho Real do Palco:** Eliminada a confusão de rótulos 360p/480p/720p. Introduzido controlo explícito de dimensão com botões incrementais `➖` e `➕` (passos de 60px) e exibição da altura em tempo real (`500px` a `1300px`).
   - **Predefinições Reativas:** Predefinições `P (500px)`, `M (680px)`, `G (840px)`, `XL (980px)` e `Ecrã ⛶ (Fit)`.
   - **Otimização para Vídeos Verticais (9:16):** Deteção automática de vídeos em modo retrato (`height > width`) elevando automaticamente a altura para ≥ 840px para que o ciclista e os membros fiquem imediatamente com grande detalhe e legibilidade em vez de espremidos.
   - **Modo Expandido / Largura Total:** Botão `⛶ Expandir / 🗗 Lado a Lado` que permite ao palco ocupar 100% da largura do monitor, descendo o painel lateral para baixo do vídeo.

---

### 6.3 Estado dos Testes e Validação Contínua
- `npm run lint -- --no-fix`: **0 erros**.
- `npm run verify:playback`: **54 asserções aprovadas**.
- `npm run verify:full-analysis`: **91 asserções aprovadas**.
- `python -m pytest tests`: **26 testes unitários e de integração aprovados**.
- Servidor backend FastAPI a correr em `localhost:8000`.
- Frontend Vue a correr em `localhost:8081`.

