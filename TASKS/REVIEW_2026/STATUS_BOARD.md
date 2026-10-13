# STATUS BOARD — Plano de Implementação do Code Review

> **Status global:** 🔴 0/18 concluídas · **Última atualização:** 2026-10-13 · **Mantido por:** todos os executores (ver [protocolo](00_PROTOCOLO_LLM.md) §3)
> Legenda: 🔴 TODO · 🟡 IN_PROGRESS · 🔵 REVIEW · 🟢 DONE · ⛔ BLOCKED

## Quadro

| ID | Tarefa | Prio | Depende de | Status | Progresso | Atribuído | Atualizado |
|---|---|---|---|---|---|---|---|
| [R01](R01_REPO_RESTRUCTURE.md) | Reestruturação `backend/ frontend/ desktopapp/` + pacote `athletemotion` | P0 | — | 🔵 REVIEW | 9/9 | Antigravity | 2026-10-13 |
| [R02](R02_DOMAIN_ANGLES_FEET_STABILIZER.md) | Correção biomecânica: ângulos em pixels, pés, estabilizador | P0 | R01 | 🔵 REVIEW | 8/8 | Antigravity | 2026-10-13 |
| [R03](R03_ENGINE_SESSIONS_CONCURRENCY.md) | Motor por ligação, concorrência DML, lifespan | P0 | R01 | 🔴 TODO | 0/8 | — | 2026-10-13 |
| [R04](R04_SECURITY_AUTH_CORS_HEADERS.md) | Auth, bind local, CORS, headers, erros, rate limit | P0 | R01 | 🔴 TODO | 0/9 | — | 2026-10-13 |
| [R05](R05_SECURITY_UPLOAD_WS_GIF_INPUT.md) | Hardening upload / WebSocket / GIF / validação | P0 | R01, R04 | 🔴 TODO | 0/9 | — | 2026-10-13 |
| [R06](R06_PRIVACY_GDPR.md) | RGPD: consentimento, exportar, apagar, cifra | P1 | R01, R07 | 🔴 TODO | 0/8 | — | 2026-10-13 |
| [R07](R07_DATABASE_ALEMBIC_INDEXES.md) | BD: Alembic, índices, SQLAlchemy 2, configuração | P1 | R01 | 🔴 TODO | 0/8 | — | 2026-10-13 |
| [R08](R08_SESSIONS_SERVICE_REFACTOR.md) | Serviço de relatórios, idempotência, paginação, batch | P1 | R01, R07 | 🔴 TODO | 0/8 | — | 2026-10-13 |
| [R09](R09_AI_COACH_REWRITE.md) | AI Coach determinístico, i18n, sem valores inventados | P0 | R01 | 🔴 TODO | 0/7 | — | 2026-10-13 |
| [R10](R10_CYCLE_DETECTOR_BDC_TDC.md) | Deteção de ciclos, BDC/TDC, cadência | P0 | R02 | 🔴 TODO | 0/9 | — | 2026-10-13 |
| [R11](R11_CALIBRATION_SCALE.md) | Calibração: ArUco, pedivela, lente, roll | P1 | R02 | 🔴 TODO | 0/8 | — | 2026-10-13 |
| [R12](R12_BIKEFIT_MEASURES_QUALITY.md) | Medidas extra, qualidade/confiança, vista frontal | P1 | R10, R11 | 🔴 TODO | 0/9 | — | 2026-10-13 |
| [R13](R13_MODELS_RTMPOSE_TRACKING_MANIFEST.md) | RTMPose Halpe26, associação de pessoa, manifest de modelos | P1 | R02, R03 | 🔴 TODO | 0/9 | — | 2026-10-13 |
| [R14](R14_PERF_BACKENDS_PIPELINE_AUTOTUNE.md) | Backends (DML/OpenVINO), pipeline, INT8, autotune | P1 | R03, R13 | 🔴 TODO | 0/10 | — | 2026-10-13 |
| [R15](R15_CI_QUALITY_SUPPLYCHAIN_OBSERVABILITY.md) | CI, lint/tipos, auditoria, observabilidade | P1 | R01 | 🔴 TODO | 0/9 | — | 2026-10-13 |
| [R16](R16_FRONTEND_REFACTOR_PRIVACY_OFFLINE.md) | Frontend: refactor, privacidade, offline, testes, TS | P1 | R01, R04 | 🔴 TODO | 0/9 | — | 2026-10-13 |
| [R17](R17_REPORTS_VALIDATION_SCIENCE.md) | Relatório PDF, rastreabilidade, validação científica | P2 | R10, R12 | 🔴 TODO | 0/7 | — | 2026-10-13 |
| [R18](R18_DOCS_CONSOLIDATION.md) | Consolidação de documentação e ADRs | P2 | — | 🔴 TODO | 0/6 | — | 2026-10-13 |

## Ordem de execução recomendada (ondas)

| Onda | Tarefas (podem correr em paralelo dentro da onda) |
|---|---|
| 0 | **R01** (sozinha — move ficheiros) · R18 (só docs) |
| 1 | R02 · R03 · R04 · R07 · R09 · R15 |
| 2 | R05 · R06 · R08 · R10 · R11 · R13 · R16 |
| 3 | R12 · R14 |
| 4 | R17 |

> Conflitos de ficheiros entre tarefas da mesma onda estão listados no campo **Âmbito** de cada tarefa. Em caso de dúvida, serializar.

## Bloqueios ativos
_(nenhum)_

## Decisões em aberto (humano)
| # | Pergunta | Afeta | Resposta |
|---|---|---|---|
| D1 | Licença: usar Ultralytics (AGPL-3.0) é aceitável para distribuição? Se não, migrar para RTMDet/RTMPose (Apache-2.0). | R13, R14 | — |
| D2 | Multi-utilizador (auth por utilizador) ou uso local single-user com token? | R04, R06 | — |
| D3 | Cifrar BD com SQLCipher (dependência nativa) ou só campos sensíveis? | R06 | — |
| D4 | Manter `frontend/mediapipe` em vue-cli ou migrar para Vite? | R16 | — |
