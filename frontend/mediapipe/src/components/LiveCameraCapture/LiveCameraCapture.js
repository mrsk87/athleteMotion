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
    this.smoother = markRaw(new LandmarkSmoother(0.35));
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
      smoothingLevel: 'medium',
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
      liveAngles: { joelho: null, costas: null, braco: null, tornozelo: null },
      targets: { knee: [145, 155], back: [40, 50], elbow: [150, 165], shoulder: [85, 95], ankle: [95, 105] },
    };
  },
  computed: {
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
    realtimeRecommendations() {
      const recs = [];
      const [minK, maxK] = this.targets.knee;
      const knee = this.lastBdcKneeAngle || this.liveAngles.joelho;
      if (knee) {
        if (knee < minK) recs.push('Selim Baixo: Eleve o selim entre 5mm e 10mm.');
        else if (knee > maxK) recs.push('Selim Alto: Desça o selim entre 5mm e 8mm.');
      }
      if (this.kopsResult && !this.kopsResult.isAligned) recs.push(`KOPS: ${this.kopsResult.actionPt}.`);
      return recs;
    },
    activeRecommendations() {
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
  },
  mounted() {
    this.configureModalityTargets();
    this.debugLogMgr.setup();
    this.$nextTick(() => this.initPipeline());
  },
  beforeUnmount() {
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

      this.lastSmoothedLandmarks = this.smoother.smooth(results.poseLandmarks);
      const computed = BiomechanicsComputer.computeFrameAngles({
        lm: this.lastSmoothedLandmarks,
        side: this.currentSide,
        manualTracker: this.manualTracker,
      });

      this.liveAngles.joelho = computed.joelho;
      this.liveAngles.costas = computed.costas;
      this.liveAngles.braco = computed.braco;
      this.liveAngles.tornozelo = computed.tornozelo;

      const video = this.$refs.video;
      const w = video?.videoWidth || 640;
      const h = video?.videoHeight || 480;

      if (computed.points.anklePt) {
        const bdc = this.pedalTracker.addSample(computed.points.anklePt.y * h, computed.joelho);
        this.currentRpm = this.bleData.connected && this.bleData.cadenceRpm ? this.bleData.cadenceRpm : bdc.rpm;
        if (bdc.isBdc) {
          this.lastBdcKneeAngle = bdc.bdcKneeAngle;
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

      this.handleAudioAlarms();
    },
    handleAudioAlarms() {
      if (!this.liveAngles.joelho || !this.audioEnabled) return;
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
      CanvasOverlayRenderer.drawSkeleton(ctx, this.lastSmoothedLandmarks);

      const isLeft = this.currentSide === 'left';
      const kneePt = this.manualTracker.getAdjustedPoint('knee', this.lastSmoothedLandmarks[isLeft ? 26 : 25]);
      const anklePt = this.manualTracker.getAdjustedPoint('ankle', this.lastSmoothedLandmarks[isLeft ? 28 : 27]);
      const shoulderPt = this.manualTracker.getAdjustedPoint('shoulder', this.lastSmoothedLandmarks[isLeft ? 12 : 11]);

      if (kneePt) CanvasOverlayRenderer.drawJointMarker(ctx, kneePt, this.liveAngles.joelho, this.targets.knee, w, h);
      if (shoulderPt) CanvasOverlayRenderer.drawJointMarker(ctx, shoulderPt, this.liveAngles.costas, this.targets.back, w, h);

      if (kneePt && anklePt) this.kopsAnalyzer.drawPlumbLine(ctx, kneePt, anklePt, w, h);
      if (this.isManualCalibrating && this.hoverCrosshair) {
        CanvasOverlayRenderer.drawCalibrationCrosshair(ctx, this.hoverCrosshair.x, this.hoverCrosshair.y, w, h);
      }
    },
    handleCanvasClick(event) {
      const rect = this.$refs.canvas?.getBoundingClientRect();
      if (!rect) return;
      const x = ((event.clientX - rect.left) / rect.width) * (this.$refs.canvas.width || 640);
      const y = ((event.clientY - rect.top) / rect.height) * (this.$refs.canvas.height || 480);

      if (this.isManualCalibrating) {
        this.manualTracker.applyCalibrationClick(x / (this.$refs.canvas.width || 640), y / (this.$refs.canvas.height || 480));
        this.hasManualMarkers = true;
        this.isManualCalibrating = false;
        this.showToast('Marcador manual fixado com sucesso!');
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
    startWheelCalibration() {
      this.wheelHandler.start();
    },
    cancelWheelCalibration() {
      this.wheelHandler.cancel();
    },
    copyDiagnosticLogs() {
      this.debugLogMgr.copyLogsToClipboard().then(() => this.showToast('Logs copiados!')).catch(() => this.showToast('Erro ao copiar'));
    },
    captureSnapshot() {
      if (!this.liveAngles.joelho) return;
      const snap = {
        frame_index: this.recordedSnapshotsCount++,
        knee_angle: this.lastBdcKneeAngle || this.liveAngles.joelho,
        back_angle: this.liveAngles.costas,
        arm_angle: this.liveAngles.braco,
        ankle_angle: this.liveAngles.tornozelo,
      };
      this.snapshotsBuffer.push(snap);
      if (this.sessionData?.session?.id && this.sessionData.session.id !== 'local-session') {
        apiService.recordSnapshot(this.sessionData.session.id, snap).catch(() => {});
      }
      this.showToast(`Snapshot guardado (#${this.recordedSnapshotsCount})`);
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
  },
};
