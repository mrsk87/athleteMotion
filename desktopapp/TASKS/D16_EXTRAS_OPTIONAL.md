# D16 — Extras opcionais: ncnn/Vulkan, ViTPose offline, LLM local, API local

> **ID:** D16 · **Prioridade:** P3 (opcional) · **Onda:** 5
> **Status:** 🔴 TODO · **Progresso:** 0/6 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D05, D15 · **Bloqueia:** — · **Branch:** `spike/d16-extras` · **PR:** —
> **Referência:** README_PLAN §4.3, §5, §10, §12 (Fase 8); CODE_REVIEW §5.3, §5.6 · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
Itens **opcionais**, cada um um *spike* com critério de decisão por medição. A RX 580 (Polaris) pode render melhor com **Vulkan (ncnn)** do que com DirectML em CNN pequenas — a verificar, não assumir. Sem chaves API: LLM só local.

## 2. Objetivo
Avaliar e, **apenas se houver ganho medido ou valor claro**, integrar: (A) backend ncnn/Vulkan; (B) ViTPose para análise offline; (C) LLM local para reformular o parecer; (D) API local para a UI web usar o motor do desktop.

## 3. Âmbito
**Cria (por spike, opcional):** `runtime/backends/ncnn_vulkan.py`, `scripts/spike_ncnn.md`, `runtime/models/vitpose.py`, `services/llm_local.py` (implementa `NarrativeRewriter` de R09), `services/local_api.py`, relatórios em `docs/spikes/*.md`.
**Não mexe:** pipeline base; tudo atrás de *flags*/extras `[ncnn]`, `[vitpose]`, `[llm]`.

## 4. Subtarefas
- [ ] **1. Spike ncnn/Vulkan:** converter YOLO11n-pose/RTMPose-s para ncnn (`pnnx`/`onnx2ncnn`), medir p50/p95 na RX 580 vs DML (usar `benchmark_matrix`); **decisão registada** em `docs/spikes/ncnn.md`: integrar como `InferenceBackend` só se ≥ 20 % melhor p95 **e** erro de keypoints equivalente (MAE ≤ 0.5 px). Caso contrário, documentar “rejeitado” com números.
- [ ] **2. Spike ViTPose (S/B) offline:** exportar ONNX, medir latência/VRAM na RX 580 8 GB; avaliar precisão vs RTMPose com o protocolo de R17 (se dados disponíveis); integrar **só** no modo de análise offline (D09) como modelo “alta precisão”; decisão em `docs/spikes/vitpose.md`.
- [ ] **3. LLM local opcional (`llm_local.py`):** processo externo (llama.cpp servidor com Vulkan **ou** Ollama), modelo 3–8B Q4 escolhido por medição de VRAM/latência na RX 580; implementa `NarrativeRewriter` (R09): reescreve o texto **sem alterar números** — validação pós-geração (todos os números/unidades do original presentes e nenhum novo); *timeout* e *fallback* para o texto determinístico; executa **fora da sessão ao vivo** (a GPU é do pipeline), prioridade baixa; desligado por defeito.
- [ ] **4. Segurança do LLM:** sem rede obrigatória (modelo local), prompts sem PII (nome substituído por placeholder), sem execução de código, limite de tokens, *sandbox* de processo (utilizador normal); aviso na UI “texto reformulado automaticamente; números inalterados”.
- [ ] **5. API local (opcional):** `127.0.0.1` apenas, token efémero (R04), WS de telemetria binária (msgpack) para a UI web usar o motor do desktop; **não** expor à LAN; reaproveita o `Pipeline`; testes de isolamento de ligações (R03).
- [ ] **6. Fecho:** tabela de decisões (integrado/rejeitado/adiado) em `docs/spikes/README.md`; atualizar `README_PLAN` §12 Fase 8, board/changelog; itens integrados com testes e extras de instalação.

## 5. Critérios de aceitação
- Cada spike termina com **decisão baseada em números** documentada.
- Nada integrado sem ganho medido/valor claro e sem testes.
- LLM nunca altera números (teste de validação com casos adversariais).
- Os extras não afetam o instalador base (extras separados).

## 6. Verificação
```powershell
cd desktopapp
python scripts/benchmark.py --backend ncnn --compare dml
pytest tests -k "llm_local or local_api or vitpose" -q
```

## 7. Riscos / Fora de âmbito
- Conversões ncnn podem falhar em operadores: registar e abandonar rapidamente.
- LLM compete pela GPU/VRAM: nunca durante medição ao vivo.

## 8. Prompt específico
```text
Executa a tarefa D16 (desktopapp/TASKS/D16_EXTRAS_OPTIONAL.md) seguindo o Prompt mestre do desktop.
Cada extra é um spike com decisão por medição; rejeitar com números é um resultado válido. O LLM nunca altera números e nunca corre durante a sessão ao vivo.
```

## 9. Evidências
_(relatórios de spikes, medições)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
