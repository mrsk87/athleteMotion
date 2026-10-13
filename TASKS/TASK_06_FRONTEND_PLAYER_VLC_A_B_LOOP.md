# TAREFA 06: LEITOR DE VÍDEO AVANÇADO TIPO VLC COM LOOP A-B EM VUE 3

> **Identificador:** `TASK_06_FRONTEND_PLAYER_VLC_A_B_LOOP`  
> **Prioridade:** P0 (Core do Frontend)  
> **Responsabilidade:** Criar o componente de vídeo de alta fidelidade em Vue 3 (Composition API) com upload nativo sem perdas (Blob URL), controlo de timeline, seletor de ciclo contínuo A-B, velocidades lentas (0.1x a 2.0x) e avanço/recuo frame-a-frame exato.

---

## 1. OBJETIVO DA TAREFA
Construir um reprodutor de vídeo de precisão biomecânica estilo VLC:
1. **Reprodução Lossless:** Usa a File API e `URL.createObjectURL` direto no elemento `<video>` HTML5, garantindo que o vídeo original seja renderizado pelo descodificador nativo de hardware sem recompressão nem artefactos de canvas intermediários.
2. **Loop Contínuo A-B:** Barra de progresso interativa com marcadores deslizantes A (início) e B (fim) para isolar e repetir uma única revolução de pedalada continuamente.
3. **Controlo Temporal Cirúrgico:** Velocidades de análise lenta (`0.1x`, `0.25x`, `0.5x`, `1.0x`, `2.0x`) e botões de passo frame-a-frame milimétrico (`+1 frame`, `-1 frame`).

---

## 2. FICHEIROS A CRIAR

1. `frontend/mediapipe/src/components/video/VideoPlayerVLC.vue` (Componente Vue 3 principal)
2. `frontend/mediapipe/src/components/video/TimelineScrubberAB.vue` (Subcomponente de timeline com marcadores A-B)
3. `frontend/mediapipe/src/composables/useVideoPlayback.js` (Composable desacoplado para lógica de reprodução e frame stepping)

---

## 3. COMPOSABLE DE CONTROLO DE VÍDEO (`src/composables/useVideoPlayback.js`)

```javascript
/**
 * Composable para controlo cirúrgico de reprodução de vídeo biomecânico.
 */
import { ref, computed } from 'vue';

export function useVideoPlayback() {
  const videoRef = ref(null);
  const isPlaying = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const playbackRate = ref(1.0);
  const estimatedFps = ref(30.0);

  // Intervalo de Loop A-B
  const loopEnabled = ref(false);
  const loopA = ref(0);
  const loopB = ref(0);

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '00:00.00';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    const ms = Math.floor((seconds % 1) * 100).toString().padStart(2, '0');
    return `${m}:${s}.${ms}`;
  };

  const currentFrame = computed(() => Math.floor(currentTime.value * estimatedFps.value));
  const totalFrames = computed(() => Math.floor(duration.value * estimatedFps.value));

  const setSpeed = (rate) => {
    playbackRate.value = rate;
    if (videoRef.value) {
      videoRef.value.playbackRate = rate;
    }
  };

  const togglePlay = () => {
    if (!videoRef.value) return;
    if (videoRef.value.paused) {
      if (loopEnabled.value && (videoRef.value.currentTime >= loopB.value || videoRef.value.currentTime < loopA.value)) {
        videoRef.value.currentTime = loopA.value;
      }
      videoRef.value.play();
      isPlaying.value = true;
    } else {
      videoRef.value.pause();
      isPlaying.value = false;
    }
  };

  const seekTo = (timeSec) => {
    if (!videoRef.value) return;
    const clamped = Math.max(0, Math.min(duration.value, timeSec));
    videoRef.value.currentTime = clamped;
    currentTime.value = clamped;
  };

  const stepFrame = (deltaFrames) => {
    if (!videoRef.value) return;
    videoRef.value.pause();
    isPlaying.value = false;
    const frameDuration = 1.0 / estimatedFps.value;
    const target = videoRef.value.currentTime + (deltaFrames * frameDuration);
    seekTo(target);
  };

  const setPointA = () => {
    loopA.value = currentTime.value;
    if (loopB.value <= loopA.value) {
      loopB.value = Math.min(duration.value, loopA.value + 1.5);
    }
  };

  const setPointB = () => {
    if (currentTime.value > loopA.value) {
      loopB.value = currentTime.value;
    }
  };

  const toggleLoop = () => {
    loopEnabled.value = !loopEnabled.value;
    if (loopEnabled.value && loopB.value <= loopA.value) {
      loopA.value = 0;
      loopB.value = duration.value;
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.value) return;
    currentTime.value = videoRef.value.currentTime;

    // Lógica estrita do Ciclo A-B
    if (loopEnabled.value && loopB.value > loopA.value) {
      if (currentTime.value >= loopB.value) {
        videoRef.value.currentTime = loopA.value;
      }
    }
  };

  return {
    videoRef,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    estimatedFps,
    loopEnabled,
    loopA,
    loopB,
    currentFrame,
    totalFrames,
    formatTime,
    setSpeed,
    togglePlay,
    seekTo,
    stepFrame,
    setPointA,
    setPointB,
    toggleLoop,
    handleTimeUpdate,
  };
}
```

---

## 4. COMPONENTE COMPLETO (`VideoPlayerVLC.vue`)

Cria `frontend/mediapipe/src/components/video/VideoPlayerVLC.vue`:

```html
<template>
  <div class="vlc-player-container">
    <!-- Zona de Drop / Vídeo Nativo HTML5 -->
    <div class="video-viewport" @dragover.prevent @drop.prevent="handleFileDrop">
      <video
        ref="videoRef"
        class="native-video-element"
        playsinline
        preload="auto"
        @loadedmetadata="onMetadataLoaded"
        @timeupdate="handleTimeUpdate"
        @ended="isPlaying = false"
      ></video>

      <!-- Slot para sobreposição do Canvas Biomecânico -->
      <div class="overlay-layer">
        <slot :currentTime="currentTime" :videoElement="videoRef"></slot>
      </div>

      <!-- Banner de Vídeo Vazio -->
      <div v-if="!hasVideo" class="dropzone-placeholder" @click="triggerFileInput">
        <span class="upload-icon">📁</span>
        <p class="upload-title">Arrasta o ficheiro de vídeo ou clica para carregar</p>
        <p class="upload-hint">Vídeo nativo sem compressão (MP4, MOV, WebM)</p>
        <input ref="fileInputRef" type="file" accept="video/*" class="hidden-input" @change="onFileSelected" />
      </div>
    </div>

    <!-- Barra de Timeline com Seletor A-B -->
    <div v-if="hasVideo" class="player-controls-panel">
      <TimelineScrubberAB
        :currentTime="currentTime"
        :duration="duration"
        :loopA="loopA"
        :loopB="loopB"
        :loopEnabled="loopEnabled"
        @seek="seekTo"
        @updateLoopA="loopA = $event"
        @updateLoopB="loopB = $event"
      />

      <!-- Barra de Botões Estilo VLC -->
      <div class="controls-toolbar">
        <!-- Grupo de Reprodução -->
        <div class="toolbar-group play-group">
          <button class="vlc-btn" :title="isPlaying ? 'Pausa (Espaço)' : 'Reproduzir (Espaço)'" @click="togglePlay">
            {{ isPlaying ? '⏸' : '▶' }}
          </button>
          <button class="vlc-btn" title="Recuar 1 Frame" @click="stepFrame(-1)">⏮ 1f</button>
          <button class="vlc-btn" title="Avançar 1 Frame" @click="stepFrame(1)">1f ⏭</button>
          <span class="time-display">{{ formatTime(currentTime) }} / {{ formatTime(duration) }} (F: {{ currentFrame }})</span>
        </div>

        <!-- Seletor de Velocidades -->
        <div class="toolbar-group speed-group">
          <span class="group-label">Velocidade:</span>
          <button
            v-for="s in [0.1, 0.25, 0.5, 1.0, 2.0]"
            :key="s"
            class="speed-btn"
            :class="{ active: playbackRate === s }"
            @click="setSpeed(s)"
          >
            {{ s }}x
          </button>
        </div>

        <!-- Grupo de Ciclo Contínuo A-B -->
        <div class="toolbar-group loop-group">
          <button class="vlc-btn" :class="{ 'btn-accent': loopA > 0 }" title="Definir Início da Pedalada (Ponto A)" @click="setPointA">
            [ A: {{ formatTime(loopA) }}
          </button>
          <button class="vlc-btn" :class="{ 'btn-accent': loopB > 0 }" title="Definir Fim da Pedalada (Ponto B)" @click="setPointB">
            B: {{ formatTime(loopB) }} ]
          </button>
          <button
            class="vlc-btn loop-toggle-btn"
            :class="{ active: loopEnabled }"
            title="Ativar/Desativar Loop Contínuo da Pedalada"
            @click="toggleLoop"
          >
            🔁 Loop {{ loopEnabled ? 'ATIVO' : 'OFF' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useVideoPlayback } from '../../composables/useVideoPlayback';
import TimelineScrubberAB from './TimelineScrubberAB.vue';

const {
  videoRef,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  loopEnabled,
  loopA,
  loopB,
  currentFrame,
  formatTime,
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
let blobUrl = null;

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
  if (file) loadBlob(file);
};

const handleFileDrop = (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file && file.type.startsWith('video/')) loadBlob(file);
};

const triggerFileInput = () => fileInputRef.value?.click();

const onMetadataLoaded = () => {
  if (videoRef.value) {
    duration.value = videoRef.value.duration || 1;
    loopA.value = 0;
    loopB.value = duration.value;
  }
};

// Atalhos de teclado ergonómicos
const handleKeydown = (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    stepFrame(-1);
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    stepFrame(1);
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  if (blobUrl) URL.revokeObjectURL(blobUrl);
});
</script>

<style scoped>
.vlc-player-container {
  display: flex;
  flex-direction: column;
  background-color: var(--bg-surface-2, #18181b);
  border: 1px solid var(--border-subtle, #27272a);
  border-radius: 8px;
  overflow: hidden;
}
.video-viewport {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background-color: #000;
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
  background-color: rgba(24, 24, 27, 0.9);
  color: #fff;
}
.hidden-input {
  display: none;
}
.player-controls-panel {
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.controls-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.vlc-btn {
  background: var(--bg-inset, #27272a);
  color: #fff;
  border: 1px solid var(--border, #3f3f46);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}
.vlc-btn:hover {
  background: #3f3f46;
}
.speed-btn {
  background: transparent;
  border: 1px solid var(--border, #3f3f46);
  color: #a1a1aa;
  padding: 3px 6px;
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
}
.speed-btn.active {
  background: #10b981;
  color: #000;
  font-weight: 700;
  border-color: #10b981;
}
.loop-toggle-btn.active {
  background: #38bdf8;
  color: #000;
  font-weight: 700;
}
.time-display {
  font-family: monospace;
  font-size: 12px;
  color: #a1a1aa;
  margin-left: 6px;
}
</style>
```

---

## 5. SUBCOMPONENTE DE TIMELINE A-B (`TimelineScrubberAB.vue`)

Cria `frontend/mediapipe/src/components/video/TimelineScrubberAB.vue` que desenha a barra de progresso horizontal e permite arrastar os cursores de A e B:
- Linha de base da duração total.
- Faixa colorida entre $A$ e $B$ com handles clicáveis/arrastáveis.
- Eventos `@seek(sec)`, `@updateLoopA(sec)` e `@updateLoopB(sec)`.

---

## 6. CRITÉRIOS DE ACEITAÇÃO
1. Arrastar um vídeo para o reprodutor reproduz o ficheiro original em qualidade nativa sem passar por exportação ou compressão.
2. Definir Ponto A em 2.0s e Ponto B em 4.0s com Loop ativo faz o vídeo reiniciar imediatamente em 2.0s quando atinge 4.0s.
3. Botões de 1f avançam rigorosamente `1 / 30` de segundo a cada clique, permitindo parar o ciclista no ponto morto inferior exato.
