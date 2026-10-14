# Manual Operacional e Guia de Execução (Runbook) — Athlete Motion

> **Status:** 🟢 VIGENTE · **Versão:** 0.3.1 · **Última atualização:** 2026-10-14 · **Responsável:** Senior Core Developer · **Revisto contra o código em:** `788dcbb`

Este documento fornece instruções passo a passo para instalação, execução diária, testes, migrações e resolução de problemas operacionais no **Athlete Motion**.

---

## 1. Configuração do Ambiente Local

### 1.1 Pré-requisitos de Sistema
- **Sistema Operativo:** Windows 10/11 (64-bit) para aceleração DirectML por GPU, ou Linux/macOS em modo CPU.
- **Python:** Python 3.11 ou 3.12 (compatível com `onnxruntime-directml` e `openvino`).
- **Node.js:** Versão 20+ LTS e npm.

### 1.2 Instalação do Backend
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -e .[dev,directml,openvino]
```

### 1.3 Instalação do Frontend
```powershell
cd frontend/web
npm install
```

---

## 2. Inicialização dos Serviços

### 2.1 Arrancar Servidor Backend (FastAPI + WebSocket)
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn athletemotion.server:app --host 127.0.0.1 --port 8000 --reload
```
- **Documentação Swagger UI:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Verificação de Saúde (Liveness):** [http://127.0.0.1:8000/health/live](http://127.0.0.1:8000/health/live)
- **Token de Autenticação:** Gerado automaticamente em `%APPDATA%/AthleteMotion/api_token`.

### 2.2 Arrancar Servidor de Desenvolvimento Frontend
```powershell
cd frontend/web
npm run dev
```

---

## 3. Gestão e Manutenção da Base de Dados

O Athlete Motion utiliza SQLite com WAL e migrações versionadas pelo **Alembic**.

### 3.1 Aplicar Migrações Pendentes
```powershell
cd backend
alembic upgrade head
```

### 3.2 Criar Nova Migração
```powershell
cd backend
alembic revision --autogenerate -m "descricao_da_migracao"
```

### 3.3 Executar Backup Online Seguro
```powershell
cd backend
python scripts/backup_db.py --out backups/
```

---

## 4. Gestão de Modelos de Inteligência Artificial

### 4.1 Download e Verificação Criptográfica de Hashes SHA-256
```powershell
cd backend
python scripts/fetch_models.py --all --verify
```
Verifica todos os modelos contra `backend/models/manifest.json`.

---

## 5. Ferramentas de Linha de Comandos (CLI)

O Athlete Motion disponibiliza comandos operacionais através do módulo CLI unificado:

### 5.1 Calibração Automática de Hardware (Autotune)
Analisa CPU, GPU DirectML e RAM, gerando o ficheiro de perfis de motor `hardware_profile.json`:
```powershell
cd backend
python -m athletemotion.cli autotune
```

### 5.2 Purga de Retenção de Dados Pessoais (RGPD)
Elimina definitivamente registos de atletas cujo prazo legal de retenção expirou:
```powershell
cd backend
python -m athletemotion.cli purge
```

### 5.3 Runner de Validação Científica
Compara estimativas de modelos contra conjuntos de dados de verdade-terreno:
```powershell
cd backend
python -m athletemotion.validation.runner --dataset tests/data/synthetic_validation --engines fake
```

### 5.4 Matriz de Benchmarks de Desempenho
Mede a latência (p50, p95, p99) e FPS de todos os modelos e backends ao longo de 300 fotogramas:
```powershell
cd backend
python scripts/benchmark_matrix.py --frames 300
```

---

## 6. Verificação de Qualidade e Testes

### 6.1 Executar Bateria Completa de Testes Unitários e Integração
```powershell
cd backend
pytest -q
```

### 6.2 Verificação de Linting e Tipagem Estrita
```powershell
cd backend
ruff check src/ tests/
mypy --strict src/athletemotion/domain/ src/athletemotion/services/reporting/ src/athletemotion/validation/
```

---

## 7. Diagnósticos e Resolução de Problemas (Troubleshooting)

| Sintoma | Causa Mais Provável | Ação de Resolução |
|---|---|---|
| `HTTP 401 Unauthorized` | Requisição sem cabeçalho Bearer token | Leia `%APPDATA%/AthleteMotion/api_token` e envie `Authorization: Bearer <token>` |
| `DirectML execution provider not available` | `onnxruntime` padrão instalado em vez do pacote DirectML | Execute `pip uninstall onnxruntime` e instale apenas `pip install onnxruntime-directml` |
| `Port 8000 already in use` | Instância anterior de Uvicorn ficou pendurada | Execute `Get-Process python \| Stop-Process` no PowerShell |
| `ModelUnavailableError: 409 Conflict` | Modelo ONNX em falta na pasta `models/` | Execute `python scripts/fetch_models.py --all --verify` |
