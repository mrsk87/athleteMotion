/**
 * Diagrama Polar de Eficiência e Redondeza da Pedalada em 360 Graus.
 *
 * Mapeia a fluidez mecânica da pedalada ao longo de 24 setores radiais (15° cada).
 * Calcula o Índice de Suavidade de Pedalada (Pedaling Smoothness Index - PSI %).
 */
export class PolarPlotter {
  constructor(numSectors = 24) {
    this.numSectors = numSectors;
    this.sectorValues = new Array(numSectors).fill(0);
    this.sectorCounts = new Array(numSectors).fill(0);
  }

  reset() {
    this.sectorValues.fill(0);
    this.sectorCounts.fill(0);
  }

  /**
   * Adiciona uma amostra angular (0° a 360°) e respectiva magnitude de velocidade/força.
   */
  addSample(angleDeg, magnitude = 1.0) {
    let normalized = angleDeg % 360;
    if (normalized < 0) normalized += 360;

    const sectorIdx = Math.floor((normalized / 360) * this.numSectors) % this.numSectors;
    this.sectorValues[sectorIdx] += magnitude;
    this.sectorCounts[sectorIdx] += 1;
  }

  /**
   * Calcula o Índice de Suavidade da Pedalada (PSI %)
   */
  calculatePsi() {
    const averages = this.getAverages();
    const valid = averages.filter((v) => v > 0);
    if (valid.length < 6) return 82.0; // Valor padrão fisiológico inicial

    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    if (mean === 0) return 0;

    const variance = valid.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / valid.length;
    const stdDev = Math.sqrt(variance);

    const psi = Math.max(40, Math.min(98, (1 - stdDev / mean) * 100));
    return Math.round(psi * 10) / 10;
  }

  getAverages() {
    return this.sectorValues.map((val, idx) => {
      const count = this.sectorCounts[idx];
      return count > 0 ? val / count : 0.2;
    });
  }

  /**
   * Desenha o diagrama polar concêntrico num elemento Canvas.
   */
  render(canvas, width = 240, height = 240) {
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(centerX, centerY) - 24;

    ctx.clearRect(0, 0, width, height);

    // 1. Círculos concêntricos de referência
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1.0].forEach((ratio) => {
      ctx.beginPath();
      ctx.arc(centerX, centerY, maxRadius * ratio, 0, Math.PI * 2);
      ctx.stroke();
    });

    // 2. Eixos dos 4 quadrantes
    ctx.beginPath();
    ctx.moveTo(centerX - maxRadius, centerY);
    ctx.lineTo(centerX + maxRadius, centerY);
    ctx.moveTo(centerX, centerY - maxRadius);
    ctx.lineTo(centerX, centerY + maxRadius);
    ctx.stroke();

    // 3. Rótulos dos eixos
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('0° (PMS)', centerX, centerY - maxRadius - 6);
    ctx.fillText('180° (PMI)', centerX, centerY + maxRadius + 14);
    ctx.textAlign = 'right';
    ctx.fillText('270°', centerX - maxRadius - 6, centerY + 3);
    ctx.textAlign = 'left';
    ctx.fillText('90°', centerX + maxRadius + 6, centerY + 3);

    // 4. Desenho do polígono polar de suavidade
    const averages = this.getAverages();
    const maxVal = Math.max(...averages, 1.0);

    ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    for (let i = 0; i < this.numSectors; i++) {
      const angleRad = (i / this.numSectors) * 2 * Math.PI - Math.PI / 2;
      const normalizedVal = averages[i] / maxVal;
      const radius = Math.max(10, normalizedVal * maxRadius);
      const x = centerX + radius * Math.cos(angleRad);
      const y = centerY + radius * Math.sin(angleRad);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 5. Centro e pontuação central
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
    ctx.fill();

    const psi = this.calculatePsi();
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`PSI: ${psi}%`, centerX, centerY + 4);
  }
}

