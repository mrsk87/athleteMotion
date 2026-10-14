/**
 * Composable para Gestão de Câmara, Dispositivos e Streams de Vídeo (R16 / Clean Architecture).
 *
 * Responsabilidades:
 * - Enumerar câmaras conectadas (webcam USB, câmara interna, câmara de telemóvel).
 * - Negociar resoluções e framerates compatíveis (preferindo 60 FPS / 1080p ou 720p).
 * - Gestão rigorosa de ciclos de vida: libertação de tracks de hardware no encerramento (sem fugas de memória).
 */

import { ref, onBeforeUnmount, getCurrentInstance } from 'vue';

export function useCamera() {
  const currentStream = ref(null);
  const devices = ref([]);
  const selectedDeviceId = ref('');
  const isCameraActive = ref(false);
  const cameraError = ref(null);
  const videoDimensions = ref({ width: 0, height: 0 });

  /**
   * Lista todos os dispositivos de entrada de vídeo disponíveis.
   * @returns {Promise<MediaDeviceInfo[]>}
   */
  async function listDevices() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }

    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');
      devices.value = videoInputs;

      if (!selectedDeviceId.value && videoInputs.length > 0) {
        selectedDeviceId.value = videoInputs[0].deviceId;
      }

      return videoInputs;
    } catch (err) {
      console.warn('[useCamera] Erro ao enumerar câmaras:', err);
      cameraError.value = err.message;
      return [];
    }
  }

  /**
   * Inicia a captura de vídeo na câmara selecionada.
   * @param {HTMLVideoElement} videoElement
   * @param {string} [deviceId]
   * @param {Object} [constraints]
   * @returns {Promise<MediaStream|null>}
   */
  async function startCamera(videoElement, deviceId = null, constraints = {}) {
    stopCamera();
    cameraError.value = null;

    const targetDeviceId = deviceId || selectedDeviceId.value;

    const videoConstraints = {
      deviceId: targetDeviceId ? { exact: targetDeviceId } : undefined,
      width: { ideal: 1920, min: 640 },
      height: { ideal: 1080, min: 480 },
      frameRate: { ideal: 60, min: 30 },
      ...constraints,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });

      currentStream.value = stream;
      if (videoElement) {
        videoElement.srcObject = stream;
        await videoElement.play().catch((err) => {
          console.warn('[useCamera] Autoplay bloqueado pelo navegador:', err);
        });

        videoDimensions.value = {
          width: videoElement.videoWidth || 1280,
          height: videoElement.videoHeight || 720,
        };
      }

      isCameraActive.value = true;
      if (targetDeviceId) {
        selectedDeviceId.value = targetDeviceId;
      }

      return stream;
    } catch (err) {
      console.error('[useCamera] Falha ao aceder à câmara:', err);
      cameraError.value = err.name === 'NotAllowedError'
        ? 'Permissão de acesso à câmara foi recusada.'
        : `Erro ao iniciar câmara: ${err.message}`;
      isCameraActive.value = false;
      return null;
    }
  }

  /**
   * Pára e liberta todos os tracks da câmara ativa.
   */
  function stopCamera(videoElement = null) {
    if (currentStream.value) {
      currentStream.value.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.warn('[useCamera] Erro ao parar track:', e);
        }
      });
      currentStream.value = null;
    }

    if (videoElement && videoElement.srcObject) {
      videoElement.srcObject = null;
    }

    isCameraActive.value = false;
  }

  // Limpeza automática ao desmontar componente
  if (getCurrentInstance() && typeof onBeforeUnmount === 'function') {
    onBeforeUnmount(() => {
      stopCamera();
    });
  }

  return {
    currentStream,
    devices,
    selectedDeviceId,
    isCameraActive,
    cameraError,
    videoDimensions,
    listDevices,
    startCamera,
    stopCamera,
  };
}

export default useCamera;
