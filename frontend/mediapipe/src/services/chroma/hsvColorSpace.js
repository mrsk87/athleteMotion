/**
 * Espaço de cor HSV para o CromaTrack.
 *
 * Porque HSV e não RGB: um marcador verde continua "verde" quando a luz sobe ou desce — o que
 * muda é o Valor, não a matiz. Limiar em RGB obrigaria a recalibrar a cada mudança de luz.
 *
 * Escala **OpenCV**: H em [0, 180), S e V em [0, 255]. Foi escolhida de propósito para os
 * limiares publicados (tutoriais do `inRange`) poderem ser copiados diretamente. Com H em
 * [0,180) o vermelho dá a volta no 0/180, razão pela qual um marcador admite **mais que um
 * intervalo** de matiz.
 */

/** @typedef {{ h: number, s: number, v: number }} Hsv */

const MAX_HUE = 180;

/**
 * RGB (0-255) → HSV na escala OpenCV.
 * @returns {Hsv}
 */
export function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let hue = 0;
  if (delta > 0) {
    if (max === rn) hue = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) hue = 60 * ((bn - rn) / delta + 2);
    else hue = 60 * ((rn - gn) / delta + 4);
  }
  if (hue < 0) hue += 360;

  return {
    h: hue / 2, // 0-360 → 0-180 (escala OpenCV)
    s: max === 0 ? 0 : (delta / max) * 255,
    v: max * 255,
  };
}

/**
 * O valor está dentro de UM intervalo de matiz? Trata a volta do vermelho.
 * Se `lo > hi` o intervalo atravessa o 0/180 (ex.: [170, 8] = 170–180 e 0–8).
 */
export function hueInRange(hue, lo, hi) {
  if (lo <= hi) return hue >= lo && hue <= hi;
  return hue >= lo || hue <= hi;
}

/**
 * O pixel corresponde a este marcador? Testa matiz (qualquer dos intervalos) + saturação +
 * brilho mínimos. Saturação mínima rejeita cinzentos; brilho mínimo rejeita sombras profundas
 * onde a matiz deixa de ser fiável (a pesquisa é explícita sobre isto).
 *
 * @param {Hsv} hsv
 * @param {{ hueRanges: Array<[number, number]>, minSaturation: number, minValue: number }} marker
 * @returns {boolean}
 */
export function matchesMarker(hsv, marker) {
  if (hsv.s < marker.minSaturation || hsv.v < marker.minValue) return false;
  return marker.hueRanges.some(([lo, hi]) => hueInRange(hsv.h, lo, hi));
}

/**
 * Normaliza um intervalo de matiz escrito "à mão" (aceita H em 0-360 de um seletor de cor
 * e converte para a escala OpenCV). Utilidade de apoio à interface.
 */
export function toOpenCvHue(hue0to360) {
  const wrapped = ((hue0to360 % 360) + 360) % 360;
  return wrapped / 2;
}

export { MAX_HUE };
