# D12 — Vista Benchmark/Diagnóstico e overlay de métricas

> **ID:** D12 · **Prioridade:** P1 · **Onda:** 3
> **Status:** 🔴 TODO · **Progresso:** 0/7 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D05, D07, D02 · **Bloqueia:** — · **Branch:** `feat/d12-benchmark-view` · **PR:** —
> **Referência:** README_PLAN §4.4, §7 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
O desempenho tem de ser **visível e verificável** em cada máquina. D05 expõe métricas por estágio; D02 expõe hardware/perfil; R14 tem `benchmark_matrix`/`autotune`.

## 2. Objetivo
Vista de diagnóstico: benchmark interativo (matriz modelo×backend×resolução), *overlay* de métricas em tempo real (F12), gráficos de latência e exportação de relatório de desempenho.

## 3. Âmbito
**Cria:** `ui/views/benchmark_view.py`, `ui/widgets/{metrics_overlay.py,latency_chart.py}`, `ui/viewmodels/benchmark_vm.py`, `runtime/benchmark_runner.py`, testes.
**Reutiliza:** `athletemotion.infrastructure.autotune`, `scripts/benchmark_matrix.py` (importar funções).
**Não mexe:** pipeline (D05).

## 4. Subtarefas
- [ ] **1. `benchmark_runner` (sem Qt):** executa a matriz escolhida em **processo separado**, com progresso, cancelamento e *warmup* descartado; fontes: frames sintéticos, ficheiro de exemplo, câmara; guarda resultados JSON em `APP_DATA_DIR/benchmarks/`.
- [ ] **2. Vista:** seleção de modelos/backends/resoluções/nº frames, botão Executar/Cancelar, tabela p50/p95/p99/FPS/CPU/RAM/VRAM, gráfico de barras e histogramas; destaque do **melhor por perfil** e botão “Aplicar como perfil” (grava `hardware_profile.json` e Definições D02).
- [ ] **3. `MetricsOverlay` (F12):** sobreposição no canvas com FPS captura/inferência/UI, idade do resultado, latência por estágio (barras empilhadas), *drops*, estado do pipeline (`RUNNING/DEGRADED`), provider ativo real, temperatura/uso GPU se obtível (WMI/PDH, opcional); custo de desenho < 0.5 ms.
- [ ] **4. Gráfico de latência:** `latency_chart` (pyqtgraph) com últimos 60 s, linhas p50/p95, marcação de *spikes* e eventos (troca de motor, watchdog).
- [ ] **5. Exportação:** relatório de desempenho (JSON + MD + PNG dos gráficos) com hardware, versões (Python/Qt/ORT/OpenVINO/driver), perfil e resultados — pronto para anexar em issues.
- [ ] **6. Comparação com baseline:** guardar baseline nomeado e comparar execuções (Δ%); alerta visual de regressão > 10 %.
- [ ] **7. Testes e docs:** `benchmark_runner` com backend *fake* (tempos controlados) → estatísticas corretas; vista offscreen; overlay não excede o orçamento. Atualizar `README_PLAN` §4.2 com instruções, board/changelog.

## 5. Critérios de aceitação
- Benchmark cancelável em < 1 s e sem bloquear a UI.
- Valores da vista coincidem com os do `benchmark_matrix` do backend (±2 %).
- *Overlay* ativável sem afetar perceptivelmente o FPS (medir com/sem).
- Exportação reproduzível (hardware+versões incluídos).

## 6. Verificação
```powershell
cd desktopapp
$env:QT_QPA_PLATFORM="offscreen"; pytest tests -k "benchmark or metrics_overlay" -q
```

## 7. Riscos / Fora de âmbito
- Métricas de GPU no Windows variam: opcionais, nunca bloqueantes.

## 8. Prompt específico
```text
Executa a tarefa D12 (desktopapp/TASKS/D12_BENCHMARK_METRICS_VIEW.md) seguindo o Prompt mestre do desktop.
Benchmark em processo separado, cancelável; reutiliza as funções do backend (não duplicar). Overlay barato. Exporta relatório reproduzível.
```

## 9. Evidências
_(capturas, comparação com backend)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
