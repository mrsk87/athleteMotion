<template>
  <div class="stats-dashboard-grid">
    <!-- Card 1: Cadência -->
    <div class="stat-card">
      <div class="stat-icon">🔄</div>
      <div class="stat-content">
        <span class="stat-label">Cadência Estimada</span>
        <span class="stat-value">{{ cadenceRpm }} <small>RPM</small></span>
        <span class="stat-sub">Calculada pelos ciclos do joelho</span>
      </div>
    </div>

    <!-- Card 2: BDC Médio -->
    <div class="stat-card">
      <div class="stat-icon">📐</div>
      <div class="stat-content">
        <span class="stat-label">BDC Médio (Extensão)</span>
        <span class="stat-value" :class="bdcClass">{{ avgBdcDegrees }}°</span>
        <span class="stat-sub">Alvo: 145° a 155°</span>
      </div>
    </div>

    <!-- Card 3: Oscilação do Tronco -->
    <div class="stat-card">
      <div class="stat-icon">⚖️</div>
      <div class="stat-content">
        <span class="stat-label">Oscilação do Tronco</span>
        <span class="stat-value">{{ torsoOscillation }}°</span>
        <span class="stat-sub">Variação dinâmica na pedalada</span>
      </div>
    </div>

    <!-- Card 4: Diagnóstico Postural Imediato -->
    <div class="stat-card diagnostic-card" :class="diagnosticTheme">
      <div class="stat-icon">{{ diagnosticIcon }}</div>
      <div class="stat-content">
        <span class="stat-label">Diagnóstico Postural</span>
        <span class="stat-value diag-status">{{ diagnosticTitle }}</span>
        <span class="stat-sub diag-desc">{{ diagnosticAdvice }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  samples: {
    type: Array,
    default: () => [],
  },
});

// Cadência via deteção de picos de extensão no joelho
const cadenceRpm = computed(() => {
  if (props.samples.length < 30) return '--';
  const knees = props.samples.map((s) => s.knee).filter(Boolean);
  if (knees.length < 10) return '--';

  let peaks = 0;
  for (let i = 1; i < knees.length - 1; i++) {
    if (knees[i] > 140 && knees[i] > knees[i - 1] && knees[i] > knees[i + 1]) {
      peaks++;
    }
  }

  const durationSec = props.samples[props.samples.length - 1].time - props.samples[0].time;
  if (durationSec <= 2) return '--';
  const rpm = Math.round((peaks / durationSec) * 60);
  return rpm > 30 && rpm < 150 ? rpm : '--';
});

// BDC Médio
const avgBdcDegrees = computed(() => {
  const peaks = [];
  const knees = props.samples.map((s) => s.knee).filter(Boolean);
  for (let i = 1; i < knees.length - 1; i++) {
    if (knees[i] > 135 && knees[i] > knees[i - 1] && knees[i] > knees[i + 1]) {
      peaks.push(knees[i]);
    }
  }
  if (!peaks.length) return '--';
  const avg = peaks.reduce((a, b) => a + b, 0) / peaks.length;
  return avg.toFixed(1);
});

// Oscilação do Tronco
const torsoOscillation = computed(() => {
  const torsos = props.samples.map((s) => s.torso).filter(Boolean);
  if (torsos.length < 10) return '--';
  const min = Math.min(...torsos);
  const max = Math.max(...torsos);
  return (max - min).toFixed(1);
});

// Regras de Diagnóstico Holmes/Pruitt
const bdcVal = computed(() => parseFloat(avgBdcDegrees.value) || 0);

const diagnosticTheme = computed(() => {
  if (!bdcVal.value) return 'theme-neutral';
  if (bdcVal.value >= 145 && bdcVal.value <= 155) return 'theme-success';
  return 'theme-warning';
});

const diagnosticIcon = computed(() => {
  if (!bdcVal.value) return 'ℹ️';
  if (bdcVal.value >= 145 && bdcVal.value <= 155) return '✅';
  if (bdcVal.value < 145) return '⬆️';
  return '⬇️';
});

const diagnosticTitle = computed(() => {
  if (!bdcVal.value) return 'A aguardar pedaladas...';
  if (bdcVal.value >= 145 && bdcVal.value <= 155) return '100% OK';
  if (bdcVal.value < 145) return 'Subir Selim (+1 a 2 cm)';
  return 'Baixar Selim (-1 a 2 cm)';
});

const diagnosticAdvice = computed(() => {
  if (!bdcVal.value) return 'Pedale continuamente para calcular média.';
  if (bdcVal.value >= 145 && bdcVal.value <= 155) return 'Extensão excelente no BDC. Menor risco articular.';
  if (bdcVal.value < 145) return 'Ângulo muito fechado no ponto inferior. Sobrecarga patelar.';
  return 'Hiper-extensão do joelho detetada. Risco de tensão poplítea.';
});

const bdcClass = computed(() => {
  if (!bdcVal.value) return '';
  return bdcVal.value >= 145 && bdcVal.value <= 155 ? 'text-ok' : 'text-warn';
});
</script>

<style scoped>
.stats-dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-top: 10px;
}
.stat-card {
  background-color: var(--bg-surface-2, #18181b);
  border: 1px solid var(--border-subtle, #27272a);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.stat-icon {
  font-size: 24px;
}
.stat-content {
  display: flex;
  flex-direction: column;
}
.stat-label {
  font-size: 11px;
  color: #a1a1aa;
  text-transform: uppercase;
  font-weight: 600;
}
.stat-value {
  font-size: 20px;
  font-weight: 800;
  color: #fff;
  font-family: monospace;
}
.stat-sub {
  font-size: 11px;
  color: #71717a;
}
.text-ok { color: #10b981; }
.text-warn { color: #f59e0b; }
.diagnostic-card.theme-success {
  border-color: #10b981;
  background-color: rgba(16, 185, 129, 0.08);
}
.diagnostic-card.theme-warning {
  border-color: #f59e0b;
  background-color: rgba(245, 158, 11, 0.08);
}
.diag-status {
  font-size: 15px;
}
</style>
