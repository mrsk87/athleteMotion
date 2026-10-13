/**
 * Ritmo com que se guardam fotogramas para o GIF animado (GifFramePlanner).
 *
 * PORQUÊ UM MÓDULO SEPARADO:
 * São DOIS ritmos diferentes, porque são dois momentos diferentes da aplicação:
 *
 *  1. **Reprodução (ao vivo).** O utilizador está a ver o vídeo e o GIF deve sair fluido:
 *     um fotograma a cada 100 ms (os 10 FPS que o serviço de compilação assume).
 *  2. **Varrimento integral.** As amostras estão espalhadas por todo o vídeo (malha de 1/30 s a
 *     0,1 s, mais a refinação nos pontos cardeais) e não seguem a ordem do tempo — a refinação
 *     salta para trás. Aqui o que interessa é COBERTURA: guarda-se um fotograma por fatia de
 *     `duração / 60` segundos, pelo que o GIF mostra o vídeo inteiro com o esqueleto em cada
 *     instante amostrado, e a ordem das amostras deixa de importar.
 *
 * Sem esta distinção, o varrimento enchia o álbum com dezenas de fotogramas dos primeiros
 * segundos (limite de 60 atingido logo no início) e o GIF nunca chegava ao resto do vídeo; e a
 * exportação a seguir a uma análise saía com uma só imagem.
 *
 * O módulo é puro: não toca no DOM nem no canvas, pelo que pode ser verificado sem navegador
 * (`npm run verify:full-analysis`).
 */

/** Fotogramas por GIF. O serviço aceita até 120 e corta em 100: 60 mantém o ficheiro leve. */
export const MAX_GIF_FRAMES = 60;
/** Intervalo entre fotogramas do GIF durante a reprodução (10 FPS). */
export const GIF_CAPTURE_INTERVAL_MS = 100;

export class GifFramePlanner {
  /**
   * @param {{ maxFrames?: number, intervalMs?: number }} [options]
   */
  constructor({ maxFrames = MAX_GIF_FRAMES, intervalMs = GIF_CAPTURE_INTERVAL_MS } = {}) {
    this.maxFrames = maxFrames;
    this.intervalMs = intervalMs;
    this.reset();
  }

  /** Esquece o histórico (nova análise, novo vídeo). */
  reset() {
    this.count = 0;
    this._lastLiveAt = null;
    this._usedSlots = new Set();
  }

  /** O álbum já está cheio? */
  get full() {
    return this.count >= this.maxFrames;
  }

  /** Regista um fotograma guardado (chamado por quem guardou). */
  markCaptured() {
    this.count += 1;
    return this.count;
  }

  /**
   * Fotograma da reprodução: um a cada `intervalMs` de tempo de relógio.
   * @param {number} now - `performance.now()`
   * @returns {boolean} `true` se é altura de capturar.
   */
  shouldCaptureLive(now) {
    if (this.full) return false;
    if (this._lastLiveAt !== null && now - this._lastLiveAt < this.intervalMs) return false;
    this._lastLiveAt = now;
    return true;
  }

  /**
   * Fotograma do varrimento integral: um por fatia de `duração / máximo` segundos.
   * As amostras podem chegar fora de ordem (a refinação recua no tempo): a fatia é
   * contabilizada uma única vez, pelo que nunca há duplicados nem buracos de cobertura.
   * @param {number} time - instante do fotograma no vídeo (s)
   * @param {number} duration - duração total do vídeo (s)
   * @returns {boolean} `true` se é altura de capturar.
   */
  shouldCaptureAtTime(time, duration) {
    if (this.full) return false;
    if (!Number.isFinite(duration) || duration <= 0) return this.shouldCaptureLive(performance.now());
    const slotSize = duration / this.maxFrames;
    const slot = Math.max(0, Math.min(this.maxFrames - 1, Math.floor((Number(time) || 0) / slotSize)));
    if (this._usedSlots.has(slot)) return false;
    this._usedSlots.add(slot);
    return true;
  }

  /** Quantas fatias do vídeo já têm fotograma (prova de cobertura, para o relatório). */
  get coveredSlots() {
    return this._usedSlots.size;
  }
}

export default GifFramePlanner;
