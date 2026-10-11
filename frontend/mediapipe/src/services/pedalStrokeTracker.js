/**
 * Rastreamento de Ciclo de Pedalada, Deteção de Ponto Morto Inferior (BDC) e Cadência RPM.
 *
 * Em ciclismo, a extensão máxima do joelho (ângulo de Holmes) só tem validade biomecânica
 * quando medida no Ponto Morto Inferior (BDC - Bottom Dead Center, posição das 6 horas).
 *
 * Em coordenadas de ecrã/canvas, Y cresce para baixo: o ponto mais baixo da perna é o MÁXIMO local de Y.
 */
export class PedalStrokeTracker {
  constructor(windowSize = 15) {
    this.history = []; // { y, timestamp }
    this.windowSize = windowSize;
    this.lastBdcTimestamp = 0;
    this.currentRpm = 0;
    this.lastBdcKneeAngle = null;
    this.bdcCount = 0;
    this.recentBdcKneeAngles = [];
  }

  reset() {
    this.history = [];
    this.lastBdcTimestamp = 0;
    this.currentRpm = 0;
    this.lastBdcKneeAngle = null;
    this.bdcCount = 0;
    this.recentBdcKneeAngles = [];
  }

  addSample(ankleY, currentKneeAngle = null, timestamp = performance.now()) {
    if (ankleY === null || ankleY === undefined) {
      return { isBdc: false, rpm: this.currentRpm, bdcKneeAngle: this.lastBdcKneeAngle };
    }

    this.history.push({ y: ankleY, kneeAngle: currentKneeAngle, timestamp });
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }

    return this.detectBdc(currentKneeAngle);
  }

  detectBdc(currentKneeAngle) {
    if (this.history.length < 7) {
      return { isBdc: false, rpm: this.currentRpm, bdcKneeAngle: this.lastBdcKneeAngle };
    }

    const midIdx = Math.floor(this.history.length / 2);
    const candidate = this.history[midIdx];

    // Verificar se o ponto central é o máximo local de Y (ponto mais baixo espacialmente)
    let isPeak = true;
    for (let i = 0; i < this.history.length; i++) {
      if (i !== midIdx && this.history[i].y > candidate.y) {
        isPeak = false;
        break;
      }
    }

    // Intervalo de cadência fisiológica: 400ms a 2000ms (30 a 150 RPM)
    const timeSinceLastBdc = candidate.timestamp - this.lastBdcTimestamp;
    if (isPeak && timeSinceLastBdc > 400 && timeSinceLastBdc < 2500) {
      const deltaSeconds = timeSinceLastBdc / 1000;
      if (this.lastBdcTimestamp > 0 && deltaSeconds > 0) {
        const instantRpm = Math.round(60 / deltaSeconds);
        // Suavização exponencial da cadência
        this.currentRpm = this.currentRpm === 0 ? instantRpm : Math.round(0.7 * this.currentRpm + 0.3 * instantRpm);
      }

      this.lastBdcTimestamp = candidate.timestamp;
      this.bdcCount += 1;

      // Ângulo do joelho congelado no BDC
      const bdcAngle = candidate.kneeAngle || currentKneeAngle;
      if (bdcAngle && bdcAngle > 50 && bdcAngle < 180) {
        this.lastBdcKneeAngle = Math.round(bdcAngle * 10) / 10;
        this.recentBdcKneeAngles.push(this.lastBdcKneeAngle);
        if (this.recentBdcKneeAngles.length > 20) {
          this.recentBdcKneeAngles.shift();
        }
      }

      return {
        isBdc: true,
        rpm: this.currentRpm,
        bdcKneeAngle: this.lastBdcKneeAngle,
        timestamp: candidate.timestamp,
        bdcCount: this.bdcCount,
      };
    }

    // Se o atleta parou de pedalar por mais de 3 segundos, zerar RPM
    if (performance.now() - this.lastBdcTimestamp > 3000 && this.currentRpm > 0) {
      this.currentRpm = 0;
    }

    return {
      isBdc: false,
      rpm: this.currentRpm,
      bdcKneeAngle: this.lastBdcKneeAngle,
    };
  }

  getAverageBdcKneeAngle() {
    if (this.recentBdcKneeAngles.length === 0) return this.lastBdcKneeAngle;
    const sum = this.recentBdcKneeAngles.reduce((acc, val) => acc + val, 0);
    return Math.round((sum / this.recentBdcKneeAngles.length) * 10) / 10;
  }
}

