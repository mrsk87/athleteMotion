/**
 * Resumo Técnico de Ajuste — TODOS os dados contam (TechnicalSummary).
 *
 * PORQUÊ ESTE FICHEIRO:
 * O pedido foi explícito: "todos os dados fornecidos têm de contar para o resumo de ajuste técnico".
 * Antes disso, vários dados eram recolhidos e ficavam sem efeito visível em lado nenhum — a altura
 * (só contexto), a flexibilidade (não usava nada), o tamanho do quadro (nunca entrava numa decisão),
 * o peso e o número de sapato (só apareciam no relatório do vídeo), o reach/drop do guiador (só
 * texto). Um resumo técnico que ignore metade do que o atleta escreveu não é um resumo técnico.
 *
 * COMO:
 * Cada dado fornecido produz UMA linha com:
 *  - o valor (e a unidade);
 *  - o que ele ALTEROU na decisão (`effect`), citando a peça e o número;
 *  - ou, quando não conta, o MOTIVO exato e o que falta para passar a contar.
 *
 * Regra de honestidade: um dado nunca aparece como "contado" se não houver nada na decisão que
 * dependa dele. Se o dado existe mas não muda nada, a linha di-lo (`status: 'context'`).
 */

import { AthleteProfile } from './athleteProfile.js';
import {
  DEEP_BAR_DROP_MM,
  barShapeReading,
  cockpitReading,
  crankLengthRule,
  handlebarWidthRule,
  resolveEquipment,
} from './equipmentFitRules.js';
import {
  TOLERANCES,
  computeTheoreticalEstimates,
  compareWithCurrent,
  toNumber,
} from '../../AthleteOnboarding/modules/theoreticalEstimates.js';
import { CRANK_POSITION_RULES } from './crankPositionRules.js';
import { POSTURE_MODES, DEFAULT_POSTURE } from './postureMode.js';

/** Procura a ordem prescrita por componente (para citar o número real no resumo). */
function prescriptionFor(prescriptions = [], key) {
  return (prescriptions || []).find((item) => item.key === key) || null;
}

/** Linha de resumo (estrutura única para a interface e para o texto exportado). */
function row({ group, label, value, unit = '', status, effect, source }) {
  return { group, label, value, unit, status, effect, source };
}

const has = (value) => value !== null && value !== undefined && value !== '';

/**
 * Constrói o quadro "dados que contam" a partir de tudo o que foi fornecido.
 *
 * @param {Object} params
 * @param {Object} params.athlete          dados do passo 1 (atleta)
 * @param {Object} params.bike             dados do passo 1 (bicicleta)
 * @param {Object} params.geometry         geometria adicional (opcional)
 * @param {Object} params.profile          perfil da análise (peso, nº de sapato, altura, costura)
 * @param {string} params.posture          postura em vigor
 * @param {Object} params.targets          alvos em vigor (já com flexibilidade aplicada)
 * @param {Array}  params.prescriptions    ordens emitidas (para citar os números)
 * @param {Array}  params.evaluations      avaliação por posição do pé (positionOptimization)
 * @param {Array}  params.notices          avisos já emitidos
 * @returns {{ rows: Array, counted: number, missing: number, context: number, posture: string }}
 */
export function buildDataAccounting({
  athlete = {},
  bike = {},
  geometry = {},
  profile = {},
  posture = DEFAULT_POSTURE,
  targets = {},
  prescriptions = [],
  evaluations = [],
  notices = [],
} = {}) {
  const rows = [];
  const equipment = resolveEquipment({ athlete, bike, geometry });

  // ---------------------------------------------------------------- ATLETA
  if (has(athlete.height_cm)) {
    const height = toNumber(athlete.height_cm);
    const inseam = toNumber(athlete.inseam_cm);
    const ratio = inseam ? Math.round((inseam / height) * 1000) / 10 : null;
    const coherent = ratio === null ? null : ratio >= 44 && ratio <= 51;
    rows.push(
      row({
        group: 'Atleta',
        label: 'Altura',
        value: height,
        unit: 'cm',
        status: ratio === null ? 'context' : coherent ? 'counts' : 'warn',
        effect:
          ratio === null
            ? 'Sem cavalo declarado não há controlo de coerência: a altura sozinha não permite estimar o selim.'
            : `Coerência cavalo/altura: ${ratio}% ${coherent ? '(dentro do esperado 44–51%)' : '(fora do esperado — confirme a medição do cavalo antes de aplicar as ordens)'}.`,
        source: 'Passo 1',
      })
    );
  } else {
    rows.push(row({ group: 'Atleta', label: 'Altura', value: null, status: 'missing', effect: 'Não fornecida: sem controlo de coerência do cavalo.', source: 'Passo 1' }));
  }

  if (has(athlete.inseam_cm)) {
    const estimates = computeTheoreticalEstimates({ inseam_cm: athlete.inseam_cm, shoulder_width_cm: athlete.shoulder_width_cm, riding_style: equipment.ridingStyle });
    const saddle = prescriptionFor(prescriptions, 'saddleHeight');
    const crank = prescriptionFor(prescriptions, 'crankLength');
    rows.push(
      row({
        group: 'Atleta',
        label: 'Cavalo (entre-perna)',
        value: toNumber(athlete.inseam_cm),
        unit: 'cm',
        status: 'counts',
        effect:
          `Estimativas: selim LeMond ${estimates.values.lemond_saddle_height_cm} cm · 109% ${estimates.values.hamley_109_saddle_height_cm} cm · ` +
          `quadro ${estimates.values.estimated_frame_size_cm} cm · crenque ${estimates.values.recommended_crank_length_mm} mm.` +
          (saddle ? ` Ordem emitida: ${saddle.action}.` : ' Sem ordem de selim nesta análise (nenhuma foto às 6h dentro do alvo).') +
          (crank ? ` Ordem de crenque: ${crank.action}.` : ''),
        source: 'Passo 1 + estimativas',
      })
    );
  } else {
    rows.push(
      row({
        group: 'Atleta',
        label: 'Cavalo (entre-perna)',
        value: null,
        status: 'missing',
        effect: 'Sem cavalo não há altura de selim teórica, faixa de crenque nem tamanho de quadro — escreva-o no passo 1.',
        source: 'Passo 1',
      })
    );
  }

  if (has(athlete.shoulder_width_cm)) {
    const rule = handlebarWidthRule({
      shouldersCm: equipment.shouldersCm,
      ridingStyle: equipment.ridingStyle,
      mountedWidthMm: equipment.handlebarWidthMm,
    });
    const bar = prescriptionFor(prescriptions, 'handlebarWidth');
    rows.push(
      row({
        group: 'Atleta',
        label: 'Largura dos ombros (biacromial)',
        value: toNumber(athlete.shoulder_width_cm),
        unit: 'cm',
        status: rule.status === 'danger' ? 'counts' : rule.status === 'ok' ? 'counts' : 'context',
        effect:
          rule.status === 'convention'
            ? `Guiador de MTB: referência convencional ${rule.recommendedRangeMm?.[0]}–${rule.recommendedRangeMm?.[1]} mm (a biacromial não define largura de guiador plano).`
            : rule.recommendedMm === null
              ? 'Guiador recomendado pelos ombros ainda por comparar.'
              : `Guiador recomendado: ${rule.recommendedMm} mm` +
                (rule.mountedWidthMm === null
                  ? ' — falta a largura do guiador montado para comparar.'
                  : ` vs montado ${rule.mountedWidthMm} mm (diferença ${rule.deltaMm > 0 ? '+' : ''}${rule.deltaMm} mm).` +
                    (bar ? ` Ordem emitida: ${bar.action}.` : ' Dentro da tolerância: nenhuma ordem.')),
        source: 'Passo 1 + regra atleta↔equipamento',
      })
    );
  } else {
    rows.push(
      row({
        group: 'Atleta',
        label: 'Largura dos ombros (biacromial)',
        value: null,
        status: 'missing',
        effect: 'Sem largura de ombros não há como validar a largura do guiador recomendada (nem avisar se o guiador for mais largo).',
        source: 'Passo 1',
      })
    );
  }

  if (has(athlete.flexibility)) {
    const flexibility = athlete.flexibility;
    rows.push(
      row({
        group: 'Atleta',
        label: 'Flexibilidade',
        value: flexibility === 'low' ? 'baixa' : flexibility === 'high' ? 'alta' : 'média',
        status: 'counts',
        effect: `Alvo do tronco em vigor: ${Array.isArray(targets.back) ? `${targets.back[0]}–${targets.back[1]}°` : 'descritivo'} (flexibilidade baixa sobe o alvo, alta desce-o).`,
        source: 'Passo 1 + postura',
      })
    );
  } else {
    rows.push(row({ group: 'Atleta', label: 'Flexibilidade', value: null, status: 'context', effect: 'Não declarada: assume-se média (alvo do tronco sem deslocamento).', source: 'Passo 1' }));
  }

  rows.push(
    row({
      group: 'Atleta',
      label: 'Modalidade',
      value: equipment.ridingStyle,
      status: 'counts',
      effect: `Alvos da modalidade aplicados (ex.: joelho ${Array.isArray(targets.knee) ? `${targets.knee[0]}–${targets.knee[1]}°` : '—'}) e referência de largura de guiador ${equipment.ridingStyle === 'mtb' ? 'de MTB (720–780 mm)' : 'de estrada'}.`,
      source: 'Passo 1',
    })
  );

  // ------------------------------------------------------------- BICICLETA
  if (has(bike.current_saddle_height_cm)) {
    const saddle = prescriptionFor(prescriptions, 'saddleHeight');
    rows.push(
      row({
        group: 'Bicicleta',
        label: 'Altura do selim medida',
        value: toNumber(bike.current_saddle_height_cm),
        unit: 'cm',
        status: 'counts',
        effect: saddle
          ? `Ordem em valor absoluto: ${saddle.equipmentTarget ? `${saddle.equipmentTarget.currentCm} cm → ${saddle.equipmentTarget.targetCm} cm` : saddle.action}.`
          : 'Sem desvio fora do alvo: mantém-se (a medição fica registada como referência).',
        source: 'Passo 1',
      })
    );
  } else {
    rows.push(
      row({
        group: 'Bicicleta',
        label: 'Altura do selim medida',
        value: null,
        status: 'missing',
        effect: 'Sem esta medida as ordens de selim ficam relativas ("subir ~17 mm") em vez de absolutas ("73,5 → 75,2 cm").',
        source: 'Passo 1',
      })
    );
  }

  if (has(bike.handlebar_width_mm)) {
    const rule = handlebarWidthRule({
      shouldersCm: equipment.shouldersCm,
      ridingStyle: equipment.ridingStyle,
      mountedWidthMm: equipment.handlebarWidthMm,
    });
    const wider = rule.recommendedMm !== null && rule.deltaMm !== null && rule.deltaMm > 0;
    const barOrder = prescriptionFor(prescriptions, 'handlebarWidth');
    rows.push(
      row({
        group: 'Bicicleta',
        label: 'Largura do guiador montado',
        value: toNumber(bike.handlebar_width_mm),
        unit: 'mm',
        status: wider ? 'counts' : 'context',
        effect:
          rule.recommendedMm === null
            ? 'Sem largura de ombros declarada não há comparação (escreva-a no passo 1).'
            : wider
              ? `GUIADOR MAIS LARGO DO QUE OS OMBROS: ${rule.mountedWidthMm} mm vs ${rule.recommendedMm} mm recomendados (+${rule.deltaMm} mm). ${
                  Math.abs(rule.deltaMm) >= 20
                    ? 'Troca prescrita.'
                    : 'Acima da tolerância de ±10 mm: planear a troca (não desaparece do resumo).'
                }${barOrder ? ` Ordem emitida: ${barOrder.action}.` : ''}`
              : rule.deltaMm < 0
                ? `Guiador mais estreito do que os ombros (${rule.mountedWidthMm} mm vs ${rule.recommendedMm} mm): restringe a respiração se a diferença for grande.${barOrder ? ` Ordem emitida: ${barOrder.action}.` : ''}`
                : 'Largura coerente com a largura biacromial.',
        source: 'Passo 1 + regra atleta↔equipamento',
      })
    );
  } else {
    rows.push(
      row({
        group: 'Bicicleta',
        label: 'Largura do guiador montado',
        value: null,
        status: 'missing',
        effect: 'Sem a largura montada não se confirma se o guiador é mais largo do que os ombros.',
        source: 'Passo 1',
      })
    );
  }

  const barShape = barShapeReading({
    barReachMm: equipment.barReachMm,
    barDropMm: equipment.barDropMm,
  });
  if (barShape) {
    const shape = prescriptionFor(prescriptions, 'handlebarShape');
    rows.push(
      row({
        group: 'Bicicleta',
        label: 'Reach / Drop do guiador',
        value: barShape.text,
        status: barShape.deep ? 'counts' : 'context',
        effect: barShape.deep
          ? `Drop profundo (> ${DEEP_BAR_DROP_MM} mm). ` +
            (shape
              ? `Ordem emitida: ${shape.action}.`
              : 'Dentro do alvo do tronco: a profundidade é usada como referência de cockpit, sem ordem.')
          : 'Forma do guiador registada: interpreta o alcance total do cockpit (quadro + avanço + reach do guiador).',
        source: 'Passo 1 + ângulo do tronco',
      })
    );
  } else {
    rows.push(
      row({
        group: 'Bicicleta',
        label: 'Reach / Drop do guiador',
        value: null,
        status: 'context',
        effect: 'Não declarados: sem eles não se distingue "guiador fundo" de "avanço longo" quando o tronco está alto.',
        source: 'Passo 1',
      })
    );
  }

  if (has(bike.stem_length_mm)) {
    const reach = prescriptionFor(prescriptions, 'reach');
    rows.push(
      row({
        group: 'Bicicleta',
        label: 'Avanço montado',
        value: toNumber(bike.stem_length_mm),
        unit: 'mm',
        status: 'counts',
        effect: reach
          ? `Ordem em valor absoluto: ${reach.equipmentTarget ? `avanço atual ${reach.equipmentTarget.currentMm} mm → ${reach.equipmentTarget.targetMm} mm` : reach.action}.`
          : 'Cotovelo dentro do alvo: mantém-se (o valor fica registado para a próxima alteração).',
        source: 'Passo 1',
      })
    );
  } else {
    rows.push(row({ group: 'Bicicleta', label: 'Avanço montado', value: null, status: 'missing', effect: 'Sem o avanço montado a ordem de alcance fica relativa ("encurtar ~15 mm").', source: 'Passo 1' }));
  }

  if (has(bike.crank_length_mm)) {
    const rule = crankLengthRule({ inseamCm: equipment.inseamCm, mountedCrankMm: equipment.crankMm });
    const crank = prescriptionFor(prescriptions, 'crankLength');
    rows.push(
      row({
        group: 'Bicicleta',
        label: 'Crenque montado',
        value: toNumber(bike.crank_length_mm),
        unit: 'mm',
        status: rule.status === 'warning' ? 'counts' : 'context',
        effect:
          rule.recommendedMm === null
            ? 'Sem cavalo declarado não há faixa de crenque para comparar.'
            : `Faixa do cavalo: ${rule.recommendedMm} mm${rule.deltaMm ? ` (montado ${rule.mountedCrankMm} mm, ${rule.deltaMm > 0 ? '+' : ''}${rule.deltaMm} mm)` : ' — coincide'}.` +
              (crank ? ` Ordem emitida: ${crank.action}.` : '') +
              ' O crenque é também uma das correções do fecho da anca às 12h.',
        source: 'Passo 1 + regra atleta↔equipamento',
      })
    );
  } else {
    rows.push(row({ group: 'Bicicleta', label: 'Crenque montado', value: null, status: 'missing', effect: 'Sem crenque declarado não há comparação com a faixa do cavalo (nem ligação ao fecho da anca às 12h).', source: 'Passo 1' }));
  }

  if (has(bike.frame_size_cm)) {
    const estimates = computeTheoreticalEstimates({ inseam_cm: athlete.inseam_cm });
    const comparison = compareWithCurrent({
      recommended: estimates.values.estimated_frame_size_cm,
      current: bike.frame_size_cm,
      tolerance: TOLERANCES.frameSizeCm,
    });
    if (comparison) {
      rows.push(
        row({
          group: 'Bicicleta',
          // O tamanho do quadro (o "54") é o TUBO DO SELIM, do eixo pedaleiro ao topo (C-T) — não é o
          // tubo que vai do selim ao avanço (esse é o tubo superior, na linha seguinte).
          label: 'Tamanho do quadro (tubo do selim, C–T)',
          value: toNumber(bike.frame_size_cm),
          unit: 'cm',
          status: comparison.withinTolerance ? 'context' : 'counts',
          effect: comparison.withinTolerance
            ? `Quadro dentro da estimativa prática para o cavalo (${estimates.values.estimated_frame_size_cm} cm ±${TOLERANCES.frameSizeCm}). Medida do eixo pedaleiro ao topo do tubo do selim (C-T); na convenção C-C o mesmo quadro dá ~1–2 cm menos.`
            : `Quadro ${comparison.delta > 0 ? 'maior' : 'menor'} do que a estimativa para o cavalo (${estimates.values.estimated_frame_size_cm} cm, diferença ${comparison.delta > 0 ? '+' : ''}${comparison.delta} cm): o avanço tem de compensar esse desvio — as ordens de alcance consideram-no como contexto e o resumo diz em que sentido. Medida do eixo pedaleiro ao topo do tubo do selim (C-T); na convenção C-C o mesmo quadro dá ~1–2 cm menos.`,
          source: 'Passo 1 + estimativas',
        })
      );
    } else {
      rows.push(row({ group: 'Bicicleta', label: 'Tamanho do quadro (tubo do selim, C–T)', value: toNumber(bike.frame_size_cm), unit: 'cm', status: 'context', effect: 'Sem cavalo não há tamanho estimado para comparar.', source: 'Passo 1' }));
    }
  } else {
    rows.push(row({ group: 'Bicicleta', label: 'Tamanho do quadro (tubo do selim, C–T)', value: null, status: 'context', effect: 'Sem o tubo do selim não se distingue se um cockpit longo vem do quadro ou do avanço.', source: 'Passo 1' }));
  }

  // Tubo superior (ETT): o comprimento do quadro que o atleta sente no cockpit. Sem esta linha, uma
  // ordem de avanço parece não ter relação com o quadro montado.
  if (has(bike.top_tube_mm)) {
    const cockpit = cockpitReading({
      topTubeMm: equipment.topTubeMm,
      stemMm: equipment.stemMm,
      barReachMm: equipment.barReachMm,
      ridingStyle: equipment.ridingStyle,
    });
    rows.push(
      row({
        group: 'Bicicleta',
        label: 'Tubo superior (ETT, horizontal)',
        value: toNumber(bike.top_tube_mm),
        unit: 'mm',
        status: cockpit && cockpit.complete ? 'counts' : 'context',
        effect: cockpit
          ? `${cockpit.text}. Medido na horizontal entre o eixo do tubo do selim e o eixo do tubo de direção (o avanço aperta no tubo de direção — o tubo superior não vai até ao avanço).${
              cockpit.withinTypical === false
                ? ` Valor fora da faixa habitual desta modalidade (${cockpit.typicalRangeMm[0]}–${cockpit.typicalRangeMm[1]} mm): confirmar a medição antes de mexer no avanço.`
                : ' Descritivo: compara-se de quadro para quadro, mas entra como contexto do alcance.'
            }`
          : 'Tubo superior registado (sem avanço/reach do guiador não se fecha o alcance total).',
        source: 'Passo 1 + leitura do cockpit',
      })
    );
  } else {
    rows.push(
      row({
        group: 'Bicicleta',
        label: 'Tubo superior (ETT, horizontal)',
        value: null,
        status: 'context',
        effect:
          'Sem o tubo superior não se sabe quanto do alcance vem do quadro: a ordem de avanço fica sem esse contexto (não é o mesmo encurtar 15 mm num quadro de 545 mm ou de 585 mm).',
        source: 'Passo 1',
      })
    );
  }

  const cleatPos = (
    bike.cleat_position ||
    bike.cleatPosition ||
    profile.cleatPosition ||
    profile.cleat_position ||
    ''
  ).trim().toLowerCase();

  if (has(cleatPos)) {
    const cleatLabels = {
      rearward: 'Recuados (Atrás)',
      neutral: 'Neutro (Centro)',
      forward: 'Avançados (Frente)',
    };
    const ankleOrder = prescriptionFor(prescriptions, 'ankle');
    rows.push(
      row({
        group: 'Bicicleta',
        label: 'Posição dos travessões (cleats)',
        value: cleatLabels[cleatPos] || cleatPos,
        status: ankleOrder ? 'counts' : 'context',
        effect: `Posição inicial registada (${cleatLabels[cleatPos] || cleatPos}): considerada na avaliação biomecânica do tornozelo.${ankleOrder ? ` Ordem de travessões emitida: ${ankleOrder.action}.` : ' Sem desvio no tornozelo: mantém-se.'}`,
        source: 'Passo 1 / Perfil',
      })
    );
  }

  // ---------------------------------------------------------------- PERFIL
  const profileNotes = AthleteProfile.describe(profile);
  if (has(profile.weightKg)) {
    const note = profileNotes.find((n) => n.key === 'weightSag');
    rows.push(
      row({
        group: 'Perfil',
        label: 'Peso',
        value: toNumber(profile.weightKg),
        unit: 'kg',
        status: 'counts',
        effect: `${note ? note.text : 'Sem nota mecânica.'} (Fonte: ${note?.source || '—'})`,
        source: 'Perfil da análise',
      })
    );
  } else {
    rows.push(row({ group: 'Perfil', label: 'Peso', value: null, status: 'missing', effect: 'Sem peso não há nota de sag de suspensão nem leitura da carga nas mãos.', source: 'Perfil da análise' }));
  }

  if (has(profile.shoeSizeEu)) {
    const note = profileNotes.find((n) => n.key === 'cleat');
    const cleat = prescriptionFor(prescriptions, 'cleat');
    rows.push(
      row({
        group: 'Perfil',
        label: 'Número de sapato',
        value: toNumber(profile.shoeSizeEu),
        status: cleat ? 'counts' : 'context',
        effect: `${note ? note.text : 'Sem nota de travessões.'}${cleat ? ` Ordem emitida: ${cleat.action}.` : ''}`,
        source: 'Perfil da análise',
      })
    );
  } else {
    rows.push(row({ group: 'Perfil', label: 'Número de sapato', value: null, status: 'missing', effect: 'Sem número de sapato os travessões não têm referência de recuo por tamanho.', source: 'Perfil da análise' }));
  }

  if (has(profile.waistCm)) {
    const note = profileNotes.find((n) => n.key === 'waist');
    rows.push(
      row({
        group: 'Perfil',
        label: 'Cintura (perímetro abdominal)',
        value: toNumber(profile.waistCm),
        unit: 'cm',
        status: 'context',
        effect: `${note ? note.text : 'Contexto antropométrico.'}`,
        source: 'Passo 1',
      })
    );
  }

  // -------------------------------------------------------------- POSTURA
  const postureMode = POSTURE_MODES[posture] || POSTURE_MODES[DEFAULT_POSTURE];
  rows.push(
    row({
      group: 'Postura',
      label: 'Perfil de postura',
      value: postureMode.label,
      status: 'counts',
      effect: `Manda nos alvos de tronco/cotovelo/antebraço${postureMode.id === 'aero' ? ' e torna o KOPS e o fecho da anca descritivos' : ' e mantém o KOPS prescritivo'}. O alvo do joelho no BDC é igual nas duas posturas.`,
      source: 'Postura em vigor',
    })
  );

  // ---------------------------------------------- MEDIÇÕES POR POSIÇÃO DO PÉ
  const byPosition = new Map();
  (evaluations || []).forEach((evaluation) => {
    if (!byPosition.has(evaluation.position)) byPosition.set(evaluation.position, evaluation);
  });
  if (byPosition.size === 0) {
    rows.push(
      row({
        group: 'Posição do pé',
        label: 'Posições medidas',
        value: 0,
        status: 'missing',
        effect: 'Nenhuma medição por posição: sem posições não há alvos de posição (12h fecho da anca · 3h KOPS · 6h extensão do joelho · 9h transição).',
        source: 'Fotos/vídeo',
      })
    );
  }
  byPosition.forEach((evaluation) => {
    const rule = CRANK_POSITION_RULES[evaluation.position];
    const prescriptive = (evaluation.metrics || []).filter((m) => m.status !== 'descriptive' && m.status !== 'missing');
    const offenders = prescriptive.filter((m) => m.status === 'low' || m.status === 'high');
    rows.push(
      row({
        group: 'Posição do pé',
        label: `${evaluation.label} — ${rule ? rule.explanationPt : 'medição registada'}`,
        value: `${prescriptive.length} métrica(s) prescritiva(s)`,
        status: offenders.length ? 'counts' : 'context',
        effect: offenders.length
          ? offenders
              .map(
                (m) =>
                  `${m.label}: ${m.measured}${m.unit || '°'} vs alvo ${m.target ? `${m.target[0]}–${m.target[1]}${m.unit === 'mm' ? ' mm' : '°'}` : 'do regime'} (${m.status === 'low' ? 'abaixo' : 'acima'} em ${m.deviation}${m.unit || '°'}) → ${m.feeds.length ? m.feeds.map((f) => f.component).join(' + ') : 'sem ordem'}.`
              )
              .join(' · ')
          : `${evaluation.summary} Tudo dentro do alvo nesta posição.`,
        source: `Posição ${evaluation.label}`,
      })
    );
  });

  // --------------------------------------------------------------- AVISOS
  if ((notices || []).length) {
    rows.push(
      row({
        group: 'Coerência',
        label: 'Avisos do motor',
        value: `${notices.length}`,
        status: 'warn',
        effect: notices.join(' | '),
        source: 'Motor coerente',
      })
    );
  }

  const counted = rows.filter((r) => r.status === 'counts').length;
  const missing = rows.filter((r) => r.status === 'missing').length;
  const context = rows.filter((r) => r.status === 'context').length;

  return { rows, counted, missing, context, posture };
}

/**
 * Texto do resumo técnico (para cópia/impressão e para o relatório final).
 * Deixa explícito o que cada dado fornecido alterou.
 */
export function formatTechnicalSummary({
  accounting,
  evaluations = [],
  athleteName = 'Ciclista',
  bikeModel = 'Bicicleta',
  professional = null,
} = {}) {
  let txt = '======================================================================\n';
  txt += '  RESUMO TÉCNICO DE AJUSTE — EM QUE CONTRIBUIU CADA DADO FORNECIDO\n';
  txt += '======================================================================\n';
  txt += `Atleta: ${athleteName} | Bicicleta: ${bikeModel}\n`;
  if (accounting) {
    txt += `Dados que contam: ${accounting.counted} | sem efeito nesta análise: ${accounting.context} | em falta: ${accounting.missing}\n`;
  }
  txt += '\n';

  const groups = [];
  (accounting?.rows || []).forEach((item) => {
    let group = groups.find((g) => g.name === item.group);
    if (!group) {
      group = { name: item.group, rows: [] };
      groups.push(group);
    }
    group.rows.push(item);
  });

  groups.forEach((group) => {
    txt += `── ${group.name.toUpperCase()} ──────────────────────────────────\n`;
    group.rows.forEach((item) => {
      const value = item.value === null || item.value === undefined || item.value === '' ? '—' : `${item.value}${item.unit ? ` ${item.unit}` : ''}`;
      const mark = item.status === 'missing' ? '⬜' : item.status === 'context' ? '◻️' : item.status === 'warn' ? '⚠️' : '✅';
      txt += `${mark} ${item.label}: ${value}\n   → ${item.effect}\n`;
    });
    txt += '\n';
  });

  if ((evaluations || []).length) {
    txt += '── OTIMIZAÇÃO POR POSIÇÃO DO PÉ ─────────────────────────────\n';
    evaluations.forEach((evaluation) => {
      txt += `• ${evaluation.label}: ${evaluation.summary}\n`;
      evaluation.metrics.forEach((metric) => {
        const unit = metric.unit || '°';
        const target =
          metric.target === null || metric.target === undefined
            ? 'sem alvo de posição'
            : Array.isArray(metric.target)
              ? `${metric.target[0]}–${metric.target[1]}${unit === 'mm' ? ' mm' : '°'}`
              : `${metric.target}`;
        txt += `   - ${metric.label}: ${metric.measured === null ? 'sem medição' : `${metric.measured}${unit}`} | alvo: ${target} | ${metric.verdict}\n`;
      });
    });
    txt += '\n';
  }

  if (professional && (professional.positions || []).length) {
    txt += formatProfessionalReading(professional);
  }

  txt += '======================================================================\n';
  return txt;
}

/**
 * Bloco de LEITURA PROFISSIONAL por posição do pé.
 *
 * Diferença face ao bloco anterior: aqui cada número vem com a CONVENÇÃO de medição, o GRAU
 * de evidência da referência e a fonte. É o que impede ler "150°" como se significasse o
 * mesmo em todos os sistemas — e o que diz quando uma diferença cabe dentro do erro de
 * repetição publicado (nesse caso não é um erro do atleta).
 */
function formatProfessionalReading(professional) {
  const statusLabel = {
    good: 'dentro da referência',
    acceptable: 'tolerado / dentro do erro de medição',
    out: 'fora da referência',
    descriptive: 'registo (convenção não comparável)',
    'no-reference': 'sem referência publicada',
    missing: 'sem medição',
  };

  let txt = '── LEITURA PROFISSIONAL POR POSIÇÃO DO PÉ ──────────────────\n';
  professional.positions.forEach((position) => {
    txt += `• ${position.label} — ${position.headline}\n`;
    position.verdicts.forEach((verdict) => {
      const measured = verdict.measured === null ? 'sem medição' : `${verdict.measured}${verdict.unit}`;
      const band = verdict.good ? `${verdict.good[0]}–${verdict.good[1]}` : '—';
      const evidence = verdict.evidenceLabel ? ` [${verdict.evidenceLabel}]` : '';
      txt += `   - ${verdict.joint}: ${measured} | referência: ${band}${evidence} | ${statusLabel[verdict.status] || verdict.status}\n`;
      if (verdict.withinUncertainty && verdict.note) txt += `     · ${verdict.note}\n`;
      if (verdict.reading) txt += `     · Leitura: ${verdict.reading}\n`;
    });
  });

  if ((professional.caveats || []).length) {
    txt += '\nLIMITES QUE A LEITURA RESPEITA:\n';
    professional.caveats.forEach((caveat) => (txt += ` - ${caveat}\n`));
  }
  if ((professional.sources || []).length) {
    txt += '\nFONTES DAS REFERÊNCIAS:\n';
    professional.sources.forEach((source) => (txt += ` - ${source}\n`));
  }
  txt += '\n';
  return txt;
}

export default { buildDataAccounting, formatTechnicalSummary };
