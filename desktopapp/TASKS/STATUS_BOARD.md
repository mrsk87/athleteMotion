# STATUS BOARD — Desktop App (PyQt6)

> **Status global:** 🔴 0/16 concluídas (1 em REVIEW) · **Última atualização:** 2026-10-13 · **Mantido por:** todos os executores ([protocolo](00_PROTOCOLO_LLM.md))
> Legenda: 🔴 TODO · 🟡 IN_PROGRESS · 🔵 REVIEW · 🟢 DONE · ⛔ BLOCKED · Dependências `Rxx` = tarefas do [board do backend](../../TASKS/REVIEW_2026/STATUS_BOARD.md)

| ID | Tarefa | Prio | Depende de | Status | Progresso | Atribuído | Atualizado |
|---|---|---|---|---|---|---|---|
| [D01](D01_SCAFFOLD_ENV.md) | Scaffold, ambiente, janela vazia, tema, logging | P0 | R01 (diferida) | 🔵 REVIEW | 8/8 | Buffy (Codebuff) | 2026-10-13 |
| [D02](D02_HARDWARE_DIAGNOSTICS_SETTINGS.md) | Diagnóstico de hardware e definições | P1 | D01 | 🔴 TODO | 0/7 | — | 2026-10-13 |
| [D03](D03_CAPTURE_MODULE.md) | Módulo de captura (câmara/ficheiro) | P0 | D01 | 🔴 TODO | 0/8 | — | 2026-10-13 |
| [D04](D04_PREPROCESS_RING_BUFFER.md) | Pré-processamento + ring buffer em memória partilhada | P0 | D01 | 🔴 TODO | 0/8 | — | 2026-10-13 |
| [D05](D05_INFERENCE_PROCESS_PIPELINE.md) | Processo de inferência + pipeline + watchdog | P0 | D03, D04, R14 | 🔴 TODO | 0/9 | — | 2026-10-13 |
| [D06](D06_MODEL_ZOO_DOWNLOAD.md) | Model zoo, download verificado, RTMPose no desktop | P1 | D01, R13 | 🔴 TODO | 0/7 | — | 2026-10-13 |
| [D07](D07_UI_SHELL_GL_CANVAS.md) | UI shell + canvas OpenGL + HUD | P0 | D01 | 🔴 TODO | 0/9 | — | 2026-10-13 |
| [D08](D08_LIVE_VIEW_BIKEFIT.md) | Vista Live + domínio bikefit (ciclos, calibração, gráficos) | P0 | D05, D07, R10, R11, R12 | 🔴 TODO | 0/10 | — | 2026-10-13 |
| [D09](D09_VIDEO_ANALYSIS_VIEW.md) | Análise de vídeo gravado, A/B, exportação com AMF | P1 | D05, D07 | 🔴 TODO | 0/8 | — | 2026-10-13 |
| [D10](D10_PERSISTENCE_GDPR_SYNC.md) | Persistência local, RGPD, sincronização opcional | P1 | D01, R06, R07, R08 | 🔴 TODO | 0/8 | — | 2026-10-13 |
| [D11](D11_REPORTS_EXPORT_VIEW.md) | Vista de relatório e exportações | P1 | D08, D10, R17 | 🔴 TODO | 0/6 | — | 2026-10-13 |
| [D12](D12_BENCHMARK_METRICS_VIEW.md) | Vista Benchmark/Diagnóstico + overlay de métricas | P1 | D05, D07, D02 | 🔴 TODO | 0/7 | — | 2026-10-13 |
| [D13](D13_ROBUSTNESS_LONGRUN.md) | Robustez: crash handler, reconnect, corridas longas | P1 | D05, D08 | 🔴 TODO | 0/8 | — | 2026-10-13 |
| [D14](D14_TESTING_CI.md) | Testes (pytest-qt), portões de desempenho, CI Windows | P0 | D01 | 🔴 TODO | 0/7 | — | 2026-10-13 |
| [D15](D15_PACKAGING_INSTALLER.md) | Empacotamento, instalador, assinatura, atualização | P1 | D08, D09, D10, D13 | 🔴 TODO | 0/8 | — | 2026-10-13 |
| [D16](D16_EXTRAS_OPTIONAL.md) | Extras opcionais: ncnn/Vulkan, ViTPose, LLM local, API local | P3 | D05, D15 | 🔴 TODO | 0/6 | — | 2026-10-13 |

## Ondas
| Onda | Tarefas |
|---|---|
| 0 | D01 (🔵 REVIEW · 8/8) · D14 (após D01) |
| 1 | D02 · D03 · D04 · D07 (paralelo) |
| 2 | D05 · D06 · D10 |
| 3 | D08 · D09 · D12 |
| 4 | D11 · D13 |
| 5 | D15 → D16 |

> **Pré-requisitos do backend:** R01 (pacote), R14 (backends/pipeline), R13 (modelos), R10/R11/R12 (domínio de ciclos/calibração/medidas), R06/R07/R08 (dados), R17 (relatório). Sem eles, D05/D08/D11 ficam ⛔ BLOCKED.

## Bloqueios ativos
- **R01 🟡 IN_PROGRESS** (executada em paralelo por Antigravity; `backend/` e `athletemotion` já em disco) → ainda não está 🟢 DONE, pelo que o desktop **não declara ainda** a dependência `athletemotion @ file:../backend` no `pyproject.toml`.
  - D01: *`import athletemotion`* **verificado por PYTHONPATH** (evidência 9.8); a instalação editável fica diferida até R01 🟢 DONE.
  - **D05, D06, D08, D09, D10, D11, D12, D13, D15, D16** permanecem bloqueadas (R14/R13/R10–R12/R06–R08/R17 em 🔴).

## Decisões em aberto (humano)
| # | Pergunta | Afeta | Resposta |
|---|---|---|---|
| E1 | Câmara alvo: USB/UVC (modelo? resolução/FPS?) ou também câmaras de telemóvel via rede (RTSP/NDI)? | D03 | — |
| E2 | Aceita-se renderização com `QOpenGLWidget` (OpenGL) ou prefere-se `QRhi/QQuick` (Qt Quick)? | D07 | — |
| E3 | Distribuição: apenas uso interno ou comercial (assinatura de código, AGPL do Ultralytics)? | D15, D06 | — |
| E4 | Gravar vídeo da sessão: por defeito desligado — confirmar política e retenção | D09, D10 | — |
