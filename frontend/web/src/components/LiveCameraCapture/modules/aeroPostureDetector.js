/**
 * Detetor de Postura Aero (AeroPostureDetector).
 *
 * PORQUÊ:
 * Numa posição aero os cotovelos ficam fletidos sobre as almofadas, o antebraço fica
 * praticamente horizontal e o tronco fica muito mais plano. Sem esta deteção, a aplicação
 * julga essa posição com os alvos de estrada e emite ordens erradas
 * ("braços bloqueados", "encurtar avanço", "recuar o selim pelo KOPS").
 *
 * COMO (sinais geométricos, agnósticos da câmara e da escala):
 * 1. **Inclinação do tronco** (ombro→anca face à horizontal): aero ≤ 35°, estrada ≥ 40°.
 * 2. **Flexão do cotovelo** (ombro-cotovelo-punho): aero ≤ 130° (prática de fit), estrada ≥ 140°.
 * 3. **Inclinação do antebraço** (cotovelo→punho face à horizontal): aero ≤ 25° (referência 0–20°).
 * 4. **Cotovelo sob o ombro com o antebraço à frente**: em aerobars o cotovelo fica claramente
 *    abaixo do ombro e o antebraço segue plano à frente — medido em frações do comprimento do
 *    tronco, logo independente da distância da câmara. (Este sinal é o que separa "aero" de
 *    "atleta de pé ao lado da bicicleta": nos dois casos o braço desce, mas só em aero ele
 *    desce e depois segue plano.)
 *
 * As decisões de limiar são de prática de fit; a fonte dos alvos está em `postureMode.js`.
 * Nada aqui prescreve: o detetor só decide *que perfil aplicar* e quando perguntar ao utilizador.
 */

import { POSTURE_AERO, POSTURE_UPRIGHT, isValidPosture } from './postureMode.js';

/** Medições mínimas para haver deteção automática. */
export const MIN_SAMPLES_FOR_DETECTION = 6;

/** Pesos dos sinais (somam 1) — o tronco é o sinal mais estável em vídeo lateral. */
export const SIGNAL_WEIGHTS = {
  torso: 0.35,
  elbow: 0.3,
  forearm: 0.15,
  elbowUnderShoulder: 0.2,
};

/** Limiares: a partir de que valor é que cada sinal "vota" aero ou estrada. */
export const POSTURE_THRESHOLDS = {
  torso: { aeroMax: 35, uprightMin: 40 },
  elbow: { aeroMax: 130, uprightMin: 140 },
  forearm: { aeroMax: 25 },
  elbowUnderShoulder: { belowRatio: 0.25, aheadRatio: -0.05, flatRatio: 0.3 },
};

/** Confiança mínima para aplicar a postura SEM perguntar. */
export const AUTO_SWITCH_CONFIDENCE = 0.75;
/** A partir desta pontuação aero existe motivo para perguntar ao utilizador. */
export const ASK_CONFIDENCE = 0.3;

/** Mediana (ignora nulos). */
function median(values) {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

/** Média (ignora nulos). */
function mean(values) {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

/**
 * Geometria do braço a partir de landmarks normalizados (0–1).
 * Devolve inclinações e razões medidas em frações do comprimento do tronco,
 * para que a distância à câmara não altere o resultado.
 */
export function analyzeArmGeometry(points) {
  if (!points) return null;
  const { shoulderPt, elbowPt, wristPt, hipPt } = points;
  if (!shoulderPt || !elbowPt || !wristPt || !hipPt) return null;

  const torsoLength = Math.hypot(shoulderPt.x - hipPt.x, shoulderPt.y - hipPt.y);
  if (!Number.isFinite(torsoLength) || torsoLength <= 0.01) return null;

  const forearmDx = Math.abs(wristPt.x - elbowPt.x);
  const forearmDy = Math.abs(wristPt.y - elbowPt.y);
  const forearmInclinationDeg = Math.round((Math.atan2(forearmDy, forearmDx || 1e-6) * 180) / Math.PI);

  // Quanto o cotovelo está ABAIXO do ombro (em frações do tronco); em video, y cresce para baixo.
  const elbowDropRatio = (elbowPt.y - shoulderPt.y) / torsoLength;
  // Sentido de avanço do ciclista (horizontal): ombro/punho à frente da anca
  const dxTorso = shoulderPt.x - hipPt.x;
  const dxArm = wristPt.x - shoulderPt.x;
  const heading = Math.abs(dxTorso) >= 0.03 ? (dxTorso >= 0 ? 1 : -1) : (dxArm >= 0 ? 1 : -1);
  // Quanto o cotovelo está À FRENTE do ombro no sentido do movimento (frações do tronco)
  const elbowAheadRatio = ((elbowPt.x - shoulderPt.x) * heading) / torsoLength;

  return {
    forearmInclinationDeg,
    elbowDropRatio: Math.round(elbowDropRatio * 100) / 100,
    elbowAheadRatio: Math.round(elbowAheadRatio * 100) / 100,
  };
}

/** Um sinal individual: a que postura vota e quanto pesa. */
function buildSignal(key, value, verdict) {
  return { key, value, verdict, weight: SIGNAL_WEIGHTS[key] };
}

/**
 * Constrói os sinais a partir de valores já agregados (medianas).
 */
export function buildSignals({ torso, elbow, forearmInclinationDeg, elbowDropRatio, elbowAheadRatio }) {
  const signals = [];

  if (typeof torso === 'number') {
    if (torso <= POSTURE_THRESHOLDS.torso.aeroMax) signals.push(buildSignal('torso', torso, 'aero'));
    else if (torso >= POSTURE_THRESHOLDS.torso.uprightMin) signals.push(buildSignal('torso', torso, 'upright'));
    else signals.push(buildSignal('torso', torso, 'neutral'));
  }

  if (typeof elbow === 'number') {
    if (elbow <= POSTURE_THRESHOLDS.elbow.aeroMax) signals.push(buildSignal('elbow', elbow, 'aero'));
    else if (elbow >= POSTURE_THRESHOLDS.elbow.uprightMin) signals.push(buildSignal('elbow', elbow, 'upright'));
    else signals.push(buildSignal('elbow', elbow, 'neutral'));
  }

  if (typeof forearmInclinationDeg === 'number') {
    if (forearmInclinationDeg <= POSTURE_THRESHOLDS.forearm.aeroMax) {
      signals.push(buildSignal('forearm', forearmInclinationDeg, 'aero'));
    } else signals.push(buildSignal('forearm', forearmInclinationDeg, 'upright'));
  }

  if (
    typeof elbowDropRatio === 'number' &&
    typeof elbowAheadRatio === 'number' &&
    typeof forearmInclinationDeg === 'number'
  ) {
    const isAeroShape =
      elbowDropRatio >= POSTURE_THRESHOLDS.elbowUnderShoulder.belowRatio &&
      elbowAheadRatio >= POSTURE_THRESHOLDS.elbowUnderShoulder.aheadRatio &&
      forearmInclinationDeg <= POSTURE_THRESHOLDS.elbowUnderShoulder.flatRatio * 100;
    signals.push(
      buildSignal(
        'elbowUnderShoulder',
        Math.round(elbowDropRatio * 100) / 100,
        isAeroShape ? 'aero' : 'neutral',
      ),
    );
  }

  return signals;
}

/**
 * Deteção a partir de várias frames.
 *
 * @param {Object} params
 * @param {Array<{costas?:number, braco?:number, points?:Object}>} params.frames
 * @param {string} [params.confirmedPosture] postura escolhida/confirmada pelo utilizador
 * @param {boolean} [params.isManualChoice] a postura atual foi escolhida à mão?
 * @returns {Object} resultado com `posture`, `action` ('auto' | 'ask' | 'keep'), `confidence`, `reasons`
 */
export function detectAeroPosture({ frames = [], confirmedPosture = null, isManualChoice = false } = {}) {
  const usable = frames.filter((f) => f && (typeof f.costas === 'number' || typeof f.braco === 'number'));
  const empty = {
    posture: isValidPosture(confirmedPosture) ? confirmedPosture : POSTURE_UPRIGHT,
    action: 'keep',
    confidence: 0,
    aeroScore: 0,
    uprightScore: 0,
    samples: usable.length,
    sufficient: false,
    signals: [],
    reasons: [],
  };
  if (usable.length < MIN_SAMPLES_FOR_DETECTION) return empty;

  const torso = median(usable.map((f) => f.costas));
  const elbow = median(usable.map((f) => f.braco));

  const geometries = usable.map((f) => analyzeArmGeometry(f.points)).filter(Boolean);
  const forearmInclinationDeg = median(geometries.map((g) => g.forearmInclinationDeg));
  const elbowDropRatio = mean(geometries.map((g) => g.elbowDropRatio));
  const elbowAheadRatio = mean(geometries.map((g) => g.elbowAheadRatio));

  const signals = buildSignals({ torso, elbow, forearmInclinationDeg, elbowDropRatio, elbowAheadRatio });
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0) || 1;
  const aeroScore = Math.round((signals.filter((s) => s.verdict === 'aero').reduce((sum, s) => sum + s.weight, 0) / totalWeight) * 100) / 100;
  const uprightScore = Math.round((signals.filter((s) => s.verdict === 'upright').reduce((sum, s) => sum + s.weight, 0) / totalWeight) * 100) / 100;

  // Um sinal "forte" é o tronco ou a combinação cotovelo+antebraço: evita perguntar
  // por um cotovelo dobrado isolado (que também acontece em estrada com má afinação).
  const hasStrongAeroEvidence = signals.some(
    (s) =>
      s.verdict === 'aero' &&
      (s.key === 'torso' || s.key === 'forearm' || s.key === 'elbowUnderShoulder'),
  );

  const manual = isValidPosture(confirmedPosture) ? confirmedPosture : null;
  const isAeroNow = manual === POSTURE_AERO;

  let action = 'keep';
  let posture = manual || POSTURE_UPRIGHT;

  if (isAeroNow) {
    // Já está em aero: só se sugere voltar a estrada com evidência forte e contrária.
    if (uprightScore >= AUTO_SWITCH_CONFIDENCE && signals.some((s) => s.verdict === 'upright' && s.key === 'torso')) {
      action = 'ask';
      posture = POSTURE_AERO;
    }
  } else if (aeroScore >= AUTO_SWITCH_CONFIDENCE && hasStrongAeroEvidence) {
    // Evidência franca de aero.
    if (isManualChoice) {
      // Escolha manual: nunca sobrepor em silêncio, perguntar.
      action = 'ask';
      posture = manual || POSTURE_UPRIGHT;
    } else {
      action = 'auto';
      posture = POSTURE_AERO;
    }
  } else if (aeroScore >= ASK_CONFIDENCE && hasStrongAeroEvidence) {
    action = 'ask';
    posture = manual || POSTURE_UPRIGHT;
  }

  const reasons = signals.map((s) => describeSignal(s));

  return {
    posture,
    action,
    confidence: posture === POSTURE_AERO ? aeroScore : uprightScore,
    aeroScore,
    uprightScore,
    samples: usable.length,
    sufficient: true,
    measures: { torso, elbow, forearmInclinationDeg, elbowDropRatio, elbowAheadRatio },
    signals,
    reasons,
  };
}

/** Explicação legível de um sinal (pt), com o valor e o limiar usado. */
export function describeSignal(signal) {
  const t = POSTURE_THRESHOLDS;
  switch (signal.key) {
    case 'torso':
      return `Tronco ${Math.round(signal.value)}° face à horizontal (aero ≤ ${t.torso.aeroMax}°, estrada ≥ ${t.torso.uprightMin}°) → ${label(signal.verdict)}`;
    case 'elbow':
      return `Cotovelo ${Math.round(signal.value)}° (aero ≤ ${t.elbow.aeroMax}°, estrada ≥ ${t.elbow.uprightMin}°) → ${label(signal.verdict)}`;
    case 'forearm':
      return `Antebraço ${Math.round(signal.value)}° face à horizontal (aero ≤ ${t.forearm.aeroMax}°) → ${label(signal.verdict)}`;
    case 'elbowUnderShoulder':
      return `Cotovelo sob o ombro e antebraço à frente → ${label(signal.verdict)}`;
    default:
      return label(signal.verdict);
  }
}

function label(verdict) {
  if (verdict === 'aero') return 'indica AERO';
  if (verdict === 'upright') return 'indica estrada';
  return 'não decide';
}

export default { detectAeroPosture, analyzeArmGeometry, buildSignals, describeSignal };
