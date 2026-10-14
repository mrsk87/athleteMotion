/**
 * Pinia Store central para gestão de telemetria e ligação ao backend Python (R16 / R04 / R10 / R13).
 */
import { defineStore } from 'pinia';
import { apiClient } from '../services/api';
import { authToken } from '../services/authToken';

const WS_BASE = process.env.VUE_APP_WS_URL || 'ws://localhost:8000';

export const useInferenceStore = defineStore('inference', {
  state: () => ({
    activeEngine: 'mediapipe',
    activeSide: 'right', // 'left' | 'right'
    availableEngines: [],
    directmlAvailable: false,

    // Resultado do último aquecimento do motor ativo (ms).
    lastWarmupMs: null,

    // Estado da ligação WebSocket
    wsStatus: 'disconnected', // 'connected' | 'connecting' | 'disconnected' | 'error'
    wsSocket: null,
    _reconnectAttempts: 0,
    _reconnectTimer: null,

    // Telemetria do último frame (com campos R10/R11/R13)
    latestTelemetry: {
      timestamp_ms: 0,
      landmarks: {},
      angles: { knee: null, torso: null, arm_elbow: null, shoulder: null, ankle: null },
      validation: { femur_valid: true, tibia_valid: true },
      is_bdc: false,
      is_tdc: false,
      cycle: null, // Objeto de ciclo pedalada R10
      confidence: 1.0,
      withheld: false,
      warnings: [],
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
        const res = await apiClient.get('/api/v1/inference/engines');
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
        const res = await apiClient.post('/api/v1/inference/engine/switch', {
          engine: engineName,
          side: targetSide,
          smoothing: 'one_euro',
        });
        this.activeEngine = res.data.active_engine;
        this.activeSide = res.data.active_side;
        this.telemetrySamples = []; // Reiniciar gráfico
        await this.warmupEngine();
      } catch (err) {
        console.error('Falha ao alternar motor de inferência:', err);
      }
    },

    async warmupEngine() {
      try {
        const res = await apiClient.post('/api/v1/inference/engine/warmup');
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
        this.wsSocket = null;
      }

      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }

      this.wsStatus = 'connecting';
      const rawUrl = `${WS_BASE}/ws/live-inference`;
      const secureWsUrl = authToken.buildWsUrl(rawUrl);

      try {
        this.wsSocket = new WebSocket(secureWsUrl);
        this.wsSocket.binaryType = 'arraybuffer';
      } catch (err) {
        this.wsStatus = 'error';
        console.error('[WebSocket] Falha na instanciação do socket:', err);
        this._scheduleReconnect();
        return;
      }

      this.wsSocket.onopen = () => {
        this.wsStatus = 'connected';
        this._reconnectAttempts = 0;
        // Enviar handshake de autenticação e warmup
        if (authToken.hasToken()) {
          this.wsSocket.send(JSON.stringify({ type: 'auth', token: authToken.getToken() }));
        }
        this.wsSocket.send(JSON.stringify({ type: 'warmup' }));
        console.log('[WebSocket] Conectado e autenticado no pipeline Python.');
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
              ankle: data.angles.ankle,
              shoulder: data.angles.shoulder,
              isBdc: Boolean(data.is_bdc),
              isTdc: Boolean(data.is_tdc),
              clock: data.clock_position || null,
              cycle: data.cycle || null,
              confidence: data.confidence ?? 1.0,
              withheld: Boolean(data.withheld),
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

      this.wsSocket.onclose = (event) => {
        this.wsStatus = 'disconnected';
        if (event.code === 1008 || event.code === 4401) {
          // Fecho por falta de autorização
          authToken.notifyUnauthorized({ code: event.code, reason: event.reason });
          return;
        }
        this._scheduleReconnect();
      };

      this.wsSocket.onerror = (err) => {
        this.wsStatus = 'error';
        console.error('[WebSocket] Erro de comunicação:', err);
      };
    },

    _scheduleReconnect() {
      this._reconnectAttempts += 1;
      // Backoff exponencial: 1s, 2s, 4s, até máx 10s
      const delay = Math.min(10000, 1000 * Math.pow(2, Math.min(this._reconnectAttempts - 1, 3)));
      console.log(`[WebSocket] Tentando reconexão em ${delay}ms (tentativa ${this._reconnectAttempts})...`);
      this._reconnectTimer = setTimeout(() => {
        if (this.wsStatus === 'disconnected' || this.wsStatus === 'error') {
          this.connectWebSocket();
        }
      }, delay);
    },

    disconnectWebSocket() {
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
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
