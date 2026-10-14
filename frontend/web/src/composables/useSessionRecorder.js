/**
 * Composable para Gravação de Sessões, Captura de Snapshots e Conclusão ACID (R16 / R08).
 *
 * Responsabilidades:
 * - Gerir o ciclo de vida da sessão (start -> capturing -> completing -> completed).
 * - Armazenar snapshots localmente e enviar ao backend (online direto ou enfileirado no syncQueue).
 * - Suportar agregação de lote (batch snapshots) para reduzir overhead de rede.
 */

import { ref, computed } from 'vue';
import { apiService } from '../services/api';
import { syncQueue } from '../services/syncQueue';

export function useSessionRecorder() {
  const currentSessionId = ref(null);
  const isRecording = ref(false);
  const snapshots = ref([]);
  const sessionStatus = ref('idle'); // 'idle' | 'in_progress' | 'completing' | 'completed' | 'error'
  const sessionError = ref(null);

  const snapshotCount = computed(() => snapshots.value.length);

  /**
   * Inicia uma nova sessão de bike fit.
   * @param {string} athleteId
   * @param {string} bikeId
   * @returns {Promise<Object>}
   */
  async function startSession(athleteId, bikeId) {
    sessionError.value = null;
    snapshots.value = [];

    try {
      const session = await apiService.startFitSession(athleteId, bikeId);
      currentSessionId.value = session.id;
      isRecording.value = true;
      sessionStatus.value = 'in_progress';
      return session;
    } catch (err) {
      console.error('[useSessionRecorder] Falha ao iniciar sessão:', err);
      sessionError.value = err.message || 'Erro ao iniciar sessão';
      sessionStatus.value = 'error';
      throw err;
    }
  }

  /**
   * Regista um snapshot com a telemetria do instante atual.
   * @param {Object} telemetry Dados de ângulos, marcos e BDC
   * @param {string} [stage='dynamic'] 'bdc_6h' | 'noventa_3h' | 'dynamic'
   * @returns {Promise<Object>}
   */
  async function captureSnapshot(telemetry, stage = 'dynamic') {
    if (!currentSessionId.value) {
      throw new Error('Nenhuma sessão ativa para gravar snapshot.');
    }

    const snapshotData = {
      sessionId: currentSessionId.value,
      timestamp: new Date().toISOString(),
      stage,
      angles: telemetry?.angles || {},
      is_bdc: Boolean(telemetry?.is_bdc),
      is_tdc: Boolean(telemetry?.is_tdc),
      cycle: telemetry?.cycle || null,
      confidence: telemetry?.confidence ?? 1.0,
      withheld: Boolean(telemetry?.withheld),
    };

    snapshots.value.push(snapshotData);

    // Enviar via apiService (se falhar, o apiService já enfileira em syncQueue de forma transparente)
    const result = await apiService.recordSnapshot(currentSessionId.value, snapshotData);
    return result;
  }

  /**
   * Conclui a sessão e obtém o relatório consolidado.
   * @returns {Promise<Object>} Relatório da sessão
   */
  async function completeSession() {
    if (!currentSessionId.value) {
      throw new Error('Nenhuma sessão para concluir.');
    }

    sessionStatus.value = 'completing';
    try {
      const report = await apiService.completeFitSession(currentSessionId.value);
      isRecording.value = false;
      sessionStatus.value = 'completed';
      return report;
    } catch (err) {
      console.warn('[useSessionRecorder] Conclusão delegada à fila offline:', err.message);
      await syncQueue.enqueue('session_complete', { sessionId: currentSessionId.value });
      isRecording.value = false;
      sessionStatus.value = 'completed_offline';
      return { id: currentSessionId.value, status: 'completed_offline' };
    }
  }

  return {
    currentSessionId,
    isRecording,
    snapshots,
    snapshotCount,
    sessionStatus,
    sessionError,
    startSession,
    captureSnapshot,
    completeSession,
  };
}

export default useSessionRecorder;
