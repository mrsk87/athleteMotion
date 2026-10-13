<template>
  <div class="vlc-player-container" :class="['size-' + currentPresetId, { 'is-expanded-stage': isExpandedStage }]">
    <div class="vlc-main-grid" :class="{ 'layout-expanded': isExpandedStage }">
      <!-- Coluna Principal (Esquerda): Palco de Vídeo + VideoScrubberBar Completo -->
      <div class="video-stage-column">
        <!-- Barra Superior do Palco com Controlo Completo de Dimensão Real -->
        <div class="video-stage-header">
          <div class="stage-info">
            <span class="stage-badge">🎥 Palco de Análise</span>
            <span v-if="hasVideo && videoResolutionText" class="video-res-indicator">
              {{ videoResolutionText }} · {{ isVerticalVideo ? '📱 Vertical' : '🖥️ Horizontal' }}
            </span>
          </div>

          <!-- Ações do Palco: Fotografia do fotograma sem HUD -->
          <div class="stage-actions-cluster">
            <button
              v-if="hasVideo"
              type="button"
              class="btn-stage-photo"
              title="Guardar o fotograma atual sem HUD nem esqueleto (atalho: P)"
              @click="capturePhoto"
            >
              📸 Foto (sem HUD)
            </button>
          </div>

          <!-- Controlo Dinâmico de Tamanho / Zoom com Botões [-] e [+] e Predefinições -->
          <div class="size-controls-cluster">
            <span class="size-label">Altura:</span>

            <!-- Botões Rápidos de Aumentar / Diminuir -->
            <div class="size-stepper-box">
              <button
                type="button"
                class="btn-size-step"
                title="Diminuir altura do vídeo (-60px)"
                @click="stepHeight(-60)"
              >
                ➖
              </button>
              <span class="size-val-display" title="Altura atual do palco">{{ displayHeightText }}</span>
              <button
                type="button"
                class="btn-size-step"
                title="Aumentar altura do vídeo (+60px)"
                @click="stepHeight(60)"
              >
                ➕
              </button>
            </div>

            <!-- Controlo Real de Largura (zoom do vídeo) -->
            <div class="size-stepper-box">
              <button
                type="button"
                class="btn-size-step"
                title="Diminuir largura do vídeo (-25%)"
                @click="stepZoom(-ZOOM_STEP_PERCENT)"
              >
                ➖
              </button>
              <span class="size-val-display" title="Largura do vídeo face à coluna do palco">
                {{ zoomPercent }}%
              </span>
              <button
                type="button"
                class="btn-size-step"
                title="Aumentar largura do vídeo (+25%)"
                @click="stepZoom(ZOOM_STEP_PERCENT)"
              >
                ➕
              </button>
            </div>

            <!-- Predefinições Rápidas de Largura -->
            <div class="size-pill-group">
              <button
                v-for="zoomPreset in zoomPresets"
                :key="'z' + zoomPreset"
                type="button"
                class="size-pill-btn"
                :class="{ active: zoomPercent === zoomPreset }"
                :title="`Largura do vídeo a ${zoomPreset}% da coluna`"
                @click="applyZoom(zoomPreset)"
              >
                {{ zoomPreset }}%
              </button>
              <button
                type="button"
                class="size-pill-btn"
                title="Ajustar a largura ao espaço disponível"
                @click="fitStageWidth"
              >
                Ajustar
              </button>
            </div>

            <!-- Predefinições Rápidas de Altura -->
            <div class="size-pill-group">
              <button
                v-for="preset in sizePresets"
                :key="preset.id"
                type="button"
                class="size-pill-btn"
                :class="{ active: currentPresetId === preset.id }"
                :title="preset.hint"
                @click="applyPreset(preset)"
              >
                {{ preset.label }}
              </button>
            </div>

            <!-- Botão de Alternar Modo Expandido / Lado a Lado -->
            <button
              type="button"
              class="btn-stage-expand"
              :class="{ 'is-expanded': isExpandedStage }"
              :title="isExpandedStage ? 'Voltar ao layout lado a lado com painel lateral' : 'Expandir vídeo para largura total'"
              @click="toggleExpandedStage"
            >
              {{ isExpandedStage ? '🗗 Lado a Lado' : '⛶ Expandir' }}
            </button>
          </div>
        </div>

        <!-- Zona do Vídeo Viewport: altura do palco + largura (zoom) independentes -->
        <div
          class="video-viewport-wrapper"
          :class="{ 'is-zoomed': zoomPercent !== 100 }"
          :style="{
            minHeight: '260px',
            height: computedWrapperHeight,
            maxHeight: computedWrapperHeight,
          }"
        >
          <div
            class="video-viewport"
            :style="{
              aspectRatio: videoAspectRatio,
              width: zoomPercent + '%',
            }"
            @dragover.prevent
            @drop.prevent="handleFileDrop"
          >
            <video
              ref="videoRef"
              class="native-video-element"
              playsinline
              preload="auto"
              @loadedmetadata="onMetadataLoaded"
              @timeupdate="onTimeUpdate"
              @ended="onVideoEnded"
            ></video>

            <!-- Slot para sobreposição do Canvas Biomecânico -->
            <div class="overlay-layer">
              <slot :currentTime="currentTime" :videoElement="videoRef"></slot>
            </div>

            <!-- Confirmação discreta (aparece e desaparece) da fotografia guardada -->
            <div v-if="photoToastText" class="photo-toast">{{ photoToastText }}</div>

            <!-- Banner de Vídeo Vazio -->
            <div v-if="!hasVideo" class="dropzone-placeholder" @click="triggerFileInput">
              <span class="upload-icon">📁</span>
              <p class="upload-title">Arrasta o ficheiro de vídeo ou clica para carregar</p>
              <p class="upload-hint">Vídeo nativo sem compressão (MP4, MOV, WebM)</p>
            </div>
          </div>
        </div>

        <!-- Input de ficheiro sempre disponível no DOM -->
        <input ref="fileInputRef" type="file" accept="video/*" class="hidden-input" @change="onFileSelected" />

        <!-- PLAYER COMPLETO IDÊNTICO À BANCADA DIRECTML COM O RELÓGIO DIGITAL GRANDE -->
        <div v-if="hasVideo" class="scrubber-bar-container">
          <VideoScrubberBar
            :videoDuration="duration"
            :videoCurrentTime="currentTime"
            :formattedVideoTime="formattedVideoTime"
            :formattedDuration="formattedDuration"
            :isVideoPlaying="isPlaying"
            :videoPlaybackRate="playbackRate"
            :hasLoopRange="hasLoopRange"
            :loopRange="loopRangeObj"
            :loopRangeLabel="loopRangeLabel"
            :isInfiniteLoopActive="isInfiniteLoopActive"
            :autoSlowdownEnabled="autoSlowdownEnabled"
            @seek="doSeek"
            @toggle-play="togglePlay"
            @seek-relative="onSeekRelative"
            @step-range-frame="doStepFrame"
            @set-speed="setSpeed"
            @toggle-slowdown="autoSlowdownEnabled = !autoSlowdownEnabled"
            @toggle-loop="toggleLoop"
            @toggle-infinite-loop="toggleInfiniteLoop"
            @set-loop-from-current="onSetLoopFromCurrent"
            @clear-loop="clearLoop"
            @trigger-file="triggerFileInput"
          />
        </div>
      </div>

      <!-- Coluna Direita (Sidebar): Definições do Motor, Ciclista e Telemetria -->
      <div class="controls-sidebar-column">
        <!-- Slot Superior: Definições do Motor & Sessão -->
        <slot name="sidebar-top"></slot>

        <!-- Slot Inferior: Telemetria & Ângulos em Tempo Real -->
        <slot name="sidebar-bottom" :currentTime="currentTime"></slot>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useVideoPlayback } from '../../composables/useVideoPlayback';
import VideoScrubberBar from '../LiveCameraCapture/components/VideoScrubberBar/VideoScrubberBar.vue';

defineProps({
  initialSize: {
    type: String,
    default: 'medium',
  },
  layout: {
    type: String,
    default: 'split',
  },
});

const emit = defineEmits([
  'timeupdate',
  'loadedmetadata',
  'videoLoaded',
  'seeked',
  'sizechange',
  'ended',
  'photo',
]);

const {
  videoRef,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  loopEnabled,
  loopA,
  loopB,
  setSpeed,
  togglePlay,
  seekTo,
  stepFrame,
  setPointA,
  setPointB,
  toggleLoop,
  handleTimeUpdate,
} = useVideoPlayback();

const fileInputRef = ref(null);
const hasVideo = ref(false);
const isInfiniteLoopActive = ref(true);
const autoSlowdownEnabled = ref(false);
let blobUrl = null;

// Altura do Palco & Predefinições Reativas
const savedHeight = parseInt(localStorage.getItem('vlc_stage_height') || '0', 10);
const savedExpanded = localStorage.getItem('vlc_stage_expanded') === 'true';
const savedPreset = localStorage.getItem('vlc_stage_preset');

const customHeight = ref(savedHeight > 300 ? savedHeight : 720);
const currentPresetId = ref(savedPreset || 'medium');
const isExpandedStage = ref(savedExpanded);

/** Largura do vídeo em percentagem da coluna do palco (aumenta/diminui o vídeo a sério). */
const MIN_ZOOM_PERCENT = 50;
const MAX_ZOOM_PERCENT = 300;
/** Passo do controlo ➖/➕ (o mesmo mostrado nos botões do template). */
const ZOOM_STEP_PERCENT = 25;
const zoomPresets = [100, 125, 150, 200];
const savedZoom = parseInt(localStorage.getItem('vlc_stage_zoom') || '0', 10);
const zoomPercent = ref(
  Number.isFinite(savedZoom) && savedZoom >= MIN_ZOOM_PERCENT && savedZoom <= MAX_ZOOM_PERCENT
    ? savedZoom
    : 100
);

const stepZoom = (delta) => {
  const next = Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, zoomPercent.value + delta));
  zoomPercent.value = next;
  saveHeightPref();
};

const applyZoom = (percent) => {
  zoomPercent.value = Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, percent));
  saveHeightPref();
};

/** "Ajustar": volta a 100% (largura da coluna) e abre o palco à largura disponível. */
const fitStageWidth = () => {
  zoomPercent.value = 100;
  isExpandedStage.value = true;
  saveHeightPref();
};

const isVerticalVideo = computed(() => {
  const v = videoRef.value;
  return Boolean(v && v.videoHeight && v.videoWidth && v.videoHeight > v.videoWidth);
});

const sizePresets = [
  { id: 'small', label: 'P (500px)', height: 500, hint: 'Tamanho Compacto (500px)' },
  { id: 'medium', label: 'M (680px)', height: 680, hint: 'Tamanho Médio (680px)' },
  { id: 'large', label: 'G (840px)', height: 840, hint: 'Tamanho Grande (840px)' },
  { id: 'xlarge', label: 'XL (980px)', height: 980, hint: 'Tamanho Extra Grande (980px)' },
  { id: 'xxlarge', label: 'XXL (1400px)', height: 1400, hint: 'Tamanho Muito Grande (1400px)' },
  { id: 'fit', label: 'Ecrã ⛶', height: 'fit', hint: 'Ajustar à Altura Máxima do Ecrã' },
];

/** Limites do palco: o teto era 1300 px e ficava pequeno em ecrãs grandes. */
const STAGE_MIN_HEIGHT_PX = 320;
const STAGE_MAX_HEIGHT_PX = 2200;

const displayHeightText = computed(() => {
  if (currentPresetId.value === 'fit') return 'Ecrã ⛶';
  return `${customHeight.value}px`;
});

const computedWrapperHeight = computed(() => {
  if (currentPresetId.value === 'fit') {
    return 'calc(100vh - 200px)';
  }
  return `${customHeight.value}px`;
});

const stepHeight = (delta) => {
  let next = customHeight.value + delta;
  if (currentPresetId.value === 'fit') {
    next = 840 + delta;
  }
  next = Math.max(STAGE_MIN_HEIGHT_PX, Math.min(STAGE_MAX_HEIGHT_PX, next));
  customHeight.value = next;
  currentPresetId.value = 'custom';
  saveHeightPref();
};

const applyPreset = (preset) => {
  currentPresetId.value = preset.id;
  if (preset.height !== 'fit') {
    customHeight.value = preset.height;
  }
  saveHeightPref();
};

const toggleExpandedStage = () => {
  isExpandedStage.value = !isExpandedStage.value;
  saveHeightPref();
};

const saveHeightPref = () => {
  try {
    localStorage.setItem('vlc_stage_height', String(customHeight.value));
    localStorage.setItem('vlc_stage_preset', currentPresetId.value);
    localStorage.setItem('vlc_stage_expanded', isExpandedStage.value ? 'true' : 'false');
    localStorage.setItem('vlc_stage_zoom', String(zoomPercent.value));
  } catch (err) {
    // quota
  }
  emit('sizechange', currentPresetId.value);
};

/* ------------------------------------------------------------------ */
/* Fotografia do fotograma ATUAL sem HUD nem esqueleto ("print" limpo) */
/* ------------------------------------------------------------------ */
const photoToastText = ref('');
let photoToastTimer = null;

const showPhotoToast = (text) => {
  photoToastText.value = text;
  clearTimeout(photoToastTimer);
  photoToastTimer = setTimeout(() => {
    photoToastText.value = '';
  }, 2600);
};

/**
 * Captura o fotograma em reprodução na resolução NATIVA do vídeo, sem qualquer camada
 * de interface (o canvas do esqueleto e o HUD vivem em elementos separados, por isso não
 * entram na imagem) e transfere-o como JPEG.
 *
 * @returns {Promise<{blob: Blob, filename: string, time: number, width: number, height: number}|null>}
 */
const capturePhoto = async () => {
  const video = videoRef.value;
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    showPhotoToast('Sem fotograma disponível para guardar.');
    return null;
  }

  const width = video.videoWidth;
  const height = video.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;

  try {
    // Só a imagem do vídeo: nenhum overlay, nenhum HUD, nenhuma marca é desenhada aqui.
    ctx.drawImage(video, 0, 0, width, height);
  } catch (err) {
    showPhotoToast('Não foi possível ler o fotograma.');
    return null;
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) {
    showPhotoToast('Não foi possível gerar a imagem.');
    return null;
  }

  const stamp = formatTimeVSC(video.currentTime).replace(':', 'm').replace('.', 's');
  const filename = `athlete-motion-foto-${stamp}.jpg`;

  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showPhotoToast(`📸 Foto guardada (${width}×${height}) · sem HUD`);
  } catch (err) {
    showPhotoToast('O browser impediu a transferência da foto.');
  }

  const result = { blob, filename, time: video.currentTime, width, height };
  emit('photo', { filename, time: result.time, width, height });
  return result;
};

// Se detetar que um vídeo carregado é vertical e o tamanho for pequeno, eleva automaticamente
watch(isVerticalVideo, (vertical) => {
  if (vertical && customHeight.value < 720 && currentPresetId.value !== 'fit') {
    customHeight.value = 840;
    currentPresetId.value = 'large';
    saveHeightPref();
  }
});

// Formatação do Relógio Digital mm:ss.d exatamente como no VideoScrubberBar
const formatTimeVSC = (seconds) => {
  if (!seconds || isNaN(seconds) || seconds < 0) return '00:00.0';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const tenths = Math.floor((seconds % 1) * 10);
  return `${m}:${s}.${tenths}`;
};

const formattedVideoTime = computed(() => formatTimeVSC(currentTime.value));
const formattedDuration = computed(() => formatTimeVSC(duration.value));

const hasLoopRange = computed(() => {
  return loopEnabled.value && loopB.value > loopA.value;
});

const loopRangeObj = computed(() => ({
  start: loopA.value,
  end: loopB.value || duration.value,
  enabled: loopEnabled.value,
}));

const loopRangeLabel = computed(() => {
  if (!hasLoopRange.value) return '';
  return `${formatTimeVSC(loopA.value)} → ${formatTimeVSC(loopB.value || duration.value)}`;
});

const onSeekRelative = (deltaSec) => {
  const target = Math.max(0, Math.min(duration.value, currentTime.value + deltaSec));
  seekTo(target);
  emit('seeked', { currentTime: currentTime.value, duration: duration.value });
};

const onSetLoopFromCurrent = (point) => {
  if (point === 'A') {
    setPointA();
    loopEnabled.value = true;
  } else if (point === 'B') {
    setPointB();
    loopEnabled.value = true;
  }
};

const clearLoop = () => {
  loopA.value = 0;
  loopB.value = duration.value;
  loopEnabled.value = false;
};

const toggleInfiniteLoop = () => {
  isInfiniteLoopActive.value = !isInfiniteLoopActive.value;
};

const onVideoEnded = () => {
  if (isInfiniteLoopActive.value && videoRef.value) {
    videoRef.value.currentTime = 0;
    videoRef.value.play();
    return;
  }
  isPlaying.value = false;
  emit('ended');
};

const videoResolutionText = computed(() => {
  const v = videoRef.value;
  if (!v || !v.videoWidth || !v.videoHeight) return '';
  return `${v.videoWidth}x${v.videoHeight}`;
});

const videoAspectRatio = computed(() => {
  const v = videoRef.value;
  if (!v || !v.videoWidth || !v.videoHeight) return '16 / 9';
  return `${v.videoWidth} / ${v.videoHeight}`;
});

const onTimeUpdate = (e) => {
  handleTimeUpdate(e);
  // Reinício suave se o ciclo infinito estiver ativo e o loop A-B não estiver ativo
  if (isInfiniteLoopActive.value && videoRef.value && !loopEnabled.value) {
    if (videoRef.value.currentTime >= duration.value - 0.05 && duration.value > 0) {
      videoRef.value.currentTime = 0;
      if (!videoRef.value.paused) {
        videoRef.value.play();
      }
    }
  }
  emit('timeupdate', { currentTime: currentTime.value, duration: duration.value });
};

const doSeek = (targetSec) => {
  seekTo(targetSec);
  emit('seeked', { currentTime: currentTime.value, duration: duration.value });
};

const doStepFrame = (delta) => {
  stepFrame(delta);
  emit('seeked', { currentTime: currentTime.value, duration: duration.value });
};


const loadBlob = (file) => {
  if (!file) return;
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(file);
  if (videoRef.value) {
    videoRef.value.src = blobUrl;
    videoRef.value.load();
    hasVideo.value = true;
  }
};

const onFileSelected = (e) => {
  const file = e.target.files?.[0];
  if (file) {
    loadBlob(file);
    emit('videoLoaded', file);
  }
  if (e.target) e.target.value = '';
};

const handleFileDrop = (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file && file.type.startsWith('video/')) {
    loadBlob(file);
    emit('videoLoaded', file);
  }
};

const triggerFileInput = () => fileInputRef.value?.click();

const onMetadataLoaded = () => {
  if (videoRef.value) {
    duration.value = videoRef.value.duration || 1;
    loopA.value = 0;
    loopB.value = duration.value;
    emit('loadedmetadata', { duration: duration.value });
  }
};

defineExpose({
  videoRef,
  isPlaying,
  currentTime,
  duration,
  hasVideo,
  currentSize: currentPresetId,
  setSize: (sizeId) => {
    const found = sizePresets.find((p) => p.id === sizeId);
    if (found) applyPreset(found);
  },
  customHeight,
  isExpandedStage,
  triggerFileInput,
  loadBlob,
  seekTo: doSeek,
  togglePlay,
  stepFrame: doStepFrame,
  capturePhoto,
  zoomPercent,
  setZoom: applyZoom,
});

// Atalhos de teclado ergonómicos
const handleKeydown = (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    doStepFrame(-1);
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    doStepFrame(1);
  } else if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    capturePhoto();
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  clearTimeout(photoToastTimer);
  if (blobUrl) URL.revokeObjectURL(blobUrl);
});
</script>

<style scoped>
.vlc-player-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}

.vlc-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 16px;
  align-items: start;
  transition: grid-template-columns 0.25s ease;
}

.vlc-main-grid.layout-expanded {
  grid-template-columns: 1fr;
}

/* Ecrã total: o palco escapa ao limite de largura da aplicação (1240 px). */
.vlc-player-container.is-expanded-stage {
  width: min(calc(100vw - 24px), 1920px);
  margin-inline: auto;
  /*
   * O modo expandido tem de escapar à largura máxima da página (1240px). Não basta aumentar a
   * largura: dentro de um contentor de 1240px centrado, o palco largo sairia desalinhado para a
   * direita. A margem esquerda leva o palco ao centro do VIEWPORT (50% da página + metade da largura
   * própria), mantendo-o centrado em qualquer monitor.
   */
  margin-left: calc(50% - min(50vw - 12px, 960px));
  box-sizing: border-box;
}

/* Ações do palco (fotografia do fotograma sem HUD) */
.stage-actions-cluster {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-stage-photo {
  background-color: var(--bg-inset, #27272a);
  color: var(--text-1, #f4f4f5);
  border: 1px solid var(--border, #3f3f46);
  border-radius: var(--radius-sm, 4px);
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.btn-stage-photo:hover {
  background-color: var(--bg-hover, #3f3f46);
  border-color: var(--border-strong, #52525b);
}

/* Confirmação discreta da fotografia guardada, dentro do palco mas fora do vídeo */
.photo-toast {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  background-color: rgba(var(--scrim-rgb, 0, 0, 0), 0.82);
  color: var(--text-1, #f4f4f5);
  border: 1px solid var(--border-subtle, #27272a);
  border-radius: var(--radius-pill, 999px);
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
  z-index: 14;
}

@media (max-width: 1120px) {
  .vlc-main-grid {
    grid-template-columns: 1fr;
  }
}

/* Coluna Esquerda: Palco de Vídeo + VideoScrubberBar */
.video-stage-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  width: 100%;
}

.video-stage-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--bg-surface-2, #18181b);
  border: 1px solid var(--border-subtle, #27272a);
  border-radius: 8px;
  padding: 8px 12px;
  gap: 10px;
  flex-wrap: wrap;
}

.stage-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stage-badge {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
}

.video-res-indicator {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: #27272a;
  color: #38bdf8;
  font-family: monospace;
  font-weight: 600;
}

.size-controls-cluster {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.size-label {
  font-size: 11px;
  color: #a1a1aa;
  font-weight: 600;
}

.size-stepper-box {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--bg-inset, #09090b);
  border: 1px solid var(--border-subtle, #27272a);
  border-radius: 6px;
  padding: 2px 4px;
}

.btn-size-step {
  background: transparent;
  border: none;
  color: #fff;
  font-size: 11px;
  padding: 2px 6px;
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.15s;
}

.btn-size-step:hover {
  background-color: rgba(255, 255, 255, 0.15);
}

.size-val-display {
  font-size: 11px;
  font-weight: 700;
  color: #38bdf8;
  font-family: monospace;
  padding: 0 4px;
  min-width: 48px;
  text-align: center;
}

.size-pill-group {
  display: flex;
  align-items: center;
  gap: 3px;
  background: var(--bg-inset, #09090b);
  padding: 2px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle, #27272a);
}

.size-pill-btn {
  background: transparent;
  border: none;
  color: #a1a1aa;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.size-pill-btn:hover {
  color: #fff;
  background-color: rgba(255, 255, 255, 0.08);
}

.size-pill-btn.active {
  background-color: #38bdf8;
  color: #000;
  font-weight: 800;
}

.btn-stage-expand {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-inset, #09090b);
  border: 1px solid var(--border-subtle, #27272a);
  color: #a1a1aa;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-stage-expand:hover {
  color: #fff;
  border-color: #38bdf8;
}

.btn-stage-expand.is-expanded {
  background-color: rgba(56, 189, 248, 0.15);
  border-color: #38bdf8;
  color: #38bdf8;
}

.btn-stage-photo,
.btn-stage-snapshot {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-inset, #09090b);
  border: 1px solid var(--border-subtle, #27272a);
  color: #f4f4f5;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-stage-photo:hover:not(:disabled),
.btn-stage-snapshot:hover:not(:disabled) {
  color: #38bdf8;
  border-color: #38bdf8;
  background-color: rgba(56, 189, 248, 0.1);
}

.btn-stage-photo:disabled,
.btn-stage-snapshot:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.video-viewport-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: #000;
  border: 1px solid var(--border-subtle, #27272a);
  border-radius: 8px;
  padding: 6px;
  overflow: auto;
  box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.6);
  transition: height 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Com zoom, o vídeo passa a ser maior que o palco: alinha ao topo e deixa deslizar. */
.video-viewport-wrapper.is-zoomed {
  align-items: flex-start;
  justify-content: flex-start;
}

.video-viewport {
  position: relative;
  flex: 0 0 auto;
  /* A altura segue o rácio real do vídeo (16:9, 9:16, 4:3) e a largura vem do zoom. */
  max-width: none;
  height: auto;
  margin: 0 auto;
  background-color: #000;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.native-video-element {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.overlay-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.dropzone-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background-color: rgba(24, 24, 27, 0.95);
  color: #fff;
  transition: background-color 0.15s;
}

.dropzone-placeholder:hover {
  background-color: rgba(39, 39, 42, 0.95);
}

.upload-icon {
  font-size: 36px;
  margin-bottom: 8px;
}

.upload-title {
  font-size: 14px;
  font-weight: 700;
  margin: 0;
}

.upload-hint {
  font-size: 12px;
  color: #a1a1aa;
  margin: 4px 0 0 0;
}

.hidden-input {
  display: none;
}

.scrubber-bar-container {
  width: 100%;
}

/* Coluna Direita: Sidebar */
.controls-sidebar-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
</style>
