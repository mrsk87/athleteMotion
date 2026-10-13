# D11 — Vista de relatório e exportações

> **ID:** D11 · **Prioridade:** P1 · **Onda:** 4
> **Status:** 🔴 TODO · **Progresso:** 0/6 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D08, D10, R17 · **Bloqueia:** D15 · **Branch:** `feat/d11-report-view` · **PR:** —
> **Referência:** README_PLAN §6 (vista 5) · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
R17 entrega no backend o gerador de PDF (`services/reporting`), proveniência, CSV/JSON de exportação e protocolo de validação. O desktop apresenta e exporta esses relatórios **sem reimplementar** o conteúdo.

## 2. Objetivo
Vista de relatório com pré-visualização, escolha de idioma, exportação PDF/CSV/JSON e impressão, mais comparação antes/depois.

## 3. Âmbito
**Cria:** `ui/views/report_view.py`, `ui/viewmodels/report_vm.py`, `services/report_service.py`, testes.
**Reutiliza:** `athletemotion.services.reporting.*`.
**Não mexe:** conteúdo do relatório (R17).

## 4. Subtarefas
- [ ] **1. `report_service`:** chama o gerador do backend em *worker* (fora da main thread), cacheia por (sessão, idioma, versão de dados); erros mostrados sem *traceback* (log detalhado em ficheiro).
- [ ] **2. Pré-visualização:** `QPdfDocument`/`QPdfView` (Qt6.4+) com zoom/paginação; indicador de progresso; fallback “abrir no leitor padrão” se o módulo PDF não estiver disponível.
- [ ] **3. Exportação:** guardar PDF, CSV, JSON (R17) com diálogo nativo; **nome de ficheiro sanitizado**; aviso de privacidade (dados pessoais); opção de anonimizar (remove nome/e-mail do relatório).
- [ ] **4. Impressão:** `QPrinter`/`QPrintDialog` com o mesmo PDF; teste manual documentado.
- [ ] **5. Comparação antes/depois:** escolher 2 sessões do mesmo atleta; relatório de comparação (tabela de deltas por medida com incerteza, curvas sobrepostas) — usa o gerador/agregação do backend (se não existir, registar R19).
- [ ] **6. Testes e docs:** relatório gerado a partir de sessão sintética tem secções e proveniência (via `pypdf`); UI offscreen; atualizar `README_PLAN`, board/changelog.

## 5. Critérios de aceitação
- Nenhum valor `withheld` no PDF; proveniência presente; PT/EN corretos.
- UI responsiva durante a geração (< 50 ms de latência do event loop).
- Exportações abrem fora da app (PDF válido, CSV com cabeçalhos estáveis, JSON com `schema_version`).

## 6. Verificação
```powershell
cd desktopapp
$env:QT_QPA_PLATFORM="offscreen"; pytest tests -k "report" -q
```

## 7. Riscos / Fora de âmbito
- Alterar o conteúdo do PDF é de R17; pedir alteração lá.

## 8. Prompt específico
```text
Executa a tarefa D11 (desktopapp/TASKS/D11_REPORTS_EXPORT_VIEW.md) seguindo o Prompt mestre do desktop.
Reutiliza o gerador de relatório do backend; sem reimplementar conteúdo. Geração fora da main thread; nomes de ficheiro sanitizados; opção de anonimizar.
```

## 9. Evidências
_(PDF de exemplo, testes)_

## 10. Notas e Descobertas
_(vazio)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
