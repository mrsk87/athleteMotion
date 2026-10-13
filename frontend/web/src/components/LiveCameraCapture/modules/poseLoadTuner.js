/**
 * Afinador de carga da inferência (PoseLoadTuner).
 *
 * O objetivo é parecer impossível: o esqueleto tem de ser **minucioso** (o modelo
 * completo acerta melhor no contorno da articulação) e, ao mesmo tempo, **muito
 * rápido** (sem atraso a acompanhar a perna). O que se pode ajustar sem perder
 * rigor de ângulos é, por ordem de impacto:
 *
 * 1. Resolução de entrada: o modelo MediaPipe redimensiona internamente para
 *    256×256, por isso dar-lhe 1080p não acrescenta rigor nenhum — só custa
 *    tempo a reduzir. `inferenceSize()` corta a imagem para um lado de trabalho
 *    (nunca ampliar, nunca distorcer).
 * 2. Modelo: `modelComplexity` 1 (rigoroso) vs 0 (rápido). É a única troca que
 *    custa rigor, por isso só acontece quando a máquina NÃO consegue acompanhar
 *    os FPS do vídeo — e volta atrás quando conseguir.
 *
 * Toda a decisão é pura (recebe FPS, devolve perfil) para poder ser verificada
 * sem browser em `npm run verify:playback`.
 */

/** Perfis de carga conhecidos. `order` é do mais rigoroso para o mais rápido. */
export const POSE_PROFILES = [
  { name: 'rigorous', modelComplexity: 1, workingWidth: 640 },
  { name: 'balanced', modelComplexity: 1, workingWidth: 480 },
  { name: 'sprint', modelComplexity: 0, workingWidth: 480 },
];

/**
 * Tamanho de trabalho da imagem enviada ao MediaPipe.
 * Preserva a proporção, nunca amplia e nunca desce abaixo de `minWidth`.
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} workingWidth - lado maior pretendido
 * @returns {{width:number, height:number}}
 */
export function inferenceSize(srcW, srcH, workingWidth = 640) {
  const w = Number(srcW);
  const h = Number(srcH);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: 0, height: 0 };
  }
  const target = Number.isFinite(workingWidth) && workingWidth > 0 ? workingWidth : 640;
  const longest = Math.max(w, h);
  if (longest <= target) {
    return { width: Math.round(w), height: Math.round(h) };
  }
  const scale = target / longest;
  return { width: Math.max(2, Math.round(w * scale)), height: Math.max(2, Math.round(h * scale)) };
}

export class PoseLoadTuner {
  /**
   * @param {number} [floorFps] - abaixo disto a máquina não acompanha: sobe um degrau de carga
   * @param {number} [ceilFps] - acima disto sobra capacidade: desce um degrau (mais rigor)
   * @param {number} [window] - quantas leituras de FPS entram na média
   * @param {number} [minSamples] - leituras mínimas antes de decidir
   * @param {number} [maxSwitches] - trocas máximas (evita andar a recarregar o modelo)
   */
  constructor({ floorFps = 20, ceilFps = 34, window = 4, minSamples = 3, maxSwitches = 2 } = {}) {
    this.floorFps = floorFps;
    this.ceilFps = ceilFps;
    this.window = window;
    this.minSamples = minSamples;
    this.maxSwitches = maxSwitches;
    this.samples = [];
    this.switches = 0;
    this.index = 0;
  }

  get profile() {
    return POSE_PROFILES[this.index];
  }

  /**
   * Acrescenta uma medição de FPS da IA e devolve o perfil em vigor.
   * @param {number} aiFps
   * @returns {{profile:Object, switched:boolean}}
   */
  addFpsSample(aiFps) {
    const fps = Number(aiFps);
    if (!Number.isFinite(fps) || fps <= 0) return { profile: this.profile, switched: false };
    this.samples.push(fps);
    if (this.samples.length > this.window) this.samples.shift();
    if (this.samples.length < this.minSamples) return { profile: this.profile, switched: false };
    if (this.switches >= this.maxSwitches) return { profile: this.profile, switched: false };

    const average = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
    const last = POSE_PROFILES.length - 1;

    if (average < this.floorFps && this.index < last) {
      this.index += 1;
      this.switches += 1;
      this.samples = [];
      return { profile: this.profile, switched: true };
    }
    if (average > this.ceilFps && this.index > 0) {
      this.index -= 1;
      this.switches += 1;
      this.samples = [];
      return { profile: this.profile, switched: true };
    }
    return { profile: this.profile, switched: false };
  }
}
