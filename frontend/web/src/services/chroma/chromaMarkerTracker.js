/**
 * CromaTrack — captura do fotograma e deteção de marcadores coloridos (lado browser).
 *
 * Responsabilidade única: **obter os píxeis** de um fotograma de forma barata e entregá-los ao
 * detetor puro (`markerDetection.js`). Não contém o algoritmo — esse vive fora do DOM e é
 * verificado com fotogramas sintéticos.
 *
 * Decisões de desempenho (vêm da pesquisa, ver `docs/CHROMA_TRACK_TASKS.md`):
 * - O gargalo é a **leitura de píxeis** (720p ≈ 3,7 MB por fotograma). Por isso o fotograma é
 *   reduzido para uma cópia pequena (320 px de largura por omissão) e só essa é lida.
 * - O canvas auxiliar usa `willReadFrequently: true` — dica explícita ao browser para manter os
 *   píxeis na CPU, evitando readback da GPU a cada fotograma.
 * - Canvas, máscara e buffers são **reutilizados**; nada é alocado por fotograma.
 * - As coordenadas devolvidas são normalizadas [0..1], por isso a redução não custa precisão.
 */
import { detectMarkersInPixels } from './markerDetection.js';
import { paletteFor } from './markerPalette.js';

const DEFAULT_PROCESSING_WIDTH = 320;

export class ChromaMarkerTracker {
  constructor({ processingWidth = DEFAULT_PROCESSING_WIDTH, singleColor = false, markers = null } = {}) {
    this.processingWidth = processingWidth;
    this.singleColor = singleColor;
    this.markers = paletteFor({ singleColor, markers });
    this.enabled = false;

    this.canvas = null;
    this.ctx = null;
    this.mask = null;
    this.height = 0;

    // Diagnóstico mostrado no painel: quantos blobs e quanto custou a deteção.
    this.lastBlobCount = 0;
    this.lastDurationMs = 0;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  /** Troca de paleta (cores distintas vs. uma só cor). */
  setMarkers({ singleColor = this.singleColor, markers = null } = {}) {
    this.singleColor = singleColor;
    this.markers = paletteFor({ singleColor, markers });
  }

  _prepare(height) {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    if (this.canvas.width !== this.processingWidth || this.canvas.height !== height) {
      this.canvas.width = this.processingWidth;
      this.canvas.height = height;
      this.mask = new Uint8Array(this.processingWidth * height);
    }
    this.height = height;
    return this.ctx;
  }

  /**
   * Deteta os blobs coloridos do fotograma.
   *
   * @param {HTMLVideoElement|HTMLCanvasElement|HTMLImageElement} source
   * @param {number} sourceWidth   largura real da fonte
   * @param {number} sourceHeight  altura real da fonte
   * @returns {Array<Object>} blobs normalizados
   */
  detect(source, sourceWidth, sourceHeight) {
    if (!this.enabled || !source || !sourceWidth || !sourceHeight) return [];

    const started = performance.now();
    const height = Math.max(1, Math.round((this.processingWidth * sourceHeight) / sourceWidth));
    const ctx = this._prepare(height);
    if (!ctx) return [];

    let pixels;
    try {
      ctx.drawImage(source, 0, 0, this.processingWidth, height);
      pixels = ctx.getImageData(0, 0, this.processingWidth, height).data;
    } catch {
      // Fonte ainda sem fotograma válido (vídeo a carregar, canvas vazio): "sem dados", não erro.
      return [];
    }

    const blobs = detectMarkersInPixels(pixels, this.processingWidth, height, this.markers, this.mask);

    this.lastBlobCount = blobs.length;
    this.lastDurationMs = performance.now() - started;
    return blobs;
  }

  /** Limpa buffers e diagnóstico (ao parar a análise). */
  reset() {
    this.lastBlobCount = 0;
    this.lastDurationMs = 0;
  }
}
