<template>
  <div v-if="isOpen" class="preflight-backdrop" @click.self="closeWizard">
    <div class="preflight-modal">
      <!-- Cabeçalho do Wizard -->
      <div class="preflight-header">
        <div class="header-titles">
          <div class="preflight-title-row">
            <span class="preflight-icon">📐</span>
            <h3 class="preflight-title">{{ t('preflightTitle') }}</h3>
            <span class="preflight-badge" :class="`badge-${readinessStatus}`">
              {{ readinessLabel }}
            </span>
          </div>
          <p class="preflight-subtitle">{{ t('preflightSubtitle') }}</p>
        </div>

        <button type="button" class="btn-close-modal" @click="closeWizard" title="Fechar assistente">
          ✕
        </button>
      </div>

      <!-- Corpo com Grelha 2x2 de Diagnóstico em Tempo Real -->
      <div class="preflight-grid">
        <!-- 1. Nível da Câmara & Horizonte Artificial -->
        <div class="diagnostic-card" :class="{ 'card-passed': Math.abs(rollDeg) <= 1.0, 'card-warning': Math.abs(rollDeg) > 1.0 && Math.abs(rollDeg) <= 3.0, 'card-error': Math.abs(rollDeg) > 3.0 }">
          <div class="card-header">
            <div class="card-title">
              <span class="card-icon">🧭</span>
              <span>{{ t('preflightLevelTitle') }}</span>
            </div>
            <span class="card-metric">{{ Math.abs(rollDeg).toFixed(1) }}°</span>
          </div>

          <div class="horizon-wrapper">
            <ArtificialHorizon :roll-deg="rollDeg" :size="190" :target-roll="1.0" />
          </div>

          <div class="card-status-msg">
            <span v-if="Math.abs(rollDeg) <= 1.0" class="msg-success">✓ {{ t('preflightLevelPerfect') }}</span>
            <span v-else-if="Math.abs(rollDeg) <= 3.0" class="msg-warning">⚠️ {{ t('preflightLevelAcceptable') }}</span>
            <span v-else class="msg-error">✕ {{ t('preflightLevelExcessive') }}</span>
          </div>
        </div>

        <!-- 2. Iluminação & Contraste -->
        <div class="diagnostic-card" :class="{ 'card-passed': lightStatus === 'good', 'card-warning': lightStatus === 'low_contrast', 'card-error': lightStatus === 'too_dark' || lightStatus === 'too_bright' }">
          <div class="card-header">
            <div class="card-title">
              <span class="card-icon">💡</span>
              <span>{{ t('preflightLightingTitle') }}</span>
            </div>
            <span class="card-metric">{{ luminanceVal }} / 255</span>
          </div>

          <div class="gauge-section">
            <!-- Barra de Luminância com faixa ideal demarcada -->
            <div class="meter-group">
              <div class="meter-label-row">
                <span>{{ t('preflightLuminance') }}</span>
                <span>{{ luminanceVal }}</span>
              </div>
              <div class="meter-bar-track">
                <div class="ideal-zone" style="left: 18%; width: 66%;"></div>
                <div
                  class="meter-bar-fill"
                  :style="{ width: `${Math.min(100, (luminanceVal / 255) * 100)}%` }"
                  :class="lightStatus === 'good' ? 'fill-good' : 'fill-warning'"
                ></div>
              </div>
              <div class="zone-labels">
                <span>Escuro</span>
                <span class="zone-target">Zona Ideal (50-200)</span>
                <span>Estourado</span>
              </div>
            </div>

            <!-- Contraste -->
            <div class="meter-group mt-3">
              <div class="meter-label-row">
                <span>{{ t('preflightContrast') }}</span>
                <span>σ {{ contrastVal }}</span>
              </div>
              <div class="meter-bar-track">
                <div
                  class="meter-bar-fill"
                  :style="{ width: `${Math.min(100, (contrastVal / 80) * 100)}%` }"
                  :class="contrastVal >= 30 ? 'fill-good' : 'fill-warning'"
                ></div>
              </div>
            </div>
          </div>

          <div class="card-status-msg">
            <span v-if="lightStatus === 'good'" class="msg-success">✓ {{ t('preflightLightingGood') }}</span>
            <span v-else-if="lightStatus === 'too_dark'" class="msg-error">✕ {{ t('preflightLightingTooDark') }}</span>
            <span v-else-if="lightStatus === 'too_bright'" class="msg-error">✕ {{ t('preflightLightingTooBright') }}</span>
            <span v-else class="msg-warning">⚠️ {{ t('preflightLightingLowContrast') }}</span>
          </div>
        </div>

        <!-- 3. Nitidez & Foco Ótico (Laplacian Variance) -->
        <div class="diagnostic-card" :class="{ 'card-passed': isSharp, 'card-error': !isSharp }">
          <div class="card-header">
            <div class="card-title">
              <span class="card-icon">🔍</span>
              <span>{{ t('preflightSharpnessTitle') }}</span>
            </div>
            <span class="card-metric">{{ sharpnessScore }}%</span>
          </div>

          <div class="sharpness-visual">
            <div class="sharpness-circle-wrapper">
              <svg width="120" height="120" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="8" />
                <circle
                  cx="60"
                  cy="60"
                  r="48"
                  fill="none"
                  :stroke="isSharp ? '#10b981' : '#ef4444'"
                  stroke-width="8"
                  stroke-linecap="round"
                  :stroke-dasharray="301.6"
                  :stroke-dashoffset="301.6 * (1 - Math.min(100, sharpnessScore) / 100)"
                  transform="rotate(-90 60 60)"
                  class="progress-ring"
                />
              </svg>
              <div class="circle-center-text">
                <span class="score-num">{{ sharpnessScore }}</span>
                <span class="score-unit">/ 100</span>
              </div>
            </div>
          </div>

          <div class="card-status-msg">
            <span v-if="isSharp" class="msg-success">✓ {{ t('preflightSharpnessGood') }}</span>
            <span v-else class="msg-error">✕ {{ t('preflightSharpnessBlurry') }}</span>
          </div>
        </div>

        <!-- 4. Enquadramento & Visibilidade do Esqueleto -->
        <div class="diagnostic-card" :class="{ 'card-passed': isFramed, 'card-warning': framingDetected && !isFramed, 'card-error': !framingDetected }">
          <div class="card-header">
            <div class="card-title">
              <span class="card-icon">🚴</span>
              <span>{{ t('preflightFramingTitle') }}</span>
            </div>
            <span class="card-metric">{{ framingScore }}%</span>
          </div>

          <div class="framing-content">
            <div class="cyclist-orientation-badge">
              <span>Orientação:</span>
              <strong>{{ cyclistOrientation === 'right' ? '→ Direita' : cyclistOrientation === 'left' ? '← Esquerda' : '?' }}</strong>
            </div>

            <!-- Lista de pontos articulados -->
            <div class="joint-tags">
              <span class="joint-tag" :class="{ 'tag-ok': !missingJoints.includes('shoulder'), 'tag-bad': missingJoints.includes('shoulder') }">
                Ombro
              </span>
              <span class="joint-tag" :class="{ 'tag-ok': !missingJoints.includes('hip'), 'tag-bad': missingJoints.includes('hip') }">
                Anca
              </span>
              <span class="joint-tag" :class="{ 'tag-ok': !missingJoints.includes('knee'), 'tag-bad': missingJoints.includes('knee') }">
                Joelho
              </span>
              <span class="joint-tag" :class="{ 'tag-ok': !missingJoints.includes('ankle'), 'tag-bad': missingJoints.includes('ankle') }">
                Tornozelo
              </span>
            </div>

            <!-- Escala Métrica ArUco -->
            <div class="aruco-badge-row">
              <span class="aruco-label">Escala Métrica:</span>
              <span v-if="calibrationScalePxPerMm" class="badge-scale-active">
                🎯 {{ calibrationScalePxPerMm.toFixed(2) }} px/mm
              </span>
              <span v-else class="badge-scale-inactive">
                Modo Angular Puro
              </span>
            </div>
          </div>

          <div class="card-status-msg">
            <span v-if="isFramed" class="msg-success">✓ {{ t('preflightFramingComplete') }}</span>
            <span v-else-if="framingDetected" class="msg-warning">⚠️ {{ t('preflightFramingNearEdge') }}</span>
            <span v-else class="msg-error">✕ {{ t('preflightFramingMissing') }}</span>
          </div>
        </div>
      </div>

      <!-- Barra de Checklist e Ações Finais (Go / No-Go) -->
      <div class="preflight-footer">
        <div class="preflight-checklist">
          <div class="checklist-item" :class="{ 'item-ok': Math.abs(rollDeg) <= 1.0 }">
            <span class="check-icon">{{ Math.abs(rollDeg) <= 1.0 ? '✓' : '○' }}</span>
            <span>Nível da Câmara</span>
          </div>
          <div class="checklist-item" :class="{ 'item-ok': lightStatus === 'good' }">
            <span class="check-icon">{{ lightStatus === 'good' ? '✓' : '○' }}</span>
            <span>Iluminação</span>
          </div>
          <div class="checklist-item" :class="{ 'item-ok': isSharp }">
            <span class="check-icon">{{ isSharp ? '✓' : '○' }}</span>
            <span>Nitidez Ótica</span>
          </div>
          <div class="checklist-item" :class="{ 'item-ok': isFramed }">
            <span class="check-icon">{{ isFramed ? '✓' : '○' }}</span>
            <span>Enquadramento</span>
          </div>
        </div>

        <div class="footer-buttons">
          <button type="button" class="btn-preflight-secondary" @click="confirmAndStart">
            {{ t('preflightSkipBtn') }}
          </button>
          <button
            type="button"
            class="btn-preflight-primary"
            :class="{ 'btn-ready': readinessStatus === 'ready' }"
            @click="confirmAndStart"
          >
            🚀 {{ t('preflightStartBtn') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import ArtificialHorizon from './ArtificialHorizon.vue';

export default {
  name: 'PreflightWizard',
  components: {
    ArtificialHorizon,
  },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    rollDeg: {
      type: Number,
      default: 0.0,
    },
    lightStatus: {
      type: String,
      default: 'good',
    },
    luminanceVal: {
      type: Number,
      default: 120,
    },
    contrastVal: {
      type: Number,
      default: 45,
    },
    sharpnessScore: {
      type: Number,
      default: 85,
    },
    isSharp: {
      type: Boolean,
      default: true,
    },
    framingDetected: {
      type: Boolean,
      default: true,
    },
    isFramed: {
      type: Boolean,
      default: true,
    },
    framingScore: {
      type: Number,
      default: 90,
    },
    cyclistOrientation: {
      type: String,
      default: 'right',
    },
    missingJoints: {
      type: Array,
      default: () => [],
    },
    calibrationScalePxPerMm: {
      type: Number,
      default: null,
    },
    readinessStatus: {
      type: String,
      default: 'ready',
    },
  },
  emits: ['close', 'startSession'],
  setup(props, { emit }) {
    const { t } = useI18n();

    const readinessLabel = computed(() => {
      if (props.readinessStatus === 'ready') return t('preflightReadyLabel');
      if (props.readinessStatus === 'acceptable') return t('preflightAcceptableLabel');
      return t('preflightNotReadyLabel');
    });

    function closeWizard() {
      emit('close');
    }

    function confirmAndStart() {
      emit('startSession');
      emit('close');
    }

    return {
      t,
      readinessLabel,
      closeWizard,
      confirmAndStart,
    };
  },
};
</script>

<style scoped>
.preflight-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(10, 15, 29, 0.85);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fadeIn 0.25s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}

.preflight-modal {
  width: 100%;
  max-width: 860px;
  background: #0f172a;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #f1f5f9;
}

.preflight-header {
  padding: 20px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  background: rgba(30, 41, 59, 0.5);
}

.preflight-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.preflight-icon {
  font-size: 1.5rem;
}

.preflight-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: #ffffff;
}

.preflight-subtitle {
  margin: 4px 0 0 0;
  font-size: 0.85rem;
  color: #94a3b8;
}

.preflight-badge {
  padding: 3px 10px;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.badge-ready {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.4);
}

.badge-acceptable {
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.4);
}

.badge-not_ready {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.4);
}

.btn-close-modal {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 1.25rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.2s;
}

.btn-close-modal:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.preflight-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 20px 24px;
}

@media (max-width: 768px) {
  .preflight-grid {
    grid-template-columns: 1fr;
  }
}

.diagnostic-card {
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 240px;
  transition: border-color 0.25s, box-shadow 0.25s;
}

.card-passed {
  border-color: rgba(16, 185, 129, 0.35);
}

.card-warning {
  border-color: rgba(245, 158, 11, 0.35);
}

.card-error {
  border-color: rgba(239, 68, 68, 0.35);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.95rem;
  color: #e2e8f0;
}

.card-metric {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-weight: 700;
  font-size: 0.9rem;
  color: #38bdf8;
}

.horizon-wrapper {
  display: flex;
  justify-content: center;
  margin: 6px 0;
}

.card-status-msg {
  margin-top: 10px;
  font-size: 0.8rem;
  font-weight: 600;
  text-align: center;
}

.msg-success { color: #34d399; }
.msg-warning { color: #fbbf24; }
.msg-error { color: #f87171; }

.gauge-section {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 10px 0;
}

.meter-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meter-label-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: #94a3b8;
}

.meter-bar-track {
  position: relative;
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
}

.ideal-zone {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(16, 185, 129, 0.25);
  border-left: 1px dashed rgba(16, 185, 129, 0.6);
  border-right: 1px dashed rgba(16, 185, 129, 0.6);
}

.meter-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.2s ease;
}

.fill-good { background: #10b981; }
.fill-warning { background: #f59e0b; }

.zone-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.68rem;
  color: #64748b;
}

.zone-target {
  color: #10b981;
}

.mt-3 { margin-top: 12px; }

.sharpness-visual {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 10px 0;
}

.sharpness-circle-wrapper {
  position: relative;
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.progress-ring {
  transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;
}

.circle-center-text {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.score-num {
  font-size: 1.4rem;
  font-weight: 800;
  color: #ffffff;
  line-height: 1;
}

.score-unit {
  font-size: 0.7rem;
  color: #94a3b8;
}

.framing-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 6px 0;
}

.cyclist-orientation-badge {
  display: flex;
  gap: 6px;
  font-size: 0.85rem;
  color: #cbd5e1;
}

.joint-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.joint-tag {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 600;
}

.tag-ok {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.4);
}

.tag-bad {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.4);
}

.aruco-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
}

.aruco-label {
  color: #94a3b8;
}

.badge-scale-active {
  background: rgba(56, 189, 248, 0.2);
  color: #38bdf8;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.badge-scale-inactive {
  background: rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  padding: 2px 8px;
  border-radius: 4px;
}

.preflight-footer {
  padding: 16px 24px;
  background: rgba(15, 23, 42, 0.8);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

@media (max-width: 640px) {
  .preflight-footer {
    flex-direction: column;
    align-items: stretch;
  }
}

.preflight-checklist {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.checklist-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: #94a3b8;
  transition: color 0.2s;
}

.item-ok {
  color: #34d399;
  font-weight: 600;
}

.check-icon {
  font-weight: 700;
}

.footer-buttons {
  display: flex;
  gap: 12px;
}

.btn-preflight-secondary {
  padding: 9px 16px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #cbd5e1;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-preflight-secondary:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
}

.btn-preflight-primary {
  padding: 9px 20px;
  background: #3b82f6;
  border: none;
  color: #ffffff;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.25s;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
}

.btn-preflight-primary:hover {
  background: #2563eb;
  transform: translateY(-1px);
}

.btn-ready {
  background: #10b981;
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4);
}

.btn-ready:hover {
  background: #059669;
}
</style>
