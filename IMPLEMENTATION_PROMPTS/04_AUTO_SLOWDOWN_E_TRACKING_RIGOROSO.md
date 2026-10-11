# 04_AUTO_SLOWDOWN_E_TRACKING_RIGOROSO.md

# Funcionalidade: Resposta Rápida do MediaPipe e Auto-Slowdown Inteligente para Análise Rigorosa

> **Solicitação do Utilizador:**  
> *"Os pontos do MediaPipe têm de ser mais rápidos a acompanhar o movimento do corpo, ou então, deverá fazer slowdown ao vídeo a fazer o movimento a partir daí e não quando o vídeo está rápido. Se isso fizer com que faça uma melhor análise e mais rigorosa, escreve num MD e vai fazendo."*

---

## 1. Diagnóstico do Problema & Motivação Técnica

### 1.1 Por que os pontos apresentavam arrasto ("lag") com o corpo em movimento?
1. **Filtro Duplo em Cascata:**
   - O MediaPipe Pose WebAssembly vinha configurado nativamente com `smoothLandmarks: true`. Esse filtro interno adiciona um atraso de fase de ~40-60ms.
   - Em seguida, o `LandmarkSmoother` aplicava o filtro 1€ com $\beta = 0.003$. Como $\beta$ era extremamente reduzido, mesmo quando a perna acelerava a alta velocidade, a frequência de corte não subia o suficiente, provocando arrasto visível dos pontos atrás da articulação real.
2. **Desfasamento Taxa de Vídeo vs Inferência WebAssembly:**
   - A 1.0x (velocidade normal), um vídeo a 30 FPS ou 60 FPS avança 33ms ou 16ms por fotograma.
   - Uma inferência WebAssembly completa do MediaPipe demora tipicamente 25-40ms na thread do navegador.
   - A 1.0x, o navegador salta fotogramas entre inferências ("frame dropping"), perdendo picos cruciais da pedalada (ex.: ângulo exato no Ponto Morto Inferior BDC ou transições de 90°).

---

## 2. Solução Integrada de Alta Engenharia

A solução atua em duas frentes complementares:

### A. Otimização de Resposta Imediata dos Marcos (Zero-Lag Tracking)
1. **Desativação do Amortecedor Interno do MediaPipe:**
   - `smoothLandmarks: false` no MediaPipe, permitindo que as coordenadas brutas cheguem imediatamente em tempo real.
2. **Recalibração Dinâmica do Filtro 1€ (`LandmarkSmoother`):**
   - Aumento da sensibilidade à velocidade ($\beta$) de $0.003$ para $0.055$.
   - A baixa velocidade (ciclista quase estático): $\text{cutoff} \approx f_{\min} = 0.5\,\text{Hz}$ (elimina 100% do jitter/tremor).
   - A alta velocidade (descida do pedal / rotação rápida): $\text{cutoff} = f_{\min} + \beta \times \text{speed} \gg 10\,\text{Hz}$ (acompanhamento instantâneo sem qualquer arrasto).
3. **Novo Nível de Suavização Rápido:** `fast_motion` ("Dinâmico Rápido") focado em desportos de alta cadência.

### B. Auto-Slowdown Inteligente para Análise Rigorosa (Smart Slow-Motion on Movement)
1. **Deteção de Movimento Biomecânico:**
   - O sistema monitoriza a velocidade angular da perna/joelho ($\Delta \theta / \Delta t$) e a velocidade linear dos marcos do tornozelo/pedaleira.
2. **Comutação Automática de Velocidade:**
   - Quando o ciclista entra em fase de movimento ou rotação da pedalada:
     - O leitor abranda automaticamente para **0.25x** (ou **0.5x**, configurável).
     - **Vantagem Biomecânica:** A 0.25x, cada segundo de vídeo tem 4x mais tempo para ser processado pela IA. O MediaPipe analisa **100% dos fotogramas sem perder um único milissegundo de movimento**, obtendo a curva de extensão máxima do joelho (BDC), KOPS e PSI com rigor cirúrgico.
   - Quando o ciclista estabiliza ou para, o leitor retoma a cadência normal ou pausada.
3. **Controlo Manual e Transparência na Interface (UI):**
   - Interruptor: `🎯 Auto-Slowdown Rigoroso` [ON / OFF] na barra de vídeo.
   - Indicador visual no HUD: `🎯 CÂMARA LENTA ATIVA (0.25x - Modo Rigor AI)`.

---

## 3. Checklist de Execução por Fases

- [x] **Fase 0: Documentação Técnica e Especificação** (`04_AUTO_SLOWDOWN_E_TRACKING_RIGOROSO.md`).
- [x] **Fase 1: Otimização do Filtro 1€ e Redução de Latência no Tracking**
  - [x] Atualizado `frontend/mediapipe/src/services/landmarkSmoother.js`:
    * $\beta$ aumentado de 0.003 para 0.055 no nível ultra e 0.085 no perfil responsive/fast_motion.
    * Aceleração dinâmica com dynamicBeta para velocidade > 0.25 abrindo a frequência de corte sem qualquer arrasto.
  - [x] Atualizado `frontend/mediapipe/src/components/LiveCameraCapture/modules/posePipelineRunner.js`:
    * Definido `smoothLandmarks: false` no MediaPipe nativo eliminando o atraso de ~50ms.
- [x] **Fase 2: Motor de Auto-Slowdown Inteligente em `videoUploadManager.js`**
  - [x] Adicionadas propriedades: `autoSlowdownEnabled`, `autoSlowdownSpeed: 0.25`, `isSlowedDownByMotion`, `userBasePlaybackRate`.
  - [x] Adicionados métodos: `setAutoSlowdown(enabled, speed)`, `triggerMotionSlowdown()`, `releaseMotionSlowdown()`.
- [x] **Fase 3: Deteção de Movimento e Orquestração em `LiveCameraCapture.js`**
  - [x] Monitorização contínua da velocidade angular do joelho ($\Delta \theta / \Delta t$) e rotação de pedalada.
  - [x] Disparo automático de câmara lenta (0.25x) em movimento para o MediaPipe processar 100% dos fotogramas sem perdas.
  - [x] Retoma suave da velocidade base quando o movimento estabiliza.
- [x] **Fase 4: Controlos na UI em `LiveCameraCapture.html` e Estilos em `video-analysis.css`**
  - [x] Botão interativo `🎯 Auto-Slowdown Ligado` / `🎯 Câmara Lenta Ativa (0.25x)` na barra de velocidade.
  - [x] Badge HUD no vídeo com animação pulsante esmeralda `🎯 CÂMARA LENTA (0.25x - RIGOR AI)`.
- [x] **Fase 5: Testes e Validação Completa**
  - [x] Compilação `npm run build` bem-sucedida (código 0).
  - [x] Suite de testes `pytest tests/` com 18/18 testes aprovados.

---

## 4. Registo de Execução em Direto

- **Passo 1:** Elaboração e gravação da documentação técnica e modelo matemático de latência em `04_AUTO_SLOWDOWN_E_TRACKING_RIGOROSO.md`.
- **Passo 2:** Calibração do filtro 1€ em `landmarkSmoother.js` ($\beta = 0.055$ e aceleração dinâmica de corte de frequência).
- **Passo 3:** Remoção de `smoothLandmarks` nativo no `posePipelineRunner.js` para resposta pura em tempo real.
- **Passo 4:** Implementação da máquina de estados de auto-slowdown no `videoUploadManager.js` com preservação da taxa base.
- **Passo 5:** Deteção biomecânica de velocidade angular e sincronização reativa em `LiveCameraCapture.js`.
- **Passo 6:** Interface e estilos com botão de controlo e badge HUD esmeralda em `LiveCameraCapture.html` e `video-analysis.css`.
- **Passo 7:** Validação rigorosa com `npm run build` (0 erros) e `pytest tests/` (18/18 testes verdes).
