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
  videoElement: {
    type: Object,
    default: null,
  },
  side: {
    type: String,
    default: 'left', // 'left' | 'right' | 'both'
  },
});

const canvasRef = ref(null);
const { addPoint, clearTrail, drawOrbitTrail } = useFootOrbitTrail(150);

// Segmentos anatómicos a ligar no perfil sagital
const SIDE_BONES = [
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

const SIDE_PARTS = ['ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'toe'];

/**
 * Resolve com segurança o landmark de um determinado lado ('left' ou 'right').
 * Dá prioridade a chaves prefixadas e faz fallback elegante para aliases canónicos.
 */
const getSideLandmark = (sideKey, part) => {
  if (!props.landmarks) return null;
  const prefixedKey = `${sideKey}_${part}`;
  if (props.landmarks[prefixedKey] && props.landmarks[prefixedKey].visibility > 0.25) {
    return props.landmarks[prefixedKey];
  }
  // Se o perfil atual corresponder ao solicitado ou se apenas existirem canónicos
  if (props.side === sideKey || (props.side === 'both' && sideKey === 'left')) {
    if (props.landmarks[part] && props.landmarks[part].visibility > 0.25) {
      return props.landmarks[part];
    }
  }
  return null;
};

// Observar chegada de novas coordenadas de pé/tornozelo do lado ativo
watch(
  () => {
    const activeSide = props.side === 'right' ? 'right' : 'left';
    return getSideLandmark(activeSide, 'ankle');
  },
  (ankle) => {
    if (ankle && ankle.visibility > 0.3) {
      addPoint(ankle.x, ankle.y, props.timestampMs);
    }
  }
);

// Limpar rastro da órbita quando o utilizador alternar o lado observado
watch(
  () => props.side,
  () => {
    clearTrail();
  }
);

/**
 * Calcula o retângulo exato onde o vídeo está a ser projetado dentro do canvas.
 * Trata o 'object-fit: contain' com precisão matemática em vídeos verticais (9:16), 4:3 e 16:9.
 */
const getVideoRenderRect = (canvasW, canvasH) => {
  const v = props.videoElement || canvasRef.value?.parentElement?.querySelector('video');
  if (!v || !v.videoWidth || !v.videoHeight) {
    return { x: 0, y: 0, w: canvasW, h: canvasH };
  }
  const videoAspect = v.videoWidth / v.videoHeight;
  const canvasAspect = canvasW / canvasH;

  if (canvasAspect > videoAspect) {
    // Canvas é mais largo que o vídeo -> barras pretas à esquerda e à direita
    const renderW = canvasH * videoAspect;
    const offsetX = (canvasW - renderW) / 2;
    return { x: offsetX, y: 0, w: renderW, h: canvasH };
  } else {
    // Canvas é mais alto que o vídeo -> barras pretas no topo e no fundo
    const renderH = canvasW / videoAspect;
    const offsetY = (canvasH - renderH) / 2;
    return { x: 0, y: offsetY, w: canvasW, h: renderH };
  }
};

const renderFrame = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const rect = getVideoRenderRect(w, h);
  const toX = (normX) => rect.x + normX * rect.w;
  const toY = (normY) => rect.y + normY * rect.h;

  // 1. Desenhar Motion Trail da Órbita do Pé mapeada sobre o vídeo real
  if (props.showTrail) {
    drawOrbitTrail(ctx, w, h, props.timestampMs, rect);
  }

  // 2. Desenhar Esqueleto Biomecânico do perfil selecionado
  if (props.showSkeleton && props.landmarks) {
    ctx.save();

    const sidesToRender = props.side === 'right' ? ['right'] : props.side === 'both' ? ['left', 'right'] : ['left'];

    for (const sideKey of sidesToRender) {
      const isContralateral = props.side === 'both' && sideKey === 'right';
      const boneColor = isContralateral ? '#fbbf24' : '#ffffff';
      const jointColor = isContralateral ? '#f59e0b' : '#38bdf8';
      const kneeColor = isContralateral ? '#eab308' : '#10b981';

      // Desenhar ossos
      ctx.strokeStyle = boneColor;
      ctx.lineWidth = isContralateral ? 2 : 3;
      ctx.lineCap = 'round';

      for (const [p1Name, p2Name] of SIDE_BONES) {
        const p1 = getSideLandmark(sideKey, p1Name);
        const p2 = getSideLandmark(sideKey, p2Name);
        if (p1 && p2) {
          ctx.beginPath();
          ctx.moveTo(toX(p1.x), toY(p1.y));
          ctx.lineTo(toX(p2.x), toY(p2.y));
          ctx.stroke();
        }
      }

      // Desenhar juntas anatómicas do lado selecionado
      for (const part of SIDE_PARTS) {
        const p = getSideLandmark(sideKey, part);
        if (p) {
          const isKnee = part === 'knee';
          ctx.fillStyle = isKnee ? kneeColor : jointColor;
          ctx.beginPath();
          ctx.arc(toX(p.x), toY(p.y), isKnee ? 6 : 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // Se ambos os lados estiverem visíveis, ligar pontes transversais entre ombros e ancas
    if (props.side === 'both') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);

      const lShoulder = getSideLandmark('left', 'shoulder');
      const rShoulder = getSideLandmark('right', 'shoulder');
      if (lShoulder && rShoulder) {
        ctx.beginPath();
        ctx.moveTo(toX(lShoulder.x), toY(lShoulder.y));
        ctx.lineTo(toX(rShoulder.x), toY(rShoulder.y));
        ctx.stroke();
      }

      const lHip = getSideLandmark('left', 'hip');
      const rHip = getSideLandmark('right', 'hip');
      if (lHip && rHip) {
        ctx.beginPath();
        ctx.moveTo(toX(lHip.x), toY(lHip.y));
        ctx.lineTo(toX(rHip.x), toY(rHip.y));
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // 3. Renderizar Valores dos Ângulos junto às Articulações Ativas
    const activeSideKey = props.side === 'right' ? 'right' : 'left';
    const activeKnee = getSideLandmark(activeSideKey, 'knee');
    const activeHip = getSideLandmark(activeSideKey, 'hip');

    if (props.angles?.knee && activeKnee) {
      const angle = props.angles.knee;
      const isCompliant = angle >= 145.0 && angle <= 155.0;
      const kx = toX(activeKnee.x);
      const ky = toY(activeKnee.y);

      // Caixa de leitura de alto contraste
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(kx + 10, ky - 14, 58, 22, 4);
      } else {
        ctx.rect(kx + 10, ky - 14, 58, 22);
      }
      ctx.fill();
      ctx.strokeStyle = isCompliant ? '#10b981' : '#f59e0b';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.fillStyle = isCompliant ? '#10b981' : '#f59e0b';
      ctx.font = 'bold 13px Inter, monospace';
      ctx.fillText(`${angle}°`, kx + 16, ky + 2);
    }

    if (props.angles?.torso && activeHip) {
      const hx = toX(activeHip.x);
      const hy = toY(activeHip.y);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(hx - 88, hy - 20, 84, 22, 4);
      } else {
        ctx.rect(hx - 88, hy - 20, 84, 22);
      }
      ctx.fill();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 12px Inter, monospace';
      ctx.fillText(`Tronco: ${props.angles.torso}°`, hx - 82, hy - 4);
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
  if (canvas.width !== rect.width || canvas.height !== rect.height) {
    canvas.width = rect.width;
    canvas.height = rect.height;
  }
};

let resizeObserver = null;

onMounted(() => {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  if (canvasRef.value?.parentElement && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(canvasRef.value.parentElement);
  }
  animId = requestAnimationFrame(loop);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeCanvas);
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (animId) cancelAnimationFrame(animId);
  clearTrail();
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
