# R04 — Segurança: autenticação, bind local, CORS, cabeçalhos, erros, rate limit

> **ID:** R04 · **Prioridade:** P0 · **Onda:** 1
> **Status:** 🔵 REVIEW · **Progresso:** 9/9 · **Atribuído a:** Antigravity (LLM) · **Início:** 2026-10-13 · **Última atualização:** 2026-10-13
> **Depende de:** R01 · **Bloqueia:** R05, R16 · **Branch:** `feat/r04-security-baseline` · **PR:** —
> **Referência:** CODE_REVIEW §1.1, §1.2, §1.6, §1.7, §1.10 · **Decisão humana D2** (STATUS_BOARD) · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
- `server.py` (hoje) liga a `0.0.0.0`; sem autenticação em REST/WS; `/docs` público.
- CORS: fallback `allow_origins=["*"]` + `allow_credentials=True`; `allow_origin_regex` aceita qualquer IP privado em qualquer porta; métodos/headers `*`.
- `inference.py` devolve `str(e)` ao cliente. Sem handlers globais de erro, sem rate limit, sem cabeçalhos de segurança.
- `getUserMedia` exige contexto seguro fora de `localhost` (HTTPS) — afeta uso por telemóvel na LAN.

## 2. Objetivo
Linha de base de segurança **configurável por ambiente**: por defeito só `127.0.0.1`; modo LAN opt-in com token; CORS estrito; erros padronizados; limites de taxa; cabeçalhos; documentação de TLS.

## 3. Âmbito
**Cria:** `athletemotion/config/settings.py` (pydantic-settings), `athletemotion/api/security/{auth.py,cors.py,headers.py,errors.py,rate_limit.py}`.
**Altera:** `api/app.py`, `api/v1/router.py` (dependências globais), `api/v1/inference.py` (erros), `.env.example`, testes.
**Não mexe:** validação de upload/WS/GIF (R05), RGPD (R06), frontend (R16 consome o token).

## 4. Subtarefas
- [x] **1. Settings:** `Settings` em `athletemotion/config/settings.py` com `env` (`dev|prod`), `host` (default `127.0.0.1`), `port`, `allowed_origins` (lista sem wildcard), `api_token` (persistido ou env), `enable_docs` (default dev), `lan_mode` (bool), `rate_limit_*`. Validação estrita: `lan_mode=true` sem `api_token` recusa arranque. Criado `.env.example`.
- [x] **2. Autenticação por token:** dependência FastAPI `require_api_token` (header `Authorization: Bearer <token>`, validação com `secrets.compare_digest`). Geração automática em primeiro arranque de token criptográfico seguro em `APP_DATA_DIR/api_token`. Aplicado globalmente em `/api/v1/*` e ao WebSocket (`Sec-WebSocket-Protocol`, header `x-api-token` ou primeira mensagem WS com timeout de 3s; nunca em query string). Rotas públicas explicitamente isoladas: `/health` e `/api/version`.
- [x] **3. CORS estrito:** `ALLOWED_ORIGINS` explícito e validado; remoção de wildcard `*` e regex ampla; `allow_credentials=False` (Bearer header); métodos e cabeçalhos restritos.
- [x] **4. Cabeçalhos de segurança** (`SecurityHeadersMiddleware`): `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(self), microphone=()`, `Cache-Control: no-store, no-cache, must-revalidate` nas rotas da API.
- [x] **5. Erros padronizados (RFC 7807):** handlers para `HTTPException`, `RequestValidationError`, `Exception` → `application/problem+json` com `type,title,status,detail,instance,request_id`. Detalhe de erro interno mascarado sem vazar exceções nem tracebacks. Sanitizado `inference.py`. Middleware `RequestIdMiddleware` (`X-Request-ID`).
- [x] **6. Rate limit:** Sliding window em memória thread-safe (`SlidingWindowRateLimiter`): 120 req/min global, rotas estritas (10 req/min para PDF/GIF/switch de motor). Devolve `429 Too Many Requests` com cabeçalho `Retry-After`.
- [x] **7. Docs/OpenAPI:** `/docs`, `/redoc`, `/openapi.json` condicionados a `settings.docs_url` e `settings.redoc_url` (desativados em `env=prod` ou quando `enable_docs=False`). Declaração de security scheme `BearerAuth` no OpenAPI.
- [x] **8. TLS e LAN:** Documentação completa em `docs/security.md` para execução com `mkcert`, uvicorn SSL e Caddy/Nginx reverse proxy, explicitando requisitos de contexto seguro HTTPS para `getUserMedia`.
- [x] **9. Testes de segurança** (`tests/integration/test_security.py`): 9 testes cobrindo recusa sem token (401), token inválido (401), autenticação válida (200), CORS bloqueando origem desconhecida, rate limit atingido (429), mascaramento de exceção interna 500 RFC 7807, validação LAN mode sem token, e autenticação WS via protocolo e via primeira mensagem. Atualizados `CODE_REVIEW.md`, `ARCHITECTURE.md` e suíte completa.

## 5. Critérios de aceitação
- `python -m athletemotion.api` liga a `127.0.0.1` por defeito; sem `--lan` não há exposição à rede.
- Todos os endpoints (exceto `/health`, `/api/version`) devolvem 401 sem token válido; o WS fecha com código 1008 sem token.
- Nenhuma resposta de erro contém texto de exceção interna (teste que injeta uma exceção com marcador e verifica ausência na resposta).
- `grep -R "allow_origins=\[\"\*\"\]"` e `grep -R "0.0.0.0"` no backend → 0 (exceto docs/exemplo comentado).
- Suite de testes verde; `pip-audit` sem novas vulnerabilidades introduzidas.

## 6. Verificação
```powershell
cd backend
pytest tests/integration/test_security.py -q; pytest -q
```

## 7. Riscos / Fora de âmbito
- Assunção D2: Single-user local com token Bearer persistido em `APP_DATA_DIR/api_token`.
- O frontend precisará de configurar o header `Authorization: Bearer <token>` (abordado na Onda de frontend R16).

## 8. Prompt específico
```text
Executa a tarefa R04 (TASKS/REVIEW_2026/R04_SECURITY_AUTH_CORS_HEADERS.md) seguindo o Prompt mestre.
Prioridade: seguro por defeito (127.0.0.1, token, CORS explícito, erros genéricos). Escreve os testes de segurança primeiro.
Nunca passes o token em query string. Nunca devolvas str(e). Se a decisão D2 estiver em aberto, assume single-user com token local e regista a assunção em Notas.
```

## 9. Evidências
- **Testes unitários e de integração:** 69 testes executados e 100% aprovados (`69 passed, 2 warnings in 8.56s`).
- **Testes de segurança dedicados:** 9 testes em `tests/integration/test_security.py` passando deterministicamente.
- **Ruff linter:** Verificação estática limpa sem avisos em `src/athletemotion/api/security`, `app.py` e `test_security.py`.

## 10. Notas e Descobertas
- **WebSocket Auth sem Query String:** Browsers no cliente padrão `new WebSocket(url)` não permitem adicionar headers customizados arbitrários. Para manter segurança máxima e conformidade com logs, foi implementado suporte ao subprotocolo `Sec-WebSocket-Protocol: athlete-auth.<token>` e fallback de handshake por mensagem estruturada imediata `{"type": "auth", "token": "..."}` com timeout de 3 segundos antes do fecho imediato com código `1008 Policy Violation`.
- **Sliding Window em Memória:** Implementação pura em Python com `collections.deque` e `threading.Lock`, eliminando dependências externas desnecessárias (`slowapi`/`redis`) para contexto desktop/on-premise.

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-13 | Antigravity (LLM) | 1-9 | `config/settings.py`, `api/security/*`, `api/app.py`, `api/v1/router.py`, `api/v1/inference.py`, `tests/integration/test_security.py`, `docs/security.md` | Linha de base completa de segurança implementada e validada (69/69 testes verdes) |

