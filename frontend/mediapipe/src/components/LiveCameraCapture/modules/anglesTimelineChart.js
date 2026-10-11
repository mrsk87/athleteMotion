/**
 * Gráfico Interativo de Evolução dos Ângulos no Vídeo (AnglesTimelineChart).
 *
 * Responsabilidade:
 * - Desenhar curvas contínuas dos ângulos articulares (Joelho, Costas, Braço, Cabeça) ao longo da timeline do vídeo.
 * - Renderizar faixa de conformidade ergonómica e cursor de sincronização temporal.
 * - Permitir interação por clique para navegar instantaneamente para qualquer momento do vídeo.
 */

export class AnglesTimelineChart {
  /**
   * Renderiza o gráfico completo no contexto 2D de um Canvas.
   *
   * @param {CanvasRenderingContext2D} ctx - Contexto gráfico
   * @param {number} width - Largura em píxeis
   * @param {number} height - Altura em píxeis
   * @param {Array<{time: number, joelho: number, costas: number, braco: number, cabeca: number}>} samples - Amostras
   * @param {number} currentTime - Segundo atual do vídeo
   * @param {number} duration - Duração total do vídeo
   * @param {Object} targets - Metas angulares
   */
  static render(ctx, width, height, samples = [], currentTime = 0, duration = 1, targets = {}) {
    if (!ctx || width <= 0 || height <= 0) return;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Fundo do gráfico (estilo dashboard escuro)
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, width, height);

    const padding = { top: 20, right: 30, bottom: 25, left: 45 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    if (chartW <= 0 || chartH <= 0) {
      ctx.restore();
      return;
    }

    const minAngle = 20;
    const maxAngle = 180;
    const angleRange = maxAngle - minAngle;

    const getY = (angle) => {
      const clamped = Math.max(minAngle, Math.min(maxAngle, angle));
      return padding.top + chartH - ((clamped - minAngle) / angleRange) * chartH;
    };

    const getX = (time) => {
      const maxTime = Math.max(duration, 0.1);
      return padding.left + (Math.max(0, Math.min(time, maxTime)) / maxTime) * chartW;
    };

    // 1. Linhas de grelha horizontal e rótulos de graus
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.fillStyle = '#71717a';

    const gridSteps = [40, 80, 120, 150, 180];
    gridSteps.forEach((deg) => {
      const y = getY(deg);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();
      ctx.fillText(`${deg}°`, 12, y + 3);
    });

    // 2. Faixa ergonómica alvo do joelho [145°, 155°]
    const kneeTarget = targets.knee || [145, 155];
    const targetYTop = getY(kneeTarget[1]);
    const targetYBottom = getY(kneeTarget[0]);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
    ctx.fillRect(padding.left, targetYTop, chartW, targetYBottom - targetYTop);
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(padding.left, targetYTop, chartW, targetYBottom - targetYTop);
    ctx.setLineDash([]);

    // 3. Desenhar curvas das amostras registadas
    if (samples.length >= 2) {
      this.drawSeries(ctx, samples, 'joelho', '#38bdf8', getX, getY, 2.5); // Joelho (Azul)
      this.drawSeries(ctx, samples, 'costas', '#f59e0b', getX, getY, 1.8); // Costas (Âmbar)
      this.drawSeries(ctx, samples, 'braco', '#c084fc', getX, getY, 1.5);  // Braço (Roxo)
      this.drawSeries(ctx, samples, 'cabeca', '#f472b6', getX, getY, 1.5); // Cabeça (Rosa)
    } else {
      // Texto informativo se ainda estiver no início
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('A reproduzir vídeo para registar curvas angulares...', width / 2, height / 2);
      ctx.textAlign = 'left';
    }

    // 4. Cursor temporal do vídeo em reprodução
    const cursorX = getX(currentTime);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, padding.top);
    ctx.lineTo(cursorX, padding.top + chartH);
    ctx.stroke();

    // Rótulo do tempo no cursor
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`${currentTime.toFixed(1)}s`, Math.max(padding.left, cursorX - 12), padding.top - 6);

    ctx.restore();
  }

  /**
   * Traça uma série temporal unitária com linha suavizada.
   */
  static drawSeries(ctx, samples, key, color, getX, getY, lineWidth = 2) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    let started = false;
    for (let i = 0; i < samples.length; i++) {
      const val = samples[i][key];
      const time = samples[i].time;
      if (typeof val === 'number' && !isNaN(val)) {
        const x = getX(time);
        const y = getY(val);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
    }
    if (started) ctx.stroke();
    ctx.restore();
  }

  /**
   * Converte a coordenada X de um clique no Canvas para o segundo exato no vídeo.
   */
  static getTimeFromClick(clickX, width, duration = 1) {
    const paddingLeft = 45;
    const paddingRight = 30;
    const chartW = width - paddingLeft - paddingRight;
    if (chartW <= 0) return 0;
    const boundedX = Math.max(0, Math.min(chartW, clickX - paddingLeft));
    return (boundedX / chartW) * duration;
  }
}
