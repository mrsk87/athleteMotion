/**
 * Gestor de Dispositivos de Vídeo e Streams WebRTC (CameraDeviceManager).
 *
 * Responsabilidade:
 * - Enumerar dispositivos de vídeo e identificar webcams físicas vs virtuais (OBS).
 * - Executar cascata (waterfall) de 6 níveis para conexão fiável a 720p/auto.
 * - Gerir o ciclo de vida do MediaStream nativo e libertar faixas de hardware.
 */

export class CameraDeviceManager {
  constructor() {
    this.stream = null;
    this.devices = [];
    this.activeLabel = '';
  }

  /**
   * Enumera os dispositivos de vídeo disponíveis no sistema.
   * Filtra dispositivos virtuais para priorizar hardware real.
   */
  async enumerateDevices(currentDeviceId = '') {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return { devices: [], selectedDeviceId: '' };
    }

    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');

      this.devices = videoInputs.map((d, index) => {
        const label = d.label || `Câmara ${index + 1}`;
        const lower = label.toLowerCase();
        const isVirtual =
          lower.includes('obs') ||
          lower.includes('virtual') ||
          lower.includes('droidcam') ||
          lower.includes('iriun') ||
          lower.includes('vysor') ||
          lower.includes('epoccam') ||
          lower.includes('snap camera');
        return {
          deviceId: d.deviceId,
          label,
          isVirtual,
        };
      });

      const physicalCams = this.devices.filter((d) => !d.isVirtual);
      const envCam = physicalCams.find(
        (d) =>
          d.label.toLowerCase().includes('back') ||
          d.label.toLowerCase().includes('traseira') ||
          d.label.toLowerCase().includes('rear')
      );
      const preferredPhysical = envCam || physicalCams[0];

      let selectedId = currentDeviceId;
      const currentExists = this.devices.find((d) => d.deviceId === currentDeviceId);
      if (!currentDeviceId || !currentExists) {
        if (preferredPhysical) {
          selectedId = preferredPhysical.deviceId;
        } else if (this.devices.length > 0) {
          selectedId = this.devices[0].deviceId;
        }
      }

      return { devices: this.devices, selectedDeviceId: selectedId };
    } catch (err) {
      console.warn('Erro ao enumerar dispositivos de vídeo:', err);
      return { devices: [], selectedDeviceId: currentDeviceId };
    }
  }

  /**
   * Conecta à câmara via cascata de 6 níveis de tolerância.
   */
  async requestStream(targetId, facingMode = 'environment') {
    const tryGetUserMedia = async (constraints) => {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
      } catch (err) {
        return null;
      }
    };

    let s = null;
    if (targetId) {
      // 1. Resolução 720p ideal
      s = await tryGetUserMedia({ deviceId: { exact: targetId }, width: { ideal: 1280 }, height: { ideal: 720 } });
      // 2. Resolução auto
      if (!s) s = await tryGetUserMedia({ deviceId: { exact: targetId } });
      // 3. Constraint flexível
      if (!s) s = await tryGetUserMedia({ deviceId: targetId });
    }

    // 4. Câmara física alternativa
    if (!s) {
      const otherPhysical = this.devices.find((d) => !d.isVirtual && d.deviceId !== targetId);
      if (otherPhysical) {
        s = await tryGetUserMedia({ deviceId: { exact: otherPhysical.deviceId } });
        if (s) targetId = otherPhysical.deviceId;
      }
    }

    // 5. FacingMode mobile
    if (!s && facingMode) {
      s = await tryGetUserMedia({ facingMode, width: { ideal: 1280 }, height: { ideal: 720 } });
    }

    // 6. Último recurso genérico
    if (!s) {
      s = await tryGetUserMedia(true);
    }

    this.stream = s;
    if (s) {
      const track = s.getVideoTracks()[0];
      this.activeLabel = track?.label || 'Webcam Ativa';
    }
    return { stream: s, selectedDeviceId: targetId, activeLabel: this.activeLabel };
  }

  /**
   * Encerra todas as faixas do stream atual para libertar o hardware da câmara.
   */
  stopStream() {
    if (this.stream) {
      try {
        this.stream.getTracks().forEach((track) => track.stop());
      } catch (e) {
        console.debug('Erro ao encerrar faixas de vídeo:', e);
      }
      this.stream = null;
    }
  }
}
