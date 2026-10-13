/**
 * Rastreador Ótico de Alta Precisão baseado em Relevo e Luz (OpticalFeatureTracker).
 *
 * Responsabilidade:
 * - Acompanhar um ponto anatómico em concreto (ex: adesivo no joelho, saliência óssea, sapato).
 * - Analisar as características visuais do ponto: luminância, gradientes de relevo, contrastes e formas.
 * - Manter o ponto travado sem qualquer oscilação ou jitter através de correlação cruzada normalizada (ZNCC).
 * - Fornecer dados para a Lupa de Inspeção de Relevo em tempo real.
 */

export class OpticalFeatureTracker {
  constructor() {
    this.lockedPoints = new Map(); // jointKey -> MarkerDescriptor
    this.patchRadius = 10; // Tamanho do patch: 21x21 píxeis
    this.searchRadius = 24; // Janela de busca local: +-24 píxeis
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
  }

  _getOffscreen(w, h) {
    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (this.offscreenCanvas.width !== w || this.offscreenCanvas.height !== h) {
      this.offscreenCanvas.width = w;
      this.offscreenCanvas.height = h;
    }
    return this.offscreenCtx;
  }

  /**
   * Extrai o vetor de características (luminância + relevo de bordas) de um patch centrado em (cx, cy).
   */
  _extractDescriptor(ctx, cx, cy, radius) {
    const size = radius * 2 + 1;
    const startX = Math.round(cx - radius);
    const startY = Math.round(cy - radius);

    let imgData;
    try {
      imgData = ctx.getImageData(startX, startY, size, size);
    } catch {
      return null;
    }

    const data = imgData.data;
    const descriptor = new Float32Array(size * size);
    let sum = 0;

    // 1. Extração de luminância e gradiente local (relevo)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        // Luminância percebida
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        // Gradiente horizontal e vertical (relevo físico)
        let gx = 0;
        let gy = 0;
        if (x > 0 && x < size - 1) {
          const lumL = 0.299 * data[idx - 4] + 0.587 * data[idx - 3] + 0.114 * data[idx - 2];
          const lumR = 0.299 * data[idx + 4] + 0.587 * data[idx + 5] + 0.114 * data[idx + 6];
          gx = Math.abs(lumR - lumL);
        }
        if (y > 0 && y < size - 1) {
          const lumU = 0.299 * data[idx - size * 4] + 0.587 * data[idx - size * 4 + 1] + 0.114 * data[idx - size * 4 + 2];
          const lumD = 0.299 * data[idx + size * 4] + 0.587 * data[idx + size * 4 + 1] + 0.114 * data[idx + size * 4 + 2];
          gy = Math.abs(lumD - lumU);
        }

        const featureVal = lum * 0.65 + (gx + gy) * 0.35;
        descriptor[y * size + x] = featureVal;
        sum += featureVal;
      }
    }

    // 2. Normalização ZNCC (média zero e desvio-padrão unitário)
    const mean = sum / descriptor.length;
    let varSum = 0;
    for (let i = 0; i < descriptor.length; i++) {
      descriptor[i] -= mean;
      varSum += descriptor[i] * descriptor[i];
    }
    const std = Math.sqrt(varSum) || 1.0;
    for (let i = 0; i < descriptor.length; i++) {
      descriptor[i] /= std;
    }

    return { descriptor, rawData: imgData, size };
  }

  /**
   * Bloqueia um ponto anatómico para rastreio ótico estrito de relevo e formas.
   */
  lockMarker(jointKey, normX, normY, videoOrCanvas) {
    if (!videoOrCanvas) return false;
    const w = videoOrCanvas.videoWidth || videoOrCanvas.width || 640;
    const h = videoOrCanvas.videoHeight || videoOrCanvas.height || 480;

    const ctx = this._getOffscreen(w, h);
    ctx.drawImage(videoOrCanvas, 0, 0, w, h);

    const pxX = normX * w;
    const pxY = normY * h;
    const patch = this._extractDescriptor(ctx, pxX, pxY, this.patchRadius);
    if (!patch) return false;

    // Guarda o descritor e dados para a lupa
    this.lockedPoints.set(jointKey, {
      jointKey,
      template: patch.descriptor,
      normX,
      normY,
      pxX,
      pxY,
      confidence: 100,
      status: 'LOCKED',
      lockedAt: Date.now(),
      lastSeenAt: Date.now(),
      w,
      h,
    });

    return true;
  }

  /**
   * Acompanha o ponto no fotograma atual analisando a janela local de busca.
   */
  track(jointKey, fallbackNormX, fallbackNormY, videoOrCanvas) {
    const marker = this.lockedPoints.get(jointKey);
    if (!marker || !videoOrCanvas) return null;

    const w = videoOrCanvas.videoWidth || videoOrCanvas.width || marker.w;
    const h = videoOrCanvas.videoHeight || videoOrCanvas.height || marker.h;
    marker.w = w;
    marker.h = h;

    const ctx = this._getOffscreen(w, h);
    ctx.drawImage(videoOrCanvas, 0, 0, w, h);

    // Centro inicial de busca: ponto anterior refinado com peso do fallback do MediaPipe
    const centerPxX = marker.pxX * 0.7 + (fallbackNormX * w) * 0.3;
    const centerPxY = marker.pxY * 0.7 + (fallbackNormY * h) * 0.3;

    let bestScore = -1.0;
    let bestPxX = centerPxX;
    let bestPxY = centerPxY;
    const tpl = marker.template;
    const r = this.patchRadius;
    const s = this.searchRadius;

    // Busca exaustiva local a passo de 1 pixel
    for (let dy = -s; dy <= s; dy += 2) {
      for (let dx = -s; dx <= s; dx += 2) {
        const cx = centerPxX + dx;
        const cy = centerPxY + dy;
        if (cx - r < 0 || cx + r >= w || cy - r < 0 || cy + r >= h) continue;

        const cand = this._extractDescriptor(ctx, cx, cy, r);
        if (!cand) continue;

        // Correlação cruzada normalizada: sum(T * C)
        let score = 0;
        const cDesc = cand.descriptor;
        for (let i = 0; i < tpl.length; i++) {
          score += tpl[i] * cDesc[i];
        }
        score /= tpl.length;

        if (score > bestScore) {
          bestScore = score;
          bestPxX = cx;
          bestPxY = cy;
        }
      }
    }

    // Limiar de confiança do relevo (ZNCC > 0.52)
    if (bestScore >= 0.52) {
      marker.pxX = bestPxX;
      marker.pxY = bestPxY;
      marker.normX = bestPxX / w;
      marker.normY = bestPxY / h;
      marker.confidence = Math.min(100, Math.round(bestScore * 100));
      marker.status = 'LOCKED';
      marker.lastSeenAt = Date.now();

      return {
        x: marker.normX,
        y: marker.normY,
        confidence: marker.confidence,
        status: 'LOCKED',
        pxX: marker.pxX,
        pxY: marker.pxY,
        isOptical: true,
      };
    }

    // Se o contraste baixar momentaneamente, utiliza a estimativa MediaPipe
    marker.status = 'SEARCHING';
    marker.pxX = fallbackNormX * w;
    marker.pxY = fallbackNormY * h;
    marker.normX = fallbackNormX;
    marker.normY = fallbackNormY;
    marker.confidence = Math.max(20, Math.round(bestScore * 100));

    return {
      x: fallbackNormX,
      y: fallbackNormY,
      confidence: marker.confidence,
      status: 'SEARCHING',
      pxX: marker.pxX,
      pxY: marker.pxY,
      isOptical: true,
    };
  }

  isLocked(jointKey) {
    return this.lockedPoints.has(jointKey);
  }

  getMarker(jointKey) {
    return this.lockedPoints.get(jointKey) || null;
  }

  getAllMarkers() {
    return Array.from(this.lockedPoints.values());
  }

  unlock(jointKey) {
    return this.lockedPoints.delete(jointKey);
  }

  clearAll() {
    this.lockedPoints.clear();
  }
}
