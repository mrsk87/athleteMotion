<template>
  <div class="timeline-scrubber-ab">
    <div
      ref="trackRef"
      class="scrubber-track-area"
      @click="onTrackClick"
      @mousemove="onTrackMouseMove"
      @mouseleave="hoverTime = null"
    >
      <!-- Faixa destacada do intervalo A-B -->
      <div
        v-if="loopEnabled || (loopA >= 0 && loopB > loopA)"
        class="loop-region-highlight"
        :style="loopRegionStyle"
      ></div>

      <!-- Marcador Ponto A -->
      <div
        v-if="loopA > 0"
        class="loop-marker marker-a"
        :style="{ left: `${percent(loopA)}%` }"
        title="Ponto A (Início)"
      >
        <span>A</span>
      </div>

      <!-- Marcador Ponto B -->
      <div
        v-if="loopB > 0 && loopB < duration"
        class="loop-marker marker-b"
        :style="{ left: `${percent(loopB)}%` }"
        title="Ponto B (Fim)"
      >
        <span>B</span>
      </div>

      <!-- Barra de progresso atual -->
      <div class="progress-bar" :style="{ width: `${percent(currentTime)}%` }"></div>

      <!-- Agulha da cabeça de leitura (Playhead) -->
      <div class="playhead-needle" :style="{ left: `${percent(currentTime)}%` }"></div>

      <!-- Tooltip de tempo sob o cursor -->
      <div
        v-if="hoverTime !== null"
        class="hover-time-tooltip"
        :style="{ left: `${percent(hoverTime)}%` }"
      >
        {{ formatTime(hoverTime) }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  currentTime: {
    type: Number,
    default: 0,
  },
  duration: {
    type: Number,
    default: 1,
  },
  loopA: {
    type: Number,
    default: 0,
  },
  loopB: {
    type: Number,
    default: 0,
  },
  loopEnabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['seek', 'updateLoopA', 'updateLoopB']);
const trackRef = ref(null);
const hoverTime = ref(null);

const percent = (val) => {
  if (!props.duration || props.duration <= 0) return 0;
  return Math.max(0, Math.min(100, (val / props.duration) * 100));
};

const loopRegionStyle = computed(() => {
  const left = percent(props.loopA);
  const right = percent(props.loopB || props.duration);
  const width = Math.max(0, right - left);
  return {
    left: `${left}%`,
    width: `${width}%`,
  };
});

const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return '00:00.00';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 100).toString().padStart(2, '0');
  return `${m}:${s}.${ms}`;
};

const getTimeFromEvent = (e) => {
  if (!trackRef.value || !props.duration) return 0;
  const rect = trackRef.value.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  return ratio * props.duration;
};

const onTrackClick = (e) => {
  const t = getTimeFromEvent(e);
  emit('seek', t);
};

const onTrackMouseMove = (e) => {
  hoverTime.value = getTimeFromEvent(e);
};
</script>

<style scoped>
.timeline-scrubber-ab {
  position: relative;
  width: 100%;
  padding: 8px 0;
  user-select: none;
}
.scrubber-track-area {
  position: relative;
  width: 100%;
  height: 20px;
  background-color: var(--bg-inset, #27272a);
  border: 1px solid var(--border-subtle, #3f3f46);
  border-radius: 4px;
  cursor: pointer;
  overflow: visible;
}
.progress-bar {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background-color: rgba(56, 189, 248, 0.4);
  pointer-events: none;
}
.loop-region-highlight {
  position: absolute;
  top: 0;
  height: 100%;
  background-color: rgba(16, 185, 129, 0.25);
  border-left: 2px solid #10b981;
  border-right: 2px solid #10b981;
  pointer-events: none;
}
.loop-marker {
  position: absolute;
  top: -6px;
  width: 16px;
  height: 16px;
  transform: translateX(-50%);
  border-radius: 50%;
  font-size: 9px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #000;
  z-index: 4;
}
.marker-a {
  background-color: #38bdf8;
}
.marker-b {
  background-color: #f59e0b;
}
.playhead-needle {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 3px;
  background-color: #ef4444;
  transform: translateX(-50%);
  z-index: 5;
  pointer-events: none;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.8);
}
.hover-time-tooltip {
  position: absolute;
  bottom: 24px;
  transform: translateX(-50%);
  background-color: #18181b;
  color: #fff;
  border: 1px solid #3f3f46;
  border-radius: 3px;
  padding: 2px 5px;
  font-size: 10px;
  font-family: monospace;
  pointer-events: none;
  white-space: nowrap;
  z-index: 10;
}
</style>
