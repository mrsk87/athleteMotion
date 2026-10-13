# R05 — Hardening de upload, WebSocket, exportação GIF e validação de entradas

> **ID:** R05 · **Prioridade:** P0 · **Onda:** 2
> **Status:** 🔴 TODO · **Progresso:** 0/9 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** R01, R04 · **Bloqueia:** — · **Branch:** `fix/r05-input-hardening` · **PR:** —
> **Referência:** CODE_REVIEW §1.3, §1.4, §1.5, §1.9 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
- `/process_frame`: `await file.read()` lê tudo e **só depois** compara com 5 MB; o endpoint apenas valida (não faz inferência).
- WS `/ws/live-inference`: sem limite de tamanho de mensagem, sem verificação de JPEG/dimensões, sem Origin, sem limite de ligações; `set_engine` com nome arbitrário (parte coberta por R03).
- `/video/export-gif`: até 120 frames base64 sem limite total; PIL sem `MAX_IMAGE_PIXELS`; `async def` com trabalho CPU pesado (bloqueia o event loop); `detail` com `str(e)`.
- `sessions.py`: query params e `raw_landmarks` sem limites; `lang` livre; PDF (`reportlab.Paragraph`) interpreta markup.

## 2. Objetivo
Nenhuma entrada do cliente pode causar consumo desproporcionado de memória/CPU nem corromper relatórios.

## 3. Âmbito
**Cria:** `athletemotion/api/validation/{images.py,limits.py}`, `athletemotion/schemas/limits.py`.
**Altera:** `api/app.py` (`/process_frame`), `api/v1/inference_ws.py`, `api/v1/video.py`, `api/v1/sessions.py` (só Query/valida), `schemas/fit.py`, `services/report_generator.py` (escape), testes.
**Não mexe:** lógica de ângulos/ciclos, auth (R04), refactor do serviço de sessões (R08).

## 4. Subtarefas
- [ ] **1. Limites centrais** (`limits.py` + settings): `MAX_UPLOAD_BYTES=5MB`, `MAX_IMAGE_PIXELS=16_000_000`, `MAX_IMAGE_SIDE=4096`, `WS_MAX_MESSAGE_BYTES=1MB`, `WS_MAX_CONNECTIONS=2`, `GIF_MAX_FRAMES=120`, `GIF_MAX_TOTAL_BYTES=40MB`, `GIF_MAX_SIDE=720`, `MAX_RAW_LANDMARKS_BYTES=64KB`. Todos em `Settings` e testados.
- [ ] **2. `validate_and_decode_image(data) -> np.ndarray`:** verifica magic bytes (JPEG/PNG/WebP — para WebP exigir `RIFF....WEBP`), tamanho, **lê cabeçalho para obter w×h antes de decodificar** (cv2 não permite → usar `PIL.Image.open(...).size` com `Image.MAX_IMAGE_PIXELS` definido, ou `imdecode` com `IMREAD_REDUCED_COLOR_2` não serve: preferir leitura do cabeçalho), rejeita > limites, devolve BGR. Erros tipados (`ImageTooLarge`, `UnsupportedImage`) mapeados para 413/415/422.
- [ ] **3. `/process_frame` sem ler tudo:** leitura em *chunks* com contador (abortar ao exceder `MAX_UPLOAD_BYTES` → 413) e `Content-Length` verificado cedo. Decidir **com o humano** (registar em *Notas*) se o endpoint é removido ou passa a executar inferência real com o motor do `EngineManager` (R03). Por defeito: manter só validação e marcar como `deprecated=True`.
- [ ] **3b. WS:** `--ws-max-size` (uvicorn) = `WS_MAX_MESSAGE_BYTES`; no handler validar `len`, SOI `FFD8`, `w×h` (via cabeçalho JPEG) antes de `imdecode`; rejeitar frames inválidos com contador (fechar a ligação após N inválidos seguidos, código 1003); limitar ligações simultâneas (1013 "try again later"); validar Origin contra `ALLOWED_ORIGINS`; comandos de texto validados por `pydantic` (`type` ∈ `{set_side,warmup,set_engine}`, `side` ∈ `{left,right}`), restante ignorado + log.
- [ ] **4. GIF seguro:** schema com `max_length` total, decodificar em fluxo, `Image.MAX_IMAGE_PIXELS` fixado, somar bytes e abortar; função **síncrona** (`def`) executada no threadpool (ou `anyio.to_thread.run_sync`); mensagens de erro genéricas (índice do frame sim, texto de exceção não); `Content-Length` correto.
- [ ] **5. Validação de parâmetros de sessão:** `Query(..., ge=,le=)` para `kops_offset ∈ [-100,100]` mm, `saddle_drop ∈ [-20,20]` cm, `cadence_rpm ∈ [20,200]`, `power_watts ∈ [0,2500]`; `lang: Literal["pt","en"]`; `SnapshotCreate`: ângulos `0 ≤ x ≤ 360`, `frame_index ≥ 0`, `raw_landmarks` com limite de tamanho serializado.
- [ ] **6. PDF seguro:** escapar todo texto do utilizador (`xml.sax.saxutils.escape`) antes de `Paragraph`; teste com `<b>`, `<img src=...>`, `&`, nomes muito longos (truncar), e `\x00`. Nome do ficheiro no `Content-Disposition` sanitizado (só `[A-Za-z0-9_.-]`).
- [ ] **7. Testes** (`tests/integration/test_input_hardening.py`): upload 6 MB → 413 **sem** ter lido tudo (medir bytes lidos com stream falso); JPEG 20000×20000 (cabeçalho forjado) → 413/422; PNG com magic bytes válidos mas corrompido → 422; WS mensagem 2 MB → fecho; WS 3.ª ligação → recusada; GIF com 121 frames → 422; GIF com 100 frames de 5 MB cada → 413; parâmetros fora de gama → 422; PDF com markup malicioso gera PDF válido sem interpretar tags.
- [ ] **8. Documentação:** limites numa tabela em `docs/limits.md`; marcar CODE_REVIEW §1.3/1.4/1.5/1.9 `✅ Resolvido em R05`; atualizar `ARCHITECTURE.md` (secção API) retirando a afirmação "blindado contra DoS" se algo ficar por cumprir.

## 5. Critérios de aceitação
- Memória do processo não cresce > 2× o limite durante o teste de upload gigante (medir com `tracemalloc`/`psutil`).
- Event loop não bloqueia durante export de GIF (teste: `/health` responde < 100 ms durante o export).
- Todas as entradas inválidas devolvem 4xx **problem+json** sem detalhes internos.
- Cobertura dos módulos novos ≥ 90 %.

## 6. Verificação
```powershell
cd backend
pytest tests/integration/test_input_hardening.py -q; pytest -q
```

## 7. Riscos / Fora de âmbito
- Limites demasiado agressivos podem quebrar uso legítimo (câmaras 4K): tornar configuráveis e documentar.
- Cifra, RGPD e retenção → R06.

## 8. Prompt específico
```text
Executa a tarefa R05 (TASKS/REVIEW_2026/R05_SECURITY_UPLOAD_WS_GIF_INPUT.md) seguindo o Prompt mestre.
Escreve primeiro os testes de abuso (ficheiro gigante, imagem forjada, WS grande, GIF enorme, markup no PDF). Todos os limites vêm de Settings.
Não leias o corpo todo antes de validar o tamanho. Mensagens de erro genéricas.
```

## 9. Evidências
_(saídas de teste, medição de memória)_

## 10. Notas e Descobertas
_(vazio — incluir decisão sobre `/process_frame`)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
