/**
 * Gestor da Calibração Métrica por Clique na Roda (WheelCalibratorHandler).
 *
 * Responsabilidade:
 * - Coletar 2 pontos do diâmetro da roda selecionados interativamente pelo utilizador.
 * - Invocar SpatialCalibrator para calcular o rácio real pixels/mm.
 */

export class WheelCalibratorHandler {
  constructor(spatialCalibrator, { onCalibrated, onToast }) {
    this.spatialCalibrator = spatialCalibrator;
    this.onCalibrated = onCalibrated;
    this.onToast = onToast;

    this.isCalibrating = false;
    this.points = [];
  }

  start() {
    this.isCalibrating = true;
    this.points = [];
    if (this.onToast) {
      this.onToast('Clique em 2 pontos opostos do aro da roda (topo e base).');
    }
  }

  cancel() {
    this.isCalibrating = false;
    this.points = [];
  }

  handleClick(point, ridingStyle = 'road') {
    if (!this.isCalibrating) return false;

    this.points.push(point);

    if (this.points.length === 1) {
      if (this.onToast) this.onToast('Ponto 1 registado. Clique no ponto oposto.');
      return false;
    }

    if (this.points.length === 2) {
      const wheelType = ridingStyle === 'mtb' ? '29mtb' : '700c';
      try {
        this.spatialCalibrator.calibrateWheel(this.points[0], this.points[1], wheelType);
        this.isCalibrating = false;
        const pxPerMm = this.spatialCalibrator.pixelsPerMm;

        if (this.onToast) {
          this.onToast(`Escala métrica calibrada com sucesso! (${pxPerMm.toFixed(2)} px/mm)`);
        }
        if (this.onCalibrated) {
          this.onCalibrated(pxPerMm);
        }
      } catch (err) {
        if (this.onToast) this.onToast(err.message || 'Erro na calibração da roda.');
        this.points = [];
      }
      return true;
    }

    return false;
  }
}
