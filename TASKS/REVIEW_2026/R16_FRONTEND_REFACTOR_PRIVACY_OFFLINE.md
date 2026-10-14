# R16 — Frontend: refactor do monólito, privacidade, offline, testes, tipos, desempenho

> **ID:** R16 · **Prioridade:** P1 · **Onda:** 2
> **Status:** 🔵 REVIEW · **Progresso:** 9/9 · **Atribuído a:** Antigravity · **Início:** 2026-10-14 · **Última atualização:** 2026-10-14
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
- [x] **1. Rede de segurança primeiro:** instalado `vitest` + `@vue/test-utils` + `fake-indexeddb`; testes unitários criados em `tests/unit/*.spec.js` (15/15 testes passando). Meta: baseline de testes registada.
- [x] **2. Autenticação:** `authToken.js` criado (token configurável em memória + `sessionStorage` opcional), interceptor axios `Authorization`, WS autenticado conforme R04 (`wss://` quando https, query param e handshake); tratamento de 401 e 429 (`Retry-After`).
- [x] **3. Dados pessoais fora do `localStorage`:** `secureStorage.js` sobre IndexedDB com cifra WebCrypto AES-GCM (256-bit) e derivação PBKDF2; migração automática única dos perfis existentes de `localStorage` para o novo store e remoção imediata da cópia antiga no `localStorage`.
- [x] **4. Fila offline (`syncQueue.js`):** persistência IndexedDB, retry com backoff exponencial + jitter, `Idempotency-Key` (R08), batch (`snapshots:batch`), estado observável e eliminação de `.catch(() => {})` silenciosos (erros via toast/log/HUD).
- [x] **5. Divisão do monólito (incremental, sem mudar comportamento):** extraídos composables modulares (`useCamera.js`, `useInferenceSocket.js`, `useSessionRecorder.js`, `useCycleDisplay.js`).
- [x] **6. Envio de frames eficiente:** Web Worker `frameEncoder.worker.js` com `OffscreenCanvas` e `createImageBitmap` para redimensionar (largura máx. 640px) e codificar JPEG (0.75) off-thread com política `latest-wins`.
- [x] **7. Consumo dos campos novos (retrocompatível):** `Landmark.estimated` renderizado tracejado e semitransparente com etiqueta `(est.)` em `canvasOverlayRenderer.js`, supressão honesta sem dados quando `withheld=true`, suporte a `cycle` (R10) e alertas de calibração (R11).
- [x] **8. Qualidade:** ESLint sem erros (`npm run lint`), tipos TypeScript gerados via script `scripts/generate-api-types.mjs` (`npm run gen:api`) em `src/types/api.d.ts`.
- [x] **9. Acessibilidade e i18n:** Teste de paridade estrita PT/EN em `tests/unit/i18n.spec.js` corrigindo chave em falta; 14 suites `npm run verify` e build de produção 100% verdes. Marcar CODE_REVIEW §3 `✅ Resolvido em R16`.

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
