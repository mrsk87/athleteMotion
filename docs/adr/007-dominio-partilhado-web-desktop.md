# ADR 007: Domínio Biomecânico Puro Partilhado entre Web e Desktop (Decisão D4)

> **Status:** Aceite  
> **Data:** 2026-10-14  
> **Decisores:** Senior Core Developer, Equipa de Arquitetura  
> **Referência:** R01, R08, R12, Decisão D4, CODE_REVIEW §2.2, §2.3  

---

## 1. Contexto e Formulação do Problema
O Athlete Motion possui dois canais de apresentação distintos:
1. **Frontend Web (`frontend/web`):** Uma aplicação Single Page Application (SPA) em Vue 3, Pinia e ECharts concebida para sessões remotas, tablets, navegadores e análise de sessões gravadas.
2. **Desktop App (`desktopapp/`):** Uma aplicação nativa para Windows baseada em PyQt6, desenhada para operação em estúdios de BikeFit com ligação direta a câmaras USB/UVC industriais, visualização de latência zero com DirectML e buffers de memória partilhada.
No código legado, regras de validação ergonómica, cálculos de KOPS e fórmulas de selim estavam duplicadas em ficheiros JavaScript no frontend e em handlers de rotas no backend. Esta duplicação resultava em diagnósticos divergentes consoante o utilizador usasse a Web ou a aplicação Desktop.

---

## 2. Decisão Tomada (Decisão D4)
1. **Domínio Biomecânico Puro Centralizado (`athletemotion.domain`):**
   - Toda a inteligência clínica, cálculos angulares, deteção de ciclo (BDC/TDC), calibração métrica espacial e pareceres ergonómicos residem **exclusivamente no backend Python**, dentro de `athletemotion.domain`.
   - Este domínio é estritamente puro: zero dependências de FastAPI, SQLAlchemy, WebSockets ou PyQt6.
2. **Camada de Apresentação Agnóstica:**
   - O Frontend Web interage com o domínio via API REST OpenAPI e WebSocket `/ws/live-inference`.
   - A Aplicação Desktop (`desktopapp/`) importa e executa o mesmo pacote `athletemotion` diretamente in-process ou via IPC de alto rendimento, consumindo as mesmas funções de domínio sem qualquer divergência matemática.
3. **Contratos Tipados OpenAPI / Pydantic:**
   - Os schemas de saída (`SnapshotResponse`, `FitReportResponse`, `CoachReport`) são validados rigorosamente via Pydantic v2 e exportados para TypeScript (`scripts/generate-api-types.mjs`), garantindo paridade total de contratos.

---

## 3. Consequências e Trade-offs

### 3.1. Positivas (+)
- **Fonte Única da Verdade (SSOT):** Uma correção de limiar ergonómico (ex.: ajuste de BDC para triatlo) reflete-se imediatamente e de forma idêntica em todas as plataformas.
- **Zero Divergência Clínica:** O ciclista obtém exatamente os mesmos pareceres, milímetros de recuo de selim e ângulos quer o teste seja conduzido na Web quer seja no Desktop.
- **Facilidade Extrema de Testes:** O domínio pode ser exaustivamente testado em milissegundos sem necessidade de levantar servidores HTTP ou renderizar componentes gráficos.

### 3.2. Negativas / Custos (-)
- A interface web necessita de estar ligada ao servidor local para computação em tempo real (mitigada por modo offline resiliente em IndexedDB documentado em R16).

---

## 4. Conformidade e Validação
Garantido por testes unitários em `tests/unit/test_domain_angles.py`, `tests/unit/test_measures_sagittal.py` e testes de paridade de esquema em `tests/unit/test_ai_coach.py`.
