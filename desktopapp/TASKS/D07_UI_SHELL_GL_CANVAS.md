# D07 — UI shell, canvas OpenGL e HUD

> **ID:** D07 · **Prioridade:** P0 · **Onda:** 1
> **Status:** 🔴 TODO · **Progresso:** 0/9 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D01 · **Bloqueia:** D08, D09, D12 · **Branch:** `feat/d07-ui-canvas` · **PR:** —
> **Referência:** README_PLAN §4.1 (render), §6 · **Decisão humana E2** · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
O custo de `QImage→QPixmap` por frame na CPU é alto. O caminho desejado: textura GL atualizada com `glTexSubImage2D`, esqueleto/HUD desenhados por cima. Esta tarefa constrói os **widgets reutilizáveis** com dados simulados (não depende do pipeline real).

## 2. Objetivo
`VideoCanvas` (QOpenGLWidget) de alto desempenho, `SkeletonOverlay`, `AngleHud`, `SignalPlot` (pyqtgraph) e *view-models* base, com **gerador de dados falso** para desenvolver/testar sem câmara.

## 3. Âmbito
**Cria:** `ui/widgets/{video_canvas.py,skeleton_overlay.py,angle_hud.py,signal_plot.py,status_bar.py}`, `ui/viewmodels/base.py`, `ui/fake/fake_stream.py`, `ui/theme/*`, testes `tests/ui`.
**Altera:** `ui/main_window.py` (D01).
**Não mexe:** pipeline real, domínio.

## 4. Subtarefas
- [ ] **1. `VideoCanvas`:** `QOpenGLWidget` (GL 3.3 core ou 2.1 compat — testar na RX 580), textura RGB/BGR com `glTexSubImage2D` (PBO opcional), *aspect-fit* com barras, zoom/pan (roda/arrasto), espelhar H, rotação 90°; `set_frame(np.ndarray|memoryview, t_ns)`; **nunca** copia o frame mais de uma vez; fallback `QPainter` se GL indisponível (aviso).
- [ ] **2. Sincronização/ritmo:** *render* guiado por `QTimer`(vsync) ou `update()` sob pedido; descartar frames se a UI estiver atrasada; contador de FPS de UI e tempo de `paintGL` (expostos às métricas D12); meta ≤ 3 ms em 720p (medir).
- [ ] **3. `SkeletonOverlay`:** desenhar landmarks/ossos com `QPainter` sobre o GL (ou *shader*), cores por lado, **estimados a tracejado/transparentes** (campo `estimated` do domínio), visibilidade → opacidade; ângulos arcos com valores; tudo em coordenadas normalizadas + transformação de viewport.
- [ ] **4. `AngleHud`:** painel compacto (joelho BDC/TDC, anca, tornozelo, tronco, cotovelo, cadência, qualidade) com estados `ok/low/high/insufficient/withheld`, **nunca** mostra valor `withheld`, formatação PT/EN, atualização ≤ 10 Hz (suavizada visualmente, sem alterar o dado).
- [ ] **5. `SignalPlot` (pyqtgraph):** curva do tornozelo/joelho em tempo real com *ring buffer* de N s, marcadores BDC/TDC, faixa alvo; uso de `setData` incremental, `downsample`/`clipToView`, `useOpenGL` opcional; 60 FPS sem crescer memória.
- [ ] **6. Base MVVM leve:** `ViewModel` com `Signal`s tipados; regras: view sem lógica de negócio; teste que a view-model funciona sem widgets.
- [ ] **7. `FakeStream`:** gera frames sintéticos (padrão + esqueleto a pedalar a 60–90 RPM) com timestamps; permite desenvolver e testar tudo sem câmara; configurável (FPS, ruído, dropouts).
- [ ] **8. Testes UI (`pytest-qt`, offscreen):** criação/destruição sem *leaks* (contar objetos Qt), `set_frame` 1000× sem crescimento de memória, *snapshot* visual do HUD/overlay com tolerância (`QImage` comparado por *hash perceptual* ou diferença média), teste de que a *main thread* não excede 8 ms por *slot* (instrumentar).
- [ ] **9. Acessibilidade e tema:** contraste AA, tamanhos de fonte escaláveis, atalhos (`Space` pausa, `S` snapshot, `F11` ecrã inteiro, `F12` métricas), foco visível; documentar. Atualizar `README_PLAN`, board/changelog.

## 5. Critérios de aceitação
- Com `FakeStream` a 60 FPS 720p: UI fluida; `paintGL` p95 dentro da meta (ou desvio documentado); RSS estável em 5 min.
- Overlay desenha estimados distintos e `withheld` nunca visível.
- Funciona sem GL (fallback) e avisa.
- Testes UI verdes em offscreen.

## 6. Verificação
```powershell
cd desktopapp
$env:QT_QPA_PLATFORM="offscreen"; pytest tests/ui -q
python -m athletemotion_desktop.ui.fake --fps 60 --size 1280x720     # demo manual
```

## 7. Riscos / Fora de âmbito
- Drivers AMD antigos podem ter bugs em PBO/GL core: preferir caminho simples e medir.
- Decisão E2 (Qt Quick/QRhi) pode mudar o widget; manter `VideoCanvas` atrás de interface `FrameSink`.

## 8. Prompt específico
```text
Executa a tarefa D07 (desktopapp/TASKS/D07_UI_SHELL_GL_CANVAS.md) seguindo o Prompt mestre do desktop.
Constrói widgets reutilizáveis com FakeStream. glTexSubImage2D sem cópias extra. Estimados a tracejado; withheld nunca visível. Mede paintGL e memória.
```

## 9. Evidências
_(tempos de paintGL, memória, capturas)_

## 10. Notas e Descobertas
_(vazio — incluir resposta E2)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
