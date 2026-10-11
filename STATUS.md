# Estado do Programa / Project Status

> **Versão Atual:** `0.3.0`  
> **Status:** Plataforma Completa de BikeFit Ativa em Produção & Teste Live (Separação Total HTML/JS/CSS, Astral `uv`, 17/17 Testes Pytest, Multi-dispositivo PC/Mobile/Tablet)  
> **Data da Última Atualização:** 11 de Outubro de 2026  
> **Língua Mãe:** Português (PT) | **Secondary:** English (EN)  

---

## 1. Regra de Ouro / Golden Rule

> [!IMPORTANT]
> **REGRA DE OURO PARA DESENVOLVEDORES E AGENTES DE IA:**
> Qualquer alteração, pull request, correção de bug ou implementação de nova feature **TEM OBRIGATORIAMENTE** de atualizar este ficheiro `STATUS.md`.
> Registos de status desatualizados quebram a rastreabilidade do projeto.

---

## 2. Servidores Ativos em Tempo Real (Live Testing)

O sistema encontra-se a correr em background para validação interativa no browser:

- **Frontend Web App (PC Local):** [http://localhost:8081](http://localhost:8081)
- **Frontend Web App (Telemóvel / Tablet na mesma rede Wi-Fi):** `http://192.168.31.127:8081`
- **Backend API (FastAPI Health Check):** [http://localhost:8000/health](http://localhost:8000/health)
- **Documentação Interativa da API (Swagger UI):** [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 3. Separação Estrita de Responsabilidades (HTML / JS / CSS)

Seguindo as boas práticas de programação e facilidade de leitura para programadores juniores, todos os componentes e vistas Vue 3 foram completamente desacoplados em 3 ficheiros individuais de responsabilidade única:

1. **Markup Semântico (`.html`)**: Estrutura pura do DOM, sem estilos inline nem lógica de negócio.
2. **Lógica de Domínio & Estado (`.js`)**: Gestão de estado reativo, chamadas assíncronas à API, integrações de sensores e cálculos matemáticos seguros, com comentários explicativos em Português.
3. **Estilos Visuais (`.css`)**: Regras de layout, cores, responsividade e animações, sem misturar código JavaScript nem marcação.
4. **Orquestrador SFC (`.vue`)**: Ficheiro minimalista de 3 linhas que apenas orquestra a importação dos 3 ficheiros via `<template src="...">`, `<script src="...">` e `<style scoped src="...">`.

### Tabela de Componentes Organizados por Pastas (Component-as-a-Folder)

Cada componente reside na sua própria pasta dedicada em `src/components/<NomeDoComponente>/`, contendo o quarteto de ficheiros desacoplados mais um `index.js` para re-exportação limpa:

| Componente / Pasta | Ficheiro HTML | Lógica (JS) | Estilos (CSS) | Orquestrador SFC | Ponto de Entrada |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Aplicação Raiz** | `src/App.html` | `src/App.js` | `src/App.css` | `src/App.vue` | `src/App.vue` |
| **Home (4 Etapas)** | `src/views/HomeView.html` | `src/views/HomeView.js` | `src/views/HomeView.css` | `src/views/HomeView.vue` | `src/views/HomeView.vue` |
| **Sobre** | `src/views/AboutView.html` | `src/views/AboutView.js` | `src/views/AboutView.css` | `src/views/AboutView.vue` | `src/views/AboutView.vue` |
| **`AthleteOnboarding/`** | `.../AthleteOnboarding.html` | `.../AthleteOnboarding.js` | `.../AthleteOnboarding.css` | `.../AthleteOnboarding.vue` | `.../index.js` |
| **`LiveCameraCapture/`** | `.../LiveCameraCapture.html` | `.../LiveCameraCapture.js` | `.../LiveCameraCapture.css` | `.../LiveCameraCapture.vue` | `.../index.js` |
| **`FitReportView/`** | `.../FitReportView.html` | `.../FitReportView.js` | `.../FitReportView.css` | `.../FitReportView.vue` | `.../index.js` |
| **`SessionComparator/`** | `.../SessionComparator.html` | `.../SessionComparator.js` | `.../SessionComparator.css` | `.../SessionComparator.vue` | `.../index.js` |
| **`Camera/`** | `.../Camera.html` | `.../Camera.js` | `.../Camera.css` | `.../Camera.vue` | `.../index.js` |
| **`BikeFitAnalyzer/`** | `.../BikeFitAnalyzer.html` | `.../BikeFitAnalyzer.js` | `.../BikeFitAnalyzer.css` | `.../BikeFitAnalyzer.vue` | `.../index.js` |
| **`HelloWorld/`** | `.../HelloWorld.html` | `.../HelloWorld.js` | `.../HelloWorld.css` | `.../HelloWorld.vue` | `.../index.js` |

---

## 4. Visão Geral dos Componentes / Component Health Matrix

| Componente | Estado | Versão / Ref | Saúde Técnica | Observações |
| :--- | :---: | :---: | :---: | :--- |
| **Backend API (FastAPI)** | 🟢 Ativo | `0.3.0` | 🟢 Saudável | Rotas modularizadas em `src/api/v1/` (`athletes`, `bikes`, `biomechanics`, `sessions`), injeção idiomática `Depends(get_db)`, streaming de PDF via ReportLab, parecer de IA, histórico por atleta, datetime UTC timezone-aware. Executado com `uv run`. |
| **Persistência Transacional (ACID)** | 🟢 Ativo | SQLite WAL | 🟢 Saudável | Base de dados relacional com Write-Ahead Logging (`WAL`), `PRAGMA foreign_keys = ON`, `Unit of Work` com rollback automático em caso de exceção. |
| **Domínio Biomecânico & Cálculos** | 🟢 Ativo | `src/domain/biomechanics/` | 🟢 Saudável | Pacote modularizado (< 150 linhas por módulo: `thresholds`, `fitting`, `posture`, `alignment`, `symmetry`, `diagnostics`), Fórmulas LeMond, Holmes, Hamley 109%, KOPS horizontal, Índice de Simetria Bilateral ($SI$), Desnível Saddle Drop. |
| **Pipeline de Câmara (Frontend)** | 🟢 Ativo | `LiveCameraCapture/` | 🟢 Saudável | Orquestrador magro modularizado (< 380 linhas) com 8 submódulos em `modules/` (< 170 linhas cada) e estilos divididos em `styles/`, MediaPipe Pose, HUD de RPM/Watts/BDC. |
| **Rastreamento de Ciclo (BDC & RPM)** | 🟢 Ativo | `pedalStrokeTracker.js` | 🟢 Saudável | Deteção automática do Ponto Morto Inferior (BDC) por extremos locais na trajetória vertical do tornozelo, cadência em RPM e congelamento angular do joelho. |
| **Linha de Prumo Virtual KOPS** | 🟢 Ativo | `kopsAnalyzer.js` | 🟢 Saudável | Projeção dinâmica de linha pontilhada a 90° e cálculo do desvio milimétrico de recuo/avanço de selim nos carris. |
| **Análise no Plano Frontal (Valgo Dinâmico)** | 🟢 Ativo | `frontalPlaneAnalyzer.js` | 🟢 Saudável | Rastreamento da oscilação medial do joelho, deteção de colapso em valgo/varo e prescrição de Fator Q / palmilhas. |
| **Diagrama Polar de Eficiência 360°** | 🟢 Ativo | `polarPlotter.js` | 🟢 Saudável | Renderização concêntrica em 24 setores radiais no canvas com cálculo do Índice de Suavidade de Pedalada (PSI %). |
| **Treinador Biomecânico de IA** | 🟢 Ativo | `ai_coach.py` | 🟢 Saudável | Parecer narrativo inteligente no backend e frontend com sumário executivo, análise de cockpit e plano de adaptação em 3 semanas. |
| **Alertas de Áudio e Voz Sintetizada** | 🟢 Ativo | `audioFeedback.js` | 🟢 Saudável | Web Audio API (bips suaves) + Web Speech API com voz sintetizada em Português (`pt-PT`) e Inglês, com debounces anti-ruído. |
| **Análise de Assimetria Bilateral** | 🟢 Ativo | `asymmetryCalculator.js` | 🟢 Saudável | Fluxo guiado em 2 passos (Perfil Esquerdo $\rightarrow$ Perfil Direito), cálculo de $SI$ para joelhos, tornozelos e braços, e recomendações de calços de taquinho (*cleat shims*). |
| **Metrologia Espacial & Saddle Drop** | 🟢 Ativo | `spatialCalibrator.js` | 🟢 Saudável | Calibração métrica por clique no diâmetro da roda (700c / 29" / 650b) e medição real do desnível selim-guiador em centímetros. |
| **Comparador Antes vs Depois** | 🟢 Ativo | `SessionComparator.*` | 🟢 Saudável | Aba dedicada em ecrã dividido (*Split-Screen*) para comparação lado a lado de sessões com tabela de deltas biomecânicos e ganhos de conformidade. |
| **Câmara Lenta e Scrubber** | 🟢 Ativo | `videoClipRecorder.js` | 🟢 Saudável | Gravador de rajada curta (6 segundos) com slider timeline de navegação quadro a quadro e reprodução a 0.25x. |
| **Conectividade IoT Web Bluetooth** | 🟢 Ativo | `bleSensorManager.js` | 🟢 Saudável | Conexão sem fios nativa via Bluetooth LE para Medidores de Potência (Watts, `0x1818`), Sensores de Cadência (`0x1816`) e Fita Cardíaca (`0x180D`). |
| **Persistência Local Offline (PWA)** | 🟢 Ativo | `offlineStorage.js` | 🟢 Saudável | Repositório nativo em IndexedDB para salvamento e consulta de sessões sem necessidade de conexão à internet. |
| **Gerador de Relatórios em PDF** | 🟢 Ativo | `report_generator.py` | 🟢 Saudável | Geração de PDFs profissionais no servidor com ReportLab, tabela de conformidade com cores, checklist de mecânica e nota legal. |
| **Onboarding & Medidas Primárias** | 🟢 Ativo | `AthleteOnboarding.*` | 🟢 Saudável | Formulário de medidas (altura, cavalo, tronco, braços, bike, selim, guiador) com cálculo teórico imediato e integração ao backend. |
| **Relatório Final & Diagnóstico** | 🟢 Ativo | `FitReportView.*` | 🟢 Saudável | Diagnóstico de conformidade, médias angulares, parecer de IA, diagrama polar, métricas KOPS e Drop, simetria bilateral e download de PDF. |
| **Internacionalização (i18n)** | 🟢 Ativo | `i18n.js` | 🟢 Saudável | 100% bilingue (Português língua-mãe, Inglês alternável) com persistência no `localStorage`. |
| **Testes Automatizados (Pytest)** | 🟢 Ativo | `tests/` | 🟢 Saudável | 17/17 testes aprovados em 0.35s com banco SQLite isolado em memória (`StaticPool`), mantendo `athlete_motion.db` 100% intocado. |
| **Versionamento SemVer** | 🟢 Ativo | `scripts/` | 🟢 Saudável | Autoincremento SemVer (`x.y.z`) com fonte em `VERSION`, sincronização com `package.json`, pre-push hooks e GitHub Actions. |
| **Gestor de Pacotes Python (uv)** | 🟢 Ativo | `uv 0.13.0` | 🟢 Saudável | Gestor de ambientes ultrarrápido da Astral, resolução de dependências em `pyproject.toml`, sincronização do virtualenv e execução com `uv run`. |

---

## 5. Histórico de Versões / Changelog

### [0.3.0] - 2026-10-11
- **Execução Integral do Plano de Refatoração Modular Anti-Ficheiros Gigantes (`REFACTOR-01` a `REFACTOR-03`)**:
  - **REFACTOR-01 (Higiene de Repositório e Limpeza de Código Morto)**:
    - Atualização do `.gitignore` ignorando pastas temporárias `.freebuff/` e bases de dados voláteis.
    - Saneamento de `requirements.txt` eliminando `mediapipe` e `opencv-contrib-python` (o processamento de IA é delegado ao WebAssembly no frontend).
    - Remoção de importações mortas em `server.py`, `HomeView.js` e `FitReportView.js`. Adicionado método `getAiCoachReport` ao serviço unificado `api.js`.
  - **REFACTOR-02 (Decomposição Cirúrgica do Frontend para Devs Juniores)**:
    - O monólito `LiveCameraCapture.js` (1.458 linhas) foi decomposto num orquestrador enxuto e 8 submódulos focados em `src/components/LiveCameraCapture/modules/` (< 170 linhas cada):
      - `cameraDeviceManager.js` (124 linhas): enumeração e alternância de câmaras.
      - `posePipelineRunner.js` (166 linhas): ciclo assíncrono de MediaPipe com watchdog timer.
      - `bilateralWizard.js` (75 linhas): fluxo guiado esquerdo/direito.
      - `scrubberController.js` (72 linhas): reprodução quadro a quadro a 0.25x.
      - `wheelCalibratorHandler.js` (55 linhas): calibração do diâmetro da roda.
      - `debugLogger.js` (62 linhas): logs de auditoria e telemetria.
      - `canvasOverlayRenderer.js` (116 linhas): desenho de marcos e ângulos.
      - `biomechanicsComputer.js` (66 linhas): orquestração de cálculos biomecânicos.
    - O ficheiro CSS de 853 linhas foi decomposto em 4 sub-estilos em `styles/` (`camera-hud.css`, `bilateral-wizard.css`, `scrubber-bar.css`, `debug-drawer.css`).
    - Validação com `npm run build` bem-sucedida (0 erros).
  - **REFACTOR-03 (Modularização do Backend, Injeção de Dependências e Testes Isolados)**:
    - `src/domain/biomechanics.py` (625 linhas) foi transformado no pacote modular `src/domain/biomechanics/` onde cada ficheiro possui **menos de 150 linhas**:
      - `thresholds.py` (90 linhas): Enums e limiares ergonómicos.
      - `fitting.py` (72 linhas): Fórmulas teóricas (LeMond, 109%, quadro, crenques, guiador).
      - `posture.py` (137 linhas): Diagnósticos sagitais e deltas ergonómicos.
      - `alignment.py` (119 linhas): KOPS e plano frontal.
      - `symmetry.py` (55 linhas): Índice de Simetria Bilateral ($SI$).
      - `diagnostics.py` (99 linhas): Desnível Saddle Drop e re-exportações.
      - `__init__.py` (52 linhas): Re-exportação com 100% de retrocompatibilidade.
    - Injeção de dependência padrão do FastAPI com gerador `get_db()` em `src/infrastructure/database.py` e `Depends(get_db)` nos endpoints `GET` de `athletes.py`, `bikes.py` e `sessions.py`.
    - Centralização de DTOs (`EstimateRequest` e `FrameValidationResponse`) em `src/schemas/fit.py`.
    - Isolamento de banco de dados nos testes automatizados através de `tests/conftest.py` com SQLite em memória (`StaticPool`): 17/17 testes aprovados em 0.35s sem poluir `athlete_motion.db`.
- **Organização de Componentes por Pastas (Component-as-a-Folder)**: Cada componente possui agora a sua própria pasta em `src/components/<Componente>/` contendo os 4 ficheiros desacoplados (`.html`, `.js`, `.css`, `.vue`) e um `index.js` para importações limpas, facilitando a navegação na árvore de ficheiros por desenvolvedores juniores.
- **Estabilização Temporal & Anti-Ruído (`LandmarkSmoother.js`)**: Implementação de filtro exponencial adaptativo (EMA) para eliminar dispersão e jitter nos 33 marcos anatómicos, com modos selecionáveis (Desligado, Baixo, Equilibrado e Alta Precisão de Estúdio).
- **Rastreamento de Marcadores Manuais & Foco (`ManualMarkerTracker.js`)**: Sistema de calibração fina por clique que permite ao fitter/ciclista posicionar um marcador anatómico (ex.: adesivo refletor no côndilo do joelho) e fazê-lo seguir rigidamente o movimento do corpo, acompanhado por mira de precisão e desenho da Órbita da Pedalada (trail dinâmico).
- **Desacoplamento Total de Renderização (60 FPS Nativos Imunes a Freeze)**:
  - O vídeo da webcam é desenhado diretamente no canvas a 60 FPS contínuos pelo `startFrameLoop()`, independente do MediaPipe.
  - A inferência de IA decorre em background assíncrono com *watchdog timer* de 1200ms, eliminando qualquer hipótese de congelamento de imagem caso a compilação do modelo WebAssembly demore ou um frame atrase.
- **Consola de Diagnóstico & Logs no Ecrã (`Live Debug Overlay`)**:
  - Adicionado painel flutuante de diagnóstico acessível pelo botão `[🐞 Diagnóstico & Logs]` na barra superior.
  - Medição em tempo real de FPS da câmara vs FPS de inferência da IA, resolução ativa (`1280x720`) e estado do modelo.
  - Intercetor global de erros e rejeições com botão `[📋 Copiar Logs]` com um só clique para suporte imediato sem necessitar de abrir as DevTools.
- **Correção da Interface do Analisador KOPS e Frontal**:
  - Implementado o método `analyze(knee, pedal, w, h, hip, pixelsPerMm)` em `kopsAnalyzer.js` e atualizado `drawPlumbLine` para suportar tanto coordenadas normalizadas como em píxeis, resolvendo a exceção `this.kopsAnalyzer.analyze is not a function`.
  - Implementado o método `analyze(hip, knee, ankle, w, h, side, pixelsPerMm)` e `drawFrontalAxes` em `frontalPlaneAnalyzer.js`.
- **Rastreio Visual e Marcação Imediata de Marcadores Manuais (`📍 JOELHO (CALIBRADO)`)**:
  - Implementada mira de precisão em cruz ciano (`drawCalibrationCrosshair`) com linhas guia no ecrã e badge indicativa (`📍 CLIQUE PARA FIXAR: JOELHO`) durante o modo de calibração interativo.
  - Registo instantâneo do ponto no clique, garantindo renderização persistente mesmo antes de o MediaPipe detetar o atleta.
  - Auto-vinculação dinâmica ao esqueleto: quando o atleta entra em cena ou é detetado, o marcador manual calcula automaticamente o delta relativo e segue a articulação com precisão de estúdio durante o movimento de pedalada.
  - Visualização de alta visibilidade com anel duplo dourado (`#FFD700`), centro em âmbar, retículo em cruz, halo pulsante e etiqueta escura de alto contraste.
- **Resolução de Conflito de Seleção de Dispositivo (OBS Studio Virtual vs Câmara Física)**: 
  - Corrigida a condição de enumeração em `LiveCameraCapture.js` que sobrescrevia a escolha do utilizador forçando a câmara física. Agora o utilizador pode selecionar livremente o OBS Virtual Camera ou qualquer câmara física sem que a escolha seja revertida.
  - Loop de renderização resiliente & anti-starvation: agendamento de `requestAnimationFrame` no topo de `processLoop()`, com re-chamada automática de `video.play()` caso o vídeo inicie em estado pausado, garantindo que o ciclo de 60 FPS nunca morre nem congela o ecrã.
  - Sincronização segura de `selectedDeviceId` no `startPipeline` validando se o id existe na lista de dispositivos antes de atualizar, evitando resets na dropdown.
- **Correção Crítica MediaPipe/Emscripten**: Resolução do erro `'get' on proxy: property '$$'` isolando as instâncias de hardware (`Pose`, `Camera`, `CanvasRenderingContext2D`) e motores matemáticos do sistema de reatividade do Vue 3 através de `markRaw()` e inicialização no hook `created()`.
- Migração completa do ecossistema Python para Astral `uv 0.13.0` com `pyproject.toml` e dependências resolvidas em menos de 4s.
- Refatoração profunda de arquitetura frontend: separação estrita de responsabilidades em todos os componentes (`.html`, `.js`, `.css`), com comentários didáticos para programadores juniores.
- Lançamento dos servidores em tempo real no browser para PC (`localhost:8081`) e telemóvel/tablet (`192.168.31.127:8081`).
- Implementação de todas as 22 tarefas de visão computacional, dinâmica de pedalada, metrologia e IoT (`FEAT-09` a `FEAT-22`).
- Suite de 17/17 testes automatizados aprovados via `uv run pytest`.
- Compilação de produção (`npm run build`) validada a 100%.

### [0.2.0] - 2026-10-11
- Implementação do fluxo de BikeFit em 3 etapas no frontend Vue 3 e backend FastAPI.
- Criação de `AthleteOnboarding.vue`, `LiveCameraCapture.vue` e `FitReportView.vue`.
- Camada de persistência relacional SQLite WAL com Unit of Work e conformidade ACID.
- Suite inicial de testes automatizados e bump SemVer para v0.2.0.

### [0.1.0] - 2026-10-11
- Auditoria de código sênior inicial em `CODE_REVIEW.md`.
- Especificações de arquitetura limpa em `ARCHITECTURE.md` e `STANDARDS.md`.
- Criação do catálogo de prompts modulares em `IMPLEMENTATION_PROMPTS/`.
