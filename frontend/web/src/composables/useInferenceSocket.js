/**
 * Composable para Comunicação em Tempo Real com o Pipeline Python (R16 / Performance).
 *
 * Princípios de Desempenho:
 * - Padrão Latest-Frame-Wins: se um fotograma já estiver em voo no WebSocket, não empilha fotogramas
 *   pendentes na memória; descarta fotogramas intermédios para manter latência < 30 ms.
 * - Cálculo em tempo real de latência de ida-e-volta (RTT) e FPS efetivo de inferência.
 */

import { ref, computed } from 'vue';
import { useInferenceStore } from '../stores/inferenceStore';

export function useInferenceSocket() {
  const store = useInferenceStore();

  const isSendingFrame = ref(false);
  const droppedFramesCount = ref(0);
  const sentFramesCount = ref(0);
  const roundTripLatencyMs = ref(0);
  const measuredFps = ref(0);

  let frameCountWindow = 0;
  let fpsTimer = null;

  const connectionStatus = computed(() => store.wsStatus);
  const isConnected = computed(() => store.wsStatus === 'connected');
  const activeEngine = computed(() => store.activeEngine);
  const latestTelemetry = computed(() => store.latestTelemetry);

  /**
   * Conecta ao WebSocket do backend Python.
   */
  function connect() {
    store.connectWebSocket();

    if (!fpsTimer) {
      fpsTimer = setInterval(() => {
        measuredFps.value = frameCountWindow;
        frameCountWindow = 0;
      }, 1000);
    }
  }

  /**
   * Desconecta do WebSocket.
   */
  function disconnect() {
    if (fpsTimer) {
      clearInterval(fpsTimer);
      fpsTimer = null;
    }
    store.disconnectWebSocket();
  }

  /**
   * Envia um frame comprimido respeitando a política latest-frame-wins.
   * @param {Blob} jpegBlob
   * @param {number} timestampMs
   * @returns {Promise<boolean>} Devolve true se enviado, false se descartado (em voo)
   */
  async function dispatchFrame(jpegBlob, timestampMs) {
    if (!isConnected.value) {
      return false;
    }

    // Se já existe um fotograma em voo, descarta este para evitar atraso acumulado
    if (isSendingFrame.value) {
      droppedFramesCount.value += 1;
      return false;
    }

    isSendingFrame.value = true;
    const startSendTime = performance.now();

    try {
      await store.sendFrame(jpegBlob, timestampMs);
      sentFramesCount.value += 1;
      frameCountWindow += 1;

      const duration = performance.now() - startSendTime;
      roundTripLatencyMs.value = Math.round(duration * 10) / 10;
      return true;
    } catch (err) {
      console.warn('[useInferenceSocket] Erro ao enviar fotograma:', err);
      return false;
    } finally {
      isSendingFrame.value = false;
    }
  }

  return {
    connectionStatus,
    isConnected,
    activeEngine,
    latestTelemetry,
    roundTripLatencyMs,
    measuredFps,
    droppedFramesCount,
    sentFramesCount,
    connect,
    disconnect,
    dispatchFrame,
    onFrameTelemetry: (cb) => store.onFrameTelemetry(cb),
  };
}

export default useInferenceSocket;
