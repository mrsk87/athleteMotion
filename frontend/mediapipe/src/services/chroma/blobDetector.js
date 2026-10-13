/**
 * Deteção de "blobs" (manchas) numa máscara binária, para o CromaTrack.
 *
 * Responsabilidade única: dada uma máscara 0/1 (um byte por pixel), devolver as manchas com
 * área, caixa, centróide e duas medidas de forma. Não sabe nada de cores, HSV ou articulações —
 * é só geometria, e por isso testa-se com máscaras escritas à mão.
 *
 * Porque não círculos de Hough: se a cor já isolou a mancha, um ajuste de círculo é trabalho a
 * mais. A forma serve apenas para **rejeitar** candidatos maus (alongados, em anel), não para os
 * encontrar.
 */

/**
 * @typedef {Object} Blob
 * @property {number} cx           centróide X (píxeis, na máscara)
 * @property {number} cy           centróide Y (píxeis, na máscara)
 * @property {number} area         nº de píxeis
 * @property {number} width        largura da caixa envolvente
 * @property {number} height       altura da caixa envolvente
 * @property {number} aspect       maior/menor lado (1.0 = quadrado)
 * @property {number} compactness  proximidade a um disco: 1.0 = disco perfeito, < 0.4 rejeitar
 */

/**
 * Encontra as manchas de uma máscara por componentes ligados (8-vizinhos).
 *
 * @param {Uint8Array} mask   um valor != 0 por píxel pertencente ao alvo
 * @param {number} width
 * @param {number} height
 * @param {{ minArea?: number, maxArea?: number, minCompactness?: number }} [options]
 * @returns {Blob[]} ordenadas por área decrescente
 */
export function findBlobs(mask, width, height, options = {}) {
  const minArea = options.minArea ?? 6;
  const maxArea = options.maxArea ?? Number.MAX_SAFE_INTEGER;
  const minCompactness = options.minCompactness ?? 0.4;

  const visited = new Uint8Array(width * height);
  const blobs = [];
  // Pilha reutilizada entre manchas: evita criar arrays a cada componente (custo por fotograma).
  const stack = new Int32Array(width * height);

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || visited[start] !== 0) continue;

    let top = 0;
    stack[top++] = start;
    visited[start] = 1;

    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    while (top > 0) {
      const index = stack[--top];
      const x = index % width;
      const y = (index - x) / width;

      area += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // 8-vizinhos: uma mancha circular fotografada em ângulo continua ligada.
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const nIndex = ny * width + nx;
          if (mask[nIndex] !== 0 && visited[nIndex] === 0) {
            visited[nIndex] = 1;
            stack[top++] = nIndex;
          }
        }
      }
    }

    if (area < minArea || area > maxArea) continue;

    const blobWidth = maxX - minX + 1;
    const blobHeight = maxY - minY + 1;
    const radius = Math.max(blobWidth, blobHeight) / 2;
    const discArea = Math.PI * radius * radius;

    blobs.push({
      cx: sumX / area,
      cy: sumY / area,
      area,
      width: blobWidth,
      height: blobHeight,
      aspect: Math.max(blobWidth, blobHeight) / Math.max(1, Math.min(blobWidth, blobHeight)),
      // Um disco perfeito preenche πr²; uma mancha em anel preenche muito menos.
      compactness: discArea > 0 ? Math.min(1, area / discArea) : 0,
    });
  }

  return blobs
    .filter((blob) => blob.compactness >= minCompactness)
    .sort((a, b) => b.area - a.area);
}
