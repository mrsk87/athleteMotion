# D09 — Análise de vídeo gravado, A/B, câmara lenta e exportação com AMF

> **ID:** D09 · **Prioridade:** P1 · **Onda:** 3
> **Status:** 🔴 TODO · **Progresso:** 0/8 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D05, D07 · **Bloqueia:** D15 · **Branch:** `feat/d09-video-analysis` · **PR:** —
> **Referência:** README_PLAN §6 (vista 4) · **Decisão humana E4** · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
O frontend web tem `VideoPlayerVLC.vue`, `TimelineScrubberAB.vue`, `TelemetrySyncChart.vue`, `BiomechanicalOverlayCanvas.vue` (referências de UX). No desktop o modo batch deve processar o vídeo **o mais depressa possível** (pipeline D05 sem limite de FPS), guardar landmarks por frame e permitir revisão frame-a-frame/câmara lenta sincronizada com gráficos.

## 2. Objetivo
Abrir vídeo, analisar em lote (com progresso e cancelamento), guardar resultados (`.npz`/SQLite) e rever com *scrubber*, loop A/B, velocidade 0.1–2×, passo ±1 frame, overlay e gráficos sincronizados; exportar clipe anotado e comparação antes/depois.

## 3. Âmbito
**Cria:** `runtime/batch/{analyzer.py,results_store.py}`, `services/video_export.py`, `ui/views/video_view.py`, `ui/widgets/{timeline_scrubber.py,sync_chart.py}`, `ui/viewmodels/video_vm.py`, testes.
**Reutiliza:** D03 `FileSource`, D05 pipeline, D07 widgets.
**Não mexe:** pipeline ao vivo, relatório (D11).

## 4. Subtarefas
- [ ] **1. `BatchAnalyzer`:** corre o pipeline D05 sobre `FileSource` sem limite de FPS, deterministicamente (um frame de cada vez; sem *drops* no modo batch), progresso/ETA/cancelar; guarda `FrameResult[]` (landmarks, ângulos, `t_pts_ns`, confiança) em `results_store` (`.npz` comprimido + metadados: modelo, hash, backend, calibração).
- [ ] **2. Throughput:** medir FPS de análise por backend (RX 580 DML vs OpenVINO CPU); usar `PIPELINE_MODE=staged`; tabela em *Evidências*; meta: ≥ 1.5× tempo real em 720p (se não, registar).
- [ ] **3. Player:** decode com `FileSource` + `VideoCanvas`; **PTS corretos** (sem *drift*), velocidade 0.1–2×, passo ±1 frame **exato**, *seek* preciso (não só ao keyframe) com cache de frames recentes; loop A/B com marcadores arrastáveis.
- [ ] **4. Gráficos sincronizados:** `sync_chart` com cursor vertical ligado ao frame atual (bidirecional: arrastar o cursor faz *seek*), marcadores BDC/TDC, faixa alvo; ângulos escolhidos (joelho, anca, tornozelo, tronco).
- [ ] **5. Revisão e correção:** ver/excluir ciclos, corrigir lado (L/R) retroativamente e **recalcular** com o domínio (R10/R12) sem reanalisar o vídeo; comparar 2 análises (antes/depois) lado a lado sincronizadas por ciclo (usa `SessionCycleSummary`).
- [ ] **6. Exportação de vídeo:** `video_export` com FFmpeg (via `imageio-ffmpeg`/PyAV ou binário empacotado — justificar) e **encoder por hardware** (`h264_amf` na RX 580; fallback `libx264`), overlay desenhado por `QPainter`/OpenCV nos frames, áudio ignorado; progresso e cancelamento; teste de equivalência de duração/nº de frames.
- [ ] **7. Política de vídeo (E4):** não copiar/gravar vídeo para a BD; apenas referência ao ficheiro (caminho/hash) e resultados; exportar GIF/MP4 anotado só a pedido; aviso de privacidade ao exportar.
- [ ] **8. Testes e docs:** vídeo sintético curto (gerado no teste) com pose conhecida: análise em lote reproduz ângulos (±0.5°); *seek/step* exatos; export tem nº de frames esperado; testes UI offscreen. Atualizar `README_PLAN`, board/changelog.

## 5. Critérios de aceitação
- Análise em lote determinística (duas execuções → resultados idênticos ±1e-6).
- Passo ±1 frame exato; velocidade e A/B sem *drift* de PTS (teste).
- Exportação com AMF funciona ou cai para `libx264` com aviso.
- UI responsiva durante análise e exportação.

## 6. Verificação
```powershell
cd desktopapp
pytest tests -k "batch or video or export" -q
python -m athletemotion_desktop.runtime.batch.analyzer --input tests/data/sample.mp4 --report
```

## 7. Riscos / Fora de âmbito
- AMF depende de driver; manter *fallback* CPU. Codecs/licenças (H.264) documentar.
- Edição de vídeo fora de âmbito.

## 8. Prompt específico
```text
Executa a tarefa D09 (desktopapp/TASKS/D09_VIDEO_ANALYSIS_VIEW.md) seguindo o Prompt mestre do desktop.
Modo batch determinístico sem drops. PTS exatos, passo ±1 frame exato. Recalcular por domínio sem reanalisar. Exportação com AMF e fallback. Não guardar vídeo na BD.
```

## 9. Evidências
_(throughput, testes, exportações)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
