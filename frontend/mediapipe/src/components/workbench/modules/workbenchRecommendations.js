/**
 * Recomendações da Bancada DirectML (WorkbenchRecommendations).
 *
 * PORQUÊ ESTE FICHEIRO:
 * A bancada mostrava três cartões fixos (selim, cockpit, "dinâmica") escritos à mão, sem tocar nos
 * dados que o atleta introduziu no passo 1 e sem tocar em avanço, travessões, guiador, crenque e
 * tamanho da bike. A bancada via os ângulos, mas não via a BICICLETA.
 *
 * Aqui a bancada passa a produzir um diagnóstico completo e coerente com o resto da aplicação:
 *  1. **Altura do selim** — extensão do joelho no BDC contra o alvo da postura/modalidade, com
 *     desvio em mm (2,4 mm por grau, a mesma conversão do motor coerente) e alvo ABSOLUTO em cm.
 *  2. **Avanço (reach do cockpit)** — ângulo do cotovelo contra o alvo ergonómico, com o avanço
 *     montado a dar o alvo absoluto em mm e a faixa publicada para aquele tamanho de quadro.
 *  3. **Guiador** — largura contra a largura biacromial E forma da curva (reach/drop) contra as
 *     referências publicadas por tipo de guiador.
 *  4. **Travessões / cleats** — recuo de referência pelo número de sapato e posição declarada.
 *  5. **Crenque** — comprimento montado contra a faixa do cavalo.
 *  6. **Tamanho da bike vs tamanho da pessoa** — tabelas publicadas pelos fabricantes (altura do
 *     atleta → tamanho) e comparação com o tamanho declarado.
 *  7. **Cockpit (alcance total)** — ETT + avanço + reach do guiador: mostra de ONDE vem o alcance
 *     antes de se mexer no avanço.
 *
 * REGRAS DE HONESTIDADE (iguais às do resto do programa):
 *  - Sem dado não há número: o cartão diz o que falta em vez de inventar um alvo.
 *  - Cada cartão declara a evidência (o que foi medido/declarado) e a FONTE da regra.
 *  - Uma peça tem uma só direção: os cartões não contradizem as ordens do motor de fotos/vídeo.
 */

import AthleteProfile from '../../LiveCameraCapture/modules/athleteProfile.js';
import {
  barShapeReading,
  buildEquipmentNotices,
  cockpitReading,
  crankLengthRule,
  describeSaddleTarget,
  describeStemTarget,
  frameSizeRule,
  handlebarWidthRule,
  resolveEquipment,
} from '../../LiveCameraCapture/modules/equipmentFitRules.js';
import { DEFAULT_POSTURE, resolveTargets } from '../../LiveCameraCapture/modules/postureMode.js';
import { loadProfiles } from '../../AthleteOnboarding/modules/athleteProfiles.js';
import { compareBikeToRider } from './bikeSizeGuide.js';
import { BAR_WIDTH_STEP_MM, classifyBar, compactBarAdvice, stemRangeForFrameSize } from './componentReference.js';

/** Chave onde o LiveCameraCapture guarda a antropometria (peso/sapato/cintura/altura/costura). */
export const ANTHROPOMETRY_STORAGE_KEY = 'athleteMotion.athleteProfile';
/** Conversão prática grau → mm na altura do selim (a mesma do motor coerente das fotos). */
export const MM_PER_KNEE_DEGREE = 2.4;
/** Limites do desvio em mm da altura do selim (evita ordens absurdas por um pico de medição). */
export const SADDLE_DELTA_LIMITS_MM = [3, 25];
/** Desvio do avanço quando o cockpit está comprido / curto (mm) — convenção do motor coerente. */
export const STEM_DELTA_MM = { shorten: -15, lengthen: 10 };

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const round1 = (value) => Math.round(value * 10) / 10;

/** Onde está a medição relativamente à faixa alvo. */
export function bandPosition(value, band) {
  const measured = toNumber(value);
  if (measured === null || !Array.isArray(band)) return null;
  if (measured < band[0]) return 'below';
  if (measured > band[1]) return 'above';
  return 'within';
}

/** Formulário do passo 1 (snake_case) → entrada esperada pelo AthleteProfile (camelCase). */
export function toAthleteProfileInput(form = {}) {
  return {
    weightKg: form.weight_kg,
    shoeSizeEu: form.shoe_size_eu,
    waistCm: form.waist_cm,
    heightCm: form.height_cm,
    inseamCm: form.inseam_cm,
    cleatPosition: form.cleat_position || null,
  };
}

/**
 * Dados do atleta/bicicleta para a bancada, sem nova interrogação ao utilizador.
 *
 * Ordem de preferência:
 *  1. Perfil do passo 1 guardado localmente (o mais recente) — tem TODOS os campos, incluindo os da
 *     bicicleta (avanço, guiador, crenque, quadro, tubo superior, cleats).
 *  2. Antropometria guardada pelo módulo de vídeo (`athleteMotion.athleteProfile`) — só o corpo.
 *
 * @param {Storage|undefined} storage
 * @returns {{ form:Object, source:string, sourceLabel:string, hasBikeData:boolean }}
 */
export function loadWorkbenchAthleteForm(storage = typeof window !== 'undefined' ? window.localStorage : undefined) {
  const empty = { form: {}, source: 'none', sourceLabel: 'Sem dados do atleta', hasBikeData: false };
  if (!storage) return empty;

  try {
    const profiles = loadProfiles(storage) || [];
    if (profiles.length) {
      const latest = [...profiles].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
      if (latest) {
        const hasBikeData = [
          latest.current_saddle_height_cm,
          latest.handlebar_width_mm,
          latest.stem_length_mm,
          latest.crank_length_mm,
          latest.frame_size_cm,
          latest.top_tube_mm,
        ].some((value) => toNumber(value) !== null);
        return {
          form: { ...latest },
          source: 'onboarding-profile',
          sourceLabel: latest.name ? `perfil «${latest.name}» (passo 1)` : 'perfil do passo 1',
          hasBikeData,
        };
      }
    }
  } catch {
    // Perfis corrompidos ou armazenamento bloqueado: segue para a antropometria, sem partir a bancada.
  }

  try {
    const raw = storage.getItem(ANTHROPOMETRY_STORAGE_KEY);
    if (raw) {
      const normalized = AthleteProfile.normalize(JSON.parse(raw));
      const hasBody = [normalized.heightCm, normalized.inseamCm].some((v) => v !== null);
      if (hasBody || normalized.weightKg !== null) {
        return {
          form: {
            weight_kg: normalized.weightKg,
            shoe_size_eu: normalized.shoeSizeEu,
            waist_cm: normalized.waistCm,
            height_cm: normalized.heightCm,
            inseam_cm: normalized.inseamCm,
            cleat_position: normalized.cleatPosition,
          },
          source: 'anthropometry',
          sourceLabel: 'antropometria guardada (peso/sapato/altura/costura)',
          hasBikeData: false,
        };
      }
    }
  } catch {
    // Ignorado: fica sem dados e a bancada diz o que falta.
  }

  return empty;
}

/**
 * Cartão 1 — ALTURA DO SELIM (extensão do joelho no BDC).
 */
function buildSaddleCard({ kneeAngle, form, targets, equipment }) {
  const band = targets.knee || [145, 155];
  const [minKnee, maxKnee] = band;
  const position = bandPosition(kneeAngle, band);
  const base = {
    key: 'saddle',
    icon: '🚲',
    title: 'Altura do Selim',
    component: 'Altura do Selim (joelho no BDC)',
    measuredText: kneeAngle === null ? '--' : `${round1(kneeAngle)}°`,
    measuredLabel: 'Extensão média do joelho medida no ponto morto inferior',
    targetText: `Alvo BDC: ${minKnee}°–${maxKnee}°`,
    evidence: [`Extensão média do joelho: ${kneeAngle === null ? 'sem amostras' : `${round1(kneeAngle)}°`}`],
    source: 'Holmes (estático: 25–35° de flexão) · dinâmica de pedalada ativa',
  };

  if (position === null) {
    return {
      ...base,
      status: 'missing',
      badge: '⏳ Sem amostras',
      action: 'Falta a extensão do joelho no BDC: reproduza o vídeo com o pedal no fundo (6h) visível para recolher amostras.',
      why: 'A altura do selim só se mede no ponto morto inferior: é aí que a extensão do joelho é máxima.',
      harm: '',
    };
  }

  const lem = AthleteProfile.saddleHeightFromInseam(toAthleteProfileInput(form));
  const lemondNote = lem
    ? ` Cruzamento com a fórmula de partida (LeMond, cavalo × 0,883): ≈ ${lem.cm} cm do eixo do pedal ao topo do selim${lem.estimatedFromHeight ? ' — atenção, o cavalo foi estimado da altura (× 0,47)' : ''}.`
    : ' Sem cavalo (passo 1) não há cruzamento com a fórmula de LeMond: a decisão fica só na medição angular.';

  if (position === 'within') {
    return {
      ...base,
      status: 'ok',
      badge: '✅ NO ALVO',
      action: 'Manter a altura do selim — não mexer.',
      why: `A extensão média de ${round1(kneeAngle)}° está dentro de ${minKnee}°–${maxKnee}°: a perna estende sem esticar e a bacia não precisa de oscilar para alcançar o pedal.${lemondNote}`,
      harm: 'Mexer num selim já no alvo introduz um erro onde não existia.',
    };
  }

  const raising = position === 'below';
  const degrees = raising ? minKnee - kneeAngle : kneeAngle - maxKnee;
  const magnitude = Math.min(
    SADDLE_DELTA_LIMITS_MM[1],
    Math.max(SADDLE_DELTA_LIMITS_MM[0], Math.round(degrees * MM_PER_KNEE_DEGREE))
  );
  const deltaMm = raising ? magnitude : -magnitude;
  const absolute = describeSaddleTarget({
    currentSaddleHeightCm: equipment.saddleHeightCm,
    deltaMm,
  });
  const severe = degrees > 12;

  return {
    ...base,
    status: severe ? 'danger' : 'warning',
    badge: raising ? (severe ? '🔴 SELIM MUITO BAIXO' : '🟡 SELIM BAIXO') : severe ? '🔴 SELIM MUITO ALTO' : '🟡 SELIM ALTO',
    action: raising
      ? `Subir o selim ${magnitude} mm${absolute && absolute.text ? ` — ${absolute.text}` : ''}.`
      : `Descer o selim ${magnitude} mm${absolute && absolute.text ? ` — ${absolute.text}` : ''}.`,
    why: raising
      ? 'Elevar o selim estica a perna no ponto morto inferior, recruta os glúteos e reduz a compressão da rótula.'
      : 'Baixar o selim devolve estabilidade à bacia e elimina a necessidade de esticar a ponta do pé para alcançar o pedal.',
    harm: raising
      ? 'Compressão patelofemoral e tendinopatia rotuliana por flexão excessiva do joelho.'
      : 'Oscilação lateral da bacia, tendinopatia de Aquiles e sobrecarga dos isquiotibiais.',
    evidence: [
      ...base.evidence,
      `${round1(degrees)}° fora do alvo ${raising ? 'inferior' : 'superior'}`,
      `Conversão aplicada: ${MM_PER_KNEE_DEGREE} mm por grau`,
    ],
    absoluteTargetCm: absolute ? absolute.targetCm : null,
    deltaMm,
    extraNote: lemondNote.trim(),
  };
}

/**
 * Cartão 2 — AVANÇO / REACH DO COCKPIT (ângulo do cotovelo, com o tronco como contexto).
 */
function buildStemCard({ elbowAngle, torsoAngle, targets, equipment }) {
  const band = targets.elbow || [150, 165];
  const [minElbow, maxElbow] = band;
  const position = bandPosition(elbowAngle, band);
  const stemRange = stemRangeForFrameSize(equipment.frameSizeCm);
  const stemRangeNote = stemRange
    ? ` Faixa publicada para um quadro de ${equipment.frameSizeCm} cm: avanço ${stemRange.text}.`
    : '';

  const base = {
    key: 'stem',
    icon: '📐',
    title: 'Avanço (comprimento do cockpit)',
    component: 'Cockpit — Reach (avanço)',
    measuredText: elbowAngle === null ? '--' : `${round1(elbowAngle)}°`,
    measuredLabel: 'Flexão média do cotovelo (ombro–cotovelo–pulso)',
    targetText: `Alvo do cotovelo: ${minElbow}°–${maxElbow}°`,
    evidence: [
      `Ângulo médio do cotovelo: ${elbowAngle === null ? 'sem amostras' : `${round1(elbowAngle)}°`}`,
      torsoAngle === null ? 'Tronco: sem amostras' : `Tronco medido: ${round1(torsoAngle)}°`,
    ],
    source: 'Ângulo do cotovelo (motor coerente) + faixas de avanço por tamanho de quadro (MyVeloFit)',
  };

  if (position === null) {
    return {
      ...base,
      status: 'missing',
      badge: '⏳ Sem amostras',
      action: 'Falta o ângulo do cotovelo: reproduza o vídeo numa vista lateral (90°) para o medir.',
      why: 'O comprimento do avanço lê-se no cotovelo: braços esticados indicam cockpit comprido, cotovelos muito fechados indicam cockpit curto.',
      harm: '',
    };
  }

  if (position === 'within') {
    return {
      ...base,
      status: 'ok',
      badge: '✅ NO ALVO',
      action: `Manter o avanço${equipment.stemMm !== null ? ` de ${equipment.stemMm} mm` : ''} — não mexer.`,
      why: `O cotovelo médio de ${round1(elbowAngle)}° está dentro de ${minElbow}°–${maxElbow}°: há flexão para amortece sem bloquear os braços.${stemRangeNote}`,
      harm: 'Alterar um cockpit já no alvo muda o peso nas mãos e a direção sem benefício.',
    };
  }

  const shortening = position === 'above';
  const deltaMm = shortening ? STEM_DELTA_MM.shorten : STEM_DELTA_MM.lengthen;
  const absolute = describeStemTarget({ currentStemMm: equipment.stemMm, deltaMm });
  const torsoNote =
    torsoAngle === null
      ? ''
      : ` O tronco mede ${round1(torsoAngle)}° (alvo ${Array.isArray(targets.back) ? `${targets.back[0]}–${targets.back[1]}°` : 'descritivo'}): ${
          Array.isArray(targets.back) && torsoAngle > targets.back[1]
            ? 'está mais erecto do que o alvo — parte do "alcance" pode ser altura do guiador (espaçadores), não avanço.'
            : Array.isArray(targets.back) && torsoAngle < targets.back[0]
              ? 'está mais deitado do que o alvo — a aerodinâmica está a ser paga com carga nos braços e no períneo.'
              : 'está alinhado com o alvo.'
        }`;

  return {
    ...base,
    status: 'warning',
    badge: shortening ? '🟡 COCKPIT COMPRIDO' : '🟡 COCKPIT CURTO',
    action: shortening
      ? `Encurtar o avanço ${Math.abs(deltaMm)} mm${absolute && absolute.text ? ` — ${absolute.text}` : ''}.`
      : `Alongar o avanço ${deltaMm} mm${absolute && absolute.text ? ` — ${absolute.text}` : ''}.`,
    why: shortening
      ? 'Encurtar o cockpit permite fechar o cotovelo sem esticar os braços, desarmando o bloqueio ósseo do membro superior.'
      : 'Alongar o cockpit dá espaço para os joelhos subirem entre os braços e evita roçar nos cotovelos.',
    harm: shortening
      ? 'Compressão do nervo ulnar/mediano com dormência nas mãos (paralisia do ciclista) e ombros a subir para o pescoço.'
      : 'Tensão contínua nos tríceps e roçar dos joelhos nos cotovelos ao pedalar em pé.',
    evidence: [...base.evidence, `Desvio aplicado: ${deltaMm > 0 ? '+' : ''}${deltaMm} mm`],
    deltaMm,
    absoluteTargetMm: absolute ? absolute.targetMm : null,
    extraNote: (torsoNote + stemRangeNote).trim(),
  };
}

/**
 * Cartão 3 — GUIADOR (largura contra a biacromial + forma da curva).
 */
function buildHandlebarCard({ torsoAngle, targets, equipment }) {
  const widthRule = handlebarWidthRule({
    shouldersCm: equipment.shouldersCm,
    ridingStyle: equipment.ridingStyle,
    mountedWidthMm: equipment.handlebarWidthMm,
  });
  const barRead = barShapeReading({
    barReachMm: equipment.barReachMm,
    barDropMm: equipment.barDropMm,
    trunkAngle: torsoAngle,
    trunkTarget: targets.back,
  });
  const shape = classifyBar({
    barReachMm: equipment.barReachMm,
    barDropMm: equipment.barDropMm,
    trunkAngle: torsoAngle,
    trunkTarget: targets.back,
  });
  const compact = compactBarAdvice();

  const evidence = [];
  if (widthRule.mountedWidthMm !== null) evidence.push(`Guiador montado: ${widthRule.mountedWidthMm} mm`);
  if (widthRule.recommendedMm !== null) evidence.push(`Largura biacromial: ${equipment.shouldersCm} cm → ${widthRule.recommendedMm} mm`);
  if (shape) evidence.push(`Curva montada: ${shape.text}${shape.typeLabel ? ` (${shape.typeLabel})` : ''}`);

  const card = {
    key: 'handlebar',
    icon: '🚴',
    title: 'Guiador (largura, reach e drop)',
    component: 'Guiador — largura e forma da curva',
    measuredText: widthRule.mountedWidthMm === null ? '--' : `${widthRule.mountedWidthMm} mm`,
    measuredLabel: 'Largura do guiador montado',
    targetText:
      widthRule.recommendedMm !== null
        ? `Alvo de largura: ${widthRule.recommendedMm} mm (±10 mm)`
        : widthRule.recommendedRangeMm
          ? `Largura em MTB: convenção ${widthRule.recommendedRangeMm[0]}–${widthRule.recommendedRangeMm[1]} mm (não biacromial)`
          : 'Sem largura biacromial no passo 1',
    evidence,
    source: 'Largura biacromial (passo 1) · curvas publicadas FSA/Zipp/Ritchey/Easton · Steve Hogg',
  };

  // Sem ombros e sem curva declarada não há nada para comparar.
  if (widthRule.status === 'unknown' && !shape) {
    return {
      ...card,
      status: 'missing',
      badge: '⏳ Faltam dados',
      action: 'Falta a largura biacromial (passo 1) e a largura/reach/drop do guiador montado.',
      why: 'Sem estes valores não há comparação: a largura do guiador mede-se contra os ombros e a curva contra a postura medida.',
      harm: '',
    };
  }

  if (widthRule.status === 'danger' || widthRule.status === 'warning') {
    const wider = widthRule.deltaMm > 0;
    return {
      ...card,
      status: widthRule.status === 'danger' ? 'danger' : 'warning',
      badge: widthRule.status === 'danger' ? '🔴 LARGURA ERRADA' : '🟡 LARGURA FORA DO ALVO',
      action: `Trocar por um guiador de ${widthRule.recommendedMm} mm (${barRead && barRead.suggestsCompactBar ? `curva compacta, ${compact.rangeText}` : 'mesma curva'}).`,
      why: `O guiador montado é ${wider ? 'MAIS LARGO' : 'mais estreito'} do que os ombros em ${Math.abs(widthRule.deltaMm)} mm (um passo comercial é ${BAR_WIDTH_STEP_MM} mm). Um guiador demasiado largo abre o peito e trava a respiração; demasiado estreito fecha as vias respiratórias e desalinha os pulsos.`,
      harm: wider
        ? 'Respiração travada, tensão entre as omoplatas e maior área frontal.'
        : 'Aperto do peito, cotovelos a saltar para fora e perda de controlo nas descidas.',
      evidence: [...evidence, `Desvio: ${widthRule.deltaMm > 0 ? '+' : ''}${widthRule.deltaMm} mm`],
      deltaMm: widthRule.deltaMm,
    };
  }

  if (barRead && barRead.suggestsCompactBar) {
    return {
      ...card,
      status: 'warning',
      badge: '🟡 CURVA DO GUIADOR ASSENTA MAL',
      action: `Estudar um guiador compacto (${compact.rangeText}) antes de mexer no avanço.`,
      why: `O guiador montado tem drop profundo (${shape.dropMm} mm) e o tronco mede acima do alvo: o atleta paga um guiador de perfil baixo que não usa. A correção natural é a curva — mexer no avanço altera o alcance de todo o cockpit.`,
      harm: 'Andar sempre nos manetes com um guiador fundo é peso e rigidez pagos sem uso.',
      evidence,
      typeLabel: shape.typeLabel,
    };
  }

  if (shape && shape.reachOutOfTypicalRange) {
    return {
      ...card,
      status: 'attention',
      badge: '🔵 CURVA FORA DO COMUM',
      action: 'Confirmar a medição do reach do guiador e comparar com a ficha do modelo.',
      why: `O reach declarado (${shape.reachMm} mm) sai da faixa publicada para guiadores de estrada/gravel (~70–90 mm). ${shape.typeRangeText ? `A curva ${shape.typeLabel} típica tem ${shape.typeRangeText}.` : ''} Reach muito curto e muito comprido mudam o alcance total do cockpit, que é a soma com o quadro e o avanço.`,
      harm: 'Um erro de medição aqui propaga-se a toda a decisão de avanço.',
      evidence,
      typeLabel: shape.typeLabel,
    };
  }

  return {
    ...card,
    status: 'ok',
    badge: '✅ COERENTE',
    action: 'Manter o guiador.',
    why: [
      widthRule.status === 'ok'
        ? `A largura (${widthRule.mountedWidthMm} mm) é coerente com os ombros.`
        : widthRule.status === 'convention'
          ? `Em MTB, a largura ${widthRule.mountedWidthMm ?? '--'} mm é julgada pela convenção ${widthRule.recommendedRangeMm?.[0]}–${widthRule.recommendedRangeMm?.[1]} mm e não pela biacromial.`
          : widthRule.status === 'note'
            ? `A largura está dentro da tolerância, mas não é a largura exata recomendada pelos ombros (${widthRule.recommendedMm} mm) — preferir essa na próxima troca.`
            : 'Sem largura de guiador declarada para comparar.',
      shape ? `A curva montada (${shape.text}) é do tipo «${shape.typeLabel}»: ${shape.typeRangeText}.` : 'Sem reach/drop declarados: a curva não foi avaliada.',
    ].join(' '),
    harm: '',
    typeLabel: shape ? shape.typeLabel : null,
  };
}

/**
 * Cartão 4 — TRAVESSÕES / CLEATS (recuo pelo número de sapato + posição declarada).
 */
function buildCleatCard({ ankleAngle, form, targets }) {
  const profile = AthleteProfile.normalize(toAthleteProfileInput(form));
  const setback = profile.shoeSizeEu === null ? null : AthleteProfile.cleatSetbackForShoeSize(profile.shoeSizeEu);
  const labels = { rearward: 'recuados (atrás)', neutral: 'neutros (centro)', forward: 'avançados (à frente)' };
  const positionLabel = profile.cleatPosition ? labels[profile.cleatPosition] || profile.cleatPosition : null;
  const ankleBand = targets.ankle || null;
  const anklePosition = bandPosition(ankleAngle, ankleBand);

  const evidence = [];
  if (profile.shoeSizeEu !== null) evidence.push(`Número de sapato: ${profile.shoeSizeEu} EU`);
  if (setback) evidence.push(`Recuo de referência da faixa ${setback.band}: ${setback.min}–${setback.max} mm à frente do eixo do pedal`);
  if (positionLabel) evidence.push(`Posição declarada no passo 1: ${positionLabel}`);
  if (ankleAngle !== null) evidence.push(`Ângulo médio do tornozelo: ${round1(ankleAngle)}°${ankleBand ? ` (alvo ${ankleBand[0]}–${ankleBand[1]}°)` : ''}`);

  const card = {
    key: 'cleats',
    icon: '👟',
    title: 'Travessões / Cleats',
    component: 'Transmissão — Travessões (cleats)',
    measuredText: positionLabel ? positionLabel : '--',
    measuredLabel: 'Posição dos travessões declarada no passo 1',
    targetText: setback ? `Recuo de partida para a faixa ${setback.band}: ${setback.min}–${setback.max} mm` : 'Sem número de sapato para dar recuo de referência',
    evidence,
    source: 'Steve Hogg / MyVeloFit (posição de travessões por tamanho de sapato)',
  };

  if (profile.shoeSizeEu === null && !positionLabel) {
    return {
      ...card,
      status: 'missing',
      badge: '⏳ Faltam dados',
      action: 'Falta o número de sapato (passo 1) para dar o recuo de referência dos travessões.',
      why: 'O recuo do travessão depende do comprimento do pé: é a distância com que o 1.º metatarso fica à frente do eixo do pedal.',
      harm: '',
    };
  }

  const ankleWarning = anklePosition && anklePosition !== 'within';
  const actions = [];
  if (setback) {
    actions.push(
      `Confirmar o recuo: centro do 1.º metatarso ${setback.min}–${setback.max} mm à frente do eixo do pedal, com o sapato nivelado e o eixo do pedal mais de 10 mm atrás do 1.º metatarso.`
    );
  }
  if (profile.cleatPosition === 'rearward') {
    actions.push('Travessões já recuados: não recuar mais sem reavaliar a altura do selim (o recuo encurta o alcance ao pedal).');
  } else if (profile.cleatPosition === 'forward') {
    actions.push('Travessões avançados: se houver sobrecarga dos gémeos ou calcanhar descaído, recuar 2–5 mm.');
  } else if (profile.cleatPosition === 'neutral') {
    actions.push('Posição neutra: há margem para ajustes finos de 2–5 mm em qualquer sentido.');
  }
  if (ankleWarning) {
    actions.push(
      anklePosition === 'below'
        ? `Tornozelo médio em ${round1(ankleAngle)}°, abaixo do alvo ${ankleBand[0]}–${ankleBand[1]}°: pé em ponta, o que aumenta a distância efetiva ao pedal — verificar se o selim não está alto antes de mexer no travessão.`
        : `Tornozelo médio em ${round1(ankleAngle)}°, acima do alvo ${ankleBand[0]}–${ankleBand[1]}°: calcanhar descaído, típico de travessão demasiado recuado ou selim baixo.`
    );
  }
  if (!actions.length) {
    actions.push('Sem dados suficientes para um ajuste: medir o recuo do travessão diretamente no sapato.');
  }

  return {
    ...card,
    status: ankleWarning ? 'warning' : 'attention',
    badge: ankleWarning ? '🟡 TORNOZELO FORA DO ALVO' : '🔵 CONFIRMAR NO SAPATO',
    action: actions.join(' '),
    why: 'A posição do travessão define o braço de alavanca do tornozelo e o alcance real ao pedal: mexer no travessão para trás obriga a reavaliar a altura do selim. Nenhuma regra angular desta análise é alterada pelo travessão — o que muda é a leitura do tornozelo.',
    harm: ankleWarning
      ? 'Sobrecarga do tendão de Aquiles e dos gémeos (calcanhar descaído) ou dor plantar por pé sempre em ponta.'
      : 'Sem ajuste correto, a potência é transmitida fora do eixo do metatarso, com perda de eficiência e pressão no arco plantar.',
    advice: actions,
  };
}

/**
 * Cartão 5 — CRENQUE (comprimento montado contra a faixa do cavalo).
 */
function buildCrankCard({ kneeAngle, equipment }) {
  const rule = crankLengthRule({ inseamCm: equipment.inseamCm, mountedCrankMm: equipment.crankMm });
  const evidence = [];
  if (equipment.inseamCm !== null) evidence.push(`Cavalo (passo 1): ${equipment.inseamCm} cm`);
  if (rule.mountedCrankMm !== null) evidence.push(`Crenque montado: ${rule.mountedCrankMm} mm`);
  if (rule.recommendedMm !== null) evidence.push(`Faixa do cavalo: ${rule.recommendedMm} mm`);
  if (kneeAngle !== null) evidence.push(`Extensão média do joelho: ${round1(kneeAngle)}°`);

  const card = {
    key: 'crank',
    icon: '⚙️',
    title: 'Crenque (comprimento)',
    component: 'Transmissão — Comprimento do Crenque',
    measuredText: rule.mountedCrankMm === null ? '--' : `${rule.mountedCrankMm} mm`,
    measuredLabel: 'Comprimento do crenque montado',
    targetText: rule.recommendedMm === null ? 'Sem cavalo no passo 1' : `Faixa do cavalo: ${rule.recommendedMm} mm`,
    evidence,
    source: 'Faixas convencionais 165 / 170 / 172,5 / 175 mm por cavalo (ajuda do passo 1)',
  };

  if (rule.status === 'unknown') {
    return {
      ...card,
      status: 'missing',
      badge: '⏳ Faltam dados',
      action:
        rule.recommendedMm === null
          ? 'Falta a altura do cavalo (passo 1) para saber a faixa de crenque.'
          : `Falta o comprimento do crenque montado (passo 1). A faixa para o seu cavalo é ${rule.recommendedMm} mm.`,
      why: 'O crenque é a peça que mais mexe nos ângulos medidos: muda a extensão do joelho no ponto morto inferior e o fecho da anca no superior.',
      harm: '',
    };
  }

  if (rule.status === 'ok') {
    return {
      ...card,
      status: 'ok',
      badge: '✅ NO ALVO',
      action: `Manter o crenque de ${rule.mountedCrankMm} mm.`,
      why: `O crenque montado está exatamente na faixa do seu cavalo (${rule.recommendedMm} mm): a extensão do joelho e o fecho da anca medidos são consequência da altura do selim, não do crenque.`,
      harm: '',
    };
  }

  const tooLong = rule.deltaMm > 0;
  return {
    ...card,
    status: 'warning',
    badge: tooLong ? '🟡 CRENQUE LONGO PARA O CAVALO' : '🟡 CRENQUE CURTO PARA O CAVALO',
    action: `Passar de ${rule.mountedCrankMm} mm para ${rule.recommendedMm} mm (desvio de ${rule.deltaMm > 0 ? '+' : ''}${rule.deltaMm} mm).`,
    why: `O crenque montado está fora da faixa do cavalo (${equipment.inseamCm} cm → ${rule.recommendedMm} mm). ${
      tooLong
        ? 'Um crenque mais longo obriga a esticar mais o joelho no ponto morto inferior e fecha a anca no ponto morto superior — agrava exatamente o que a altura do selim corrige.'
        : 'Um crenque curto reduz a alavanca e obriga a cadências mais altas para manter a potência.'
    }`,
    harm: tooLong
      ? 'Oscilação da bacia e compressão anterior do joelho no ponto morto superior.'
      : 'Perda de alavanca e fadiga precoce dos gémeos.',
    evidence,
    deltaMm: rule.deltaMm,
  };
}

/**
 * Cartão 6 — TAMANHO DA BIKE vs TAMANHO DA PESSOA.
 */
function buildBikeSizeCard({ form, equipment, ridingStyle }) {
  const height = toNumber(form.height_cm);
  const comparison = compareBikeToRider({
    heightCm: height,
    frameSizeCm: equipment.frameSizeCm,
    ridingStyle,
    brandModel: form.brand_model,
  });
  const formula = frameSizeRule({ inseamCm: equipment.inseamCm, frameSizeCm: equipment.frameSizeCm });

  const evidence = [];
  if (height !== null) evidence.push(`Altura do atleta (passo 1): ${height} cm`);
  if (equipment.frameSizeCm !== null) evidence.push(`Quadro montado: ${equipment.frameSizeCm} cm (tubo do selim)`);
  if (formula.estimatedCm !== null) evidence.push(`Estimativa pelo cavalo (× 0,665): ${formula.estimatedCm} cm`);
  if (form.brand_model) evidence.push(`Marca/modelo: ${form.brand_model}`);

  const formulaNote = formula.counts
    ? ` A estimativa clássica pelo cavalo (${formula.estimatedCm} cm) diz que o quadro está ${formula.deltaCm > 0 ? 'acima' : 'abaixo'} por ${Math.abs(formula.deltaCm)} cm — as duas leituras contam em conjunto, porque a fórmula usa só o cavalo e as tabelas usam a altura e a família do quadro.`
    : '';

  const statusByComparison = {
    match: 'ok',
    'too-long': 'warning',
    'too-short': 'warning',
    'height-only': 'attention',
    'label-only': 'attention',
    inconclusive: 'attention',
    'no-height': 'missing',
  };

  return {
    key: 'bikeSize',
    icon: '📏',
    title: 'Tamanho da bike vs tamanho da pessoa',
    component: 'Quadro — tamanho vs altura do atleta',
    measuredText: equipment.frameSizeCm === null ? '--' : `${equipment.frameSizeCm} cm`,
    measuredLabel: 'Tamanho do quadro (tubo do selim) declarado no passo 1',
    targetText:
      comparison.references && comparison.references.length
        ? `Faixas publicadas para ${height !== null ? `${height} cm` : 'a sua altura'}: ${[
            ...new Set(comparison.references.filter((r) => r.containsHeight).map((r) => `${r.brand} ${r.label}`)),
          ].join(' · ')}`
        : 'Sem faixas publicadas para esta modalidade',
    status: statusByComparison[comparison.status] || 'attention',
    badge:
      comparison.status === 'match'
        ? '✅ TAMANHO COERENTE'
        : comparison.status === 'too-long'
          ? '🟡 QUADRO UM TAMANHO ACIMA'
          : comparison.status === 'too-short'
            ? '🟡 QUADRO UM TAMANHO ABAIXO'
            : comparison.status === 'no-height'
              ? '⏳ FALTA A ALTURA'
              : '🔵 REFERÊNCIA PUBLICADA',
    action: comparison.headline,
    why: `${comparison.detail}${formulaNote}`,
    harm:
      comparison.status === 'too-long'
        ? 'Quadro grande demais estica o tronco de origem: dor interestelar, peso nas mãos e a ilusão de que o problema é o avanço.'
        : comparison.status === 'too-short'
          ? 'Quadro pequeno demais obriga a alongar o avanço, estreita o espaço entre pernas e cames e agrava o fecho da anca.'
          : '',
    evidence,
    source: comparison.sources.join(' · '),
    comparisonStatus: comparison.status,
    references: comparison.references.filter((r) => r.containsHeight),
  };
}

/**
 * Cartão 7 — COCKPIT (alcance total: quadro + avanço + guiador).
 */
function buildCockpitCard({ equipment, ridingStyle }) {
  const cockpit = cockpitReading({
    topTubeMm: equipment.topTubeMm,
    stemMm: equipment.stemMm,
    barReachMm: equipment.barReachMm,
    ridingStyle,
  });

  if (!cockpit) {
    return {
      key: 'cockpit',
      icon: '🧭',
      title: 'Cockpit (alcance total)',
      component: 'Cockpit — alcance total (quadro + avanço + guiador)',
      measuredText: '--',
      measuredLabel: 'Sem tubo superior, avanço ou reach do guiador declarados',
      targetText: 'Sem alvo universal (medida descritiva)',
      status: 'missing',
      badge: '⏳ Faltam dados',
      action: 'Falta o tubo superior efetivo (ETT), o avanço ou o reach do guiador no passo 1.',
      why: 'O alcance que o atleta sente nas mãos é a soma do quadro com o avanço e o reach do guiador: sem as três parcelas não se sabe de onde vem o alcance.',
      harm: '',
      evidence: [],
      source: 'Geometry Geeks / Sheldon Brown (ETT) + dados do passo 1',
    };
  }

  return {
    key: 'cockpit',
    icon: '🧭',
    title: 'Cockpit (alcance total)',
    component: 'Cockpit — alcance total (quadro + avanço + guiador)',
    measuredText: cockpit.totalMm === null ? `${cockpit.text}` : `${cockpit.totalMm} mm`,
    measuredLabel: 'Alcance do quadro ao guiador (soma das três parcelas)',
    targetText: 'Sem alvo universal — o que conta é a repartição entre quadro, avanço e guiador',
    status: cockpit.withinTypical === false ? 'attention' : 'ok',
    badge: cockpit.withinTypical === false ? '🔵 ETT FORA DO HABITUAL' : '🔵 MEDIDA DESCRITIVA',
    action: cockpit.text,
    why: `${
      cockpit.complete
        ? `O quadro contribui com ${cockpit.frameSharePct}% do alcance total.`
        : 'Alcance total incompleto: falta uma das três parcelas.'
    } Se o alcance é longo, mexer no avanço é apenas uma das alavancas — e a única que muda o peso nas mãos e a direção. ${
      cockpit.withinTypical === false
        ? `O tubo superior lido (${cockpit.topTubeMm} mm) está fora da faixa habitual da modalidade (${cockpit.typicalRangeMm[0]}–${cockpit.typicalRangeMm[1]} mm): confirmar a medição antes de decidir sobre o avanço.`
        : cockpit.withinTypical === true
          ? `O tubo superior lido está na faixa habitual da modalidade (${cockpit.typicalRangeMm[0]}–${cockpit.typicalRangeMm[1]} mm).`
          : ''
    }`,
    harm:
      cockpit.withinTypical === false
        ? 'Uma medição de ETT errada produz um avanço errado: o erro propaga-se à peça que se compra.'
        : '',
    evidence: [cockpit.text],
    source: 'Geometry Geeks (ETT) · MyVeloFit (alcance do quadro vs alcance às mãos)',
  };
}

/**
 * Constrói o diagnóstico completo da bancada.
 *
 * @param {{ measurements?:Object, form?:Object, posture?:string, ridingStyle?:string, source?:string }} params
 * @returns {{ targets:Object, equipment:Object, cards:Array, notices:Array, riderNotes:Array,
 *             profileIssues:Array, dataSource:string }}
 */
export function buildWorkbenchRecommendations({
  measurements = {},
  form = {},
  posture = DEFAULT_POSTURE,
  ridingStyle = null,
  dataSource = 'none',
} = {}) {
  const style = ridingStyle || form.riding_style || 'road';
  const targets = resolveTargets({ posture, ridingStyle: style });
  const equipment = resolveEquipment({
    athlete: {
      shoulder_width_cm: form.shoulder_width_cm,
      inseam_cm: form.inseam_cm,
      height_cm: form.height_cm,
      riding_style: style,
      cleat_position: form.cleat_position,
    },
    geometry: {
      bike_type: style,
      current_saddle_height_cm: form.current_saddle_height_cm,
      handlebar_width_mm: form.handlebar_width_mm,
      stem_length_mm: form.stem_length_mm,
      crank_length_mm: form.crank_length_mm,
      frame_size_cm: form.frame_size_cm,
      top_tube_mm: form.top_tube_mm,
      handlebar_reach_mm: form.handlebar_reach_mm,
      handlebar_drop_mm: form.handlebar_drop_mm,
      cleat_position: form.cleat_position,
    },
  });

  const knee = toNumber(measurements.knee);
  const torso = toNumber(measurements.torso);
  const elbow = toNumber(measurements.elbow);
  const ankle = toNumber(measurements.ankle);

  const cards = [
    buildSaddleCard({ kneeAngle: knee, form, targets, equipment }),
    buildStemCard({ elbowAngle: elbow, torsoAngle: torso, targets, equipment }),
    buildHandlebarCard({ torsoAngle: torso, targets, equipment }),
    buildCleatCard({ ankleAngle: ankle, form, targets }),
    buildCrankCard({ kneeAngle: knee, equipment }),
    buildBikeSizeCard({ form, equipment, ridingStyle: style }),
    buildCockpitCard({ equipment, ridingStyle: style }),
  ];

  const profile = AthleteProfile.normalize(toAthleteProfileInput(form));
  const notices = buildEquipmentNotices(equipment, { trunkAngle: torso, trunkTarget: targets.back });
  const riderNotes = AthleteProfile.describe(toAthleteProfileInput(form));

  return {
    targets,
    equipment,
    cards,
    notices,
    riderNotes,
    profileIssues: profile.issues,
    dataSource,
  };
}

/** Resumo em texto (uma linha por cartão) para copiar/exportar com o relatório. */
export function summarizeRecommendations(built = {}) {
  const cards = Array.isArray(built.cards) ? built.cards : [];
  return cards.map((card) => `[${card.badge}] ${card.title}: ${card.action}`).join('\n');
}

export default {
  ANTHROPOMETRY_STORAGE_KEY,
  MM_PER_KNEE_DEGREE,
  SADDLE_DELTA_LIMITS_MM,
  STEM_DELTA_MM,
  bandPosition,
  toAthleteProfileInput,
  loadWorkbenchAthleteForm,
  buildWorkbenchRecommendations,
  summarizeRecommendations,
};
