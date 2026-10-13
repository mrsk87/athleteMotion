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
    } else {
      loopB.value = currentTime.value;
      loopA.value = Math.max(0, currentTime.value - 1.5);
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
      if (currentTime.value >= loopB.value || currentTime.value < loopA.value - 0.2) {
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
