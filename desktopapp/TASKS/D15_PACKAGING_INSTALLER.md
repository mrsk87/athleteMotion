# D15 — Empacotamento, instalador, assinatura e atualização

> **ID:** D15 · **Prioridade:** P1 · **Onda:** 5
> **Status:** 🔴 TODO · **Progresso:** 0/8 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D08, D09, D10, D11, D13 (e D06) · **Bloqueia:** D16 · **Branch:** `chore/d15-packaging` · **PR:** —
> **Referência:** README_PLAN §11 · **Decisão humana E3** · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
Distribuição em Windows 10 22H2/11 com DirectX 12. Dependências nativas pesadas (ORT-DML, OpenVINO, OpenCV, PyQt6 plugins, FFmpeg). Modelos fora do executável. `onnxruntime` e `onnxruntime-directml` não podem coexistir no pacote.

## 2. Objetivo
Executável reprodutível (PyInstaller `onedir` ou Nuitka), instalador por utilizador (Inno Setup), assinatura de código (se E3), atualizações verificadas, e teste de instalação limpa.

## 3. Âmbito
**Cria:** `packaging/{athletemotion.spec,hooks/,installer.iss,version_info.txt,icons/}`, `scripts/{build_exe.py,make_installer.ps1,smoke_installed.ps1}`, `.github/workflows/desktop-release.yml`, `docs/packaging.md`, `services/updater.py`.
**Altera:** `pyproject.toml` (grupo `[packaging]`).
**Não mexe:** código funcional (apenas correções de empacotamento).

## 4. Subtarefas
- [ ] **1. Build PyInstaller onedir:** `.spec` com *hooks* para `onnxruntime` (DML DLLs), `openvino` (plugins), `cv2`, `PyQt6` (platforms, imageformats, `multimedia` se usado, `qt.conf`), `pyqtgraph`; excluir módulos não usados; `--noconsole`; ícone e *version info*; **teste de import** que falha se ambos ORT estiverem no pacote. Medir tamanho e tempo de arranque (meta ≤ 3 s).
- [ ] **2. Dados/Modelos:** modelos **fora** do exe (D06); incluir `manifest.json` e traduções `.qm`; localizar recursos via `importlib.resources`/`sys._MEIPASS` com função única; teste executável a partir de pasta com espaços/acentos.
- [ ] **3. Multiprocessing congelado:** `freeze_support()` no `__main__`; worker `spawn` funciona no executável (teste de arranque do pipeline com `FakeBackend`); sem ficheiros temporários deixados.
- [ ] **4. Instalador (Inno Setup):** instalação **por utilizador** (sem admin), atalhos, desinstalador que **pergunta** se remove dados em `%APPDATA%` (nunca por defeito), associação opcional de ficheiros, verificação de pré-requisitos (DX12/VC++ runtime) com mensagem clara, idioma PT/EN.
- [ ] **5. Assinatura e integridade:** assinar exe/instalador com `signtool` (certificado fornecido pelo humano via segredo do CI; **nunca** no repositório); gerar `SHA256SUMS`; se não houver certificado (E3) documentar o impacto SmartScreen.
- [ ] **6. Atualizações (`updater.py`):** consulta de versão (URL configurável, JSON assinado/hashes), descarga verificada (SHA-256 + assinatura), nunca executar sem confirmação do utilizador, *rollback* simples; desligado por defeito se E3 = interno.
- [ ] **7. Teste de instalação limpa:** `smoke_installed.ps1` numa VM/Windows Sandbox: instala, arranca, abre Definições (hardware), corre pipeline com `FakeBackend`, verifica logs, desinstala; resultados e capturas em *Evidências*. Verificar também numa máquina **sem** Python.
- [ ] **8. Release CI e docs:** workflow `desktop-release.yml` por *tag* (build, assinar, checksums, artefactos); `docs/packaging.md` (passos, troubleshooting, tabela de tamanhos/tempos); ligar a `VERSION` do monorepo (SemVer); licenças de terceiros (`THIRD_PARTY_LICENSES.md` gerado). Atualizar `README_PLAN`, board/changelog.

## 5. Critérios de aceitação
- Instalação limpa funciona sem Python/SDK instalados; arranque ≤ 3 s (meta; medir).
- Pipeline com backend fake corre a partir do executável congelado.
- Instalador não requer admin; desinstalar não apaga dados sem confirmação.
- Build reprodutível a partir de uma *tag* no CI; checksums publicados.
- Pacote não inclui `onnxruntime` CPU junto de DML.

## 6. Verificação
```powershell
cd desktopapp
python scripts/build_exe.py
./scripts/make_installer.ps1
./scripts/smoke_installed.ps1
```

## 7. Riscos / Fora de âmbito
- Faltam DLLs de DirectML/OpenVINO no pacote: validar com *Dependencies*/`ldd`-equivalente.
- Certificados de assinatura e distribuição pública dependem do humano (E3).

## 8. Prompt específico
```text
Executa a tarefa D15 (desktopapp/TASKS/D15_PACKAGING_INSTALLER.md) seguindo o Prompt mestre do desktop.
Build reprodutível, instalador por utilizador sem admin, nunca apagar dados sem perguntar, nada de segredos no repositório. Prova com instalação limpa (sem Python). Nunca empacotar dois onnxruntime.
```

## 9. Evidências
_(tamanhos, tempos, smoke de instalação, checksums)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
