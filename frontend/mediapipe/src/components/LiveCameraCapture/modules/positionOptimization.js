/**
 * Otimização por Posição do Pé no Cranque (PositionOptimization).
 *
 * PORQUÊ ESTE FICHEIRO:
 * O alvo ótimo NÃO é o mesmo em todas as posições do cranque. Aos 6h (pé em baixo) a perna está
 * quase estendida e o que define a altura do selim é a EXTENSÃO do joelho; às 3h (pé à frente) o
 * joelho está em flexão média e o que importa é a posição longitudinal (KOPS); às 12h (pé em cima)
 * o objetivo é o FECHO DA ANCA (não bater no peito com o joelho); às 9h (pé atrás) o que se lê é a
 * TRANSIÇÃO do tornozelo, não a fase de potência. O ângulo do pé (toe-down) tem, ele próprio, uma
 * faixa diferente em cada posição.
 *
 * Consequência prática: sempre que o pé está numa posição diferente, o alvo e a ordem de ajuste
 * mudam com ele. Aplicar o alvo do BDC a uma medição às 3h (ou prescrever travessões a partir de
 * uma foto às 12h) é um erro — e era o que acontecia em parte do motor.
 *
 * FONTES E LIMITES (o que este ficheiro NÃO afirma):
 * - As faixas vêm de `crankPositionRules.js` (SSOT): extensão 145–155° estático / 137–150° dinâmico,
 *   fecho da anca 50–80° (prática 55–65°), tornozelo 95–105°, toe-down por posição.
 * - O alvo do tronco e do cotovelo NÃO muda com a posição do cranque: o tronco é praticamente
 *   constante durante a pedalada (é a bacia/tronco que dominam) — por isso, nessas duas métricas,
 *   todas as posições contribuem para o MESMO alvo e o que se reporta por posição é a dispersão.
 * - Nenhuma posição autoriza prescrever o que a evidência não suporta: a estrutura "autoridade"
 *   (`authority`) diz explicitamente o que é prescritivo e o que é registo.
 */

import {
  ANALYSIS_POSITION_ORDER,
  ANKLE_TARGET_RANGE,
  CRANK_POSITION_RULES,
  HIP_CLOSURE_RANGE,
  getCrankRule,
  getFootToeDownTarget,
} from './crankPositionRules.js';
import { POSTURE_AERO, getPostureMetricAuthority } from './postureMode.js';
import { METRIC_TO_JOINT, assessMetricAtPosition } from './professionalFitStandards.js';

/** Deslocamento do alvo do tronco por flexibilidade declarada (graus). */
export const FLEXIBILITY_TRUNK_SHIFT = { low: 5, medium: 0, high: -5 };

/** Limites duros do alvo do tronco, para o deslocamento por flexibilidade não sair do razoável. */
export const TRUNK_TARGET_BOUNDS = { upright: [30, 60], aero: [5, 35] };

/**
 * Alvo do tronco ajustado à flexibilidade declarada.
 *
 * PORQUÊ: um atleta com flexibilidade baixa (não toca nos pés) não sustenta a mesma inclinação
 * de tronco que um atleta flexível; exigir-lhe o mesmo intervalo produz uma ordem que ele não
 * consegue cumprir. É prática de fit declarada — não existe norma publicada que quantifique isto.
 *
 * @param {[number, number]} targetRange - alvo do tronco em vigor (postura + modalidade)
 * @param {string} flexibility - 'low' | 'medium' | 'high'
 * @param {string} posture - 'upright' | 'aero'
 * @returns {{ range: [number, number], shift: number, note: string|null }}
 */
export function applyFlexibilityToTrunkTarget(targetRange = [40, 50], flexibility = 'medium', posture = 'upright') {
  const base = Array.isArray(targetRange) && targetRange.length === 2 ? targetRange : [40, 50];
  const shift = FLEXIBILITY_TRUNK_SHIFT[flexibility] ?? 0;
  if (!shift) return { range: [...base], shift: 0, note: null };

  const bounds = posture === POSTURE_AERO ? TRUNK_TARGET_BOUNDS.aero : TRUNK_TARGET_BOUNDS.upright;
  const range = [
    Math.min(bounds[1], Math.max(bounds[0], base[0] + shift)),
    Math.min(bounds[1], Math.max(bounds[0], base[1] + shift)),
  ];
  const direction = shift > 0 ? 'menos inclinado (mais confortável)' : 'mais deitado (mais aerodinâmico)';
  return {
    range,
    shift,
    note:
      `Flexibilidade ${flexibility === 'low' ? 'baixa' : 'alta'}: alvo do tronco ajustado de ` +
      `${base[0]}–${base[1]}° para ${range[0]}–${range[1]}° (${direction}). ` +
      'Prática de fit declarada — revisitar se o atleta trabalhar mobilidade.',
  };
}

/**
 * Tabela de objetivos POR POSIÇÃO DO PÉ.
 *
 * Cada objetivo declara:
 *  - `metric`      chave estável da métrica;
 *  - `angleKey`    que ângulo da medição alimenta a métrica (`joelho`, `anca`, `tornozelo`, `pe`, ...);
 *  - `authorityKey`chave na tabela de autoridade (`crankPositionRules` + postura);
 *  - `target`      função que devolve o intervalo alvo desta posição (ou null = descritivo);
 *  - `feeds`       componentes da bicicleta que corrigem este desvio na direção indicada;
 *  - `why`         por que razão o alvo é este nesta posição.
 */
export const POSITION_OBJECTIVES = {
  tdc: {
    id: 'tdc',
    label: 'TDC (12h)',
    phaseDeg: 0,
    summary:
      'Pé em cima: o objetivo é o FECHO DA ANCA (o joelho não deve subir até ao peito). Não se prescreve altura de selim nem KOPS a partir desta posição.',
    objectives: [
      {
        metric: 'hipClosure',
        angleKey: 'anca',
        authorityKey: 'hipClosure',
        label: 'Fecho da anca',
        target: () => HIP_CLOSURE_RANGE,
        feeds: [
          { component: 'stack', status: 'low', sign: 1, rationale: 'subir o guiador abre a anca no topo do curso' },
          { component: 'reach', status: 'low', sign: -1, rationale: 'encurtar o cockpit reduz o fecho da anca' },
          { component: 'crankLength', status: 'low', sign: -1, rationale: 'um crenque mais curto sobe menos o joelho' },
        ],
        why: 'Aos 12h a perna está no ponto mais alto da órbita: é aqui que o fecho da anca é crítico (risco de pinçamento femoroacetabular).',
      },
      {
        metric: 'toeDown',
        angleKey: 'pe',
        authorityKey: 'foot',
        label: 'Ângulo do pé (toe-down)',
        target: () => getFootToeDownTarget('tdc'),
        feeds: [
          { component: 'cleat', status: 'high', sign: -1, rationale: 'recuar os travessões baixa a ponta do pé' },
          { component: 'cleat', status: 'low', sign: 1, rationale: 'avançar os travessões sobe a ponta do pé' },
        ],
        why: 'No topo do curso o pé aponta naturalmente mais para baixo; a faixa é mais alta do que às 3h.',
      },
      {
        metric: 'trunk',
        angleKey: 'costas',
        authorityKey: 'trunk',
        label: 'Inclinação do tronco',
        target: null /** alvo único, vem do motor (postura + modalidade + flexibilidade) */,
        feeds: [
          { component: 'stack', status: 'low', sign: 1, rationale: 'tronco mais plano do que o alvo pede elevação do guiador' },
          { component: 'stack', status: 'high', sign: -1, rationale: 'tronco mais ereto do que o alvo pede baixar o guiador' },
        ],
        why: 'O tronco é praticamente constante durante o ciclo: esta posição dá mais um voto ao MESMO alvo.',
      },
      {
        metric: 'elbow',
        angleKey: 'braco',
        authorityKey: 'elbow',
        label: 'Ângulo do cotovelo',
        target: null,
        feeds: [
          { component: 'reach', status: 'high', sign: -1, rationale: 'cotovelo bloqueado pede encurtar o cockpit' },
          { component: 'reach', status: 'low', sign: 1, rationale: 'cotovelo demasiado aberto pede alongar o cockpit' },
        ],
        why: 'O cotovelo lê-se em qualquer posição; contribui para o alvo único de alcance.',
      },
    ],
  },

  '90deg': {
    id: '90deg',
    label: '90° (3h)',
    phaseDeg: 90,
    summary:
      'Pé à frente (fase de potência): o objetivo é a POSIÇÃO LONGITUDINAL do selim (KOPS) e a transição do tornozelo. O joelho aqui está em flexão média — não define altura de selim.',
    objectives: [
      {
        metric: 'kops',
        angleKey: null,
        authorityKey: 'kops',
        label: 'Desvio KOPS',
        target: () => [-10, 10],
        feeds: [{ component: 'saddleForeAft', status: 'high', sign: -1, rationale: 'joelho à frente do eixo do pedal → recuar o selim' }],
        why: 'Às 3h (cranque horizontal) o joelho está sobre o eixo do pedal na posição ótima — é a única posição que autoriza mexer no recuo.',
      },
      {
        metric: 'toeDown',
        angleKey: 'pe',
        authorityKey: 'foot',
        label: 'Ângulo do pé (toe-down)',
        target: () => getFootToeDownTarget('90deg'),
        feeds: [
          { component: 'cleat', status: 'high', sign: -1, rationale: 'recuar os travessões baixa a ponta do pé' },
          { component: 'cleat', status: 'low', sign: 1, rationale: 'avançar os travessões sobe a ponta do pé' },
        ],
        why: 'Às 3h, com carga máxima, o pé fica mais nivelado: a faixa é mais baixa do que às 12h.',
      },
      {
        metric: 'ankle',
        angleKey: 'tornozelo',
        authorityKey: 'ankle',
        label: 'Estabilidade do tornozelo',
        target: () => ANKLE_TARGET_RANGE,
        feeds: [
          { component: 'ankle', status: 'high', sign: -1, rationale: 'tornozelo muito em ponta → recuar travessões' },
          { component: 'ankle', status: 'low', sign: 1, rationale: 'calcanhar muito baixo → avançar travessões' },
        ],
        why: 'Às 3h o tornozelo está na fase de transmissão de potência: aqui a leitura é prescritiva.',
      },
      {
        metric: 'trunk',
        angleKey: 'costas',
        authorityKey: 'trunk',
        label: 'Inclinação do tronco',
        target: null,
        feeds: [
          { component: 'stack', status: 'low', sign: 1, rationale: 'tronco mais plano do que o alvo pede elevação do guiador' },
          { component: 'stack', status: 'high', sign: -1, rationale: 'tronco mais ereto do que o alvo pede baixar o guiador' },
        ],
        why: 'Voto adicional para o alvo único de tronco.',
      },
      {
        metric: 'elbow',
        angleKey: 'braco',
        authorityKey: 'elbow',
        label: 'Ângulo do cotovelo',
        target: null,
        feeds: [
          { component: 'reach', status: 'high', sign: -1, rationale: 'cotovelo bloqueado pede encurtar o cockpit' },
          { component: 'reach', status: 'low', sign: 1, rationale: 'cotovelo demasiado aberto pede alongar o cockpit' },
        ],
        why: 'Voto adicional para o alvo único de alcance.',
      },
    ],
  },

  bdc: {
    id: 'bdc',
    label: 'BDC (6h)',
    phaseDeg: 180,
    summary:
      'Pé em baixo: o objetivo é a EXTENSÃO DO JOELHO — a única posição que define a ALTURA DO SELIM. Não se prescreve recuo/avanço a partir daqui.',
    objectives: [
      {
        metric: 'kneeExtension',
        angleKey: 'joelho',
        authorityKey: 'knee',
        label: 'Extensão do joelho',
        target: null /** alvo vem do regime (estático/dinâmico) + modalidade */,
        feeds: [
          { component: 'saddleHeight', status: 'low', sign: 1, rationale: 'joelho demasiado fletido → subir selim' },
          { component: 'saddleHeight', status: 'high', sign: -1, rationale: 'joelho demasiado estendido → descer selim' },
        ],
        why: 'No ponto morto inferior a perna está quase estendida: é a amplitude que define a altura do selim.',
      },
      {
        metric: 'toeDown',
        angleKey: 'pe',
        authorityKey: 'foot',
        label: 'Ângulo do pé (toe-down)',
        target: () => getFootToeDownTarget('bdc'),
        feeds: [
          { component: 'cleat', status: 'high', sign: -1, rationale: 'recuar os travessões baixa a ponta do pé' },
          { component: 'cleat', status: 'low', sign: 1, rationale: 'avançar os travessões sobe a ponta do pé' },
        ],
        why: 'No ponto morto inferior o pé procura o pedal: a faixa é intermédia (5–20°).',
      },
      {
        metric: 'ankle',
        angleKey: 'tornozelo',
        authorityKey: 'ankle',
        label: 'Estabilidade do tornozelo',
        target: () => ANKLE_TARGET_RANGE,
        feeds: [
          { component: 'ankle', status: 'high', sign: -1, rationale: 'tornozelo muito em ponta → recuar travessões' },
          { component: 'ankle', status: 'low', sign: 1, rationale: 'calcanhar muito baixo → avançar travessões' },
        ],
        why: 'No BDC a altura do selim também aparece no tornozelo: aqui a leitura é prescritiva.',
      },
      {
        metric: 'trunk',
        angleKey: 'costas',
        authorityKey: 'trunk',
        label: 'Inclinação do tronco',
        target: null,
        feeds: [
          { component: 'stack', status: 'low', sign: 1, rationale: 'tronco mais plano do que o alvo pede elevação do guiador' },
          { component: 'stack', status: 'high', sign: -1, rationale: 'tronco mais ereto do que o alvo pede baixar o guiador' },
        ],
        why: 'Voto adicional para o alvo único de tronco.',
      },
      {
        metric: 'elbow',
        angleKey: 'braco',
        authorityKey: 'elbow',
        label: 'Ângulo do cotovelo',
        target: null,
        feeds: [
          { component: 'reach', status: 'high', sign: -1, rationale: 'cotovelo bloqueado pede encurtar o cockpit' },
          { component: 'reach', status: 'low', sign: 1, rationale: 'cotovelo demasiado aberto pede alongar o cockpit' },
        ],
        why: 'Voto adicional para o alvo único de alcance.',
      },
    ],
  },

  '270deg': {
    id: '270deg',
    label: '270° (9h)',
    phaseDeg: 270,
    summary:
      'Pé atrás: o objetivo é a ESTABILIDADE/TRANSIÇÃO do tornozelo. O tornozelo aqui é descritivo (não é a fase de transmissão de potência): só vota no tronco e no alcance.',
    objectives: [
      {
        metric: 'ankle',
        angleKey: 'tornozelo',
        authorityKey: 'ankle',
        label: 'Transição do tornozelo',
        target: null,
        feeds: [],
        why: 'Aos 9h o pé está em recuperação: não existe alvo universal para esta fase — regista-se, não se prescreve.',
      },
      {
        metric: 'toeDown',
        angleKey: 'pe',
        authorityKey: 'foot',
        label: 'Ângulo do pé (toe-down)',
        target: () => getFootToeDownTarget('270deg'),
        feeds: [],
        why: 'A fase de recuperação não tem faixa de toe-down defensável: fica descritiva.',
      },
      {
        metric: 'trunk',
        angleKey: 'costas',
        authorityKey: 'trunk',
        label: 'Inclinação do tronco',
        target: null,
        feeds: [
          { component: 'stack', status: 'low', sign: 1, rationale: 'tronco mais plano do que o alvo pede elevação do guiador' },
          { component: 'stack', status: 'high', sign: -1, rationale: 'tronco mais ereto do que o alvo pede baixar o guiador' },
        ],
        why: 'Voto adicional para o alvo único de tronco.',
      },
      {
        metric: 'elbow',
        angleKey: 'braco',
        authorityKey: 'elbow',
        label: 'Ângulo do cotovelo',
        target: null,
        feeds: [
          { component: 'reach', status: 'high', sign: -1, rationale: 'cotovelo bloqueado pede encurtar o cockpit' },
          { component: 'reach', status: 'low', sign: 1, rationale: 'cotovelo demasiado aberto pede alongar o cockpit' },
        ],
        why: 'Voto adicional para o alvo único de alcance.',
      },
    ],
  },
};

/** Posições com objetivos definidos (a posição livre não tem alvos de posição). */
export const OPTIMIZED_POSITIONS = Object.keys(POSITION_OBJECTIVES);

/**
 * Objetivos da posição, com a AUTORIDADE já resolvida pela postura.
 *
 * Em posição aero o KOPS sai da prescrição e o fecho da anca fica descritivo (as convenções das
 * fontes não são comparáveis) — a autoridade vem de `postureMode`, não é reinventada aqui.
 *
 * @param {{ position?: string, posture?: string, flexibility?: string, targets?: Object }} params
 */
export function objectivesForPosition({ position, posture, flexibility = 'medium', targets = {} } = {}) {
  const table = POSITION_OBJECTIVES[position] || null;
  if (!table) {
    return {
      id: position || null,
      label: position ? getCrankRule(position).label : 'Posição não indicada',
      phaseDeg: null,
      summary:
        'Posição do pé desconhecida: não há alvo de posição para aplicar. Mede-se e registra-se, mas sem ordem — escolha a posição (12h/3h/6h/9h) para o alvo seguir a posição do pé.',
      objectives: [],
      unidentified: true,
    };
  }

  const authority = getPostureMetricAuthority({ posture, position });

  return {
    ...table,
    unidentified: false,
    objectives: table.objectives.map((objective) => {
      const rawAuthority = authority[objective.authorityKey];
      const prescriptive = rawAuthority === true || rawAuthority === 'extension' || rawAuthority === 'footRange';
      return {
        ...objective,
        prescriptive,
        authority: rawAuthority,
        target:
          objective.target === null
            ? null
            : objective.target({ posture, targets, flexibility, position }),
        // Um alvo explícito de posição que não é prescritivo permanece visível, mas não vota.
        feeds: prescriptive
          ? objective.feeds
          : objective.feeds.map((feed) => ({ ...feed, suppressed: true, reason: `posição ${table.label} + postura ${posture}: métrica descritiva` })),
      };
    }),
  };
}

/**
 * Avalia uma medição (ângulos + KOPS) contra os objetivos da SUA posição.
 *
 * @returns {{ position, label, metrics: Array<{metric,label,measured,target,status,deviation,sign,feeds}> }}
 */
export function evaluatePosition({ position, angles = {}, kopsResult = null, posture, flexibility = 'medium', targets = {} } = {}) {
  const table = objectivesForPosition({ position, posture, flexibility, targets });

  const metrics = table.objectives.map((objective) => {
    const raw = objective.metric === 'kops' ? kopsResult?.offsetMm ?? null : angles?.[objective.angleKey] ?? null;
    const measured = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    const target = Array.isArray(objective.target) ? objective.target : null;

    let status = 'descriptive';
    let deviation = null;
    if (!objective.prescriptive) {
      status = 'descriptive';
    } else if (measured === null) {
      status = 'missing';
    } else if (!target) {
      // Alvo vem do motor (ex.: extensão do joelho depende do regime estático/dinâmico).
      status = 'delegated';
    } else if (measured < target[0]) {
      status = 'low';
      deviation = Math.round((target[0] - measured) * 10) / 10;
    } else if (measured > target[1]) {
      status = 'high';
      deviation = Math.round((measured - target[1]) * 10) / 10;
    } else {
      status = 'ok';
    }

    return {
      metric: objective.metric,
      label: objective.label,
      measured,
      // Unidade PRÓPRIA da métrica: o desvio do KOPS é medido em milímetros nos carris do selim,
      // não em graus — escrever "22°" num desvio longitudinal seria uma unidade falsa.
      unit: objective.metric === 'kops' ? 'mm' : '°',
      target,
      status,
      deviation,
      sign: status === 'low' ? 1 : status === 'high' ? -1 : 0,
      why: objective.why,
      feeds: status === 'ok' || status === 'missing' || status === 'descriptive' || status === 'delegated'
        ? []
        : objective.feeds.filter((feed) => !feed.suppressed && feed.status === status),
    };
  });

  return { position: table.id, label: table.label, summary: table.summary, unidentified: table.unidentified, metrics };
}

/**
 * Votos por componente, a partir da avaliação de TODAS as posições medidas.
 *
 * Esta é a peça que garante a regra de ouro: cada posição contribui com o seu voto para a peça que
 * corrige o seu desvio, e o motor reconcilia UMA direção por componente — mesmo que dois desvios de
 * posições diferentes apontem para a mesma peça.
 *
 * @param {Array} evaluations - resultado de `evaluatePosition` por foto
 * @returns {Object} { [component]: [{ position, metric, sign, magnitude, rationale, source }] }
 */
export function collectVotesByComponent(evaluations = []) {
  const votes = {};
  (evaluations || []).forEach((evaluation) => {
    (evaluation?.metrics || []).forEach((metric) => {
      (metric.feeds || []).forEach((feed) => {
        if (!votes[feed.component]) votes[feed.component] = [];
        votes[feed.component].push({
          position: evaluation.position,
          positionLabel: evaluation.label,
          metric: metric.metric,
          measured: metric.measured,
          target: metric.target,
          deviation: metric.deviation,
          sign: feed.sign,
          magnitude: metric.deviation,
          rationale: feed.rationale,
          source: `${evaluation.label} · ${metric.label}`,
        });
      });
    });
  });
  return votes;
}

/**
 * Resumo textual, por posição, do que foi medido e do alvo que cada posição pede.
 * É o que alimenta a tabela "otimização por posição" do resumo técnico.
 */
export function describePositionOptimization(evaluations = []) {
  return (evaluations || []).map((evaluation) => ({
    position: evaluation.position,
    label: evaluation.label,
    unidentified: evaluation.unidentified,
    summary: evaluation.summary,
    metrics: (evaluation.metrics || []).map((metric) => ({
      ...metric,
      verdict:
        metric.status === 'ok'
          ? 'no alvo'
          : metric.status === 'low'
            ? `abaixo do alvo em ${metric.deviation}${metric.unit}`
            : metric.status === 'high'
              ? `acima do alvo em ${metric.deviation}${metric.unit}`
              : metric.status === 'missing'
                ? 'sem medição'
                : metric.status === 'delegated'
                  ? 'alvo definido pelo motor (regime/modalidade)'
                  : 'descritivo',
    })),
  }));
}

/** Nº de posições diferentes medidas (para avisos de cobertura). */
export function measuredPositionCount(evaluations = []) {
  return new Set((evaluations || []).map((e) => e.position).filter(Boolean)).size;
}

/**
 * Cartas do quadro clínico comparativo — UMA por fase da pedalada (12h → 3h → 6h → 9h).
 *
 * PORQUÊ: o quadro antigo tinha as metas escritas na marcação (joelho 145–155°, KOPS ±10 mm, anca
 * > 50°) e só mostrava três fases. Isso contradizia o motor numa bicicleta de MTB, numa medição
 * dinâmica (vídeo) ou em posição aero — e as 9h simplesmente não existiam no ecrã. Aqui cada carta
 * recebe o objetivo da SUA posição (da SSOT `crankPositionRules`), as métricas medidas com o alvo
 * próprio daquela posição (do `describePositionOptimization`) e a ordem de ajuste emitida para a
 * peça que corrige o desvio, quando existe.
 *
 * @param {Object} params
 * @param {Array}  params.evaluations   resultado de `describePositionOptimization` (ou `evaluatePosition`)
 * @param {Array}  params.prescriptions ordens emitidas pelo motor coerente (com `key`/`action`)
 * @param {Function} [params.positionMeta] `(id) => ({ icon, shortLabel })` para a etiqueta visual
 * @param {Object} [params.rules]       tabela de regras (por omissão `CRANK_POSITION_RULES`)
 * @returns {Array<{id,icon,label,goal,measuredPosition,hasData,metrics}>}
 */
export function buildPhaseCards({
  evaluations = [],
  prescriptions = [],
  positionMeta = null,
  rules = CRANK_POSITION_RULES,
  posture = 'upright',
  flexibility = 'medium',
  regime = 'dynamic',
} = {}) {
  return ANALYSIS_POSITION_ORDER.map((id) => {
    const rule = rules[id] || null;
    const meta = typeof positionMeta === 'function' ? positionMeta(id) || {} : {};
    const row = (evaluations || []).find((item) => item.position === id) || null;

    const metrics = row
      ? row.metrics
          .filter((metric) => metric.measured !== null)
          .map((metric) => {
            // A peça que corrige o desvio é a que consta do feed; quando o alvo é delegado ao motor
            // (extensão do joelho às 6h), a peça correspondente é o selim.
            const component =
              (metric.feeds[0] && metric.feeds[0].component) ||
              (metric.metric === 'kneeExtension' ? 'saddleHeight' : null);
            const order = component ? (prescriptions || []).find((item) => item.key === component) || null : null;
            const unit = metric.unit || '°';

            // Avaliação PROFISSIONAL: o mesmo desvio ganha um veredicto que respeita a convenção
            // de medição, o grau de evidência da referência e o erro de repetição publicado
            // (um desvio que cabe lá dentro não é um erro do atleta).
            const joint = METRIC_TO_JOINT[metric.metric] || null;
            const professional = joint
              ? assessMetricAtPosition({ joint, value: metric.measured, position: id, posture, flexibility, regime })
              : null;

            return {
              ...metric,
              professionalStatus: professional ? professional.status : null,
              // O desvio PROFISSIONAL é o que sobra depois de descontar o erro de repetição —
              // diferente do `deviation` bruto do motor (que é nulo quando o alvo é delegado).
              professionalDeviation: professional ? professional.deviationDeg : null,
              evidenceLabel: professional ? professional.evidenceLabel : null,
              professionalNote: professional ? professional.note : null,
              withinUncertainty: Boolean(professional && professional.withinUncertainty),
              positionTarget: Array.isArray(metric.target) ? [...metric.target] : null,
              // Sem alvo de posição (delegado ao regime/modalidade, ou descritivo) NÃO se escreve
              // "alvo": o veredicto da métrica já diz de onde vem o alvo.
              targetText: Array.isArray(metric.target)
                ? `alvo ${metric.target[0]}–${metric.target[1]}${unit === 'mm' ? ' mm' : '°'}`
                : '',
              order: order ? order.action : null,
            };
          })
      : [];

    // Prioridade da fase = o desvio profissional mais grosseiro (não o maior desvio bruto:
    // só conta o que excede o erro de repetição, senão priorizava-se ruído).
    const actionable = metrics
      .filter((metric) => metric.professionalStatus === 'out' && typeof metric.professionalDeviation === 'number')
      .sort((a, b) => b.professionalDeviation - a.professionalDeviation);

    return {
      id,
      icon: meta.icon || '',
      label: meta.shortLabel || (rule ? rule.label : id),
      goal: rule ? rule.explanationPt : '',
      measuredPosition: Boolean(row),
      hasData: metrics.length > 0,
      priority: actionable.length ? actionable[0].label : null,
      priorityDetail: actionable.length
        ? `${actionable[0].professionalDeviation}${actionable[0].unit || '°'} fora da referência (${actionable[0].evidenceLabel || 'referência'})`
        : null,
      metrics,
    };
  });
}

export default {
  POSITION_OBJECTIVES,
  buildPhaseCards,
  OPTIMIZED_POSITIONS,
  FLEXIBILITY_TRUNK_SHIFT,
  applyFlexibilityToTrunkTarget,
  objectivesForPosition,
  evaluatePosition,
  collectVotesByComponent,
  describePositionOptimization,
  measuredPositionCount,
};
