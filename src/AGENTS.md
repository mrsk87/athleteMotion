# Regras de Engenharia do Módulo Backend (src/AGENTS.md)

Este documento define as diretrizes obrigatórias para o código do backend (`src/` / `backend/`). Herda integralmente os padrões de **Senior Core Developer** definidos em [../AGENTS.md](../AGENTS.md).

---

## 1. Postura de Engenharia e Princípios ACID no Backend

1. **Separação Rígida de Camadas (Arquitetura Limpa):**
   - `domain/`: Lógica biomecânica pura (ângulos, BDC/TDC, thresholds clínicos, incerteza). **Sem dependências externas de frameworks (FastAPI, SQLAlchemy, PyQt6).**
   - `schemas/`: Contratos Pydantic estritos para validação de entrada e saída.
   - `infrastructure/`: Base de dados, repositórios, drivers de inferência de IA (ONNX, OpenVINO, YOLO), I/O de ficheiros.
   - `services/`: Orquestração de casos de uso e regras transacionais.
   - `api/`: Endpoints FastAPI e rotas de WebSocket. Apenas receção, validação de requisições e serialização de respostas.
2. **Rigor Transacional ACID:**
   - **Atomicidade:** Todas as mutações na base de dados devem correr dentro de transações explícitas (`with session.begin():`). Em caso de exceção de domínio, rollback imediato e automático.
   - **Consistência:** Ativar `PRAGMA foreign_keys = ON;` no SQLite em todas as conexões. Invariantes validados por Pydantic antes de qualquer operação de gravação.
   - **Isolamento:** Uso obrigatório de `PRAGMA journal_mode = WAL;` e `BEGIN IMMEDIATE;` em rotas de mutação para prevenir bloqueios concorrentes de `SQLITE_BUSY`.
   - **Durabilidade:** Operações críticas de persistência devem efetuar flush explícito antes de responder ao cliente.
3. **Escrita Atómica em Disco:**
   - Vídeos enviados, modelos e ficheiros exportados gravam primeiro em ficheiro temporário (`.tmp`) e são movidos atomicamente com `os.replace`.

---

## 2. Legibilidade e Manutenibilidade (Junior & Mid Friendly)

1. **Nomes Intencionais:** Funções matemáticas e biomecânicas com nomenclatura clara e sem abreviações misteriosas (ex.: `calculate_knee_extension_angle_deg`, `detect_bottom_dead_center`).
2. **Exceções de Domínio Tipadas:** Proibido retornar `{"error": "something failed"}` ou silenciar exceções. Criar exceções ricas (ex.: `InvalidKeypointConfidenceError`, `AthleteNotFoundError`).
3. **Tipagem Estrita (100%):** Type annotations obrigatórias em todas as funções e métodos (`mypy --strict`).
4. **Honestidade Clínica:** Proibido inventar ângulos ou usar valores placebo quando os keypoints tiverem baixa confiança; reportar explicitamente `insufficient_data`.
5. **Idioma:** Comentários, docstrings e logs em Português (PT-PT); símbolos e nomes de código em Inglês.
