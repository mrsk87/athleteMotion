/**
 * Regras Biomecânicas por Posição da Pedaleira (CrankPositionRules).
 *
 * FONTE ÚNICA DE VERDADE (SSOT) para saber *o que se mede* em cada posição do cranque.
 *
 * Porquê este ficheiro?
 * - A flexão do joelho NÃO tem o mesmo significado às 6h (Ponto Morto Inferior) e às 3h
 *   (cranque horizontal). Aos 6h a perna está quase estendida e define a ALTURA DO SELIM;
 *   às 3h o joelho está em flexão média e o que importa é a posição longitudinal (KOPS).
 * - Ao centralizar estas regras aqui, nenhum outro ficheiro precisa de "números mágicos".
 *
 * Convenções:
 * - `kneeMode: 'extension'` → o ângulo do joelho gera recomendação de ALTURA DE SELIM.
 * - `kneeMode: 'midflexion'` → ângulo descritivo; NÃO gera altura de selim.
 * - `kneeMode: 'flexion'` → usado só como contexto (ex.: fecho da anca a 12h).
 * - `kneeMode: 'descriptive'` → posição livre, sem alvo rígido.
 */

/**
 * Alvo canónico de extensão do joelho no Ponto Morto Inferior (6h), medido de forma
 * ESTÁTICA (atleta parado com o pé no BDC) — método Holmes:
 * 25° a 35° de flexão residual => 145° a 155° de ângulo incluído.
 * Fonte: https://www.cyclingweekly.com/fitness/bike-fit/set-saddle-height-how-to-25379
 */
export const KNEE_EXTENSION_RANGE = [145, 155];

/**
 * Alvo de extensão do joelho no BDC medido em PEDALADA ATIVA (vídeo).
 *
 * PORQUÊ UM INTERVALO DIFERENTE DO ESTÁTICO:
 * A medição dinâmica não é intermutável com a estática — a articulação carregada, o
 * tornozelo em movimento e a bacia em oscilação alteram o ângulo lido. Bini & Hume (2016)
 * mostram diferenças significativas exactamente às 6h, e as revisões de pedalada ativa
 * apontam ≈30–43° de flexão (incluído ≈137–150°), contra 25–35° (145–155°) em estático.
 * Fontes: https://hummov.awf.wroc.pl/A-comparison-of-static-and-dynamic-measures-of-lower-limb-joint-angles-in-cycling,183244,0,2.html
 *         https://pmc.ncbi.nlm.nih.gov/articles/PMC11561003/
 */
export const KNEE_EXTENSION_RANGE_DYNAMIC = [137, 150];

/** Deslocamento médio (graus) entre o alvo estático e o dinâmico, para metas personalizadas. */
export const KNEE_EXTENSION_DYNAMIC_OFFSET_DEG = -7;

/** Alvo do ângulo da anca no Ponto Morto Superior (12h), para despistar pinçamento. */
export const HIP_CLOSURE_RANGE = [50, 80];

/**
 * Faixa de prática para o fecho da anca às 12h (TDC).
 * É orientação prática de fit (não padrão científico universal) e depende da convenção
 * de landmarks; por isso o intervalo aceitável é mais largo do que a faixa de prática.
 * Fonte: https://www.bikefitadviser.com/blog/not-basic-bike-fit-part-3-bike-fit-joint-angles
 */
export const HIP_CLOSURE_PRACTICE_RANGE = [55, 65];

/** Alvo do ângulo do tornozelo na fase de potência (3h) e no BDC (6h). */
export const ANKLE_TARGET_RANGE = [95, 105];

/**
 * Ângulo do PÉ (face ao solo, "toe-down") por posição do cranque.
 * Orientação prática de fit — varia muito entre atletas; `null` = sem alvo defensável.
 * Fonte: https://www.bikefitadviser.com/blog/not-basic-bike-fit-part-3-bike-fit-joint-angles
 */
export const FOOT_TOE_DOWN_RANGE = {
  bdc: [5, 20],
  '90deg': [0, 12],
  tdc: [15, 35],
  '270deg': null,
  custom: null,
};

/**
 * Fontes da janela do joelho por posição do pé na pedaleira.
 *
 * O que a literatura permite afirmar (e o que NÃO permite) — verificado em pesquisa:
 * - 6h (pé em baixo / BDC): existe referência sólida para a EXTENSÃO. O método Ferrer-Roca
 *   recomenda 30–40° de flexão residual (≈140–150° de ângulo incluído) em pedalada ativa —
 *   confirmado em ciclistas profissionais (média 38°, grande variabilidade individual); em
 *   medição estática o clássico de Holmes é 25–35° (≈145–155°).
 * - 12h (pé em cima / TDC): NÃO há intervalo universal publicado. A referência é prática: o
 *   joelho no topo ronda ≈65–70° de ângulo incluído (exemplo publicado: 67° no topo contra
 *   140° no BDC), pelo que a janela serve de contexto e não de norma.
 * - 3h e 9h: NÃO existe alvo universal publicado para o joelho. Só faz sentido medir e
 *   comparar com a faixa de TRANSIÇÃO entre a flexão máxima (12h) e a extensão (6h). Em 3h a
 *   medição estática aproxima-se da dinâmica (<1,4° de diferença); em 6h a estática lê ≈8°
 *   menos que a dinâmica (Bini & Hume) — motivo pelo qual o alvo do selim só se prescreve no BDC.
 *
 * Nenhuma destas janelas autoriza mexer na bicicleta: só a extensão a 6h prescreve (altura do
 * selim). As restantes são o contexto com que o utilizador lê o número medido.
 */
export const KNEE_REFERENCE_SOURCES = {
  bdc: [
    'https://www.jsc-journal.com/index.php/JSC/article/view/541',
    'https://www.bikefitadviser.com/blog/not-basic-bike-fit-part-3-bike-fit-joint-angles',
    'https://openrepository.aut.ac.nz/items/9fba7a89-48d4-43cd-8515-9925d3aefd63',
  ],
  tdc: ['https://www.bikefitadviser.com/blog/not-basic-bike-fit-part-3-bike-fit-joint-angles'],
  '90deg': [
    'https://openrepository.aut.ac.nz/items/9fba7a89-48d4-43cd-8515-9925d3aefd63',
    'https://www.bikefitadviser.com/blog/not-basic-bike-fit-part-3-bike-fit-joint-angles',
  ],
  '270deg': ['https://www.bikefitadviser.com/blog/not-basic-bike-fit-part-3-bike-fit-joint-angles'],
  custom: [],
};

/**
 * Fase canónica do cranque em graus, com a convenção 0° = 12h (TDC) e sentido crescente
 * 12h → 3h → 6h → 9h. É esta a convenção usada pelo CrankPhaseTracker.
 */
export const CARDINAL_PHASE_DEG = { tdc: 0, '90deg': 90, bdc: 180, '270deg': 270 };

/**
 * Janela de tolerância (graus) em torno da posição cardeal para aceitar uma amostra.
 * A fase de vídeo é estimada (sem sensor de cranque), pelo que exigir o grau exacto seria
 * uma falsa precisão: uma janela de ±12° a 90 rpm equivale a ≈22 ms de pedalada.
 */
export const DEFAULT_PHASE_WINDOW_DEG = 12;

/** Nº mínimo de revoluções com passagem válida para autorizar uma prescrição. */
export const MIN_REVOLUTIONS_FOR_PRESCRIPTION = 3;

/** Nº de revoluções recomendado pelo consenso de cinemática (exemplo: média de 10 ciclos). */
export const RECOMMENDED_REVOLUTIONS = 10;

/**
 * Métricas autorizadas por posição do cranque.
 * `extension` = o joelho desta posição autoriza prescrever ALTURA DE SELIM;
 * `descriptive` = mede-se e reporta-se, mas não existe alvo universal para prescrever.
 */
export const POSITION_METRIC_AUTHORITY = {
  bdc: {
    knee: 'extension',
    kops: false,
    hipClosure: false,
    ankle: true,
    foot: 'footRange',
    trunk: true,
    elbow: true,
    head: 'descriptive',
  },
  '90deg': {
    knee: 'descriptive',
    kops: true,
    hipClosure: false,
    ankle: true,
    foot: 'footRange',
    trunk: true,
    elbow: true,
    head: 'descriptive',
  },
  tdc: {
    knee: 'descriptive',
    kops: false,
    hipClosure: true,
    ankle: 'descriptive',
    foot: null,
    trunk: true,
    elbow: true,
    head: 'descriptive',
  },
  '270deg': {
    knee: 'descriptive',
    kops: false,
    hipClosure: false,
    ankle: 'descriptive',
    foot: null,
    trunk: true,
    elbow: true,
    head: 'descriptive',
  },
  custom: {
    knee: 'descriptive',
    kops: false,
    hipClosure: 'descriptive',
    ankle: 'descriptive',
    foot: null,
    trunk: true,
    elbow: true,
    head: 'descriptive',
  },
};

/** Ordem canónica de análise por revolução: 12h → 3h → 6h → 9h. */
export const ANALYSIS_POSITION_ORDER = ['tdc', '90deg', 'bdc', '270deg'];

export const CRANK_POSITION_RULES = {
  bdc: {
    id: 'bdc',
    label: 'BDC (6h)',
    /** Onde está o pé quando esta medida é feita: dá sentido ao ângulo do joelho. */
    footPositionPt: 'pé em baixo (6h)',
    kneeMode: 'extension',
    kneeIdeal: KNEE_EXTENSION_RANGE,
    descriptiveKneeLabel: 'Extensão no ponto morto inferior',
    descriptiveKneeRange: null,
    primaryMetric: 'kneeExtension',
    authoritativeFor: 'saddleHeight',
    explanationPt: 'Às 6h (ponto morto inferior) avalia-se a EXTENSÃO do joelho para definir a ALTURA DO SELIM.',
  },
  '90deg': {
    id: '90deg',
    label: '90° (3h)',
    footPositionPt: 'pé à frente (3h)',
    kneeMode: 'midflexion',
    // NÃO existe intervalo universal validado para o joelho às 3h.
    // Este intervalo é apenas descritivo (contexto), nunca prescreve altura de selim.
    kneeIdeal: null,
    descriptiveKneeLabel: 'Flexão média na fase de potência',
    descriptiveKneeRange: [95, 125],
    primaryMetric: 'kopsForeAft',
    authoritativeFor: 'saddleForeAft',
    explanationPt: 'Às 3h (cranque horizontal) o joelho está em flexão média: avalia-se o RECUO/AVANÇO do selim (KOPS), não a altura.',
  },
  tdc: {
    id: 'tdc',
    label: 'TDC (12h)',
    footPositionPt: 'pé em cima (12h)',
    kneeMode: 'flexion',
    kneeIdeal: null,
    descriptiveKneeLabel: 'Flexão máxima com o pé em cima',
    descriptiveKneeRange: [60, 80],
    primaryMetric: 'hipClosure',
    authoritativeFor: 'hipClosure',
    explanationPt: 'Às 12h (ponto morto superior) avalia-se o FECHO DA ANCA para despistar pinçamento femoroacetabular.',
  },
  '270deg': {
    id: '270deg',
    label: '270° (9h)',
    footPositionPt: 'pé atrás (9h)',
    kneeMode: 'midflexion',
    kneeIdeal: null,
    descriptiveKneeLabel: 'Transição na recuperação',
    descriptiveKneeRange: [95, 125],
    primaryMetric: 'ankleStability',
    authoritativeFor: 'ankleStability',
    explanationPt: 'Às 9h (recuperação) avalia-se a ESTABILIDADE DO TORNOZELO e a posição dos travessões.',
  },
  custom: {
    id: 'custom',
    label: 'Livre',
    footPositionPt: 'posição livre',
    kneeMode: 'descriptive',
    kneeIdeal: null,
    descriptiveKneeLabel: null,
    descriptiveKneeRange: null,
    primaryMetric: null,
    authoritativeFor: null,
    explanationPt: 'Posição livre: registo biomecânico geral, sem alvos rígidos de posição.',
  },
};

/**
 * O que esperar do JOELHO numa posição concreta do pé na pedaleira.
 *
 * Devolve SEMPRE a posição, o intervalo e o tipo de autoridade:
 *  - `kind: 'target'`    → a evidência sustenta prescrever a partir daqui (só o 6h, que define
 *                          a altura do selim);
 *  - `kind: 'reference'` → janela de contexto publicada, que serve para o utilizador julgar o
 *                          número (o joelho às 12h NÃO pode ser comparado com o das 6h);
 *  - `kind: 'none'`      → não existe referência defensável (posição livre).
 *
 * @param {string|null|undefined} position - 'bdc' | '90deg' | 'tdc' | '270deg' | 'custom'
 * @param {{ regime?: 'static'|'dynamic', extensionRange?: number[] }} [options]
 * @returns {{ key:string, label:string, footPositionPt:string, range:number[]|null, kind:'target'|'reference'|'none', summary:string, sources:string[] }}
 */
export function getKneeReferenceForPosition(position, { regime = 'dynamic', extensionRange = KNEE_EXTENSION_RANGE } = {}) {
  const rule = getCrankRule(position);
  const sources = KNEE_REFERENCE_SOURCES[rule.id] || [];

  if (rule.kneeMode === 'extension') {
    const range = getKneeTargetForRegime(extensionRange, regime);
    return {
      key: rule.id,
      label: rule.label,
      footPositionPt: rule.footPositionPt,
      range,
      kind: 'target',
      summary:
        `Alvo ${range[0]}–${range[1]}° com o ${rule.footPositionPt} em ` +
        `${regime === 'dynamic' ? 'pedalada ativa (medido, não estático)' : 'medição estática'}` +
        ' — é esta a posição que define a altura do selim.',
      sources,
    };
  }

  const range = Array.isArray(rule.descriptiveKneeRange) ? [...rule.descriptiveKneeRange] : null;
  // A procedência muda o que se pode dizer do número: em 12h existe referência PRÁTICA publicada
  // (≈65–70° no topo); em 3h/9h a janela é DEDUZIDA da transição entre os dois extremos medidos
  // (flexão máxima às 12h, extensão às 6h) porque não há valor universal publicado.
  const premise =
    rule.id === 'tdc'
      ? `Referência prática ${range ? `${range[0]}–${range[1]}°` : ''} com o ${rule.footPositionPt} (o topo ronda ≈65–70° de ângulo incluído): a literatura não publica um intervalo universal nesta posição — é contexto para ler o número, não uma ordem de ajuste.`
      : `Faixa de transição ${range ? `${range[0]}–${range[1]}°` : ''} com o ${rule.footPositionPt}, deduzida entre a flexão máxima às 12h e a extensão às 6h (não há valor universal publicado nesta posição) — é contexto para ler o número, não uma ordem de ajuste.`;
  return {
    key: rule.id,
    label: rule.label,
    footPositionPt: rule.footPositionPt,
    range,
    kind: range ? 'reference' : 'none',
    summary: range ? premise : `Sem referência numérica defensável com o ${rule.footPositionPt}.`,
    sources,
  };
}

/** Regra de recurso quando a posição é desconhecida (comportamento seguro). */
const FALLBACK_RULE = CRANK_POSITION_RULES.custom;

/**
 * Devolve a regra da posição do cranque, com recurso seguro a "Livre".
 * @param {string|null|undefined} position - ex.: 'bdc', '90deg', 'tdc', '270deg', 'custom'
 */
export function getCrankRule(position) {
  if (!position) return FALLBACK_RULE;
  return CRANK_POSITION_RULES[position] || FALLBACK_RULE;
}

/**
 * Indica se esta posição permite prescrever ALTURA DE SELIM a partir do joelho.
 * Só a extensão no BDC (6h) é válida para esse efeito.
 * @param {string|null|undefined} position
 * @returns {boolean}
 */
export function prescribesSaddleHeight(position) {
  return getCrankRule(position).kneeMode === 'extension';
}

/**
 * Devolve o intervalo alvo do joelho para a posição, ou `null` quando a posição
 * não deve gerar qualquer ordem de altura de selim (ex.: 3h / 9h).
 * @param {string|null|undefined} position
 * @param {number[]} [extensionRange] - intervalo de extensão configurável (ex.: MTB/TT)
 * @returns {number[]|null}
 */
export function getKneeTargetForPosition(position, extensionRange = KNEE_EXTENSION_RANGE) {
  const rule = getCrankRule(position);
  if (rule.kneeMode !== 'extension') return null;
  return Array.isArray(extensionRange) && extensionRange.length === 2 ? extensionRange : KNEE_EXTENSION_RANGE;
}

/**
 * Devolve o alvo de extensão adequado ao regime de medição.
 *
 * @param {number[]} [extensionRange] - meta estática configurada (ex.: [140, 150] em MTB)
 * @param {'static'|'dynamic'} [regime] - 'dynamic' quando o ângulo vem de pedalada ativa
 * @returns {number[]} intervalo incluído [min, max]
 */
export function getKneeTargetForRegime(extensionRange = KNEE_EXTENSION_RANGE, regime = 'static') {
  const base = Array.isArray(extensionRange) && extensionRange.length === 2 ? extensionRange : KNEE_EXTENSION_RANGE;
  if (regime !== 'dynamic') return base;

  // Meta personalizada (deixou de ser o Holmes padrão): desloca-a pelo mesmo offset
  // documentado entre estático e dinâmico, mantendo o intervalo coerente com a modalidade.
  const isDefaultStatic = base[0] === KNEE_EXTENSION_RANGE[0] && base[1] === KNEE_EXTENSION_RANGE[1];
  if (isDefaultStatic) return [...KNEE_EXTENSION_RANGE_DYNAMIC];

  const shifted = [base[0] + KNEE_EXTENSION_DYNAMIC_OFFSET_DEG, base[1] + KNEE_EXTENSION_DYNAMIC_OFFSET_DEG];
  return [Math.max(125, shifted[0]), Math.max(130, shifted[1])];
}

/**
 * Métricas que esta posição do cranque pode efetivamente avaliar (e como).
 * @param {string|null|undefined} position
 */
export function getPositionMetricAuthority(position) {
  const rule = getCrankRule(position);
  return POSITION_METRIC_AUTHORITY[rule.id] || POSITION_METRIC_AUTHORITY.custom;
}

/**
 * Alvo do ângulo do pé (toe-down) para a posição, ou `null` quando não há alvo defensável.
 * @param {string|null|undefined} position
 */
export function getFootToeDownTarget(position) {
  const rule = getCrankRule(position);
  return FOOT_TOE_DOWN_RANGE[rule.id] || null;
}
