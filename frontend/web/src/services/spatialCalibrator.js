/**
 * Calibração Espacial Métrica (Pixels para Centímetros) e Medição de Drop do Guiador.
 *
 * Utiliza referências dimensionais padrão conhecidas da indústria de ciclismo:
 * - Roda de Estrada 700c (aro ISO 622 + pneu 25c/28c): Diâmetro exterior ≈ 670 mm
 * - Roda de BTT 29" (aro ISO 622 + pneu 2.25"): Diâmetro exterior ≈ 740 mm
 * - Roda 27.5" / 650B: Diâmetro exterior ≈ 700 mm
 */
export class SpatialCalibrator {
  constructor() {
    this.pixelsPerMm = null;
    this.wheelType = '700c';
    this.referencePoints = []; // 2 pontos da roda
    this.saddlePoint = null;
    this.handlebarPoint = null;
  }

  get isCalibrated() {
    return this.pixelsPerMm !== null && this.pixelsPerMm > 0;
  }

  reset() {
    this.pixelsPerMm = null;
    this.referencePoints = [];
    this.saddlePoint = null;
    this.handlebarPoint = null;
  }

  /**
   * Calibra a relação de escala com base em dois pontos opostos do diâmetro da roda.
   */
  calibrateWheel(p1, p2, wheelType = '700c') {
    this.wheelType = wheelType;
    let referenceDiameterMm = 670;
    if (wheelType === '29mtb') referenceDiameterMm = 740;
    else if (wheelType === '650b') referenceDiameterMm = 700;

    const distPixels = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (distPixels < 20) {
      throw new Error('Distância entre os pontos da roda demasiado curta para calibração precisa.');
    }

    this.pixelsPerMm = distPixels / referenceDiameterMm;
    this.referencePoints = [p1, p2];
    return this.pixelsPerMm;
  }

  pixelsToMm(pixels) {
    if (!this.pixelsPerMm) return null;
    return Math.round(pixels / this.pixelsPerMm);
  }

  pixelsToCm(pixels) {
    if (!this.pixelsPerMm) return null;
    return Math.round((pixels / this.pixelsPerMm / 10) * 10) / 10;
  }

  /**
   * Calcula o desnível vertical entre selim e guiador (Saddle Drop) em centímetros.
   * Em coordenadas de ecrã, Y cresce para baixo: se guiador está mais baixo que o selim,
   * handlebar.y > saddle.y -> drop positivo.
   */
  calculateSaddleDropCm(saddle, handlebar) {
    if (!this.pixelsPerMm || !saddle || !handlebar) return null;
    this.saddlePoint = saddle;
    this.handlebarPoint = handlebar;

    const dropPixels = handlebar.y - saddle.y;
    return this.pixelsToCm(dropPixels);
  }

  /**
   * Calcula a distância direta (reach) em centímetros entre selim e guiador.
   */
  calculateCockpitReachCm(saddle, handlebar) {
    if (!this.pixelsPerMm || !saddle || !handlebar) return null;
    const reachPixels = Math.abs(handlebar.x - saddle.x);
    return this.pixelsToCm(reachPixels);
  }
}

