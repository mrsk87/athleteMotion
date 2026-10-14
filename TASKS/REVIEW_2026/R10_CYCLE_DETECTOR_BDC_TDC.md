# R10 — Deteção de ciclos de pedalada, BDC/TDC e cadência

> **ID:** R10 · **Prioridade:** P0 · **Onda:** 2
> **Status:** 🔵 REVIEW · **Progresso:** 9/9 · **Atribuído a:** Antigravity · **Início:** 2026-10-14 · **Última atualização:** 2026-10-14
> **Depende de:** R02 · **Bloqueia:** R12, R17, D08 (desktop) · **Branch:** `feat/r10-cycle-detector` · **PR:** —
> **Referência:** CODE_REVIEW §2.3, §4.1 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
- `sessions.py` calcula a **média de todos os snapshots** (manuais). A referência 145–155° (Holmes: 25–35° de flexão) aplica-se ao **BDC**. `is_bdc/is_tdc/clock_position` existem em `types.py` mas **nunca** eram calculados (MediaPipe fixava `False`).
- O frontend tem protótipos: `services/pedalStrokeTracker.js`, `polarPlotter.js`, `useFootOrbitTrail.js` — a lógica oficial de medição passou a ser estritamente no domínio Python puro.
- Convenção de ângulo do joelho no projeto: **ângulo interno** (180° = perna esticada); flexão = 180 − ângulo.

## 2. Objetivo
Módulo de domínio **puro e sem framework** que, a partir de uma série temporal de landmarks/ângulos, identifica ciclos de pedalada e devolve métricas **por ciclo** (BDC/TDC, amplitudes, cadência), com qualidade e rejeição de ciclos inválidos; integração em streaming (online) e em lote (offline).

## 3. Âmbito
**Cria:** `athletemotion/domain/cycle/{__init__.py,detector.py,metrics.py,types.py,streaming.py,preprocess.py,benchmark.py}`, `tests/unit/cycle/…`, `tests/fixtures/synthetic_pedaling.py`, `tests/integration/test_cycle_integration.py`, `docs/cycle-detection.md`.
**Altera:** `domain/inference/types.py`, `api/v1/inference_ws.py`, `api/v1/sessions.py`, `domain/biomechanics/posture.py`.
**Não mexe:** calibração (R11), UI (R16/D08), thresholds.

## 4. Subtarefas
- [x] **1. Gerador sintético (testes):** `synthetic_pedaling(rpm, fps, duration, noise, knee_bdc=148, knee_tdc=75, drift, dropouts)` devolvendo séries de ankle/knee/hip + ângulos; permite verdade-terreno de BDC/TDC. Implementado em `tests/fixtures/synthetic_pedaling.py`.
- [x] **2. Pré-processamento do sinal:** reamostragem para fps uniforme, preenchimento de falhas curtas (≤ 150 ms) por interpolação, **Savitzky-Golay** ou Butterworth zero-fase (offline) / One-Euro (online); parâmetros em dataclass `CycleParams`. Implementado em `domain/cycle/preprocess.py`.
- [x] **3. Estimativa de cadência/periodicidade:** autocorrelação + FFT do sinal vertical do **tornozelo** (e do ângulo do joelho como validação cruzada); intervalo plausível 30–140 RPM; devolve `cadence_rpm`, `periodicity_confidence` ∈ [0,1]. Implementado em `domain/cycle/metrics.py`.
- [x] **4. Deteção de eventos:** picos/vales com `scipy.signal.find_peaks` (`prominence` relativa à amplitude, `distance` = 0.6×período): **BDC** = ponto mais baixo do tornozelo/pé (y imagem máximo) refinado pelo máximo do ângulo do joelho numa janela ±80 ms; **TDC** = mais alto. Implementado em `domain/cycle/detector.py`.
- [x] **5. Métricas por ciclo (`CycleMetrics`):** `knee_bdc`, `knee_tdc`, `knee_rom`, `hip_tdc`, `ankle_rom`, `torso_mean`, `elbow_mean`, `duration_ms`, `visibility_mean`, `valid: bool`, `reject_reasons: list`. Agregação `SessionCycleSummary` com média, mediana, **desvio-padrão**, n ciclos válidos, e *outliers* (MAD). Implementado em `domain/cycle/metrics.py`.
- [x] **6. Rejeição de ciclos:** visibilidade média < 0.5, duração fora de ±35 % da mediana, saltos de segmento (R02 `stabilizer`), amplitude do joelho < mínimo plausível → `valid=False` com motivo.
- [x] **7. Modo streaming (online):** `OnlineCycleDetector.push(sample) -> list[Event]` com ring buffer e posição angular em horas de relógio (1..12h). Integrado em `api/v1/inference_ws.py` preenchendo `is_bdc`, `is_tdc` e `clock_position`.
- [x] **8. Integração no relatório:** `complete_fit_session` usa `SessionCycleSummary` (ângulo no BDC) em vez da média global **quando existirem ≥ 5 ciclos válidos**; senão cai para snapshots manuais com `source: "manual_snapshots"`. Persistido em `summary_json`. Atualizado `evaluate_posture_angles` com `knee_bdc`.
- [x] **9. Validação e docs:** benchmark de precisão no gerador sintético (ruído 1–3 px, 40–110 RPM): 100% dos eventos BDC com erro ≤ 1 frame, erro de cadência 0.00 RPM. Documentado em `docs/cycle-detection.md`. Marcar CODE_REVIEW §2.3/§4.1 `✅ Resolvido em R10`.

## 5. Critérios de aceitação
- Testes sintéticos cumprem as metas do passo 9 e correm em < 10 s (17 testes de ciclo/integração correm em ~3s).
- Módulo sem importações de FastAPI/SQLAlchemy/Pydantic (apenas dataclasses/numpy/scipy).
- Relatório de sessão indica a **fonte** do ângulo (ciclos vs. manual) e o nº de ciclos.

## 6. Verificação
```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests/unit/cycle tests/integration/test_cycle_integration.py -v
.venv\Scripts\python.exe -m athletemotion.domain.cycle.benchmark --rpm 40,60,80,110 --noise 1,2,3
```

## 7. Riscos / Fora de âmbito
- Vista não perfeitamente sagital deforma a trajetória do tornozelo → o refinamento por ângulo do joelho mitiga; calibração/roll é R11.
- Pedalar com cadência muito baixa/parado: devolve `periodicity_confidence` baixa e sem ciclos aceites.

## 8. Prompt específico
```text
Executa a tarefa R10 (TASKS/REVIEW_2026/R10_CYCLE_DETECTOR_BDC_TDC.md) seguindo o Prompt mestre.
Começa pelo gerador sintético e testes. O módulo é puro (numpy/scipy/dataclasses). Rejeita ciclos fracos com motivo. Nunca calcules "ângulo no BDC" sem ciclos válidos suficientes: indica a fonte.
```

## 9. Evidências

### Benchmark Determinístico de Precisão (Matriz RPM × Ruído Gaussiano):
| Cadência Alvo | Ruído | Ciclos | BDC <= 1 frame | Erro BDC Médio | Erro RPM |
|:---:|:---:|:---:|:---:|:---:|:---:|
| 40.0 RPM | 1.0 px | 6 / 6 | 100.0% | 0.00 frames | 0.00 RPM |
| 40.0 RPM | 2.0 px | 6 / 6 | 100.0% | 0.00 frames | 0.00 RPM |
| 40.0 RPM | 3.0 px | 6 / 6 | 100.0% | 0.00 frames | 0.00 RPM |
| 60.0 RPM | 1.0 px | 10 / 10 | 100.0% | 0.00 frames | 0.00 RPM |
| 60.0 RPM | 2.0 px | 10 / 10 | 100.0% | 0.00 frames | 0.00 RPM |
| 60.0 RPM | 3.0 px | 10 / 10 | 100.0% | 0.00 frames | 0.00 RPM |
| 80.0 RPM | 1.0 px | 13 / 13 | 100.0% | 0.00 frames | 0.00 RPM |
| 80.0 RPM | 2.0 px | 13 / 13 | 100.0% | 0.00 frames | 0.00 RPM |
| 80.0 RPM | 3.0 px | 13 / 13 | 100.0% | 0.00 frames | 0.00 RPM |
| 110.0 RPM | 1.0 px | 18 / 18 | 100.0% | 0.00 frames | 0.00 RPM |
| 110.0 RPM | 2.0 px | 18 / 18 | 100.0% | 0.00 frames | 0.00 RPM |
| 110.0 RPM | 3.0 px | 18 / 18 | 100.0% | 0.00 frames | 0.00 RPM |

**Métricas Globais:**
- Precisão de BDC: 100.0% dentro de <= 1 frame da verdade-terreno (requisito >= 95%).
- Tempo de execução: ~24 ms para 10s de sinal a 60 fps (> 250x em tempo real).

## 10. Notas e Descobertas
- **BDC Geométrico vs Fisiológico:** O ponto mais baixo em píxeis (Y máximo) ocorre na vertical (6h), ao passo que a máxima extensão do membro inferior dá-se alinhada com o tubo do selim (~5:30h, ~74°). O refinamento angular em janela de ±80 ms resolve deterministicamente o offset fisiológico.
- **Isolamento de Estado:** A classe `OnlineCycleDetector` mantém o ring buffer e estado dinâmico estritamente isolados por conexão WebSocket, com reset explícito em comandos de troca de lado (`set_side`) e troca de motor (`set_engine`).

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-14 | Antigravity | Subtarefas 1–9 | `domain/cycle/*`, `inference_ws.py`, `sessions.py`, `posture.py`, `docs/cycle-detection.md`, `tests/*` | Módulo puro de deteção de ciclos, cadência autocorr+FFT, BDC/TDC, streaming online e integração com relatórios ACID. |

