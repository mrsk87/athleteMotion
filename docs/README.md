# Centro de Documentação Técnica do Athlete Motion

> **Status:** 🟢 VIGENTE · **Versão:** 0.3.1 · **Última atualização:** 2026-10-14 · **Responsável:** Senior Core Developer · **Revisto contra o código em:** `788dcbb`

Bem-vindo ao índice central da documentação técnica e arquitetural do **Athlete Motion**. Todos os documentos deste diretório são mantidos em estrita sincronia com a base de código e respeitam as diretrizes de integridade de engenharia (`AGENTS.md`).

---

## 1. Inventário de Documentação e Matriz de Vigência

A tabela seguinte cataloga todos os documentos técnicos do repositório, o seu propósito, estado de vigência e conformidade com o código real:

| Documento | Propósito Principal | Estado | Destino | Conformidade com o Código Real |
|---|---|:---:|:---:|---|
| [architecture.md](architecture.md) | Arquitetura de software unificada, diagramas de blocos Mermaid e fluxo de dados | 🟢 Vigente | Manter | 100% alinhado com Strategy engines, DirectML, Staged Pipeline e SQLite WAL |
| [security.md](security.md) | Baseline de segurança, autenticação local Bearer, headers OWASP e rate limiting | 🟢 Vigente | Manter | Reflete `SecurityHeadersMiddleware`, CORS estrito e tokens voláteis |
| [limits.md](limits.md) | Limites defensivos, streaming de uploads, payload WS e timeouts DoS | 🟢 Vigente | Manter | Mapeia `ApiSettings` e validação Pydantic |
| [privacy.md](privacy.md) | Proteção de dados RGPD, consentimento explícito, cifra de landmarks e purga | 🟢 Vigente | Manter | Conforme com migração 0004 e `FieldCipher` Fernet AES |
| [database.md](database.md) | Modelo relacional, migrações Alembic, índices parciais e conformidade ACID | 🟢 Vigente | Manter | Conforme com Alembic 0001..0005 e SQLAlchemy 2.0 |
| [cycle-detection.md](cycle-detection.md) | Deteção pura de ciclos de pedalada, BDC/TDC, cadência e streaming | 🟢 Vigente | Manter | Mapeia `domain/cycle` e refinamento fisiológico de BDC |
| [calibration.md](calibration.md) | Calibração espacial métrica, ArUco, pedivela, roda e correção de distorção ótica | 🟢 Vigente | Manter | Mapeia `domain/calibration` e `CameraProfileModel` |
| [measures.md](measures.md) | Métricas biomecânicas sagitais e frontais, scoring de qualidade e filtro de Kalman | 🟢 Vigente | Manter | Mapeia `domain/measures` e citações bibliográficas |
| [performance.md](performance.md) | Desempenho de inferência, matriz baseline, autotune e INT8 em Haswell AVX2 | 🟢 Vigente | Manter | Dados reais medidos no Xeon E5-1660 v3 e RX 580 |
| [quality.md](quality.md) | Garantia de qualidade, matriz CI/CD, linters (Ruff/Mypy), testes e CodeQL | 🟢 Vigente | Manter | Conforme com GitHub Actions e 218 testes automatizados |
| [validation/README.md](validation/README.md) | Protocolo de validação científica, ensaios clínicos e ferramentas Bland-Altman | 🟢 Vigente | Manter | Conforme com `validation/runner.py` e LoA 95% |
| [runbook.md](runbook.md) | Guia operacional prático de instalação, arranque, migrações e testes | 🟢 Vigente | Manter | Comandos PowerShell e CLI verificados |
| [glossary.md](glossary.md) | Glossário técnico e biomecânico de termos, ângulos e conceitos | 🟢 Vigente | Manter | Definições padronizadas |
| [status.md](status.md) | Sumário consolidado de estado de desenvolvimento e cobertura de tarefas | 🟢 Vigente | Manter | Conforme com 17/18 tarefas do plano fechadas |
| [adr/](adr/) | Registos de Decisão de Arquitetura (Architecture Decision Records) | 🟢 Vigente | Manter | ADR 001 a 007 com decisões D1 a D4 do board |
| `archive/*` | Documentos históricos e especificações legadas arquivadas | 🟡 Histórico | Arquivar | Preservados para rastreabilidade histórica com nota de descontinuação |

---

## 2. Mapa de Navegação por Área de Interesse

- **Para Desenvolvedores de Backend:** Consulte [architecture.md](architecture.md), [database.md](database.md), [performance.md](performance.md) e [runbook.md](runbook.md).
- **Para Especialistas de Biomecânica e Clínicos:** Consulte [measures.md](measures.md), [cycle-detection.md](cycle-detection.md), [calibration.md](calibration.md) e [validation/README.md](validation/README.md).
- **Para Oficiais de Segurança e DPO (RGPD):** Consulte [security.md](security.md), [privacy.md](privacy.md) e [limits.md](limits.md).
- **Para Engenheiros de QA e DevOps:** Consulte [quality.md](quality.md), [runbook.md](runbook.md) e [adr/](adr/).
