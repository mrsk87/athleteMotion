/**
 * Detetor de movimento para o Auto-Slowdown (MotionSlowdownDetector).
 *
 * Para que serve: quando a perna está a andar depressa, o MediaPipe tem mais
 * dificuldade em acertar no contorno exato da articulação. Este detetor decide
 * quando vale a pena abrandar a reprodução para o motor ver mais fotogramas por
 * cada grau de rotação da perna.
 *
 * Decisões de desenho (o que fazia o auto-slowdown não fazer nada):
 * - A velocidade angular é medida em **TEMPO DE VÍDEO**, não em tempo de relógio.
 *   Com o tempo de relógio, o próprio abrandamento reduzia a velocidade medida e o
 *   motor largava o travão, voltava a 1x e travava outra vez — oscilação constante.
 * - Há **histerese**: entra em câmara lenta acima de `enterSpeed` e só sai depois de
 *   `releaseSamples` leituras seguidas abaixo de `exitSpeed`. Sem esta margem, o
 *   ruído do MediaPipe ligava/desligava a câmara lenta a cada fotograma.
 * - Uma leitura sem ângulo (pose perdida) não conta nem para entrar nem para sair.
 */

/** Velocidade angular do joelho (graus/segundo de vídeo) a partir da qual se abranda. */
export const SLOWDOWN_ENTER_SPEED = 160;
/** Velocidade angular (graus/segundo) abaixo da qual se pode voltar à velocidade normal. */
export const SLOWDOWN_EXIT_SPEED = 70;
/** Leituras consecutivas abaixo de `exitSpeed` necessárias para largar o travão. */
export const SLOWDOWN_RELEASE_SAMPLES = 8;

/**
 * Velocidade angular (graus/segundo) entre duas leituras do mesmo ângulo.
 * Devolve `null` quando não é possível medir (sem leitura anterior, tempo parado
 * ou salto de tempo — um seek não é movimento da perna).
 *
 * @param {number} previousAngle - leitura anterior (graus)
 * @param {number} angle - leitura atual (graus)
 * @param {number} deltaVideoSeconds - tempo de VÍDEO decorrido entre as duas leituras
 * @param {number} [maxStepSeconds] - saltos de tempo acima disto são descontinuidade
 * @returns {number|null}
 */
/**
 * Só aceita números a sério: `null` (pose perdida) NÃO pode ser lido como 0, senão
 * uma leitura em falta virava um movimento de centenas de graus por segundo.
 */
function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function kneeAngularSpeed(previousAngle, angle, deltaVideoSeconds, maxStepSeconds = 0.5) {
  const a = finiteOrNull(previousAngle);
  const b = finiteOrNull(angle);
  const dt = finiteOrNull(deltaVideoSeconds);
  if (a === null || b === null) return null;
  if (dt === null || dt <= 0 || dt > maxStepSeconds) return null;
  return Math.abs(b - a) / dt;
}

export class MotionSlowdownDetector {
  constructor({
    enterSpeed = SLOWDOWN_ENTER_SPEED,
    exitSpeed = SLOWDOWN_EXIT_SPEED,
    releaseSamples = SLOWDOWN_RELEASE_SAMPLES,
  } = {}) {
    this.enterSpeed = enterSpeed;
    this.exitSpeed = exitSpeed;
    this.releaseSamples = releaseSamples;
    this.reset();
  }

  /** Esquece o histórico (novo vídeo, seek, mudança de lado ou de articulação). */
  reset() {
    this.previousAngle = null;
    this.previousTime = null;
    this.stillSamples = 0;
    this.slowed = false;
    this.lastSpeed = null;
  }

  /**
   * Acrescenta uma leitura e decide o que fazer.
   * @param {{angle:number, time:number}} sample - ângulo do joelho e instante de VÍDEO
   * @returns {{slowed:boolean, speed:number|null, enter:boolean, release:boolean}}
   */
  addSample({ angle, time }) {
    const at = finiteOrNull(time);
    const speed = kneeAngularSpeed(
      this.previousAngle,
      angle,
      this.previousTime === null || at === null ? null : at - this.previousTime
    );
    this.previousAngle = finiteOrNull(angle);
    this.previousTime = at;

    if (speed === null) {
      return { slowed: this.slowed, speed: null, enter: false, release: false };
    }
    this.lastSpeed = speed;

    if (!this.slowed) {
      if (speed >= this.enterSpeed) {
        this.slowed = true;
        this.stillSamples = 0;
        return { slowed: true, speed, enter: true, release: false };
      }
      return { slowed: false, speed, enter: false, release: false };
    }

    // Já em câmara lenta: só larga o travão depois de movimento calmo sustentado.
    if (speed <= this.exitSpeed) {
      this.stillSamples += 1;
      if (this.stillSamples >= this.releaseSamples) {
        this.slowed = false;
        this.stillSamples = 0;
        return { slowed: false, speed, enter: false, release: true };
      }
    } else {
      this.stillSamples = 0;
    }
    return { slowed: true, speed, enter: false, release: false };
  }
}
