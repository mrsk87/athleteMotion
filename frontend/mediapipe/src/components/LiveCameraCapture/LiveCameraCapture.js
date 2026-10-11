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
        },
        onPlayStateChange: (playing) => {
          this.isVideoPlaying = playing;
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
      videoSamplesHistory: [],
      videoCapturedFrames: [],
      isExportingGif: false,
      isExportingClip: false,
      bdcAnglesHistory: [],
      isFlippedHorizontal: false,
      loopRange: { start: 0, end: 0, enabled: false },
      showTuningReportModal: false,
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
      if (mode === 'file') {
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
          ? 'Vídeo invertido horizontalmente (modo espelho)'
          : 'Vídeo na orientação original'
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
