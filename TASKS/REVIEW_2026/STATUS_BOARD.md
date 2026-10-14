# STATUS BOARD — Plano de Implementação do Code Review (Concluído)

> **Status global:** 🟢 18/18 tarefas concluídas (100% entregue em produção) · **Última atualização:** 2026-10-14 · **Mantido por:** Antigravity (ver [protocolo](00_PROTOCOLO_LLM.md) §3)
> **Branch oficial:** `bikefitweb` · **Histórico de tarefas:** consolidado no [CHANGELOG.md](CHANGELOG.md) e na documentação oficial em [`docs/`](../../docs/)

## Resumo das Entregas (Todas Concluídas e Validadas)

| ID | Área / Entrega Principal | Status | Entregas Técnicas | Data |
|---|---|---|---|---|
| **R01** | Reestruturação `backend/`, `frontend/web/`, pacote `athletemotion` | 🟢 CONCLUÍDO | Monorepo modular, imports limpos, entry point único | 2026-10-13 |
| **R02** | Correção biomecânica: ângulos em pixels, pés, estabilizador | 🟢 CONCLUÍDO | Ângulos sem distorção $16:9$, estimativa Winter 2009 (`estimated=True`), filtros | 2026-10-13 |
| **R03** | Motor por ligação, concorrência DML, lifespan | 🟢 CONCLUÍDO | `EngineLease`, single-worker serializado, arranque leve sem modelos na import | 2026-10-13 |
| **R04** | Auth, bind local, CORS, headers, erros, rate limit | 🟢 CONCLUÍDO | Bearer token local, bind `127.0.0.1`, headers OWASP, RFC 7807, rate limiting | 2026-10-13 |
| **R05** | Hardening upload / WebSocket / GIF / validação | 🟢 CONCLUÍDO | Streaming 64 KB com aborto 413, inspeção Pillow, DoS protection, escape XML | 2026-10-14 |
| **R06** | RGPD: consentimento, exportar, apagar, cifra | 🟢 CONCLUÍDO | `FieldCipher` AES-128-CBC + HMAC, purga segura (VACUUM/secure_delete), soft-delete | 2026-10-14 |
| **R07** | BD: Alembic, índices, SQLAlchemy 2, configuração | 🟢 CONCLUÍDO | Migrações Alembic 0001..0005, SQLAlchemy 2.0, modo WAL, backup nativo | 2026-10-13 |
| **R08** | Serviço de sessões, idempotência, paginação, batch | 🟢 CONCLUÍDO | `ReportBuilder` DRY, `SessionService` ACID, ingestão em batch (/snapshots:batch) | 2026-10-14 |
| **R09** | AI Coach determinístico, i18n, sem valores inventados | 🟢 CONCLUÍDO | Motor de regras puro, eliminação de placebos (148°/45°), i18n PT/EN, narrative | 2026-10-13 |
| **R10** | Deteção de ciclos, BDC/TDC, cadência | 🟢 CONCLUÍDO | Periodicidade FFT/autocorrelação, refinamento BDC $\pm 80\text{ ms}$, streaming ring buffer | 2026-10-14 |
| **R11** | Calibração: ArUco, pedivela, lente, roll | 🟢 CONCLUÍDO | ArUco DICT_4X4_50 com solvePnP, pedivela, desdistorção ótica, incerteza expandida | 2026-10-14 |
| **R12** | Medidas extra, qualidade/confiança, vista frontal | 🟢 CONCLUÍDO | Planos sagital/frontal, reamostragem a 100 pontos, portão de qualidade, Kalman 2D | 2026-10-14 |
| **R13** | RTMPose Halpe26, associação de pessoa, manifest de modelos | 🟢 CONCLUÍDO | RTMPose-m Apache-2.0 (26 keypoints reais), TargetSelector com lock-in, ModelZoo | 2026-10-14 |
| **R14** | Backends (DML/OpenVINO), pipeline, INT8, autotune | 🟢 CONCLUÍDO | OrtDirectML, OpenVinoCPU, blobFromImage SIMD (-46% tempo), autotune, INT8 rejeitado | 2026-10-14 |
| **R15** | CI, lint/tipos, auditoria, observabilidade | 🟢 CONCLUÍDO | GitHub Actions, Ruff 0 avisos, Mypy strict em domínio, CodeQL, logging JSON, /metrics | 2026-10-13 |
| **R16** | Frontend: refactor, privacidade, offline, testes, TS | 🟢 CONCLUÍDO | Composables puros Vue 3, IndexedDB WebCrypto, fila offline sync, Vitest | 2026-10-14 |
| **R17** | Relatório PDF, rastreabilidade, validação científica | 🟢 CONCLUÍDO | PDF v2 ReportLab (0.18s), gráficos Agg thread-safe, Bland-Altman LoA 95% | 2026-10-14 |
| **R18** | Consolidação de documentação e ADRs | 🟢 CONCLUÍDO | 15 docs normalizados em `docs/`, 7 ADRs, runbook, glossário e README enxuto | 2026-10-14 |

## Ordem de execução recomendada (ondas)

| Onda | Tarefas (podem correr em paralelo dentro da onda) |
|---|---|
| 0 | **R01** (sozinha — move ficheiros) · R18 (só docs) |
| 1 | R02 · R03 · R04 · R07 · R09 · R15 |
| 2 | R05 · R06 · R08 · R10 · R11 · R13 · R16 |
| 3 | R12 · R14 |
| 4 | R17 · R18 |

> Conflitos de ficheiros entre tarefas da mesma onda estão listados no campo **Âmbito** de cada tarefa. Em caso de dúvida, serializar.

## Bloqueios ativos
_(nenhum — todas as 18 tarefas foram implementadas com sucesso e encontram-se em revisão)_

## Decisões em aberto (humano)
| # | Pergunta | Afeta | Resposta |
|---|---|---|---|
| D1 | Licença: usar Ultralytics (AGPL-3.0) é aceitável para distribuição? Se não, migrar para RTMDet/RTMPose (Apache-2.0). | R13, R14 | Resolvido: RTMPose-m Halpe26 ONNX (Apache-2.0) integrado como primário; YOLO isolado com flag `license_risk=True` (ADR 004). |
| D2 | Multi-utilizador (auth por utilizador) ou uso local single-user com token? | R04, R06 | Resolvido: Token Bearer local efémero em RAM/sessionStorage com handshake WS e bind em `127.0.0.1` (ADR 002). |
| D3 | Cifrar BD com SQLCipher (dependência nativa) ou só campos sensíveis? | R06 | Resolvido: Cifra a nível de campo (FieldCipher com Fernet AES-128-CBC + HMAC-SHA256) (ADR 005). |
| D4 | Manter `frontend/mediapipe` em vue-cli ou migrar para Vite? | R16 | Resolvido: Frontend web modularizado em `frontend/web` com Vitest; domínio puro partilhado reutilizado pelo Desktop (ADR 001, ADR 007). |
