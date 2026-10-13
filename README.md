# Athlete Motion 🚴‍♂️📊

> **Análise Biomecânica de Postura para Ciclismo em Tempo Real / Real-time Cycling Posture Analysis**  
> **Língua Principal / Native Language:** Português (PT) | **Secondary:** English (EN)  
> **Versão Corrente / Current SemVer:** Consulte [`VERSION`](VERSION) (atualmente `0.1.0`)  
> **Estado do Projeto / Status:** Protótipo Funcional / Em Refatoração & Estruturação — Consulte [`STATUS.md`](STATUS.md)

---

## 1. Sobre o Projeto / About

O **Athlete Motion** é uma aplicação de análise postural computacional desenvolvida para ciclistas (*BikeFit*). Utiliza visão computacional (Google MediaPipe e OpenCV) combinada com uma aplicação web reativa (Vue 3) e uma API de alta performance (FastAPI) para detectar articulações do ciclista, calcular ângulos ergonómicos e fornecer feedback visual imediato em tempo real.

O projeto foi auditado e reestruturado para seguir **Clean Architecture**, **princípios ACID** na persistência de sessões, **código limpo de fácil manutenção para juniores**, **suporte bilingue com Português como língua-mãe** e um sistema automatizado de **versionamento SemVer (Major.Minor.Patch)** integrado ao Git.

---

## 2. Documentação e Boas Práticas / Engineering Documentation

| Ficheiro | Descrição |
| :--- | :--- |
| 🔍 [`CODE_REVIEW.md`](CODE_REVIEW.md) | **Auditoria Técnica Sénior:** Análise profunda de arquitetura, vulnerabilidades de segurança, concorrência MediaPipe e conformidade ACID. |
| 🏛️ [`ARCHITECTURE.md`](ARCHITECTURE.md) | **Arquitetura do Sistema:** Clean Architecture (Domínio, Aplicação, Infraestrutura, Apresentação), modelo transacional ACID e ciclo de vida. |
| 📐 [`STANDARDS.md`](STANDARDS.md) | **Padrões de Código & Boas Práticas:** Guia para juniores e seniores, tipagem Pydantic, eliminação de números mágicos e regras ACID. |
| 📈 [`STATUS.md`](STATUS.md) | **Estado do Projeto:** Matriz de saúde dos módulos, histórico de atualizações e **Regra de Ouro** de atualização obrigatória. |
| 🤝 [`CONTRIBUTING.md`](CONTRIBUTING.md) | **Guia de Contribuição:** Convenções de commits, fluxo de branches e ciclo de releases SemVer. |
| 🤖 [`IMPLEMENTATION_PROMPTS/`](IMPLEMENTATION_PROMPTS/) | **Catálogo de Prompts para LLMs:** Tarefas modulares prontas para outros agentes de IA executarem correções, implementações e novas features sem erros. |

---

## 3. Arquitetura e Tecnologias

- **Backend:** Python 3.11+, FastAPI, OpenCV, Google MediaPipe, NumPy, Pydantic.
- **Frontend:** Vue 3 (Composition API / Options API), HTML5 Canvas, Web Audio API, Axios.
- **Internacionalização:** Módulo reativo `i18n.js` com Português por omissão e alternância dinâmica para Inglês.
- **Persistência Planeada (ACID):** SQLite em modo WAL (Write-Ahead Logging) com Unit of Work transacional.
- **Automação & CI/CD:** GitHub Actions com autoincremento SemVer e tags de release automáticas.

---

## 4. Instalação e Execução

### 4.1. Pré-requisitos
- Python 3.11 ou superior
- Node.js 18 ou superior & npm
- Git

### 4.2. Instalação do Backend
```bash
cd backend
uv venv --python 3.11
# No Windows:
.venv\Scripts\activate
# No Linux/macOS:
source .venv/bin/activate

# Instalar pacote em modo editável com dependências
pip install -e ".[dev,directml]"
cd ..
```

### 4.3. Instalação do Frontend
```bash
cd frontend/web
npm install
cd ../..
```

### 4.4. Executar os Serviços
Em terminais separados:

**1. Servidor Backend (FastAPI):**
```bash
python -m athletemotion.api
```
- API Swagger / OpenAPI: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`
- Informação de versão: `http://localhost:8000/api/version`

**2. Aplicação Frontend (Vue 3):**
```bash
cd frontend/web
npm run serve
```
- Aceda no browser em: `http://localhost:8080`

**Ou Início Rápido Unificado:**
- Windows PowerShell: `.\start.ps1`
- Windows CMD: `start.bat`

---

## 5. Sistema de Versionamento SemVer Automático

A versão da aplicação é gerida centralmente pelo ficheiro [`backend/VERSION`](backend/VERSION) e sincronizada automaticamente com o `package.json` do frontend e com a API backend.

### 5.1. Instalação dos Git Hooks Locais
Para garantir que o Git valida o versionamento antes de qualquer envio remoto (`push`):
```bash
python backend/scripts/install_hooks.py
```

### 5.2. Comandos do Utilitário de Versão
```bash
# Consultar a versão atual
python backend/scripts/bump_version.py --current

# Simular o próximo incremento
python backend/scripts/bump_version.py --dry-run patch

# Incrementar manualmente
python backend/scripts/bump_version.py patch
python backend/scripts/bump_version.py minor
python backend/scripts/bump_version.py major

# Auto-detetar pelo último commit convencional
python scripts/bump_version.py --auto
```

### 5.3. Automação no GitHub Actions
Quando um commit é integrado na branch `main`:
- Mensagens com `#major`, `feat!:` ou `BREAKING CHANGE:` disparam bump **MAJOR**.
- Mensagens com `#minor` ou `feat:` disparam bump **MINOR**.
- Outros commits (`fix:`, `refactor:`, etc.) disparam bump **PATCH**.
- O GitHub Actions atualiza `VERSION`, cria a tag Git `vX.Y.Z` e publica as notas de release no GitHub.

---

## 6. Como Usar o Analisador de Postura (BikeFit)

1. Posicione a sua bicicleta de lado em relação à câmara (em rolo de treino ou suporte estático).
2. Certifique-se de que quadril, joelho e tornozelo estão claramente iluminados e visíveis.
3. No topo da página, selecione o idioma desejado (Português ou Inglês).
4. Clique em **Iniciar Análise**:
   - Ângulos a **Verde**: Dentro da faixa ergonómica recomendada.
   - Ângulos a **Vermelho**: Fora do intervalo ideal, necessitando de ajuste no selim ou guiador.
5. Consulte o painel inferior de recomendações biomecânicas personalizadas.

---

## 7. English Summary

Athlete Motion is a real-time cycling biomechanical posture analyzer using MediaPipe, OpenCV, FastAPI, and Vue 3. Built on Clean Architecture and strict ACID persistence principles, it guarantees junior-friendly maintainability, automated SemVer incrementation upon Git pushes, and complete bilingual support with Portuguese as the primary native language. Review [`CODE_REVIEW.md`](CODE_REVIEW.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and [`STATUS.md`](STATUS.md) before contributing, and explore [`IMPLEMENTATION_PROMPTS/`](IMPLEMENTATION_PROMPTS/) for AI-ready tasks.

---

## Licença

Projeto sob licença MIT. Consulte `LICENSE.md` para mais informações.
