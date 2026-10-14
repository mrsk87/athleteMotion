# ADR 002: Token Bearer Local Volátil vs. Provedor OAuth Externo (Decisão D2)

> **Status:** Aceite  
> **Data:** 2026-10-13  
> **Decisores:** Senior Core Developer, Board Técnico  
> **Referência:** R04, Decisão D2, CODE_REVIEW §1.1, §1.2  

---

## 1. Contexto e Formulação do Problema
O Athlete Motion opera predominantemente como uma aplicação de estúdio local, estação de trabalho biomecânica ou posto autónomo de BikeFit. A API expõe rotas críticas de streaming de vídeo por WebSocket (`/ws/live-inference`), ingestão de dados biométricos sensíveis e exportação de relatórios.
A introdução de um provedor OAuth2/OIDC externo (ex.: Auth0, Keycloak) imporia dependência obrigatória de conectividade à Internet, latência acrescida nas chamadas locais e complexidade desnecessária para operadores individuais. Por outro lado, deixar as rotas abertas sem autenticação exporia a máquina local a ataques de Cross-Site WebSocket Hijacking (CSWSH) e acesso não autorizado a partir de browsers ou outros utilizadores da mesma rede local.

---

## 2. Decisão Tomada (Decisão D2)
Implementar **Autenticação Local por Token Bearer Criptográfico**:
1. O backend gera automaticamente no arranque um token aleatório criptograficamente seguro com 256 bits (`secrets.token_urlsafe(32)`), persistido localmente em ficheiro restrito (`%APPDATA%/AthleteMotion/api_token` com permissões de utilizador).
2. O servidor pode opcionalmente receber `API_TOKEN` via variável de ambiente.
3. Todas as rotas REST (`/api/v1/*`, `/process_frame`) exigem cabeçalho `Authorization: Bearer <token>`.
4. A ligação WebSocket (`/ws/live-inference`) exige o token no handshake inicial (query parameter `token=` ou cabeçalho HTTP).
5. O frontend web e desktop guardam o token estritamente em RAM (e opcionalmente `sessionStorage`), nunca em `localStorage` persistente.

---

## 3. Consequências e Trade-offs

### 3.1. Positivas (+)
- **Segurança Robusta sem Conexão Externa:** Impede qualquer requisição maliciosa vinda de páginas web externas ou de agentes não autorizados na LAN.
- **Simplicidade Operacional:** Arranque imediato *out-of-the-box* sem configuração de contas, infraestrutura de login ou custos de provedores de identidade.
- **Proteção de WebSocket:** Mitigação total contra ataques de *Cross-Site WebSocket Hijacking*.

### 3.2. Negativas / Custos (-)
- Aplicações clientes externas ou múltiplos utilizadores partilhando a mesma máquina física precisam de ler o token a partir do ficheiro local ou injetá-lo na inicialização.

---

## 4. Conformidade e Validação
Garantido por testes de integração em `tests/integration/test_security.py` validando que requisições sem token devolvem HTTP 401 Unauthorized e que o handshake WebSocket é imediatamente rejeitado com código de encerramento seguro.
