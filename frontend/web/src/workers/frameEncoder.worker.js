/**
 * Web Worker para Compressão e Redimensionamento Off-Thread de Frames (R16 / Subtarefa 6).
 *
 * Princípios de Engenharia:
 * - O thread principal da UI NUNCA deve bloquear a codificar JPEGs.
 * - Utiliza OffscreenCanvas e createImageBitmap para redimensionamento acelerado por GPU.
 * - Converte para JPEG com qualidade configurável (default 0.75) e largura máx. (default 640px).
 */

/* eslint-disable no-restricted-globals */
self.onmessage = async (event) => {
  const { id, imageBitmap, maxWidth = 640, quality = 0.75, timestampMs = 0 } = event.data;

  try {
    if (!imageBitmap) {
      self.postMessage({ id, error: 'imageBitmap inválido', timestampMs });
      return;
    }

    const srcWidth = imageBitmap.width;
    const srcHeight = imageBitmap.height;

    // Calcular dimensões preservando o aspect ratio
    let targetWidth = srcWidth;
    let targetHeight = srcHeight;

    if (srcWidth > maxWidth) {
      targetWidth = maxWidth;
      targetHeight = Math.round((srcHeight * maxWidth) / srcWidth);
    }

    // Usar OffscreenCanvas para desenho e codificação off-thread
    const offscreen = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = offscreen.getContext('2d');

    // Desenhar com interpolação de alta qualidade
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);

    // Fechar o ImageBitmap original para libertar memória de textura imediatamente
    imageBitmap.close();

    // Codificar para Blob JPEG
    const blob = await offscreen.convertToBlob({
      type: 'image/jpeg',
      quality,
    });

    // Converter para ArrayBuffer para transferência Zero-Copy
    const arrayBuffer = await blob.arrayBuffer();

    // Transferir ownership do buffer (Transferable Objects) sem clonar bytes
    self.postMessage(
      {
        id,
        success: true,
        buffer: arrayBuffer,
        timestampMs,
        width: targetWidth,
        height: targetHeight,
      },
      [arrayBuffer]
    );
  } catch (err) {
    self.postMessage({
      id,
      success: false,
      error: err.message || String(err),
      timestampMs,
    });
  }
};
