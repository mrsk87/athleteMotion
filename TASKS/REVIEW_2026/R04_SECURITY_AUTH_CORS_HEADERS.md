# R04 — Segurança: autenticação, bind local, CORS, cabeçalhos, erros, rate limit

> **ID:** R04 · **Prioridade:** P0 · **Onda:** 1
> **Status:** 🔴 TODO · **Progresso:** 0/9 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
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
- [ ] **1. Settings:** `Settings(BaseSettings)` com `ENV` (`dev|prod`), `HOST` (default `127.0.0.1`), `PORT`, `ALLOWED_ORIGINS` (lista), `API_TOKEN` (opcional), `ENABLE_DOCS` (default `dev` apenas), `LAN_MODE` (bool), `RATE_LIMIT_*`. Validar: `LAN_MODE=true` **exige** `API_TOKEN` (recusar arrancar sem ele). Criar `.env.example`.
- [ ] **2. Autenticação por token:** dependência FastAPI `require_auth` (header `Authorization: Bearer <token>`, comparação `secrets.compare_digest`). Em modo local sem `API_TOKEN` gerar token aleatório no 1.º arranque, guardá-lo em `APP_DATA_DIR/api_token` (permissões restritas) e imprimi-lo uma vez. Aplicar a **todos** os routers `/api/v1/*` e ao WS (token via `Sec-WebSocket-Protocol` ou 1.ª mensagem — **não** em query string, para não ir para logs). Exceção: `/health` (mínimo) e `/api/version`. *(Se D2 = multi-utilizador, abrir tarefa nova para OAuth2/JWT; esta tarefa fica como token local.)*
- [ ] **3. CORS estrito:** `ALLOWED_ORIGINS` explícito por ambiente; **remover** fallback `*` e o `allow_origin_regex` amplo; `allow_credentials=False` (token é header); métodos `GET,POST,PUT,PATCH,DELETE,OPTIONS`; headers `Authorization,Content-Type`. Em `LAN_MODE`, permitir a origem do frontend configurada (ex.: `https://192.168.1.50:8080`) **só** se listada.
- [ ] **4. Cabeçalhos de segurança** (middleware): `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(self), microphone=()`, `Cache-Control: no-store` nas rotas da API; **CSP** para o frontend servido (documentar para o servidor estático/nginx do frontend).
- [ ] **5. Erros padronizados (RFC 7807):** handlers para `HTTPException`, `RequestValidationError`, `Exception` → `application/problem+json` com `type,title,status,detail(genérico),instance,request_id`. O detalhe técnico só no log (`logger.exception`). Remover `str(e)` de `inference.py` (`switch_engine`, `warmup_engine`). Middleware `request_id` (cabeçalho `X-Request-ID`).
- [ ] **6. Rate limit:** `slowapi` (ou implementação própria em memória com *token bucket*): global por IP/token (ex. 120/min), mais restrito em `/sessions/{id}/pdf` (10/min), `/video/export-gif` (5/min), `/inference/engine/switch` (10/min). Responder 429 com `Retry-After`. Configurável por env.
- [ ] **7. Docs/OpenAPI:** `/docs`, `/redoc`, `/openapi.json` só se `ENABLE_DOCS`. Esquema de segurança Bearer declarado quando ativo.
- [ ] **8. TLS e LAN:** documentar em `docs/security.md` (ou README do backend): como correr com `mkcert` + uvicorn `--ssl-keyfile/--ssl-certfile`, ou atrás de Caddy/nginx; `wss://`; aviso sobre `getUserMedia`. **Não** commitar certificados.
- [ ] **9. Testes de segurança** (`tests/integration/test_security.py`): sem token → 401; token errado → 401; com token → 200; origem não listada → sem `access-control-allow-origin`; 429 após exceder limite; `/docs` 404 em prod; erro 500 não contém traceback nem `str(e)`; `LAN_MODE` sem token → falha de arranque. Marcar CODE_REVIEW §1.1/1.2/1.6/1.7/1.10 `✅ Resolvido em R04` e atualizar `ARCHITECTURE.md`.

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
curl -i http://127.0.0.1:8000/api/v1/athletes            # esperado 401
curl -i -H "Authorization: Bearer $env:API_TOKEN" http://127.0.0.1:8000/api/v1/athletes
```

## 7. Riscos / Fora de âmbito
- Quebra o frontend até R16 enviar o token: **em `ENV=dev` permitir `API_TOKEN` configurável no `.env` do frontend** e atualizar `frontend/web/src/services/api.js` com o mínimo para continuar a funcionar (documentar em *Notas*; refactor completo é R16).
- Autorização por recurso (owner) só se D2 = multi-utilizador.

## 8. Prompt específico
```text
Executa a tarefa R04 (TASKS/REVIEW_2026/R04_SECURITY_AUTH_CORS_HEADERS.md) seguindo o Prompt mestre.
Prioridade: seguro por defeito (127.0.0.1, token, CORS explícito, erros genéricos). Escreve os testes de segurança primeiro.
Nunca passes o token em query string. Nunca devolvas str(e). Se a decisão D2 estiver em aberto, assume single-user com token local e regista a assunção em Notas.
```

## 9. Evidências
_(saídas curl, testes)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
