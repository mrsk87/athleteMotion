/**
 * Controlador de Lógica da Vista de Relatório Web Interativo (WebReportView).
 *
 * Responsabilidades:
 * - Apresentar a auditoria biomecânica de BikeFit em ambiente web partilhável.
 * - Leitor de trajetória slow-motion com scrubber frame-a-frame.
 * - Diagrama polar 360° interativo de força e simetria de pedalada (PolarPlotter).
 * - Integração do Simulador Cinemático de Ajustes ("Digital Twin").
 */

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { KinematicSimulator } from '../components/common/KinematicSimulator';
import { apiService } from '../services/api';
import { PolarPlotter } from '../services/polarPlotter';

export default {
  name: 'WebReportView',
  components: {
    KinematicSimulator,
  },
  setup() {
    const route = useRoute();
    const sessionId = computed(() => route.params.id || 'live-session');
    const sessionIdShort = computed(() => String(sessionId.value).substring(0, 8));

    const athleteName = ref('Ciclista');
    const sessionDate = ref(new Date().toLocaleDateString('pt-PT'));
    const confidencePct = ref(94);

    // Controlo de Reprodução Slow-Motion
    const isPlaying = ref(true);
    const currentFrameIdx = ref(0);
    const totalFrames = 100;
    const playbackSpeed = ref(30); // ms por frame

    const reportCanvasRef = ref(null);
    const polarCanvasRef = ref(null);

    const isSimulatorOpen = ref(false);

    // Polar Plotter instance
    const polarPlotter = new PolarPlotter(24);
    const psiScore = ref(86.5);

    let animationTimer = null;

    // Métricas angulares calculadas dinamicamente ao longo da revolução
    const currentKneeAngle = computed(() => {
      const phase = (currentFrameIdx.value / totalFrames) * 2 * Math.PI;
      // Varia entre ~70° (TDC) e ~148° (BDC)
      const base = 109.0;
      const amp = 39.0;
      return Math.round((base - amp * Math.cos(phase)) * 10) / 10;
    });

    const currentTorsoAngle = computed(() => 45.2);

    const patellarForceN = computed(() => {
      const deg = (currentFrameIdx.value / totalFrames) * 360;
      if (deg >= 40 && deg <= 140) {
        return Math.round(850 + 550 * Math.sin(((deg - 40) / 100) * Math.PI));
      }
      return Math.round(180 + 80 * Math.random());
    });

    const patellarStressMpa = computed(() =>
      Math.round((patellarForceN.value / 380.0) * 10) / 10
    );

    const currentPhaseLabel = computed(() => {
      const idx = currentFrameIdx.value;
      if (idx >= 45 && idx <= 55) return 'Ponto Morto Inferior (BDC) ⭐';
      if (idx >= 0 && idx <= 8) return 'Ponto Morto Superior (TDC)';
      if (idx >= 20 && idx <= 30) return 'Pico de Força (3h)';
      return 'Fase Dinâmica';
    });

    const pdfUrl = computed(() =>
      apiService.getPdfDownloadUrl(sessionId.value, { lang: 'pt' })
    );

    /**
     * Renderiza o ciclista no fotograma atual do ciclo no Canvas.
     */
    const renderFrame = () => {
      const canvas = reportCanvasRef.value;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Fundo escuro e grelha técnica
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Geometria da bicicleta
      const bbX = 300;
      const bbY = 300;
      const crankLen = 58;
      const crankAngleRad = (currentFrameIdx.value / totalFrames) * 2 * Math.PI - Math.PI / 2;

      // Posição do pedal
      const pedalX = bbX + crankLen * Math.cos(crankAngleRad);
      const pedalY = bbY + crankLen * Math.sin(crankAngleRad);

      // Posição do selim e anca
      const hipX = bbX - 65;
      const hipY = bbY - 210;

      // Tornozelo
      const ankleX = pedalX - 20;
      const ankleY = pedalY - 14;

      // Joelho (cinemática inversa)
      const l1 = 125;
      const l2 = 120;
      const dx = ankleX - hipX;
      const dy = ankleY - hipY;
      const d = Math.hypot(dx, dy);

      let kneeX = hipX + 45;
      let kneeY = hipY + 110;
      if (d < l1 + l2 && d > Math.abs(l1 - l2)) {
        const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
        const hDiff = Math.sqrt(Math.max(0, l1 * l1 - a * a));
        const px = hipX + (a * dx) / d;
        const py = hipY + (a * dy) / d;
        kneeX = px + (hDiff * dy) / d;
        kneeY = py - (hDiff * dx) / d;
      }

      // Tronco e braços
      const torsoRad = (45 * Math.PI) / 180;
      const shoulderX = hipX + 155 * Math.cos(torsoRad);
      const shoulderY = hipY - 155 * Math.sin(torsoRad);

      const handX = bbX + 130;
      const handY = bbY - 170;

      // Quadro
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      // Rodas
      ctx.arc(bbX - 160, bbY, 80, 0, Math.PI * 2);
      ctx.arc(bbX + 220, bbY, 80, 0, Math.PI * 2);
      ctx.stroke();

      // Esqueleto do Ciclista (Ciano Brilhante)
      ctx.strokeStyle = '#06b6d4';
      ctx.fillStyle = '#06b6d4';
      ctx.lineWidth = 3.5;

      // Perna
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      ctx.lineTo(kneeX, kneeY);
      ctx.lineTo(ankleX, ankleY);
      ctx.lineTo(pedalX, pedalY);
      ctx.stroke();

      // Crenque
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(bbX, bbY);
      ctx.lineTo(pedalX, pedalY);
      ctx.stroke();

      // Tronco e Braço
      ctx.strokeStyle = '#06b6d4';
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      ctx.lineTo(shoulderX, shoulderY);
      ctx.lineTo(handX, handY);
      ctx.stroke();

      // Cabeça
      ctx.beginPath();
      ctx.arc(shoulderX + 24, shoulderY - 26, 14, 0, Math.PI * 2);
      ctx.stroke();

      // Marcadores articulares
      [
        { x: hipX, y: hipY },
        { x: kneeX, y: kneeY },
        { x: ankleX, y: ankleY },
        { x: shoulderX, y: shoulderY },
        { x: handX, y: handY },
      ].forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Arco angular do joelho
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(kneeX, kneeY, 20, 0, (currentKneeAngle.value * Math.PI) / 180);
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(`${currentKneeAngle.value}°`, kneeX + 26, kneeY - 4);
    };

    /**
     * Atualiza o Diagrama Polar 360° em sincronismo com a pedalada.
     */
    const updatePolarPlot = () => {
      const angle = (currentFrameIdx.value / totalFrames) * 360;
      const torque = patellarForceN.value;
      polarPlotter.addSample(angle, torque);
      polarPlotter.render(polarCanvasRef.value, 260, 260);
      psiScore.value = polarPlotter.calculatePsi();
    };

    const stepFrame = (delta) => {
      currentFrameIdx.value = (currentFrameIdx.value + delta + totalFrames) % totalFrames;
      renderFrame();
      updatePolarPlot();
    };

    const togglePlay = () => {
      isPlaying.value = !isPlaying.value;
      if (isPlaying.value) {
        startAnimation();
      } else {
        stopAnimation();
      }
    };

    const startAnimation = () => {
      stopAnimation();
      animationTimer = setInterval(() => {
        currentFrameIdx.value = (currentFrameIdx.value + 1) % totalFrames;
        renderFrame();
        updatePolarPlot();
      }, playbackSpeed.value);
    };

    const stopAnimation = () => {
      if (animationTimer) {
        clearInterval(animationTimer);
        animationTimer = null;
      }
    };

    const onApplySimulator = (deltas) => {
      console.log('Ajustes aplicados pelo simulador cinemático:', deltas);
    };

    watch(currentFrameIdx, () => {
      renderFrame();
      updatePolarPlot();
    });

    onMounted(async () => {
      // Popula amostras simuladas de referência no polar plotter
      for (let i = 0; i < 360; i += 15) {
        const rad = (i * Math.PI) / 180;
        const mag = i > 30 && i < 150 ? 600 + 400 * Math.sin(rad) : 150;
        polarPlotter.addSample(i, mag);
      }

      await nextTick();
      renderFrame();
      updatePolarPlot();
      startAnimation();
    });

    onBeforeUnmount(() => {
      stopAnimation();
    });

    return {
      sessionId,
      sessionIdShort,
      athleteName,
      sessionDate,
      confidencePct,
      isPlaying,
      currentFrameIdx,
      totalFrames,
      reportCanvasRef,
      polarCanvasRef,
      isSimulatorOpen,
      psiScore,
      currentKneeAngle,
      currentTorsoAngle,
      patellarForceN,
      patellarStressMpa,
      currentPhaseLabel,
      pdfUrl,
      togglePlay,
      stepFrame,
      onApplySimulator,
    };
  },
};

