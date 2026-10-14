<template>
  <div class="artificial-horizon-container" :style="{ width: `${size}px`, height: `${size}px` }">
    <!-- Moldura circular com anel graduado -->
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`" class="horizon-svg">
      <defs>
        <!-- Gradiente de Céu / Terra -->
        <linearGradient id="horizonSkyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#0284c7" stop-opacity="0.85" />
          <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.35" />
        </linearGradient>
        <linearGradient id="horizonGroundGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#78350f" stop-opacity="0.4" />
          <stop offset="100%" stop-color="#451a03" stop-opacity="0.85" />
        </linearGradient>
        <clipPath id="horizonCircleClip">
          <circle :cx="center" :cy="center" :r="radius - 8" />
        </clipPath>
      </defs>

      <!-- Fundo do Horizonte que gira com o Roll -->
      <g :clip-path="'url(#horizonCircleClip)'">
        <g :transform="`rotate(${-displayRoll}, ${center}, ${center})`">
          <!-- Metade Superior (Céu) -->
          <rect
            :x="center - radius * 2"
            :y="center - radius * 2 + pitchOffset"
            :width="radius * 4"
            :height="radius * 2"
            fill="url(#horizonSkyGradient)"
          />
          <!-- Metade Inferior (Solo) -->
          <rect
            :x="center - radius * 2"
            :y="center + pitchOffset"
            :width="radius * 4"
            :height="radius * 2"
            fill="url(#horizonGroundGradient)"
          />
          <!-- Linha do Horizonte Principal -->
          <line
            :x1="center - radius * 1.5"
            :y1="center + pitchOffset"
            :x2="center + radius * 1.5"
            :y2="center + pitchOffset"
            :stroke="levelColor"
            stroke-width="2.5"
          />

          <!-- Linhas de Passo (Pitch Ladder) -->
          <g stroke="#ffffff" stroke-opacity="0.4" stroke-width="1.5">
            <line :x1="center - 24" :y1="center - 20" :x2="center + 24" :y2="center - 20" />
            <line :x1="center - 14" :y1="center - 40" :x2="center + 14" :y2="center - 40" />
            <line :x1="center - 24" :y1="center + 20" :x2="center + 24" :y2="center + 20" />
            <line :x1="center - 14" :y1="center + 40" :x2="center + 14" :y2="center + 40" />
          </g>
        </g>
      </g>

      <!-- Anel Exterior e Graduações Fixas de Roll -->
      <circle
        :cx="center"
        :cy="center"
        :r="radius - 8"
        fill="none"
        stroke="rgba(255, 255, 255, 0.15)"
        stroke-width="2"
      />
      <circle
        :cx="center"
        :cy="center"
        :r="radius - 2"
        fill="none"
        :stroke="levelColor"
        stroke-width="3"
        class="outer-ring"
      />

      <!-- Marcações angulares fixas: 0°, ±10°, ±20°, ±30°, ±45° -->
      <g class="roll-ticks" stroke="rgba(255, 255, 255, 0.6)" stroke-width="1.5">
        <line :x1="center" :y1="10" :x2="center" :y2="20" stroke="#38bdf8" stroke-width="2.5" />
        <line
          v-for="deg in [-45, -30, -20, -10, 10, 20, 30, 45]"
          :key="deg"
          :x1="center"
          :y1="12"
          :x2="center"
          :y2="18"
          :transform="`rotate(${deg}, ${center}, ${center})`"
        />
      </g>

      <!-- Mira Reticular Central Fixa (Aircraft Reference Symbol) -->
      <g class="central-reticle">
        <!-- Ponto central -->
        <circle :cx="center" :cy="center" r="3.5" :fill="levelColor" />
        <!-- Asas laterais da mira -->
        <path
          :d="`M ${center - 42} ${center} L ${center - 14} ${center} L ${center - 8} ${center + 8}`"
          fill="none"
          :stroke="levelColor"
          stroke-width="3"
          stroke-linecap="round"
        />
        <path
          :d="`M ${center + 42} ${center} L ${center + 14} ${center} L ${center + 8} ${center + 8}`"
          fill="none"
          :stroke="levelColor"
          stroke-width="3"
          stroke-linecap="round"
        />
      </g>
    </svg>

    <!-- Indicador Numérico de Nível -->
    <div class="horizon-badge" :class="badgeClass">
      <span class="badge-icon">{{ isPerfectLevel ? '✓' : Math.abs(displayRoll) <= 3.0 ? '⚠️' : '✕' }}</span>
      <span class="badge-text">
        {{ Math.abs(displayRoll) <= 0.1 ? '0.0° Nivelada' : `${displayRoll > 0 ? '+' : ''}${displayRoll.toFixed(1)}°` }}
      </span>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';

export default {
  name: 'ArtificialHorizon',
  props: {
    rollDeg: {
      type: Number,
      default: 0.0,
    },
    pitchDeg: {
      type: Number,
      default: 0.0,
    },
    targetRoll: {
      type: Number,
      default: 1.0,
    },
    size: {
      type: Number,
      default: 220,
    },
  },
  setup(props) {
    const center = computed(() => props.size / 2);
    const radius = computed(() => props.size / 2);

    const displayRoll = computed(() => {
      if (!Number.isFinite(props.rollDeg)) return 0.0;
      return props.rollDeg;
    });

    const isPerfectLevel = computed(() => Math.abs(displayRoll.value) <= props.targetRoll);

    const levelColor = computed(() => {
      const err = Math.abs(displayRoll.value);
      if (err <= props.targetRoll) return '#10b981'; // Verde Esmeralda
      if (err <= 3.0) return '#f59e0b'; // Âmbar
      return '#ef4444'; // Vermelho
    });

    const badgeClass = computed(() => {
      const err = Math.abs(displayRoll.value);
      if (err <= props.targetRoll) return 'badge-level-perfect';
      if (err <= 3.0) return 'badge-level-warning';
      return 'badge-level-error';
    });

    const pitchOffset = computed(() => {
      // Limitar deslocamento visual vertical
      const maxOffset = props.size * 0.25;
      return Math.max(-maxOffset, Math.min(maxOffset, props.pitchDeg * 2));
    });

    return {
      center,
      radius,
      displayRoll,
      isPerfectLevel,
      levelColor,
      badgeClass,
      pitchOffset,
    };
  },
};
</script>

<style scoped>
.artificial-horizon-container {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  user-select: none;
}

.horizon-svg {
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.45));
}

.outer-ring {
  transition: stroke 0.25s ease;
}

.horizon-badge {
  position: absolute;
  bottom: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 9999px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.82rem;
  font-weight: 700;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  transition: all 0.25s ease;
}

.badge-level-perfect {
  background: rgba(16, 185, 129, 0.25);
  color: #34d399;
  border-color: rgba(16, 185, 129, 0.5);
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.35);
}

.badge-level-warning {
  background: rgba(245, 158, 11, 0.25);
  color: #fbbf24;
  border-color: rgba(245, 158, 11, 0.5);
}

.badge-level-error {
  background: rgba(239, 68, 68, 0.25);
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.5);
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.35);
}
</style>
