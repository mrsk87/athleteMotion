/**
 * Máquina de Estados do Teste Bilateral Guiado (BilateralWizard).
 *
 * Responsabilidade:
 * - Orquestrar o teste em 2 fases: Lado Esquerdo (20s) -> Pausa -> Lado Direito (20s).
 * - Gerir a contagem decrescente temporal e avisos sonoros/vocais.
 * - Calcular o índice de assimetria bilateral (SI) ao término da avaliação.
 */
import { AsymmetryCalculator } from '../../../services/asymmetryCalculator';

export class BilateralWizard {
  constructor({ onTick, onStepChange, onComplete, onVoicePrompt }) {
    this.onTick = onTick;
    this.onStepChange = onStepChange;
    this.onComplete = onComplete;
    this.onVoicePrompt = onVoicePrompt;

    this.isActive = false;
    this.step = 'idle'; // 'left' | 'pause' | 'right' | 'done'
    this.countdown = 20;
    this.intervalId = null;
    this.leftData = null;
    this.rightData = null;
  }

  start() {
    this.isActive = true;
    this.step = 'left';
    this.countdown = 20;
    if (this.onStepChange) this.onStepChange('left', 'left');

    this.runTimer(() => this.finishLeftStep());
  }

  resumeRight() {
    this.step = 'right';
    this.countdown = 20;
    if (this.onStepChange) this.onStepChange('right', 'right');

    this.runTimer(() => this.finishRightStep());
  }

  runTimer(onExpire) {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      if (this.countdown > 0) {
        this.countdown -= 1;
        if (this.onTick) this.onTick(this.countdown);
      } else {
        clearInterval(this.intervalId);
        this.intervalId = null;
        onExpire();
      }
    }, 1000);
  }

  finishLeftStep(liveAnglesSnapshot) {
    this.leftData = liveAnglesSnapshot;
    this.step = 'pause';
    if (this.onStepChange) this.onStepChange('pause', 'left');
    if (this.onVoicePrompt) this.onVoicePrompt();
  }

  finishRightStep(liveAnglesSnapshot) {
    this.rightData = liveAnglesSnapshot;
    this.step = 'done';
    this.isActive = false;

    const results = AsymmetryCalculator.compareProfiles(this.leftData, this.rightData);
    if (this.onComplete) this.onComplete(results);
  }

  cancel() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isActive = false;
    this.step = 'idle';
  }
}
