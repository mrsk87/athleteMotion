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
import { PoseLoadTuner, inferenceSize } from './poseLoadTuner';

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

    // Referências para poder redesennhar fora do ciclo de rAF (ver `drawCurrentFrame`).
    this.videoEl = null;
    this.canvasEl = null;
    this.ctxRef = null;
    this.lastDrawAt = 0;

    // --- Velocidade de inferência -------------------------------------------
    // A imagem enviada ao modelo é reduzida a um lado de trabalho: o MediaPipe
    // redimensiona internamente para 256×256, pelo que o 1080p só custava tempo
    // (era a razão principal do esqueleto chegar atrasado à perna).
    this.poseInputCanvas = null;
    this.poseInputCtx = null;
    this.tuner = new PoseLoadTuner();
    this.appliedProfile = this.tuner.profile;
    this.lastInferenceSize = { width: 0, height: 0 };
    /**
     * Fotograma ANALISADO de alta resolução + instante correspondente.
     *
     * Quando ligado (`alignFrameToInference`), o canvas mostra exatamente a imagem
     * que foi analisada no momento em que o resultado chega. É a única forma de o
     * esqueleto ficar "ao milésimo" sobre a perna: desenhar o fotograma atual com
     * marcas de um fotograma anterior dá sempre a impressão de atraso.
     */
    this.poseFrameCanvas = null;
    this.poseFrameCtx = null;
    this.alignFrameToInference = false;
    this.presentationFromInference = false;
    this.inferredFrameTime = -1;
  }

  /**
   * Liga a apresentação "presa ao fotograma analisado" (análise de ficheiro) ou o
   * desenho contínuo a 60 FPS (câmara ao vivo, onde o atraso tem de ser mínimo).
   */
  setFrameAlignment(enabled) {
    this.alignFrameToInference = Boolean(enabled);
  }

  setFlipped(flipped) {
    this.isFlippedHorizontal = Boolean(flipped);
  }

  setReverseMode(active) {
    this.isReverseActive = Boolean(active);
  }

  /**
   * Opções do motor. O perfil (modelo + lado de trabalho) vem do afinador, para que
   * a troca de modelo aconteça num único sítio.
   */
  applyOptions(profile = this.appliedProfile, confidence = 0.65) {
    if (!this.poseInstance) return;
    this.appliedProfile = profile;
    try {
      this.poseInstance.setOptions({
        modelComplexity: profile.modelComplexity,
        smoothLandmarks: false, // Desativado para eliminar o amortecimento interno e latência (~50ms)
        enableSegmentation: false,
        minDetectionConfidence: confidence,
        minTrackingConfidence: confidence,
      });
    } catch (err) {
      if (this.onDebugLog) this.onDebugLog('warn', `MediaPipe: não foi possível aplicar o perfil ${profile.name}: ${err?.message || err}`);
    }
  }

  /**
   * Inicializa o motor MediaPipe Pose com WebAssembly oficial.
   */
  initPose() {
    if (this.poseInstance) return;

    const rawPose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    });

    rawPose.onResults((results) => {
      this.aiFrameCount++;
      // Primeiro o componente consome o resultado (marcas e ângulos novos), e SÓ
      // depois se desenha: desenhar antes pintava as marcas do fotograma anterior
      // em cima da imagem nova — um fotograma inteiro de atraso inventado.
      if (this.onResults) this.onResults(results, this.inferredFrameTime);
      // `presentationFromInference` garante que só se desenha por aqui quando a
      // apresentação está mesmo entregue à inferência (ficheiro a andar). Em pausa,
      // em seeks e durante o varrimento integral manda o desenho contínuo, senão o
      // ecrã ficava preso numa cópia antiga.
      if (this.presentationFromInference) {
        this.drawInferredFrame();
      }
    });

    this.poseInstance = rawPose;
    this.applyOptions(this.appliedProfile);
  }

  /**
   * Reduz o fotograma ao lado de trabalho e devolve-o. Reaproveita sempre o mesmo
   * canvas para não criar lixo de memória a cada inferência.
   * @param {*} source - <video>, <canvas> ou <img>
   * @returns {*} canvas de trabalho ou a própria fonte quando não há redução a fazer
   */
  prepareInferenceSource(source) {
    const srcW = source.videoWidth || source.naturalWidth || source.width || 0;
    const srcH = source.videoHeight || source.naturalHeight || source.height || 0;
    const size = inferenceSize(srcW, srcH, this.appliedProfile.workingWidth);
    this.lastInferenceSize = size;
    if (!size.width || !size.height) return source;

    const longest = Math.max(srcW, srcH);
    if (longest <= size.width && longest <= size.height) {
      // Já é pequeno: enviar a fonte original evita uma cópia inútil.
      return source;
    }

    if (!this.poseInputCanvas) {
      this.poseInputCanvas = document.createElement('canvas');
      this.poseInputCtx = this.poseInputCanvas.getContext('2d', { alpha: false });
    }
    if (this.poseInputCanvas.width !== size.width || this.poseInputCanvas.height !== size.height) {
      this.poseInputCanvas.width = size.width;
      this.poseInputCanvas.height = size.height;
    }
    if (!this.poseInputCtx) return source;
    this.poseInputCtx.drawImage(source, 0, 0, size.width, size.height);
    return this.poseInputCanvas;
  }

  /**
   * Guarda uma cópia em resolução nativa do fotograma que vai ser analisado (a
   * apresentação exata desse fotograma não pode ser a versão reduzida, que se veria
   * desfocada).
   */
  snapshotSource(source) {
    const srcW = source.videoWidth || source.naturalWidth || source.width || 0;
    const srcH = source.videoHeight || source.naturalHeight || source.height || 0;
    if (!srcW || !srcH) return;
    if (!this.poseFrameCanvas) {
      this.poseFrameCanvas = document.createElement('canvas');
      this.poseFrameCtx = this.poseFrameCanvas.getContext('2d', { alpha: false });
    }
    if (this.poseFrameCanvas.width !== srcW || this.poseFrameCanvas.height !== srcH) {
      this.poseFrameCanvas.width = srcW;
      this.poseFrameCanvas.height = srcH;
    }
    if (this.poseFrameCtx) this.poseFrameCtx.drawImage(source, 0, 0, srcW, srcH);
  }

  /**
   * Desenha no canvas visível o fotograma ANALISADO (e só ele). Sem o rAF a decidir
   * o que está à vista, o esqueleto e a perna ficam sempre no mesmo instante.
   * @returns {boolean}
   */
  drawInferredFrame() {
    const canvas = this.canvasEl;
    const ctx = this.ctxRef;
    const snapshot = this.poseFrameCanvas;
    if (!canvas || !ctx || !snapshot || !snapshot.width) return false;

    if (canvas.width !== snapshot.width || canvas.height !== snapshot.height) {
      canvas.width = snapshot.width;
      canvas.height = snapshot.height;
    }
    const w = canvas.width;
    const h = canvas.height;

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (this.isFlippedHorizontal) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(snapshot, 0, 0, w, h);
      ctx.restore();
      ctx.save();
    } else {
      ctx.drawImage(snapshot, 0, 0, w, h);
    }
    if (this.onRenderOverlay) {
      this.onRenderOverlay(ctx, w, h);
    }
    ctx.restore();
    this.lastDrawAt = performance.now();
    return true;
  }

  /**
   * Desenha UM fotograma do vídeo no canvas (com a sobreposição por cima).
   *
   * É público de propósito: o avanço normal do vídeo é conduzido pelo relógio nativo do
   * `<video>`, mas a marcha-atrás é feita por seeks. Se o browser estrangular o
   * `requestAnimationFrame` (janela sem foco, separador oculto), um canvas que só desenhe
   * no ciclo de rAF fica com a ÚLTIMA imagem enquanto o vídeo continua a andar — a imagem
   * "parada" que o utilizador via. Quem entrega um fotograma novo (seek concluído ou
   * `requestVideoFrameCallback`) pede aqui o desenho, sem depender do rAF.
   * @returns {boolean} `true` se algo foi desenhado.
   */
  drawCurrentFrame() {
    const video = this.videoEl;
    const canvas = this.canvasEl;
    const ctx = this.ctxRef;
    if (!video || !canvas || !ctx) return false;
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;

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
    this.lastDrawAt = performance.now();
    return true;
  }

  /**
   * Inicia o loop nativo a 60 FPS desacoplado da inferência.
   */
  startLoop(video, canvas, ctx, getShouldAnalyze) {
    if (!video || !canvas || !ctx) return;

    this.videoEl = video;
    this.canvasEl = canvas;
    this.ctxRef = ctx;

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
        this.tuneLoad(aiFps);
        if (this.onFpsUpdate) this.onFpsUpdate(camFps, aiFps);
      }

      // Apresentação do fotograma.
      // - Câmara ao vivo e pausa/seeks: desenho contínuo (o atraso tem de ser mínimo).
      // - Ficheiro a andar com alinhamento ligado: quem desenha é o resultado da
      //   inferência (`drawInferredFrame`), para o esqueleto nunca fugir da perna.
      const presentationFromInference = this.alignFrameToInference && !video.paused && !video.seeking;
      this.presentationFromInference = presentationFromInference;
      const drew = presentationFromInference ? true : this.drawCurrentFrame();

      if (drew) {
        // Disparo assíncrono ao MediaPipe com watchdog.
        // - Nunca inferir durante um seek (`video.seeking`): na marcha-atrás a
        //   descodificação tem prioridade e o fotograma ainda não está disponível.
        // - Ficheiros: só inferir quando o tempo do fotograma realmente mudou,
        //   evitando inferências repetidas sobre a mesma imagem (custo inútil).
        const frameMoved = Math.abs((video.currentTime || 0) - this.lastInferredTime) > 0.001;
        const shouldInfer = !video.seeking && (Boolean(video.srcObject) || frameMoved || !video.paused);

        if ((this.poseInstance || this.customInferrer) && getShouldAnalyze() && !this.isInferring && shouldInfer) {
          this.lastInferredTime = video.currentTime || 0;
          this.triggerInference(video);
        }
      }
    };

    this.animationFrameId = requestAnimationFrame(processLoop);
  }

  /**
   * Define um motor de inferência personalizado (ex.: DirectML GPU via WebSocket).
   * Passando null reverte para MediaPipe WebAssembly local.
   * @param {Function|null} inferrerFn - (source, frameTime, timeoutMs?) => Promise<{ poseLandmarks: [] }|null>
   */
  setCustomInferrer(inferrerFn) {
    this.customInferrer = typeof inferrerFn === 'function' ? inferrerFn : null;
  }

  /**
   * Ajusta o perfil de carga a partir dos FPS reais da IA. Uma troca de modelo custa
   * ~1 s (o MediaPipe recarrega os pesos), por isso é raro e só quando compensa.
   */
  tuneLoad(aiFps) {
    if (this.customInferrer) return; // Afinador de carga apenas para MediaPipe local
    const { profile, switched } = this.tuner.addFpsSample(aiFps);
    if (!switched) return;
    this.applyOptions(profile);
    if (this.onDebugLog) {
      this.onDebugLog('info', `MediaPipe: perfil de carga → ${profile.name} (modelo ${profile.modelComplexity}, ${profile.workingWidth}px) porque a IA corria a ${aiFps} FPS.`);
    }
  }

  triggerInference(video) {
    this.isInferring = true;
    clearTimeout(this.inferenceWatchdog);
    this.inferenceWatchdog = setTimeout(() => {
      if (this.isInferring) {
        if (this.onDebugLog) this.onDebugLog('warn', 'Watchdog: inferência demorou > 1200ms. A libertar canal.');
        this.isInferring = false;
      }
    }, 1200);

    // O fotograma é reduzido ANTES de entrar no motor: é aqui que se ganha a maior
    // parte da velocidade, sem perder rigor (o modelo vê 256×256 de qualquer forma).
    this.inferredFrameTime = video.currentTime || 0;
    if (this.alignFrameToInference) this.snapshotSource(video);

    // Se estiver ativo um motor acelerado externo (DirectML / GPU)
    if (this.customInferrer) {
      this.customInferrer(video, this.inferredFrameTime)
        .then((results) => {
          clearTimeout(this.inferenceWatchdog);
          this.isInferring = false;
          if (results) {
            this.aiFrameCount++;
            if (this.onResults) this.onResults(results, this.inferredFrameTime);
            if (this.presentationFromInference) {
              this.drawInferredFrame();
            }
          }
        })
        .catch((err) => {
          clearTimeout(this.inferenceWatchdog);
          this.isInferring = false;
          if (this.onDebugLog) this.onDebugLog('error', `Falha no motor de inferência externo: ${err?.message || err}`);
        });
      return;
    }

    if (!this.poseInstance) {
      this.isInferring = false;
      return;
    }

    const inferenceSource = this.prepareInferenceSource(video);

    this.poseInstance
      .send({ image: inferenceSource })
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
   * Inferência ÚNICA e aguardável sobre uma fonte de imagem (elemento <video> em pausa,
   * canvas ou imagem), com limite de tempo.
   *
   * É o que o varrimento integral do vídeo precisa: como o varrimento avança fotograma a
   * fotograma, tem de saber EXATAMENTE quando o resultado daquele fotograma está pronto antes
   * de pedir o seguinte. Devolve `null` quando não há pose detetada ou quando expira.
   *
   * @param {*} imageSource - <video>, <canvas> ou <img> com o fotograma pretendido
   * @param {number} [timeoutMs]
   * @returns {Promise<Object|null>}
   */
  inferFrame(imageSource, timeoutMs = 4000) {
    if (this.customInferrer) {
      return this.customInferrer(imageSource, 0, timeoutMs);
    }

    if (!this.poseInstance) this.initPose();
    if (!this.poseInstance || !imageSource) return Promise.resolve(null);

    return new Promise((resolve) => {
      let settled = false;
      let timeoutId = null;
      const originalHandler = this.onResults;

      const finish = (results) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        this.onResults = originalHandler;
        resolve(results && results.poseLandmarks && results.poseLandmarks.length ? results : null);
      };

      timeoutId = setTimeout(() => finish(null), timeoutMs);
      this.onResults = (results) => finish(results);

      this.poseInstance.send({ image: imageSource }).catch(() => finish(null));
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
    const passIndex = this.staticPassIndex || 1;

    // Se a imagem for de alta resolução (> 1280px), redimensiona temporariamente para acelerar a inferência.
    // Em passagens > 1 do conjunto de análises, aplica ligeira micro-variação subpixel (±0.4% escala / ±1px)
    // para permitir estimar estatisticamente o ponto médio espacial real com o modelo de pose.
    const maxDim = 1280;
    let targetW = srcW;
    let targetH = srcH;
    if (srcW > maxDim || srcH > maxDim) {
      if (srcW > srcH) {
        targetW = maxDim;
        targetH = Math.round((srcH / srcW) * maxDim);
      } else {
        targetH = maxDim;
        targetW = Math.round((srcW / srcH) * maxDim);
      }
    }

    if (srcW > maxDim || srcH > maxDim || passIndex > 1) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = targetW || 800;
      tempCanvas.height = targetH || 600;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        if (passIndex > 1) {
          const jitterScale = 1.0 + (passIndex % 2 === 0 ? 0.004 : -0.004);
          const shiftX = passIndex % 3 === 0 ? 1 : (passIndex % 3 === 1 ? -1 : 0);
          const shiftY = passIndex % 2 === 0 ? 1 : -1;
          tempCtx.save();
          tempCtx.translate(tempCanvas.width / 2 + shiftX, tempCanvas.height / 2 + shiftY);
          tempCtx.scale(jitterScale, jitterScale);
          tempCtx.drawImage(imageSource, -tempCanvas.width / 2, -tempCanvas.height / 2, tempCanvas.width, tempCanvas.height);
          tempCtx.restore();
        } else {
          tempCtx.drawImage(imageSource, 0, 0, tempCanvas.width, tempCanvas.height);
        }
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
    this.videoEl = null;
    this.canvasEl = null;
    this.ctxRef = null;
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
