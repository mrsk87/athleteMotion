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
   * Extrai e calcula todos os 4 ângulos instantâneos a partir dos marcos corporais.
   */
  static computeFrameAngles({ lm, side, manualTracker }) {
    if (!lm || lm.length < 33) {
      return { joelho: null, costas: null, braco: null, tornozelo: null };
    }

    const isLeft = side === 'left';
    const hipIdx = isLeft ? 24 : 23;
    const kneeIdx = isLeft ? 26 : 25;
    const ankleIdx = isLeft ? 28 : 27;
    const footIdx = isLeft ? 32 : 31;
    const shoulderIdx = isLeft ? 12 : 11;
    const elbowIdx = isLeft ? 14 : 13;
    const wristIdx = isLeft ? 16 : 15;

    const kneePt = manualTracker ? manualTracker.getAdjustedPoint('knee', lm[kneeIdx]) : lm[kneeIdx];
    const hipPt = manualTracker ? manualTracker.getAdjustedPoint('hip', lm[hipIdx]) : lm[hipIdx];
    const anklePt = manualTracker ? manualTracker.getAdjustedPoint('ankle', lm[ankleIdx]) : lm[ankleIdx];
    const shoulderPt = manualTracker ? manualTracker.getAdjustedPoint('shoulder', lm[shoulderIdx]) : lm[shoulderIdx];
    const elbowPt = manualTracker ? manualTracker.getAdjustedPoint('elbow', lm[elbowIdx]) : lm[elbowIdx];
    const footPt = lm[footIdx];
    const wristPt = lm[wristIdx];

    return {
      joelho: this.calculateSafeAngle(hipPt, kneePt, anklePt),
      costas: this.calculateInclination(hipPt, shoulderPt),
      braco: this.calculateSafeAngle(shoulderPt, elbowPt, wristPt),
      tornozelo: this.calculateSafeAngle(kneePt, anklePt, footPt),
      points: { kneePt, hipPt, anklePt, shoulderPt, elbowPt, footPt, wristPt },
    };
  }
}
