# D03 — Módulo de captura (câmara USB e ficheiros de vídeo)

> **ID:** D03 · **Prioridade:** P0 · **Onda:** 1
> **Status:** 🔵 REVIEW · **Progresso:** 8/8 · **Atribuído a:** Buffy (Codebuff) · **Início:** 2026-10-13 · **Última atualização:** 2026-10-13
> **Depende de:** D01 · **Bloqueia:** D05, D09 · **Branch:** `fix/r03-engine-sessions` (checkout partilhado) · **PR:** —
> **Referência:** README_PLAN §4.1–4.2, §6 (câmara) · **Decisão humana E1** · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
Latência e *frame pacing* começam na captura. OpenCV `VideoCapture` com `CAP_DSHOW`/`CAP_MSMF`; câmaras USB entregam MJPG a alta resolução/FPS; *auto-exposure* provoca desfoque/flicker; buffers internos acumulam latência.

## 2. Objetivo
`runtime/capture` (sem Qt): fonte de frames com **timestamp de captura**, **latest-frame-wins**, controlo de FOURCC/resolução/FPS/exposição, reconexão, e também leitura de ficheiros (com *seek*, velocidade, passo frame-a-frame).

## 3. Âmbito
**Cria:** `runtime/capture/{base.py,camera.py,file_source.py,devices.py,controls.py,frame.py}`, testes.
**Não mexe:** ring buffer (D04), inferência (D05), UI (D07).

**Desvios ao âmbito (justificados):**
- `runtime/capture/device.py` foi acrescentado: concentra a **única** fronteira com `cv2.VideoCapture` (protocolo `CaptureDevice` + adaptador `OpenCVCapture` + helpers de FOURCC e a *flag* de backend). Sem ele, a camada da câmara e os controlos teriam de depender do `cv2` diretamente — e as *stubs* do OpenCV (`Mat`, `Any`) obrigariam a `ignore` espalhados. Assim, os testes injetam um dispositivo simulado em vez de substituir a biblioteca.
- `runtime/process.py` foi criado ao extrair de `runtime/hardware/probe.py` o executor de comandos externos (timeout, `CREATE_NO_WINDOW`, tratamento do código 1 do PowerShell). A enumeração de câmaras precisa exatamente do mesmo comportamento; copiá-lo garantiria divergência silenciosa entre sonda de hardware e sonda de câmaras. O `probe` passou a importá-lo (0 linhas duplicadas) e os seus 34 testes continuam verdes.
- `config/paths.py` ganhou `camera_presets_file` (`%APPDATA%/AthleteMotion/camera_presets.json`), pela regra 9 do protocolo: presets são dados do utilizador e não vivem ao lado do executável.

## 4. Subtarefas
- [x] **1. `Frame` imutável:** `Frame(index, t_capture_ns, width, height, pixel_format, data, source_id)` com validação na construção (índice não negativo, instante monotónico, forma coerente com o formato, `uint8`), **píxeis só-leitura** (`read_only_view`) e proibição de arrays próprios (o frame é uma vista sobre o buffer do produtor). Igualdade por conteúdo; não é *hashable*.
- [x] **2. `CaptureSource` (Protocol) + base com thread:** `open()`, `read(timeout_ms=0)`, `close()`, `info()`, `state`, `stats()`, observadores de estado. A base (`ThreadedCaptureSource`) implementa a thread dedicada, o **latest-wins**, o descarte contado, o FPS efetivo (janela móvel de 60 frames), o aviso quando < 90 % do pedido, a reconexão com *backoff* 0,5→4 s e a máquina de estados (`CLOSED/OPENING/READING/RECONNECTING/FAILED`). Sem `time.sleep` em laços de tempo real (`Event.wait`/`Condition.wait`).
- [x] **3. `CameraSource`:** `CAP_DSHOW`/`CAP_MSMF` configurável, `CAP_PROP_FOURCC=MJPG`, resolução/FPS pedidos e **`CAP_PROP_BUFFERSIZE=1`**; lê e regista o que a câmara **realmente** entregou (resolução, FPS, FOURCC e tamanho do buffer do driver) e emite um aviso por cada divergência face ao pedido; falha explícita se o driver entregar uma forma inesperada em vez de ler píxeis truncados.
- [x] **4. Controlos:** `probe_controls` verifica suporte por escrita do mesmo valor + nova leitura (um driver que devolve sempre `0.0` é reportado como **não** suportado, com a razão); `set_control`, `lock_exposure` (desliga a automática e fixa o valor lido), presets por dispositivo com gravação atómica (`.tmp` + `os.replace` + `fsync`) e aplicação que **devolve** os controlos recusados em vez de fingir sucesso.
- [x] **5. `devices.py`:** nomes amigáveis por PowerShell `Get-PnpDevice -Class Camera -Status OK` (sem dependência nova; justificação no cabeçalho do módulo), índices resolvidos por sondagem do OpenCV (0…7, cada dispositivo fechado de imediato), associação nome↔índice **marcada como inferida** e abandonada quando as contagens não coincidem, e `CameraHotplugMonitor` (poll 2 s) com `poll_once()` testável.
- [x] **6. `FileSource`:** `cv2.VideoCapture` sobre o ficheiro, `read()` com cadência opcional (`realtime`), `seek(frame|ms)`, `step(±n)` exato, `set_speed(0,1–2×)`, intervalo A-B (que **posiciona no início do intervalo**), modo *batch* (tão rápido quanto possível) e fim de ficheiro sinalizado (`at_end`).
- [x] **7. Reconexão:** 3 leituras falhadas consecutivas → `RECONNECTING` com *backoff* exponencial (interrompível pelo encerramento), reabertura com os mesmos controlos, realocação do buffer se a resolução mudar, limite configurável de tentativas → `FAILED` com a **causa-raiz** preservada em `last_error`; `read()` devolve `None` (nunca bloqueia) enquanto a fonte não recupera.
- [x] **8. Testes:** fonte *fake* determinística (`tests/support/fake_capture.py`), câmara simulada com propriedades e defeitos controlados, vídeos gerados no teste (frame N identificável por conteúdo), testes de cadência/lote e portões de desempenho em `tests/perf/test_capture_perf.py`. **111 testes** no pacote (ver 9.1).

## 5. Critérios de aceitação
- ✅ **`read()` nunca devolve frame mais antigo que o último escrito** — `test_read_never_goes_backwards` (20 leituras, índices estritamente crescentes) e, na base, entre dois `read()` só existe um frame guardado.
- ✅ **FPS efetivo e resolução reais reportados** — `test_divergences_are_reported_as_warnings` (pedido 1280x720@60 MJPG, obtido 640x480@30 YUY2 → 3 avisos) e `test_driver_buffer_larger_than_requested_is_reported`.
- ✅ **Reconexão automática (simulada)** — `test_camera_reconnects_after_it_stops_delivering`, `test_reconnect_reopens_the_device_and_counts_it`, `test_read_returns_none_when_the_source_failed`. *(Teste com câmara real: não executado — ver 9.4.)*
- ✅ **Passo frame-a-frame exato em ficheiro (frame N devolve o N-ésimo, verificado por *hash*)** — verificados por **conteúdo** (`test_step_returns_exactly_the_requested_frame`, `test_seek_by_frame_and_by_milliseconds`): o frame é identificado pelo seu valor de cinzento, o que também deteta um `seek` que caísse no *keyframe* anterior.
- ✅ **0 uso de PyQt no módulo; `mypy --strict` limpo** — 9.5.

## 6. Verificação
```powershell
cd desktopapp
$env:QT_QPA_PLATFORM="offscreen"
python -m pytest tests -q                                          # 339 passed
python -m pytest tests/unit/capture -q                             # 111 passed
python -m pytest tests/perf -q -s                                  # imprime as latências medidas
python -m pytest tests -q --cov=athletemotion_desktop.runtime.capture --cov-report=term-missing
ruff check src tests ; ruff format --check src tests scripts ; mypy src tests    # limpos
python -m athletemotion_desktop.runtime.capture.devices --list
python -m athletemotion_desktop.runtime.capture.camera --index 0 --fourcc MJPG --size 1280x720 --fps 60 --seconds 10
```

## 7. Riscos / Fora de âmbito
- **Câmaras de rede (RTSP/NDI)** dependem da decisão E1 e não foram implementadas; a base com thread está preparada para as receber (só é preciso implementar `_open_device`/`_read_into`/`_release_device`).
- **Controlos variam muito por driver:** "não suportado" é tratado como normal e explicado, nunca como erro fatal. O que não se faz é declarar suportado o que não foi verificado.
- **`read()` de câmara não substitui o ring buffer:** a entrega é *latest-wins* com buffer reutilizado. Quem precisar do frame depois do `read()` seguinte tem de o copiar para o anel (D04) — é para isso que o anel existe.
- **Teste manual com câmara real pendente** (9.4): a máquina usada para o desenvolvimento respondeu à enumeração, mas o teste com vídeo ao vivo (FPS efetivo a 720p60 e latência medida com LED) tem de ser executado no PC alvo.

## 8. Prompt específico
```text
Executa a tarefa D03 (desktopapp/TASKS/D03_CAPTURE_MODULE.md) seguindo o Prompt mestre do desktop.
Sem PyQt. Latest-frame-wins com contagem de drops. Regista o que a câmara realmente entrega. Reconexão não bloqueante. Testa tudo com uma fonte fake determinística.
```

## 9. Evidências

### 9.1. Testes
```
111 passed  (tests/unit/capture: frame 16 · base 17 · câmara 16 · controlos 19 · enumeração 24 · ficheiro 19)
339 passed  (suite completa, incluindo os 111 novos e os 34 da sonda de hardware que passaram a usar runtime.process)
```
Nenhum teste toca em hardware: a câmara é um `FakeCaptureDevice` (propriedades, escritas recusadas, leituras falhadas, resolução que muda, frames que acabam) e os vídeos são gerados no próprio teste.

### 9.2. Portões de desempenho (medidos nesta máquina)
```
[captura read()]     p50=0.0035 ms p95=0.0674 ms  n=4400  (orçamento 1,0 ms)  ✅
[captura ficheiro]   3000 frames em 84,8 ms por passagem (≈35 000 frames/s)   ✅
```
A leitura de um frame **já disponível** custa ~3,5 µs (0,02 % do orçamento de 16,6 ms por frame a 60 FPS): a contabilidade de entrega não é o gargalo. A medição exclui deliberadamente a espera pelo produtor (mediria a câmara, não o mecanismo).

### 9.3. Verificação manual no sistema (sem câmara autorizada para vídeo)
```
$ python -m athletemotion_desktop.runtime.capture.devices --list
- Câmara 0: índice 0 (dshow), 640x480
- Câmara 1: índice 1 (dshow), 640x480
exit=0

(stderr) O Windows reporta 1 câmara(s) mas o OpenCV responde em 2 índice(s):
         os nomes não podem ser associados com fiabilidade.
```
Este resultado é **real** e mostra exatamente o comportamento desenhado: nomes genéricos em vez de uma associação inventada, porque as contagens não coincidem. É também a prova de que o caminho PowerShell + sondagem do OpenCV funciona no Windows (o `cv2` avisa, no `stderr`, dos índices que não existem — ruído do próprio OpenCV, não um erro da aplicação).

### 9.4. Teste com câmara real — **não executado (limitação registada)**
O comando abaixo mede o FPS efetivo e o descarte em tempo real, mas exige uma câmara ligada e autorizada nesta máquina, o que não estava disponível:
```powershell
python -m athletemotion_desktop.runtime.capture.camera --index 0 --fourcc MJPG --size 1280x720 --fps 60 --seconds 10
```
Esperado: `câmara 0: <resolução real> @ <FPS real>`, contagem de capturados/entregues/descartados e avisos de divergência. **Fica como o primeiro item a correr no PC alvo antes da D05.**

### 9.5. Verificação estática
```
ruff format --check src tests scripts → 90 files already formatted
ruff check src tests                  → All checks passed!
mypy src tests                        → Success: no issues found in 90 source files
```
Nenhum módulo de `capture/` importa PyQt (teste dedicado da D04 cobre `runtime/` inteiro, incluindo este pacote).

### 9.6. Cobertura dos módulos novos (suite completa)
```
frame.py        100%   device.py       94%   base.py         95%
controls.py      90%   devices.py      93%   file_source.py  93%
camera.py        87%   process.py      96%   TOTAL capture+process 93%
```
As linhas não cobertas são as de linha de comando (`camera.main`, `devices.main` já testado em JSON) e caminhos defensivos de driver (exceções na libertação, `_blank` de leitura falhada).

## 10. Notas e Descobertas
- **Um `Frame` com píxeis escrevíveis é um *bug* garantido.** Todos os consumidores partilham o buffer do produtor; sem a vista só-leitura, uma escrita acidental num sítio corromperia o frame que outro consumidor estava a ler — e o sintoma apareceria longe da causa. A validação também recusa arrays próprios, para que ninguém "resolva" a partilha copiando.
- **O armadilha dos testes de captura é o buffer partilhado:** guardar vários `Frame` numa lista e comparar conteúdo no fim dá o *último* frame em todos (apanhado duas vezes, nos testes de ficheiro e da base). A regra passou a ser: validar o conteúdo **no momento da leitura**.
- **Os drivers mentem sobre os controlos.** `cap.set()` devolve `True` para propriedades inexistentes e `cap.get()` devolve `0.0` tanto para "não suportado" como para "valor zero". A verificação por escrita-do-mesmo-valor distingue os casos, e o resultado ambíguo é reportado como não suportado com a razão — em vez de apresentar um controlo morto na UI.
- **Uma reconexão bem-sucedida não pode reiniciar a contagem de tentativas.** A primeira versão reiniciava ao reabrir o dispositivo, o que, com uma câmara que reabre mas não entrega frames (cabo meio solto), criava um ciclo infinito de reaberturas. A tentativa só se reinicia quando **um frame é efetivamente capturado**.
- **A causa-raiz da falha é preservada.** Se a leitura falhar por "forma inesperada" e a reabertura falhar a seguir, `last_error` mantém o motivo original — era o que os testes apanharam quando o erro reportado passou a ser "não abriu", escondendo o defeito real.
- **`Get-PnpDevice` + sondagem do OpenCV não são a mesma lista:** o Windows pode listar 1 câmara e o OpenCV responder em 2 índices (visto nesta máquina, 9.3). Por isso a associação nome↔índice é heurística declarada (`name_is_inferred`) e é abandonada quando as contagens não coincidem — nunca se apresenta um nome ao lado do índice errado.
- **O `ConvertTo-Json` devolve um objeto quando só há um dispositivo** (não uma lista): tratar o `payload` como lista cegamente faria a única câmara do utilizador desaparecer da lista. Está coberto por teste.
- **`cv2.VideoWriter_fourcc` não existe nas *stubs* de tipos** do OpenCV — a alternativa (um `type: ignore`) esconderia erros reais, pelo que `fourcc_to_code` é implementado no projeto (`c0 | c1<<8 | c2<<16 | c3<<24`, com teste de ida e volta).
- **`--list` no enumerador de câmaras** existe para simetria com `capture.camera --list` (onde é obrigatório); no enumerador é equivalente ao comportamento por omissão e está dito no `--help`.
- **`t_capture_ns` continua a ser o relógio de parede em ficheiros** (e não o PTS do contentor): assim a "idade do frame" significa o mesmo em qualquer fonte, e a posição exata no ficheiro é dada por `Frame.index`, que é exato. O PTS fica disponível no futuro se a D09 o precisar.
- **Reconexão com `Event.wait` (nunca `sleep`):** o encerramento interrompe o *backoff* na hora; um `sleep` de 4 s deixaria a aplicação presa ao fechar.
- **`runtime/process.py`:** o executor de comandos externos é agora partilhado com a sonda de hardware. Isto obrigou a atualizar 4 testes do `probe` que substituíam `probe._run_command` — atualização feita no mesmo momento, sem enfraquecer nenhuma asserção.

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
| 2026-10-13 | Buffy (Codebuff) | — | `runtime/process.py`, `runtime/hardware/probe.py`, `tests/unit/test_hardware_probe.py` | Extração do executor de comandos externos para um módulo partilhado (timeout, `CREATE_NO_WINDOW`, tolerância ao código 1 do PowerShell); a sonda de hardware passou a importá-lo, sem cópia de lógica |
| 2026-10-13 | Buffy (Codebuff) | 1 | `runtime/capture/{frame.py,device.py}`, `tests/unit/capture/test_frame.py` | `Frame` imutável com vista só-leitura obrigatória e validação de forma/dtype/instante; protocolo `CaptureDevice` + adaptador `OpenCVCapture` + helpers de FOURCC (a única fronteira com o `cv2`) |
| 2026-10-13 | Buffy (Codebuff) | 2, 7 | `runtime/capture/base.py`, `tests/unit/capture/test_threaded_source.py` | Base com thread dedicada: *latest-wins*, descarte contado, FPS efetivo com aviso < 90 %, reconexão com *backoff* interrompível, máquina de estados e observadores; erros recuperáveis nunca bloqueiam o consumidor |
| 2026-10-13 | Buffy (Codebuff) | 3, 4 | `runtime/capture/{camera.py,controls.py}`, `config/paths.py`, `tests/unit/capture/{test_camera.py,test_controls.py}` | `CameraSource` com FOURCC/resolução/FPS/buffer = 1 pedidos e **valores reais** reportados com avisos; controlos verificados por *round-trip*, trava de exposição e presets gravados atomicamente |
| 2026-10-13 | Buffy (Codebuff) | 5 | `runtime/capture/devices.py`, `tests/unit/capture/test_devices.py` | Enumeração por `Get-PnpDevice` + sondagem do OpenCV com associação heurística declarada, deteção de *hot-plug* numa thread e CLI (`--list`/`--json`) |
| 2026-10-13 | Buffy (Codebuff) | 6 | `runtime/capture/file_source.py`, `tests/unit/capture/test_file_source.py` | `FileSource` com cadência opcional, `seek(frame|ms)`, `step(±n)` exato (verificado por conteúdo), velocidade 0,1–2×, intervalo A-B e modo *batch* |
| 2026-10-13 | Buffy (Codebuff) | 8 | `tests/support/fake_capture.py`, `tests/perf/test_capture_perf.py` | Dobres reutilizáveis (dispositivo, fonte, relógio) e portões de desempenho: `read()` de um frame pronto p50 0,0035 ms / p95 0,067 ms e ≈35 000 frames/s em modo *batch* |
| 2026-10-13 | Buffy (Codebuff) | 8 | `TASKS/D03_*.md`, `TASKS/{STATUS_BOARD,CHANGELOG}.md`, `README.md`, `README_PLAN.md` | Estado, evidências e limitações (incluindo o teste com câmara real pendente) registados; 339 testes verdes, `mypy --strict` limpo |
