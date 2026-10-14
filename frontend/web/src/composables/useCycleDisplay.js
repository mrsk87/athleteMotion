/**
 * Composable para Apresentação Visual da Cinemática de Pedalada (R16 / R10).
 *
 * Responsabilidades:
 * - Interpretar os eventos em tempo real emitidos pelo detetor de ciclos do backend (R10).
 * - Fornecer dados formatados para o mostrador analógico de horas (1h–12h) e fases da pedalada.
 * - Indicar quando a cadência e alinhamento de BDC/TDC têm confiança estatística válida.
 */

import { ref, computed } from 'vue';

export function useCycleDisplay() {
  const currentClock = ref(null);
  const isBdc = ref(false);
  const isTdc = ref(false);
  const cadenceRpm = ref(null);
  const cadenceConfidence = ref(1.0);
  const kneeRomDeg = ref(null);
  const pedalingPhase = ref('unknown'); // 'power' (1h–5h) | 'bottom_dead' (6h) | 'recovery' (7h–11h) | 'top_dead' (12h)

  /**
   * Atualiza o estado da pedalada a partir da telemetria recebida do backend.
   * @param {Object} telemetry Pacote de telemetria de frame
   */
  function updateFromTelemetry(telemetry) {
    if (!telemetry) return;

    isBdc.value = Boolean(telemetry.is_bdc);
    isTdc.value = Boolean(telemetry.is_tdc);
    currentClock.value = telemetry.clock_position || null;

    if (telemetry.cycle) {
      cadenceRpm.value = telemetry.cycle.cadence_rpm ? Math.round(telemetry.cycle.cadence_rpm) : null;
      cadenceConfidence.value = telemetry.cycle.periodicity_confidence ?? 1.0;
      kneeRomDeg.value = telemetry.cycle.knee_rom_deg ? Math.round(telemetry.cycle.knee_rom_deg * 10) / 10 : null;
    }

    // Identificação de fase biomecânica
    if (isBdc.value) {
      pedalingPhase.value = 'bottom_dead';
    } else if (isTdc.value) {
      pedalingPhase.value = 'top_dead';
    } else if (typeof currentClock.value === 'number') {
      const h = currentClock.value;
      if (h >= 1 && h <= 5) {
        pedalingPhase.value = 'power';
      } else if (h >= 7 && h <= 11) {
        pedalingPhase.value = 'recovery';
      }
    }
  }

  const phaseLabel = computed(() => {
    switch (pedalingPhase.value) {
      case 'bottom_dead':
        return 'Ponto Morto Inferior (BDC - 6h)';
      case 'top_dead':
        return 'Ponto Morto Superior (TDC - 12h)';
      case 'power':
        return 'Fase de Potência (1h–5h)';
      case 'recovery':
        return 'Fase de Recuperação (7h–11h)';
      default:
        return 'Pedalada em Análise';
    }
  });

  const isCadenceReliable = computed(() => {
    return cadenceRpm.value !== null && cadenceConfidence.value >= 0.65;
  });

  return {
    currentClock,
    isBdc,
    isTdc,
    cadenceRpm,
    cadenceConfidence,
    kneeRomDeg,
    pedalingPhase,
    phaseLabel,
    isCadenceReliable,
    updateFromTelemetry,
  };
}

export default useCycleDisplay;
