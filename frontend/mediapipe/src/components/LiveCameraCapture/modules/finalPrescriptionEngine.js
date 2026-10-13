/**
 * Motor de Prescrição Final Única a partir da Análise Integral do Vídeo (FinalPrescriptionEngine).
 *
 * CONTRATO (o que foi pedido, e que este ficheiro garante):
 * 1. **Nada é prescrito antes de o vídeo estar analisado.** Enquanto a análise não fecha,
 *    `status` é `pending` e `prescriptions` fica vazio. Não existe caminho alternativo.
 * 2. **A prescrição não muda conforme o vídeo avança.** É construída UMA vez, a partir das
 *    estatísticas de todas as pedaladas analisadas, e devolvida como objeto imutável.
 * 3. **A análise é diferente em cada posição do cranque** (6h valida o selim em altura,
 *    3h valida o recuo/avanço, 12h avalia o fecho da anca, 9h a transição do tornozelo).
 * 4. **Rigor estatístico:** mediana + MAD por posição, número de pedaladas, erro angular de
 *    fase e um nível de confiança explícito. Nunca uma média silenciosa de fotogramas soltos.
 * 5. **Alvos específicos da postura:** a análise declara com que perfil foi feita (ereta ou aero)
 *    e em aero o KOPS passa a descritivo, entrando o antebraço como métrica própria
 *    (`postureMode.js` é a fonte única de verdade dos alvos e das autoridades).
 *
 * A reconciliação final (uma única direção por componente, sem ordens contraditórias) é
 * delegada ao `CoherentRecommendationEngine`, que já é o dono dessa regra no projeto.
 */

import {
  ANALYSIS_POSITION_ORDER,
  CRANK_POSITION_RULES,
  MIN_REVOLUTIONS_FOR_PRESCRIPTION,
  RECOMMENDED_REVOLUTIONS,
  getKneeReferenceForPosition,
  getKneeTargetForRegime,
} from './crankPositionRules.js';
import { CoherentRecommendationEngine } from './coherentRecommendationEngine.js';
import { AthleteProfile } from './athleteProfile.js';
import {
  DEFAULT_POSTURE,
  POSTURE_AERO,
  POSTURE_MODES,
  formatTargetsLine,
  getPostureMetricAuthority,
} from './postureMode.js';

/** Mediana robusta (não usa a média: um fotograma mal detetado não pode deslocar o resultado). */
export function median(values = []) {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

/** Desvio absoluto mediano (MAD): dispersão robusta entre pedaladas. */
export function medianAbsoluteDeviation(values = []) {
  const med = median(values);
  if (med === null) return null;
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return median(clean.map((v) => Math.abs(v - med)));
}

export class FinalPrescriptionEngine {
  /** Chaves de métrica que cada componente da prescrição usa como prova estatística. */
  static EVIDENCE_BY_COMPONENT = {
    saddleHeight: 'bdc',
    saddleForeAft: '90deg',
    stack: 'all',
    reach: 'all',
    ankle: 'all',
  };

  /**
   * @param {Object} input
   * @param {Object|null} input.analysis - resultado do FullVideoAnalysisPipeline
   * @param {boolean} [input.scanning] - varrimento em curso
   * @param {Object} [input.progress] - { percent, stage, scannedSeconds, totalSeconds, samples, failures }
   * @param {Object} [input.profile] - perfil do atleta (peso, sapato, altura, costura)
   * @param {Object} [input.targets] - metas ergonómicas do componente
   * @param {Object} [input.video] - { name, durationSeconds }
   * @param {Object} [input.equipment] - { athlete, bike }: dados do passo 1 (ombros, cavalo,
   *        guiador, avanço, crenque, selim) que pesam nas peças prescritas
   * @returns {Object} relatório final (ou bloqueado, com o motivo)
   */
  static build({
    analysis = null,
    scanning = false,
    progress = null,
    profile = {},
    targets = {},
    video = {},
    posture = DEFAULT_POSTURE,
    postureDetection = null,
    equipment = null,
  } = {}) {
    const postureMode = POSTURE_MODES[posture] || POSTURE_MODES[DEFAULT_POSTURE];
    const profileNotes = AthleteProfile.describe(profile);
    const normalizedProfile = AthleteProfile.normalize(profile);
    const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));

    const base = {
      status: 'pending',
      locked: true,
      ready: false,
      percent,
      progress,
      lockReason: null,
      positions: {},
      fullBodyRatio: null,
      metrics: [],
      prescriptions: [],
      notices: [],
      missingPositions: [],
      profileNotes,
      profileLine: AthleteProfile.formatLine(profile),
      profile,
      profileComplete: normalizedProfile.complete,
      confidence: { level: 'none', score: 0, label: 'Por avaliar', reasons: [] },
      video: { name: video.name || '', durationSeconds: video.durationSeconds || 0 },
      scan: analysis?.scan || null,
      phase: null,
      analyzedCount: 0,
      requiredRevolutions: MIN_REVOLUTIONS_FOR_PRESCRIPTION,
      recommendedRevolutions: RECOMMENDED_REVOLUTIONS,
      score: null,
      verdict: scanning ? 'Análise em curso' : 'Análise Pendente',
      verdictColor: scanning ? 'var(--accent, #38bdf8)' : '#71717a',
      // Com que perfil de postura foi feita a análise (e o que é prescritivo nessa postura).
      posture: {
        id: posture,
        icon: postureMode.icon,
        label: postureMode.label,
        shortLabel: postureMode.shortLabel,
        summary: postureMode.summary,
        sources: postureMode.sources,
        targetsLine: formatTargetsLine(posture, targets),
        detection: postureDetection,
      },
    };

    if (scanning || !analysis) {
      base.lockReason = scanning
        ? `Análise integral do vídeo em curso (${Math.round(percent)}%). A prescrição só é emitida no fim.`
        : 'Vídeo carregado. Clique em «Iniciar Análise Integral» para avaliar todas as pedaladas.';
      return base;
    }

    if (analysis.status === 'failed') {
      base.status = 'failed';
      base.lockReason = analysis.reason || 'A análise do vídeo falhou.';
      base.notices.push(base.lockReason);
      base.verdict = 'Sem prescrição — a análise não chegou ao fim';
      base.verdictColor = '#ef4444';
      return base;
    }
    if (analysis.status === 'cancelled') {
      base.status = 'cancelled';
      base.lockReason = 'Análise cancelada — nenhuma prescrição foi emitida.';
      base.verdict = 'Sem prescrição — análise cancelada';
      base.verdictColor = '#f59e0b';
      return base;
    }

    const phase = analysis.phase;
    base.phase = phase
      ? {
          reliable: phase.reliable,
          direction: phase.direction,
          completeRevolutions: phase.completeRevolutions,
          cadenceRpm: phase.cadenceRpm,
          phaseCoverageDeg: phase.phaseCoverageDeg,
          sampleCount: phase.sampleCount,
          windowDeg: phase.windowDeg,
          coverage: phase.coverage,
          rejected: phase.rejected?.length || 0,
        }
      : null;

    // ---------------------------------------------------------------------
    // Agregação robusta por posição do cranque
    // ---------------------------------------------------------------------
    const positions = phase?.passages ? this._aggregatePositions(phase.passages, targets, posture) : {};
    base.positions = positions;
    const ratios = Object.values(positions)
      .filter((position) => position.samples > 0 && position.fullBodyRatio !== null)
      .map((position) => position.fullBodyRatio);
    // Critério conservador (o mínimo): todas as posições têm de ter corpo inteiro.
    base.fullBodyRatio = ratios.length ? Math.min(...ratios) : null;
    base.metrics = this._flattenMetrics(positions);
    base.analyzedCount = Object.values(positions).reduce((sum, pos) => sum + (pos.revolutions || 0), 0);

    const requiredMissing = ['bdc', '90deg'].filter((key) => (positions[key]?.revolutions || 0) === 0);
    if (!phase || !phase.reliable) {
      base.status = 'insufficient';
      base.lockReason = analysis.reason || phase?.reason || 'A fase do cranque não pôde ser reconstruída neste vídeo.';
      base.notices.push(base.lockReason);
      base.notices.push(
        'Sem fase fiável não é possível garantir que uma medição foi feita às 6h (BDC) ou às 3h (90°), e medir fora dessas posições não tem significado biomecânico.'
      );
      base.verdict = 'Sem prescrição — fase do cranque não reconstruída';
      base.verdictColor = '#f59e0b';
      return base;
    }
    if (requiredMissing.length) {
      base.status = 'insufficient';
      base.missingPositions = requiredMissing.map((key) => CRANK_POSITION_RULES[key].label);
      base.lockReason = `Sem nenhuma pedalada com passagem válida em: ${base.missingPositions.join(', ')}.`;
      base.notices.push(base.lockReason);
      base.notices.push(...(analysis.notes || []));
      base.verdict = 'Sem prescrição — faltam posições essenciais';
      base.verdictColor = '#f59e0b';
      return base;
    }

    // ---------------------------------------------------------------------
    // Prescrição final (reconciliação atómica do motor coerente)
    // ---------------------------------------------------------------------
    const dynamicTargets = { ...targets, knee: getKneeTargetForRegime(targets.knee, 'dynamic') };
    const items = this._buildSyntheticItems(positions);
    // Os dados do passo 1 viajam para o motor coerente: é o que faz a largura do guiador pesar
    // contra os ombros e o crenque contra o cavalo também no vídeo, e não só nas fotos.
    const coherent = CoherentRecommendationEngine.build(items, dynamicTargets, {
      posture,
      athlete: equipment?.athlete || profile,
      bike: equipment?.bike || null,
      geometry: equipment?.geometry || null,
      profile,
      flexibility: equipment?.flexibility || profile?.flexibility || 'medium',
      // Os alvos que chegam aqui já trazem o deslocamento por flexibilidade aplicado pelo chamador
      // (a interface aplica-o em `configureModalityTargets`); sem equipamento, aplica-o o motor.
      flexibilityApplied: equipment?.flexibilityApplied === true,
    });

    const confidence = this._assessConfidence(phase, positions);
    const prescriptions = coherent.prescriptions.map((item) => this._attachStatistics(item, positions, phase));

    base.status = 'ready';
    base.locked = false;
    base.ready = true;
    base.lockReason = null;
    base.prescriptions = prescriptions;
    base.missingPositions = coherent.missingPositions;
    base.notices = [...(analysis.notes || []), ...coherent.notices];
    base.analyzedCount = items.length;
    base.confidence = confidence;
    base.score = CoherentRecommendationEngine.scoreOf(coherent);
    base.staticKneeTarget = targets.knee || [145, 155];
    base.dynamicKneeTarget = dynamicTargets.knee;
    base.equipment = coherent.equipment || null;
    // Resumo técnico (todos os dados fornecidos) e otimização por posição do pé: viajam com o
    // relatório final para a interface e para o texto exportado.
    base.dataAccounting = coherent.dataAccounting || null;
    base.positionOptimization = coherent.positionOptimization || [];
    base.technicalSummaryText = coherent.technicalSummaryText || null;
    base.flexibilityAdjust = coherent.flexibilityAdjust || null;
    base.verdict = this._verdict(prescriptions, confidence);
    base.verdictColor = prescriptions.length === 0 ? '#10b981' : confidence.level === 'high' ? '#f59e0b' : '#ef4444';
    return base;
  }

  /**
   * Agrega as passagens por posição em estatística robusta por métrica.
   * @private
   */
  static _aggregatePositions(passages = {}, targets = {}, posture = DEFAULT_POSTURE) {
    const positions = {};
    ANALYSIS_POSITION_ORDER.forEach((key) => {
      const entries = passages[key] || [];
      const rule = CRANK_POSITION_RULES[key];
      // A postura entra na autoridade: em aero o KOPS deixa de prescrever (ver postureMode.js).
      const authority = getPostureMetricAuthority({ posture, position: key });
      const observations = entries.map((entry) => entry.observation).filter(Boolean);
      const dynamicKneeTarget = getKneeTargetForRegime(targets.knee, 'dynamic');

      positions[key] = {
        key,
        label: rule.label,
        /** Onde está o pé nesta posição: o ângulo da perna só tem sentido com esta etiqueta. */
        footPositionPt: rule.footPositionPt,
        revolutions: new Set(entries.map((entry) => entry.revolution)).size,
        samples: entries.length,
        phaseErrorDeg: this._round(median(entries.map((entry) => entry.phaseErrorDeg))),
        phaseErrorMaxDeg: this._round(Math.max(0, ...entries.map((entry) => entry.phaseErrorDeg || 0))),
        times: entries.map((entry) => this._round(entry.time, 2)),
        medianAngles: this._medianAngles(observations),
        madAngles: this._madAngles(observations),
        kopsMedianMm: authority.kops
          ? this._round(median(observations.map((obs) => obs?.kops?.offsetMm)))
          : null,
        kopsMadMm: authority.kops
          ? this._round(medianAbsoluteDeviation(observations.map((obs) => obs?.kops?.offsetMm)))
          : null,
        // Fração de amostras desta posição com o atleta todo enquadrado: sem corpo inteiro as
        // medições de tronco/braço/cabeça são menos fiáveis e isso tem de ser dito.
        fullBodyRatio: observations.length
          ? Math.round((observations.filter((obs) => obs?.isFullBodyVisible).length / observations.length) * 100) / 100
          : null,
        metrics: this._positionMetrics({ observations, targets, authority, dynamicKneeTarget, posture, positionKey: key }),
      };
    });
    return positions;
  }

  /** Métricas avaliáveis nesta posição, com o alvo que a evidência autoriza. */
  static _positionMetrics({
    observations,
    targets,
    authority,
    dynamicKneeTarget,
    posture = DEFAULT_POSTURE,
    positionKey = 'custom',
  }) {
    const pickAngle = (name) => observations.map((obs) => obs?.angles?.[name]);
    const metrics = [];

    const add = (metric) => {
      if (metric) metrics.push(metric);
    };

    // Joelho: a POSIÇÃO DO PÉ manda no que o número significa. Só às 6h (pé em baixo) o joelho
    // prescreve altura de selim; nas outras posições mostra-se a janela de referência publicada
    // para AQUELA posição (o joelho às 12h é ~2x mais fletido do que às 6h — comparar os dois com
    // o mesmo alvo é um erro de leitura, e era o que o relatório fazia ao dizer só "descritivo").
    const kneeReference = getKneeReferenceForPosition(positionKey, {
      regime: 'dynamic',
      extensionRange: targets.knee,
    });
    add(
      this._metric({
        key: 'knee',
        label: 'Joelho (incluído)',
        unit: '°',
        values: pickAngle('joelho'),
        target: authority.knee === 'extension' ? dynamicKneeTarget : null,
        descriptive: authority.knee !== 'extension',
        referenceRange: authority.knee === 'extension' ? null : kneeReference.range,
        referenceKind: authority.knee === 'extension' ? 'target' : kneeReference.kind,
        referenceLabel: kneeReference.summary,
        referenceSources: kneeReference.sources,
        note:
          authority.knee === 'extension'
            ? kneeReference.summary
            : `${kneeReference.summary} ${CRANK_POSITION_RULES[positionKey]?.explanationPt || ''}`.trim(),
      })
    );

    add(
      this._metric({
        key: 'kops',
        label: 'KOPS (joelho vs eixo do pedal)',
        unit: 'mm',
        values: observations.map((obs) => obs?.kops?.offsetMm),
        target: authority.kops ? [-10, 10] : null,
        descriptive: !authority.kops,
        note: authority.kops
          ? 'Desvio horizontal no plano do cranque às 3h (valor positivo = joelho à frente do eixo do pedal).'
          : 'Em posição aero o KOPS não prescreve: a referência é o ângulo de assento (78–86°). Valor registado só para histórico.',
      })
    );

    add(
      this._metric({
        key: 'hipClosure',
        label: 'Fecho da anca (tronco coxa)',
        unit: '°',
        values: pickAngle('anca'),
        target: authority.hipClosure === true ? [50, 80] : null,
        descriptive: authority.hipClosure !== true,
        note: authority.hipClosure === true ? 'Avalia risco de pinçamento femoroacetabular às 12h.' : null,
      })
    );

    add(
      this._metric({
        key: 'trunk',
        label: 'Inclinação do tronco',
        unit: '°',
        values: pickAngle('costas'),
        target: targets.back || [40, 50],
        note:
          posture === POSTURE_AERO
            ? 'Em aero, o tronco plano (10–30°) é o objetivo: orienta o stack/almofadas. Abaixo de ~10° o ganho é pequeno e o custo cai na anca e na respiração.'
            : 'Orienta apenas os espaçadores (stack); medido em todas as posições.',
      })
    );

    add(
      this._metric({
        key: 'elbow',
        label: 'Ângulo do cotovelo',
        unit: '°',
        values: pickAngle('braco'),
        target: targets.elbow || [150, 165],
        note:
          posture === POSTURE_AERO
            ? 'Em aero o cotovelo fica claramente fletido sobre as almofadas: este intervalo é prática de fit, não uma norma publicada. Orienta os apoios/extensões.'
            : 'Orienta apenas o comprimento do avanço (reach).',
      })
    );

    // Antebraço: só existe alvo em AERO (referência 0–20°, partida 5–10° — Velogicfit).
    if (posture === POSTURE_AERO && Array.isArray(targets.antebraco)) {
      add(
        this._metric({
          key: 'forearm',
          label: 'Antebraço (elevação face à horizontal)',
          unit: '°',
          values: pickAngle('antebraco'),
          target: targets.antebraco,
          note: 'Assinatura da posição aero: antebraço quase nivelado sobre as almofadas, punhos descarregados.',
        })
      );
    }

    add(
      this._metric({
        key: 'ankle',
        label: 'Ângulo do tornozelo',
        unit: '°',
        values: pickAngle('tornozelo'),
        target: authority.ankle === true ? targets.ankle || [95, 105] : null,
        descriptive: authority.ankle !== true,
        note: authority.ankle === true ? 'Referência para posição dos travessões.' : 'Descritivo nesta posição.',
      })
    );

    add(
      this._metric({
        key: 'head',
        label: 'Cabeça / pescoço',
        unit: '°',
        values: pickAngle('cabeca'),
        target: null,
        descriptive: true,
        note: 'Sem alvo numérico universal na literatura: avaliar estabilidade e capacidade de olhar em frente.',
      })
    );

    return metrics;
  }

  /** Constrói uma métrica estatística (mediana + MAD + estado). */
  static _metric({
    key,
    label,
    unit,
    values,
    target,
    descriptive = false,
    note = null,
    referenceRange = null,
    referenceKind = null,
    referenceLabel = null,
    referenceSources = null,
  }) {
    const clean = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (!clean.length) return null;
    const value = this._round(median(clean));
    const mad = this._round(medianAbsoluteDeviation(clean));
    let status = 'descriptive';
    if (!descriptive && Array.isArray(target)) {
      const [min, max] = target;
      if (value < min) status = value < min - 5 ? 'danger' : 'warning';
      else if (value > max) status = value > max + 5 ? 'danger' : 'warning';
      else status = 'ok';
    }
    return {
      key,
      label,
      unit,
      value,
      mad,
      min: clean.length ? this._round(Math.min(...clean)) : null,
      max: clean.length ? this._round(Math.max(...clean)) : null,
      n: clean.length,
      target: Array.isArray(target) ? [...target] : null,
      descriptive,
      status,
      note,
      deviation: this._deviationText(value, target),
      // Janela de contexto da POSIÇÃO (não é ordem de ajuste: `target` continua a ser o único
      // campo que prescreve). É isto que torna o relatório fiel à posição do pé.
      referenceRange: Array.isArray(referenceRange) ? [...referenceRange] : null,
      referenceKind,
      referenceLabel,
      referenceSources: Array.isArray(referenceSources) ? [...referenceSources] : null,
    };
  }

  static _deviationText(value, target) {
    if (!Array.isArray(target) || value === null) return null;
    const [min, max] = target;
    if (value < min) return `${this._round(min - value)} abaixo do mínimo`;
    if (value > max) return `${this._round(value - max)} acima do máximo`;
    return 'dentro do alvo';
  }

  static _medianAngles(observations) {
    const keys = ['joelho', 'costas', 'braco', 'tornozelo', 'cabeca', 'anca', 'antebraco'];
    const out = {};
    keys.forEach((name) => {
      const values = observations.map((obs) => obs?.angles?.[name]);
      out[name] = this._round(median(values));
    });
    return out;
  }

  static _madAngles(observations) {
    const keys = ['joelho', 'costas', 'braco', 'tornozelo', 'cabeca', 'anca', 'antebraco'];
    const out = {};
    keys.forEach((name) => {
      const values = observations.map((obs) => obs?.angles?.[name]);
      out[name] = this._round(medianAbsoluteDeviation(values));
    });
    return out;
  }

  /** Itens sintéticos (um por posição) para a reconciliação do motor coerente. */
  static _buildSyntheticItems(positions = {}) {
    const items = [];
    ANALYSIS_POSITION_ORDER.forEach((key) => {
      const position = positions[key];
      if (!position || !position.revolutions) return;
      const offMm = position.kopsMedianMm;
      items.push({
        name: `${position.label} · ${position.revolutions} pedalada(s)`,
        status: 'done',
        crankPosition: key,
        angles: { ...position.medianAngles },
        kopsResult: typeof offMm === 'number' ? { offsetMm: offMm } : null,
        isFullBodyVisible: true,
        position,
      });
    });
    return items;
  }

  /** Anexa a prova estatística (nº de pedaladas, dispersão, erro de fase) a cada prescrição. */
  static _attachStatistics(item, positions = {}, phase = null) {
    const sourceKey = this.EVIDENCE_BY_COMPONENT[item.key];
    const position = positions[sourceKey] || null;
    const metricKey = { saddleHeight: 'knee', saddleForeAft: 'kops', stack: 'trunk', reach: 'elbow', ankle: 'ankle' }[item.key];
    const metric = position?.metrics?.find((m) => m.key === metricKey) || null;

    const statistics = position
      ? {
          position: position.label,
          positionKey: position.key || sourceKey,
          footPositionPt: position.footPositionPt || null,
          revolutions: position.revolutions,
          samples: position.samples,
          median: metric?.value ?? null,
          mad: metric?.mad ?? null,
          min: metric?.min ?? null,
          max: metric?.max ?? null,
          phaseErrorDeg: position.phaseErrorDeg,
          cadenceRpm: phase?.cadenceRpm ?? null,
          target: metric?.target || item.target || null,
        }
      : null;

    const evidenceLine = position
      ? `${position.label}: mediana de ${position.revolutions} pedalada(s)` +
        (metric?.mad !== null && metric?.mad !== undefined ? `, dispersão (MAD) ±${metric.mad}${metric.unit || ''}` : '') +
        (typeof position.phaseErrorDeg === 'number' ? `, erro de fase médio ${position.phaseErrorDeg}°` : '')
      : 'análise integral do vídeo';

    return {
      ...item,
      statistics,
      evidence: [evidenceLine],
      source: position ? `Vídeo completo — ${position.label}` : 'Vídeo completo',
      degreesInfo: metric?.value !== null && metric?.value !== undefined
        ? `${item.degreesInfo} (mediana de ${position.revolutions} pedaladas)`
        : item.degreesInfo,
    };
  }

  /** Nível de confiança explícito — o utilizador tem de saber com que força acreditar. */
  static _assessConfidence(phase, positions = {}) {
    let score = 100;
    const reasons = [];
    const used = Math.min(
      ...['bdc', '90deg'].map((key) => positions[key]?.revolutions ?? 0)
    );
    const total = phase?.completeRevolutions || 0;

    if (used < RECOMMENDED_REVOLUTIONS) {
      const penalty = Math.min(40, (RECOMMENDED_REVOLUTIONS - used) * 5);
      score -= penalty;
      reasons.push(`${used} pedalada(s) válida(s) na posição avaliada (recomendado: ${RECOMMENDED_REVOLUTIONS}).`);
    }
    if (used < MIN_REVOLUTIONS_FOR_PRESCRIPTION) {
      reasons.push(`Abaixo do mínimo de ${MIN_REVOLUTIONS_FOR_PRESCRIPTION} pedaladas — a prescrição é indicativa.`);
    }
    if (total > 0 && total < MIN_REVOLUTIONS_FOR_PRESCRIPTION) {
      reasons.push(`O vídeo só contém ${total} pedalada(s) completa(s).`);
    }

    const kneeMad = positions.bdc?.metrics?.find((m) => m.key === 'knee')?.mad;
    if (typeof kneeMad === 'number') {
      if (kneeMad > 6) {
        score -= 30;
        reasons.push(`Dispersão alta da extensão do joelho entre pedaladas (MAD ±${kneeMad}°).`);
      } else if (kneeMad > 3) {
        score -= 15;
        reasons.push(`Dispersão moderada da extensão do joelho (MAD ±${kneeMad}°).`);
      }
    }
    const kopsMad = positions['90deg']?.kopsMadMm;
    if (typeof kopsMad === 'number' && kopsMad > 3) {
      score -= 15;
      reasons.push(`Dispersão do KOPS entre pedaladas (MAD ±${kopsMad} mm).`);
    }
    if ((phase?.rejected || []).length) {
      score -= 10;
      reasons.push(`${phase.rejected.length} fotograma(s) rejeitado(s) por erro de fase acima da janela.`);
    }
    const phaseErrors = ['bdc', '90deg'].map((key) => positions[key]?.phaseErrorMaxDeg).filter((v) => typeof v === 'number');
    if (phaseErrors.length && Math.max(...phaseErrors) > phase.windowDeg) {
      score -= 10;
      reasons.push('Erro de fase acima da janela em algumas amostras (a medição não caiu exatamente na posição).');
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const level = score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low';
    const label = { high: 'Alta', medium: 'Média', low: 'Baixa' }[level];
    if (!reasons.length) reasons.push('Análise completa com dispersão baixa entre pedaladas.');
    return { level, score, label, reasons };
  }

  static _verdict(prescriptions = [], confidence) {
    if (!prescriptions.length) return 'Nenhum desvio fora da tolerância — bicicleta afinada à medida.';
    return `${prescriptions.length} componente(s) a ajustar · confiança ${confidence.label.toLowerCase()}`;
  }

  static _flattenMetrics(positions = {}) {
    const rows = [];
    ANALYSIS_POSITION_ORDER.forEach((key) => {
      (positions[key]?.metrics || []).forEach((metric) => {
        rows.push({
          position: key,
          positionLabel: positions[key].label,
          positionFootPt: positions[key].footPositionPt || null,
          ...metric,
        });
      });
    });
    return rows;
  }

  static _round(value, decimals = 1) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  /**
   * Vista pronta para a interface: mantém os painéis clínicos existentes a funcionar
   * (formato `items`) e acrescenta a estatística da análise integral.
   *
   * Em estado bloqueado devolve `items: []` — é isso que garante que nada é mostrado
   * como recomendação antes de o vídeo estar todo analisado.
   */
  static toReportView(result) {
    if (!result) return null;

    const items = [];
    // Só um resultado PRONTO produz itens. Um estado pendente/insuficiente não pode mostrar
    // nada no painel clínico — é a garantia de "nenhuma recomendação antes da análise completa".
    if (result.status !== 'ready') {
      return {
        ...result,
        items,
        timestamp: new Date().toLocaleTimeString('pt-PT'),
        score: result.score ?? 0,
      };
    }

    (result.prescriptions || []).forEach((prescription) => {
      items.push({
        component: prescription.component,
        action: prescription.action,
        whatToDo: prescription.whatToDo,
        degreesInfo: prescription.degreesInfo,
        why: prescription.why,
        harmDone: prescription.harmDone,
        status: prescription.status,
        badge: prescription.badge,
        // A posição do pé onde esta ordem foi medida: sem ela o ângulo não é interpretável.
        position: prescription.statistics?.positionKey || null,
        positionLabel: prescription.statistics?.position || null,
        positionFoot: prescription.statistics?.footPositionPt || null,
        measured:
          prescription.statistics?.median !== null && prescription.statistics?.median !== undefined
            ? String(prescription.statistics.median)
            : null,
        target: Array.isArray(prescription.statistics?.target)
          ? `${prescription.statistics.target[0]} – ${prescription.statistics.target[1]}`
          : null,
        detail: prescription.statistics
          ? `Mediana de ${prescription.statistics.revolutions} pedalada(s) em ${prescription.statistics.position}; dispersão (MAD) ±${prescription.statistics.mad}; erro de fase ${prescription.statistics.phaseErrorDeg}°.`
          : null,
        evidence: prescription.evidence,
        statistics: prescription.statistics,
        source: prescription.source,
      });
    });

    // Medições DESCRITIVAS (sem alvo universal na evidência) entram como informação, não
    // como ordem de ajuste: `status: 'ok'` mantém-nas fora da lista de não-conformidades.
    (result.metrics || [])
      .filter((metric) => metric.descriptive)
      .forEach((metric) => {
        const positionLabel = metric.positionLabel || result.positions?.[metric.position]?.label;
        items.push({
          position: metric.position || null,
          positionLabel: positionLabel || null,
          positionFoot: metric.positionFootPt || null,
          referenceRange: metric.referenceRange || null,
          referenceLabel: metric.referenceLabel || null,
          component: `${metric.label}${positionLabel ? ` — ${positionLabel}` : ''}`,
          action: 'Sem alteração prescrita',
          whatToDo: 'Manter: esta medição é descritiva nesta posição (a evidência não suporta um alvo universal).',
          degreesInfo: `Mediana ${metric.value}${metric.unit} (MAD ±${metric.mad}${metric.unit}, ${metric.n} amostra(s)).`,
          why: metric.note || 'Sem alvo numérico validado na literatura para esta posição.',
          harmDone: 'Nenhum: não se inventa um alvo onde a evidência não o sustenta.',
          status: 'ok',
          badge: 'ℹ️ DESCRITIVO',
          measured: `${metric.value}${metric.unit}`,
          target: null,
          detail: metric.note,
          descriptive: true,
        });
      });

    return {
      ...result,
      items,
      timestamp: new Date().toLocaleTimeString('pt-PT'),
      score: result.score ?? 0,
    };
  }

  /**
   * Relatório final em texto, pronto a copiar/imprimir. Inclui o perfil do atleta,
   * a estatística por posição e a declaração de imutabilidade.
   */
  static formatText(result, { athleteName = 'Ciclista', bikeModel = 'Bicicleta' } = {}) {
    let txt = '======================================================================\n';
    txt += '  ATHLETE MOTION — RELATÓRIO FINAL ÚNICO (ANÁLISE INTEGRAL DO VÍDEO)\n';
    txt += '======================================================================\n';
    txt += `Atleta: ${athleteName} | Bicicleta: ${bikeModel}\n`;
    txt += `Vídeo: ${result.video?.name || '—'} | Duração: ${(result.video?.durationSeconds || 0).toFixed(2)}s\n`;
    txt += `Perfil: ${result.profileLine || '—'}\n`;
    if (result.posture?.targetsLine) {
      txt += `${result.posture.targetsLine}\n`;
      txt += `Fontes dos alvos: ${(result.posture.sources || []).join(' · ')}\n`;
    }
    if (result.posture?.detection?.sufficient) {
      txt += `Deteção de postura: ${result.posture.detection.reasons.join(' | ')}\n`;
    }
    txt += `Data/Hora: ${new Date().toLocaleString('pt-PT')}\n\n`;

    if (result.status !== 'ready') {
      txt += `PRESCRIÇÃO INDISPONÍVEL (${result.status.toUpperCase()}):\n`;
      if (result.lockReason) txt += ` - ${result.lockReason}\n`;
      result.notices.forEach((n) => (txt += ` - ${n}\n`));
      txt += '======================================================================\n';
      return txt;
    }

    const scan = result.scan || {};
    txt += 'COMO FOI MEDIDO:\n';
    txt += ` - Vídeo varrido na totalidade (passo da malha ${(scan.stepSeconds || 0).toFixed(3)}s).\n`;
    txt += ` - Amostras com pose: ${scan.samples ?? '—'} | sem pose: ${scan.failures ?? '—'}.\n`;
    txt += ` - Pedaladas completas detetadas: ${result.phase?.completeRevolutions ?? '—'} | Cadência: ${result.phase?.cadenceRpm ?? '—'} rpm.\n`;
    txt += ` - Direção do pedalar: ${result.phase?.direction === 'mirrored' ? 'perfil virado à esquerda' : 'perfil virado à direita'}.\n`;
    txt += ` - Confiança da prescrição: ${result.confidence.label} (${result.confidence.score}/100).\n`;
    result.confidence.reasons.forEach((r) => (txt += `     · ${r}\n`));
    txt += '\n';

    txt += 'MEDIÇÕES POR POSIÇÃO DO CRANQUE:\n';
    ANALYSIS_POSITION_ORDER.forEach((key) => {
      const pos = result.positions?.[key];
      if (!pos || !pos.revolutions) return;
      txt += `----------------------------------------------------------------------\n`;
      txt += `${pos.label} — ${pos.footPositionPt || 'posição do pé não registada'} — ${pos.revolutions} pedalada(s) válida(s)\n`;
      txt += `   Erro de fase médio: ${pos.phaseErrorDeg}° (janela ±${result.phase?.windowDeg}°)\n`;
      pos.metrics.forEach((metric) => {
        // O joelho leva a janela da SUA posição: um joelho a 12h não se compara com um a 6h.
        const target = metric.target
          ? ` [alvo ${metric.target[0]}–${metric.target[1]}${metric.unit}]`
          : Array.isArray(metric.referenceRange)
            ? ` [referência nesta posição ${metric.referenceRange[0]}–${metric.referenceRange[1]}${metric.unit}]`
            : ' [descritivo]';
        txt += `   · ${metric.label}: ${metric.value}${metric.unit} (MAD ±${metric.mad}${metric.unit})${target} → ${metric.status.toUpperCase()}\n`;
        if (metric.referenceLabel) txt += `       posição do pé: ${metric.referenceLabel}\n`;
      });
    });

    if (result.profileNotes?.length) {
      txt += '\nDADOS ANTROPOMÉTRICOS E NOTAS MECÂNICAS:\n';
      result.profileNotes.forEach((note) => {
        txt += ` - ${note.label}: ${note.text}\n   (fonte: ${note.source})\n`;
      });
    }

    if (result.missingPositions?.length) {
      txt += `\n⚠️ POSIÇÕES EM FALTA: ${result.missingPositions.join(', ')} — esses componentes não foram prescritos.\n`;
    }

    if (!result.prescriptions.length) {
      txt += '\n✅ Nenhum desvio fora da tolerância.\n';
    } else {
      txt += '\nAFINAÇÕES PRESCRITAS (UMA ÚNICA DIREÇÃO POR COMPONENTE):\n';
      result.prescriptions.forEach((item, idx) => {
        txt += `----------------------------------------------------------------------\n`;
        txt += `${idx + 1}. [${item.component}] — ${item.badge}\n`;
        txt += `   🔧 O QUE FAZER: ${item.whatToDo}\n`;
        txt += `   📐 ONDE ESTÁ MAL: ${item.degreesInfo}\n`;
        txt += `   📊 PROVA: ${item.evidence.join(' | ')}\n`;
        txt += `   💡 PORQUÊ: ${item.why}\n`;
        txt += `   ⚠️ DANO EVITADO: ${item.harmDone}\n`;
      });
    }

    if (result.notices?.length) {
      txt += '\nAVISOS:\n';
      result.notices.forEach((n) => (txt += ` - ${n}\n`));
    }
    txt += '\nEste relatório é FINAL: foi calculado depois de analisar o vídeo inteiro e não\n';
    txt += 'muda com o avançar da reprodução.\n';
    txt += '======================================================================\n';

    // O resumo técnico (em que contribuiu cada dado fornecido) acompanha o relatório final: era o
    // pedido explícito — todos os dados têm de contar no resumo de ajuste técnico.
    if (result.technicalSummaryText) {
      txt += `\n${result.technicalSummaryText}`;
    }
    return txt;
  }
}

export default FinalPrescriptionEngine;
