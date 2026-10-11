/**
 * Gestor de Ficheiros de Vídeo Carregados (VideoUploadManager).
 *
 * Responsabilidade:
 * - Gerir o upload de ficheiros de vídeo locais (MP4, MOV, WebM, etc.).
 * - Controlar a reprodução no sentido normal (forward) e no sentido oposto / marcha-atrás (reverse).
 * - Sincronizar o progresso temporal para a inferência e análise biomecânica com alta precisão.
 */

export class VideoUploadManager {
  constructor({ onTimeUpdate, onVideoLoaded, onEnded, onPlayStateChange, onDirectionChange, onAutoSlowdownChange }) {
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

    // Sentido de reprodução temporal (Marcha-Atrás / Reverse)
    this.playbackDirection = 'forward'; // 'forward' | 'reverse'
    this.isReversePlaying = false;
    this.reverseAnimFrameId = null;
    this.lastReverseTime = null;
    this.wasPlayingBeforeScrub = false;
    this.wasReverseBeforeScrub = false;

    // Auto-Slowdown Inteligente para Análise Rigorosa no Movimento
    this.autoSlowdownEnabled = false;
    this.autoSlowdownSpeed = 0.25;
    this.isSlowedDownByMotion = false;
    this.userBasePlaybackRate = 1.0;

    this.onTimeUpdate = onTimeUpdate;
    this.onVideoLoaded = onVideoLoaded;
    this.onEnded = onEnded;
    this.onPlayStateChange = onPlayStateChange;
    this.onDirectionChange = onDirectionChange;
    this.onAutoSlowdownChange = onAutoSlowdownChange;
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
      // Se a marcha-atrás manual estiver ativa, o tempo é orquestrado pelo loop rAF
      if (this.isReversePlaying) {
        return;
      }

      this.currentTime = this.videoElement.currentTime || 0;

      // Execução do Loop A-B automático no intervalo definido (sentido normal)
      if (this.loopEnabled && this.loopEnd > this.loopStart) {
        if (this.currentTime >= this.loopEnd || this.currentTime < this.loopStart - 0.25) {
          this.seekTo(this.loopStart);
          return;
        }
      }

      if (this.onTimeUpdate) this.onTimeUpdate(this.currentTime, this.duration);
    };

    this.videoElement.onended = () => {
      if (this.isReversePlaying) return;
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
      if (!this.isReversePlaying) {
        this.isPlaying = true;
        if (this.onPlayStateChange) this.onPlayStateChange(true);
      }
    };

    this.videoElement.onpause = () => {
      if (!this.isReversePlaying) {
        this.isPlaying = false;
        if (this.onPlayStateChange) this.onPlayStateChange(false);
      }
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
      this.seekTo(this.playbackDirection === 'reverse' ? this.loopEnd : this.loopStart);
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

    this.pauseReverse();

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

  /**
   * Inicia a reprodução reversa contínua (andar no sentido oposto no tempo).
   */
  playReverse() {
    if (!this.videoElement) return;

    // Se estiver a reproduzir para a frente, pausa nativamente
    if (!this.videoElement.paused) {
      this.videoElement.pause();
    }

    // Se estiver no início ou fora do loop, reposiciona no ponto final adequado
    if (this.loopEnabled && this.loopEnd > this.loopStart) {
      if (this.videoElement.currentTime <= this.loopStart + 0.05 || this.videoElement.currentTime > this.loopEnd) {
        this.seekTo(this.loopEnd);
      }
    } else if ((this.videoElement.currentTime || 0) <= 0.05) {
      this.seekTo(this.duration || 0);
    }

    this.isReversePlaying = true;
    this.isPlaying = true;
    this.playbackDirection = 'reverse';
    this.lastReverseTime = performance.now();

    if (this.onPlayStateChange) this.onPlayStateChange(true);
    if (this.onDirectionChange) this.onDirectionChange('reverse');

    if (this.reverseAnimFrameId) {
      cancelAnimationFrame(this.reverseAnimFrameId);
    }
    this.reverseAnimFrameId = requestAnimationFrame(() => this._reverseTick());
  }

  /**
   * Pausa a reprodução reversa.
   */
  pauseReverse() {
    this.isReversePlaying = false;
    this.isPlaying = false;
    if (this.reverseAnimFrameId) {
      cancelAnimationFrame(this.reverseAnimFrameId);
      this.reverseAnimFrameId = null;
    }
    this.lastReverseTime = null;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  /**
   * Ciclo contínuo de marcha-atrás via requestAnimationFrame e medição precisa de delta.
   */
  _reverseTick() {
    if (!this.isReversePlaying || !this.videoElement) return;

    const now = performance.now();
    if (this.lastReverseTime === null) {
      this.lastReverseTime = now;
    }
    const dt = (now - this.lastReverseTime) / 1000;
    this.lastReverseTime = now;

    // Passo temporal baseado na velocidade selecionada (0.25x, 0.5x, 1.0x)
    const rate = Math.abs(this.playbackRate || 1.0);
    const step = dt * rate;
    const current = this.videoElement.currentTime || 0;
    let target = current - step;

    // Fronteira com Loop A-B ativo: ao atingir o ponto A, faz wrap para o ponto B
    if (this.loopEnabled && this.loopEnd > this.loopStart) {
      if (target <= this.loopStart) {
        target = this.loopEnd;
      }
    } else {
      // Sem loop: ao atingir o início do vídeo (0s), pausa e termina
      if (target <= 0) {
        target = 0;
        this.videoElement.currentTime = 0;
        this.currentTime = 0;
        if (this.onTimeUpdate) this.onTimeUpdate(0, this.duration);
        this.pauseReverse();
        if (this.onEnded) this.onEnded();
        return;
      }
    }

    this.videoElement.currentTime = target;
    this.currentTime = target;
    if (this.onTimeUpdate) {
      this.onTimeUpdate(target, this.duration);
    }

    this.reverseAnimFrameId = requestAnimationFrame(() => this._reverseTick());
  }

  /**
   * Define o sentido de reprodução ('forward' | 'reverse').
   */
  setPlaybackDirection(direction) {
    if (direction !== 'forward' && direction !== 'reverse') return;
    if (this.playbackDirection === direction) return;

    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.pause();
    }
    this.playbackDirection = direction;
    if (this.onDirectionChange) this.onDirectionChange(direction);

    if (wasPlaying) {
      if (direction === 'reverse') {
        this.playReverse();
      } else {
        this.play();
      }
    }
  }

  togglePlaybackDirection() {
    this.setPlaybackDirection(this.playbackDirection === 'forward' ? 'reverse' : 'forward');
  }

  togglePlay() {
    if (!this.videoElement) return;

    if (this.playbackDirection === 'reverse') {
      if (this.isReversePlaying) {
        this.pauseReverse();
      } else {
        this.playReverse();
      }
    } else {
      if (this.isReversePlaying) {
        this.pauseReverse();
      }
      if (this.videoElement.paused || this.videoElement.ended) {
        this.videoElement.play().catch(() => {});
      } else {
        this.videoElement.pause();
      }
    }
  }

  pause() {
    if (this.isReversePlaying) {
      this.pauseReverse();
    }
    if (this.videoElement && !this.videoElement.paused) {
      this.videoElement.pause();
    }
  }

  play() {
    if (this.isReversePlaying) {
      this.pauseReverse();
    }
    this.playbackDirection = 'forward';
    if (this.onDirectionChange) this.onDirectionChange('forward');
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

  startScrubbing() {
    this.wasPlayingBeforeScrub = this.isPlaying;
    this.wasReverseBeforeScrub = this.isReversePlaying;
    this.pause();
  }

  stopScrubbing(resume = false) {
    if (resume) {
      if (this.wasReverseBeforeScrub) {
        this.playReverse();
      } else if (this.wasPlayingBeforeScrub) {
        this.play();
      }
    }
  }

  stepRangeFrame(direction = 1, fps = 30) {
    if (!this.videoElement) return;
    const delta = (1 / fps) * direction;
    const current = this.videoElement.currentTime || 0;
    let next = current + delta;
    if (this.loopEnd > this.loopStart) {
      if (next > this.loopEnd) next = this.loopStart;
      else if (next < this.loopStart) next = this.loopEnd;
    }
    this.seekTo(next);
  }

  stepRangeSeconds(deltaSeconds) {
    if (!this.videoElement) return;
    const current = this.videoElement.currentTime || 0;
    let next = current + deltaSeconds;
    if (this.loopEnd > this.loopStart) {
      if (next > this.loopEnd) next = this.loopStart;
      else if (next < this.loopStart) next = this.loopEnd;
    }
    this.seekTo(next);
  }

  setAutoSlowdown(enabled, speed = 0.25) {
    this.autoSlowdownEnabled = Boolean(enabled);
    if (speed) this.autoSlowdownSpeed = speed;
    if (!this.autoSlowdownEnabled && this.isSlowedDownByMotion) {
      this.releaseMotionSlowdown();
    }
  }

  triggerMotionSlowdown() {
    if (!this.autoSlowdownEnabled || this.isSlowedDownByMotion || !this.isPlaying) return;
    this.userBasePlaybackRate = this.playbackRate;
    this.isSlowedDownByMotion = true;
    this.setPlaybackRate(this.autoSlowdownSpeed);
    if (this.onAutoSlowdownChange) {
      this.onAutoSlowdownChange(true, this.autoSlowdownSpeed);
    }
  }

  releaseMotionSlowdown() {
    if (!this.isSlowedDownByMotion) return;
    this.isSlowedDownByMotion = false;
    const restored = this.userBasePlaybackRate || 1.0;
    this.setPlaybackRate(restored);
    if (this.onAutoSlowdownChange) {
      this.onAutoSlowdownChange(false, restored);
    }
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate;
    if (!this.isSlowedDownByMotion) {
      this.userBasePlaybackRate = rate;
    }
    if (this.videoElement) {
      this.videoElement.playbackRate = rate;
    }
  }

  cleanup() {
    this.releaseMotionSlowdown();
    this.pauseReverse();
    if (this.videoUrl) {
      URL.revokeObjectURL(this.videoUrl);
      this.videoUrl = null;
    }
    this.videoFile = null;
    this.fileName = '';
    this.duration = 0;
    this.currentTime = 0;
    this.isPlaying = false;
    this.isReversePlaying = false;
    this.playbackDirection = 'forward';
  }
}

