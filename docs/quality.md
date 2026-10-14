# Diretrizes de Qualidade, CI, Segurança e Observabilidade

> **Status:** 🟢 VIGENTE · **Versão:** 0.3.1 · **Última atualização:** 2026-10-14 · **Responsável:** Senior Core Developer · **Revisto contra o código em:** `788dcbb`
> **Módulo:** CI/CD & Observabilidade · **Referência:** R15

Este documento detalha os portões de qualidade estática, políticas de testes, auditoria de dependências e observabilidade implementados no **Athlete Motion** (referência da tarefa `R15` e secções §1.11, §2.12 e §2.13 do `CODE_REVIEW.md`).

---

## 1. Portões de Qualidade (Quality Gates)

O pipeline de Integração Contínua (CI) e o fluxo de trabalho local impõem as seguintes garantias antes da integração em `main`:

| Portão | Ferramenta | Alvo / Escopo | Política / Critério de Sucesso |
|---|---|---|---|
| **Formatação** | `ruff format` | Todo o repositório (`backend/`) | Zero divergências em relação ao estilo PEP 8 / Black |
| **Linting** | `ruff check` | `src/`, `tests/`, `scripts/` | Zero avisos ativos (`E`, `F`, `I`, `B`, `UP`, `S`, `C4`, `SIM`, `RUF`) |
| **Tipagem Estrita** | `mypy --strict` | `domain/biomechanics`, `schemas/` | Modo estrito sem `Any` implícito e sem erros de tipagem |
| **Testes Unitários & Integração** | `pytest` | `backend/tests/` | 100% de testes verdes determinísticos |
| **Cobertura de Código** | `pytest-cov` | Pacote `athletemotion` | Limiar mínimo obrigatório (`--cov-fail-under=70%`) com baseline medido de 75% |
| **Vulnerabilidades Python** | `pip-audit` | Dependências instaladas | Zero vulnerabilidades de severidade Alta ou Crítica |
| **Vulnerabilidades Frontend** | `npm audit` | Dependências de produção (`frontend/web`) | Zero vulnerabilidades de severidade Alta ou Crítica |
| **Sincronização SemVer** | Script Git | `backend/VERSION` vs `package.json` | Paridade obrigatória de versão SemVer 2.0.0 |
| **Prevenção de Ficheiros Grandes** | `pre-commit` | Todo o repositório | Bloqueio de commits de pesos/modelos > 1 MB |

---

## 2. Como Executar os Portões Localmente

### 2.1. Backend (Python)

No ambiente virtual do backend (`backend/`):

```powershell
# 1. Análise estática e ordenação de imports
python -m ruff check src tests scripts

# 2. Verificação de formatação
python -m ruff format --check src tests scripts

# 3. Verificação de tipos estritos no domínio e esquemas
python -m mypy src/athletemotion/domain/biomechanics src/athletemotion/schemas

# 4. Execução da suíte de testes com cobertura
python -m pytest -v --cov=athletemotion --cov-fail-under=70 --cov-report=term-missing

# 5. Auditoria de vulnerabilidades de dependências
python -m pip_audit
```

### 2.2. Frontend (Web)

No diretório do frontend (`frontend/web/`):

```bash
# 1. Instalação determinística
npm ci

# 2. Compilação de produção
npm run build

# 3. Scripts de validação e coerência
npm run verify

# 4. Auditoria de segurança
npm audit --omit=dev --audit-level=high
```

---

## 3. Git Hooks e Pre-Commit

O repositório suporta validação automática antes de cada commit e push.

### 3.1. Instalação dos Hooks
Para instalar os hooks nativos e o framework pre-commit:

```powershell
python backend/scripts/install_hooks.py
```

### 3.2. Configuração do `.pre-commit-config.yaml`
O pre-commit valida:
- Espaços em branco supérfluos (`trailing-whitespace`).
- Linhas finais em ficheiros (`end-of-file-fixer`).
- Sintaxe válida de JSON e YAML (`check-yaml`, `check-json`).
- Prevenção de commits de modelos grandes (`check-added-large-files --maxkb=1000`).
- Lint e formatação imediata via Ruff.
- Verificação de consistência da versão SemVer.

---

## 4. Observabilidade e Probes de Saúde

### 4.1. Logging Estruturado em JSON (`logging_config.py`)
Em produção, os logs são estruturados em formato JSON para ingestão por agentes de telemetria (Datadog, Loki, CloudWatch):

```json
{
  "timestamp": "2026-10-14 00:15:17",
  "level": "INFO",
  "logger": "athlete_motion.api.app",
  "message": "Mecanismo de autenticação ativo.",
  "request_id": "req-98765",
  "duration_ms": 12.4
}
```

Os logs são gravados com rotação automática (`RotatingFileHandler`, max 10 MB, 5 backups) no diretório de dados da aplicação (`APP_DATA_DIR/logs/athletemotion.log`).

### 4.2. Endpoints de Saúde (`/health`)

- **`GET /health/live` (Liveness Probe):**
  - Confirma que o processo HTTP está responsivo.
  - Retorna `200 OK` com `{"status": "alive"}`. Isento de autenticação.
- **`GET /health/ready` (Readiness Probe):**
  - Valida a conectividade ativa à base de dados SQLite (`SELECT 1;`) e o estado operacional do gestor de concorrência (`EngineManager`).
  - Retorna `200 OK` com `{"status": "ready", "database": "ok", "version": "...", "active_leases": 0}` quando operacional.
  - Retorna `503 Service Unavailable` em caso de falha de conexão à base de dados ou falha de inicialização de motores, sem expor credenciais ou caminhos internos.
