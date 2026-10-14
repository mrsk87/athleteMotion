# R12 — Medidas bikefit adicionais, qualidade/confiança e vista frontal

> **ID:** R12 · **Prioridade:** P1 · **Onda:** 3
> **Status:** 🔵 REVIEW · **Progresso:** 9/9 · **Atribuído a:** Antigravity · **Início:** 2026-10-14 · **Última atualização:** 2026-10-14
> **Depende de:** R10, R11 · **Bloqueia:** R17 · **Branch:** `feat/r12-measures-quality` · **PR:** —
> **Referência:** CODE_REVIEW §4.3, §4.4 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar)
- Domínio atual: `posture.py` (joelho/tronco/cotovelo), `alignment.py` (KOPS + varo/valgo), `symmetry.py` (SI), `diagnostics.py` (saddle drop). Frontend tem protótipos `frontalPlaneAnalyzer.js`, `asymmetryCalculator.js`, `kopsAnalyzer.js`.
- Não existe: ângulo da anca/ombro ao longo do ciclo, curvas por ciclo, *hip drop*, *lateral sway*, fadiga, confiança por medida, Kalman com restrição de segmentos.
- Convenção: ângulos internos; thresholds em `thresholds.py` com fontes por documentar.

## 2. Objetivo
Medidas completas por ciclo (vista sagital e frontal), cada uma com **confiança** e *gating*; tracking temporal com restrição de comprimento de segmento; deteção automática do lado visível.

## 3. Âmbito
**Cria:** `athletemotion/domain/measures/{sagittal.py,frontal.py,fatigue.py,confidence.py,side_detection.py}`, `domain/inference/kalman_skeleton.py`, `schemas/measures.py`, `docs/measures.md`.
**Altera:** `domain/biomechanics/{thresholds,posture,alignment,symmetry,diagnostics}.py` (fontes + novos limiares), `services/session_service.py` (agregação).
**Não mexe:** modelos de IA (R13), calibração (R11), UI.

## 4. Subtarefas
- [x] **1. Fontes dos limiares:** em `thresholds.py` cada limiar ganha `source` (Holmes 1994, Bini, Silberman 2005, Peveler…) e `confidence_level`; novo campo `fit_goal ∈ {comfort, performance, aero}` e `injury_flags` que ajustam limites (documentar em `docs/measures.md`). **Sem inventar referências**: se não houver fonte verificável, marcar `source="empirical/unverified"`.
- [x] **2. Curvas por ciclo (sagital):** reamostrar cada ciclo (R10) para 0–360° (100 pontos): joelho, anca (tronco–fémur), tornozelo (dorsiflexão), ombro (tronco–braço), cotovelo; média ± DP entre ciclos; `ROM` e fase do pico.
- [x] **3. Medidas estáticas derivadas (em mm, requer R11):** *setback* (KOPS), *knee-over-pedal-spindle* no 3h, *saddle-to-bar drop*, *reach* — cada uma com `uncertainty_mm`; sem calibração → `None` + motivo.
- [x] **4. Vista frontal:** `hip_drop_deg`, `lateral_sway_mm`, `knee_tracking (varo/valgo)` por ciclo, `q_factor_mm` (se escala), `symmetry_index` L/R por articulação; reutilizar `alignment.py`/`symmetry.py`, ligando a dados reais por ciclo.
- [x] **5. Fadiga/deriva:** `fatigue.py` compara janelas (1.º vs último terço) para joelho BDC, tronco, cadência; devolve `drift_deg`, `p_value` (teste não-paramétrico, Mann-Whitney) e flag `significant`.
- [x] **6. Confiança e gating (`confidence.py`):** `MeasureConfidence(score ∈ [0,1], factors{visibility,cycles,periodicity,calibration,model_agreement})`; regra de gating: score < 0.6 → medida **não entra** no diagnóstico (marcada `withheld` com motivo). Concordância entre 2 motores (quando disponível) como fator.
- [x] **7. Deteção do lado:** `detect_visible_side(landmarks_history) -> ("left"|"right", confidence)` a partir da posição relativa nariz/orelha vs. ombros/anca e da visibilidade; sugerir `set_side` automaticamente (nunca mudar sozinho no meio de um ciclo).
- [x] **8. Kalman com restrição de segmentos:** `kalman_skeleton.py` — estado por articulação (x,y,vx,vy) com *update* por visibilidade/confiança e projeção que mantém comprimentos fémur/tíbia (em px, escala corrente) dentro de ±8 %; opcional e ligado/desligado por parâmetro; teste com ruído e oclusões: RMSE do ângulo do joelho ≤ 70 % do sem filtro.
- [x] **9. Integração e docs:** agregação em `SessionMeasuresSummary` consumida pelo relatório (R08/R17); tabela em `docs/measures.md` (definição, convenção de sinal, unidade, requisitos, incerteza típica). Marcar CODE_REVIEW §4.3/§4.4 `✅ Resolvido em R12`.

## 5. Critérios de aceitação
- Cada medida expõe `value`, `unit`, `confidence`, `uncertainty` (quando aplicável), `source` (ciclos/manual) e `withheld`.
- Testes com sinais sintéticos de verdade-terreno: erro < 1° nas curvas de ângulo; deteção de fadiga sintética (drift 3°) com `significant=True`, sem drift → `False` em ≥ 95 % de 200 execuções com ruído.
- Nenhum diagnóstico emitido com `confidence < 0.6`.
- Todas as funções do módulo são puras e tipadas; `mypy` limpo.

## 6. Verificação
```powershell
cd backend
pytest tests/unit/measures -q; pytest -q
mypy src/athletemotion/domain/measures src/athletemotion/domain/inference/kalman_skeleton.py
```

## 7. Riscos / Fora de âmbito
- Qualquer limiar sem fonte tem de ficar sinalizado como tal — nunca apresentar como recomendação científica.
- 3D lifting (MotionBERT) fora de âmbito.

## 8. Prompt específico
```text
Executa a tarefa R12 (TASKS/REVIEW_2026/R12_BIKEFIT_MEASURES_QUALITY.md) seguindo o Prompt mestre.
Cada medida com confiança e incerteza; gating a 0.6. Não inventes referências científicas: marca como unverified quando não tiveres fonte. Testes com sinais sintéticos de verdade-terreno.
```

## 9. Evidências
_(testes, tabela de erros, RMSE Kalman)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
