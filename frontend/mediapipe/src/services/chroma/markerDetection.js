/**
 * Deteção de marcadores ao nível do píxel (CromaTrack) — **pura, sem DOM**.
 *
 * Separada do `ChromaMarkerTracker` de propósito: aqui só entra um buffer RGBA e saem blobs.
 * O canvas, o redimensionamento e o `getImageData` ficam do outro lado. Resultado: todo o
 * algoritmo de deteção é verificável com **fotogramas sintéticos**, sem câmara e sem browser.
 */
import { findBlobs } from './blobDetector.js';
import { matchesMarker, rgbToHsv } from './hsvColorSpace.js';

/** Área mínima/máxima aceitável para uma mancha, à escala em que foi medida. */
export function areaBoundsFor(marker, frameWidth) {
  const radius = Math.max(1, marker.targetRadiusRatio * frameWidth);
  const expected = Math.PI * radius * radius;
  return { minArea: Math.max(4, expected * 0.09), maxArea: expected * 6 };
}

/**
 * Escreve em `mask` (1 por píxel que corresponde à cor do marcador) e devolve o nº de píxeis.
 *
 * @param {Uint8ClampedArray|Uint8Array} pixels  buffer RGBA
 * @param {Object} marker                        marcador normalizado (hueRanges, minSat, minVal)
 * @param {Uint8Array} mask                      buffer de saída (width*height)
 * @returns {number} píxeis marcados
 */
export function buildMaskForMarker(pixels, marker, mask) {
  let count = 0;
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    const hsv = rgbToHsv(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (matchesMarker(hsv, marker)) {
      mask[p] = 1;
      count += 1;
    } else {
      mask[p] = 0;
    }
  }
  return count;
}

/**
 * Deteta os blobs coloridos de um fotograma em buffer.
 *
 * @param {Uint8ClampedArray|Uint8Array} pixels  buffer RGBA do fotograma reduzido
 * @param {number} width
 * @param {number} height
 * @param {Array<Object>} markers                paleta normalizada
 * @param {Uint8Array} [maskBuffer]              buffer reutilizável (evita alocar por fotograma)
 * @returns {Array<Object>} blobs normalizados com pxX/pxY na escala de `width`/`height`
 */
export function detectMarkersInPixels(pixels, width, height, markers, maskBuffer = null) {
  const mask = maskBuffer || new Uint8Array(width * height);
  const blobs = [];

  for (const marker of markers) {
    buildMaskForMarker(pixels, marker, mask);
    const { minArea, maxArea } = areaBoundsFor(marker, width);
    const found = findBlobs(mask, width, height, { minArea, maxArea, minCompactness: 0.45 });

    for (const blob of found) {
      blobs.push({
        x: blob.cx / width,
        y: blob.cy / height,
        pxX: blob.cx,
        pxY: blob.cy,
        area: blob.area,
        compactness: blob.compactness,
        markerJoint: marker.joint,
      });
    }
  }

  return blobs;
}
