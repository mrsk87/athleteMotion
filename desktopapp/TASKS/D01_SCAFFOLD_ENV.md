# D01 — Scaffold, ambiente, janela vazia, tema e logging

> **ID:** D01 · **Prioridade:** P0 · **Onda:** 0
> **Status:** 🔵 REVIEW · **Progresso:** 8/8 · **Atribuído a:** Buffy (Codebuff) · **Início:** 2026-10-13 · **Última atualização:** 2026-10-13
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
- [x] **7. i18n:** `QTranslator` com `pt_PT.ts`/`en.ts`, todas as strings via `self.tr()`; seletor de idioma persistido; script `scripts/update_translations.ps1` (`pylupdate6`/`lrelease`).
- [x] **8. Teste smoke:** `pytest-qt` abre a `MainWindow` offscreen, troca de vista, fecha sem exceções nem processos órfãos. Atualizar `README_PLAN.md` §12 (Fase 0 → 🟡/🔵) e board/changelog.

## 5. Critérios de aceitação
- `python -m athletemotion_desktop` abre a janela em < 2 s (medir) e fecha limpa.
- 🟡 **PARCIAL (depende de R01):** `import athletemotion` funciona a partir do desktop (domínio partilhado) — sem cópia de código. **Verificado** por `PYTHONPATH=../backend/src` (evidência 9.9), com o `backend/` criado por R01 em paralelo. Falta a instalação editável e a dependência declarada no `pyproject.toml`, que aguardam R01 🟢 DONE.
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

### 9.1 Ambiente reprodutível (2026-10-13 · Buffy)
```text
$ python -m pip install --user uv    → uv 0.13.0
$ python -m uv venv --python 3.11    → Using CPython 3.11.17 · Creating virtual environment at: .venv
$ python -m uv pip install --python .venv/Scripts/python.exe -e ".[dev]"
  → 30 pacotes: PyQt6 6.11.0, pyqtgraph 0.14.0, numpy 2.4.6, opencv-python 5.0.0.93,
    pydantic 2.14.1, pydantic-settings 2.15.0, psutil 7.2.2, pytest 9.1.1, pytest-qt 4.5.0,
    pytest-benchmark 5.3.0, ruff 0.17.0, mypy 2.4.0, types-psutil 7.2.2
```
A máquina só tinha Python 3.14 (fora do intervalo `>=3.11,<3.13`), pelo que o `uv` instalou um CPython 3.11 portátil em `%APPDATA%/uv`.

### 9.2 Portões de qualidade
| Comando | Resultado |
|---|---|
| `ruff check .` | `All checks passed!` |
| `ruff format --check src/athletemotion_desktop tests` | `38 files already formatted` |
| `mypy src/athletemotion_desktop` (`strict = true`) | `Success: no issues found in 23 source files` |
| `QT_QPA_PLATFORM=offscreen pytest -q` | `43 passed in 7.7s` (unit 27 · UI 9 · integração 6 · desempenho 1) |

### 9.3 Tempo de arranque (orçamento: < 2 s)
Medido em subprocesso real, desde o início do interpretador até a janela estar criada e apresentada — inclui a importação do PyQt6 (pior caso realista):

| Execução | `startup_ms` |
|---|---|
| 1 | 1014 ms |
| 2 | 812 ms |
| 3 | 831 ms |

Pior caso medido: **1014 ms** → dentro do orçamento.

### 9.4 Encerramento controlado (subprocesso com ciclo de eventos real)
Sinal entregue a partir de uma thread secundária com a thread principal bloqueada no ciclo de eventos do Qt:

| Sinal | Código de saída | Encerramento após o sinal | `app.lock` removido | Logs |
|---|---|---|---|---|
| `SIGINT` | 0 | 68 ms | sim | `Sinal SIGINT recebido…` + `encerrado com código 0` |
| `SIGTERM` | 0 | 70 ms | sim | idem |

### 9.5 Execução real do comando de arranque
```text
$ QT_QPA_PLATFORM=offscreen .venv/Scripts/python.exe -m athletemotion_desktop
→ PROCESSO VIVO com o ciclo de eventos ativo após 6 s, sem exceções.
→ %APPDATA%/AthleteMotion/logs/desktopapp.log (JSON, uma linha por registo):
  {"timestamp": "2026-10-13T19:28:52", "level": "INFO", "logger": "athletemotion_desktop",
   "message": "A iniciar Athlete Motion Desktop v0.2.0", "module": "app", "line": 155,
   "process_id": 20736, "thread": "MainThread"}
```

### 9.6 Extração de traduções idempotente
```text
$ .venv/Scripts/pylupdate6.exe --ts src/athletemotion_desktop/ui/i18n/en.ts src/athletemotion_desktop
Summary of changes to src/athletemotion_desktop/ui/i18n/en.ts:
    17 existing messages were found      # nenhuma mensagem nova/em falta → .ts em sincronia com o código
```
Mesma saída para `pt_PT.ts`. Os testes verificam ainda que todos os textos de navegação têm tradução em inglês.

### 9.7 Falha nativa simulada
`ctypes.string_at(0)` num subprocesso → `%APPDATA%/AthleteMotion/logs/crash_fault.log`:
```text
=== Sessão iniciada em 2026-10-13T19:23:56 (pid 22452) ===
Windows fatal exception: access violation

Current thread 0x00006c7c (most recent call first):
  File "...\ctypes\__init__.py", line 519 in string_at
```

### 9.8 Critério parcialmente verificado / integralmente diferido
`import athletemotion` a partir do desktop **verifica-se já** (ver 9.8). Continua **diferido** o que depende de R01 estar concluída: instalação editável do backend no `.venv` do desktop e dependência declarada no `pyproject.toml`.

### 9.9 Domínio partilhado importável a partir do desktop
```text
$ cd desktopapp; PYTHONPATH=../backend/src .venv/Scripts/python.exe -c "import athletemotion"
athletemotion importado de: D:\Projects\athleteMotion\backend\src\athletemotion\__init__.py
módulos extra carregados com o pacote: []   # nenhuma dependência pesada é arrastada
```
Ou seja: o domínio é partilhado (importável, sem duplicação de código) e a carga do pacote é leve — a integração completa aguarda apenas o fim de R01.

## 10. Notas e Descobertas
- **(2026-10-13 · Buffy)** O protocolo exige dependências 🟢 DONE. No início desta sessão **R01 estava 🔴 TODO** (não existia `backend/` nem o pacote `athletemotion`); decisão do utilizador: **avançar só com o desktop**, executando as tarefas que não dependem do backend (D02–D04, D07, D14) e marcando as restantes ⛔ BLOCKED no board. O critério de aceitação *`import athletemotion` funciona a partir do desktop* ficou **diferido**.
- **(2026-10-13 · Buffy) — atualização de estado:** durante esta sessão **outro agente executou R01 em paralelo** (commit `f956d10 refactor: git mv files to backend and frontend/web structure`; R01 passou a 🟡 IN_PROGRESS, 0/9). O `backend/` e o pacote `athletemotion` já existem em disco e **`import athletemotion` funciona a partir do interpretador do desktop** (ver 9.9) — sem copiar código. A **instalação editável** do backend no `.venv` do desktop (`uv pip install -e ../backend` + dependência `athletemotion @ file:../backend` no `pyproject.toml`) fica para depois de R01 estar 🟢 DONE: R01 está em curso e as dependências do backend trariam `onnxruntime`/`fastapi`/`mediapipe` para o ambiente do desktop, com risco real de conflito CPU/DirectML (o próprio arranque passaria a abortar).
- **(2026-10-13 · Buffy)** O ambiente da máquina só tem **Python 3.14**; o projeto exige `>=3.11,<3.13`. Criado `.venv` com **CPython 3.11.17** via `uv` (não há Python 3.11/3.12 instalado no sistema).
- **(2026-10-13 · Buffy)** **Sem `lrelease`:** o wheel do PyQt6 fornece apenas `pylupdate6`, não o `lrelease` do Qt Linguist. Para manter o repositório offline-first e sem binários de terceiros, os `.ts` (**fonte única de tradução**, atualizados por `scripts/update_translations.ps1`) são interpretados em runtime por um `QTranslator` especializado (`ui/i18n/translator.py`); se existir um `.qm` compilado, tem prioridade. Validado por sonda que `QTranslator.translate` reimplementado em Python é efetivamente invocado por `tr()`.
- **(2026-10-13 · Buffy)** As subtarefas 4 e 5 estavam marcadas `[x]` mas não cumpriam os critérios de aceitação (logs em texto simples sem rotação; conflito ORT apenas *warning*). Foram corrigidas nesta execução.
- **(2026-10-13 · Buffy)** Módulos adicionais criados dentro do Âmbito (justificação: testabilidade sem Qt e SoC): `config/logging_setup.py` (logging JSON + rotação + crash dumps) e `config/environment.py` (integridade do ambiente de pacotes).
- **(2026-10-13 · Buffy)** **Descoberta no PyQt6:** devolver `""` de um `QTranslator.translate()` reimplementado é interpretado como *tradução vazia* (rótulos em branco na UI) e não como "usa o texto fonte" (comportamento do C++). `TsFileTranslator` devolve agora o próprio texto fonte quando não há tradução; o caso está coberto por teste e documentado no código.
- **(2026-10-13 · Buffy)** **Encerramento por sinais:** um `kill` simples no processo deixava o `app.lock` preso e não executava o `flush` dos logs/relatório de falhas. Implementado `install_shutdown_signal_handlers()` com um temporizador de despertar de 200 ms (necessário porque, com o processo bloqueado no ciclo de eventos do Qt, os handlers de sinais do Python não correm — só executam em *bytecode*).
- **(2026-10-13 · Buffy)** Dependência de desenvolvimento adicionada: `types-psutil` (stubs oficiais) — necessária para manter `mypy --strict` limpo sem `ignore_missing_imports`. Não afeta o runtime.
- **(2026-10-13 · Buffy)** `ruff --fix` reordenou imports em `runtime/backends/base.py` (ficheiro pré-existente, fora do Âmbito estrito) para deixar `ruff check .` limpo; alteração registada aqui e no `CHANGELOG.md`.
- **(2026-10-13 · Buffy)** Após um `TerminateProcess` externo (o que o Windows faz em `kill`), um `app.lock` pode ficar em disco; o `QLockFile` deteta-o como obsoleto no arranque seguinte (verificado por teste de dois arranques consecutivos). Comportamento esperado, sem ação pendente.
- **(2026-10-13 · Buffy)** **Bloqueios que afetam o resto da onda:** D06 exige R13 (manifest de modelos), D05 exige R14/R03, D08 exige R10/R11/R12, D10 exige R06/R07/R08 e D11 exige R17 — todos 🔴 TODO. Por isso o avanço desta sessão é D01 → D02/D03/D04/D07/D14.

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-13 | Buffy (Codebuff) | 1–6 (revisão) | `config/logging_setup.py`, `config/environment.py`, `app.py` | Logs JSON com rotação, crash dump em `LOGS_DIR`, conflito `onnxruntime`/`-directml` passa a falha de arranque (código 2) |
| 2026-10-13 | Buffy (Codebuff) | 7 | `ui/i18n/{__init__,translator}.py`, `ui/i18n/{pt_PT,en}.ts`, `ui/main_window.py`, `ui/theme/dark.qss`, `scripts/update_translations.ps1`, `scripts/dev_setup.ps1`, `config/settings.py`, `app.py` | i18n completo: `QTranslator` que interpreta `.ts` (sem `lrelease`), todas as strings em `tr()`, `retranslate_ui()` no padrão Qt, seletor de idioma persistido atomicamente e língua fonte PT como recurso |
| 2026-10-13 | Buffy (Codebuff) | 7–8 | `tests/` (`conftest.py`, `unit/*`, `ui/*`, `integration/test_startup.py`, `perf/test_startup_time.py`, `support/*`) | 43 testes: logging JSON, integridade do ambiente, parsing/cobertura `.ts`, smoke da janela, persistência de idioma, arranque real, sinais e portão de arranque < 2 s |
| 2026-10-13 | Buffy (Codebuff) | 8 | `README.md`, `README_PLAN.md` §12/§15, `TASKS/STATUS_BOARD.md`, `TASKS/CHANGELOG.md` | Documentação de execução, estado da Fase 0 e quadro/registo atualizados |
| 2026-10-13 | Buffy (Codebuff) | 4 (descoberta) | `app.py` | Encerramento controlado por `SIGINT`/`SIGTERM`/`SIGBREAK` com temporizador de despertar (unlock, flush de logs e fecho do relatório de falhas) |
| 2026-10-13 | Buffy (Codebuff) | — (ad-hoc) | `runtime/backends/base.py` | Reordenação de imports por `ruff --fix` (ficheiro fora do Âmbito; necessário para `ruff check .` limpo) |
