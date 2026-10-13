# D01 — Scaffold, ambiente, janela vazia, tema e logging

> **ID:** D01 · **Prioridade:** P0 · **Onda:** 0
> **Status:** 🟡 IN_PROGRESS · **Progresso:** 6/8 · **Atribuído a:** Buffy (Codebuff) · **Início:** 2026-10-13 · **Última atualização:** 2026-10-13
> **Depende de:** R01 · **Bloqueia:** todas as D · **Branch:** `feat/d01-scaffold` · **PR:** —
> **Referência:** README_PLAN §2, §3, §15 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
`desktopapp/` só tem `README_PLAN.md` e `TASKS/`. O backend passa a pacote `athletemotion` (R01). O desktop deve instalá-lo em modo editável e reutilizar domínio/inferência. `onnxruntime` e `onnxruntime-directml` não coexistem.

## 2. Objetivo
Esqueleto executável: `python -m athletemotion_desktop` abre uma janela com tema escuro, painel de diagnóstico básico, logging estruturado, *crash hook* e internacionalização preparada. Estrutura de pastas da §2 do protocolo.

## 3. Âmbito
**Cria:** `pyproject.toml`, `src/athletemotion_desktop/{__init__,__main__,app}.py`, `config/{settings.py,paths.py}`, `ui/{main_window.py,theme/dark.qss,i18n/}`, `runtime/__init__.py`, `tests/`, `.gitignore`, `README.md` (como correr).
**Não mexe:** backend (só consome), restantes módulos (outras tarefas).

## 4. Subtarefas
- [x] **1. `pyproject.toml`:** `requires-python ">=3.11,<3.13"`; deps: `PyQt6>=6.7`, `pyqtgraph`, `numpy`, `opencv-python`, `psutil`, `py-cpuinfo`, `pydantic-settings`. Configurado empacotamento com hatchling, ruff e mypy.
- [x] **2. Ambiente reprodutível:** `scripts/dev_setup.ps1` com testes automáticos de módulos e documentação em `README.md`.
- [x] **3. Paths e settings:** `paths.py` com `%APPDATA%/AthleteMotion` e `settings.py` com validação Pydantic e persistência atómica ACID (`.tmp` + `os.replace`).
- [x] **4. `app.py`:** `QApplication`, single instance (`QLockFile`), `faulthandler.enable()`, deteção de conflitos ORT, `multiprocessing.freeze_support()` e spawn.
- [x] **5. Logging:** Rotação de logs em `%APPDATA%/AthleteMotion/logs/desktopapp.log` e consola.
- [x] **6. Janela e tema:** `MainWindow` com sidebar de navegação, `QStackedWidget`, tema escuro `dark.qss` e telemetria de hardware na status bar.
- [ ] **7. i18n:** `QTranslator` com `pt_PT.ts`/`en.ts`, todas as strings via `self.tr()`; seletor de idioma persistido; script `scripts/update_translations.ps1` (`pylupdate6`/`lrelease`).
- [ ] **8. Teste smoke:** `pytest-qt` abre a `MainWindow` offscreen, troca de vista, fecha sem exceções nem processos órfãos. Atualizar `README_PLAN.md` §12 (Fase 0 → 🟡/🔵) e board/changelog.

## 5. Critérios de aceitação
- `python -m athletemotion_desktop` abre a janela em < 2 s (medir) e fecha limpa.
- `import athletemotion` funciona a partir do desktop (domínio partilhado) — sem cópia de código.
- Falha de arranque se `onnxruntime` CPU conviver com DML (mensagem clara).
- Logs JSON gravados; *crash* simulado gera ficheiro `faulthandler` em `LOGS_DIR`.
- `ruff`, `mypy` (módulos criados), `pytest -q` verdes.

## 6. Verificação
```powershell
cd desktopapp
./scripts/dev_setup.ps1
python -m athletemotion_desktop
$env:QT_QPA_PLATFORM="offscreen"; pytest -q
```

## 7. Riscos / Fora de âmbito
- Conflito de versões `numpy`/`opencv`/`openvino`: fixar no lock e registar em *Notas*.
- Sem captura, inferência ou vistas funcionais (D03+).

## 8. Prompt específico
```text
Executa a tarefa D01 (desktopapp/TASKS/D01_SCAFFOLD_ENV.md) seguindo o Prompt mestre do desktop.
Cria só o esqueleto. Importa o backend como pacote editável; não copies código. Garante single-instance, crash hook, logging JSON e i18n PT/EN desde já.
```

## 9. Evidências
_(tempo de arranque, saída dev_setup, testes)_

## 10. Notas e Descobertas
- **(2026-10-13 · Buffy)** O protocolo exige dependências 🟢 DONE, mas **R01 continua 🔴 TODO**: não existe `backend/` nem o pacote `athletemotion`. Decisão do utilizador: **avançar só com o desktop**, executando as tarefas que não dependem do backend (D02–D04, D06, D07, D14) e marcando as restantes ⛔ BLOCKED no board. O critério de aceitação *`import athletemotion` funciona a partir do desktop* fica **diferido** (não é possível cumpri-lo sem R01).
- **(2026-10-13 · Buffy)** O ambiente da máquina só tem **Python 3.14**; o projeto exige `>=3.11,<3.13`. Criado `.venv` com **CPython 3.11.17** via `uv` (não há Python 3.11/3.12 instalado no sistema).
- **(2026-10-13 · Buffy)** **Sem `lrelease`:** o wheel do PyQt6 fornece apenas `pylupdate6`, não o `lrelease` do Qt Linguist. Para manter o repositório offline-first e sem binários de terceiros, os `.ts` (**fonte única de tradução**, atualizados por `scripts/update_translations.ps1`) são interpretados em runtime por um `QTranslator` especializado (`ui/i18n/translator.py`); se existir um `.qm` compilado, tem prioridade. Validado por sonda que `QTranslator.translate` reimplementado em Python é efetivamente invocado por `tr()`.
- **(2026-10-13 · Buffy)** As subtarefas 4 e 5 estavam marcadas `[x]` mas não cumpriam os critérios de aceitação (logs em texto simples sem rotação; conflito ORT apenas *warning*). Foram corrigidas nesta execução.
- **(2026-10-13 · Buffy)** Módulos adicionais criados dentro do Âmbito (justificação: testabilidade sem Qt e SoC): `config/logging_setup.py` (logging JSON + rotação + crash dumps) e `config/environment.py` (integridade do ambiente de pacotes).

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-13 | Buffy (Codebuff) | 1–6 (revisão) | `config/logging_setup.py`, `config/environment.py`, `app.py` | Logs JSON com rotação, crash dump em `LOGS_DIR`, conflito `onnxruntime`/`-directml` passa a falha de arranque (código 2) |
