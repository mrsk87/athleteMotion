# R09 — AI Coach: parecer determinístico, i18n, sem valores inventados

> **ID:** R09 · **Prioridade:** P0 · **Onda:** 1
> **Status:** 🔵 REVIEW · **Progresso:** 7/7 · **Atribuído a:** Antigravity (LLM) · **Início:** 2026-10-13 · **Última atualização:** 2026-10-13
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
**Cria:** `athletemotion/services/coach/{__init__.py,rules.py,narrative.py,i18n/{pt.json,en.json},rewriter.py}`, `athletemotion/schemas/coach.py`, `athletemotion/domain/biomechanics/joints.py`.
**Altera/Remove:** `services/ai_coach.py` (passa a *shim* determinístico de retrocompatibilidade), rota `/ai-coach`, `schemas/fit.py` (`DiagnosticItem.joint_id`), testes.
**Não mexe:** thresholds (`domain/biomechanics/thresholds.py`), PDF, frontend (apenas contrato novo retrocompatível).

## 4. Subtarefas
- [x] **1. Testes primeiro** (`tests/unit/test_coach.py`): sem joelho → `knee` marcado `insufficient` e **nenhuma** frase de elogio/alerta sobre joelho; `lang=en` produz texto EN com números exatos; KOPS fora de limites gera frase com mm reais; valores nos limites (145.0/155.0) comportam-se de forma determinística (intervalo fechado documentado).
- [x] **2. Identificadores estáveis:** `JointId` enum (`knee`,`torso`,`elbow`,`ankle`,`hip`…) no domínio (`athletemotion/domain/biomechanics/joints.py`); `DiagnosticItem.joint_id` e `PostureDiagnostic.joint_id` adicionados preservando `joint_name` para retrocompatibilidade.
- [x] **3. Regras (`rules.py`):** funções puras `assess_knee`, `assess_torso`, `assess_elbow` devolvendo `Finding(joint_id, status ∈ {ok,low,high,insufficient}, delta, evidence)`; thresholds consomem estritamente `BIOMECHANIC_THRESHOLDS` (0 valores arbitrários).
- [x] **4. Catálogo i18n:** `pt.json` e `en.json` estruturados com paridade estrita de chaves (`True` em teste unitário); linguagem prudente (“sugere”, “pode indicar”), aviso/disclaimer ergonómico explícito e ausência de diagnósticos médicos categóricos.
- [x] **5. Narrativa (`narrative.py`):** `build_coach_report(findings, ctx, lang) -> CoachReport` com `title, executive_summary, cockpit_analysis, kops_insight, cadence_power_insight, adaptation_plan, data_quality, disclaimer, generator: "rules-v1"`; se todos forem insuficientes → `adaptation_plan=[]` e sumário de dados insuficientes.
- [x] **6. Rota e schema:** `/sessions/{id}/ai-coach` devolve `CoachReport` (campos antigos preservados + novos metadados de integridade). Atualizada docstring e contratos OpenAPI.
- [x] **7. Ponto de extensão LLM:** interface `NarrativeRewriter` (Protocol) com `NoopRewriter` e validador `verify_numeric_fidelity` (proíbe mutação de valores numéricos originais). Marcado CODE_REVIEW §2.4 `✅ Resolvido em R09`.

## 5. Critérios de aceitação
- Nenhum valor numérico por omissão (grep por `148.0` no código fonte → 0).
- Com dados incompletos o relatório declara explicitamente insuficiência de dados.
- `pt.json` e `en.json` com exatamente as mesmas chaves (`test_i18n_key_parity` verde).
- Todos os textos clínicos revistos com linguagem preventiva e responsável.

## 6. Verificação
```powershell
cd backend
pytest tests/unit/test_coach.py -v; pytest -q
python -c "import json;print(set(json.load(open('src/athletemotion/services/coach/i18n/pt.json')))==set(json.load(open('src/athletemotion/services/coach/i18n/en.json'))))"
```

## 7. Riscos / Fora de âmbito
- Frontend continua a receber os campos antigos (`executive_summary`, `cockpit_analysis`, `kops_insight`, `cadence_power_insight`, `adaptation_plan`) e pode agora beneficiar de `data_quality` e `disclaimer`.

## 8. Prompt específico
```text
Executa a tarefa R09 (TASKS/REVIEW_2026/R09_AI_COACH_REWRITE.md) seguindo o Prompt mestre.
Elimina valores por omissão (148/45). Usa joint_id, regras puras e catálogo i18n PT/EN. Linguagem prudente. Mantém retrocompatibilidade do JSON da rota.
```

## 9. Evidências
- **Paridade i18n:** `python -c "import json;print(set(json.load(open('src/athletemotion/services/coach/i18n/pt.json')))==set(json.load(open('src/athletemotion/services/coach/i18n/en.json'))))"` devolve `True`.
- **Testes unitários dedicados:** 8 testes em `tests/unit/test_coach.py` passando a 100% em 0.09s.
- **Suíte global:** 77 testes passando no backend (`77 passed, 2 warnings in 9.11s`).
- **Grep de validação:** 0 ocorrências de `148.0` no código de `athletemotion`.
- **Ruff linter:** Verificação estática com zero erros.

## 10. Notas e Descobertas
- **Revisão Clínica dos Textos:** Substituição de expressões categóricas agressivas ("compressão nos discos L4-L5 e adormecimento nas mãos", "forçará a bacia a oscilar... sobrecarregando a fáscia plantar") por redação de orientação ergonómica desportiva responsável ("postura mais agressiva pode aumentar a tensão na zona lombar", "pode induzir compensação pélvica") acompanhada de disclaimer explícito de que o algoritmo não constitui diagnóstico médico.
- **Ponto de Extensão com Fidelidade Numérica:** O helper `verify_numeric_fidelity` extrai todos os valores numéricos em vírgula flutuante do draft das regras e confirma se o rewriter os preservou, prevenindo alucinações de LLM em futuros motores.

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-13 | Antigravity (LLM) | 1-7 | `domain/biomechanics/joints.py`, `services/coach/*`, `schemas/coach.py`, `services/ai_coach.py`, `api/v1/sessions.py`, `tests/unit/test_coach.py` | Reescrita determinística completa do Treinador Biomecânico, catálogo i18n PT/EN com paridade, JointId enum e eliminação de valores fictícios (77/77 testes verdes) |

