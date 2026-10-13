/**
 * Analisador de Alinhamento KOPS (Knee Over Pedal Spindle) e Linha de Prumo Virtual.
 *
 * Determina o avanço ou recuo do selim quando a biela está a 90° (posição horizontal das 3 horas).
 * Uma linha de prumo que desce da tuberosidade anterior da tíbia (frente do joelho)
 * deve coincidir verticalmente com o centro do eixo do pedal.
 */
export class KopsAnalyzer {
  constructor(toleranceMm = 5.0) {
    this.toleranceMm = toleranceMm;
    this.lastOffsetMm = 0;
    this.lastStatus = 'aligned';
    this.isCrankAt90 = false;
  }

  /**
   * Avalia a posição da biela e calcula o desvio horizontal entre o joelho e o eixo do pedal.
   *
   * @param {Object} knee - Ponto do joelho { x, y } (em pixels ou normalizado)
   * @param {Object} pedal - Ponto do pé/pedal { x, y }
   * @param {Object} hip - Ponto da anca { x, y }
   * @param {number} pixelsPerMm - Fator de calibração métrica opcional
   */
  evaluate(knee, pedal, hip, pixelsPerMm = null) {
    if (!knee || !pedal || !hip) {
      return null;
    }

    // A perna está próxima dos 90° (3 horas) quando o joelho está flexionado em ~90°-105°
    // e o vetor anca-joelho está próximo da horizontal inclinada para a frente
    const deltaY = pedal.y - hip.y;
    const legSpan = Math.abs(pedal.y - knee.y);

    // Detectar fase de potência intermediária (posição das 3 horas)
    // O joelho e o pedal estão ambos projetados para a frente em relação à anca
    this.isCrankAt90 = deltaY > 0 && legSpan > 20;

    // Calcular diferença horizontal: Joelho.x - Pedal.x
    // Em perfil voltado para a direita: se Joelho.x > Pedal.x, joelho está à frente do pedal.
    // Em perfil voltado para a esquerda: se Joelho.x < Pedal.x, joelho está à frente.
    const isFacingRight = knee.x > hip.x;
    let rawDeltaX = knee.x - pedal.x;
    if (!isFacingRight) {
      rawDeltaX = -rawDeltaX;
    }

    let offsetMm = 0;
    if (pixelsPerMm && pixelsPerMm > 0) {
      offsetMm = rawDeltaX / pixelsPerMm;
    } else {
      // Estimativa geométrica padrão quando a escala métrica ainda não foi calibrada
      // Assumindo ~1.8 pixels por milímetro em vídeo padrão 720p/1080p
      offsetMm = rawDeltaX * 0.55;
    }

    offsetMm = Math.round(offsetMm * 10) / 10;
    this.lastOffsetMm = offsetMm;

    let verdict = 'aligned';
    let labelPt = 'KOPS Neutro / Alinhado';
    let labelEn = 'KOPS Neutral / Aligned';
    let actionPt = 'Manter posição horizontal do selim';
    let actionEn = 'Maintain saddle fore/aft position';

    if (offsetMm > this.toleranceMm) {
      verdict = 'ahead';
      labelPt = `Joelho adiantado (+${offsetMm} mm)`;
      labelEn = `Knee ahead (+${offsetMm} mm)`;
      actionPt = `Recuar selim ${Math.abs(offsetMm)} mm`;
      actionEn = `Slide saddle backward ${Math.abs(offsetMm)} mm`;
    } else if (offsetMm < -this.toleranceMm) {
      verdict = 'behind';
      labelPt = `Joelho atrasado (${offsetMm} mm)`;
      labelEn = `Knee behind (${offsetMm} mm)`;
      actionPt = `Avançar selim ${Math.abs(offsetMm)} mm`;
      actionEn = `Slide saddle forward ${Math.abs(offsetMm)} mm`;
    }

    this.lastStatus = verdict;

    return {
      offsetMm,
      isAligned: verdict === 'aligned',
      status: verdict,
      labelPt,
      labelEn,
      actionPt,
      actionEn,
      kneeX: knee.x,
      kneeY: knee.y,
      pedalX: pedal.x,
      pedalY: pedal.y,
    };
  }

  /**
   * Método de análise KOPS compatível com o LiveCameraCapture.
   * Suporta coordenadas normalizadas [0.0 - 1.0] ou em píxeis.
   * 
   * @param {Object} knee - Ponto do joelho { x, y }
   * @param {Object} pedal - Ponto do pé/tornozelo { x, y }
   * @param {number} [w=640] - Largura do canvas/vídeo
   * @param {number} [h=480] - Altura do canvas/vídeo
   * @param {Object} [hip=null] - Ponto opcional da anca
   * @param {number} [pixelsPerMm=null] - Escala métrica calibrada
   * @returns {Object} Resultado de alinhamento KOPS
   */
  analyze(knee, pedal, w = 640, h = 480, hip = null, pixelsPerMm = null) {
    if (!knee || !pedal) return null;

    // Converter para píxeis se as coordenadas forem normalizadas [0.0 - 1.0]
    const kneePx = {
      x: knee.x <= 1.05 ? knee.x * w : knee.x,
      y: knee.y <= 1.05 ? knee.y * h : knee.y,
    };
    const pedalPx = {
      x: pedal.x <= 1.05 ? pedal.x * w : pedal.x,
      y: pedal.y <= 1.05 ? pedal.y * h : pedal.y,
    };

    // Estimar ou converter a anca
    let hipPx = null;
    if (hip) {
      hipPx = {
        x: hip.x <= 1.05 ? hip.x * w : hip.x,
        y: hip.y <= 1.05 ? hip.y * h : hip.y,
      };
    } else {
      hipPx = {
        x: kneePx.x - (pedalPx.x - kneePx.x) * 0.5,
        y: Math.max(0, kneePx.y - 120),
      };
    }

    return this.evaluate(kneePx, pedalPx, hipPx, pixelsPerMm);
  }

  /**
   * Desenha a linha de prumo pontilhada e marcação visual no canvas HTML5.
   * Suporta coordenadas normalizadas ou em píxeis.
   */
  drawPlumbLine(ctx, knee, pedal, w = 640, h = 480, isAligned = null) {
    if (!ctx || !knee || !pedal) return;

    const canvasW = w || 640;
    const canvasH = h || 480;

    const kneeX = knee.x <= 1.05 ? knee.x * canvasW : knee.x;
    const kneeY = knee.y <= 1.05 ? knee.y * canvasH : knee.y;
    const pedalX = pedal.x <= 1.05 ? pedal.x * canvasW : pedal.x;
    const pedalY = pedal.y <= 1.05 ? pedal.y * canvasH : pedal.y;

    const aligned = isAligned !== null && isAligned !== undefined 
      ? isAligned 
      : (this.lastStatus === 'aligned');

    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = aligned ? '#10b981' : '#f59e0b'; // Verde ou Âmbar

    // Linha de prumo vertical descendo da patela
    ctx.beginPath();
    ctx.moveTo(kneeX, kneeY);
    ctx.lineTo(kneeX, Math.max(pedalY + 30, canvasH - 20));
    ctx.stroke();

    // Círculo no joelho (ponto de origem do prumo)
    ctx.setLineDash([]);
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(kneeX, kneeY, 5, 0, Math.PI * 2);
    ctx.fill();

    // Círculo no pedal (alvo do prumo)
    ctx.fillStyle = aligned ? '#10b981' : '#ef4444';
    ctx.beginPath();
    ctx.arc(pedalX, pedalY, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

