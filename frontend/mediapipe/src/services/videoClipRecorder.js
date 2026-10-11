/**
 * Gravador de Rajada Curta em Câmara Lenta (Slow-Motion) e Scrubber Quadro a Quadro.
 *
 * Permite capturar 5 a 10 segundos da pedalada em memória e navegar fotograma a fotograma
 * com velocidade reduzida (0.25x / 0.5x) para inspecionar pontos críticos da biomecânica.
 */
export class VideoClipRecorder {
  constructor(maxFrames = 180) {
    this.maxFrames = maxFrames; // ~6 segundos a 30 FPS
    this.frames = [];
    this.isRecording = false;
    this.isPlaying = false;
    this.currentFrameIndex = 0;
    this.playbackInterval = null;
  }

  get totalFrames() {
    return this.frames.length;
  }

  get hasClip() {
    return this.frames.length > 0;
  }

  startRecording() {
    this.frames = [];
    this.isRecording = true;
    this.isPlaying = false;
    this.currentFrameIndex = 0;
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }
  }

  captureFrame(canvas, landmarks = null, angles = null) {
    if (!this.isRecording || !canvas) return;

    // Criar uma cópia leve do fotograma
    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const ctx = offscreen.getContext('2d');
    ctx.drawImage(canvas, 0, 0);

    this.frames.push({
      canvas: offscreen,
      landmarks: landmarks ? JSON.parse(JSON.stringify(landmarks)) : null,
      angles: angles ? { ...angles } : null,
      timestamp: performance.now(),
      index: this.frames.length,
    });

    if (this.frames.length >= this.maxFrames) {
      this.stopRecording();
    }
  }

  stopRecording() {
    this.isRecording = false;
    this.currentFrameIndex = 0;
    return this.frames.length;
  }

  seekToFrame(index) {
    if (this.frames.length === 0) return null;
    const boundedIdx = Math.max(0, Math.min(index, this.frames.length - 1));
    this.currentFrameIndex = boundedIdx;
    return this.frames[boundedIdx];
  }

  nextFrame() {
    return this.seekToFrame(this.currentFrameIndex + 1);
  }

  prevFrame() {
    return this.seekToFrame(this.currentFrameIndex - 1);
  }

  playSlow(speed = 0.25, onFrame) {
    this.pause();
    this.isPlaying = true;
    // Em velocidade normal 30 FPS = 33ms por frame. Em 0.25x = ~133ms por frame
    const intervalMs = Math.round(33.3 / speed);

    this.playbackInterval = setInterval(() => {
      if (this.currentFrameIndex >= this.frames.length - 1) {
        this.currentFrameIndex = 0; // Loop contínuo de câmara lenta
      } else {
        this.currentFrameIndex += 1;
      }
      const frame = this.frames[this.currentFrameIndex];
      if (onFrame) onFrame(frame);
    }, intervalMs);
  }

  pause() {
    this.isPlaying = false;
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }
  }

  clear() {
    this.pause();
    this.frames = [];
    this.currentFrameIndex = 0;
    this.isRecording = false;
  }
}

