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
   * @param {string} defaultLevel - Nível de suavização ('ultra' | 'high' | 'medium' | 'low' | 'off')
   */
  constructor(defaultLevel = 'ultra') {
    this.level = defaultLevel;
    this.minCutoff = 0.25; // Frequência de corte mínima (Hz) para eliminar jitter a baixa velocidade
    this.beta = 0.003;     // Sensibilidade à velocidade para anular arrasto/lag a alta velocidade
    this.dCutoff = 1.0;    // Frequência de corte da derivada

    this.filters = [];     // Estado por articulação: { x, dx, y, dy, z, dz, t }
    this.previousLandmarks = null;
    this.trajectories = new Map();
    this.maxTrajectoryLength = 32;

    this.setSmoothingLevel(defaultLevel);
  }

  /**
   * Define o nível de estabilização contra ruído visual e oscilações do MediaPipe.
   * 
   * @param {'off' | 'low' | 'medium' | 'high' | 'ultra'} level
   */
  setSmoothingLevel(level) {
    this.level = level;
    switch (level) {
      case 'off':
        this.minCutoff = 100.0;
        this.beta = 0.0;
        break;
      case 'low':
        this.minCutoff = 1.8;
        this.beta = 0.020;
        break;
      case 'medium':
        this.minCutoff = 1.0;
        this.beta = 0.012;
        break;
      case 'high':
        this.minCutoff = 0.55;
        this.beta = 0.006;
        break;
      case 'ultra':
      default:
        // Modo Estúdio / Rigor Máximo: estabilidade absoluta contra oscilações de iluminação e pose
        this.minCutoff = 0.25;
        this.beta = 0.003;
        break;
    }
  }

  /**
   * Calcula o fator alpha do filtro passa-baixo exponencial.
   */
  getAlpha(dt, cutoff) {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  /**
   * Suaviza o array de 33 marcos anatómicos com o algoritmo One-Euro Filter (1€ Filter).
   * 
   * @param {Array<Object>} rawLandmarks - Array de {x, y, z, visibility}
   * @returns {Array<Object>} Array com as coordenadas filtradas com rigor cirúrgico
   */
  smooth(rawLandmarks) {
    if (!rawLandmarks || rawLandmarks.length === 0) {
      return rawLandmarks;
    }

    if (this.level === 'off') {
      this.previousLandmarks = rawLandmarks.map((lm) => ({ ...lm }));
      return rawLandmarks;
    }

    const now = performance.now();

    const smoothed = rawLandmarks.map((curr, idx) => {
      if (!this.filters[idx]) {
        this.filters[idx] = {
          x: curr.x,
          dx: 0,
          y: curr.y,
          dy: 0,
          z: curr.z || 0,
          dz: 0,
          t: now,
        };
        return { ...curr };
      }

      const f = this.filters[idx];
      const dt = Math.max(0.001, (now - f.t) / 1000.0);
      f.t = now;

      // Proteção contra marcos com visibilidade degradada
      const visibility = curr.visibility !== undefined ? curr.visibility : 1.0;
      if (visibility < 0.35) {
        return {
          x: f.x,
          y: f.y,
          z: f.z,
          visibility,
        };
      }

      // 1. Filtragem da velocidade (derivada dx/dt)
      const rawDx = (curr.x - f.x) / dt;
      const rawDy = (curr.y - f.y) / dt;
      const aD = this.getAlpha(dt, this.dCutoff);
      f.dx = aD * rawDx + (1.0 - aD) * f.dx;
      f.dy = aD * rawDy + (1.0 - aD) * f.dy;

      // 2. Frequência de corte adaptativa (elimina jitter a baixa velocidade e lag a alta velocidade)
      const speed = Math.hypot(f.dx, f.dy);
      const cutoff = this.minCutoff + this.beta * speed;
      const a = this.getAlpha(dt, cutoff);

      // 3. Suavização das posições X e Y
      f.x = a * curr.x + (1.0 - a) * f.x;
      f.y = a * curr.y + (1.0 - a) * f.y;

      if (curr.z !== undefined) {
        const rawDz = ((curr.z || 0) - f.z) / dt;
        f.dz = aD * rawDz + (1.0 - aD) * f.dz;
        const zCutoff = this.minCutoff + this.beta * Math.abs(f.dz);
        const aZ = this.getAlpha(dt, zCutoff);
        f.z = aZ * curr.z + (1.0 - aZ) * f.z;
      }

      return {
        x: f.x,
        y: f.y,
        z: f.z,
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

