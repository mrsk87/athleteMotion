# D03 — Módulo de captura (câmara USB e ficheiros de vídeo)

> **ID:** D03 · **Prioridade:** P0 · **Onda:** 1
> **Status:** 🔴 TODO · **Progresso:** 0/8 · **Atribuído a:** — · **Início:** — · **Última atualização:** 2026-10-13
> **Depende de:** D01 · **Bloqueia:** D05, D09 · **Branch:** `feat/d03-capture` · **PR:** —
> **Referência:** README_PLAN §4.1–4.2, §6 (câmara) · **Decisão humana E1** · **Protocolo:** [00_PROTOCOLO_LLM.md](00_PROTOCOLO_LLM.md)

## 1. Contexto
Latência e *frame pacing* começam na captura. OpenCV `VideoCapture` com `CAP_DSHOW`/`CAP_MSMF`; câmaras USB entregam MJPG a alta resolução/FPS; *auto-exposure* provoca desfoque/flicker; buffers internos acumulam latência.

## 2. Objetivo
`runtime/capture` (sem Qt): fonte de frames com **timestamp de captura**, **latest-frame-wins**, controlo de FOURCC/resolução/FPS/exposição, reconexão, e também leitura de ficheiros (com *seek*, velocidade, passo frame-a-frame).

## 3. Âmbito
**Cria:** `runtime/capture/{base.py,camera.py,file_source.py,devices.py,controls.py,frame.py}`, testes.
**Não mexe:** ring buffer (D04), inferência (D05), UI (D07).

## 4. Subtarefas
- [ ] **1. `Frame` imutável:** `Frame(index, t_capture_ns, width, height, pixel_format, data(np.ndarray|memoryview), source_id)`; contrato único para todos os módulos seguintes.
- [ ] **2. `CaptureSource` (Protocol):** `open()`, `read(timeout_ms)->Frame|None`, `close()`, `info()` (res/fps/fourcc reais), `set_controls(...)`; fonte base com **thread de captura dedicada** que escreve apenas o último frame (substitui o anterior) e conta *drops*.
- [ ] **3. `CameraSource`:** testar backends `CAP_DSHOW` e `CAP_MSMF` (configurável), `CAP_PROP_FOURCC=MJPG`, resolução/FPS pedidos, `CAP_PROP_BUFFERSIZE=1`; **ler e registar o que a câmara realmente entregou** (nunca assumir); medir FPS efetivo (janela móvel); aviso se < 90 % do pedido.
- [ ] **4. Controlos:** exposição manual/auto, ganho, balanço de brancos, foco (quando suportados); detetar suporte por *probe* (`set` + `get`), expor `capabilities`; presets guardados por dispositivo; “travar exposição” com um clique (leitura da auto e fixação).
- [ ] **5. `devices.py`:** enumerar câmaras (nome amigável via DirectShow/`pygrabber` **ou** PowerShell `Get-PnpDevice -Class Camera` — justificar dependência), índices estáveis, deteção de *hot-plug* (poll lento 2 s numa thread).
- [ ] **6. `FileSource`:** `cv2.VideoCapture`/PyAV, timestamps do ficheiro (PTS), `seek(frame|ms)`, `set_speed(0.1–2×)`, `step(±n)`, *loop* A-B, modo “tão rápido quanto possível” para batch; fim de ficheiro sinalizado.
- [ ] **7. Reconexão:** em falha de leitura repetida → estado `RECONNECTING` com *backoff* (0.5→4 s), reabrir com os mesmos controlos, evento `on_state(state)`; limite de tentativas configurável; nunca bloquear quem consome (`read` devolve `None`).
- [ ] **8. Testes:** fonte *fake* (gerador de padrões com timestamps conhecidos) para validar *latest-wins*, *drops*, reconexão simulada, *seek/step/loop*; teste de latência da fonte fake (ordem de 1 ms); teste manual documentado com câmara real (resultados em *Evidências*: FPS efetivo e latência de captura medida com cronómetro/LED se possível).

## 5. Critérios de aceitação
- `read()` nunca devolve frame mais antigo que o último escrito (teste).
- FPS efetivo e resolução reais reportados (não os pedidos).
- Reconexão automática em câmara desligada e religada (teste manual + simulado).
- Passo frame-a-frame exato em ficheiro (frame N devolve o N-ésimo, verificado por *hash*).
- 0 uso de PyQt no módulo; `mypy --strict` limpo.

## 6. Verificação
```powershell
cd desktopapp
pytest tests/unit/capture -q
python -m athletemotion_desktop.runtime.capture.devices --list
python -m athletemotion_desktop.runtime.capture.camera --index 0 --fourcc MJPG --size 1280x720 --fps 60 --seconds 10
```

## 7. Riscos / Fora de âmbito
- Controlos de câmara variam por driver: tratar “não suportado” como normal.
- Câmaras de rede (RTSP/NDI) só se E1 o pedir (nova tarefa).

## 8. Prompt específico
```text
Executa a tarefa D03 (desktopapp/TASKS/D03_CAPTURE_MODULE.md) seguindo o Prompt mestre do desktop.
Sem PyQt. Latest-frame-wins com contagem de drops. Regista o que a câmara realmente entrega. Reconexão não bloqueante. Testa tudo com uma fonte fake determinística.
```

## 9. Evidências
_(FPS efetivo, latência, testes)_

## 10. Notas e Descobertas
_(vazio — incluir resposta E1)_

## 11. Registo de alterações
| Data | Autor | Subtarefa | Ficheiros | Resumo |
|---|---|---|---|---|
