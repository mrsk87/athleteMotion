/**
 * Regras Atleta ↔ Equipamento (EquipmentFitRules).
 *
 * PORQUÊ:
 * A análise media ângulos e prescrevia ajustes sem olhar para os dados que o atleta forneceu no
 * início. Duas consequências erradas:
 *   1. Podia recomendar um guiador de 420 mm a quem tem 40 cm de ombros (só os ângulos do cotovelo
 *      viam isso, e mal). A largura biacromial é uma medida do atleta — tem de pesar.
 *   2. As ordens saíam em milímetros relativos (\"encurtar 15 mm\"), obrigando o fitter a fazer a conta
 *      com a peça que está na bicicleta. Com o avanço, o crenque e a altura do selim medidos, a ordem
 *      pode e deve sair em valor absoluto (\"avanço 100 mm → 90 mm\").
 *
 * EVIDÊNCIA E LIMITES (o que este ficheiro NÃO faz):
 * - **Largura do guiador = largura biacromial** é prática de fit apoiada em antropometria (a mesma
 *   regra do passo 1, com arredondamento aos valores comerciais 400/420/440 mm). Em MTB a largura
 *   é uma convenção própria (720–780 mm) e **não** se aplica à biacromial.
 * - **Crenque por faixa de cavalo** (165 / 170 / 172,5 / 175 mm) é a convenção que a ajuda da app
 *   documenta; crenques mais curtos abrem joelho e anca, mais longos dão alavanca.
 * - **Reach e drop do guiador** são **descritivos**: servem para interpretar o cockpit (avanço total
 *   e agressividade) e para escolher o tipo de guiador, não para prescrever um número.
 * - Sem o dado do atleta não há regra: devolve `unknown` e diz o que falta (nunca um alvo inventado).
 */

import {
  TOLERANCES,
  compareWithCurrent,
  handlebarWidthFor,
  crankLengthForInseam,
  toNumber,
} from '../../AthleteOnboarding/modules/theoreticalEstimates.js';

/** Profundidade de guiador a partir da qual se considera \"fundo\" (prática de fit). */
export const DEEP_BAR_DROP_MM = 140;
/** Faixa típica de guiador compacto (mm). */
export const COMPACT_BAR_DROP_RANGE_MM = [115, 130];
/** Faixa típica de reach do guiador (mm). */
export const TYPICAL_BAR_REACH_RANGE_MM = [70, 90];

/**
 * Faixa típica do TUBO SUPERIOR EFETIVO (ETT, mm) por modalidade — só para dizer se o valor lido é
 * plausível. NÃO é um alvo: o ETT depende da altura do atleta e da marca; compara-se de quadro para
 * quadro, não contra uma norma (Sheldon Brown; Geometry Geeks).
 */
export const TYPICAL_TOP_TUBE_MM = { road: [520, 580], gravel: [530, 600], mtb: [580, 640], tt: [500, 560] };
/** Diferença de largura de guiador (mm) a partir da qual a troca é prescrita (um passo comercial). */
export const HANDLEBAR_REPLACE_DELTA_MM = 20;

/**
 * Diferença de largura de guiador (mm) a partir da qual o desvio CONTA sempre.
 * Um guiador mais largo do que os ombros é um desvio real mesmo abaixo do passo comercial: pode não
 * justificar uma compra imediata, mas não pode desaparecer do resumo técnico (era o que acontecia
 * entre 10 e 20 mm).
 */
export const HANDLEBAR_REPORT_DELTA_MM = 5;

/**
 * Reúne os dados do atleta e da bicicleta num só objeto, com o que está e o que falta.
 *
 * Aceita as duas proveniências que existem na app: os dados da sessão (backend) e as medições do
 * passo 1 guardadas localmente — o que existir, na mesma forma.
 */
export function resolveEquipment({ athlete = {}, bike = {}, geometry = {} } = {}) {
  const merged = { ...(bike || {}), ...(geometry || {}) };
  const equipment = {
    shouldersCm: toNumber(athlete?.shoulder_width_cm ?? geometry?.shoulder_width_cm),
    inseamCm: toNumber(athlete?.inseam_cm ?? geometry?.inseam_cm),
    heightCm: toNumber(athlete?.height_cm),
    ridingStyle: athlete?.riding_style || merged.bike_type || 'road',
    saddleHeightCm: toNumber(merged.current_saddle_height_cm),
    handlebarWidthMm: toNumber(merged.handlebar_width_mm),
    stemMm: toNumber(merged.stem_length_mm),
    crankMm: toNumber(merged.crank_length_mm),
    frameSizeCm: toNumber(merged.frame_size_cm),
    // Tubo superior efetivo (ETT, mm) — comprimento do quadro sentido no cockpit. Distinto do
    // tamanho do quadro (tubo do selim) e do reach do quadro (que parte do eixo pedaleiro).
    topTubeMm: toNumber(merged.top_tube_mm),
    barReachMm: toNumber(merged.handlebar_reach_mm),
    barDropMm: toNumber(merged.handlebar_drop_mm),
    cleatPosition: (
      merged.cleat_position ||
      merged.cleatPosition ||
      athlete?.cleat_position ||
      athlete?.cleatPosition ||
      ''
    ).trim().toLowerCase() || null,
  };

  equipment.hasAthlete = equipment.shouldersCm !== null || equipment.inseamCm !== null;
  equipment.hasBike = [
    equipment.handlebarWidthMm,
    equipment.stemMm,
    equipment.crankMm,
    equipment.saddleHeightCm,
    equipment.topTubeMm,
  ].some((value) => value !== null);

  return equipment;
}

/**
 * Regra da largura do guiador contra a largura biacromial do atleta.
 *
 * @returns {{ status: 'ok'|'warning'|'danger'|'convention'|'unknown', recommendedMm: number|null,
 *             deltaMm: number|null, mountedWidthMm: number|null, reason: string }}
 */
export function handlebarWidthRule({ shouldersCm, ridingStyle = 'road', mountedWidthMm } = {}) {
  const recommendation = handlebarWidthFor(shouldersCm, ridingStyle);

  if (recommendation && Array.isArray(recommendation.rangeMm)) {
    return {
      status: 'convention',
      recommendedMm: null,
      recommendedRangeMm: [...recommendation.rangeMm],
      deltaMm: null,
      mountedWidthMm: toNumber(mountedWidthMm),
      reason: 'flat-bar',
    };
  }
  if (!recommendation) {
    return { status: 'unknown', recommendedMm: null, deltaMm: null, mountedWidthMm: toNumber(mountedWidthMm), reason: 'no-shoulders' };
  }

  const mounted = toNumber(mountedWidthMm);
  if (mounted === null) {
    return {
      status: 'unknown',
      recommendedMm: recommendation.mm,
      deltaMm: null,
      mountedWidthMm: null,
      reason: 'no-mounted-width',
    };
  }

  const comparison = compareWithCurrent({ recommended: recommendation.mm, current: mounted, tolerance: TOLERANCES.handlebarWidthMm });
  const deltaMm = comparison ? comparison.delta : null;
  const abs = Math.abs(deltaMm ?? 0);
  // Quatro degraus, para o desvio nunca "desaparecer" entre a tolerância e o passo comercial:
  //  ≥20 mm → troca prescrita · 10–20 mm → acima da tolerância (conta, sem compra imediata)
  //  5–10 mm → dentro da tolerância mas fora da largura exata · <5 mm → coerente
  const status =
    abs >= HANDLEBAR_REPLACE_DELTA_MM
      ? 'danger'
      : abs > TOLERANCES.handlebarWidthMm
        ? 'warning'
        : abs >= HANDLEBAR_REPORT_DELTA_MM
          ? 'note'
          : 'ok';
  const wider = (deltaMm ?? 0) > 0;

  return {
    status,
    recommendedMm: recommendation.mm,
    deltaMm,
    mountedWidthMm: mounted,
    wider,
    counts: status !== 'ok',
    // Sentido do desvio em texto, para a interface e o resumo não o terem de reinventar.
    comparison:
      status === 'ok'
        ? 'largura coerente com a largura biacromial'
        : `${wider ? 'MAIS LARGO' : 'mais estreito'} do que os ombros em ${abs} mm`,
    reason:
      status === 'danger'
        ? 'replace-now'
        : status === 'warning'
          ? 'above-tolerance'
          : status === 'note'
            ? 'within-tolerance-but-not-exact'
            : 'within',
  };
}

/**
 * Regra do comprimento do crenque contra a faixa de cavalo do atleta.
 */
export function crankLengthRule({ inseamCm, mountedCrankMm } = {}) {
  const recommendedMm = crankLengthForInseam(inseamCm);
  const mounted = toNumber(mountedCrankMm);
  if (recommendedMm === null) {
    return { status: 'unknown', recommendedMm: null, deltaMm: null, mountedCrankMm: mounted, reason: 'no-inseam' };
  }
  if (mounted === null) {
    return { status: 'unknown', recommendedMm, deltaMm: null, mountedCrankMm: null, reason: 'no-mounted-crank' };
  }
  const deltaMm = Math.round((mounted - recommendedMm) * 10) / 10;
  return {
    status: deltaMm === 0 ? 'ok' : 'warning',
    recommendedMm,
    deltaMm,
    mountedCrankMm: mounted,
    reason: deltaMm === 0 ? 'within-band' : deltaMm > 0 ? 'longer-than-band' : 'shorter-than-band',
  };
}

/**
 * Regra do TAMANHO DO QUADRO contra a estimativa para o cavalo (cavalo × 0,665).
 *
 * PORQUÊ ISTO CONTA: um quadro maior do que o corpo empurra o cockpit para a frente e um quadro
 * menor aproxima-o; sem este dado, uma ordem de avanço parece arbitrária ("porque é que eu, com
 * 1,70 m, preciso de um avanço de 80 mm?"). A regra não manda trocar de quadro — diz em que
 * sentido o quadro já está e quanto o cockpit tem de compensar.
 */
export function frameSizeRule({ inseamCm, frameSizeCm } = {}) {
  const inseam = toNumber(inseamCm);
  const frame = toNumber(frameSizeCm);
  if (inseam === null) return { status: 'unknown', estimatedCm: null, deltaCm: null, frameCm: frame, reason: 'no-inseam' };
  const estimatedCm = Math.round(inseam * 0.665 * 10) / 10;
  if (frame === null) return { status: 'unknown', estimatedCm, deltaCm: null, frameCm: null, reason: 'no-frame' };

  const deltaCm = Math.round((frame - estimatedCm) * 10) / 10;
  const within = Math.abs(deltaCm) <= 1.5;
  return {
    status: within ? 'ok' : deltaCm > 0 ? 'long' : 'short',
    estimatedCm,
    deltaCm,
    frameCm: frame,
    toleranceCm: 1.5,
    counts: !within,
    reason: within ? 'within' : deltaCm > 0 ? 'longer-than-estimate' : 'shorter-than-estimate',
  };
}

/**
 * Alvo ABSOLUTO da altura do selim: parte da altura que o atleta diz ter no espigão e aplica o
 * desvio que os ângulos mediram. Sem a altura escrita, devolve só o desvio (nada inventado).
 */
export function describeSaddleTarget({ currentSaddleHeightCm, deltaMm } = {}) {
  const current = toNumber(currentSaddleHeightCm);
  const delta = toNumber(deltaMm);
  if (delta === null) return null;
  if (current === null) return { currentCm: null, targetCm: null, deltaMm: delta, text: null };
  const targetCm = Math.round((current + delta / 10) * 10) / 10;
  return {
    currentCm: current,
    targetCm,
    deltaMm: delta,
    text: `de ${current} cm para ${targetCm} cm (medido no espigão do selim)`,
  };
}

/**
 * Alvo ABSOLUTO do avanço: parte do avanço montado e aplica a correção de alcance.
 */
export function describeStemTarget({ currentStemMm, deltaMm } = {}) {
  const current = toNumber(currentStemMm);
  const delta = toNumber(deltaMm);
  if (delta === null) return null;
  if (current === null) return { currentMm: null, targetMm: null, deltaMm: delta, text: null };
  const targetMm = Math.round(current + delta);
  return {
    currentMm: current,
    targetMm,
    deltaMm: delta,
    text: `avanço atual ${current} mm → ${targetMm} mm`,
  };
}

/**
 * Leitura do conjunto guiador (reach + drop) quando o atleta o declarou: serve para interpretar o
 * cockpit e para escolher o TIPO de guiador antes de mexer no avanço.
 */
export function barShapeReading({ barReachMm, barDropMm, trunkAngle, trunkTarget } = {}) {
  const reach = toNumber(barReachMm);
  const drop = toNumber(barDropMm);
  if (reach === null && drop === null) return null;

  const parts = [];
  if (reach !== null) parts.push(`reach ${reach} mm`);
  if (drop !== null) parts.push(`drop ${drop} mm`);

  const deep = drop !== null && drop > DEEP_BAR_DROP_MM;
  let trunkTooUpright = false;
  if (Array.isArray(trunkTarget) && typeof trunkAngle === 'number') {
    trunkTooUpright = trunkAngle > trunkTarget[1];
  }

  return {
    reachMm: reach,
    dropMm: drop,
    text: parts.join(' · '),
    deep,
    // Regra prática: com o tronco acima do alvo e um guiador fundo, o ajuste natural é um guiador
    // mais compacto (ou reverter o guiador), não encurtar o avanço — que mexeria no alcance.
    suggestsCompactBar: deep && trunkTooUpright,
    compactRangeMm: [...COMPACT_BAR_DROP_RANGE_MM],
    typicalReachRangeMm: [...TYPICAL_BAR_REACH_RANGE_MM],
  };
}

/**
 * Leitura do COCKPIT: o comprimento do quadro (tubo superior / ETT) somado ao avanço e à curva do
 * guiador. É esta soma que define o alcance que o atleta sente — e a razão pela qual um avanço curto
 * num quadro longo continua a dar um cockpit comprido.
 *
 * Honestidade: o ETT é **descritivo** (não há alvo universal) — o que se reporta é a soma, a fatia
 * que vem do quadro e se o valor lido é plausível para a modalidade.
 */
export function cockpitReading({ topTubeMm, stemMm, barReachMm, ridingStyle = 'road' } = {}) {
  const topTube = toNumber(topTubeMm);
  const stem = toNumber(stemMm);
  const barReach = toNumber(barReachMm);
  if (topTube === null && stem === null && barReach === null) return null;

  const complete = [topTube, stem, barReach].every((value) => value !== null);
  const totalMm = complete ? Math.round(topTube + stem + barReach) : null;
  const frameSharePct = totalMm ? Math.round((topTube / totalMm) * 100) : null;
  const typicalRangeMm = TYPICAL_TOP_TUBE_MM[ridingStyle] || TYPICAL_TOP_TUBE_MM.road;
  const withinTypical = topTube === null ? null : topTube >= typicalRangeMm[0] && topTube <= typicalRangeMm[1];

  const parts = [];
  if (topTube !== null) parts.push(`ETT ${topTube} mm`);
  if (stem !== null) parts.push(`avanço ${stem} mm`);
  if (barReach !== null) parts.push(`reach do guiador ${barReach} mm`);

  return {
    topTubeMm: topTube,
    stemMm: stem,
    barReachMm: barReach,
    totalMm,
    complete,
    frameSharePct,
    typicalRangeMm: [...typicalRangeMm],
    withinTypical,
    text:
      parts.join(' + ') +
      (totalMm === null
        ? ' (falta uma das três parcelas para fechar o alcance total)'
        : ` = ${totalMm} mm de alcance do quadro ao guiador; o quadro contribui com ${frameSharePct}%`),
  };
}

/**
 * Prescrições que nascem SÓ da comparação atleta ↔ equipamento (não dos ângulos).
 * Componentes distintos dos que o motor coerente já usa (largura do guiador e crenque), para
 * nunca haver duas ordens sobre a mesma peça.
 */
export function buildEquipmentPrescriptions(equipment = {}, { trunkAngle, trunkTarget } = {}) {
  const items = [];
  const barRule = handlebarWidthRule({
    shouldersCm: equipment.shouldersCm,
    ridingStyle: equipment.ridingStyle,
    mountedWidthMm: equipment.handlebarWidthMm,
  });

  if (barRule.status === 'danger' || barRule.status === 'warning') {
    const direction = barRule.deltaMm > 0 ? 'mais estreito' : 'mais largo';
    const replacing = barRule.status === 'danger';
    items.push({
      key: 'handlebarWidth',
      component: 'Guiador — Largura (biacromial)',
      direction: barRule.deltaMm > 0 ? 'narrow' : 'wide',
      status: replacing ? 'danger' : 'warning',
      badge: barRule.deltaMm > 0 ? '🟡 GUIADOR MAIS LARGO DO QUE OS OMBROS' : '🟡 GUIADOR MAIS ESTREITO DO QUE OS OMBROS',
      action: replacing
        ? `Trocar guiador: ${barRule.mountedWidthMm} mm → ${barRule.recommendedMm} mm`
        : `Preferir guiador de ${barRule.recommendedMm} mm na próxima troca (montado: ${barRule.mountedWidthMm} mm)`,
      whatToDo: `${
        replacing ? 'Substituir' : 'Escolher'
      } um guiador de ${barRule.recommendedMm} mm: o atual, ${barRule.mountedWidthMm} mm, está ${Math.abs(barRule.deltaMm)} mm ${direction} do que a sua largura de ombros pede${replacing ? '' : ' (dentro da tolerância de ±10 mm, mas acima da largura exata)'}.`,
      degreesInfo: `Largura biacromial: ${equipment.shouldersCm} cm → guiador ${barRule.recommendedMm} mm | Montado: ${barRule.mountedWidthMm} mm.`,
      why: 'A largura do guiador deve acompanhar a distância entre os ombros: é a medida do atleta que fecha ou abre a caixa torácica e a posição das mãos.',
      harmDone:
        barRule.deltaMm > 0
          ? 'Guiador mais largo do que os ombros abre o peito, roda os ombros para dentro, expõe mais tronco ao vento e sobrecarrega o lado interno do cotovelo.'
          : 'Guiador mais estreito do que os ombros restringe a respiração, fecha a caixa torácica e obriga a compensações de punho e ombro.',
      evidence: [`Ombros do atleta: ${equipment.shouldersCm} cm`, `Guiador montado: ${barRule.mountedWidthMm} mm`],
      source: 'Dados do passo 1 (largura biacromial) + regra prática de fit',
    });
  }

  const crankRule = crankLengthRule({ inseamCm: equipment.inseamCm, mountedCrankMm: equipment.crankMm });
  if (crankRule.status === 'warning') {
    const shorter = crankRule.deltaMm > 0;
    items.push({
      key: 'crankLength',
      component: 'Transmissão — Comprimento do Crenque',
      direction: shorter ? 'shorten' : 'lengthen',
      status: 'warning',
      badge: shorter ? '🟡 CRENQUE LONGO PARA O SEU CAVALO' : '🟡 CRENQUE CURTO PARA O SEU CAVALO',
      action: shorter
        ? `Passar de ${crankRule.mountedCrankMm} mm para ${crankRule.recommendedMm} mm`
        : `Passar de ${crankRule.mountedCrankMm} mm para ${crankRule.recommendedMm} mm`,
      whatToDo: `O crenque montado (${crankRule.mountedCrankMm} mm) está fora da faixa do seu cavalo (${equipment.inseamCm} cm → ${crankRule.recommendedMm} mm). ${shorter ? 'Crenques mais curtos abrem o joelho e a anca.' : 'Crenques mais longos dão mais alavanca, mas fecham o joelho e a anca.'}`,
      degreesInfo: `Cavalo: ${equipment.inseamCm} cm → crenque ${crankRule.recommendedMm} mm | Montado: ${crankRule.mountedCrankMm} mm (${crankRule.deltaMm > 0 ? '+' : ''}${crankRule.deltaMm} mm).`,
      why: 'O comprimento do crenque muda diretamente a extensão do joelho no ponto morto inferior e o fecho da anca no ponto morto superior — é a peça que mais mexe nos ângulos medidos.',
      harmDone:
        shorter
          ? 'Crenque longo obriga a esticar mais o joelho no ponto morto inferior (mais oscilação da bacia) e fecha a anca no ponto morto superior.'
          : 'Crenque curto reduz a alavanca e pode forçar cadências altas para manter a potência.',
      evidence: [`Cavalo do atleta: ${equipment.inseamCm} cm`, `Crenque montado: ${crankRule.mountedCrankMm} mm`],
      source: 'Dados do passo 1 (cavalo) + faixas convencionais 165/170/172,5/175 mm',
    });
  }

  const barShape = barShapeReading({
    barReachMm: equipment.barReachMm,
    barDropMm: equipment.barDropMm,
    trunkAngle,
    trunkTarget,
  });
  if (barShape && barShape.suggestsCompactBar) {
    items.push({
      key: 'handlebarShape',
      component: 'Guiador — Reach/Drop (forma da curva)',
      direction: 'compact',
      status: 'warning',
      badge: '🟡 CURVA DO GUIADOR ASSENTA MAL',
      action: `Considerar guiador compacto (drop ${barShape.compactRangeMm[0]}–${barShape.compactRangeMm[1]} mm)`,
      whatToDo: `Com o tronco acima do alvo e um drop profundo (${barShape.dropMm} mm), a correção natural é um guiador de curva mais compacta — e não encurtar o avanço, que mexe no alcance (reach do guiador: ${barShape.reachMm ?? '—'} mm).`,
      degreesInfo: `Guiador montado: ${barShape.text} | Tronco medido acima do alvo (${trunkAngle}° > ${trunkTarget?.[1]}°).`,
      why: 'O drop do guiador define o quão baixo o atleta consegue descer sem fechar a respiração; um drop profundo com tronco alto indica que a altura certa não está a ser usada.',
      harmDone: 'Manter um drop que o atleta não usa deixa-o sempre na parte superior do guiador: paga o peso do guiador e nunca aproveita o perfil baixo.',
      evidence: [`Drop montado: ${barShape.dropMm} mm`, `Tronco: ${trunkAngle}°`],
      source: 'Dados do passo 1 (reach/drop do guiador) + ângulo do tronco medido',
    });
  }

  return items;
}

/**
 * Notas de contexto (não são ordens): o que ficou por verificar e o que é descritivo.
 */
export function buildEquipmentNotices(equipment = {}, { trunkAngle, trunkTarget } = {}) {
  const notices = [];
  const barRule = handlebarWidthRule({
    shouldersCm: equipment.shouldersCm,
    ridingStyle: equipment.ridingStyle,
    mountedWidthMm: equipment.handlebarWidthMm,
  });

  if (barRule.status === 'convention') {
    notices.push(
      `Largura do guiador em MTB: a referência é a convenção de guiador plano (${barRule.recommendedRangeMm[0]}–${barRule.recommendedRangeMm[1]} mm), não a largura biacromial — sem alvo único para comparar.`
    );
  } else if (barRule.status === 'unknown' && barRule.recommendedMm !== null) {
    notices.push(
      `Largura de guiador recomendada pelos seus ombros (${barRule.recommendedMm} mm): falta a largura do guiador montado para comparar.`
    );
  }
  if (equipment.shouldersCm === null) {
    notices.push('Sem largura de ombros (passo 1) não há como validar a largura do guiador recomendada.');
  }
  if (equipment.inseamCm === null) {
    notices.push('Sem altura do cavalo (passo 1) não há faixa de crenque para comparar com o montado.');
  }

  const barShape = barShapeReading({
    barReachMm: equipment.barReachMm,
    barDropMm: equipment.barDropMm,
    trunkAngle,
    trunkTarget,
  });
  if (barShape) {
    notices.push(`Guiador montado (do passo 1): ${barShape.text}. Reach e drop são descritivos — não têm alvo universal.`);
  }

  // Tubo superior (ETT): o comprimento do quadro que o atleta sente nas mãos. Descritivo, mas
  // conta: sem ele, uma ordem de avanço parece não ter relação com o quadro que lá está.
  const cockpit = cockpitReading({
    topTubeMm: equipment.topTubeMm,
    stemMm: equipment.stemMm,
    barReachMm: equipment.barReachMm,
    ridingStyle: equipment.ridingStyle,
  });
  if (cockpit) {
    notices.push(
      `Cockpit (do passo 1): ${cockpit.text}.` +
        (cockpit.withinTypical === true
          ? ` O tubo superior lido está na faixa habitual de ${cockpit.typicalRangeMm[0]}–${cockpit.typicalRangeMm[1]} mm para esta modalidade.`
          : cockpit.withinTypical === false
            ? ` O tubo superior lido está fora da faixa habitual (${cockpit.typicalRangeMm[0]}–${cockpit.typicalRangeMm[1]} mm para esta modalidade) — confirmar a medição antes de mexer no avanço.`
            : '') +
        ' O tubo superior é descritivo (compara-se de quadro para quadro), mas entra como contexto do alcance.'
    );
  }

  // Guiador mais largo do que os ombros: além da tolerância, o desvio é dito mesmo quando ainda
  // não justifica uma compra imediata (entre 10 e 20 mm).
  if (barRule.status === 'warning' || barRule.status === 'note') {
    notices.push(
      `Largura do guiador: o montado (${
        barRule.mountedWidthMm
      } mm) é ${barRule.comparison}. ${barRule.status === 'warning' ? 'Acima da tolerância de ±10 mm: planear a troca.' : 'Dentro da tolerância, mas acima da largura exata: preferir o guiador recomendado na próxima troca.'}`
    );
  }

  const frameRule = frameSizeRule({ inseamCm: equipment.inseamCm, frameSizeCm: equipment.frameSizeCm });
  if (frameRule.counts) {
    notices.push(
      `Tamanho do quadro: ${frameRule.frameCm} cm vs ${frameRule.estimatedCm} cm estimados para o cavalo (${frameRule.deltaCm > 0 ? '+' : ''}${
        frameRule.deltaCm
      } cm, tolerância ±${frameRule.toleranceCm} cm). ${
        frameRule.status === 'long'
          ? 'O quadro é o lado comprido do cockpit: parte de um avanço mais curto resolve o alcance sem mexer no recuo do selim.'
          : 'O quadro é o lado curto: parte do alcance tem de vir do avanço, o que estreita a distância entre pernas e cames.'
      } Este dado entra como contexto do alcance no resumo técnico.`
    );
  } else if (frameRule.status === 'unknown' && frameRule.estimatedCm !== null) {
    notices.push(
      `Tamanho de quadro estimado para o seu cavalo: ${frameRule.estimatedCm} cm (falta o tamanho do quadro montado para comparar).`
    );
  }

  if (equipment.cleatPosition) {
    const cleatLabels = {
      rearward: 'recuados (posição posterior)',
      neutral: 'neutros (posição central)',
      forward: 'avançados (posição anterior)',
    };
    const cleatLabel = cleatLabels[equipment.cleatPosition] || equipment.cleatPosition;
    notices.push(
      `Travessões / Cleats: registados como ${cleatLabel}. Esta referência é considerada na análise biomecânica do tornozelo.`
    );
  }

  return notices;
}

export default {
  resolveEquipment,
  handlebarWidthRule,
  crankLengthRule,
  frameSizeRule,
  cockpitReading,
  describeSaddleTarget,
  describeStemTarget,
  barShapeReading,
  buildEquipmentPrescriptions,
  buildEquipmentNotices,
};
