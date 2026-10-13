/**
 * Guia de Tamanho da Bicicleta vs Tamanho do Atleta (BikeSizeGuide).
 *
 * PORQUÊ ESTE FICHEIRO:
 * O tamanho da bike era um número escrito no formulário e nunca confrontado com o corpo do atleta.
 * A bancada dizia "encurtar o avanço" sem nunca explicar que o quadro já estava um tamanho acima ou
 * abaixo — que é, muitas vezes, a verdadeira causa do cockpit errado.
 *
 * DE ONDE VÊM ESTES NÚMEROS (não são inventados):
 * São as **tabelas publicadas pelos fabricantes**, com a faixa de ALTURA DO ATLETA e o comprimento
 * do TUBO DO SELIM em cm quando a marca o publica nas fichas de geometria:
 *  - Giant: fichas de modelo (Defy, Contend, Revolt, Talon, Fathom) publicam altura do atleta,
 *    tubo do selim, stack e reach na mesma página.
 *  - Canyon: PDFs de geometria (Endurace, Grail) publicam altura do atleta e tubo do selim.
 *  - Trek (Domane, Checkpoint, Marlin) e Specialized (Tarmac, Diverge, Rockhopper): publicam altura
 *    do atleta por tamanho; os números 49/52/54 são **rótulos nominais**, NÃO tubo do selim medido.
 *
 * LIMITES DECLARADOS (o que este ficheiro NÃO faz):
 *  1. **Não converte marcas.** As marcas não são convertíveis entre si: a Canyon diz explicitamente
 *     que um "large" de outro fabricante pode ser o "medium" dela. Quando a altura cai em dois
 *     tamanhos, os dois são mostrados — nunca se força um único resultado.
 *  2. **Não compara cm de marcas diferentes como se fossem iguais.** Um quadro compacto tem tubo do
 *     selim curto e continua a ser o tamanho certo. Só se comparam cm entre marcas dentro da mesma
 *     **família de tamanhos** (rodas/família da modalidade), com tolerância de ±1,5 cm.
 *  3. **MTB não se dimensiona pela altura como a estrada.** O tamanho em MTB é guiado por reach,
 *     standover e posição em pé no pedal; por isso o MTB só é reportado por RÓTULO e nunca por cm.
 *  4. **Gravel ≠ estrada.** As tabelas coincidem em parte e divergem nos limites: a mesma altura
 *     pode dar rótulos diferentes nas duas modalidades.
 */

/** Fontes lidas para construir as tabelas (uma por marca/família). */
export const SIZE_CHART_SOURCES = {
  giantDefy: 'https://www.giant-bicycles.com/md/defy-advanced-1',
  giantContend: 'https://www.giant-bicycles.com/gb/contend-2-2025',
  giantRevolt: 'https://www.giant-bicycles.com/md/revolt-advanced-2-2025',
  giantTalon: 'https://www.giant-bicycles.com/us/talon-1-2025',
  giantFathom: 'https://www.giant-bicycles.com/ca/fathom-29-2025',
  trekDomane: 'https://www.theproscloset.com/collections/trek-domane-size-chart',
  trekCheckpoint: 'https://www.theproscloset.com/collections/trek-checkpoint-size-chart',
  trekMarlin: 'https://thewheelhousebikes.com/pages/trek-marlin-gen-3-size-guide',
  trekMtbGuide: 'https://www.trekbikes.com/us/en_US/mountain_buyers_guide/size/',
  specializedRoad: 'https://www.specializedconceptstore.co.uk/specialized-size-guide/',
  specializedRockhopper: 'https://www.evo.com/pages/specialized-rockhopper-29-mountain-bike-size-chart',
  canyonEndurace: 'https://www.canyon.com/en-us/productpdf/geometry/?pid=2186',
  canyonGrail: 'https://www.canyon.com/en-us/productpdf/geometry/?pid=3577',
  canyonSizing: 'https://www.canyon.com/en-us/blog-content/advice/canyon-bike-sizing/b29092022.html',
  canyonPositioning: 'https://www.canyon.com/en-us/buying-tools/positioning-system/',
};

/** Tolerância (cm) com que um tubo de selim declarado conta como "o tamanho desta faixa". */
export const SEAT_TUBE_TOLERANCE_CM = 1.5;
/** Diferença (cm) com que uma altura conta como "toca nesta faixa" (não só dentro dela). */
export const HEIGHT_NEAR_MISS_CM = 2;

/**
 * Modalidades atendidas e a sua referência de dimensionamento.
 * `byHeight` = a altura do atleta é o critério publicado · `byLabel` = marcado por família/rótulo.
 */
export const STYLE_SIZING_NOTE = {
  road: 'A estrada dimensiona-se por altura do atleta + cavalo; as marcas publicam faixas de altura por tamanho.',
  gravel: 'O gravel usa as mesmas famílias de tamanho que a estrada, mas os limites das faixas não são iguais.',
  mtb: 'Em MTB o tamanho é guiado por reach/standover e posição em pé no pedal, não pela altura: o tubo do selim é mais curto (por causa do espigão telescópico) e os cm não são comparáveis com a estrada.',
  tt: 'Em TT/triatlo não há faixa de altura comparável: os números são coordenadas de fit (pad/extension reach) definidas depois, não um tamanho de montra.',
};

/**
 * Tabelas publicadas. Cada linha tem a faixa de altura do atleta (cm) e o tubo do selim (cm) só
 * quando o fabricante o publica (`seatTubeCm: null` = a marca não o dá para esse tamanho).
 */
export const RIDER_SIZE_CHARTS = [
  {
    id: 'giant-defy',
    brand: 'Giant',
    model: 'Defy (endurance)',
    style: 'road',
    labelType: 'letters',
    seatTubeComparable: true,
    source: SIZE_CHART_SOURCES.giantDefy,
    rows: [
      { label: 'XS', seatTubeCm: 41.0, minCm: 160, maxCm: 168 },
      { label: 'S', seatTubeCm: 44.5, minCm: 166, maxCm: 174 },
      { label: 'M', seatTubeCm: 48.0, minCm: 172, maxCm: 180 },
      { label: 'M/L', seatTubeCm: 51.5, minCm: 178, maxCm: 186 },
      { label: 'L', seatTubeCm: 53.5, minCm: 184, maxCm: 192 },
      { label: 'XL', seatTubeCm: 56.5, minCm: 190, maxCm: 198 },
    ],
  },
  {
    id: 'giant-contend',
    brand: 'Giant',
    model: 'Contend (estrada)',
    style: 'road',
    labelType: 'letters',
    seatTubeComparable: true,
    source: SIZE_CHART_SOURCES.giantContend,
    rows: [
      { label: 'XS', seatTubeCm: 43.0, minCm: 157, maxCm: 169 },
      { label: 'S', seatTubeCm: 46.5, minCm: 165, maxCm: 175 },
      { label: 'M', seatTubeCm: 50.0, minCm: 171, maxCm: 181 },
      { label: 'M/L', seatTubeCm: 53.5, minCm: 177, maxCm: 187 },
      { label: 'L', seatTubeCm: 55.5, minCm: 183, maxCm: 193 },
      { label: 'XL', seatTubeCm: 58.5, minCm: 189, maxCm: 199 },
    ],
  },
  {
    id: 'giant-revolt',
    brand: 'Giant',
    model: 'Revolt (gravel)',
    style: 'gravel',
    labelType: 'letters',
    seatTubeComparable: true,
    source: SIZE_CHART_SOURCES.giantRevolt,
    rows: [
      { label: 'XS', seatTubeCm: 43.0, minCm: 155, maxCm: 166 },
      { label: 'S', seatTubeCm: 45.0, minCm: 159, maxCm: 171 },
      { label: 'M', seatTubeCm: 47.0, minCm: 169, maxCm: 181 },
      { label: 'M/L', seatTubeCm: 49.0, minCm: 174, maxCm: 186 },
      { label: 'L', seatTubeCm: 51.0, minCm: 179, maxCm: 191 },
      { label: 'XL', seatTubeCm: 53.0, minCm: 189, maxCm: 200 },
    ],
  },
  {
    id: 'giant-talon',
    brand: 'Giant',
    model: 'Talon (MTB XC)',
    style: 'mtb',
    labelType: 'letters',
    seatTubeComparable: false,
    source: SIZE_CHART_SOURCES.giantTalon,
    rows: [
      { label: 'XS (27,5")', seatTubeCm: 34.5, minCm: 155, maxCm: 166 },
      { label: 'S (29")', seatTubeCm: 38.0, minCm: 163, maxCm: 172 },
      { label: 'M (29")', seatTubeCm: 42.0, minCm: 169, maxCm: 179 },
      { label: 'L (29")', seatTubeCm: 45.0, minCm: 176, maxCm: 186 },
      { label: 'XL (29")', seatTubeCm: 48.0, minCm: 183, maxCm: 193 },
    ],
  },
  {
    id: 'giant-fathom',
    brand: 'Giant',
    model: 'Fathom 29 (MTB trail)',
    style: 'mtb',
    labelType: 'letters',
    seatTubeComparable: false,
    source: SIZE_CHART_SOURCES.giantFathom,
    rows: [
      { label: 'S', seatTubeCm: 38.0, minCm: 163, maxCm: 172 },
      { label: 'M', seatTubeCm: 43.0, minCm: 171, maxCm: 180 },
      { label: 'L', seatTubeCm: 46.5, minCm: 179, maxCm: 188 },
      { label: 'XL', seatTubeCm: 49.5, minCm: 187, maxCm: 198 },
    ],
  },
  {
    id: 'trek-domane',
    brand: 'Trek',
    model: 'Domane (estrada)',
    style: 'road',
    labelType: 'numeric-label',
    seatTubeComparable: false,
    source: SIZE_CHART_SOURCES.trekDomane,
    rows: [
      { label: '44', seatTubeCm: null, minCm: 150, maxCm: 153 },
      { label: '47', seatTubeCm: null, minCm: 152, maxCm: 158 },
      { label: '50', seatTubeCm: null, minCm: 158, maxCm: 163 },
      { label: '52', seatTubeCm: null, minCm: 163, maxCm: 168 },
      { label: '54', seatTubeCm: null, minCm: 168, maxCm: 174 },
      { label: '56', seatTubeCm: null, minCm: 174, maxCm: 180 },
      { label: '58', seatTubeCm: null, minCm: 180, maxCm: 185 },
      { label: '60', seatTubeCm: null, minCm: 185, maxCm: 190 },
      { label: '62', seatTubeCm: null, minCm: 190, maxCm: 195 },
    ],
  },
  {
    id: 'trek-checkpoint',
    brand: 'Trek',
    model: 'Checkpoint (gravel)',
    style: 'gravel',
    labelType: 'numeric-label',
    seatTubeComparable: false,
    source: SIZE_CHART_SOURCES.trekCheckpoint,
    rows: [
      { label: '49', seatTubeCm: null, minCm: 156, maxCm: 163 },
      { label: '52', seatTubeCm: null, minCm: 163, maxCm: 168 },
      { label: '54', seatTubeCm: null, minCm: 168, maxCm: 174 },
      { label: '56', seatTubeCm: null, minCm: 174, maxCm: 180 },
      { label: '58', seatTubeCm: null, minCm: 180, maxCm: 185 },
      { label: '61', seatTubeCm: null, minCm: 185, maxCm: 191 },
    ],
  },
  {
    id: 'trek-marlin',
    brand: 'Trek',
    model: 'Marlin Gen 3 (MTB)',
    style: 'mtb',
    labelType: 'letters',
    seatTubeComparable: false,
    source: SIZE_CHART_SOURCES.trekMarlin,
    rows: [
      { label: '2XS', seatTubeCm: null, minCm: 135, maxCm: 145 },
      { label: 'XS', seatTubeCm: null, minCm: 145, maxCm: 155 },
      { label: 'S', seatTubeCm: null, minCm: 155, maxCm: 165 },
      { label: 'M', seatTubeCm: null, minCm: 165, maxCm: 177 },
      { label: 'M/L', seatTubeCm: null, minCm: 173, maxCm: 180 },
      { label: 'L', seatTubeCm: null, minCm: 177, maxCm: 188 },
      { label: 'XL', seatTubeCm: null, minCm: 188, maxCm: 195 },
      { label: '2XL', seatTubeCm: null, minCm: 195, maxCm: 203 },
    ],
  },
  {
    id: 'specialized-tarmac',
    brand: 'Specialized',
    model: 'Tarmac (estrada)',
    style: 'road',
    labelType: 'numeric-label',
    seatTubeComparable: false,
    source: SIZE_CHART_SOURCES.specializedRoad,
    rows: [
      { label: '49', seatTubeCm: null, minCm: 152, maxCm: 165 },
      { label: '52', seatTubeCm: null, minCm: 165, maxCm: 173 },
      { label: '54', seatTubeCm: null, minCm: 173, maxCm: 178 },
      { label: '56', seatTubeCm: null, minCm: 178, maxCm: 183 },
      { label: '58', seatTubeCm: null, minCm: 183, maxCm: 191 },
      { label: '61', seatTubeCm: null, minCm: 191, maxCm: 198 },
    ],
  },
  {
    id: 'specialized-diverge',
    brand: 'Specialized',
    model: 'Diverge (gravel)',
    style: 'gravel',
    labelType: 'numeric-label',
    seatTubeComparable: false,
    source: SIZE_CHART_SOURCES.specializedRoad,
    rows: [
      { label: '46', seatTubeCm: null, minCm: 152, maxCm: 160 },
      { label: '49', seatTubeCm: null, minCm: 160, maxCm: 168 },
      { label: '52', seatTubeCm: null, minCm: 168, maxCm: 173 },
      { label: '54', seatTubeCm: null, minCm: 173, maxCm: 178 },
      { label: '56', seatTubeCm: null, minCm: 178, maxCm: 183 },
      { label: '58', seatTubeCm: null, minCm: 183, maxCm: 191 },
      { label: '61', seatTubeCm: null, minCm: 191, maxCm: 198 },
    ],
  },
  {
    id: 'specialized-rockhopper',
    brand: 'Specialized',
    model: 'Rockhopper 29 (MTB)',
    style: 'mtb',
    labelType: 'letters',
    seatTubeComparable: false,
    source: SIZE_CHART_SOURCES.specializedRockhopper,
    rows: [
      { label: 'S', seatTubeCm: null, minCm: 153, maxCm: 165 },
      { label: 'M', seatTubeCm: null, minCm: 163, maxCm: 178 },
      { label: 'L', seatTubeCm: null, minCm: 175, maxCm: 185 },
      { label: 'XL', seatTubeCm: null, minCm: 183, maxCm: 195 },
      { label: 'XXL', seatTubeCm: null, minCm: 193, maxCm: 206 },
    ],
  },
  {
    id: 'canyon-endurace',
    brand: 'Canyon',
    model: 'Endurace (estrada)',
    style: 'road',
    labelType: 'letters',
    seatTubeComparable: true,
    source: SIZE_CHART_SOURCES.canyonEndurace,
    rows: [
      { label: '2XS', seatTubeCm: 43.2, minCm: 0, maxCm: 166 },
      { label: 'XS', seatTubeCm: 46.2, minCm: 166, maxCm: 172 },
      { label: 'S', seatTubeCm: 49.2, minCm: 172, maxCm: 178 },
      { label: 'M', seatTubeCm: 52.2, minCm: 178, maxCm: 184 },
      { label: 'L', seatTubeCm: 55.2, minCm: 184, maxCm: 190 },
      { label: 'XL', seatTubeCm: 58.2, minCm: 190, maxCm: 196 },
      { label: '2XL', seatTubeCm: 61.2, minCm: 196, maxCm: 1000 },
    ],
  },
  {
    id: 'canyon-grail',
    brand: 'Canyon',
    model: 'Grail (gravel)',
    style: 'gravel',
    labelType: 'letters',
    seatTubeComparable: true,
    source: SIZE_CHART_SOURCES.canyonGrail,
    rows: [
      { label: '2XS', seatTubeCm: 42.0, minCm: 0, maxCm: 169 },
      { label: 'XS', seatTubeCm: 45.0, minCm: 167, maxCm: 175 },
      { label: 'S', seatTubeCm: 48.0, minCm: 172, maxCm: 181 },
      { label: 'M', seatTubeCm: 51.0, minCm: 179, maxCm: 187 },
      { label: 'L', seatTubeCm: 54.0, minCm: 185, maxCm: 193 },
      { label: 'XL', seatTubeCm: 57.0, minCm: 190, maxCm: 199 },
      { label: '2XL', seatTubeCm: 60.0, minCm: 196, maxCm: 1000 },
    ],
  },
];

/** Converte para número, aceitando vírgula decimal e devolvendo `null` sem valor. */
const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const round1 = (value) => Math.round(value * 10) / 10;

/** Modalidade válida (com recuo para estrada). */
export function normalizeStyle(style) {
  const safe = String(style || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(STYLE_SIZING_NOTE, safe) ? safe : 'road';
}

/** Tabelas publicadas de uma modalidade. */
export function chartsForStyle(style = 'road') {
  const safe = normalizeStyle(style);
  return RIDER_SIZE_CHARTS.filter((chart) => chart.style === safe);
}

/** A faixa desta linha contém a altura dada? */
export function rowContainsHeight(row, heightCm) {
  const height = toNumber(heightCm);
  if (height === null || !row) return false;
  return height >= row.minCm && height <= row.maxCm;
}

/** Texto legível da faixa de altura de uma linha. */
export function rowHeightText(row) {
  if (!row) return '';
  if (row.minCm <= 0) return `até ${row.maxCm} cm`;
  if (row.maxCm >= 1000) return `a partir de ${row.minCm} cm`;
  return `${row.minCm}–${row.maxCm} cm`;
}

/**
 * Todas as referências publicadas para uma altura, marca a marca.
 * Devolve os tamanhos cuja faixa contém a altura e, com `includeNear`, também os que ficam a menos
 * de `HEIGHT_NEAR_MISS_CM` de distância (as faixas publicadas sobrepõem-se — não se escolhe uma).
 *
 * @param {{ heightCm:number|string, ridingStyle?:string, includeNear?:boolean }} params
 * @returns {{ heightCm:number|null, style:string, sizingNote:string,
 *             references:Array<{brand:string, model:string, label:string, bandText:string,
 *                                seatTubeCm:number|null, containsHeight:boolean, distanceCm:number,
 *                                source:string}>, brandsMatching:string[] }}
 */
export function sizeReferencesForHeight({ heightCm, ridingStyle = 'road', includeNear = false } = {}) {
  const height = toNumber(heightCm);
  const style = normalizeStyle(ridingStyle);
  const charts = chartsForStyle(style);
  const references = [];

  if (height === null) {
    return { heightCm: null, style, sizingNote: STYLE_SIZING_NOTE[style], references, brandsMatching: [] };
  }

  charts.forEach((chart) => {
    chart.rows.forEach((row) => {
      const inside = rowContainsHeight(row, height);
      const distance = inside
        ? 0
        : height < row.minCm
          ? round1(row.minCm - height)
          : round1(height - row.maxCm);
      if (!inside && !(includeNear && distance <= HEIGHT_NEAR_MISS_CM)) return;
      references.push({
        brand: chart.brand,
        model: chart.model,
        label: row.label,
        bandText: rowHeightText(row),
        seatTubeCm: row.seatTubeCm,
        seatTubeComparable: chart.seatTubeComparable,
        containsHeight: inside,
        distanceCm: distance,
        source: chart.source,
      });
    });
  });

  const brandsMatching = [...new Set(references.filter((r) => r.containsHeight).map((r) => r.brand))];

  return { heightCm: height, style, sizingNote: STYLE_SIZING_NOTE[style], references, brandsMatching };
}

/**
 * Compara a bicicleta que o atleta tem com o que as tabelas publicadas dizem para o SEU tamanho.
 *
 * Estados possíveis:
 *  - `no-height`      → falta a altura; sem ela não se compara nada (nunca se inventa).
 *  - `height-only`    → há altura e não há tamanho declarado: mostra as referências publicadas.
 *  - `match`          → o tamanho declarado cai na família de tamanhos da altura (ver abaixo).
 *  - `too-long`/`too-short` → o tamanho declarado está uma família acima/abaixo da altura.
 *  - `label-only`     → a modalidade só é comparável por rótulo (MTB) ou a marca não publica tubo.
 *
 * A comparação *numérica* só usa as tabelas que publicam tubo do selim (`seatTubeComparable`):
 * Giant (estrada/gravel) e Canyon. Nos rótulos numéricos (Trek/Specialized) o número é nominal e
 * não serve de bitola — nesses casos o rótulo é reportado como referência, não como veredicto.
 *
 * @param {{ heightCm:number|string, frameSizeCm:number|string, ridingStyle?:string, brandModel?:string }} params
 * @returns {Object}
 */
export function compareBikeToRider({ heightCm, frameSizeCm, ridingStyle = 'road', brandModel = '' } = {}) {
  const height = toNumber(heightCm);
  const frame = toNumber(frameSizeCm);
  const style = normalizeStyle(ridingStyle);
  const references = sizeReferencesForHeight({ heightCm: height, ridingStyle: style, includeNear: true });
  const sources = [...new Set(RIDER_SIZE_CHARTS.filter((c) => c.style === style).map((c) => c.source))];
  const sizingNote = STYLE_SIZING_NOTE[style];
  const base = {
    heightCm: height,
    frameSizeCm: frame,
    style,
    sizingNote,
    references: references.references,
    sources,
    brandModel: String(brandModel || '').trim(),
  };

  if (height === null) {
    return {
      ...base,
      status: 'no-height',
      headline: 'Sem altura do atleta não há comparação',
      detail: 'A altura do atleta (passo 1) é o único dado com que os fabricantes publicam faixas de tamanho. Sem ela, o guia de tamanhos fica só informativo e o tamanho declarado é comparado apenas com a estimativa do cavalo (× 0,665).',
      missing: ['height_cm'],
    };
  }

  if (frame === null) {
    const labels = references.references
      .filter((r) => r.containsHeight)
      .map((r) => `${r.brand} ${r.model} → ${r.label} (${r.bandText}${r.seatTubeCm ? `, tubo ${r.seatTubeCm} cm` : ''})`);
    return {
      ...base,
      status: 'height-only',
      headline: `${height} cm → ${labels.length ? 'estas são as referências publicadas' : 'nenhuma faixa publicada para esta modalidade'}`,
      detail: labels.length
        ? `Para ${height} cm, as tabelas publicadas dão: ${labels.join(' · ')}. Estas faixas SOBREPÕEM-SE e não são convertíveis entre marcas — se a altura cai em dois tamanhos, os dois são candidatos e o desempate é o cavalo e o alcance do cockpit.`
        : `As tabelas desta modalidade não cobrem ${height} cm nos modelos lidos. Confirmar a ficha do modelo concreto antes de assumir um tamanho.`,
      missing: ['frame_size_cm'],
    };
  }

  const charts = chartsForStyle(style);
  const comparable = charts.filter((chart) => chart.seatTubeComparable);

  // 1. A que FAMÍLIA de tamanho corresponde o cm declarado (dentro das tabelas que publicam tubo)?
  const matchingRows = [];
  comparable.forEach((chart) => {
    chart.rows.forEach((row) => {
      if (row.seatTubeCm === null) return;
      if (Math.abs(row.seatTubeCm - frame) <= SEAT_TUBE_TOLERANCE_CM) {
        matchingRows.push({ chart, row });
      }
    });
  });

  if (matchingRows.length) {
    const fitRows = matchingRows.filter(({ row }) => rowContainsHeight(row, height));
    if (fitRows.length) {
      const list = fitRows
        .map(({ chart, row }) => `${chart.brand} ${chart.model} ${row.label} (${rowHeightText(row)}, tubo ${row.seatTubeCm} cm)`)
        .join(' · ');
      return {
        ...base,
        status: 'match',
        headline: `Quadro ${frame} cm declarado corresponde ao tamanho certo para ${height} cm`,
        detail: `O tubo do selim declarado (${frame} cm) é o de ${list} — uma família de tamanho coerente com ${height} cm. Atenção: o mesmo cm NÃO é o mesmo tamanho em todas as marcas (quadros compactos têm tubo curto e continuam certos) — a confirmação é a altura bater na faixa do mesmo rótulo.`,
        matchedSize: `${fitRows[0].chart.brand} ${fitRows[0].row.label}`,
      };
    }
    const directions = matchingRows.map(({ row }) => (row.minCm > height ? 'acima' : 'abaixo'));
    const above = directions.filter((d) => d === 'acima').length >= directions.filter((d) => d === 'abaixo').length;
    const list = matchingRows
      .map(({ chart, row }) => `${chart.brand} ${chart.model} ${row.label} (${rowHeightText(row)})`)
      .join(' · ');
    return {
      ...base,
      status: above ? 'too-long' : 'too-short',
      // Tolerância larga (meia família) evita acusar quem está apenas no limite de duas faixas.
      headline: above
        ? `Quadro ${frame} cm é um tamanho ACIMA de ${height} cm`
        : `Quadro ${frame} cm é um tamanho ABAIXO de ${height} cm`,
      detail: `O tubo do selim declarado (${frame} cm) corresponde a ${list}, cuja faixa de altura é ${above ? 'acima' : 'abaixo'} dos seus ${height} cm. Consequência prática: ${
        above
          ? 'o alcance ao guiador já sai longo de origem (o tronco fica esticado) e o avanço tem de compensar para baixo — é a explicação mais provável de uma ordem de encurtar o avanço.'
          : 'parte do alcance tem de vir do avanço, o que reduz o espaço entre pernas e cames e agrava o fecho da anca.'
      } Não é ordem de trocar de quadro: é a razão pela qual o cockpit está como está.`,
    };
  }

  // 2. Sem família correspondente: comparar com o intervalo de tubos que a altura admite.
  //    Só entram as tabelas cujo tubo do selim é de facto comparável (`seatTubeComparable`): em MTB
  //    os cm existem na ficha mas NÃO servem de bitola — se entrassem aqui, um MTB médio seria
  //    acusado de ser um quadro pequeno de estrada (era o defeito que esta linha evita).
  const expected = references.references.filter(
    (r) => r.containsHeight && r.seatTubeComparable === true && typeof r.seatTubeCm === 'number'
  );
  if (!expected.length) {
    const labels = references.references.filter((r) => r.containsHeight);
    return {
      ...base,
      status: style === 'mtb' ? 'label-only' : 'inconclusive',
      headline:
        style === 'mtb'
          ? `Em MTB só o RÓTULO é comparável, não os cm`
          : `Sem tabela que publique tubo do selim para ${height} cm nesta modalidade`,
      detail:
        (style === 'mtb'
          ? 'O tubo do selim em MTB é curto de propósito (espigão telescópico e liberdade para descer o corpo): comparar os seus cm com a estrada daria uma conclusão errada. O que conta é o reach e o standover. '
          : '') +
        (labels.length
          ? `Referências publicadas para ${height} cm: ${labels.map((r) => `${r.brand} ${r.model} → ${r.label}`).join(' · ')}.`
          : `Nenhuma faixa publicada cobre ${height} cm nos modelos lidos.`),
    };
  }

  const minSeat = Math.min(...expected.map((r) => r.seatTubeCm));
  const maxSeat = Math.max(...expected.map((r) => r.seatTubeCm));
  const family = expected
    .map((r) => `${r.brand} ${r.model} ${r.label} (tubo ${r.seatTubeCm} cm, ${r.bandText})`)
    .join(' · ');

  if (frame < minSeat - SEAT_TUBE_TOLERANCE_CM) {
    return {
      ...base,
      status: 'too-short',
      headline: `Quadro ${frame} cm abaixo das famílias publicadas para ${height} cm`,
      detail: `Para ${height} cm as tabelas dão ${family} — tubo do selim entre ${round1(minSeat)} e ${round1(maxSeat)} cm. ${frame} cm está ${round1(minSeat - frame)} cm abaixo desse intervalo: o cockpit terá de ser alongado no avanço (e o avanço já está no limite prático da modalidade), a menos que o cavalo curto justifique um quadro pequeno.`,
    };
  }
  if (frame > maxSeat + SEAT_TUBE_TOLERANCE_CM) {
    return {
      ...base,
      status: 'too-long',
      headline: `Quadro ${frame} cm acima das famílias publicadas para ${height} cm`,
      detail: `Para ${height} cm as tabelas dão ${family} — tubo do selim entre ${round1(minSeat)} e ${round1(maxSeat)} cm. ${frame} cm está ${round1(frame - maxSeat)} cm acima desse intervalo: o tronco sai esticado de origem e a correção natural é encurtar o avanço — exatamente o tipo de ordem que parecia inexplicável sem este dado.`,
    };
  }

  return {
    ...base,
    status: 'match',
    headline: `Quadro ${frame} cm dentro do intervalo publicado para ${height} cm`,
    detail: `Para ${height} cm as tabelas dão tubo do selim entre ${round1(minSeat)} e ${round1(maxSeat)} cm (${family}). ${frame} cm cai dentro do intervalo — folga de ${round1(minSeat - frame > 0 ? minSeat - frame : 0)} a ${round1(maxSeat - frame > 0 ? maxSeat - frame : 0)} cm relativamente aos extremos.`,
  };
}

/** Linhas da tabela prontas a apresentar (uma por marca/modelo/tamanho) para a modalidade. */
export function chartRowsForStyle(style = 'road') {
  const rows = [];
  chartsForStyle(style).forEach((chart) => {
    chart.rows.forEach((row) => {
      rows.push({
        brand: chart.brand,
        model: chart.model,
        label: row.label,
        heightText: rowHeightText(row),
        seatTubeCm: row.seatTubeCm,
        source: chart.source,
      });
    });
  });
  return rows;
}

export default {
  SIZE_CHART_SOURCES,
  STYLE_SIZING_NOTE,
  RIDER_SIZE_CHARTS,
  SEAT_TUBE_TOLERANCE_CM,
  HEIGHT_NEAR_MISS_CM,
  chartsForStyle,
  chartRowsForStyle,
  normalizeStyle,
  rowContainsHeight,
  rowHeightText,
  sizeReferencesForHeight,
  compareBikeToRider,
};
