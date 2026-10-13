# PROTOCOLO PARA LLMs / ENGENHEIROS — PLANO DE IMPLEMENTAÇÃO DO CODE REVIEW

> **Ficheiro:** `TASKS/REVIEW_2026/00_PROTOCOLO_LLM.md`
> **Status do protocolo:** 🟢 ATIVO · **Versão:** 1.0 · **Última atualização:** 2026-10-13
> **Origem:** [`CODE_REVIEW.md`](../../CODE_REVIEW.md) · **Quadro de estado:** [`STATUS_BOARD.md`](STATUS_BOARD.md) · **Registo de alterações:** [`CHANGELOG.md`](CHANGELOG.md)
> **Desktop app (plano gémeo):** [`desktopapp/TASKS/`](../../desktopapp/TASKS/00_PROTOCOLO_LLM.md)

Este ficheiro é a **fonte única de regras** para qualquer LLM ou pessoa que execute uma tarefa `R01…R18`. Ler **sempre** antes de começar.

---

## 1. Contexto do projeto (resumo obrigatório)

- **Athlete Motion**: análise biomecânica de ciclistas (BikeFit). Backend Python/FastAPI + SQLite, frontend Vue 3 (vue-cli), motores de pose (YOLO11-pose ONNX/DirectML, MediaPipe Tasks, RTMPose).
- **Hardware de referência:** Intel Xeon **E5-1660 v3** (8C/16T, Haswell-EP, **AVX2, sem AVX-512/VNNI**, 1 socket) · **AMD Radeon RX 580 8 GB** (Polaris, **DirectML**; sem ganho de FP16/INT8 em GPU) · 32 GB RAM · Windows.
- **Língua:** código e identificadores em inglês; **docstrings, comentários e mensagens ao utilizador em português europeu** (como no código existente), com `pt`/`en` onde já existe i18n.
- **Arquitetura:** Clean/Hexagonal — o **domínio não importa frameworks** (sem FastAPI, SQLAlchemy, Vue).

### Mapa de caminhos (consolidado após R01)
| Caminho legado | Caminho consolidado (R01 ✅) |
|---|---|
| `src/` (pacote `src.*`) | `backend/src/athletemotion/` (pacote `athletemotion.*`) |
| `server.py`, `main.py`, `start.*` | `backend/` (um único entry point `python -m athletemotion.api`) |
| `models/`, `scripts/`, `tests/`, `pyproject.toml`, `uv.lock`, `requirements.txt`, `VERSION` | `backend/…` |
| `frontend/mediapipe/` | `frontend/web/` |
| — | `desktopapp/` (PyQt6 standalone) |

> **R01 está 🔵 REVIEW.** Todas as tarefas (R02–R17) usam os novos caminhos consolidados.

---

## 2. Regras de ouro (violar = tarefa rejeitada)

1. **Uma tarefa de cada vez por LLM.** Não tocar em ficheiros fora do **Âmbito** da tarefa. Se for inevitável, registar em *Notas* e no `CHANGELOG.md`.
2. **Ler o `CODE_REVIEW.md` na secção indicada** e o código atual **antes** de editar. O review foi feito por leitura; **verificar** cada afirmação no código real (podem existir diferenças). Se uma premissa for falsa, registar em *Notas* e ajustar.
3. **Testes primeiro** para bugs (teste que falha → correção → passa). Nunca baixar cobertura.
4. **Nunca** engolir exceções (`except Exception: pass`), nunca devolver `str(e)` ao cliente, nunca inventar valores clínicos por omissão.
5. **Preservar comentários e docstrings** que não tenham relação com a alteração.
6. **Sem dependências novas** sem justificar em *Notas* (licença, tamanho, alternativa) e atualizar `pyproject.toml`/`package.json` + lock.
7. **`onnxruntime` e `onnxruntime-directml` nunca coexistem** no mesmo ambiente. Nunca instalar `onnxruntime` normal.
8. Pesos de modelos (`*.onnx`, `*.pt`, `*.task`) **nunca** vão para o Git.
9. Medições de desempenho: **medir antes e depois** (p50/p95), nunca afirmar ganhos sem números.
10. Commits pequenos, **Conventional Commits** (`fix:`, `feat:`, `perf:`, `refactor:`, `test:`, `docs:`, `chore:`; `BREAKING CHANGE:` quando aplicável). O `VERSION` é gerido por `scripts/bump_version.py`.

---

## 3. Ciclo de vida de uma tarefa e **obrigação de atualizar cabeçalhos**

Estados: `🔴 TODO` → `🟡 IN_PROGRESS` → `🔵 REVIEW` → `🟢 DONE` (ou `⛔ BLOCKED` com motivo).

### 3.1 Ao **iniciar**
Editar o **cabeçalho do ficheiro da tarefa**:
- `Status` → `🟡 IN_PROGRESS`; `Atribuído a` → nome/modelo do LLM; `Início` → data ISO; `Branch` → nome.
- Atualizar a linha da tarefa em [`STATUS_BOARD.md`](STATUS_BOARD.md).
- Acrescentar entrada em [`CHANGELOG.md`](CHANGELOG.md) (`started`).

### 3.2 **Durante** (a cada subtarefa concluída — não só no fim)
- Marcar `- [x]` na checklist de subtarefas.
- Atualizar `Progresso: n/N` e `Última atualização` no cabeçalho.
- Acrescentar linha na tabela **Registo de alterações** no fim do ficheiro da tarefa (data, quem, ficheiros tocados, resumo).
- Se descobrir trabalho novo/desvio: acrescentar em **Notas e Descobertas** e, se for tarefa nova, criar `R19+` e listá-la no board.

### 3.3 Ao **concluir**
1. Todos os critérios de aceitação cumpridos e **comandos de verificação** executados (colar a saída resumida em *Evidências*).
2. `Status` → `🔵 REVIEW` (quem implementa **nunca** marca `DONE` sozinho; o revisor/humano ou um segundo LLM marca `🟢 DONE`).
3. Atualizar `STATUS_BOARD.md` (estado, progresso, data) e `CHANGELOG.md`.
4. **Atualizar os cabeçalhos/estado de qualquer outro documento afetado**: `ARCHITECTURE.md`, `STATUS.md`, `README.md`, `CODE_REVIEW.md` (marcar o item como resolvido com `✅ Resolvido em R0x`), `desktopapp/README_PLAN.md`, `frontend/web/README.md`.

### 3.4 **Qualquer alteração ao projeto, mesmo fora de uma tarefa**
Toda a modificação (correção rápida, refactor, config, dependência) tem de deixar **rasto**:
- linha em `CHANGELOG.md` (data · autor · ficheiros · motivo · tarefa associada ou `ad-hoc`);
- se tocar num ficheiro que tem cabeçalho de estado (`> **Status:**`), **atualizar esse cabeçalho** (`Última atualização`, e `Status` se mudar).

### 3.5 Bloqueios
`Status` → `⛔ BLOCKED`, preencher `Bloqueado por:` (tarefa/decisão/pergunta) no cabeçalho e no board. **Não adivinhar**: fazer a pergunta ao humano.

---

## 4. Definition of Done global (aplica-se a TODAS as tarefas)

- [ ] Critérios de aceitação da tarefa cumpridos.
- [ ] Testes novos/atualizados; `pytest` (backend) e/ou `npm run lint && npm test` (frontend) verdes.
- [ ] `ruff check` e `ruff format --check` limpos nos ficheiros tocados; `mypy` limpo em `domain/` (quando existir configuração).
- [ ] Sem `TODO` por resolver no código novo (se existir, vira item do board).
- [ ] Sem segredos, chaves, dados pessoais ou caminhos absolutos no código/commits.
- [ ] Docstrings (PT) nas funções públicas novas; tipos completos.
- [ ] Cabeçalho da tarefa, `STATUS_BOARD.md`, `CHANGELOG.md` e documentos afetados atualizados (secção 3).
- [ ] Se afeta desempenho: tabela antes/depois (p50/p95) colada em *Evidências*.

---

## 5. Prompt mestre (colar no LLM executor, substituindo `<ID>` e `<FICHEIRO>`)

```text
Atua como engenheiro de software sénior (Python/FastAPI, visão computacional, Vue 3).
Repositório: athleteMotion (Windows, Xeon E5-1660 v3 AVX2 + AMD RX 580 8GB, DirectML).

1) Lê por esta ordem, na íntegra:
   - TASKS/REVIEW_2026/00_PROTOCOLO_LLM.md
   - <FICHEIRO> (a tua tarefa, ID <ID>)
   - as secções de CODE_REVIEW.md que a tarefa referencia
   - o código atual dos ficheiros do Âmbito (não assumes — verifica).
2) Confirma que as dependências da tarefa estão 🟢 DONE no STATUS_BOARD.md. Se não, pára e diz-me.
3) Antes de editar, atualiza o cabeçalho da tarefa (Status 🟡, Atribuído a, Início), o STATUS_BOARD.md e o CHANGELOG.md.
4) Implementa SÓ o Âmbito, subtarefa a subtarefa, com testes primeiro. A cada subtarefa: marca [x], atualiza Progresso e o Registo de alterações da tarefa.
5) Corre os comandos de verificação da tarefa e cola a saída resumida em "Evidências".
6) No fim: Status 🔵 REVIEW, atualiza board/changelog/documentos afetados, e responde com: resumo, ficheiros alterados, evidências, riscos, e perguntas em aberto.
Regras: PT-PT em docstrings/mensagens; não engolir exceções; não inventar valores clínicos; não adicionar dependências sem justificar; não tocar fora do Âmbito; se algo for ambíguo, pergunta.
```

---

## 6. Formato padrão de cada ficheiro de tarefa
Cabeçalho de estado (campos fixos) → Contexto → Objetivo → Âmbito → Subtarefas (checklist) → Critérios de aceitação → Verificação (comandos) → Riscos/Fora de âmbito → Prompt específico → Evidências → Notas e Descobertas → Registo de alterações. **Não remover secções**; escrever "n/a" se não se aplicar.
