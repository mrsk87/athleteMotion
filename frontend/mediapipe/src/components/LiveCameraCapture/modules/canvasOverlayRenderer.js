/**
 * Renderizador de Sobreposição Gráfica no Canvas (CanvasOverlayRenderer).
 *
 * Responsabilidade:
 * - Desenhar esqueleto anatómico dinâmico com traços coloridos segundo conformidade ergonómica:
 *   Verde (ideal), Amarelo (perto da meta), Vermelho (longe da meta).
 * - Renderizar marcadores articulares com halo e valores angulares.
 * - Renderizar trajetória do pedal, retículos e miras de calibração.
 */

export class CanvasOverlayRenderer {
  /**
   * Obtém a cor de conformidade (RGBA) para um ângulo face à meta ergonómica.
   */
  static getComplianceColor(angle, targetRange, tolerance = 8, alpha = 0.85) {
    if (angle === null || angle === undefined || !targetRange || targetRange.length < 2) {
      return `rgba(148, 163, 184, ${alpha})`;
    }
    const [minVal, maxVal] = targetRange;
    if (angle >= minVal && angle <= maxVal) {
      return `rgba(0, 255, 0, ${alpha})`; // VERDE: Posição ideal
    }
    const diff = angle < minVal ? minVal - angle : angle - maxVal;
    if (diff <= tolerance) {
      return `rgba(255, 204, 0, ${alpha})`; // AMARELO: Perto da posição ideal
    }
    return `rgba(255, 51, 51, ${alpha})`; // VERMELHO: Longe da posição ideal
  }

  /**
   * Obtém a cor hexadecimal correspondente para marcadores e halos.
   */
  static getComplianceHexColor(angle, targetRange, tolerance = 8) {
    if (angle === null || angle === undefined || !targetRange || targetRange.length < 2) {
      return '#94a3b8';
    }
    const [minVal, maxVal] = targetRange;
    if (angle >= minVal && angle <= maxVal) {
      return '#00FF00'; // Verde
    }
    const diff = angle < minVal ? minVal - angle : angle - maxVal;
    if (diff <= tolerance) {
      return '#FFCC00'; // Amarelo
    }
    return '#FF3333'; // Vermelho
  }

  /**
   * Desenha um segmento ósseo unitário com cor dinâmica e iluminação de halo.
   */
  static drawBoneSegment(ctx, p1, p2, color, w, h, lineWidth = 4) {
    if (!ctx || !p1 || !p2) return;
    if (typeof p1.visibility === 'number' && p1.visibility < 0.25) return;
    if (typeof p2.visibility === 'number' && p2.visibility < 0.25) return;

    const x1 = p1.x * w;
    const y1 = p1.y * h;
    const x2 = p2.x * w;
    const y2 = p2.y * h;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Desenha o esqueleto completo com traços coloridos (Verde/Amarelo/Vermelho)
   * da perna aos braços e cabeça consoante a proximidade da posição ideal.
   */
  static drawSkeleton(ctx, landmarks, w, h, liveAngles = {}, targets = {}, side = 'left') {
    if (!ctx || !landmarks || landmarks.length < 33) return;

    const isLeft = side === 'left';
    const activeIdx = {
      nose: 0,
      ear: isLeft ? 8 : 7,
      shoulder: isLeft ? 12 : 11,
      elbow: isLeft ? 14 : 13,
      wrist: isLeft ? 16 : 15,
      hip: isLeft ? 24 : 23,
      knee: isLeft ? 26 : 25,
      ankle: isLeft ? 28 : 27,
      heel: isLeft ? 30 : 29,
      foot: isLeft ? 32 : 31,
    };
    const otherIdx = {
      ear: isLeft ? 7 : 8,
      shoulder: isLeft ? 11 : 12,
      elbow: isLeft ? 13 : 14,
      wrist: isLeft ? 15 : 16,
      hip: isLeft ? 23 : 24,
      knee: isLeft ? 25 : 26,
      ankle: isLeft ? 27 : 28,
      heel: isLeft ? 29 : 30,
      foot: isLeft ? 31 : 32,
    };

    // Cores ergonómicas calculadas para os membros principais
    const legColor = this.getComplianceColor(liveAngles.joelho, targets.knee);
    const footColor = this.getComplianceColor(liveAngles.tornozelo, targets.ankle);
    const backColor = this.getComplianceColor(liveAngles.costas, targets.back);
    const armColor = this.getComplianceColor(liveAngles.braco, targets.elbow);
    const headColor = this.getComplianceColor(liveAngles.cabeca, targets.head || [35, 55]);

    // 1. Conexões anatómicas bilaterais (Ombros e Bacia)
    const neutralColor = 'rgba(255, 255, 255, 0.35)';
    this.drawBoneSegment(ctx, landmarks[11], landmarks[12], neutralColor, w, h, 2);
    this.drawBoneSegment(ctx, landmarks[23], landmarks[24], neutralColor, w, h, 2);

    // 2. Membros do lado oposto (desenhados com menor intensidade para não sobrecarregar)
    const dimColor = 'rgba(148, 163, 184, 0.3)';
    this.drawBoneSegment(ctx, landmarks[otherIdx.shoulder], landmarks[otherIdx.elbow], dimColor, w, h, 2.5);
    this.drawBoneSegment(ctx, landmarks[otherIdx.elbow], landmarks[otherIdx.wrist], dimColor, w, h, 2.5);
    this.drawBoneSegment(ctx, landmarks[otherIdx.hip], landmarks[otherIdx.knee], dimColor, w, h, 2.5);
    this.drawBoneSegment(ctx, landmarks[otherIdx.knee], landmarks[otherIdx.ankle], dimColor, w, h, 2.5);

    // 3. Cabeça e Pescoço (ativo)
    this.drawBoneSegment(ctx, landmarks[activeIdx.shoulder], landmarks[activeIdx.ear], headColor, w, h, 4);
    this.drawBoneSegment(ctx, landmarks[activeIdx.ear], landmarks[activeIdx.nose], headColor, w, h, 3.5);

    // 4. Tronco / Costas (ativo)
    this.drawBoneSegment(ctx, landmarks[activeIdx.hip], landmarks[activeIdx.shoulder], backColor, w, h, 5);

    // 5. Braço e Antebraço (ativo)
    this.drawBoneSegment(ctx, landmarks[activeIdx.shoulder], landmarks[activeIdx.elbow], armColor, w, h, 4.5);
    this.drawBoneSegment(ctx, landmarks[activeIdx.elbow], landmarks[activeIdx.wrist], armColor, w, h, 4);

    // 6. Coxa, Perna e Pé (ativo)
    this.drawBoneSegment(ctx, landmarks[activeIdx.hip], landmarks[activeIdx.knee], legColor, w, h, 5);
    this.drawBoneSegment(ctx, landmarks[activeIdx.knee], landmarks[activeIdx.ankle], legColor, w, h, 5);
    this.drawBoneSegment(ctx, landmarks[activeIdx.ankle], landmarks[activeIdx.heel], footColor, w, h, 3.5);
    this.drawBoneSegment(ctx, landmarks[activeIdx.heel], landmarks[activeIdx.foot], footColor, w, h, 3.5);
    this.drawBoneSegment(ctx, landmarks[activeIdx.ankle], landmarks[activeIdx.foot], footColor, w, h, 3.5);
  }

  /**
   * Desenha marcador de articulação com anotação angular e halo ergonómico tricolor.
   */
  static drawJointMarker(ctx, point, angle, targetRange, w, h) {
    if (!ctx || !point || angle === null || angle === undefined) return;
    const px = point.x * w;
    const py = point.y * h;
    const color = this.getComplianceHexColor(angle, targetRange);

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
    ctx.fillText(`${Math.round(angle)}°`, px + 15, py - 5);
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

  /**
   * Desenha retículo de bloqueio ótico de alta precisão (Zero-Jitter Optical Lock).
   */
  static drawOpticalLockReticle(ctx, pxX, pxY, label, confidence = 100, status = 'LOCKED') {
    if (!ctx) return;
    const isLocked = status === 'LOCKED';
    const color = isLocked ? '#10b981' : '#f59e0b';

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    // Círculo central com mira
    ctx.beginPath();
    ctx.arc(pxX, pxY, 10, 0, 2 * Math.PI);
    ctx.stroke();

    // 4 traços de mira ortogonais
    const len = 6;
    ctx.beginPath();
    ctx.moveTo(pxX - 16, pxY);
    ctx.lineTo(pxX - 16 + len, pxY);
    ctx.moveTo(pxX + 16, pxY);
    ctx.lineTo(pxX + 16 - len, pxY);
    ctx.moveTo(pxX, pxY - 16);
    ctx.lineTo(pxX, pxY - 16 + len);
    ctx.moveTo(pxX, pxY + 16);
    ctx.lineTo(pxX, pxY + 16 - len);
    ctx.stroke();

    // Ponto sub-pixel central
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pxX, pxY, 3, 0, 2 * Math.PI);
    ctx.fill();

    // Etiqueta com percentual de confiança de relevo
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText(`[🎯 ${label.toUpperCase()} (${confidence}%)]`, pxX + 16, pxY - 8);
    ctx.restore();
  }

  /**
   * Desenha a Lupa de Inspeção de Relevo e Luz em tempo real no canto do ecrã.
   * Permite ver a forma ampliada (2.5x) do ponto anatómico acompanhado.
   */
  static drawMagnifyingLoupe(ctx, videoSource, pxX, pxY, label, confidence, w) {
    if (!ctx || !videoSource || pxX <= 0 || pxY <= 0) return;

    ctx.save();
    const loupeRadius = 42; // Diâmetro de 84px
    const margin = 14;
    const loupeCenterX = w - loupeRadius - margin;
    const loupeCenterY = loupeRadius + 50; // Abaixo dos badges HUD

    // 1. Fundo e sombra da lupa
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#18181b';
    ctx.beginPath();
    ctx.arc(loupeCenterX, loupeCenterY, loupeRadius, 0, 2 * Math.PI);
    ctx.fill();

    // 2. Recorte circular para desenho ampliado (2.5x)
    ctx.save();
    ctx.beginPath();
    ctx.arc(loupeCenterX, loupeCenterY, loupeRadius - 2, 0, 2 * Math.PI);
    ctx.clip();

    const sampleRadius = Math.round(loupeRadius / 2.5); // ~17px em redor do ponto
    const srcX = Math.max(0, pxX - sampleRadius);
    const srcY = Math.max(0, pxY - sampleRadius);
    const srcW = sampleRadius * 2;
    const srcH = sampleRadius * 2;

    try {
      ctx.drawImage(
        videoSource,
        srcX, srcY, srcW, srcH,
        loupeCenterX - loupeRadius, loupeCenterY - loupeRadius,
        loupeRadius * 2, loupeRadius * 2
      );
    } catch {
      // caso o vídeo esteja indisponível momentaneamente
    }

    // 3. Mira central na lupa
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(loupeCenterX - 12, loupeCenterY);
    ctx.lineTo(loupeCenterX + 12, loupeCenterY);
    ctx.moveTo(loupeCenterX, loupeCenterY - 12);
    ctx.lineTo(loupeCenterX, loupeCenterY + 12);
    ctx.stroke();
    ctx.restore();

    // 4. Bordo exterior brilhante e etiqueta
    ctx.strokeStyle = confidence >= 60 ? '#10b981' : '#f59e0b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(loupeCenterX, loupeCenterY, loupeRadius, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#10b981';
    ctx.textAlign = 'center';
    ctx.fillText(`🔍 LUPA RELEVO (${confidence}%)`, loupeCenterX, loupeCenterY + loupeRadius + 14);
    ctx.fillText(`[${label.toUpperCase()}]`, loupeCenterX, loupeCenterY + loupeRadius + 26);
    ctx.restore();
  }
}
