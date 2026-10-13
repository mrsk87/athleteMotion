# TAREFA 07: OVERLAY DE ESQUELETO BIOMECÂNICO & ÓRBITA DO PÉ

> **Identificador:** `TASK_07_FRONTEND_CANVAS_OVERLAY_AND_FOOT_ORBIT`  
> **Prioridade:** P0 (Visualização Biomecânica)  
> **Responsabilidade:** Criar o componente de Canvas sobreposto ao vídeo para desenhar o esqueleto biomecânico, ângulos dinâmicos e a trajetória orbital contínua do pé (Motion Trail do tornozelo/5.º metatarso com fade progressivo).

---

## 1. OBJETIVO DA TAREFA
Construir uma camada gráfica transparente sobre o leitor de vídeo com renderização acelerada a 60 FPS:
1. **Esqueleto Biomecânico Sagital:** Conexões anatómicas elegantes e ângulos em tempo real (joelho, tronco, braço) renderizados junto às articulações com cores de conformidade.
2. **Motion Trail da Órbita do Pé:** Rastreio orbital contínuo do pé (tornozelo ou 5.º metatarso) ao longo de cada volta da pedaleira. Permite detetar instantaneamente elipses assimétricas, quebras de cadência e queda precoce do calcanhar (*heel drop*). Suporta fade temporal configurável ou retenção de $N$ voltas completas.

---

## 2. FICHEIROS A CRIAR

1. `frontend/mediapipe/src/components/video/BiomechanicalOverlayCanvas.vue` (Componente Vue 3)
2. `frontend/mediapipe/src/composables/useFootOrbitTrail.js` (Composable de histórico e desenho da órbita)
3. `frontend/mediapipe/src/composables/useSkeletonRenderer.js` (Renderizador gráfico de ossos, juntas e ângulos)

---

## 3. GESTOR DA TRAJETÓRIA DO PÉ (`src/composables/useFootOrbitTrail.js`)

```javascript
/**
 * Gestor do Motion Trail da órbita do pé com fade progressivo.
 */
import { ref } from 'vue';

export function useFootOrbitTrail(maxPoints = 120) {
  // Array de pontos: { x, y, timestamp_ms, alpha }
  const trailPoints = ref([]);
  const fadeDurationMs = ref(3500); // 3.5 segundos de retenção (aproximadamente 3 a 4 pedaladas)

  const addPoint = (normX, normY, timestampMs) => {
    if (normX == null || normY == null) return;
    trailPoints.value.push({
      x: normX,
      y: normY,
      time: timestampMs,
    });

    // Manter tamanho controlado
    if (trailPoints.value.length > maxPoints) {
      trailPoints.value.shift();
    }
  };

  const clearTrail = () => {
    trailPoints.value = [];
  };

  const drawOrbitTrail = (ctx, width, height, currentTimestampMs) => {
    if (trailPoints.value.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 1; i < trailPoints.value.length; i++) {
      const pPrev = trailPoints.value[i - 1];
      const pCurr = trailPoints.value[i];

      // Cálculo de fade temporal progressivo
      const age = currentTimestampMs - pCurr.time;
      let alpha = 1.0 - (age / fadeDurationMs.value);
      if (alpha <= 0.05) continue;
      alpha = Math.max(0.05, Math.min(1.0, alpha));

      // Gradiente azul elétrico / ciano para o rasto orbital
      ctx.strokeStyle = `rgba(56, 189, 248, ${alpha.toFixed(2)})`;
      ctx.lineWidth = 3.0 * alpha + 1.0;

      ctx.beginPath();
      ctx.moveTo(pPrev.x * width, pPrev.y * height);
      ctx.lineTo(pCurr.x * width, pCurr.y * height);
      ctx.stroke();
    }

    // Ponto atual da ponta do pedal (destaque dourado)
    const last = trailPoints.value[trailPoints.value.length - 1];
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(last.x * width, last.y * height, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore;
  };

  return {
    trailPoints,
    fadeDurationMs,
    addPoint,
    clearTrail,
    drawOrbitTrail,
  };
}
```

---

## 4. COMPONENTE COMPLETO DE OVERLAY (`BiomechanicalOverlayCanvas.vue`)

Cria `frontend/mediapipe/src/components/video/BiomechanicalOverlayCanvas.vue`:

```html
<template>
  <canvas ref="canvasRef" class="biomechanical-canvas"></canvas>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { useFootOrbitTrail } from '../../composables/useFootOrbitTrail';

const props = defineProps({
  landmarks: {
    type: Object,
    default: () => ({}),
  },
  angles: {
    type: Object,
    default: () => ({}),
  },
  timestampMs: {
    type: Number,
    default: 0,
  },
  showTrail: {
    type: Boolean,
    default: true,
  },
  showSkeleton: {
    type: Boolean,
    default: true,
  },
});

const canvasRef = ref(null);
const { addPoint, clearTrail, drawOrbitTrail } = useFootOrbitTrail(150);

// Observar chegada de novas coordenadas de pé/tornozelo
watch(
  () => props.landmarks?.ankle,
  (ankle) => {
    if (ankle) {
      addPoint(ankle.x, ankle.y, props.timestampMs);
    }
  }
);

// Segmentos anatómicos a ligar no esqueleto sagital
const BONES = [
  ['ear', 'shoulder'],
  ['shoulder', 'elbow'],
  ['elbow', 'wrist'],
  ['shoulder', 'hip'],
  ['hip', 'knee'],
  ['knee', 'ankle'],
  ['ankle', 'heel'],
  ['heel', 'toe'],
  ['ankle', 'toe'],
];

const renderFrame = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // 1. Desenhar Motion Trail da Órbita do Pé
  if (props.showTrail) {
    drawOrbitTrail(ctx, w, h, props.timestampMs);
  }

  // 2. Desenhar Esqueleto Biomecânico
  if (props.showSkeleton && props.landmarks) {
    ctx.save();
    
    // Desenhar ossos
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    for (const [j1, j2] of BONES) {
      const p1 = props.landmarks[j1];
      const p2 = props.landmarks[j2];
      if (p1 && p2 && p1.visibility > 0.4 && p2.visibility > 0.4) {
        ctx.beginPath();
        ctx.moveTo(p1.x * w, p1.y * h);
        ctx.lineTo(p2.x * w, p2.y * h);
        ctx.stroke();
      }
    }

    // Desenhar juntas anatómicas
    for (const [name, p] of Object.entries(props.landmarks)) {
      if (p && p.visibility > 0.4) {
        ctx.fillStyle = name === 'knee' ? '#10b981' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // 3. Renderizar Valores dos Ângulos junto às Articulações
    if (props.angles?.knee && props.landmarks.knee) {
      const kp = props.landmarks.knee;
      const angle = props.angles.knee;
      // Cor de conformidade: Verde se 145-155, Amarelo se fora
      const isCompliant = angle >= 145.0 && angle <= 155.0;
      ctx.fillStyle = isCompliant ? '#10b981' : '#f59e0b';
      ctx.font = 'bold 14px Inter, monospace';
      ctx.fillText(`${angle}°`, kp.x * w + 12, kp.y * h + 4);
    }

    if (props.angles?.torso && props.landmarks.hip) {
      const hp = props.landmarks.hip;
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 13px Inter, monospace';
      ctx.fillText(`Tronco: ${props.angles.torso}°`, hp.x * w - 80, hp.y * h - 10);
    }

    ctx.restore();
  }
};

let animId = null;
const loop = () => {
  renderFrame();
  animId = requestAnimationFrame(loop);
};

const resizeCanvas = () => {
  const canvas = canvasRef.value;
  if (!canvas || !canvas.parentElement) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
};

onMounted(() => {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  animId = requestAnimationFrame(loop);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCanvas);
  if (animId) cancelAnimationFrame(animId);
});
</script>

<style scoped>
.biomechanical-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
```

---

## 5. CRITÉRIOS DE ACEITAÇÃO
1. O canvas redimensiona dinamicamente mantendo alinhamento perfeito com o vídeo subjacente.
2. A órbita do pé desenha um percurso suave em elipse à volta do eixo pedaleiro conforme o ciclista pedala.
3. O ângulo do joelho é atualizado frame a frame com destaque verde na faixa ergonómica de 145° a 155°.
