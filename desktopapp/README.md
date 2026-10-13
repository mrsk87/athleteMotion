# Athlete Motion Desktop (PyQt6 + Hardware Acceleration)

Aplicação desktop nativa Windows para análise biomecânica e bikefit em tempo real, concebida para extrair o máximo desempenho do computador físico (AMD Radeon RX 580 DirectML + Intel Xeon E5-1660 v3 AVX2 OpenVINO).

**Estado atual:** D01 concluída (🔵 REVIEW) e D02 em 🔵 REVIEW — janela com tema escuro, navegação, i18n PT/EN, logging estruturado, fecho controlado e **vista de Definições com diagnóstico de hardware** (GPU/VRAM, CPU/AVX2, providers ORT/OpenVINO, perfil de autotune e *override* manual). Captura e inferência chegam nas tarefas D03+ (ver [TASKS/STATUS_BOARD.md](TASKS/STATUS_BOARD.md)).

---

## 🚀 Como Executar

### 1. Configurar o ambiente de desenvolvimento
Requer **Python 3.11 ou 3.12** (o projeto declara `>=3.11,<3.13`). O `uv` trata do resto:

```powershell
cd desktopapp
.\scripts\dev_setup.ps1        # cria .venv, instala -e ".[dev]" e atualiza as traduções
```

Manualmente (equivalente):
```powershell
cd desktopapp
python -m pip install --user uv     # se ainda não tiver o uv
uv venv --python 3.11
uv pip install -e ".[dev]"
```

### 2. Iniciar a aplicação
```powershell
.venv\Scripts\python.exe -m athletemotion_desktop
```
Dados do utilizador (definições, logs, modelos, sessões) ficam em `%APPDATA%\AthleteMotion\`.

### 3. Diagnóstico de hardware (CLI, sem interface gráfica)

A sonda é um módulo sem Qt, reutilizável fora da aplicação (scripts, CI, suporte remoto):
```powershell
.venv\Scripts\python.exe -m athletemotion_desktop.runtime.hardware.probe --summary  # resumo legível
.venv\Scripts\python.exe -m athletemotion_desktop.runtime.hardware.probe --json      # JSON serializável
```
A saída **nunca inventa valores**: quando um componente não pode ser lido (pacote ausente, comando bloqueado) o campo fica `null`/vazio e a razão aparece em `warnings` — por exemplo, a VRAM reportada pelo WMI está truncada a 4 GiB e é recuperada do registo (`qwMemorySize`).

### 4. Verificações (portões de qualidade)
```powershell
cd desktopapp
$env:QT_QPA_PLATFORM="offscreen"; .venv\Scripts\python.exe -m pytest -q
.venv\Scripts\ruff.exe check .
.venv\Scripts\ruff.exe format --check src/athletemotion_desktop tests
.venv\Scripts\mypy.exe src/athletemotion_desktop        # modo strict
```

---

## 🌍 Internacionalização (PT/EN)

- **Fonte única de tradução:** os ficheiros `.ts` em `src/athletemotion_desktop/ui/i18n/` (`pt_PT.ts`, `en.ts`).
- O PT-PT é a **língua fonte**: todo o texto do código está em PT-PT dentro de `self.tr(...)`; o inglês é traduzido em `en.ts`.
- **Sem `lrelease`:** o wheel do PyQt6 distribui o `pylupdate6` mas não o `lrelease` do Qt Linguist. Em vez de introduzir binários externos, `ui/i18n/translator.py` implementa um `QTranslator` que interpreta os `.ts` diretamente (e usa um `.qm` compilado, se existir).
- Extrair textos novos e verificar o que falta traduzir:
  ```powershell
  .\scripts\update_translations.ps1     # corre o pylupdate6 sobre o código
  ```
  Mensagens sem tradução ficam `unfinished` e a interface mostra o texto PT-PT — nunca texto inventado. Os testes `test_translation_files_have_no_unfinished_entries` e `test_english_translation_covers_every_settings_view_text` impedem que fiquem pendentes.
- Os scripts `.ps1` são gravados **com BOM UTF-8**: o Windows PowerShell 5.1 lê ficheiros sem BOM como ANSI e o byte de um travessão (—) passa a ser interpretado como aspas tipográficas de fecho, partindo o *parser*.
- O idioma escolhido no seletor da barra lateral é gravado atomicamente em `%APPDATA%\AthleteMotion\settings.json`.

> Ao traduzir, preserve os marcadores (`{cores}`, `{ram}`, …): são preenchidos em runtime com medições reais do sistema.

---

## 🧱 Estrutura

```text
desktopapp/
├── AGENTS.md                          # Regras de engenharia e ACID do subprojeto
├── README_PLAN.md                     # Plano de implementação e arquitetura
├── pyproject.toml                     # Dependências, ruff, mypy, pytest
├── TASKS/                             # Tarefas D01…D16, protocolo, quadro e registo
├── src/athletemotion_desktop/
│   ├── __main__.py                    # python -m athletemotion_desktop
│   ├── app.py                         # Ciclo de vida, sinais, locks, i18n, crash hook
│   ├── config/
│   │   ├── paths.py                   # %APPDATA%/AthleteMotion
│   │   ├── settings.py                # Definições Pydantic + gravação atómica
│   │   ├── logging_setup.py           # Logging JSON rotativo + relatório de falhas nativas
│   │   └── environment.py             # Integridade do ambiente (conflito ORT CPU/DirectML)
│   ├── runtime/                       # MOTOR DE TEMPO REAL (sem Qt) — capture/preprocess/
│   │   ├── hardware/                  #   ring_buffer/inference_worker chegam em D03–D05
│   │   │   ├── probe.py               #   sonda CPU/GPU/RAM/providers (também por CLI)
│   │   │   ├── profile.py             #   leitura/validação de hardware_profile.json
│   │   │   ├── autotune.py            #   benchmark em subprocesso cancelável
│   │   │   └── diagnostics.py         #   avisos inteligentes (sem Qt)
│   │   └── backends/ models/
│   ├── domain_bridge/ services/       # Pontes para o pacote athletemotion e sessões (D08/D10)
│   └── ui/
│       ├── main_window.py             # Janela, navegação, seletor de idioma, telemetria
│       ├── i18n/                      # translator.py + pt_PT.ts + en.ts
│       ├── theme/dark.qss             # Tema escuro
│       └── views/ widgets/ viewmodels/  # settings_view/settings_vm (D02); Live/Benchmark em D07–D12
└── tests/
    ├── unit/                          # Configuração, logging, ambiente, i18n, sonda/perfil/avisos
    ├── ui/                            # pytest-qt: janela, navegação, idioma, vista de Definições
    ├── integration/                   # Arranque real, locks, sinais, falha nativa
    ├── perf/                          # Portão de arranque (< 2 s)
    └── support/                       # Lançador headless reutilizado pelos testes
```

---

## 📌 Regras de Contribuição para LLMs
Antes de iniciar qualquer tarefa em `desktopapp/TASKS/`:
1. Consulta obrigatoriamente [AGENTS.md](AGENTS.md) e [TASKS/00_PROTOCOLO_LLM.md](TASKS/00_PROTOCOLO_LLM.md).
2. O módulo `runtime/` **nunca deve importar PyQt6 / QtCore**.
3. Toda a mutação de base de dados SQLite deve respeitar estritamente as propriedades **ACID**.
4. A thread principal da UI **nunca deve bloquear** (> 8 ms).
