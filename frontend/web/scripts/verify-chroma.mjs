/**
 * Verificação automática do CromaTrack (rastreio por marcadores cromáticos).
 *
 * Executar com:  npm run verify:chroma
 *
 * O que se prova, sem câmara e sem browser:
 *  1. A conversão RGB→HSV e o teste de intervalo (incluindo o vermelho que dá a volta no 0/180).
 *  2. A deteção de blobs em **fotogramas sintéticos**: um círculo verde em posição conhecida é
 *     encontrado na posição certa; cores diferentes são distinguidas; manchas alongadas e
 *     cinzentos são rejeitados.
 *  3. A fusão: âncora suave (nunca substituição cega), rejeição de saltos, histerese de
 *     confirmação, atribuição um-a-um e recuo para o modelo quando não há marcador.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rgbToHsv, matchesMarker, hueInRange } from '../src/services/chroma/hsvColorSpace.js';
import { findBlobs } from '../src/services/chroma/blobDetector.js';
import { detectMarkersInPixels } from '../src/services/chroma/markerDetection.js';
import { paletteFor, DEFAULT_MARKERS, CHROMA_JOINTS, landmarkIndexFor } from '../src/services/chroma/markerPalette.js';
import { applyChromaMarkers, createChromaState, blobQuality } from '../src/components/LiveCameraCapture/modules/chromaFusion.js';

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ✔ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------
// Utilitários de fotograma sintético
// ---------------------------------------------------------------------------
const W = 320;
const H = 180;

/** Fotograma RGBA cinzento (fundo com matiz indefinida → nunca confundido com cor). */
function blankFrame() {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 120;
    px[i + 1] = 120;
    px[i + 2] = 120;
    px[i + 3] = 255;
  }
  return px;
}

/** Pinta um disco cheio de uma cor, centrado em (cx, cy). */
function paintDisc(px, cx, cy, radius, [r, g, b]) {
  for (let y = Math.max(0, cy - radius); y <= Math.min(H - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(W - 1, cx + radius); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = (y * W + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
    }
  }
}

/** Pinta um risco fino (deve ser rejeitado pela forma). */
function paintLine(px, x0, y, length, [r, g, b]) {
  for (let x = x0; x < x0 + length; x += 1) {
    const i = (y * W + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  }
}

const GREEN = [0, 255, 0];
const MAGENTA = [255, 0, 255];
const CYAN = [0, 255, 255];
const YELLOW = [255, 255, 0];
const RED = [255, 0, 0];

console.log('== 1. RGB → HSV e intervalos de matiz (escala OpenCV 0-180) ==');
check('verde puro → matiz 60', near(rgbToHsv(...GREEN).h, 60, 0.5), String(rgbToHsv(...GREEN).h));
check('ciano → matiz 90', near(rgbToHsv(...CYAN).h, 90, 0.5), String(rgbToHsv(...CYAN).h));
check('amarelo → matiz 30', near(rgbToHsv(...YELLOW).h, 30, 0.5), String(rgbToHsv(...YELLOW).h));
check('magenta → matiz 150', near(rgbToHsv(...MAGENTA).h, 150, 0.5), String(rgbToHsv(...MAGENTA).h));
check('vermelho → matiz 0', near(rgbToHsv(...RED).h, 0, 0.5), String(rgbToHsv(...RED).h));
check('cinzento → saturação 0 (nunca é marcador)', rgbToHsv(120, 120, 120).s === 0);
check('o vermelho atravessa o 0/180: [170,8] apanha 175 e 3', hueInRange(175, 170, 8) && hueInRange(3, 170, 8));
check('o vermelho atravessa o 0/180: [170,8] rejeita 90', !hueInRange(90, 170, 8));

const greenMarker = paletteFor().find((m) => m.joint === 'knee');
const redMarker = paletteFor().find((m) => m.joint === 'elbow');
check('verde corresponde ao marcador do joelho', matchesMarker(rgbToHsv(...GREEN), greenMarker));
check('cinzento não corresponde a nenhum marcador', !matchesMarker(rgbToHsv(120, 120, 120), greenMarker));
check('verde escuro (abaixo do brilho mínimo) é rejeitado', !matchesMarker(rgbToHsv(0, 40, 0), greenMarker));
check('o marcador do cotovelo apanha vermelho', matchesMarker(rgbToHsv(...RED), redMarker));

console.log('\n== 2. Componentes ligados (geometria pura) ==');
const discMask = new Uint8Array(W * H);
for (let y = 50; y < 70; y += 1) {
  for (let x = 40; x < 60; x += 1) discMask[y * W + x] = 1;
}
const squareBlobs = findBlobs(discMask, W, H, { minArea: 4 });
check('encontra exatamente uma mancha', squareBlobs.length === 1, String(squareBlobs.length));
check('centróide correto', near(squareBlobs[0].cx, 49.5, 0.5) && near(squareBlobs[0].cy, 59.5, 0.5));
check('área correta (20×20)', squareBlobs[0].area === 400, String(squareBlobs[0].area));
check('um quadrado é compacto (aspecto 1)', squareBlobs[0].aspect === 1);

const lineMask = new Uint8Array(W * H);
for (let x = 0; x < 60; x += 1) lineMask[100 * W + x] = 1;
const lineBlobs = findBlobs(lineMask, W, H, { minArea: 4, minCompactness: 0.45 });
check('um risco de 60×1 é rejeitado pela forma', lineBlobs.length === 0, String(lineBlobs.length));

const twoMasks = new Uint8Array(W * H);
for (let y = 20; y < 30; y += 1) for (let x = 20; x < 30; x += 1) twoMasks[y * W + x] = 1;
for (let y = 100; y < 130; y += 1) for (let x = 200; x < 230; x += 1) twoMasks[y * W + x] = 1;
const twoBlobs = findBlobs(twoMasks, W, H, { minArea: 4 });
check('duas manchas separadas → dois blobs', twoBlobs.length === 2);
check('ordenadas por área decrescente', twoBlobs[0].area > twoBlobs[1].area);

console.log('\n== 3. Deteção em fotogramas sintéticos ==');
const markers = paletteFor();
const singleGreen = blankFrame();
paintDisc(singleGreen, 100, 60, 9, GREEN);
const greenBlobs = detectMarkersInPixels(singleGreen, W, H, markers);
check('um disco verde → um blob', greenBlobs.length === 1, String(greenBlobs.length));
check('posição normalizada correta', near(greenBlobs[0].x, 100 / W, 0.01) && near(greenBlobs[0].y, 60 / H, 0.01));
check('o blob sabe que é do joelho', greenBlobs[0].markerJoint === 'knee');

const multi = blankFrame();
paintDisc(multi, 80, 50, 9, GREEN);
paintDisc(multi, 200, 120, 9, MAGENTA);
paintDisc(multi, 280, 40, 9, CYAN);
const multiBlobs = detectMarkersInPixels(multi, W, H, markers);
check('três cores distintas → três blobs', multiBlobs.length === 3, String(multiBlobs.length));
check('as três articulações certas', ['knee', 'ankle', 'hip'].every((j) => multiBlobs.some((b) => b.markerJoint === j)));

const noisy = blankFrame();
paintDisc(noisy, 160, 90, 9, GREEN);
paintLine(noisy, 0, 20, 120, GREEN); // risco da mesma cor (ex.: roupa)
const noisyBlobs = detectMarkersInPixels(noisy, W, H, markers);
check('o risco da mesma cor é descartado, fica só o marcador', noisyBlobs.length === 1, String(noisyBlobs.length));
check('o blob que fica é o do disco', near(noisyBlobs[0].x, 160 / W, 0.01));

const tiny = blankFrame();
paintDisc(tiny, 40, 40, 2, GREEN); // marcador pequeno demais
check('marcador minúsculo é ignorado (ruído)', detectMarkersInPixels(tiny, W, H, markers).length === 0);

// ---------------------------------------------------------------------------
// 4. Fusão
// ---------------------------------------------------------------------------
console.log('\n== 4. Fusão marcador ↔ modelo de pose ==');
const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
const goodBlob = (x, y, joint = 'knee') => ({ x, y, area: 253, compactness: 0.9, markerJoint: joint });
const baseOptions = { side: 'right', frameWidth: W, markers: paletteFor(), confirmFrames: 1, holdFrames: 6 };

const s0 = createChromaState();
const first = applyChromaMarkers(s0, landmarks, [goodBlob(0.53, 0.5)], baseOptions);
const kneePoint = first.points.knee;
check('o marcador puxa o ponto, mas não o substitui', kneePoint.x > 0.5 && kneePoint.x < 0.53);
check('o peso é < 1 (nunca substituição cega)', kneePoint.weight > 0 && kneePoint.weight < 1);
check('marcado como vindo do marcador', kneePoint.source === 'marker' && kneePoint.isChroma === true);
check('ponto de qualidade é reportado', kneePoint.confidence > 0);

console.log('\n  -- Recuo quando não há marcador --');
const noMarker = applyChromaMarkers(s0, landmarks, [], baseOptions);
check('sem blobs, o joelho volta ao modelo', noMarker.points.knee.source === 'pose' && noMarker.points.knee.confidence === 0);
check('o ponto devolvido é o do modelo', noMarker.points.knee.x === 0.5 && noMarker.points.knee.y === 0.5);

console.log('\n  -- Rejeição de saltos (não segue a peça de roupa errada) --');
const farAway = applyChromaMarkers(s0, landmarks, [goodBlob(0.9, 0.5)], { ...baseOptions, maxJump: 0.08 });
check('um blob muito longe é rejeitado', farAway.points.knee.source === 'pose', farAway.points.knee.source);

console.log('\n  -- Histerese de confirmação --');
const hysteretic = { ...baseOptions, confirmFrames: 3 };
const f1 = applyChromaMarkers(createChromaState(), landmarks, [goodBlob(0.53, 0.5)], hysteretic);
const f2 = applyChromaMarkers(f1.state, landmarks, [goodBlob(0.53, 0.5)], hysteretic);
const f3 = applyChromaMarkers(f2.state, landmarks, [goodBlob(0.53, 0.5)], hysteretic);
check('1º fotograma: ainda não confirmado (peso 0)', f1.points.knee.weight === 0 && f1.points.knee.confirmed === false);
check('2º fotograma: ainda não confirmado', f2.points.knee.weight === 0);
check('3º fotograma: confirmado e a atuar', f3.points.knee.confirmed === true && f3.points.knee.weight > 0.5);
const dropped = applyChromaMarkers(f3.state, landmarks, [], hysteretic);
check('se o marcador desaparece, a memória mantém-se por `holdFrames`', dropped.state.joints.knee.hold === 5);
let held = dropped;
for (let i = 0; i < 6; i += 1) held = applyChromaMarkers(held.state, landmarks, [], hysteretic);
check('passados os fotogramas de espera, o marcador é libertado', held.state.joints.knee === undefined);

console.log('\n  -- Atribuição um-a-um (modo de uma só cor) --');
// Sem `markers`: em modo de uma só cor a paleta é escolhida pelo próprio `singleColor`.
const singleOptions = { side: 'right', frameWidth: W, confirmFrames: 1, holdFrames: 6, singleColor: true, maxJump: 0.2 };
const singleState = createChromaState();
// Dois marcadores verdes: um perto do joelho, outro perto do tornozelo.
const both = applyChromaMarkers(singleState, landmarks, [
  { x: 0.52, y: 0.5, area: 253, compactness: 0.9, markerJoint: 'any' },
  { x: 0.48, y: 0.5, area: 253, compactness: 0.9, markerJoint: 'any' },
], singleOptions);
const usedX = new Set([both.points.knee.x, both.points.ankle.x]);
check('cada articulação fica com um blob diferente (nenhum repetido)', usedX.size === 2, [...usedX].join(','));
check('o blob mais próximo do joelho ficou no joelho', both.points.knee.x > both.points.ankle.x);

console.log('\n  -- Qualidade e forma --');
const goodQuality = blobQuality({ area: 253, compactness: 0.95 }, { targetRadiusRatio: 0.028, frameWidth: W, proximity: 0, proximityTolerance: 0.1 });
const badQuality = blobQuality({ area: 253, compactness: 0.1 }, { targetRadiusRatio: 0.028, frameWidth: W, proximity: 0, proximityTolerance: 0.1 });
check('a qualidade depende da forma (disco bom > forma má)', goodQuality > badQuality && goodQuality <= 1);
check('qualidade dentro de [0,1]', goodQuality >= 0 && badQuality >= 0);

console.log('\n  -- Coerência da paleta e dos índices --');
check('todas as articulações têm marcador na paleta', CHROMA_JOINTS.every((j) => DEFAULT_MARKERS.some((m) => m.joint === j)));
check('joelho direito = marco 26, joelho esquerdo = 25', landmarkIndexFor('knee', 'right') === 26 && landmarkIndexFor('knee', 'left') === 25);
check('tornozelo direito = 28', landmarkIndexFor('ankle', 'right') === 28);
check('ombro esquerdo = 11', landmarkIndexFor('shoulder', 'left') === 11);

// ---------------------------------------------------------------------------
// 5. Integração no componente e na interface (regressão de cablagem)
// ---------------------------------------------------------------------------
console.log('\n== 5. Integração no componente ==');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const component = read('src/components/LiveCameraCapture/LiveCameraCapture.js');
const template = read('src/components/LiveCameraCapture/LiveCameraCapture.html');
const i18n = read('src/i18n.js');
const biomech = read('src/components/LiveCameraCapture/modules/biomechanicsComputer.js');
const overlay = read('src/components/LiveCameraCapture/modules/canvasOverlayRenderer.js');

check('o componente importa o detetor', component.includes("from '../../services/chroma/chromaMarkerTracker'"));
check('o componente importa a fusão', component.includes("from './modules/chromaFusion'"));
check('o detetor é instanciado fora da reatividade', component.includes('markRaw(new ChromaMarkerTracker())') && component.includes('createChromaState()'));
// A deteção tem de correr DENTRO de `onPoseResults` e ANTES do cálculo dos ângulos — senão os
// ângulos do fotograma seriam calculados com os marcadores do fotograma anterior.
const poseStart = component.indexOf('onPoseResults(results,');
const detectAt = component.indexOf('this.runChromaDetection();');
const anglesAt = component.indexOf('BiomechanicsComputer.computeFrameAngles({', poseStart);
check(
  'a deteção corre em `onPoseResults`, antes do cálculo dos ângulos',
  poseStart > 0 && detectAt > poseStart && anglesAt > detectAt,
  `pose=${poseStart} detect=${detectAt} angles=${anglesAt}`,
);
check('os ângulos recebem a cadeia de pontos via `resolvePoint`', component.includes('resolvePoint: (joint, fallback) => this.resolveTrackedPoint(joint, fallback)'));
check('o motor de ângulos aceita `resolvePoint`', biomech.includes('resolvePoint = null') && biomech.includes("const resolve = resolvePoint ||"));
check('precedência: manual → cromático → modelo', /resolveTrackedPoint\(joint, fallback\)[\s\S]{0,400}?manual\.isManual[\s\S]{0,200}?chroma\.weight > 0/.test(component));
check('o overlay desenha os marcadores cromáticos', component.includes('drawChromaOverlay') && overlay.includes('static drawChromaMarker') && overlay.includes('static drawChromaLegend'));
check('nunca se desenha um ponto "do modelo" com aparência de marcador', component.includes("if (!point || point.source === 'pose') return;"));
check('o CromaTrack não corre no modo fotos', template.includes("if (!isImage) this.drawChromaOverlay") || component.includes("if (!isImage) this.drawChromaOverlay(ctx, w, h);"));
check('ligar/desligar existe', component.includes('toggleChroma()') && template.includes('toggleChroma()'));
check('o modo de paleta é configurável', component.includes('setChromaPaletteMode') && component.includes('setMarkers({ singleColor'));
check('as preferências são persistidas', component.includes('CHROMA_STORAGE_KEY') && component.includes('persistChromaPreference'));
check('o armazenamento bloqueado não parte nada', /loadChromaPreference\(\)[\s\S]{0,400}?catch/.test(component));

console.log('\n  -- Interface --');
check('há um grupo de controlo para o CromaTrack', template.includes('class="control-group chroma-group"'));
check('o painel usa a ajuda contextual com o desenho dos marcadores', template.includes('diagram="chromaMarkers"'));
check('a ajuda explica como medir (pelo menos 3 passos)', (template.match(/chromaStep[123]/g) || []).length >= 3);
check('o painel avisa que a medição é 2D', template.includes("t('chromaDisclaimer')"));
check('há linha de estado com o número de articulações ancoradas', template.includes('chromaStatusText()'));

console.log('\n  -- i18n (pt + en) --');
const CHROMA_KEYS = [
  'chromaTitle', 'chromaLabel', 'chromaOff', 'chromaOn', 'chromaPaletteLabel',
  'chromaPaletteMulti', 'chromaPaletteSingle', 'chromaNoMarkers', 'chromaStatusJoints',
  'chromaDisclaimer', 'chromaOnToast', 'chromaOffToast', 'chromaHelpSummary',
  'chromaStep1', 'chromaStep2', 'chromaStep3', 'chromaHelpFormula', 'chromaHelpSource',
];
const missingLocale = CHROMA_KEYS.filter((key) => (i18n.match(new RegExp(`\\b${key}:`, 'g')) || []).length !== 2);
check('todas as chaves existem em pt e en', missingLocale.length === 0, missingLocale.join(', '));
check('o texto muda de idioma (pt ≠ en)', i18n.includes("'CromaTrack — marcadores cromáticos'") && i18n.includes("'CromaTrack — chromatic markers'"));

console.log('\n  -- CSS --');
const chromaCssPath = 'src/components/LiveCameraCapture/styles/chroma-track.css';
check('existe um ficheiro CSS próprio do CromaTrack', fs.existsSync(path.join(root, chromaCssPath)));
const chromaCss = read(chromaCssPath);
check('o CSS não fixa cores (usa as variáveis do tema)', !/#[0-9a-fA-F]{3,8}/.test(chromaCss) && !/rgb\(/.test(chromaCss));
check('o CSS é importado pelo componente', read('src/components/LiveCameraCapture/LiveCameraCapture.css').includes("'./styles/chroma-track.css'"));

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} VERIFICAÇÕES FALHARAM`}`);
process.exit(failures === 0 ? 0 : 1);
