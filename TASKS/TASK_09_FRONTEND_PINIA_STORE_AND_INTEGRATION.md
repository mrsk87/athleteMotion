# TAREFA 09: GESTOR DE ESTADO PINIA, CLIENTE WEBSOCKET & DESACOPLAMENTO

> **Identificador:** `TASK_09_FRONTEND_PINIA_STORE_AND_INTEGRATION`  
> **Prioridade:** P1 (Integração & Desacoplamento da Arquitetura)  
> **Responsabilidade:** Instalar e configurar a Pinia Store no Vue 3, implementar o cliente WebSocket assíncrono com reconexão resiliente e definir o plano de transição para desmontar o monólito `LiveCameraCapture.js`.

---

## 1. OBJETIVO DA TAREFA
1. **Pinia Store (`useInferenceStore`):** Centralizar o estado reativo de telemetria, amostras temporais, motor ativo e ligação WebSocket.
2. **Cliente WebSocket Resiliente:** Comunicação de alto rendimento com empacotamento binário de frames (`[4 bytes timestamp][jpeg bytes]`), reconexão exponencial automática e descarte de quadros atrasados.
3. **Plano de Desacoplamento do Monólito:** Substituição faseada dos 160 KB de `LiveCameraCapture.js` pelos novos componentes modulares e desacoplados (`VideoPlayerVLC`, `BiomechanicalOverlayCanvas`, `TelemetrySyncChart`, `BiomechanicalStatsDashboard`).

---

## 2. DEPENDÊNCIAS FRONTEND A INSTALAR
No diretório `frontend/mediapipe`:
```bash
npm install pinia
```
Em `frontend/mediapipe/src/main.js`:
```javascript
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
```

---

## 3. STORE PINIA DE INFERÊNCIA (`src/stores/inferenceStore.js`)

Cria `frontend/mediapipe/src/stores/inferenceStore.js`:

```javascript
/**
 * Pinia Store central para gestão de telemetria e ligação ao backend Python.
 */
import { defineStore } from 'pinia';
import axios from 'axios';

const API_BASE = process.env.VUE_APP_API_URL || 'http://localhost:8000';
const WS_BASE = process.env.VUE_APP_WS_URL || 'ws://localhost:8000';

export const useInferenceStore = defineStore('inference', {
  state: () => ({
    activeEngine: 'mediapipe',
    activeSide: 'right', // 'left' | 'right'
    availableEngines: [],
    directmlAvailable: false,
    
    // Estado da ligação WebSocket
    wsStatus: 'disconnected', // 'connected' | 'connecting' | 'disconnected' | 'error'
    wsSocket: null,
    
    // Telemetria do último frame
    latestTelemetry: {
      timestamp_ms: 0,
      landmarks: {},
      angles: { knee: null, torso: null, arm_elbow: null, shoulder: null, ankle: null },
      validation: { femur_valid: true, tibia_valid: true },
      is_bdc: false,
      is_tdc: false,
    },
    
    // Histórico de amostras para o gráfico temporal
    telemetrySamples: [],
  }),

  actions: {
    async fetchEngines() {
      try {
        const res = await axios.get(`${API_BASE}/api/v1/inference/engines`);
        this.availableEngines = res.data.available_engines;
        this.activeEngine = res.data.active_engine;
        this.activeSide = res.data.active_side;
        this.directmlAvailable = res.data.directml_available;
      } catch (err) {
        console.error('Falha ao carregar lista de motores:', err);
      }
    },

    async switchEngine(engineName, side = null) {
      const targetSide = side || this.activeSide;
      try {
        const res = await axios.post(`${API_BASE}/api/v1/inference/engine/switch`, {
          engine: engineName,
          side: targetSide,
          smoothing: 'one_euro',
        });
        this.activeEngine = res.data.active_engine;
        this.activeSide = res.data.active_side;
        this.telemetrySamples = []; // Reiniciar gráfico
      } catch (err) {
        console.error('Falha ao alternar motor de inferência:', err);
      }
    },

    setSide(side) {
      this.activeSide = side;
      if (this.wsSocket && this.wsSocket.readyState === WebSocket.OPEN) {
        this.wsSocket.send(JSON.stringify({ type: 'set_side', side }));
      }
    },

    connectWebSocket() {
      if (this.wsSocket) {
        this.wsSocket.close();
      }

      this.wsStatus = 'connecting';
      const wsUrl = `${WS_BASE}/ws/live-inference`;
      this.wsSocket = new WebSocket(wsUrl);
      this.wsSocket.binaryType = 'arraybuffer';

      this.wsSocket.onopen = () => {
        this.wsStatus = 'connected';
        console.log('[WebSocket] Conectado ao pipeline Python.');
      };

      this.wsSocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.latestTelemetry = data;

          // Adicionar amostra ao histórico do gráfico
          if (data.angles && data.timestamp_ms !== undefined) {
            const timeSec = data.timestamp_ms / 1000.0;
            this.telemetrySamples.push({
              time: Number(timeSec.toFixed(3)),
              knee: data.angles.knee,
              torso: data.angles.torso,
              arm: data.angles.arm_elbow,
            });

            // Limitar histórico a 600 amostras (aprox. 20s a 30 FPS)
            if (this.telemetrySamples.length > 600) {
              this.telemetrySamples.shift();
            }
          }
        } catch (e) {
          console.warn('[WebSocket] Mensagem inválida recebida:', e);
        }
      };

      this.wsSocket.onclose = () => {
        this.wsStatus = 'disconnected';
        console.log('[WebSocket] Desconectado. Tentando reconexão em 3s...');
        setTimeout(() => {
          if (this.wsStatus === 'disconnected') {
            this.connectWebSocket();
          }
        }, 3000);
      };

      this.wsSocket.onerror = (err) => {
        this.wsStatus = 'error';
        console.error('[WebSocket] Erro de comunicação:', err);
      };
    },

    disconnectWebSocket() {
      if (this.wsSocket) {
        this.wsSocket.close();
        this.wsSocket = null;
      }
      this.wsStatus = 'disconnected';
    },

    /**
     * Envia um frame codificado para o backend com cabeçalho de timestamp em microssegundos.
     * @param {Blob} jpegBlob - Imagem comprimida em JPEG
     * @param {number} timestampMs - Timestamp do frame no vídeo
     */
    async sendFrame(jpegBlob, timestampMs) {
      if (!this.wsSocket || this.wsSocket.readyState !== WebSocket.OPEN) return;

      const arrayBuffer = await jpegBlob.arrayBuffer();
      const packet = new Uint8Array(4 + arrayBuffer.byteLength);

      // Cabeçalho: 4 bytes uint32 big-endian
      const view = new DataView(packet.buffer);
      view.setUint32(0, Math.floor(timestampMs), false);

      // Payload JPEG
      packet.set(new Uint8Array(arrayBuffer), 4);

      this.wsSocket.send(packet.buffer);
    },
  },
});
```

---

## 4. PLANO DE DESMANTELAMENTO DO MONÓLITO (`LiveCameraCapture.js`)

A refatoração do componente monólito de 160 KB será executada em 5 etapas atómicas sem quebrar o sistema:

```
[ ETAPA 1 ] Extração da Infraestrutura
  - Instalar Pinia.
  - Criar `src/stores/inferenceStore.js`.
  - Iniciar WebSocket em segundo plano no `main.js`.

[ ETAPA 2 ] Implementação dos Componentes Modulares
  - Montar `VideoPlayerVLC.vue` com File API.
  - Montar `BiomechanicalOverlayCanvas.vue`.
  - Montar `TelemetrySyncChart.vue` com ECharts.
  - Montar `BiomechanicalStatsDashboard.vue`.

[ ETAPA 3 ] Integração na Vista Principal (`HomeView.vue`)
  - Substituir a chamada direta ao monólito pela composição limpa:
    <div class="analysis-workbench">
      <VideoPlayerVLC>
        <template #default="{ currentTime, videoElement }">
          <BiomechanicalOverlayCanvas
            :landmarks="inferenceStore.latestTelemetry.landmarks"
            :angles="inferenceStore.latestTelemetry.angles"
            :timestampMs="currentTime * 1000"
          />
        </template>
      </VideoPlayerVLC>
      <TelemetrySyncChart
        :samples="inferenceStore.telemetrySamples"
        :currentTime="videoCurrentTime"
        :duration="videoDuration"
        @seek="seekVideo"
      />
      <BiomechanicalStatsDashboard :samples="inferenceStore.telemetrySamples" />
    </div>

[ ETAPA 4 ] Remoção dos Ficheiros Obsoletos
  - Isolar módulos legados em `modules/legacy/` e apagar `LiveCameraCapture.js` e `LiveCameraCapture.html` após todos os testes passarem.

[ ETAPA 5 ] Verificação e Testes de Regressão
  - Executar suite completa de verificação frontend: `npm run verify`.
```

---

## 5. MATRIZ DE TESTES E ACEITAÇÃO FINAL

| Módulo | Teste de Aceitação | Critério de Sucesso |
|---|---|---|
| **DirectML** | `python scripts/verify_directml_hardware.py` | `DmlExecutionProvider` ativo na GPU AMD RX 580 com latência < 25 ms. |
| **Strategy** | `pytest tests/unit/test_mediapipe_engine.py` | MediaPipe com `complexity=2` e validação rígida de fémur/tíbia aprovados. |
| **REST API** | `POST /api/v1/inference/engine/switch` | Troca em runtime entre MediaPipe e YOLO11 sem reiniciar o processo. |
| **WebSocket** | Streaming contínuo a 30 FPS | Pacotes de telemetria recebidos com `is_bdc` sincronizado e latência < 33 ms. |
| **Leitor VLC** | Upload de vídeo MP4 1080p | Reprodução nativa sem re-encoding, ciclo contínuo A-B e avanço frame a frame. |
| **Overlay** | Canvas sobreposto | Motion trail da órbita do pé renderizado com fade suave de 3.5s. |
| **Gráfico** | Curva do joelho no ECharts | Faixa verde 145°-155° no BDC destacada com linha vertical vermelha síncrona. |
| **Dashboard** | Cálculo de cadência e BDC | Diagnóstico "Subir Selim" / "100% OK" calculado e exibido em tempo real. |
