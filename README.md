# Athlete Motion 🚴‍♂️📊

[![CI Quality Gates](https://github.com/mrsk87/athleteMotion/actions/workflows/ci.yml/badge.svg)](https://github.com/mrsk87/athleteMotion/actions/workflows/ci.yml)
[![CodeQL Security Analysis](https://github.com/mrsk87/athleteMotion/actions/workflows/codeql.yml/badge.svg)](https://github.com/mrsk87/athleteMotion/actions/workflows/codeql.yml)
[![Code style: ruff](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json)](https://github.com/astral-sh/ruff)
[![Checked with mypy](https://www.mypy-lang.org/static/mypy_badge.svg)](https://mypy-lang.org/)
[![Tests Passing](https://img.shields.io/badge/tests-218%20passed-success)](backend/tests/)

> **Plataforma Profissional de Análise Biomecânica de Postura e BikeFit em Tempo Real**  
> **Língua Principal:** Português (PT) | **Secondary:** English (EN)  
> **Versão Corrente:** `0.3.1` (consulte [`backend/VERSION`](backend/VERSION))  
> **Estado:** 100% das tarefas concluídas (18/18) — Consulte [`docs/status.md`](docs/status.md)

---

## 1. Sobre o Projeto

O **Athlete Motion** é um ecossistema de software avançado para análise biomecânica e postural de ciclistas (*BikeFit*). Combina visão computacional de alta fidelidade (**RTMPose-m Halpe26**, **YOLO11n-Pose**, **MediaPipe** e marcadores fiduciários **ArUco**) com uma arquitetura desacoplada em três frentes:
1. **Domínio Biomecânico Puro:** Cinemática angular, deteção fisiológica de BDC/TDC, calibração métrica e portão de qualidade.
2. **API REST & WebSocket de Alta Performance:** Pipeline assíncrono com aceleração por hardware (DirectML GPU e OpenVINO CPU).
3. **Apresentação Reativa:** Aplicação Web (Vue 3, Pinia, ECharts) e Aplicação Desktop (PyQt6).

---

## 2. Mapa do Repositório (Monorepo)

```text
athleteMotion/
├── backend/                  # Servidor FastAPI, WebSocket e Domínio Puro
│   ├── src/athletemotion/    # Pacote canónico Python (domain, infrastructure, services, api)
│   ├── tests/                # 218 testes automatizados (unit, integration, e2e)
│   ├── scripts/              # Utilitários operacionais (benchmark, backup, modelos)
│   └── models/               # Manifest criptográfico SHA-256 e modelos ONNX
├── frontend/web/             # Aplicação Web (Vue 3, Pinia, ECharts, Vitest)
├── desktopapp/               # Aplicação nativa Desktop de Estúdio (PyQt6)
├── docs/                     # Documentação técnica consolidada e ADRs
└── TASKS/REVIEW_2026/        # Plano de modernização executado e changelog
```

---

## 3. Guia Rápido de Instalação e Execução

### 3.1 Backend
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .[dev,directml,openvino]
uvicorn athletemotion.server:app --host 127.0.0.1 --port 8000 --reload
```
- **Documentação Interativa (Swagger):** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Token de Autenticação:** Gerado automaticamente em `%APPDATA%/AthleteMotion/api_token`

### 3.2 Frontend Web
```powershell
cd frontend/web
npm install
npm run dev
```

---

## 4. Índice de Documentação Técnica

Toda a documentação técnica foi consolidada e normalizada dentro de [`docs/`](docs/):

- 🏛️ **[Arquitetura Global](docs/architecture.md):** Diagramas de camadas, fluxo de inferência WebSocket e modelo de dados.
- 📐 **[ADRs (Architecture Decision Records)](docs/adr/):** Decisões fundamentais D1 a D4 (DirectML, RTMPose, cifra RGPD, monorepo).
- ⚙️ **[Manual Operacional (Runbook)](docs/runbook.md):** Guia prático de comandos, migrações Alembic e testes.
- 🚀 **[Engenharia de Desempenho](docs/performance.md):** Benchmarks de 300 frames, latências DirectML/OpenVINO e autotune.
- 🚴‍♂️ **[Medidas Biomecânicas](docs/measures.md):** Planos sagital e frontal, portão de qualidade e referências científicas.
- 🔄 **[Deteção de Ciclos BDC/TDC](docs/cycle-detection.md):** Algoritmo de refinamento fisiológico de BDC e cadência.
- 🎯 **[Calibração Espacial](docs/calibration.md):** Marcadores ArUco, conversão px/mm e correção de distorção ótica de lente.
- 🔒 **[Segurança e Rede](docs/security.md):** Autenticação Bearer, headers OWASP e rate limiting.
- 🛡️ **[Privacidade e RGPD](docs/privacy.md):** Cifra de dados biométricos em repouso (Fernet AES) e purga agendada.
- 🧪 **[Validação Científica](docs/validation/README.md):** Protocolo experimental e testes de concordância de Bland-Altman.
- 📖 **[Glossário Técnico](docs/glossary.md):** Definições padronizadas de termos biomecânicos e computacionais.

---

## 5. Qualidade e Testes

O projeto segue padrões estritos de qualidade impostos por CI/CD:
```powershell
cd backend
pytest -q                  # 218 testes automatizados 100% verdes
ruff check src/ tests/     # Zero erros de estilo e segurança
mypy --strict ...          # Tipagem estrita no domínio puro
```

Consulte [docs/quality.md](docs/quality.md) e [CONTRIBUTING.md](CONTRIBUTING.md) para detalhes de contribuição.
