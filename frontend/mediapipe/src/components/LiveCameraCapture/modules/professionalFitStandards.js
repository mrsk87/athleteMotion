/**
 * Normas de Referência do Bike Fitter Profissional (ProfessionalFitStandards).
 *
 * PORQUÊ ESTE FICHEIRO:
 * `crankPositionRules.js` diz *o que se mede* em cada posição do pé e qual o alvo a
 * prescrever; `positionOptimization.js` compara o medido com esse alvo (ok/abaixo/acima).
 * O que faltava era o que um fitter profissional faz por cima disso:
 *
 * 1. **Dizer se o número é sequer comparável.** Um ângulo medido por vídeo 2D não é
 *    intermutável com a convenção estática do goniometro, nem com outro software que use
 *    landmarks diferentes. O mesmo número pode ser "bom" numas convenções e "mau" noutras.
 * 2. **Definir até onde é que uma diferença é real.** Existe erro de repetição medido
 *    (Corbett & Bevins, 2014): 1,7° no joelho dinâmico contra 4,2° no estático. Uma
 *    diferença de 2° NÃO é um erro do atleta — é ruído do método.
 * 3. **Classificar em graus de evidência** (medido / prática de fit / convenção /
 *    não validado) e citar a fonte de cada número. A maior parte dos "alvos" que circulam
 *    na internet é prática de fit, não evidência — e isso tem de ser visível.
 * 4. **Não inventar.** Não existe intervalo normal publicado de assimetria
 *    esquerda/direita em graus, nem um limiar clínico validado de lesão por ângulo.
 *    Este ficheiro tem uma política explícita para os dois casos.
 *
 * Toda a tabela é pura e verificada em `npm run verify:fit-standards`.
 */

/**
 * Métricas da aplicação → chaves da tabela profissional.
 * Fonte única: tanto a leitura por posição como os cartões das fases usam este mapa, para
 * nunca haver duas opiniões sobre o que é "o joelho" ou "a anca".
 */
export const METRIC_TO_JOINT = {
  knee: 'knee',
  kneeExtension: 'knee',
  hipClosure: 'hipClosure',
  ankle: 'ankle',
  toeDown: 'toeDown',
  kops: 'kops',
  trunk: 'trunk',
  elbow: 'elbow',
  shoulder: 'shoulder',
};

/** Graus de evidência, do mais forte ao mais fraco. */
export const EVIDENCE = {
  /** Medido em estudo publicado, com protocolo declarado. */
  MEASURED: 'measured',
  /** Prática de fitter publicada (experiência clínica, sem validação populacional). */
  PRACTICE: 'practice',
  /** Convenção de escola/sistema: depende dos landmarks e não é comparável fora dela. */
  CONVENTION: 'convention',
  /** Regra popular sem suporte publicado. */
  UNVALIDATED: 'unvalidated',
};

export const EVIDENCE_LABELS = {
  [EVIDENCE.MEASURED]: 'medido em estudo',
  [EVIDENCE.PRACTICE]: 'prática de fit',
  [EVIDENCE.CONVENTION]: 'convenção (não comparável)',
  [EVIDENCE.UNVALIDATED]: 'não validado',
};

/**
 * Erro de repetição intra-sessão publicado (graus), por junta e regime.
 *
 * Fonte: Corbett & Bevins (2014), "A comparison of static and dynamic measures of lower
 * limb joint angles in cycling", J. Sci. Cycl. — 1,7° joelho dinâmico, 4,2° joelho
 * estático; até 4,2° dinâmico e 4,9° estático no tornozelo (plantarflexão).
 * https://jsc-journal.com/index.php/JSC/article/view/94
 *
 * `null` = não foi publicado para essa junta — e então o software NÃO inventa um valor:
 * diz que não sabe, em vez de fingir uma precisão que não tem.
 */
export const MEASUREMENT_UNCERTAINTY_DEG = {
  knee: { dynamic: 1.7, static: 4.2 },
  ankle: { dynamic: 4.2, static: 4.9 },
  hip: { dynamic: null, static: null },
  trunk: { dynamic: null, static: null },
  elbow: { dynamic: null, static: null },
  wrist: { dynamic: null, static: null },
};

/**
 * As duas convenções de ângulo do joelho — a confusão mais comum do bike fit.
 *
 * "25–35°" e "145–155°" descrevem a MESMA posição: a primeira conta a FLEXÃO a partir da
 * extensão completa (0° = perna esticada), a segunda o ângulo INCLUÍDO na articulação
 * (180° = perna esticada). São suplementares. Escrever "150°" sem dizer a convenção é
 * ambíguo e é assim que se comparam números que não são comparáveis.
 */
export const KNEE_ANGLE_CONVENTIONS = {
  included: {
    id: 'included',
    label: 'Ângulo incluído (hip–knee–ankle)',
    straightIs: 180,
    usedByApp: true,
    note: 'É a convenção da aplicação: 180° = perna totalmente estendida.',
  },
  flexion: {
    id: 'flexion',
    label: 'Flexão a partir da extensão',
    straightIs: 0,
    usedByApp: false,
    note: 'Convenção clássica de goniometria: 0° = perna esticada. included = 180 − flexion.',
  },
};

/** Converte flexão → ângulo incluído (e vice-versa, é o mesmo cálculo). */
export function flexionToIncluded(flexionDeg) {
  return Number.isFinite(flexionDeg) ? Math.round((180 - flexionDeg) * 10) / 10 : null;
}

/** Converte ângulo incluído → flexão. */
export function includedToFlexion(includedDeg) {
  return Number.isFinite(includedDeg) ? Math.round((180 - includedDeg) * 10) / 10 : null;
}

const CW = 'https://jsc-journal.com/index.php/JSC/article/view/94';
const BFA = 'https://www.bikefitadviser.com/blog/not-basic-bike-fit-part-3-bike-fit-joint-angles';
const HOLLIDAY = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9219349/';
const CONSENSUS = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11561003/';
const VELOGIC_ROAD = 'https://docs.velogicfit.com/section-02-using-velogic-studio/road-metrics';
const VELOGIC_TRI = 'https://docs.velogicfit.com/section-02-using-velogic-studio/triathlon-metrics';
const JOHNSTON = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5717478/';
const WADSWORTH = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6818133/';

/**
 * Tabela de referência por JUNTA e por POSIÇÃO DO PÉ no cranque.
 *
 * Cada entrada tem:
 *  - `good`        faixa em que um fitter não mexeria;
 *  - `acceptable`  faixa tolerada (fora dela, é aqui que começa a conversa);
 *  - `evidence`    grau de evidência (ver `EVIDENCE`);
 *  - `convention`  convenção de medição a que o número pertence;
 *  - `reading`     o que um fitter diz ao atleta (nunca um teste automático);
 *  - `sources`     ligações diretas.
 *
 * `comparability: 'mismatch'` marca as entradas em que o número publicado usa uma
 * convenção DIFERENTE da que a aplicação mede — nesses casos a faixa é mostrada como
 * contexto e NUNCA gera veredicto automático.
 */
export const FIT_REFERENCE_TABLE = {
  knee: {
    joint: 'Joelho',
    conventions: [KNEE_ANGLE_CONVENTIONS.included, KNEE_ANGLE_CONVENTIONS.flexion],
    positions: {
      bdc: {
        dynamic: {
          good: [140, 150],
          acceptable: [137, 155],
          evidence: EVIDENCE.MEASURED,
          convention: KNEE_ANGLE_CONVENTIONS.included.id,
          published: '30–40° de flexão residual em pedalada ativa (equivalente a 140–150° incluído)',
          reading:
            'No ponto morto inferior o joelho tem de ficar com flexão residual. Menos flexão que isto é selim alto: a perna ' +
            'chega ao fim do curso a "puxar" o joelho e o Aquiles é quem paga. Mais flexão que isto é selim baixo: comprime ' +
            'a frente do joelho e a articulação trabalha em ângulo fechado todo o curso.',
          sources: [CW, BFA, CONSENSUS],
        },
        static: {
          good: [145, 155],
          acceptable: [142, 158],
          evidence: EVIDENCE.CONVENTION,
          convention: KNEE_ANGLE_CONVENTIONS.included.id,
          published: '25–35° de flexão residual em medição estática (equivalente a 145–155° incluído)',
          reading:
            'Convenção clássica de goniometria (parar o atleta no BDC). Serve para comparar com quem mede assim — não é ' +
            'intermutável com a medição em movimento, que lê em média ~5° mais de flexão.',
          sources: [HOLLIDAY, WADSWORTH],
        },
      },
      tdc: {
        dynamic: {
          good: [60, 80],
          acceptable: [55, 85],
          evidence: EVIDENCE.PRACTICE,
          convention: KNEE_ANGLE_CONVENTIONS.included.id,
          published: '≈110° de flexão (± 70° incluído) no topo do curso — valor citado, não norma populacional',
          reading:
            'No topo o joelho tem de dobrar o suficiente para o pé passar no ponto morto superior sem a anca fechar. ' +
            'Não existe intervalo universal publicado para esta posição: serve para ler o número, não para prescrever.',
          sources: [WADSWORTH, BFA],
        },
      },
      '90deg': {
        dynamic: null,
        dynamic_reason:
          'Não existe alvo universal publicado para o joelho com o cranque horizontal. Compara-se apenas com a transição ' +
          'entre a flexão máxima (12h) e a extensão (6h).',
      },
      '270deg': {
        dynamic: null,
        dynamic_reason: 'Fase de recuperação: sem alvo publicado. O que se lê aqui é a transição do tornozelo e do pé.',
      },
    },
  },

  hipClosure: {
    joint: 'Fecho da anca',
    comparability: 'mismatch',
    comparabilityNote:
      'Este ângulo NÃO é comparável entre fontes: cada sistema constrói-o com landmarks diferentes (anca–joelho–ombro, ' +
      'tronco–coxa, ou ângulo de assento). A aplicação usa uma construção própria e por isso reporta-o como registo.',
    positions: {
      tdc: {
        dynamic: {
          byFlexibility: {
            low: { good: [52, 58], source: BFA },
            medium: { good: [52, 58], source: BFA },
            high: { good: [44, 50], source: BFA },
          },
          alternativeConvention: { good: [55, 65], evidence: EVIDENCE.CONVENTION, source: BFA },
          evidence: EVIDENCE.PRACTICE,
        },
        reading:
          'No topo do curso, quanto menor o ângulo, mais a anca fecha. Um atleta com mobilidade alta tolera mais fecho; ' +
          'um atleta rígido sente-o como "joelho a bater no peito". Não existe limiar clínico validado — decide-se pela ' +
          'tolerância e pelos sintomas do atleta, não por um número.',
        sources: [BFA, HOLLIDAY, CONSENSUS, VELOGIC_ROAD],
      },
    },
  },

  ankle: {
    joint: 'Tornozelo',
    comparability: 'mismatch',
    comparabilityNote:
      'A literaȷura publica o ângulo tornozelo–pé (perna–pé). A aplicação mede joelho–tornozelo–ponta do pé (incluído), ' +
      'o que dá valores sistematicamente diferentes. Por isso a faixa publicada é mostrada como contexto e não gera veredicto.',
    publishedConvention: { neutralDeg: 90, overStroke: [75, 105], nearPowerPhase: [85, 95] },
    positions: {
      bdc: { dynamic: { good: [95, 105], evidence: EVIDENCE.PRACTICE, convention: 'app-knee-ankle-toe' } },
      '90deg': { dynamic: { good: [95, 105], evidence: EVIDENCE.PRACTICE, convention: 'app-knee-ankle-toe' } },
      tdc: { dynamic: null, dynamic_reason: 'Posição descritiva: o tornozelo está a preparar o topo do curso.' },
      '270deg': { dynamic: { good: [95, 105], evidence: EVIDENCE.PRACTICE, convention: 'app-knee-ankle-toe' } },
    },
    reading:
      'Tornozelo demasiado rígido em todo o curso costuma significar travessão demasiado recuado; um tornozelo que cai ' +
      'muito no ponto morto inferior aponta para selim alto. É o marcador que liga a altura do selim aos travessões.',
    sources: [BFA],
  },

  toeDown: {
    joint: 'Ângulo do pé (toe-down)',
    positions: {
      bdc: { dynamic: { good: [5, 20], evidence: EVIDENCE.PRACTICE, convention: 'foot-vs-ground' } },
      '90deg': { dynamic: { good: [0, 12], evidence: EVIDENCE.PRACTICE, convention: 'foot-vs-ground' } },
      tdc: { dynamic: { good: [15, 35], evidence: EVIDENCE.PRACTICE, convention: 'foot-vs-ground' } },
      '270deg': { dynamic: null, dynamic_reason: 'Sem faixa publicada; exemplo observado acima de 40° (não é recomendação).' },
    },
    reading:
      'Excesso de ponta de pé em baixo às 6h associa-se a selim alto ou travessão avançado; falta de ponta de pé pode vir ' +
      'de selim baixo ou de mecânica de tornozelo. São hipóteses de diagnóstico, não regras de um para um.',
    sources: [BFA],
  },

  kops: {
    joint: 'KOPS (joelho sobre o eixo do pedal)',
    evidence: EVIDENCE.UNVALIDATED,
    toleranceMm: null,
    definition:
      'Às 3h, com o cranque horizontal e o pé dianteiro à frente: linha de prumo do tubérculo tibial (ou da rótula) até ao ' +
      'eixo do pedal.',
    absenceOfTolerance:
      'NÃO existe tolerância publicada em milímetros que se possa citar. A regra é uma referência de partida, não uma ' +
      'obrigação biomecânica: ignora a antropometria individual e não tem limiar de prevenção de lesão demonstrado.',
    positions: {
      all: {
        dynamic: null,
        dynamic_reason:
          'Medido em milímetros, sem tolerância publicada: não se converte em graus nem gera veredicto automático.',
      },
    },
    reading:
      'Usa-se para chegar a uma posição de partida e para comparar sessões — não para "corrigir" alguns milímetros. Se o ' +
      'atleta está confortável e estável, um desvio pequeno não justifica mexer no selim.',
    sources: [HOLLIDAY, BFA, CONSENSUS],
  },

  trunk: {
    joint: 'Tronco (face à horizontal)',
    positions: {
      all: {
        dynamic: {
          good: [40, 50],
          acceptable: [30, 58],
          byPosture: { upright: { good: [40, 50], elite: [35, 40] }, aero: { good: [10, 30], elite: [10, 15] } },
          evidence: EVIDENCE.PRACTICE,
          convention: 'torso-vs-horizontal',
        },
      },
    },
    reading:
      'O tronco é praticamente constante durante a pedalada (quem domina a leitura é a bacia). Um tronco mais deitado só ' +
      'faz sentido se a anca continuar a abrir — caso contrário compra-se aerodinâmica com potência.',
    sources: [VELOGIC_ROAD, VELOGIC_TRI, HOLLIDAY],
  },

  elbow: {
    joint: 'Cotovelo',
    comparability: 'mismatch',
    comparabilityNote: 'As fontes publicam 155–170° incluído e, separadamente, 20–30° de flexão a partir da extensão.',
    positions: {
      all: {
        dynamic: {
          good: [155, 170],
          acceptable: [150, 175],
          flexionEquivalent: [10, 25],
          evidence: EVIDENCE.PRACTICE,
          convention: KNEE_ANGLE_CONVENTIONS.included.id,
        },
      },
    },
    reading:
      'Braços bloqueados transmitem as pancadas do asfalto à coluna; braços demasiado dobrados empurram o peso para a ' +
      'frente e encurtam a respiração. Em estrada, a referência é o cotovelo ligeiramente fletido.',
    sources: [VELOGIC_ROAD, HOLLIDAY],
  },

  shoulder: {
    joint: 'Ombro',
    comparability: 'mismatch',
    comparabilityNote:
      'Uma fonte dá 75–100° e outra 112° ± 7°: é uma diferença de DEFINIÇÃO, não um alvo em conflito. Sem um landmark ' +
      'acordado não há alvo utilizável.',
    positions: { all: { dynamic: null, dynamic_reason: 'Sem construção de landmark acordada entre fontes.' } },
    reading: 'Usa-se como contexto de apoio (ombros apoiados, sem elevação) e não como alvo numérico.',
    sources: [VELOGIC_ROAD, HOLLIDAY],
  },

  wrist: {
    joint: 'Punho',
    positions: { all: { dynamic: null, dynamic_reason: 'Nenhum intervalo numérico publicado.' } },
    reading: 'Avalia-se qualitativamente (postura neutra de aperto de mão), não em graus.',
    sources: [HOLLIDAY],
  },
};

/**
 * Política de ASSIMETRIA esquerda/direita.
 *
 * Nenhuma das fontes verificadas publica um "normal" em graus — os sistemas que trabalham
 * a assimetria (gebioMized, Retül) analisam-na em força/potência e por posição do cranque,
 * não com um limiar angular. Um corte inventado produziria diagnósticos falsos.
 */
export const ASYMMETRY_POLICY = {
  thresholdDeg: null,
  reportingUnit: 'graus (diferença absoluta)',
  rule:
    'A assimetria é registada e apresentada, nunca comparada com um limiar: a diferença só é assinalada quando excede ' +
    'o erro de repetição conhecido da junta (ver MEASUREMENT_UNCERTAINTY_DEG) E de forma consistente em várias revoluções.',
  notSupported:
    'Não existe intervalo normal publicado de diferença angular esquerda/direita, nem limiar clínico derivável de uma ' +
    'repartição de potência. Qualquer número fixo aqui seria inventado.',
  sources: ['https://www.gebiomized.us/force-analysis.html', 'https://www.retul.com/retul-fit', CONSENSUS],
};

/**
 * Limiares de SAÚDE: o que a evidência permite (e não permite) afirmar.
 *
 * Johnston et al. (2017) reviram a literatura e concluíram que NÃO existe evidência direta
 * que ligue parâmetros da bicicleta/posição a risco de lesão. Este objeto existe para
 * impedir que o relatório escreva "risco de tendinopatia" a partir de um ângulo.
 */
export const INJURY_EVIDENCE = {
  thresholdDeg: null,
  statement:
    'Nenhum limiar angular validado liga a posição na bicicleta a lesão. Os desvios descrevem CARGA e CONFORTO ' +
    '(e o que muda ao corrigir), não um diagnóstico nem uma probabilidade de lesão.',
  whatSourcesDoSupport: [
    'Selim baixo / maior flexão do joelho está associado a sintomas na frente do joelho (interpretação de fitter, não limiar).',
    'Selim alto / extremos de extensão estão associados a sintomas na parte de trás (tendão, ísquios).',
    'A revisão sistemática não encontra ligação direta demonstrada entre parâmetros de posição e risco de lesão.',
  ],
  sources: [JOHNSTON, BFA],
};

/**
 * Protocolo de captura que um fitter profissional exige antes de confiar nos números.
 *
 * Fonte principal: consenso de especialistas (2024) — aquecimento e ≥2 min de pedalada na
 * cadência/intensidade pretendidas antes da avaliação submáxima; reportar cadência e nº de
 * ciclos; normalizar a fase do cranque (0–360°) na comparação de repetições.
 * https://pmc.ncbi.nlm.nih.gov/articles/PMC11561003/
 */
export const CAPTURE_PROTOCOL = {
  minDurationSeconds: 120,
  minCompleteCycles: 3,
  recommendedCycles: 10,
  cadenceWindowRpm: [70, 100],
  cameraDistanceM: [2, 3],
  preferredFps: 60,
  minimumFps: 30,
  checks: [
    { id: 'duration', label: 'Duração da pedalada', requirement: '≥ 2 min (recomendado)', source: CONSENSUS },
    { id: 'cycles', label: 'Ciclos completos', requirement: '≥ 3 ciclos (10 ideal)', source: CONSENSUS },
    { id: 'cadence', label: 'Cadência', requirement: '70–100 rpm, declarada e mantida', source: CONSENSUS },
    { id: 'fps', label: 'Fotogramas por segundo', requirement: '60 fps preferido; 30 fps aceitável mas menos preciso', source: 'https://www.bikefitadviser.com/blog/perform-a-not-so-basic-bike-fit-part-1-hardware-software-and-setup' },
    { id: 'distance', label: 'Distância da câmara', requirement: '2–3 m, eixo ótico à altura do selim, nivelada', source: 'https://www.myvelofit.com/fit-academy/myvelofit-setup-instructions/' },
    { id: 'plane', label: 'Plano e enquadramento', requirement: 'câmara perpendicular ao plano sagital; pé e cranque visíveis', source: CONSENSUS },
  ],
};

/**
 * Erro de repetição publicado para uma junta/regime, ou `null` se não foi publicado.
 * @param {string} joint - 'knee' | 'ankle' | 'hip' | 'trunk' | 'elbow' | 'wrist'
 * @param {'static'|'dynamic'} regime
 */
export function uncertaintyFor(joint, regime = 'dynamic') {
  const entry = MEASUREMENT_UNCERTAINTY_DEG[joint];
  if (!entry) return null;
  const value = entry[regime];
  return typeof value === 'number' ? value : null;
}

/**
 * Faixa de referência para uma junta numa posição do pé, na convenção pedida.
 * Devolve `null` quando não existe referência defensável (e explica porquê em `reason`).
 *
 * @returns {{ good:number[], acceptable:number[]|null, evidence:string, convention:string, reading:string, sources:string[], reason?:string }|null}
 */
export function referenceFor(joint, position, { regime = 'dynamic', posture = 'upright', flexibility = 'medium' } = {}) {
  const entry = FIT_REFERENCE_TABLE[joint];
  if (!entry || !entry.positions) return null;
  const slot = entry.positions[position] || entry.positions.all;
  if (!slot) return null;

  // Recurso EXPLÍCITO: quando a posição só declara a faixa de um regime e a faixa não depende
  // dele (é a mesma orientação publicada), usa-se essa — e diz-se que houve recurso. Onde os
  // regimes diferem (joelho estático vs dinâmico) cada um tem a sua entrada e não há recurso.
  // Onde a posição declara `dynamic: null` (sem alvo), NÃO há recurso nenhum.
  let variant = slot[regime] || null;
  let regimeFellBack = false;
  if (!variant && slot[regime] === undefined && slot.dynamic && typeof slot.dynamic === 'object') {
    variant = slot.dynamic;
    regimeFellBack = true;
  }
  if (!variant) return slot.dynamic_reason ? { missing: true, reason: slot.dynamic_reason } : null;

  // Ajustes que não mudam a referência mas mudam a faixa aplicável.
  let good = variant.byPosture?.[posture]?.good || variant.byFlexibility?.[flexibility]?.good;
  if (!good && variant.byFlexibility) good = variant.byFlexibility.medium?.good;
  if (!good) good = variant.good;

  return {
    good: Array.isArray(good) ? [...good] : null,
    acceptable: Array.isArray(variant.acceptable) ? [...variant.acceptable] : null,
    evidence: variant.evidence || slot.evidence || entry.evidence || EVIDENCE.PRACTICE,
    convention: variant.convention || null,
    // O texto e as fontes podem estar no variante, na posição ou na junta — procura-se nos três.
    reading: variant.reading || slot.reading || entry.reading || '',
    published: variant.published || null,
    sources: variant.sources || slot.sources || entry.sources || [],
    comparability: entry.comparability || 'direct',
    comparabilityNote: entry.comparabilityNote || null,
    alternativeConvention: variant.alternativeConvention || null,
    // `true` = a faixa publicada é a mesma nos dois regimes; foi usada tal como está.
    regimeFellBack,
  };
}

/**
 * Avalia UM ângulo numa posição do pé como um fitter o faria.
 *
 * Diferente de `evaluatePosition` (que compara com o alvo a prescrever), esta função:
 *  - trabalha com a faixa `good` e a `acceptable` (duas velocidades, não uma);
 *  - declara a convenção e o grau de evidência;
 *  - marca `withinUncertainty` quando o desvio cabe dentro do erro de repetição publicado
 *    — nesse caso o veredicto NÃO é um erro, é ruído do método;
 *  - nunca julga quando a convenção não é comparável (`comparability: 'mismatch'`).
 *
 * @returns {{
 *   joint:string, position:string, measured:number|null, status:'good'|'acceptable'|'out'|'descriptive'|'no-reference'|'missing',
 *   severity:'tolerated'|'clear'|null, deviationDeg:number|null, direction:'low'|'high'|null, withinUncertainty:boolean,
 *   uncertaintyDeg:number|null, evidence:string|null, evidenceLabel:string|null,
 *   convention:string|null, reading:string, sources:string[], comparability:string, note:string|null
 * }}
 */
export function assessMetricAtPosition({
  joint,
  value,
  position,
  posture = 'upright',
  flexibility = 'medium',
  regime = 'dynamic',
} = {}) {
  const base = {
    joint,
    position,
    measured: Number.isFinite(value) ? value : null,
    status: 'missing',
    severity: null,
    deviationDeg: null,
    direction: null,
    withinUncertainty: false,
    uncertaintyDeg: uncertaintyFor(joint, regime),
    evidence: null,
    evidenceLabel: null,
    convention: null,
    reading: '',
    sources: [],
    comparability: 'direct',
    note: null,
  };

  const reference = referenceFor(joint, position, { regime, posture, flexibility });
  if (!reference) {
    return { ...base, status: 'no-reference', note: 'Sem referência publicada para esta junta.' };
  }
  if (reference.missing) {
    return { ...base, status: 'no-reference', note: reference.reason };
  }

  const filled = {
    ...base,
    evidence: reference.evidence,
    evidenceLabel: EVIDENCE_LABELS[reference.evidence] || null,
    convention: reference.convention,
    reading: reference.reading,
    sources: reference.sources,
    comparability: reference.comparability,
    note: reference.comparabilityNote,
  };

  if (reference.comparability === 'mismatch') {
    // Convenção diferente da que medimos: o número é registado, nunca julgado.
    return { ...filled, status: 'descriptive' };
  }
  if (base.measured === null) return filled;
  if (!reference.good) return { ...filled, status: 'descriptive' };

  if (base.measured >= reference.good[0] && base.measured <= reference.good[1]) {
    return { ...filled, status: 'good' };
  }

  const low = base.measured < reference.good[0];
  const deviation = low
    ? Math.round((reference.good[0] - base.measured) * 10) / 10
    : Math.round((base.measured - reference.good[1]) * 10) / 10;

  // UM DESVIO SÓ É UM ERRO SE EXCEDER O ERRO DE REPETIÇÃO PUBLICADO.
  // Dentro dele, o método não consegue distinguir "o atleta está 1° fora" de "o método varia 1°".
  const within = base.uncertaintyDeg !== null && deviation <= base.uncertaintyDeg;
  const toleratedByBand =
    reference.acceptable &&
    base.measured >= reference.acceptable[0] &&
    base.measured <= reference.acceptable[1];

  let status;
  let severity = null;
  if (within) {
    status = 'acceptable';
  } else {
    status = 'out';
    // `tolerated` = desvio real mas ainda na faixa tolerada; `clear` = fora de tudo.
    severity = toleratedByBand ? 'tolerated' : 'clear';
  }

  let note = reference.comparabilityNote;
  if (within) {
    note = `Desvio de ${deviation}° dentro do erro de repetição publicado (${base.uncertaintyDeg}°) — não é um erro do atleta.`;
  } else if (severity === 'tolerated') {
    note = `Desvio real de ${deviation}° (acima do erro de repetição de ${base.uncertaintyDeg}°), mas ainda dentro da faixa tolerada.`;
  } else if (severity === 'clear') {
    note = `Desvio de ${deviation}° fora da faixa tolerada — é aqui que um fitter intervém.`;
  }

  return {
    ...filled,
    status,
    severity,
    deviationDeg: deviation,
    direction: low ? 'low' : 'high',
    withinUncertainty: within,
    note,
  };
}

/**
 * Leitura profissional por posição do pé, a partir das avaliações por posição já feitas.
 *
 * @param {Object} params
 * @param {Array} params.evaluations  resultado de `evaluatePosition` por posição
 * @param {string} params.posture
 * @param {string} params.flexibility
 * @param {'static'|'dynamic'} params.regime
 * @returns {{ positions:Array, caveats:string[], sources:string[] }}
 */
export function buildProfessionalReading({ evaluations = [], posture = 'upright', flexibility = 'medium', regime = 'dynamic' } = {}) {
  const jointByMetric = METRIC_TO_JOINT;

  const positions = (evaluations || []).map((evaluation) => {
    const verdicts = (evaluation.metrics || [])
      .map((metric) => {
        const joint = jointByMetric[metric.metric];
        if (!joint) return null;
        const assessment = assessMetricAtPosition({
          joint,
          value: typeof metric.measured === 'number' ? metric.measured : null,
          position: evaluation.position,
          posture,
          flexibility,
          regime,
        });
        return { ...assessment, appStatus: metric.status, unit: metric.unit || '°', appTarget: metric.target };
      })
      .filter(Boolean);

    // O que um fitter faria primeiro nesta posição: o desvio real mais grosseiro.
    const actionable = verdicts
      .filter((verdict) => verdict.status === 'out' && verdict.deviationDeg !== null)
      .sort((a, b) => b.deviationDeg - a.deviationDeg);

    const headline = actionable.length
      ? `Prioridade nesta posição: ${actionable[0].joint} (${actionable[0].direction === 'low' ? 'abaixo' : 'acima'} ` +
        `do intervalo em ${actionable[0].deviationDeg}°) — ${EVIDENCE_LABELS[actionable[0].evidence] || 'referência'}.`
      : verdicts.some((verdict) => verdict.status === 'good')
        ? 'Nada a corrigir nesta posição dentro do que a referência permite afirmar.'
        : 'Sem veredicto automático nesta posição: as métricas disponíveis são de registo.';

    return {
      position: evaluation.position,
      label: evaluation.label,
      summary: evaluation.summary,
      verdicts,
      priorityFix: actionable[0] || null,
      headline,
    };
  });

  const caveats = [
    INJURY_EVIDENCE.statement,
    ASYMMETRY_POLICY.rule,
    'As referências são orientação de referência, não fronteiras de diagnóstico: o que decide é o atleta, os sintomas e a estabilidade sobre a bicicleta.',
  ];

  const sources = Array.from(
    new Set(
      positions
        .flatMap((position) => position.verdicts.flatMap((verdict) => verdict.sources || []))
        .filter(Boolean),
    ),
  );

  return { positions, caveats, sources };
}

/**
 * Auditoria do protocolo de captura — o que faltou para os números serem "magistrais".
 *
 * @param {{ durationSeconds?:number, completeCycles?:number, cadenceRpm?:number, framesPerSecond?:number, cameraDistanceM?:number }} capture
 * @returns {{ passed:Array, failed:Array, ready:boolean, summary:string }}
 */
export function auditCaptureProtocol({
  durationSeconds = null,
  completeCycles = null,
  cadenceRpm = null,
  framesPerSecond = null,
  cameraDistanceM = null,
} = {}) {
  const passed = [];
  const failed = [];
  const record = (ok, id, label, requirement, detail) => {
    const entry = { id, label, requirement, detail };
    if (ok) passed.push(entry);
    else failed.push(entry);
  };

  record(
    Number.isFinite(durationSeconds) && durationSeconds >= CAPTURE_PROTOCOL.minDurationSeconds,
    'duration',
    'Duração da pedalada',
    `≥ ${CAPTURE_PROTOCOL.minDurationSeconds} s`,
    Number.isFinite(durationSeconds) ? `${Math.round(durationSeconds)} s` : 'duração desconhecida',
  );
  record(
    Number.isFinite(completeCycles) && completeCycles >= CAPTURE_PROTOCOL.minCompleteCycles,
    'cycles',
    'Ciclos completos',
    `≥ ${CAPTURE_PROTOCOL.minCompleteCycles}`,
    Number.isFinite(completeCycles) ? `${completeCycles} ciclos` : 'fase do cranque indisponível',
  );
  record(
    Number.isFinite(cadenceRpm) &&
      cadenceRpm >= CAPTURE_PROTOCOL.cadenceWindowRpm[0] &&
      cadenceRpm <= CAPTURE_PROTOCOL.cadenceWindowRpm[1],
    'cadence',
    'Cadência',
    `${CAPTURE_PROTOCOL.cadenceWindowRpm[0]}–${CAPTURE_PROTOCOL.cadenceWindowRpm[1]} rpm`,
    Number.isFinite(cadenceRpm) ? `${cadenceRpm} rpm` : 'cadência não estimada',
  );
  record(
    Number.isFinite(framesPerSecond) && framesPerSecond >= CAPTURE_PROTOCOL.minimumFps,
    'fps',
    'Fotogramas por segundo',
    `≥ ${CAPTURE_PROTOCOL.minimumFps} fps (60 preferido)`,
    Number.isFinite(framesPerSecond) ? `${framesPerSecond} fps` : 'fps desconhecidos',
  );
  record(
    Number.isFinite(cameraDistanceM) &&
      cameraDistanceM >= CAPTURE_PROTOCOL.cameraDistanceM[0] &&
      cameraDistanceM <= CAPTURE_PROTOCOL.cameraDistanceM[1],
    'distance',
    'Distância da câmara',
    `${CAPTURE_PROTOCOL.cameraDistanceM[0]}–${CAPTURE_PROTOCOL.cameraDistanceM[1]} m`,
    Number.isFinite(cameraDistanceM) ? `${cameraDistanceM} m` : 'distância não indicada',
  );

  const ready = failed.length === 0;
  return {
    passed,
    failed,
    ready,
    summary: ready
      ? 'Captura conforme o protocolo: os ângulos podem ser lidos como medidas.'
      : `Captura fora do protocolo em ${failed.length} ponto(s): os números devem ser tratados como indicativos, não como medidas.`,
  };
}

export default {
  EVIDENCE,
  EVIDENCE_LABELS,
  METRIC_TO_JOINT,
  MEASUREMENT_UNCERTAINTY_DEG,
  KNEE_ANGLE_CONVENTIONS,
  FIT_REFERENCE_TABLE,
  ASYMMETRY_POLICY,
  INJURY_EVIDENCE,
  CAPTURE_PROTOCOL,
  flexionToIncluded,
  includedToFlexion,
  uncertaintyFor,
  referenceFor,
  assessMetricAtPosition,
  buildProfessionalReading,
  auditCaptureProtocol,
};
