<template>
  <div class="chart-wrapper">
    <div class="chart-header">
      <div class="header-left">
        <span class="chart-title">Evolução Angular Sincronizada</span>
        <div class="legend-badges">
          <span class="badge badge-knee">● Joelho</span>
          <span class="badge badge-target">--- Alvo BDC (145°-155°)</span>
          <span class="badge badge-torso">● Tronco</span>
          <span class="badge badge-arm">● Braço</span>
        </div>
      </div>
      <button
        v-if="samples && samples.length > 0"
        type="button"
        class="btn-clear-chart"
        @click="emit('clear')"
        title="Limpar gráfico e reiniciar histórico de telemetria"
      >
        🗑️ Limpar Gráfico
      </button>
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

const emit = defineEmits(['seek', 'clear']);
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

  const maxDuration = Math.max(props.duration || 10, props.currentTime || 0, 1);

  const option = {
    backgroundColor: '#18181b',
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
    },
    grid: {
      left: 45,
      right: 25,
      top: 25,
      bottom: 25,
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: maxDuration,
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

let rafUpdateId = null;

const requestChartUpdate = () => {
  if (rafUpdateId) return;
  rafUpdateId = requestAnimationFrame(() => {
    rafUpdateId = null;
    updateChart();
  });
};

watch(() => props.samples.length, requestChartUpdate);
watch(() => props.duration, requestChartUpdate);

// Atualização leve da agulha de leitura sem reconstruir a grelha de dados
watch(
  () => props.currentTime,
  (newTime) => {
    if (!chartInstance) return;
    chartInstance.setOption({
      series: [
        {
          name: 'Joelho',
          markLine: {
            symbol: 'none',
            silent: true,
            data: [
              { yAxis: 145, lineStyle: { color: '#10b981', type: 'dashed', width: 1.5 } },
              { yAxis: 155, lineStyle: { color: '#10b981', type: 'dashed', width: 1.5 } },
              {
                xAxis: newTime,
                lineStyle: { color: '#ef4444', width: 2, type: 'solid' },
                label: {
                  formatter: `t = ${newTime.toFixed(2)}s`,
                  color: '#ef4444',
                  position: 'end',
                },
              },
            ],
          },
        },
      ],
    });
  }
);

const onWindowResize = () => {
  if (chartInstance) chartInstance.resize();
};

onMounted(() => {
  initChart();
  window.addEventListener('resize', onWindowResize);
});

onBeforeUnmount(() => {
  if (rafUpdateId) cancelAnimationFrame(rafUpdateId);
  window.removeEventListener('resize', onWindowResize);
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
  gap: 12px;
  margin-bottom: 8px;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.chart-title {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
}
.btn-clear-chart {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background-color: var(--bg-inset, rgba(255, 255, 255, 0.05));
  color: var(--text-2, #a1a1aa);
  border: 1px solid var(--border, #3f3f46);
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.btn-clear-chart:hover {
  background-color: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border-color: #ef4444;
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
