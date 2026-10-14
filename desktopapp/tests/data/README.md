# Dados de teste — proveniência e política

Esta pasta existe para deixar escrito **de onde vêm** os dados usados nos testes e o que
pode (e não pode) ser versionado. Um ficheiro binário sem proveniência é pior do que
nenhum: ninguém sabe se pode ser redistribuído, se representa um atleta real ou se o
número que ele produziu ainda significa algo.

## Regras

1. **Nada de dados pesados no Git.** Vídeos, `.npz`, `.onnx` e afins ficam fora do
   repositório (verificado por teste automático em
   `tests/unit/test_synthetic_data.py::test_no_heavy_test_data_is_versioned`). O que se
   versiona é o **gerador**, em `tests/fakes/synthetic.py`.
2. **Gerado > gravado.** Prefere-se sempre um gerador determinístico: a mesma semente
   produz a mesma observação, o `diff` é legível e a suíte não depende de um binário que
   ninguém consegue justificar.
3. **Dados de pessoas só com base legal e anonimização.** Landmarks reais só entram depois
   de removida qualquer informação identificável (sem vídeo, sem metadados de câmara, sem
   nome ou data), com a proveniência e a base legal descritas abaixo.
4. **Sem significado clínico.** Nenhum dado desta pasta valida uma medida biomecânica. As
   metas de precisão validam-se com *ground-truth* medido (marcadores), que é trabalho da
   R17 — não com dados sintéticos a fingir de verdade.

## O que existe hoje

| Dado | Origem | Estado |
|---|---|---|
| Vídeo de teste | Gerado em tempo de execução (`write_synthetic_video`): frames sólidos com um valor de cinzento identificável por índice | ✅ Implementado |
| Frames com textura | Gerados (`synthetic_frame`), determinísticos por semente | ✅ Implementado |
| Poses sintéticas | Geradas (`synthetic_landmark_sequence`): corpo em anel + joelho/tornozelo a pedalar à cadência pedida, com ruído semeado | ✅ Implementado |
| Séries de pedalada | Geradas (`synthetic_pedaling_series`), **provisório** até a R10 publicar `synthetic_pedaling` no domínio | 🟡 Provisório |
| Landmarks reais anonimizados (`.npz`) | **A fornecer pelo responsável do projeto** | 🔴 Pendente |

## Como adicionar landmarks reais anonimizados

1. Gravar a sessão de referência (câmara do PC alvo, exposição fixa) e extrair as
   coordenadas com o motor definitivo.
2. Remover tudo o que não seja coordenadas: sem frames, sem nome do atleta, sem
   data/hora, sem número de série da câmara.
3. Guardar como `landmarks_<contexto>.npz` com as chaves documentadas no próprio `.npz`
   (`landmarks` `(frames, N, 3)`, `fps`, `model_version`) e registar aqui a origem, a
   base legal e a versão do modelo que os produziu.
4. Enquanto o ficheiro não existir, os testes que dele dependem ficam `skipif` com motivo
   explícito — **nunca** substituídos por valores inventados que passariam por medição.
