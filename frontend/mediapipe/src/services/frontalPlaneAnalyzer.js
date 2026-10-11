/**
 * Analisador de Alinhamento no Plano Frontal (Valgo / Varo Dinâmico e Fator Q).
 *
 * Em visão frontal, o joelho deve mover-se num plano predominantemente vertical.
 * O colapso medial (para o interior / em direção ao quadro) caracteriza o Valgo Dinâmico,
 * gerando sobrecarga na patela e na banda iliotibial.
 */
export class FrontalPlaneAnalyzer {
  constructor(toleranceMm = 12.0) {
    this.toleranceMm = toleranceMm;
    this.history = [];
    this.maxDeviationMm = 0;
  }

  reset() {
    this.history = [];
    this.maxDeviationMm = 0;
  }

  /**
   * Avalia o desvio lateral do joelho em relação à linha imaginária anca-tornozelo.
   *
   * @param {Object} hip - { x, y }
   * @param {Object} knee - { x, y }
   * @param {Object} ankle - { x, y }
   * @param {string} side - 'left' ou 'right'
   * @param {number} pixelsPerMm - Escala métrica
   */
  evaluateKneeTracking(hip, knee, ankle, side = 'right', pixelsPerMm = 1.8) {
    if (!hip || !knee || !ankle) return null;

    // Linha vertical de referência que conecta anca e tornozelo
    const dy = ankle.y - hip.y;
    if (Math.abs(dy) < 10) return null;

    const t = (knee.y - hip.y) / dy;
    const refX = hip.x + t * (ankle.x - hip.x);

    // Desvio em pixels
    const deltaXPixels = knee.x - refX;

    // Em milímetros reais
    const deviationMm = Math.round((deltaXPixels / pixelsPerMm) * 10) / 10;
    this.history.push(deviationMm);
    if (this.history.length > 60) this.history.shift();

    if (Math.abs(deviationMm) > Math.abs(this.maxDeviationMm)) {
      this.maxDeviationMm = deviationMm;
    }

    // Para a perna direita (lado esquerdo do observador se de frente):
    // Se o joelho desviar para a esquerda do observador (x menor), cai para o interior (Valgo).
    // Se o joelho desviar para a direita (x maior), afasta-se para o exterior (Varo).
    const absDev = Math.abs(deviationMm);
    let condition = 'neutral';
    let labelPt = 'Alinhamento Frontal Perfeito';
    let labelEn = 'Optimal Frontal Alignment';
    let recommendationPt = 'Trajetória linear saudável do joelho sem oscilações laterais nocivas.';
    let recommendationEn = 'Healthy linear knee tracking without harmful lateral oscillation.';

    if (absDev > this.toleranceMm) {
      const isValgus = (side === 'right' && deviationMm < 0) || (side === 'left' && deviationMm > 0);

      if (isValgus) {
        condition = 'valgus';
        labelPt = `Valgo Dinâmico (${absDev} mm)`;
        labelEn = `Dynamic Valgus (${absDev} mm)`;
        recommendationPt = (
          `O joelho colapsa para o interior na fase de força. ` +
          `Recomenda-se aumentar o Fator Q (afastar os taquinhos para o interior do sapato ou adicionar espaçador de pedal de 1-2mm) ` +
          `e utilizar palmilhas com suporte de arco plantar para estabilizar a pronação do pé.`
        );
        recommendationEn = (
          `Knee collapses inward during downstroke. ` +
          `Increasing Q-Factor (moving cleats inward or adding 1-2mm pedal axle washers) ` +
          `and using arch-support cycling insoles is recommended.`
        );
      } else {
        condition = 'varus';
        labelPt = `Varo Dinâmico (${absDev} mm)`;
        labelEn = `Dynamic Varus (${absDev} mm)`;
        recommendationPt = (
          `O joelho projeta-se excessivamente para o exterior. ` +
          `Considere reduzir o Fator Q (aproximar os taquinhos da manivela do pedivela).`
        );
        recommendationEn = (
          `Knee flares excessively outward. ` +
          `Consider reducing Q-Factor by moving cleats closer to the crank arm.`
        );
      }
    }

    return {
      deviationMm,
      maxDeviationMm: this.maxDeviationMm,
      condition,
      isAligned: condition === 'neutral',
      labelPt,
      labelEn,
      recommendationPt,
      recommendationEn,
      refX,
      kneeX: knee.x,
      kneeY: knee.y,
    };
  }

  drawTrackingGuide(ctx, hip, knee, ankle, refX, isAligned) {
    if (!ctx || !hip || !knee || !ankle) return;

    ctx.save();
    // Linha neutra de referência
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(ankle.x, ankle.y);
    ctx.stroke();

    // Desvio do joelho
    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = isAligned ? '#10b981' : '#ef4444';
    ctx.beginPath();
    ctx.moveTo(refX, knee.y);
    ctx.lineTo(knee.x, knee.y);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Método de análise no plano frontal compatível com LiveCameraCapture.
   * Suporta coordenadas normalizadas [0.0 - 1.0] ou em píxeis.
   * 
   * @param {Object} hip - Centro da anca { x, y }
   * @param {Object} knee - Ponto do joelho { x, y }
   * @param {Object} ankle - Ponto do tornozelo { x, y }
   * @param {number} [w=640] - Largura do canvas
   * @param {number} [h=480] - Altura do canvas
   * @param {string} [side='right'] - Lado observado ('left' | 'right')
   * @param {number} [pixelsPerMm=1.8] - Escala métrica
   * @returns {Object} Resultado do alinhamento frontal
   */
  analyze(hip, knee, ankle, w = 640, h = 480, side = 'right', pixelsPerMm = 1.8) {
    if (!hip || !knee || !ankle) return null;

    const hipPx = {
      x: hip.x <= 1.05 ? hip.x * w : hip.x,
      y: hip.y <= 1.05 ? hip.y * h : hip.y,
    };
    const kneePx = {
      x: knee.x <= 1.05 ? knee.x * w : knee.x,
      y: knee.y <= 1.05 ? knee.y * h : knee.y,
    };
    const anklePx = {
      x: ankle.x <= 1.05 ? ankle.x * w : ankle.x,
      y: ankle.y <= 1.05 ? ankle.y * h : ankle.y,
    };

    return this.evaluateKneeTracking(hipPx, kneePx, anklePx, side, pixelsPerMm);
  }

  /**
   * Desenha os eixos e guias de alinhamento frontal no canvas.
   * Suporta coordenadas normalizadas ou em píxeis.
   */
  drawFrontalAxes(ctx, hip, knee, ankle, w = 640, h = 480) {
    if (!ctx || !hip || !knee || !ankle) return;

    const hipPx = {
      x: hip.x <= 1.05 ? hip.x * w : hip.x,
      y: hip.y <= 1.05 ? hip.y * h : hip.y,
    };
    const kneePx = {
      x: knee.x <= 1.05 ? knee.x * w : knee.x,
      y: knee.y <= 1.05 ? knee.y * h : knee.y,
    };
    const anklePx = {
      x: ankle.x <= 1.05 ? ankle.x * w : ankle.x,
      y: ankle.y <= 1.05 ? ankle.y * h : ankle.y,
    };

    const dy = anklePx.y - hipPx.y;
    if (Math.abs(dy) < 10) return;
    const t = (kneePx.y - hipPx.y) / dy;
    const refX = hipPx.x + t * (anklePx.x - hipPx.x);

    const isAligned =
      this.history.length > 0
        ? Math.abs(this.history[this.history.length - 1]) <= this.toleranceMm
        : true;

    this.drawTrackingGuide(ctx, hipPx, kneePx, anklePx, refX, isAligned);
  }
}

