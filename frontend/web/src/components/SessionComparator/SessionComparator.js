/**
 * Controlador de Lógica de Negócio do Comparador Antes vs Depois (FEAT-16 & Modo Fantasma 2D).
 *
 * Responsabilidade:
 * - Carregar o histórico de sessões do atleta via API.
 * - Gerir a seleção de duas sessões distintas (Pré-Fit vs Pós-Fit).
 * - Calcular os deltas biomecânicos angulares e os vereditos ergonómicos.
 * - Renderizar a sobreposição visual "Modo Fantasma" (Ghost Overlay) com controlo de opacidade e vetores delta.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from '../../i18n';
import { apiService } from '../../services/api';
import { secureStorage } from '../../services/secureStorage';

export default {
  name: 'SessionComparator',
  props: {
    athleteId: {
      type: String,
      default: '',
    },
    currentSession: {
      type: Object,
      default: null,
    },
  },
  emits: ['backToReport'],
  setup(props) {
    const { t } = useI18n();

    // Estado reativo principal
    const availableSessions = ref([]);
    const selectedSessionAId = ref('');
    const selectedSessionBId = ref('');

    // Estado do Modo de Visualização e Modo Fantasma
    const viewMode = ref('split'); // 'split' | 'ghost'
    const ghostOpacity = ref(50); // 0 a 100% (50 = mistura equitativa)
    const ghostPhase = ref('BDC'); // 'BDC' | 'POWER_3H' | 'TDC'
    const showVectorArrows = ref(true);
    const ghostCanvasRef = ref(null);

    // Sessões selecionadas computadas
    const sessionA = computed(() =>
      availableSessions.value.find((s) => s.id === selectedSessionAId.value)
    );
    const sessionB = computed(() =>
      availableSessions.value.find((s) => s.id === selectedSessionBId.value)
    );

    /**
     * Carrega sessões do atleta ou cria simulação educativa pré-fit.
     */
    const loadSessions = async () => {
      if (props.athleteId) {
        try {
          const sessions = await apiService.getAthleteSessions(props.athleteId);
          if (sessions && sessions.length > 0) {
            availableSessions.value = sessions;
            if (sessions.length >= 2) {
              selectedSessionAId.value = sessions[1].id;
              selectedSessionBId.value = sessions[0].id;
            } else {
              selectedSessionAId.value = sessions[0].id;
              createPreFitSimulation(sessions[0]);
            }
            return;
          }
        } catch (e) {
          console.warn('Erro ao carregar histórico do atleta:', e);
        }
      }

      // Verificar se existe linha de base pré-ajuste guardada no dispositivo
      let storedBaseline = null;
      try {
        storedBaseline = await secureStorage.getItem('athleteMotion_baseline_session');
        if (!storedBaseline && typeof window !== 'undefined' && window.localStorage) {
          const raw = window.localStorage.getItem('athleteMotion_baseline_session');
          if (raw) {
            storedBaseline = JSON.parse(raw);
            await secureStorage.setItem('athleteMotion_baseline_session', storedBaseline);
            window.localStorage.removeItem('athleteMotion_baseline_session');
          }
        }
      } catch {
        storedBaseline = null;
      }

      if (storedBaseline && props.currentSession) {
        const preSession = {
          id: storedBaseline.id || 'baseline-pre',
          name: storedBaseline.name || 'Sessão Anterior (Linha de Base)',
          started_at: storedBaseline.created_at || new Date().toISOString(),
          measured_avg_knee_angle: storedBaseline.angles?.knee_angle || 138.5,
          measured_avg_back_angle: storedBaseline.angles?.back_angle || 52.0,
          measured_avg_arm_angle: storedBaseline.angles?.arm_angle || 165.0,
          measured_avg_ankle_angle: storedBaseline.angles?.ankle_angle || 98.0,
          target_knee_min: 145.0,
          target_knee_max: 155.0,
          target_back_min: 40.0,
          target_back_max: 50.0,
        };
        const postSession = {
          id: props.currentSession.id || 'current-post',
          name: props.currentSession.name || 'Sessão Pós-Ajuste',
          started_at: props.currentSession.created_at || new Date().toISOString(),
          measured_avg_knee_angle:
            props.currentSession.angles?.knee_angle ||
            props.currentSession.measured_avg_knee_angle ||
            148.0,
          measured_avg_back_angle:
            props.currentSession.angles?.back_angle ||
            props.currentSession.measured_avg_back_angle ||
            45.0,
          measured_avg_arm_angle:
            props.currentSession.angles?.arm_angle ||
            props.currentSession.measured_avg_arm_angle ||
            158.0,
          measured_avg_ankle_angle:
            props.currentSession.angles?.ankle_angle ||
            props.currentSession.measured_avg_ankle_angle ||
            98.0,
          target_knee_min: 145.0,
          target_knee_max: 155.0,
          target_back_min: 40.0,
          target_back_max: 50.0,
        };
        availableSessions.value = [postSession, preSession];
        selectedSessionAId.value = preSession.id;
        selectedSessionBId.value = postSession.id;
        return;
      }

      // Fallback para sessão atual com simulação
      if (props.currentSession) {
        createPreFitSimulation(props.currentSession);
      }
    };

    /**
     * Gera uma sessão comparativa simulada (Pré-Fit) para fins de demonstração visual.
     */
    const createPreFitSimulation = (current) => {
      const simulatedPre = {
        id: 'simulated-pre',
        name: 'Linha de Base (Pré-Fit)',
        started_at: new Date(Date.now() - 3600000).toISOString(),
        measured_avg_knee_angle: current.measured_avg_knee_angle
          ? Math.round((current.measured_avg_knee_angle - 8.5) * 10) / 10
          : 138.5,
        measured_avg_back_angle: current.measured_avg_back_angle
          ? Math.round((current.measured_avg_back_angle + 6.0) * 10) / 10
          : 54.0,
        measured_avg_arm_angle: 168.0,
        theoretical_saddle_height_cm: current.theoretical_saddle_height_cm || 73.0,
        target_knee_min: current.target_knee_min || 145.0,
        target_knee_max: current.target_knee_max || 155.0,
        target_back_min: current.target_back_min || 40.0,
        target_back_max: current.target_back_max || 50.0,
      };

      const realPost = {
        ...current,
        id: current.session_id || current.id || 'current-post',
        name: current.name || 'Sessão Otimizada (Pós-Fit)',
        started_at: current.completed_at || new Date().toISOString(),
      };

      availableSessions.value = [realPost, simulatedPre];
      selectedSessionAId.value = 'simulated-pre';
      selectedSessionBId.value = realPost.id;
    };

    /**
     * Cálculo dos Deltas de melhoria postural e vereditos clínicos.
     */
    const deltas = computed(() => {
      if (!sessionA.value || !sessionB.value) return null;
      const kA = sessionA.value.measured_avg_knee_angle || 0;
      const kB = sessionB.value.measured_avg_knee_angle || 0;
      const bA = sessionA.value.measured_avg_back_angle || 0;
      const bB = sessionB.value.measured_avg_back_angle || 0;

      const kneeDelta = Math.round((kB - kA) * 10) / 10;
      const backDelta = Math.round((bB - bA) * 10) / 10;

      const kneeVerdict =
        kB >= 145 && kB <= 155 ? 'Zona Otimizada (Alívio Patelar) ✅' : 'Evolução Registada';
      const backVerdict =
        bB >= 40 && bB <= 50 ? 'Aerodinâmica Equilibrada ✅' : 'Evolução Registada';

      return {
        kneeDelta,
        backDelta,
        kneeVerdict,
        backVerdict,
      };
    });

    /**
     * Modela a cinemática 2D de uma sessão para renderização no Canvas.
     */
    const computePosturePoints = (session, phase = 'BDC') => {
      const kneeAngle = session?.measured_avg_knee_angle || 145.0;
      const backAngle = session?.measured_avg_back_angle || 45.0;

      // Origem no BB da bicicleta (coordenadas canvas)
      const bbX = 330;
      const bbY = 360;
      const crankLen = 55;

      // Posição do pedal de acordo com a fase
      let pedalX = bbX;
      let pedalY = bbY;
      if (phase === 'BDC') {
        pedalX = bbX - crankLen * Math.cos((73.5 * Math.PI) / 180);
        pedalY = bbY + crankLen * Math.sin((73.5 * Math.PI) / 180);
      } else if (phase === 'TDC') {
        pedalX = bbX + crankLen * Math.cos((73.5 * Math.PI) / 180);
        pedalY = bbY - crankLen * Math.sin((73.5 * Math.PI) / 180);
      } else {
        // 3h horizontal
        pedalX = bbX + crankLen;
        pedalY = bbY;
      }

      // Tornozelo (offset do pedal)
      const ankleX = pedalX - 22;
      const ankleY = pedalY - 18;

      // Posição da anca (influenciada pela extensão do joelho e altura de selim)
      // Variação angular de ~1° de joelho equivale a ~2.2mm de altura
      const heightOffset = (kneeAngle - 145.0) * 1.8;
      const hipX = bbX - 65;
      const hipY = bbY - 215 - heightOffset;

      // Cinemática inversa do joelho (interseção 2 círculos: fémur e tíbia)
      const l1 = 125; // fémur px
      const l2 = 120; // tíbia px
      const dx = ankleX - hipX;
      const dy = ankleY - hipY;
      const d = Math.hypot(dx, dy);

      let kneeX = hipX + 45;
      let kneeY = hipY + 110;
      if (d < l1 + l2 && d > Math.abs(l1 - l2)) {
        const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
        const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
        const px = hipX + (a * dx) / d;
        const py = hipY + (a * dy) / d;
        // Joelho projeta para a frente (+X)
        kneeX = px + (h * dy) / d;
        kneeY = py - (h * dx) / d;
      }

      // Tronco e membros superiores
      const torsoLen = 155;
      const torsoRad = (backAngle * Math.PI) / 180;
      const shoulderX = hipX + torsoLen * Math.cos(torsoRad);
      const shoulderY = hipY - torsoLen * Math.sin(torsoRad);

      // Ponto de apoio das mãos no guiador (fixo na geometria da bicicleta)
      const handX = bbX + 130;
      const handY = bbY - 175;

      // Cotovelo
      const armLen = 85;
      const forearmLen = 75;
      const edx = handX - shoulderX;
      const edy = handY - shoulderY;
      const ed = Math.hypot(edx, edy);

      let elbowX = shoulderX - 25;
      let elbowY = shoulderY + 60;
      if (ed < armLen + forearmLen && ed > Math.abs(armLen - forearmLen)) {
        const ea = (armLen * armLen - forearmLen * forearmLen + ed * ed) / (2 * ed);
        const eh = Math.sqrt(Math.max(0, armLen * armLen - ea * ea));
        const epx = shoulderX + (ea * edx) / ed;
        const epy = shoulderY + (ea * edy) / ed;
        elbowX = epx - (eh * edy) / ed;
        elbowY = epy + (eh * edx) / ed;
      }

      // Ponto do topo da cabeça
      const headX = shoulderX + 25;
      const headY = shoulderY - 28;

      return {
        bb: { x: bbX, y: bbY },
        pedal: { x: pedalX, y: pedalY },
        ankle: { x: ankleX, y: ankleY },
        knee: { x: kneeX, y: kneeY },
        hip: { x: hipX, y: hipY },
        shoulder: { x: shoulderX, y: shoulderY },
        elbow: { x: elbowX, y: elbowY },
        hand: { x: handX, y: handY },
        head: { x: headX, y: headY },
      };
    };

    /**
     * Renderiza o quadro da bicicleta e a sobreposição fantasma dos 2 esqueletos.
     */
    const renderGhostOverlay = () => {
      const canvas = ghostCanvasRef.value;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // 1. Fundo escuro de alto contraste
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width, height);

      // 2. Grelha de calibração sutil
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // 3. Desenho do Quadro da Bicicleta (Fixa)
      const bbX = 330;
      const bbY = 360;
      const rearAxleX = bbX - 160;
      const rearAxleY = bbY;
      const frontAxleX = bbX + 220;
      const frontAxleY = bbY;
      const headTubeX = bbX + 110;
      const headTubeY = bbY - 170;
      const seatClusterX = bbX - 70;
      const seatClusterY = bbY - 160;

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 3;

      // Rodas
      ctx.beginPath();
      ctx.arc(rearAxleX, rearAxleY, 80, 0, Math.PI * 2);
      ctx.arc(frontAxleX, frontAxleY, 80, 0, Math.PI * 2);
      ctx.stroke();

      // Tubos do quadro
      ctx.beginPath();
      // Triângulo Traseiro
      ctx.moveTo(bbX, bbY);
      ctx.lineTo(rearAxleX, rearAxleY);
      ctx.lineTo(seatClusterX, seatClusterY);
      ctx.lineTo(bbX, bbY);
      // Triângulo Dianteiro
      ctx.lineTo(headTubeX, headTubeY);
      ctx.lineTo(seatClusterX, seatClusterY);
      // Forqueta
      ctx.moveTo(headTubeX, headTubeY);
      ctx.lineTo(frontAxleX, frontAxleY);
      ctx.stroke();

      // Guiador & Selim
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 4;
      ctx.beginPath();
      // Espigão de selim e selim
      ctx.moveTo(seatClusterX, seatClusterY);
      ctx.lineTo(seatClusterX - 10, seatClusterY - 30);
      ctx.moveTo(seatClusterX - 35, seatClusterY - 30);
      ctx.lineTo(seatClusterX + 15, seatClusterY - 30);
      // Avanço e manetes
      ctx.moveTo(headTubeX, headTubeY);
      ctx.lineTo(bbX + 130, bbY - 175);
      ctx.stroke();

      if (!sessionA.value || !sessionB.value) return;

      const ptsA = computePosturePoints(sessionA.value, ghostPhase.value);
      const ptsB = computePosturePoints(sessionB.value, ghostPhase.value);

      const opB = ghostOpacity.value / 100;
      const opA = 1 - opB;

      // Função auxiliar para desenhar um esqueleto
      const drawSkeleton = (pts, colorRgba, isDashed = false) => {
        ctx.strokeStyle = colorRgba;
        ctx.fillStyle = colorRgba;
        ctx.lineWidth = 3.5;
        if (isDashed) {
          ctx.setLineDash([5, 4]);
        } else {
          ctx.setLineDash([]);
        }

        // Segmentos: Perna
        ctx.beginPath();
        ctx.moveTo(pts.hip.x, pts.hip.y);
        ctx.lineTo(pts.knee.x, pts.knee.y);
        ctx.lineTo(pts.ankle.x, pts.ankle.y);
        ctx.lineTo(pts.pedal.x, pts.pedal.y);
        ctx.stroke();

        // Tronco e Braço
        ctx.beginPath();
        ctx.moveTo(pts.hip.x, pts.hip.y);
        ctx.lineTo(pts.shoulder.x, pts.shoulder.y);
        ctx.lineTo(pts.elbow.x, pts.elbow.y);
        ctx.lineTo(pts.hand.x, pts.hand.y);
        ctx.stroke();

        // Cabeça
        ctx.beginPath();
        ctx.arc(pts.head.x, pts.head.y, 14, 0, Math.PI * 2);
        ctx.stroke();

        ctx.setLineDash([]);

        // Marcadores articulares
        [pts.hip, pts.knee, pts.ankle, pts.shoulder, pts.elbow, pts.hand].forEach((pt) => {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
          ctx.fill();
        });
      };

      // 4. Desenha Sessão A (Antes) em Vermelho/Coral
      const alphaA = Math.max(0.12, Math.min(0.95, opA * 1.1));
      drawSkeleton(ptsA, `rgba(239, 68, 68, ${alphaA})`, true);

      // 5. Desenha Sessão B (Depois) em Verde/Esmeralda
      const alphaB = Math.max(0.12, Math.min(0.95, opB * 1.1));
      drawSkeleton(ptsB, `rgba(16, 185, 129, ${alphaB})`, false);

      // 6. Vetores de Deslocamento Articular (Setas Delta)
      if (showVectorArrows.value) {
        ctx.strokeStyle = '#38bdf8';
        ctx.fillStyle = '#38bdf8';
        ctx.lineWidth = 2;

        const drawArrow = (from, to) => {
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 3) return; // Variação impercetível

          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.stroke();

          // Ponta da seta
          const angle = Math.atan2(dy, dx);
          const headlen = 6;
          ctx.beginPath();
          ctx.moveTo(to.x, to.y);
          ctx.lineTo(
            to.x - headlen * Math.cos(angle - Math.PI / 6),
            to.y - headlen * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            to.x - headlen * Math.cos(angle + Math.PI / 6),
            to.y - headlen * Math.sin(angle + Math.PI / 6)
          );
          ctx.closePath();
          ctx.fill();
        };

        drawArrow(ptsA.hip, ptsB.hip);
        drawArrow(ptsA.knee, ptsB.knee);
        drawArrow(ptsA.shoulder, ptsB.shoulder);
        drawArrow(ptsA.elbow, ptsB.elbow);
      }
    };

    const onSessionChange = () => {
      nextTick(() => {
        renderGhostOverlay();
      });
    };

    watch(
      [viewMode, ghostOpacity, ghostPhase, showVectorArrows, sessionA, sessionB],
      () => {
        if (viewMode.value === 'ghost') {
          nextTick(() => {
            renderGhostOverlay();
          });
        }
      }
    );

    const formatSessionOption = (s) => {
      const dateStr = s.started_at ? new Date(s.started_at).toLocaleDateString() : '';
      const knee = s.measured_avg_knee_angle ? `${s.measured_avg_knee_angle}°` : '';
      return `${s.name || 'Sessão'} (${dateStr}) - Joelho: ${knee}`;
    };

    const formatDate = (iso) => {
      if (!iso) return '-';
      return new Date(iso).toLocaleString();
    };

    onMounted(async () => {
      await loadSessions();
      nextTick(() => {
        renderGhostOverlay();
      });
    });

    return {
      t,
      availableSessions,
      selectedSessionAId,
      selectedSessionBId,
      sessionA,
      sessionB,
      deltas,
      viewMode,
      ghostOpacity,
      ghostPhase,
      showVectorArrows,
      ghostCanvasRef,
      onSessionChange,
      formatSessionOption,
      formatDate,
    };
  },
};
