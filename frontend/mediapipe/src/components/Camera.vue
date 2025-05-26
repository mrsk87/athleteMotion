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
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';

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
      angles: {}
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
      // draw skeleton
      drawConnectors(this.ctx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
      drawLandmarks(this.ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2, radius: 4 });

      // joints config
      const joints = {
        cotovelo_direito: [11, 13, 15], // shoulder, elbow, wrist
        cotovelo_esquerdo: [12, 14, 16],
        ombro_direito: [13, 11, 23], // elbow, shoulder, hip
        ombro_esquerdo: [14, 12, 24],
        quadril_direito: [11, 23, 25], // shoulder, hip, knee
        quadril_esquerdo: [12, 24, 26],
        joelho_direito: [23, 25, 27],
        joelho_esquerdo: [24, 26, 28],
        tornozelo_direito: [25, 27, 31], // knee, ankle, foot
        tornozelo_esquerdo: [26, 28, 32]
      };
      const thresholds = {
        joelho: [70, 110], tornozelo: [80, 110],
        cotovelo: [150, 175], ombro: [40, 60], quadril: [40, 60]
      };

      Object.entries(joints).forEach(([name, [a,b,c]]) => {
        const lm = results.poseLandmarks;
        if (!lm || !lm[a] || !lm[b] || !lm[c]) return;
        const angle = calculateAngle(lm[a], lm[b], lm[c]);
        const [min, max] = thresholds[name.split('_')[0]];
        const correct = angle >= min && angle <= max;
        this.angles[name] = { angle, correct };
        // draw angle text at landmark b
        const x = lm[b].x * this.canvas.width;
        const y = lm[b].y * this.canvas.height;
        this.ctx.fillStyle = correct ? 'lime' : 'red';
        this.ctx.font = 'bold 18px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`${Math.round(angle)}°`, x, y - 10);
        // draw label below
        this.ctx.fillStyle = correct ? 'lime' : 'red';
        this.ctx.font = '14px Arial';
        this.ctx.fillText(name.replace('_', ' '), x, y + 20);
      });

      // After drawing angles overlay, update list
      const newAngles = {};
      Object.entries(joints).forEach(([name, [a,b,c]]) => {
        const angle = calculateAngle(results.poseLandmarks[a], results.poseLandmarks[b], results.poseLandmarks[c]);
        const [min, max] = thresholds[name.split('_')[0]];
        newAngles[name] = { angle, correct: angle>=min&&angle<=max };
      });
      this.angles = newAngles;

      this.ctx.restore();
    },
    setResolution() {
      const [width, height] = this.resolution.split('x').map(Number);
      this.canvas.width = this.video.width = width;
      this.canvas.height = this.video.height = height;
    }
  }
};

// utility to calculate angle between three landmarks A-B-C at B
function calculateAngle(A, B, C) {
  const vBA = { x: A.x - B.x, y: A.y - B.y };
  const vBC = { x: C.x - B.x, y: C.y - B.y };
  const dot = vBA.x * vBC.x + vBA.y * vBC.y;
  const mag = Math.hypot(vBA.x, vBA.y) * Math.hypot(vBC.x, vBC.y);
  const cos = Math.max(-1, Math.min(1, dot / mag));
  return Math.acos(cos) * (180 / Math.PI);
}

</script>
<style scoped>
.camera-container { position: relative; width: 100%; max-width: 800px; margin: auto; }
video, canvas { position: absolute; top: 0; left: 0; width: 100%; height: auto; }
.analysis-btn, .apply-btn {
  margin: 10px;
  padding: 10px 20px;
  font-size: 16px;
  cursor: pointer;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 5px;
}
.controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 10px;
}
.angle-list {
  margin: 10px;
  font-size: 14px;
}
.angle-item {
  display: flex;
  justify-content: space-between;
}
</style>