<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div>
    <div class="controls">
      <label>Resolução:
        <select v-model="pendingResolution">
          <option value="640x480">640 x 480</option>
          <option value="1280x720">1280 x 720</option>
        </select>
      </label>
      <label>Zoom:
        <select v-model="pendingZoom">
          <option v-for="z in zoomOptions" :key="z" :value="z">{{ z }}x</option>
        </select>
      </label>
      <button @click="applySettings" class="apply-btn">Aplicar</button>
      <button @click="toggleAnalysis" class="analysis-btn">
        {{ analyzing ? 'Pausar Análise' : 'Iniciar Análise' }}
      </button>
      <label>Esquerdo:
        <input type="checkbox" v-model="leftProfile" />
      </label>
      <label>Direito:
        <input type="checkbox" v-model="rightProfile" />
      </label>
    </div>
    <div class="camera-container" ref="container">
      <video ref="video" autoplay muted playsinline></video>
      <canvas ref="canvas"></canvas>
    </div>
    <div class="angle-list">
      <div v-for="(val, name) in angles" :key="name" class="angle-item">
        <span :style="{ color: val.correct ? 'lime' : 'red' }">
          {{ name.replace('_', ' ') }}:
        </span>
        <span>{{ Math.round(val.angle) }}°</span>
      </div>
    </div>
  </div>
</template>
<script>
import { Pose, POSE_CONNECTIONS } from '@mediapipe/pose';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors } from '@mediapipe/drawing_utils';

export default {
  data() {
    return {
      // settings
      resolution: '640x480',
      pendingResolution: '640x480',
      zoom: 1,
      pendingZoom: 1,
      zoomOptions: [1, 1.5, 2, 3],
      analyzing: false,
      angles: {},
      leftProfile: false,
      rightProfile: false
    };
  },
  mounted() {
    this.video = this.$refs.video;
    this.canvas = this.$refs.canvas;
    this.ctx = this.canvas.getContext('2d');
    const [w, h] = this.resolution.split('x').map(Number);
    this.canvas.width = this.video.width = w;
    this.canvas.height = this.video.height = h;

    const pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
    pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    pose.onResults(this.onResults);

    const camera = new Camera(this.video, {
      onFrame: async () => { await pose.send({ image: this.video }); },
      width: w, height: h
    });
    camera.start();
  },
  watch: {
    resolution(newRes) {
      // also update pendingResolution
      this.pendingResolution = newRes;
    },
    pendingResolution(newRes) {
      const [width, height] = newRes.split('x').map(Number);
      this.canvas.width = this.video.width = width;
      this.canvas.height = this.video.height = height;
    }
  },
  methods: {
    applySettings() {
      // apply resolution
      this.resolution = this.pendingResolution;
      const [w, h] = this.resolution.split('x').map(Number);
      this.canvas.width = this.video.width = w;
      this.canvas.height = this.video.height = h;
      // apply zoom
      this.zoom = this.pendingZoom;
      this.$refs.container.style.transform = `scale(${this.zoom})`;
    },
    toggleAnalysis() {
      this.analyzing = !this.analyzing;
    },
    onResults(results) {
      // draw video frame
      this.ctx.save();
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(results.image, 0, 0, this.canvas.width, this.canvas.height);
      if (!this.analyzing) { this.ctx.restore(); return; }
      const lm = results.poseLandmarks;
      if (!lm) { this.ctx.restore(); return; }
      // draw skeleton or profile for selected side
      // definir conjuntos de juntas e thresholds
      const defaultJoints = {
        cotovelo_direito: [11,13,15], cotovelo_esquerdo: [12,14,16],
        ombro_direito: [13,11,23], ombro_esquerdo: [14,12,24],
        quadril_direito: [11,23,25], quadril_esquerdo: [12,24,26],
        joelho_direito: [23,25,27], joelho_esquerdo: [24,26,28],
        tornozelo_direito: [25,27,31], tornozelo_esquerdo: [26,28,32]
      };
      const defaultThresholds = { joelho: [70,110], tornozelo: [80,110], cotovelo: [150,175], ombro: [40,60], quadril: [40,60] };
      const leftProfileJoints = { cotovelo_esquerdo: [12,14,16], joelho_esquerdo: [24,26,28], tornozelo_esquerdo: [26,28,32], pulso_esquerdo: [14,16,18] };
      const rightProfileJoints = { cotovelo_direito: [11,13,15], joelho_direito: [23,25,27], tornozelo_direito: [25,27,31], pulso_direito: [13,15,17] };
      const profileThresholds = { cotovelo: [150,180], joelho: [150,180], tornozelo: [80,100], pulso: [150,180] };
      // selecionar conjuntos conforme perfil
      let jointsToUse = defaultJoints;
      let thresholdsToUse = defaultThresholds;
      if (this.leftProfile !== this.rightProfile) {
        if (this.leftProfile) { jointsToUse = leftProfileJoints; thresholdsToUse = profileThresholds; }
        else { jointsToUse = rightProfileJoints; thresholdsToUse = profileThresholds; }
      }

      const drawProfile = (sideJoints, landmarks) => {
        Object.values(sideJoints).forEach(([a, b, c]) => {
          const [xA, yA] = [landmarks[a].x * this.canvas.width, landmarks[a].y * this.canvas.height];
          const [xB, yB] = [landmarks[b].x * this.canvas.width, landmarks[b].y * this.canvas.height];
          const [xC, yC] = [landmarks[c].x * this.canvas.width, landmarks[c].y * this.canvas.height];
          this.ctx.beginPath(); this.ctx.moveTo(xA, yA); this.ctx.lineTo(xB, yB); this.ctx.lineTo(xC, yC);
          this.ctx.strokeStyle = '#00FF00'; this.ctx.lineWidth = 4; this.ctx.stroke();
          [[xA,yA],[xB,yB],[xC,yC]].forEach(([x,y]) => {
            this.ctx.beginPath(); this.ctx.arc(x,y,4,0,2*Math.PI); this.ctx.fillStyle='#FF0000'; this.ctx.fill();
          });
        });
      };
      if (this.leftProfile === this.rightProfile) {
        // nenhum ou ambos: corpo inteiro sem marcas faciais
        const bodyConnections = Array.from(POSE_CONNECTIONS).filter(([i,j]) => i >= 11 && j >= 11);
        drawConnectors(this.ctx, lm, bodyConnections, { color: '#00FF00', lineWidth: 4 });
      } else if (this.leftProfile) {
        drawProfile(leftProfileJoints, lm);
      } else if (this.rightProfile) {
        drawProfile(rightProfileJoints, lm);
      }

      // computar e exibir ângulos apenas das juntas selecionadas
      const newAngles = {};
      for (const [name,[a,b,c]] of Object.entries(jointsToUse)) {
        const lm = results.poseLandmarks;
        if (!lm[a]||!lm[b]||!lm[c]) continue;
        const angle = calculateAngle(lm[a],lm[b],lm[c]);
        const [min,max] = thresholdsToUse[name.split('_')[0]]||thresholdsToUse[name];
        const correct = angle>=min&&angle<=max;
        newAngles[name] = { angle, correct };
        if (this.analyzing) {
          const x = lm[b].x*this.canvas.width;
          const y = lm[b].y*this.canvas.height;
          this.ctx.fillStyle = correct?'lime':'red';
          this.ctx.font = 'bold 18px Arial';
          this.ctx.fillText(`${Math.round(angle)}°`, x, y-10);
        }
      }

      this.angles = newAngles;
      this.ctx.restore();
    }
  }
};

function calculateAngle(p1, p2, p3) {
  const a = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  const b = Math.sqrt(Math.pow(p2.x - p3.x, 2) + Math.pow(p2.y - p3.y, 2));
  const c = Math.sqrt(Math.pow(p1.x - p3.x, 2) + Math.pow(p1.y - p3.y, 2));
  return Math.acos((a*a + b*b - c*c) / (2*a*b)) * (180/Math.PI);
}
</script>
<style>
.camera-container {
  position: relative;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  overflow: hidden;
  border: 2px solid #00FF00;
  border-radius: 8px;
}

video, canvas {
  display: block;
  width: 100%;
  height: auto;
}

.video-container video,
video {
  display: none;
}

.controls {
  text-align: center;
  margin-bottom: 8px;
}

.apply-btn, .analysis-btn {
  background-color: #00FF00;
  color: #000;
  border: none;
  padding: 10px 20px;
  margin: 0 5px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 16px;
}

.apply-btn:hover, .analysis-btn:hover {
  background-color: #00CC00;
}

label {
  color: #00FF00;
  font-weight: bold;
  margin-right: 10px;
}

.angle-list {
  max-width: 720px;
  margin: 20px auto;
  padding: 0 10px;
  text-align: left;
}

.angle-item {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid #00FF00;
}

.angle-item:last-child {
  border-bottom: none;
}
</style>