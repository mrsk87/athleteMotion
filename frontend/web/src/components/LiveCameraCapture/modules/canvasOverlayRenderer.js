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
  static drawBoneSegment(ctx, p1, p2, color, w, h, lineWidth = 4, forceDashed = false) {
    if (!ctx || !p1 || !p2) return;
    if (typeof p1.visibility === 'number' && p1.visibility < 0.25) return;
    if (typeof p2.visibility === 'number' && p2.visibility < 0.25) return;
    if ((p1.x === 0 && p1.y === 0) || (p2.x === 0 && p2.y === 0)) return;

    const scale = Math.max(1.0, Math.min(4.0, Math.max(w, h) / 720));
    const x1 = p1.x * w;
    const y1 = p1.y * h;
    const x2 = p2.x * w;
    const y2 = p2.y * h;
    const isEstimated = Boolean(p1.estimated || p2.estimated || forceDashed);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, Math.round(lineWidth * scale));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (isEstimated) {
      ctx.setLineDash([Math.round(6 * scale), Math.round(4 * scale)]);
      ctx.globalAlpha = 0.65;
    }
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.round(6 * scale);
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
    // No MediaPipe Pose: Ímpares = Esquerdo, Pares = Direito (Lado da transmissão)
    const activeIdx = {
      nose: 0,
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
    const otherIdx = {
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
   * Suporta supressão honesta com withheld=true e marcação de estimativa.
   */
  static drawJointMarker(ctx, point, angle, targetRange, w, h, withheld = false) {
    if (!ctx || !point) return;
    const scale = Math.max(1.0, Math.min(4.0, Math.max(w, h) / 720));
    const px = point.x * w;
    const py = point.y * h;

    if (withheld) {
      // Supressão honesta: não inventa ângulos quando confiança ou calibração são insuficientes
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, Math.round(5 * scale), 0, 2 * Math.PI);
      ctx.fillStyle = '#64748b';
      ctx.fill();
      ctx.restore();
      return;
    }

    if (angle === null || angle === undefined) return;
    const color = this.getComplianceHexColor(angle, targetRange);
    const isEstimated = Boolean(point.estimated);

    ctx.save();
    if (isEstimated) {
      ctx.globalAlpha = 0.75;
    }
    ctx.beginPath();
    ctx.arc(px, py, Math.round(7 * scale), 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.round(10 * scale);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, Math.round(13 * scale), 0, 2 * Math.PI);
    ctx.strokeStyle = color;
    if (isEstimated) {
      ctx.setLineDash([Math.round(4 * scale), Math.round(3 * scale)]);
    }
    ctx.lineWidth = Math.max(2, Math.round(2 * scale));
    ctx.stroke();

    const fontSize = Math.round(14 * scale);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = Math.round(4 * scale);
    const labelText = isEstimated ? `${Math.round(angle)}° (est.)` : `${Math.round(angle)}°`;
    ctx.fillText(labelText, px + Math.round(16 * scale), py - Math.round(6 * scale));
    ctx.restore();
  }

  /**
   * Desenha o ponto médio de uma articulação obtido a partir do conjunto de várias análises,
   * incluindo os pontos individuais das análises (dispersão) e a mira de precisão do ponto médio com coordenadas.
   */
  static drawMedianJointMarker(ctx, point, label, angle, targetRange, w, h, showCoordinates = true) {
    if (!ctx || !point) return;
    const scale = Math.max(1.0, Math.min(3.5, Math.max(w, h) / 720));
    const px = point.x * w;
    const py = point.y * h;
    const color = angle !== null && angle !== undefined && targetRange
      ? this.getComplianceHexColor(angle, targetRange)
      : '#38bdf8';

    ctx.save();

    // 1. Amostras individuais do conjunto de análises (nuvem de pontos discretos)
    if (Array.isArray(point.history) && point.history.length > 1) {
      point.history.forEach((sample) => {
        const sx = sample.x * w;
        const sy = sample.y * h;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1.5, 2.5 * scale), 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.fill();
      });
    }

    // 2. Halo da dispersão/desvio máximo do ponto médio
    if (point.spreadDist && Number.isFinite(point.spreadDist)) {
      const spreadRadius = Math.max(7 * scale, (point.spreadDist / 100) * Math.min(w, h));
      ctx.beginPath();
      ctx.arc(px, py, spreadRadius, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = Math.max(1, Math.round(scale));
      ctx.setLineDash([2 * scale, 2 * scale]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 3. Ponto Médio central (alvo de alta precisão com anel duplo e retículo)
    ctx.beginPath();
    ctx.arc(px, py, Math.round(5 * scale), 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.round(8 * scale);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, Math.round(11 * scale), 0, 2 * Math.PI);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, 2 * scale);
    ctx.stroke();

    // Retículo / Mira de precisão em cruz
    const crossArm = Math.round(16 * scale);
    ctx.beginPath();
    ctx.moveTo(px - crossArm, py);
    ctx.lineTo(px - Math.round(13 * scale), py);
    ctx.moveTo(px + Math.round(13 * scale), py);
    ctx.lineTo(px + crossArm, py);
    ctx.moveTo(px, py - crossArm);
    ctx.lineTo(px, py - Math.round(13 * scale));
    ctx.moveTo(px, py + Math.round(13 * scale));
    ctx.lineTo(px, py + crossArm);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 4. Etiqueta com Nome, Ângulo e Coordenadas do Ponto Médio (X%, Y%)
    const fontSize = Math.round(11 * scale);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = Math.round(4 * scale);

    const xPct = (point.x * 100).toFixed(1);
    const yPct = (point.y * 100).toFixed(1);
    const angleText = angle !== null && angle !== undefined ? ` ${Math.round(angle)}°` : '';
    const labelLine = `${label || 'P. Médio'}${angleText}`;
    ctx.fillText(labelLine, px + Math.round(15 * scale), py - Math.round(8 * scale));

    if (showCoordinates) {
      const coordFontSize = Math.round(9.5 * scale);
      ctx.font = `${coordFontSize}px monospace`;
      ctx.fillStyle = 'rgba(224, 242, 254, 0.95)';
      ctx.fillText(`(${xPct}%, ${yPct}%)`, px + Math.round(15 * scale), py + Math.round(6 * scale));
    }

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
   * CromaTrack: retículo de um marcador cromático detetado.
   *
   * Distingue visualmente **confirmado** (anel cheio + mira) de **por confirmar** (anel
   * tracejado): o técnico vê de imediato se aquele ponto já está a valer.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x:number,y:number,weight?:number,confidence?:number,confirmed?:boolean}} point ponto normalizado
   * @param {string} label  nome da articulação
   * @param {string} color  cor hex da articulação (paleta)
   * @param {number} w
   * @param {number} h
   */
  static drawChromaMarker(ctx, point, label, color, w, h) {
    if (!ctx || !point) return;
    const radius = 10 + Math.round((point.weight || 0) * 6);
    const px = point.x * w;
    const py = point.y * h;

    ctx.save();
    ctx.strokeStyle = color || '#22c55e';
    ctx.fillStyle = color || '#22c55e';
    ctx.setLineDash(point.confirmed ? [] : [4, 4]);
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Mira em cruz.
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(px - radius - 4, py);
    ctx.lineTo(px + radius + 4, py);
    ctx.moveTo(px, py - radius - 4);
    ctx.lineTo(px, py + radius + 4);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, 2 * Math.PI);
    ctx.fill();

    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(`${label} ${point.confidence ?? 0}%`, px + radius + 6, py - radius);
    ctx.restore();
  }

  /**
   * CromaTrack: legenda com a cor de cada articulação (o técnico não tem de adivinhar).
   *
   * @param {Array<{label: string, color: string}>} entries
   */
  static drawChromaLegend(ctx, entries, x = 12, y = 12) {
    if (!ctx || !entries || !entries.length) return;
    ctx.save();
    ctx.font = 'bold 11px sans-serif';
    entries.forEach((entry, index) => {
      const lineY = y + index * 16;
      ctx.fillStyle = entry.color;
      ctx.beginPath();
      ctx.arc(x + 5, lineY, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(entry.label, x + 16, lineY + 4);
    });
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

  /**
   * Desenha uma seta de deslocamento da posição atual para a posição alvo recomendada.
   */
  static drawDisplacementArrow(ctx, fromX, fromY, toX, toY, color = '#10b981', scale = 1.0) {
    if (!ctx) return;
    const dist = Math.hypot(toX - fromX, toY - fromY);
    if (dist < 8 * scale) return; // Se a diferença for insignificante, não poluir o ecrã
    const headLen = Math.min(26, Math.max(8 * scale, dist * 0.28));
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(2.5, 2.5 * scale);
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.round(6 * scale);

    // Linha de deslocamento
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    // Seta orientada
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Desenha um badge informativo elegante sobreposto no canvas com texto e cor de destaque.
   */
  static drawCanvasBadge(ctx, text, x, y, borderColor = '#10b981', textColor = '#ffffff', scale = 1.0) {
    if (!ctx || !text) return;
    ctx.save();
    const fontSize = Math.round(11 * scale);
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textWidth = ctx.measureText(text).width;
    const paddingX = Math.round(8 * scale);
    const boxW = textWidth + paddingX * 2;
    const boxH = Math.round(22 * scale);

    const boxX = Math.max(8, x - boxW / 2);
    const boxY = Math.max(8, y - boxH / 2);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = Math.max(1.5, 1.5 * scale);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(boxX, boxY, boxW, boxH, Math.round(6 * scale));
    } else {
      ctx.rect(boxX, boxY, boxW, boxH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = Math.round(3 * scale);
    ctx.fillText(text, boxX + paddingX, boxY + boxH / 2);
    ctx.restore();
  }

  /**
   * Desenha linhas-guia fantasma (ghost trace) com cor suave e setas de deslocamento
   * indicando exatamente para onde o membro deve ser ajustado para atingir a meta ergonómica.
   */
  static drawTargetGhostAndGuides(ctx, landmarks, w, h, liveAngles = {}, targets = {}, side = 'left') {
    if (!ctx || !landmarks || landmarks.length < 33) return;

    const scale = Math.max(1.0, Math.min(3.5, Math.max(w, h) / 720));
    const isLeft = side === 'left';
    // Ímpares = Esquerdo, Pares = Direito (Lado da transmissão)
    const hipIdx = isLeft ? 23 : 24;
    const kneeIdx = isLeft ? 25 : 26;
    const ankleIdx = isLeft ? 27 : 28;
    const shoulderIdx = isLeft ? 11 : 12;
    const elbowIdx = isLeft ? 13 : 14;
    const wristIdx = isLeft ? 15 : 16;

    // 1. GUIA PARA EXTENSÃO DO JOELHO (Altura do Selim - apenas na fase de extensão/BDC)
    const kneeTarget = targets.knee || [145, 155];
    const kneeAngle = liveAngles.joelho;
    if (
      kneeAngle !== null &&
      kneeAngle !== undefined &&
      kneeAngle >= 90 &&
      (kneeAngle < kneeTarget[0] || kneeAngle > kneeTarget[1])
    ) {
      const pKnee = landmarks[kneeIdx];
      const pAnkle = landmarks[ankleIdx];
      const pHip = landmarks[hipIdx];

      if (pKnee && pAnkle && pHip) {
        const Hx = pHip.x * w;
        const Hy = pHip.y * h;
        const Kx = pKnee.x * w;
        const Ky = pKnee.y * h;
        const Ax = pAnkle.x * w;
        const Ay = pAnkle.y * h;

        const Lshank = Math.hypot(Ax - Kx, Ay - Ky);
        if (Lshank > 15) {
          const VthighX = Kx - Hx;
          const VthighY = Ky - Hy;
          const VshankX = Ax - Kx;
          const VshankY = Ay - Ky;
          const cp = VthighX * VshankY - VthighY * VshankX;
          const phiCurr = Math.atan2(VshankY, VshankX);
          const targetAngle = 150; // Meta ideal média (145°-155°)
          const deltaRad = (targetAngle - kneeAngle) * (Math.PI / 180);
          const sign = cp >= 0 ? 1 : -1;
          const phiTarget = phiCurr - sign * deltaRad;

          const targetAx = Kx + Lshank * Math.cos(phiTarget);
          const targetAy = Ky + Lshank * Math.sin(phiTarget);

          // Traço com cor fraca / semi-transparente do membro alvo
          ctx.save();
          ctx.beginPath();
          ctx.setLineDash([Math.round(6 * scale), Math.round(5 * scale)]);
          ctx.lineWidth = Math.max(3, Math.round(3.5 * scale));
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.7)';
          ctx.shadowColor = '#10b981';
          ctx.shadowBlur = Math.round(8 * scale);
          ctx.moveTo(Kx, Ky);
          ctx.lineTo(targetAx, targetAy);
          ctx.stroke();

          // Marcador do alvo ideal
          ctx.beginPath();
          ctx.arc(targetAx, targetAy, Math.round(7 * scale), 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';
          ctx.fill();
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = Math.max(2, Math.round(2 * scale));
          ctx.stroke();
          ctx.restore();

          // Seta de deslocamento da posição errada para a certa
          this.drawDisplacementArrow(ctx, Ax, Ay, targetAx, targetAy, '#10b981', scale);

          // Indicação textual no ecrã
          const kneeBadge = kneeAngle < kneeTarget[0]
            ? `⬆ Subir Selim (Alvo: 150° | Atual: ${Math.round(kneeAngle)}°)`
            : `⬇ Descer Selim (Alvo: 150° | Atual: ${Math.round(kneeAngle)}°)`;
          this.drawCanvasBadge(ctx, kneeBadge, Kx, Ky - Math.round(24 * scale), '#10b981', '#ffffff', scale);
        }
      }
    }

    // 2. GUIA PARA INCLINAÇÃO DO TRONCO (Stack & Reach)
    const backTarget = targets.back || [40, 50];
    const backAngle = liveAngles.costas;
    if (
      backAngle !== null &&
      backAngle !== undefined &&
      (backAngle < backTarget[0] || backAngle > backTarget[1])
    ) {
      const pHip = landmarks[hipIdx];
      const pShoulder = landmarks[shoulderIdx];

      if (pHip && pShoulder) {
        const Hx = pHip.x * w;
        const Hy = pHip.y * h;
        const Sx = pShoulder.x * w;
        const Sy = pShoulder.y * h;
        const Ltorso = Math.hypot(Sx - Hx, Sy - Hy);

        if (Ltorso > 20) {
          const facingLeft = Sx < Hx;
          // Tronco ideal a 45° de elevação
          const targetTorsoRad = facingLeft
            ? -Math.PI + (45 * Math.PI) / 180
            : (-45 * Math.PI) / 180;
          const targetSx = Hx + Ltorso * Math.cos(targetTorsoRad);
          const targetSy = Hy + Ltorso * Math.sin(targetTorsoRad);

          // Traço fantasma com cor suave
          ctx.save();
          ctx.beginPath();
          ctx.setLineDash([Math.round(6 * scale), Math.round(5 * scale)]);
          ctx.lineWidth = Math.max(3, Math.round(3.5 * scale));
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
          ctx.shadowColor = '#38bdf8';
          ctx.shadowBlur = Math.round(8 * scale);
          ctx.moveTo(Hx, Hy);
          ctx.lineTo(targetSx, targetSy);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(targetSx, targetSy, Math.round(7 * scale), 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(56, 189, 248, 0.3)';
          ctx.fill();
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = Math.max(2, Math.round(2 * scale));
          ctx.stroke();
          ctx.restore();

          this.drawDisplacementArrow(ctx, Sx, Sy, targetSx, targetSy, '#38bdf8', scale);

          const backBadge = backAngle < backTarget[0]
            ? `⬆ Elevar Tronco (Alvo: 45° | Atual: ${Math.round(backAngle)}°)`
            : `⬇ Inclinar Tronco (Alvo: 45° | Atual: ${Math.round(backAngle)}°)`;
          this.drawCanvasBadge(ctx, backBadge, Sx, Sy - Math.round(24 * scale), '#38bdf8', '#ffffff', scale);
        }
      }
    }

    // 3. GUIA PARA ALCANCE / FLEXÃO DO BRAÇO (Cockpit / Cotovelo)
    const armTarget = targets.elbow || [150, 165];
    const armAngle = liveAngles.braco;
    if (
      armAngle !== null &&
      armAngle !== undefined &&
      (armAngle < armTarget[0] || armAngle > armTarget[1])
    ) {
      const pShoulder = landmarks[shoulderIdx];
      const pElbow = landmarks[elbowIdx];
      const pWrist = landmarks[wristIdx];

      if (pShoulder && pElbow && pWrist) {
        const Sx = pShoulder.x * w;
        const Sy = pShoulder.y * h;
        const Ex = pElbow.x * w;
        const Ey = pElbow.y * h;
        const Wx = pWrist.x * w;
        const Wy = pWrist.y * h;
        const Lforearm = Math.hypot(Wx - Ex, Wy - Ey);

        if (Lforearm > 15) {
          const VarmX = Ex - Sx;
          const VarmY = Ey - Sy;
          const VforearmX = Wx - Ex;
          const VforearmY = Wy - Ey;
          const cp = VarmX * VforearmY - VarmY * VforearmX;
          const phiCurr = Math.atan2(VforearmY, VforearmX);
          const targetAngle = 155; // Flexão protetora de 155°
          const deltaRad = (targetAngle - armAngle) * (Math.PI / 180);
          const sign = cp >= 0 ? 1 : -1;
          const phiTarget = phiCurr - sign * deltaRad;

          const targetWx = Ex + Lforearm * Math.cos(phiTarget);
          const targetWy = Ey + Lforearm * Math.sin(phiTarget);

          ctx.save();
          ctx.beginPath();
          ctx.setLineDash([Math.round(6 * scale), Math.round(5 * scale)]);
          ctx.lineWidth = Math.max(2.5, Math.round(3 * scale));
          ctx.strokeStyle = 'rgba(192, 132, 252, 0.7)';
          ctx.shadowColor = '#c084fc';
          ctx.shadowBlur = Math.round(8 * scale);
          ctx.moveTo(Ex, Ey);
          ctx.lineTo(targetWx, targetWy);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(targetWx, targetWy, Math.round(6 * scale), 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(192, 132, 252, 0.3)';
          ctx.fill();
          ctx.strokeStyle = '#c084fc';
          ctx.lineWidth = Math.max(2, Math.round(2 * scale));
          ctx.stroke();
          ctx.restore();

          this.drawDisplacementArrow(ctx, Wx, Wy, targetWx, targetWy, '#c084fc', scale);

          const armBadge = armAngle > armTarget[1]
            ? `↩ Fletir Braço (Alvo: 155° | Atual: ${Math.round(armAngle)}°)`
            : `↪ Abrir Cockpit (Alvo: 155° | Atual: ${Math.round(armAngle)}°)`;
          this.drawCanvasBadge(ctx, armBadge, Ex, Ey - Math.round(20 * scale), '#c084fc', '#ffffff', scale);
        }
      }
    }
  }
}
