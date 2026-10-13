/**
 * Motor de Reprodução no Sentido Oposto (ReversePlaybackEngine) — "rebobinar cassete".
 *
 * Motivo técnico: o HTML5 não suporta `playbackRate` negativo em Chromium/WebKit/Gecko.
 * A única forma de recuar no tempo é reposicionar o vídeo com `currentTime` (seeks).
 *
 * O motor anterior escrevia `currentTime` a cada ~16ms (requestAnimationFrame) enquanto
 * um seek estava em curso. Como atribuir `currentTime` CANCELA o seek anterior e inicia
 * outro, os seeks nunca terminavam: o contador de tempo avançava mas a imagem ficava
 * congelada (medido: ~1 fotograma novo por segundo em vez de 30).
 *
 * Este motor garante:
 *  - **Um único seek em voo**: o próximo só é emitido após o evento `seeked`
 *    (com *timeout* de segurança de 400ms para nunca bloquear).
 *  - **Velocidade real**: acumula `Δtempo_real × velocidade` e recua esse valor,
 *    saltando fotogramas quando a descodificação é mais lenta que o tempo real
 *    (exatamente o comportamento de rebobinar), com passo limitado a `maxStep`.
 *  - **Loop total também na marcha-atrás**: ao chegar ao início salta para o fim
 *    (ponto A → ponto B no intervalo, ou 0s → duração no vídeo completo).
 *  - **Nunca depende só de `requestAnimationFrame`**: o avanço normal é conduzido pelo
 *    relógio nativo do `<video>`, mas a marcha-atrás é feita por SEEKs. Se o browser
 *    estrangular o rAF (janela sem foco, aba oculta, separador em segundo plano), um
 *    motor só de rAF deixaria a imagem parada enquanto o vídeo continuava a andar.
 *    Um batimento por `setInterval` mantém o tempo a andar; o orçamento partilhado
 *    garante que os dois relógios não resultem em duas velocidades diferentes.
 */
import { resolveReverseTarget } from './playbackTimeline.js';

export class ReversePlaybackEngine {
  /**
   * @param {Object} deps
   * @param {() => HTMLVideoElement|null} deps.getVideo
   * @param {() => number} deps.getRate            Velocidade pretendida (0.25x, 0.5x, 1x).
   * @param {() => number} deps.getFrameStep       Duração de um fotograma do ficheiro (segundos).
   * @param {() => {start:number,end:number,infiniteLoop:boolean}} deps.getBounds
   * @param {(time:number) => void} [deps.onFrame] Chamado após cada fotograma efetivamente apresentado.
   * @param {(time:number) => void} [deps.onFinished] Fim do vídeo sem loop infinito.
   * @param {(type:string,msg:string) => void} [deps.onDebugLog]
   */
  constructor({ getVideo, getRate, getFrameStep, getBounds, onFrame, onFinished, onDebugLog }) {
    this.getVideo = getVideo;
    this.getRate = getRate;
    this.getFrameStep = getFrameStep;
    this.getBounds = getBounds;
    this.onFrame = onFrame;
    this.onFinished = onFinished;
    this.onDebugLog = onDebugLog;

    this.isRunning = false;
    this.seekPending = false;
    this.budget = 0;
    this.lastTick = 0;
    this.rafId = null;
    this.heartbeatId = null;
    this.pendingTimeout = null;
    this.statSeekRequests = 0;
    this.statFramesShown = 0;
    this.statStalls = 0;
    this.statStartedAt = 0;
    /** Bónus de passo acumulado quando um seek devolve o MESMO fotograma (segundos). */
    this.stallBonus = 0;
    /** Instante do último fotograma realmente apresentado. */
    this.lastPresentedTime = null;
    /** Passo do seek que está à espera de ser contabilizado (ver `_settlePresentedFrame`). */
    this.pendingStep = null;
  }

  /** Passo máximo aceitável entre fotogramas apresentados (evita saltos absurdos). */
  static MAX_STEP = 0.5;

  /** Tempo máximo de espera por um `seeked` antes de destravar o ciclo (ms). */
  static SEEK_TIMEOUT_MS = 400;

  /**
   * Período do batimento de segurança (ms). Com o mesmo granularidade do rAF (~60 Hz) para
   * que a velocidade real não fique limitada por ele; o orçamento acumulado impede que uma
   * chamada extra acelere a reprodução.
   */
  static HEARTBEAT_MS = 16;

  /**
   * Bónus de passo máximo (segundos) acumulado em caso de "seek que devolve o mesmo
   * fotograma". Vídeos com fotogramas muito espaçados (1 FPS, câmaras de ação, ficheiros
   * gravados com captura irregular) arredondam um passo pequeno de volta ao fotograma
   * atual: sem este bónus, a marcha-atrás ficava eternamente presa na mesma imagem.
   */
  static MAX_STALL_BONUS = 1.5;

  start() {
    const video = this.getVideo();
    if (!video || this.isRunning) return false;

    this.isRunning = true;
    this.seekPending = false;
    this.budget = 0;
    this.stallBonus = 0;
    this.pendingStep = null;
    this.lastPresentedTime = Number.isFinite(video.currentTime) ? video.currentTime : null;
    this.lastTick = performance.now();
    this.statSeekRequests = 0;
    this.statFramesShown = 0;
    this.statStalls = 0;
    this.statStartedAt = this.lastTick;
    this.rafId = requestAnimationFrame((now) => this._tick(now, true));
    this.heartbeatId = setInterval(() => this._tick(performance.now(), false), ReversePlaybackEngine.HEARTBEAT_MS);
    return true;
  }

  stop() {
    this.isRunning = false;
    this.seekPending = false;
    this.budget = 0;
    this.stallBonus = 0;
    this.lastPresentedTime = null;
    this.pendingStep = null;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.heartbeatId) {
      clearInterval(this.heartbeatId);
      this.heartbeatId = null;
    }
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    const video = this.getVideo();
    if (video && this._boundFinish) {
      video.removeEventListener('seeked', this._boundFinish);
      this._boundFinish = null;
    }
  }

  /**
   * Informativo: fotogramas por segundo realmente apresentados na marcha-atrás.
   * Serve para diagnóstico no browser (a imagem nunca deve ficar parada).
   */
  get measuredFps() {
    const elapsed = (performance.now() - this.statStartedAt) / 1000;
    if (elapsed <= 0) return 0;
    return Math.round((this.statFramesShown / elapsed) * 10) / 10;
  }

  /** Um seek externo (scrub/timeline) reinicia o orçamento de tempo. */
  notifyExternalSeek() {
    this.budget = 0;
    this.stallBonus = 0;
    this.lastPresentedTime = null;
    this.pendingStep = null;
    this.lastTick = performance.now();
  }

  /**
   * Um tick do motor. Chamado pelo rAF **e** pelo batimento de segurança; o orçamento
   * acumulado é partilhado, por isso a velocidade real não muda com o número de chamadas.
   * @param {number} now Tempo (ms) do relógio de `performance`.
   * @param {boolean} fromRaf Só a cadeia de rAF se reagenda a si própria.
   */
  _tick(now, fromRaf = false) {
    if (!this.isRunning) return;

    const video = this.getVideo();
    if (!video) {
      this.stop();
      return;
    }

    if (fromRaf) this.rafId = requestAnimationFrame((t) => this._tick(t, true));

    // Um seek em voo de cada vez — a imagem só muda quando o anterior conclui.
    // O tempo gasto à espera do fotograma NÃO se perde: fica no orçamento e é
    // compensado no passo seguinte (é isso que mantém a velocidade real de 1x).
    if (this.seekPending) return;

    // Fechar o ciclo do seek ANTERIOR antes de pedir outro. A decisão tem de acontecer
    // aqui e não dentro do `seeked`: nesse instante o browser ainda não fixou o fotograma
    // arredondado (vídeos com fotogramas espaçados), e comparar ali dava "não avançou" a
    // um seek que avançou — o relógio da interface e o redesenho ficavam parados.
    if (this.pendingStep !== null) this._settlePresentedFrame(video);

    // Um único relógio monotónico para os dois relógios de chamada. Um tick com tempo
    // ATRASADO face ao último é ignorado (e não somado): se cada fonte contasse o mesmo
    // intervalo, o orçamento crescia ao dobro e a marcha-atrás acelerava sozinha.
    const stamp = Number.isFinite(now) ? now : performance.now();
    const dtMs = stamp - this.lastTick;
    if (dtMs < 0) return;
    // Δt limitado a 250ms: evita um salto enorme se o separador ficar em segundo plano.
    const dt = Math.min(dtMs / 1000, 0.25);
    this.lastTick = stamp;

    const rate = Math.max(0.05, Number(this.getRate()) || 1);
    this.budget += dt * rate;

    let frameStep = Number(this.getFrameStep()) || 1 / 30;
    if (!Number.isFinite(frameStep) || frameStep <= 0) frameStep = 1 / 30;
    frameStep = Math.max(1 / 240, Math.min(frameStep, 0.2));

    if (this.budget < frameStep) return;

    const bounds = this.getBounds() || { start: 0, end: video.duration || 0, infiniteLoop: true };
    const resolved = resolveReverseTarget({
      currentTime: video.currentTime || 0,
      // O bónus de stall entra no orçamento: se o seek anterior não mudou o fotograma,
      // é preciso pedir um salto maior para sair daquele fotograma.
      advance: this.budget + this.stallBonus,
      duration: bounds.end,
      loopEnabled: bounds.scoped !== false && bounds.end > bounds.start,
      loopStart: bounds.start,
      loopEnd: bounds.end,
      infiniteLoop: bounds.infiniteLoop !== false,
      frameStep,
      maxStep: ReversePlaybackEngine.MAX_STEP + this.stallBonus,
    });

    if (resolved.finished) {
      this._issueSeek(video, resolved.target, () => {
        this.stop();
        if (this.onFinished) this.onFinished(resolved.target);
      });
      return;
    }

    this._issueSeek(video, resolved.target, null, resolved.step);
  }

  /**
   * Contabiliza o seek já concluído: o fotograma apresentado mudou ou não?
   *
   * Se mudou, consome-se o orçamento e anuncia-se o fotograma (relógio + redesenho). Se o
   * descodificador devolveu o MESMO fotograma (vídeos de 1 FPS, capturas irregulares), o
   * orçamento NÃO é gasto e o passo seguinte cresce — sem isto, a marcha-atrás ficava
   * eternamente presa na mesma imagem, que é precisamente a queixa a corrigir.
   */
  _settlePresentedFrame(video) {
    const stepSeconds = this.pendingStep;
    this.pendingStep = null;
    const time = Number.isFinite(video.currentTime) ? video.currentTime : this.lastPresentedTime;
    const advanced = this.lastPresentedTime === null || Math.abs(time - this.lastPresentedTime) > 0.001;

    if (advanced) {
      this.lastPresentedTime = time;
      this.stallBonus = 0;
      this.statFramesShown++;
      if (typeof stepSeconds === 'number') {
        this.budget = Math.max(0, this.budget - stepSeconds);
      }
      // Só se anuncia um fotograma quando ele é REALMENTE novo: repetir o mesmo instante
      // inflacionava o FPS medido e mentia ao relógio da interface.
      if (this.onFrame) this.onFrame(time);
      return;
    }

    this.statStalls++;
    const frameStep = this.getFrameStep() || 1 / 30;
    this.stallBonus = Math.min(this.stallBonus + frameStep, ReversePlaybackEngine.MAX_STALL_BONUS);
  }

  /**
   * Emite um seek e liberta o ciclo apenas quando o vídeo confirmar o novo fotograma.
   */
  _issueSeek(video, target, afterFinish, stepSeconds) {
    this.seekPending = true;
    this.statSeekRequests++;

    const finish = () => {
      if (!this.seekPending) return;
      this.seekPending = false;
      if (this.pendingTimeout) {
        clearTimeout(this.pendingTimeout);
        this.pendingTimeout = null;
      }
      if (this._boundFinish) {
        video.removeEventListener('seeked', this._boundFinish);
        this._boundFinish = null;
      }
      // O veredicto sobre este fotograma só sai no tick seguinte (posição já fixada).
      this.pendingStep = typeof stepSeconds === 'number' ? stepSeconds : null;
      if (afterFinish) afterFinish();
    };

    this._boundFinish = finish;
    video.addEventListener('seeked', finish);

    // Rede de segurança: se o ficheiro não emitir `seeked` (ex.: seek impossível),
    // o ciclo não pode ficar bloqueado para sempre.
    this.pendingTimeout = setTimeout(finish, ReversePlaybackEngine.SEEK_TIMEOUT_MS);

    try {
      video.currentTime = Math.max(0, target);
    } catch (err) {
      if (this.onDebugLog) {
        this.onDebugLog('warn', `Marcha-atrás: seek rejeitado (${err?.message || err}).`);
      }
      finish();
    }
  }
}
