/**
 * Fotograma ANOTADO para o GIF animado (AnnotatedGifFrame).
 *
 * PORQUÊ UM MÓDULO SEPARADO:
 * O GIF tem de mostrar o corpo COM os traços do MediaPipe — esqueleto colorido por conformidade,
 * guias de correção e o valor angular em cada articulação. Se se capturar o que estiver no canvas
 * visível, o GIF sai sem traço nenhum (durante a análise integral o canvas nem sequer é
 * redesenhado) ou com um esqueleto de outro instante (desalinhado do fotograma exportado).
 *
 * Aqui a composição é explícita e usa exatamente a mesma camada que o utilizador vê ao vivo:
 *   1. imagem do vídeo (espelhada se a pré-visualização estiver espelhada);
 *   2. traços da pose DAQUELE fotograma (marcos passados à mão, não o estado ao vivo).
 *
 * O módulo é puro em relação ao componente: recebe o contexto 2D e o vídeo, não toca no Vue nem
 * em refs. Assim pode ser verificado sem navegador (`npm run verify:full-analysis`), com um
 * contexto 2D falso que grava o que foi desenhado.
 */
import { CanvasOverlayRenderer } from './canvasOverlayRenderer.js';

/**
 * Desenha os traços do corpo (esqueleto + guias + valores angulares) com os marcos indicados.
 *
 * É a camada comum ao overlay ao vivo e ao fotograma do GIF: qualquer melhoria no desenho
 * aparece nos dois sítios, e o GIF nunca pode divergir do que o utilizador vê.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w - largura de destino em píxeis (resolução do vídeo)
 * @param {number} h - altura de destino em píxeis
 * @param {{ landmarks?:Array, angles?:Object, targets?:Object, side?:string, joints?:Object }} frame
 *   `joints` permite substituir os pontos das articulações (calibração ótica/manual ao vivo).
 * @returns {boolean} `true` se desenhou algo.
 */
export function drawAnnotatedOverlay(ctx, w, h, frame = {}) {
  const landmarks = frame.landmarks;
  if (!ctx || !landmarks) return false;

  const angles = frame.angles || {};
  const targets = frame.targets || {};
  const side = frame.side === 'right' ? 'right' : 'left';
  const isLeft = side === 'left';
  const joints = frame.joints || {};

  const isImage = Boolean(frame.isImage);

  CanvasOverlayRenderer.drawSkeleton(ctx, landmarks, w, h, angles, targets, side);
  if (frame.showGuides !== false) {
    CanvasOverlayRenderer.drawTargetGhostAndGuides(ctx, landmarks, w, h, angles, targets, side);
  }

  // Pontos resolvidos: quem chama pode trocá-los pelos pontos corrigidos (rastreio ótico/manual).
  const kneePt = joints.knee || landmarks[isLeft ? 25 : 26];
  const shoulderPt = joints.shoulder || landmarks[isLeft ? 11 : 12];
  const elbowPt = joints.elbow || landmarks[isLeft ? 13 : 14];
  const anklePt = joints.ankle || landmarks[isLeft ? 27 : 28];
  const hipPt = joints.hip || landmarks[isLeft ? 23 : 24];
  const headPt = joints.head || landmarks[isLeft ? 7 : 8] || landmarks[0];

  if (isImage) {
    if (kneePt) CanvasOverlayRenderer.drawMedianJointMarker(ctx, kneePt, 'Joelho', angles.joelho, targets.knee, w, h);
    if (shoulderPt) CanvasOverlayRenderer.drawMedianJointMarker(ctx, shoulderPt, 'Ombro', angles.costas, targets.back, w, h);
    if (elbowPt) CanvasOverlayRenderer.drawMedianJointMarker(ctx, elbowPt, 'Cotovelo', angles.braco, targets.elbow, w, h);
    if (anklePt) CanvasOverlayRenderer.drawMedianJointMarker(ctx, anklePt, 'Tornozelo', angles.tornozelo, targets.ankle, w, h);
    if (hipPt) CanvasOverlayRenderer.drawMedianJointMarker(ctx, hipPt, 'Anca', angles.anca, targets.hip, w, h);
    if (headPt) CanvasOverlayRenderer.drawMedianJointMarker(ctx, headPt, 'Cabeça', angles.cabeca, targets.head, w, h);
  } else {
    if (kneePt) CanvasOverlayRenderer.drawJointMarker(ctx, kneePt, angles.joelho, targets.knee, w, h);
    if (shoulderPt) CanvasOverlayRenderer.drawJointMarker(ctx, shoulderPt, angles.costas, targets.back, w, h);
    if (elbowPt) CanvasOverlayRenderer.drawJointMarker(ctx, elbowPt, angles.braco, targets.elbow, w, h);
    if (anklePt) CanvasOverlayRenderer.drawJointMarker(ctx, anklePt, angles.tornozelo, targets.ankle, w, h);
    if (headPt) CanvasOverlayRenderer.drawJointMarker(ctx, headPt, angles.cabeca, targets.head, w, h);
  }
  return true;
}

/**
 * Espelha marcos em X (o esqueleto tem de cair sobre o corpo espelhado). Não altera o original.
 */
export function mirrorLandmarks(landmarks) {
  if (!Array.isArray(landmarks)) return landmarks;
  return landmarks.map((lm) => ({ ...lm, x: 1 - lm.x }));
}

/**
 * Compõe UM fotograma anotado: imagem do vídeo + traços do MediaPipe do instante indicado.
 *
 * @param {CanvasRenderingContext2D} ctx - contexto de destino (canvas próprio do GIF)
 * @param {HTMLVideoElement} video - vídeo já posicionado no instante a exportar
 * @param {{ width:number, height:number, landmarks?:Array, angles?:Object, targets?:Object,
 *           side?:string, joints?:Object, flipped?:boolean }} options
 * @returns {boolean} `true` se o fotograma ficou composto.
 */
export function composeAnnotatedGifFrame(ctx, video, options = {}) {
  const w = Math.round(options.width || 0);
  const h = Math.round(options.height || 0);
  if (!ctx || !video || !w || !h) return false;
  // Vídeo ainda sem fotograma descodificado: `drawImage` daria uma imagem negra.
  if (typeof video.readyState === 'number' && video.readyState < 2) return false;

  const flipped = Boolean(options.flipped);
  const landmarks = flipped ? mirrorLandmarks(options.landmarks) : options.landmarks;

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  if (flipped) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    ctx.save();
  } else {
    ctx.drawImage(video, 0, 0, w, h);
  }
  drawAnnotatedOverlay(ctx, w, h, {
    landmarks,
    angles: options.angles,
    targets: options.targets,
    side: options.side,
    joints: options.joints,
  });
  ctx.restore();
  return Boolean(landmarks);
}

export default composeAnnotatedGifFrame;
