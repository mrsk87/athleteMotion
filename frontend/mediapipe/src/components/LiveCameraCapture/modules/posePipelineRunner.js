/**
 * Orquestrador da Pipeline de Inferência MediaPipe e Renderização a 60 FPS.
 *
 * Responsabilidade:
 * - Inicializar MediaPipe Pose WebAssembly fora do sistema de reatividade do Vue.
 * - Gerir o ciclo de renderização no canvas via requestAnimationFrame (imune a congelamentos).
 * - Despachar frames para inferência assíncrona protegida por watchdog timer de 1200ms.
 * - Calcular em tempo real as taxas de FPS da câmara e da IA.
 */
import { Pose } from '@mediapipe/pose';

export class PosePipelineRunner {
  constructor({ onResults, onFpsUpdate, onRenderOverlay, onDebugLog }) {
    this.onResults = onResults;
    this.onFpsUpdate = onFpsUpdate;
    this.onRenderOverlay = onRenderOverlay;
    this.onDebugLog = onDebugLog;

    this.poseInstance = null;
    this.animationFrameId = null;
    this.isInferring = false;
    this.inferenceWatchdog = null;

    // Métricas de taxa de quadros (FPS)
    this.cameraFrameCount = 0;
    this.aiFrameCount = 0;
    this.lastFpsCalcTime = performance.now();
    this.lastInferredTime = -1;
    this.isFlippedHorizontal = false;
    this.isReverseActive = false;
  }

  setFlipped(flipped) {
    this.isFlippedHorizontal = Boolean(flipped);
  }

  setReverseMode(active) {
    this.isReverseActive = Boolean(active);
  }

  /**
   * Inicializa o motor MediaPipe Pose com WebAssembly oficial.
   */
  initPose() {
    if (this.poseInstance) return;

    const rawPose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    });

    rawPose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: false, // Desativado para eliminar o amortecimento interno e latência (~50ms)
      enableSegmentation: false,
      minDetectionConfidence: 0.65,
      minTrackingConfidence: 0.65,
    });

    rawPose.onResults((results) => {
      this.aiFrameCount++;
      if (this.onResults) this.onResults(results);
    });

    this.poseInstance = rawPose;
  }

  /**
   * Inicia o loop nativo a 60 FPS desacoplado da inferência.
   */
  startLoop(video, canvas, ctx, getShouldAnalyze) {
    if (!video || !canvas || !ctx) return;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    const processLoop = () => {
      const hasSource = Boolean(video.srcObject || video.src || video.currentSrc);
      if (!hasSource) return;

      this.animationFrameId = requestAnimationFrame(processLoop);

      if (video.srcObject && video.paused && !video.ended) {
        video.play().catch(() => {});
        return;
      }
      if (video.ended) return;

      // Cálculo de FPS
      if (!video.paused || this.isReverseActive) {
        this.cameraFrameCount++;
      }
      const now = performance.now();
      if (now - this.lastFpsCalcTime >= 1000) {
        const camFps = Math.round((this.cameraFrameCount * 1000) / (now - this.lastFpsCalcTime));
        const aiFps = Math.round((this.aiFrameCount * 1000) / (now - this.lastFpsCalcTime));
        this.cameraFrameCount = 0;
        this.aiFrameCount = 0;
        this.lastFpsCalcTime = now;
        if (this.onFpsUpdate) this.onFpsUpdate(camFps, aiFps);
      }

      // Renderização contínua do frame de vídeo
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        const w = canvas.width;
        const h = canvas.height;

        ctx.save();
        ctx.clearRect(0, 0, w, h);
        if (this.isFlippedHorizontal) {
          ctx.translate(w, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, w, h);
          ctx.restore();
          ctx.save();
        } else {
          ctx.drawImage(video, 0, 0, w, h);
        }

        if (this.onRenderOverlay) {
          this.onRenderOverlay(ctx, w, h);
        }
        ctx.restore();

        // Disparo assíncrono ao MediaPipe com watchdog
        const isPausedFile = !video.srcObject && video.paused && !this.isReverseActive;
        const shouldInfer = !isPausedFile || Math.abs((video.currentTime || 0) - this.lastInferredTime) > 0.01;

        if (this.poseInstance && getShouldAnalyze() && !this.isInferring && shouldInfer) {
          this.lastInferredTime = video.currentTime || 0;
          this.triggerInference(video);
        }
      }
    };

    this.animationFrameId = requestAnimationFrame(processLoop);
  }

  triggerInference(video) {
    this.isInferring = true;
    clearTimeout(this.inferenceWatchdog);
    this.inferenceWatchdog = setTimeout(() => {
      if (this.isInferring) {
        if (this.onDebugLog) this.onDebugLog('warn', 'Watchdog: MediaPipe demorou > 1200ms. A libertar canal.');
        this.isInferring = false;
      }
    }, 1200);

    this.poseInstance
      .send({ image: video })
      .then(() => {
        clearTimeout(this.inferenceWatchdog);
        this.isInferring = false;
      })
      .catch((err) => {
        clearTimeout(this.inferenceWatchdog);
        this.isInferring = false;
        if (this.onDebugLog) this.onDebugLog('error', `Falha poseInstance.send: ${err?.message || err}`);
      });
  }

  /**
   * Processa uma imagem estática (ou canvas estático) a pedido.
   * Retorna uma Promise que resolve com os resultados da pose.
   */
  /**
   * Processa uma imagem estática (ou canvas estático) a pedido com resiliência e alta velocidade.
   * Redimensiona imagens de alta resolução para dimensão ideal (max 1280px) prevenindo sobrecarga de WebAssembly.
   * Executa tentativa primária e fallback de sensibilidade automático caso a iluminação seja desafiante,
   * garantindo sucesso no primeiro clique sem necessidade de re-análises manuais.
   */
  async processStaticImage(imageSource) {
    if (!this.poseInstance) {
      this.initPose();
    }
    if (!this.poseInstance) {
      return Promise.reject(new Error('MediaPipe não pôde ser inicializado'));
    }

    this.isInferring = false;
    if (this.inferenceWatchdog) {
      clearTimeout(this.inferenceWatchdog);
      this.inferenceWatchdog = null;
    }

    let inferenceSource = imageSource;
    const srcW = imageSource.naturalWidth || imageSource.videoWidth || imageSource.width || 0;
    const srcH = imageSource.naturalHeight || imageSource.videoHeight || imageSource.height || 0;

    // Se a imagem for de alta resolução (> 1280px), redimensiona temporariamente para acelerar a inferência
    if (srcW > 1280 || srcH > 1280) {
      const maxDim = 1280;
      let targetW = srcW;
      let targetH = srcH;
      if (srcW > srcH) {
        targetW = maxDim;
        targetH = Math.round((srcH / srcW) * maxDim);
      } else {
        targetH = maxDim;
        targetW = Math.round((srcW / srcH) * maxDim);
      }

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = targetW;
      tempCanvas.height = targetH;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        tempCtx.drawImage(imageSource, 0, 0, targetW, targetH);
        inferenceSource = tempCanvas;
      }
    }

    // Configuração otimizada para foto estática (maior sensibilidade que streaming)
    const runInferenceAttempt = (confidence = 0.5) => {
      try {
        this.poseInstance.setOptions({
          modelComplexity: 1,
          smoothLandmarks: false,
          enableSegmentation: false,
          minDetectionConfidence: confidence,
          minTrackingConfidence: confidence,
        });
      } catch (_) {
        // ignorar
      }

      return new Promise((resolve, reject) => {
        let timeoutId = null;
        const originalHandler = this.onResults;

        const finish = (results) => {
          if (timeoutId) clearTimeout(timeoutId);
          this.onResults = originalHandler;
          resolve(results);
        };

        this.onResults = (results) => {
          finish(results);
        };

        timeoutId = setTimeout(() => {
          this.onResults = originalHandler;
          resolve(null);
        }, 7000);

        this.poseInstance
          .send({ image: inferenceSource })
          .catch((err) => {
            if (timeoutId) clearTimeout(timeoutId);
            this.onResults = originalHandler;
            reject(err);
          });
      });
    };

    // 1ª Tentativa com confiança padrão (0.50)
    let results = await runInferenceAttempt(0.5);

    // Se não detetar pose (ex.: ciclista com roupa escura ou luz fraca), executa fallback imediato (0.38)
    if (!results || !results.poseLandmarks || results.poseLandmarks.length < 33) {
      if (this.onDebugLog) this.onDebugLog('info', 'MediaPipe: A executar fallback autónomo de sensibilidade (0.38)...');
      results = await runInferenceAttempt(0.38);
    }

    return results;
  }

  stopLoop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.inferenceWatchdog) {
      clearTimeout(this.inferenceWatchdog);
      this.inferenceWatchdog = null;
    }
    this.isInferring = false;
  }

  destroy() {
    this.stopLoop();
    if (this.poseInstance) {
      try {
        this.poseInstance.close();
      } catch (e) {
        // ignorar
      }
      this.poseInstance = null;
    }
  }
}
