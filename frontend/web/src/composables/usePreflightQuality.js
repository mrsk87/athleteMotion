/**
 * Composable de Avaliação Pré-Voo e Qualidade de Enquadramento.
 *
 * Responsabilidades:
 * - Avaliar luminosidade e contraste perceptual (ITU-R BT.601).
 * - Avaliar nitidez de imagem via variância do operador Laplaciano discreto.
 * - Avaliar horizonte artificial e nível da câmara (Roll e Yaw em graus).
 * - Avaliar enquadramento e visibilidade das articulações biomecânicas essenciais.
 * - Produzir um score composto determinístico de prontidão ("Go / No-Go").
 */
import { computed, ref } from 'vue';

export const PREFLIGHT_THRESHOLDS = Object.freeze({
  MIN_LUMINANCE: 45,
  MAX_LUMINANCE: 215,
  MIN_CONTRAST: 30,
  MIN_SHARPNESS_VARIANCE: 40,
  TARGET_SHARPNESS_VARIANCE: 90,
  MAX_PERMISSIBLE_ROLL_DEG: 3.0,
  TARGET_ROLL_DEG: 1.0,
  MIN_LANDMARK_CONFIDENCE: 0.55,
  MARGIN_BOUND_RATIO: 0.03, // 3% de margem das bordas do vídeo
});

/**
 * Calcula a luminosidade média e o contraste (desvio padrão) de um ImageData.
 * Amostra com passo dinâmico para garantir execução < 2ms em frames HD.
 *
 * @param {ImageData} imageData - Dados de píxeis do canvas.
 * @param {number} step - Passo de amostragem em píxeis (padrão: 8).
 * @returns {{ luminance: number, contrast: number, status: 'good' | 'too_dark' | 'too_bright' | 'low_contrast' }}
 */
export function computeLuminanceAndContrast(imageData, step = 8) {
  if (!imageData || !imageData.data || imageData.data.length === 0) {
    return { luminance: 0, contrast: 0, status: 'too_dark' };
  }

  const { data, width, height } = imageData;
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // Luminância relativa perceptual
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += lum;
      sumSq += lum * lum;
      count += 1;
    }
  }

  if (count === 0) {
    return { luminance: 0, contrast: 0, status: 'too_dark' };
  }

  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  const stdDev = Math.sqrt(variance);

  let status = 'good';
  if (mean < PREFLIGHT_THRESHOLDS.MIN_LUMINANCE) {
    status = 'too_dark';
  } else if (mean > PREFLIGHT_THRESHOLDS.MAX_LUMINANCE) {
    status = 'too_bright';
  } else if (stdDev < PREFLIGHT_THRESHOLDS.MIN_CONTRAST) {
    status = 'low_contrast';
  }

  return {
    luminance: Math.round(mean * 10) / 10,
    contrast: Math.round(stdDev * 10) / 10,
    status,
  };
}

/**
 * Calcula a nitidez através da variância do operador Laplaciano discreto de 4 vizinhos.
 * Alta variância indica contornos bem definidos e ausência de desfoque/motion-blur.
 *
 * @param {ImageData} imageData - Dados de píxeis do canvas.
 * @param {number} step - Passo de amostragem em píxeis (padrão: 4).
 * @returns {{ variance: number, isSharp: boolean, score: number }}
 */
export function computeLaplacianSharpness(imageData, step = 4) {
  if (!imageData || !imageData.data || imageData.width < 4 || imageData.height < 4) {
    return { variance: 0, isSharp: false, score: 0 };
  }

  const { data, width, height } = imageData;
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  // Convolução do Laplaciano discreto: [0, 1, 0; 1, -4, 1; 0, 1, 0]
  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const idxCenter = (y * width + x) * 4;
      const idxUp = ((y - step) * width + x) * 4;
      const idxDown = ((y + step) * width + x) * 4;
      const idxLeft = (y * width + (x - step)) * 4;
      const idxRight = (y * width + (x + step)) * 4;

      const lumCenter = 0.299 * data[idxCenter] + 0.587 * data[idxCenter + 1] + 0.114 * data[idxCenter + 2];
      const lumUp = 0.299 * data[idxUp] + 0.587 * data[idxUp + 1] + 0.114 * data[idxUp + 2];
      const lumDown = 0.299 * data[idxDown] + 0.587 * data[idxDown + 1] + 0.114 * data[idxDown + 2];
      const lumLeft = 0.299 * data[idxLeft] + 0.587 * data[idxLeft + 1] + 0.114 * data[idxLeft + 2];
      const lumRight = 0.299 * data[idxRight] + 0.587 * data[idxRight + 1] + 0.114 * data[idxRight + 2];

      const lap = lumUp + lumDown + lumLeft + lumRight - 4 * lumCenter;
      sum += lap;
      sumSq += lap * lap;
      count += 1;
    }
  }

  if (count === 0) {
    return { variance: 0, isSharp: false, score: 0 };
  }

  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  const isSharp = variance >= PREFLIGHT_THRESHOLDS.MIN_SHARPNESS_VARIANCE;

  // Score normalizado 0..100
  const score = Math.min(100, Math.round((variance / PREFLIGHT_THRESHOLDS.TARGET_SHARPNESS_VARIANCE) * 100));

  return {
    variance: Math.round(variance * 10) / 10,
    isSharp,
    score,
  };
}

/**
 * Avalia o enquadramento sagital e a integridade do esqueleto do ciclista.
 *
 * @param {Array<{ x: number, y: number, visibility?: number, score?: number }>} landmarks - Lista de landmarks normalizados ou em pixels.
 * @param {number} frameWidth - Largura do frame.
 * @param {number} frameHeight - Altura do frame.
 * @returns {{
 *   detected: boolean,
 *   isFramed: boolean,
 *   visibleJointsRatio: number,
 *   isNearEdge: boolean,
 *   orientation: 'left' | 'right' | 'unknown',
 *   missingCrucialJoints: string[],
 *   score: number
 * }}
 */
export function checkSkeletonFraming(landmarks, frameWidth = 1, frameHeight = 1) {
  if (!landmarks || landmarks.length < 17) {
    return {
      detected: false,
      isFramed: false,
      visibleJointsRatio: 0,
      isNearEdge: false,
      orientation: 'unknown',
      missingCrucialJoints: ['all'],
      score: 0,
    };
  }

  // Identificação de índices chave (suporta COCO/Halpe26 e MediaPipe)
  // COCO/Halpe: 0: nose, 5: l_sho, 6: r_sho, 11: l_hip, 12: r_hip, 13: l_knee, 14: r_knee, 15: l_ank, 16: r_ank
  const isMediaPipe = landmarks.length >= 33;
  const indices = isMediaPipe
    ? {
        nose: 0,
        lSho: 11,
        rSho: 12,
        lHip: 23,
        rHip: 24,
        lKnee: 25,
        rKnee: 26,
        lAnk: 27,
        rAnk: 28,
        lFoot: 31,
        rFoot: 32,
      }
    : {
        nose: 0,
        lSho: 5,
        rSho: 6,
        lHip: 11,
        rHip: 12,
        lKnee: 13,
        rKnee: 14,
        lAnk: 15,
        rAnk: 16,
        lFoot: 19,
        rFoot: 20,
      };

  const crucial = [
    { name: 'shoulder', left: indices.lSho, right: indices.rSho },
    { name: 'hip', left: indices.lHip, right: indices.rHip },
    { name: 'knee', left: indices.lKnee, right: indices.rKnee },
    { name: 'ankle', left: indices.lAnk, right: indices.rAnk },
  ];

  let visibleCount = 0;
  const missingCrucialJoints = [];
  let isNearEdge = false;

  const minConf = PREFLIGHT_THRESHOLDS.MIN_LANDMARK_CONFIDENCE;
  const margin = PREFLIGHT_THRESHOLDS.MARGIN_BOUND_RATIO;

  for (const item of crucial) {
    const pL = landmarks[item.left];
    const pR = landmarks[item.right];
    const confL = pL ? (pL.visibility ?? pL.score ?? 1) : 0;
    const confR = pR ? (pR.visibility ?? pR.score ?? 1) : 0;

    const bestPoint = confL >= confR ? pL : pR;
    const bestConf = Math.max(confL, confR);

    if (bestConf >= minConf && bestPoint) {
      visibleCount += 1;
      // Normalizar coordenadas se vierem em píxeis
      const nx = bestPoint.x > 1.0 ? bestPoint.x / frameWidth : bestPoint.x;
      const ny = bestPoint.y > 1.0 ? bestPoint.y / frameHeight : bestPoint.y;

      if (nx < margin || nx > 1 - margin || ny < margin || ny > 1 - margin) {
        isNearEdge = true;
      }
    } else {
      missingCrucialJoints.push(item.name);
    }
  }

  const visibleJointsRatio = visibleCount / crucial.length;

  // Determinar orientação da pedalada (se o nariz/cabeça está à esquerda ou à direita dos ombros)
  let orientation = 'unknown';
  const nose = landmarks[indices.nose];
  const lSho = landmarks[indices.lSho];
  const rSho = landmarks[indices.rSho];
  if (nose && (lSho || rSho)) {
    const shoX = (lSho?.x ?? rSho.x);
    if (nose.x < shoX) {
      orientation = 'left';
    } else if (nose.x > shoX) {
      orientation = 'right';
    }
  }

  const isFramed = visibleJointsRatio >= 0.75 && !isNearEdge;
  const score = Math.round(
    Math.max(0, visibleJointsRatio * 100 - (isNearEdge ? 30 : 0) - (missingCrucialJoints.length * 15))
  );

  return {
    detected: true,
    isFramed,
    visibleJointsRatio: Math.round(visibleJointsRatio * 100) / 100,
    isNearEdge,
    orientation,
    missingCrucialJoints,
    score,
  };
}

/**
 * Composable reativo para gestão do assistente de pré-voo.
 */
export function usePreflightQuality() {
  const rollDeg = ref(0.0);
  const yawDeg = ref(0.0);
  const isLevel = ref(true);
  const calibrationScalePxPerMm = ref(null);
  const calibrationUncertainty = ref(null);

  const lightStatus = ref('good');
  const luminanceVal = ref(120);
  const contrastVal = ref(50);

  const sharpnessScore = ref(85);
  const isSharp = ref(true);

  const framingDetected = ref(false);
  const isFramed = ref(false);
  const framingScore = ref(90);
  const cyclistOrientation = ref('right');
  const missingJoints = ref([]);

  // Score composto ponderado
  const overallScore = computed(() => {
    // Nível (Roll): 25 pts se <= 1°, decresce até 3°
    const rollErr = Math.abs(rollDeg.value);
    let levelPoints = 25;
    if (rollErr > PREFLIGHT_THRESHOLDS.MAX_PERMISSIBLE_ROLL_DEG) {
      levelPoints = 0;
    } else if (rollErr > PREFLIGHT_THRESHOLDS.TARGET_ROLL_DEG) {
      const factor = (PREFLIGHT_THRESHOLDS.MAX_PERMISSIBLE_ROLL_DEG - rollErr) / 2.0;
      levelPoints = Math.round(25 * factor);
    }

    // Luz e Contraste: 25 pts
    let lightPoints = 25;
    if (lightStatus.value === 'too_dark' || lightStatus.value === 'too_bright') {
      lightPoints = 5;
    } else if (lightStatus.value === 'low_contrast') {
      lightPoints = 15;
    }

    // Nitidez: 25 pts
    const sharpPoints = Math.round(Math.min(25, (sharpnessScore.value / 100) * 25));

    // Enquadramento: 25 pts
    const framePoints = Math.round(Math.min(25, (framingScore.value / 100) * 25));

    return levelPoints + lightPoints + sharpPoints + framePoints;
  });

  const readinessStatus = computed(() => {
    if (overallScore.value >= 75) return 'ready';
    if (overallScore.value >= 50) return 'acceptable';
    return 'not_ready';
  });

  /**
   * Avalia um fotograma do canvas com amostragem rápida.
   */
  function evaluateFrame(canvas, landmarks = null, externalRoll = null, externalScale = null) {
    if (!canvas || !canvas.getContext) return;

    try {
      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;
      if (width === 0 || height === 0) return;

      const imgData = ctx.getImageData(0, 0, width, height);

      // 1. Luz & Contraste
      const light = computeLuminanceAndContrast(imgData, 10);
      luminanceVal.value = light.luminance;
      contrastVal.value = light.contrast;
      lightStatus.value = light.status;

      // 2. Nitidez
      const sharp = computeLaplacianSharpness(imgData, 6);
      sharpnessScore.value = sharp.score;
      isSharp.value = sharp.isSharp;

      // 3. Horizonte / Nível
      if (externalRoll !== null && Number.isFinite(externalRoll)) {
        rollDeg.value = Math.round(externalRoll * 10) / 10;
        isLevel.value = Math.abs(rollDeg.value) <= PREFLIGHT_THRESHOLDS.TARGET_ROLL_DEG;
      }

      // Escala métrica se fornecida
      if (externalScale !== null) {
        calibrationScalePxPerMm.value = externalScale.pxPerMm ?? null;
        calibrationUncertainty.value = externalScale.uncertainty ?? null;
      }

      // 4. Enquadramento
      if (landmarks) {
        const frameCheck = checkSkeletonFraming(landmarks, width, height);
        framingDetected.value = frameCheck.detected;
        isFramed.value = frameCheck.isFramed;
        framingScore.value = frameCheck.score;
        cyclistOrientation.value = frameCheck.orientation;
        missingJoints.value = frameCheck.missingCrucialJoints;
      }
    } catch {
      // Ignorar erros de cross-origin ou canvas desligado
    }
  }

  function setSimulatedLevel(roll, yaw = 0) {
    rollDeg.value = roll;
    yawDeg.value = yaw;
    isLevel.value = Math.abs(roll) <= PREFLIGHT_THRESHOLDS.TARGET_ROLL_DEG;
  }

  return {
    rollDeg,
    yawDeg,
    isLevel,
    calibrationScalePxPerMm,
    calibrationUncertainty,
    lightStatus,
    luminanceVal,
    contrastVal,
    sharpnessScore,
    isSharp,
    framingDetected,
    isFramed,
    framingScore,
    cyclistOrientation,
    missingJoints,
    overallScore,
    readinessStatus,
    evaluateFrame,
    setSimulatedLevel,
  };
}
