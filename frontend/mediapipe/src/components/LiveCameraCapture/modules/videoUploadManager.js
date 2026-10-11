/**
 * Gestor de Ficheiros de Vídeo Carregados (VideoUploadManager).
 *
 * Responsabilidade:
 * - Gerir o upload de ficheiros de vídeo locais (MP4, MOV, WebM, etc.).
 * - Controlar a reprodução (play, pause, seek, velocidade lenta 0.25x / 0.5x).
 * - Sincronizar o progresso temporal para a inferência e análise biomecânica.
 */

export class VideoUploadManager {
  constructor({ onTimeUpdate, onVideoLoaded, onEnded, onPlayStateChange }) {
    this.videoElement = null;
    this.videoFile = null;
    this.videoUrl = null;
    this.fileName = '';
    this.fileSizeMb = 0;
    this.duration = 0;
    this.currentTime = 0;
    this.isPlaying = false;
    this.playbackRate = 1.0;

    // Intervalo de repetição contínua (Loop A-B)
    this.loopStart = 0;
    this.loopEnd = 0;
    this.loopEnabled = false;

    this.onTimeUpdate = onTimeUpdate;
    this.onVideoLoaded = onVideoLoaded;
    this.onEnded = onEnded;
    this.onPlayStateChange = onPlayStateChange;
  }

  /**
   * Associa o elemento <video> do componente e regista event listeners.
   */
  attachVideo(videoElement) {
    this.videoElement = videoElement;
    if (!videoElement) return;

    this.videoElement.onloadedmetadata = () => {
      this.duration = this.videoElement.duration || 0;
      if (this.onVideoLoaded) this.onVideoLoaded(this.duration);
    };

    this.videoElement.ontimeupdate = () => {
      this.currentTime = this.videoElement.currentTime || 0;

      // Execução do Loop A-B automático no intervalo definido
      if (this.loopEnabled && this.loopEnd > this.loopStart) {
        if (this.currentTime >= this.loopEnd || this.currentTime < this.loopStart - 0.25) {
          this.seekTo(this.loopStart);
          return;
        }
      }

      if (this.onTimeUpdate) this.onTimeUpdate(this.currentTime, this.duration);
    };

    this.videoElement.onended = () => {
      if (this.loopEnabled && this.loopEnd > this.loopStart) {
        this.seekTo(this.loopStart);
        this.play();
        return;
      }
      this.isPlaying = false;
      if (this.onPlayStateChange) this.onPlayStateChange(false);
      if (this.onEnded) this.onEnded();
    };

    this.videoElement.onplay = () => {
      this.isPlaying = true;
      if (this.onPlayStateChange) this.onPlayStateChange(true);
    };

    this.videoElement.onpause = () => {
      this.isPlaying = false;
      if (this.onPlayStateChange) this.onPlayStateChange(false);
    };
  }

  setLoopPointA(timeSeconds) {
    this.loopStart = Math.max(0, Math.min(timeSeconds, this.duration));
    if (this.loopEnd <= this.loopStart) {
      this.loopEnd = Math.min(this.duration, this.loopStart + 2.0);
    }
    this.loopEnabled = true;
  }

  setLoopPointB(timeSeconds) {
    this.loopEnd = Math.max(this.loopStart + 0.2, Math.min(timeSeconds, this.duration));
    this.loopEnabled = true;
  }

  toggleLoop(enabled) {
    this.loopEnabled = typeof enabled === 'boolean' ? enabled : !this.loopEnabled;
    if (this.loopEnabled && (this.currentTime < this.loopStart || this.currentTime >= this.loopEnd)) {
      this.seekTo(this.loopStart);
    }
  }

  clearLoop() {
    this.loopEnabled = false;
    this.loopStart = 0;
    this.loopEnd = 0;
  }

  /**
   * Carrega um ficheiro de vídeo selecionado pelo utilizador.
   */
  loadVideoFile(file) {
    if (!file || !this.videoElement) return false;

    if (this.videoUrl) {
      URL.revokeObjectURL(this.videoUrl);
    }

    this.videoFile = file;
    this.fileName = file.name;
    this.fileSizeMb = Math.round((file.size / (1024 * 1024)) * 10) / 10;
    this.videoUrl = URL.createObjectURL(file);

    this.videoElement.src = this.videoUrl;
    this.videoElement.playbackRate = this.playbackRate;
    this.videoElement.load();
    return true;
  }

  togglePlay() {
    if (!this.videoElement) return;
    if (this.videoElement.paused || this.videoElement.ended) {
      this.videoElement.play().catch(() => {});
    } else {
      this.videoElement.pause();
    }
  }

  pause() {
    if (this.videoElement && !this.videoElement.paused) {
      this.videoElement.pause();
    }
  }

  play() {
    if (this.videoElement && this.videoElement.paused) {
      this.videoElement.play().catch(() => {});
    }
  }

  seekTo(seconds) {
    if (!this.videoElement) return;
    const target = Math.max(0, Math.min(seconds, this.duration));
    this.videoElement.currentTime = target;
    this.currentTime = target;
  }

  seekRelative(deltaSeconds) {
    if (!this.videoElement) return;
    this.seekTo((this.videoElement.currentTime || 0) + deltaSeconds);
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate;
    if (this.videoElement) {
      this.videoElement.playbackRate = rate;
    }
  }

  cleanup() {
    if (this.videoUrl) {
      URL.revokeObjectURL(this.videoUrl);
      this.videoUrl = null;
    }
    this.videoFile = null;
    this.fileName = '';
    this.duration = 0;
    this.currentTime = 0;
    this.isPlaying = false;
  }
}
