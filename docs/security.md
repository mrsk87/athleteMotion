# Linha de Base de Segurança e Operação em Rede — Athlete Motion

> **Status:** 🟢 VIGENTE · **Versão:** 0.3.1 · **Última atualização:** 2026-10-14 · **Responsável:** Senior Core Developer · **Revisto contra o código em:** `788dcbb`
> **Módulo:** `athletemotion.api.security` · **Referência:** R04

Este documento estabelece as diretrizes de segurança aplicadas à API do Athlete Motion, abrangendo autenticação, controlo de origens (CORS), cabeçalhos de proteção (OWASP), tratamento seguro de erros e configuração de TLS para uso em rede local (LAN).

---

## 1. Modelo de Autenticação e Autorização

### 1.1. Autenticação Local por Token Bearer
Por padrão, o servidor liga-se a `127.0.0.1` e exige autenticação em todas as rotas operacionais (`/api/v1/*`, `/process_frame` e `/ws/live-inference`).
- **Geração Automática:** Se a variável `API_TOKEN` não for definida, o sistema gera automaticamente no primeiro arranque um token criptograficamente seguro (256 bits, `secrets.token_urlsafe(32)`) e grava-o em `%APPDATA%/AthleteMotion/api_token` (ou `$HOME/.athletemotion/AthleteMotion/api_token`).
- **Cabeçalho Requerido:**
  ```http
  Authorization: Bearer <API_TOKEN>
  ```
- **Comparação Temporalmente Constante:** A verificação utiliza `secrets.compare_digest` para neutralizar ataques de temporização (*timing attacks*).

### 1.2. Rotas Isentas de Autenticação
Apenas as rotas públicas essenciais de integridade e metadados estão isentas:
- `GET /` — Metadados básicos de estado.
- `GET /health` — Verificação de prontidão do servidor.
- `GET /api/version` — Versão SemVer atual.
- Documentação OpenAPI (`/docs`, `/redoc`, `/openapi.json`) quando `ENABLE_DOCS=true`.

### 1.3. Autenticação no WebSocket (`/ws/live-inference`)
O canal WebSocket valida o token através dos cabeçalhos de ligação:
- Cabeçalho padrão `Authorization: Bearer <API_TOKEN>`.
- Cabeçalho `Sec-WebSocket-Protocol: bearer, <API_TOKEN>`.
- Cabeçalho `X-Api-Token: <API_TOKEN>`.
- Em navegadores com restrições de headers em `new WebSocket()`, o servidor aceita a ligação temporariamente e aguarda a primeira mensagem no formato `{"type": "auth", "token": "<API_TOKEN>"}` dentro de 3 segundos. Falhas de autenticação fecham o socket com código **1008 (Policy Violation)**.
- **Proibição:** O token nunca deve ser enviado na query string (`?token=...`) para impedir vazamento em registos de acesso e proxies.

---

## 2. Modo LAN e Exposição em Rede Local

Por razões estritas de segurança, a API rejeita arrancar em modo de rede aberta sem proteção:
- **`LAN_MODE=false` (Padrão):** O servidor escuta em `127.0.0.1`.
- **`LAN_MODE=true`:** Exige obrigatoriamente a definição de `API_TOKEN`. Se a variável estiver vazia, o arranque falha imediatamente com erro explicativo.

---

## 3. Requisito de TLS / HTTPS para Captura de Câmara (`getUserMedia`)

Os navegadores modernos (Chrome, Firefox, Safari) **bloqueiam estritamente** o acesso à câmara do telemóvel (`navigator.mediaDevices.getUserMedia`) quando acedido por endereço IP da rede local via HTTP comum (ex: `http://192.168.1.50:8080`). O acesso à câmara exige um **Contexto Seguro** (*Secure Context*):
- `http://localhost` ou `http://127.0.0.1` (sempre considerado seguro);
- Qualquer ligação via **HTTPS** (`https://...`).

### 3.1. Como Configurar Certificados Locais com `mkcert`
Para aceder à aplicação a partir de um smartphone na mesma rede Wi-Fi com suporte a câmara:

1. **Instalar `mkcert` no computador:**
   ```bash
   choco install mkcert   # Windows
   mkcert -install
   ```

2. **Gerar certificado para o IP da sua máquina local (exemplo: 192.168.1.100):**
   ```bash
   mkcert localhost 127.0.0.1 192.168.1.100
   # Gera localhost+2.pem (certificado) e localhost+2-key.pem (chave privada)
   ```

3. **Iniciar o backend com SSL:**
   ```bash
   uvicorn athletemotion.api.app:app --host 0.0.0.0 --port 8000 --ssl-keyfile localhost+2-key.pem --ssl-certfile localhost+2.pem
   ```

> **Aviso Importante:** Certificados e chaves privadas (`*.pem`, `*.key`) nunca devem ser adicionados ao repositório Git.

---

## 4. CORS e Cabeçalhos de Segurança (OWASP)

- **CORS Estrito:** Apenas as origens explicitamente declaradas em `ALLOWED_ORIGINS` têm acesso. O fallback curinga `*` foi permanentemente removido, prevenindo requisições de sites maliciosos na LAN.
- **Cabeçalhos Injetados Automaticamente:**
  - `X-Content-Type-Options: nosniff` — Impede ataques baseados em confusão de tipos MIME.
  - `X-Frame-Options: DENY` — Bloqueia embutimento em `iframe` e previne *clickjacking*.
  - `Referrer-Policy: no-referrer` — Oculta referências e caminhos de origem em navegações externas.
  - `Permissions-Policy: camera=(self), microphone=()` — Limita o uso de câmara ao domínio da app e bloqueia microfone.
  - `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` — Impede armazenamento em cache intermédio de dados biométricos da API.

---

## 5. Respostas de Erro RFC 7807 (Problem Details) e Rastreabilidade

Todas as falhas e exceções retornam o formato canónico RFC 7807 (`application/problem+json`):
```json
{
  "type": "about:blank",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Autenticação necessária. Forneça o cabeçalho 'Authorization: Bearer <token>'.",
  "instance": "/api/v1/athletes",
  "request_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

- **Sem Fuga de Dados Técnicos:** Erros internos (500) nunca expõem *tracebacks* nem `str(exc)` ao cliente. O erro detalhado é gravado nos logs com o respetivo `request_id`, enquanto o cliente recebe uma mensagem amigável e segura.
- **Rastreabilidade:** Cada requisição recebe um cabeçalho `X-Request-ID` para correlação direta entre frontend e registos do servidor.

---

## 6. Limitação de Taxa de Requisições (Rate Limiting)

Implementado através de algoritmo de janela deslizante (*Sliding Window*) em memória:
- **Limite Global:** 120 requisições por minuto por cliente (`RATE_LIMIT_PER_MINUTE`).
- **Limite Estrito:** 10 requisições por minuto para endpoints pesados (`/sessions/{id}/pdf`, `/video/export-gif`, `/inference/engine/switch`).
- **Resposta 429 Too Many Requests:** Quando ultrapassado, devolve o cabeçalho `Retry-After: <segundos>` e payload descritivo RFC 7807.
