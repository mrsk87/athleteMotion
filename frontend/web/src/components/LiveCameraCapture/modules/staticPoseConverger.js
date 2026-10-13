/**
 * Convergência de Pose em Imagem Estática (StaticPoseConverger).
 *
 * PORQUÊ:
 * Numa FOTO o resultado tem de ser um só. O modelo de pose não dá exatamente os mesmos pontos em
 * passagens repetidas da MESMA imagem (a solução é uma grafo com estado e cada inferência ajusta
 * a região de interesse), e o utilizador via isso: carregar em "re-analisar" desenhava um esqueleto
 * diferente de cada vez — e, com ele, ângulos diferentes na recomendação.
 *
 * COMO:
 *   1. A mesma imagem é inferida VÁRIAS vezes (cada passagem parte de uma leitura limpa).
 *   2. Guarda-se o **ponto médio** de cada marco anatómico — na verdade a **mediana** por
 *      coordenada, que é o ponto médio robusto: uma passagem disparatada não desloca o resultado,
 *      enquanto a média seria arrastada por ela.
 *   3. A leitura só é dada como final quando a mediana **para de mexer** entre passagens
 *      (deslocamento máximo abaixo da tolerância) — ou quando se esgota o orçamento de passagens,
 *      caso em que se devolve a mediana com `converged: false` (nunca se esconde o que aconteceu).
 *   4. O traço corporal é desenhado UMA vez, a partir dessa mediana.
 *
 * Nada aqui desenha ou mede ângulos: o módulo só devolve os marcos estáveis e a dispersão medida,
 * para que o cálculo e o desenho aconteçam depois.
 */

/** Parâmetros por omissão da convergência. */
export const CONVERGENCE_DEFAULTS = {
  /** Passagens mínimas antes de se poder concluir (uma só leitura nunca é uma média). */
  minPasses: 3,
  /** Orçamento máximo de passagens (tempo de espera aceitável para o utilizador). */
  maxPasses: 7,
  /** Deslocamento máximo aceite do ponto médio, em fração da imagem (0,006 = 0,6%). */
  tolerance: 0.006,
  /** Visibilidade mínima de um marco para a amostra ser considerada válida. */
  minVisibility: 0.3,
};

/** Mediana de uma lista de números (ignora valores inválidos). */
export function median(values = []) {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

/**
 * Ponto médio de cada marco anatómico a partir de várias amostras.
 *
 * @param {Array<Array<Object>>} samples marcos do MediaPipe (33 pontos) por passagem
 * @returns {{ landmarks: Array<Object>|null, landmarkCount: number, samples: number }}
 */
export function medianLandmarks(samples = []) {
  const valid = (samples || []).filter((sample) => Array.isArray(sample) && sample.length);
  if (!valid.length) return { landmarks: null, landmarkCount: 0, samples: 0 };

  const count = Math.min(...valid.map((s) => s.length));
  const landmarks = [];
  for (let i = 0; i < count; i++) {
    const points = valid.map((sample) => sample[i]).filter(Boolean);
    if (!points.length) {
      landmarks.push({ x: 0, y: 0, z: 0, visibility: 0, spreadDist: 0, history: [] });
      continue;
    }
    const medX = median(points.map((p) => p.x));
    const medY = median(points.map((p) => p.y));
    const medZ = median(points.map((p) => p.z));
    const medVis = median(points.map((p) => p.visibility));

    const distances = points.map((p) => Math.hypot((p.x ?? 0) - medX, (p.y ?? 0) - medY));
    const maxSpread = distances.length ? Math.max(...distances) : 0;

    landmarks.push({
      x: medX,
      y: medY,
      z: medZ,
      visibility: medVis,
      spreadDist: Math.round(maxSpread * 10000) / 100, // em % da imagem
      history: points.map((p) => ({ x: p.x, y: p.y })),
    });
  }
  return { landmarks, landmarkCount: count, samples: valid.length };
}

/**
 * Deslocamento máximo entre dois conjuntos de marcos (fração da imagem) — a métrica que diz se a
 * leitura "parou de mexer". Devolve `null` se não houver pontos comparáveis.
 */
export function maxLandmarkShift(previous = [], next = []) {
  if (!Array.isArray(previous) || !Array.isArray(next) || !previous.length || !next.length) return null;
  const count = Math.min(previous.length, next.length);
  let max = 0;
  let seen = 0;
  for (let i = 0; i < count; i++) {
    const a = previous[i];
    const b = next[i];
    if (!a || !b) continue;
    const distance = Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
    if (!Number.isFinite(distance)) continue;
    seen++;
    if (distance > max) max = distance;
  }
  return seen ? max : null;
}

/**
 * Dispersão das amostras face ao ponto médio: mediana do desvio máximo de cada passagem, em
 * percentagem da imagem. É o número honesto para mostrar ("as passagens afastaram-se até X%").
 */
export function sampleSpreadPercent(samples = [], landmarks = []) {
  const shifts = (samples || [])
    .map((sample) => maxLandmarkShift(sample, landmarks))
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (!shifts.length) return null;
  const med = median(shifts);
  return med === null ? null : Math.round(med * 1000) / 10;
}

/** Verifica se uma amostra tem marcos suficientes para contar (33 pontos do MediaPipe Pose). */
export function isValidLandmarkSample(sample, minCount = 33) {
  return Array.isArray(sample) && sample.length >= minCount && sample.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

/**
 * Extrai um mapa legível das posições dos pontos médios das articulações principais.
 *
 * @param {Array<Object>} landmarks marcos médios calculados
 * @param {'left'|'right'} [side='left'] lado filmado do atleta
 * @param {number} [canvasWidth=1000] largura de referência em pixels
 * @param {number} [canvasHeight=1000] altura de referência em pixels
 * @returns {Object<string, { label: string, normX: number, normY: number, pctX: string, pctY: string, pixelX: number, pixelY: number, spread: number|null, history: Array }>}
 */
export function extractMedianJointPositions(landmarks, side = 'left', canvasWidth = 1000, canvasHeight = 1000) {
  if (!Array.isArray(landmarks) || !landmarks.length) return {};
  const isLeft = side === 'left';
  const jointDef = [
    { key: 'joelho', label: 'Joelho', idx: isLeft ? 25 : 26 },
    { key: 'tornozelo', label: 'Tornozelo', idx: isLeft ? 27 : 28 },
    { key: 'anca', label: 'Anca', idx: isLeft ? 23 : 24 },
    { key: 'ombro', label: 'Ombro', idx: isLeft ? 11 : 12 },
    { key: 'cotovelo', label: 'Cotovelo', idx: isLeft ? 13 : 14 },
    { key: 'pulso', label: 'Pulso', idx: isLeft ? 15 : 16 },
    { key: 'cabeca', label: 'Cabeça', idx: isLeft ? 7 : 8 },
  ];

  const w = canvasWidth || 1000;
  const h = canvasHeight || 1000;
  const result = {};

  for (const { key, label, idx } of jointDef) {
    const lm = landmarks[idx];
    if (lm && Number.isFinite(lm.x) && Number.isFinite(lm.y)) {
      result[key] = {
        label,
        normX: Math.round(lm.x * 1000) / 1000,
        normY: Math.round(lm.y * 1000) / 1000,
        pctX: `${(lm.x * 100).toFixed(1)}%`,
        pctY: `${(lm.y * 100).toFixed(1)}%`,
        pixelX: Math.round(lm.x * w),
        pixelY: Math.round(lm.y * h),
        spread: lm.spreadDist ?? null,
        history: Array.isArray(lm.history) ? lm.history : [],
      };
    }
  }
  return result;
}

/**
 * Executa a convergência: infere a mesma imagem repetidamente e devolve o ponto médio estável.
 *
 * @param {Object} params
 * @param {Function} params.capture  função assíncrona que faz UMA inferência e devolve os marcos (ou null)
 * @param {Object}   [params.options] ver `CONVERGENCE_DEFAULTS`
 * @param {Function} [params.onProgress] chamada com `{ pass, maxPasses, phase: 'sampling'|'settled' }`
 * @returns {Promise<Object>} `{ landmarks, passes, converged, dispersion, samples, rejected, allSamples }`
 */
export async function convergeStaticPose({ capture, options = {}, onProgress } = {}) {
  const config = { ...CONVERGENCE_DEFAULTS, ...options };
  const samples = [];
  let rejected = 0;
  let previousMedian = null;
  let lastMedian = null;
  let lastShift = null;
  let converged = false;
  let passes = 0;

  for (let pass = 1; pass <= config.maxPasses; pass++) {
    passes = pass;
    if (onProgress) onProgress({ pass, maxPasses: config.maxPasses, phase: 'sampling' });

    let raw = null;
    try {
      raw = await capture(pass);
    } catch (err) {
      raw = null;
    }
    if (isValidLandmarkSample(raw)) samples.push(raw);
    else rejected++;

    if (samples.length < config.minPasses) {
      continue;
    }

    const median = medianLandmarks(samples);
    lastMedian = median.landmarks;
    if (previousMedian) {
      const shift = maxLandmarkShift(previousMedian, median.landmarks);
      lastShift = shift;
      if (shift !== null && shift <= config.tolerance) {
        converged = true;
        if (onProgress) onProgress({ pass, maxPasses: config.maxPasses, phase: 'settled', shift });
        break;
      }
    }
    previousMedian = median.landmarks;
  }

  const final = samples.length ? medianLandmarks(samples) : { landmarks: null, landmarkCount: 0, samples: 0 };

  return {
    landmarks: final.landmarks,
    passes,
    converged,
    samples: samples.length,
    allSamples: samples,
    rejected,
    // Deslocamento do ponto médio entre as duas últimas passagens (fração da imagem)…
    lastShift,
    // …e os dois números que se mostram ao utilizador, em percentagem da imagem: quanto o ponto
    // médio se mexeu por último e quanto as passagens se afastaram do resultado final.
    shiftPercent: lastShift === null ? null : Math.round(lastShift * 1000) / 10,
    spreadPercent: sampleSpreadPercent(samples, lastMedian || final.landmarks),
  };
}

export default { convergeStaticPose, medianLandmarks, maxLandmarkShift, extractMedianJointPositions, CONVERGENCE_DEFAULTS };
