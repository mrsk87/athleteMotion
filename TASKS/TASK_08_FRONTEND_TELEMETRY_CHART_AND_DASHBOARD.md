# TAREFA 08: TELEMETRIA BIOMECÂNICA, GRÁFICO SINCRONIZADO & DASHBOARD

> **Identificador:** `TASK_08_FRONTEND_TELEMETRY_CHART_AND_DASHBOARD`  
> **Prioridade:** P0 (Telemetria & Diagnóstico)  
> **Responsabilidade:** Criar o gráfico temporal sincronizado em Vue 3 (ECharts ou Chart.js) com faixa-alvo de 145°-155° no BDC a tracejado verde, cursor vertical vermelho móvel e o dashboard estatístico inferior (Cadência, BDC médio, oscilação de tronco e caixa de diagnóstico postural).

---

## 1. OBJETIVO DA TAREFA
1. **Gráfico Temporal Sincronizado:** Apresentar a evolução angular (joelho, tronco, braço, cabeça) ao longo do tempo do vídeo. Uma **linha vertical vermelha móvel** atua como agulha de tempo que acompanha exatamente o frame em reprodução. A **faixa-alvo do joelho (145° a 155°)** é realçada com tracejado verde.
2. **Dashboard de Cartões Estatísticos:** Calcular e exibir em tempo real:
   - **Cadência (RPM):** Deteção de ciclos baseada em vales e picos da curva do joelho.
   - **BDC Médio:** Extensão máxima média do joelho no ponto morto inferior.
   - **Oscilação do Tronco:** Variação máxima angular (estabilidade pélvica).
   - **Caixa de Diagnóstico:** Recomendações instantâneas ("Subir Selim", "Baixar Selim", "100% OK").

---

## 2. DEPENDÊNCIAS FRONTEND A INSTALAR
No diretório `frontend/mediapipe`:
```bash
npm install echarts vue-echarts
```

---

## 3. FICHEIROS A CRIAR

1. `frontend/mediapipe/src/components/telemetry/TelemetrySyncChart.vue` (Componente de gráfico sincronizado)
2. `frontend/mediapipe/src/components/telemetry/BiomechanicalStatsDashboard.vue` (Dashboard de estatísticas e cartões)
3. `frontend/mediapipe/src/composables/useCadenceAndDiagnostics.js` (Lógica matemática de análise de ciclos e prescrição)

---

## 4. COMPONENTE DE GRÁFICO TEMPORAL SINCRONIZADO (`TelemetrySyncChart.vue`)

Cria `frontend/mediapipe/src/components/telemetry/TelemetrySyncChart.vue`:

```html
<template>
  <div class="chart-wrapper">
    <div class="chart-header">
      <span class="chart-title">Evolução Angular Sincronizada</span>
      <div class="legend-badges">
        <span class="badge badge-knee">● Joelho</span>
        <span class="badge badge-target">--- Alvo BDC (145°-155°)</span>
        <span class="badge badge-torso">● Tronco</span>
        <span class="badge badge-arm">● Braço</span>
      </div>
    </div>
    <div ref="chartContainer" class="echarts-dom"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as echarts from 'echarts';

const props = defineProps({
  samples: {
    type: Array, // [{ time: 1.2, knee: 148, torso: 44, arm: 156 }, ...]
    default: () => [],
  },
  currentTime: {
    type: Number,
    default: 0,
  },
  duration: {
    type: Number,
    default: 10,
  },
});

const emit = defineEmits(['seek']);
const chartContainer = ref(null);
let chartInstance = null;

const initChart = () => {
  if (!chartContainer.value) return;
  chartInstance = echarts.init(chartContainer.value, 'dark');

  // Clique no gráfico para saltar no vídeo
  chartInstance.on('click', (params) => {
    if (params.data && params.data[0] !== undefined) {
      emit('seek', params.data[0]);
    }
  });

  updateChart();
};

const updateChart = () => {
  if (!chartInstance) return;

  const kneeData = props.samples.map((s) => [s.time, s.knee]);
  const torsoData = props.samples.map((s) => [s.time, s.torso]);
  const armData = props.samples.map((s) => [s.time, s.arm]);

  const option = {
    backgroundColor: '#18181b',
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
    },
    grid: {
      left: 50,
      right: 20,
      top: 30,
      bottom: 30,
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: props.duration || 10,
      axisLabel: {
        formatter: (val) => `${val.toFixed(1)}s`,
        color: '#a1a1aa',
      },
      splitLine: { lineStyle: { color: '#27272a' } },
    },
    yAxis: {
      type: 'value',
      min: 30,
      max: 180,
      interval: 30,
      axisLabel: {
        formatter: '{value}°',
        color: '#a1a1aa',
      },
      splitLine: { lineStyle: { color: '#27272a' } },
    },
    series: [
      {
        name: 'Joelho',
        type: 'line',
        data: kneeData,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: '#10b981', width: 2.5 },
        markArea: {
          silent: true,
          data: [
            [
              {
                name: 'Faixa Alvo BDC',
                yAxis: 145,
                itemStyle: { color: 'rgba(16, 185, 129, 0.12)' },
              },
              { yAxis: 155 },
            ],
          ],
        },
        markLine: {
          symbol: 'none',
          silent: true,
          data: [
            // Limiares Alvo a tracejado verde
            { yAxis: 145, lineStyle: { color: '#10b981', type: 'dashed', width: 1.5 } },
            { yAxis: 155, lineStyle: { color: '#10b981', type: 'dashed', width: 1.5 } },
            // CURSOR VERTICAL VERMELHO MÓVEL
            {
              xAxis: props.currentTime,
              lineStyle: { color: '#ef4444', width: 2, type: 'solid' },
              label: {
                formatter: `t = ${props.currentTime.toFixed(2)}s`,
                color: '#ef4444',
                position: 'end',
              },
            },
          ],
        },
      },
      {
        name: 'Tronco',
        type: 'line',
        data: torsoData,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: '#38bdf8', width: 2 },
      },
      {
        name: 'Braço',
        type: 'line',
        data: armData,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: '#c084fc', width: 1.5 },
      },
    ],
  };

  chartInstance.setOption(option);
};

watch(() => [props.samples, props.currentTime, props.duration], updateChart, { deep: true });

onMounted(() => {
  initChart();
  window.addEventListener('resize', () => chartInstance?.resize());
});

onBeforeUnmount(() => {
  if (chartInstance) chartInstance.dispose();
});
</script>

<style scoped>
.chart-wrapper {
  background-color: var(--bg-surface-2, #18181b);
  border: 1px solid var(--border-subtle, #27272a);
  border-radius: 8px;
  padding: 12px;
}
.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.chart-title {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
}
.legend-badges {
  display: flex;
  gap: 10px;
  font-size: 11px;
}
.badge-knee { color: #10b981; }
.badge-target { color: #34d399; font-weight: 600; }
.badge-torso { color: #38bdf8; }
.badge-arm { color: #c084fc; }
.echarts-dom {
  width: 100%;
  height: 220px;
}
</style>
```

---

## 5. DASHBOARD DE CARTÕES ESTATÍSTICOS (`BiomechanicalStatsDashboard.vue`)

Cria `frontend/mediapipe/src/components/telemetry/BiomechanicalStatsDashboard.vue`:

```html
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
```

---

## 6. CRITÉRIOS DE ACEITAÇÃO
1. O gráfico renderiza as séries de tempo e a linha vertical vermelha desloca-se fluidamente em perfeita sincronia com `currentTime`.
2. A faixa verde entre 145° e 155° destaca o intervalo ideal do joelho no BDC.
3. Se a média dos picos for 141°, o dashboard exibe o card de aviso amarelo com a recomendação "Subir Selim". Se for 149°, exibe "100% OK".
