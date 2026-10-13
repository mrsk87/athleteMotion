# R09 — AI Coach: parecer determinístico, i18n, sem valores inventados

> **ID:** R09 · **Prioridade:** P0 · **Onda:** 1
> **Status:** 🔴 TODO · **Progresso:** 0/7 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** R01 · **Bloqueia:** R17 · **Branch:** `fix/r09-ai-coach` · **PR:** —
> **Referência:** CODE_REVIEW §2.4, §5.6 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto (verificar em `services/ai_coach.py` e `api/v1/sessions.py` rota `/ai-coach`)
- Se joelho/costas não existem, assume **148.0°** e **45.0°** e emite "Parabéns… perfeitamente alinhada" → resultado clínico falso.
- Procura diagnósticos por substring PT (`"joelho"`, `"costas"`, `"tronco"`) — quebra em `lang=en`.
- EN usa `kops_data.get('actionPt')` (chave inexistente).
- Texto em f-strings inline, duplicado PT/EN; nome "IA" quando é *template*.
- Utilizador **não tem chaves API** → LLM local só opcional (e não nesta tarefa, apenas ponto de extensão).

## 2. Objetivo
Parecer gerado por **regras determinísticas** a partir de dados validados, com `joint_id` estáveis, textos num catálogo i18n e um estado explícito “dados insuficientes”. Ponto de extensão para um *rewriter* LLM local futuro.

## 3. Âmbito
**Cria:** `athletemotion/services/coach/{__init__.py,rules.py,narrative.py,i18n/{pt.json,en.json}}`, `athletemotion/schemas/coach.py`.
**Altera/Remove:** `services/ai_coach.py` (passa a *shim* que reexporta/deprecia), rota `/ai-coach`, testes.
**Não mexe:** thresholds (`domain/biomechanics/thresholds.py`), PDF, frontend (apenas contrato novo retrocompatível).

## 4. Subtarefas
- [ ] **1. Testes primeiro** (`tests/unit/test_coach.py`): sem joelho → `knee` marcado `insufficient_data` e **nenhuma** frase de elogio/alerta sobre joelho; `lang=en` produz texto EN com números; KOPS fora de limites gera frase com mm reais; valores nos limites (145.0/155.0) comportam-se de forma determinística (intervalo fechado documentado).
- [ ] **2. Identificadores estáveis:** `JointId` enum (`knee`,`torso`,`elbow`,`ankle`,`hip`…) no domínio; `DiagnosticItem.joint_id` adicionado (campo novo, mantendo `joint_name` para retrocompatibilidade). O coach consome `joint_id`, **nunca** o rótulo traduzido.
- [ ] **3. Regras (`rules.py`):** funções puras `assess_knee(measured, thresholds, ctx) -> Finding` devolvendo `Finding(joint_id, status ∈ {ok,low,high,insufficient}, delta, evidence)`; thresholds vêm de `BIOMECHANIC_THRESHOLDS` + flexibilidade/modalidade (nada de 145/155 hardcoded).
- [ ] **4. Catálogo i18n:** chaves (`coach.knee.low`, `coach.knee.high`, `coach.knee.ok`, `coach.insufficient`…) com placeholders nomeados (`{angle:.1f}`, `{name}`); `pt.json` e `en.json` completos e **teste de paridade de chaves**; linguagem prudente (“sugere”, “pode indicar”) e **aviso** de que não substitui avaliação profissional; sem diagnósticos médicos categóricos (ex. “compressão L4-L5”).
- [ ] **5. Narrativa:** `build_narrative(findings, ctx, lang) -> CoachReport` com `title, executive_summary, cockpit_analysis, kops_insight, cadence_power_insight, adaptation_plan, data_quality` (lista dos ângulos em falta); se **todos** insuficientes → `executive_summary` = mensagem de dados insuficientes e `adaptation_plan=[]`. Plano de adaptação ajustado à magnitude dos deltas (ajustes > X mm → faseado).
- [ ] **6. Rota e schema:** `/sessions/{id}/ai-coach` devolve `CoachReport` (campos antigos preservados + `data_quality`, `disclaimer`, `generator: "rules-v1"`). Renomear no UI/doc “Parecer Biomecânico (assistente por regras)” — sem prometer IA.
- [ ] **7. Ponto de extensão LLM (opcional, desligado):** interface `NarrativeRewriter` (Protocol) com implementação `NoopRewriter`; documentar contrato: recebe texto + números, **proibido alterar números**; validação pós-reescrita (todos os números do original presentes). **Não** implementar LLM nesta tarefa. Marcar CODE_REVIEW §2.4 `✅ Resolvido em R09`.

## 5. Critérios de aceitação
- Nenhum valor numérico por omissão (grep por `148.0`, `45.0` no módulo coach → 0).
- Com dados incompletos o relatório diz explicitamente o que falta.
- `pt.json` e `en.json` com as mesmas chaves (teste).
- Todos os textos clínicos revistos (sem afirmações médicas categóricas) — checklist em *Notas*.

## 6. Verificação
```powershell
cd backend
pytest tests/unit/test_coach.py -q; pytest -q
python -c "import json;print(set(json.load(open('src/athletemotion/services/coach/i18n/pt.json')))==set(json.load(open('src/athletemotion/services/coach/i18n/en.json'))))"
```

## 7. Riscos / Fora de âmbito
- Frontend pode depender de campos existentes: manter todos, só acrescentar.
- LLM local → tarefa futura (CODE_REVIEW §5.6).

## 8. Prompt específico
```text
Executa a tarefa R09 (TASKS/REVIEW_2026/R09_AI_COACH_REWRITE.md) seguindo o Prompt mestre.
Elimina valores por omissão (148/45). Usa joint_id, regras puras e catálogo i18n PT/EN. Linguagem prudente. Mantém retrocompatibilidade do JSON da rota.
```

## 9. Evidências
_(testes, saída de exemplo PT/EN com dados completos e incompletos)_

## 10. Notas e Descobertas
_(vazio — checklist de revisão clínica dos textos)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
