# R01 — Reestruturação do repositório: `backend/ frontend/ desktopapp/`

> **ID:** R01 · **Prioridade:** P0 · **Onda:** 0 (executar sozinha)
> **Status:** 🟡 IN_PROGRESS · **Progresso:** 0/9 · **Atribuído a:** Antigravity · **Início:** 2026-10-13 · **Última atualização:** 2026-10-13
> **Depende de:** — · **Bloqueia:** todas as outras (R02–R17) · **Branch:** `chore/r01-restructure` · **PR:** —
> **Referência:** CODE_REVIEW §2.11, §6 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
O backend vive na raiz (`src/`, `server.py`, `main.py`, `tests/`, `models/`, `scripts/`, `pyproject.toml`, `uv.lock`, `VERSION`), o frontend em `frontend/mediapipe/`. Existem dois ambientes virtuais na raiz (`.venv/` e `bin/ lib64 share pyvenv.cfg`), `__pycache__`, `.pytest_cache`, `athlete_motion.db*` (ignorados pelo Git mas a poluir). Há 5 entry points (`main.py`, `server.py`, `start.py`, `start.bat`, `start.ps1`).

## 2. Objetivo
Estrutura final **sem alterar lógica**:
```
athleteMotion/
├─ backend/   (src/athletemotion/{api,domain,infrastructure,schemas,services}, models/, scripts/, tests/, pyproject.toml, uv.lock, VERSION)
├─ frontend/  (web/ = antigo frontend/mediapipe)
├─ desktopapp/
├─ docs/      (vazio por agora; R18 preenche)
├─ TASKS/     (inalterado)
└─ .github/
```
O pacote passa a `athletemotion` (instalável com `pip install -e backend`), para o desktop reutilizar o domínio.

## 3. Âmbito
**Mexe:** tudo (apenas `git mv` + ajustes de imports/caminhos). **Não mexe:** lógica de negócio, frontend src, conteúdo de documentos (exceto caminhos).

## 4. Subtarefas
- [ ] **1. Branch limpa e baseline.** `git status` limpo; correr `pytest` e guardar resultado (baseline) em *Evidências*. Se já falhar antes de mexer, registar quais testes.
- [ ] **2. `git mv`** com histórico: `src → backend/src/athletemotion`, `tests → backend/tests`, `models → backend/models` (só `README.md` é versionado; mover pesos locais com `Move-Item` sem `git add`), `scripts → backend/scripts`, `pyproject.toml`, `uv.lock`, `requirements.txt`, `VERSION`, `version.py → backend/src/athletemotion/version.py`, `frontend/mediapipe → frontend/web`.
- [ ] **3. Renomear imports** `from src.` / `import src.` / relativos `...domain` → `athletemotion.`. Usar `ruff`/`sed` e depois `python -c "import athletemotion"`. Corrigir `ROOT_DIR = parents[2]` em `infrastructure/database.py` e `MODELS_DIR = parents[3]` em `mediapipe_engine.py` (passar a `athletemotion.config.paths`, ver passo 5).
- [ ] **4. `pyproject.toml`** com `[project]`, `requires-python = ">=3.11,<3.13"`, `packages` em `src/`, extras: `[dev]` (pytest, pytest-asyncio, httpx, ruff, mypy), `[directml]` (`onnxruntime-directml`), `[openvino]`. **Remover `requirements.txt`** como fonte (gerar a partir do lock se alguém precisar). Pytest/httpx saem das dependências de produção.
- [ ] **5. Módulo `athletemotion/config/paths.py`**: `APP_DATA_DIR` (env `ATHLETE_DATA_DIR`, default `%APPDATA%/AthleteMotion`), `MODELS_DIR` (env `ATHLETE_MODELS_DIR`, default `backend/models`), `DATABASE_URL` (env `ATHLETE_DB_URL`, default `sqlite:///{APP_DATA_DIR}/athlete_motion.db`). Substituir todos os caminhos fixos. **Não migrar a BD sozinho:** documentar em `README` como mover `athlete_motion.db` (R07 trata da migração).
- [ ] **6. Entry point único:** `python -m athletemotion.api` (cria `athletemotion/api/__main__.py` com `uvicorn.run("athletemotion.api.app:app", host=settings.host, port=settings.port)`, **host default `127.0.0.1`** — o resto da segurança é R04). Mover o conteúdo de `server.py` para `athletemotion/api/app.py`. Apagar `main.py`, `server.py`, `start.py`; `start.ps1`/`start.bat` passam a chamar o módulo.
- [ ] **7. Limpeza:** apagar do disco (não versionados) `bin/`, `lib64`, `share/`, `pyvenv.cfg`, `__pycache__`, `.pytest_cache`; mover `athlete_motion.db*` para `%APPDATA%/AthleteMotion/` (guardar cópia de segurança antes!). Atualizar `.gitignore` (adicionar `backend/models/*` exceto `README.md`/`manifest.json`, `frontend/web/node_modules`, `frontend/web/dist`, `desktopapp/.venv`).
- [ ] **8. CI/scripts:** atualizar `.github/workflows/ci.yml` e `release.yml` (`working-directory`, caminhos do `VERSION`/`package.json`), `scripts/bump_version.py` e `scripts/install_hooks.py`, `scripts/find-unused.mjs`. **Não** corrigir o problema `onnxruntime-directml`-em-Ubuntu aqui (R15), apenas manter os jobs a correr com os novos caminhos.
- [ ] **9. Documentação mínima:** atualizar caminhos em `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`; cabeçalho de `CODE_REVIEW.md` §6 marcado `✅ Resolvido em R01`; atualizar a tabela de caminhos em `00_PROTOCOLO_LLM.md` para “estado atual”.

## 5. Critérios de aceitação
- `cd backend && pip install -e .[dev,directml] && pytest` → **mesmo resultado que o baseline** (mesmos testes verdes).
- `python -m athletemotion.api` arranca e `GET http://127.0.0.1:8000/health` devolve `ok`.
- `cd frontend/web && npm ci && npm run build` passa.
- `grep -R "from src" backend` e `grep -R "import src" backend` → 0 resultados.
- Raiz contém **apenas**: `backend/ frontend/ desktopapp/ docs/ TASKS/ .github/ .gitignore README.md CONTRIBUTING.md ARCHITECTURE.md CODE_REVIEW.md STANDARDS.md STATUS.md …` (sem ficheiros de venv, db ou `*.py`).
- `git log --follow` preserva histórico dos ficheiros movidos (usar `git mv`).

## 6. Verificação
```powershell
git status --short | Measure-Object
cd backend; uv venv --python 3.11; uv pip install -e ".[dev,directml]"; pytest -q
python -m athletemotion.api   # noutro terminal: curl http://127.0.0.1:8000/health
cd ../frontend/web; npm ci; npm run build
```

## 7. Riscos / Fora de âmbito
- Ficheiros grandes de modelos locais: mover com `Move-Item`, não com Git.
- Não alterar nomes de rotas, schemas ou comportamento. Qualquer bug visto → *Notas*, não corrigir aqui.
- Fora de âmbito: segurança (R04), BD (R07), CI avançado (R15).

## 8. Prompt específico
```text
Executa a tarefa R01 (TASKS/REVIEW_2026/R01_REPO_RESTRUCTURE.md) seguindo o Prompt mestre do protocolo.
Faz APENAS movimentos e ajustes de imports/caminhos, sem mudar lógica. Usa git mv. Faz baseline de pytest antes e prova no fim que é idêntico.
Cria antes uma cópia de segurança de athlete_motion.db* fora do repositório.
```

## 9. Evidências
_(colar aqui baseline e resultado final de pytest, build, /health)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
