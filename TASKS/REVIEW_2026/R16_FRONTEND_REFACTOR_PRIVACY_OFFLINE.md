# R16 — Frontend: refactor do monólito, privacidade, offline, testes, tipos, desempenho

> **ID:** R16 · **Prioridade:** P1 · **Onda:** 2
> **Status:** 🔴 TODO · **Progresso:** 0/9 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** R01, R04 · **Bloqueia:** — · **Branch:** `refactor/r16-frontend` · **PR:** —
> **Referência:** CODE_REVIEW §3, §1.8, §1.10 · **Decisão humana D4 (vue-cli vs Vite)** · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar em `frontend/web/src`)
- `components/LiveCameraCapture/LiveCameraCapture.js` ≈ 179 KB (>4000 linhas) + `.html` ≈ 99 KB; já existem `modules/` (≈ 40 ficheiros) → extração incompleta.
- Perfis/baseline/preferências em `localStorage` (PII do atleta: `LiveCameraCapture.js` ~l.3534-3600, `AthleteOnboarding/modules/athleteProfiles.js`).
- `api.recordSnapshot(...).catch(() => {})` engole erros; `offlineStorage.js` usa IndexedDB mas sem *retry* estruturado.
- `inferenceStore.js`: `WS_BASE = process.env.VUE_APP_WS_URL || 'ws://localhost:8000'` (vue-cli); sem token (R04).
- `i18n.js` ≈ 37 KB com dicionário manual; sem testes de frontend; `v-html` em `HelpTip` (SVG estático).
- `posePipelineRunner.js` envia frames ao backend (confirmar formato/qualidade/resolução).

## 2. Objetivo
Frontend manutenível e seguro: componente dividido em *composables*, dados pessoais fora do `localStorage`, fila offline robusta, autenticação por token, envio eficiente de frames, testes e tipos graduais.

## 3. Âmbito
**Cria:** `src/composables/{useCamera.js,useInferenceSocket.js,useSessionRecorder.js,useCycleDisplay.js}`, `src/services/{authToken.js,secureStorage.js,syncQueue.js}`, `src/workers/frameEncoder.worker.js`, `tests/unit/**`, `tests/e2e/**`.
**Altera:** `LiveCameraCapture/*`, `services/api.js`, `services/offlineStorage.js`, `stores/inferenceStore.js`, `AthleteOnboarding/*`, `i18n.js`, `package.json`, `vue.config.js`.
**Não mexe:** backend; lógica biomecânica nova (vem do backend: R10/R12).

## 4. Subtarefas
- [ ] **1. Rede de segurança primeiro:** instalar `vitest` + `@vue/test-utils` (+ `playwright` para e2e); testes de caracterização dos módulos puros existentes (`modules/*.js`, `services/*`) e *smoke e2e* (abrir app, onboarding, mock do WS). Meta: baseline de cobertura registada.
- [ ] **2. Autenticação:** `authToken.js` (token configurável em ecrã de definições/`.env`, guardado só em memória + `sessionStorage` opcional), interceptor axios `Authorization`, WS autenticado conforme R04 (sub-protocolo/1.ª mensagem); tratar 401 (ecrã de pedido de token) e 429 (`Retry-After`). `wss://` quando a página é `https`.
- [ ] **3. Dados pessoais fora do `localStorage`:** `secureStorage.js` sobre IndexedDB com cifra opcional WebCrypto (AES-GCM, chave derivada de PIN/`passphrase` — **não** guardar a chave); migração única dos perfis existentes de `localStorage` para o novo store e **remoção** da cópia antiga; preferências de UI (tema, HUD) podem ficar em `localStorage`. Ecrã de consentimento (versão do texto de R06).
- [ ] **4. Fila offline (`syncQueue.js`):** persistência IndexedDB, *retry* com *backoff* exponencial + *jitter*, `Idempotency-Key` (R08), batch (`snapshots:batch`), estado visível (pendentes/erros) e **nunca** `.catch(() => {})` silencioso: erros → toast + log + contador.
- [ ] **5. Divisão do monólito (incremental, sem mudar comportamento):** extrair para composables (`useCamera`: stream/dispositivos/permissões/limpeza em `beforeUnmount`; `useInferenceSocket`: ligação/reconexão/backoff/estado; `useSessionRecorder`: snapshots/sessão; `useCycleDisplay`: consome `cycle` do payload R10). Objetivo mensurável: `LiveCameraCapture.js` ≤ 1500 linhas, nenhum ficheiro novo > 500. Cada extração = 1 commit + testes + verificação manual (checklist em *Evidências*).
- [ ] **6. Envio de frames eficiente:** Web Worker + `OffscreenCanvas`/`createImageBitmap` para redimensionar (largura máx. configurável, default 640) e `convertToBlob({type:'image/jpeg', quality:0.75})`; `requestVideoFrameCallback` para sincronização; 1 frame em voo (*latest-wins*); métricas de latência fim-a-fim no HUD de debug. Comparar CPU de UI antes/depois (DevTools Performance).
- [ ] **7. Consumo dos campos novos (retrocompatível):** `Landmark.estimated` (desenhar a tracejado/transparente e rotular "estimado"), `is_bdc/is_tdc`, `cycle`, `confidence`, `withheld`, `warnings` de calibração; UI **não** mostra valor com `withheld=true`. Textos via i18n PT/EN.
- [ ] **8. Qualidade:** ESLint (`plugin:vue/vue3-recommended`, regra que **proíbe `v-html`** exceto com comentário de exceção), Prettier, `npm run lint`/`test` no CI; tipos graduais: `jsconfig` → `// @ts-check` + JSDoc nos `services/` e `stores/`, e tipos da API gerados com `openapi-typescript` a partir do OpenAPI do backend (script `npm run gen:api`). Decidir D4 (Vite) e, se aprovado, tarefa separada.
- [ ] **9. Acessibilidade e i18n:** `aria-live` para alertas, contraste AA verificado (axe), foco visível, navegação por teclado nos controlos; mover dicionários para ficheiros por idioma carregados sob demanda (`vue-i18n` se aprovado) com teste de paridade PT/EN. Marcar CODE_REVIEW §3 `✅ Resolvido em R16`.

## 5. Critérios de aceitação
- `grep -R "localStorage" src` só devolve preferências de UI não pessoais (lista em *Notas*).
- Nenhum `.catch(() => {})` no código; erro de sincronização visível ao utilizador.
- `LiveCameraCapture.js` ≤ 1500 linhas; testes e e2e verdes; build OK; lint 0 erros.
- Com backend com auth: sem token → ecrã de token; com token → fluxo completo funciona.
- CPU de UI durante captura reduzida (valor antes/depois registado).

## 6. Verificação
```powershell
cd frontend/web
npm ci; npm run lint; npm run test; npm run build
npx playwright test
```

## 7. Riscos / Fora de âmbito
- Refactor grande: **PRs pequenos**, um composable por vez; manter app funcional a cada commit.
- Migração para TypeScript total/Vite → só após D4.

## 8. Prompt específico
```text
Executa a tarefa R16 (TASKS/REVIEW_2026/R16_FRONTEND_REFACTOR_PRIVACY_OFFLINE.md) seguindo o Prompt mestre.
Cria primeiro testes de caracterização. Refactor incremental (1 composable por commit) sem mudar comportamento. Remove PII do localStorage com migração. Nunca engolir erros de rede. Respeita retrocompatibilidade dos campos novos da API.
```

## 9. Evidências
_(testes, linhas por ficheiro antes/depois, profiling UI, checklist manual)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
