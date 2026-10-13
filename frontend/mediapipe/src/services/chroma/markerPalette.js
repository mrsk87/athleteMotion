/**
 * Paleta de marcadores do CromaTrack.
 *
 * Um marcador = uma articulação + uma matiz (ou duas, no vermelho, que dá a volta no 0/180).
 * As cores foram escolhidas **separadas no círculo de matiz** para que a identificação venha da
 * cor e não de adivinhação posicional: verde (joelho), magenta (tornozelo), ciano (anca),
 * amarelo (ombro) e vermelho (cotovelo).
 *
 * Nota da pesquisa que justifica o modo alternativo: a cor ideal depende da sala. Num velódromo
 * verde, o verde do joelho perde-se — daí existir `SINGLE_COLOR_MARKERS`, em que todos os
 * marcadores são da mesma cor e a identificação passa a ser **por proximidade** ao ponto que o
 * modelo de pose já prevê.
 */

/** Índices dos 33 marcos do modelo de pose, por articulação e lado. */
export const JOINT_LANDMARK_INDEX = {
  shoulder: { left: 11, right: 12 },
  elbow: { left: 13, right: 14 },
  hip: { left: 23, right: 24 },
  knee: { left: 25, right: 26 },
  ankle: { left: 27, right: 28 },
};

/** Articulações que o CromaTrack sabe ancorar, na ordem em que aparecem na interface. */
export const CHROMA_JOINTS = ['knee', 'ankle', 'hip', 'shoulder', 'elbow'];

/**
 * Cor visível de cada articulação (hex), para desenhar o retículo e a legenda.
 * Vive ao lado das matizes de propósito: é a **mesma** decisão de cor, escrita uma só vez.
 * Se a paleta mudar, muda aqui também — não em três sítios.
 */
export const CHROMA_JOINT_COLORS = {
  knee: '#22c55e',
  ankle: '#e879f9',
  hip: '#22d3ee',
  shoulder: '#facc15',
  elbow: '#ef4444',
};

/** Nome legível (PT) de cada articulação, usado nas etiquetas do overlay. */
export const CHROMA_JOINT_LABELS = {
  knee: 'Joelho',
  ankle: 'Tornozelo',
  hip: 'Anca',
  shoulder: 'Ombro',
  elbow: 'Cotovelo',
};

/**
 * Raio esperado do marcador, como fração da largura do fotograma **reduzido**. Serve para
 * dimensionar a área mínima/máxima aceitável de cada mancha — não é um requisito de tamanho
 * físico, é uma tolerância de escala.
 */
export const DEFAULT_TARGET_RADIUS_RATIO = 0.028;

/** Marcadores por omissão: uma cor distinta por articulação. */
export const DEFAULT_MARKERS = [
  { joint: 'knee', hueRanges: [[45, 80]], targetRadiusRatio: DEFAULT_TARGET_RADIUS_RATIO },
  { joint: 'ankle', hueRanges: [[140, 170]], targetRadiusRatio: DEFAULT_TARGET_RADIUS_RATIO },
  { joint: 'hip', hueRanges: [[85, 100]], targetRadiusRatio: DEFAULT_TARGET_RADIUS_RATIO },
  { joint: 'shoulder', hueRanges: [[20, 35]], targetRadiusRatio: DEFAULT_TARGET_RADIUS_RATIO },
  // O vermelho atravessa o 0/180: dois intervalos, senão metade dos píxeis ficava de fora.
  { joint: 'elbow', hueRanges: [[170, 180], [0, 8]], targetRadiusRatio: DEFAULT_TARGET_RADIUS_RATIO },
];

/**
 * Marcador único (verde) para as cinco articulações: a identificação é posicional.
 * Todos têm `resolveByProximity: true` e o mesmo `joint` reservado `'any'`.
 */
export const SINGLE_COLOR_MARKERS = [
  {
    joint: 'any',
    hueRanges: [[45, 80]],
    targetRadiusRatio: DEFAULT_TARGET_RADIUS_RATIO,
    resolveByProximity: true,
  },
];

/** Saturação e brilho mínimos: rejeitam cinzentos e sombras profundas onde a matiz mente. */
export const DEFAULT_MIN_SATURATION = 70;
export const DEFAULT_MIN_VALUE = 45;

/** Completa um marcador com os mínimos por omissão (a paleta é declarativa, curta). */
export function normalizeMarker(marker) {
  return {
    joint: marker.joint,
    hueRanges: marker.hueRanges,
    minSaturation: marker.minSaturation ?? DEFAULT_MIN_SATURATION,
    minValue: marker.minValue ?? DEFAULT_MIN_VALUE,
    targetRadiusRatio: marker.targetRadiusRatio ?? DEFAULT_TARGET_RADIUS_RATIO,
    resolveByProximity: Boolean(marker.resolveByProximity),
  };
}

/** Escolhe a paleta a usar. `singleColor` = todos os marcadores da mesma cor. */
export function paletteFor({ singleColor = false, markers = null } = {}) {
  const source = markers || (singleColor ? SINGLE_COLOR_MARKERS : DEFAULT_MARKERS);
  return source.map(normalizeMarker);
}

/** Índice do marco (0-32) desta articulação no lado ativo. */
export function landmarkIndexFor(joint, side) {
  const entry = JOINT_LANDMARK_INDEX[joint];
  if (!entry) return null;
  return entry[side === 'left' ? 'left' : 'right'];
}
