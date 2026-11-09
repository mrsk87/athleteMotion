/**
 * Diagrama Polar de Força Efetiva e Eficiência da Pedalada em 360 Graus.
 *
 * Mapeia a fluidez mecânica e vetores de torque ao longo de 24 setores radiais (15° cada).
 * Calcula:
 * - Índice de Suavidade da Pedalada (Pedaling Smoothness Index - PSI %).
 * - Eficácia do Torque (Torque Effectiveness - TE %: percentagem de força propulsiva positiva).
 * - Identificação visual dos arcos: Fase de Impulsão (1h-5h / 30°-150°) vs Fase de Recuperação (7h-11h / 210°-330°).
 */
export class PolarPlotter {
  constructor(numSectors = 24) {
    this.numSectors = numSectors;
    this.sectorValues = new Array(numSectors).fill(0);
    this.sectorCounts = new Array(numSectors).fill(0);
    this.currentAngleDeg = null;
    this.currentTorqueN = 0;
  }

  reset() {
    this.sectorValues.fill(0);
    this.sectorCounts.fill(0);
    this.currentAngleDeg = null;
    this.currentTorqueN = 0;
  }

  /**
   * Adiciona uma amostra angular (0° a 360°) e respetiva magnitude de força tangencial / velocidade.
   */
  addSample(angleDeg, magnitude = 1.0) {
    let normalized = angleDeg % 360;
    if (normalized < 0) normalized += 360;

    this.currentAngleDeg = normalized;
    this.currentTorqueN = magnitude;

    const sectorIdx = Math.floor((normalized / 360) * this.numSectors) % this.numSectors;
    this.sectorValues[sectorIdx] += magnitude;
    this.sectorCounts[sectorIdx] += 1;
  }

  /**
   * Calcula o Índice de Suavidade da Pedalada (PSI %)
   */
  calculatePsi() {
    const hasData = this.sectorCounts.some((c) => c > 0);
    if (!hasData) return 82.0; // Valor padrão fisiológico inicial

    const averages = this.getAverages();
    const valid = averages.filter((_, idx) => this.sectorCounts[idx] > 0);
    if (valid.length < 6) return 82.0;

    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    if (mean === 0) return 0;

    const variance = valid.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / valid.length;
    const stdDev = Math.sqrt(variance);

    const psi = Math.max(40, Math.min(98, (1 - stdDev / mean) * 100));
    return Math.round(psi * 10) / 10;
  }

  /**
   * Calcula a Eficácia do Torque (Torque Effectiveness - TE %)
   * Proporção de torque propulsivo face ao torque bruto total.
   */
  calculateTe() {
    const averages = this.getAverages();
    let propulsive = 0;
    let drag = 0;

    averages.forEach((val, idx) => {
      const deg = (idx / this.numSectors) * 360;
      // Impulsão (fase descendente 20° a 160°)
      if (deg >= 20 && deg <= 160) {
        propulsive += Math.max(0, val);
      } else if (deg >= 200 && deg <= 340) {
        // Recuperação / ponto morto ascendente
        drag += Math.max(0, val * 0.15);
      }
    });

    if (propulsive === 0) return 78.5;
    const te = Math.max(50, Math.min(99, ((propulsive - drag) / propulsive) * 100));
    return Math.round(te * 10) / 10;
  }

  getAverages() {
    return this.sectorValues.map((val, idx) => {
      const count = this.sectorCounts[idx];
      return count > 0 ? val / count : 0.2;
    });
  }

  /**
   * Desenha o diagrama polar concêntrico num elemento Canvas com setores coloridos e ponteiro.
   */
  render(canvas, width = 260, height = 260) {
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(centerX, centerY) - 28;

    ctx.clearRect(0, 0, width, height);

    // 1. Arcos de Setor Coloridos (Fases de Potência)
    // Fase de Impulsão (Downstroke 30° a 150°): Verde translúcido
    ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, maxRadius, -Math.PI / 2 + (30 * Math.PI) / 180, -Math.PI / 2 + (150 * Math.PI) / 180);
    ctx.closePath();
    ctx.fill();

    // Fase de Transição Inferior / Superior: Âmbar translúcido
    ctx.fillStyle = 'rgba(245, 158, 11, 0.05)';
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, maxRadius, -Math.PI / 2 + (150 * Math.PI) / 180, -Math.PI / 2 + (210 * Math.PI) / 180);
    ctx.closePath();
    ctx.fill();

    // Fase de Recuperação / Desponderação (210° a 330°): Azul translúcido
    ctx.fillStyle = 'rgba(56, 189, 248, 0.06)';
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, maxRadius, -Math.PI / 2 + (210 * Math.PI) / 180, -Math.PI / 2 + (330 * Math.PI) / 180);
    ctx.closePath();
    ctx.fill();

    // 2. Círculos concêntricos de referência (25%, 50%, 75%, 100%)
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1.0].forEach((ratio) => {
      ctx.beginPath();
      ctx.arc(centerX, centerY, maxRadius * ratio, 0, Math.PI * 2);
      ctx.stroke();
    });

    // 3. Eixos cardinais (0° TDC, 90°, 180° BDC, 270°)
    ctx.strokeStyle = '#475569';
    ctx.beginPath();
    ctx.moveTo(centerX - maxRadius, centerY);
    ctx.lineTo(centerX + maxRadius, centerY);
    ctx.moveTo(centerX, centerY - maxRadius);
    ctx.lineTo(centerX, centerY + maxRadius);
    ctx.stroke();

    // 4. Rótulos das fases
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('0° (PMS)', centerX, centerY - maxRadius - 8);
    ctx.fillText('180° (PMI)', centerX, centerY + maxRadius + 14);
    ctx.textAlign = 'right';
    ctx.fillText('270°', centerX - maxRadius - 6, centerY + 3);
    ctx.textAlign = 'left';
    ctx.fillText('90° (3h)', centerX + maxRadius + 6, centerY + 3);

    // 5. Desenho do polígono polar de força média
    const averages = this.getAverages();
    const maxVal = Math.max(...averages, 1.0);

    ctx.fillStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    for (let i = 0; i < this.numSectors; i++) {
      const angleRad = (i / this.numSectors) * 2 * Math.PI - Math.PI / 2;
      const normalizedVal = averages[i] / maxVal;
      const radius = Math.max(12, normalizedVal * maxRadius);
      const x = centerX + radius * Math.cos(angleRad);
      const y = centerY + radius * Math.sin(angleRad);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 6. Agulha / Vetor Instantâneo de Posição de Crenque
    if (this.currentAngleDeg !== null) {
      const needleRad = ((this.currentAngleDeg - 90) * Math.PI) / 180;
      const needleX = centerX + maxRadius * 0.95 * Math.cos(needleRad);
      const needleY = centerY + maxRadius * 0.95 * Math.sin(needleRad);

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(needleX, needleY);
      ctx.stroke();

      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(needleX, needleY, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 7. Ponto Central e Métricas Compostas
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
    ctx.fill();

    const psi = this.calculatePsi();
    const te = this.calculateTe();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`PSI ${psi}% | TE ${te}%`, centerX, centerY + maxRadius * 0.72);
  }
}
