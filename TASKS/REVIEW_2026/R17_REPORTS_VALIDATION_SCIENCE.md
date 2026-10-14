# R17 — Relatório PDF, rastreabilidade e validação científica

> **ID:** R17 · **Prioridade:** P2 · **Onda:** 4
> **Status:** 🔵 REVIEW · **Progresso:** 7/7 · **Atribuído a:** Senior Core Developer · **Início:** 2026-10-14 · **Última atualização:** 2026-10-14
> **Depende de:** R10, R12 (e R09) · **Bloqueia:** R18 · **Branch:** `feat/r17-reports-validation` · **PR:** —
> **Referência:** CODE_REVIEW §4.6, §4.7 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar em `services/report_generator.py`)
- PDF atual por `reportlab` com ângulos médios, KOPS, saddle drop, cadência/potência, plano do coach. Sem gráficos por ciclo, imagens-chave, rastreabilidade (modelo, versão, calibração) nem incerteza.
- Não existe verdade-terreno nem métricas de erro (MAE/Bland-Altman) dos motores; limiares aplicados sem erro conhecido.
- Exportações de séries temporais (CSV/JSON) inexistentes.

## 2. Objetivo
Relatório **auditável**: cada número com origem, incerteza e versão do software/modelo; exportações abertas; protocolo de validação reprodutível contra marcadores/goniómetro.

## 3. Âmbito
**Cria:** `athletemotion/services/reporting/{pdf.py,charts.py,exports.py,provenance.py}`, `athletemotion/validation/{protocol.md,metrics.py,bland_altman.py,runner.py}`, `docs/validation/`.
**Altera:** `services/report_generator.py` (passa a *shim*), `api/v1/sessions.py` (rotas `export.csv|json`), testes.
**Não mexe:** algoritmos de medida (R10/R12), UI.

## 4. Subtarefas
- [x] **1. Proveniência (`provenance.py`):** `Provenance(app_version, git_sha, model_id, model_sha256, backend, provider, calibration, camera_profile, cycles_used, source ∈ {cycles,manual}, created_at)` incluído no JSON da sessão e rodapé do PDF.
- [x] **2. Gráficos (`charts.py`):** curvas por ciclo (média ± DP) de joelho/anca/tornozelo com banda alvo; histograma de BDC; evolução (fadiga); gerar com `matplotlib` (backend `Agg`) orientado a objetos sem estado global do pyplot (100% thread-safe).
- [x] **3. PDF novo (`pdf.py`):** secções — identificação, equipamento, calibração e qualidade (semáforo), resultados com `valor ± incerteza` e **confiança**, medidas `withheld` listadas com motivo, gráficos, imagens-chave BDC/TDC (se frames disponíveis e consentimento de âmbito), recomendações (R09, linguagem prudente) com deltas em mm, **aviso legal**, proveniência. PT/EN. **Escape** de texto (R05) e fontes limpas.
- [x] **4. Exportações:** `GET /sessions/{id}/export.csv` (séries por frame e tabela por ciclo), `export.json` (schema versionado `schema_version`), sem PII além do necessário; *streaming* para sessões longas.
- [x] **5. Protocolo de validação (`protocol.md`):** desenho do estudo (n participantes, goniómetro/marcadores ArUco/retro-reflectores como referência, posições estáticas a ângulos conhecidos + dinâmico), critérios de aceitação por articulação (**MAE ≤ 3°** meta provisória), formato de dados (`.npz`/CSV), consentimento informado.
- [x] **6. Ferramentas de validação:** `metrics.py` (MAE, RMSE, viés, LoA 95 %), `bland_altman.py` (gráfico + estatística), `runner.py` (CLI: `python -m athletemotion.validation.runner --dataset PATH --engines yolo11_pose_fast,rtmpose` → relatório MD/JSON/PNG por motor). Testes com dados sintéticos (erro conhecido injetado → métricas recuperam o erro).
- [x] **7. Golden de PDF e docs:** testes de *smoke* do PDF (gera, abre com `pypdf`, contém secções e proveniência), snapshot de texto; `docs/validation/README.md` com como reproduzir. Marcar CODE_REVIEW §4.6/§4.7 `✅ Resolvido em R17`.

## 5. Critérios de aceitação
- Todo número no PDF tem unidade, incerteza ou “n/d” e vem com a fonte (ciclos/manual).
- Medidas `withheld` nunca aparecem como valores.
- `validation.runner` reproduz o erro injetado (±0.1°) em dados sintéticos.
- PDF PT/EN gerado com 300+ ciclos em < 3 s.

## 6. Verificação
```powershell
cd backend
pytest tests -k "report or validation" -q; pytest -q
python -m athletemotion.validation.runner --dataset tests/data/synthetic_validation --engines fake
```

## 7. Riscos / Fora de âmbito
- Dataset real de validação depende do humano (participantes/consentimento): a tarefa entrega **ferramentas e protocolo**, não os resultados clínicos.
- Não afirmar precisão clínica no relatório até haver validação.

## 8. Prompt específico
```text
Executa a tarefa R17 (TASKS/REVIEW_2026/R17_REPORTS_VALIDATION_SCIENCE.md) seguindo o Prompt mestre.
Cada número com unidade, incerteza e origem. Nunca inventes resultados de validação: entrega protocolo e ferramentas testadas com dados sintéticos.
```

## 9. Evidências
1. **Runner de Validação Científica (`python -m athletemotion.validation.runner`):**
   ```text
   ======================================================================
   ATHLETE MOTION -- RESUMO DA VALIDACAO CIENTIFICA
   ======================================================================
   * Anca (hip_validation): MAE=1.24 deg | RMSE=1.54 deg | Vies=-0.53 deg | LoA=[-3.4 deg, +2.3 deg] | r=0.9650 -> [PASS] APROVADO
   * Joelho (knee_validation): MAE=1.13 deg | RMSE=1.42 deg | Vies=+0.79 deg | LoA=[-1.5 deg, +3.1 deg] | r=0.9965 -> [PASS] APROVADO
   ======================================================================
   Status Global: [PASS] CONFORME
   ```
   Recuperação exata do erro injetado (Joelho: viés injetado = +0.8° -> medido = +0.79°; Anca: viés injetado = -0.5° -> medido = -0.53°). Erro de recuperação $\le 0.03^\circ \le 0.1^\circ$.

2. **Geração de PDF com 300+ Ciclos:**
   Tempo medido em benchmark de teste: **0.18 s** ($< 3.0\text{ s}$ estipulados no critério).

3. **Verificação Estrutural do PDF com `pypdf`:**
   Leitura de bytes gerados por `generate_bikefit_pdf`, extração de texto validando presença de nome do atleta, modalidade, ângulos medidos com incerteza (`149.5° ±1.2°`), confiança (95%), chamada explícita de medidas retidas (*withheld*) e proveniência no rodapé.

4. **Suite de Testes Global:**
   `218 passed, 14 warnings in 25.43s` no backend pytest.
   `ruff check src/ tests/` limpo (0 erros).
   `mypy --strict src/athletemotion/services/reporting src/athletemotion/validation` limpo (0 erros).

## 10. Notas e Descobertas
- **Thread-Safety no Matplotlib:** Utilizar exclusivamente a API Orientada a Objetos com `Figure()` e `FigureCanvasAgg(fig)` sem importar `matplotlib.pyplot` elimina qualquer estado global, permitindo renderização concorrente de gráficos em múltiplos threads sem colisões.
- **Leitura Segura do Git SHA sem Subprocessos:** O commit Git curto pode ser obtido lendo diretamente `.git/HEAD` e `refs/heads` ou `packed-refs`, reduzindo o tempo de resolução de ~35 ms para $< 1\text{ ms}$ e eliminando avisos de segurança S603/S607.
- **Tratamento de Codificação de Terminal Windows:** Em consolas Windows com codificação de página CP1252, carateres Unicode especiais em scripts CLI podem disparar `UnicodeEncodeError`. Configurar `sys.stdout.reconfigure(encoding="utf-8", errors="replace")` e adotar fallbacks ASCII nas mensagens de consola previne quebras em ambientes corporativos.

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-14 | Antigravity | Subtarefas 1 a 7 | `provenance.py`, `charts.py`, `pdf.py`, `exports.py`, `report_generator.py`, `sessions.py`, `protocol.md`, `metrics.py`, `bland_altman.py`, `runner.py`, `docs/validation/README.md`, testes | Implementação integral do novo relatório PDF auditável, gráficos thread-safe via matplotlib Agg, exportações CSV/JSON, protocolo científico e ferramentas de validação estatística com 14 novos testes e conformidade 100% |
