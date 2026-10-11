/**
 * Motor de Cálculo Angular e Atualização de Telemetria Biomecânica (BiomechanicsComputer).
 *
 * Responsabilidade:
 * - Calcular ângulos articulares seguros via produto escalar com clamping estrito anti-NaN.
 * - Calcular inclinação angular face à horizontal.
 * - Extrair pontos ajustados (manuais vs landmarks brutos) e avaliar limiares ergonómicos.
 */

export class BiomechanicsComputer {
  /**
   * Cálculo seguro de ângulo formado pelos segmentos AB e CB no vértice B.
   */
  static calculateSafeAngle(a, b, c) {
    if (!a || !b || !c) return null;
    const v1x = a.x - b.x;
    const v1y = a.y - b.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;

    const mag1 = Math.hypot(v1x, v1y);
    const mag2 = Math.hypot(v2x, v2y);
    if (mag1 === 0 || mag2 === 0) return 0;

    const dot = v1x * v2x + v1y * v2y;
    let cosVal = dot / (mag1 * mag2);
    cosVal = Math.max(-1.0, Math.min(1.0, cosVal));
    return Math.round(Math.acos(cosVal) * (180 / Math.PI) * 10) / 10;
  }

  /**
   * Ângulo de inclinação em relação ao eixo horizontal [0, 90].
   */
  static calculateInclination(bottom, top) {
    if (!bottom || !top) return null;
    const dx = Math.abs(top.x - bottom.x);
    const dy = Math.abs(top.y - bottom.y);
    const rad = Math.atan2(dy, dx);
    return Math.round(rad * (180 / Math.PI) * 10) / 10;
  }

  /**
   * Verifica se um marco anatómico está visível e dentro do enquadramento da câmara.
   */
  static isLandmarkVisible(p, minVisibility = 0.35) {
    if (!p) return false;
    if (typeof p.visibility === 'number' && p.visibility < minVisibility) return false;
    if (p.x < -0.05 || p.x > 1.05 || p.y < -0.05 || p.y > 1.05) return false;
    return true;
  }

  /**
   * Extrai e calcula todos os ângulos instantâneos e valida integridade de corpo inteiro.
   */
  static computeFrameAngles({ lm, side, manualTracker }) {
    if (!lm || lm.length < 33) {
      return {
        joelho: null,
        costas: null,
        braco: null,
        tornozelo: null,
        cabeca: null,
        points: {},
        isFullBodyVisible: false,
        missingSegments: ['Cabeça', 'Braços', 'Tronco', 'Pernas'],
      };
    }

    const isLeft = side === 'left';
    // No MediaPipe Pose oficial: Índices ímpares são ESQUERDOS, índices pares são DIREITOS (Lado da transmissão)
    const earIdx = isLeft ? 7 : 8;
    const noseIdx = 0;
    const hipIdx = isLeft ? 23 : 24;
    const kneeIdx = isLeft ? 25 : 26;
    const ankleIdx = isLeft ? 27 : 28;
    const footIdx = isLeft ? 31 : 32;
    const shoulderIdx = isLeft ? 11 : 12;
    const elbowIdx = isLeft ? 13 : 14;
    const wristIdx = isLeft ? 15 : 16;

    const headPt = lm[earIdx] || lm[noseIdx];
    const kneePt = manualTracker ? manualTracker.getAdjustedPoint('knee', lm[kneeIdx]) : lm[kneeIdx];
    const hipPt = manualTracker ? manualTracker.getAdjustedPoint('hip', lm[hipIdx]) : lm[hipIdx];
    const anklePt = manualTracker ? manualTracker.getAdjustedPoint('ankle', lm[ankleIdx]) : lm[ankleIdx];
    const shoulderPt = manualTracker ? manualTracker.getAdjustedPoint('shoulder', lm[shoulderIdx]) : lm[shoulderIdx];
    const elbowPt = manualTracker ? manualTracker.getAdjustedPoint('elbow', lm[elbowIdx]) : lm[elbowIdx];
    const footPt = lm[footIdx];
    const wristPt = lm[wristIdx];

    // Avaliação de visibilidade do corpo inteiro (cabeça, braços, tronco e pernas)
    const headVisible = this.isLandmarkVisible(lm[noseIdx]) || this.isLandmarkVisible(lm[earIdx]);
    const armVisible = this.isLandmarkVisible(shoulderPt) && this.isLandmarkVisible(elbowPt) && this.isLandmarkVisible(wristPt);
    const torsoVisible = this.isLandmarkVisible(shoulderPt) && this.isLandmarkVisible(hipPt);
    const legVisible = this.isLandmarkVisible(hipPt) && this.isLandmarkVisible(kneePt) && this.isLandmarkVisible(anklePt);

    const missingSegments = [];
    if (!headVisible) missingSegments.push('Cabeça');
    if (!armVisible) missingSegments.push('Braços');
    if (!torsoVisible) missingSegments.push('Tronco');
    if (!legVisible) missingSegments.push('Pernas');

    const isFullBodyVisible = missingSegments.length === 0;

    return {
      joelho: this.calculateSafeAngle(hipPt, kneePt, anklePt),
      costas: this.calculateInclination(hipPt, shoulderPt),
      braco: this.calculateSafeAngle(shoulderPt, elbowPt, wristPt),
      tornozelo: this.calculateSafeAngle(kneePt, anklePt, footPt),
      cabeca: this.calculateInclination(shoulderPt, headPt),
      anca: this.calculateSafeAngle(shoulderPt, hipPt, kneePt),
      points: { kneePt, hipPt, anklePt, shoulderPt, elbowPt, footPt, wristPt, headPt },
      visibility: { headVisible, armVisible, torsoVisible, legVisible },
      isFullBodyVisible,
      missingSegments,
    };
  }
}
