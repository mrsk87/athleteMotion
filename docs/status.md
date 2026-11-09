# Estado Consolidado do Projeto — Athlete Motion

> **Status:** 🟢 VIGENTE · **Versão:** 0.4.0 · **Última atualização:** 2026-11-09 · **Responsável:** Senior Core Developer · **Revisto contra o código em:** `v0.4.0`

---

## 1. Resumo Executivo e Progresso

O projeto **Athlete Motion** atingiu o patamar de referência de nível mundial com a versão **0.4.0**, introduzindo capacidades avançadas de simulação preditiva, metrologia CAD sem fita métrica, estimativa de torque e visualização de última geração:

- **Progresso Global do Plano de Tarefas:** **18 / 18 Tarefas Base (100%) + 7 Novas Funcionalidades de Elite Concluídas**
- **Testes Unitários e de Integração:** **230 / 230 testes verdes** no backend (`pytest tests -q`)
- **Testes Unitários de Frontend:** **31 / 31 testes verdes** no frontend (`npm run test`)
- **Portões de Verificação Clínica:** **14 / 14 suites clínicas aprovadas** (`npm run verify`)
- **Linters e Qualidade Estática:** `ruff check` (0 erros) · `mypy` limpo · `verify-theme` 100% conforme tokens CSS
- **Desempenho de Inferência:** YOLO11n-pose @ 4.12 ms / 241 FPS · RTMPose-m @ 8.20 ms / 119 FPS em DirectML (AMD Radeon RX 580)

---

## 2. Novas Funcionalidades de Elite Implementadas (v0.4.0)

1. **Simulador Cinemático de Ajustes ("Digital Twin 2D"):**
   - Motor matemático analítico de cinemática direta 2D (`kinematic_simulator.py`).
   - Resolução determinística por interseção círculo-círculo com alinhamento ao ângulo do tubo de selim (73.5° / 253.5° BDC).
   - Detetor de riscos ergonómicos (faixa de Holmes 140°-150°, hiperextensão poplítea, sobrecarga patelar).
   - Endpoint REST `POST /api/v1/biomechanics/simulate-adjustments`.
   - Painel interativo Vue 3 (`KinematicSimulator.vue`) com sliders a 60 FPS.

2. **Auto-Deteção de Geometria Bike CAD (Sem fita métrica):**
   - Metrologia precisa de Stack, Reach, Altura do Selim, Recuo, Saddle Drop e Wheelbase (`bike_cad.py`).
   - Propagação rigorosa de incerteza métrica via `ScaleCalibration` (R11).
   - Endpoint REST `POST /api/v1/calibration/bike-cad`.

3. **Estimativa de Torque Inverso & Força Patelofemoral ($F_{\text{PF}}$):**
   - Modelo biomecânico dinâmico de Winter 2D (`joint_torque.py`).
   - Cálculo da força compressiva patelofemoral ($F_{\text{PF}} = 2 F_q \sin(\theta/2)$) e tensão em MPa (área de contacto Huberti & Hayes).
   - Diagnóstico clínico de sobrecarga por selim baixo.
   - Endpoint REST `POST /api/v1/biomechanics/patellofemoral-stress`.

4. **Modo Fantasma (Ghost Overlay Antes vs Depois):**
   - Incorporado no `SessionComparator` com alternador Split-Screen vs Modo Fantasma.
   - Controlo contínuo de opacidade (0% a 100%).
   - Alinhamento sincronizado por fase (BDC, TDC, 3h).
   - Sobreposição cromática: Antes (Coral `#ef4444`) vs Depois (Esmeralda `#10b981`).
   - Vetores de deslocamento articular dinâmicos ($\Delta$).

5. **Diagrama Polar 360° de Força Efetiva:**
   - Motor de renderização atualizado (`polarPlotter.js`) com setores de potência coloridos: Impulsão (30°-150°), Transição e Recuperação (210°-330°).
   - Cálculo de Suavidade da Pedalada (PSI %) e Eficácia do Torque (TE %).
   - Ponteiro e agulha de orientação em tempo real.

6. **Sincronização Estéreo Dual-Câmara:**
   - Composable `useDualCamera.js` para captura simultânea de 2 câmaras USB/Webcam (Sagital + Frontal).
   - Layouts Side-by-Side e Picture-in-Picture sincronizados com carimbo temporal ISO de precisão clínica.

7. **Relatório Web Interativo com Código QR:**
   - Emissão de Código QR vetorial nativo ReportLab em `pdf.py` sem dependências externas.
   - Leitor web de relatório interativo (`WebReportView.vue`) na rota `/report/:id` com slow-motion scrubber e diagrama polar.

---

## 2. Matriz de Tarefas do Plano de Engenharia (REVIEW_2026)

| ID | Área / Módulo | Prioridade | Onda | Estado | Entregas Principais |
|:---:|---|:---:|:---:|:---:|---|
| **R01** | Estrutura de Repositório | P0 | 0 | 🟢 Completo | Reestruturação `backend/src/athletemotion`, `frontend/`, `desktopapp/` |
| **R02** | Domínio e Biomecânica | P0 | 1 | 🟢 Completo | Ângulos euclidianos em pixels, estimador de pés Winter 2009 |
| **R03** | Concorrência e Lifespan | P0 | 1 | 🟢 Completo | Isolamento de motores por conexão, EngineLease, single-worker executor |
| **R04** | Linha de Base de Segurança | P0 | 1 | 🟢 Completo | Bearer token local em RAM, headers OWASP, rate limiting, CORS estrito |
| **R05** | Hardening de Entrada | P1 | 2 | 🟢 Completo | Limites de upload por streaming, inspeção Pillow contra decompression bombs |
| **R06** | Privacidade e RGPD | P1 | 2 | 🟢 Completo | Consentimento explícito, cifra de landmarks (Fernet AES), soft-delete e purga |
| **R07** | Base de Dados e Alembic | P0 | 1 | 🟢 Completo | Migrações Alembic 0001..0005, SQLAlchemy 2.0, modo WAL e integridade ACID |
| **R08** | Camada de Sessões | P1 | 2 | 🟢 Completo | ReportBuilder (DRY), SessionService ACID idempotente, ingestão em batch |
| **R09** | AI Coach Determinístico | P1 | 1 | 🟢 Completo | Motor de regras puro, eliminação de valores placebo, i18n bilíngue PT/EN |
| **R10** | Deteção de Ciclos BDC/TDC | P1 | 2 | 🟢 Completo | Detetor puro, refinamento fisiológico de BDC (±80ms), streaming ring buffer |
| **R11** | Calibração e Escala | P1 | 2 | 🟢 Completo | Calibração ArUco, pedivela, roda, correção de distorção ótica de lente |
| **R12** | Medidas BikeFit e Qualidade | P1 | 3 | 🟢 Completo | Planos sagital e frontal, portão de qualidade (score < 0.60), Kalman filter |
| **R13** | RTMPose e Rastreio | P1 | 2 | 🟢 Completo | RTMPose-m Halpe26 (Apache-2.0, 26 keypoints), TargetSelector anti-troca |
| **R14** | Desempenho e Autotune | P1 | 3 | 🟢 Completo | OrtDirectML, OpenVinoCPU, blobFromImage SIMD, autotune, INT8 rejeitado |
| **R15** | CI/CD e Observabilidade | P1 | 1 | 🟢 Completo | Matriz GitHub Actions, ruff, mypy strict, CodeQL, logging JSON, /metrics |
| **R16** | Refatoração Frontend | P1 | 2 | 🟢 Completo | Modularização Vue 3/Pinia, IndexedDB cifrado, offline sync resiliente |
| **R17** | Relatórios e Validação | P2 | 4 | 🟢 Completo | PDF auditável v2, gráficos thread-safe Agg, export CSV/JSON, Bland-Altman |
| **R18** | Consolidação de Docs e ADRs | P2 | 4 | 🟢 Completo | Docs centralizados em `docs/`, 7 ADRs, runbook operacional, glossário |

---

## 3. Serviços Ativos e Portas Operacionais

- **Backend API REST & WS:** `http://127.0.0.1:8000`
- **Frontend Web App:** `http://127.0.0.1:8080` (ou porta configurada)
- **Métricas Prometheus:** `http://127.0.0.1:8000/metrics` (requer Bearer token)
- **Health Checks:** `http://127.0.0.1:8000/health/live` e `/health/ready`

Para histórico anterior a Outubro de 2026, consulte o arquivo legado em [docs/archive/STATUS_LEGACY.md](archive/STATUS_LEGACY.md).
