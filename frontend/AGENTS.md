# Regras de Engenharia do Módulo Frontend (frontend/AGENTS.md)

Este documento define as diretrizes obrigatórias para o subprojeto `frontend/`. Herda integralmente os padrões de **Senior Core Developer** definidos em [../AGENTS.md](../AGENTS.md).

---

## 1. Postura de Engenharia e Princípios de Estado (ACID-Aligned) no Frontend

1. **Separação Rígida de Responsabilidades:**
   - Componentes Vue e templates HTML destinam-se exclusivamente à renderização e captura de eventos do utilizador.
   - **Zero computação biomecânica:** Todos os cálculos angulares, regras de bikefit e diagnósticos são obtidos através da API/WebSocket do backend.
2. **Atomicidade e Consistência de Estado (Pinia / Vue State):**
   - Mutações de estado da sessão de treino ou calibração devem ocorrer de forma atómica.
   - Proibido deixar stores num estado parcial inconsistente (ex.: sessão marcada como ativa sem dados do atleta).
   - Validação de dados recebidos via WebSocket/REST antes de atualizar os componentes visuais.
3. **Isolamento de Eventos e Reatividade Limpa:**
   - Desacoplamento estrito entre streaming de vídeo/WebSocket e a reatividade de formulários.
   - Evitar re-renders desnecessários e loops infinitos de watch/effect.
4. **Durabilidade e Tolerância a Falhas:**
   - Resiliência na ligação WebSocket com reconexão automática e indicação visual inequívoca do estado de rede (conectado, a reconectar, desconectado).
   - Preservação de configurações do utilizador no `localStorage` de forma segura e estruturada.

---

## 2. Legibilidade e Manutenibilidade (Junior & Mid Friendly)

1. **Nomes Claros e Declarativos:** Props, eventos emitidos e métodos de componentes devem ter nomes que expliquem exatamente o que realizam (ex.: `onCalibrationCompleted`, `athleteProfileSelected`).
2. **Componentização Modular:** Evitar ficheiros monolíticos de 1000+ linhas; dividir vistas complexas em subcomponentes reutilizáveis e focados.
3. **Tipagem e Props Estritas:** Todas as `props` devem ter validação de tipo explícita, valores por omissão e documentação das suas expectativas.
4. **Tratamento Visível de Erros:** Proibido capturar erros de rede silenciosamente (`catch () {}`). Todo o erro deve ser apresentado amigavelmente ao utilizador através de notificações de erro (toasts ou banners).
5. **Idioma:** Comentários, documentação e textos de interface em Português (PT-PT); nomes de variáveis e componentes em Inglês.
