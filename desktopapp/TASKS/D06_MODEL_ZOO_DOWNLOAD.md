# D06 — Model zoo, download verificado e RTMPose no desktop

> **ID:** D06 · **Prioridade:** P1 · **Onda:** 2
> **Status:** 🔴 TODO · **Progresso:** 0/7 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D01, R13 · **Bloqueia:** D05 (modelos), D15 · **Branch:** `feat/d06-model-zoo` · **PR:** —
> **Referência:** README_PLAN §5 · **Decisões E3, D1** · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
R13 cria `models/manifest.json`, `model_zoo.verify()` e `scripts/fetch_models.py` no backend. O desktop precisa de **gerir pesos do lado do utilizador final** (download com UI, verificação SHA-256, versões, espaço), em `%APPDATA%/AthleteMotion/models/`, sem copiar a lógica do backend.

## 2. Objetivo
Camada `services/model_manager` (sem Qt) + vista na UI: listar modelos (estado, tamanho, licença), descarregar com retoma, verificar integridade, apagar, escolher por função (detetor/pose); recusar modelos sem verificação.

## 3. Âmbito
**Cria:** `services/model_manager.py`, `runtime/models/catalog.py`, `ui/views/models_view.py`, `ui/viewmodels/models_vm.py`, testes.
**Reutiliza (importa):** `athletemotion.domain.inference.model_zoo`, `manifest.json`.
**Não mexe:** conversão/exportação de modelos (R13), pipeline (D05).

## 4. Subtarefas
- [ ] **1. Catálogo:** ler o `manifest.json` do backend (ou cópia empacotada em D15 com a mesma estrutura); `ModelEntry` com `id,task,size,license,sha256,url,required_for_profile`; estados `ABSENT|DOWNLOADING|VERIFYING|READY|CORRUPT|LICENSE_RISK`.
- [ ] **2. Downloader:** `httpx` em *streaming* com **retoma** (`Range`), *timeouts*, limite de velocidade opcional, escrita para `.part` + `rename` atómico depois da verificação, espaço em disco verificado antes, cancelável; **nunca** executar nada descarregado.
- [ ] **3. Verificação:** SHA-256 obrigatório; se `sha256` do manifest for `null` → o modelo fica `UNVERIFIED` e **só utilizável com confirmação explícita** do utilizador (aviso claro); registo de quem/ quando confirmou.
- [ ] **4. Seleção por função:** `choose(task, profile)` devolve o melhor modelo **disponível e verificado** para o perfil de hardware (D02); se o preferido falta → sugerir descarregar; **nunca** substituir por outro com nome trocado.
- [ ] **5. Vista de Modelos:** tabela com estado/tamanho/licença/versão, botões Descarregar/Cancelar/Verificar/Apagar, barra de progresso, aviso de licença (AGPL/Apache) conforme manifest, *sem bloquear a UI* (worker).
- [ ] **6. Instalação offline:** importar pacote local (`.zip` com modelos + manifest assinado/hash) para máquinas sem internet; verificar hashes.
- [ ] **7. Testes:** servidor HTTP local de teste (`http.server`/`respx`) com ficheiro pequeno: download, retoma após corte, hash errado → `CORRUPT` e ficheiro removido, espaço insuficiente simulado, cancelamento; testes de seleção. Atualizar `README_PLAN` e board/changelog.

## 5. Critérios de aceitação
- Corte de rede a meio → retoma sem recomeçar; hash errado → ficheiro removido e erro claro.
- Nenhum modelo `UNVERIFIED`/`CORRUPT` é carregado sem confirmação explícita.
- UI responsiva durante o download (event loop < 50 ms).
- Sem dependência do estado global do backend em runtime (usa caminhos de `APP_DATA_DIR`).

## 6. Verificação
```powershell
cd desktopapp
pytest tests -k "model_manager or catalog" -q
python -m athletemotion_desktop.services.model_manager --list
```

## 7. Riscos / Fora de âmbito
- URLs/hashes finais dependem de R13 e do humano (E3/D1): se faltarem, **parar e perguntar**; não inventar.
- Atualização automática de modelos fora de âmbito.

## 8. Prompt específico
```text
Executa a tarefa D06 (desktopapp/TASKS/D06_MODEL_ZOO_DOWNLOAD.md) seguindo o Prompt mestre do desktop.
Reutiliza o manifest e o model_zoo do backend. Download com retoma + SHA-256 obrigatório. Nunca inventes URLs nem hashes. Nunca substituas um modelo por outro mantendo o nome.
```

## 9. Evidências
_(testes de retoma/hash, captura da vista)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
