/**
 * Fusão CromaTrack: junta os marcadores coloridos detetados com os pontos do modelo de pose.
 *
 * Função pura sobre os seus argumentos (`state` entra e volta a sair) — é por isso verificável
 * com blobs sintéticos, sem câmara nenhuma (`scripts/verify-chroma.mjs`).
 *
 * Política de fusão (decisão de engenharia, ver `docs/CHROMA_TRACK_TASKS.md`):
 * - **Âncora suave**, nunca substituição cega: `p = (1-w)·pose + w·marcador`, com
 *   `w = pesoBase · qualidade`. Um marcador bom puxa o ponto; um marcador medíocre quase não mexe.
 * - O ponto do marcador está **na pele**, não no centro da articulação. O peso máximo é por isso
 *   < 1: preserva-se o modelo para o resto do esqueleto em vez de o quebrar.
 * - **Rejeição de saltos**: um blob longe do ponto previsto é descartado (pode ser uma peça de
 *   roupa da mesma cor). É preferível não usar marcador do que seguir um objeto errado.
 * - **Histerese**: o marcador precisa de ser visto em `confirmFrames` fotogramas para contar;
 *   se desaparece, mantém-se o valor por `holdFrames` e depois liberta-se (evita tremer).
 * - Sem marcador → devolve-se o ponto do modelo com confiança baixa (nunca um ponto inventado).
 */
import {
  CHROMA_JOINTS,
  landmarkIndexFor,
  paletteFor,
} from '../../../services/chroma/markerPalette.js';

/** Distância euclidiana entre dois pontos normalizados. */
export function distance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Estado inicial (vazio) da fusão. */
export function createChromaState() {
  return { joints: {} };
}

/**
 * Qualidade de um blob para uma articulação, em [0, 1].
 * Combina: forma (proximidade a disco), área face à esperada, e proximidade ao ponto previsto.
 */
export function blobQuality(blob, { targetRadiusRatio, frameWidth, proximity, proximityTolerance }) {
  if (!blob) return 0;

  const shape = Math.max(0, Math.min(1, blob.compactness));

  // Área esperada = disco com o raio-alvo (o marcador pode aparecer a 60%-200% do esperado).
  const expectedRadius = Math.max(1, targetRadiusRatio * frameWidth);
  const expectedArea = Math.PI * expectedRadius * expectedRadius;
  const areaRatio = blob.area / expectedArea;
  const areaScore = areaRatio <= 1 ? areaRatio : Math.max(0, 2 - areaRatio);

  const proximityScore =
    proximity === undefined || proximityTolerance <= 0
      ? 1
      : Math.max(0, 1 - proximity / proximityTolerance);

  return Math.max(0, Math.min(1, shape * 0.55 + areaScore * 0.25 + proximityScore * 0.2));
}

/**
 * Aplica os marcadores de um fotograma aos marcos do modelo de pose.
 *
 * @param {Object} state                        estado anterior (de `createChromaState`)
 * @param {Object|null} landmarks               marcos do modelo de pose (33), ou null
 * @param {Array<Object>} blobs                 blobs detetados no fotograma (normalizados [0..1])
 * @param {Object} [options]
 * @param {'left'|'right'} [options.side]
 * @param {Array<Object>} [options.markers]     paleta; por omissão a padrão
 * @param {boolean} [options.singleColor]       força a paleta de uma só cor
 * @param {number} [options.frameWidth]         largura em píxeis do fotograma reduzido
 * @param {number} [options.maxJump]            salto máximo aceite entre fotogramas (normalizado);
 *                                              é também a tolerância de proximidade da qualidade
 * @param {number} [options.blendWeight]        peso máximo do marcador (0..1)
 * @param {number} [options.smoothing]          alfa do filtro temporal do marcador (0..1)
 * @param {number} [options.confirmFrames]      fotogramas seguidos para confirmar o marcador
 * @param {number} [options.holdFrames]         fotogramas sem ver antes de libertar
 * @returns {{ points: Object, state: Object, report: Object }}
 */
export function applyChromaMarkers(state, landmarks, blobs, options = {}) {
  const {
    side = 'right',
    markers = paletteFor({ singleColor: Boolean(options.singleColor) }),
    frameWidth = 320,
    maxJump = 0.08,
    blendWeight = 0.85,
    smoothing = 0.55,
    confirmFrames = 2,
    holdFrames = 6,
  } = options;

  const previous = state && state.joints ? state.joints : {};
  const next = {};
  const points = {};
  const list = Array.isArray(blobs) ? blobs : [];

  // 1. Pares candidato (articulação → blob) dentro da tolerância de salto/proximidade.
  const candidates = [];
  const predicted = {};

  for (const marker of markers) {
    const joints = marker.resolveByProximity ? CHROMA_JOINTS : [marker.joint];
    for (const joint of joints) {
      const index = landmarkIndexFor(joint, side);
      const posePoint = landmarks && index !== null ? landmarks[index] : null;
      const prior = previous[joint];
      const anchor = prior && prior.hold > 0 ? { x: prior.x, y: prior.y } : posePoint;
      if (!posePoint && !prior) continue;

      predicted[joint] = anchor || posePoint;

      list.forEach((blob, blobIndex) => {
        // Um blob marcado com outra articulação nunca serve (cor é identidade, não sugestão).
        if (!marker.resolveByProximity && blob.markerJoint !== undefined && blob.markerJoint !== joint) {
          return;
        }
        const target = anchor || posePoint;
        const jump = distance(blob, target);
        if (jump > maxJump) return;
        candidates.push({ joint, blobIndex, blob, jump, index, posePoint, marker });
      });
    }
  }

  // 2. Atribuição um-a-um: o par mais próximo primeiro. Sem isto, dois joelhos podiam
  //    reclamar o mesmo blob em modo de uma só cor.
  candidates.sort((a, b) => a.jump - b.jump);
  const assignedJoints = new Set();
  const usedBlobs = new Set();

  const report = { detected: [], rejected: list.length, total: 0 };

  for (const candidate of candidates) {
    if (assignedJoints.has(candidate.joint) || usedBlobs.has(candidate.blobIndex)) continue;
    assignedJoints.add(candidate.joint);
    usedBlobs.add(candidate.blobIndex);

    const { joint, blob, index, posePoint, marker } = candidate;
    const prior = previous[joint] || { seen: 0, hold: 0 };
    const seen = prior.seen + 1;
    const confirmed = seen >= confirmFrames || prior.confirmed === true;
    const proximity = distance(blob, predicted[joint]);
    const quality = blobQuality(blob, {
      targetRadiusRatio: marker.targetRadiusRatio,
      frameWidth,
      proximity,
      proximityTolerance: maxJump,
    });

    // 3. Filtro temporal do próprio marcador (tira o tremor do blob, não a informação).
    const previousSmooth = prior.smooth || null;
    const smooth = previousSmooth
      ? { x: previousSmooth.x + (blob.x - previousSmooth.x) * smoothing, y: previousSmooth.y + (blob.y - previousSmooth.y) * smoothing }
      : { x: blob.x, y: blob.y };

    const weight = confirmed ? Math.max(0, Math.min(1, blendWeight * quality)) : 0;

    // 4. Âncora suave. Sem ponto de pose usa-se o marcador direto (não há alternativa melhor).
    const point = posePoint
      ? {
          x: posePoint.x * (1 - weight) + smooth.x * weight,
          y: posePoint.y * (1 - weight) + smooth.y * weight,
        }
      : { x: smooth.x, y: smooth.y };

    points[joint] = {
      x: point.x,
      y: point.y,
      source: weight >= 0.5 ? 'marker' : weight > 0 ? 'blend' : 'pose',
      weight,
      quality,
      confidence: Math.round(quality * 100),
      isChroma: true,
      confirmed,
      landmarkIndex: index,
    };

    next[joint] = { x: point.x, y: point.y, smooth, seen, hold: holdFrames, confirmed };
    report.detected.push(joint);
    report.total += 1;
  }

  // 5. Articulações sem marcador visível neste fotograma: mantém-se a memória por `holdFrames`
  //    e, enquanto isso, o ponto sai do modelo de pose com confiança baixa.
  for (const joint of CHROMA_JOINTS) {
    if (next[joint]) continue;
    const prior = previous[joint];
    const index = landmarkIndexFor(joint, side);
    const posePoint = landmarks && index !== null ? landmarks[index] : null;

    if (prior && prior.hold > 0) {
      next[joint] = { ...prior, seen: 0, hold: prior.hold - 1, confirmed: false };
    }
    if (posePoint) {
      points[joint] = {
        x: posePoint.x,
        y: posePoint.y,
        source: 'pose',
        weight: 0,
        quality: 0,
        confidence: 0,
        isChroma: false,
        confirmed: false,
        landmarkIndex: index,
      };
    }
  }

  return {
    points,
    state: { joints: next },
    report: { ...report, active: Object.keys(next).length },
  };
}
