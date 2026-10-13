# D08 — Vista Live + domínio bikefit (ciclos, calibração, gráficos)

> **ID:** D08 · **Prioridade:** P0 · **Onda:** 3
> **Status:** 🔴 TODO · **Progresso:** 0/10 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D05, D07, R10, R11, R12 · **Bloqueia:** D11, D13 · **Branch:** `feat/d08-live-bikefit` · **PR:** —
> **Referência:** README_PLAN §6; CODE_REVIEW §4 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
O fluxo de sessão é: **Onboarding → Calibração guiada → Aquecimento → Medição (60 s+) → Revisão → Relatório**. O domínio (ciclos R10, calibração R11, medidas/confiança R12) é do backend e é **importado**. Os motores devolvem landmarks; o `domain_bridge` transforma em medidas por ciclo em tempo real.

## 2. Objetivo
Vista **Live** completa e *wizard* de sessão: visualização, medição em tempo real, qualidade do sinal e gravação de resultados da sessão — sem lógica biomecânica duplicada.

## 3. Âmbito
**Cria:** `domain_bridge/{live_session.py,cycle_adapter.py,calibration_adapter.py,quality_adapter.py}`, `services/session_service.py` (desktop), `ui/views/{onboarding_view.py,calibration_view.py,live_view.py,review_view.py}`, `ui/viewmodels/*`, testes.
**Reutiliza (importa):** `athletemotion.domain.cycle`, `domain.calibration`, `domain.measures`, `domain.biomechanics`.
**Não mexe:** domínio do backend; persistência/sync (D10); PDF (D11).

## 4. Subtarefas
- [ ] **1. `domain_bridge/live_session.py`:** `LiveSession` consome `Result` do pipeline, alimenta `OnlineCycleDetector` (R10) e agrega `SessionMeasuresSummary` (R12) incrementalmente; sem Qt; estado serializável para retomar após crash (D13).
- [ ] **2. Onboarding:** formulário atleta + bicicleta (validação com os limites do backend: altura 100–240, cavalo, etc.), **consentimento** (texto versionado R06; âmbito de gravação), cálculo teórico de selim (LeMond/Hamley) mostrado; dados guardados via D10.
- [ ] **3. Assistente de calibração:** passos (enquadramento → marcador ArUco/pedivela/roda → verificação de perpendicularidade/roll → perfil de lente) usando `calibration_adapter` (R11); pré-visualização com sobreposição do marcador detetado, **semáforo** de qualidade, avisos bilingues; bloqueia “Iniciar medição” se calibração inválida **a menos que** o utilizador aceite medir sem mm (medidas em mm ficam `None`).
- [ ] **4. Live View:** `VideoCanvas` + `SkeletonOverlay` + `AngleHud` + 2 `SignalPlot` (tornozelo/joelho) + painel de qualidade (visibilidade, periodicidade, nº ciclos válidos, cadência), indicadores BDC/TDC, escolha de lado (com sugestão automática R12, sem trocar a meio de ciclo), botão Iniciar/Pausar/Terminar, snapshot manual opcional (marcado como `manual`).
- [ ] **5. Gating visual:** medidas com confiança < 0.6 ou `withheld` aparecem “—” com motivo ao passar o rato; avisos de qualidade (iluminação, oclusão, câmara fora de perpendicular) como *toasts* não intrusivos; **nunca** apresentar valores estimados como medidos.
- [ ] **6. Gravação da sessão:** durante a medição acumula séries (ângulos, eventos, ciclos) em *chunks* (memória limitada; despejo para disco D10); vídeo **só** se E4/definições o permitirem; marca de tempo e versão de modelo/perfil (proveniência R17).
- [ ] **7. Revisão (`review_view`):** tabela de ciclos (válidos/rejeitados + motivo), curvas médias ± DP, histograma de BDC, estatísticas, possibilidade de **excluir ciclos manualmente** (recalcula resumo); botão “Gerar relatório” (D11).
- [ ] **8. Latência de interface:** `live_view` atualiza HUD ≤ 10 Hz e *plots* ≤ 30 Hz, overlay a cada frame disponível; medir tempo na *main thread* por *tick* (≤ 8 ms; teste instrumentado).
- [ ] **9. Testes:** `live_session` com landmarks sintéticos (gerador R10) → resultados esperados (cadência/BDC) ; vista Live com `FakeStream`+pipeline *mock* (offscreen); testes do assistente (fluxos válido/inválido); teste de “sem calibração → mm None”.
- [ ] **10. Docs e validação manual:** checklist de teste manual com bicicleta em rolo (anexar vídeo/capturas se possível em *Evidências*), atualizar `README_PLAN` §12 e board/changelog.

## 5. Critérios de aceitação
- Em pedalada sintética a 80 RPM: cadência ±1 RPM e BDC correto ≥ 95 % dos ciclos na vista (mesmos critérios de R10).
- Sem calibração válida, nenhuma medida em mm é mostrada.
- Medidas `withheld` nunca visíveis; estimados distinguíveis.
- UI sem bloqueios > 8 ms; sessão de 10 min sem crescimento de RSS > 5 %.
- Nenhuma fórmula biomecânica duplicada no desktop (`grep` por `arctan2`/`calculate_safe_angle` em `desktopapp/src` → 0).

## 6. Verificação
```powershell
cd desktopapp
$env:QT_QPA_PLATFORM="offscreen"; pytest tests -k "live or calibration or review" -q
python -m athletemotion_desktop  # fluxo manual com FakeStream e depois câmara real
```

## 7. Riscos / Fora de âmbito
- Depende fortemente de R10/R11/R12: se faltarem, ⛔ BLOCKED (não reimplementar no desktop).
- Análise de vídeo gravado → D09; PDF → D11.

## 8. Prompt específico
```text
Executa a tarefa D08 (desktopapp/TASKS/D08_LIVE_VIEW_BIKEFIT.md) seguindo o Prompt mestre do desktop.
Importa o domínio (cycle/calibration/measures) — proibido duplicar fórmulas. Sem calibração não há mm. withheld nunca visível; estimados distinguíveis. Mede a latência da main thread.
```

## 9. Evidências
_(testes, capturas, métricas de UI, checklist manual)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
