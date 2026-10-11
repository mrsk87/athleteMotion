/**
 * Renderizador de Sobreposição Gráfica no Canvas (CanvasOverlayRenderer).
 *
 * Responsabilidade:
 * - Desenhar marcadores articulares, esqueleto e anotações angulares com cores de conformidade.
 * - Renderizar órbita dinâmica da pedalada e retículo de foco articular.
 * - Desenhar mira de precisão ciano e marcadores manuais calibrados.
 */
import { drawConnectors } from '@mediapipe/drawing_utils';
import { POSE_CONNECTIONS } from '@mediapipe/pose';

export class CanvasOverlayRenderer {
  /**
   * Desenha conexões anatómicas e esqueleto.
   */
  static drawSkeleton(ctx, landmarks) {
    if (!ctx || !landmarks) return;
    const bodyConnections = Array.from(POSE_CONNECTIONS).filter(([i, j]) => i >= 11 && j >= 11);
    drawConnectors(ctx, landmarks, bodyConnections, { color: 'rgba(0, 255, 0, 0.7)', lineWidth: 3 });
  }

  /**
   * Desenha um marcador de articulação com valor angular e halo ergonómico.
   */
  static drawJointMarker(ctx, point, angle, targetRange, w, h) {
    if (!ctx || !point || angle === null) return;
    const px = point.x * w;
    const py = point.y * h;
    const [minA, maxA] = targetRange || [0, 360];
    const isOk = angle >= minA && angle <= maxA;
    const color = isOk ? '#00FF00' : '#FFCC00';

    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, 12, 0, 2 * Math.PI);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText(`${angle.toFixed(1)}°`, px + 15, py - 5);
    ctx.restore();
  }

  /**
   * Desenha a órbita histórica da trajetória do membro durante a pedalada.
   */
  static drawTrajectoryOrbit(ctx, trajectoryPoints) {
    if (!ctx || !trajectoryPoints || trajectoryPoints.length < 3) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(trajectoryPoints[0].x, trajectoryPoints[0].y);
    for (let i = 1; i < trajectoryPoints.length; i++) {
      ctx.lineTo(trajectoryPoints[i].x, trajectoryPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Desenha retículo de foco ampliado com mira e etiqueta.
   */
  static drawFocusReticle(ctx, point, label, w, h) {
    if (!ctx || !point) return;
    const px = point.x * w;
    const py = point.y * h;

    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, 24, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`[${label}]`, px - 20, py - 30);
    ctx.restore();
  }

  /**
   * Desenha a mira de calibração interativa por clique do rato.
   */
  static drawCalibrationCrosshair(ctx, x, y, w, h, label = 'CLIQUE PARA FIXAR') {
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#00ffff';
    ctx.fillText(`📍 ${label}`, x + 18, y - 8);
    ctx.restore();
  }
}
