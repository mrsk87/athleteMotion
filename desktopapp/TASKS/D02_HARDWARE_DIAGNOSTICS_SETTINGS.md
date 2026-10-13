# D02 — Diagnóstico de hardware e definições

> **ID:** D02 · **Prioridade:** P1 · **Onda:** 1
> **Status:** 🔴 TODO · **Progresso:** 0/7 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D01 · **Bloqueia:** D12 · **Branch:** `feat/d02-hardware-settings` · **PR:** —
> **Referência:** README_PLAN §4.4, §6 (Definições), CODE_REVIEW §5.1 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
O backend (R14) fornece `autotune` e `hardware_profile.json`. O desktop precisa de **detetar e mostrar** o hardware, **executar/ler** o autotune e permitir *override* manual de backend/modelo/resolução. GPU: RX 580 (DirectML); CPU: Xeon E5-1660 v3 (AVX2, sem VNNI).

## 2. Objetivo
Camada `runtime/hardware` (sem Qt) + vista de Definições: lista de GPUs/CPU/RAM/providers, perfil recomendado, *override*, câmara e idioma.

## 3. Âmbito
**Cria:** `runtime/hardware/{probe.py,profile.py}`, `ui/views/settings_view.py`, `ui/viewmodels/settings_vm.py`, testes.
**Altera:** `config/settings.py`.
**Não mexe:** pipeline de inferência (D05), benchmark visual (D12).

## 4. Subtarefas
- [ ] **1. `probe.py`:** CPU (`cpuinfo`: modelo, flags AVX2/AVX512/VNNI; `psutil`: físicos/lógicos, RAM), GPUs (DXGI via `ctypes`/`pywin32`, fallback `wmic path win32_VideoController`/PowerShell `Get-CimInstance`): nome, VRAM, driver, `device_id` DML; providers ORT e dispositivos OpenVINO. Devolver `HardwareInfo` (dataclass) **serializável**. Timeouts nas chamadas externas.
- [ ] **2. Testes do probe:** simular saídas (monkeypatch) para: só CPU, GPU AMD, GPU Intel integrada + discreta, driver sem DX12; nunca levantar exceção para fora (degradar com `None` + aviso).
- [ ] **3. Perfil:** `profile.py` lê/valida `hardware_profile.json` (R14) com schema + versão; se ausente ou stale (mudou driver/ORT/GPU) → estado `needs_autotune`. API: `load_profile()`, `run_autotune(progress_cb)` (processo separado, cancelável) reutilizando `athletemotion.infrastructure.autotune`.
- [ ] **4. Definições persistentes:** backend preferido (`auto|directml|openvino|cpu`), modelo de pose/detetor, resolução, `redetect_interval`, câmara/resolução/FPS (D03), idioma, tema, política de gravação (E4), modo desempenho. Validação (pydantic) e `reset to defaults`.
- [ ] **5. Vista de Definições:** secções Hardware (tabela), Desempenho (perfil + botão “Executar autotune” com barra de progresso e cancelar), Câmara, Aplicação. Alterações aplicadas por “Guardar” (sem reiniciar quando possível; aviso quando exige).
- [ ] **6. Avisos inteligentes:** sem DX12/DirectML → recomendar CPU/OpenVINO; VRAM < 2 GB → limitar resolução; GPU integrada escolhida por engano → alertar; `onnxruntime` CPU instalado junto do DML (D01) → erro destacado.
- [ ] **7. Testes UI e docs:** `pytest-qt` para a vista (offscreen), snapshot dos *view-models*; atualizar `README_PLAN.md` e board/changelog.

## 5. Critérios de aceitação
- Em máquina sem GPU o probe não falha e a vista mostra o fallback.
- Autotune lançável e cancelável sem bloquear a UI (teste mede que o *event loop* responde < 50 ms).
- *Override* manual prevalece sobre o perfil e é persistido.
- Cobertura do `probe/profile` ≥ 90 %.

## 6. Verificação
```powershell
cd desktopapp
pytest tests -k "probe or profile or settings" -q
python -m athletemotion_desktop.runtime.hardware.probe --json
```

## 7. Riscos / Fora de âmbito
- DXGI por `ctypes` é frágil: manter caminho alternativo por PowerShell e testes com saídas gravadas.
- Gráficos de benchmark → D12.

## 8. Prompt específico
```text
Executa a tarefa D02 (desktopapp/TASKS/D02_HARDWARE_DIAGNOSTICS_SETTINGS.md) seguindo o Prompt mestre do desktop.
runtime/hardware sem Qt, nunca lançar exceção para fora, testes com saídas simuladas. Autotune em processo separado e cancelável.
```

## 9. Evidências
_(JSON do probe na máquina real, testes)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
