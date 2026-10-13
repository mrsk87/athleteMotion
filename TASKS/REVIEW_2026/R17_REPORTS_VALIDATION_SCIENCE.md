# R17 — Relatório PDF, rastreabilidade e validação científica

> **ID:** R17 · **Prioridade:** P2 · **Onda:** 4
> **Status:** 🔴 TODO · **Progresso:** 0/7 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** R10, R12 (e R09) · **Bloqueia:** — · **Branch:** `feat/r17-reports-validation` · **PR:** —
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
- [ ] **1. Proveniência (`provenance.py`):** `Provenance(app_version, git_sha, model_id, model_sha256, backend, provider, calibration, camera_profile, cycles_used, source ∈ {cycles,manual}, created_at)` incluído no JSON da sessão e rodapé do PDF.
- [ ] **2. Gráficos (`charts.py`):** curvas por ciclo (média ± DP) de joelho/anca/tornozelo com banda alvo; histograma de BDC; evolução (fadiga); gerar com `matplotlib` (backend `Agg`) ou desenho `reportlab.graphics` — escolher o mais leve e justificar. Sem estado global do pyplot (thread-safe).
- [ ] **3. PDF novo (`pdf.py`):** secções — identificação, equipamento, calibração e qualidade (semáforo), resultados com `valor ± incerteza` e **confiança**, medidas `withheld` listadas com motivo, gráficos, imagens-chave BDC/TDC (se frames disponíveis e consentimento de âmbito), recomendações (R09, linguagem prudente) com deltas em mm, **aviso legal**, proveniência. PT/EN. **Escape** de texto (R05) e fontes Unicode (DejaVu).
- [ ] **4. Exportações:** `GET /sessions/{id}/export.csv` (séries por frame e tabela por ciclo), `export.json` (schema versionado `schema_version`), sem PII além do necessário; *streaming* para sessões longas.
- [ ] **5. Protocolo de validação (`protocol.md`):** desenho do estudo (n participantes, goniómetro/marcadores ArUco/retro-reflectores como referência, posições estáticas a ângulos conhecidos + dinâmico), critérios de aceitação por articulação (**MAE ≤ 3°** meta provisória a confirmar com o humano), formato de dados (`.npz`/CSV), consentimento informado.
- [ ] **6. Ferramentas de validação:** `metrics.py` (MAE, RMSE, viés, LoA 95 %), `bland_altman.py` (gráfico + estatística), `runner.py` (CLI: `python -m athletemotion.validation.runner --dataset PATH --engines yolo11_pose_fast,rtmpose` → relatório MD/PDF por motor). Testes com dados sintéticos (erro conhecido injetado → métricas recuperam o erro).
- [ ] **7. Golden de PDF e docs:** testes de *smoke* do PDF (gera, abre com `pypdf`, contém secções e proveniência), snapshot de texto; `docs/validation/README.md` com como reproduzir. Marcar CODE_REVIEW §4.6/§4.7 `✅ Resolvido em R17`.

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
_(PDF de exemplo, métricas sintéticas)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
