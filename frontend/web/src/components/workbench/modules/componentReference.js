/**
 * Valores de Referência de Componentes (ComponentReference).
 *
 * PORQUÊ ESTE FICHEIRO:
 * O reach e o drop do guiador, o comprimento do avanço e a largura do guiador são as quatro peças
 * do cockpit que o atleta declara no passo 1. Sem uma tabela de referência publicada, a bancada só
 * conseguia dizer "encurtar o avanço 15 mm" — um número sem escala. Aqui ficam os valores que os
 * fabricantes e os fitter publicam, cada um com a sua fonte, para a bancada poder dizer se o que
 * está montado é uma curva compacta, tradicional ou de gravel, e se o avanço está dentro da faixa
 * daquele tamanho de quadro.
 *
 * LIMITES DECLARADOS:
 *  - **Reach e drop não têm alvo universal**: são descritivos. O que se faz é identificar o TIPO de
 *    curva e dizer quando ela contradiz a postura medida (ex.: drop fundo com tronco alto).
 *  - **O comprimento do avanço não define o alcance sozinho**: o alcance sentido nas mãos =
 *    reach do quadro + avanço + reach do guiador (+ posição dos manetes). Um quadro mais comprido
 *    pede um avanço mais curto para o mesmo resultado.
 *  - **A largura do guiador não tem tolerância universal**: a referência é igual ou ligeiramente
 *    acima da largura biacromial; um passo comercial de 20 mm é a experiência a testar, não uma
 *    norma. Em guiadores de gravel a largura nos drops pode ser 60–70 mm maior que nos manetes.
 */

/** Fontes lidas para os valores abaixo. */
export const COMPONENT_SOURCES = {
  fsaOmegaCompact: 'https://www.fsaproshop.com/products/omega-compact-road-handlebar',
  ritcheyEvoCurve: 'https://ritcheylogic.com/bike/handlebars/superlogic-evocurve-internal-routing-handlebar',
  hoggBars: 'https://bicyclingaustralia.com.au/news/talking-handlebars-with-steve-hogg/',
  zippSl70Ergo: 'https://www.sram.com/en/zipp/models/hb-dbsc-sl7e-b2',
  zippSl70Xplr: 'https://support.zipp.com/hc/en-us/articles/27115807116955-What-reach-and-drop-is-available-on-the-SL-70-XPLR-handlebars',
  ritcheyVentureMax: 'https://ritcheylogic.com/bike/handlebars/comp-venturemax-handlebar',
  eastonEc70ax: 'https://eastoncycling.com/products/ec70-ax-bar',
  eastonWidth: 'https://eastoncycling.com/products/ec70-ax-bar',
  myVeloFitStem: 'https://www.myvelofit.com/stem-calculator/',
  myVeloFitGeometry: 'https://www.myvelofit.com/fit-academy/bicycle-geometry-101-fit-geometry/',
  redshiftWidth: 'https://redshiftsports.com/blogs/redshift-sports/are-your-handlebars-too-narrow-a-comprehensive-guide-for-gravel-road-and-mountain-bikes',
  reneHerse: 'https://www.renehersecycles.com/handlebars-wide-vs-narrow/',
  ritcheyGuide: 'https://ritcheylogic.com/guides/gravel-components/gravel-handlebars',
};

/**
 * Tipos de curva de guiador de estrada/gravel: reach × drop típicos e exemplos publicados.
 * `deepFromMm` = drop a partir do qual a curva é considerada funda (prática de fit).
 */
export const BAR_SHAPE_TYPES = [
  {
    id: 'compact',
    label: 'Compacta',
    reachMm: [70, 80],
    // Faixa alinhada com a fonte única já existente na aplicação (equipmentFitRules:
    // COMPACT_BAR_DROP_RANGE_MM = 115–130 mm). Os exemplos publicados ficam dentro dela (120–130).
    dropMm: [115, 130],
    examples: [
      'FSA Omega Compact — 75 × 120 mm',
      'Ritchey SuperLogic EvoCurve — 80 × 130 mm',
    ],
    whenToUse:
      'Quando o atleta não usa os drops ou tem o tronco alto: chega-se às manetes e ao fundo sem fechar a respiração.',
    source: COMPONENT_SOURCES.fsaOmegaCompact,
  },
  {
    id: 'ergo',
    label: 'Ergonómica / shallow',
    reachMm: [70, 75],
    dropMm: [123, 128],
    examples: ['Zipp SL-70 Ergo — 70 × 128 mm', 'Specialized Expert Shallow — 75 × 123 mm'],
    whenToUse:
      '"Ergo" descreve a forma do topo/curva e não é uma norma de medidas: comparar a geometria real, não o rótulo.',
    source: COMPONENT_SOURCES.zippSl70Ergo,
  },
  {
    id: 'traditional',
    label: 'Tradicional / redonda funda',
    reachMm: [82, 95],
    dropMm: [140, 155],
    examples: [
      'Ritchey Classic — 82 mm de reach (≈ 145 mm de drop)',
      'Deda Deep — 95 mm de reach (≈ 145 mm de drop)',
      'Curvas fundas antigas: 150–170 mm de drop',
    ],
    whenToUse:
      'Procura-se uma posição mais baixa e mais à frente nos drops (perfil desportivo/aerodinâmico). Alternativas tradicionais rasas: 130–135 mm de drop.',
    source: COMPONENT_SOURCES.hoggBars,
  },
  {
    id: 'gravel-flare',
    label: 'Gravel com flare',
    reachMm: [70, 80],
    dropMm: [102, 120],
    examples: [
      'Zipp SL-70 XPLR — 70 × 115 mm, flare 5° e 11° de abertura',
      'Ritchey Comp VentureMax — 75 × 102 mm, flare 24°',
      'Easton EC70 AX — 80 × 120 mm, flare 16°',
    ],
    whenToUse:
      'O flare alarga os drops para controlo; não define por si o reach/drop. Avaliar em separado a largura nos manetes e nos drops.',
    source: COMPONENT_SOURCES.eastonEc70ax,
  },
];

/** Drop (mm) a partir do qual a curva é lida como "funda" — coerente com `DEEP_BAR_DROP_MM`. */
export const DEEP_BAR_DROP_MM = 140;
/** Faixa típica de reach do guiador de estrada/gravel (mm). */
export const TYPICAL_BAR_REACH_MM = [70, 90];
/** Passo comercial de largura de guiador de estrada (mm): 400 / 420 / 440. */
export const BAR_WIDTH_STEP_MM = 20;
/** Desvio de largura (mm) abaixo do qual não há sequer nota (ruído de medição). */
export const BAR_WIDTH_NOISE_MM = 5;

/**
 * Faixa de comprimento de avanço por tamanho de quadro de ESTRADA (cm), tabela MyVeloFit.
 * Serve para dizer se o avanço montado é plausível para o quadro — não para o prescrever sozinho.
 */
export const STEM_LENGTH_BY_FRAME_CM = [
  { fromCm: 44, toCm: 47, minMm: 70, maxMm: 90 },
  { fromCm: 48, toCm: 51, minMm: 80, maxMm: 100 },
  { fromCm: 52, toCm: 54, minMm: 90, maxMm: 110 },
  { fromCm: 55, toCm: 57, minMm: 100, maxMm: 120 },
  { fromCm: 58, toCm: 60, minMm: 110, maxMm: 130 },
  { fromCm: 61, toCm: 63, minMm: 120, maxMm: 140 },
];

/** Faixas de avanço por modalidade e tamanho (mm) — MyVeloFit. */
export const STEM_LENGTH_BY_STYLE = {
  road: { note: 'Estrada por tamanho de quadro (ver STEM_LENGTH_BY_FRAME_CM); 90–120 mm é a referência larga.', source: COMPONENT_SOURCES.myVeloFitStem },
  gravel: { note: 'Gravel segue a estrada, muitas vezes 10 mm mais curto para uma postura mais sobre o controlo.', source: COMPONENT_SOURCES.myVeloFitStem },
  mtb: { note: 'MTB XC: 40–100 mm (S 50–60 · M 60–70 · L 70–80). Trail/enduro: 35–70 mm. Um avanço de estrada num MTB é sinal de quadro errado, não de fit.', source: COMPONENT_SOURCES.myVeloFitStem },
  tt: { note: 'TT/triatlo: o alcance vem das extensões e do pad, não do avanço.', source: COMPONENT_SOURCES.myVeloFitStem },
};

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

/** Faixa de avanço esperada para um tamanho de quadro (cm), ou `null`. */
export function stemRangeForFrameSize(frameSizeCm) {
  const frame = toNumber(frameSizeCm);
  if (frame === null) return null;
  const band = STEM_LENGTH_BY_FRAME_CM.find((entry) => frame >= entry.fromCm && frame <= entry.toCm);
  if (!band) return null;
  return { minMm: band.minMm, maxMm: band.maxMm, text: `${band.minMm}–${band.maxMm} mm`, source: COMPONENT_SOURCES.myVeloFitStem };
}

/**
 * Classifica uma curva de guiador declarada (reach/drop em mm) e diz se contradiz a postura medida.
 *
 * @param {{ barReachMm:number|string, barDropMm:number|string, trunkAngle:number|null,
 *           trunkTarget:number[]|null }} params
 * @returns {Object|null} `null` sem reach nem drop declarados.
 */
export function classifyBar({ barReachMm, barDropMm, trunkAngle = null, trunkTarget = null } = {}) {
  const reach = toNumber(barReachMm);
  const drop = toNumber(barDropMm);
  if (reach === null && drop === null) return null;

  const deep = drop !== null && drop > DEEP_BAR_DROP_MM;
  let type = null;
  if (drop !== null) {
    if (drop <= 132) type = BAR_SHAPE_TYPES.find((t) => t.id === 'compact');
    else if (drop < DEEP_BAR_DROP_MM) type = BAR_SHAPE_TYPES.find((t) => t.id === 'ergo');
    else type = BAR_SHAPE_TYPES.find((t) => t.id === 'traditional');
  }

  const trunkTooUpright =
    Array.isArray(trunkTarget) && typeof trunkAngle === 'number' ? trunkAngle > trunkTarget[1] : null;

  const parts = [];
  if (reach !== null) parts.push(`reach ${reach} mm`);
  if (drop !== null) parts.push(`drop ${drop} mm`);

  return {
    reachMm: reach,
    dropMm: drop,
    deep,
    typeId: type ? type.id : null,
    typeLabel: type ? type.label : null,
    typeRangeText: type ? `${type.reachMm[0]}–${type.reachMm[1]} mm de reach · ${type.dropMm[0]}–${type.dropMm[1]} mm de drop` : null,
    typeSource: type ? type.source : null,
    text: parts.join(' · '),
    trunkTooUpright,
    // Drop fundo + tronco acima do alvo: o ajuste natural é a curva, não o avanço (que mexe no alcance).
    suggestsCompactBar: Boolean(deep && trunkTooUpright),
    // Reach fora da faixa publicada (70–90 mm) → merece nota, mesmo sem ser erro.
    reachOutOfTypicalRange:
      reach === null ? null : reach < TYPICAL_BAR_REACH_MM[0] || reach > TYPICAL_BAR_REACH_MM[1],
  };
}

/** Texto de referência do guiador mais compacto para quem fica no topo do guiador. */
export function compactBarAdvice() {
  const compact = BAR_SHAPE_TYPES.find((t) => t.id === 'compact');
  return {
    label: compact.label,
    rangeText: `${compact.dropMm[0]}–${compact.dropMm[1]} mm de drop`,
    reachRangeText: `${compact.reachMm[0]}–${compact.reachMm[1]} mm de reach`,
    examples: [...compact.examples],
    source: compact.source,
  };
}

export default {
  COMPONENT_SOURCES,
  BAR_SHAPE_TYPES,
  DEEP_BAR_DROP_MM,
  TYPICAL_BAR_REACH_MM,
  BAR_WIDTH_STEP_MM,
  BAR_WIDTH_NOISE_MM,
  STEM_LENGTH_BY_FRAME_CM,
  STEM_LENGTH_BY_STYLE,
  stemRangeForFrameSize,
  classifyBar,
  compactBarAdvice,
};
