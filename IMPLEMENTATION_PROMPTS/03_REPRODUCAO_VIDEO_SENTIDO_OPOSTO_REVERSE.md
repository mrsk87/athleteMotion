# 03_REPRODUCAO_VIDEO_SENTIDO_OPOSTO_REVERSE.md

# Funcionalidade: Reprodução de Vídeo no Sentido Oposto / Marcha-Atrás (Reverse Video Playback)

> **Objetivo do Utilizador:**  
> *"A inversão do vídeo que me referia era andar no sentido oposto, não era inverter a posição, escreve num md e vai fazendo"*  
> Permitir reproduzir o vídeo no sentido temporal oposto (andar para trás no tempo / marcha-atrás / $t \to 0$ ou de B para A no Loop), em velocidade normal ou lenta (0.25x, 0.5x, 1.0x) e em loop A-B, sincronizado com a inferência do MediaPipe.

---

## 1. Clarificação e Desambiguação de Conceitos

| Conceito | O que Faz | Onde se Aplica | Estado |
| :--- | :--- | :--- | :--- |
| **🪞 Espelho Horizontal** | Inverte visualmente o plano horizontal (`scale(-1, 1)` no canvas) para câmaras frontais ou vídeos gravados do lado oposto. | Topo da barra de modos (`source-mode-bar`). | Mantido e clarificado como `🪞 Espelho Horizontal`. |
| **◀ Sentido Oposto (Marcha-Atrás)** | **Reprodução temporal reversa**: o vídeo anda para trás no tempo ($t \to 0$ ou $t_{\text{fim}} \to t_{\text{início}}$ no Loop). | Controlos do leitor de vídeo (`video-player-controls`). | **Em Implementação Ativa.** |

---

## 2. Desafio Técnico & Arquitetura Web

No elemento nativo `<video>` do HTML5, definir `video.playbackRate = -1` **não é suportado** pelas especificações do Chromium, WebKit e Gecko (lança a exceção `NotSupportedError` ou congela o vídeo).

### Solução de Engenharia:
Implementação de um **Motor de Reprodução Temporal Reversa de Alta Precisão** em `VideoUploadManager`:
1. **Loop Contínuo com `requestAnimationFrame`**:
   - Medição do delta de tempo ($\Delta t = (t_{\text{atual}} - t_{\text{anterior}}) / 1000$).
   - Decremento da posição do vídeo:
     $$\text{currentTime}_{\text{novo}} = \text{currentTime} - (\Delta t \times |\text{playbackRate}|)$$
2. **Integração com Loop A-B**:
   - Quando o vídeo atinge o Ponto A ($t \le \text{loopStart}$), reinicia no Ponto B ($t = \text{loopEnd}$), mantendo o ciclo contínuo em sentido inverso.
3. **Integração sem Loop (Fronteira $t = 0$)**:
   - Ao atingir o início do vídeo ($t \le 0$), pausa suavemente no segundo 0 e despacha o evento `onEnded`.
4. **Sincronização com a Inferência MediaPipe**:
   - Em `PosePipelineRunner`, a cada atualização de `video.currentTime` (mesmo com vídeo pausado nativamente), a condição de inferência é satisfeita e a IA atualiza os ângulos articulares, KOPS, PSI e feedback em tempo real.
5. **Interface Reativa (UI/UX)**:
   - Seletor de direção: `▶ Sentido Normal` $\longleftrightarrow$ `◀ Sentido Oposto`.
   - Botão dinâmico: `▶ Reproduzir` / `◀ Marcha-Atrás` / `⏸ Pausa`.
   - Suporte a todas as velocidades: `0.25x`, `0.5x`, `1.0x`.
   - Indicador HUD em tempo real: `⏪ REVERSO (-0.5x)`.

---

## 3. Checklist de Execução por Fases

- [x] **Fase 0: Documentação Técnica e Especificação** (`03_REPRODUCAO_VIDEO_SENTIDO_OPOSTO_REVERSE.md`).
- [x] **Fase 1: Motor de Reprodução Reversa em `VideoUploadManager.js`**
  - [x] Propriedades: `playbackDirection`, `isReversePlaying`, `reverseAnimFrameId`, `lastReverseTime`.
  - [x] Métodos: `playReverse()`, `pauseReverse()`, `setPlaybackDirection(dir)`, `togglePlay()`.
  - [x] Wrap-around no Loop A-B reverso e paragem suave em $t=0$.
- [x] **Fase 2: Suporte em `PosePipelineRunner.js`**
  - [x] Adicionado `setReverseMode(active)` para manter a contagem de frames de câmara e inferência ativa em marcha-atrás.
- [x] **Fase 3: Integração Reativa no Orquestrador `LiveCameraCapture.js`**
  - [x] Estado `playbackDirection: 'forward' | 'reverse'`, `isReversePlaying: boolean`.
  - [x] Métodos `setPlaybackDirection(dir)`, `togglePlaybackDirection()`, `playReverseVideo()`.
  - [x] Atualização do HUD overlay com etiqueta de sentido oposto.
- [x] **Fase 4: Controlos na UI em `LiveCameraCapture.html`**
  - [x] Comutador direcional `▶ Sentido Normal` / `◀ Sentido Oposto`.
  - [x] Botão de reprodução adaptável `▶ Reproduzir` / `◀ Marcha-Atrás`.
  - [x] Botão direto `⏪ Recuar`.
  - [x] Clarificação definitiva do botão `🪞 Espelho Horizontal` (reflexão ótica).
- [x] **Fase 5: Estilos CSS em `styles/video-analysis.css` e `LiveCameraCapture.css`**
  - [x] Estilos para botões de direção ativos e badge HUD reverso com pulsação ciano/violeta.
- [x] **Fase 6: Compilação, Testes e Validação**
  - [x] Executado `npm run build` na pasta `frontend/mediapipe/` (Sucesso: código de saída 0).
  - [x] Executado `pytest tests/` no backend (18/18 testes aprovados).

---

## 4. Registo de Execução em Direto

- **Passo 1:** Clarificação conceptual e documentação arquitetural no ficheiro `.md`.
- **Passo 2:** Implementado motor de decremento contínuo via `requestAnimationFrame` em `VideoUploadManager.js`.
- **Passo 3:** Sincronizado `PosePipelineRunner.js` para inferência e taxa de FPS em marcha-atrás.
- **Passo 4:** Criados métodos e estado direcional reativo em `LiveCameraCapture.js`.
- **Passo 5:** Integrados botões `▶ Normal` / `◀ Sentido Oposto` e `⏪ Recuar` no leitor de vídeo, renomeando o botão visual para `🪞 Espelho Horizontal`.
- **Passo 6:** Estilos visuais dinâmicos adicionados a `video-analysis.css` e badge HUD.
- **Passo 7:** Build de produção (`npm run build`) concluído com 0 erros e 18 testes unitários/integração validados com sucesso.

