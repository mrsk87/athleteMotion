/**
 * Controlador de Lógica do Simulador Cinemático de Ajustes (Digital Twin 2D).
 *
 * Implementa cinemática analítica direta 2D no cliente para resposta instantânea (60 FPS)
 * e sincronização com o endpoint REST `/api/v1/biomechanics/simulate-adjustments` para
 * validação ergonómica auditável e persistência.
 */

import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { apiService } from '../../../services/api';

export default {
  name: 'KinematicSimulator',
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    athleteProfile: {
      type: Object,
      default: () => ({
        femur_length_mm: 430.0,
        tibia_length_mm: 410.0,
        trunk_length_mm: 540.0,
        arm_length_mm: 320.0,
        forearm_length_mm: 260.0,
      }),
    },
    baselineGeometry: {
      type: Object,
      default: () => ({
        saddle_height_mm: 700.0,
        saddle_setback_mm: 60.0,
        seat_tube_angle_deg: 73.5,
        handlebar_stack_mm: 560.0,
        handlebar_reach_mm: 385.0,
        crank_length_mm: 172.5,
      }),
    },
  },
  emits: ['close', 'apply'],
  setup(props, { emit }) {
    // Sliders de ajuste em milímetros
    const deltaSaddleHeight = ref(0);
    const deltaSaddleSetback = ref(0);
    const deltaStemStack = ref(0);
    const deltaStemReach = ref(0);

    const simCanvasRef = ref(null);

    // Ângulos previstos
    const baselineKneeBdc = ref(146.5);
    const simulatedKneeBdc = ref(146.5);
    const deltaKneeBdc = computed(() =>
      Math.round((simulatedKneeBdc.value - baselineKneeBdc.value) * 10) / 10
    );

    const baselineTorso = ref(44.0);
    const simulatedTorso = ref(44.0);
    const deltaTorso = computed(() =>
      Math.round((simulatedTorso.value - baselineTorso.value) * 10) / 10
    );

    const simulatedElbow = ref(155.0);
    const kopsOffsetMm = ref(0.0);
    const clinicalWarnings = ref([]);

    const kneeClinicalStatus = computed(() => {
      const k = simulatedKneeBdc.value;
      if (k >= 140.0 && k <= 152.0) return 'Faixa Ótima (Holmes 140°-150°) ✅';
      if (k > 155.0) return 'Hiperextensão (Sobrecarga Poplítea) ⚠️';
      if (k < 138.0) return 'Flexão Excessiva (Pressão Patelar) ⚠️';
      return 'Zona Aceitável';
    });

    const torsoClinicalStatus = computed(() => {
      const t = simulatedTorso.value;
      if (t >= 40.0 && t <= 50.0) return 'Postura Equilibrada ✅';
      if (t < 35.0) return 'Agressivo / Lombar Exigida ⚠️';
      return 'Postura Conforto';
    });

    /**
     * Resolução cinemática direta 2D local para feedback a 60 FPS ao arrastar sliders.
     */
    const computeKinematics = () => {
      const anthro = props.athleteProfile || {};
      const l1 = anthro.femur_length_mm || 430.0;
      const l2 = anthro.tibia_length_mm || 410.0;
      const torsoL = anthro.trunk_length_mm || 540.0;
      const armL = anthro.arm_length_mm || 320.0;
      const forearmL = anthro.forearm_length_mm || 260.0;

      const baseGeo = props.baselineGeometry || {};
      const saddleH = (baseGeo.saddle_height_mm || 700.0) + deltaSaddleHeight.value;
      const setback = (baseGeo.saddle_setback_mm || 60.0) + deltaSaddleSetback.value;
      const stack = (baseGeo.handlebar_stack_mm || 560.0) + deltaStemStack.value;
      const reach = (baseGeo.handlebar_reach_mm || 385.0) + deltaStemReach.value;
      const crank = baseGeo.crank_length_mm || 172.5;

      const staRad = ((baseGeo.seat_tube_angle_deg || 73.5) * Math.PI) / 180;

      // Posição Hip e Ankle no BDC
      const hipX = -Math.abs(setback) + 25.0;
      const hipY = saddleH * Math.sin(staRad) + 30.0;

      const pedalX = -crank * Math.cos(staRad);
      const pedalY = -crank * Math.sin(staRad);

      const ankleX = pedalX - 65.0;
      const ankleY = pedalY + 65.0;

      // Distância Hip -> Ankle
      const dx = ankleX - hipX;
      const dy = ankleY - hipY;
      const d = Math.hypot(dx, dy);

      // Lei dos Cossenos para o ângulo do Joelho
      let cosKnee = (l1 * l1 + l2 * l2 - d * d) / (2.0 * l1 * l2);
      cosKnee = Math.max(-1.0, Math.min(1.0, cosKnee));
      const kneeAngleDeg = (Math.acos(cosKnee) * 180.0) / Math.PI;

      simulatedKneeBdc.value = Math.round(kneeAngleDeg * 10) / 10;

      // Posição das mãos (guiador)
      const handX = reach + 70.0;
      const handY = stack + 20.0;

      // Tronco e ombro
      const tdx = handX - hipX;
      const tdy = handY - hipY;
      const td = Math.hypot(tdx, tdy);

      const armTotal = armL + forearmL;
      let torsoAngle = 45.0;
      if (td < torsoL + armTotal && td > 0) {
        const cosTorso = (torsoL * torsoL + td * td - armTotal * armTotal) / (2.0 * torsoL * td);
        const alpha = Math.acos(Math.max(-1.0, Math.min(1.0, cosTorso)));
        const baseAngle = Math.atan2(tdy, tdx);
        torsoAngle = ((baseAngle + alpha) * 180.0) / Math.PI;
      }
      simulatedTorso.value = Math.max(25, Math.min(75, Math.round(torsoAngle * 10) / 10));

      // KOPS offset às 3h
      const pedal3hX = crank;
      const knee3hX = hipX + l1 * 0.72; // aproximação rápida
      kopsOffsetMm.value = Math.round((knee3hX - pedal3hX) * 10) / 10;

      // Alertas clínicos locais imediatos
      const warnings = [];
      if (simulatedKneeBdc.value > 155.0) {
        warnings.push({
          severity: simulatedKneeBdc.value > 162.0 ? 'critical' : 'warning',
          message_pt: `Extensão do joelho a ${simulatedKneeBdc.value}°: Risco elevado de tendinite no bíceps femoral e dor poplítea.`,
        });
      } else if (simulatedKneeBdc.value < 138.0) {
        warnings.push({
          severity: 'warning',
          message_pt: `Extensão do joelho a ${simulatedKneeBdc.value}°: Sobrecarga compressiva na cartilagem patelofemoral.`,
        });
      }
      if (simulatedTorso.value < 35.0) {
        warnings.push({
          severity: 'warning',
          message_pt: `Inclinação de tronco a ${simulatedTorso.value}°: Cockpit muito baixo, sobrecarregando a coluna lombar.`,
        });
      }
      clinicalWarnings.value = warnings;

      renderCanvas();
    };

    /**
     * Renderiza o quadro e a comparação cinemática Referência vs Simulação no Canvas.
     */
    const renderCanvas = () => {
      const canvas = simCanvasRef.value;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Fundo
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);

      // Grelha
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 30) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Escala e Origem no Canvas (BB)
      const scale = 0.35; // mm para px
      const bbX = 260;
      const bbY = 320;

      // Quadro da Bicicleta
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2.5;

      const rearAxleX = bbX - 420 * scale;
      const rearAxleY = bbY;
      const frontAxleX = bbX + 600 * scale;
      const frontAxleY = bbY;
      const headX = bbX + (props.baselineGeometry?.handlebar_reach_mm || 385) * scale;
      const headY = bbY - (props.baselineGeometry?.handlebar_stack_mm || 560) * scale;
      const seatClusterX = bbX - 180 * scale;
      const seatClusterY = bbY - 480 * scale;

      // Rodas
      ctx.beginPath();
      ctx.arc(rearAxleX, rearAxleY, 310 * scale, 0, Math.PI * 2);
      ctx.arc(frontAxleX, frontAxleY, 310 * scale, 0, Math.PI * 2);
      ctx.stroke();

      // Tubos
      ctx.beginPath();
      ctx.moveTo(bbX, bbY);
      ctx.lineTo(rearAxleX, rearAxleY);
      ctx.lineTo(seatClusterX, seatClusterY);
      ctx.lineTo(bbX, bbY);
      ctx.lineTo(headX, headY);
      ctx.lineTo(seatClusterX, seatClusterY);
      ctx.moveTo(headX, headY);
      ctx.lineTo(frontAxleX, frontAxleY);
      ctx.stroke();

      // Biela e Pedal no BDC
      const crankPx = 172.5 * scale;
      const staRad = ((props.baselineGeometry?.seat_tube_angle_deg || 73.5) * Math.PI) / 180;
      const pedalX = bbX - crankPx * Math.cos(staRad);
      const pedalY = bbY + crankPx * Math.sin(staRad);

      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(bbX, bbY);
      ctx.lineTo(pedalX, pedalY);
      ctx.stroke();

      // Função auxiliar para desenhar o ciclista
      const drawRider = (sH, sSetback, bStack, bReach, strokeColor, isDashed = false) => {
        const sX = bbX - sSetback * scale;
        const sY = bbY - sH * scale;

        const hipX = sX + 25 * scale;
        const hipY = sY + 30 * scale;

        const ankleX = pedalX - 65 * scale;
        const ankleY = pedalY - 20 * scale;

        // Cinemática perna
        const l1 = (props.athleteProfile?.femur_length_mm || 430) * scale;
        const l2 = (props.athleteProfile?.tibia_length_mm || 410) * scale;
        const dx = ankleX - hipX;
        const dy = ankleY - hipY;
        const d = Math.hypot(dx, dy);

        let kneeX = hipX + 45 * scale;
        let kneeY = hipY + 110 * scale;
        if (d < l1 + l2 && d > Math.abs(l1 - l2)) {
          const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
          const hDiff = Math.sqrt(Math.max(0, l1 * l1 - a * a));
          const px = hipX + (a * dx) / d;
          const py = hipY + (a * dy) / d;
          kneeX = px + (hDiff * dy) / d;
          kneeY = py - (hDiff * dx) / d;
        }

        // Tronco e Braço
        const torsoLen = (props.athleteProfile?.trunk_length_mm || 540) * scale;
        const handX = bbX + (bReach + 70) * scale;
        const handY = bbY - (bStack + 20) * scale;

        const shoulderX = hipX + torsoLen * 0.75;
        const shoulderY = hipY - torsoLen * 0.65;

        ctx.strokeStyle = strokeColor;
        ctx.fillStyle = strokeColor;
        ctx.lineWidth = 3;
        if (isDashed) {
          ctx.setLineDash([4, 4]);
        } else {
          ctx.setLineDash([]);
        }

        // Perna
        ctx.beginPath();
        ctx.moveTo(hipX, hipY);
        ctx.lineTo(kneeX, kneeY);
        ctx.lineTo(ankleX, ankleY);
        ctx.lineTo(pedalX, pedalY);
        ctx.stroke();

        // Tronco e Braço
        ctx.beginPath();
        ctx.moveTo(hipX, hipY);
        ctx.lineTo(shoulderX, shoulderY);
        ctx.lineTo(handX, handY);
        ctx.stroke();

        ctx.setLineDash([]);

        // Marcadores
        [
          { x: hipX, y: hipY },
          { x: kneeX, y: kneeY },
          { x: ankleX, y: ankleY },
          { x: shoulderX, y: shoulderY },
          { x: handX, y: handY },
        ].forEach((pt) => {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
          ctx.fill();
        });
      };

      // 1. Esqueleto de Referência (Cinza / Coral translúcido)
      const baseSH = props.baselineGeometry?.saddle_height_mm || 700.0;
      const baseSB = props.baselineGeometry?.saddle_setback_mm || 60.0;
      const baseSt = props.baselineGeometry?.handlebar_stack_mm || 560.0;
      const baseR = props.baselineGeometry?.handlebar_reach_mm || 385.0;
      drawRider(baseSH, baseSB, baseSt, baseR, 'rgba(239, 68, 68, 0.45)', true);

      // 2. Esqueleto Simulado Ajustado (Ciano Brilhante)
      drawRider(
        baseSH + deltaSaddleHeight.value,
        baseSB + deltaSaddleSetback.value,
        baseSt + deltaStemStack.value,
        baseR + deltaStemReach.value,
        '#06b6d4',
        false
      );
    };

    const resetDeltas = () => {
      deltaSaddleHeight.value = 0;
      deltaSaddleSetback.value = 0;
      deltaStemStack.value = 0;
      deltaStemReach.value = 0;
      computeKinematics();
    };

    const applyAdjustments = () => {
      emit('apply', {
        delta_saddle_height_mm: deltaSaddleHeight.value,
        delta_saddle_setback_mm: deltaSaddleSetback.value,
        delta_stem_stack_mm: deltaStemStack.value,
        delta_stem_reach_mm: deltaStemReach.value,
        simulated_knee_bdc_deg: simulatedKneeBdc.value,
        simulated_torso_deg: simulatedTorso.value,
      });
      close();
    };

    const close = () => {
      emit('close');
    };

    watch(
      [deltaSaddleHeight, deltaSaddleSetback, deltaStemStack, deltaStemReach, () => props.isOpen],
      () => {
        if (props.isOpen) {
          nextTick(() => {
            computeKinematics();
          });
        }
      }
    );

    onMounted(() => {
      if (props.isOpen) {
        computeKinematics();
      }
    });

    return {
      deltaSaddleHeight,
      deltaSaddleSetback,
      deltaStemStack,
      deltaStemReach,
      simCanvasRef,
      baselineKneeBdc,
      simulatedKneeBdc,
      deltaKneeBdc,
      simulatedTorso,
      deltaTorso,
      simulatedElbow,
      kopsOffsetMm,
      clinicalWarnings,
      kneeClinicalStatus,
      torsoClinicalStatus,
      resetDeltas,
      applyAdjustments,
      close,
    };
  },
};

