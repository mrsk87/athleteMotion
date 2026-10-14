# Limites Operacionais e de Segurança (Security Limits)

> **Status:** 🟢 VIGENTE · **Versão:** 0.3.1 · **Última atualização:** 2026-10-14 · **Responsável:** Senior Core Developer · **Revisto contra o código em:** `788dcbb`
> **Módulo:** `athletemotion.config.settings` · **Referência:** R05

Este documento especifica os limites centrais de segurança, transporte e consumo de memória aplicados pelo backend do **Athlete Motion** para proteção contra ataques de negação de serviço (DoS), esgotamento de memória por descompressão abusiva (Pixel Floods / Decompression Bombs) e corrupção de dados.

---

## 1. Tabela Central de Limites e Quotas

Todos os valores são configuráveis através de variáveis de ambiente (`ATHLETE_*` ou específicas) e carregados estritamente através de [ApiSettings](file:///d:/Projects/athleteMotion/backend/src/athletemotion/config/settings.py).

| Parâmetro / Chave | Variável de Ambiente | Valor Padrão | Escopo / Endpoint | Efeito ao Exceder |
|---|---|---|---|---|
| `max_upload_bytes` | `MAX_UPLOAD_BYTES` | 5 MB (`5242880`) | Upload (`/process_frame`) | HTTP 413 (aborto imediato no stream) |
| `max_image_pixels` | `MAX_IMAGE_PIXELS` | 16 MP (`16000000`) | Pillow / Inspeção | HTTP 413 (`ImageTooLargeError`) |
| `max_image_side` | `MAX_IMAGE_SIDE` | 4096 px | Largura ou altura de imagem | HTTP 413 (`ImageTooLargeError`) |
| `ws_max_message_bytes` | `WS_MAX_MESSAGE_BYTES` | 1 MB (`1048576`) | `/ws/live-inference` | Fecho WebSocket (código `1009`) |
| `ws_max_connections` | `WS_MAX_CONNECTIONS` | 2 ligações | `/ws/live-inference` | Fecho WebSocket (código `1013`) |
| `gif_max_frames` | `GIF_MAX_FRAMES` | 120 fotogramas | `/api/v1/video/export-gif` | HTTP 422 (validação de esquema) |
| `gif_max_total_bytes` | `GIF_MAX_TOTAL_BYTES` | 40 MB (`41943040`) | `/api/v1/video/export-gif` | HTTP 413 (carga útil acumulada) |
| `gif_max_side` | `GIF_MAX_SIDE` | 720 px | `/api/v1/video/export-gif` | Redimensionamento automático mantendo rácio |
| `max_raw_landmarks_bytes` | `MAX_RAW_LANDMARKS_BYTES` | 64 KB (`65536`) | `/api/v1/sessions/{id}/snapshots` | HTTP 422 (`SnapshotCreate` validator) |

---

## 2. Validação Biomecânica de Parâmetros de Entrada

Os parâmetros de consulta para relatórios técnicos em PDF (`/api/v1/sessions/{id}/pdf`) e parecer de AI Coach (`/api/v1/sessions/{id}/ai-coach`) são validados com limites anatómicos e físicos estritos:

| Parâmetro | Tipo | Intervalo Válido | Unidade | Descrição |
|---|---|---|---|---|
| `lang` | `Literal["pt", "en"]` | `"pt"` ou `"en"` | — | Idioma estrito do relatório / parecer |
| `kops_offset` | `float` | `[-100.0, 100.0]` | mm | Desvio de alinhamento joelho sobre o eixo do pedal (KOPS) |
| `saddle_drop` | `float` | `[-20.0, 20.0]` | cm | Desnível vertical do selim em relação ao guiador |
| `cadence_rpm` | `int` | `[20, 200]` | RPM | Frequência de pedalada aceitável fisiologicamente |
| `power_watts` | `int` | `[0, 2500]` | Watts | Potência mecânica debitada no pedaleiro |
| `angles` (`knee`, `back`, etc.) | `float` | `[0.0, 360.0]` | Graus | Intervalo angular válido no domínio biomecânico |

---

## 3. Mecanismos Defensivos Implementados

### 3.1 Upload Streaming sem Buffer Total
O endpoint `/process_frame` nunca lê o payload completo antes de validar quotas. A receção de bytes é efetuada em blocos de 64 KB com somatório progressivo. Assim que o total ultrapassa `max_upload_bytes`, o upload é abortado com `HTTP 413 Content Too Large`, impedindo ataques de esgotamento de memória (RAM Exhaustion).

### 3.2 Leitura Defensiva de Cabeçalhos (Pillow Decompression Bomb Protection)
Antes de invocar o rasterizador OpenCV (`cv2.imdecode`), os bytes são validados quanto aos Magic Bytes (`JPEG`: `\xFF\xD8\xFF`, `PNG`: `\x89PNG\r\n\x1a\n`, `WebP`: `RIFF....WEBP`). A seguir, o cabeçalho é inspecionado com `Image.open` sob restrição `Image.MAX_IMAGE_PIXELS`, verificando dimensões `(w, h)` antes de alocar matrizes na memória.

### 3.3 Blindagem do WebSocket
1. **Controlo de Origem:** Validação estrita do cabeçalho `Origin` contra `ALLOWED_ORIGINS` (código de fecho `1008 Policy Violation`).
2. **Quota de Concorrência:** Rejeição de novas ligações se o total atingir `ws_max_connections` (código `1013 Try Again Later`).
3. **Limite de Mensagens:** Mensagens acima de `ws_max_message_bytes` encerram o canal com código `1009 Message Too Big`.
4. **Deteção de Anomalias Continuadas:** Envio repetido de dados corrompidos (5 frames consecutivos sem cabeçalho JPEG SOI) encerra a ligação com código `1003 Unsupported Data`.

### 3.4 Processamento Assíncrono de GIFs em Threadpool
A compilação de GIFs animados (`/api/v1/video/export-gif`) é delegada via `anyio.to_thread.run_sync` para um threadpool do sistema operativo. Isto garante que o event loop do FastAPI nunca seja bloqueado por tarefas de encode intensivo em CPU, mantendo a latência das rotas de telemetria abaixo de 100 ms.

### 3.5 Higienização Estrita de Relatórios PDF
Todas as variáveis fornecidas pelo utilizador (nomes de atletas, modelos de bicicletas, observações e recomendações) são higienizadas através de `xml.sax.saxutils.escape` e remoção de bytes nulos (`\x00`), prevenindo injeções de tags maliciosas nos blocos `Paragraph` do ReportLab. O nome de ficheiro no cabeçalho `Content-Disposition` é sanitizado contra ataques de Directory Traversal ou quebra de cabeçalho HTTP.
