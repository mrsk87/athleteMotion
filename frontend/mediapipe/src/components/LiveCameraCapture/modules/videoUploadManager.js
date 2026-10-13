/**
 * Gestor de Ficheiros de Vídeo Carregados (VideoUploadManager).
 *
 * Responsabilidade:
 * - Gerir o upload de ficheiros de vídeo locais (MP4, MOV, WebM, etc.).
 * - Controlar a reprodução no sentido normal (forward) e no sentido oposto /
 *   marcha-atrás (reverse) — a marcha-atrás é delegada no `ReversePlaybackEngine`,
 *   porque o HTML5 não suporta `playbackRate` negativo.
 * - Garantir reprodução contínua sem fim (loop total) ou dentro do intervalo A-B.
 * - Sincronizar o progresso temporal para a inferência e análise biomecânica com alta precisão.
 */
import { clampRange, playbackBounds, resolveForwardBoundary } from './playbackTimeline.js';
import { ReversePlaybackEngine } from './reversePlaybackEngine.js';

/**
 * Tempo máximo de espera pela duração do ficheiro (ms). Só depois disto é que se declara que o
 * ficheiro não a revela: desistir ao primeiro evento cancelava o recuo do utilizador.
 */
export const RESOLVE_DURATION_TIMEOUT_MS = 2000;

export class VideoUploadManager {
  constructor({
    onTimeUpdate,
    onVideoLoaded,
    onEnded,
    onPlayStateChange,
    onDirectionChange,
    onAutoSlowdownChange,
    onLoopWrap,
    onFramePresented,
    onDebugLog,
  }) {
    this.videoElement = null;
    this.videoFile = null;
    this.videoUrl = null;
    this.fileName = '';
    this.fileSizeMb = 0;
    this.duration = 0;
    this.currentTime = 0;
    this.isPlaying = false;
    this.playbackRate = 1.0;

    // Intervalo de repetição contínua (Loop A-B)
    this.loopStart = 0;
    this.loopEnd = 0;
    this.loopEnabled = false;

    // Loop Infinito (Reprodução Sem Fim por omissão) — o "loop total"
    this.infiniteLoop = true;

    // Sentido de reprodução temporal (Marcha-Atrás / Reverse)
    this.playbackDirection = 'forward'; // 'forward' | 'reverse'
    this.isReversePlaying = false;
    this.wasPlayingBeforeScrub = false;
    this.wasReverseBeforeScrub = false;

    /**
     * Sentido pedido pelo UTILIZADOR ('forward' | 'reverse'), que a automação tem de respeitar.
     *
     * PORQUÊ: carregar um ficheiro e pedir "recuar" logo a seguir perdia a ordem — o
     * `loadedmetadata`/a análise integral arrancavam e voltavam a pôr o vídeo a andar para a
     * frente (medido: o pedido de recuo desaparecia e a imagem andava para a frente). A ordem
     * fica registada aqui e é cumprida mal o transporte fique livre.
     */
    this.requestedDirection = 'forward';

    // Auto-Slowdown Inteligente para Análise Rigorosa no Movimento
    this.autoSlowdownEnabled = false;
    this.autoSlowdownSpeed = 0.25;
    this.isSlowedDownByMotion = false;
    this.userBasePlaybackRate = 1.0;

    // Duração real de um fotograma do ficheiro (aprendida por requestVideoFrameCallback)
    this.sourceFrameDuration = 1 / 30;
    this._frameTimeSamples = [];
    this._vfcId = null;

    // Guarda de loop a 60Hz (o `ontimeupdate` nativo só dispara ~4x por segundo)
    this.loopGuardId = null;

    /**
     * Bloqueio de transporte (usado durante o varrimento integral do vídeo).
     *
     * O varrimento é dono do elemento `<video>`: posiciona-o amostra a amostra, com um seek
     * de cada vez. Se o utilizador carregasse em "recuar" nesse período, os dois emissores
     * de seeks cancelavam-se mutuamente e a imagem ficava PARADA — parecia avariado.
     * Bloquear e avisar é mais honesto do que aceitar uma ordem que não se pode cumprir.
     */
    this.transportLocked = false;

    this.onTimeUpdate = onTimeUpdate;
    this.onVideoLoaded = onVideoLoaded;
    this.onEnded = onEnded;
    this.onPlayStateChange = onPlayStateChange;
    this.onDirectionChange = onDirectionChange;
    this.onAutoSlowdownChange = onAutoSlowdownChange;
    this.onLoopWrap = onLoopWrap;
    this.onFramePresented = onFramePresented;
    this.onDebugLog = onDebugLog;

    this.reverseEngine = new ReversePlaybackEngine({
      getVideo: () => this.videoElement,
      getRate: () => Math.abs(this.playbackRate || 1.0),
      getFrameStep: () => this.sourceFrameDuration,
      getBounds: () => {
        const bounds = playbackBounds({
          loopEnabled: this.loopEnabled,
          loopStart: this.loopStart,
          loopEnd: this.loopEnd,
          duration: this.duration,
        });
        return { ...bounds, infiniteLoop: this.infiniteLoop };
      },
      onFrame: (time) => {
        // Só chega aqui quando um seek terminou, ou seja quando o novo fotograma está
        // descodificado e pronto a ser desenhado: é este o momento "real" da imagem.
        this._publishFrame(time);
      },
      onFinished: (time) => {
        this.isReversePlaying = false;
        this.isPlaying = false;
        if (this.onPlayStateChange) this.onPlayStateChange(false);
        if (this.onEnded) this.onEnded(time);
      },
      onDebugLog: (type, msg) => {
        if (this.onDebugLog) this.onDebugLog(type, msg);
      },
    });
  }

  /**
   * Publica o instante do fotograma que está REALMENTE a ser mostrado.
   *
   * Regra de ouro: nunca anunciar um tempo antes de a imagem correspondente existir.
   * Era isto que fazia o relógio "não corresponder à realidade": `seekTo` avisava logo a
   * interface com o instante PEDIDO, enquanto a imagem ainda era a anterior. Agora o
   * relógio só avança com o fotograma apresentado (`requestVideoFrameCallback`), com o
   * fim do seek (`seeked`) ou com o relógio nativo do `<video>`.
   */
  _publishFrame(time) {
    const value = Number.isFinite(time) ? time : 0;
    this.currentTime = value;
    if (this.duration <= 0 && this.videoElement && Number.isFinite(this.videoElement.duration) && this.videoElement.duration > 0) {
      this.duration = this.videoElement.duration;
      this._reclampLoopToDuration();
    }
    if (this.onTimeUpdate) this.onTimeUpdate(value, this.duration);
    if (this.onFramePresented) this.onFramePresented(value);
  }

  // ---------------------------------------------------------------------------
  // Ligação ao elemento <video>
  // ---------------------------------------------------------------------------

  /**
   * Associa o elemento <video> do componente e regista event listeners.
   */
  attachVideo(videoElement) {
    this.videoElement = videoElement;
    if (!videoElement) return;

    const handleDurationAvailable = () => {
      const dur = Number.isFinite(this.videoElement.duration) && this.videoElement.duration > 0
        ? this.videoElement.duration
        : 0;
      if (dur > 0 && this.duration !== dur) {
        this.duration = dur;
        this._reclampLoopToDuration();
        if (this.onTimeUpdate) this.onTimeUpdate(this.currentTime || 0, this.duration);
      }
    };

    this.videoElement.onloadedmetadata = () => {
      this.duration = (Number.isFinite(this.videoElement.duration) && this.videoElement.duration > 0)
        ? this.videoElement.duration
        : 0;
      this._reclampLoopToDuration();
      if (this.onVideoLoaded) this.onVideoLoaded(this.duration);
    };

    this.videoElement.ondurationchange = handleDurationAvailable;
    this.videoElement.onloadeddata = handleDurationAvailable;
    this.videoElement.oncanplay = handleDurationAvailable;

    this.videoElement.ontimeupdate = () => {
      // Durante um seek a posição já mudou mas a imagem ainda não: quem publica é o `seeked`.
      if (this.videoElement.seeking) return;
      handleDurationAvailable();
      this._publishFrame(this.videoElement.currentTime || 0);
    };

    // Um seek terminou: o fotograma pedido existe. Na marcha-atrás quem publica é o motor
    // (que emite os seus próprios seeks) para não haver dois relógios a competir.
    this.videoElement.onseeked = () => {
      if (this.isReversePlaying) return;
      this._publishFrame(this.videoElement.currentTime || 0);
    };

    this.videoElement.onended = () => {
      if (this.isReversePlaying) return;
      if (this.infiniteLoop) {
        const bounds = playbackBounds({
          loopEnabled: this.loopEnabled,
          loopStart: this.loopStart,
          loopEnd: this.loopEnd,
          duration: this.duration,
        });
        this.seekTo(this.playbackDirection === 'reverse' ? bounds.end : bounds.start);
        // Retomada automática: se o utilizador tinha pedido para recuar, é o recuo que retoma.
        this.play({ automatic: true });
        return;
      }
      this.isPlaying = false;
      if (this.onPlayStateChange) this.onPlayStateChange(false);
      if (this.onEnded) this.onEnded(this.currentTime);
    };

    this.videoElement.onplay = () => {
      if (!this.isReversePlaying) {
        this.isPlaying = true;
        if (this.onPlayStateChange) this.onPlayStateChange(true);
      }
    };

    this.videoElement.onpause = () => {
      if (!this.isReversePlaying) {
        this.isPlaying = false;
        if (this.onPlayStateChange) this.onPlayStateChange(false);
      }
    };

    this._learnSourceFrameDuration();
    this._startLoopGuard();
  }

  /**
   * Aprende a duração real de um fotograma do ficheiro (ex.: 1/30s, 1/25s, 1/60s)
   * para que a marcha-atrás recue exatamente um fotograma por passo.
   */
  _learnSourceFrameDuration() {
    const video = this.videoElement;
    if (!video || typeof video.requestVideoFrameCallback !== 'function') return;

    const onFrame = (_, metadata) => {
      if (video !== this.videoElement) return;
      const mediaTime = metadata && Number.isFinite(metadata.mediaTime) ? metadata.mediaTime : null;
      if (mediaTime !== null) {
        const previous = this._frameTimeSamples[this._frameTimeSamples.length - 1];
        if (previous && previous.time !== undefined && mediaTime > previous.time) {
          this._frameTimeSamples.push({ delta: mediaTime - previous.time, time: mediaTime });
          if (this._frameTimeSamples.length > 24) this._frameTimeSamples.shift();
        } else {
          this._frameTimeSamples.push({ time: mediaTime });
        }
        const deltas = this._frameTimeSamples.filter((s) => s.delta > 0.001).map((s) => s.delta).sort((a, b) => a - b);
        if (deltas.length >= 4) {
          const median = deltas[Math.floor(deltas.length / 2)];
          if (Number.isFinite(median) && median > 0) {
            this.sourceFrameDuration = Math.max(1 / 240, Math.min(median, 1 / 8));
          }
        }
        // O instante do fotograma apresentado é a verdade da imagem que está no ecrã.
        this._publishFrame(mediaTime);
      }
      this._vfcId = video.requestVideoFrameCallback(onFrame);
    };

    this._vfcId = video.requestVideoFrameCallback(onFrame);
  }

  /**
   * Guarda de fronteira do loop a ~60Hz. O `ontimeupdate` nativo dispara apenas ~4x por
   * segundo e deixava o corte no ponto B com atraso até 0.25s.
   */
  _startLoopGuard() {
    if (this.loopGuardId) return;
    const tick = () => {
      this.loopGuardId = requestAnimationFrame(tick);
      const video = this.videoElement;
      if (!video || video.srcObject) return;
      if (this.isReversePlaying || video.seeking) return;

      if (video.ended) {
        if (this.infiniteLoop && this.duration > 0) {
          const bounds = playbackBounds({
            loopEnabled: this.loopEnabled,
            loopStart: this.loopStart,
            loopEnd: this.loopEnd,
            duration: this.duration,
          });
          this.seekTo(bounds.start);
          this.play();
        }
        return;
      }

      if (video.paused) return;

      const decision = resolveForwardBoundary({
        currentTime: video.currentTime || 0,
        duration: this.duration,
        loopEnabled: this.loopEnabled,
        loopStart: this.loopStart,
        loopEnd: this.loopEnd,
        infiniteLoop: this.infiniteLoop,
      });
      if (!decision) return;

      this.seekTo(decision.seekTo);
      if (decision.stop) {
        this.pause();
        if (this.onEnded) this.onEnded(decision.seekTo);
        return;
      }
      if (this.onLoopWrap) this.onLoopWrap(decision.seekTo);
    };
    this.loopGuardId = requestAnimationFrame(tick);
  }

  _stopLoopGuard() {
    if (this.loopGuardId) {
      cancelAnimationFrame(this.loopGuardId);
      this.loopGuardId = null;
    }
  }

  _reclampLoopToDuration() {
    if (!this.loopEnabled) return;
    const range = clampRange(this.loopStart, this.loopEnd, this.duration);
    if (!range.valid || range.end - range.start < 0.2) {
      this.loopEnabled = false;
      this.loopStart = 0;
      this.loopEnd = 0;
      return;
    }
    this.loopStart = range.start;
    this.loopEnd = range.end;
  }

  // ---------------------------------------------------------------------------
  // Intervalo A-B (loop por tempo)
  // ---------------------------------------------------------------------------

  /** Define o intervalo A-B aceitando segundos, "20", "1:20" ou "01:20.5". */
  setLoopRange(start, end) {
    const range = clampRange(start, end, this.duration);
    if (!range.valid) return false;
    this.loopStart = range.start;
    this.loopEnd = range.end;
    this.loopEnabled = true;
    this._snapIntoRange();
    return true;
  }

  setLoopPointA(timeSeconds) {
    const range = clampRange(timeSeconds, this.loopEnd > 0 ? this.loopEnd : this.duration, this.duration);
    if (!range.valid) return;
    this.loopStart = range.start;
    this.loopEnd = range.end;
    this.loopEnabled = true;
    this._snapIntoRange();
  }

  setLoopPointB(timeSeconds) {
    const range = clampRange(this.loopStart, timeSeconds, this.duration);
    if (!range.valid) return;
    this.loopStart = range.start;
    this.loopEnd = range.end;
    this.loopEnabled = true;
    this._snapIntoRange();
  }

  /** Se o tempo atual estiver fora do intervalo, coloca-o no início do âmbito. */
  _snapIntoRange() {
    if (!this.loopEnabled) return;
    const video = this.videoElement;
    if (!video) return;
    const current = video.currentTime || 0;
    if (current < this.loopStart || current > this.loopEnd) {
      this.seekTo(this.playbackDirection === 'reverse' ? this.loopEnd : this.loopStart);
    }
  }

  toggleLoop(enabled) {
    this.loopEnabled = typeof enabled === 'boolean' ? enabled : !this.loopEnabled;
    if (this.loopEnabled) this._snapIntoRange();
    return this.loopEnabled;
  }

  clearLoop() {
    this.loopEnabled = false;
    this.loopStart = 0;
    this.loopEnd = 0;
  }

  setInfiniteLoop(enabled) {
    this.infiniteLoop = Boolean(enabled);
  }

  toggleInfiniteLoop() {
    this.infiniteLoop = !this.infiniteLoop;
    return this.infiniteLoop;
  }

  /** Âmbito de reprodução efetivo (intervalo A-B quando ativo, senão o vídeo inteiro). */
  getBounds() {
    return playbackBounds({
      loopEnabled: this.loopEnabled,
      loopStart: this.loopStart,
      loopEnd: this.loopEnd,
      duration: this.duration,
    });
  }

  // ---------------------------------------------------------------------------
  // Carregamento do ficheiro
  // ---------------------------------------------------------------------------

  /**
   * Carrega um ficheiro de vídeo selecionado pelo utilizador.
   */
  loadVideoFile(file) {
    if (!file || !this.videoElement) return false;

    this.pauseReverse();
    this._frameTimeSamples = [];

    if (this.videoUrl) {
      URL.revokeObjectURL(this.videoUrl);
    }

    this.videoFile = file;
    this.fileName = file.name;
    this.fileSizeMb = Math.round((file.size / (1024 * 1024)) * 10) / 10;
    this.videoUrl = URL.createObjectURL(file);

    // Um vídeo novo começa sempre no sentido normal, para trás, e em loop total.
    // O intervalo A-B anterior é limpo: referia-se a outra linha temporal e
    // deixaria a interface e o motor dessincronizados.
    this.playbackDirection = 'forward';
    // A ordem de sentido pertencia ao ficheiro anterior: um vídeo novo começa neutro.
    this.requestedDirection = 'forward';
    this.clearLoop();
    this.duration = 0;
    this.currentTime = 0;

    this.videoElement.src = this.videoUrl;
    this.videoElement.playbackRate = this.playbackRate;
    this.videoElement.load();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Reprodução no sentido oposto (marcha-atrás tipo cassete)
  // ---------------------------------------------------------------------------

  /**
   * Bloqueia/liberta os controlos de transporte (varrimento integral em curso).
   *
   * Ao libertar cumpre-se a ordem de sentido que o utilizador deu durante o varrimento: era aqui
   * que o clique em "recuar" se perdia (o varrimento acabava e o vídeo voltava a andar para a
   * frente, como se o pedido nunca tivesse existido).
   */
  setTransportLocked(locked) {
    const wasLocked = this.transportLocked;
    this.transportLocked = Boolean(locked);
    if (this.transportLocked) {
      // Pausa automática: NÃO apaga a ordem de sentido que o utilizador deu (ver `pause`).
      this.pause({ automatic: true });
      return;
    }
    if (wasLocked && this.requestedDirection === 'reverse' && !this.isReversePlaying) {
      this.playReverse();
    }
  }

  /** O transporte está bloqueado? */
  isTransportLocked() {
    return Boolean(this.transportLocked);
  }

  /**
   * Duração finita do ficheiro, resolvida se ainda não estiver disponível.
   *
   * PORQUÊ: alguns ficheiros (WebM gravados no browser, gravações de ecrã, MP4 sem índice)
   * reportam `Infinity`/`NaN` até serem indexados. Sem duração a marcha-atrás não sabe onde é o
   * fim e, no início do vídeo, também não tem para onde saltar — a imagem ficava parada enquanto
   * o painel dizia "a rebobinar". Forçar um seek para lá do fim obriga o descodificador a
   * percorrer o ficheiro e a calcular a duração real; no fim o vídeo volta ao instante onde estava
   * (o seek de indexação é um efeito interno, não é uma ordem de transporte do utilizador).
   *
   * @returns {Promise<number>} duração em segundos (0 quando o ficheiro não a revela)
   */
  resolveDuration() {
    const video = this.videoElement;
    if (!video) return Promise.resolve(0);
    if (Number.isFinite(this.duration) && this.duration > 0) return Promise.resolve(this.duration);
    // Com o varrimento em curso o elemento pertence-lhe: não se emite um seek paralelo.
    if (this.transportLocked) return Promise.resolve(0);
    if (Number.isFinite(video.duration) && video.duration > 0) {
      this._adoptDuration(video.duration);
      return Promise.resolve(this.duration);
    }

    const previous = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    return new Promise((resolve) => {
      let settled = false;
      let armed = false;

      /**
       * Fecha a resolução. Só declara fracasso quando a duração é mesmo desconhecida: desistir
       * ao primeiro evento (a `durationchange` dispara antes de o browser fixar o valor em
       * ficheiros sem índice) cancelava o recuo pedido pelo utilizador com o ficheiro já pronto.
       */
      const settle = () => {
        if (settled) return;
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        if (duration <= 0 && Date.now() - startedAt < RESOLVE_DURATION_TIMEOUT_MS) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(deadline);
        video.removeEventListener('timeupdate', trySettle);
        video.removeEventListener('durationchange', trySettle);
        video.removeEventListener('seeked', trySettle);
        video.removeEventListener('loadedmetadata', armForceSeek);
        if (duration > 0) {
          this._adoptDuration(duration);
          try {
            // Devolve o vídeo ao instante onde estava: o seek de indexação é interno.
            video.currentTime = Math.max(0, Math.min(previous, duration - 0.001));
          } catch (err) {
            // Devolver o vídeo ao instante anterior é conveniência: falhar não impede recuar.
          }
        } else if (this.onDebugLog) {
          this.onDebugLog('warn', 'O ficheiro não revela a duração: sem fim definido, o recuo não pode correr.');
        }
        resolve(duration);
      };

      const trySettle = () => settle();

      /** Seek para lá do fim: é o que obriga o descodificador a percorrer e a indexar o ficheiro. */
      const armForceSeek = () => {
        if (settled || armed) return;
        armed = true;
        try {
          video.currentTime = 1e101;
        } catch (err) {
          // Sem metadados ainda: o `durationchange`/o relógio de acompanhamento voltam a tentar.
          armed = false;
        }
      };

      const startedAt = Date.now();
      video.addEventListener('timeupdate', trySettle);
      video.addEventListener('durationchange', trySettle);
      video.addEventListener('seeked', trySettle);
      // O seek forçado só faz sentido depois de o elemento ter metadados (antes disso é ignorado).
      if (video.readyState >= 1) armForceSeek();
      else video.addEventListener('loadedmetadata', armForceSeek, { once: true });

      // Rede de segurança: cobre o caso de o seek ser ignorado sem evento nenhum.
      const poll = setInterval(() => {
        if (!armed) armForceSeek();
        trySettle();
      }, 50);
      const deadline = setTimeout(settle, RESOLVE_DURATION_TIMEOUT_MS);
    });
  }

  /**
   * Adota uma duração nova (relógio, régua e loop).
   *
   * NÃO dispara `onVideoLoaded`: esse aviso significa "ficheiro novo carregado" e o componente
   * arranca a análise integral com ele. Descobrir a duração a meio de uma ordem de recuo não pode
   * ter esse efeito colateral. A interface lê a duração de cada atualização de tempo.
   */
  _adoptDuration(duration) {
    this.duration = duration;
    this._reclampLoopToDuration();
    if (this.onTimeUpdate) this.onTimeUpdate(this.currentTime || 0, duration);
  }

  /**
   * Inicia a reprodução reversa contínua (andar no sentido oposto no tempo).
   *
   * Sem duração conhecida o motor não arranca já: resolve-se o índice do ficheiro primeiro (ver
   * `resolveDuration`) para o recuo saber onde é o fim. Se o ficheiro nunca revelar a duração,
   * a ordem é desfeita com um aviso — em vez de deixar o painel a dizer "a rebobinar" com a
   * imagem parada.
   */
  playReverse() {
    const video = this.videoElement;
    if (!video) return;
    // A ordem do utilizador registra-se ANTES do bloqueio: durante o varrimento não se emitem
    // seeks (competiriam com ele), mas a ordem não se perde — é cumprida no fim.
    this.requestedDirection = 'reverse';
    if (this.transportLocked) return;

    if (!video.paused) video.pause();

    this.playbackDirection = 'reverse';
    this.isReversePlaying = true;
    this.isPlaying = true;

    if (this.onPlayStateChange) this.onPlayStateChange(true);
    if (this.onDirectionChange) this.onDirectionChange('reverse');

    if (!Number.isFinite(this.duration) || this.duration <= 0) {
      if (this.onDebugLog) {
        this.onDebugLog('info', 'Marcha-atrás: a resolver a duração do ficheiro antes de recuar.');
      }
      const request = this._durationRequest || this.resolveDuration();
      this._durationRequest = request;
      request.then((duration) => {
        if (this._durationRequest === request) this._durationRequest = null;
        // A ordem mudou entretanto (pausa, outro sentido, varrimento tomou o vídeo): não arrancar.
        if (!this.isReversePlaying || this.transportLocked) return;
        if (!Number.isFinite(duration) || duration <= 0) {
          this.pauseReverse();
          if (this.onDebugLog) {
            this.onDebugLog('warn', 'Marcha-atrás cancelada: a duração do vídeo é desconhecida.');
          }
          return;
        }
        this._startReverseFromCurrentPosition();
      });
      return;
    }

    this._startReverseFromCurrentPosition();
  }

  /**
   * Arranca o motor de recuo a partir do instante atual (ou do fim, se estiver no início).
   * Exige uma duração conhecida.
   */
  _startReverseFromCurrentPosition() {
    const video = this.videoElement;
    if (!video || !this.isReversePlaying) return;

    const bounds = this.getBounds();
    const current = video.currentTime || 0;
    const minBound = bounds.start;
    const maxBound = bounds.end || this.duration;

    // No modo inverso, o "início" é o fim do vídeo (ou o ponto B do intervalo).
    if (Number.isFinite(maxBound) && (current <= minBound + 0.05 || current >= maxBound)) {
      this.seekTo(maxBound);
    }

    this.reverseEngine.start();
  }

  /** Pausa a reprodução reversa (comando do utilizador: retira a ordem de recuar). */
  pauseReverse({ automatic = false } = {}) {
    if (!automatic) this.requestedDirection = null;
    this.reverseEngine.stop();
    if (!this.isReversePlaying) {
      // Já não estava a rebobinar: ainda assim a pausa tem de deixar o estado coerente
      // (`isPlaying` preso a `true` fazia a interface mentir sobre o que o vídeo fazia).
      this.isPlaying = false;
      return;
    }
    this.isReversePlaying = false;
    this.isPlaying = false;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  /**
   * Fotogramas por segundo realmente apresentados na marcha-atrás (diagnóstico).
   * Na marcha-atrás este valor é estável; antes da correção colapsava para ~1 FPS.
   */
  get reverseMeasuredFps() {
    return this.reverseEngine.measuredFps;
  }

  /** Estado completo do motor de marcha-atrás (diagnóstico e testes automáticos). */
  getReverseDebug() {
    return {
      running: this.reverseEngine.isRunning,
      seekPending: this.reverseEngine.seekPending,
      seeks: this.reverseEngine.statSeekRequests,
      frames: this.reverseEngine.statFramesShown,
      stalls: this.reverseEngine.statStalls,
      fps: this.reverseEngine.measuredFps,
      budget: Math.round(this.reverseEngine.budget * 1000) / 1000,
      direction: this.playbackDirection,
      isReversePlaying: this.isReversePlaying,
      currentTime: this.currentTime,
    };
  }

  /**
   * Define o sentido de reprodução ('forward' | 'reverse').
   */
  setPlaybackDirection(direction) {
    if (direction !== 'forward' && direction !== 'reverse') return;
    this.requestedDirection = direction;
    if (this.transportLocked) return;
    if (this.playbackDirection === direction && (this.isReversePlaying === (direction === 'reverse'))) return;

    const wasPlaying = this.isPlaying || this.isReversePlaying;
    if (direction === 'reverse') {
      if (wasPlaying) {
        this.playReverse();
      } else {
        this.playbackDirection = 'reverse';
        if (this.onDirectionChange) this.onDirectionChange('reverse');
      }
      return;
    }

    // Voltar ao sentido normal
    this.reverseEngine.stop();
    this.isReversePlaying = false;
    this.playbackDirection = 'forward';
    if (this.onDirectionChange) this.onDirectionChange('forward');

    if (wasPlaying) {
      const bounds = this.getBounds();
      const current = this.videoElement ? this.videoElement.currentTime || 0 : 0;
      if (current >= (bounds.end || this.duration) - 0.05) this.seekTo(bounds.start);
      this.play();
    }
  }

  togglePlaybackDirection() {
    this.setPlaybackDirection(this.playbackDirection === 'forward' ? 'reverse' : 'forward');
  }

  /**
   * Comando de transporte: escolher um sentido faz o vídeo ANDAR nesse sentido.
   *
   * Sem isto, escolher "de trás para frente" com o vídeo parado limitava-se a mudar a
   * etiqueta do sentido e a imagem ficava parada — o utilizador carregava em "recuar" e
   * não acontecia nada. O pedido é explícito: "quando selecionado o vídeo tem de
   * reproduzir inversamente".
   */
  selectDirection(direction) {
    if (direction !== 'forward' && direction !== 'reverse') return;
    this.requestedDirection = direction;
    if (this.transportLocked) return;
    this.setPlaybackDirection(direction);
    if (direction === 'reverse') {
      if (!this.isReversePlaying) this.playReverse();
      return;
    }
    if (!this.isPlaying) this.play();
  }

  togglePlay() {
    const video = this.videoElement;
    if (!video || this.transportLocked) return;

    if (this.playbackDirection === 'reverse') {
      if (this.isReversePlaying) {
        this.pauseReverse();
      } else {
        this.playReverse();
      }
      return;
    }

    this.pauseReverse();
    this.playbackDirection = 'forward';
    if (video.paused || video.ended) {
      this.play();
    } else {
      video.pause();
    }
  }

  /**
   * Para tudo (sentido normal e marcha-atrás) com o estado coerente com o vídeo.
   *
   * @param {{ automatic?: boolean }} [options] A pausa do UTILIZADOR retira a ordem de sentido
   *        (uma pausa é "não andes agora"); a pausa automática — o varrimento integral a tomar o
   *        vídeo — mantém-na, para ser cumprida quando o transporte voltar ao utilizador.
   */
  pause({ automatic = false } = {}) {
    if (!automatic) this.requestedDirection = null;
    // Nada se move enquanto está em pausa: o travão da câmara lenta automática
    // larga-se aqui para o painel não dizer "câmara lenta" sobre uma imagem parada.
    this.releaseMotionSlowdown();
    const wasRunning = this.isPlaying || this.isReversePlaying;
    this.reverseEngine.stop();
    this.isReversePlaying = false;
    this.isPlaying = false;
    if (this.videoElement && !this.videoElement.paused) {
      this.videoElement.pause();
    }
    if (wasRunning && this.onPlayStateChange) this.onPlayStateChange(false);
  }

  /**
   * Reproduzir no sentido normal.
   *
   * @param {{ automatic?: boolean }} [options] `automatic: true` marca a retomada feita pela
   *        própria aplicação (fim da análise integral) — nesse caso a ordem do utilizador manda:
   *        se ele pediu para recuar, retoma-se o recuo em vez de forçar o sentido normal.
   */
  play({ automatic = false } = {}) {
    if (automatic && this.requestedDirection === 'reverse') {
      this.playReverse();
      return;
    }
    if (!automatic) this.requestedDirection = 'forward';

    this.reverseEngine.stop();
    this.isReversePlaying = false;
    if (this.transportLocked) return;
    this.playbackDirection = 'forward';
    if (this.onDirectionChange) this.onDirectionChange('forward');

    const video = this.videoElement;
    if (!video) return;

    // Se estiver no fim do âmbito, recomeça no início (autoplay/loop total).
    if (this.infiniteLoop && this.duration > 0) {
      const bounds = this.getBounds();
      const current = video.currentTime || 0;
      if (current >= bounds.end - 0.05) this.seekTo(bounds.start);
    }

    if (video.paused) {
      video.play().catch(() => {
        if (this.onDebugLog) this.onDebugLog('warn', 'Autoplay bloqueado pelo navegador.');
      });
    }
  }

  seekTo(seconds) {
    const video = this.videoElement;
    if (!video || this.transportLocked) return;
    const dur = Number.isFinite(this.duration) && this.duration > 0
      ? this.duration
      : (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0);
    if (dur > 0 && this.duration <= 0) {
      this.duration = dur;
      this._reclampLoopToDuration();
    }
    const target = dur > 0 ? Math.max(0, Math.min(seconds, dur)) : Math.max(0, seconds);
    const unchanged = Math.abs((video.currentTime || 0) - target) < 0.001;
    try {
      video.currentTime = target;
    } catch (err) {
      if (this.onDebugLog) this.onDebugLog('warn', `Seek rejeitado (${err?.message || err}).`);
    }
    this.currentTime = target;
    if (this.isReversePlaying) this.reverseEngine.notifyExternalSeek();
    // Se o tempo não mudou, o `seeked` não dispara: publicar aqui evita um relógio preso.
    if (unchanged) this._publishFrame(target);
  }

  seekRelative(deltaSeconds) {
    if (!this.videoElement || this.transportLocked) return;
    this.seekTo((this.videoElement.currentTime || 0) + deltaSeconds);
  }

  startScrubbing() {
    this.wasPlayingBeforeScrub = this.isPlaying;
    this.wasReverseBeforeScrub = this.isReversePlaying;
    this.pause();
  }

  stopScrubbing(resume = false) {
    if (!resume) return;
    if (this.wasReverseBeforeScrub) {
      this.playReverse();
    } else if (this.wasPlayingBeforeScrub) {
      this.play();
    }
  }

  stepRangeFrame(direction = 1, fps = 30) {
    if (!this.videoElement) return;
    const step = this.sourceFrameDuration > 0 && this.sourceFrameDuration < 0.2 ? this.sourceFrameDuration : 1 / fps;
    this._stepWithinBounds(direction * step);
  }

  stepRangeSeconds(deltaSeconds) {
    this._stepWithinBounds(deltaSeconds);
  }

  /** Navegação fotograma-a-fotograma dentro do âmbito (com wrap nas extremidades). */
  _stepWithinBounds(delta) {
    const video = this.videoElement;
    if (!video || this.transportLocked) return;
    const bounds = this.getBounds();
    let next = (video.currentTime || 0) + delta;
    if (bounds.end > bounds.start) {
      if (next > bounds.end) next = bounds.start;
      else if (next < bounds.start) next = bounds.end;
    }
    this.seekTo(next);
  }

  // ---------------------------------------------------------------------------
  // Velocidade e auto-slowdown
  // ---------------------------------------------------------------------------

  setAutoSlowdown(enabled, speed = 0.25) {
    this.autoSlowdownEnabled = Boolean(enabled);
    if (speed) this.autoSlowdownSpeed = speed;
    if (!this.autoSlowdownEnabled && this.isSlowedDownByMotion) {
      this.releaseMotionSlowdown();
    }
  }

  triggerMotionSlowdown() {
    if (!this.autoSlowdownEnabled || this.isSlowedDownByMotion || !this.isPlaying) return false;
    this.isSlowedDownByMotion = true;
    this.applyPlaybackRate(this.autoSlowdownSpeed);
    if (this.onAutoSlowdownChange) {
      this.onAutoSlowdownChange(true, this.autoSlowdownSpeed);
    }
    return true;
  }

  releaseMotionSlowdown() {
    if (!this.isSlowedDownByMotion) return false;
    this.isSlowedDownByMotion = false;
    const restored = this.userBasePlaybackRate > 0 ? this.userBasePlaybackRate : 1.0;
    this.applyPlaybackRate(restored);
    if (this.onAutoSlowdownChange) {
      this.onAutoSlowdownChange(false, restored);
    }
    return true;
  }

  /**
   * Velocidade escolhida pelo utilizador. Fica guardada mesmo quando a câmara lenta
   * automática está a mandar — e é esta que é reposta quando o travão larga.
   */
  setUserPlaybackRate(rate) {
    const value = Number(rate) > 0 ? Number(rate) : 1.0;
    this.userBasePlaybackRate = value;
    if (this.isSlowedDownByMotion) return;
    this.applyPlaybackRate(value);
  }

  setPlaybackRate(rate) {
    const value = Number(rate) > 0 ? Number(rate) : 1.0;
    if (!this.isSlowedDownByMotion) {
      this.userBasePlaybackRate = value;
    }
    this.applyPlaybackRate(value);
  }

  applyPlaybackRate(rate) {
    this.playbackRate = rate;
    if (this.videoElement) {
      this.videoElement.playbackRate = rate;
    }
  }

  cleanup() {
    this.releaseMotionSlowdown();
    this.pauseReverse();
    this._stopLoopGuard();
    if (this.videoElement && this._vfcId && typeof this.videoElement.cancelVideoFrameCallback === 'function') {
      try {
        this.videoElement.cancelVideoFrameCallback(this._vfcId);
      } catch (e) {
        // ignorar
      }
      this._vfcId = null;
    }
    if (this.videoUrl) {
      URL.revokeObjectURL(this.videoUrl);
      this.videoUrl = null;
    }
    this.videoFile = null;
    this.fileName = '';
    this.duration = 0;
    this.currentTime = 0;
    this.isPlaying = false;
    this.isReversePlaying = false;
    this.playbackDirection = 'forward';
  }
}
