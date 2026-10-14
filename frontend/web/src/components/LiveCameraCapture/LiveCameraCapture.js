/**
 * Orquestrador da Câmara em Tempo Real (LiveCameraCapture).
 *
 * Responsabilidade:
 * - Orquestrar o ciclo de vida do componente Vue 3 e gerir o estado reativo da interface.
 * - Delegar para os submódulos especializados em ./modules/ (< 150 linhas cada):
 *   - CameraDeviceManager: Enumeração e conexão resiliente de webcam (WebRTC).
 *   - PosePipelineRunner: Loop desacoplado a 60 FPS e inferência MediaPipe Pose.
 *   - BiomechanicsComputer: Cálculos trigonométricos seguros e deteção de ângulos.
 *   - CanvasOverlayRenderer: Desenho de esqueleto, anotações, órbita e miras.
 *   - BilateralWizard: Máquina de estados do teste bilateral.
 *   - ScrubberController: Gravação de rajada de 6s e reprodução em câmara lenta.
 *   - WheelCalibratorHandler: Calibração interativa de pixels para milímetros reais.
 *   - DebugLogger: Interceção global de erros e consola de diagnóstico.
 */

import { markRaw } from 'vue';
import { useI18n } from '../../i18n';
import { useInferenceStore } from '../../stores/inferenceStore';
import { apiService } from '../../services/api';
import { secureStorage } from '../../services/secureStorage';
import { audioService } from '../../services/audioFeedback';
import { bleManager } from '../../services/bleSensorManager';
import { LandmarkSmoother } from '../../services/landmarkSmoother';
import { ManualMarkerTracker } from '../../services/manualMarkerTracker';
import { ChromaMarkerTracker } from '../../services/chroma/chromaMarkerTracker';
import {
  CHROMA_JOINT_COLORS,
  CHROMA_JOINT_LABELS,
  CHROMA_JOINTS,
} from '../../services/chroma/markerPalette';
import { PedalStrokeTracker } from '../../services/pedalStrokeTracker';
import { KopsAnalyzer } from '../../services/kopsAnalyzer';
import { SpatialCalibrator } from '../../services/spatialCalibrator';
import { VideoClipRecorder } from '../../services/videoClipRecorder';
import { FrontalPlaneAnalyzer } from '../../services/frontalPlaneAnalyzer';
import { PolarPlotter } from '../../services/polarPlotter';

import { CameraDeviceManager } from './modules/cameraDeviceManager';
import { PosePipelineRunner } from './modules/posePipelineRunner';
import { BiomechanicsComputer } from './modules/biomechanicsComputer';
import { CanvasOverlayRenderer } from './modules/canvasOverlayRenderer';
import { BilateralWizard } from './modules/bilateralWizard';
import { ScrubberController } from './modules/scrubberController';
import { WheelCalibratorHandler } from './modules/wheelCalibratorHandler';
import { DebugLogger } from './modules/debugLogger';
import { VideoUploadManager } from './modules/videoUploadManager';
import { AnglesTimelineChart } from './modules/anglesTimelineChart';
import { LiveTuningReportManager } from './modules/liveTuningReportManager';
import { MultiImageAnalysisManager } from './modules/multiImageAnalysisManager';
import { MotionSlowdownDetector } from './modules/motionSlowdown';
import { CONVERGENCE_DEFAULTS, convergeStaticPose, extractMedianJointPositions } from './modules/staticPoseConverger';
import { applyFlexibilityToTrunkTarget, buildPhaseCards } from './modules/positionOptimization';
import { CoherentRecommendationEngine } from './modules/coherentRecommendationEngine';
import { FullVideoScanRunner } from './modules/fullVideoScanRunner';
import { FullVideoAnalysisPipeline } from './modules/fullVideoAnalysisPipeline';
import { FinalPrescriptionEngine } from './modules/finalPrescriptionEngine';
import { CRANK_POSITION_RULES } from './modules/crankPositionRules';
import { AthleteProfile } from './modules/athleteProfile';
import {
  DEFAULT_POSTURE,
  POSTURE_AERO,
  POSTURE_MODES,
  POSTURE_UPRIGHT,
  isValidPosture,
  resolveTargets,
} from './modules/postureMode';
import { ASK_CONFIDENCE, detectAeroPosture } from './modules/aeroPostureDetector';
import {
  DRAG_THRESHOLD_PX,
  buildTimeTicks,
  clampRange,
  clampTime,
  formatTimecode,
  loopRegionPercent,
  percentOf,
  resolveTimelineClick,
  resolveTimelineDrag,
} from './modules/playbackTimeline';
import { GifExportService } from '../../services/gifExportService';
import { GifFramePlanner } from './modules/gifFramePlanner';
import { composeAnnotatedGifFrame, drawAnnotatedOverlay } from './modules/annotatedGifFrame';
import { FootOrbitTrace, drawFootOrbit } from './modules/footOrbitTrace';
import { applyChromaMarkers, createChromaState } from './modules/chromaFusion';
import HelpTip from '../common/HelpTip';
import VideoScrubberBar from './components/VideoScrubberBar';

/** Posições do cranque usadas para medir a dispersão do tronco entre pedaladas. */
const STABILITY_POSITIONS = ['tdc', '90deg', 'bdc', '270deg'];
/** Chave de persistência local do perfil do atleta. */
const ATHLETE_PROFILE_STORAGE_KEY = 'athleteMotion.athleteProfile';
/** Chave de persistência local da postura confirmada (ereta vs aero). */
const POSTURE_STORAGE_KEY = 'athleteMotion.posture';
/** Chave de persistência local das preferências do CromaTrack (ligado/desligado + paleta). */
const CHROMA_STORAGE_KEY = 'athleteMotion.chromaTrack';
/** Chave de persistência local do rastreio da órbita do pé (mostrar/ocultar). */
const FOOT_ORBIT_STORAGE_KEY = 'athleteMotion.footOrbit';
/** Intervalo mínimo entre pontos da órbita ao vivo (ms) — não se guarda o mesmo instante duas vezes. */
const FOOT_ORBIT_LIVE_INTERVAL_MS = 40;
/** Quantos fotogramas entram na decisão de postura (≈2 s a 30 FPS). */
const POSTURE_WINDOW_FRAMES = 90;
/** De quanto em quantos fotogramas se reavalia a postura (não a cada fotograma). */
const POSTURE_EVAL_EVERY_FRAMES = 20;
/** Intervalo máximo entre seeks de pré-visualização enquanto se arrasta o intervalo na barra (ms). */
const TIMELINE_DRAG_SEEK_INTERVAL_MS = 60;

/** Intervalo mínimo entre perguntas de confirmação (evita insistir com o utilizador). */
const POSTURE_ASK_COOLDOWN_MS = 60000;

export default {
  name: 'LiveCameraCapture',
  components: { HelpTip, VideoScrubberBar },
  props: {
    sessionData: { type: Object, default: null },
  },
  emits: ['session-completed'],
  setup() {
    const { t } = useI18n();
    return { t };
  },
  created() {
    // Janela deslizante de observações para a deteção de postura. Não é reativa de propósito:
    // é atualizada a cada fotograma e não deve provocar re-render.
    this._postureFrames = [];
    this._postureFrameCounter = 0;
    this._lastPostureAskAt = 0;
    const storedPosture = this.loadStoredPosture();
    this.posture = isValidPosture(storedPosture) ? storedPosture : DEFAULT_POSTURE;
    this.postureSource = isValidPosture(storedPosture) ? 'manual' : 'default';

    // Gestores e hardware isolados da reatividade do Vue 3 para prevenir vazamento de memória Emscripten
    this.deviceMgr = markRaw(new CameraDeviceManager());
    this.smoother = markRaw(new LandmarkSmoother('ultra'));
    this.manualTracker = markRaw(new ManualMarkerTracker());
    this.pedalTracker = markRaw(new PedalStrokeTracker(15));
    // Planeador do GIF: decide QUANDO se guarda cada fotograma (reprodução a 10 FPS vs
    // varrimento integral distribuído pelo vídeo todo). Fora da reatividade de propósito.
    this.gifPlanner = markRaw(new GifFramePlanner());
    this.kopsAnalyzer = markRaw(new KopsAnalyzer(5.0));
    this.spatialCalibrator = markRaw(new SpatialCalibrator());
    this.clipRecorder = markRaw(new VideoClipRecorder(180));
    this.frontalAnalyzer = markRaw(new FrontalPlaneAnalyzer(10.0));
    this.polarPlotter = markRaw(new PolarPlotter(24));

    this.debugLogMgr = markRaw(
      new DebugLogger({
        onNewLog: (logs) => {
          this.debugLogs = [...logs];
        },
      })
    );

    this.scrubberCtrl = markRaw(
      new ScrubberController(this.clipRecorder, {
        onRenderFrame: (canvas) => {
          if (this.ctx) this.ctx.drawImage(canvas, 0, 0);
        },
        onAnglesUpdate: (angles) => {
          this.liveAngles = { ...angles };
        },
        onToast: (msg) => this.showToast(msg),
      })
    );

    this.wheelHandler = markRaw(
      new WheelCalibratorHandler(this.spatialCalibrator, {
        onCalibrated: (pxPerMm) => {
          this.saddleDropCm = 6.4;
          this.debugLogMgr.addLog('info', `Escala calibrada: ${pxPerMm.toFixed(2)} px/mm`);
        },
        onToast: (msg) => this.showToast(msg),
      })
    );

    this.bilateralWiz = markRaw(
      new BilateralWizard({
        onTick: (cd) => {
          this.bilateralCountdown = cd;
        },
        onStepChange: (step, side) => {
          this.bilateralStep = step;
          this.currentSide = side;
        },
        onVoicePrompt: () => audioService.speak(this.t('turnBikePrompt')),
        onComplete: (results) => {
          this.bilateralResults = results;
          this.bilateralTesting = false;
          this.showToast(this.t('bilateralDonePrompt') || 'Teste Bilateral concluído com sucesso!', 4000);
        },
      })
    );

    this.poseRunner = markRaw(
      new PosePipelineRunner({
        onResults: (res, frameTime) => this.onPoseResults(res, frameTime),
        onFpsUpdate: (camFps, aiFps) => {
          this.cameraFps = camFps;
          this.aiFps = aiFps;
        },
        onRenderOverlay: (ctx, w, h) => this.renderOverlayGraphics(ctx, w, h),
        onDebugLog: (type, msg) => this.debugLogMgr.addLog(type, msg),
      })
    );

    // Detetor de movimento do Auto-Slowdown: estado fora da reatividade do Vue.
    this.motionDetector = markRaw(new MotionSlowdownDetector());

    this.videoUploadMgr = markRaw(
      new VideoUploadManager({
        onTimeUpdate: (cur, dur) => {
          this.videoCurrentTime = cur;
          if (dur > 0) {
            this.videoDuration = dur;
          } else if (this.$refs.video && Number.isFinite(this.$refs.video.duration) && this.$refs.video.duration > 0) {
            this.videoDuration = this.$refs.video.duration;
          }
          this.renderTimelineChart();
        },
        onVideoLoaded: (dur) => {
          const effectiveDur = dur > 0 ? dur : (this.$refs.video && Number.isFinite(this.$refs.video.duration) && this.$refs.video.duration > 0 ? this.$refs.video.duration : 0);
          this.videoDuration = effectiveDur;
          this.videoSamplesHistory = [];
        this.videoCapturedFrames = [];
        this.chartHasSamples = false;
        this.bdcAnglesHistory = [];
        this.syncLoopInputsFromManager();
          this.syncLoopStateFromManager();
          // Reprodução fluida a 60 FPS: o vídeo corre no seu framerate nativo enquanto a IA infere
          // de forma assíncrona sem encravar nem estrangular o fluxo de fotogramas.
          this.poseRunner.setFrameAlignment(false);
          // O gestor de vídeo tem de saber o estado real do Auto-Slowdown: sem isto, o
          // interruptor nascia ligado na interface e desligado no motor, e não fazia nada.
          this.videoUploadMgr.setAutoSlowdown(this.autoSlowdownEnabled, this.autoSlowdownSpeed);
          this.videoUploadMgr.setUserPlaybackRate(this.videoPlaybackRate);
          this.timelineClickStart = null;
          this.motionDetector.reset();
          this.smoother.reset();
          // A ordem correta é: ANALISAR tudo primeiro, reproduzir depois. Sem análise
          // completa não há prescrição nenhuma (nem recomendações que vão mudando).
          this.resetVideoAnalysisState();
          this.requestFullVideoAnalysis();
        },
        onLoopWrap: () => {
          this.renderTimelineChart();
        },
        onFramePresented: () => {
          // Um fotograma NOVO está descodificado (seek concluído ou fotograma nativo):
          // redesenha o canvas já. Sem isto, a marcha-atrás (e qualquer seek) ficava
          // dependente do rAF, e um rAF estrangulado deixava a imagem parada.
          this.poseRunner.drawCurrentFrame();
        },
        onDebugLog: (type, msg) => this.debugLogMgr.addLog(type, msg),
        onEnded: () => {
          this.isVideoPlaying = false;
          this.isReversePlaying = false;
          this.poseRunner.setReverseMode(false);
        },
        onPlayStateChange: (playing) => {
          this.isVideoPlaying = playing;
          this.isReversePlaying = this.videoUploadMgr.isReversePlaying;
          this.poseRunner.setReverseMode(this.isReversePlaying);
        },
        onDirectionChange: (dir) => {
          this.playbackDirection = dir;
        },
        onAutoSlowdownChange: (active, rate) => {
          this.isAutoSlowedDown = active;
          this.videoPlaybackRate = rate;
        },
      })
    );

    // --- CromaTrack: rastreio por marcadores cromáticos (fora da reatividade) ---
    this.chromaTracker = markRaw(new ChromaMarkerTracker());
    this.chromaState = createChromaState();
    this.chromaPoints = {}; // pontos fundidos do último fotograma
    this.chromaBlobs = []; // blobs detetados (para diagnóstico/desenho)
    this.loadChromaPreference();

    // Órbita do pé: rastreio próprio (fora da reatividade — são centenas de pontos por análise).
    this.footOrbitTrace = markRaw(new FootOrbitTrace());
    this.loadFootOrbitPreference();
    this._lastFootOrbitPointAt = 0;

    this.ctx = null;
    this.lastSmoothedLandmarks = null;
    this.consecutiveWarnFrames = 0;
  },
  data() {
    return {
      isAnalyzing: true,
      selectedVisionEngine: 'mediapipe_wasm',
      availableVisionEngines: [],
      currentSide: 'left',
      viewPlane: 'sagittal',
      facingMode: 'environment',
      videoDevices: [],
      selectedDeviceId: '',
      audioEnabled: false,
      voiceEnabled: false,
      toastMessage: '',
      cameraError: '',
      cameraLoading: false,
      recordedSnapshotsCount: 0,
      snapshotsBuffer: [],
      showDebugModal: false,
      // Barra de ferramentas avançadas recolhida por omissão para limpar o ruído visual do ecrã
      showAdvancedTools: false,
      // Painel de ferramentas e controlos (Enquadramento, Alertas, Leitura, Órbita, CromaTrack) recolhível com setinha
      isControlsBarCollapsed: (() => {
        try {
          const saved = localStorage.getItem('athleteMotion_controls_collapsed');
          return saved !== null ? saved === 'true' : true;
        } catch {
          return true;
        }
      })(),
      // Posição do HUD de Telemetria: 'top' (Fora do vídeo, topo), 'bottom' (Fora do vídeo, base), 'overlay' (Sobreposto ao vídeo), 'hidden' (Oculto)
      hudPosition: (() => {
        try {
          const saved = localStorage.getItem('athleteMotion_hud_position');
          return saved && ['top', 'bottom', 'overlay', 'hidden'].includes(saved) ? saved : 'top';
        } catch {
          return 'top';
        }
      })(),
      debugLogs: [],
      cameraFps: 0,
      aiFps: 0,
      activeDeviceLabel: '',
      videoResolution: '',
      mediaPipeStatusText: 'A aguardar câmara...',
      mediaPipeStatusClass: 'status-idle',
      hasDetectedPose: false,
      smoothingLevel: 'ultra',
      focusTarget: 'all',
      showMarkerMenu: false,
      isManualCalibrating: false,
      manualCalibratingJoint: '',
      hasManualMarkers: false,
      hoverCrosshair: null,
      currentRpm: 0,
      lastBdcKneeAngle: null,
      bdcFlashActive: false,
      kopsResult: null,
      frontalResult: null,
      livePsi: 86.0,
      saddleDropCm: null,
      bleData: { connected: false, deviceName: '', powerWatts: null, cadenceRpm: null, heartRateBpm: null },
      bilateralTesting: false,
      bilateralStep: 'idle',
      bilateralCountdown: 20,
      bilateralResults: [],
      liveAngles: { joelho: null, costas: null, braco: null, tornozelo: null, cabeca: null, anca: null, antebraco: null },
      targets: resolveTargets({ posture: DEFAULT_POSTURE, ridingStyle: 'road' }),
      /** Postura em vigor: 'upright' (estrada) ou 'aero' (barras de contra-relógio). */
      posture: DEFAULT_POSTURE,
      /** Como chegou aqui: 'default' (por omissão), 'auto' (detetada) ou 'manual' (escolhida). */
      postureSource: 'default',
      /** Última avaliação do detetor (sinais, pontuações e razões). */
      postureDetection: null,
      /** Pergunta de confirmação visível: "atleta está em posição aero?" */
      showPosturePrompt: false,
      isFullBodyVisible: false,
      missingBodyParts: [],
      wheelPoints: [],
      videoSourceMode: 'camera',
      uploadedVideoFile: null,
      uploadedVideoName: '',
      uploadedVideoSizeMb: 0,
      videoCurrentTime: 0,
      videoDuration: 0,
      isVideoPlaying: false,
      videoPlaybackRate: 1.0,
      playbackDirection: 'forward',
      isReversePlaying: false,
      autoSlowdownEnabled: true,
      autoSlowdownSpeed: 0.25,
      isAutoSlowedDown: false,
      videoSamplesHistory: [],
      // De onde vem a curva do gráfico: 'scan' (varrimento integral, cobre o vídeo todo) ou 'live'.
      chartHasSamples: false,
      // Resumo da dinâmica do pé (voltas, sentido, diâmetro); null enquanto não houver órbita.
      footOrbitSummary: null,
      // Rastreio da órbita do pé ligado por omissão (o seletor no cartão do gráfico desliga-o).
      showFootOrbit: true,
      // Guias de correção e setas de deslocamento desligadas por omissão para não sobrecarregar o vídeo
      showTargetGuides: false,
      videoCapturedFrames: [],
      isExportingGif: false,
      isExportingClip: false,
      bdcAnglesHistory: [],
      isFlippedHorizontal: false,
      loopRange: { start: 0, end: 0, enabled: false },
      isInfiniteLoopActive: true,
      // Entradas de tempo do intervalo A-B (aceitam "20", "20.5" ou "1:20").
      loopAInput: '',
      loopBInput: '',
      /** Arrasto em curso na barra temporal (dois pontos: início e fim do intervalo). */
      isTimelineDragging: false,
      /** Sessão de arrasto (não é lida por nenhum template: só guarda a origem do gesto). */
      timelineDragSession: null,
      /** A reprodução estava a andar quando o arrasto começou na barra? */
      wasPlayingBeforeTimelineDrag: false,
      /** Intervalo provisório enquanto o dedo/rato arrasta (desenhado na barra antes de aplicar). */
      loopPreviewRange: null,
      /**
       * Clique ao estilo VLC: o primeiro clique fixa o ponto A (fica aqui pendente) e o
       * segundo escolhe o ponto B e fecha o intervalo. `null` = nada por fechar.
       */
      timelineClickStart: null,
      /** Instante sob o ponteiro (leitura da régua para escolher os pontos com rigor). */
      timelineHoverTime: null,
      /** Aviso de como escolher o intervalo, mostrado depois do primeiro arrasto. */
      timelineHintSeen: false,
      showTuningReportModal: false,
      imageAnalysisMgr: markRaw(new MultiImageAnalysisManager()),
      // O gestor de fotos é `markRaw` (não reativo). Este contador é incrementado em cada
      // mutação e serve de dependência reativa explícita para as computed da galeria.
      imageRevision: 0,
      isAnalyzingSingleImage: false,
      /**
       * Estado da estabilização de uma foto (múltiplas passagens até ao ponto médio).
       * Enquanto isto estiver preenchido, a interface diz em que passagem vai e NÃO desenha traço
       * corporal: o desenho só aparece depois de os cálculos fecharem sobre o ponto médio.
       */
      imageStabilization: null,
      showMultiPositionModal: false,
      isRangeScrubbing: false,
      // --- Análise integral do vídeo (prescrição final única) ---
      athleteProfile: { weightKg: '', shoeSizeEu: '', waistCm: '', heightCm: '', inseamCm: '', cleatPosition: '' },
      showProfileModal: false,
      profilePendingAction: null,
      isFullVideoScanRunning: false,
      videoScanProgress: { percent: 0, stage: 'idle', scannedSeconds: 0, totalSeconds: 0, samples: 0, failures: 0, elapsedMs: 0 },
      videoScanSummary: null,
      videoFinalPrescription: null,
      // --- CromaTrack: estado visível na interface ---
      // (a deteção e a fusão vivem em campos não reativos: correm a cada fotograma e não fazem
      //  sentido no sistema de reatividade do Vue. Só o resumo abaixo é reativo.)
      chromaEnabled: false,
      chromaSingleColor: false,
      chromaStats: { blobs: 0, ms: 0, joints: 0 },
    };
  },
  computed: {
    smoothingLevelText() {
      const map = {
        ultra: 'Rigor Máximo',
        high: 'Suave',
        medium: 'Médio',
        low: 'Leve',
        off: 'Desligado',
      };
      return map[this.smoothingLevel] || this.smoothingLevel;
    },
    hudPositionLabel() {
      const labels = {
        top: 'Fora (Topo)',
        bottom: 'Fora (Base)',
        overlay: 'Sobre o Vídeo',
        hidden: 'Oculto',
      };
      return labels[this.hudPosition] || 'Fora (Topo)';
    },
    /**
     * Posição do pé NA PEDALEIRA no instante em reprodução (12h em cima, 6h em baixo, 3h/9h nos
     * intermédios), lida da rotação da própria órbita.
     *
     * Sem órbita registada devolve string vazia (a interface mostra o aviso próprio). Como lê
     * `videoCurrentTime`, acompanha a reprodução: o valor muda com o pé a andar na roda.
     */
    footOrbitPositionText() {
      // O rasto é `markRaw` (não passa pelo sistema de reatividade, porque corre a cada quadro):
      // a dependência reativa é o RESUMO, que é substituído sempre que a órbita ganha um ponto.
      // Sem esta leitura, o computado ficava em cache a devolver vazio até a reprodução mexer.
      if (!this.footOrbitSummary || !this.footOrbitTrace?.isDrawable) return '';
      const position = this.footOrbitTrace.positionAt(this.videoCurrentTime);
      if (!position) return '';
      // Fora da janela de tolerância a hora é aproximada e diz-se quanto (± graus).
      const label = position.atCardinal
        ? position.label
        : `≈ ${position.label} ±${Math.round(position.deltaDeg)}°`;
      return `${this.t('footOrbitPosition')}: ${label} · ${position.time.toFixed(1)}s`;
    },

    /**
     * Rótulo de fase da pedaleira e grau ótimo da posição atual (12h, 3h, 6h, 9h).
     * Permite ao utilizador compreender o ângulo ótimo esperado para cada fase da pedaleira.
     */
    currentCrankPhaseBadge() {
      if (!this.liveAngles.joelho) return '';
      const pos = this.footOrbitTrace?.isDrawable
        ? this.footOrbitTrace.positionAt(this.videoCurrentTime)
        : null;
      if (pos?.key === 'bdc' || (!pos && this.lastBdcKneeAngle && Math.abs(this.liveAngles.joelho - this.lastBdcKneeAngle) < 6)) {
        const [minK, maxK] = this.targets.knee;
        return `🦶 6h (BDC): Joelho ${Math.round(this.liveAngles.joelho)}° · Alvo ${minK}–${maxK}° (Selim)`;
      }
      if (pos?.key === 'tdc' || (!pos && this.liveAngles.joelho < 85)) {
        return `🦶 12h (TDC): Joelho ${Math.round(this.liveAngles.joelho)}° · Ótimo 60–80° (Fecho Anca)`;
      }
      if (pos?.key === '90deg' || (!pos && this.liveAngles.joelho >= 95 && this.liveAngles.joelho <= 125)) {
        return `🦶 3h: Joelho ${Math.round(this.liveAngles.joelho)}° · Ótimo 100–120° (KOPS)`;
      }
      if (pos?.key === '270deg') {
        return `🦶 9h: Joelho ${Math.round(this.liveAngles.joelho)}° · Ótimo 100–125° (Recuperação)`;
      }
      return '';
    },

    /**
     * Linha de resumo da órbita do pé: voltas, sentido, diâmetro e forma do circuito.
     *
     * Sem órbita registada devolve string vazia (a interface mostra então o aviso próprio), pelo
     * que nunca aparecem zeros a fingir de medição.
     */
    footOrbitText() {
      const summary = this.footOrbitSummary;
      if (!summary) return '';
      const parts = [`${summary.turns} ${this.t('footOrbitTurns')}`];
      if (summary.direction) {
        parts.push(this.t(summary.direction === 'cw' ? 'footOrbitClockwise' : 'footOrbitCounterClockwise'));
      }
      if (summary.diameterPx) {
        const value = summary.diameterMm ? `${summary.diameterMm} mm` : `${summary.diameterPx} px`;
        parts.push(`${this.t('footOrbitDiameter')} ≈ ${value}`);
      }
      if (summary.travelPx) {
        parts.push(`${this.t('footOrbitTravel')} ${summary.travelPx.width}×${summary.travelPx.height} px`);
      }
      if (summary.circularity !== null) {
        parts.push(
          summary.isCircular
            ? this.t('footOrbitCircular')
            : `${this.t('footOrbitNotCircular')} ±${Math.round(summary.circularity * 100)}%`
        );
      }
      return parts.join(' · ');
    },

    /**
     * Relatório de afinações mostrado na interface.
     *
     * MODO VÍDEO: devolve o RELATÓRIO FINAL já calculado — ou, enquanto o varrimento corre,
     * o estado bloqueado com a percentagem. Deliberadamente NÃO lê `liveAngles` nem
     * `lastBdcKneeAngle` (que mudam a cada fotograma): era precisamente isso que fazia a
     * recomendação mudar conforme o vídeo avançava. A telemetria ao vivo continua na HUD,
     * porque uma MEDIDA instantânea não é a mesma coisa que uma PRESCRIÇÃO.
     */
    activeTuningReport() {
      if (this.videoSourceMode === 'file') {
        return this.videoFinalReport;
      }
      return LiveTuningReportManager.generateReport({
        bdcKneeAngle: this.lastBdcKneeAngle,
        liveAngles: this.liveAngles,
        kopsResult: this.kopsResult,
        targets: this.targets,
        isFullBody: this.isFullBodyVisible,
        rpm: this.currentRpm,
        psi: this.livePsi,
        posture: this.posture,
        postureDetection: this.postureDetection,
      });
    },
    nonCompliantItems() {
      if (!this.activeTuningReport || !this.activeTuningReport.items) return [];
      return this.activeTuningReport.items.filter((item) => item.status !== 'ok');
    },
    imageItems() {
      return this.imageRevision >= 0 ? this.imageAnalysisMgr.items : [];
    },
    activeImage() {
      return this.imageRevision >= 0 ? this.imageAnalysisMgr.getActiveImage() : null;
    },
    activeImageReport() {
      if (!this.activeImage || this.activeImage.status !== 'done') return null;
      if (this.activeImage.report) return this.activeImage.report;
      return LiveTuningReportManager.generateReport({
        bdcKneeAngle: this.activeImage.crankPosition === 'bdc' ? this.activeImage.angles?.joelho : null,
        liveAngles: this.activeImage.angles || {},
        kopsResult: this.activeImage.kopsResult,
        targets: this.targets,
        isFullBody: this.activeImage.isFullBodyVisible,
        rpm: 0,
        psi: 90,
        crankPosition: this.activeImage.crankPosition,
        posture: this.posture,
      });
    },
    activeImageNonCompliantItems() {
      if (!this.activeImageReport?.items) return [];
      return this.activeImageReport.items.filter((item) => item.status !== 'ok');
    },
    activeImageCompliantItems() {
      if (!this.activeImageReport?.items) return [];
      return this.activeImageReport.items.filter((item) => item.status === 'ok');
    },
    /**
     * Dados do passo 1 (atleta + bicicleta) que o motor de recomendações usa para PESAR AS PEÇAS:
     * largura do guiador contra os ombros, crenque contra o cavalo, forma do guiador contra o
     * tronco, e alvos absolutos no selim (cm) e no avanço (mm).
     *
     * Sem isto o motor só via ângulos — e podia mandar trocar um guiador de 420 mm a quem tem
     * 40 cm de ombros, ou uma ordem em milímetros relativos a quem já disse quanto tem montado.
     * A costura do perfil (peso/sapato/altura) serve de reserva quando a sessão não a traz.
     */
    equipmentContext() {
      const athlete = this.sessionData?.athlete || {};
      return {
        athlete: {
          ...athlete,
          inseam_cm: athlete.inseam_cm ?? this.athleteProfile?.inseamCm ?? null,
          height_cm: athlete.height_cm ?? this.athleteProfile?.heightCm ?? null,
        },
        bike: this.sessionData?.bike || null,
        geometry: this.sessionData?.geometry || null,
        // Perfil da análise (peso, nº de sapato): entra no resumo técnico e nas notas mecânicas.
        profile: this.athleteProfile || {},
        // Flexibilidade + postura: os alvos em `this.targets` JÁ levam o deslocamento por
        // flexibilidade (ver `configureModalityTargets`), pelo que o motor não o aplica outra vez.
        flexibility: this.sessionData?.athlete?.flexibility || 'medium',
        flexibilityApplied: true,
      };
    },
    /**
     * Prescrição coerente, única, agregada a partir de todas as fotos analisadas.
     * Só existe com >= 2 fotos e nunca contém direções contraditórias.
     */
    coherentPrescription() {
      // Lê `imageRevision` de forma explícita: o gestor de fotos é `markRaw`,
      // pelo que só este contador garante a invalidação desta computed.
      const options = { posture: this.posture, ...this.equipmentContext };
      return this.imageRevision >= 0
        ? CoherentRecommendationEngine.build(this.imageItems, this.targets, options)
        : CoherentRecommendationEngine.build([], this.targets, options);
    },
    /**
     * Resumo técnico de ajuste (todos os dados fornecidos), por grupo, para a interface.
     * `null` enquanto não houver nada para resumir.
     */
    technicalSummaryRows() {
      return this.coherentPrescription?.dataAccounting?.rows || [];
    },
    technicalSummaryCounts() {
      const accounting = this.coherentPrescription?.dataAccounting;
      if (!accounting) return null;
      return { counted: accounting.counted, context: accounting.context, missing: accounting.missing };
    },
    /** Otimização por posição do pé: medido → alvo → ordem, para a tabela da interface. */
    positionOptimizationRows() {
      return this.coherentPrescription?.positionOptimization || [];
    },
    /**
     * Quadro clínico comparativo das QUATRO fases da pedalada (12h → 3h → 6h → 9h), gerado a partir
     * do MESMO motor que avalia as fotos.
     *
     * PORQUÊ ASSIM: o quadro antigo tinha metas fixas de estrada (joelho 145–155°, KOPS ±10 mm, anca
     * > 50°) escritas na marcação — o que contradizia o motor numa bicicleta de MTB, numa medição
     * dinâmica e numa posição aero — e só mostrava três fases (as 9h não existiam). Aqui cada fase
     * traz o objetivo declarado na SSOT das posições (`crankPositionRules`), as métricas COM medição
     * com o alvo próprio daquela posição e a ordem de ajuste que saiu para a peça (se saiu).
     */
    phaseCards() {
      return buildPhaseCards({
        evaluations: this.positionOptimizationRows,
        prescriptions: this.coherentPrescription?.prescriptions || [],
        positionMeta: (id) => this.imageAnalysisMgr.getPositionMeta(id),
        // O veredicto profissional depende da postura, da flexibilidade declarada e do regime de
        // medição: os mesmos 140° no joelho não significam o mesmo em estrada e em MTB, nem em
        // medição estática e em pedalada ativa.
        posture: this.posture,
        flexibility: this.sessionData?.athlete?.flexibility || 'medium',
        // O alvo do joelho desta galeria é o da convenção ESTÁTICA de Holmes (145–155°), que é o
        // que o motor de prescrição usa hoje. Declarar o regime mantém o alvo e o veredicto na
        // MESMA convenção — se o motor passar a usar o alvo dinâmico, passa a 'dynamic' aqui.
        regime: 'static',
      });
    },
    copyTechnicalSummary() {
      const text = this.coherentPrescription?.technicalSummaryText;
      if (!text) return;
      const athleteName = this.sessionData?.athlete?.name || 'Ciclista';
      const bikeModel = this.sessionData?.bike?.brand_model || this.sessionData?.bike?.model || 'Bicicleta';
      const full = `${text}\n${CoherentRecommendationEngine.formatText(this.coherentPrescription, athleteName, bikeModel)}`;
      navigator.clipboard.writeText(full).then(() => {
        this.showToast('📋 Resumo técnico (dados que contam) copiado!');
      }).catch(() => {
        this.showToast('Erro ao copiar texto.');
      });
    },
    coherentPrescriptionScore() {
      return CoherentRecommendationEngine.scoreOf(this.coherentPrescription);
    },
    multiPositionSummary() {
      return this.imageRevision >= 0
        ? this.imageAnalysisMgr.getComparisonSummary()
        : { totalUploaded: 0, totalAnalyzed: 0 };
    },
    crankPositionsList() {
      return MultiImageAnalysisManager.CRANK_POSITIONS;
    },
    isRangeActive() {
      return (
        this.videoSourceMode === 'file' &&
        Boolean(this.uploadedVideoFile) &&
        (this.loopRange.enabled || this.loopRange.start > 0 || this.loopRange.end > 0)
      );
    },
    rangeDuration() {
      if (!this.loopRange.end || this.loopRange.end <= this.loopRange.start) return 1;
      return Math.max(0.1, this.loopRange.end - this.loopRange.start);
    },
    rangeRelativeCurrentTime() {
      const cur = this.videoCurrentTime || 0;
      const start = this.loopRange.start || 0;
      return Math.max(0, Math.min(this.rangeDuration, cur - start));
    },
    rangeProgressPercent() {
      if (!this.rangeDuration) return 0;
      return Math.min(100, Math.max(0, Math.round((this.rangeRelativeCurrentTime / this.rangeDuration) * 100)));
    },
    /** Existe um intervalo A-B válido (não apenas o vídeo completo). */
    hasLoopRange() {
      return this.loopRange.end > this.loopRange.start + 0.01;
    },
    formattedVideoTime() {
      return formatTimecode(this.videoCurrentTime);
    },
    formattedDuration() {
      const dur = this.videoDuration > 0
        ? this.videoDuration
        : (this.$refs.video && Number.isFinite(this.$refs.video.duration) && this.$refs.video.duration > 0 ? this.$refs.video.duration : 0);
      return formatTimecode(dur);
    },
    formattedMidTime() {
      return formatTimecode((this.videoDuration || 0) / 2);
    },
    playheadPercent() {
      return percentOf(this.videoCurrentTime, this.videoDuration || 1);
    },
    /** Marcações da régua: minutos (ou passos "bonitos" em vídeos curtos). */
    timeTicks() {
      return buildTimeTicks(this.videoDuration || 0, { maxTicks: 12 });
    },
    /** Região desenhada na barra: a provisória (a arrastar) tem prioridade sobre a aplicada. */
    timelineRegionStyle() {
      const range = this.timelineShownRange;
      // Sem intervalo fechado não se pinta região nenhuma (só o marcador do ponto A).
      if (!range || !(range.end > range.start + 0.01)) return { display: 'none' };
      const region = loopRegionPercent(range, this.videoDuration || 1);
      return { left: `${region.left}%`, width: `${region.width}%` };
    },
    /**
     * Existe algo para pintar na barra: um intervalo aplicado, um arrasto em curso ou
     * um ponto A já fixado à espera do segundo clique.
     */
    hasTimelineRegion() {
      return Boolean(this.timelineShownRange);
    },
    /**
     * Intervalo que está a ser mostrado na barra: o arrasto em curso, o intervalo
     * aplicado, ou o par em construção por cliques (A já fixado, B à espera).
     */
    timelineShownRange() {
      if (this.loopPreviewRange) return this.loopPreviewRange;
      if (this.hasLoopRange) return { start: this.loopRange.start, end: this.loopRange.end };
      if (Number.isFinite(this.timelineClickStart)) {
        return { start: this.timelineClickStart, end: this.timelineClickStart };
      }
      return null;
    },
    /** Percentagem do marcador A (segue o arrasto em curso, quando existe). */
    timelineRangeStartPercent() {
      const range = this.timelineShownRange;
      if (!range) return 0;
      return percentOf(range.start, this.videoDuration || 1);
    },
    /** Percentagem do marcador B (segue o arrasto em curso, quando existe). */
    timelineRangeEndPercent() {
      const range = this.timelineShownRange;
      if (!range) return 0;
      return percentOf(range.end || this.videoDuration, this.videoDuration || 1);
    },
    /** Texto do intervalo provisório enquanto se arrasta na barra. */
    loopPreviewLabel() {
      if (!this.loopPreviewRange) return '';
      return `${formatTimecode(this.loopPreviewRange.start)} → ${formatTimecode(this.loopPreviewRange.end)}`;
    },
    /** Etiqueta do tempo sob o ponteiro (escolher A e B com rigor). */
    timelineHoverLabel() {
      if (!Number.isFinite(this.timelineHoverTime)) return '';
      return formatTimecode(this.timelineHoverTime);
    },
    /** Posição (percentagem) da leitura sob o ponteiro. */
    timelineHoverPercent() {
      if (!Number.isFinite(this.timelineHoverTime)) return 0;
      return percentOf(this.timelineHoverTime, this.videoDuration || 1);
    },
    /** Instante do ponto A já fixado (à espera do B) — `null` quando não há nada pendente. */
    pendingLoopPointA() {
      return Number.isFinite(this.timelineClickStart) ? this.timelineClickStart : null;
    },
    /** O mesmo ponto A, já escrito como relógio para as mensagens da interface. */
    pendingLoopPointLabel() {
      return this.pendingLoopPointA === null ? '' : formatTimecode(this.pendingLoopPointA);
    },
    /** Passo da régua em segundos (para legendas e atalhos). */
    timelineTickStepLabel() {
      const ticks = this.timeTicks;
      if (ticks.length < 2) return '';
      const step = ticks[1].time - ticks[0].time;
      return step >= 60 ? `${Math.round(step / 60)} min` : `${step}s`;
    },
    loopStartPercent() {
      return percentOf(this.loopRange.start, this.videoDuration || 1);
    },
    loopEndPercent() {
      return percentOf(this.loopRange.end || this.videoDuration, this.videoDuration || 1);
    },
    loopRegionStyle() {
      const region = loopRegionPercent(this.loopRange, this.videoDuration || 1);
      return { left: `${region.left}%`, width: `${region.width}%` };
    },
    loopRangeLabel() {
      if (!this.hasLoopRange) return 'o vídeo completo';
      return `A ${formatTimecode(this.loopRange.start)} → B ${formatTimecode(this.loopRange.end)}`;
    },
    liveKneeStatus() {
      if (!this.liveAngles.joelho) return 'status-idle';
      const [minK, maxK] = this.targets.knee;
      return this.liveAngles.joelho >= minK && this.liveAngles.joelho <= maxK ? 'status-ok' : 'status-warn';
    },
    liveBackStatus() {
      if (!this.liveAngles.costas) return 'status-idle';
      const [minB, maxB] = this.targets.back;
      return this.liveAngles.costas >= minB && this.liveAngles.costas <= maxB ? 'status-ok' : 'status-warn';
    },
    missingBodyPartsText() {
      return this.missingBodyParts.length ? this.missingBodyParts.join(', ') : '';
    },
    realtimeRecommendations() {
      if (!this.isFullBodyVisible) return [];
      const recs = [];
      const [minK, maxK] = this.targets.knee;
      // RIGOR BIOMECÂNICO: A altura do selim SÓ é avaliada no Ponto Morto Inferior (6h / BDC).
      // Quando o ciclista pedala, o joelho flete naturalmente até 65°-75° ao subir (12h).
      // Avaliar o joelho fora do BDC gerava conselhos contraditórios de "subir" e "descer" selim.
      const knee = this.lastBdcKneeAngle;
      if (knee) {
        if (knee < minK) recs.push(`Selim Baixo (BDC ${knee}°): Eleve o selim entre 5mm e 10mm para atingir a meta ${minK}°–${maxK}°.`);
        else if (knee > maxK) recs.push(`Selim Alto (BDC ${knee}°): Desça o selim entre 5mm e 8mm para prevenir hiperextensão (${minK}°–${maxK}°).`);
        else recs.push(`Selim Alinhado (BDC ${knee}°): Extensão ideal dentro da meta ergonómica ${minK}°–${maxK}°.`);
      } else if (this.currentRpm > 0) {
        recs.push('A analisar pedalada: aguarde passagem no Ponto Morto Inferior (6h / BDC) para avaliar a altura do selim.');
      } else if (this.liveAngles.joelho && this.liveAngles.joelho >= 120) {
        if (this.liveAngles.joelho < minK) recs.push('Selim Baixo: Eleve o selim entre 5mm e 10mm para atingir extensão ideal.');
        else if (this.liveAngles.joelho > maxK) recs.push('Selim Alto: Desça o selim entre 5mm e 8mm para prevenir hiperextensão.');
      }
      // O KOPS prescreve recuo/avanço do selim só em posição ERETA: a referência de aero é o
      // ângulo de assento (78–86°), pelo que em aero o desvio é informação, não ordem.
      if (this.kopsResult && !this.kopsResult.isAligned) {
        if (this.posture === POSTURE_AERO) {
          recs.push(
            `KOPS (${this.kopsResult.offsetMm > 0 ? '+' : ''}${this.kopsResult.offsetMm} mm): descritivo em posição aero — a referência é o ângulo de assento (78–86°), não o joelho sobre o eixo do pedal.`
          );
        } else {
          recs.push(`KOPS: ${this.kopsResult.actionPt}.`);
        }
      }
      if (this.posture === POSTURE_AERO && typeof this.liveAngles.antebraco === 'number' && Array.isArray(this.targets.antebraco)) {
        const maxF = this.targets.antebraco[1];
        if (this.liveAngles.antebraco > maxF) {
          recs.push('Antebraço inclinado acima do alvo aero: eleve a ponta das extensões para nivelar o antebraço com o solo.');
        }
      }
      if (this.liveAngles.costas) {
        const [minB, maxB] = this.targets.back;
        if (this.liveAngles.costas < minB) recs.push('Tronco muito rebaixado: Eleve o guiador ou adicione espaçadores para aliviar a coluna.');
        else if (this.liveAngles.costas > maxB) recs.push('Tronco muito ereto: Pode descer o avanço para obter melhor perfil aerodinâmico.');
      }
      if (this.liveAngles.braco) {
        const [minE, maxE] = this.targets.elbow;
        if (this.liveAngles.braco > maxE) recs.push('Braços hiperestendidos: Reduza o alcance do avanço para fletir cotovelos.');
        else if (this.liveAngles.braco < minE) recs.push('Braços muito fletidos: Cockpit curto. Considere avançar o selim ou mesa mais longa.');
      }
      if (this.liveAngles.cabeca && this.targets.head) {
        const [minH, maxH] = this.targets.head;
        if (this.liveAngles.cabeca > maxH) {
          recs.push('Cabeça em sobre-extensão cervical: Mantenha o olhar relaxado na linha do horizonte.');
        } else if (this.liveAngles.cabeca < minH) {
          recs.push('Cabeça demasiado descaída: Eleve ligeiramente o queixo para desobstruir as vias respiratórias.');
        }
      }
      return recs;
    },
    activeRecommendations() {
      // Em modo vídeo SÓ o relatório final pode produzir recomendações.
      if (this.videoSourceMode === 'file') {
        if (!this.videoFinalPrescription || this.videoFinalPrescription.status !== 'ready') return [];
        return this.videoFinalPrescription.prescriptions.map((item) => `${item.badge} ${item.component}: ${item.action}`);
      }
      if (!this.isAnalyzing || !this.hasDetectedPose) return [];
      if (!this.isFullBodyVisible) {
        const missing = this.missingBodyParts.length ? this.missingBodyParts.join(', ') : 'membros em falta';
        return [`⚠️ Enquadramento Incompleto: Posicione-se para visualizar a totalidade do corpo (cabeça, braços, tronco e pernas). Em falta: ${missing}. Recomendações biomecânicas pausadas.`];
      }
      return this.realtimeRecommendations;
    },
    diagnosticErrorsCount() {
      return this.debugLogs.filter((l) => l.type === 'error').length;
    },
    formattedDebugLogs() {
      return this.debugLogs.length ? this.debugLogs.map((l) => l.message).join('\n') : 'Sistema operacional.';
    },
    hasActiveManualMarkers() {
      return this.hasManualMarkers;
    },
    /**
     * Calibração métrica em curso. Propriedade computada COM setter: era definida em
     * simultâneo em `data` e como computada, o que fazia o Vue avisar que a computada
     * estava sombreada — e as escritas em `this.wheelCalibrating` não chegavam ao gestor.
     */
    wheelCalibrating: {
      get() {
        return this.wheelHandler.isCalibrating;
      },
      set(value) {
        this.wheelHandler.isCalibrating = Boolean(value);
      },
    },
    isRecordingClip() {
      return this.scrubberCtrl.isRecording;
    },
    slowMoScrubberActive() {
      return this.scrubberCtrl.isActive;
    },
    scrubberCurrentIndex: {
      get() {
        return this.scrubberCtrl.currentIndex;
      },
      set(val) {
        this.scrubberCtrl.currentIndex = val;
      },
    },
    isPlayingSlowMo() {
      return this.scrubberCtrl.isPlaying;
    },
    averageBdcKneeAngle() {
      if (this.videoSourceMode === 'file') {
        const metric = this.videoFinalPrescription?.positions?.bdc?.metrics?.find((m) => m.key === 'knee');
        return metric ? Math.round(metric.value) : null;
      }
      if (!this.bdcAnglesHistory.length) return this.lastBdcKneeAngle || null;
      const sum = this.bdcAnglesHistory.reduce((acc, v) => acc + v, 0);
      return Math.round(sum / this.bdcAnglesHistory.length);
    },
    torsoStabilityDegrees() {
      if (this.videoSourceMode === 'file') {
        const positions = this.videoFinalPrescription?.positions || {};
        const mads = STABILITY_POSITIONS.map((key) => positions[key]?.madAngles?.costas).filter(
          (v) => typeof v === 'number'
        );
        if (!mads.length) return null;
        // Dispersão mediana do tronco entre pedaladas: medida de estabilidade, não de posição.
        return Math.round(Math.max(...mads) * 10) / 10;
      }
      const backSamples = this.videoSamplesHistory.map((s) => s.costas).filter((v) => typeof v === 'number');
      if (backSamples.length < 5) return null;
      const minB = Math.min(...backSamples);
      const maxB = Math.max(...backSamples);
      return Math.round((maxB - minB) * 10) / 10;
    },
    videoCyclesCount() {
      if (this.videoSourceMode === 'file') {
        return this.videoFinalPrescription?.phase?.completeRevolutions ?? 0;
      }
      return this.bdcAnglesHistory.length;
    },

    // ---------------------------------------------------------------------
    // Análise integral do vídeo — estado derivado (nunca lê ângulos ao vivo)
    // ---------------------------------------------------------------------

    /** O perfil tem o mínimo obrigatório (peso + número de sapato)? */
    athleteProfileComplete() {
      return AthleteProfile.isComplete(this.athleteProfile);
    },
    athleteProfileMissingText() {
      return AthleteProfile.missingLabels(AthleteProfile.normalize(this.athleteProfile).missingRequired).join(' e ');
    },
    athleteProfileLine() {
      return AthleteProfile.formatLine(this.athleteProfile);
    },
    /** Notas mecânicas derivadas do perfil (peso → sag, sapato → travessões). */
    athleteProfileNotes() {
      return AthleteProfile.describe(this.athleteProfile);
    },
    isVideoModeFile() {
      return this.videoSourceMode === 'file';
    },
    /**
     * Vista do relatório final, no formato que a interface já sabe mostrar.
     * `null` só quando não há qualquer estado (ex.: modo câmara).
     */
    videoFinalReport() {
      const final = this.videoFinalPrescription;
      if (final) return FinalPrescriptionEngine.toReportView(final);
      if (!this.isFullVideoScanRunning && !this.uploadedVideoFile) return null;
      return FinalPrescriptionEngine.toReportView(
        FinalPrescriptionEngine.build({
          analysis: null,
          scanning: this.isFullVideoScanRunning,
          progress: this.videoScanProgress,
          profile: this.athleteProfile,
          targets: this.targets,
          posture: this.posture,
          equipment: this.equipmentContext,
          video: { name: this.uploadedVideoName, durationSeconds: this.videoDuration },
        })
      );
    },
    /**
     * O corpo inteiro está enquadrado para orientações clínicas seguras?
     * Em modo vídeo isto lê a ANÁLISE FINAL (fração de amostras com corpo inteiro), não o flag
     * instantâneo da câmara — caso contrário o relatório final ficaria sem os cartões clínicos
     * porque a última inferência ao vivo não via o corpo todo.
     */
    analysisBodyComplete() {
      if (this.videoSourceMode === 'file') {
        const final = this.videoFinalPrescription;
        if (!final || final.status !== 'ready') return false;
        return (final.fullBodyRatio ?? 1) >= 0.8;
      }
      return this.isFullBodyVisible;
    },
    /** Posições do cranque da análise final, na ordem canónica 12h → 3h → 6h → 9h. */
    videoPositionsList() {
      const positions = this.videoFinalPrescription?.positions || {};
      return STABILITY_POSITIONS.map((key) => positions[key]).filter(Boolean);
    },
    /**
     * Ajustes da análise integral do vídeo, prontos para a tabela que aparece por baixo dos
     * cartões por posição — o mesmo formato que a análise de fotos já mostra.
     *
     * Cada linha diz EM QUE POSIÇÃO DO PÉ (pedal) a medida foi feita: o ângulo da perna só é
     * interpretável com essa etiqueta (o joelho com o pé em cima é ~2x mais fletido do que com o
     * pé em baixo). É esta a fidelidade que o relatório tem de ter.
     */
    videoAdjustments() {
      const items = this.activeTuningReport?.items;
      if (!Array.isArray(items)) return [];
      return items.map((item) => {
        const rule = item.position ? CRANK_POSITION_RULES[item.position] : null;
        const positionLabel = item.positionLabel || (rule ? rule.label : null);
        const positionFoot = item.positionFoot || item.statistics?.footPositionPt || (rule ? rule.footPositionPt : null);
        const measured = item.measured ?? (item.statistics?.median !== undefined ? String(item.statistics.median) : null);
        const target = item.target || (Array.isArray(item.statistics?.target) ? `${item.statistics.target[0]} – ${item.statistics.target[1]}` : null);
        return {
          ...item,
          positionLabel,
          positionFoot,
          measuredLine: [measured, target ? `alvo ${target}` : null].filter(Boolean).join(' · ') || '—',
          positionLine: [positionLabel, positionFoot].filter(Boolean).join(' · ') || 'vídeo completo',
        };
      });
    },
    /** Quantos componentes têm mesmo de ser afinados (os descritivos não são ordens). */
    videoAdjustmentCount() {
      return this.videoAdjustments.filter((item) => item.status !== 'ok').length;
    },
    /** Existe prescrição pronta com ajustes para mostrar por baixo da análise? */
    videoHasAdjustments() {
      return this.videoFinalPrescription?.status === 'ready' && this.videoAdjustments.length > 0;
    },
    videoScanLabel() {
      const stage = this.videoScanProgress.stage;
      if (stage === 'refine') return 'A refinar os fotogramas das posições 12h / 3h / 6h / 9h';
      if (stage === 'grid' || stage === 'grid-complete') return 'A percorrer o vídeo inteiro (passagem de reconhecimento)';
      return 'A preparar a análise integral do vídeo';
    },
    /** Metadados da postura em vigor (ícone, rótulo e resumo). */
    postureMode() {
      return POSTURE_MODES[this.posture] || POSTURE_MODES[DEFAULT_POSTURE];
    },
    /** De onde veio a postura em vigor. */
    postureSourceLabel() {
      if (this.postureSource === 'manual') return 'escolhida por ti';
      if (this.postureSource === 'auto') return 'detetada automaticamente';
      return 'por omissão';
    },
    /** Linha dos alvos aplicados, igual à que sai no relatório copiado. */
    postureSummaryText() {
      return this.postureMode.summary;
    },
    /** Razões da última deteção (medidas e limiares), para mostrar sob a pergunta. */
    postureDetectionReasons() {
      return this.postureDetection?.reasons || [];
    },
    /** Uma linha com a evidência da deteção, quando há amostras suficientes. */
    postureDetectionLine() {
      const detection = this.postureDetection;
      if (!detection || !detection.sufficient) return '';
      const aero = Math.round((detection.aeroScore || 0) * 100);
      const upright = Math.round((detection.uprightScore || 0) * 100);
      return `Sinais (${detection.samples} amostras): ${detection.reasons.join(' · ')} → aero ${aero}% / estrada ${upright}%.`;
    },
  },
  mounted() {
      this.configureModalityTargets();
      this.debugLogMgr.setup();
      this.loadAthleteProfileFromStorage();
      // O passo 1 já pediu peso, sapato, cintura, altura e costura: se vieram com a sessão,
      // entram aqui e a análise arranca sem voltar a interrogar o atleta.
      this.prefillProfileFromSession({ override: true });
      if (this.$refs.video) {
        this.videoUploadMgr.attachVideo(this.$refs.video);
      }
      this.backendInferenceStore = useInferenceStore();
      this.backendInferenceStore
        .fetchEngines()
        .then(() => {
          this.availableVisionEngines = this.backendInferenceStore.availableEngines || [];
        })
        .catch(() => {});
      this.$nextTick(() => this.initPipeline());
    },
    beforeUnmount() {
      this.cancelFullVideoAnalysis();
      this.videoUploadMgr.cleanup();
      this.debugLogMgr.teardown();
      this.poseRunner.destroy();
      this.deviceMgr.stopStream();
      this.bilateralWiz.cancel();
      this.scrubberCtrl.close();
      if (this.backendInferenceStore) {
        this.backendInferenceStore.disconnectWebSocket();
      }
    },
    methods: {
      async onVisionEngineChange() {
        if (this.smoother && typeof this.smoother.resetFilters === 'function') {
          this.smoother.resetFilters();
        }

        if (this.selectedVisionEngine === 'mediapipe_wasm') {
          this.poseRunner.setCustomInferrer(null);
          this.debugLogMgr.addLog('info', 'Motor de visão alterado para MediaPipe (Navegador WASM).');
          this.showToast('Motor: MediaPipe (Navegador WASM)', 2500);
          return;
        }

        if (!this.backendInferenceStore) {
          this.backendInferenceStore = useInferenceStore();
        }

        try {
          await this.backendInferenceStore.switchEngine(this.selectedVisionEngine, this.currentSide);
          this.backendInferenceStore.connectWebSocket();

          this.poseRunner.setCustomInferrer((source, frameTime, timeoutMs) =>
            this.runBackendInference(source, frameTime, timeoutMs)
          );

          const engObj = this.availableVisionEngines.find((e) => e.name === this.selectedVisionEngine);
          const name = engObj ? engObj.display_name : this.selectedVisionEngine;
          this.debugLogMgr.addLog('info', `Motor de visão alterado para ${name} (${engObj?.hardware_provider || 'DirectML'}).`);
          this.showToast(`Motor: ${name}`, 3000);
        } catch (err) {
          this.debugLogMgr.addLog('error', `Falha ao alternar motor: ${err?.message || err}`);
          this.showToast('Erro ao alternar para motor acelerado. A usar MediaPipe.', 3000);
          this.selectedVisionEngine = 'mediapipe_wasm';
          this.poseRunner.setCustomInferrer(null);
        }
      },

      async runBackendInference(source, frameTime, timeoutMs = 1200) {
        const store = this.backendInferenceStore || useInferenceStore();
        if (store.wsStatus !== 'connected') {
          store.connectWebSocket();
        }

        if (!this._backendCanvas) {
          this._backendCanvas = document.createElement('canvas');
          this._backendCtx = this._backendCanvas.getContext('2d', { alpha: false });
        }

        const srcW = source.videoWidth || source.naturalWidth || source.width || 640;
        const srcH = source.videoHeight || source.naturalHeight || source.height || 360;

        // Otimizado: 480px reduz o tempo de toBlob em 60% e reduz o payload de rede sem perder keypoints.
        // Com o motor rápido (rede a 320px) enviar 480px só gasta codificação JPEG e rede —
        // o payload acompanha o motor, porque os keypoints são devolvidos em coordenadas
        // normalizadas e não dependem da resolução enviada.
        const isFastEngine = /fast/i.test(this.selectedVisionEngine || '');
        const maxDim = isFastEngine ? 384 : 480;
        const jpegQuality = isFastEngine ? 0.52 : 0.58;
        let targetW = srcW;
        let targetH = srcH;
        if (targetW > maxDim || targetH > maxDim) {
          const scale = Math.min(maxDim / targetW, maxDim / targetH);
          targetW = Math.round(targetW * scale);
          targetH = Math.round(targetH * scale);
        }

        if (this._backendCanvas.width !== targetW || this._backendCanvas.height !== targetH) {
          this._backendCanvas.width = targetW;
          this._backendCanvas.height = targetH;
        }

        try {
          this._backendCtx.drawImage(source, 0, 0, targetW, targetH);
        } catch (e) {
          return null;
        }

        const jpegBlob = await new Promise((resolve) => {
          this._backendCanvas.toBlob(resolve, 'image/jpeg', jpegQuality);
        });

        if (!jpegBlob) return null;

        // Timestamp rigoroso: em câmara ao vivo ou se frameTime não for positivo e finito, usar performance.now()
        let timestampMs = 0;
        if (this.videoSourceMode === 'camera' || !Number.isFinite(frameTime) || frameTime <= 0) {
          timestampMs = Math.round(performance.now());
        } else {
          timestampMs = Math.round(frameTime * 1000);
        }

        const telemetry = await store.sendFrameAndAwait(jpegBlob, timestampMs, timeoutMs);
        if (!telemetry || !telemetry.landmarks || Object.keys(telemetry.landmarks).length === 0) return null;

        const poseLandmarks = this.convertBackendLandmarksToMediaPipe(telemetry.landmarks, this.currentSide);
        return { poseLandmarks };
      },

      convertBackendLandmarksToMediaPipe(dictLandmarks, side = 'left') {
        const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
        const isLeft = side === 'left';

        // Mapeamento dos 33 pontos MediaPipe
        // 1. Cabeça / Nariz
        if (dictLandmarks.nose) {
          lm[0] = { x: dictLandmarks.nose.x, y: dictLandmarks.nose.y, z: 0, visibility: dictLandmarks.nose.visibility ?? 0.8 };
        } else if (dictLandmarks.ear) {
          lm[0] = { x: dictLandmarks.ear.x, y: dictLandmarks.ear.y, z: 0, visibility: dictLandmarks.ear.visibility ?? 0.8 };
        }

        // Orelhas
        if (dictLandmarks.left_ear) {
          lm[7] = { x: dictLandmarks.left_ear.x, y: dictLandmarks.left_ear.y, z: 0, visibility: dictLandmarks.left_ear.visibility ?? 0.8 };
        } else if (isLeft && dictLandmarks.ear) {
          lm[7] = { x: dictLandmarks.ear.x, y: dictLandmarks.ear.y, z: 0, visibility: dictLandmarks.ear.visibility ?? 0.8 };
        }
        if (dictLandmarks.right_ear) {
          lm[8] = { x: dictLandmarks.right_ear.x, y: dictLandmarks.right_ear.y, z: 0, visibility: dictLandmarks.right_ear.visibility ?? 0.8 };
        } else if (!isLeft && dictLandmarks.ear) {
          lm[8] = { x: dictLandmarks.ear.x, y: dictLandmarks.ear.y, z: 0, visibility: dictLandmarks.ear.visibility ?? 0.8 };
        }

        // Ombros
        if (dictLandmarks.left_shoulder) {
          lm[11] = { x: dictLandmarks.left_shoulder.x, y: dictLandmarks.left_shoulder.y, z: 0, visibility: dictLandmarks.left_shoulder.visibility ?? 0.9 };
        } else if (isLeft && dictLandmarks.shoulder) {
          lm[11] = { x: dictLandmarks.shoulder.x, y: dictLandmarks.shoulder.y, z: 0, visibility: dictLandmarks.shoulder.visibility ?? 0.9 };
        }
        if (dictLandmarks.right_shoulder) {
          lm[12] = { x: dictLandmarks.right_shoulder.x, y: dictLandmarks.right_shoulder.y, z: 0, visibility: dictLandmarks.right_shoulder.visibility ?? 0.9 };
        } else if (!isLeft && dictLandmarks.shoulder) {
          lm[12] = { x: dictLandmarks.shoulder.x, y: dictLandmarks.shoulder.y, z: 0, visibility: dictLandmarks.shoulder.visibility ?? 0.9 };
        }

        // Cotovelos
        if (dictLandmarks.left_elbow) {
          lm[13] = { x: dictLandmarks.left_elbow.x, y: dictLandmarks.left_elbow.y, z: 0, visibility: dictLandmarks.left_elbow.visibility ?? 0.9 };
        } else if (isLeft && dictLandmarks.elbow) {
          lm[13] = { x: dictLandmarks.elbow.x, y: dictLandmarks.elbow.y, z: 0, visibility: dictLandmarks.elbow.visibility ?? 0.9 };
        }
        if (dictLandmarks.right_elbow) {
          lm[14] = { x: dictLandmarks.right_elbow.x, y: dictLandmarks.right_elbow.y, z: 0, visibility: dictLandmarks.right_elbow.visibility ?? 0.9 };
        } else if (!isLeft && dictLandmarks.elbow) {
          lm[14] = { x: dictLandmarks.elbow.x, y: dictLandmarks.elbow.y, z: 0, visibility: dictLandmarks.elbow.visibility ?? 0.9 };
        }

        // Pulsos
        if (dictLandmarks.left_wrist) {
          lm[15] = { x: dictLandmarks.left_wrist.x, y: dictLandmarks.left_wrist.y, z: 0, visibility: dictLandmarks.left_wrist.visibility ?? 0.9 };
        } else if (isLeft && dictLandmarks.wrist) {
          lm[15] = { x: dictLandmarks.wrist.x, y: dictLandmarks.wrist.y, z: 0, visibility: dictLandmarks.wrist.visibility ?? 0.9 };
        }
        if (dictLandmarks.right_wrist) {
          lm[16] = { x: dictLandmarks.right_wrist.x, y: dictLandmarks.right_wrist.y, z: 0, visibility: dictLandmarks.right_wrist.visibility ?? 0.9 };
        } else if (!isLeft && dictLandmarks.wrist) {
          lm[16] = { x: dictLandmarks.wrist.x, y: dictLandmarks.wrist.y, z: 0, visibility: dictLandmarks.wrist.visibility ?? 0.9 };
        }

        // Bacia / Anca
        if (dictLandmarks.left_hip) {
          lm[23] = { x: dictLandmarks.left_hip.x, y: dictLandmarks.left_hip.y, z: 0, visibility: dictLandmarks.left_hip.visibility ?? 0.9 };
        } else if (isLeft && dictLandmarks.hip) {
          lm[23] = { x: dictLandmarks.hip.x, y: dictLandmarks.hip.y, z: 0, visibility: dictLandmarks.hip.visibility ?? 0.9 };
        }
        if (dictLandmarks.right_hip) {
          lm[24] = { x: dictLandmarks.right_hip.x, y: dictLandmarks.right_hip.y, z: 0, visibility: dictLandmarks.right_hip.visibility ?? 0.9 };
        } else if (!isLeft && dictLandmarks.hip) {
          lm[24] = { x: dictLandmarks.hip.x, y: dictLandmarks.hip.y, z: 0, visibility: dictLandmarks.hip.visibility ?? 0.9 };
        }

        // Joelhos
        if (dictLandmarks.left_knee) {
          lm[25] = { x: dictLandmarks.left_knee.x, y: dictLandmarks.left_knee.y, z: 0, visibility: dictLandmarks.left_knee.visibility ?? 0.9 };
        } else if (isLeft && dictLandmarks.knee) {
          lm[25] = { x: dictLandmarks.knee.x, y: dictLandmarks.knee.y, z: 0, visibility: dictLandmarks.knee.visibility ?? 0.9 };
        }
        if (dictLandmarks.right_knee) {
          lm[26] = { x: dictLandmarks.right_knee.x, y: dictLandmarks.right_knee.y, z: 0, visibility: dictLandmarks.right_knee.visibility ?? 0.9 };
        } else if (!isLeft && dictLandmarks.knee) {
          lm[26] = { x: dictLandmarks.knee.x, y: dictLandmarks.knee.y, z: 0, visibility: dictLandmarks.knee.visibility ?? 0.9 };
        }

        // Tornozelos
        if (dictLandmarks.left_ankle) {
          lm[27] = { x: dictLandmarks.left_ankle.x, y: dictLandmarks.left_ankle.y, z: 0, visibility: dictLandmarks.left_ankle.visibility ?? 0.9 };
        } else if (isLeft && dictLandmarks.ankle) {
          lm[27] = { x: dictLandmarks.ankle.x, y: dictLandmarks.ankle.y, z: 0, visibility: dictLandmarks.ankle.visibility ?? 0.9 };
        }
        if (dictLandmarks.right_ankle) {
          lm[28] = { x: dictLandmarks.right_ankle.x, y: dictLandmarks.right_ankle.y, z: 0, visibility: dictLandmarks.right_ankle.visibility ?? 0.9 };
        } else if (!isLeft && dictLandmarks.ankle) {
          lm[28] = { x: dictLandmarks.ankle.x, y: dictLandmarks.ankle.y, z: 0, visibility: dictLandmarks.ankle.visibility ?? 0.9 };
        }

        // Calcâneo
        if (dictLandmarks.left_heel) {
          lm[29] = { x: dictLandmarks.left_heel.x, y: dictLandmarks.left_heel.y, z: 0, visibility: dictLandmarks.left_heel.visibility ?? 0.85 };
        } else if (isLeft && dictLandmarks.heel) {
          lm[29] = { x: dictLandmarks.heel.x, y: dictLandmarks.heel.y, z: 0, visibility: dictLandmarks.heel.visibility ?? 0.85 };
        }
        if (dictLandmarks.right_heel) {
          lm[30] = { x: dictLandmarks.right_heel.x, y: dictLandmarks.right_heel.y, z: 0, visibility: dictLandmarks.right_heel.visibility ?? 0.85 };
        } else if (!isLeft && dictLandmarks.heel) {
          lm[30] = { x: dictLandmarks.heel.x, y: dictLandmarks.heel.y, z: 0, visibility: dictLandmarks.heel.visibility ?? 0.85 };
        }

        // Biqueira (Foot Index)
        if (dictLandmarks.left_toe) {
          lm[31] = { x: dictLandmarks.left_toe.x, y: dictLandmarks.left_toe.y, z: 0, visibility: dictLandmarks.left_toe.visibility ?? 0.85 };
        } else if (isLeft && dictLandmarks.toe) {
          lm[31] = { x: dictLandmarks.toe.x, y: dictLandmarks.toe.y, z: 0, visibility: dictLandmarks.toe.visibility ?? 0.85 };
        }
        if (dictLandmarks.right_toe) {
          lm[32] = { x: dictLandmarks.right_toe.x, y: dictLandmarks.right_toe.y, z: 0, visibility: dictLandmarks.right_toe.visibility ?? 0.85 };
        } else if (!isLeft && dictLandmarks.toe) {
          lm[32] = { x: dictLandmarks.toe.x, y: dictLandmarks.toe.y, z: 0, visibility: dictLandmarks.toe.visibility ?? 0.85 };
        }

        // Manter coerência anatómica no lado oposto (não desenhar pontos a 0,0)
        const activeIdx = isLeft ? [11, 13, 15, 23, 25, 27, 29, 31] : [12, 14, 16, 24, 26, 28, 30, 32];
        const otherIdx = isLeft ? [12, 14, 16, 24, 26, 28, 30, 32] : [11, 13, 15, 23, 25, 27, 29, 31];

        for (let i = 0; i < activeIdx.length; i++) {
          const act = lm[activeIdx[i]];
          const oth = lm[otherIdx[i]];
          if (act.visibility > 0.3 && (oth.visibility < 0.2 || (oth.x === 0 && oth.y === 0))) {
            lm[otherIdx[i]] = {
              x: act.x,
              y: act.y,
              z: -0.05,
              visibility: 0.35,
            };
          }
        }

        return lm;
      },

      showToast(msg, ms = 2500) {
      this.toastMessage = msg;
      setTimeout(() => {
        if (this.toastMessage === msg) this.toastMessage = '';
      }, ms);
    },
    /** Modalidade declarada na sessão (estrada, MTB, gravel, TT). */
    ridingStyleValue() {
      return this.sessionData?.athlete?.riding_style || 'road';
    },
    /**
     * Recalcula os alvos a partir da POSTURA em vigor e da modalidade.
     *
     * Quem decide os números é `postureMode.js` (fonte única de verdade). Nota de correção:
     * a modalidade TT já NÃO altera o alvo do joelho (148–158°) — a evidência não sustenta um
     * alvo diferente de 145–155° para a altura do selim em TT, e esse valor vinha produzindo
     * ordens de selim erradas em posição aero.
     */
    configureModalityTargets() {
      const base = resolveTargets({ posture: this.posture, ridingStyle: this.ridingStyleValue() });
      // Flexibilidade declarada no passo 1 desloca o alvo do tronco. É aplicado AQUI (e não só no
      // motor) para que as leituras em direto, os relatórios e a prescrição mostrem o MESMO alvo:
      // a flexibilidade tem de contar em todo o lado, não apenas no texto final.
      const flexibility = this.sessionData?.athlete?.flexibility || 'medium';
      const adjust = applyFlexibilityToTrunkTarget(base.back, flexibility, this.posture);
      this.flexibilityAdjust = adjust;
      this.targets = adjust.shift ? { ...base, back: adjust.range } : base;
      // O motor recebe `flexibilityApplied: true` (ver `equipmentContext`) para não deslocar de novo.
    },
    /** Postura guardada neste dispositivo (se existir). */
    loadStoredPosture() {
      try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem(POSTURE_STORAGE_KEY) : null;
      } catch {
        return null;
      }
    },
    /**
     * Muda a postura em vigor, aplica os alvos e (em modo vídeo já analisado) reconstrói a
     * prescrição final com os alvos novos — a prescrição continua a ser uma só e não muda sozinha.
     *
     * @param {string} posture 'upright' | 'aero'
     * @param {string} source 'manual' (escolha do utilizador) | 'auto' (detetada)
     */
    setPosture(posture, source = 'manual') {
      if (!isValidPosture(posture)) return;
      const changed = posture !== this.posture;
      this.posture = posture;
      this.postureSource = source;
      this.showPosturePrompt = false;
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(POSTURE_STORAGE_KEY, posture);
      } catch {
        // Persistência indisponível (modo privado): a escolha vale apenas para esta sessão.
      }
      this.configureModalityTargets();
      if (changed) this.rebuildFinalPrescriptionForPosture();
    },
    /** Resposta afirmativa à pergunta "atleta está em posição aero?" */
    confirmAeroPosture() {
      this.setPosture(POSTURE_AERO, 'manual');
      this.showToast(`🪂 ${POSTURE_MODES[POSTURE_AERO].label}: alvos de aero aplicados.`, 4000);
    },
    /** Resposta negativa: o atleta está em posição de estrada (não voltar a perguntar já). */
    dismissAeroPosture() {
      this.setPosture(POSTURE_UPRIGHT, 'manual');
      this._lastPostureAskAt = Date.now();
      this.showToast('🚴 Postura de estrada confirmada.', 2500);
    },
    /** Escolha manual direta (etiquetas de postura na interface). */
    selectPosture(posture) {
      if (posture === this.posture && this.postureSource === 'manual') return;
      this.setPosture(posture, 'manual');
      this.showToast(`Postura: ${POSTURE_MODES[posture]?.label || posture}.`, 2500);
    },
    /** Volta ao modo automático (a postura passa a ser decidida pelo detetor). */
    useAutomaticPosture() {
      this.postureSource = 'default';
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(POSTURE_STORAGE_KEY);
      } catch {
        // sem persistência: apenas nesta sessão
      }
      this.postureDetection = null;
      this.showPosturePrompt = false;
      this._lastPostureAskAt = 0;
      // Reavalia JÁ com as observações que existem: a postura atual é mantida se os sinais a
      // confirmarem, e corrigida de imediato se os sinais disserem o contrário (em vez de ficar
      // à espera de novos fotogramas, que com a câmara tapada nunca chegariam).
      this.evaluatePosture();
      this.showToast('🤖 Deteção automática de postura reativada.', 3000);
    },
    /**
     * Guarda uma observação para a deteção de postura e reavalia periodicamente.
     * É chamada a cada fotograma analisado (câmara) e a cada amostra do varrimento (vídeo).
     */
    recordPostureFrame({ costas, braco, points }) {
      this._postureFrames.push({ costas, braco, points });
      if (this._postureFrames.length > POSTURE_WINDOW_FRAMES) {
        this._postureFrames.splice(0, this._postureFrames.length - POSTURE_WINDOW_FRAMES);
      }
      this._postureFrameCounter += 1;
      if (this._postureFrameCounter % POSTURE_EVAL_EVERY_FRAMES === 0) this.evaluatePosture();
    },
    /**
     * Reavalia a postura a partir da janela de observações.
     *
     * Duas decisões distintas, de propósito:
     *  - `auto`: evidência franca de aero e o utilizador nunca escolheu → aplica sozinho.
     *  - `ask`: evidência parcial (ou escolha manual em sentido contrário) → PERGUNTA.
     * Nunca se sobrepõe uma escolha manual em silêncio.
     */
    evaluatePosture() {
      const detection = detectAeroPosture({
        frames: this._postureFrames,
        confirmedPosture: this.posture,
        isManualChoice: this.postureSource === 'manual',
      });
      this.postureDetection = detection;
      if (!detection.sufficient) return false;

      if (detection.action === 'auto' && detection.posture !== this.posture) {
        this.setPosture(detection.posture, 'auto');
        this.showToast(
          `🪂 Posição aero detetada (${Math.round(detection.confidence * 100)}% de confiança): alvos de aero aplicados. Corrige com a etiqueta de postura.`,
          5000
        );
        return true;
      }

      if (detection.action === 'ask') {
        return this.requestPostureConfirmation(detection);
      }
      return false;
    },
    /** Mostra a pergunta de confirmação, com intervalo mínimo entre perguntas. */
    requestPostureConfirmation(detection) {
      if (this.showPosturePrompt) return false;
      if (Date.now() - this._lastPostureAskAt < POSTURE_ASK_COOLDOWN_MS) return false;
      if (detection.aeroScore < ASK_CONFIDENCE) return false;
      this._lastPostureAskAt = Date.now();
      this.showPosturePrompt = true;
      return true;
    },
    /** Alvos em vigor, em texto (usado na interface e no relatório copiado). */
    postureTargetsLine(posture = this.posture) {
      const mode = POSTURE_MODES[posture] || POSTURE_MODES[DEFAULT_POSTURE];
      return `${mode.icon} ${mode.label}`;
    },
    /**
     * Reconstrói a prescrição final quando a postura muda DEPOIS da análise do vídeo.
     * Usa o resumo já guardado (`videoScanSummary`): nada é reanalisado, só os alvos mudam.
     * Assim a prescrição continua única e imutável por postura, em vez de "ir mudando".
     */
    rebuildFinalPrescriptionForPosture() {
      if (this.videoSourceMode !== 'file' || !this.videoScanSummary) return;
      this.videoFinalPrescription = FinalPrescriptionEngine.build({
        analysis: this.videoScanSummary,
        scanning: false,
        progress: this.videoScanProgress,
        profile: this.athleteProfile,
        targets: this.targets,
        posture: this.posture,
        postureDetection: this.postureDetection,
        equipment: this.equipmentContext,
        video: { name: this.uploadedVideoName, durationSeconds: this.videoDuration },
      });
    },
    async initPipeline() {
      const canvas = this.$refs.canvas;
      if (canvas) this.ctx = markRaw(canvas.getContext('2d'));

      this.poseRunner.initPose();
      await this.refreshVideoDevices();
      await this.startPipeline();
      await this.refreshVideoDevices();
    },
    async refreshVideoDevices() {
      const { devices, selectedDeviceId } = await this.deviceMgr.enumerateDevices(this.selectedDeviceId);
      this.videoDevices = devices;
      this.selectedDeviceId = selectedDeviceId;
    },
    async startPipeline() {
      if (this.videoSourceMode !== 'camera') return;
      const video = this.$refs.video;
      if (!video) return;

      this.cameraLoading = true;
      this.cameraError = '';
      this.poseRunner.stopLoop();
      this.deviceMgr.stopStream();

      const { stream, selectedDeviceId, activeLabel } = await this.deviceMgr.requestStream(
        this.selectedDeviceId,
        this.facingMode
      );
      if (this.videoSourceMode !== 'camera') {
        if (stream) {
          try {
            stream.getTracks().forEach((t) => t.stop());
          } catch (e) {
            console.debug('stream stop error', e);
          }
        }
        return;
      }
      if (stream) {
        this.selectedDeviceId = selectedDeviceId;
        this.activeDeviceLabel = activeLabel;
        video.srcObject = stream;
        await new Promise((r) => {
          if (video.readyState >= 1) r();
          else video.onloadedmetadata = r;
          setTimeout(r, 1200);
        });
        if (this.videoSourceMode !== 'camera') {
          video.srcObject = null;
          this.deviceMgr.stopStream();
          return;
        }
        await video.play().catch(() => {});
        if (this.videoSourceMode !== 'camera') {
          video.srcObject = null;
          this.deviceMgr.stopStream();
          return;
        }
        this.cameraLoading = false;
        this.poseRunner.startLoop(video, this.$refs.canvas, this.ctx, () => this.isAnalyzing && !this.slowMoScrubberActive);
      } else {
        this.cameraLoading = false;
        this.cameraError = this.t('camLockedWarning');
        this.showToast(this.cameraError);
      }
    },
    async restartCamera() {
      if (this.cameraLoading) return;
      this.poseRunner.stopLoop();
      this.deviceMgr.stopStream();
      await new Promise((r) => setTimeout(r, 200));
      await this.startPipeline();
    },
    onPoseResults(results, frameTime = null) {
      if (!this.isAnalyzing || !results?.poseLandmarks?.length) {
        this.hasDetectedPose = false;
        return;
      }
      this.hasDetectedPose = true;
      this.mediaPipeStatusText = 'A analisar pose...';
      this.mediaPipeStatusClass = 'status-ok';

      const rawLandmarks = this.isFlippedHorizontal
        ? results.poseLandmarks.map((lm) => ({ ...lm, x: 1.0 - lm.x }))
        : results.poseLandmarks;
      // O instante de VÍDEO do fotograma analisado acompanha a suavização: depois de um
      // seek ou de um fotograma novo, o filtro recomeça da leitura crua em vez de arrastar
      // a posição antiga — de outro modo o esqueleto chegava visivelmente atrasado à perna.
      this.lastSmoothedLandmarks = this.smoother.smooth(rawLandmarks, {
        time: Number.isFinite(frameTime) ? frameTime : this.videoCurrentTime,
      });

      const isLeft = this.currentSide === 'left';
      // Rastreio contínuo de características óticas (luz, relevo e bordas) nos fotogramas
      // Ímpares = Esquerdo, Pares = Direito (Lado da transmissão)
      if ((this.$refs.video || this.$refs.canvas) && this.hasManualMarkers) {
        this.manualTracker.updateOpticalTracking(this.$refs.video || this.$refs.canvas, {
          knee: this.lastSmoothedLandmarks[isLeft ? 25 : 26],
          ankle: this.lastSmoothedLandmarks[isLeft ? 27 : 28],
          hip: this.lastSmoothedLandmarks[isLeft ? 23 : 24],
          shoulder: this.lastSmoothedLandmarks[isLeft ? 11 : 12],
          elbow: this.lastSmoothedLandmarks[isLeft ? 13 : 14],
        });
      }

      // CromaTrack: marcadores cromáticos do fotograma atual, fundidos com a pose.
      this.runChromaDetection();

      const computed = BiomechanicsComputer.computeFrameAngles({
        lm: this.lastSmoothedLandmarks,
        side: this.currentSide,
        manualTracker: this.manualTracker,
        // Cadeia de origem dos pontos: manual (ação explícita) → cromático → marco do modelo.
        resolvePoint: (joint, fallback) => this.resolveTrackedPoint(joint, fallback),
      });

      this.liveAngles.joelho = computed.joelho;
      this.liveAngles.costas = computed.costas;
      this.liveAngles.braco = computed.braco;
      this.liveAngles.tornozelo = computed.tornozelo;
      this.liveAngles.cabeca = computed.cabeca;
      this.liveAngles.anca = computed.anca;
      this.liveAngles.antebraco = computed.antebraco;
      this.isFullBodyVisible = computed.isFullBodyVisible;
      this.missingBodyParts = computed.missingSegments;

      // Observação para o detetor de postura (janela deslizante + reavaliação periódica).
      this.recordPostureFrame({ costas: computed.costas, braco: computed.braco, points: computed.points });

      const video = this.$refs.video;
      const w = video?.videoWidth || 640;
      const h = video?.videoHeight || 480;

      if (computed.points.anklePt) {
        const bdc = this.pedalTracker.addSample(computed.points.anklePt.y * h, computed.joelho);
        this.currentRpm = this.bleData.connected && this.bleData.cadenceRpm ? this.bleData.cadenceRpm : bdc.rpm;
        if (bdc.isBdc) {
          this.lastBdcKneeAngle = bdc.bdcKneeAngle;
          if (bdc.bdcKneeAngle) {
            this.bdcAnglesHistory.push(bdc.bdcKneeAngle);
          }
          this.triggerBdcFlash();
          this.handleBdcAudioAlarm(bdc.bdcKneeAngle);
        }
      }

      if (computed.points.kneePt && computed.points.anklePt) {
        this.kopsResult = this.kopsAnalyzer.analyze(computed.points.kneePt, computed.points.anklePt, w, h, computed.points.hipPt);
      }

      if (this.viewPlane === 'frontal' && results.poseLandmarks[23] && results.poseLandmarks[24]) {
        const hipCenter = { x: (results.poseLandmarks[23].x + results.poseLandmarks[24].x) / 2, y: (results.poseLandmarks[23].y + results.poseLandmarks[24].y) / 2 };
        this.frontalResult = this.frontalAnalyzer.analyze(hipCenter, computed.points.kneePt, computed.points.anklePt, w, h, this.currentSide);
      }

      if (computed.points.kneePt) {
        this.polarPlotter.addSample(computed.joelho || 90, this.bleData.powerWatts || Math.max(100, this.currentRpm * 2.2));
        this.livePsi = this.polarPlotter.calculatePsi();
      }

      if (this.videoSourceMode === 'file') {
        if (this.videoDuration <= 0 && this.$refs.video && Number.isFinite(this.$refs.video.duration) && this.$refs.video.duration > 0) {
          this.videoDuration = this.$refs.video.duration;
        }
        // Deteção Dinâmica de Movimento para Auto-Slowdown Inteligente (Análise Rigorosa no Movimento)
        if (this.autoSlowdownEnabled && this.isVideoPlaying) {
          // A velocidade angular do joelho é medida em TEMPO DE VÍDEO: com o tempo de
          // relógio, o próprio abrandamento faria baixar a velocidade medida e o motor
          // largava o travão, voltava a 1x e travava outra vez (oscilação sem fim).
          const decision = this.motionDetector.addSample({
            angle: computed.joelho,
            time: this.videoCurrentTime,
          });
          if (decision.enter) {
            const slowed = this.videoUploadMgr.triggerMotionSlowdown();
            if (slowed) this.showToast(`🎯 Movimento rápido (${Math.round(decision.speed)}°/s): câmara lenta automática a ${this.autoSlowdownSpeed}x.`, 3000);
          } else if (decision.release) {
            this.videoUploadMgr.releaseMotionSlowdown();
          }
        } else if (this.videoUploadMgr.isSlowedDownByMotion) {
          // Sem auto-slowdown (ou vídeo parado) o travão não fica preso.
          this.videoUploadMgr.releaseMotionSlowdown();
        }

        // Rastreio da dinâmica do pé: cada inferência ao vivo acrescenta um ponto à órbita.
        this.recordFootOrbitPoint(computed.points, w, h);

        // Curva do gráfico: depois de uma análise integral a curva do vídeo INTEIRO já existe
        // (publicada pelo varrimento); misturar amostras ao vivo por cima dela daria uma linha em
        // zigue-zague, pelo que a reprodução só move o cursor. Sem análise, a curva é a ao vivo.
        if (this.chartSampleSource !== 'scan') {
          this.chartSampleSource = this.chartSampleSource || 'live';
          this.chartHasSamples = true;
          this.videoSamplesHistory.push({
            time: this.videoCurrentTime,
            joelho: computed.joelho,
            costas: computed.costas,
            braco: computed.braco,
            tornozelo: computed.tornozelo,
            cabeca: computed.cabeca,
            isFullBody: computed.isFullBodyVisible,
          });
        }

        // Fotogramas do GIF: vídeo + traços do MediaPipe, compostos pelo próprio analisador
        // (nunca o canvas visível tal como estiver), a 10 FPS.
        this.collectGifFrame(this.videoCurrentTime || 0);

        this.renderTimelineChart();
      }

      this.handleAudioAlarms();
    },
    /**
     * Alarme sonoro e vocal em pedalada ativa: avaliado RIGOROSAMENTE e EXCLUSIVAMENTE no BDC (6h).
     * O joelho flete naturalmente para 60°-75° no ponto mais alto (12h); alertar fora do BDC gerava
     * a incoerência de mandar elevar o selim a cada pedalada.
     */
     handleBdcAudioAlarm(bdcKneeAngle) {
      if (!bdcKneeAngle || !this.audioEnabled || !this.isFullBodyVisible) return;
      const [minK, maxK] = this.targets.knee;
      if (bdcKneeAngle < minK || bdcKneeAngle > maxK) {
        audioService.playBeep(440, 0.2);
        this.consecutiveWarnFrames++;
        if (this.consecutiveWarnFrames >= 2 && this.voiceEnabled) {
          audioService.speak(bdcKneeAngle < minK ? 'Elevar selim' : 'Baixar selim');
          this.consecutiveWarnFrames = 0;
        }
      } else {
        this.consecutiveWarnFrames = 0;
      }
    },
    handleAudioAlarms() {
      if (!this.audioEnabled || !this.isFullBodyVisible) return;
      // Em ciclismo ativo (RPM > 0), a altura do selim é avaliada exclusivamente no BDC via handleBdcAudioAlarm.
      // Em modo estático (RPM = 0), só avalia se a perna estiver voluntariamente estendida no BDC (>= 120°).
      if (this.currentRpm === 0 && this.liveAngles.joelho && this.liveAngles.joelho >= 120) {
        const [minK, maxK] = this.targets.knee;
        if (this.liveAngles.joelho < minK || this.liveAngles.joelho > maxK) {
          this.consecutiveWarnFrames++;
          audioService.playBeep(440, 0.2);
          if (this.consecutiveWarnFrames > 90 && this.voiceEnabled) {
            audioService.speak(this.liveAngles.joelho < minK ? 'Elevar selim' : 'Baixar selim');
            this.consecutiveWarnFrames = 0;
          }
        } else {
          this.consecutiveWarnFrames = 0;
        }
      }
    },
    triggerBdcFlash() {
      this.bdcFlashActive = true;
      setTimeout(() => (this.bdcFlashActive = false), 250);
    },
    // ---------------------------------------------------------------------------------------
    // Dinâmica do pé — órbita que o pé desenha ao rodar a roda pedaleira
    // ---------------------------------------------------------------------------------------

    /** Recupera a preferência do rastreio da órbita do pé (mostrar/ocultar). Falha em silêncio. */
    loadFootOrbitPreference() {
      let prefs = null;
      try {
        const raw = window.localStorage.getItem(FOOT_ORBIT_STORAGE_KEY);
        prefs = raw ? JSON.parse(raw) : null;
      } catch {
        prefs = null;
      }
      // Sem preferência guardada fica ligado: o rastreio é o que o utilizador pediu para ver.
      this.showFootOrbit = !prefs || prefs.enabled !== false;
    },

    /** Grava a preferência do rastreio da órbita do pé neste dispositivo. */
    persistFootOrbitPreference() {
      try {
        window.localStorage.setItem(FOOT_ORBIT_STORAGE_KEY, JSON.stringify({ enabled: this.showFootOrbit }));
      } catch {
        // Sem armazenamento: a escolha vale só para esta sessão.
      }
    },

    /** Seletor mostrar/ocultar a órbita do pé (persistido). */
    toggleFootOrbit(value) {
      if (typeof value === 'boolean') this.showFootOrbit = value;
      this.persistFootOrbitPreference();
      this.showToast(this.showFootOrbit ? '🦶 Rastreio do pé ligado.' : '🦶 Rastreio do pé desligado.');
      this.renderTimelineChart();
      // Redesenha já o fotograma atual: o rasto aparece/desaparece sem esperar pelo próximo quadro.
      if (this.videoSourceMode !== 'camera') this.poseRunner.drawCurrentFrame();
    },

    /**
     * Guarda um ponto da órbita do pé a partir de um fotograma ao vivo.
     *
     * O intervalo mínimo evita repetir o mesmo instante (a inferência pode correr a 60 FPS) e o
     * ponto é guardado em coordenadas normalizadas, para o desenho servir qualquer resolução.
     */
    recordFootOrbitPoint(points, width, height) {
      const ankle = points?.anklePt;
      if (!ankle || !width || !height) return false;
      const now = performance.now();
      if (now - this._lastFootOrbitPointAt < FOOT_ORBIT_LIVE_INTERVAL_MS) return false;
      this._lastFootOrbitPointAt = now;
      const added = this.footOrbitTrace.addPoint(this.videoCurrentTime || now / 1000, ankle.x / width, ankle.y / height);
      if (added) this.refreshFootOrbitSummary();
      return added;
    },

    /** Recalcula o resumo da órbita (voltas, sentido, diâmetro) para a interface. */
    refreshFootOrbitSummary() {
      const trace = this.footOrbitTrace;
      if (!trace || !trace.isDrawable) {
        this.footOrbitSummary = null;
        return null;
      }
      this.footOrbitSummary = trace.summary({ pixelsPerMm: this.spatialCalibrator?.pixelsPerMm || null });
      return this.footOrbitSummary;
    },

    /**
     * Publica as observações do VARRIMENTO INTEGRAL no gráfico e na órbita do pé.
     *
     * PORQUÊ: a análise integral mede os ângulos em centenas de instantes e deitava-os fora — o
     * gráfico da evolução só se enchia durante a reprodução posterior (e uma "A reproduzir vídeo
     * para registar curvas angulares..." ficava no ecrã depois de uma análise completa). Agora a
     * curva do vídeo inteiro aparece assim que a análise acaba, e a reprodução só move o cursor.
     *
     * @param {Array} observations - observações do `FullVideoScanRunner`
     * @param {{ width:number, height:number }} [frame] - resolução em que foram medidas
     * @returns {number} número de amostras publicadas
     */
    publishScanSamples(observations = [], frame = null) {
      const ordered = observations
        .filter((o) => o && Number.isFinite(o.time) && o.angles)
        .slice()
        .sort((a, b) => a.time - b.time);

      this.footOrbitTrace.reset();
      this._lastFootOrbitPointAt = 0;
      if (frame) this.footOrbitTrace.frame = { width: frame.width, height: frame.height };

      ordered.forEach((o) => {
        const angles = o.angles || {};            this.videoSamplesHistory.push({
              time: o.time,
              joelho: angles.joelho ?? null,
              costas: angles.costas ?? null,
              braco: angles.braco ?? null,
              tornozelo: angles.tornozelo ?? null,
              cabeca: angles.cabeca ?? null,
              anca: angles.anca ?? null,
              isFullBody: o.isFullBodyVisible !== false,
            });
            this.footOrbitTrace.addObservation(o, frame);
          });

          this.chartSampleSource = ordered.length ? 'scan' : null;
          this.chartHasSamples = ordered.length >= 1;
      this.refreshFootOrbitSummary();
      this.renderTimelineChart();
      return ordered.length;
    },

    // ---------------------------------------------------------------------------------------
    // CromaTrack — rastreio por marcadores cromáticos (ver docs/CHROMA_TRACK_TASKS.md)
    // ---------------------------------------------------------------------------------------

    /** Recupera as preferências do CromaTrack (ligado/desligado e paleta). Falha em silêncio. */
    loadChromaPreference() {
      let prefs = null;
      try {
        const raw = window.localStorage.getItem(CHROMA_STORAGE_KEY);
        prefs = raw ? JSON.parse(raw) : null;
      } catch {
        prefs = null;
      }
      this.chromaEnabled = Boolean(prefs && prefs.enabled);
      this.chromaSingleColor = Boolean(prefs && prefs.singleColor);
      this.chromaTracker.setMarkers({ singleColor: this.chromaSingleColor });
      this.chromaTracker.setEnabled(this.chromaEnabled);
    },

    /** Grava as preferências do CromaTrack neste dispositivo. */
    persistChromaPreference() {
      try {
        window.localStorage.setItem(
          CHROMA_STORAGE_KEY,
          JSON.stringify({ enabled: this.chromaEnabled, singleColor: this.chromaSingleColor })
        );
      } catch {
        // Armazenamento bloqueado: a preferência vale só para esta sessão. Não é erro.
      }
    },

    /** Liga/desliga o CromaTrack. */
    toggleChroma() {
      this.chromaEnabled = !this.chromaEnabled;
      this.chromaTracker.setEnabled(this.chromaEnabled);
      if (!this.chromaEnabled) {
        this.chromaState = createChromaState();
        this.chromaPoints = {};
        this.chromaBlobs = [];
        this.chromaStats = { blobs: 0, ms: 0, joints: 0 };
      }
      this.persistChromaPreference();
      this.showToast(this.chromaEnabled ? this.t('chromaOnToast') : this.t('chromaOffToast'));
    },

    /**
     * Escolhe o modo de identificação dos marcadores:
     * cores distintas (uma cor por articulação) ou uma só cor (identificação por proximidade).
     */
    setChromaPaletteMode(single) {
      this.chromaSingleColor = Boolean(single);
      this.chromaTracker.setMarkers({ singleColor: this.chromaSingleColor });
      this.chromaState = createChromaState();
      this.persistChromaPreference();
    },

    /**
     * Deteta os marcadores no fotograma atual e funde-os com os marcos do modelo de pose.
     *
     * Corre ao ritmo da inferência (≈30 FPS) e **não** ao ritmo de render (60 FPS): o custo da
     * leitura de píxeis é o gargalo, portanto não se paga duas vezes pelo mesmo fotograma.
     */
    runChromaDetection() {
      if (!this.chromaEnabled) return;
      const video = this.$refs.video;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      const blobs = this.chromaTracker.detect(video, video.videoWidth, video.videoHeight);
      const fused = applyChromaMarkers(this.chromaState, this.lastSmoothedLandmarks, blobs, {
        side: this.currentSide,
        frameWidth: this.chromaTracker.processingWidth,
        singleColor: this.chromaSingleColor,
        markers: this.chromaTracker.markers,
      });

      this.chromaBlobs = blobs;
      this.chromaState = fused.state;
      this.chromaPoints = fused.points;
      this.chromaStats = {
        blobs: blobs.length,
        ms: Math.round(this.chromaTracker.lastDurationMs * 10) / 10,
        joints: fused.report.total,
      };
    },

    /**
     * Origem de um ponto articular, por ordem de prioridade:
     * 1. Calibração manual (ação explícita do técnico) — manda sempre.
     * 2. Marcador cromático confirmado (CromaTrack).
     * 3. Marco bruto do modelo de pose.
     */
    resolveTrackedPoint(joint, fallback) {
      const manual = this.manualTracker ? this.manualTracker.getAdjustedPoint(joint, fallback) : null;
      if (manual && manual.isManual) return manual;

      const chroma = this.chromaEnabled ? this.chromaPoints[joint] : null;
      if (chroma && chroma.weight > 0) return chroma;

      return manual || fallback;
    },

    /** Linha de estado do CromaTrack: quantas articulações, quantos blobs e quanto custou. */
    chromaStatusText() {
      const { blobs, joints, ms } = this.chromaStats;
      if (!joints) return this.t('chromaNoMarkers');
      return `${joints} ${this.t('chromaStatusJoints')} · ${blobs} blob(s) · ${ms} ms`;
    },

    /** Entradas da legenda do CromaTrack (só as articulações onde há marcador a atuar). */
    chromaLegendEntries() {
      return CHROMA_JOINTS.filter(
        (joint) => this.chromaPoints[joint] && this.chromaPoints[joint].source !== 'pose'
      ).map((joint) => ({ label: CHROMA_JOINT_LABELS[joint], color: CHROMA_JOINT_COLORS[joint] }));
    },

    /** Desenha os retículos dos marcadores cromáticos e a legenda de cores. */
    drawChromaOverlay(ctx, w, h) {
      if (!this.chromaEnabled) return;
      CHROMA_JOINTS.forEach((joint) => {
        const point = this.chromaPoints[joint];
        // Só se desenha onde o marcador está realmente a atuar — nunca um ponto "do modelo" com
        // a aparência de marcador (isso seria mentir ao técnico sobre a fonte da medição).
        if (!point || point.source === 'pose') return;
        CanvasOverlayRenderer.drawChromaMarker(
          ctx,
          point,
          CHROMA_JOINT_LABELS[joint],
          CHROMA_JOINT_COLORS[joint],
          w,
          h
        );
      });
      CanvasOverlayRenderer.drawChromaLegend(ctx, this.chromaLegendEntries(), 12, 12);
    },

    renderOverlayGraphics(ctx, w, h) {
      if (!this.lastSmoothedLandmarks) return;

      const isLeft = this.currentSide === 'left';
      const isImage = this.videoSourceMode === 'images';
      // Ímpares = Esquerdo, Pares = Direito (Lado da transmissão)
      const kneePt = (isImage ? null : this.manualTracker?.getAdjustedPoint('knee', this.lastSmoothedLandmarks[isLeft ? 25 : 26])) || this.lastSmoothedLandmarks[isLeft ? 25 : 26];
      const anklePt = (isImage ? null : this.manualTracker?.getAdjustedPoint('ankle', this.lastSmoothedLandmarks[isLeft ? 27 : 28])) || this.lastSmoothedLandmarks[isLeft ? 27 : 28];
      const shoulderPt = (isImage ? null : this.manualTracker?.getAdjustedPoint('shoulder', this.lastSmoothedLandmarks[isLeft ? 11 : 12])) || this.lastSmoothedLandmarks[isLeft ? 11 : 12];
      const elbowPt = (isImage ? null : this.manualTracker?.getAdjustedPoint('elbow', this.lastSmoothedLandmarks[isLeft ? 13 : 14])) || this.lastSmoothedLandmarks[isLeft ? 13 : 14];
      const headPt = this.lastSmoothedLandmarks[isLeft ? 7 : 8] || this.lastSmoothedLandmarks[0];

      // Esqueleto, guias de correção e valores angulares: a MESMA camada que compõe o fotograma
      // do GIF (ver annotatedGifFrame.js), para o GIF nunca divergir do que o utilizador vê.
      drawAnnotatedOverlay(ctx, w, h, {
        landmarks: this.lastSmoothedLandmarks,
        angles: this.liveAngles,
        targets: this.targets,
        side: this.currentSide,
        joints: { knee: kneePt, shoulder: shoulderPt, elbow: elbowPt, ankle: anklePt, head: headPt },
        isImage,
        showGuides: this.showTargetGuides || isImage,
      });

      // CromaTrack: retículos dos marcadores cromáticos por cima do esqueleto.
      if (!isImage) this.drawChromaOverlay(ctx, w, h);

      if (!isImage) {
        // Renderização de Retículos de Bloqueio Ótico e Lupa de Relevo em Tempo Real (modo vídeo/câmara)
        const opticalJoints = [
          { pt: kneePt, label: 'Joelho' },
          { pt: anklePt, label: 'Tornozelo' },
          { pt: shoulderPt, label: 'Ombro' },
          { pt: elbowPt, label: 'Cotovelo' },
        ];
        const activeOptical = opticalJoints.find((j) => j.pt && j.pt.isOptical);

        opticalJoints.forEach(({ pt, label }) => {
          if (pt && pt.isOptical) {
            CanvasOverlayRenderer.drawOpticalLockReticle(ctx, pt.x * w, pt.y * h, label, pt.confidence, pt.status);
          }
        });

        if (activeOptical && activeOptical.pt && (this.$refs.video || this.$refs.canvas)) {
          CanvasOverlayRenderer.drawMagnifyingLoupe(
            ctx,
            this.$refs.video || this.$refs.canvas,
            activeOptical.pt.x * w,
            activeOptical.pt.y * h,
            activeOptical.label,
            activeOptical.pt.confidence || 100,
            w
          );
        }
      }

      if (kneePt && anklePt) this.kopsAnalyzer.drawPlumbLine(ctx, kneePt, anklePt, w, h);

      // Rastreio da dinâmica do pé: o circuito que o pé desenha ao rodar a roda pedaleira, com o
      // círculo ajustado e o marcador do instante em reprodução. Só quando o seletor está ligado.
      if (this.showFootOrbit && this.footOrbitTrace?.isDrawable) {
        const position = this.footOrbitTrace.positionAt(this.videoCurrentTime);
        drawFootOrbit(ctx, this.footOrbitTrace, {
          width: w,
          height: h,
          currentTime: this.videoCurrentTime,
          showCircle: true,
          showHours: true,
          // A etiqueta do marcador diz em que posição da pedaleira está o pé NAQUELE instante.
          currentLabel: position ? `${position.label} · ${position.time.toFixed(1)}s` : null,
        });
      }

      if (this.isManualCalibrating && this.hoverCrosshair) {
        CanvasOverlayRenderer.drawCalibrationCrosshair(ctx, this.hoverCrosshair.x, this.hoverCrosshair.y, w, h, `FIXAR ${this.manualCalibratingJoint.toUpperCase()}`);
      }
    },
    /**
     * Fotograma ANOTADO para o GIF: imagem do vídeo + traços do MediaPipe, compostos por nós.
     *
     * O GIF tem de mostrar o corpo com o esqueleto e os ângulos. Antes capturava-se o que
     * estivesse no canvas visível naquele instante — e durante a análise integral o canvas não é
     * redesenhado, pelo que o GIF saía sem traço nenhum (ou com um fotograma já antigo). Aqui a
     * composição é feita de propósito, num canvas próprio, com os pontos e os ângulos DAQUELE
     * fotograma.
     *
     * @param {{ landmarks?:Array, angles?:Object }} [frame] - estado a desenhar; sem argumentos
     *        usa os valores ao vivo (reprodução normal).
     * @returns {string|null} data URL JPEG pronto a entrar na sequência do GIF.
     */
    captureAnnotatedGifFrame(frame = {}) {
      const video = this.$refs.video;
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;

      const w = video.videoWidth;
      const h = video.videoHeight;
      // Canvas próprio (fora da reatividade e fora do ecrã): não mexe no que o utilizador vê.
      const off = this._gifCanvas || (this._gifCanvas = document.createElement('canvas'));
      if (off.width !== w || off.height !== h) {
        off.width = w;
        off.height = h;
      }
      const ctx = off.getContext('2d');
      if (!ctx) return null;

      // Composição explícita (módulo verificado fora do navegador): imagem do vídeo — espelhada
      // se for esse o caso, com os marcos espelhados a condizer — mais os traços da pose
      // DAQUELE fotograma e o mesmo traçado que o utilizador vê (esqueleto, ângulos, guias).
      // Sem marcos no fotograma (reprodução ao vivo) usam-se os do instante atual.
      const composed = composeAnnotatedGifFrame(ctx, video, {
        width: w,
        height: h,
        landmarks: frame.landmarks || this.lastSmoothedLandmarks,
        angles: frame.angles || this.liveAngles,
        targets: this.targets,
        side: this.currentSide,
        flipped: this.isFlippedHorizontal,
      });
      if (!composed) return null;

      try {
        return off.toDataURL('image/jpeg', 0.85);
      } catch (err) {
        this.debugLogMgr.addLog('warn', `Fotograma do GIF não pôde ser codificado: ${err?.message || err}`);
        return null;
      }
    },

    /**
     * Junta um fotograma anotado à sequência do GIF, com o ritmo certo.
     *
     * Dois ritmos, porque são dois momentos diferentes:
     *  - **reprodução** (ao vivo): um fotograma a cada 100 ms, como o GIF a 10 FPS;
     *  - **varrimento integral**: as amostras estão espalhadas por todo o vídeo, pelo que se
     *    guarda UM fotograma por fatia de `duração / 60` s — assim o GIF cobre o vídeo inteiro
     *    (antes da análise não havia fotograma nenhum, e o GIF saía com uma só imagem).
     *
     * @param {number} videoTime - instante do vídeo a que o fotograma pertence
     * @param {{ landmarks?:Array, angles?:Object }} [frame]
     * @param {{ evenSpread?: boolean }} [options]
     * @returns {boolean} `true` se ficou guardado.
     */
    collectGifFrame(videoTime = 0, frame = {}, { evenSpread = false } = {}) {
      // O ritmo é decidido pelo planeador (puro e verificado fora do navegador).
      const allowed = evenSpread
        ? this.gifPlanner.shouldCaptureAtTime(videoTime, this.videoDuration || 0)
        : this.gifPlanner.shouldCaptureLive(performance.now());
      if (!allowed) return false;

      const shot = this.captureAnnotatedGifFrame(frame);
      if (!shot) return false;
      this.videoCapturedFrames.push(shot);
      this.gifPlanner.markCaptured();
      return true;
    },

    getJointIndexForName(name, isLeft) {
      switch (name) {
        case 'knee': return isLeft ? 25 : 26;
        case 'hip': return isLeft ? 23 : 24;
        case 'ankle': return isLeft ? 27 : 28;
        case 'shoulder': return isLeft ? 11 : 12;
        case 'elbow': return isLeft ? 13 : 14;
        default: return isLeft ? 25 : 26;
      }
    },
    handleCanvasClick(event) {
      const rect = this.$refs.canvas?.getBoundingClientRect();
      if (!rect) return;
      const x = ((event.clientX - rect.left) / rect.width) * (this.$refs.canvas.width || 640);
      const y = ((event.clientY - rect.top) / rect.height) * (this.$refs.canvas.height || 480);

      if (this.isManualCalibrating) {
        const normX = x / (this.$refs.canvas.width || 640);
        const normY = y / (this.$refs.canvas.height || 480);
        const isLeft = this.currentSide === 'left';
        const lmIdx = this.getJointIndexForName(this.manualCalibratingJoint, isLeft);
        const refLm = this.lastSmoothedLandmarks ? this.lastSmoothedLandmarks[lmIdx] : null;

        this.manualTracker.applyCalibrationClick(
          normX,
          normY,
          refLm,
          this.$refs.video || this.$refs.canvas
        );
        this.hasManualMarkers = true;
        this.isManualCalibrating = false;
        this.showToast(`🎯 Ponto (${this.manualCalibratingJoint.toUpperCase()}) bloqueado no relevo e luz!`);
        return;
      }
      if (this.wheelCalibrating) {
        const calibrated = this.wheelHandler.handleClick({ x, y }, this.sessionData?.athlete?.riding_style || 'road');
        this.wheelPoints = [...this.wheelHandler.points];
        if (calibrated || !this.wheelHandler.isCalibrating) {
          this.wheelCalibrating = false;
        }
        return;
      }
      this.wheelHandler.handleClick({ x, y }, this.sessionData?.athlete?.riding_style || 'road');
    },
    handleCanvasMouseMove(e) {
      if (!this.isManualCalibrating) return;
      const r = this.$refs.canvas?.getBoundingClientRect();
      if (r) this.hoverCrosshair = { x: ((e.clientX - r.left) / r.width) * this.$refs.canvas.width, y: ((e.clientY - r.top) / r.height) * this.$refs.canvas.height };
    },
    handleCanvasMouseLeave() {
      this.hoverCrosshair = null;
    },
    startManualCalibrationFor(joint) {
      this.manualCalibratingJoint = joint;
      this.isManualCalibrating = true;
      this.showMarkerMenu = false;
      this.showToast(`📍 Clique no canvas para posicionar: ${joint.toUpperCase()}`);
    },
    cancelManualCalibration() {
      this.isManualCalibrating = false;
    },
    clearAllManualMarkers() {
      this.manualTracker.clearCalibration();
      this.hasManualMarkers = false;
      this.showToast('Marcadores manuais removidos.');
    },
    toggleManualCalibrationMenu() {
      this.showMarkerMenu = !this.showMarkerMenu;
    },
    onSmoothingChange() {
      this.smoother.setSmoothingLevel(this.smoothingLevel);
      this.showToast(`Estabilização: ${this.smoothingLevel.toUpperCase()}`);
    },
    onFocusChange() {
      this.showToast(`Foco: ${this.focusTarget.toUpperCase()}`);
    },
    toggleAudio() {
      audioService.toggleAudio(this.audioEnabled);
    },
    toggleVoice() {
      audioService.toggleVoice(this.voiceEnabled);
    },
    toggleFacingMode() {
      this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
      this.restartCamera();
    },
    /**
     * Comuta o perfil ativo (lado da transmissão ⇄ lado sem corrente).
     *
     * Garante que TUDO acompanha a escolha: ângulos, KOPS, linha de prumo (linha ténue)
     * e as miniaturas da galeria são recalculados e repintados para o lado novo.
     */
    setProfileSide(side) {
      if (this.currentSide === side) return;
      this.currentSide = side;
      if (this.selectedVisionEngine !== 'mediapipe_wasm' && this.backendInferenceStore) {
        this.backendInferenceStore.setSide(side);
      }
      // A órbita é DO PÉ filmado: mudar de lado (outro tornozelo) começa um rasto novo.
      this.footOrbitTrace.reset();
      this.footOrbitSummary = null;
      this._lastFootOrbitPointAt = 0;
      this.showToast(
        side === 'right'
          ? 'Perfil Direito (Lado da Transmissão) ativado'
          : 'Perfil Esquerdo (Lado sem corrente) ativado'
      );

      // 1. Recalcular as métricas de TODAS as fotos analisadas com o novo lado.
      this.imageAnalysisMgr.items.forEach((item) => {
        if (item.status === 'done' && item.landmarks) this.recomputeImageItemForSide(item);
      });

      if (!this.ctx || !this.$refs.canvas) return;

      if (this.videoSourceMode === 'images') {
        // 2. Regenerar as miniaturas e repintar a foto ativa.
        this.refreshAllImageThumbnails();
        const active = this.imageAnalysisMgr.getActiveImage();
        if (active) this.drawActiveImageToCanvas(active);
        return;
      }

      // Modo câmara/vídeo: recalcular os ângulos do fotograma atual.
      if (this.lastSmoothedLandmarks) {
        const computed = BiomechanicsComputer.computeFrameAngles({
          lm: this.lastSmoothedLandmarks,
          side: this.currentSide,
          manualTracker: this.manualTracker,
        });
        this.liveAngles = {
          joelho: computed.joelho,
          costas: computed.costas,
          braco: computed.braco,
          tornozelo: computed.tornozelo,
          cabeca: computed.cabeca,
          anca: computed.anca,
        };
        this.isFullBodyVisible = computed.isFullBodyVisible;
        this.missingBodyParts = computed.missingSegments;
        if (computed.points.kneePt && computed.points.anklePt) {
          this.kopsResult = this.kopsAnalyzer.analyze(
            computed.points.kneePt,
            computed.points.anklePt,
            this.$refs.canvas.width,
            this.$refs.canvas.height,
            computed.points.hipPt
          );
        }
        this.renderOverlayGraphics(this.ctx, this.$refs.canvas.width, this.$refs.canvas.height);
      }
    },
    toggleControlsBar() {
      this.isControlsBarCollapsed = !this.isControlsBarCollapsed;
      try {
        localStorage.setItem('athleteMotion_controls_collapsed', String(this.isControlsBarCollapsed));
      } catch {
        // Ignora se localStorage indisponível
      }
    },
    setHudPosition(pos) {
      this.hudPosition = pos;
      try {
        localStorage.setItem('athleteMotion_hud_position', pos);
      } catch {
        // Ignora se localStorage indisponível
      }
      const labels = {
        top: 'HUD posicionado no topo (fora do vídeo)',
        bottom: 'HUD posicionado na base (fora do vídeo)',
        overlay: 'HUD sobreposto ao vídeo',
        hidden: 'HUD oculto (reexiba nas Ferramentas)',
      };
      this.showToast(labels[pos] || 'Posição do HUD atualizada');
    },
    cycleHudPosition() {
      const order = ['top', 'bottom', 'overlay', 'hidden'];
      const nextIdx = (order.indexOf(this.hudPosition) + 1) % order.length;
      this.setHudPosition(order[nextIdx]);
    },
    toggleHudVisibility() {
      if (this.hudPosition === 'hidden') {
        const prev = localStorage.getItem('athleteMotion_hud_prev') || 'top';
        this.setHudPosition(prev === 'hidden' ? 'top' : prev);
      } else {
        localStorage.setItem('athleteMotion_hud_prev', this.hudPosition);
        this.setHudPosition('hidden');
      }
    },
    setViewPlane(plane) {
      this.viewPlane = plane;
      this.showToast(plane === 'frontal' ? 'Modo Frontal (Valgo/Varo)' : 'Modo Sagital');
    },
    startBilateralTest() {
      this.bilateralTesting = true;
      this.bilateralWiz.start();
    },
    resumeBilateralRightStep() {
      this.bilateralWiz.finishLeftStep({ ...this.liveAngles });
      this.bilateralWiz.resumeRight();
    },
    triggerClipRecording() {
      this.scrubberCtrl.triggerRecording();
    },
    seekToFrame(i) {
      this.scrubberCtrl.seekToFrame(i);
    },
    stepFrame(dir) {
      this.scrubberCtrl.stepFrame(dir);
    },
    toggleSlowMoPlayback() {
      this.scrubberCtrl.toggleSlowMo();
    },
    closeSlowMoScrubber() {
      this.scrubberCtrl.close();
    },
    async connectBleSensors() {
      try {
        await bleManager.connect((data) => (this.bleData = { ...data, connected: true }));
        this.showToast(`Sensor BLE conectado: ${this.bleData.deviceName}`);
      } catch (err) {
        this.showToast(err.message);
      }
    },
    connectBluetoothSensor() {
      return this.connectBleSensors();
    },
    startWheelCalibration() {
      this.wheelCalibrating = true;
      this.wheelPoints = [];
      this.wheelHandler.start();
    },
    cancelWheelCalibration() {
      this.wheelCalibrating = false;
      this.wheelPoints = [];
      this.wheelHandler.cancel();
    },
    copyDiagnosticLogs() {
      this.debugLogMgr.copyLogsToClipboard().then(() => this.showToast('Logs copiados!')).catch(() => this.showToast('Erro ao copiar'));
    },
    copyDebugLogs() {
      return this.copyDiagnosticLogs();
    },
    clearDebugLogs() {
      this.debugLogMgr.clearLogs();
      this.debugLogs = [];
      this.showToast('Logs de diagnóstico limpos.');
    },
    toggleDebugModal() {
      this.showDebugModal = !this.showDebugModal;
    },
    toggleAnalysis() {
      this.isAnalyzing = !this.isAnalyzing;
      this.showToast(this.isAnalyzing ? 'Análise em direto retomada.' : 'Análise em direto pausada.');
    },
    getComplianceClass(angle, targetRange) {
      if (angle === null || angle === undefined || !targetRange || targetRange.length < 2) return '';
      const [minVal, maxVal] = targetRange;
      if (angle >= minVal && angle <= maxVal) {
        return 'metric-compliant';
      }
      const tolerance = 8;
      const diff = angle < minVal ? minVal - angle : angle - maxVal;
      if (diff <= tolerance) {
        return 'metric-warning';
      }
      return 'metric-danger';
    },
    captureSnapshot() {
      if (!this.liveAngles.joelho) return;
      const snap = {
        frame_index: this.recordedSnapshotsCount++,
        knee_angle: this.lastBdcKneeAngle || this.liveAngles.joelho,
        back_angle: this.liveAngles.costas,
        arm_angle: this.liveAngles.braco,
        ankle_angle: this.liveAngles.tornozelo,
        head_angle: this.liveAngles.cabeca,
      };
      this.snapshotsBuffer.push(snap);
      if (this.sessionData?.session?.id && this.sessionData.session.id !== 'local-session') {
        apiService.recordSnapshot(this.sessionData.session.id, snap).catch(() => {});
      }
      this.showToast(`Snapshot guardado (#${this.recordedSnapshotsCount})`);
    },
    setVideoSourceMode(mode) {
      if (this.videoSourceMode === mode) return;
      this.videoSourceMode = mode;
      // Modo fluído contínuo a 60 FPS: o vídeo nunca é estrangulado pela taxa de processamento da IA
      this.poseRunner.setFrameAlignment(false);
      this.timelineClickStart = null;
      this.timelineHoverTime = null;
      if (mode === 'images') {
        this.deviceMgr.stopStream();
        this.poseRunner.stopLoop();
        this.videoUploadMgr.pause();
        this.cameraLoading = false;
        this.cameraError = '';
        const video = this.$refs.video;
        if (video) {
          video.pause();
          video.srcObject = null;
          video.removeAttribute('src');
          video.load();
        }
        if (this.ctx && this.$refs.canvas) {
          this.ctx.clearRect(0, 0, this.$refs.canvas.width, this.$refs.canvas.height);
        }
        const active = this.imageAnalysisMgr.getActiveImage();
        if (active) {
          this.drawActiveImageToCanvas(active);
        } else {
          this.$nextTick(() => this.triggerImageFilesInput());
        }
        this.showToast('Modo de fotos das posições da pedalada ativado.');
      } else if (mode === 'file') {
        this.deviceMgr.stopStream();
        this.poseRunner.stopLoop();
        this.cameraLoading = false;
        this.cameraError = '';
        this.hasDetectedPose = false;

        const video = this.$refs.video;
        if (video) {
          video.pause();
          video.srcObject = null;
          if (this.uploadedVideoFile) {
            this.videoUploadMgr.loadVideoFile(this.uploadedVideoFile);
            this.poseRunner.startLoop(video, this.$refs.canvas, this.ctx, () => this._shouldAnalyzeLive());
          } else {
            video.removeAttribute('src');
            video.load();
          }
        }
        if (this.ctx && this.$refs.canvas) {
          this.ctx.clearRect(0, 0, this.$refs.canvas.width, this.$refs.canvas.height);
        }

        if (!this.uploadedVideoFile) {
          this.$nextTick(() => this.triggerVideoFileInput());
        }
        this.showToast('Modo de leitura de vídeo ativado.');
      } else {
        this.videoUploadMgr.pause();
        const video = this.$refs.video;
        if (video) {
          video.removeAttribute('src');
          video.load();
        }
        if (this.ctx && this.$refs.canvas) {
          this.ctx.clearRect(0, 0, this.$refs.canvas.width, this.$refs.canvas.height);
        }
        this.startPipeline();
      }
    },
    triggerImageFilesInput() {
      if (this.$refs.imageFileInput) {
        this.$refs.imageFileInput.value = '';
        this.$refs.imageFileInput.click();
      }
    },
    async handleImageFilesUpload(event) {
      const files = event.target.files;
      if (!files || !files.length) return;
      if (this.videoSourceMode !== 'images') {
        this.setVideoSourceMode('images');
      }
      const added = await this.imageAnalysisMgr.addFiles(files);
      if (added.length > 0) {
        this.showToast(`${added.length} foto(s) carregada(s). A iniciar análise...`);
        const active = this.imageAnalysisMgr.getActiveImage();
        if (active) {
          this.drawActiveImageToCanvas(active);
          // Analisa automaticamente a foto ativa de imediato para feedback instantâneo
          await this.analyzeImageItem(active.id);
        }
        this.imageRevision++;
      }
    },
    /** Texto do progresso de estabilização de uma foto (ou string vazia). */
    imageStabilizationLabel() {
      const state = this.imageStabilization;
      if (!state) return '';
      const pass = Math.max(1, state.pass || 1);
      if (state.phase === 'settled') return `🔁 ${state.name}: leitura estabilizada (${pass} passagens).`;
      return `🔁 A estabilizar ${state.name}: passagem ${pass}/${state.maxPasses} — a média ainda se move.`;
    },
    /** Nota por foto analisada: quantas passagens e quanto se afastaram do ponto médio. */
    imageStabilizationNote(item) {
      const state = item?.stabilization;
      if (!state) return '';
      const spread = state.spreadPercent === null || state.spreadPercent === undefined ? null : state.spreadPercent;
      const basis = `ponto médio de ${state.passes} passagem(ns)${state.converged ? '' : ' (não convergiu — leitura menos estável)'}`;
      return spread === null ? basis : `${basis} · desvio ≤ ${spread}%`;
    },

    /**
     * Dimensões nativas da imagem de uma foto (independentes do canvas em uso).
     * Usar sempre as dimensões da própria foto mantém o KOPS consistente.
     */
    getImageSize(item) {
      const img = item?.imageElement;
      return {
        w: img?.naturalWidth || img?.width || this.$refs.canvas?.width || 800,
        h: img?.naturalHeight || img?.height || this.$refs.canvas?.height || 600,
      };
    },

    /**
     * Recalcula ângulos, KOPS (linha de prumo) e relatório de UMA foto
     * com o lado de perfil atualmente selecionado. Não desenha nada.
     */
    recomputeImageItemForSide(item) {
      if (!item || !item.landmarks) return null;
      const computed = BiomechanicsComputer.computeFrameAngles({
        lm: item.landmarks,
        side: this.currentSide,
        manualTracker: null, // Modo foto puro: sem deslocamento residual ótico de vídeo
      });

      item.angles = {
        joelho: computed.joelho,
        costas: computed.costas,
        braco: computed.braco,
        tornozelo: computed.tornozelo,
        cabeca: computed.cabeca,
        anca: computed.anca,
      };
      item.isFullBodyVisible = computed.isFullBodyVisible;
      item.missingSegments = computed.missingSegments;

      if (computed.points.kneePt && computed.points.anklePt) {
        const { w, h } = this.getImageSize(item);
        item.kopsResult = this.kopsAnalyzer.analyze(
          computed.points.kneePt,
          computed.points.anklePt,
          w,
          h,
          computed.points.hipPt
        );
      }

      item.report = LiveTuningReportManager.generateReport({
        bdcKneeAngle: item.crankPosition === 'bdc' ? item.angles.joelho : null,
        liveAngles: item.angles,
        kopsResult: item.kopsResult,
        targets: this.targets,
        isFullBody: item.isFullBodyVisible,
        rpm: 0,
        psi: 90,
        crankPosition: item.crankPosition,
      });

      const { w, h } = this.getImageSize(item);
      item.medianJointPositions = extractMedianJointPositions(
        item.landmarks,
        this.currentSide,
        w,
        h
      );

      return computed;
    },

    /**
     * Desenha a foto + sobreposição (esqueleto, ângulos e linha de prumo) no canvas principal,
     * usando o lado de perfil ativo. Devolve a miniatura resultante sem alterar o estado final.
     */
    renderAnalyzedImageToCanvas(item) {
      const canvas = this.$refs.canvas;
      const ctx = this.ctx;
      if (!item || !item.imageElement || !canvas || !ctx) return null;

      const img = item.imageElement;
      canvas.width = img.naturalWidth || img.width || 800;
      canvas.height = img.naturalHeight || img.height || 600;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      if (item.status !== 'done' || !item.landmarks) return null;

      // Guardar e substituir temporariamente o estado reativo para desenhar ESTA foto.
      const previous = {
        landmarks: this.lastSmoothedLandmarks,
        angles: this.liveAngles,
        kops: this.kopsResult,
        fullBody: this.isFullBodyVisible,
        missing: this.missingBodyParts,
        detected: this.hasDetectedPose,
      };

      let thumbnail = null;
      try {
        this.lastSmoothedLandmarks = item.landmarks;
        this.liveAngles = { ...item.angles };
        this.kopsResult = item.kopsResult;
        this.isFullBodyVisible = item.isFullBodyVisible;
        this.missingBodyParts = item.missingSegments || [];
        this.hasDetectedPose = true;
        this.renderOverlayGraphics(ctx, canvas.width, canvas.height);
        thumbnail = canvas.toDataURL('image/jpeg', 0.85);
      } catch (err) {
        thumbnail = item.dataUrl;
      } finally {
        this.lastSmoothedLandmarks = previous.landmarks;
        this.liveAngles = previous.angles;
        this.kopsResult = previous.kops;
        this.isFullBodyVisible = previous.fullBody;
        this.missingBodyParts = previous.missing;
        this.hasDetectedPose = previous.detected;
      }
      return thumbnail;
    },

    /**
     * Regenera a miniatura de todas as fotos analisadas para o lado ativo.
     * É isto que faz a "linha ténue" das miniaturas acompanhar a escolha do utilizador.
     */
    refreshAllImageThumbnails() {
      this.imageAnalysisMgr.items.forEach((item) => {
        if (item.status !== 'done' || !item.landmarks) return;
        const thumbnail = this.renderAnalyzedImageToCanvas(item);
        if (thumbnail) item.analyzedCanvasDataUrl = thumbnail;
      });
      // Obriga a galeria a voltar a ler as miniaturas (gestor não reativo).
      this.imageRevision++;
    },

    drawActiveImageToCanvas(item) {
      if (!item || !item.imageElement || !this.$refs.canvas) return;
      this.poseRunner.stopLoop();
      const canvas = this.$refs.canvas;
      if (!this.ctx && canvas) {
        this.ctx = markRaw(canvas.getContext('2d'));
      }
      if (!this.ctx) return;
      const img = item.imageElement;
      canvas.width = img.naturalWidth || img.width || 800;
      canvas.height = img.naturalHeight || img.height || 600;
      this.ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      if (item.status === 'done' && item.landmarks) {
        this.lastSmoothedLandmarks = item.landmarks;
        this.liveAngles = { ...item.angles };
        this.isFullBodyVisible = item.isFullBodyVisible;
        this.missingBodyParts = item.missingSegments || [];
        this.kopsResult = item.kopsResult;
        this.hasDetectedPose = true;
        this.renderOverlayGraphics(this.ctx, canvas.width, canvas.height);
      }
    },
    selectImageItem(id) {
      this.imageAnalysisMgr.setActiveImage(id);
      const item = this.imageAnalysisMgr.getActiveImage();
      if (item) {
        this.drawActiveImageToCanvas(item);
      }
      this.imageRevision++;
    },
    setImageItemPosition(id, position) {
      this.imageAnalysisMgr.setCrankPosition(id, position);
      const item = this.imageAnalysisMgr.items.find((it) => it.id === id);
      if (item && item.status === 'done') {
        // A posição altera o significado do joelho e a métrica autoritativa:
        // recalculamos tudo para manter a coerência (ex.: KOPS só às 3h).
        this.recomputeImageItemForSide(item);
        if (item.id === this.activeImage?.id) this.drawActiveImageToCanvas(item);
      }
      this.imageRevision++;
    },
    removeImageItem(id) {
      this.imageAnalysisMgr.removeImage(id);
      const active = this.imageAnalysisMgr.getActiveImage();
      if (active) {
        this.drawActiveImageToCanvas(active);
      } else if (this.ctx && this.$refs.canvas) {
        this.ctx.clearRect(0, 0, this.$refs.canvas.width, this.$refs.canvas.height);
      }
      this.imageRevision++;
    },
    clearAllImageItems() {
      this.imageAnalysisMgr.clearAll();
      if (this.ctx && this.$refs.canvas) {
        this.ctx.clearRect(0, 0, this.$refs.canvas.width, this.$refs.canvas.height);
      }
      this.imageRevision++;
    },
    async analyzeImageItem(id) {
      const item = this.imageAnalysisMgr.items.find((it) => it.id === id);
      if (!item || !item.imageElement) return;

      this.imageAnalysisMgr.setActiveImage(id);
      item.status = 'analyzing';
      this.isAnalyzingSingleImage = true;

      const canvas = this.$refs.canvas;
      const ctx = this.ctx;
      if (!canvas || !ctx) {
        item.status = 'error';
        this.isAnalyzingSingleImage = false;
        return;
      }

      canvas.width = item.imageElement.naturalWidth || item.imageElement.width || 800;
      canvas.height = item.imageElement.naturalHeight || item.imageElement.height || 600;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(item.imageElement, 0, 0, canvas.width, canvas.height);

      try {
        // -------------------------------------------------------------------------------
        // CONVERGÊNCIA ANTES DO DESENHO
        // A mesma foto é inferida várias vezes e o resultado é o PONTO MÉDIO (mediana por marco).
        // Era isto que faltava: uma única passagem dava um esqueleto (e ângulos) diferente de cada
        // vez que se carregava em "re-analisar", porque o modelo não é determinístico na mesma imagem.
        // Cada passagem parte da FOTO limpa — nunca do canvas com o traço anterior por cima.
        // -------------------------------------------------------------------------------
        this.imageStabilization = { name: item.name, pass: 0, maxPasses: CONVERGENCE_DEFAULTS.maxPasses, phase: 'sampling' };

        const convergence = await convergeStaticPose({
          capture: async () => {
            const pass = this.imageStabilization?.pass || 1;
            this.poseRunner.staticPassIndex = pass;
            const results = await this.poseRunner.processStaticImage(item.imageElement);
            return results && results.poseLandmarks && results.poseLandmarks.length >= 33
              ? results.poseLandmarks
              : null;
          },
          onProgress: ({ pass, maxPasses, phase }) => {
            this.imageStabilization = { name: item.name, pass, maxPasses, phase };
          },
        });

        if (convergence.landmarks) {
          item.landmarks = convergence.landmarks;
          item.allSamples = convergence.allSamples || [];
          item.medianJointPositions = extractMedianJointPositions(
            convergence.landmarks,
            this.currentSide,
            canvas.width,
            canvas.height
          );
          item.stabilization = {
            passes: convergence.passes,
            converged: convergence.converged,
            samples: convergence.samples,
            rejected: convergence.rejected,
            shiftPercent: convergence.shiftPercent,
            spreadPercent: convergence.spreadPercent,
          };
          this.lastSmoothedLandmarks = convergence.landmarks;

          // Cálculo único e partilhado: ângulos, KOPS e relatório coerentes com o lado ativo.
          const computed = this.recomputeImageItemForSide(item);

          this.liveAngles = { ...item.angles };
          this.isFullBodyVisible = item.isFullBodyVisible;
          this.missingBodyParts = item.missingSegments;
          this.kopsResult = item.kopsResult;
          this.hasDetectedPose = true;

          if (item.crankPosition === 'bdc' && computed.joelho) {
            this.lastBdcKneeAngle = Math.round(computed.joelho);
          }

          // Só AGORA se desenha o traço corporal — uma vez, a partir do ponto médio estável.
          this.renderOverlayGraphics(ctx, canvas.width, canvas.height);

          try {
            item.analyzedCanvasDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          } catch {
            item.analyzedCanvasDataUrl = item.dataUrl;
          }

          item.status = 'done';
          const spread = convergence.spreadPercent;
          const confidence = convergence.converged
            ? `leitura estabilizada em ${convergence.passes} passagens${spread === null ? '' : ` (desvio ≤ ${spread}%)`}`
            : `ponto médio de ${convergence.samples} passagens (não convergiu — confirme o enquadramento)`;
          this.showToast(`Foto '${item.name}': ${confidence}.`, 4000);
        } else {
          item.status = 'error';
          item.errorMessage = 'Pose não detetada. Verifique o enquadramento do ciclista.';
          this.showToast(`Aviso: Nenhuma pose detetada em '${item.name}'`);
        }
      } catch (err) {
        item.status = 'error';
        item.errorMessage = err?.message || 'Erro durante inferência';
        this.showToast(`Erro ao analisar foto: ${item.errorMessage}`);
      } finally {
        this.isAnalyzingSingleImage = false;
        this.imageStabilization = null;
        this.imageRevision++;
      }
    },
    async analyzeAllImages() {
      if (this.imageAnalysisMgr.isBatchAnalyzing) return;
      this.imageAnalysisMgr.isBatchAnalyzing = true;
      const items = [...this.imageAnalysisMgr.items];
      let doneCount = 0;

      for (const item of items) {
        await this.analyzeImageItem(item.id);
        doneCount++;
        await new Promise((r) => setTimeout(r, 80));
      }

      this.imageAnalysisMgr.isBatchAnalyzing = false;
      this.showToast(`Análise em lote concluída (${doneCount} fotos processadas).`);
    },
    toggleMultiPositionModal() {
      this.showMultiPositionModal = !this.showMultiPositionModal;
    },
    copyMultiPositionReport() {
      const athleteName = this.sessionData?.athlete?.name || 'Ciclista';
      const bikeModel = this.sessionData?.bike?.model || 'Bicicleta';
      // O relatório por posição leva também o resumo técnico (dados que contam + otimização por
      // posição do pé): copiar só as medições deixaria de fora a prova de que cada dado foi usado.
      const summary = this.coherentPrescription?.technicalSummaryText || '';
      const txt = `${this.imageAnalysisMgr.formatMultiPositionReport(athleteName, bikeModel)}\n${summary}`;
      navigator.clipboard.writeText(txt).then(() => {
        this.showToast('Relatório multi-posição copiado para a área de transferência!');
      }).catch(() => {
        this.showToast('Erro ao copiar texto.');
      });
    },
    copyActivePhotoReport() {
      if (!this.activeImageReport) return;
      const athleteName = this.sessionData?.athlete?.name || 'Ciclista';
      const bikeModel = this.sessionData?.bike?.model || 'Bicicleta';
      const txt = LiveTuningReportManager.formatTextSummary(
        this.activeImageReport,
        athleteName,
        `${bikeModel} (${this.activeImage?.name || 'Foto'})`
      );
      navigator.clipboard.writeText(txt).then(() => {
        this.showToast('📋 Diagnóstico da foto atual copiado para a área de transferência!');
      }).catch(() => {
        this.showToast('Erro ao copiar texto.');
      });
    },
    copyConsolidatedPhotoReport() {
      const athleteName = this.sessionData?.athlete?.name || 'Ciclista';
      const bikeModel = this.sessionData?.bike?.model || 'Bicicleta';
      const txt = CoherentRecommendationEngine.formatText(this.coherentPrescription, athleteName, bikeModel);
      navigator.clipboard.writeText(txt).then(() => {
        this.showToast('📋 Prescrição coerente copiada para a área de transferência!');
      }).catch(() => {
        this.showToast('Erro ao copiar texto.');
      });
    },
    printPhotoReport() {
      window.print();
    },
    triggerVideoFileInput() {
      if (this.$refs.videoFileInput) {
        this.$refs.videoFileInput.value = '';
        this.$refs.videoFileInput.click();
      }
    },
    handleVideoFileUpload(event) {
      const file = event.target.files?.[0];
      if (!file) return;

      this.deviceMgr.stopStream();
      this.poseRunner.stopLoop();

      const loaded = this.videoUploadMgr.loadVideoFile(file);
      if (loaded) {
        this.uploadedVideoFile = file;
        this.uploadedVideoName = file.name;
        this.uploadedVideoSizeMb = Math.round((file.size / (1024 * 1024)) * 10) / 10;
        this.videoSamplesHistory = [];
        this.chartSampleSource = null;
        this.footOrbitTrace.reset();
        this.footOrbitSummary = null;
        this._lastFootOrbitPointAt = 0;
        this.videoCapturedFrames = [];
        this.bdcAnglesHistory = [];
        this.hasDetectedPose = false;

        // Vídeo novo: sentido normal, loop total ligado e intervalo A-B limpo.
        this.isInfiniteLoopActive = true;
        this.playbackDirection = 'forward';
        this.isReversePlaying = false;
        this.loopRange = { start: 0, end: 0, enabled: false };
        this.isRangeScrubbing = false;

        const video = this.$refs.video;
        if (video) {
          video.srcObject = null;
          // O canvas continua a desenhar cada fotograma, mas a INFERÊNCIA durante o
          // varrimento é controlada por ele, uma amostra de cada vez.
          const startLoop = () => {
            this.poseRunner.startLoop(video, this.$refs.canvas, this.ctx, () => this._shouldAnalyzeLive());
          };
          if (video.readyState >= 2) {
            startLoop();
          } else {
            video.oncanplay = () => {
              video.oncanplay = null;
              startLoop();
            };
          }
        }
        this.showToast(`Vídeo carregado: ${file.name} — a seguir, análise integral.`);
      }
    },
    /**
     * O varrimento integral é dono do vídeo (posiciona-o amostra a amostra): avisa em vez de
     * aceitar uma ordem de transporte que os dois emissores de seeks iriam anular um ao outro.
     * @returns {boolean} `true` quando a ordem foi recusada por estar bloqueado.
     */
    warnIfTransportLocked() {
      if (!this.videoUploadMgr.isTransportLocked()) return false;
      this.showToast(
        '⏳ A análise integral está a percorrer o vídeo: os controlos de reprodução ficam livres no fim (ou cancele a análise no painel «Análise Integral do Vídeo»).',
        4500
      );
      return true;
    },
    toggleVideoPlay() {
      if (this.warnIfTransportLocked()) return;
      this.videoUploadMgr.togglePlay();
      this.syncLoopStateFromManager();
    },
    toggleVideoPlayback() {
      this.toggleVideoPlay();
    },
    stepVideoFrame(frames = 1) {
      if (this.warnIfTransportLocked()) return;
      const step = (this.videoUploadMgr?.sourceFrameDuration || (1 / 30)) * frames;
      this.videoUploadMgr.seekRelative(step);
    },
    togglePlaybackDirection() {
      this.setPlaybackDirection(this.playbackDirection === 'forward' ? 'reverse' : 'forward');
    },
    /**
     * Escolhe o sentido de reprodução.
     *
     * A ordem é registada mesmo com o transporte bloqueado (análise integral a correr): durante o
     * varrimento não se emitem seeks — competiriam com ele e deixavam a imagem parada — mas
     * recusar e ESQUECER a ordem era o que fazia o utilizador concluir que "o reverso não anda".
     */
    setPlaybackDirection(direction) {
      // Com o vídeo parado, escolher um sentido é um comando de transporte: o clique começa logo
      // a andar NESSE sentido (antes só mudava a etiqueta e nada se movia).
      this.videoUploadMgr.selectDirection(direction);
      this.syncLoopStateFromManager();
      if (this.videoUploadMgr.isTransportLocked()) {
        this.showToast(
          direction === 'reverse'
            ? '◀ Sentido escolhido (recuar): arranca assim que a análise integral soltar o vídeo.'
            : '▶ Sentido escolhido (avançar): arranca assim que a análise integral soltar o vídeo.',
          4500
        );
        return;
      }
      this.showToast(
        direction === 'reverse'
          ? '◀ A rebobinar (de trás para a frente), tipo cassete'
          : '▶ A avançar (de frente para trás)'
      );
    },
    playReverseVideo() {
      const locked = this.videoUploadMgr.isTransportLocked();
      this.videoUploadMgr.playReverse();
      this.syncLoopStateFromManager();
      this.showToast(
        locked
          ? '◀ Reverso pedido: arranca assim que a análise integral soltar o vídeo.'
          : '◀ A rebobinar o vídeo (marcha-atrás contínua)',
        locked ? 4500 : 0
      );
    },
    seekVideo(seconds) {
      if (this.warnIfTransportLocked()) return;
      this.videoUploadMgr.seekTo(seconds);
    },
    seekRelativeVideo(seconds) {
      if (this.warnIfTransportLocked()) return;
      this.videoUploadMgr.seekRelative(seconds);
    },
    setVideoSpeed(rate) {
      const value = Number(rate) > 0 ? Number(rate) : 1.0;
      // A velocidade escolhida aqui é a velocidade DE BASE: fica guardada mesmo
      // quando a câmara lenta automática está a mandar, e é reposta quando largar.
      this.videoUploadMgr.setUserPlaybackRate(value);
      if (!this.videoUploadMgr.isSlowedDownByMotion) this.videoPlaybackRate = value;
      this.showToast(
        this.videoUploadMgr.isSlowedDownByMotion
          ? `Velocidade de base: ${value}x (entra em vigor quando a câmara lenta automática largar)`
          : `Velocidade: ${value}x`
      );
    },
    toggleAutoSlowdown() {
      this.autoSlowdownEnabled = !this.autoSlowdownEnabled;
      this.videoUploadMgr.setAutoSlowdown(this.autoSlowdownEnabled, this.autoSlowdownSpeed);
      if (!this.autoSlowdownEnabled) {
        this.videoUploadMgr.releaseMotionSlowdown();
      } else {
        this.motionDetector.reset();
      }
      this.showToast(
        this.autoSlowdownEnabled
          ? '🎯 Auto-Slowdown Rigoroso ativado (câmara lenta automática no movimento)'
          : 'Auto-Slowdown desativado (velocidade contínua normal)'
      );
    },
    setAutoSlowdownSpeed(speed) {
      this.autoSlowdownSpeed = speed;
      this.videoUploadMgr.setAutoSlowdown(this.autoSlowdownEnabled, speed);
      this.showToast(`Velocidade de rigor: ${speed}x`);
    },
    renderTimelineChart() {
      if (!this.$refs.chartCanvas) return;
      const chartCanvas = this.$refs.chartCanvas;
      const chartCtx = chartCanvas.getContext('2d');
      if (chartCanvas.width !== chartCanvas.clientWidth || chartCanvas.height !== chartCanvas.clientHeight) {
        chartCanvas.width = chartCanvas.clientWidth || 600;
        chartCanvas.height = chartCanvas.clientHeight || 160;
      }
      AnglesTimelineChart.render(
        chartCtx,
        chartCanvas.width,
        chartCanvas.height,
        this.videoSamplesHistory,
        this.videoCurrentTime,
        this.videoDuration,
        this.targets,
        this.loopRange,
        { emptyLabel: this.t('anglesTimelineEmpty') }
      );
    },
    handleChartCanvasClick(event) {
      if (!this.$refs.chartCanvas || !this.videoDuration) return;
      const rect = this.$refs.chartCanvas.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const targetTime = AnglesTimelineChart.getTimeFromClick(clickX, rect.width, this.videoDuration);
      this.seekVideo(targetTime);
    },
    clearVideoChart() {
      this.videoSamplesHistory = [];
      this.chartHasSamples = false;
      this.videoCyclesCount = 0;
      this.averageBdcKneeAngle = null;
      this.torsoStabilityDegrees = null;
      this.renderTimelineChart();
      this.showToast('Gráfico limpo com sucesso.');
    },
    async exportVideoGif() {
      // Sem fotogramas guardados (ex.: análise integral sem nenhuma amostra desenhada) ainda se
      // exporta um fotograma — mas ANOTADO: imagem do vídeo com o esqueleto e os ângulos, em vez
      // do canvas visível tal como estiver. Nunca um GIF às escuras.
      if (!this.videoCapturedFrames.length) {
        const annotated = this.captureAnnotatedGifFrame();
        if (!annotated) {
          this.showToast('Nenhum fotograma de vídeo disponível para o GIF.', 4000);
          return;
        }
        this.videoCapturedFrames.push(annotated);
      }
      this.isExportingGif = true;
      this.showToast(`A compilar GIF animado com ${this.videoCapturedFrames.length} fotograma(s) anotado(s)...`);
      try {
        const compiled = await GifExportService.exportToGif(this.videoCapturedFrames, 100, `bikefit_${this.uploadedVideoName || 'video'}.gif`);
        // Sem API o serviço descarrega um fotograma anotado: dizê-lo, em vez de anunciar um GIF
        // que não foi compilado.
        if (compiled) this.showToast('GIF exportado com sucesso (com os traços do corpo)!');
        else this.showToast('API indisponível: descarregado um fotograma anotado (PNG) em vez do GIF animado.', 5000);
      } catch (err) {
        this.showToast(`Erro ao exportar GIF: ${err.message || err}`);
      } finally {
        this.isExportingGif = false;
      }
    },
    async exportVideoClip() {
      if (!this.$refs.canvas) return;
      this.isExportingClip = true;
      this.showToast('A gravar clipe do vídeo analisado...');
      try {
        const blob = await GifExportService.recordCanvasClip(this.$refs.canvas, 3500, 30);
        GifExportService.triggerDownload(blob, `bikefit_clipe_${this.uploadedVideoName || 'analise'}.webm`);
        this.showToast('Clipe descarregado com sucesso!');
      } catch (err) {
        this.showToast(`Erro ao gravar clipe: ${err.message || err}`);
      } finally {
        this.isExportingClip = false;
      }
    },
    async completeSession() {
      this.deviceMgr.stopStream();
      this.poseRunner.stopLoop();
      let rep = null;
      if (this.sessionData?.session?.id && this.sessionData.session.id !== 'local-session') {
        rep = await apiService.completeFitSession(this.sessionData.session.id).catch(() => null);
      }
      if (!rep) {
        rep = {
          session_id: this.sessionData?.session?.id || 'local-fit-session',
          athlete: this.sessionData?.athlete || { name: 'Ciclista', riding_style: 'road' },
          bike: this.sessionData?.bike || {},
          average_angles: { knee_angle: this.lastBdcKneeAngle || this.liveAngles.joelho || 148, back_angle: this.liveAngles.costas || 44, arm_angle: this.liveAngles.braco || 158, ankle_angle: this.liveAngles.tornozelo || 98 },
          target_ranges: this.targets,
          snapshots_count: this.recordedSnapshotsCount,
          kops_metric: this.kopsResult,
          frontal_valgus_metric: this.frontalResult,
          bilateral_asymmetry: this.bilateralResults,
          pedaling_smoothness: { psi_percentage: this.livePsi },
          spatial_metrics: { is_calibrated: this.spatialCalibrator.isCalibrated, saddle_drop_cm: this.saddleDropCm },
          ai_coach_verdict: { summary: `Sessão finalizada. RPM: ${this.currentRpm || 85}, PSI: ${this.livePsi}%`, adjustments: this.realtimeRecommendations },
        };
      }
      this.$emit('session-completed', rep);
    },
    toggleFlipHorizontal() {
      this.isFlippedHorizontal = !this.isFlippedHorizontal;
      this.poseRunner.setFlipped(this.isFlippedHorizontal);
      this.showToast(
        this.isFlippedHorizontal
          ? 'Modo espelho horizontal ativado (reflexão ótica da imagem)'
          : 'Orientação de imagem original ativada'
      );
    },
    /** Sincroniza o estado reativo do loop e do sentido com o gestor de vídeo. */
    syncLoopStateFromManager() {
      const mgr = this.videoUploadMgr;
      this.loopRange = { start: mgr.loopStart, end: mgr.loopEnd, enabled: mgr.loopEnabled };
      this.isInfiniteLoopActive = mgr.infiniteLoop;
      this.playbackDirection = mgr.playbackDirection;
      this.isReversePlaying = mgr.isReversePlaying;
      this.poseRunner.setReverseMode(mgr.isReversePlaying);
    },

    /** Reflete nos campos de texto A/B o intervalo que está realmente aplicado. */
    syncLoopInputsFromManager() {
      const mgr = this.videoUploadMgr;
      this.loopAInput = formatTimecode(mgr.loopStart || 0);
      this.loopBInput = formatTimecode(mgr.loopEnd > 0 ? mgr.loopEnd : this.videoDuration || 0);
    },

    /** Usa o tempo atual da reprodução como ponto A ou B. */
    setLoopFromCurrent(which) {
      const cur = this.videoCurrentTime || 0;
      if (which === 'A') {
        this.videoUploadMgr.setLoopPointA(cur);
      } else {
        this.videoUploadMgr.setLoopPointB(cur);
      }
      this.syncLoopStateFromManager();
      this.syncLoopInputsFromManager();
      this.renderTimelineChart();
      this.showToast(`⏱ Ponto ${which} fixado em ${formatTimecode(cur)}`);
    },

    /**
     * Aplica o intervalo A-B escrito por tempo (ex.: A = 20s e B = 45s).
     * Aceita segundos puros, `mm:ss` ou `h:mm:ss`.
     */
    applyLoopTimes() {
      if (!this.videoDuration) {
        this.showToast('⚠️ Carregue um vídeo antes de definir o intervalo A-B.');
        return;
      }

      const requested = clampRange(this.loopAInput, this.loopBInput, this.videoDuration);
      const applied = this.videoUploadMgr.setLoopRange(this.loopAInput, this.loopBInput);

      if (!applied || !requested.valid) {
        this.showToast('❌ Tempos inválidos: escreva, por exemplo, A = 20 e B = 45.');
        this.syncLoopInputsFromManager();
        return;
      }

      this.syncLoopStateFromManager();
      this.syncLoopInputsFromManager();
      this.renderTimelineChart();
      const span = (this.loopRange.end - this.loopRange.start).toFixed(2);
      this.showToast(`🔁 A reproduzir apenas ${formatTimecode(this.loopRange.start)} → ${formatTimecode(this.loopRange.end)} (${span}s), nos dois sentidos.`);
    },

    /** Ajuste fino de precisão de um dos pontos do intervalo. */
    nudgeLoopBoundary(which, delta) {
      if (!this.videoDuration) return;
      const current = this.hasLoopRange
        ? { start: this.loopRange.start, end: this.loopRange.end }
        : { start: 0, end: this.videoDuration };
      const nextStart = which === 'A' ? current.start + delta : current.start;
      const nextEnd = which === 'B' ? current.end + delta : current.end;
      this.videoUploadMgr.setLoopRange(nextStart, nextEnd);
      this.syncLoopStateFromManager();
      this.syncLoopInputsFromManager();
      this.renderTimelineChart();
      this.showToast(`⏱ Ponto ${which}: ${formatTimecode(which === 'A' ? this.loopRange.start : this.loopRange.end)}`);
    },

    toggleLoop() {
      this.videoUploadMgr.toggleLoop();
      this.syncLoopStateFromManager();
      this.renderTimelineChart();
      this.showToast(
        this.loopRange.enabled
          ? '🔁 Repetição contínua no intervalo A-B ativada'
          : '🔁 Intervalo A-B desativado (mantém os pontos, reproduz uma vez)'
      );
    },

    toggleInfiniteLoop() {
      const active = this.videoUploadMgr.toggleInfiniteLoop();
      this.isInfiniteLoopActive = active;
      this.showToast(
        active
          ? '♾️ Loop Total ativado (reprodução contínua sem fim, nos dois sentidos)'
          : 'Loop Total desativado (pausa ao atingir o fim)'
      );
    },

    clearLoop() {
      this.videoUploadMgr.clearLoop();
      this.loopRange = { start: 0, end: 0, enabled: false };
      this.syncLoopInputsFromManager();
      this.renderTimelineChart();
      this.showToast('Intervalo A-B limpo: a reproduzir o vídeo completo');
    },

    // =====================================================================
    // BARRA TEMPORAL: zonas (minutos) e escolha do intervalo A-B com DOIS pontos
    // =====================================================================

    /** Instante do vídeo correspondente a um gesto sobre a barra. */
    timelineTimeFromEvent(event) {
      const track =
        event?.currentTarget ||
        (event?.target?.closest && event.target.closest('.vtl-track-area')) ||
        this.$refs.videoScrubberBar?.$refs?.timelineTrack ||
        this.$refs.timelineTrack;
      if (!track || !this.videoDuration) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
      return clampTime(ratio * this.videoDuration, this.videoDuration);
    },

    /**
     * Carregar na barra e arrastar define um intervalo de tempo com DOIS pontos:
     * onde se carregou é o início (A) e onde se soltou é o fim (B). Sem arrasto, um
     * simples clique salta para esse instante (comportamento clássico, mantido).
     */
    onTimelinePointerDown(event) {
      if (!this.videoDuration) return;
      if (event.button !== undefined && event.button !== 0) return;
      const time = this.timelineTimeFromEvent(event);
      this.timelineHoverTime = time;
      this.timelineDragSession = {
        startTime: time,
        startX: event.clientX,
        movedPx: 0,
        lastSeekAt: 0,
      };
      this.isTimelineDragging = true;
      this.loopPreviewRange = null;
      this.wasPlayingBeforeTimelineDrag = this.isVideoPlaying || this.isReversePlaying;
      if (this.wasPlayingBeforeTimelineDrag) this.videoUploadMgr.pause();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (err) {
        // ignorar: alguns navegadores não permitem capturar o ponteiro
      }
      this.seekVideo(time);
      this.renderTimelineChart();
    },

    onTimelinePointerMove(event) {
      // Leitura do instante sob o ponteiro: é o que permite escolher A e B com rigor
      // (o tempo aparece por baixo do cursor antes de se carregar).
      if (this.videoDuration) this.timelineHoverTime = this.timelineTimeFromEvent(event);

      const drag = this.timelineDragSession;
      if (!drag) return;
      drag.movedPx = event.clientX - drag.startX;
      if (Math.abs(drag.movedPx) < DRAG_THRESHOLD_PX) return;

      const current = this.timelineTimeFromEvent(event);
      // Região provisória (preview) enquanto se arrasta: ainda não está aplicada.
      this.loopPreviewRange = {
        start: Math.min(drag.startTime, current),
        end: Math.max(drag.startTime, current),
      };
      // Ver o fotograma do ponto que está a ser escolhido, mas sem inundar o descodificador
      // de seeks (dois seeks sobrepostos é o que deixava a imagem parada).
      const now = performance.now();
      if (now - drag.lastSeekAt >= TIMELINE_DRAG_SEEK_INTERVAL_MS) {
        drag.lastSeekAt = now;
        this.seekVideo(current);
      }
    },

    onTimelinePointerUp(event) {
      const drag = this.timelineDragSession;
      if (!drag) return;
      this.timelineDragSession = null;
      this.isTimelineDragging = false;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch (err) {
        // ignorar
      }

      const endTime = this.timelineTimeFromEvent(event);
      const gesture = resolveTimelineDrag({
        startTime: drag.startTime,
        endTime,
        duration: this.videoDuration,
        movedPx: drag.movedPx,
        thresholdPx: DRAG_THRESHOLD_PX,
      });
      this.loopPreviewRange = null;
      const wasPlaying = this.wasPlayingBeforeTimelineDrag;
      this.wasPlayingBeforeTimelineDrag = false;

      if (gesture.mode === 'loop') {
        this.timelineClickStart = null;
        this.applyLoopFromTimeline(gesture.range);
        return;
      }

      // Sem arrasto: um CLIQUE escolhe os pontos como no VLC (A e depois B).
      if (wasPlaying) this.resumePlaybackInCurrentDirection();
      this.handleTimelineClick(drag.startTime);
    },

    onTimelinePointerCancel() {
      this.timelineDragSession = null;
      this.isTimelineDragging = false;
      this.loopPreviewRange = null;
    },

    /** Sai da barra: a leitura do ponteiro já não faz sentido. */
    onTimelinePointerLeave() {
      if (!this.timelineDragSession) this.timelineHoverTime = null;
    },

    /**
     * CLIQUE na barra ao estilo VLC: o primeiro clique fixa o ponto A e o segundo
     * fixa o B e fecha o intervalo — a partir daí a reprodução só anda lá dentro.
     * Um clique depois de fechado recomeça a escolha (novo A).
     */
    handleTimelineClick(time) {
      const step = resolveTimelineClick({
        time,
        duration: this.videoDuration,
        pendingStart: this.timelineClickStart,
      });

      if (step.mode === 'none') return;

      if (step.mode === 'pending') {
        this.timelineClickStart = step.start;
        this.seekVideo(step.seekTo);
        this.renderTimelineChart();
        this.showToast(
          `⏱ Ponto A = ${formatTimecode(step.start)}. Carregue noutro ponto da barra para fixar o fim (B) e repetir só esse intervalo.`,
          4500
        );
        return;
      }

      this.timelineClickStart = null;
      this.applyLoopFromTimeline(step.range);
    },

    /** Cancela a escolha do ponto A pendente (clique na barra já não fecha nada). */
    clearPendingLoopPoint() {
      if (this.timelineClickStart === null) return;
      this.timelineClickStart = null;
      this.renderTimelineChart();
      this.showToast('Escolha do ponto A cancelada (a barra volta a saltar para o instante carregado).');
    },

    /**
     * Aplica o intervalo escolhido na barra e começa imediatamente a repeti-lo
     * (nos dois sentidos, se o sentido inverso estiver escolhido).
     */
    applyLoopFromTimeline(range) {
      if (!range || !range.valid) return;
      // O loop fechado passa a ser a única coisa que anda: nada de ficar a meio caminho.
      this.videoUploadMgr.setLoopRange(range.start, range.end);
      this.videoUploadMgr.setInfiniteLoop(true);
      this.syncLoopStateFromManager();
      this.syncLoopInputsFromManager();
      const span = (range.end - range.start).toFixed(2);
      this.showToast(
        `🔁 Intervalo escolhido na barra: ${formatTimecode(range.start)} → ${formatTimecode(range.end)} (${span}s). A repetir já.`,
        5000
      );
      // Escolher um intervalo só faz sentido se ele começar a rodar: arranca dentro dele,
      // no sentido que está escolhido (para trás, se for o caso).
      const backwards = this.playbackDirection === 'reverse';
      this.seekVideo(backwards ? range.end : range.start);
      if (backwards) this.videoUploadMgr.playReverse();
      else this.videoUploadMgr.play();
      this.syncLoopStateFromManager();
      this.timelineHintSeen = true;
      this.renderTimelineChart();
    },

    /** Retoma a reprodução no sentido que estava escolhido. */
    resumePlaybackInCurrentDirection() {
      if (this.playbackDirection === 'reverse') this.videoUploadMgr.playReverse();
      else this.videoUploadMgr.play();
      this.syncLoopStateFromManager();
    },

    onRangeScrubStart() {
      this.isRangeScrubbing = true;
      this.videoUploadMgr.startScrubbing();
    },
    onRangeScrubInput(event) {
      const newTime = Number(event.target.value);
      this.seekVideo(newTime);
    },
    onRangeScrubEnd() {
      this.isRangeScrubbing = false;
      this.videoUploadMgr.stopScrubbing(false);
    },
    stepRangeFrame(direction) {
      this.videoUploadMgr.stepRangeFrame(direction, 30);
    },
    stepRangeSeconds(delta) {
      this.videoUploadMgr.stepRangeSeconds(delta);
    },
    // =====================================================================
    // ANÁLISE INTEGRAL DO VÍDEO: perfil → varrimento completo → prescrição única
    // =====================================================================

    /** Lê o perfil guardado localmente (peso e nº de sapato persistem entre sessões via secureStorage). */
    async loadAthleteProfileFromStorage() {
      try {
        let raw = await secureStorage.getItem(ATHLETE_PROFILE_STORAGE_KEY);
        if (!raw && typeof window !== 'undefined' && window.localStorage) {
          const legacy = window.localStorage.getItem(ATHLETE_PROFILE_STORAGE_KEY);
          if (legacy) {
            try {
              raw = JSON.parse(legacy);
              await secureStorage.setItem(ATHLETE_PROFILE_STORAGE_KEY, raw);
              window.localStorage.removeItem(ATHLETE_PROFILE_STORAGE_KEY);
            } catch {
              raw = null;
            }
          }
        }
        if (!raw) return;
        const normalized = AthleteProfile.normalize(raw);
        this.athleteProfile = {
          weightKg: normalized.weightKg ?? '',
          shoeSizeEu: normalized.shoeSizeEu ?? '',
          waistCm: normalized.waistCm ?? '',
          heightCm: normalized.heightCm ?? '',
          inseamCm: normalized.inseamCm ?? '',
          cleatPosition: normalized.cleatPosition ?? '',
        };
      } catch (err) {
        this.debugLogMgr?.addLog('warn', `Perfil do atleta não pôde ser lido: ${err?.message || err}`);
      }
    },

    openProfileModal() {
      this.prefillProfileFromSession();
      this.showProfileModal = true;
    },

    closeProfileModal() {
      this.showProfileModal = false;
      this.profilePendingAction = null;
    },

    /** Valida, guarda e — se havia uma análise à espera do perfil — arranca-a. */
    async saveAthleteProfile() {
      const normalized = AthleteProfile.normalize(this.athleteProfile);
      if (normalized.issues.length) {
        this.showToast(`⚠️ ${normalized.issues[0].message}`, 5000);
        return false;
      }
      if (!normalized.complete) {
        this.showToast(
          `⚠️ Falta indicar ${AthleteProfile.missingLabels(normalized.missingRequired).join(' e ')} para uma análise rigorosa.`,
          5000
        );
        return false;
      }

      this.athleteProfile = {
        weightKg: normalized.weightKg,
        shoeSizeEu: normalized.shoeSizeEu,
        waistCm: normalized.waistCm ?? '',
        heightCm: normalized.heightCm ?? '',
        inseamCm: normalized.inseamCm ?? '',
        cleatPosition: normalized.cleatPosition ?? '',
      };
      try {
        await secureStorage.setItem(ATHLETE_PROFILE_STORAGE_KEY, this.athleteProfile);
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(ATHLETE_PROFILE_STORAGE_KEY);
        }
      } catch (err) {
        this.debugLogMgr?.addLog('warn', 'Perfil do atleta não pôde ser guardado com segurança.');
      }

      const pending = this.profilePendingAction;
      this.showProfileModal = false;
      this.profilePendingAction = null;
      this.showToast('✅ Perfil do atleta registado no armazenamento seguro.');
      if (pending === 'video-analysis') this.startFullVideoAnalysis();
      return true;
    },

    async clearAthleteProfile() {
      this.athleteProfile = { weightKg: '', shoeSizeEu: '', waistCm: '', heightCm: '', inseamCm: '', cleatPosition: '' };
      try {
        await secureStorage.removeItem(ATHLETE_PROFILE_STORAGE_KEY);
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(ATHLETE_PROFILE_STORAGE_KEY);
        }
      } catch (err) {
        // ignorar: o perfil em memória já foi limpo
      }
      this.showToast('Perfil do atleta limpo.');
    },

    /** Reinicia o estado da análise (obrigatório a cada vídeo novo). */
    resetVideoAnalysisState() {
      this.videoScanSummary = null;
      this.videoFinalPrescription = null;
      // A curva dos ângulos e a órbita do pé pertencem AO VÍDEO: uma análise nova começa com o
      // gráfico vazio (o varrimento volta a publicar a curva completa quando terminar).
      this.videoSamplesHistory = [];
      this.chartSampleSource = null;
      this.footOrbitTrace.reset();
      this.footOrbitSummary = null;
      this._lastFootOrbitPointAt = 0;
      // Álbum do GIF: uma análise nova começa com uma sequência nova (o varrimento enche-a com
      // fotogramas anotados distribuídos pelo vídeo todo).
      this.videoCapturedFrames = [];
      this.gifPlanner.reset();
      // A janela de postura também é reiniciada: as observações antigas pertenciam a outro vídeo.
      this._postureFrames = [];
      this._postureFrameCounter = 0;
      this.showPosturePrompt = false;
      this.videoScanProgress = {
        percent: 0,
        stage: 'idle',
        scannedSeconds: 0,
        totalSeconds: this.videoDuration || 0,
        samples: 0,
        failures: 0,
        elapsedMs: 0,
      };
    },

    /** A inferência ao vivo só corre fora do varrimento (nunca duas em paralelo). */
    _shouldAnalyzeLive() {
      return !this.isFullVideoScanRunning;
    },

    /** Pede o perfil do atleta (se faltar) e arranca a análise integral do vídeo. */
    async requestFullVideoAnalysis() {
      if (this.videoSourceMode !== 'file' || !this.uploadedVideoFile) return;
      // A duração tem de estar resolvida ANTES: sem ela o varrimento não sabe onde acabar.
      await this.resolveVideoDuration();
      if (!this.athleteProfileComplete) {
        this.prefillProfileFromSession();
      }
      this.startFullVideoAnalysis();
    },

    /**
     * Duração finita do vídeo (delegada em `VideoUploadManager.resolveDuration`).
     *
     * Sem ela a análise não sabe onde acabar e a marcha-atrás não sabe onde é o fim, pelo que
     * esta resolução serve os dois caminhos.
     */
    async resolveVideoDuration() {
      // A receita vive no gestor do vídeo (é ele que conhece o elemento e é lá que a MARCHA-ATRÁS
      // também precisa dela): uma única implementação para os dois caminhos — análise e recuo.
      const duration = await this.videoUploadMgr.resolveDuration();
      if (duration > 0) this.videoDuration = duration;
      return duration;
    },

    /**
     * Reaproveita o que já foi recolhido no passo 1 (peso, sapato, cintura, altura e costura).
     *
     * `override: true` (na entrada do passo 2) faz os dados da sessão vencerem a memória do
     * dispositivo: o atleta acabou de os escrever no passo 1. Sem `override` só se preenchem
     * campos vazios — é o modo usado ao abrir o modal, para não apagar uma edição em curso.
     */
    prefillProfileFromSession({ override = false } = {}) {
      const athlete = this.sessionData?.athlete || {};
      const bike = this.sessionData?.bike || {};
      // O passo 1 envia o perfil em camelCase; a API usa snake_case. Aceitar os dois evita
      // perder o dado conforme a origem (sessão online ou modo local).
      const stepOne = this.sessionData?.athleteProfile || {};
      const firstFilled = (...values) =>
        values.find((value) => value !== null && value !== undefined && value !== '') ?? null;

      const values = {
        weightKg: firstFilled(stepOne.weightKg, stepOne.weight_kg, athlete.weight_kg),
        shoeSizeEu: firstFilled(stepOne.shoeSizeEu, stepOne.shoe_size_eu, athlete.shoe_size_eu),
        waistCm: firstFilled(stepOne.waistCm, stepOne.waist_cm, athlete.waist_cm),
        heightCm: firstFilled(stepOne.heightCm, stepOne.height_cm, athlete.height_cm, athlete.height),
        inseamCm: firstFilled(stepOne.inseamCm, stepOne.inseam_cm, athlete.inseam_cm, athlete.inseam),
        cleatPosition: firstFilled(
          stepOne.cleatPosition,
          stepOne.cleat_position,
          bike.cleat_position,
          bike.cleatPosition
        ),
      };

      Object.entries(values).forEach(([field, value]) => {
        if (value === null) return;
        if (!override && this.athleteProfile[field]) return;
        this.athleteProfile[field] = value;
      });
    },

    /**
     * Varre o vídeo INTEIRO (malha + refinação) e só no fim calcula a prescrição final.
     * Enquanto corre, não existe nenhuma recomendação em nenhum painel.
     */
    async startFullVideoAnalysis() {
      const video = this.$refs.video;
      if (!video || this.isFullVideoScanRunning) return;
      if (!this.videoDuration || this.videoDuration <= 0) {
        this.showToast('⚠️ Duração do vídeo desconhecida — análise impossível.', 4000);
        return;
      }

      // A partir daqui o vídeo pertence ao varrimento: nenhum controlo de reprodução pode
      // emitir seeks em paralelo (dois seeks sobrepostos = imagem parada).
      this.videoUploadMgr.setTransportLocked(true);
      this.resetVideoAnalysisState();
      this.isFullVideoScanRunning = true;
      this.videoScanProgress = {
        percent: 0,
        stage: 'grid',
        scannedSeconds: 0,
        totalSeconds: this.videoDuration,
        samples: 0,
        failures: 0,
        elapsedMs: 0,
      };
      this.hasDetectedPose = false;
      this.showToast('🔎 A analisar o vídeo inteiro. A prescrição só sai no fim.', 6000);
      this.debugLogMgr.addLog('info', `Varrimento integral iniciado (${this.videoDuration.toFixed(2)}s de vídeo).`);

      const scanner = new FullVideoScanRunner({
        processFrame: (time) => this._processScanFrame(time),
        onLog: (type, msg) => this.debugLogMgr.addLog(type, msg),
      });

      const pipeline = new FullVideoAnalysisPipeline({
        scanner,
        onProgress: (payload) => this.updateScanProgress(payload),
        onLog: (type, msg) => this.debugLogMgr.addLog(type, msg),
      });
      this._videoPipeline = pipeline;

      try {
        const analysis = await pipeline.run({ duration: this.videoDuration });
        this.videoScanSummary = analysis;
        this.announceDetectedPosture();
        this.videoFinalPrescription = FinalPrescriptionEngine.build({
          analysis,
          scanning: false,
          progress: this.videoScanProgress,
          profile: this.athleteProfile,
          targets: this.targets,
          posture: this.posture,
          postureDetection: this.postureDetection,
          equipment: this.equipmentContext,
          video: { name: this.uploadedVideoName, durationSeconds: this.videoDuration },
        });
        this.announceFinalAnalysis();
        if (this.videoFinalPrescription?.status === 'ready') {
          this.showTuningReportModal = true;
        }
      } catch (err) {
        this.debugLogMgr.addLog('error', `Análise integral falhou: ${err?.message || err}`);
        this.videoFinalPrescription = FinalPrescriptionEngine.build({
          analysis: { status: 'failed', reason: `Falha inesperada na análise: ${err?.message || err}` },
          profile: this.athleteProfile,
          targets: this.targets,
          posture: this.posture,
          video: { name: this.uploadedVideoName, durationSeconds: this.videoDuration },
        });
      } finally {
        // A curva dos ângulos e a órbita do pé saem da PRÓPRIA análise (o varrimento mediu
        // centenas de instantes: não se deitam fora nem se espera por uma reprodução posterior
        // para o gráfico deixar de estar vazio). Em caso de cancelamento ou falha publica-se o
        // que o vídeo realmente foi analisado — parcial, como a percentagem que fica no relatório.
        this.publishScanSamples(scanner.observations, {
          width: video.videoWidth || this.$refs.canvas?.width || 0,
          height: video.videoHeight || this.$refs.canvas?.height || 0,
        });
        this.isFullVideoScanRunning = false;
        this._videoPipeline = null;
        // Devolver o controlo ao utilizador ANTES de retomar a reprodução.
        this.videoUploadMgr.setTransportLocked(false);
        // NÃO se força 100% aqui: se o varrimento abortou a meio, a percentagem que fica no
        // relatório é a que o vídeo realmente foi analisado (o motivo é mostrado ao lado).
        // Só DEPOIS da análise o vídeo começa a rodar, para estudo visual (loop total) — e, se o
        // utilizador pediu para recuar durante a análise, é o RECUO que retoma.
        this.poseRunner.startLoop(video, this.$refs.canvas, this.ctx, () => this._shouldAnalyzeLive());
        this.videoUploadMgr.play({ automatic: true });
        this.syncLoopStateFromManager();
      }
    },

    /**
     * Depois de varrer o vídeo, decide a postura com base no vídeo inteiro.
     * Aplica sozinho quando a evidência é franca; quando é parcial, deixa a PERGUNTA aberta
     * (é o pedido explícito: "detetar e perguntar para confirmar").
     */
    announceDetectedPosture() {
      const detection = detectAeroPosture({
        frames: this._postureFrames,
        confirmedPosture: this.posture,
        isManualChoice: this.postureSource === 'manual',
      });
      this.postureDetection = detection;
      if (!detection.sufficient) return false;

      if (detection.action === 'auto' && detection.posture !== this.posture) {
        this.setPosture(detection.posture, 'auto');
        this.showToast(
          `🪂 O vídeo mostra uma posição aero (${Math.round(detection.confidence * 100)}%): alvos de aero aplicados.`,
          6000
        );
        return true;
      }
      if (detection.action === 'ask') {
        this.showPosturePrompt = true;
        this._lastPostureAskAt = Date.now();
        return true;
      }
      return false;
    },

    /** Comunica o desfecho da análise, incluindo o motivo quando não há prescrição. */
    announceFinalAnalysis() {
      const final = this.videoFinalPrescription;
      if (!final) return;
      if (final.status === 'ready') {
        const revolutions = final.phase?.completeRevolutions ?? 0;
        this.showToast(
          `✅ Análise concluída: ${revolutions} pedalada(s) em 12h/3h/6h/9h. ` +
            `Prescrição final: ${final.prescriptions.length} componente(s) a ajustar (confiança ${final.confidence.label.toLowerCase()}).`,
          9000
        );
      } else {
        this.showToast(`⚠️ Análise concluída sem prescrição: ${final.lockReason}`, 9000);
      }
    },

    cancelFullVideoAnalysis() {
      if (this._videoPipeline) this._videoPipeline.cancel();
    },

    updateScanProgress(payload = {}) {
      const previous = this.videoScanProgress;
      this.videoScanProgress = {
        percent:
          typeof payload.percent === 'number' ? Math.round(payload.percent * 10) / 10 : previous.percent,
        stage: payload.stage || previous.stage,
        scannedSeconds: typeof payload.time === 'number' ? Math.round(payload.time * 100) / 100 : previous.scannedSeconds,
        totalSeconds: this.videoDuration || 0,
        samples: payload.samples ?? previous.samples,
        failures: payload.failures ?? previous.failures,
        elapsedMs: payload.elapsedMs ?? previous.elapsedMs,
      };
    },

    /**
     * Processa UM fotograma do varrimento: coloca o vídeo no instante pedido, espera pela
     * descodificação e infere a pose — devolvendo a observação biomecânica desse instante.
     */
    async _processScanFrame(time) {
      const video = this.$refs.video;
      if (!video) return null;

      await this._seekVideoTo(time);
      if (!this.poseRunner.poseInstance) this.poseRunner.initPose();
      const results = await this.poseRunner.inferFrame(video, 4000);
      if (!results) return null;

      const observation = this._buildScanObservation(results, time, video);

      // O GIF sai também da análise integral: cada amostra do varrimento pode contribuir com um
      // fotograma anotado, distribuído pelo vídeo inteiro. É isto que garante que o GIF exportado
      // depois de analisar tem os traços do corpo em todo o vídeo, e não uma só imagem.
      if (observation) {
        this.collectGifFrame(time, {
          landmarks: results.poseLandmarks,
          angles: observation.angles,
        }, { evenSpread: true });
      }

      return observation;
    },

    /**
     * Posiciona o vídeo num instante e espera pelo evento `seeked`.
     * SEMPRE um seek de cada vez: atribuir `currentTime` cancela o seek anterior, e foi
     * exatamente esse sobrepor de seeks que deixava o vídeo "parado".
     */
    _seekVideoTo(time) {
      const video = this.$refs.video;
      return new Promise((resolve) => {
        if (!video) return resolve(false);
        const maxTime = Math.max(0, (video.duration || this.videoDuration || 0) - 0.001);
        const target = Math.max(0, Math.min(time, maxTime));
        let settled = false;
        let timer = null;

        const finish = (ok) => {
          if (settled) return;
          settled = true;
          video.removeEventListener('seeked', onSeeked);
          if (timer) clearTimeout(timer);
          resolve(ok);
        };
        const onSeeked = () => finish(true);

        video.addEventListener('seeked', onSeeked);
        timer = setTimeout(() => finish(false), 900);
        try {
          video.currentTime = target;
        } catch (err) {
          finish(false);
          return;
        }
        // Se já estava exatamente neste instante, o evento não dispara: resolver já.
        if (Math.abs((video.currentTime || 0) - target) < 0.0005) finish(true);
      });
    },

    /** Converte o resultado do MediaPipe numa observação com ângulos, pontos e KOPS. */
    _buildScanObservation(results, time, video) {
      const landmarks = results?.poseLandmarks;
      if (!landmarks || landmarks.length < 33) return null;

      const w = video.videoWidth || this.$refs.canvas?.width || 640;
      const h = video.videoHeight || this.$refs.canvas?.height || 480;
      const computed = BiomechanicsComputer.computeFrameAngles({
        lm: landmarks,
        side: this.currentSide,
        manualTracker: null,
      });
      const { anklePt, kneePt, hipPt } = computed.points || {};
      if (!anklePt || !kneePt || !hipPt) return null;

      // Cada amostra do varrimento alimenta também o detetor de postura: é assim que a análise
      // integral do vídeo consegue dizer se o atleta pedalava em aero ou em posição ereta.
      this.recordPostureFrame({ costas: computed.costas, braco: computed.braco, points: computed.points });

      const toPx = (pt) => ({ x: pt.x * w, y: pt.y * h });
      let kops = null;
      try {
        kops = this.kopsAnalyzer.analyze(kneePt, anklePt, w, h, hipPt, this.spatialCalibrator?.pixelsPerMm || null);
      } catch (err) {
        kops = null;
      }

      return {
        time,
        ankle: toPx(anklePt),
        knee: toPx(kneePt),
        hip: toPx(hipPt),
        angles: {
          joelho: computed.joelho,
          costas: computed.costas,
          braco: computed.braco,
          tornozelo: computed.tornozelo,
          cabeca: computed.cabeca,
          anca: computed.anca,
          antebraco: computed.antebraco,
        },
        kops: kops ? { offsetMm: kops.offsetMm, status: kops.status } : null,
        isFullBodyVisible: computed.isFullBodyVisible,
        missingSegments: computed.missingSegments || [],
      };
    },

    /** Copia o relatório FINAL (análise integral) para a área de transferência. */
    copyFinalVideoReport() {
      const final = this.videoFinalPrescription;
      if (!final) {
        this.showToast('Sem relatório final: a análise do vídeo ainda não terminou.');
        return;
      }
      const athleteName = this.sessionData?.athlete?.name || 'Ciclista';
      const bikeModel = this.sessionData?.bike?.model || 'Bicicleta';
      const text = FinalPrescriptionEngine.formatText(final, { athleteName, bikeModel });
      if (navigator.clipboard) {
        navigator.clipboard
          .writeText(text)
          .then(() => this.showToast('📋 Relatório final da análise integral copiado!'))
          .catch(() => this.showToast('Erro ao copiar o relatório.'));
      } else {
        this.showToast('Área de transferência indisponível.');
      }
    },

    toggleTuningReportModal() {
      this.showTuningReportModal = !this.showTuningReportModal;
    },
    copyTuningReport() {
      // Em modo vídeo só existe o relatório final (análise integral), que tem o seu próprio texto.
      if (this.videoSourceMode === 'file') {
        this.copyFinalVideoReport();
        return;
      }
      const athleteName = this.sessionData?.athlete?.name || 'Ciclista';
      const bikeModel = this.sessionData?.bike?.model || 'Bicicleta';
      const text = LiveTuningReportManager.formatTextSummary(
        this.activeTuningReport,
        athleteName,
        bikeModel
      );
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
        this.showToast('📋 Relatório copiado para a área de transferência!');
      } else {
        this.showToast('Área de transferência indisponível.');
      }
    },
    printTuningReport() {
      window.print();
    },
    /**
     * Guarda a sessão atual como linha de base (pré-ajuste) para comparação posterior.
     */
    async saveAsBaselineSession() {
      const session = {
        id: `session-baseline-${Date.now()}`,
        name: `${this.uploadedVideoName || 'Vídeo'} (Linha de Base - Pré-Ajuste)`,
        created_at: new Date().toISOString(),
        video_name: this.uploadedVideoName,
        angles: {
          knee_angle: this.lastBdcKneeAngle || this.liveAngles.joelho || 148,
          back_angle: this.liveAngles.costas || 44,
          arm_angle: this.liveAngles.braco || 158,
          ankle_angle: this.liveAngles.tornozelo || 98,
        },
        prescription: this.videoFinalPrescription,
        report: this.activeTuningReport,
      };
      try {
        await secureStorage.setItem('athleteMotion_baseline_session', session);
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem('athleteMotion_baseline_session');
        }
        this.showToast('💾 Sessão guardada como Linha de Base no armazenamento seguro!', 7000);
      } catch (err) {
        this.showToast('Erro ao guardar a linha de base no dispositivo.');
      }
    },
    /**
     * Navega para o comparador de sessões para comparar o pré-fit com o pós-fit.
     */
    openComparatorWithSession() {
      const current = {
        id: `session-current-${Date.now()}`,
        name: `${this.uploadedVideoName || 'Vídeo'} (Sessão Atual)`,
        created_at: new Date().toISOString(),
        angles: {
          knee_angle: this.lastBdcKneeAngle || this.liveAngles.joelho || 148,
          back_angle: this.liveAngles.costas || 44,
          arm_angle: this.liveAngles.braco || 158,
          ankle_angle: this.liveAngles.tornozelo || 98,
        },
        report: this.activeTuningReport,
      };
      this.$emit('session-completed', current);
      this.$emit('open-comparator', current);
      this.toggleTuningReportModal();
    },
  },
};
