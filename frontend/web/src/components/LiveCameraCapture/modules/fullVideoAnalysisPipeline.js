/**
 * Pipeline de Análise Integral do Vídeo em Duas Passagens (FullVideoAnalysisPipeline).
 *
 * PORQUÊ DUAS PASSAGENS:
 * Numa só passagem teríamos de escolher entre ser rápido (poucas amostras, e as posições
 * cardeais do cranque eram apanhadas "por sorte") ou varrer o vídeo ao fotograma (preciso mas
 * lentíssimo numa análise completa). A solução é a do protocolo de referência:
 *
 *  1. **Passagem em malha (grid):** percorre o vídeo todo em intervalos regulares e reconstrói
 *     a fase do cranque, descobrindo a cadência e os instantes EXATOS de cada posição cardeal.
 *  2. **Passagem de refinação:** volta ao vídeo só nos instantes calculados — 12h, 3h, 6h e 9h de
 *     cada pedalada — para medir com o fotograma "phase-matched" em vez de aceitar o que calhou.
 *
 * Isto é o que o consenso de cinemática pede: medir em fases iguais ao longo de várias pedaladas
 * e reportar quantos ciclos foram usados.
 */

import { CrankPhaseTracker } from './crankPhaseTracker.js';
import { DEFAULT_PHASE_WINDOW_DEG, RECOMMENDED_REVOLUTIONS } from './crankPositionRules.js';

/** Limite de amostras da malha: mantém o tempo de análise utilizável em vídeos longos. */
export const MAX_GRID_SAMPLES = 700;
export const MIN_STEP_SECONDS = 1 / 30;
export const MAX_STEP_SECONDS = 0.1;
/** Fase da malha no progresso global (a refinação ocupa os 30% finais). */
const GRID_PROGRESS_SHARE = 0.7;

export class FullVideoAnalysisPipeline {
  constructor({
    scanner,
    windowDeg = DEFAULT_PHASE_WINDOW_DEG,
    maxRevolutions = RECOMMENDED_REVOLUTIONS,
    onProgress,
    onPhase,
    onLog,
  } = {}) {
    if (!scanner) throw new Error('FullVideoAnalysisPipeline requer um FullVideoScanRunner.');
    this.scanner = scanner;
    this.windowDeg = windowDeg;
    this.maxRevolutions = maxRevolutions;
    this.onProgress = onProgress;
    this.onPhase = onPhase;
    this.onLog = onLog;

    // O progresso bruto do varrimento é reescalado para o progresso global da análise
    // (malha = 0–70%, refinação = 70–100%), mantendo a interface com uma única barra.
    this.scanner.onProgress = (payload) => this._scanProgress(payload);
  }

  /** Traduz o progresso de uma passagem do varrimento em progresso global. */
  _scanProgress({ pass, percent = 0, ...rest }) {
    const overall =
      pass === 'refine'
        ? GRID_PROGRESS_SHARE * 100 + percent * (1 - GRID_PROGRESS_SHARE)
        : percent * GRID_PROGRESS_SHARE;
    this._progress({ stage: pass, percent: Math.round(overall * 10) / 10, ...rest });
  }

  /**
   * Passo da malha para um vídeo de `duration` segundos.
   * Vídeos curtos são amostrados quase ao fotograma; vídeos longos são amostrados com o passo
   * máximo aceitável (a fase é interpolada, o que mantém a precisão).
   */
  static computeGridStep(duration) {
    if (!Number.isFinite(duration) || duration <= 0) return MIN_STEP_SECONDS;
    const ideal = duration / MAX_GRID_SAMPLES;
    return Math.max(MIN_STEP_SECONDS, Math.min(MAX_STEP_SECONDS, ideal));
  }

  cancel() {
    this.scanner.cancel();
  }

  _progress(payload) {
    if (this.onProgress) this.onProgress(payload);
  }

  /**
   * Executa a análise completa do vídeo.
   * @param {{ duration:number }} options
   * @returns {Promise<Object>} resultado com `status`, `scan`, `phase` (passagens por posição) e `notes`
   */
  async run({ duration } = {}) {
    const notes = [];
    if (!Number.isFinite(duration) || duration <= 0) {
      return { status: 'failed', reason: 'Duração do vídeo desconhecida — não é possível analisar.', notes };
    }

    this.scanner.reset();
    const stepSeconds = FullVideoAnalysisPipeline.computeGridStep(duration);

    // ---------------------------------------------------------------------
    // Passagem 1 — malha regular sobre o vídeo inteiro
    // ---------------------------------------------------------------------
    const grid = await this.scanner.runGrid({ start: 0, end: duration, stepSeconds });
    this._progress({ stage: 'grid-complete', percent: GRID_PROGRESS_SHARE * 100, grid });

    if (grid.status === 'cancelled') {
      return { status: 'cancelled', reason: 'Análise cancelada.', scan: { duration, stepSeconds, grid }, notes };
    }
    if (grid.status === 'failed') {
      return { status: 'failed', reason: grid.reason, scan: { duration, stepSeconds, grid }, notes };
    }

    const gridObservations = this.scanner.observations.slice();
    const gridTracker = new CrankPhaseTracker({ windowDeg: this.windowDeg });
    gridTracker.addAll(gridObservations);
    const coarse = gridTracker.build();

    if (!coarse || !coarse.reliable) {
      const reason = coarse?.reason || 'Não foi possível reconstruir a fase do cranque a partir deste vídeo.';
      notes.push(reason);
      return {
        status: 'done',
        reason,
        scan: { duration, stepSeconds, grid, refine: null },
        phase: coarse
          ? { ...coarse, passages: this._emptyPassages(), coverage: this._emptyCoverage(), rejected: [] }
          : null,
        notes,
      };
    }

    // ---------------------------------------------------------------------
    // Passagem 2 — refinação nos instantes exatos de cada posição cardeal
    // ---------------------------------------------------------------------
    const crossings = gridTracker.findCrossings(this.maxRevolutions);
    const refine = await this.scanner.runTimes(crossings);
    this._progress({ stage: 'refine-complete', percent: 100, refine });

    if (refine.status === 'cancelled') {
      return {
        status: 'cancelled',
        reason: 'Análise cancelada durante a refinação.',
        scan: { duration, stepSeconds, grid, refine },
        phase: { ...coarse, passages: this._emptyPassages(), coverage: this._emptyCoverage(), rejected: [] },
        notes,
      };
    }

    const refinedObservations = this.scanner.observations.slice(gridObservations.length);

    // Órbita final: malha + refinação (mais amostras nos extremos => normalização mais fiel).
    const finalTracker = new CrankPhaseTracker({ windowDeg: this.windowDeg });
    finalTracker.addAll(this.scanner.observations);
    const finalPhase = finalTracker.build() || coarse;

    const { passages, coverage, rejected } = CrankPhaseTracker.bucketPassages(
      refinedObservations,
      finalPhase.bounds,
      finalPhase.mirrored,
      this.windowDeg
    );

    if (rejected.length) {
      notes.push(
        `${rejected.length} fotograma(s) refinado(s) foram rejeitados por não caírem dentro da janela de ±${this.windowDeg}° da posição pedida.`
      );
    }
    const missing = CrankPhaseTracker.CARDINALS.filter((key) => coverage[key].revolutions === 0);
    if (missing.length) {
      notes.push(`Sem passagem válida em: ${missing.join(', ')}.`);
    }

    const result = {
      status: 'done',
      scan: {
        duration,
        stepSeconds,
        grid,
        refine,
        samples: this.scanner.totals.samples,
        failures: this.scanner.totals.failures,
        elapsedMs: this.scanner.totals.elapsedMs,
      },
      phase: { ...finalPhase, passages, coverage, rejected },
      notes,
    };

    if (this.onPhase) this.onPhase(result.phase);
    this._progress({ stage: 'complete', percent: 100, phase: result.phase });
    return result;
  }

  _emptyPassages() {
    const passages = {};
    CrankPhaseTracker.CARDINALS.forEach((key) => {
      passages[key] = [];
    });
    return passages;
  }

  _emptyCoverage() {
    const coverage = {};
    CrankPhaseTracker.CARDINALS.forEach((key) => {
      coverage[key] = { revolutions: 0, samples: 0 };
    });
    return coverage;
  }
}

export default FullVideoAnalysisPipeline;
