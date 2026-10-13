/**
 * Serviço de Rastreamento de Marcadores Manuais e Foco Articular (ManualMarkerTracker)
 * 
 * Responsabilidade:
 * - Permitir a calibração manual de marcadores anatómicos (ex.: adesivos físicos no joelho,
 *   anca ou maléolo colocados pelo fisioterapeuta/bike fitter).
 * - Calcular o deslocamento relativo (offset delta) entre a estimativa automática do MediaPipe
 *   e a posição real indicada no clique manual.
 * - Manter o marcador travado com precisão e seguir o movimento do corpo sem dispersão.
 * - Gerir o modo de Foco Articular dedicado (isolamento visual com retículo e órbita).
 */

import { OpticalFeatureTracker } from './opticalFeatureTracker';

export class ManualMarkerTracker {
  constructor() {
    // Mapa de offsets manuais por articulação: jointName -> { deltaX, deltaY, calibratedAt }
    this.offsets = new Map();

    // Rastreador ótico baseado em relevo, luz e formas
    this.opticalTracker = new OpticalFeatureTracker();

    // Estado da calibração manual interativa
    this.activeCalibratingJoint = null; // 'knee' | 'hip' | 'ankle' | 'elbow' | 'shoulder' | null

    // Articulação em foco ('all' | 'knee' | 'hip' | 'ankle' | 'cockpit' | 'kops')
    this.focusTarget = 'all';
  }

  /**
   * Define a articulação em foco para visualização de alta precisão.
   * 
   * @param {string} target - 'all' | 'knee' | 'hip' | 'ankle' | 'cockpit' | 'kops'
   */
  setFocusTarget(target) {
    this.focusTarget = target || 'all';
  }

  /**
   * Inicia o modo de calibração manual para uma articulação específica.
   * 
   * @param {string} jointName - 'knee' | 'hip' | 'ankle' | 'elbow' | 'shoulder'
   */
  startManualCalibration(jointName) {
    this.activeCalibratingJoint = jointName;
  }

  /**
   * Cancela o modo de calibração manual.
   */
  cancelManualCalibration() {
    this.activeCalibratingJoint = null;
  }

  /**
   * Aplica o clique manual registado no canvas para calcular o deslocamento relativo
   * e bloqueia o patch visual de relevo/luz no OpticalFeatureTracker.
   * 
   * @param {number} clickNormX - Posição X normalizada [0.0 - 1.0]
   * @param {number} clickNormY - Posição Y normalizada [0.0 - 1.0]
   * @param {Object} detectedLandmark - { x, y } do MediaPipe
   * @param {HTMLVideoElement | HTMLCanvasElement} [sourceImage] - Fonte de imagem para extrair relevo
   * @returns {boolean} True se a calibração foi gravada com sucesso
   */
  applyCalibrationClick(clickNormX, clickNormY, detectedLandmark, sourceImage = null) {
    if (!this.activeCalibratingJoint) {
      return false;
    }

    const joint = this.activeCalibratingJoint;
    const deltaX = detectedLandmark ? clickNormX - detectedLandmark.x : 0;
    const deltaY = detectedLandmark ? clickNormY - detectedLandmark.y : 0;

    this.offsets.set(joint, {
      deltaX,
      deltaY,
      staticX: clickNormX,
      staticY: clickNormY,
      hasRelativeLandmark: !!detectedLandmark,
      calibratedAt: Date.now(),
    });

    // Bloqueia as características óticas (luz, relevo e bordas) do ponto clicado
    if (sourceImage) {
      this.opticalTracker.lockMarker(joint, clickNormX, clickNormY, sourceImage);
    }

    this.activeCalibratingJoint = null;
    return joint;
  }

  /**
   * Atualiza o rastreio ótico de todos os marcadores bloqueados para o fotograma atual.
   */
  updateOpticalTracking(videoOrCanvas, rawLandmarksMap = {}) {
    if (!videoOrCanvas) return;
    for (const marker of this.opticalTracker.getAllMarkers()) {
      const fallback = rawLandmarksMap[marker.jointKey] || { x: marker.normX, y: marker.normY };
      this.opticalTracker.track(marker.jointKey, fallback.x, fallback.y, videoOrCanvas);
    }
  }

  /**
   * Ajusta um marco anatómico com base no offset manual calibrado (se existir).
   * 
   * @param {string} jointName - Nome da articulação
   * @param {Object} landmark - Objeto { x, y } original
   * @returns {Object} Objeto com { x, y } calibrado e flag isManual: true/false
   */
  getAdjustedPoint(jointName, landmark) {
    // 1. Se existir ponto bloqueado por rastreio ótico de relevo, tem prioridade absoluta
    const optical = this.opticalTracker.getMarker(jointName);
    if (optical) {
      return {
        x: optical.normX,
        y: optical.normY,
        isManual: true,
        isOptical: true,
        confidence: optical.confidence,
        status: optical.status,
        jointName,
      };
    }

    // 2. Se existir offset estático/relativo calibrado
    const offset = this.offsets.get(jointName);
    if (!offset) {
      if (!landmark) return null;
      return {
        x: landmark.x,
        y: landmark.y,
        isManual: false,
      };
    }

    if (landmark) {
      // Se no momento do clique não havia landmark detetado, calcular o delta relativo agora
      if (!offset.hasRelativeLandmark) {
        offset.deltaX = offset.staticX - landmark.x;
        offset.deltaY = offset.staticY - landmark.y;
        offset.hasRelativeLandmark = true;
      }

      return {
        x: Math.max(0, Math.min(1.0, landmark.x + offset.deltaX)),
        y: Math.max(0, Math.min(1.0, landmark.y + offset.deltaY)),
        isManual: true,
        jointName,
      };
    }

    return {
      x: offset.staticX,
      y: offset.staticY,
      isManual: true,
      jointName,
    };
  }

  /**
   * Verifica se uma articulação possui calibração manual ou ótica ativa.
   * 
   * @param {string} jointName
   * @returns {boolean}
   */
  hasManualOffset(jointName) {
    return this.offsets.has(jointName) || this.opticalTracker.isLocked(jointName);
  }

  /**
   * Remove a calibração manual e o rastreio ótico de uma articulação ou de todas.
   * 
   * @param {string} [jointName]
   */
  clearCalibration(jointName) {
    if (jointName) {
      this.offsets.delete(jointName);
      this.opticalTracker.unlock(jointName);
    } else {
      this.offsets.clear();
      this.opticalTracker.clearAll();
    }
  }

  /**
   * Retorna a lista de todos os marcadores manuais registados, com as suas posições
   * atualizadas (seja relativas aos landmarks do corpo ou na sua posição estática inicial).
   * 
   * @param {Object} [landmarksMap] - Dicionário opcional { [jointName]: { x, y } }
   * @returns {Array<{ jointName: string, x: number, y: number, isManual: boolean, hasLandmark: boolean, deltaX: number, deltaY: number }>}
   */
  getAllCalibratedMarkers(landmarksMap = {}) {
    const markers = [];
    for (const [jointName, offset] of this.offsets.entries()) {
      const lm = landmarksMap[jointName] || null;
      const pt = this.getAdjustedPoint(jointName, lm);
      if (pt) {
        markers.push({
          jointName,
          x: pt.x,
          y: pt.y,
          isManual: true,
          hasLandmark: !!lm,
          deltaX: offset.deltaX,
          deltaY: offset.deltaY,
        });
      }
    }
    return markers;
  }
}

