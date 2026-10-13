/**
 * Controlador de Câmara Lenta e Navegação Quadro a Quadro (ScrubberController).
 *
 * Responsabilidade:
 * - Gravar rajadas curtas de 6 segundos em memória.
 * - Navegar fotograma a fotograma para inspecionar pontos críticos da biomecânica.
 * - Gerir a reprodução desacelerada a 0.25x.
 */

export class ScrubberController {
  constructor(clipRecorder, { onRenderFrame, onAnglesUpdate, onToast }) {
    this.clipRecorder = clipRecorder;
    this.onRenderFrame = onRenderFrame;
    this.onAnglesUpdate = onAnglesUpdate;
    this.onToast = onToast;

    this.isRecording = false;
    this.isActive = false;
    this.isPlaying = false;
    this.currentIndex = 0;
  }

  triggerRecording(onRecordFinished) {
    if (this.clipRecorder.hasClip && !this.isRecording) {
      this.isActive = true;
      this.currentIndex = 0;
      this.seekToFrame(0);
      return;
    }

    this.isRecording = true;
    this.clipRecorder.startRecording();
    if (this.onToast) this.onToast('A gravar rajada de 6s em câmara lenta...');

    setTimeout(() => {
      this.clipRecorder.stopRecording();
      this.isRecording = false;
      this.isActive = true;
      this.currentIndex = 0;
      this.seekToFrame(0);
      if (this.onToast) this.onToast(`Clipe de ${this.clipRecorder.totalFrames} frames gravado!`);
      if (onRecordFinished) onRecordFinished();
    }, 6000);
  }

  seekToFrame(index) {
    const frame = this.clipRecorder.seekToFrame(index);
    if (frame) {
      this.currentIndex = index;
      if (this.onRenderFrame) this.onRenderFrame(frame.canvas);
      if (frame.angles && this.onAnglesUpdate) this.onAnglesUpdate(frame.angles);
    }
  }

  stepFrame(direction) {
    const maxIdx = Math.max(0, this.clipRecorder.totalFrames - 1);
    const target = Math.max(0, Math.min(this.currentIndex + direction, maxIdx));
    this.seekToFrame(target);
  }

  toggleSlowMo() {
    if (this.isPlaying) {
      this.clipRecorder.pause();
      this.isPlaying = false;
    } else {
      this.isPlaying = true;
      this.clipRecorder.playSlow(0.25, (frame) => {
        this.currentIndex = frame.index;
        if (this.onRenderFrame) this.onRenderFrame(frame.canvas);
        if (frame.angles && this.onAnglesUpdate) this.onAnglesUpdate(frame.angles);
      });
    }
  }

  close() {
    this.clipRecorder.pause();
    this.isPlaying = false;
    this.isActive = false;
  }
}
