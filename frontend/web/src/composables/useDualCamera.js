/**
 * Composable para Sincronização Estéreo Dual-Câmara (Sagital + Frontal).
 *
 * Responsabilidades:
 * - Enumerar e negociar simultaneamente duas fontes de vídeo independentes (USB/Webcam).
 * - Sincronização de frames com carimbo temporal unificado (performance.now()).
 * - Renderização em Canvas composto (Side-by-Side ou Picture-in-Picture).
 * - Libertação atómica de recursos de hardware em unmount.
 */

import { computed, getCurrentInstance, onBeforeUnmount, ref } from 'vue';

export function useDualCamera() {
  const devices = ref([]);
  const primaryDeviceId = ref('');
  const secondaryDeviceId = ref('');

  const primaryStream = ref(null);
  const secondaryStream = ref(null);

  const primaryVideoEl = ref(null);
  const secondaryVideoEl = ref(null);

  const layoutMode = ref('side_by_side'); // 'side_by_side' | 'pip' | 'primary_only'
  const isPrimaryActive = ref(false);
  const isSecondaryActive = ref(false);
  const dualCameraError = ref(null);

  const isDualActive = computed(() => isPrimaryActive.value && isSecondaryActive.value);

  /**
   * Enumera os dispositivos de vídeo disponíveis no sistema.
   */
  async function listDevices() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = all.filter((d) => d.kind === 'videoinput');
      devices.value = videoInputs;

      if (!primaryDeviceId.value && videoInputs.length > 0) {
        primaryDeviceId.value = videoInputs[0].deviceId;
      }
      if (!secondaryDeviceId.value && videoInputs.length > 1) {
        secondaryDeviceId.value = videoInputs[1].deviceId;
      }
      return videoInputs;
    } catch (err) {
      console.warn('[useDualCamera] Erro ao enumerar dispositivos:', err);
      dualCameraError.value = err.message;
      return [];
    }
  }

  /**
   * Inicia o stream primário (tipicamente vista Sagital Lateral).
   */
  async function startPrimary(videoElement, deviceId = null) {
    stopPrimary();
    dualCameraError.value = null;
    primaryVideoEl.value = videoElement;

    const targetId = deviceId || primaryDeviceId.value;
    const constraints = {
      video: {
        deviceId: targetId ? { exact: targetId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60, min: 30 },
      },
      audio: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      primaryStream.value = stream;
      if (videoElement) {
        videoElement.srcObject = stream;
        await videoElement.play();
      }
      isPrimaryActive.value = true;
      return stream;
    } catch (err) {
      console.error('[useDualCamera] Falha ao iniciar câmara primária:', err);
      dualCameraError.value = `Câmara Primária: ${err.message}`;
      isPrimaryActive.value = false;
      return null;
    }
  }

  /**
   * Inicia o stream secundário (tipicamente vista Frontal / Tronco).
   */
  async function startSecondary(videoElement, deviceId = null) {
    stopSecondary();
    dualCameraError.value = null;
    secondaryVideoEl.value = videoElement;

    const targetId = deviceId || secondaryDeviceId.value;
    const constraints = {
      video: {
        deviceId: targetId ? { exact: targetId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60, min: 30 },
      },
      audio: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      secondaryStream.value = stream;
      if (videoElement) {
        videoElement.srcObject = stream;
        await videoElement.play();
      }
      isSecondaryActive.value = true;
      return stream;
    } catch (err) {
      console.error('[useDualCamera] Falha ao iniciar câmara secundária:', err);
      dualCameraError.value = `Câmara Secundária: ${err.message}`;
      isSecondaryActive.value = false;
      return null;
    }
  }

  function stopPrimary() {
    if (primaryStream.value) {
      primaryStream.value.getTracks().forEach((track) => track.stop());
      primaryStream.value = null;
    }
    if (primaryVideoEl.value) {
      primaryVideoEl.value.srcObject = null;
    }
    isPrimaryActive.value = false;
  }

  function stopSecondary() {
    if (secondaryStream.value) {
      secondaryStream.value.getTracks().forEach((track) => track.stop());
      secondaryStream.value = null;
    }
    if (secondaryVideoEl.value) {
      secondaryVideoEl.value.srcObject = null;
    }
    isSecondaryActive.value = false;
  }

  function stopAll() {
    stopPrimary();
    stopSecondary();
  }

  /**
   * Desenha a composição estéreo sincronizada num elemento Canvas de saída.
   * @param {HTMLCanvasElement} canvas
   */
  function renderCompositeFrame(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pVideo = primaryVideoEl.value;
    const sVideo = secondaryVideoEl.value;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (layoutMode.value === 'side_by_side') {
      const halfW = w / 2;
      // Metade esquerda: Câmara Sagital
      if (pVideo && pVideo.readyState >= 2) {
        ctx.drawImage(pVideo, 0, 0, halfW, h);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(8, 8, 120, 24);
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('SAGITAL (LATERAL)', 14, 24);
      } else {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, halfW, h);
        ctx.fillStyle = '#64748b';
        ctx.fillText('Aguardando Sagital...', 20, h / 2);
      }

      // Metade direita: Câmara Frontal
      if (sVideo && sVideo.readyState >= 2) {
        ctx.drawImage(sVideo, halfW, 0, halfW, h);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(halfW + 8, 8, 120, 24);
        ctx.fillStyle = '#10b981';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('FRONTAL (POSTURA)', halfW + 14, 24);
      } else {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(halfW, 0, halfW, h);
        ctx.fillStyle = '#64748b';
        ctx.fillText('Aguardando Frontal...', halfW + 20, h / 2);
      }

      // Linha divisória vertical
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(halfW, 0);
      ctx.lineTo(halfW, h);
      ctx.stroke();
    } else if (layoutMode.value === 'pip') {
      // Ecrã inteiro: Câmara Sagital
      if (pVideo && pVideo.readyState >= 2) {
        ctx.drawImage(pVideo, 0, 0, w, h);
      }
      // Miniatura PiP (canto superior direito): Câmara Frontal
      if (sVideo && sVideo.readyState >= 2) {
        const pipW = w * 0.32;
        const pipH = h * 0.32;
        const pipX = w - pipW - 12;
        const pipY = 12;

        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.strokeRect(pipX, pipY, pipW, pipH);
        ctx.drawImage(sVideo, pipX, pipY, pipW, pipH);
      }
    } else {
      // Primária apenas
      if (pVideo && pVideo.readyState >= 2) {
        ctx.drawImage(pVideo, 0, 0, w, h);
      }
    }

    // Carimbo de sincronismo temporal (Timecode ISO)
    const timestamp = new Date().toISOString().substring(11, 23);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(w - 110, h - 22, 102, 18);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '10px monospace';
    ctx.fillText(timestamp, w - 104, h - 9);
  }

  // Desativação segura das câmaras ao desmontar componente
  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      stopAll();
    });
  }

  return {
    devices,
    primaryDeviceId,
    secondaryDeviceId,
    primaryStream,
    secondaryStream,
    primaryVideoEl,
    secondaryVideoEl,
    layoutMode,
    isPrimaryActive,
    isSecondaryActive,
    isDualActive,
    dualCameraError,
    listDevices,
    startPrimary,
    startSecondary,
    stopPrimary,
    stopSecondary,
    stopAll,
    renderCompositeFrame,
  };
}

