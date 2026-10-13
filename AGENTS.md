# Regras de Engenharia e Princípios de Desenvolvimento (AGENTS.md)

Este documento define as diretrizes obrigatórias de engenharia, arquitetura e estilo de código para qualquer agente AI (e desenvolvedores) a operar neste repositório. O objetivo primordial é manter o padrão de um **Senior Core Developer de topo mundial**: código robusto, sustentável, compreensível e de fácil manutenção por engenheiros juniores e mid-level.

---

## 1. Postura de Engenharia: Senior Core Developer

1. **Rigor e Clareza:** Cada linha de código deve ter um propósito evidente. Sem atalhos frágeis, sem código placebo ("mockups" disfarçados de lógica real) e sem suposições não validadas.
2. **Separação Rígida de Responsabilidades (SoC):**
   - **Domínio puro:** Lógica biométrica, cálculos angulares e regras clínicas residem isolados de qualquer framework (sem FastAPI, sem PyQt6, sem SQLAlchemy no domínio).
   - **Infraestrutura:** Base de dados, câmaras, hardware, I/O e drivers de IA adaptam o domínio ao mundo exterior.
   - **Apresentação:** Web e Desktop apenas renderizam e recolhem inputs; nunca computam regras de negócio.
3. **Simplicidade Pragmática:** Evitar sobre-engenharia desnecessária. Preferir soluções explícitas, desacopladas e testáveis a abstrações complexas e herméticas.

---

## 2. Princípios ACID e Integridade de Estado

Todas as operações de persistência e mutação de estado (SQLite, ficheiros de configuração, sessões e estado de aplicação) devem respeitar estritamente as propriedades ACID:

### 2.1. Atomicidade (Atomicity)
- Toda a mutação de dados ocorre numa transação explícita de "tudo ou nada".
- **Base de Dados:** Nunca executar múltiplos `commit()` intermédios dentro de um fluxo lógico. Usar context managers transacionais (`with session.begin():` ou `with db_transaction():`). Em caso de exceção, rollback automático obrigatório.
- **Operações em Ficheiros:** Nunca sobrescrever ficheiros críticos diretamente em streaming. Gravar primeiro para um ficheiro temporário (`.tmp`) no mesmo sistema de ficheiros e fazer replace atómico (`os.replace` / `shutil.move`).

### 2.2. Consistência (Consistency)
- Os invariantes de negócio devem ser validados antes e depois de qualquer gravação.
- Schemas validados rigorosamente via Pydantic (`strict=True` quando aplicável) e restrições de integridade na base de dados (Foreign Keys ativas no SQLite via `PRAGMA foreign_keys = ON;`, `CHECK constraints`, `NOT NULL`).
- Nunca persistir nem emitir estados parciais ou inválidos (ex.: sessões sem atleta associado, ângulos calculados fora do intervalo anatómico sem flag de incerteza).

### 2.3. Isolamento (Isolation)
- Proteger contra condições de corrida (*race conditions*) em acessos concorrentes.
- No SQLite com múltiplos threads ou processos (ex.: FastAPI workers ou Desktop runtime):
  - Ativar `PRAGMA journal_mode = WAL;` e `PRAGMA synchronous = NORMAL;`.
  - Usar transações imediatas (`BEGIN IMMEDIATE;`) para operações de escrita para evitar bloqueios tardios de `SQLITE_BUSY`.
- Em concorrência interna (Desktop / Shared Memory): usar mutexes explícitos, ring buffers com semáforos atómicos e double-buffering (*latest-frame-wins*) devidamente sincronizados.

### 2.4. Durabilidade (Durability)
- Dados confirmados não podem ser perdidos em caso de encerramento abrupto ou crash.
- Transações críticas devem fazer flush explícito (`fsync` quando o estado de calibração ou relatório for gravado).
- Shutdown limpo com tratamento de sinais (`SIGINT`, `SIGTERM`, `QCloseEvent`) para libertar recursos, fechar transações abertas e descarregar buffers pendentes.

---

## 3. Legibilidade e Facilidade de Manutenção (Junior & Mid Friendly)

O código deve ser uma ferramenta de aprendizagem e clareza para toda a equipa:

1. **Nomes Intencionais e Autoexplicativos:**
   - Funções, variáveis e classes devem declarar exatamente o que fazem sem necessidade de adivinhação.
   - *Mau:* `def calc_a(p1, p2, p3): ...` / `k_val = 148.0`
   - *Bom:* `def calculate_joint_angle_deg(proximal_point: Point2D, vertex_joint: Point2D, distal_point: Point2D) -> float:`
2. **Explícito é Melhor que Implícito ("Clean & Honest Code"):**
   - Evitar "one-liners" crípticos, compreensões de listas triplamente aninhadas ou truques de metaprogramação desnecessários.
   - Decompor algoritmos complexos em passos sequenciais nomeados.
3. **Tipagem Estrita e Completa:**
   - Todos os argumentos, retornos e atributos de classe devem conter Type Annotations completas (`typing`, `Pydantic`, `numpy.typing.NDArray`).
   - Sem uso cego de `Any`; usar `Union`, `Optional` ou generics apropriados.
4. **Tratamento de Erros Explicativo e Defensivo:**
   - Proibido engolir exceções com `except Exception: pass` ou `except: pass`.
   - Criar exceções de domínio tipadas (ex.: `AthleteNotFoundError`, `InvalidCalibrationPointsError`).
   - Mensagens de erro devem contextualizar o problema: o que falhou, que valor foi recebido e o que era esperado.
5. **Documentação e Comentários Orientados ao "Porquê":**
   - Comentários não repetem o que o código faz; explicam o **motivo**, o contexto biomecânico ou a decisão arquitetural.
   - Docstrings em estilo estruturado (Google ou Sphinx/PEP 257) com secções claras de `Args:`, `Returns:` e `Raises:`.
   - Idioma: Português (PT-PT) para comentários, docstrings e documentação de projeto; Inglês para símbolos de código (nomes de funções, classes e variáveis).

---

## 4. Performance Nativa e Concorrência

1. **Aproveitamento Bare-Metal do Hardware:**
   - Priorizar execução nativa no host Windows (DirectML na AMD Radeon RX 580, OpenVINO AVX2 no Intel Xeon E5-1660 v3).
   - Zero duplicação de frames na memória: utilizar memória partilhada (`multiprocessing.shared_memory`) e views NumPy (`np.frombuffer`).
2. **UI Nunca Bloqueia:**
   - O thread principal da interface gráfica (PyQt6 ou Web) nunca pode executar I/O síncrono, inferência de redes neuronais ou descodificação de vídeo. Tudo é delegado a processos/workers desacoplados com comunicação não-bloqueante.
3. **Gestão Rigorosa de Recursos:**
   - Fechar explicitamente descritores de ficheiros, leases de memória partilhada, câmaras OpenCV (`cap.release()`) e sessões ONNX/OpenVINO (`del session`).

---

## 5. Testabilidade e Portões de Qualidade

1. **Testes Unitários Obrigatórios:** Qualquer lógica de negócio adicionada ou alterada deve vir acompanhada de testes unitários com asserções numéricas determinísticas.
2. **Sem Dados Falsificados em Produção:** Se uma medição não puder ser calculada por falta de confiança dos keypoints, o sistema deve reportar explicitamente `insufficient_data` ou `None`, nunca inventar valores padrão clínicos.
3. **Verificação Estática:** Código submetido deve passar em linters e type-checkers sem avisos (`ruff check`, `mypy --strict`).
