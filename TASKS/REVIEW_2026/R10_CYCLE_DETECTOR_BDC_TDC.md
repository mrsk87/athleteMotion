# R10 — Deteção de ciclos de pedalada, BDC/TDC e cadência

> **ID:** R10 · **Prioridade:** P0 · **Onda:** 2
> **Status:** 🔴 TODO · **Progresso:** 0/9 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** R02 · **Bloqueia:** R12, R17, D08 (desktop) · **Branch:** `feat/r10-cycle-detector` · **PR:** —
> **Referência:** CODE_REVIEW §2.3, §4.1 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
- `sessions.py` calcula a **média de todos os snapshots** (manuais). A referência 145–155° (Holmes: 25–35° de flexão) aplica-se ao **BDC**. `is_bdc/is_tdc/clock_position` existem em `types.py` mas **nunca** são calculados (MediaPipe fixa `False`).
- O frontend tem protótipos: `services/pedalStrokeTracker.js`, `polarPlotter.js`, `useFootOrbitTrail.js` — **ler** para reaproveitar ideias/parâmetros, mas a lógica oficial passa a ser Python.
- Convenção de ângulo do joelho no projeto: **ângulo interno** (180° = perna esticada); flexão = 180 − ângulo.

## 2. Objetivo
Módulo de domínio **puro e sem framework** que, a partir de uma série temporal de landmarks/ângulos, identifica ciclos de pedalada e devolve métricas **por ciclo** (BDC/TDC, amplitudes, cadência), com qualidade e rejeição de ciclos inválidos; integração em streaming (online) e em lote (offline).

## 3. Âmbito
**Cria:** `athletemotion/domain/cycle/{__init__.py,detector.py,metrics.py,types.py,streaming.py}`, `tests/unit/cycle/…`, `tests/fixtures/synthetic_pedaling.py`.
**Altera:** `domain/inference/types.py` (preencher `is_bdc/is_tdc/clock_position` a partir do `streaming`), integração opcional no WS (campo novo `cycle` no payload, retrocompatível), `services/session_service.py` (R08) para guardar `CycleMetrics`.
**Não mexe:** calibração (R11), UI (R16/D08), thresholds.

## 4. Subtarefas
- [ ] **1. Gerador sintético (testes):** `synthetic_pedaling(rpm, fps, duration, noise, knee_bdc=148, knee_tdc=75, drift, dropouts)` devolvendo séries de ankle/knee/hip + ângulos; permite verdade-terreno de BDC/TDC. Sem isto não se começa.
- [ ] **2. Pré-processamento do sinal:** reamostragem para fps uniforme, preenchimento de falhas curtas (≤ 150 ms) por interpolação, **Savitzky-Golay** ou Butterworth zero-fase (offline) / One-Euro (online); parâmetros em dataclass `CycleParams`.
- [ ] **3. Estimativa de cadência/periodicidade:** autocorrelação + FFT do sinal vertical do **tornozelo** (e do ângulo do joelho como validação cruzada); intervalo plausível 30–140 RPM; devolve `cadence_rpm`, `periodicity_confidence` ∈ [0,1].
- [ ] **4. Deteção de eventos:** picos/vales com `scipy.signal.find_peaks` (`prominence` relativa à amplitude, `distance` = 0.6×período): **BDC** = ponto mais baixo do tornozelo/pé (y imagem máximo) refinado pelo máximo do ângulo do joelho numa janela ±80 ms; **TDC** = mais alto. Validar alternância BDC/TDC estrita; resolver duplicados.
- [ ] **5. Métricas por ciclo (`CycleMetrics`):** `knee_bdc`, `knee_tdc`, `knee_rom`, `hip_tdc`, `ankle_rom`, `torso_mean`, `elbow_mean`, `duration_ms`, `visibility_mean`, `valid: bool`, `reject_reasons: list`. Agregação `SessionCycleSummary` com média, mediana, **desvio-padrão**, n ciclos válidos, e *outliers* (MAD).
- [ ] **6. Rejeição de ciclos:** visibilidade média < 0.5, duração fora de ±35 % da mediana, saltos de segmento (R02 `stabilizer`), amplitude do joelho < mínimo plausível → `valid=False` com motivo.
- [ ] **7. Modo streaming (online):** `OnlineCycleDetector.push(sample) -> list[Event]` com latência máx. de ½ período (documentar); `reset()`; estado imutável por ligação (compatível com R03). Preenche `is_bdc/is_tdc` e `clock_position` (posição do pedal em "horas" 0–12 a partir da fase) nos `InferenceOutput`.
- [ ] **8. Integração no relatório:** `session_service.complete` usa `SessionCycleSummary` (ângulo no BDC) em vez da média global **quando existirem ≥ 5 ciclos válidos**; senão cai para snapshots manuais, **rotulado** (`source: "manual_snapshots"`). Persistir ciclos (tabela `cycle_metrics`, migração via R07) ou JSON na sessão. Atualizar `evaluate_posture_angles` para receber `knee_bdc`.
- [ ] **9. Validação e docs:** benchmark de precisão no gerador sintético (ruído 1–3 px, dropouts 5 %, 40–110 RPM): erro de cadência < 1 RPM, erro de timing do BDC < 1 frame em ≥ 95 % dos ciclos. Documentar algoritmo e parâmetros em `docs/cycle-detection.md`. Marcar CODE_REVIEW §2.3/§4.1 `✅ Resolvido em R10`.

## 5. Critérios de aceitação
- Testes sintéticos cumprem as metas do passo 9 e correm em < 10 s.
- Em dados reais (vídeo de exemplo fornecido pelo humano em `backend/tests/data/` — **não** versionar vídeo pesado; usar landmarks `.npz`) o BDC é visualmente correto em ≥ 90 % dos ciclos (revisão manual registada em *Evidências*).
- Módulo sem importações de FastAPI/SQLAlchemy/Pydantic (apenas dataclasses/numpy/scipy).
- Relatório de sessão indica a **fonte** do ângulo (ciclos vs. manual) e o nº de ciclos.

## 6. Verificação
```powershell
cd backend
pytest tests/unit/cycle -q; pytest -q
python -m athletemotion.domain.cycle.benchmark --rpm 40,60,80,110 --noise 1,2,3
```

## 7. Riscos / Fora de âmbito
- Vista não perfeitamente sagital deforma a trajetória do tornozelo → o refinamento por ângulo do joelho mitiga; calibração/roll é R11.
- Pedalar com cadência muito baixa/parado: devolver `periodicity_confidence` baixa, não ciclos.

## 8. Prompt específico
```text
Executa a tarefa R10 (TASKS/REVIEW_2026/R10_CYCLE_DETECTOR_BDC_TDC.md) seguindo o Prompt mestre.
Começa pelo gerador sintético e testes. O módulo é puro (numpy/scipy/dataclasses). Rejeita ciclos fracos com motivo. Nunca calcules "ângulo no BDC" sem ciclos válidos suficientes: indica a fonte.
```

## 9. Evidências
_(tabela de precisão sintética; revisão manual em dados reais)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
