/**
 * Gestor do Motion Trail da órbita do pé com fade progressivo.
 */
import { ref } from 'vue';

export function useFootOrbitTrail(maxPoints = 120) {
  // Array de pontos: { x, y, time }
  const trailPoints = ref([]);
  const fadeDurationMs = ref(3500); // 3.5 segundos de retenção (aproximadamente 3 a 4 pedaladas)

  const addPoint = (normX, normY, timestampMs) => {
    if (normX == null || normY == null) return;
    trailPoints.value.push({
      x: normX,
      y: normY,
      time: timestampMs,
    });

    // Manter tamanho controlado
    if (trailPoints.value.length > maxPoints) {
      trailPoints.value.shift();
    }
  };

  const clearTrail = () => {
    trailPoints.value = [];
  };

  const drawOrbitTrail = (ctx, width, height, currentTimestampMs, rect = null) => {
    if (trailPoints.value.length < 2) return;

    const toX = (normX) => (rect ? rect.x + normX * rect.w : normX * width);
    const toY = (normY) => (rect ? rect.y + normY * rect.h : normY * height);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 1; i < trailPoints.value.length; i++) {
      const pPrev = trailPoints.value[i - 1];
      const pCurr = trailPoints.value[i];

      // Cálculo de fade temporal progressivo
      const age = currentTimestampMs - pCurr.time;
      let alpha = 1.0 - (age / fadeDurationMs.value);
      if (alpha <= 0.05) continue;
      alpha = Math.max(0.05, Math.min(1.0, alpha));

      // Gradiente azul elétrico / ciano para o rasto orbital
      ctx.strokeStyle = `rgba(56, 189, 248, ${alpha.toFixed(2)})`;
      ctx.lineWidth = 3.0 * alpha + 1.0;

      ctx.beginPath();
      ctx.moveTo(toX(pPrev.x), toY(pPrev.y));
      ctx.lineTo(toX(pCurr.x), toY(pCurr.y));
      ctx.stroke();
    }

    // Ponto atual da ponta do pedal (destaque dourado)
    const last = trailPoints.value[trailPoints.value.length - 1];
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(toX(last.x), toY(last.y), 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  };

  return {
    trailPoints,
    fadeDurationMs,
    addPoint,
    clearTrail,
    drawOrbitTrail,
  };
}
