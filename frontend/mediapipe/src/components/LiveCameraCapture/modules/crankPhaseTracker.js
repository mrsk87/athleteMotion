/**
 * Estimador da Fase do Cranque a partir da Órbita do Pé (CrankPhaseTracker).
 *
 * PROBLEMA QUE RESOLVE:
 * Sem sensor de cranque, é preciso saber em que posição está a pedaleira (12h, 3h, 6h, 9h)
 * para medir cada articulação NA POSIÇÃO CERTA. Medir a extensão do joelho "a meio" da
 * pedalada não tem significado biomecânico nenhum para a altura do selim.
 *
 * COMO ESTIMA A FASE (e porquê assim):
 * O pé/tornozelo descreve uma órbita fechada. A fase é calculada em coordenadas NORMALIZADAS
 * pela caixa da órbita (equivalente a normalizar pela elipse quando a câmara não está
 * perfeitamente de perfil) — a recomendação para órbitas elípticas em vídeo de ciclismo:
 *   "If the projected orbit is elliptical, fit the ellipse and calculate phase in
 *    ellipse-normalized coordinates."
 * Convenção: 0° = 12h (TDC), 90° = 3h, 180° = 6h (BDC), 270° = 9h, sentido crescente.
 * O sentido é detetado dos próprios dados: se a fase corre no sentido negativo, o atleta
 * está virado para a esquerda e a fase é espelhada (3h ↔ 9h).
 *
 * LIMITAÇÃO ASSUMIDA: a órbita do tornozelo não é exatamente a órbita do eixo do pedal
 * (o tornozelo move-se em relação ao pedal). Nas vizinhanças das posições cardeais o erro é
 * pequeno, e por isso todas as amostras passam por uma JANELA de tolerância angular cujo
 * erro é medido e reportado — nunca se assume precisão de grau exacto.
 *
 * Este ficheiro é puro (sem DOM): recebe observações, devolve estatística e passagens.
 */

import {
  CARDINAL_PHASE_DEG,
  DEFAULT_PHASE_WINDOW_DEG,
  ANALYSIS_POSITION_ORDER,
} from './crankPositionRules.js';

const FULL_CIRCLE = 360;

/**
 * Cobertura angular mínima da órbita para confiar na fase. Equivale a exigir que o maior
 * intervalo entre amostras consecutivas seja ≤ 90°, o que mantém o desdobramento de fase
 * livre de ambiguidades e garante que a volta foi realmente observada por inteiro.
 */
const MIN_PHASE_COVERAGE_DEG = 270;

/** Distância angular mínima entre dois ângulos (0–180). */
export function angularDistance(a, b) {
  const diff = Math.abs(((a - b) % FULL_CIRCLE + FULL_CIRCLE) % FULL_CIRCLE);
  return diff > 180 ? FULL_CIRCLE - diff : diff;
}

export class CrankPhaseTracker {
  /** Posições cardeais analisadas, por ordem 12h → 3h → 6h → 9h. */
  static CARDINALS = ANALYSIS_POSITION_ORDER;

  /**
   * @param {Object} [options]
   * @param {number} [options.windowDeg] - tolerância angular (graus) em torno da posição cardeal
   * @param {number} [options.minSamples] - amostras mínimas para considerar a fase utilizável
   * @param {number} [options.minOrbitPx] - amplitude mínima da órbita em píxeis (evita ruído)
   */
  constructor({ windowDeg = DEFAULT_PHASE_WINDOW_DEG, minSamples = 20, minOrbitPx = 4 } = {}) {
    this.windowDeg = windowDeg;
    this.minSamples = minSamples;
    this.minOrbitPx = minOrbitPx;
    this.observations = [];
    this.summary = null;
  }

  get count() {
    return this.observations.length;
  }

  reset() {
    this.observations = [];
    this.summary = null;
  }

  /**
   * Adiciona uma observação com a posição do tornozelo/pé (píxeis) e o tempo (segundos).
   * @param {{ time:number, ankle:{x:number,y:number} }} observation
   */
  addObservation(observation) {
    if (!observation || !observation.ankle) return false;
    const { x, y } = observation.ankle;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(observation.time)) return false;
    this.observations.push(observation);
    return true;
  }

  addAll(observations = []) {
    observations.forEach((obs) => this.addObservation(obs));
    return this.count;
  }

  /**
   * Calcula a órbita normalizada (centro + semi-eixos) a partir das observações.
   * Devolve `null` quando a órbita é demasiado pequena para ser fiável.
   */
  static computeOrbitBounds(observations = []) {
    if (observations.length < 3) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    observations.forEach(({ ankle }) => {
      if (ankle.x < minX) minX = ankle.x;
      if (ankle.x > maxX) maxX = ankle.x;
      if (ankle.y < minY) minY = ankle.y;
      if (ankle.y > maxY) maxY = ankle.y;
    });
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const halfSize = { x: Math.max(0.5, (maxX - minX) / 2), y: Math.max(0.5, (maxY - minY) / 2) };
    return { center, halfSize, spanX: maxX - minX, spanY: maxY - minY };
  }

  /**
   * Fase (graus, 0–360) de um ponto da órbita, na convenção 0° = 12h (topo do ecrã).
   * @param {{x:number,y:number}} point
   * @param {{center:{x:number,y:number}, halfSize:{x:number,y:number}}} bounds
   */
  static phaseAt(point, bounds) {
    const nx = (point.x - bounds.center.x) / bounds.halfSize.x;
    const ny = (point.y - bounds.center.y) / bounds.halfSize.y;
    const deg = (Math.atan2(nx, -ny) * 180) / Math.PI;
    return (deg + FULL_CIRCLE) % FULL_CIRCLE;
  }

  /**
   * Constrói o resumo da fase: direção, revoluções completas, cadência e cobertura angular.
   * @returns {Object|null}
   */
  build() {
    // A fase é uma grandeza temporal: as observações têm de estar em ordem cronológica.
    // Os dois varrimentos (malha + refinação) chegam fora de ordem, pelo que se ordena aqui
    // — caso contrário o desdobramento da fase saltava para trás e estragava as revoluções.
    const observations = [...this.observations].sort((a, b) => a.time - b.time);
    this.observations = observations;
    const bounds = CrankPhaseTracker.computeOrbitBounds(observations);
    this.summary = null;
    if (!bounds) return null;

    const orbitTooSmall = bounds.spanX < this.minOrbitPx && bounds.spanY < this.minOrbitPx;

    const rawPhases = observations.map((obs) => CrankPhaseTracker.phaseAt(obs.ankle, bounds));

    // Sentido de rotação: soma dos deltas pelo arco mais curto.
    let signedSum = 0;
    for (let i = 1; i < rawPhases.length; i++) {
      const delta = ((rawPhases[i] - rawPhases[i - 1] + 540) % FULL_CIRCLE) - 180;
      signedSum += delta;
    }
    const mirrored = signedSum < 0;
    const phases = mirrored ? rawPhases.map((p) => (FULL_CIRCLE - p) % FULL_CIRCLE) : rawPhases;

    // Desdobramento (unwrapped) para contar revoluções.
    const unwrapped = [phases[0] || 0];
    for (let i = 1; i < phases.length; i++) {
      const delta = ((phases[i] - phases[i - 1] + 540) % FULL_CIRCLE) - 180;
      unwrapped.push(unwrapped[i - 1] + delta);
    }

    const firstTime = observations[0].time;
    const lastTime = observations[observations.length - 1].time;
    const span = unwrapped.length ? unwrapped[unwrapped.length - 1] - unwrapped[0] : 0;
    const completeRevolutions = Math.max(0, Math.floor(span / FULL_CIRCLE));
    const durationSeconds = Math.max(0, lastTime - firstTime);
    // A cadência usa a rotação CONTÍNUA da fase (span/360), não as revoluções completas:
    // usar apenas as completas subestimava a cadência em até uma pedalada por vídeo.
    const totalRevolutions = span / FULL_CIRCLE;
    const cadenceRpm =
      totalRevolutions > 0 && durationSeconds > 0
        ? Math.round(((totalRevolutions * 60) / durationSeconds) * 10) / 10
        : null;

    // Cobertura angular: medida pelo MAIOR INTERVALO entre amostras consecutivas da órbita
    // (360° − maior intervalo). É imune ao enviesamento de um histograma de setores fixos, que
    // subcontava a cobertura quando o passo de amostragem ressoava com a largura do setor.
    const sortedPhases = [...phases].sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 0; i < sortedPhases.length; i++) {
      const current = sortedPhases[i];
      const next = i === sortedPhases.length - 1 ? sortedPhases[0] + FULL_CIRCLE : sortedPhases[i + 1];
      maxGap = Math.max(maxGap, next - current);
    }
    const phaseCoverageDeg = Math.round(FULL_CIRCLE - maxGap);

    const reliable =
      observations.length >= this.minSamples &&
      !orbitTooSmall &&
      phaseCoverageDeg >= MIN_PHASE_COVERAGE_DEG &&
      completeRevolutions >= 1;

    let reason = null;
    if (orbitTooSmall) reason = 'A órbita do pé é demasiado pequena no enquadramento para estimar a fase do cranque.';
    else if (observations.length < this.minSamples) reason = `Amostras insuficientes para estimar a fase (${observations.length}).`;
    else if (phaseCoverageDeg < MIN_PHASE_COVERAGE_DEG) reason = 'A órbita do pé não fecha uma volta completa no vídeo.';
    else if (completeRevolutions < 1) reason = 'Não foi possível identificar nenhuma pedalada completa.';

    this.summary = {
      reliable,
      reason,
      bounds,
      mirrored,
      direction: mirrored ? 'mirrored' : 'forward',
      phases,
      unwrapped,
      sampleCount: observations.length,
      completeRevolutions,
      partialRevolutionFraction: Math.max(0, (span % FULL_CIRCLE) / FULL_CIRCLE),
      durationSeconds,
      cadenceRpm,
      phaseCoverageDeg,
      windowDeg: this.windowDeg,
    };
    return this.summary;
  }

  /**
   * Instantes (segundos de vídeo) em que a fase cruza cada posição cardeal, por revolução,
   * obtidos por interpolação linear da fase desdobrada. Estes instantes são depois usados
   * para ir buscar fotogramas EXATAMENTE na posição pedida — o protocolo de medição
   * "phase-matched" em vez de aceitar o que calhar.
   *
   * @param {number} [maxRevolutions] - limite de revoluções (usam-se as ÚLTIMAS, mais estáveis)
   * @returns {Array<{ key:string, revolution:number, time:number, phaseDeg:number }>}
   */
  findCrossings(maxRevolutions = 10) {
    const summary = this.summary || this.build();
    if (!summary || !summary.reliable) return [];
    const { unwrapped, phases } = summary;
    const observations = this.observations;
    const total = summary.completeRevolutions;
    if (total < 1) return [];
    const firstRevolution = Math.max(0, total - Math.max(1, maxRevolutions));

    const crossings = [];
    for (let rev = firstRevolution; rev < total; rev++) {
      CrankPhaseTracker.CARDINALS.forEach((key) => {
        const target = CARDINAL_PHASE_DEG[key];
        const delta = ((target - phases[0] + FULL_CIRCLE) % FULL_CIRCLE) + FULL_CIRCLE * rev;
        const uTarget = unwrapped[0] + delta;

        for (let i = 1; i < unwrapped.length; i++) {
          if (unwrapped[i] >= uTarget) {
            const uPrev = unwrapped[i - 1];
            const uNext = unwrapped[i];
            const ratio = uNext === uPrev ? 0 : (uTarget - uPrev) / (uNext - uPrev);
            const tPrev = observations[i - 1].time;
            const tNext = observations[i].time;
            crossings.push({
              key,
              revolution: rev,
              time: Math.max(0, tPrev + (tNext - tPrev) * ratio),
              phaseDeg: target,
            });
            break;
          }
        }
      });
    }
    return crossings.sort((a, b) => a.time - b.time);
  }

  /**
   * Classifica observações já recolhidas com `intended = { key, revolution }`:
   * mede o erro angular REAL de cada fotograma face à posição pretendida e rejeita os que
   * não caem dentro da janela de tolerância.
   *
   * @param {Array} observations - observações com `intended`
   * @param {{center:Object, halfSize:Object}} bounds - órbita final (melhor estimativa)
   * @param {boolean} mirrored
   * @param {number} [windowDeg]
   * @returns {{ passages:Object, coverage:Object, rejected:Array }}
   */
  static bucketPassages(observations = [], bounds, mirrored, windowDeg = DEFAULT_PHASE_WINDOW_DEG) {
    const passages = {};
    const coverage = {};
    const rejected = [];
    CrankPhaseTracker.CARDINALS.forEach((key) => {
      passages[key] = [];
      coverage[key] = { revolutions: 0, samples: 0 };
    });

    observations.forEach((obs) => {
      if (!obs || !obs.intended || !obs.ankle || !bounds) return;
      const { key, revolution } = obs.intended;
      if (!passages[key]) return;
      let phase = CrankPhaseTracker.phaseAt(obs.ankle, bounds);
      if (mirrored) phase = (FULL_CIRCLE - phase) % FULL_CIRCLE;
      const error = angularDistance(phase, CARDINAL_PHASE_DEG[key]);
      if (error > windowDeg) {
        rejected.push({ key, revolution, time: obs.time, phaseErrorDeg: Math.round(error * 10) / 10 });
        return;
      }
      passages[key].push({
        revolution,
        time: obs.time,
        phase: Math.round(phase * 10) / 10,
        phaseErrorDeg: Math.round(error * 10) / 10,
        observation: obs,
      });
    });

    CrankPhaseTracker.CARDINALS.forEach((key) => {
      passages[key].sort((a, b) => a.revolution - b.revolution);
      coverage[key] = {
        revolutions: new Set(passages[key].map((p) => p.revolution)).size,
        samples: passages[key].length,
      };
    });

    return { passages, coverage, rejected };
  }
}

export default CrankPhaseTracker;
