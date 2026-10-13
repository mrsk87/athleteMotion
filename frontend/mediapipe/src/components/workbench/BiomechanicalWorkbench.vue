<template>
  <div class="biomechanical-workbench">
    <!-- Cabeçalho Principal do Estúdio com Navegação de Etapas / Abas -->
    <div class="workbench-header">
      <div class="header-titles">
        <h3 class="workbench-title">⚡ Estação de Análise Biomecânica DirectML</h3>
        <span class="workbench-subtitle">Inferência GPU AMD RX 580 / CPU Xeon AVX2</span>
      </div>

      <!-- Seletor de Etapas: 1. Vídeo | 2. Relatório -->
      <div class="workbench-tabs-nav">
        <button
          type="button"
          class="workbench-tab-btn"
          :class="{ active: activeTab === 'video' }"
          @click="activeTab = 'video'"
        >
          🎥 1. Estúdio de Vídeo
        </button>
        <button
          type="button"
          class="workbench-tab-btn"
          :class="{ active: activeTab === 'report' }"
          @click="activeTab = 'report'"
        >
          📊 2. Relatório & Recomendações
          <span v-if="sampleCount > 0" class="tab-badge-counter">{{ sampleCount }}</span>
        </button>
      </div>

      <div class="header-badges">
        <span class="ws-status-pill" :class="'ws-' + inferenceStore.wsStatus">
          ● {{ wsStatusLabel }}
        </span>
      </div>
    </div>

    <!-- ETAPA 1: Estúdio de Vídeo Focado (Sem gráficos nem distrações) -->
    <div v-show="activeTab === 'video'" class="workbench-tab-content video-tab-content">
      <!-- Banner Notificação de Vídeo Concluído -->
      <div v-if="videoEndedBanner && sampleCount > 0" class="video-ended-banner">
        <div class="banner-text">
          <span class="banner-icon">🏁</span>
          <strong>Vídeo concluído!</strong> Foram analisadas {{ sampleCount }} frames com sucesso.
        </div>
        <button type="button" class="btn-banner-action" @click="activeTab = 'report'">
          Ver Relatório & Recomendações ▶
        </button>
      </div>

      <!-- Leitor VLC Lossless 2-Coluna com Palco e Painel Lateral -->
      <div class="workbench-player-section">
        <VideoPlayerVLC
          ref="playerRef"
          @timeupdate="onPlayerTimeUpdate"
          @loadedmetadata="onPlayerMetadata"
          @videoLoaded="onPlayerVideoLoaded"
          @seeked="onPlayerSeeked"
          @ended="onPlayerEnded"
        >
          <!-- Slot Central: Canvas Biomecânico sobreposto ao vídeo -->
          <template #default="{ currentTime: videoTime, videoElement }">
            <BiomechanicalOverlayCanvas
              :landmarks="inferenceStore.latestTelemetry.landmarks"
              :angles="inferenceStore.latestTelemetry.angles"
              :timestampMs="videoTime * 1000"
              :videoElement="videoElement"
              :side="inferenceStore.activeSide"
            />
          </template>

          <!-- Slot Lateral Superior: Definições do Motor & Ciclista -->
          <template #sidebar-top>
            <div class="sidebar-section-card">
              <div class="sidebar-card-header">
                <span class="card-icon">⚙️</span>
                <span class="card-title">Motor de Visão & Configurações</span>
              </div>

              <div class="sidebar-card-body">
                <!-- Botão Hero de Carregar / Trocar Vídeo -->
                <button
                  type="button"
                  class="btn-upload-hero"
                  title="Carregar ou substituir o vídeo do ciclista"
                  @click="onTriggerUpload"
                >
                  📁 Carregar / Trocar Vídeo
                </button>

                <!-- Seletor do Motor de Visão DirectML -->
                <div class="setting-item">
                  <label for="engine-select" class="setting-label">Motor DirectML:</label>
                  <select
                    id="engine-select"
                    class="setting-select"
                    :value="inferenceStore.activeEngine"
                    @change="onSwitchEngine($event.target.value)"
                  >
                    <option
                      v-for="eng in inferenceStore.availableEngines"
                      :key="eng.name"
                      :value="eng.name"
                      :disabled="eng.available === false"
                      :title="eng.notes || eng.description"
                    >
                      {{ eng.display_name }} ({{ eng.hardware_provider }}){{ eng.available === false ? ' — indisponível' : '' }}
                    </option>
                  </select>
                </div>

                <!-- Lado Analisado -->
                <div class="setting-item">
                  <label class="setting-label">Lado do Corpo / Perfil:</label>
                  <div class="side-selector-segmented">
                    <button
                      type="button"
                      class="btn-side-segment"
                      :class="{ 'is-active': inferenceStore.activeSide === 'left' }"
                      title="Analisar e desenhar apenas o perfil Esquerdo"
                      @click="onSelectSide('left')"
                    >
                      ◀ Esquerdo
                    </button>
                    <button
                      type="button"
                      class="btn-side-segment"
                      :class="{ 'is-active': inferenceStore.activeSide === 'right' }"
                      title="Analisar e desenhar apenas o perfil Direito"
                      @click="onSelectSide('right')"
                    >
                      Direito ▶
                    </button>
                    <button
                      type="button"
                      class="btn-side-segment"
                      :class="{ 'is-active': inferenceStore.activeSide === 'both' }"
                      title="Analisar e desenhar Ambos os lados"
                      @click="onSelectSide('both')"
                    >
                      Ambos
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- Slot Lateral Inferior: Telemetria Instantânea + Botão de Avanço -->
          <template #sidebar-bottom>
            <div class="sidebar-section-card">
              <div class="sidebar-card-header">
                <span class="card-icon">📐</span>
                <span class="card-title">Telemetria em Direto</span>
              </div>

              <div class="sidebar-card-body">
                <div class="angles-grid">
                  <!-- Joelho com Compliance Badge BDC (145°-155°) -->
                  <div class="angle-kpi-card" :class="'compliance-' + kneeComplianceStatus">
                    <div class="kpi-header">
                      <span class="kpi-name">Joelho (Extensão)</span>
                      <span class="kpi-compliance-badge">{{ kneeComplianceBadgeText }}</span>
                    </div>
                    <div class="kpi-value-row">
                      <span class="kpi-value">{{ currentKneeAngleText }}</span>
                      <span class="kpi-target-hint">Alvo BDC: 145°-155°</span>
                    </div>
                  </div>

                  <!-- Tronco -->
                  <div class="angle-kpi-card">
                    <div class="kpi-header">
                      <span class="kpi-name">Tronco (Inclinação)</span>
                      <span class="kpi-subinfo">Sagital</span>
                    </div>
                    <div class="kpi-value-row">
                      <span class="kpi-value">{{ currentTorsoAngleText }}</span>
                      <span class="kpi-target-hint">vs Horizontal</span>
                    </div>
                  </div>

                  <!-- Braço / Cotovelo -->
                  <div class="angle-kpi-card">
                    <div class="kpi-header">
                      <span class="kpi-name">Braço / Cotovelo</span>
                      <span class="kpi-subinfo">Avanço</span>
                    </div>
                    <div class="kpi-value-row">
                      <span class="kpi-value">{{ currentArmAngleText }}</span>
                      <span class="kpi-target-hint">Ombro-Cotovelo-Pulso</span>
                    </div>
                  </div>
                </div>

                <!-- Botão de Transição para o Relatório -->
                <div class="sidebar-advance-box">
                  <button
                    type="button"
                    class="btn-advance-report"
                    :disabled="sampleCount === 0"
                    @click="activeTab = 'report'"
                  >
                    <span>📊 Concluir & Ver Relatório</span>
                    <span v-if="sampleCount > 0" class="btn-sample-badge">({{ sampleCount }} frames)</span>
                  </button>
                  <span v-if="sampleCount === 0" class="advance-hint">
                    Reproduza o vídeo para recolher a telemetria da pedalada.
                  </span>
                </div>
              </div>
            </div>
          </template>
        </VideoPlayerVLC>
      </div>
    </div>

    <!-- ETAPA 2: Relatório Clínico, Gráficos & Recomendações de Bike Fit -->
    <div v-show="activeTab === 'report'" class="workbench-tab-content report-tab-content">
      <!-- Barra Superior do Relatório -->
      <div class="report-top-bar">
        <button type="button" class="btn-back-to-video" @click="activeTab = 'video'">
          ◀ Voltar ao Vídeo
        </button>

        <div class="session-meta-chips">
          <span class="meta-chip">Motor: <strong>{{ activeEngineLabel }}</strong></span>
          <span class="meta-chip">Lado: <strong>{{ activeSideLabel }}</strong></span>
          <span class="meta-chip">Amostras: <strong>{{ sampleCount }} frames</strong></span>
          <span class="meta-chip">Duração: <strong>{{ duration.toFixed(1) }}s</strong></span>
        </div>

        <button type="button" class="btn-print-report" @click="printReport">
          🖨️ Imprimir / Guardar PDF
        </button>
      </div>

      <!-- Painel de Recomendações Clínicas de Bike Fit -->
      <div class="clinical-recommendations-section">
        <div class="section-title-row">
          <h4 class="section-heading">🩺 Diagnóstico & Recomendações de Ajuste</h4>
          <span class="section-subheading">
            Análise postural automatizada cruzada com os dados da sua bicicleta (passo 1)
          </span>
        </div>

        <!-- De onde vêm os dados: nada é inventado se o passo 1 estiver vazio. -->
        <div class="workbench-data-source">
          <span class="data-chip">Dados do atleta: <strong>{{ athleteDataSourceLabel }}</strong></span>
          <span class="data-chip">Modalidade: <strong>{{ styleLabel }}</strong></span>
          <span class="data-chip">Joelho: <strong>{{ kneeMeasurementText }}</strong></span>
          <span v-if="!athleteFormHasBikeData" class="data-warning">
            ⚠️ Sem medidas da bicicleta no passo 1 — os cartões de equipamento dizem exatamente o que falta.
          </span>
        </div>

        <div class="recommendations-cards-grid">
          <div
            v-for="card in recommendationCards"
            :key="card.key"
            class="rec-card"
            :class="'theme-' + card.theme"
          >
            <div class="rec-card-header">
              <span class="rec-icon">{{ card.icon }}</span>
              <span class="rec-title">{{ card.title }}</span>
              <span class="rec-badge">{{ card.badge }}</span>
            </div>
            <div class="rec-metric-row">
              <span class="metric-big">{{ card.measuredText }}</span>
              <span class="metric-label">{{ card.measuredLabel }}</span>
            </div>
            <p v-if="card.targetText" class="rec-target">🎯 {{ card.targetText }}</p>
            <p class="rec-description">{{ card.action }}</p>
            <p class="rec-description rec-why">{{ card.why }}</p>
            <p v-if="card.harm" class="rec-harm">⚠️ {{ card.harm }}</p>
            <ul v-if="card.references && card.references.length" class="rec-evidence">
              <li v-for="(ref, index) in card.references" :key="card.key + '-ref-' + index">
                {{ ref.brand }} {{ ref.model }} → <strong>{{ ref.label }}</strong> ({{ ref.bandText }}<span
                  v-if="ref.seatTubeCm"
                > · tubo {{ ref.seatTubeCm }} cm</span>)
              </li>
            </ul>
            <ul v-if="card.evidence && card.evidence.length" class="rec-evidence">
              <li v-for="(line, index) in card.evidence" :key="card.key + '-ev-' + index">{{ line }}</li>
            </ul>
            <span class="rec-source">Fonte: {{ card.source }}</span>
          </div>
        </div>

        <!-- Tabelas publicadas: o atleta vê a que altura corresponde cada tamanho, com a fonte. -->
        <details v-if="publishedSizeRows.length" class="published-size-tables" open>
          <summary>
            📚 Tabelas publicadas de tamanho ({{ styleLabel }}) — {{ publishedSizeRows.length }} tamanhos
          </summary>
          <p class="published-size-note">{{ publishedSizeNote }}</p>
          <table>
            <thead>
              <tr>
                <th>Marca</th>
                <th>Modelo</th>
                <th>Tamanho</th>
                <th>Altura do atleta</th>
                <th>Tubo do selim</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in publishedSizeRows" :key="'size-' + index">
                <td>{{ row.brand }}</td>
                <td>{{ row.model }}</td>
                <td><strong>{{ row.label }}</strong></td>
                <td>{{ row.heightText }}</td>
                <td>{{ row.seatTubeCm === null ? '—' : row.seatTubeCm + ' cm' }}</td>
              </tr>
            </tbody>
          </table>
          <p class="published-size-note">
            Fontes:
            <span v-for="(source, index) in publishedSizeSources" :key="'src-' + index">
              {{ index > 0 ? ' · ' : '' }}<a :href="source" target="_blank" rel="noopener noreferrer">{{ source }}</a>
            </span>
          </p>
        </details>

        <!-- Notas de contexto e limites declarados (o que ficou por verificar). -->
        <div v-if="recommendationNotices.length" class="workbench-notices">
          <h5 class="notices-title">📌 Notas, limites e verificações em falta</h5>
          <ul>
            <li v-for="(notice, index) in recommendationNotices" :key="'notice-' + index">{{ notice }}</li>
          </ul>
        </div>
      </div>

      <!-- Dashboard Estatístico: Cadência RPM, BDC Médio, Oscilação -->
      <div class="workbench-stats-section">
        <BiomechanicalStatsDashboard :samples="inferenceStore.telemetrySamples" />
      </div>

      <!-- Gráfico Sincronizado ECharts com Faixa BDC 145°-155° -->
      <div class="workbench-chart-section">
        <TelemetrySyncChart
          :samples="inferenceStore.telemetrySamples"
          :currentTime="currentTime"
          :duration="duration"
          @seek="onChartSeek"
          @clear="onClearChart"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useInferenceStore } from '../../stores/inferenceStore';
import VideoPlayerVLC from '../video/VideoPlayerVLC.vue';
import BiomechanicalOverlayCanvas from '../video/BiomechanicalOverlayCanvas.vue';
import TelemetrySyncChart from '../telemetry/TelemetrySyncChart.vue';
import BiomechanicalStatsDashboard from '../telemetry/BiomechanicalStatsDashboard.vue';
import {
  buildWorkbenchRecommendations,
  loadWorkbenchAthleteForm,
} from './modules/workbenchRecommendations';
import { STYLE_SIZING_NOTE, chartRowsForStyle } from './modules/bikeSizeGuide';
import { POSTURE_AERO, POSTURE_UPRIGHT } from '../LiveCameraCapture/modules/postureMode';

const inferenceStore = useInferenceStore();
const playerRef = ref(null);
const currentTime = ref(0);
const duration = ref(10);
const activeTab = ref('video'); // 'video' | 'report'
const videoEndedBanner = ref(false);

let offscreenCanvas = null;
let offscreenCtx = null;
let isSendingFrame = false;
let isAwaitingInference = false;
let inferenceTimeoutId = null;
let lastSentTime = -1;
let animFrameId = null;
let unsubscribeTelemetry = null;

const sampleCount = computed(() => inferenceStore.telemetrySamples.length);

const activeEngineLabel = computed(() => {
  const current = inferenceStore.availableEngines.find((e) => e.name === inferenceStore.activeEngine);
  return current ? current.display_name : inferenceStore.activeEngine;
});

const wsStatusLabel = computed(() => {
  switch (inferenceStore.wsStatus) {
    case 'connected': return 'Conectado (DirectML Ativo)';
    case 'connecting': return 'A conectar...';
    case 'error': return 'Erro WS';
    default: return 'Desconectado';
  }
});

// Telemetria Angular em Tempo Real
const currentKneeAngle = computed(() => {
  return inferenceStore.latestTelemetry?.angles?.knee ?? null;
});

const currentKneeAngleText = computed(() => {
  const k = currentKneeAngle.value;
  return k !== null ? `${k.toFixed(1)}°` : '--';
});

const kneeComplianceStatus = computed(() => {
  const k = currentKneeAngle.value;
  if (k === null) return 'idle';
  if (k >= 145.0 && k <= 155.0) return 'target';
  if (k < 145.0) return 'low';
  return 'high';
});

const kneeComplianceBadgeText = computed(() => {
  switch (kneeComplianceStatus.value) {
    case 'target': return 'No Alvo BDC';
    case 'low': return 'Fletido (<145°)';
    case 'high': return 'Hiperextensão (>155°)';
    default: return 'Aguardando';
  }
});

const currentTorsoAngleText = computed(() => {
  const t = inferenceStore.latestTelemetry?.angles?.torso ?? null;
  return t !== null ? `${t.toFixed(1)}°` : '--';
});

const currentArmAngleText = computed(() => {
  const a = inferenceStore.latestTelemetry?.angles?.elbow ?? inferenceStore.latestTelemetry?.angles?.arm ?? null;
  return a !== null ? `${a.toFixed(1)}°` : '--';
});

/* ------------------------------------------------------------------ */
/* DADOS DO ATLETA (passo 1) E MEDIÇÕES AGREGADAS DA PEDALADA          */
/* ------------------------------------------------------------------ */

// Perfil e medidas do passo 1 guardados no dispositivo: a bancada NÃO volta a interrogar o atleta.
const athleteRecord = loadWorkbenchAthleteForm();
const athleteForm = ref(athleteRecord.form || {});
const athleteDataSourceLabel = ref(athleteRecord.sourceLabel);
const athleteFormHasBikeData = ref(athleteRecord.hasBikeData);

const styleLabels = { road: 'Estrada', gravel: 'Gravel', mtb: 'BTT/MTB', tt: 'TT/Triatlo' };
const ridingStyle = computed(() => athleteForm.value.riding_style || 'road');
const styleLabel = computed(() => styleLabels[ridingStyle.value] || styleLabels.road);
// Um perfil de TT/triatlo é uma posição aerodinâmica: os alvos de tronco e cotovelo são outros.
const posture = computed(() => (ridingStyle.value === 'tt' ? POSTURE_AERO : POSTURE_UPRIGHT));

/** Amostras recolhidas no ponto morto inferior (6h) — é aí que a altura do selim se mede. */
const bdcSamples = computed(() => inferenceStore.telemetrySamples.filter((s) => s.isBdc));
/** Mínimo de amostras de BDC para preferir o BDC à média global. */
const MIN_BDC_SAMPLES = 3;

/**
 * Média de uma métrica angular. O joelho e o tornozelo preferem as amostras do BDC (é a definição
 * do alvo); o tronco e o cotovelo são postura e usam todas as amostras.
 */
const averageAngle = (key, { preferBdc = false, min = null, max = null } = {}) => {
  const source = preferBdc && bdcSamples.value.length >= MIN_BDC_SAMPLES ? bdcSamples.value : inferenceStore.telemetrySamples;
  const valid = source
    .map((sample) => sample[key])
    .filter((value) => typeof value === 'number' && (min === null || value > min) && (max === null || value < max));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
};

const kneeAverage = computed(() => averageAngle('knee', { preferBdc: true, min: 60 }));
const torsoAverage = computed(() => averageAngle('torso', { min: 10 }));
const armAverage = computed(() => averageAngle('arm', { min: 20 }));
const ankleAverage = computed(() => averageAngle('ankle', { preferBdc: true, min: 40, max: 140 }));
const kneeFromBdc = computed(() => bdcSamples.value.length >= MIN_BDC_SAMPLES);

const kneeMeasurementText = computed(() => {
  if (kneeAverage.value === null) return 'sem amostras';
  return `${kneeAverage.value.toFixed(1)}° (${kneeFromBdc.value ? `BDC, ${bdcSamples.value.length} amostras` : 'média de todas as amostras'})`;
});

/**
 * Diagnóstico completo da bancada: ângulos medidos × dados do atleta e da bicicleta (passo 1).
 * A construção vive em `modules/workbenchRecommendations.js` (testável sem navegador).
 */
const recommendations = computed(() =>
  buildWorkbenchRecommendations({
    measurements: {
      knee: kneeAverage.value,
      torso: torsoAverage.value,
      elbow: armAverage.value,
      ankle: ankleAverage.value,
    },
    form: athleteForm.value,
    posture: posture.value,
    ridingStyle: ridingStyle.value,
    dataSource: athleteRecord.source,
  })
);

const cardThemes = { ok: 'success', warning: 'warning', danger: 'warning', attention: 'info', missing: 'neutral' };

const recommendationCards = computed(() =>
  recommendations.value.cards.map((card) => ({ ...card, theme: cardThemes[card.status] || 'neutral' }))
);

/** Notas, limites e o que ficou por verificar (equipamento + antropometria + regime de medição). */
const recommendationNotices = computed(() => {
  const measurementNote = kneeFromBdc.value
    ? `Extensão do joelho lida com ${bdcSamples.value.length} amostras no BDC (método Holmes, medição estática).`
    : 'Sem amostras suficientes no BDC: a extensão do joelho foi lida na média de todas as amostras — serve de indicador, não de medida estática do método Holmes.';
  const riderNotes = (recommendations.value.riderNotes || []).map(
    (note) => `${note.icon} ${note.label}: ${note.text}`
  );
  const issues = (recommendations.value.profileIssues || []).map((issue) => `⚠️ ${issue.message}`);
  return [measurementNote, ...recommendations.value.notices, ...riderNotes, ...issues];
});

/** Tabelas publicadas de tamanho da modalidade declarada (com as fontes de cada marca). */
const publishedSizeRows = computed(() => chartRowsForStyle(ridingStyle.value));
const publishedSizeSources = computed(() => [...new Set(publishedSizeRows.value.map((row) => row.source))]);
const publishedSizeNote = computed(
  () =>
    `${STYLE_SIZING_NOTE[ridingStyle.value] || STYLE_SIZING_NOTE.road} As faixas SOBREPÕEM-SE entre tamanhos e não são convertíveis entre marcas.`
);

const onTriggerUpload = () => {
  if (playerRef.value?.triggerFileInput) {
    playerRef.value.triggerFileInput();
  }
};

const captureAndSendFrame = () => {
  const video = playerRef.value?.videoRef;
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
  if (inferenceStore.wsStatus !== 'connected') return;
  if (isSendingFrame || isAwaitingInference) return;

  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
    offscreenCtx = offscreenCanvas.getContext('2d', { alpha: false });
  }

  // Resolução calibrada para inferência ultrarrápida a 30-40 FPS na GPU
  const maxDim = 480;
  let targetW = video.videoWidth;
  let targetH = video.videoHeight;
  if (targetW > maxDim || targetH > maxDim) {
    const scale = Math.min(maxDim / targetW, maxDim / targetH);
    targetW = Math.round(targetW * scale);
    targetH = Math.round(targetH * scale);
  }

  if (offscreenCanvas.width !== targetW || offscreenCanvas.height !== targetH) {
    offscreenCanvas.width = targetW;
    offscreenCanvas.height = targetH;
  }

  try {
    offscreenCtx.drawImage(video, 0, 0, targetW, targetH);
  } catch (err) {
    return;
  }

  isSendingFrame = true;
  isAwaitingInference = true;
  lastSentTime = video.currentTime;
  const currentSec = video.currentTime;

  // Timeout de salvaguarda de 75ms para prevenir bloqueio caso um pacote seja descartado
  clearTimeout(inferenceTimeoutId);
  inferenceTimeoutId = setTimeout(() => {
    isAwaitingInference = false;
  }, 75);

  offscreenCanvas.toBlob(
    (blob) => {
      if (blob && inferenceStore.wsStatus === 'connected') {
        const tsMs = currentSec > 0 ? Math.round(currentSec * 1000) : Math.round(performance.now());
        inferenceStore
          .sendFrame(blob, tsMs)
          .catch(() => {
            isAwaitingInference = false;
          })
          .finally(() => {
            isSendingFrame = false;
          });
      } else {
        isSendingFrame = false;
        isAwaitingInference = false;
      }
    },
    'image/jpeg',
    0.58
  );
};

const onPlayerTimeUpdate = ({ currentTime: cur, duration: dur }) => {
  currentTime.value = cur;
  if (dur > 0) duration.value = dur;

  // Se o vídeo estiver pausado e o utilizador arrastar ou avançar frame, envia frame imediatamente
  const video = playerRef.value?.videoRef;
  if (video && video.paused) {
    isAwaitingInference = false;
    captureAndSendFrame();
  }
};

const onPlayerSeeked = ({ currentTime: cur, duration: dur }) => {
  currentTime.value = cur;
  if (dur > 0) duration.value = dur;
  isAwaitingInference = false;
  captureAndSendFrame();
};

const onPlayerMetadata = ({ duration: dur }) => {
  if (dur > 0) duration.value = dur;
  setTimeout(() => captureAndSendFrame(), 150);
};

const onPlayerVideoLoaded = () => {
  inferenceStore.telemetrySamples = [];
  lastSentTime = -1;
  videoEndedBanner.value = false;
  isAwaitingInference = false;
  setTimeout(() => captureAndSendFrame(), 200);
};

const onPlayerEnded = () => {
  videoEndedBanner.value = true;
};

const onSwitchEngine = (engineName) => {
  inferenceStore.switchEngine(engineName);
  isAwaitingInference = false;
  setTimeout(() => captureAndSendFrame(), 200);
};

const onSelectSide = (side) => {
  inferenceStore.setSide(side);
  isAwaitingInference = false;
  setTimeout(() => captureAndSendFrame(), 100);
};

const activeSideLabel = computed(() => {
  if (inferenceStore.activeSide === 'left') return 'Esquerdo';
  if (inferenceStore.activeSide === 'right') return 'Direito';
  return 'Ambos';
});

const onChartSeek = (targetSec) => {
  if (playerRef.value?.seekTo) {
    playerRef.value.seekTo(targetSec);
    activeTab.value = 'video';
    isAwaitingInference = false;
    captureAndSendFrame();
  }
};

const onClearChart = () => {
  inferenceStore.clearTelemetry();
};

const printReport = () => {
  window.print();
};

const startPlaybackInferenceLoop = () => {
  const checkLoop = () => {
    const video = playerRef.value?.videoRef;
    if (video && !video.paused && !video.seeking && !isSendingFrame && !isAwaitingInference) {
      if (Math.abs(video.currentTime - lastSentTime) >= 0.025) {
        captureAndSendFrame();
      }
    }
    animFrameId = requestAnimationFrame(checkLoop);
  };
  animFrameId = requestAnimationFrame(checkLoop);
};

onMounted(() => {
  inferenceStore.fetchEngines();
  inferenceStore.connectWebSocket();
  unsubscribeTelemetry = inferenceStore.onFrameTelemetry(() => {
    isAwaitingInference = false;
    clearTimeout(inferenceTimeoutId);
  });
  startPlaybackInferenceLoop();
});

onBeforeUnmount(() => {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (unsubscribeTelemetry) {
    unsubscribeTelemetry();
    unsubscribeTelemetry = null;
  }
  clearTimeout(inferenceTimeoutId);
  inferenceStore.disconnectWebSocket();
});
</script>

<style scoped>
.biomechanical-workbench {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  background-color: var(--bg-surface-1, #121214);
  border-radius: 10px;
  border: 1px solid var(--border-subtle, #27272a);
}

.workbench-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-subtle, #27272a);
}

.workbench-title {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: #fff;
}

.workbench-subtitle {
  font-size: 12px;
  color: #a1a1aa;
}

/* Navegação por Abas */
.workbench-tabs-nav {
  display: flex;
  align-items: center;
  gap: 6px;
  background-color: var(--bg-inset, #09090b);
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle, #27272a);
}

.workbench-tab-btn {
  background: transparent;
  border: none;
  color: #a1a1aa;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;
}

.workbench-tab-btn:hover {
  color: #fff;
  background-color: rgba(255, 255, 255, 0.05);
}

.workbench-tab-btn.active {
  background-color: #38bdf8;
  color: #000;
  font-weight: 800;
}

.tab-badge-counter {
  background-color: #10b981;
  color: #000;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 800;
}

.header-badges {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ws-status-pill {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 12px;
  font-weight: 700;
}

.ws-connected {
  background-color: rgba(16, 185, 129, 0.15);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.ws-connecting {
  background-color: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.ws-disconnected, .ws-error {
  background-color: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

/* Banner de Vídeo Concluído */
.video-ended-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.15), rgba(56, 189, 248, 0.15));
  border: 1px solid #10b981;
  border-radius: 8px;
  padding: 10px 14px;
  color: #fff;
  animation: fadeIn 0.3s ease;
}

.banner-text {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.banner-icon {
  font-size: 18px;
}

.btn-banner-action {
  background-color: #10b981;
  color: #000;
  border: none;
  font-weight: 800;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: background-color 0.15s;
}

.btn-banner-action:hover {
  background-color: #34d399;
}

/* Secção do Leitor e Barra Lateral */
.workbench-player-section {
  width: 100%;
}

.sidebar-section-card {
  background-color: var(--bg-surface-2, #18181b);
  border: 1px solid var(--border-subtle, #27272a);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sidebar-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-subtle, #27272a);
}

.card-icon {
  font-size: 14px;
}

.card-title {
  font-size: 12px;
  font-weight: 700;
  color: #f4f4f5;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sidebar-card-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.btn-upload-hero {
  background: linear-gradient(135deg, #27272a, #3f3f46);
  color: #fff;
  border: 1px solid var(--border, #52525b);
  border-radius: 6px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.15s ease;
}

.btn-upload-hero:hover {
  background: linear-gradient(135deg, #3f3f46, #52525b);
  border-color: #38bdf8;
  color: #38bdf8;
}

.setting-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setting-label {
  font-size: 11px;
  font-weight: 600;
  color: #a1a1aa;
}

.setting-select {
  background-color: var(--bg-inset, #09090b);
  color: #fff;
  border: 1px solid var(--border, #3f3f46);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  width: 100%;
}

.side-selector-segmented {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 4px;
  background-color: var(--bg-inset, #09090b);
  padding: 3px;
  border-radius: 6px;
  border: 1px solid var(--border, #3f3f46);
}

.btn-side-segment {
  background: transparent;
  border: none;
  color: #a1a1aa;
  font-size: 11px;
  font-weight: 600;
  padding: 6px 4px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;
}

.btn-side-segment:hover {
  color: #f4f4f5;
  background-color: rgba(255, 255, 255, 0.06);
}

.btn-side-segment.is-active {
  background: var(--accent, #38bdf8);
  color: #0b0b0d;
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}

.setting-row-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.btn-side-toggle {
  flex: 1;
  background-color: var(--bg-inset, #09090b);
  color: #38bdf8;
  border: 1px solid #38bdf8;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  text-align: center;
  transition: background-color 0.15s;
}

.btn-side-toggle:hover {
  background-color: rgba(56, 189, 248, 0.12);
}

/* Grelha de Ângulos */
.angles-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.angle-kpi-card {
  background-color: var(--bg-inset, #09090b);
  border: 1px solid var(--border-subtle, #27272a);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.angle-kpi-card.compliance-target {
  border-color: rgba(16, 185, 129, 0.5);
  background-color: rgba(16, 185, 129, 0.05);
}

.angle-kpi-card.compliance-low,
.angle-kpi-card.compliance-high {
  border-color: rgba(245, 158, 11, 0.5);
  background-color: rgba(245, 158, 11, 0.05);
}

.kpi-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.kpi-name {
  font-size: 11px;
  font-weight: 700;
  color: #e4e4e7;
}

.kpi-compliance-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 8px;
}

.compliance-target .kpi-compliance-badge {
  background-color: rgba(16, 185, 129, 0.2);
  color: #10b981;
}

.compliance-low .kpi-compliance-badge,
.compliance-high .kpi-compliance-badge {
  background-color: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}

.compliance-idle .kpi-compliance-badge {
  background-color: #27272a;
  color: #71717a;
}

.kpi-subinfo {
  font-size: 10px;
  color: #71717a;
}

.kpi-value-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.kpi-value {
  font-size: 20px;
  font-weight: 800;
  font-family: monospace;
  color: #38bdf8;
}

.compliance-target .kpi-value {
  color: #10b981;
}

.compliance-low .kpi-value,
.compliance-high .kpi-value {
  color: #f59e0b;
}

.kpi-target-hint {
  font-size: 10px;
  color: #a1a1aa;
}

/* Botão de Avanço para o Relatório */
.sidebar-advance-box {
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.btn-advance-report {
  background: linear-gradient(135deg, #10b981, #059669);
  color: #000;
  font-weight: 800;
  border: none;
  border-radius: 6px;
  padding: 9px 12px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.15s ease;
}

.btn-advance-report:hover:not(:disabled) {
  background: linear-gradient(135deg, #34d399, #10b981);
  transform: translateY(-1px);
}

.btn-advance-report:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sample-badge {
  background-color: rgba(0, 0, 0, 0.3);
  color: #fff;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
}

.advance-hint {
  font-size: 10px;
  color: #71717a;
  text-align: center;
}

/* ETAPA 2: Relatório Clínico & Gráficos */
.report-tab-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: fadeIn 0.25s ease;
}

.report-top-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background-color: var(--bg-surface-2, #18181b);
  border: 1px solid var(--border-subtle, #27272a);
  border-radius: 8px;
  padding: 10px 14px;
}

.btn-back-to-video {
  background-color: var(--bg-inset, #27272a);
  border: 1px solid var(--border, #3f3f46);
  color: #38bdf8;
  font-weight: 700;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.btn-back-to-video:hover {
  background-color: #3f3f46;
}

.session-meta-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.meta-chip {
  background-color: var(--bg-inset, #09090b);
  border: 1px solid var(--border-subtle, #27272a);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  color: #a1a1aa;
}

.meta-chip strong {
  color: #fff;
}

.btn-print-report {
  background-color: #27272a;
  border: 1px solid var(--border, #3f3f46);
  color: #fff;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.btn-print-report:hover {
  background-color: #38bdf8;
  color: #000;
  border-color: #38bdf8;
}

/* Origem dos dados do atleta: a bancada diz sempre de onde vêm as medidas. */
.workbench-data-source {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.data-chip {
  font-size: 11px;
  color: #a1a1aa;
  background-color: var(--bg-surface-2, #18181b);
  border: 1px solid var(--border-subtle, #27272a);
  border-radius: 10px;
  padding: 3px 10px;
}

.data-chip strong {
  color: #fff;
}

.data-warning {
  font-size: 11px;
  color: #f59e0b;
}

/* Secção de Recomendações Clínicas */
.clinical-recommendations-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-heading {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  color: #fff;
}

.section-subheading {
  font-size: 11px;
  color: #a1a1aa;
}

.recommendations-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
}

.rec-card {
  background-color: var(--bg-surface-2, #18181b);
  border: 1px solid var(--border-subtle, #27272a);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.15s;
}

.rec-card.theme-success {
  border-color: rgba(16, 185, 129, 0.4);
  background: linear-gradient(180deg, rgba(16, 185, 129, 0.05), var(--bg-surface-2, #18181b));
}

.rec-card.theme-warning {
  border-color: rgba(245, 158, 11, 0.4);
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.05), var(--bg-surface-2, #18181b));
}

.rec-card.theme-info {
  border-color: rgba(56, 189, 248, 0.4);
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.05), var(--bg-surface-2, #18181b));
}

.rec-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rec-icon {
  font-size: 16px;
}

.rec-title {
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  flex: 1;
}

.rec-badge {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 10px;
}

.theme-success .rec-badge {
  background-color: rgba(16, 185, 129, 0.2);
  color: #10b981;
}

.theme-warning .rec-badge {
  background-color: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}

.theme-info .rec-badge {
  background-color: rgba(56, 189, 248, 0.2);
  color: #38bdf8;
}

.theme-neutral .rec-badge {
  background-color: #27272a;
  color: #71717a;
}

.rec-metric-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.metric-big {
  font-size: 26px;
  font-weight: 800;
  font-family: monospace;
  color: #fff;
}

.theme-success .metric-big {
  color: #10b981;
}

.theme-warning .metric-big {
  color: #f59e0b;
}

.theme-info .metric-big {
  color: #38bdf8;
}

.metric-label {
  font-size: 11px;
  color: #a1a1aa;
}

.rec-description {
  font-size: 12px;
  line-height: 1.5;
  color: #d4d4d8;
  margin: 0;
}

/* Ação a tomar (primeira linha) em destaque; a explicação e a evidência seguem em tom menor. */
.rec-card > .rec-description:first-of-type {
  color: #fff;
  font-weight: 600;
}

.rec-target {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  color: #a1a1aa;
}

.rec-why {
  color: #a1a1aa;
  font-size: 11.5px;
}

.rec-harm {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: #f59e0b;
}

.rec-evidence {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rec-evidence li {
  font-size: 11px;
  color: #a1a1aa;
}

.rec-source {
  font-size: 10px;
  color: #71717a;
  border-top: 1px dashed var(--border-subtle, #27272a);
  padding-top: 6px;
}

/* Tabelas publicadas de tamanho (altura do atleta → tamanho), com as fontes de cada marca. */
.published-size-tables {
  border: 1px solid var(--border-subtle, #27272a);
  border-radius: 8px;
  background-color: var(--bg-surface-2, #18181b);
  padding: 10px 12px;
}

.published-size-tables summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
}

.published-size-tables table {
  width: 100%;
  margin-top: 10px;
  border-collapse: collapse;
  font-size: 11px;
}

.published-size-tables th,
.published-size-tables td {
  text-align: left;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border-subtle, #27272a);
  color: #d4d4d8;
}

.published-size-tables th {
  color: #a1a1aa;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 10px;
}

.published-size-note {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: #a1a1aa;
}

.published-size-note a {
  color: #38bdf8;
  word-break: break-all;
}

/* Notas, limites declarados e verificações em falta. */
.workbench-notices {
  border: 1px dashed var(--border-subtle, #27272a);
  border-radius: 8px;
  padding: 10px 12px;
  background-color: rgba(56, 189, 248, 0.04);
}

.notices-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
}

.workbench-notices ul {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.workbench-notices li {
  font-size: 11.5px;
  line-height: 1.5;
  color: #a1a1aa;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@media print {
  .workbench-header,
  .report-top-bar,
  .btn-print-report,
  .btn-back-to-video {
    display: none !important;
  }
  .biomechanical-workbench {
    background-color: #fff !important;
    color: #000 !important;
    border: none !important;
  }
  /* O relatório impresso tem de trazer os cartões inteiros: nada de cortar a meio da página. */
  .rec-card,
  .published-size-tables,
  .workbench-notices {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .rec-description,
  .rec-why,
  .rec-why,
  .rec-evidence li,
  .workbench-notices li {
    color: #333 !important;
  }
}
</style>
