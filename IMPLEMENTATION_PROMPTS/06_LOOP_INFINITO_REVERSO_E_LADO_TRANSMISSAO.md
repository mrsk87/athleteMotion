# 06_LOOP_INFINITO_REVERSO_E_LADO_TRANSMISSAO.md

# Funcionalidade: Loop Infinito, Inversão de Sentido Temporal e Correção do Perfil do Lado da Transmissão

> **Solicitação do Utilizador:**  
> *"O vídeo deverá ter opção de loop infinito, reprodução sem fim, escolher os pontos do tempo no slide temporal do vídeo que quer que seja o loop, se não tiver loop, reproduz o vídeo todo com as definições escolhidas, a inversão do vídeo é poder escolher de trás para a frente ou de frente para trás, quando se escolhe inverso, o início do vídeo é o final dele em modo normal. Quando o perfil está do lado da transmissão, e se escolhe a opção lado da transmissão, a linha corporal fica mal escolhida, dando a sensação até que está ao contrário pois fica correto quando se escolhe o lado oposto. Não está correto. Sê mais preciso nisso. Escreve num MD e vai fazendo, o que já está feito, ignora."*

---

## 1. Diagnóstico do Problema & Causa Raiz

### 1.1 Inversão dos Marcos Anatómicos no Perfil do Lado da Transmissão (Drive-Side)
- **Convenção de Ciclismo:**  
  - O **Lado da Transmissão** (corrente, pedaleira, desviador traseiro e cassete) corresponde rigorosamente ao **Lado Direito** (`right`) da bicicleta.
  - O **Lado Oposto à Transmissão** (sem corrente) corresponde ao **Lado Esquerdo** (`left`).
- **Definição Oficial do MediaPipe Pose:**  
  - Índices Ímpares = **Esquerdo** (Ombro: 11, Cotovelo: 13, Punho: 15, Anca: 23, Joelho: 25, Tornozelo: 27, Calcanhar: 29, Pé: 31, Orelha: 7).
  - Índices Pares = **Direito** (Ombro: 12, Cotovelo: 14, Punho: 16, Anca: 24, Joelho: 26, Tornozelo: 28, Calcanhar: 30, Pé: 32, Orelha: 8).
- **Causa Raiz do Bug:**  
  - Em `BiomechanicsComputer.js`, `CanvasOverlayRenderer.js` e `LiveCameraCapture.js`, as expressões ternárias estavam invertidas:
    `const kneeIdx = isLeft ? 26 : 25;` (Quando `isLeft` era verdadeiro, selecionava o índice 26 que é DIREITO; quando era falso (`side === 'right'`), selecionava o índice 25 que é ESQUERDO!).
  - Resultado: Ao selecionar *"Perfil Direito (Lado da Transmissão)"*, o sistema calculava e destacava a perna e braço do lado oculto/esquerdo da bicicleta, e só desenhava a perna certa ao selecionar o perfil oposto.

### 1.2 Loop Infinito e Reprodução Sem Fim
- O sistema permitia apenas o loop A-B se o intervalo estivesse ativado. Se o vídeo fosse reproduzido no seu todo sem intervalo definido, o evento `onended` pausava a reprodução.
- Não existia a opção explícita de "Loop Infinito (Reprodução Sem Fim)" que garantisse que tanto o intervalo selecionado como o vídeo completo fizessem repetição perpétua sem parar.

### 1.3 Inversão do Sentido Temporal ("De Trás para a Frente")
- O utilizador especificou a lógica natural da marcha-atrás no vídeo:
  *"quando se escolhe inverso, o início do vídeo é o final dele em modo normal"*.
  - Ao comutar para o sentido inverso ("De Trás para a Frente"), a reprodução deve iniciar-se no final do vídeo (ou no ponto B do intervalo) e andar para trás até ao início (ou ponto A).
  - Em modo de loop infinito, ao atingir o início, deve saltar imediatamente para o final e continuar a reproduzir de trás para a frente indefinidamente.

---

## 2. Arquitetura da Solução

### 2.1 Correção Rigorosa dos Marcos Anatómicos por Lado
- Mapeamento corrigido conforme a especificação oficial:
  * `isLeft === true` (Lado sem corrente): `hip: 23`, `knee: 25`, `ankle: 27`, `heel: 29`, `foot: 31`, `shoulder: 11`, `elbow: 13`, `wrist: 15`, `ear: 7`.
  * `isLeft === false` / `side === 'right'` (Lado da transmissão): `hip: 24`, `knee: 26`, `ankle: 28`, `heel: 30`, `foot: 32`, `shoulder: 12`, `elbow: 14`, `wrist: 16`, `ear: 8`.
- No `canvasOverlayRenderer.js`, o esqueleto principal iluminado passa a ser a perna/braço do lado selecionado, ficando o lado oposto atenuado como fundo.
- Ao clicar no botão de perfil (Esquerdo vs Direito), o canvas e os ângulos recalculam e repintam imediatamente.

### 2.2 Motor de Reprodução em Loop Infinito (`videoUploadManager.js`)
- Propriedade `infiniteLoop = true` (com comutador no ecrã: 🔁 Loop Infinito Ligado/Desligado).
- **Com intervalo A-B selecionado:**
  - Forward: ao atingir `loopEnd`, salta para `loopStart`.
  - Reverse: ao atingir `loopStart`, salta para `loopEnd`.
- **Sem intervalo selecionado (Vídeo completo):**
  - Forward: ao atingir `duration`, salta para `0.0`.
  - Reverse: ao atingir `0.0`, salta para `duration`.

### 2.3 Sentido de Reprodução: Frente p/ Trás vs Trás p/ Frente
- Seletor com rótulos explícitos:
  - `▶ De Frente para Trás (Normal)`
  - `◀ De Trás para a Frente (Invertido)`
- Ao comutar para Invertido: se o leitor estiver no início (tempo ~ 0s), posiciona imediatamente o vídeo no final (`duration` ou `loopEnd`), para que comece a marcha-atrás a partir do fim.

---

## 3. Checklist de Execução por Fases

- [x] **Fase 0: Documentação Técnica e Especificação** (`06_LOOP_INFINITO_REVERSO_E_LADO_TRANSMISSAO.md`).
- [x] **Fase 1: Correção Rigorosa do Lado da Transmissão (MediaPipe Landmarks)**
  - [x] Corrigir índices anatómicos em `biomechanicsComputer.js` (ímpares = Esquerdo, pares = Direito).
  - [x] Corrigir `activeIdx` e `otherIdx` em `canvasOverlayRenderer.js` (`drawSkeleton` e `drawTargetGhostAndGuides`).
  - [x] Corrigir `opticalTracking` e pontos em `LiveCameraCapture.js`.
  - [x] Adicionar repintura e recálculo imediatos ao mudar de lado em `setProfileSide`.
- [x] **Fase 2: Motor de Loop Infinito e Reprodução Sem Fim em `videoUploadManager.js`**
  - [x] Adicionar propriedade `infiniteLoop = true` e métodos de controlo (`toggleInfiniteLoop`, `setLoopRange`).
  - [x] Suporte a loop infinito tanto no vídeo completo como no intervalo selecionado (em `onended`, `ontimeupdate` e `_reverseTick`).
  - [x] Posicionamento no final do vídeo ao entrar em marcha-atrás (`duration` ou `loopEnd`).
- [x] **Fase 3: Controlos e Interface Visual em `LiveCameraCapture.html` e `LiveCameraCapture.js`**
  - [x] Adicionar botão de comutação "♾️ Loop Infinito: Ligado / Desligado" na barra de vídeo.
  - [x] Atualizar botões de sentido para "▶ De Frente p/ Trás" e "◀ De Trás p/ Frente".
  - [x] Adicionar seletores temporais A e B no slide temporal para escolha direta de pontos de tempo.
- [x] **Fase 4: Estilização em `video-analysis.css`**
  - [x] Estilos para botão `.btn-infinite-loop` ativo, sliders de pontos temporais e badges no HUD.
- [x] **Fase 5: Validação e Testes**
  - [x] `npm run build` compilado com sucesso (código 0).
  - [x] `python -m pytest tests/` aprovado (18/18 testes verdes).
  - [x] Commit e validação final.

---

## 4. Registo de Execução em Direto

- **Passo 1:** Documentação técnica gravada no ficheiro markdown.
- **Passo 2:** Correção dos índices MediaPipe (ímpares = Esquerdo, pares = Direito / Lado da Transmissão) em `biomechanicsComputer.js`, `canvasOverlayRenderer.js` e `LiveCameraCapture.js`.
- **Passo 3:** Implementação do motor de reprodução em loop infinito contínuo e inversão de sentido temporal em `videoUploadManager.js`.
- **Passo 4:** Integração de controlos visuais (botão de loop infinito, botões de sentido "De Frente p/ Trás" e "De Trás p/ Frente", seletores de pontos A e B) no template HTML e no controlador Vue.
- **Passo 5:** Estilização dedicada em `video-analysis.css` e badges HUD informativos.
- **Passo 6:** Build do frontend (`npm run build`) validado com código 0 e testes de backend (`python -m pytest tests/`) aprovados com 18/18 testes.
