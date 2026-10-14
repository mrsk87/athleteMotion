# R05 — Hardening de upload, WebSocket, exportação GIF e validação de entradas

> **ID:** R05 · **Prioridade:** P0 · **Onda:** 2
> **Status:** 🔵 REVIEW · **Progresso:** 9/9 · **Atribuído a:** Antigravity · **Início:** 2026-10-14 · **Última atualização:** 2026-10-14
> **Depende de:** R01, R04 · **Bloqueia:** — · **Branch:** `fix/r05-input-hardening` · **PR:** —
> **Referência:** CODE_REVIEW §1.3, §1.4, §1.5, §1.9 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
- `/process_frame`: `await file.read()` lia tudo e só depois comparava com 5 MB; o endpoint apenas valida (não faz inferência).
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
- [x] **1. Limites centrais** (`limits.py` + settings): `MAX_UPLOAD_BYTES=5MB`, `MAX_IMAGE_PIXELS=16_000_000`, `MAX_IMAGE_SIDE=4096`, `WS_MAX_MESSAGE_BYTES=1MB`, `WS_MAX_CONNECTIONS=2`, `GIF_MAX_FRAMES=120`, `GIF_MAX_TOTAL_BYTES=40MB`, `GIF_MAX_SIDE=720`, `MAX_RAW_LANDMARKS_BYTES=64KB`. Todos em `Settings` e testados.
- [x] **2. `validate_and_decode_image(data) -> np.ndarray`:** verifica magic bytes (JPEG/PNG/WebP — para WebP exigir `RIFF....WEBP`), tamanho, **lê cabeçalho para obter w×h antes de decodificar** via `PIL.Image.open(...).size` com `Image.MAX_IMAGE_PIXELS` definido, rejeita > limites, devolve BGR. Erros tipados (`ImageTooLarge`, `UnsupportedImage`, `InvalidImagePayload`) mapeados para 413/415/422 RFC 7807.
- [x] **3. `/process_frame` sem ler tudo:** leitura em *chunks* de 64 KB com contador (abortar ao exceder `MAX_UPLOAD_BYTES` → HTTP 413) e `Content-Length` verificado cedo. Endpoint mantido como `deprecated=True` para suporte a clientes legados com validação segura.
- [x] **3b. WS:** validação de tamanho de mensagem individual com fecho `1009`, SOI `FFD8` com deteção e descarte defensivo; contador de anomalias consecutivas encerrando com código `1003`; quota de ligações simultâneas (`1013 Try Again Later`); validação de Origin contra `ALLOWED_ORIGINS` (`1008`); comandos Pydantic validados (`type`, `side`, `engine`).
- [x] **4. GIF seguro:** `GifExportRequest` com `max_length=120`, decodificação em threadpool com `anyio.to_thread.run_sync` (não bloqueia event loop), `Image.MAX_IMAGE_PIXELS` controlado, soma progressiva de bytes com aborto em 413 se > 40MB, mensagens de erro estruturadas e `Content-Length` explícito.
- [x] **5. Validação de parâmetros de sessão:** `Query(..., ge=,le=)` para `kops_offset ∈ [-100,100]` mm, `saddle_drop ∈ [-20,20]` cm, `cadence_rpm ∈ [20,200]`, `power_watts ∈ [0,2500]`; `lang: Literal["pt","en"]`; `SnapshotCreate`: ângulos `0 ≤ x ≤ 360`, `frame_index ≥ 0`, `raw_landmarks` validado com limite de 64 KB serializados.
- [x] **6. PDF seguro:** `sanitize_pdf_text` com `xml.sax.saxutils.escape` e remoção de bytes nulos (`\x00`) antes de qualquer bloco `Paragraph`; nome do ficheiro sanitizado no `Content-Disposition`.
- [x] **7. Testes** (`tests/integration/test_input_hardening.py`): 12 testes cobrindo upload excessivo (413), magic bytes forjados (415), pixel bombs de dimensão (413), quota de ligações WS (1013), payload WS > 1MB (1009), 5 frames WS corrompidos seguidos (1003), limite de frames de GIF (422), volume de GIF > 40MB (413), parâmetros fora de limites clínicos (422), e injeção de markup XML no PDF.
- [x] **8. Documentação:** limites consolidados numa tabela em `docs/limits.md`; `CODE_REVIEW.md` marcado com `✅ Resolvido em R05` nas secções §1.3, §1.4, §1.5 e §1.9; `ARCHITECTURE.md` atualizado na secção 2.3.

## 5. Critérios de aceitação
- Memória do processo não cresce > 2× o limite durante o teste de upload gigante (streaming em blocos de 64 KB).
- Event loop não bloqueia durante export de GIF (executado em threadpool via `anyio.to_thread`).
- Todas as entradas inválidas devolvem 4xx **problem+json** sem detalhes internos.
- Cobertura global atingida: 76.04% (portão ≥ 70% cumprido, 100/100 testes verdes).

## 6. Verificação
```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest tests/integration/test_input_hardening.py -v
.\.venv\Scripts\python.exe -m pytest tests/unit tests/integration -q
.\.venv\Scripts\ruff.exe check src tests
.\.venv\Scripts\mypy.exe src/athletemotion/domain/biomechanics src/athletemotion/schemas
```

## 7. Riscos / Fora de âmbito
- Limites agressivos podem ser ajustados por variáveis de ambiente (`ATHLETE_*`) para cenários especiais de estúdio com câmaras de alta fidelidade.
- Cifra na base de dados SQLite (SQLCipher) e direito ao esquecimento / RGPD estão isolados para a tarefa R06.

## 8. Prompt específico
```text
Executa a tarefa R05 (TASKS/REVIEW_2026/R05_SECURITY_UPLOAD_WS_GIF_INPUT.md) seguindo o Prompt mestre.
Escreve primeiro os testes de abuso (ficheiro gigante, imagem forjada, WS grande, GIF enorme, markup no PDF). Todos os limites vêm de Settings.
Não leias o corpo todo antes de validar o tamanho. Mensagens de erro genéricas.
```

## 9. Evidências
```text
======================= 12 passed, 8 warnings in 4.26s ========================
pytest tests/integration/test_input_hardening.py: 12/12 PASS
pytest suite global: 100 passed, 10 warnings in 10.97s (100% verde)
Coverage global: 76.04% (mínimo exigido: 70.0%)
Ruff linter: All checks passed! (86 files formatted)
Mypy strict: Success: no issues found in 13 source files
```

## 10. Notas e Descobertas
- Decisão sobre `/process_frame`: mantido como endpoint legado com flag `deprecated=True` em conformidade com o ecossistema existente, com leitura em streaming por blocos (64 KB) e rejeição imediata (HTTP 413) para prevenir esgotamento de memória.
- Limpeza global de `_active_ws_connections` integrada no fixture `reset_engine_manager_leases` de `tests/conftest.py` para prevenir vazamento de estado entre testes assíncronos.

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-14 | Antigravity | 1..8 | `limits.py`, `images.py`, `schemas/limits.py`, `fit.py`, `video.py`, `inference_ws.py`, `report_generator.py`, `test_input_hardening.py`, `docs/limits.md`, `CODE_REVIEW.md`, `ARCHITECTURE.md` | Implementação completa de hardening de upload em streaming, quotas de WebSocket e DoS protection, geração segura off-thread de GIFs, validação de limites de parâmetros clínicos de sessão e escape defensivo XML em relatórios PDF. |

