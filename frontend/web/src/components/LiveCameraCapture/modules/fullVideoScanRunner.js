/**
 * Varrimento Integal de Vídeo, Fotograma a Fotograma (FullVideoScanRunner).
 *
 * RESPONSABILIDADE:
 * Percorrer TODO o vídeo recolhendo uma observação biomecânica por amostra, sempre
 * **sequencialmente** (um fotograma de cada vez, à espera que a descodificação termine antes de
 * pedir o seguinte). Duas razões para isto:
 *  1. Correção: dois pedidos de inferência sobrepostos produzem resultados fora de ordem e
 *     foi exatamente isso que, na marcha-atrás, deixava o vídeo parado.
 *  2. Desempenho: pedir fotogramas por ordem crescente de tempo aproveita a descodificação
 *     progressiva do ficheiro; saltar para trás e para a frente é muito mais lento.
 *
 * Este módulo não sabe nada de MediaPipe nem de DOM: recebe `processFrame(time)` e limita-se a
 * decidir QUANDO pedir, a medir o progresso, a tolerar falhas e a permitir cancelar.
 *
 * É usado em duas passagens:
 *  - `runGrid`: malha regular a cobrir o vídeo inteiro (descobrir a fase do cranque);
 *  - `runTimes`: lista explícita de instantes (ir buscar fotogramas na posição exata pedida).
 */

export class FullVideoScanRunner {
  /** Tempo máximo tolerado por fotograma antes de o considerar perdido. */
  static FRAME_TIMEOUT_MS = 9000;
  /** Falhas consecutivas que abortam o varrimento (evita varrer 10 minutos de nada). */
  static MAX_CONSECUTIVE_FAILURES = 8;

  constructor({
    processFrame,
    onProgress,
    onSample,
    onLog,
    frameTimeoutMs = FullVideoScanRunner.FRAME_TIMEOUT_MS,
    maxConsecutiveFailures = FullVideoScanRunner.MAX_CONSECUTIVE_FAILURES,
  } = {}) {
    if (typeof processFrame !== 'function') {
      throw new Error('FullVideoScanRunner requer um processFrame(time) válido.');
    }
    this.processFrame = processFrame;
    this.onProgress = onProgress;
    this.onSample = onSample;
    this.onLog = onLog;
    this.frameTimeoutMs = frameTimeoutMs;
    this.maxConsecutiveFailures = maxConsecutiveFailures;

    this.observations = [];
    this.isRunning = false;
    this._cancelled = false;
    /** Estatística da passagem em curso. */
    this.stats = this._freshStats();
    /** Estatística acumulada de todas as passagens (malha + refinação). */
    this.totals = this._freshStats();
  }

  /** Acumula a passagem terminada no total do varrimento. */
  _mergeTotals() {
    Object.keys(this.totals).forEach((key) => {
      const value = this.stats[key];
      if (typeof value !== 'number') return;
      this.totals[key] += value;
    });
    this.totals.lastTime = this.stats.lastTime;
  }

  _freshStats() {
    return {
      requested: 0,
      scanned: 0,
      samples: 0,
      failures: 0,
      timeouts: 0,
      elapsedMs: 0,
      lastTime: null,
    };
  }

  reset() {
    this.observations = [];
    this.stats = this._freshStats();
    this.totals = this._freshStats();
    this._cancelled = false;
  }

  cancel() {
    if (!this.isRunning) return;
    this._cancelled = true;
    if (this.onLog) this.onLog('info', 'Varrimento integral cancelado pelo utilizador.');
  }

  /**
   * Constrói a lista de instantes de uma malha regular.
   * @param {{ start:number, end:number, stepSeconds:number }} options
   * @returns {Array<{ time:number, meta:Object|null }>}
   */
  static buildGridEntries({ start = 0, end, stepSeconds }) {
    const entries = [];
    if (!Number.isFinite(end) || end <= start) return entries;
    const step = Number.isFinite(stepSeconds) && stepSeconds > 0 ? stepSeconds : 1 / 30;
    // Meia amostra de margem no fim evita pedir exatamente a duração (que alguns
    // descodificadores resolvem para o último fotograma já repetido).
    const last = Math.max(start, end - Math.min(step / 2, 0.05));
    for (let t = start; t < last; t += step) {
      entries.push({ time: Math.round(t * 10000) / 10000, meta: null });
    }
    return entries;
  }

  /**
   * Varrimento em malha regular sobre o vídeo todo.
   * @param {{ start?:number, end:number, stepSeconds:number }} options
   */
  async runGrid(options = {}) {
    return this._consume(FullVideoScanRunner.buildGridEntries(options), 'grid');
  }

  /**
   * Varrimento em instantes explícitos (ex.: posições cardeais do cranque).
   * @param {Array<{ time:number, key?:string, revolution?:number }>} times
   */
  async runTimes(times = []) {
    const entries = times
      .filter((entry) => entry && Number.isFinite(entry.time))
      .sort((a, b) => a.time - b.time)
      .map((entry) => ({ time: entry.time, meta: entry }));
    return this._consume(entries, 'refine');
  }

  /**
   * Consome uma lista de instantes, um de cada vez, com progresso e tolerância a falhas.
   * @param {Array<{ time:number, meta:Object|null }>} entries
   * @param {'grid'|'refine'} pass
   */
  async _consume(entries, pass) {
    if (this.isRunning) {
      return { pass, status: 'busy', reason: 'Já existe um varrimento em curso.', requested: entries.length, scanned: 0, samples: 0, failures: 0, elapsedMs: 0 };
    }
    this.isRunning = true;
    this._cancelled = false;
    // Cada passagem tem a sua própria contagem de amostras (o progresso e o relatório mostram
    // o que ESTA passagem fez, não um acumulado confuso).
    this.stats = this._freshStats();
    const startedAt = Date.now();
    let consecutiveFailures = 0;
    let status = 'done';
    let reason = null;

    const report = (index, time) => {
      if (!this.onProgress) return;
      this.onProgress({
        pass,
        index,
        total: entries.length,
        time,
        samples: this.stats.samples,
        failures: this.stats.failures,
        elapsedMs: Date.now() - startedAt,
        percent: entries.length ? Math.round((index / entries.length) * 1000) / 10 : 0,
      });
    };

    for (let index = 0; index < entries.length; index++) {
      if (this._cancelled) {
        status = 'cancelled';
        reason = 'Varrimento cancelado.';
        break;
      }
      const entry = entries[index];
      this.stats.requested++;
      this.stats.lastTime = entry.time;

      let observation = null;
      try {
        observation = await this._withTimeout(this.processFrame(entry.time, entry.meta), entry.time);
      } catch (err) {
        observation = null;
        if (this.onLog) this.onLog('warn', `Amostra em ${entry.time.toFixed(2)}s falhou: ${err?.message || err}`);
      }

      this.stats.scanned++;
      if (observation) {
        consecutiveFailures = 0;
        this.stats.samples++;
        if (entry.meta) {
          observation.intended = { key: entry.meta.key, revolution: entry.meta.revolution };
        }
        this.observations.push(observation);
        if (this.onSample) this.onSample(observation, pass);
      } else {
        consecutiveFailures++;
        this.stats.failures++;
        if (consecutiveFailures >= this.maxConsecutiveFailures) {
          status = 'failed';
          reason = `${consecutiveFailures} amostras consecutivas sem pose detetada — varrimento interrompido.`;
          if (this.onLog) this.onLog('error', reason);
          break;
        }
      }

      report(index + 1, entry.time);
      // Ceder o controlo ao browser entre amostras mantém a interface viva (progresso, cancelar).
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    this.stats.elapsedMs = Date.now() - startedAt;
    this._mergeTotals();
    this.isRunning = false;
    this._cancelled = false;

    return {
      pass,
      status,
      reason,
      requested: entries.length,
      scanned: this.stats.scanned,
      samples: this.stats.samples,
      failures: this.stats.failures,
      timeouts: this.stats.timeouts,
      elapsedMs: this.stats.elapsedMs,
    };
  }

  /** Aplica um limite de tempo a uma amostra (uma promessa presa não pode travar a análise). */
  _withTimeout(promise, time) {
    let timeoutId = null;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        this.stats.timeouts++;
        if (this.onLog) this.onLog('warn', `Amostra em ${time.toFixed(2)}s excedeu ${this.frameTimeoutMs} ms.`);
        resolve(null);
      }, this.frameTimeoutMs);
    });
    return Promise.race([Promise.resolve(promise).catch(() => null), timeout]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  }
}

export default FullVideoScanRunner;
