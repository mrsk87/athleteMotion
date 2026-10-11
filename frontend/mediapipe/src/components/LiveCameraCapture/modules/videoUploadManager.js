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
      if (this.onTimeUpdate) this.onTimeUpdate(this.currentTime, this.duration);
    };

    this.videoElement.onended = () => {
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
