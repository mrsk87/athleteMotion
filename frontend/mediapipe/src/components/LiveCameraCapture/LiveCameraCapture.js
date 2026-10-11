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
import { apiService } from '../../services/api';
import { audioService } from '../../services/audioFeedback';
import { bleManager } from '../../services/bleSensorManager';
import { LandmarkSmoother } from '../../services/landmarkSmoother';
import { ManualMarkerTracker } from '../../services/manualMarkerTracker';
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
import { GifExportService } from '../../services/gifExportService';

export default {
  name: 'LiveCameraCapture',
  props: {
    sessionData: { type: Object, default: null },
  },
  emits: ['session-completed'],
  setup() {
    const { t } = useI18n();
    return { t };
  },
  created() {
    // Gestores e hardware isolados da reatividade do Vue 3 para prevenir vazamento de memória Emscripten
    this.deviceMgr = markRaw(new CameraDeviceManager());
    this.smoother = markRaw(new LandmarkSmoother('ultra'));
    this.manualTracker = markRaw(new ManualMarkerTracker());
    this.pedalTracker = markRaw(new PedalStrokeTracker(15));
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
        onResults: (res) => this.onPoseResults(res),
        onFpsUpdate: (camFps, aiFps) => {
          this.cameraFps = camFps;
          this.aiFps = aiFps;
        },
        onRenderOverlay: (ctx, w, h) => this.renderOverlayGraphics(ctx, w, h),
        onDebugLog: (type, msg) => this.debugLogMgr.addLog(type, msg),
      })
    );

    this.videoUploadMgr = markRaw(
      new VideoUploadManager({
        onTimeUpdate: (cur, dur) => {
          this.videoCurrentTime = cur;
          this.videoDuration = dur;
          this.renderTimelineChart();
        },
        onVideoLoaded: (dur) => {
          this.videoDuration = dur;
          this.showToast(`Vídeo carregado (${dur.toFixed(1)}s).`);
          this.videoSamplesHistory = [];
          this.videoCapturedFrames = [];
          this.bdcAnglesHistory = [];
        },
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

    this.ctx = null;
    this.lastSmoothedLandmarks = null;
    this.consecutiveWarnFrames = 0;
  },
  data() {
    return {
      isAnalyzing: true,
      currentSide: 'left',
      viewPlane: 'sagittal',
      facingMode: 'environment',
      videoDevices: [],
      selectedDeviceId: '',
      audioEnabled: true,
      voiceEnabled: true,
      toastMessage: '',
      cameraError: '',
      cameraLoading: false,
      recordedSnapshotsCount: 0,
      snapshotsBuffer: [],
      showDebugModal: false,
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
      liveAngles: { joelho: null, costas: null, braco: null, tornozelo: null, cabeca: null },
      targets: { knee: [145, 155], back: [40, 50], elbow: [150, 165], shoulder: [85, 95], ankle: [95, 105], head: [35, 55] },
      isFullBodyVisible: false,
      missingBodyParts: [],
      wheelCalibrating: false,
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
      videoCapturedFrames: [],
      isExportingGif: false,
      isExportingClip: false,
      bdcAnglesHistory: [],
      isFlippedHorizontal: false,
      loopRange: { start: 0, end: 0, enabled: false },
      showTuningReportModal: false,
      imageAnalysisMgr: markRaw(new MultiImageAnalysisManager()),
      isAnalyzingSingleImage: false,
      showMultiPositionModal: false,
      isRangeScrubbing: false,
    };
  },
  computed: {
    activeTuningReport() {
      return LiveTuningReportManager.generateReport({
        bdcKneeAngle: this.lastBdcKneeAngle,
        liveAngles: this.liveAngles,
        kopsResult: this.kopsResult,
        targets: this.targets,
        isFullBody: this.isFullBodyVisible,
        rpm: this.currentRpm,
        psi: this.livePsi,
      });
    },
    nonCompliantItems() {
      if (!this.activeTuningReport || !this.activeTuningReport.items) return [];
      return this.activeTuningReport.items.filter((item) => item.status !== 'ok');
    },
    imageItems() {
      return this.imageAnalysisMgr.items;
    },
    activeImage() {
      return this.imageAnalysisMgr.getActiveImage();
    },
    multiPositionSummary() {
      return this.imageAnalysisMgr.getComparisonSummary();
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
      const knee = this.lastBdcKneeAngle || this.liveAngles.joelho;
      if (knee) {
        if (knee < minK) recs.push('Selim Baixo: Eleve o selim entre 5mm e 10mm para atingir extensão ideal.');
        else if (knee > maxK) recs.push('Selim Alto: Desça o selim entre 5mm e 8mm para prevenir hiperextensão.');
      }
      if (this.kopsResult && !this.kopsResult.isAligned) {
        recs.push(`KOPS: ${this.kopsResult.actionPt}.`);
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
    wheelCalibrating() {
      return this.wheelHandler.isCalibrating;
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
      if (!this.bdcAnglesHistory.length) return this.lastBdcKneeAngle || null;
      const sum = this.bdcAnglesHistory.reduce((acc, v) => acc + v, 0);
      return Math.round(sum / this.bdcAnglesHistory.length);
    },
    torsoStabilityDegrees() {
      const backSamples = this.videoSamplesHistory.map((s) => s.costas).filter((v) => typeof v === 'number');
      if (backSamples.length < 5) return null;
      const minB = Math.min(...backSamples);
      const maxB = Math.max(...backSamples);
      return Math.round((maxB - minB) * 10) / 10;
    },
    videoCyclesCount() {
      return this.bdcAnglesHistory.length;
    },
  },
  mounted() {
    this.configureModalityTargets();
    this.debugLogMgr.setup();
    if (this.$refs.video) {
      this.videoUploadMgr.attachVideo(this.$refs.video);
    }
    this.$nextTick(() => this.initPipeline());
  },
  beforeUnmount() {
    this.videoUploadMgr.cleanup();
    this.debugLogMgr.teardown();
    this.poseRunner.destroy();
    this.deviceMgr.stopStream();
    this.bilateralWiz.cancel();
    this.scrubberCtrl.close();
  },
  methods: {
    showToast(msg, ms = 2500) {
      this.toastMessage = msg;
      setTimeout(() => {
        if (this.toastMessage === msg) this.toastMessage = '';
      }, ms);
    },
    configureModalityTargets() {
      const style = this.sessionData?.athlete?.riding_style || 'road';
      if (style === 'mtb') this.targets = { knee: [140, 150], back: [45, 55], elbow: [145, 160], ankle: [90, 100] };
      else if (style === 'tt') this.targets = { knee: [148, 158], back: [25, 38], elbow: [85, 100], ankle: [95, 105] };
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
      if (stream) {
        this.selectedDeviceId = selectedDeviceId;
        this.activeDeviceLabel = activeLabel;
        video.srcObject = stream;
        await new Promise((r) => {
          if (video.readyState >= 1) r();
          else video.onloadedmetadata = r;
          setTimeout(r, 1200);
        });
        await video.play().catch(() => {});
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
    onPoseResults(results) {
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
      this.lastSmoothedLandmarks = this.smoother.smooth(rawLandmarks);

      const isLeft = this.currentSide === 'left';
      // Rastreio contínuo de características óticas (luz, relevo e bordas) nos fotogramas
      if ((this.$refs.video || this.$refs.canvas) && this.hasManualMarkers) {
        this.manualTracker.updateOpticalTracking(this.$refs.video || this.$refs.canvas, {
          knee: this.lastSmoothedLandmarks[isLeft ? 26 : 25],
          ankle: this.lastSmoothedLandmarks[isLeft ? 28 : 27],
          hip: this.lastSmoothedLandmarks[isLeft ? 24 : 23],
          shoulder: this.lastSmoothedLandmarks[isLeft ? 12 : 11],
          elbow: this.lastSmoothedLandmarks[isLeft ? 14 : 13],
        });
      }

      const computed = BiomechanicsComputer.computeFrameAngles({
        lm: this.lastSmoothedLandmarks,
        side: this.currentSide,
        manualTracker: this.manualTracker,
      });

      this.liveAngles.joelho = computed.joelho;
      this.liveAngles.costas = computed.costas;
      this.liveAngles.braco = computed.braco;
      this.liveAngles.tornozelo = computed.tornozelo;
      this.liveAngles.cabeca = computed.cabeca;
      this.isFullBodyVisible = computed.isFullBodyVisible;
      this.missingBodyParts = computed.missingSegments;

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

      if (this.videoSourceMode === 'file' && this.videoDuration > 0) {
        // Deteção Dinâmica de Movimento para Auto-Slowdown Inteligente (Análise Rigorosa no Movimento)
        if (this.autoSlowdownEnabled && this.isVideoPlaying) {
          const currentKnee = computed.joelho;
          const now = performance.now();
          if (this._lastMotionCheckTime && currentKnee) {
            const dt = Math.max(0.016, (now - this._lastMotionCheckTime) / 1000);
            const angularSpeed = Math.abs((currentKnee - (this._lastKneeAngle || currentKnee)) / dt);
            const isMovingFast = angularSpeed > 22 || this.currentRpm > 8;

            if (isMovingFast) {
              this._motionStillFrames = 0;
              this.videoUploadMgr.triggerMotionSlowdown();
            } else {
              this._motionStillFrames = (this._motionStillFrames || 0) + 1;
              if (this._motionStillFrames > 20) {
                this.videoUploadMgr.releaseMotionSlowdown();
              }
            }
          }
          this._lastMotionCheckTime = now;
          this._lastKneeAngle = currentKnee;
        }

        this.videoSamplesHistory.push({
          time: this.videoCurrentTime,
          joelho: computed.joelho,
          costas: computed.costas,
          braco: computed.braco,
          tornozelo: computed.tornozelo,
          cabeca: computed.cabeca,
          isFullBody: computed.isFullBodyVisible,
        });

        // Captura fotogramas para o GIF animado a cada ~100ms
        if (this.$refs.canvas && this.videoCapturedFrames.length < 60) {
          const now = performance.now();
          if (!this._lastGifCapTime || now - this._lastGifCapTime >= 100) {
            this._lastGifCapTime = now;
            try {
              this.videoCapturedFrames.push(this.$refs.canvas.toDataURL('image/jpeg', 0.8));
            } catch (e) {
              // canvas temporariamente inacessível
            }
          }
        }

        this.renderTimelineChart();
      }

      this.handleAudioAlarms();
    },
    handleAudioAlarms() {
      if (!this.liveAngles.joelho || !this.audioEnabled || !this.isFullBodyVisible) return;
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
    },
    triggerBdcFlash() {
      this.bdcFlashActive = true;
      setTimeout(() => (this.bdcFlashActive = false), 250);
    },
    renderOverlayGraphics(ctx, w, h) {
      if (!this.lastSmoothedLandmarks) return;
      CanvasOverlayRenderer.drawSkeleton(
        ctx,
        this.lastSmoothedLandmarks,
        w,
        h,
        this.liveAngles,
        this.targets,
        this.currentSide
      );

      // Renderização do traçado fantasma com cor fraca e setas indicadoras de correção
      CanvasOverlayRenderer.drawTargetGhostAndGuides(
        ctx,
        this.lastSmoothedLandmarks,
        w,
        h,
        this.liveAngles,
        this.targets,
        this.currentSide
      );

      const isLeft = this.currentSide === 'left';
      const kneePt = this.manualTracker.getAdjustedPoint('knee', this.lastSmoothedLandmarks[isLeft ? 26 : 25]);
      const anklePt = this.manualTracker.getAdjustedPoint('ankle', this.lastSmoothedLandmarks[isLeft ? 28 : 27]);
      const shoulderPt = this.manualTracker.getAdjustedPoint('shoulder', this.lastSmoothedLandmarks[isLeft ? 12 : 11]);
      const elbowPt = this.manualTracker.getAdjustedPoint('elbow', this.lastSmoothedLandmarks[isLeft ? 14 : 13]);
      const headPt = this.lastSmoothedLandmarks[isLeft ? 8 : 7] || this.lastSmoothedLandmarks[0];

      if (kneePt) CanvasOverlayRenderer.drawJointMarker(ctx, kneePt, this.liveAngles.joelho, this.targets.knee, w, h);
      if (shoulderPt) CanvasOverlayRenderer.drawJointMarker(ctx, shoulderPt, this.liveAngles.costas, this.targets.back, w, h);
      if (elbowPt) CanvasOverlayRenderer.drawJointMarker(ctx, elbowPt, this.liveAngles.braco, this.targets.elbow, w, h);
      if (anklePt) CanvasOverlayRenderer.drawJointMarker(ctx, anklePt, this.liveAngles.tornozelo, this.targets.ankle, w, h);
      if (headPt) CanvasOverlayRenderer.drawJointMarker(ctx, headPt, this.liveAngles.cabeca, this.targets.head, w, h);

      // Renderização de Retículos de Bloqueio Ótico e Lupa de Relevo em Tempo Real
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

      if (kneePt && anklePt) this.kopsAnalyzer.drawPlumbLine(ctx, kneePt, anklePt, w, h);
      if (this.isManualCalibrating && this.hoverCrosshair) {
        CanvasOverlayRenderer.drawCalibrationCrosshair(ctx, this.hoverCrosshair.x, this.hoverCrosshair.y, w, h, `FIXAR ${this.manualCalibratingJoint.toUpperCase()}`);
      }
    },
    getJointIndexForName(name, isLeft) {
      switch (name) {
        case 'knee': return isLeft ? 26 : 25;
        case 'hip': return isLeft ? 24 : 23;
        case 'ankle': return isLeft ? 28 : 27;
        case 'shoulder': return isLeft ? 12 : 11;
        case 'elbow': return isLeft ? 14 : 13;
        default: return isLeft ? 26 : 25;
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
    setProfileSide(side) {
      this.currentSide = side;
      this.showToast(`Perfil: ${side === 'left' ? 'Esquerdo' : 'Direito'}`);
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
            this.poseRunner.startLoop(video, this.$refs.canvas, this.ctx, () => this.isAnalyzing);
            this.videoUploadMgr.play();
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
      const added = await this.imageAnalysisMgr.addFiles(files);
      if (added.length > 0) {
        this.showToast(`${added.length} foto(s) carregada(s) para análise.`);
        const active = this.imageAnalysisMgr.getActiveImage();
        if (active) {
          this.drawActiveImageToCanvas(active);
        }
      }
    },
    drawActiveImageToCanvas(item) {
      if (!item || !item.imageElement || !this.$refs.canvas || !this.ctx) return;
      const canvas = this.$refs.canvas;
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
    },
    setImageItemPosition(id, position) {
      this.imageAnalysisMgr.setCrankPosition(id, position);
      const item = this.imageAnalysisMgr.items.find((it) => it.id === id);
      if (item && item.status === 'done') {
        item.report = LiveTuningReportManager.generateReport({
          bdcKneeAngle: position === 'bdc' ? item.angles.joelho : this.lastBdcKneeAngle,
          liveAngles: item.angles,
          kopsResult: item.kopsResult,
          targets: this.targets,
          isFullBody: item.isFullBodyVisible,
          rpm: 0,
          psi: 90,
        });
      }
    },
    removeImageItem(id) {
      this.imageAnalysisMgr.removeImage(id);
      const active = this.imageAnalysisMgr.getActiveImage();
      if (active) {
        this.drawActiveImageToCanvas(active);
      } else if (this.ctx && this.$refs.canvas) {
        this.ctx.clearRect(0, 0, this.$refs.canvas.width, this.$refs.canvas.height);
      }
    },
    clearAllImageItems() {
      this.imageAnalysisMgr.clearAll();
      if (this.ctx && this.$refs.canvas) {
        this.ctx.clearRect(0, 0, this.$refs.canvas.width, this.$refs.canvas.height);
      }
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
        const results = await this.poseRunner.processStaticImage(canvas);

        if (results && results.poseLandmarks && results.poseLandmarks.length >= 33) {
          this.lastSmoothedLandmarks = results.poseLandmarks;
          item.landmarks = results.poseLandmarks;

          const computed = BiomechanicsComputer.computeFrameAngles({
            lm: results.poseLandmarks,
            side: this.currentSide,
            manualTracker: this.manualTracker,
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

          this.liveAngles.joelho = computed.joelho;
          this.liveAngles.costas = computed.costas;
          this.liveAngles.braco = computed.braco;
          this.liveAngles.tornozelo = computed.tornozelo;
          this.liveAngles.cabeca = computed.cabeca;
          this.isFullBodyVisible = computed.isFullBodyVisible;
          this.missingBodyParts = computed.missingSegments;
          this.hasDetectedPose = true;

          if (item.crankPosition === 'bdc' && computed.joelho) {
            this.lastBdcKneeAngle = Math.round(computed.joelho);
          }

          if (computed.points.kneePt && computed.points.anklePt) {
            item.kopsResult = this.kopsAnalyzer.analyze(
              computed.points.kneePt,
              computed.points.anklePt,
              canvas.width,
              canvas.height,
              computed.points.hipPt
            );
            this.kopsResult = item.kopsResult;
          }

          item.report = LiveTuningReportManager.generateReport({
            bdcKneeAngle: item.crankPosition === 'bdc' ? computed.joelho : this.lastBdcKneeAngle,
            liveAngles: item.angles,
            kopsResult: item.kopsResult,
            targets: this.targets,
            isFullBody: item.isFullBodyVisible,
            rpm: 0,
            psi: 90,
          });

          this.renderOverlayGraphics(ctx, canvas.width, canvas.height);

          try {
            item.analyzedCanvasDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          } catch {
            item.analyzedCanvasDataUrl = item.dataUrl;
          }

          item.status = 'done';
          this.showToast(`Foto '${item.name}' analisada com sucesso!`);
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
      const txt = this.imageAnalysisMgr.formatMultiPositionReport(athleteName, bikeModel);
      navigator.clipboard.writeText(txt).then(() => {
        this.showToast('Relatório multi-posição copiado para a área de transferência!');
      }).catch(() => {
        this.showToast('Erro ao copiar texto.');
      });
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
        this.videoCapturedFrames = [];
        this.bdcAnglesHistory = [];
        this.hasDetectedPose = false;

        const video = this.$refs.video;
        if (video) {
          video.srcObject = null;
          const startPlayback = () => {
            video.oncanplay = null;
            this.poseRunner.startLoop(video, this.$refs.canvas, this.ctx, () => this.isAnalyzing);
            this.videoUploadMgr.play();
          };
          if (video.readyState >= 2) {
            startPlayback();
          } else {
            video.oncanplay = startPlayback;
          }
        }
        this.showToast(`Vídeo carregado: ${file.name}`);
      }
    },
    toggleVideoPlay() {
      this.videoUploadMgr.togglePlay();
      this.isReversePlaying = this.videoUploadMgr.isReversePlaying;
      this.poseRunner.setReverseMode(this.isReversePlaying);
    },
    togglePlaybackDirection() {
      this.videoUploadMgr.togglePlaybackDirection();
      this.playbackDirection = this.videoUploadMgr.playbackDirection;
      this.isReversePlaying = this.videoUploadMgr.isReversePlaying;
      this.poseRunner.setReverseMode(this.isReversePlaying);
      this.showToast(
        this.playbackDirection === 'reverse'
          ? 'Sentido oposto ativado (marcha-atrás)'
          : 'Sentido normal ativado (para a frente)'
      );
    },
    setPlaybackDirection(direction) {
      this.videoUploadMgr.setPlaybackDirection(direction);
      this.playbackDirection = this.videoUploadMgr.playbackDirection;
      this.isReversePlaying = this.videoUploadMgr.isReversePlaying;
      this.poseRunner.setReverseMode(this.isReversePlaying);
      this.showToast(
        direction === 'reverse'
          ? 'Sentido oposto ativado (marcha-atrás)'
          : 'Sentido normal ativado (para a frente)'
      );
    },
    playReverseVideo() {
      this.videoUploadMgr.playReverse();
      this.playbackDirection = 'reverse';
      this.isReversePlaying = true;
      this.isVideoPlaying = true;
      this.poseRunner.setReverseMode(true);
      this.showToast('A reproduzir no sentido oposto (marcha-atrás)');
    },
    seekVideo(seconds) {
      this.videoUploadMgr.seekTo(seconds);
    },
    seekRelativeVideo(seconds) {
      this.videoUploadMgr.seekRelative(seconds);
    },
    setVideoSpeed(rate) {
      this.videoPlaybackRate = rate;
      this.videoUploadMgr.setPlaybackRate(rate);
      this.showToast(`Velocidade: ${rate}x`);
    },
    toggleAutoSlowdown() {
      this.autoSlowdownEnabled = !this.autoSlowdownEnabled;
      this.videoUploadMgr.setAutoSlowdown(this.autoSlowdownEnabled, this.autoSlowdownSpeed);
      if (!this.autoSlowdownEnabled) {
        this.videoUploadMgr.releaseMotionSlowdown();
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
        this.loopRange
      );
    },
    handleChartCanvasClick(event) {
      if (!this.$refs.chartCanvas || !this.videoDuration) return;
      const rect = this.$refs.chartCanvas.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const targetTime = AnglesTimelineChart.getTimeFromClick(clickX, rect.width, this.videoDuration);
      this.seekVideo(targetTime);
    },
    async exportVideoGif() {
      if (!this.videoCapturedFrames.length) {
        if (this.$refs.canvas) {
          this.videoCapturedFrames.push(this.$refs.canvas.toDataURL('image/jpeg', 0.85));
        } else {
          this.showToast('Nenhum fotograma capturado para GIF.');
          return;
        }
      }
      this.isExportingGif = true;
      this.showToast('A compilar GIF animado...');
      try {
        await GifExportService.exportToGif(this.videoCapturedFrames, 100, `bikefit_${this.uploadedVideoName || 'video'}.gif`);
        this.showToast('GIF exportado com sucesso!');
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
    setLoopPointA() {
      const cur = this.videoCurrentTime || 0;
      this.videoUploadMgr.setLoopPointA(cur);
      this.loopRange = {
        start: this.videoUploadMgr.loopStart,
        end: this.videoUploadMgr.loopEnd,
        enabled: true,
      };
      this.renderTimelineChart();
      this.showToast(`Loop Ponto A fixado em ${cur.toFixed(1)}s`);
    },
    setLoopPointB() {
      const cur = this.videoCurrentTime || 0;
      this.videoUploadMgr.setLoopPointB(cur);
      this.loopRange = {
        start: this.videoUploadMgr.loopStart,
        end: this.videoUploadMgr.loopEnd,
        enabled: true,
      };
      this.renderTimelineChart();
      this.showToast(`Loop Ponto B fixado em ${cur.toFixed(1)}s`);
    },
    toggleLoop() {
      this.videoUploadMgr.toggleLoop();
      this.loopRange.enabled = this.videoUploadMgr.loopEnabled;
      this.renderTimelineChart();
      this.showToast(this.loopRange.enabled ? 'Repetição de Loop A-B ativada' : 'Loop A-B desativado');
    },
    clearLoop() {
      this.videoUploadMgr.clearLoop();
      this.loopRange = { start: 0, end: 0, enabled: false };
      this.renderTimelineChart();
      this.showToast('Intervalo de Loop A-B limpo');
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
    toggleTuningReportModal() {
      this.showTuningReportModal = !this.showTuningReportModal;
    },
    copyTuningReport() {
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
  },
};
