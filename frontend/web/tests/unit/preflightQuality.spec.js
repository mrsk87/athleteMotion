import { describe, it, expect } from 'vitest';
import {
  computeLuminanceAndContrast,
  computeLaplacianSharpness,
  checkSkeletonFraming,
  usePreflightQuality,
  PREFLIGHT_THRESHOLDS,
} from '@/composables/usePreflightQuality';

describe('usePreflightQuality - Algoritmos Biomecânicos de Pré-Voo', () => {
  describe('computeLuminanceAndContrast', () => {
    it('deteta imagem escura (sub-exposição)', () => {
      // 10x10 imagem preta
      const data = new Uint8ClampedArray(10 * 10 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 10;     // R
        data[i + 1] = 10; // G
        data[i + 2] = 10; // B
        data[i + 3] = 255;
      }
      const imgData = { data, width: 10, height: 10 };
      const res = computeLuminanceAndContrast(imgData, 1);
      expect(res.status).toBe('too_dark');
      expect(res.luminance).toBeLessThan(PREFLIGHT_THRESHOLDS.MIN_LUMINANCE);
    });

    it('deteta imagem sobre-exposta (estourada)', () => {
      const data = new Uint8ClampedArray(10 * 10 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 240;
        data[i + 1] = 240;
        data[i + 2] = 240;
        data[i + 3] = 255;
      }
      const imgData = { data, width: 10, height: 10 };
      const res = computeLuminanceAndContrast(imgData, 1);
      expect(res.status).toBe('too_bright');
      expect(res.luminance).toBeGreaterThan(PREFLIGHT_THRESHOLDS.MAX_LUMINANCE);
    });

    it('deteta boa iluminação e contraste adequado', () => {
      const data = new Uint8ClampedArray(10 * 10 * 4);
      for (let i = 0; i < data.length; i += 4) {
        const val = (i % 8 === 0) ? 50 : 180;
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
        data[i + 3] = 255;
      }
      const imgData = { data, width: 10, height: 10 };
      const res = computeLuminanceAndContrast(imgData, 1);
      expect(res.status).toBe('good');
      expect(res.contrast).toBeGreaterThanOrEqual(PREFLIGHT_THRESHOLDS.MIN_CONTRAST);
    });
  });

  describe('computeLaplacianSharpness', () => {
    it('reporta variância zero para imagem homogénea (desfocada/plana)', () => {
      const data = new Uint8ClampedArray(16 * 16 * 4);
      data.fill(128);
      const imgData = { data, width: 16, height: 16 };
      const res = computeLaplacianSharpness(imgData, 2);
      expect(res.isSharp).toBe(false);
      expect(res.variance).toBe(0);
      expect(res.score).toBe(0);
    });

    it('reporta alta variância para imagem com contornos contrastados (nítida)', () => {
      const data = new Uint8ClampedArray(16 * 16 * 4);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const idx = (y * 16 + x) * 4;
          const val = (x % 2 === 0) ? 20 : 230;
          data[idx] = val;
          data[idx + 1] = val;
          data[idx + 2] = val;
          data[idx + 3] = 255;
        }
      }
      const imgData = { data, width: 16, height: 16 };
      const res = computeLaplacianSharpness(imgData, 1);
      expect(res.isSharp).toBe(true);
      expect(res.variance).toBeGreaterThan(PREFLIGHT_THRESHOLDS.MIN_SHARPNESS_VARIANCE);
      expect(res.score).toBeGreaterThan(50);
    });
  });

  describe('checkSkeletonFraming', () => {
    it('retorna não detetado se marcos estiverem vazios ou insuficientes', () => {
      const res = checkSkeletonFraming([], 640, 480);
      expect(res.detected).toBe(false);
      expect(res.isFramed).toBe(false);
      expect(res.score).toBe(0);
    });

    it('aprova enquadramento completo e deteta orientação sagital para a direita', () => {
      // 26 marcos COCO/Halpe simulando ciclista de perfil virado para a direita
      const landmarks = Array.from({ length: 26 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
      // Nose mais à direita que ombro
      landmarks[0] = { x: 0.65, y: 0.25, visibility: 0.95 }; // nose
      landmarks[5] = { x: 0.50, y: 0.30, visibility: 0.90 }; // l_sho
      landmarks[6] = { x: 0.50, y: 0.30, visibility: 0.90 }; // r_sho
      landmarks[11] = { x: 0.40, y: 0.50, visibility: 0.90 }; // l_hip
      landmarks[13] = { x: 0.45, y: 0.70, visibility: 0.90 }; // l_knee
      landmarks[15] = { x: 0.45, y: 0.88, visibility: 0.90 }; // l_ank

      const res = checkSkeletonFraming(landmarks, 1.0, 1.0);
      expect(res.detected).toBe(true);
      expect(res.isFramed).toBe(true);
      expect(res.orientation).toBe('right');
      expect(res.isNearEdge).toBe(false);
      expect(res.missingCrucialJoints).toHaveLength(0);
      expect(res.score).toBeGreaterThanOrEqual(75);
    });

    it('alerta se atleta estiver cortado junto às bordas do frame', () => {
      const landmarks = Array.from({ length: 26 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
      // Ponto na margem extrema (0.01 < 0.03 margin)
      landmarks[15] = { x: 0.01, y: 0.88, visibility: 0.90 };

      const res = checkSkeletonFraming(landmarks, 1.0, 1.0);
      expect(res.isNearEdge).toBe(true);
      expect(res.isFramed).toBe(false);
    });
  });

  describe('usePreflightQuality - Gestão do Estado Composto', () => {
    it('calcula score de prontidão ponderado e readinessStatus', () => {
      const preflight = usePreflightQuality();

      // Setup ideal
      preflight.setSimulatedLevel(0.4); // Roll de 0.4° <= 1.0° (25 pontos)
      preflight.lightStatus.value = 'good'; // 25 pontos
      preflight.sharpnessScore.value = 90; // ~23 pontos
      preflight.framingScore.value = 95; // ~24 pontos

      expect(preflight.isLevel.value).toBe(true);
      expect(preflight.overallScore.value).toBeGreaterThanOrEqual(85);
      expect(preflight.readinessStatus.value).toBe('ready');
    });

    it('penaliza câmara excessivamente inclinada (> 3.0°)', () => {
      const preflight = usePreflightQuality();
      preflight.setSimulatedLevel(4.2); // Roll de 4.2°
      expect(preflight.isLevel.value).toBe(false);
      expect(preflight.overallScore.value).toBeLessThanOrEqual(75);
    });
  });
});
