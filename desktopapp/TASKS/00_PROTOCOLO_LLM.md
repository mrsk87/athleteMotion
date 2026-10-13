# PROTOCOLO PARA LLMs / ENGENHEIROS — DESKTOP APP (PyQt6)

> **Ficheiro:** `desktopapp/TASKS/00_PROTOCOLO_LLM.md`
> **Status do protocolo:** 🟢 ATIVO · **Versão:** 1.0 · **Última atualização:** 2026-10-13
> **Plano de origem:** [`../README_PLAN.md`](../README_PLAN.md) · **Quadro:** [`STATUS_BOARD.md`](STATUS_BOARD.md) · **Registo:** [`CHANGELOG.md`](CHANGELOG.md)
> **Protocolo base (herdado integralmente):** [`TASKS/REVIEW_2026/00_PROTOCOLO_LLM.md`](../../TASKS/REVIEW_2026/00_PROTOCOLO_LLM.md)

Aplicam-se **todas** as regras do protocolo base (ciclo de vida, cabeçalhos, DoD global, prompt mestre) com as **adições/diferenças** abaixo. Em conflito, **este ficheiro prevalece** para tarefas `D01…D16`.

---

## 1. Contexto (resumo obrigatório)
- App **desktop nativa Windows**, **PyQt6**, para tempo real e análise de vídeo com **máximo desempenho** no hardware físico: Xeon **E5-1660 v3** (8C/16T, AVX2, sem VNNI, 1 socket) + **RX 580 8 GB** (DirectML) + 32 GB RAM.
- **Reutiliza o domínio e a inferência do backend** (`pip install -e ../backend`, pacote `athletemotion`, criado em **R01**). **Proibido copiar** código de `domain/`, `inference/`, `infrastructure/backends` para o desktop.
- Sem chaves de API; qualquer LLM é **local e opcional** (D16).
- Offline-first; sincronização com o backend opcional.

## 2. Estrutura-alvo (`desktopapp/`)
```
desktopapp/
├─ pyproject.toml
├─ src/athletemotion_desktop/
│  ├─ __main__.py · app.py · config/
│  ├─ runtime/      # SEM Qt: capture, preprocess, ring_buffer, inference_worker, pipeline, metrics, backends adapters
│  ├─ domain_bridge/  services/  ui/ (views, widgets, viewmodels, theme, i18n)  resources/
├─ tests/ (unit, integration, ui, perf)  ·  scripts/  ·  packaging/  ·  TASKS/
```

## 3. Regras específicas do desktop
1. **`runtime/` nunca importa PyQt** (nem `PyQt6`, nem `QtCore`). Comunica por filas/`shared_memory`/callbacks. Testável por CLI.
2. **A UI nunca bloqueia**: nenhuma inferência, I/O de disco/rede ou decode na *main thread*. Máximo de **8 ms** de trabalho por *slot* na thread de UI (medido com `QElapsedTimer` e testado).
3. **Windows `spawn`**: todo o código multiprocessing usa `if __name__ == "__main__"` + `multiprocessing.freeze_support()`; sem estado global importado com efeitos laterais; objetos transferidos entre processos têm de ser *picklable* ou memória partilhada.
4. **Memória partilhada**: todo `SharedMemory` tem dono único que faz `unlink()`; testes verificam ausência de *leaks* (`/psm_*` nomes) após shutdown.
5. **Latest-frame-wins**: filas entre captura→inferência têm tamanho 1 e descartam o mais antigo; contadores de *drops* expostos nas métricas.
6. **Sem `time.sleep` em laços de tempo real**: usar eventos/`wait(timeout)`.
7. **Relógio:** `time.perf_counter_ns()` para latências; *timestamps* de frame vêm da captura (não do consumo).
8. **Qt:** sinais/slots com tipos explícitos; `QThread`/workers só para I/O curto; sem acesso a widgets fora da thread de UI; `QT_QPA_PLATFORM=offscreen` nos testes.
9. **Dados do utilizador** em `%APPDATA%/AthleteMotion/` (nunca ao lado do executável); **não gravar vídeo** sem opção explícita e consentimento (R06).
10. **Medir antes e depois** qualquer alteração de desempenho; metas do orçamento de latência em `README_PLAN.md` §4.2 são **metas** — registar os valores reais.

## 4. Caminhos e comandos de referência
```powershell
cd desktopapp
uv venv --python 3.11
uv pip install -e ../backend[directml,openvino] -e .[dev]
python -m athletemotion_desktop
$env:QT_QPA_PLATFORM="offscreen"; pytest -q
ruff check .; ruff format --check .; mypy src/athletemotion_desktop/runtime
```

## 5. DoD adicional (além do global)
- [ ] `mypy --strict` limpo em `runtime/` e `domain_bridge/`.
- [ ] Teste de *shutdown limpo*: após fechar, 0 processos filhos e 0 `SharedMemory` órfãos.
- [ ] Sem fugas de memória em corrida de 10 min (teste de integração marcado `slow`; RSS crescimento < 5 %).
- [ ] Qualquer texto visível em **PT e EN** (Qt `.ts`/`tr()`), sem *strings* soltas.
- [ ] Cabeçalho da tarefa, `STATUS_BOARD.md`, `CHANGELOG.md` **e** `README_PLAN.md` (§12 roadmap) atualizados.

## 6. Prompt mestre (desktop)
```text
Atua como engenheiro sénior (Python, PyQt6, visão computacional, ONNX Runtime DirectML/OpenVINO, multiprocessing no Windows).
Repositório: athleteMotion — pasta desktopapp/. Hardware: Xeon E5-1660 v3 (AVX2) + AMD RX 580 8GB.

1) Lê na íntegra, por esta ordem:
   - TASKS/REVIEW_2026/00_PROTOCOLO_LLM.md (regras base)
   - desktopapp/TASKS/00_PROTOCOLO_LLM.md (regras do desktop)
   - <FICHEIRO> (tarefa <ID>)
   - desktopapp/README_PLAN.md nas secções referenciadas
   - o código atual dos ficheiros do Âmbito.
2) Confirma no desktopapp/TASKS/STATUS_BOARD.md (e TASKS/REVIEW_2026/STATUS_BOARD.md quando há dependência R..) que as dependências estão 🟢 DONE. Se não, pára e diz-me.
3) Atualiza o cabeçalho da tarefa (Status 🟡, Atribuído a, Início), o STATUS_BOARD.md e o CHANGELOG.md antes de editar.
4) Implementa SÓ o Âmbito, subtarefa a subtarefa, com testes primeiro; a cada subtarefa: [x], Progresso e Registo de alterações.
5) Corre os comandos de verificação e cola a saída (e as medições) em "Evidências".
6) No fim: Status 🔵 REVIEW, atualiza board/changelog/README_PLAN e responde com resumo, ficheiros, evidências, riscos e perguntas.
Regras: runtime/ sem Qt; UI nunca bloqueia; PT-PT; nunca copiar código do backend (importa); não engolir exceções; sem dependências novas sem justificar; pergunta se algo for ambíguo.
```
