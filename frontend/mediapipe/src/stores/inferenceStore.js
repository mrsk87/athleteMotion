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

    // Resultado do último aquecimento do motor ativo (ms). Pagar o arranque do
    // DirectML/MediaPipe aqui evita que ele caia no primeiro fotograma do atleta.
    lastWarmupMs: null,

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

    // Listeners para receção de telemetria de frame
    _frameListeners: [],
  }),

  actions: {
    /**
     * Regista um callback para ser invocado a cada pacote de telemetria recebido.
     * Devolve uma função de limpeza (unsubscribe).
     */
    onFrameTelemetry(callback) {
      this._frameListeners.push(callback);
      return () => {
        this._frameListeners = this._frameListeners.filter((cb) => cb !== callback);
      };
    },
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
        // Aquecer JÁ o motor novo: o primeiro fotograma do atleta não deve pagar o arranque.
        await this.warmupEngine();
      } catch (err) {
        console.error('Falha ao alternar motor de inferência:', err);
      }
    },

    /**
     * Pede ao backend a primeira inferência do motor ativo (fora do caminho crítico).
     * Devolve o tempo gasto, ou `null` se o backend não estiver acessível.
     */
    async warmupEngine() {
      try {
        const res = await axios.post(`${API_BASE}/api/v1/inference/engine/warmup`);
        this.lastWarmupMs = res.data.warmup_ms ?? null;
        return this.lastWarmupMs;
      } catch (err) {
        console.warn('Aquecimento do motor indisponível:', err.message);
        return null;
      }
    },

    clearTelemetry() {
      this.telemetrySamples = [];
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
        // O backend já aquece o motor ao aceitar a ligação; este pedido confirma o
        // tempo gasto e serve de referência nos diagnósticos.
        this.wsSocket.send(JSON.stringify({ type: 'warmup' }));
        console.log('[WebSocket] Conectado ao pipeline Python.');
      };

      this.wsSocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.latestTelemetry = data;

          // Notificar listeners registados
          for (const listener of this._frameListeners) {
            try {
              listener(data);
            } catch (err) {
              console.warn('[inferenceStore] Erro no listener de frame:', err);
            }
          }

          // Adicionar amostra ao histórico do gráfico
          if (data.angles && data.timestamp_ms !== undefined) {
            const timeSec = data.timestamp_ms / 1000.0;
            this.telemetrySamples.push({
              time: Number(timeSec.toFixed(3)),
              knee: data.angles.knee,
              torso: data.angles.torso,
              arm: data.angles.arm_elbow,
              // Campos extra para o relatório da bancada: o tornozelo e a posição do cranque dizem
              // se a amostra foi recolhida no ponto morto inferior (BDC), que é onde a altura do
              // selim se mede. Não alteram o gráfico, que continua a usar tempo/joelho/tronco/braço.
              ankle: data.angles.ankle,
              shoulder: data.angles.shoulder,
              isBdc: Boolean(data.is_bdc),
              isTdc: Boolean(data.is_tdc),
              clock: data.clock_position || null,
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

    /**
     * Envia um frame e aguarda pela resposta de telemetria correspondente.
     * @param {Blob} jpegBlob - Imagem comprimida em JPEG
     * @param {number} timestampMs - Timestamp do frame
     * @param {number} timeoutMs - Tempo máximo de espera em ms
     * @returns {Promise<Object|null>} Telemetria devolvida pelo backend
     */
    async sendFrameAndAwait(jpegBlob, timestampMs, timeoutMs = 1200) {
      if (!this.wsSocket || this.wsSocket.readyState !== WebSocket.OPEN) return null;

      return new Promise((resolve) => {
        let timer = null;
        const unsubscribe = this.onFrameTelemetry((data) => {
          if (timer) clearTimeout(timer);
          unsubscribe();
          resolve(data);
        });

        timer = setTimeout(() => {
          unsubscribe();
          resolve(null);
        }, timeoutMs);

        this.sendFrame(jpegBlob, timestampMs).catch(() => {
          if (timer) clearTimeout(timer);
          unsubscribe();
          resolve(null);
        });
      });
    },
  },
});
