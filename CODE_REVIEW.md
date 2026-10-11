# Auditoria Técnica e Revisão de Código Sênior / Senior Code Review

> **Projeto:** Athlete Motion  
> **Auditor:** Senior Principal Engineer  
> **Data:** 11 de Outubro de 2026 | **Versão:** v0.3.0  
> **Língua Mãe:** Português (PT) | **Secondary:** English (EN)  

---

## 1. Sumário Executivo da Auditoria Sénior

A plataforma **Athlete Motion** atingiu maturidade operacional avançada, com as 22 funcionalidades de BikeFit (de `FEAT-09` a `FEAT-22`) integralmente implementadas e funcionais:
- Modelos biomecânicos validados (LeMond, Hamley 109%, Holmes, KOPS horizontal, Saddle Drop, Índice de Simetria $SI$).
- Pipeline de visão computacional em tempo real a 60 FPS com MediaPipe Pose em WebAssembly no cliente, desacoplado da inferência assíncrona.
- Persistência transacional relacional com conformidade estrita aos princípios ACID (SQLite WAL).
- 17/17 testes unitários e de integração aprovados com Pytest em 3.13s.
- Geração de relatórios PDF bilingues via ReportLab e parecer de Treinador Biomecânico com IA.

Contudo, a auditoria sénior identificou **ficheiros monolíticos gigantes que violam a facilidade de leitura para programadores juniores** (`LiveCameraCapture.js` com 1.458 linhas, `LiveCameraCapture.css` com 740 linhas e `biomechanics.py` com 560 linhas), condensados no catálogo de 3 prompts modulares em `IMPLEMENTATION_PROMPTS/`.

---

## 2. Matriz de Diagnóstico Técnico e Resolução

| Item de Auditoria | Severidade | Diagnóstico Técnico | Ação Corretiva Exigida |
| :--- | :---: | :--- | :--- |
| **Ficheiros Gigantes / God Objects (Frontend)** | Crítica | `LiveCameraCapture.js` (1.458 linhas), `LiveCameraCapture.css` (740 linhas) e template (432 linhas) misturam 10 responsabilidades, impossíveis de manter por juniores. | Decompor num orquestrador magro (< 200 linhas) e 6 módulos especializados em `modules/` (< 120 linhas cada) + sub-estilos em `styles/`. |
| **Ficheiros Monolíticos no Backend** | Média | `src/domain/biomechanics.py` (560 linhas) acumula limiares, fórmulas, dimensionamento e diagnósticos num único ficheiro. | Transformar em pacote modular `src/domain/biomechanics/` (`thresholds.py`, `fitting.py`, `diagnostics.py`) com menos de 150 linhas por ficheiro. |
| **Artefactos Linux de venv no Git** | Alta | Pastas `bin/`, `lib64/`, `share/` e `pyvenv.cfg` provêm de `/home/mario/...` e continuam rastreadas no índice do Git (`git ls-files bin ...`). | Executar `git rm -r --cached bin lib64 share pyvenv.cfg` e eliminar ficheiros físicos. |
| **Dependências Obsoletas no Backend** | Média | `requirements.txt` ainda lista `mediapipe` e `opencv-contrib-python`, mas o MediaPipe corre 100% no browser (WebAssembly). Causa erros em Python 3.12+. | Alinhar `requirements.txt` com `pyproject.toml`, removendo as bibliotecas não consumidas. |
| **Componentes Mortos / Boilerplate** | Média | `HelloWorld/`, `BikeFitAnalyzer/` e `Camera/` legado (e respectivos `.vue` shims na raiz de `components/`) são código morto substituído por `LiveCameraCapture`. | Eliminar as pastas e shims legados para reduzir overhead e prevenir confusão de desenvolvedores. |
| **Imports Desalinhados no Frontend** | Baixa | `HomeView.js` importa componentes via caminhos profundos em vez de usar os ficheiros `index.js` das pastas dedicadas. Imports mortos em `LiveCameraCapture.js` (`drawConnectors`, `POSE_CONNECTIONS`) e `FitReportView.js` (`axios`). | Padronizar imports via `index.js` e expurgar referências mortas. |
| **Injeção de Sessão DB (`get_db`)** | Média | Endpoints de leitura em `athletes.py`, `bikes.py` e `sessions.py` usam blocos manuais `session = SessionLocal()` com `try/finally` repetidos. | Implementar gerador `get_db()` em `database.py` e injetar com `db: Session = Depends(get_db)`. |
| **Schema Deslocado da Camada** | Baixa | `EstimateRequest` declarado dentro de `src/api/v1/biomechanics.py` em vez de residir em `src/schemas/fit.py`. | Centralizar em `src/schemas/fit.py` mantendo isolamento estrito de camadas. |
| **Isolamento de Banco nos Testes** | Alta | `test_api.py` corre fixtures diretamente contra a base de produção `athlete_motion.db`, poluindo o histórico. | Usar base de dados SQLite em memória (`:memory:`) ou ficheiro temporário isolado. |

---

## 3. Estado dos Prompts de Implementação (`IMPLEMENTATION_PROMPTS/`)

- **Prompts Concluídos e Eliminados (21 Ficheiros):**
  Todos os prompts com tarefas 100% implementadas e validadas foram eliminados (`01` a `03`, `05` a `22`).
- **Novo Catálogo Modular Ativo (Regra de Ouro: < 150-250 Linhas por Ficheiro):**
  1. [`01_REFACTOR_limpeza_git_e_codigo_morto.md`](file:///d:/Projects/athleteMotion/IMPLEMENTATION_PROMPTS/01_REFACTOR_limpeza_git_e_codigo_morto.md): Higiene Git, eliminação de venv Linux e componentes mortos (`HelloWorld`, `Camera`, `BikeFitAnalyzer`).
  2. [`02_REFACTOR_decomposicao_arquivos_gigantes_frontend.md`](file:///d:/Projects/athleteMotion/IMPLEMENTATION_PROMPTS/02_REFACTOR_decomposicao_arquivos_gigantes_frontend.md): Decomposição cirúrgica de `LiveCameraCapture.js` (1.458 linhas) e `LiveCameraCapture.css` (740 linhas) em submódulos didáticos para juniores.
  3. [`03_REFACTOR_modularizacao_backend_e_testes_isolados.md`](file:///d:/Projects/athleteMotion/IMPLEMENTATION_PROMPTS/03_REFACTOR_modularizacao_backend_e_testes_isolados.md): Decomposição de `biomechanics.py` (560 linhas), injeção `Depends(get_db)` e isolamento da base de dados nos testes.
