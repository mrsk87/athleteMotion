/**
 * Serviço de Suavização Temporal de Pontos (LandmarkSmoother)
 * 
 * Responsabilidade:
 * - Filtrar ruído de alta frequência (jitter/tremor) das coordenadas do MediaPipe Pose
 *   através de Média Móvel Exponencial (EMA - Exponential Moving Average).
 * - Manter a estabilidade espacial dos 33 marcos anatómicos sem introduzir latência perceptível.
 * - Registar o rastro histórico (órbita de pedalada / trajetória) da articulação em foco.
 */

export class LandmarkSmoother {
  /**
   * @param {number} defaultAlpha - Fator de suavização (0.0 = imóvel, 1.0 = sem filtro). Padrão: 0.35
   */
  constructor(defaultAlpha = 0.35) {
    this.alpha = defaultAlpha;
    this.previousLandmarks = null;
    this.trajectories = new Map(); // jointIndex -> Array<{x, y}>
    this.maxTrajectoryLength = 28; // ~1 segundo de pedalada a 30 FPS
  }

  /**
   * Define o nível de estabilização contra ruído visual da câmara.
   * 
   * @param {'off' | 'low' | 'medium' | 'high'} level
   */
  setSmoothingLevel(level) {
    switch (level) {
      case 'off':
        this.alpha = 1.0; // Sem filtro
        break;
      case 'low':
        this.alpha = 0.60; // Muito ágil, ligeiro tremor
        break;
      case 'high':
        this.alpha = 0.18; // Estabilidade extrema de estúdio
        break;
      case 'medium':
      default:
        this.alpha = 0.35; // Equilíbrio ótimo entre precisão e fluidez
        break;
    }
  }

  /**
   * Suaviza o array de 33 marcos anatómicos recebido do MediaPipe.
   * 
   * @param {Array<Object>} rawLandmarks - Array de {x, y, z, visibility}
   * @returns {Array<Object>} Array com as coordenadas filtradas
   */
  smooth(rawLandmarks) {
    if (!rawLandmarks || rawLandmarks.length === 0) {
      return rawLandmarks;
    }

    if (!this.previousLandmarks || this.alpha === 1.0) {
      this.previousLandmarks = rawLandmarks.map((lm) => ({ ...lm }));
      return rawLandmarks;
    }

    const smoothed = rawLandmarks.map((curr, idx) => {
      const prev = this.previousLandmarks[idx];
      if (!prev) return { ...curr };

      // Se a visibilidade for muito baixa, manter a posição anterior em vez de saltar
      const visibility = curr.visibility !== undefined ? curr.visibility : 1.0;
      if (visibility < 0.35 && prev.visibility >= 0.35) {
        return { ...prev };
      }

      // Média Móvel Exponencial (EMA)
      const smoothedX = this.alpha * curr.x + (1 - this.alpha) * prev.x;
      const smoothedY = this.alpha * curr.y + (1 - this.alpha) * prev.y;
      const smoothedZ = curr.z !== undefined && prev.z !== undefined
        ? this.alpha * curr.z + (1 - this.alpha) * prev.z
        : curr.z;

      return {
        x: smoothedX,
        y: smoothedY,
        z: smoothedZ,
        visibility: curr.visibility,
      };
    });

    this.previousLandmarks = smoothed;
    return smoothed;
  }

  /**
   * Adiciona um ponto à trajetória histórica da articulação para desenhar a órbita.
   * 
   * @param {number} jointIndex - Índice do landmark (ex: 26 para joelho esquerdo)
   * @param {number} pxX - Coordenada X em píxeis
   * @param {number} pxY - Coordenada Y em píxeis
   */
  recordTrajectoryPoint(jointIndex, pxX, pxY) {
    if (!this.trajectories.has(jointIndex)) {
      this.trajectories.set(jointIndex, []);
    }
    const list = this.trajectories.get(jointIndex);
    list.push({ x: pxX, y: pxY, timestamp: Date.now() });

    if (list.length > this.maxTrajectoryLength) {
      list.shift();
    }
  }

  /**
   * Obtém a lista histórica de pontos da órbita da articulação.
   * 
   * @param {number} jointIndex
   * @returns {Array<{x: number, y: number}>}
   */
  getTrajectory(jointIndex) {
    return this.trajectories.get(jointIndex) || [];
  }

  /**
   * Limpa os acumuladores de suavização e histórico de trajetórias.
   */
  reset() {
    this.previousLandmarks = null;
    this.trajectories.clear();
  }
}

