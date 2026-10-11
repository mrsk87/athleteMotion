# 02_SLIDER_SCRUBBER_INTERVALO_VIDEO.md

# Funcionalidade: Deslizador de Vaivém de Alta Precisão no Intervalo de Vídeo (Jog/Shuttle Range Scrubber)

> **Objetivo:** Permitir ao utilizador selecionar um intervalo/período de tempo de um vídeo e deslizar livremente para a frente e para trás com um slider dedicado, controlando manualmente a velocidade do movimento (fotograma a fotograma ou contínuo) para inspecionar posições biomecânicas exatas da pedalada (ex.: BDC, 90°, TDC).

---

## 1. Requisitos do Utilizador

1. **Seleção de Período do Vídeo:**
   - Poder marcar um ponto inicial $[A]$ e um ponto final $[B]$ (ou definir um intervalo temporal de análise da pedalada).
2. **Deslizador Dedicado ao Intervalo $[A, B]$:**
   - Quando um intervalo está ativo, surge um slider calibrado estritamente para essa janela de tempo (`min = A`, `max = B`), permitindo máxima sensibilidade e amplitude no ecrã.
3. **Vaivém Manual Bidirecional ("Andar para a Frente e para Trás"):**
   - Ao arrastar o slider com o rato ou toque, o vídeo desloca-se para a frente e para trás à velocidade manual com que o utilizador move o cursor.
   - Atualização síncrona do fotograma de vídeo e repintura do canvas com esqueleto, traçado fantasma e ângulos medidos nesse instante exato.
4. **Controlos de Passo Fino (Fotograma a Fotograma):**
   - Botões de micro-passo ($\pm 1$ fotograma / $\sim 30\text{ms}$ e $\pm 0.1\text{s}$) para navegar com precisão cirúrgica até ao ponto exato do ciclo da pedalada.
5. **Indicadores Visuais de Posição:**
   - Marcador da posição atual relativa ao intervalo: `[A: 3.40s] ──●────── [B: 5.20s] (+0.80s / 44% do ciclo)`.

---

## 2. Arquitetura da Solução

```
+---------------------------------------------------------------------------------+
|                                 ÁREA DE VÍDEO                                   |
|   +-------------------------------------------------------------------------+   |
|   |  Vídeo com Esqueleto + Traçado Fantasma + Linhas de Prumo KOPS          |   |
|   +-------------------------------------------------------------------------+   |
|                                                                                 |
|   Slider Geral do Vídeo: [0.0s] ──────────●───────────────────── [12.4s]        |
|                                                                                 |
|   Intervalo A-B Definido: [A = 3.20s] → [B = 4.80s] (Duração: 1.60s / 1 ciclo)  |
|                                                                                 |
|   DESLIZADOR DE ALTA PRECISÃO DO INTERVALO:                                     |
|   [A: 3.20s] ═══════════════●═════════════════════════════════ [B: 4.80s]       |
|                                                                                 |
|   Controlos de Vaivém Manual:                                                   |
|   [ ⏪ -0.1s ] [ ◀ -1 Frame ] [ ⏸ / ▶ ] [ +1 Frame ▶ ] [ +0.1s ⏩ ]            |
|   Posição Atual no Intervalo: 3.92s (+0.72s | 45% do ciclo)                      |
+---------------------------------------------------------------------------------+
```

---

## 3. Plano de Implementação por Fases

- [x] **Fase 1: Atualização do Módulo `VideoUploadManager`**
  - Adicionar suporte a scrubbing com preservação do estado de reprodução (`isScrubbing`, pausa durante arrasto e retoma opcional).
  - Adicionar métodos de micro-passo temporal: `stepFrame(direction, fps)` e `stepTime(delta)`.
  - Adicionar suporte a limites estritos dentro do intervalo $[A, B]$.

- [x] **Fase 2: Integração Reativa no Orquestrador `LiveCameraCapture.js`**
  - Adicionar propriedades computadas e reativas para o slider de intervalo:
    * `isRangeScrubbing`: booleano de estado de arrasto.
    * `rangeRelativeCurrentTime`: tempo atual dentro do intervalo $[A, B]$.
    * `rangeProgressPercent`: percentagem decorrida dentro do intervalo.
    * `stepRangeFrame(deltaFrames)`: salto de $\pm 1$ fotograma (a 30 fps $\approx 0.033\text{s}$).
    * `stepRangeSeconds(delta)`: micro-avanço de $\pm 0.1\text{s}$.
  - Garantir atualização imediata do MediaPipe Pose / Overlay canvas ao mudar o tempo manualmente.

- [x] **Fase 3: Interface no Template `LiveCameraCapture.html`**
  - Renderizar o bloco do Deslizador de Alta Precisão quando `loopRange.start > 0 || loopRange.end > 0 || loopRange.enabled`.
  - Slider com escala expandida e `step="0.01"`.
  - Barra de vaivém manual com botões de micro-passo e tempo relativo.

- [x] **Fase 4: Estilos Modernos em `styles/video-analysis.css`**
  - Estilização do slider com gradiente vibrante, botões de jog-wheel e indicador numérico mono-espaçado de alta visibilidade.

- [x] **Fase 5: Testes e Validação**
  - Compilação de produção com `npm run build` (0 erros).
  - Execução dos testes com `pytest tests/` (18/18 testes a passar).
  - Commit das alterações e documentação técnica.

---

## 4. Registo de Execução

*Estado:* 🟢 **Concluído e Validado com Sucesso.**  
- Deslizador de alta precisão do período selecionado (`range-scrubber-box`) implementado com escala de 0.01s.
- Controlo manual contínuo e fotograma a fotograma ($\pm 1$ frame e $\pm 0.1\text{s}$).
- Integração síncrona com renderização do esqueleto, traçado fantasma e inferência MediaPipe.
