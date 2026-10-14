# Estado Consolidado do Projeto — Athlete Motion

> **Status:** 🟢 VIGENTE · **Versão:** 0.3.1 · **Última atualização:** 2026-10-14 · **Responsável:** Senior Core Developer · **Revisto contra o código em:** `788dcbb`

---

## 1. Resumo Executivo e Progresso

O projeto **Athlete Motion** atingiu a maturidade arquitetural e técnica de nível Senior Core Developer com a conclusão do plano de modernização de 2026 (`TASKS/REVIEW_2026/`):

- **Progresso Global do Plano de Tarefas:** **18 / 18 Tarefas Concluídas (100%)**
- **Testes Unitários e de Integração:** **218 / 218 testes verdes** no backend (`pytest tests -q`)
- **Linters e Qualidade Estática:** `ruff check src/ tests/` (0 erros) · `mypy --strict` limpo
- **Segurança de Código (SAST):** CodeQL ativo, pip-audit sem vulnerabilidades conhecidas
- **Desempenho de Inferência:** YOLO11n-pose @ 4.12 ms / 241 FPS · RTMPose-m @ 8.20 ms / 119 FPS em DirectML (AMD Radeon RX 580)

---

## 2. Matriz de Tarefas do Plano de Engenharia (REVIEW_2026)

| ID | Área / Módulo | Prioridade | Onda | Estado | Entregas Principais |
|:---:|---|:---:|:---:|:---:|---|
| **R01** | Estrutura de Repositório | P0 | 0 | 🟢 Completo | Reestruturação `backend/src/athletemotion`, `frontend/`, `desktopapp/` |
| **R02** | Domínio e Biomecânica | P0 | 1 | 🟢 Completo | Ângulos euclidianos em pixels, estimador de pés Winter 2009 |
| **R03** | Concorrência e Lifespan | P0 | 1 | 🟢 Completo | Isolamento de motores por conexão, EngineLease, single-worker executor |
| **R04** | Linha de Base de Segurança | P0 | 1 | 🟢 Completo | Bearer token local em RAM, headers OWASP, rate limiting, CORS estrito |
| **R05** | Hardening de Entrada | P1 | 2 | 🟢 Completo | Limites de upload por streaming, inspeção Pillow contra decompression bombs |
| **R06** | Privacidade e RGPD | P1 | 2 | 🟢 Completo | Consentimento explícito, cifra de landmarks (Fernet AES), soft-delete e purga |
| **R07** | Base de Dados e Alembic | P0 | 1 | 🟢 Completo | Migrações Alembic 0001..0005, SQLAlchemy 2.0, modo WAL e integridade ACID |
| **R08** | Camada de Sessões | P1 | 2 | 🟢 Completo | ReportBuilder (DRY), SessionService ACID idempotente, ingestão em batch |
| **R09** | AI Coach Determinístico | P1 | 1 | 🟢 Completo | Motor de regras puro, eliminação de valores placebo, i18n bilíngue PT/EN |
| **R10** | Deteção de Ciclos BDC/TDC | P1 | 2 | 🟢 Completo | Detetor puro, refinamento fisiológico de BDC (±80ms), streaming ring buffer |
| **R11** | Calibração e Escala | P1 | 2 | 🟢 Completo | Calibração ArUco, pedivela, roda, correção de distorção ótica de lente |
| **R12** | Medidas BikeFit e Qualidade | P1 | 3 | 🟢 Completo | Planos sagital e frontal, portão de qualidade (score < 0.60), Kalman filter |
| **R13** | RTMPose e Rastreio | P1 | 2 | 🟢 Completo | RTMPose-m Halpe26 (Apache-2.0, 26 keypoints), TargetSelector anti-troca |
| **R14** | Desempenho e Autotune | P1 | 3 | 🟢 Completo | OrtDirectML, OpenVinoCPU, blobFromImage SIMD, autotune, INT8 rejeitado |
| **R15** | CI/CD e Observabilidade | P1 | 1 | 🟢 Completo | Matriz GitHub Actions, ruff, mypy strict, CodeQL, logging JSON, /metrics |
| **R16** | Refatoração Frontend | P1 | 2 | 🟢 Completo | Modularização Vue 3/Pinia, IndexedDB cifrado, offline sync resiliente |
| **R17** | Relatórios e Validação | P2 | 4 | 🟢 Completo | PDF auditável v2, gráficos thread-safe Agg, export CSV/JSON, Bland-Altman |
| **R18** | Consolidação de Docs e ADRs | P2 | 4 | 🟢 Completo | Docs centralizados em `docs/`, 7 ADRs, runbook operacional, glossário |

---

## 3. Serviços Ativos e Portas Operacionais

- **Backend API REST & WS:** `http://127.0.0.1:8000`
- **Frontend Web App:** `http://127.0.0.1:8080` (ou porta configurada)
- **Métricas Prometheus:** `http://127.0.0.1:8000/metrics` (requer Bearer token)
- **Health Checks:** `http://127.0.0.1:8000/health/live` e `/health/ready`

Para histórico anterior a Outubro de 2026, consulte o arquivo legado em [docs/archive/STATUS_LEGACY.md](archive/STATUS_LEGACY.md).
