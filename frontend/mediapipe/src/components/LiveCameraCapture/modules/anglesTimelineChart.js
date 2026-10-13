/**
 * Gráfico Interativo de Evolução dos Ângulos no Vídeo (AnglesTimelineChart).
 *
 * Responsabilidade:
 * - Desenhar curvas contínuas dos ângulos articulares (Joelho, Costas, Braço, Cabeça) ao longo da timeline do vídeo.
 * - Renderizar faixa de conformidade ergonómica e cursor de sincronização temporal.
 * - Permitir interação por clique para navegar instantaneamente para qualquer momento do vídeo.
 *
 * As cores são lidas dos tokens do tema ativo (`--chart-*`): o mesmo gráfico
 * funciona nos temas claro, escuro e sóbrio. Sem DOM (testes em Node) usa-se
 * uma paleta de recurso por tema.
 */

import { themeManager } from '../../../services/themeManager.js';

/**
 * Cor do token do tema ativo. Sem DOM (testes em Node) devolve a paleta de
 * recurso do próprio gestor de temas — nunca há valores de cor fixos aqui.
 */
function token(name) {
  return themeManager.token(name);
}

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
   * @param {Object} loopRange - Intervalo de loop { start, end, enabled }
   * @param {{ emptyLabel?: string }} [options] - texto mostrado sem amostras (traduzido por quem chama)
   */
  static render(
    ctx,
    width,
    height,
    samples = [],
    currentTime = 0,
    duration = 1,
    targets = {},
    loopRange = null,
    options = {}
  ) {
    if (!ctx || width <= 0 || height <= 0) return;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Fundo do gráfico (segue o tema ativo)
    ctx.fillStyle = token('--chart-bg');
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
    ctx.strokeStyle = token('--chart-grid');
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.fillStyle = token('--chart-axis');

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
    ctx.fillStyle = token('--chart-band-fill');
    ctx.fillRect(padding.left, targetYTop, chartW, targetYBottom - targetYTop);
    ctx.strokeStyle = token('--chart-band-stroke');
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(padding.left, targetYTop, chartW, targetYBottom - targetYTop);
    ctx.setLineDash([]);

    // 3. Desenhar curvas das amostras registadas (ou mensagem informativa se vazio)
    if (samples.length > 0) {
      this.drawSeries(ctx, samples, 'joelho', token('--chart-series-knee'), getX, getY, 2.5);
      this.drawSeries(ctx, samples, 'costas', token('--chart-series-torso'), getX, getY, 1.8);
      this.drawSeries(ctx, samples, 'braco', token('--chart-series-arm'), getX, getY, 1.5);
      this.drawSeries(ctx, samples, 'cabeca', token('--chart-series-head'), getX, getY, 1.5);
    } else {
      // Texto informativo enquanto não há amostras (o texto vem traduzido de quem chama).
      ctx.fillStyle = token('--text-2');
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        options.emptyLabel || 'A reproduzir vídeo para registar curvas angulares...',
        width / 2,
        height / 2
      );
      // Segundo reforço discreto (para leituras em testes ou capturas)
      ctx.fillStyle = token('--text-3');
      ctx.font = '10px sans-serif';
      ctx.fillText(
        options.emptyLabel || 'Sem amostras de ângulos: a curva aparece assim que a análise do vídeo registar a pedalada.',
        width / 2,
        height / 2 + 16
      );
      ctx.textAlign = 'left';
    }

    // 5. Destaque do Intervalo de Loop A-B (se ativo)
    if (loopRange && loopRange.enabled && loopRange.end > loopRange.start) {
      const loopX1 = getX(loopRange.start);
      const loopX2 = getX(loopRange.end);
      const loopW = Math.max(2, loopX2 - loopX1);

      ctx.save();
      ctx.fillStyle = token('--chart-playhead-fill');
      ctx.fillRect(loopX1, padding.top, loopW, chartH);
      ctx.strokeStyle = token('--chart-playhead');
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(loopX1, padding.top, loopW, chartH);
      ctx.setLineDash([]);

      ctx.fillStyle = token('--chart-playhead');
      ctx.font = 'bold 9px monospace';
      ctx.fillText(`[A: ${loopRange.start.toFixed(1)}s]`, Math.max(padding.left, loopX1 - 8), padding.top + 12);
      ctx.fillText(`[B: ${loopRange.end.toFixed(1)}s]`, Math.max(padding.left, loopX2 - 25), padding.top + 12);
      ctx.restore();
    }

    // 6. Cursor temporal do vídeo em reprodução
    const cursorX = getX(currentTime);
    ctx.strokeStyle = token('--chart-threshold');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, padding.top);
    ctx.lineTo(cursorX, padding.top + chartH);
    ctx.stroke();

    // Rótulo do tempo no cursor
    ctx.fillStyle = token('--chart-threshold');
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
