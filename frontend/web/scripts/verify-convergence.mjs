/**
 * Verificação automática do PONTO MÉDIO ESTÁVEL nas fotos (StaticPoseConverger).
 *
 * Executar com:  npm run verify:convergence
 *
 * O defeito que este ficheiro trava (relatado pelo utilizador):
 *   "se eu estiver a clicar em re-analisar mostra um desenho diferente todas as vezes"
 * A causa é o modelo de pose não ser determinístico na MESMA imagem. A correção é inferir várias
 * vezes, guardar o ponto médio (mediana por coordenada) e só desenhar depois de a mediana parar
 * de mexer.
 *
 * Aqui prova-se, sem navegador e sem MediaPipe:
 *  1. A mediana é o ponto médio robusto (uma passagem disparatada não a desloca).
 *  2. A convergência para quando a mediana estabiliza — e diz em que passagem.
 *  3. O resultado final coincide com a pose verdadeira mesmo quando cada passagem isolada erra
 *     (é isto que faz o desenho deixar de mudar a cada re-análise).
 *  4. Não convergir é DITO, nunca escondido (devolve o ponto médio com `converged: false`).
 *  5. Amostras inválidas/falhadas são contadas e não destroem a leitura.
 *  6. O desenho só acontece DEPOIS da convergência (ligação na interface, verificada no código).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONVERGENCE_DEFAULTS,
  convergeStaticPose,
  isValidLandmarkSample,
  maxLandmarkShift,
  median,
  medianLandmarks,
  sampleSpreadPercent,
} from '../src/components/LiveCameraCapture/modules/staticPoseConverger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failures = 0;
function check(label, condition, extra = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` :: ${extra}` : ''}`);
}

/** Pose "verdadeira" com 33 marcos (o que o MediaPipe Pose devolve). */
const TRUTH = Array.from({ length: 33 }, (_, i) => ({
  x: 0.2 + (i % 6) * 0.1,
  y: 0.15 + Math.floor(i / 6) * 0.12,
  z: 0,
  visibility: 0.95,
}));

/** Aplica o MESMO deslocamento a todos os marcos (como um erro global de inferência). */
const shiftAll = (offset) => TRUTH.map((p) => ({ ...p, x: p.x + offset, y: p.y + offset }));

const KEYFRAME_OFFSETS = [0.02, -0.02, 0.01, -0.01, 0];

/** Simulação de captura: cada passagem devolve a pose verdadeira com o erro daquela passagem. */
function captureSequence(offsets, options = {}) {
  let index = 0;
  return async () => {
    const offset = offsets[Math.min(index, offsets.length - 1)];
    index++;
    if (options.failAt && options.failAt.includes(index)) return null;
    return shiftAll(offset);
  };
}

/* ------------------------------------------------------------------ */
console.log('\n== 1. O ponto médio é a mediana (robusta a uma passagem má) ==');
check('mediana de ímpares', median([5, 1, 3]) === 3);
check('mediana de pares (média dos dois centrais)', median([1, 2, 3, 4]) === 2.5);
check('mediana ignora valores inválidos', median([1, null, 3, undefined, 5, NaN]) === 3);
check('mediana sem valores devolve null', median([]) === null && median([null]) === null);

const five = [
  shiftAll(0.02), shiftAll(-0.02), shiftAll(0.01), shiftAll(-0.01), shiftAll(0.5),
];
const medianOfFive = medianLandmarks(five);
const medianError = Math.max(...medianOfFive.landmarks.map((p, i) => Math.abs(p.x - TRUTH[i].x)));
check(
  'mediana de 5 passagens com uma delas a 50% da imagem fica dentro de 1% da verdade',
  medianError <= 0.0101,
  `erro máximo ${medianError.toFixed(4)}`
);
const meanOfFive = TRUTH.map((_, i) => five.reduce((sum, s) => sum + s[i].x, 0) / five.length);
const meanError = Math.max(...meanOfFive.map((v, i) => Math.abs(v - TRUTH[i].x)));
check(
  'a MÉDIA teria sido arrastada pela passagem disparatada (por isso não se usa média)',
  meanError > 0.09,
  `erro da média ${meanError.toFixed(3)}`
);
check('a mediana guarda os 33 marcos e a visibilidade', medianOfFive.landmarkCount === 33 && medianOfFive.landmarks[0].visibility === 0.95);
check('sem amostras válidas não há marcos', medianLandmarks([]).landmarks === null);

console.log('\n== 2. Métricas de dispersão ==');
// A distância é euclidiana: um deslocamento de 0,02 no eixo x e no eixo y dá hypot(0,02; 0,02).
check('deslocamento máximo entre poses (distância euclidiana)', Math.abs(maxLandmarkShift(TRUTH, shiftAll(0.02)) - Math.hypot(0.02, 0.02)) < 1e-9);
check('sem pontos comparáveis devolve null', maxLandmarkShift([], TRUTH) === null && maxLandmarkShift(TRUTH, []) === null);
const spread = sampleSpreadPercent(five, TRUTH);
check('dispersão das passagens é medida em percentagem da imagem', spread !== null && spread >= 0.5, `(${spread}%)`);
check('amostra válida exige 33 marcos com coordenadas', isValidLandmarkSample(TRUTH) === true && isValidLandmarkSample([{ x: 1, y: 1 }]) === false && isValidLandmarkSample([...TRUTH, { x: NaN, y: 0 }]) === false);

/* ------------------------------------------------------------------ */
console.log('\n== 3. Convergência: para quando a mediana estabiliza ==');
const progress = [];
const settled = await convergeStaticPose({
  capture: captureSequence(KEYFRAME_OFFSETS),
  onProgress: (state) => progress.push(state),
});
check('convergiu', settled.converged === true, `passes=${settled.passes}`);
check(
  'a leitura final é EXATAMENTE a pose verdadeira (cada passagem isolada errava 1–2%)',
  settled.landmarks.every((p, i) => Math.abs(p.x - TRUTH[i].x) < 1e-9 && Math.abs(p.y - TRUTH[i].y) < 1e-9)
);
check(
  'uma passagem isolada deslocava o esqueleto 2,8% da imagem (é isto que o utilizador via mudar)',
  Math.abs(maxLandmarkShift(shiftAll(0.02), TRUTH) - Math.hypot(0.02, 0.02)) < 1e-9
);
check('convergiu depois do mínimo de passagens (não a 1ª leitura)', settled.passes >= CONVERGENCE_DEFAULTS.minPasses && settled.passes <= CONVERGENCE_DEFAULTS.maxPasses, `${settled.passes} passagens`);
check('o deslocamento final ficou dentro da tolerância', settled.shiftPercent !== null && settled.shiftPercent <= CONVERGENCE_DEFAULTS.tolerance * 100, `${settled.shiftPercent}%`);
check('todas as passagens foram amostras válidas', settled.samples === settled.passes && settled.rejected === 0);
check('progresso: fase de amostragem e depois a de estabilização', progress[0].phase === 'sampling' && progress[progress.length - 1].phase === 'settled');
check('progresso diz a passagem e o orçamento máximo', progress[0].pass === 1 && progress[0].maxPasses === CONVERGENCE_DEFAULTS.maxPasses);
check('a dispersão fica registada no resultado', typeof settled.spreadPercent === 'number' && settled.spreadPercent >= 0);

console.log('\n== 4. Re-análises repetidas dão o MESMO desenho ==');
const runs = [];
for (let i = 0; i < 3; i++) {
  // eslint-disable-next-line no-await-in-loop
  const run = await convergeStaticPose({ capture: captureSequence(KEYFRAME_OFFSETS) });
  runs.push(run);
}
const identical = runs.every((run) => JSON.stringify(run.landmarks) === JSON.stringify(runs[0].landmarks));
check('carregar em re-analisar 3 vezes devolve pontos idênticos', identical);
check('e o desvio entre re-análises é 0%', runs.every((run) => run.shiftPercent === 0 || run.converged));

/* ------------------------------------------------------------------ */
console.log('\n== 5. Não convergir é DITO (nunca escondido) ==');
const drifting = await convergeStaticPose({
  capture: captureSequence([0.05, -0.06, 0.07, -0.08, 0.09, -0.1, 0.11]),
});
check('leitura que nunca estabiliza: converged=false', drifting.converged === false);
check('mesmo assim devolve o ponto médio (não fica sem leitura)', Array.isArray(drifting.landmarks) && drifting.landmarks.length === 33);
check('diz quantas passagens fez (orçamento esgotado)', drifting.passes === CONVERGENCE_DEFAULTS.maxPasses, `${drifting.passes}`);
check('a dispersão grande é divulgada ao utilizador', drifting.spreadPercent >= 5, `${drifting.spreadPercent}%`);

/* ------------------------------------------------------------------ */
console.log('\n== 6. Amostras inválidas e falhas não destroem a leitura ==');
let failuresSeen = 0;
const withFailures = await convergeStaticPose({
  capture: async (pass) => {
    if (pass === 1 || pass === 3) {
      failuresSeen++;
      return null;
    }
    if (pass === 2) return [{ x: 0.1, y: 0.1 }]; // amostra incompleta
    return shiftAll(0.005);
  },
  options: { minPasses: 2, maxPasses: 5, tolerance: 0.002 },
});
check('passagens sem pose são contadas como rejeitadas', failuresSeen === 2 && withFailures.rejected >= 2, `rejeitadas=${withFailures.rejected}`);
check('a leitura continua a ser feita com as amostras boas', Array.isArray(withFailures.landmarks) && withFailures.samples >= 2, `boas=${withFailures.samples}`);

const allBad = await convergeStaticPose({ capture: async () => null, options: { minPasses: 2, maxPasses: 4 } });
check('nenhuma pose detetada: sem marcos (a interface mostra o erro, não um desenho inventado)', allBad.landmarks === null && allBad.samples === 0 && allBad.rejected === 4);

const throwing = await convergeStaticPose({
  capture: async (pass) => {
    if (pass === 1) throw new Error('falha do WebAssembly');
    return shiftAll(0.002);
  },
  options: { minPasses: 2, maxPasses: 4 },
});
check('uma passagem que rebenta não interrompe a convergência', Array.isArray(throwing.landmarks) && throwing.rejected >= 1);

const custom = await convergeStaticPose({
  capture: captureSequence([0.02, -0.02, 0.01, -0.01, 0]),
  options: { minPasses: 2, maxPasses: 2, tolerance: 0.5 },
});
check('o orçamento de passagens é respeitado', custom.passes === 2, `${custom.passes}`);
check('sem tolerância definida usam-se os valores por omissão', CONVERGENCE_DEFAULTS.minPasses >= 2 && CONVERGENCE_DEFAULTS.maxPasses >= CONVERGENCE_DEFAULTS.minPasses && CONVERGENCE_DEFAULTS.tolerance > 0);

/* ------------------------------------------------------------------ */
console.log('\n== 7. Ligação na interface: desenhar SÓ depois da convergência ==');
const component = read('src/components/LiveCameraCapture/LiveCameraCapture.js');
const template = read('src/components/LiveCameraCapture/LiveCameraCapture.html');
const css = read('src/components/LiveCameraCapture/styles/video-analysis.css');

const analyzeStart = component.indexOf('async analyzeImageItem(');
const analyzeBlock = component.slice(analyzeStart, component.indexOf('async analyzeAllImages(', analyzeStart));
check('analyzeImageItem existe e usa o convergidor', analyzeStart > 0 && analyzeBlock.includes('convergeStaticPose'));
check('a análise chega ao desenho pelo ponto médio', /await convergeStaticPose\(/.test(analyzeBlock));
const convergeIndex = analyzeBlock.indexOf('await convergeStaticPose(');
const drawIndex = analyzeBlock.indexOf('renderOverlayGraphics(ctx');
check('o traço corporal é desenhado DEPOIS de a mediana fechar', convergeIndex > 0 && drawIndex > convergeIndex, `${convergeIndex} → ${drawIndex}`);
const captureBlock = analyzeBlock.slice(analyzeBlock.indexOf('capture: async () =>'), analyzeBlock.indexOf('onProgress'));
check('durante as passagens NÃO se desenha nada (só a foto limpa é inferida)', captureBlock.length > 0 && !captureBlock.includes('renderOverlayGraphics'));
check('cada passagem parte da imagem original (não do canvas com traço)', analyzeBlock.includes('processStaticImage(item.imageElement)'));
check('o resultado guardado é a mediana, não a última passagem', analyzeBlock.includes('item.landmarks = convergence.landmarks'));
check('a interface fica a saber quantas passagens e quanto variou', analyzeBlock.includes('item.stabilization'));

check('o painel de espera diz em que passagem vai', template.includes('imageStabilizationLabel') && component.includes('A estabilizar ${state.name}: passagem ${pass}/${state.maxPasses}'));
check('o chip da estabilização tem estilo próprio', css.includes('.image-stabilizing-chip'));
check('cada foto mostra a nota de estabilidade', template.includes('imageStabilizationNote(imgItem)'));
check('a nota diz as passagens e o desvio medido', component.includes('ponto médio de ${state.passes} passagem(ns)'));
check('o relatório multi-posição inclui a estabilidade', read('src/components/LiveCameraCapture/modules/multiImageAnalysisManager.js').includes('Estabilidade: ponto médio de'));
check('o cartão tem estilo próprio para a nota', css.includes('.image-card-stability'));

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} VERIFICAÇÕES FALHARAM`}`);
process.exit(failures === 0 ? 0 : 1);
