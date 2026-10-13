/**
 * Motor de Recomendações Coerentes de Bike Fit (CoherentRecommendationEngine).
 *
 * PROBLEMA QUE RESOLVE:
 * Ao analisar várias fotos, o sistema antigo emitia ordens contraditórias
 * (ex.: "encurtar o avanço" numa foto e "alongar o avanço" noutra).
 *
 * REGRAS DE COERÊNCIA (não negociáveis):
 * 1. Cada componente da bicicleta tem UMA e só UMA direção de ajuste no resultado final.
 * 2. A prescrição consolidada só existe com, no mínimo, DUAS fotos analisadas.
 * 3. A ALTURA DO SELIM só é prescrita a partir de fotos BDC (6h).
 *    O RECUO/AVANÇO só é prescrito a partir de fotos 90° (3h, KOPS).
 * 4. O Stack (espaçadores ← tronco) e o Reach (avanço ← cotovelo) estão desacoplados:
 *    nunca dois componentes diferentes mandam mexer na mesma peça em sentidos opostos.
 * 5. Quando as fotos divergem entre si, o motor NÃO inventa uma média silenciosa:
 *    emite um AVISO explícito (`notice`) a explicar a divergência.
 * 6. Em POSTURA AERO o KOPS não prescreve (a referência é o ângulo de assento): a regra 3
 *    aplica-se apenas a posição ereta. Ver `postureMode.js`.
 *
 * Este ficheiro é uma classe sem estado: só recebe dados e devolve um resultado.
 */

import { KNEE_EXTENSION_RANGE, getKneeTargetForPosition } from './crankPositionRules.js';
import {
  DEFAULT_POSTURE,
  getPostureMetricAuthority,
  postureCopyFor,
} from './postureMode.js';
import {
  resolveEquipment,
  buildEquipmentPrescriptions,
  buildEquipmentNotices,
  barShapeReading,
  cockpitReading,
  describeSaddleTarget,
  describeStemTarget,
  frameSizeRule,
} from './equipmentFitRules.js';
import { computeTheoreticalEstimates, round1, TOLERANCES } from '../../AthleteOnboarding/modules/theoreticalEstimates.js';
import {
  applyFlexibilityToTrunkTarget,
  collectVotesByComponent,
  describePositionOptimization,
  evaluatePosition,
} from './positionOptimization.js';
import { CRANK_POSITION_RULES, HIP_CLOSURE_RANGE } from './crankPositionRules.js';
import { buildDataAccounting, formatTechnicalSummary } from './technicalSummary.js';
import { auditCaptureProtocol, buildProfessionalReading } from './professionalFitStandards.js';

export class CoherentRecommendationEngine {
  /** Número mínimo de fotos analisadas para emitir uma prescrição consolidada. */
  static MIN_PHOTOS = 2;

  /**
   * Constrói a prescrição coerente a partir das fotos já analisadas.
   *
   * @param {Array} imageItems - fotos da galeria (com status, crankPosition, angles, kopsResult, name)
   * @param {Object} targets - metas ergonómicas (knee, back, elbow, ankle)
   * @param {{ posture?: string, athlete?: Object, bike?: Object, geometry?: Object, profile?: Object,
   *            flexibility?: string }} [options]
   *        - postura em vigor (em aero o KOPS deixa de prescrever)
   *        - `athlete`/`bike`/`geometry`: dados do passo 1 (ombros, cavalo, guiador, avanço, crenque,
   *          selim). Sem eles as regras atleta↔equipamento são omitidas, nunca inventadas.
   *        - `profile`: perfil da análise (peso, nº de sapato) — entra no resumo técnico.
   *        - `flexibility`: desloca o alvo do tronco (baixa sobe o alvo, alta desce-o).
   * @returns {Object} prescrição única e coerente
   */
  static build(
    imageItems = [],
    targets = {},
    {
      posture = DEFAULT_POSTURE,
      athlete = null,
      bike = null,
      geometry = null,
      profile = {},
      flexibility = null,
      flexibilityApplied = false,
      regime = 'dynamic',
      capture = null,
    } = {}
  ) {
    const postureAuthority = getPostureMetricAuthority({ posture, position: '90deg' });
    const analyzed = imageItems.filter((item) => item.status === 'done' && item.angles);
    const extensionRange = targets.knee || KNEE_EXTENSION_RANGE;

    // A flexibilidade declarada desloca o alvo do tronco: um atleta com flexibilidade baixa não
    // sustenta a mesma inclinação. Se o chamador já aplicou o deslocamento nos alvos que envia
    // (`flexibilityApplied`), não se aplica duas vezes — o que se faz é só documentá-lo.
    const declaredFlexibility = flexibility || athlete?.flexibility || 'medium';
    const flexibilityAdjust = flexibilityApplied
      ? {
          range: Array.isArray(targets.back) ? [...targets.back] : targets.back,
          shift: 0,
          // Sem aviso: quando o chamador já aplicou o deslocamento, isto é só metadado do resumo.
          note: null,
          appliedByCaller: true,
          flexibility: declaredFlexibility,
        }
      : applyFlexibilityToTrunkTarget(targets.back, declaredFlexibility, posture);
    const effectiveTargets = flexibilityAdjust.shift ? { ...targets, back: flexibilityAdjust.range } : { ...targets };

    const result = {
      ready: analyzed.length >= CoherentRecommendationEngine.MIN_PHOTOS,
      analyzedCount: analyzed.length,
      requiredPhotos: CoherentRecommendationEngine.MIN_PHOTOS,
      missingPositions: [],
      notices: [],
      prescriptions: [],
      compliantCount: 0,
      score: null,
      equipment: null,
      // Alvos em vigor (já com a flexibilidade aplicada) e prova da otimização por posição do pé.
      targetsInUse: effectiveTargets,
      flexibilityAdjust,
      positionOptimization: [],
      dataAccounting: null,
      // Leitura profissional por posição do pé e auditoria do protocolo de captura.
      professionalReading: null,
      captureAudit: null,
    };

    if (flexibilityAdjust.note) result.notices.push(flexibilityAdjust.note);

    /**
     * Resumo técnico: TODOS os dados fornecidos contam, mesmo quando ainda não há prescrição.
     * É montado a partir do que existe naquele instante (as ordens já emitidas enriquecem as linhas).
     */
    const finishTechnicalSummary = () => {
      result.dataAccounting = buildDataAccounting({
        athlete: athlete || {},
        bike: bike || {},
        geometry: geometry || {},
        profile: profile || {},
        posture,
        targets: effectiveTargets,
        prescriptions: result.prescriptions,
        evaluations: result.positionOptimization,
        notices: result.notices,
      });
      // A leitura profissional acrescenta o que o alvo não diz: a CONVENÇÃO de cada ângulo, o
      // grau de evidência da referência, a fonte, e o erro de repetição publicado (uma diferença
      // que cabe lá dentro não é um erro do atleta).
      result.professionalReading = buildProfessionalReading({
        evaluations: result.positionOptimization,
        posture,
        flexibility: declaredFlexibility,
        regime,
      });
      result.captureAudit = auditCaptureProtocol(capture || {});
      result.technicalSummaryText = formatTechnicalSummary({
        accounting: result.dataAccounting,
        evaluations: result.positionOptimization,
        professional: result.professionalReading,
      });
      return result;
    };

    if (!result.ready) {
      result.notices.push(
        `Analise pelo menos ${CoherentRecommendationEngine.MIN_PHOTOS} fotos em posições diferentes ` +
          `(obrigatoriamente 6h/BDC e 3h/90°) para gerar uma prescrição fiável. ` +
          `Fotos analisadas neste momento: ${analyzed.length}.`
      );
      // Os dados já contam como CONTEXTO (alvos que serão aplicados): o resumo não fica vazio só
      // porque falta uma segunda foto.
      result.missingPositions.push(...['BDC (6h)', '90° (3h)'].filter((label) => !analyzed.some((item) => (label.startsWith('BDC') ? item.crankPosition === 'bdc' : item.crankPosition === '90deg'))));
      return finishTechnicalSummary();
    }

    // --- 1. ALTURA DO SELIM (só a partir de BDC / 6h) ---
    const bdcItems = analyzed.filter((item) => item.crankPosition === 'bdc');
    if (!bdcItems.length) {
      result.missingPositions.push('BDC (6h)');
    } else {
      const votes = bdcItems.map((item) => {
        const [minK, maxK] = getKneeTargetForPosition('bdc', extensionRange) || extensionRange;
        const knee = item.angles.joelho;
        return { photoName: item.name, measured: knee, min: minK, max: maxK };
      });
      this._resolveSaddleHeight(votes, result, bdcItems);
    }

    // --- 2. RECUO / AVANÇO DO SELIM (só a partir de 90° / 3h → KOPS) ---
    const ninetyItems = analyzed.filter((item) => item.crankPosition === '90deg' && item.kopsResult);
    if (!ninetyItems.length) {
      result.missingPositions.push('90° (3h)');
    } else if (!postureAuthority.kops) {
      // Em AERO o KOPS não prescreve: a referência é o ângulo de assento (78–86°).
      const kopsCopy = postureCopyFor(posture, 'kops', 'descriptive');
      result.notices.push(kopsCopy.whatToDo);
    } else {
      const offsets = ninetyItems.map((item) => ({ photoName: item.name, value: item.kopsResult.offsetMm }));
      this._resolveSaddleForeAft(offsets, result);
    }

    // --- 2b. OTIMIZAÇÃO POR POSIÇÃO DO PÉ ---
    // Cada foto é lida com os objetivos DA SUA posição: às 12h o objetivo é o fecho da anca, às 3h a
    // posição longitudinal (KOPS) e o tornozelo da fase de potência, às 6h a extensão do joelho, às
    // 9h a transição do tornozelo (descritiva). Daqui saem votos por COMPONENTE — as posições que
    // partilham uma peça votam na mesma reconciliação, para continuar a haver uma única direção.
    const positionEvaluations = analyzed.map((item) =>
      evaluatePosition({
        position: item.crankPosition,
        angles: item.angles || {},
        kopsResult: item.kopsResult || null,
        posture,
        flexibility,
        targets: effectiveTargets,
      })
    );
    const votesByComponent = collectVotesByComponent(positionEvaluations);
    result.positionOptimization = describePositionOptimization(positionEvaluations);
    if (positionEvaluations.some((evaluation) => evaluation.unidentified)) {
      result.notices.push(
        'Há fotos sem posição do pé identificada: nessas não se aplica alvo de posição (mede-se e registra-se). Escolha a posição (12h/3h/6h/9h) para o ajuste ótimo seguir a posição do pé.'
      );
    }

    // --- 3. STACK (espaçadores) ←ÂNGULO DO TRONCO + FECHO DA ANCA (12h) ---
    this._resolveTrunkStack(analyzed, effectiveTargets, result, votesByComponent.stack || []);

    // --- 4. REACH (comprimento do avanço) ← ÂNGULO DO COTOVELO + FECHO DA ANCA (12h) ---
    this._resolveElbowReach(analyzed, effectiveTargets, result, votesByComponent.reach || []);

    // --- 4b. CRENQUE ← fecho da anca às 12h (além da faixa do cavalo) ---
    this._resolveHipClosureCrank(positionEvaluations, result);

    // --- 5. TORNOZELO / TRAVESSÕES ← por posição (tornozelo + ângulo do pé) ---
    this._resolveAnkle(analyzed, effectiveTargets, result, {
      posture,
      votesByComponent: votesByComponent.cleat || [],
      bike,
      profile,
    });

    // --- 6. ATLETA ↔ EQUIPAMENTO ---
    // A largura do guiador e o crenque não vêm dos ângulos: vêm do corpo do atleta contra a peça
    // montada. Sem estes dados o motor podia (e podia mesmo) prescrever peças erradas.
    this._applyAthleteEquipment(result, { athlete, bike, geometry, targets: effectiveTargets });

    // --- 7. RESUMO TÉCNICO: TODOS OS DADOS CONTAM ---
    // Cada dado fornecido (passo 1, perfil, postura, medidas por posição) fica com uma linha que diz
    // o que ALTEROU na decisão — ou, quando não conta, o motivo exato e o que falta.
    result.compliantCount = analyzed.length;
    return finishTechnicalSummary();
  }

  /**
   * Reconcilia votos com sinal: soma as direções e escolhe UMA só.
   * Devolve `{ direction: +1|-1|0, diverged: boolean, magnitude }`.
   * @private
   */
  static _reconcile(votes) {
    let positive = 0;
    let negative = 0;
    let positiveMagnitudeSum = 0;
    let negativeMagnitudeSum = 0;

    votes.forEach((vote) => {
      if (vote.sign > 0) {
        positive++;
        positiveMagnitudeSum += Math.abs(vote.magnitude || 0);
      } else if (vote.sign < 0) {
        negative++;
        negativeMagnitudeSum += Math.abs(vote.magnitude || 0);
      }
    });

    const diverged = positive > 0 && negative > 0;
    if (diverged) return { direction: 0, diverged: true, magnitude: 0 };
    if (positive > 0) {
      return { direction: 1, diverged: false, magnitude: Math.round(positiveMagnitudeSum / positive) };
    }
    if (negative > 0) {
      return { direction: -1, diverged: false, magnitude: Math.round(negativeMagnitudeSum / negative) };
    }
    return { direction: 0, diverged: false, magnitude: 0 };
  }

  /** Registo de aviso de divergência entre fotos. @private */
  static _pushDivergenceNotice(result, componentLabel, votes) {
    const photos = votes.map((v) => v.photoName).join(', ');
    result.notices.push(
      `⚠️ Divergência em "${componentLabel}": as fotos (${photos}) apontam sentidos opostos. ` +
        `Nenhuma alteração é prescrita para evitar ajustes contraditórios.`
    );
  }

  /**
   * Rótulo humano do alvo de extensão, para não atribuir o método estático Holmes a uma
   * medição dinâmica (e vice-versa).
   * @private
   */
  static _kneeTargetLabel(min, max) {
    if (min === 145 && max === 155) return 'Holmes (estático: 25–35° de flexão)'; // 145/155 = estático
    if (min === 137 && max === 150) return 'dinâmica de pedalada ativa';
    return 'ergonómica';
  }

  /**
   * Altura do selim: um único sentido a partir das fotos BDC (6h).
   * @private
   */
  static _resolveSaddleHeight(votes, result, items) {
    const withVotes = votes.map((vote) => {
      const delta = vote.measured < vote.min ? -(vote.min - vote.measured) : vote.measured - vote.max;
      const sign = vote.measured < vote.min ? 1 : vote.measured > vote.max ? -1 : 0; // +1 = subir
      const deg = Math.abs(delta);
      return { photoName: vote.photoName, sign, magnitude: Math.round(deg * 2.4), deg, measured: vote.measured };
    });

    const active = withVotes.filter((v) => v.sign !== 0);
    if (!active.length) return; // conforme

    const resolved = this._reconcile(active);
    if (resolved.diverged) {
      this._pushDivergenceNotice(result, 'Altura do Selim (6h)', active);
      return;
    }

    const mm = Math.min(25, Math.max(3, resolved.magnitude));
    const raising = resolved.direction > 0;
    const measuredAvg = Math.round(items.reduce((sum, it) => sum + it.angles.joelho, 0) / items.length);
    const evidence = active.map((v) => v.photoName);

    result.prescriptions.push({
      key: 'saddleHeight',
      component: 'Altura do Selim',
      direction: raising ? 'raise' : 'lower',
      status: Math.abs(measuredAvg - (raising ? 145 : 155)) > 12 ? 'danger' : 'warning',
      badge: raising ? (mm >= 12 ? '🔴 SELIM MUITO BAIXO' : '🟡 SELIM BAIXO') : (mm >= 12 ? '🔴 SELIM MUITO ALTO' : '🟡 SELIM ALTO'),
      action: raising ? `Subir selim ~${mm} mm` : `Descer selim ~${mm} mm`,
      whatToDo: raising
        ? `Subir o espigão do selim cerca de ${mm} mm a ${mm + 4} mm (medido no quadro).`
        : `Baixar o espigão do selim cerca de ${mm} mm a ${mm + 3} mm (medido no quadro).`,
      // O rótulo da meta depende do REGIME de medição: o método Holmes é estático (foto com o
      // pedal parado no BDC) e não pode ser citado para um intervalo dinâmico de pedalada ativa.
      degreesInfo: `Extensão média no BDC (6h): ${measuredAvg}° | Meta ${this._kneeTargetLabel(votes[0].min, votes[0].max)}: ${votes[0].min}° a ${votes[0].max}°.`,
      why: raising
        ? 'Elevar o selim estica a perna no ponto morto inferior, recrutando glúteos e aliviando a compressão da rótula.'
        : 'Baixar o selim devolve estabilidade à bacia e elimina a necessidade de esticar a ponta do pé para alcançar o pedal.',
      harmDone: raising
        ? 'Compressão patelofemoral e tendinite rotuliana por flexão excessiva do joelho.'
        : 'Oscilação lateral da bacia (rocking), tendinopatia de Aquiles e sobrecarga dos isquiotibiais.',
      evidence,
      source: 'BDC (6h)',
      // Desvio assinado em mm (usado para dar o alvo ABSOLUTO quando há altura de selim medida).
      deltaMm: raising ? mm : -mm,
    });
  }

  /**
   * Recuo/avanço do selim: um único sentido a partir das fotos 90° (3h) via KOPS.
   * @private
   */
  static _resolveSaddleForeAft(offsets, result) {
    const withVotes = offsets.map((entry) => ({
      photoName: entry.photoName,
      sign: entry.value > 10 ? -1 : entry.value < -10 ? 1 : 0, // -1 = recuar; +1 = avançar
      magnitude: Math.max(3, Math.round(Math.abs(entry.value) - 5)),
      value: entry.value,
    }));

    const active = withVotes.filter((v) => v.sign !== 0);
    if (!active.length) return;

    const resolved = this._reconcile(active);
    if (resolved.diverged) {
      this._pushDivergenceNotice(result, 'Recuo/Avanço do Selim (KOPS 3h)', active);
      return;
    }

    const mm = resolved.magnitude;
    const movingBack = resolved.direction < 0;
    const offsetAvg = Math.round(offsets.reduce((sum, o) => sum + o.value, 0) / offsets.length);
    const evidence = active.map((v) => v.photoName);

    result.prescriptions.push({
      key: 'saddleForeAft',
      component: 'Recuo / Avanço do Selim (KOPS)',
      direction: movingBack ? 'back' : 'forward',
      status: Math.abs(offsetAvg) > 20 ? 'danger' : 'warning',
      badge: movingBack ? '🟡 AVANÇADO' : '🟡 RECUADO',
      action: movingBack ? `Recuar selim ~${mm} mm nos carris` : `Avançar selim ~${mm} mm nos carris`,
      whatToDo: movingBack
        ? `Deslizar o selim para trás cerca de ${mm} mm nos carris do espigão.`
        : `Deslizar o selim para a frente cerca de ${mm} mm nos carris do espigão.`,
      degreesInfo: `Desvio KOPS médio às 3h: ${offsetAvg > 0 ? `+${offsetAvg}` : offsetAvg} mm | Tolerância ideal: ±10 mm.`,
      why: movingBack
        ? 'Recuar o selim reposiciona a patela sobre o eixo do pedal, reduzindo o vetor de cisalhamento.'
        : 'Avançar o selim facilita cadências altas e abre o ângulo anterior da anca.',
      harmDone: movingBack
        ? 'Força cortante na patela e sobrecarga dos pulsos por excesso de peso projetado no guiador.'
        : 'Sobrecarga dos flexores da anca e fadiga lombar precoce.',
      evidence,
      source: '90° (3h)',
    });
  }

  /**
   * STACK (espaçadores) ← ângulo do tronco. NÃO sugere comprimento de avanço.
   * @private
   */
  static _resolveTrunkStack(analyzed, targets, result, extraVotes = []) {
    const [minB, maxB] = targets.back || [40, 50];
    const votes = analyzed
      .filter((item) => typeof item.angles.costas === 'number')
      .map((item) => ({
        photoName: item.name,
        sign: item.angles.costas < minB ? 1 : item.angles.costas > maxB ? -1 : 0, // +1 = mais espaçadores
        magnitude: Math.min(15, Math.max(5, Math.round(Math.abs(item.angles.costas - (item.angles.costas < minB ? minB : maxB)) * 1.2))),
        measured: item.angles.costas,
      }));

    // Votos de OUTRAS posições para a mesma peça (ex.: fecho da anca às 12h pede guiador mais alto).
    // Entram na mesma reconciliação, para continuar a haver uma só direção por componente — é esta
    // a peça que faz o ajuste ótimo acompanhar cada posição do pé sem gerar ordens contraditórias.
    extraVotes.forEach((vote) => {
      votes.push({
        photoName: `Fecho da anca ${vote.positionLabel}`,
        sign: vote.sign,
        magnitude: Math.min(15, Math.max(5, Math.round((vote.deviation || 5) * 1.5))),
        measured: null,
        fromMetric: vote.metric,
        rationale: vote.rationale,
      });
    });

    const active = votes.filter((v) => v.sign !== 0);
    if (!active.length) return;

    const resolved = this._reconcile(active);
    if (resolved.diverged) {
      this._pushDivergenceNotice(result, 'Stack / Espaçadores (tronco)', active);
      return;
    }

    const mm = Math.min(15, Math.max(5, resolved.magnitude));
    const adding = resolved.direction > 0;
    const measured = votes.filter((v) => typeof v.measured === 'number');
    const trunkAvg = Math.round(measured.reduce((sum, v) => sum + v.measured, 0) / Math.max(1, measured.length));
    const hipVotes = votes.filter((v) => v.fromMetric === 'hipClosure');

    result.prescriptions.push({
      key: 'stack',
      component: 'Cockpit — Stack (Espaçadores)',
      direction: adding ? 'raise' : 'lower',
      status: 'warning',
      badge: adding ? '🟡 TRONCO MUITO DEITADO' : '🟡 TRONCO MUITO ERETO',
      action: adding ? `Adicionar ~${mm} mm de espaçadores` : `Remover ~${mm} mm de espaçadores`,
      whatToDo: adding
        ? `Adicionar ${mm} mm de espaçadores sob o avanço para elevar o guiador e aliviar a coluna.`
        : `Remover ${mm} mm de espaçadores sob o avanço para baixar ligeiramente o guiador.`,
      degreesInfo:
        `Inclinação média do tronco: ${trunkAvg}° | Meta ergonómica: ${minB}° a ${maxB}°.` +
        (hipVotes.length
          ? ` Inclui o fecho da anca ${hipVotes.map((v) => v.photoName.replace('Fecho da anca ', '')).join(', ')}: subir o guiador é a correção que abre a anca sem mexer no recuo do selim.`
          : ''),
      why: adding
        ? hipVotes.length
          ? 'Elevar o guiador alivia o fecho da anca no ponto morto superior (o joelho não sobe contra o peito) mantendo a lordose lombar neutra.'
          : 'Elevar o guiador alivia a rotação excessiva da bacia mantendo a lordose lombar neutra.'
        : 'Uma ligeira inclinação frontal transfere peso para os braços, aliviando a pressão nos ísquios.',
      harmDone: adding
        ? 'Pinçamento discal lombar (L4-L5/S1) e hiperextensão cervical.'
        : 'Pressão excessiva nos ísquios e transmissão direta das pancadas do asfalto à coluna.',
      evidence: active.map((v) => v.photoName),
      source: 'Tronco (todas as fotos)',
      // Ângulo do tronco medido — lido pela regra da forma do guiador (drop profundo + tronco alto
      // indica guiador compacto, não avanço mais curto).
      measured: trunkAvg,
    });
  }

  /**
   * REACH (comprimento do avanço) ← ângulo do cotovelo. Única fonte sobre a mesa.
   * @private
   */
  static _resolveElbowReach(analyzed, targets, result, extraVotes = []) {
    const [minE, maxE] = targets.elbow || [150, 165];
    const votes = analyzed
      .filter((item) => typeof item.angles.braco === 'number')
      .map((item) => ({
        photoName: item.name,
        sign: item.angles.braco > maxE ? -1 : item.angles.braco < minE ? 1 : 0, // -1 = encurtar; +1 = alongar
        magnitude: item.angles.braco > maxE ? 18 : 10,
        measured: item.angles.braco,
      }));

    // Fecho da anca às 12h também se corrige encurtando o cockpit (voto na MESMA reconciliação).
    extraVotes.forEach((vote) => {
      votes.push({
        photoName: `Fecho da anca ${vote.positionLabel}`,
        sign: vote.sign,
        magnitude: 10,
        measured: null,
        fromMetric: vote.metric,
        rationale: vote.rationale,
      });
    });

    const active = votes.filter((v) => v.sign !== 0);
    if (!active.length) return;

    const resolved = this._reconcile(active);
    if (resolved.diverged) {
      this._pushDivergenceNotice(result, 'Reach / Comprimento do Avanço (cotovelo)', active);
      return;
    }

    const shorten = resolved.direction < 0;
    const measured = votes.filter((v) => typeof v.measured === 'number');
    const armAvg = Math.round(measured.reduce((sum, v) => sum + v.measured, 0) / Math.max(1, measured.length));
    const hipVotes = votes.filter((v) => v.fromMetric === 'hipClosure');

    result.prescriptions.push({
      key: 'reach',
      component: 'Cockpit — Reach (Avanço/Mesa)',
      direction: shorten ? 'shorten' : 'lengthen',
      status: shorten && resolved.magnitude >= 18 ? 'danger' : 'warning',
      badge: shorten ? '🔴 BRAÇOS BLOQUEADOS' : '🟡 COCKPIT CURTO',
      action: shorten ? 'Encurtar avanço ~15-20 mm' : 'Alongar avanço ~10 mm',
      whatToDo: shorten
        ? 'Substituir o avanço por um mais curto (15 a 20 mm menor) ou aproximar os manetes de travão.'
        : 'Alongar o avanço da mesa em cerca de 10 mm.',
      degreesInfo:
        `Ângulo médio do cotovelo: ${armAvg}° | Meta ergonómica: ${minE}° a ${maxE}°.` +
        (hipVotes.length
          ? ' Inclui o fecho da anca às 12h: encurtar o cockpit reduz a distância do tronco ao guiador e abre a anca.'
          : ''),
      why: shorten
        ? 'Encurtar o cockpit permite fletir naturalmente os cotovelos, desarmando o bloqueio ósseo dos membros superiores.'
        : 'Abrir o cockpit dá espaço para manobrar com estabilidade e respirar livremente.',
      harmDone: shorten
        ? 'Compressão do nervo ulnar/mediano com dormência nas mãos ("paralisia do ciclista").'
        : 'Tensão contínua nos tríceps e risco de os joelhos baterem nos cotovelos ao pedalar em pé.',
      evidence: active.map((v) => v.photoName),
      source: 'Cotovelo (todas as fotos)',
      // Desvio assinado conservador em mm (o alvo absoluto do avanço usa o limite inferior).
      deltaMm: shorten ? -15 : 10,
    });
  }

  /**
   * Regras ATLETA ↔ EQUIPAMENTO (passo 6 do motor).
   *
   * 1. Largura do guiador contra a largura biacromial (nunca um 420 mm para 40 cm de ombros).
   * 2. Comprimento do crenque contra a faixa do cavalo.
   * 3. Forma do guiador (reach/drop) contra a inclinação do tronco medida.
   * 4. Enriquecimento das ordens com alvo ABSOLUTO (selim em cm, avanço em mm) usando o que o
   *    atleta declarou ter na bicicleta.
   * 5. Aviso quando a altura de selim introduzida contradiz a estimativa de LeMond para o cavalo.
   *
   * Componentes adicionados (guiador, crenque) são distintos dos cinco que vêm dos ângulos, para
   * continuar a haver UMA única direção por peça.
   * @private
   */
  static _applyAthleteEquipment(result, { athlete, bike, geometry, targets } = {}) {
    const equipment = resolveEquipment({ athlete, bike, geometry });
    if (!equipment.hasAthlete && !equipment.hasBike) return;

    const trunkTarget = targets.back || [40, 50];
    const trunkPrescription = result.prescriptions.find((item) => item.key === 'stack');
    const trunkAngle = trunkPrescription ? trunkPrescription.measured : undefined;

    const barShape = barShapeReading({
      barReachMm: equipment.barReachMm,
      barDropMm: equipment.barDropMm,
      trunkAngle,
      trunkTarget,
    });

    // --- 1/2/3: peças cujo alvo vem do corpo do atleta ---
    buildEquipmentPrescriptions(equipment, { trunkAngle, trunkTarget }).forEach((item) => {
      // O CRENQUE pode já ter ordem vinda do fecho da anca às 12h (passo 4b). Continua a haver UMA
      // só ordem por peça: a do cavalo traz os números absolutos e absorve a razão da anca.
      const existing = result.prescriptions.find((p) => p.key === item.key);
      if (existing) {
        existing.action = item.action;
        existing.badge = item.badge;
        existing.status = item.status;
        existing.whatToDo = `${item.whatToDo} ${existing.whatToDo}`;
        existing.degreesInfo = `${item.degreesInfo} ${existing.degreesInfo}`;
        existing.why = `${item.why} ${existing.why}`;
        existing.harmDone = `${item.harmDone} ${existing.harmDone}`;
        existing.evidence = [...new Set([...existing.evidence, ...item.evidence])];
        existing.source = `${existing.source} + Passo 1 (faixa do cavalo)`;
        existing.merged = true;
        return;
      }
      result.prescriptions.push({ ...item, evidence: [...item.evidence, 'Passo 1 (dados do atleta)'] });
    });

    // --- 4: alvos absolutos sobre as ordens que já existem ---
    const saddle = result.prescriptions.find((item) => item.key === 'saddleHeight');
    if (saddle && typeof saddle.deltaMm === 'number') {
      const target = describeSaddleTarget({
        currentSaddleHeightCm: equipment.saddleHeightCm,
        deltaMm: saddle.deltaMm,
      });
      if (target && target.text) {
        saddle.equipmentTarget = target;
        saddle.action = `${saddle.action} → ${target.currentCm} cm para ${target.targetCm} cm`;
        saddle.whatToDo = `${saddle.whatToDo} Valor absoluto: ${target.text}.`;
      }
    }

    const reach = result.prescriptions.find((item) => item.key === 'reach');
    if (reach && typeof reach.deltaMm === 'number') {
      const target = describeStemTarget({ currentStemMm: equipment.stemMm, deltaMm: reach.deltaMm });
      if (target && target.text) {
        reach.equipmentTarget = target;
        reach.action = `${reach.action} → ${target.targetMm} mm`;
        reach.whatToDo = `${reach.whatToDo} Valor absoluto: ${target.text}.`;
      }
      // O tamanho do quadro explica PORQUE é que este atleta precisa deste avanço: sem isto, o
      // dado do quadro ficava sem efeito no resumo.
      const frame = frameSizeRule({ inseamCm: equipment.inseamCm, frameSizeCm: equipment.frameSizeCm });
      if (frame.counts) {
        reach.frameContext = frame;
        reach.whatToDo += ` Contexto: o quadro (${frame.frameCm} cm) está ${frame.deltaCm > 0 ? '+' : ''}${frame.deltaCm} cm ${
          frame.status === 'long' ? 'acima' : 'abaixo'
        } da estimativa para o cavalo (${frame.estimatedCm} cm) — parte do alcance vem daí, não do avanço.`;
      }
      // Tubo superior (ETT): diz QUANTO do alcance vem do quadro antes de o atleta trocar o avanço.
      // Sem isto, uma ordem de "encurtar 15 mm" esconde que o cockpit total é comprido por causa do
      // quadro — e o fitter encurta o avanço para compensar um quadro que não é o dele.
      const cockpit = cockpitReading({
        topTubeMm: equipment.topTubeMm,
        stemMm: equipment.stemMm,
        barReachMm: equipment.barReachMm,
        ridingStyle: equipment.ridingStyle,
      });
      if (cockpit && cockpit.topTubeMm !== null) {
        reach.cockpitContext = cockpit;
        reach.whatToDo += ` Cockpit: ${cockpit.text}.`;
      }
    }

    // --- 5: coerência entre a altura declarada e a estimativa para o cavalo ---
    const lemond = computeTheoreticalEstimates({ inseam_cm: equipment.inseamCm }).values.lemond_saddle_height_cm;
    if (equipment.saddleHeightCm !== null && lemond !== null) {
      const delta = round1(equipment.saddleHeightCm - lemond);
      if (Math.abs(delta) > TOLERANCES.saddleHeightCm) {
        result.notices.push(
          `Altura de selim declarada (${equipment.saddleHeightCm} cm) está ${Math.abs(delta)} cm ` +
            `${delta > 0 ? 'acima' : 'abaixo'} da estimativa LeMond para o seu cavalo (${lemond} cm): ` +
            'confirme a medição antes de aplicar os ajustes.'
        );
      }
    }

    buildEquipmentNotices(equipment, { trunkAngle, trunkTarget }).forEach((notice) => result.notices.push(notice));

    // Contexto para a interface (o painel mostra o que o atleta declarou ter na bicicleta).
    result.equipment = { ...equipment, barShape };
  }

  /**
   * Tornozelo / travessões ← ângulo do tornozelo.
   * @private
   */
  static _resolveAnkle(analyzed, targets, result, { posture = DEFAULT_POSTURE, votesByComponent = [], bike = null, profile = {} } = {}) {
    const [minA, maxA] = targets.ankle || [95, 105];

    // SÓ as posições onde o tornozelo é prescritivo votam: às 3h (fase de potência) e às 6h (BDC).
    // Às 12h e às 9h o tornozelo é registo — usar aqui o alvo da fase de potência seria aplicar a
    // otimização errada a uma posição diferente (o defeito que esta alteração corrige).
    const seenPositions = new Set();
    const votes = analyzed
      .filter((item) => {
        const authority = getPostureMetricAuthority({ posture, position: item.crankPosition });
        seenPositions.add(item.crankPosition || 'custom');
        return authority.ankle === true && typeof item.angles.tornozelo === 'number';
      })
      .map((item) => ({
        photoName: item.name,
        sign: item.angles.tornozelo > maxA ? -1 : item.angles.tornozelo < minA ? 1 : 0,
        magnitude: 4,
        measured: item.angles.tornozelo,
        fromPosition: item.crankPosition,
      }));

    // Votos do ÂNGULO DO PÉ (toe-down), que tem faixa PRÓPRIA em cada posição e corrige a mesma peça
    // (travessões). Entram na mesma reconciliação: uma só direção por peça.
    const toeVotes = votesByComponent.slice();
    toeVotes.forEach((vote) => {
      votes.push({
        photoName: `Ângulo do pé ${vote.positionLabel}`,
        sign: vote.sign,
        magnitude: 4,
        measured: null,
        fromMetric: vote.metric,
        rationale: vote.rationale,
      });
    });
    result.toeDownVotes = toeVotes.length;
    result.anklePositionsUsed = [...seenPositions];

    const active = votes.filter((v) => v.sign !== 0);
    if (!active.length) return;

    const resolved = this._reconcile(active);
    if (resolved.diverged) {
      this._pushDivergenceNotice(result, 'Tornozelo / Travessões', active);
      return;
    }

    const plantarflexed = resolved.direction < 0;
    const measured = votes.filter((v) => typeof v.measured === 'number');
    const ankleAvg = Math.round(measured.reduce((sum, v) => sum + v.measured, 0) / Math.max(1, measured.length));
    const toeVotesActive = votes.filter((v) => v.fromMetric === 'toeDown');
    const usedPositions = [...new Set(votes.filter((v) => v.fromPosition).map((v) => CRANK_POSITION_RULES[v.fromPosition]?.label || v.fromPosition))];

    const cleatPos = (
      bike?.cleat_position ||
      bike?.cleatPosition ||
      profile?.cleatPosition ||
      profile?.cleat_position ||
      ''
    ).trim().toLowerCase();

    let action = plantarflexed ? 'Recuar travessões ~3-5 mm' : 'Avançar travessões ~2-4 mm';
    let whatToDo = plantarflexed
      ? 'Recuar os travessões nos sapatos em direção ao calcanhar (3 a 5 mm) e verificar se o selim não está alto demais.'
      : 'Avançar ligeiramente os travessões nos sapatos ou verificar a flexibilidade do tornozelo.';
    let why = plantarflexed
      ? 'Recuar o travessão encurta a alavanca do tendão de Aquiles e reduz a pedalada na ponta do pé.'
      : 'Nivela o pé durante o curso de potência às 3h e no BDC.';

    if (cleatPos === 'rearward' && plantarflexed) {
      action = 'Travessões já recuados: baixar selim 2–4 mm / avaliar calço';
      whatToDo =
        'Os travessões já estão em posição posterior máxima (recuados). Como não há margem mecânica para recuar mais o sapato, evite forçar novos ajustes de travessão: baixe o selim 2–4 mm para aproximar o pedal ou adicione suporte no antepé.';
      why =
        'Com travessões já recuados, a alavanca já está reduzida ao mínimo; a ponta do pé decorre de selim excessivamente alto ou compensação no pedal.';
    } else if (cleatPos === 'forward' && !plantarflexed) {
      action = 'Travessões já avançados: subir selim ~2–4 mm ou rever flexibilidade';
      whatToDo =
        'Os travessões já estão totalmente avançados. Em vez de avançar mais a sapatilha, verifique se o selim não está ligeiramente baixo ou avalie a flexibilidade posterior.';
      why =
        'Com travessões já na frente, o calcanhar excessivamente baixo resulta de selim baixo ou amplitude excessiva de dorsiflexão.';
    } else if (cleatPos === 'neutral') {
      whatToDo += ' (A posição neutra declarada permite margem de ajuste na calha do sapato para executar este movimento).';
    }

    result.prescriptions.push({
      key: 'ankle',
      component: 'Tornozelo / Travessões (Cleats)',
      direction: plantarflexed ? 'cleatBack' : 'cleatForward',
      status: 'warning',
      badge: plantarflexed ? '🟡 PONTA DO PÉ' : '🟡 CALCANHAR BAIXO',
      action,
      whatToDo,
      degreesInfo:
        `Ângulo médio do tornozelo: ${ankleAvg}° | Meta da fase de potência/morto inferior (${usedPositions.join(', ')}): ${minA}° a ${maxA}°.` +
        (toeVotesActive.length
          ? ` Inclui o ângulo do pé ${toeVotesActive.map((v) => v.photoName.replace('Ângulo do pé ', '')).join(', ')} (faixa própria da posição).`
          : '') +
        (seenPositions.size > usedPositions.length ? ' Posições com tornozelo descritivo (12h/9h) foram medidas mas não votam no travessão.' : ''),
      why,
      harmDone: plantarflexed
        ? 'Tendinopatia crónica de Aquiles e cãibras frequentes nos gémeos.'
        : 'Sobrecarga do tibial anterior com perda de potência de impulso.',
      evidence: active.map((v) => v.photoName),
      source: `Tornozelo + pé por posição (${usedPositions.join(', ') || 'sem posição prescritiva'})`,
    });
  }

  /**
   * Crenque como correção do FECHO DA ANCA às 12h.
   *
   * Só entra quando a anca fecha demasiado e a faixa do cavalo NÃO já justificava uma ordem (senão
   * haveria duas ordens sobre a mesma peça). Um crenque mais curto sobe menos o joelho no topo do
   * curso — é a correção que não mexe no selim nem no cockpit.
   * @private
   */
  static _resolveHipClosureCrank(positionEvaluations = [], result) {
    if (result.prescriptions.some((item) => item.key === 'crankLength')) return;
    const hipMetrics = positionEvaluations
      .flatMap((evaluation) =>
        (evaluation.metrics || [])
          .filter((metric) => metric.metric === 'hipClosure' && metric.status === 'low')
          .map((metric) => ({ ...metric, positionLabel: evaluation.label }))
      );
    if (!hipMetrics.length) return;

    const worst = hipMetrics.reduce((min, metric) => (metric.measured < min.measured ? metric : min), hipMetrics[0]);
    result.prescriptions.push({
      key: 'crankLength',
      component: 'Transmissão — Comprimento do Crenque (fecho da anca)',
      direction: 'shorten',
      status: 'warning',
      badge: '🟡 ANCA FECHADA NO TOPO DO CURSO',
      action: 'Avaliar um crenque 5 mm mais curto (ou subir o guiador)',
      whatToDo: `Aos 12h a anca fecha a ${worst.measured}° (referência ${HIP_CLOSURE_RANGE[0]}–${HIP_CLOSURE_RANGE[1]}°). Um crenque 5 mm mais curto sobe menos o joelho nesse ponto; em alternativa, subir o guiador resolve o mesmo desvio sem trocar peças.`,
      degreesInfo: `Fecho da anca às 12h: ${worst.measured}° | Referência: ${HIP_CLOSURE_RANGE[0]}° a ${HIP_CLOSURE_RANGE[1]}° (prática 55–65°).`,
      why: 'No ponto morto superior a perna está no ponto mais alto da órbita: é aqui que o fecho da anca causa pinçamento e perda de potência, não aos 6h.',
      harmDone: 'Pinçamento femoroacetabular (dor anterior na anca em posições agressivas), bacia a rodar para o lado para "ganhar" espaço e perda de potência no topo do curso.',
      evidence: [worst.positionLabel || 'TDC (12h)'],
      source: 'Posição 12h (fecho da anca) — regra por posição do pé',
    });
  }

  /**
   * Linha de contexto do equipamento declarado, para a prescrição copiada/impressa.
   * @private
   */
  static _equipmentLine(equipment) {
    if (!equipment) return '';
    const parts = [];
    if (typeof equipment.handlebarWidthMm === 'number') parts.push(`guiador ${equipment.handlebarWidthMm} mm`);
    if (typeof equipment.barReachMm === 'number') parts.push(`reach ${equipment.barReachMm} mm`);
    if (typeof equipment.barDropMm === 'number') parts.push(`drop ${equipment.barDropMm} mm`);
    if (typeof equipment.stemMm === 'number') parts.push(`avanço ${equipment.stemMm} mm`);
    if (typeof equipment.crankMm === 'number') parts.push(`crenque ${equipment.crankMm} mm`);
    if (typeof equipment.saddleHeightCm === 'number') parts.push(`selim ${equipment.saddleHeightCm} cm`);
    if (typeof equipment.inseamCm === 'number') parts.push(`cavalo ${equipment.inseamCm} cm`);
    if (typeof equipment.shouldersCm === 'number') parts.push(`ombros ${equipment.shouldersCm} cm`);
    return parts.length ? `${parts.join(' | ')}\n` : '';
  }

  /**
   * Cálculo do score de prontidão da prescrição (0-100).
   * Penaliza componentes prescritos; fotografias a mais não ajudam.
   */
  static scoreOf(result) {
    if (!result || !result.ready) return null;
    const penalty = result.prescriptions.length * 12 + result.notices.length * 6;
    return Math.max(0, Math.min(100, Math.round(100 - penalty)));
  }

  /**
   * Formata a prescrição coerente em texto pronto a copiar/imprimir.
   */
  static formatText(result, athleteName = 'Ciclista', bikeModel = 'Bicicleta') {
    let txt = '======================================================================\n';
    txt += '  ATHLETE MOTION - PRESCRIÇÃO COERENTE DE AFINAÇÕES (MULTI-FOTO)\n';
    txt += '======================================================================\n';
    txt += `Atleta: ${athleteName} | Bicicleta: ${bikeModel}\n`;
    txt += `Data/Hora: ${new Date().toLocaleString('pt-PT')}\n`;
    txt += `Fotos analisadas: ${result.analyzedCount} (mínimo exigido: ${result.requiredPhotos})\n`;
    txt += `Equipamento declarado: ${this._equipmentLine(result.equipment) || 'n/d\n'}`;
    txt += '\n';

    if (!result.ready) {
      txt += 'PRESCRIÇÃO INDISPONÍVEL:\n';
      result.notices.forEach((n) => (txt += ` - ${n}\n`));
      txt += '======================================================================\n';
      return txt;
    }

    if (result.missingPositions.length) {
      txt += `⚠️ POSIÇÕES EM FALTA: ${result.missingPositions.join(', ')}.\n`;
      txt += '   Componentes que dependem delas não foram prescritos.\n\n';
    }

    if (!result.prescriptions.length) {
      txt += '✅ Nenhum desvio fora da tolerância. Bicicleta afinada à medida do ciclista.\n';
    } else {
      txt += 'AFINAÇÕES PRESCRITAS (UMA ÚNICA DIREÇÃO POR COMPONENTE):\n';
      result.prescriptions.forEach((item, idx) => {
        txt += `----------------------------------------------------------------------\n`;
        txt += `${idx + 1}. [${item.component}] - ${item.badge}\n`;
        txt += `   🔧 O QUE FAZER: ${item.whatToDo}\n`;
        txt += `   📐 ONDE ESTÁ MAL: ${item.degreesInfo}\n`;
        txt += `   💡 PORQUÊ: ${item.why}\n`;
        txt += `   ⚠️ DANO EVITADO: ${item.harmDone}\n`;
        txt += `   📷 FONTE (fotos): ${item.evidence.join(', ')} — ${item.source}\n`;
      });
    }

    if (result.notices.length) {
      txt += '\nAVISOS DE COERÊNCIA:\n';
      result.notices.forEach((n) => (txt += ` - ${n}\n`));
    }
    txt += '======================================================================\n';

    // O resumo técnico (em que contribuiu cada dado fornecido) e a otimização por posição do pé
    // fazem parte da prescrição: sem eles, o relatório esconde metade do raciocínio.
    if (result.technicalSummaryText) {
      txt += '\n';
      txt += formatTechnicalSummary({
        accounting: result.dataAccounting,
        evaluations: result.positionOptimization,
        athleteName,
        bikeModel,
        professional: result.professionalReading,
      });
    }
    return txt;
  }
}
