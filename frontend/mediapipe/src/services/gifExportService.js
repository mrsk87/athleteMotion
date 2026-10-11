/**
 * Serviço de Exportação de GIF Animado e Vídeo Composto (GifExportService).
 *
 * Responsabilidade:
 * - Enviar fotogramas renderizados com esqueleto e ângulos para compilação em GIF animado no backend.
 * - Fornecer fallback autónomo client-side para descarregar animação diretamente.
 * - Despoletar o download de ficheiro no navegador do utilizador.
 */
import axios from 'axios';

export class GifExportService {
  /**
   * Dispara o download de um Blob no navegador.
   */
  static triggerDownload(blob, filename = 'bikefit_analise.gif') {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /**
   * Exporta uma sequência de fotogramas (Base64) para GIF animado através da API.
   *
   * @param {string[]} framesDataUrls - Array de strings data:image/jpeg;base64,...
   * @param {number} delayMs - Duração de cada frame (padrão 100ms = 10 FPS)
   * @returns {Promise<boolean>} Sucesso da exportação
   */
  static async exportToGif(framesDataUrls, delayMs = 100, filename = 'bikefit_analise.gif') {
    if (!framesDataUrls || framesDataUrls.length === 0) {
      throw new Error('Nenhum fotograma disponível para exportação.');
    }

    try {
      const response = await axios.post(
        '/api/v1/video/export-gif',
        {
          frames: framesDataUrls.slice(0, 100), // Limite razoável de frames para GIF ágil
          delay_ms: delayMs,
          loop: 0,
        },
        {
          responseType: 'blob',
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
        }
      );

      this.triggerDownload(response.data, filename);
      return true;
    } catch (err) {
      console.warn('API GIF export falhou, a utilizar exportação de imagem com fotograma principal:', err);
      // Fallback: se a API não estiver acessível, descarrega o primeiro fotograma chave como PNG de alta resolução
      const firstB64 = framesDataUrls[0];
      const link = document.createElement('a');
      link.href = firstB64;
      link.download = filename.replace('.gif', '.png');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return false;
    }
  }

  /**
   * Grava um clipe WebM diretamente no browser a partir do Canvas usando MediaRecorder nativo.
   */
  static recordCanvasClip(canvas, durationMs = 3000, fps = 30) {
    return new Promise((resolve, reject) => {
      if (!canvas || !canvas.captureStream) {
        return reject(new Error('Canvas captureStream não suportado'));
      }

      try {
        const stream = canvas.captureStream(fps);
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm';
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          resolve(blob);
        };

        recorder.start();
        setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, durationMs);
      } catch (err) {
        reject(err);
      }
    });
  }
}
