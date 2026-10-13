# D02 — Diagnóstico de hardware e definições

> **ID:** D02 · **Prioridade:** P1 · **Onda:** 1
> **Status:** 🔵 REVIEW · **Progresso:** 7/7 · **Atribuído a:** Buffy (Codebuff) · **Início:** 2026-10-13 · **Última atualização:** 2026-10-13
> **Depende de:** D01 · **Bloqueia:** D12 · **Branch:** `chore/r01-restructure` (checkout partilhado com o trabalho da R01) · **PR:** —
> **Referência:** README_PLAN §4.4, §6 (Definições), CODE_REVIEW §5.1 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
O backend (R14) fornece `autotune` e `hardware_profile.json`. O desktop precisa de **detetar e mostrar** o hardware, **executar/ler** o autotune e permitir *override* manual de backend/modelo/resolução. GPU: RX 580 (DirectML); CPU: Xeon E5-1660 v3 (AVX2, sem VNNI).

## 2. Objetivo
Camada `runtime/hardware` (sem Qt) + vista de Definições: lista de GPUs/CPU/RAM/providers, perfil recomendado, *override*, câmara e idioma.

## 3. Âmbito
**Cria:** `runtime/hardware/{probe.py,profile.py}`, `ui/views/settings_view.py`, `ui/viewmodels/settings_vm.py`, testes.
**Altera:** `config/settings.py`.
**Não mexe:** pipeline de inferência (D05), benchmark visual (D12).

**Desvios ao âmbito (justificados):**
- `runtime/hardware/autotune.py` e `runtime/hardware/diagnostics.py` foram acrescentados ao criar a tarefa: o autotune num *processo separado cancelável* e as regras de aviso são **lógica sem Qt**, e testá-los dentro da vista seria mais frágil e menos reutilizável (a D12 consome os mesmos avisos).
- `runtime/__init__.py` foi corrigido: importava os adaptadores de backend (e o `numpy`) como efeito lateral de `import athletemotion_desktop.runtime`.

## 4. Subtarefas
- [x] **1. `probe.py`:** CPU (`cpuinfo`: modelo, flags AVX2/AVX512/VNNI; `psutil`: físicos/lógicos, RAM), GPUs (PowerShell `Get-CimInstance`, fallback `wmic`) + **registo (`qwMemorySize`)** para recuperar VRAM truncada: nome, VRAM, driver, vendor/`is_discrete`; providers ORT e dispositivos OpenVINO. Devolve `HardwareInfo` **serializável** (`to_dict`/`to_json`/`signature`). Timeouts (10 s) em todas as chamadas externas.
- [x] **2. Testes do probe:** saídas WMI/PowerShell/wmic **gravadas** (JSON e CSV), GPU AMD, Intel integrada + discreta, driver sem valor fiável, VRAM truncada, registo ambíguo/inválido, `psutil`/`cpuinfo` ausentes, `_run_command` com comando inexistente/erro não-terminante/falha do SO. Nenhum teste toca no hardware real.
- [x] **3. Perfil:** `profile.py` lê/valida `hardware_profile.json` (R14) com `schema_version` + assinatura de hardware; ausente → `needs_autotune`, inválido → aviso (nunca exceção para fora), versão desconhecida → recusa. API: `load_profile()`, `AutotuneProcess` (processo separado, cancelável, `parse_progress_line`).
- [x] **4. Definições persistentes:** `InferenceSettings` (backend `auto|directml|openvino|cpu`, modelo de pose/detetor, resolução, `redetect_interval`, confiança, modo, `manual_override`), `CameraSettings` (índice/FPS/resolução), idioma, tema, política de gravação, mais `reset_to_defaults()`; validação Pydantic e gravação atómica `.tmp` + `os.replace`.
- [x] **5. Vista de Definições:** secções Hardware (tabela + estado da sonda), Avisos, Desempenho (perfil recomendado + «Executar autotune» com barra de progresso e cancelar), Câmara, Aplicação. Alterações aplicadas só em «Guardar»; «Detetar novamente» e «Repor padrões» sem gravar.
- [x] **6. Avisos inteligentes:** sem DirectML/providers → recomendar OpenVINO/CPU; `preferred_backend=directml` sem provider → **erro**; VRAM < 2 GB → limitar resolução; VRAM desconhecida → informativo; GPU integrada primeiro → alertar; sem `onnxruntime` → **erro bloqueante**; conflito de runtimes ORT; avisos da sonda propagados; deduplicação.
- [x] **7. Testes UI e docs:** `pytest-qt` *offscreen* (13 testes na vista/VM, incluindo um que verifica os rótulos **em inglês** a partir do `.ts`), resposta do *event loop* < 50 ms com autotune e sondagem a correr, traduções PT/EN sem entradas `unfinished`, board/changelog/`README_PLAN.md` atualizados.

## 5. Critérios de aceitação
- ✅ **Máquina sem GPU:** a sonda não falha e a vista mostra o *fallback* («Nenhuma detetada») com avisos — `tests/ui/test_settings_view.py::test_view_without_gpu_falls_back_and_warns`.
- ✅ **Autotune lançável e cancelável sem bloquear a UI:** `test_autotune_runs_without_blocking_the_event_loop` e `test_autotune_can_be_cancelled_from_the_view` medem a resposta do *event loop* durante a execução; `test_hardware_probe_does_not_block_the_caller` faz o mesmo para a sonda. A sondagem corre numa thread própria e o autotune num **subprocesso**; a UI só faz *polling* a cada 100 ms.
- ✅ **Override manual prevalece e é persistido:** `test_manual_change_marks_override_and_is_persisted`, `test_override_prevents_profile_from_overwriting_choices`.
- ✅ **Cobertura ≥ 90 %:** `probe.py` 97 % e `profile.py` 95 % (TOTAL 97 %, 391 *statements*).

## 6. Verificação
```powershell
cd desktopapp
QT_QPA_PLATFORM=offscreen python -m pytest tests -q                      # 117 passed
QT_QPA_PLATFORM=offscreen python -m pytest tests -q `
  --cov=athletemotion_desktop.runtime.hardware.probe `
  --cov=athletemotion_desktop.runtime.hardware.profile --cov-report=term-missing
ruff check . ; ruff format --check . ; mypy src/                          # limpos
python -m athletemotion_desktop.runtime.hardware.probe --summary
python -m athletemotion_desktop.runtime.hardware.probe --json
```

## 7. Riscos / Fora de âmbito
- DXGI por `ctypes` **não** foi implementado (era «caminho principal»): o caminho PowerShell + registo revelou-se suficiente e muito menos frágil; o `wmic` fica como último recurso. Risco residual: numa máquina com PowerShell bloqueado por política, a VRAM fica `None` (assinalado por aviso) — nunca inventada.
- Gráficos de benchmark → D12.

## 8. Prompt específico
```text
Executa a tarefa D02 (desktopapp/TASKS/D02_HARDWARE_DIAGNOSTICS_SETTINGS.md) seguindo o Prompt mestre do desktop.
runtime/hardware sem Qt, nunca lançar exceção para fora, testes com saídas simuladas. Autotune em processo separado e cancelável.
```

## 9. Evidências

### 9.1. Sonda na máquina real (RX 580 + Xeon E5-1660 v3), `--json`
```json
{
  "schema_version": 1,
  "generated_at": "2026-10-13T20:10:47.157912+00:00",
  "cpu": {
    "model": "Intel(R) Xeon(R) CPU E5-1660 v3 @ 3.00GHz",
    "physical_cores": 8, "logical_cores": 16,
    "has_avx2": true, "has_avx512": false, "has_vnni": false
  },
  "gpus": [
    { "name": "Radeon RX 580 Series", "vendor": "amd", "vram_gb": 8.0,
      "driver_version": "31.0.21924.61", "is_discrete": true }
  ],
  "total_ram_gb": 31.9,
  "ort_providers": [],
  "openvino_devices": [],
  "signature": "69e277454450b10b",
  "warnings": [
    "VRAM de 'Radeon RX 580 Series' reportada como 4.0 GiB, que é o limite de 32 bits do WMI: valor não fiável, a procurar no registo (qwMemorySize).",
    "VRAM de 'Radeon RX 580 Series' obtida do registo (qwMemorySize): 8.0 GiB (o WMI trunca valores acima de 4 GiB).",
    "ONNX Runtime não está instalado neste ambiente: inferência indisponível."
  ]
}
```
Resumo legível (`--summary`): `GPU: Radeon RX 580 Series (amd, VRAM=8.0 GiB, driver=31.0.21924.61)`, `RAM: 31.9 GB`, `Flags: AVX2=True AVX-512=False VNNI=False`.

> `ort_providers` vazio é **esperado** neste momento: o `onnxruntime-directml` só entra com a R01 🟢 DONE + D05. É precisamente esse o caso que a vista reporta como erro bloqueante com instrução de resolução.

### 9.2. Testes e cobertura
```
117 passed in 22.04s
Name                                                  Stmts   Miss  Cover   Missing
src\...\runtime\hardware\probe.py                       311      8    97%   274, 346, 435, 531-532, 552-553, 674
src\...\runtime\hardware\profile.py                      80      4    95%   139-141, 165
TOTAL                                                   391     12    97%
```
*(linhas não cobertas são caminhos defensivos remotos: ramos de erro do ORT/OpenVINO que exigem um binário partido e a linha do modo `--json`.)*

### 9.3. Verificação estática
```
ruff check .        → All checks passed!
ruff format --check → 34 files already formatted
mypy src/           → Success: no issues found in 30 source files
```
Nota: `py-cpuinfo` não publica `py.typed`/stubs; o `pyproject.toml` tem um override **explícito e comentado** (`[[tool.mypy.overrides]] module = ["cpuinfo"]`) — não se baixou o rigor global.

### 9.4. Orçamento de arranque (o critério da D01 não pode regredir)
```
run_headless_launch → {"exit_code": 0, "startup_ms": 1111.28}
```
1111 ms (orçamento: 2000 ms). Na primeira versão a sonda corria no arranque e levava o arranque a ~4,4 s: passou a correr numa **thread própria** (`start_hardware_probe()`), disparada depois de a janela estar visível.

### 9.5. Critério «UI responde < 50 ms»
Testes dedicados em `tests/ui/test_settings_view.py`: `test_autotune_runs_without_blocking_the_event_loop`, `test_autotune_can_be_cancelled_from_the_view`, `test_hardware_probe_does_not_block_the_caller` — medem o tempo de resposta do ciclo de eventos com a sonda/autotune em curso.

### 9.6. Interface em PT e EN (DoD do protocolo §5)
```
pylupdate6 → pt_PT.ts: 71 mensagens | en.ts: 71 mensagens
grep -c unfinished → pt_PT.ts: 0 | en.ts: 0
pytest tests/unit/test_i18n.py tests/ui/test_settings_view.py → 120 passed (suite completa)
```
As 51 mensagens novas da vista de Definições foram extraídas por `scripts/update_translations.ps1` e traduzidas nos dois ficheiros; o teste `test_view_texts_follow_the_selected_language` confirma em execução que o contexto do `.ts` corresponde à classe `SettingsView` (`Detected hardware`, `Detect again`, `Save`, `Camera`) e dois testes novos impedem regressões: `test_english_translation_covers_every_settings_view_text` (todos os literais de `self.tr(...)` da vista têm tradução) e `test_translation_files_have_no_unfinished_entries`.

> Exceção consciente: os textos dos **avisos de diagnóstico** nascem em `runtime/hardware/diagnostics.py`, que pela regra 1 do protocolo **não pode importar PyQt** (logo não usa `tr()`). Ficam em PT-PT nos dois idiomas; a tradução dos avisos técnicos fica registada como trabalho do D14, quando a política de i18n do `runtime/` for decidida.

## 10. Notas e Descobertas
- **Truncagem do WMI é `0xFFF00000` (4095 MiB), não `0xFFFF0000`.** O artefacto real observado na RX 580 é `4293918720` bytes (≈4,0 GiB exibidos). Cruzar com o limiar errado deixava a VRAM a `None` em silêncio; o valor correto é recuperado pelo registo (`HardwareInformation.qwMemorySize` → 8,0 GiB). O `wmi`/PowerShell nunca deve ser acreditado acima de 4 GiB — está documentado no módulo.
- **PowerShell devolve código 1 em erros *não-terminantes*** (ex.: subchaves do registo sem permissão) **mesmo com `stdout` útil**. `_run_command` aproveita a saída nesse caso (registo em `debug`) e só considera falha quando não há saída nenhuma (`warning` → `None`).
- **`py-cpuinfo` é a forma portátil de ler as flags AVX2/AVX-512/VNNI** (não há stub de tipos; ver 9.3).
- **`is_likely_discrete_gpu` é heurística** (nome comercial) e devolve `None` quando não sabe — a vista mostra «indeterminado» em vez de afirmar erradamente que é integrada.
- **Nenhuma medição é inventada:** sem certeza, o campo fica `None`/vazio e a razão entra em `warnings` (regra da AGENTS.md e do protocolo).
- `python -m ...hardware.probe` deixava um aviso do `runpy` porque `hardware/__init__.py` re-exportava o módulo: o pacote passou a não re-exportar nada (cada consumidor importa o módulo concreto).
- **`scripts/*.ps1` não corriam no Windows PowerShell 5.1:** o 5.1 lê ficheiros sem BOM como ANSI/CP-1252, e o byte `0x94` de um travessão UTF-8 (—) é interpretado como aspas tipográficas de fecho — o *parser* falhava a meio do ficheiro com «The string is missing the terminator». Corrigido com BOM UTF-8 nos dois scripts (sem alterar lógica nem acentos).

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-13 | Buffy (Codebuff) | 1–2 | `runtime/hardware/{probe.py,__init__.py}`, `tests/unit/test_hardware_probe.py` | Sonda de CPU/GPU/RAM/providers com degradação para `None` + avisos; recuperação da VRAM do registo; 34 testes com saídas simuladas; cobertura 97 % |
| 2026-10-13 | Buffy (Codebuff) | 3 | `runtime/hardware/{profile.py,autotune.py}`, `tests/unit/test_hardware_profile.py` | Leitura/validação de `hardware_profile.json` com assinatura de hardware; autotune em subprocesso cancelável com progresso por linha JSON |
| 2026-10-13 | Buffy (Codebuff) | 4 | `config/settings.py` | `InferenceSettings`/`CameraSettings` com limites validados, `manual_override`, `reset_to_defaults()` preservando idioma/tema |
| 2026-10-13 | Buffy (Codebuff) | 5–6 | `runtime/hardware/diagnostics.py`, `ui/views/settings_view.py`, `ui/viewmodels/settings_vm.py`, `ui/main_window.py`, `app.py`, `tests/unit/test_hardware_diagnostics.py`, `tests/ui/test_settings_view.py` | Vista de Definições com *draft* + gravação atómica, autotune com barra/cancelar, avisos inteligentes (13 testes) e 12 testes de UI; sondagem movida para thread para manter o arranque < 2 s |
| 2026-10-13 | Buffy (Codebuff) | 7 | `pyproject.toml`, `runtime/__init__.py`, `TASKS/*`, `README_PLAN.md` | `py-cpuinfo` + override de mypy documentado; fim dos efeitos laterais no import de `runtime`; documentação/board/changelog atualizados |
| 2026-10-13 | Buffy (Codebuff) | 7 | `ui/i18n/{pt_PT.ts,en.ts}`, `tests/unit/test_i18n.py`, `tests/ui/test_settings_view.py`, `scripts/*.ps1` | 51 textos novos traduzidos em PT/EN (0 `unfinished`), teste de cobertura das traduções da vista + teste que valida os rótulos em inglês em execução; corrigido o BOM UTF-8 dos scripts PowerShell (partiam no PS 5.1 por causa do travessão) |
