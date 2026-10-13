/**
 * Modos de Postura e Alvos Específicos (PostureMode).
 *
 * FONTE ÚNICA DE VERDADE (SSOT) para saber *que alvos se aplicam* conforme o atleta está
 * numa posição de estrada (ereta) ou numa posição AERO (barras de contra-relógio/triatlo).
 *
 * PORQUÊ:
 * Numa posição aero os braços ficam visivelmente fletidos sobre as almofadas e o tronco fica
 * muito mais plano. Julgar essa posição com os alvos da estrada produzia ordens erradas
 * ("braços bloqueados", "cockpit muito rebaixado", "recuar o selim pelo KOPS").
 *
 * EVIDÊNCIA (com o que NÃO sustenta):
 * - **Tronco (face à horizontal):** estrada ≈ 30–50° (elite 35–40°, geral 40–50°); TT/tri ≈ 10–30°
 *   (elite 10–15°; posições observadas em elites 4–18°).
 *   Fontes: Holliday & Swart (2021) https://pmc.ncbi.nlm.nih.gov/articles/PMC9219349/ ;
 *   Velogicfit — road/tri metrics https://docs.velogicfit.com/section-02-using-velogic-studio/road-metrics ,
 *   https://docs.velogicfit.com/section-02-using-velogic-studio/triathlon-metrics ;
 *   Cubel et al. (2022) https://www.jsc-journal.com/index.php/JSC/article/view/780
 * - **Antebraço:** em tri/TT 0–20° face à horizontal, com 5–10° como partida (Velogicfit, tri metrics).
 * - **Cotovelo:** NÃO existe alvo consensual para a flexão em aerobars. A geometria prática
 *   (braço quase vertical, antebraço quase horizontal, cotovelos sobre as almofadas) dá um ângulo
 *   claramente fechado; o intervalo aqui usado é prática de fit, não norma. Em estrada a referência
 *   prática é 155–170° (Velogicfit; BikeFit — upper body TT).
 * - **JOELHO: NÃO muda por ser aero.** As mesmas referências (Holmes 145–155 estático; 137–150
 *   dinâmico) aplicam-se; a BikeDynamics sugere começar com a altura de estrada ou 1–2 mm mais baixa.
 *   Fontes: Velogicfit (mesmos intervalos em road e tri); BikeDynamics https://bikedynamics.co.uk/FitGuideTT.htm
 * - **Recuo do selim:** em TT/tri a referência é o ângulo de assento 78–86° (partida 80°), não o KOPS
 *   (estrada 72–76°). Por isso em aero o KOPS passa a DESCRITIVO.
 * - **Anca:** as convenções não são comparáveis entre fontes (F.I.S.T. 95–105°; BikeDynamics mínimo
 *   ≈50° em Ironman; 55–65° citado em estrada) — em aero fica **descritiva**, sem alvo inventado.
 */

import { getPositionMetricAuthority } from './crankPositionRules.js';

/** Identificadores dos modos de postura suportados. */
export const POSTURE_UPRIGHT = 'upright';
export const POSTURE_AERO = 'aero';

/** Alvos de uma posição de estrada (o comportamento histórico da aplicação). */
export const UPRIGHT_TARGETS = {
  knee: [145, 155],
  back: [40, 50],
  elbow: [150, 165],
  shoulder: [85, 95],
  head: [35, 55],
  ankle: [95, 105],
  antebraco: null,
};

/**
 * Alvos de uma posição aero. O JOELHO mantém-se igual de propósito (a evidência não sustenta
 * um alvo próprio), a cabeça fica descritiva e o KOPS/anca saem da prescrição (ver autoridades).
 */
export const AERO_TARGETS = {
  knee: [145, 155],
  back: [10, 30],
  elbow: [80, 115],
  shoulder: null,
  head: null,
  ankle: [95, 105],
  antebraco: [0, 20],
};

/**
 * Deslocamentos de MODALIDADE (independentes da postura). O MTB continua a ter a sua própria
 * extensão de joelho, porque a posição e a suspensão mudam a leitura (prática de fit).
 */
export const STYLE_TARGET_OVERRIDES = {
  mtb: { knee: [140, 150], back: [45, 55], elbow: [145, 160], ankle: [90, 100], head: null },
  road: {},
  gravel: {},
  tt: {},
};

/** Metadados apresentáveis de cada postura (usados na interface e nos relatórios). */
export const POSTURE_MODES = {
  [POSTURE_UPRIGHT]: {
    id: POSTURE_UPRIGHT,
    icon: '🚴',
    label: 'Estrada (ereta)',
    shortLabel: 'Estrada',
    summary:
      'Alvos de posição de estrada: tronco 40–50°, cotovelo 150–165°. O KOPS prescreve o recuo/avanço do selim.',
    sources: ['Holliday & Swart (2021)', 'Velogicfit (road metrics)'],
  },
  [POSTURE_AERO]: {
    id: POSTURE_AERO,
    icon: '🪂',
    label: 'Aero (barras de contra-relógio)',
    shortLabel: 'Aero',
    summary:
      'Alvos de posição aero: tronco 10–30°, cotovelo 80–115° (prática de fit), antebraço 0–20°. Altura do selim mantém o mesmo alvo; KOPS e fecho da anca ficam descritivos.',
    sources: ['Velogicfit (triathlon metrics)', 'Cubel et al. (2022)', 'BikeDynamics (TT/tri)'],
  },
};

/** Posturas válidas (para validar escolhas do utilizador). */
export const POSTURE_IDS = Object.keys(POSTURE_MODES);

/** Modo de postura por omissão. */
export const DEFAULT_POSTURE = POSTURE_UPRIGHT;

/** Uma postura válida? */
export function isValidPosture(posture) {
  return POSTURE_IDS.includes(posture);
}

/**
 * Alvos efetivos = base da postura + sobreposições da modalidade declarada.
 *
 * Nota importante: a modalidade `tt` **não** altera o joelho (era o comportamento antigo,
 * 148–158°, sem suporte na evidência). Em TT/aero o joelho mantém o alvo da estrada.
 *
 * @param {{ posture?: string, ridingStyle?: string }} params
 * @returns {Object} alvos prontos a usar pelos motores
 */
export function resolveTargets({ posture = DEFAULT_POSTURE, ridingStyle = 'road' } = {}) {
  const safePosture = isValidPosture(posture) ? posture : DEFAULT_POSTURE;
  const base = safePosture === POSTURE_AERO ? { ...AERO_TARGETS } : { ...UPRIGHT_TARGETS };
  const styleOverrides = STYLE_TARGET_OVERRIDES[ridingStyle] || {};
  const targets = { ...base, ...styleOverrides };

  // Em aero os alvos da modalidade são irrelevantes para o tronco/profundidade aerodinâmica:
  // a postura manda. O joelho do MTB continua a valer (é geometria de suspensão/posição).
  if (safePosture === POSTURE_AERO) {
    targets.back = AERO_TARGETS.back;
    targets.elbow = AERO_TARGETS.elbow;
    targets.head = null;
    targets.antebraco = AERO_TARGETS.antebraco;
    if (ridingStyle !== 'mtb') targets.knee = AERO_TARGETS.knee;
  }

  return targets;
}

/**
 * Autoridade das métricas = regras da posição do cranque (SSOT) ajustadas pela postura.
 *
 * Em aero:
 *  - `kops` → `false` (fica descritivo: a referência é o ângulo de assento 78–86°);
 *  - `hipClosure` → `'descriptive'` (convenções não comparáveis);
 *  - `head` → `'descriptive'` (cabeça baixa é o objetivo, não um desvio);
 *  - `forearm` → `true` (antebraço quase horizontal, 0–20°);
 *  - `elbow` → `true` (com o alvo de aero: almofadas e extensões).
 *
 * @param {{ posture?: string, position?: string }} params
 */
export function getPostureMetricAuthority({ posture = DEFAULT_POSTURE, position = 'bdc' } = {}) {
  const base = { ...getPositionMetricAuthority(position), forearm: null };
  if (posture !== POSTURE_AERO) return base;

  return {
    ...base,
    kops: false,
    hipClosure: 'descriptive',
    head: 'descriptive',
    elbow: true,
    forearm: true,
  };
}

/**
 * A altura do selim continua a ser prescrita em aero? Sim — a extensão do joelho no BDC
 * é a métrica que a define, independentemente da postura.
 */
export function prescribesSaddleHeightInPosture(posture = DEFAULT_POSTURE) {
  return posture === POSTURE_AERO || posture === POSTURE_UPRIGHT;
}

/**
 * Textos específicos da posição aero, alinhados com a evidência (o que muda e porquê).
 * As chaves são `métrica.variante`, com variantes `ok`, `low` (abaixo do mínimo) e `high`.
 */
export const POSTURE_COPY = {
  aero: {
    trunk: {
      ok: {
        component: 'Aero — Tronco/Stack',
        action: 'Manter stack e almofadas (0 mm)',
        why: 'Tronco nesta faixa é o objetivo aerodinâmico da posição (10–30° face à horizontal; elites chegam a 4–18°) sem fechar a respiração.',
        harmDone: 'Nenhum. É o compromisso entre área frontal e capacidade de pedalar.',
      },
      low: {
        component: 'Aero — Tronco/Stack',
        action: 'Abrir a anca antes de baixar mais a frente',
        whatToDo: 'Verificar o apoio das almofadas e a altura do stack antes de tentar deitar mais o tronco; com o tronco abaixo do alvo, a prioridade é abrir a anca (selim mais à frente) e não baixar mais a frente.',
        why: 'Abaixo de ~10° o ganho aerodinâmico é pequeno e o custo aparece na anca e na respiração — a evidência mostra aumento do esforço percebido nas posições mais baixas.',
        harmDone: 'Anca sobre-fechada no topo do curso, perda de potência e ventilação restrita; a cabeça deixa de ver a estrada em segurança.',
      },
      high: {
        component: 'Aero — Tronco/Stack',
        action: 'Baixar stack/almofadas ~10 mm',
        whatToDo: 'Baixar o stack/almofadas em passos de 10 mm e reavaliar: primeiro as almofadas (apoio), depois as extensões (alcance).',
        why: 'Com o tronco acima de ~30° a posição aero perde o benefício principal (área frontal) — é o ajuste de maior retorno antes de mexer no selim.',
        harmDone: 'Postura híbrida: paga o desconforto das barras sem o ganho aerodinâmico.',
      },
    },
    elbow: {
      ok: {
        component: 'Aero — Cotovelo/Almofadas',
        action: 'Manter apoios e extensões (0 mm)',
        why: 'Cotovelos fletidos sobre as almofadas, com o antebraço quase horizontal, é a assinatura da posição aero (prática de fit; não existe alvo consensual para o ângulo do cotovelo).',
        harmDone: 'Nenhum. Os ombros ficam apoiados e a respiração desobstruída.',
      },
      high: {
        component: 'Aero — Cotovelo/Almofadas',
        action: 'Aproximar extensões/apoios (cotovelos sobre as almofadas)',
        whatToDo: 'Cotovelo demasiado aberto para aero: aproximar as extensões e/ou os apoios para que os cotovelos fiquem SOBRE as almofadas, logo atrás delas.',
        why: 'Sem os cotovelos apoiados não há transferência de peso para as almofadas e a posição aero degrada-se para "mãos na base bar".',
        harmDone: 'Peso todo nas mãos e nos ombros, dormência nos punhos e instabilidade no guiador (risco de perda de controlo).',
      },
      low: {
        component: 'Aero — Cotovelo/Almofadas',
        action: 'Alongar o apoio (almofadas/extensões) ~10 mm',
        whatToDo: 'Alongar o apoio (almofadas e extensões) para abrir o cotovelo; confirmar que o braço fica quase vertical e o antebraço plano.',
        why: 'Um cotovelo demasiado fechado empurra os ombros para cima e estreita a caixa torácica — o ganho aerodinâmico não compensa a perda respiratória.',
        harmDone: 'Compressão nos ombros e no nervo ulnar, respiração curta e dores cervicais.',
      },
    },
    forearm: {
      ok: {
        component: 'Aero — Antebraço',
        action: 'Manter inclinação das extensões',
        why: 'Antebraço praticamente horizontal (0–20°, ideal 5–10°) é a referência de tri/TT para manter as mãos nas extensões sem esforço isométrico.',
        harmDone: 'Nenhum. Punhos e ombros descarregados.',
      },
      high: {
        component: 'Aero — Antebraço',
        action: 'Elevar a ponta das extensões (~10–15°)',
        whatToDo: 'Elevar a ponta das extensões (ou baixar as almofadas) para o antebraço ficar quase paralelo ao solo.',
        why: 'Antebraço inclinado para cima obriga os músculos do antebraço a segurar o corpo — energia que devia ir para o pedal.',
        harmDone: 'Fadiga precoce dos extensores do punho, dormência nas mãos e perda de tempo em esforços longos.',
      },
      low: {
        component: 'Aero — Antebraço',
        action: 'Nivelar o antebraço com o solo',
        whatToDo: 'Verificar a inclinação das extensões: um antebraço a descer acaba em pressão nos punhos e no selim.',
        why: 'A referência é o antebraço quase nivelado com o solo (0–20°); descer abaixo disso empurra o atleta para frente no selim.',
        harmDone: 'Pressão excessiva no períneo e nos punhos, com instabilidade da bacia.',
      },
    },
    kops: {
      descriptive: {
        component: 'Aero — Recuo do Selim (posição aero)',
        action: 'Sem prescrição de KOPS em posição aero',
        whatToDo: 'Não mexer no recuo do selim pelo KOPS. Em TT/tri a referência é o ângulo de assento (78–86°, partida 80°) e a posição do corpo sobre o apoio dos cotovelos — não o joelho sobre o eixo do pedal.',
        why: 'O KOPS é uma referência de estrada (assento 72–76°). Em aero o atleta senta-se muito mais à frente de propósito, pelo que o desvio medido não é um erro.',
        harmDone: 'Recuar o selim para "cumprir" o KOPS numa bicicleta de contra-relógio fecha a anca e destrói a posição aero — a ordem seria prejudicial.',
        detail: 'Medido por curiosidade de registo; a decisão de recuo/avanço em aero sai do ângulo de assento, que esta versão ainda não mede.',
      },
    },
  },
};

/**
 * Texto específico da postura para uma métrica/variante, ou `null` se não houver
 * (nesse caso usa-se o texto padrão).
 */
export function postureCopyFor(posture, metric, variant) {
  const table = POSTURE_COPY[posture];
  if (!table) return null;
  const entry = table[metric];
  if (!entry) return null;
  return entry[variant] || entry.ok || null;
}

/**
 * Linha de "alvos aplicados" para o relatório e para o texto exportado.
 * Deixa claro, com números, com que perfil a análise foi feita.
 */
export function formatTargetsLine(posture = DEFAULT_POSTURE, targets = {}) {
  const mode = POSTURE_MODES[posture] || POSTURE_MODES[DEFAULT_POSTURE];
  const range = (value) => (Array.isArray(value) ? `${value[0]}–${value[1]}°` : 'descritivo');
  const parts = [
    `tronco ${range(targets.back)}`,
    `cotovelo ${range(targets.elbow)}`,
    `joelho no BDC ${range(targets.knee)} (igual em estrada e aero)`,
  ];
  if (posture === POSTURE_AERO) {
    parts.push(`antebraço ${range(targets.antebraco)}`);
    parts.push('KOPS e fecho da anca descritivos');
  }
  return `${mode.icon} Alvos aplicados: ${mode.shortLabel} — ${parts.join(' · ')}.`;
}

export default {
  POSTURE_UPRIGHT,
  POSTURE_AERO,
  POSTURE_MODES,
  UPRIGHT_TARGETS,
  AERO_TARGETS,
  resolveTargets,
  getPostureMetricAuthority,
  postureCopyFor,
  formatTargetsLine,
  isValidPosture,
};
