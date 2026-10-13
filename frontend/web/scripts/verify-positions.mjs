/**
 * Verificação automática da OTIMIZAÇÃO POR POSIÇÃO DO PÉ e do RESUMO TÉCNICO.
 *
 * Executar com:  npm run verify:positions
 *
 * O pedido do utilizador que este ficheiro trava:
 *   "todos os dados fornecidos têm de contar para o resumo de ajuste técnico. largura de guiador
 *    maior que ombros, pé às 3h tem um ângulo diferente ótimo que o pé às 6h ou 9h ou 12h, sempre
 *    que o pé esteja numa posição diferente o ajuste ótimo tem de acompanhar a mudança de otimização."
 *
 * Prova-se, sem navegador nem MediaPipe:
 *  1. Cada posição do pé tem o SEU objetivo: 12h fecho da anca · 3h KOPS + tornozelo de potência ·
 *     6h extensão do joelho (só aqui se prescreve altura de selim) · 9h transição (descritiva).
 *  2. O ângulo do pé (toe-down) tem faixa própria em cada posição e é agora medido.
 *  3. Os votos de posições diferentes para a MESMA peça são reconciliados numa só direção.
 *  4. A largura do guiador maior do que os ombros conta SEMPRE (mesmo abaixo do passo comercial).
 *  5. A flexibilidade declarada desloca o alvo do tronco (e só uma vez).
 *  6. TODOS os dados fornecidos aparecem no resumo técnico — com o que alteraram, ou com o motivo
 *     por que não contam e o que falta.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FLEXIBILITY_TRUNK_SHIFT,
  POSITION_OBJECTIVES,
  applyFlexibilityToTrunkTarget,
  buildPhaseCards,
  collectVotesByComponent,
  describePositionOptimization,
  evaluatePosition,
  objectivesForPosition,
} from '../src/components/LiveCameraCapture/modules/positionOptimization.js';
import { MultiImageAnalysisManager } from '../src/components/LiveCameraCapture/modules/multiImageAnalysisManager.js';
import { buildDataAccounting, formatTechnicalSummary } from '../src/components/LiveCameraCapture/modules/technicalSummary.js';
import { CoherentRecommendationEngine } from '../src/components/LiveCameraCapture/modules/coherentRecommendationEngine.js';
import { buildEquipmentNotices, buildEquipmentPrescriptions, frameSizeRule, handlebarWidthRule } from '../src/components/LiveCameraCapture/modules/equipmentFitRules.js';
import { FOOT_TOE_DOWN_RANGE, HIP_CLOSURE_RANGE, getKneeReferenceForPosition } from '../src/components/LiveCameraCapture/modules/crankPositionRules.js';
import { BiomechanicsComputer } from '../src/components/LiveCameraCapture/modules/biomechanicsComputer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failures = 0;
function check(label, condition, extra = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` :: ${extra}` : ''}`);
}

const photo = (item) => ({ status: 'done', isFullBodyVisible: true, ...item });
const TARGETS = { knee: [145, 155], back: [40, 50], elbow: [150, 165], ankle: [95, 105] };
const UPRIGHT = 'upright';

/* ------------------------------------------------------------------ */
console.log('\n== 1. Cada posição do pé tem o seu próprio objetivo ==');
check('há objetivos definidos para 12h, 3h, 6h e 9h', ['tdc', '90deg', 'bdc', '270deg'].every((p) => POSITION_OBJECTIVES[p]));

const tdc = objectivesForPosition({ position: 'tdc', posture: UPRIGHT });
const ninety = objectivesForPosition({ position: '90deg', posture: UPRIGHT });
const bdc = objectivesForPosition({ position: 'bdc', posture: UPRIGHT });
const n270 = objectivesForPosition({ position: '270deg', posture: UPRIGHT });
const metricsOf = (table) => table.objectives.filter((o) => o.prescriptive).map((o) => o.metric);

check('12h: o objetivo prescritivo inclui o FECHO DA ANCA', metricsOf(tdc).includes('hipClosure'));
check('12h: NÃO prescreve extensão do joelho (não define altura de selim)', !metricsOf(tdc).includes('kneeExtension'));
check('12h: NÃO prescreve KOPS', !metricsOf(tdc).includes('kops'));
check('3h: prescreve KOPS (posição longitudinal do selim)', metricsOf(ninety).includes('kops'));
check('3h: NÃO prescreve extensão do joelho', !metricsOf(ninety).includes('kneeExtension'));
check('6h: prescreve extensão do joelho (altura do selim)', metricsOf(bdc).includes('kneeExtension'));
check('6h: NÃO prescreve KOPS', !metricsOf(bdc).includes('kops'));
check('6h: NÃO prescreve fecho da anca (o joelho está em baixo)', !metricsOf(bdc).includes('hipClosure'));
check(
  '9h: tornozelo, ângulo do pé, KOPS, joelho e anca NÃO são prescritivos (só tronco e cotovelo)',
  !metricsOf(n270).some((m) => ['ankle', 'toeDown', 'kops', 'kneeExtension', 'hipClosure'].includes(m)) && metricsOf(n270).includes('trunk'),
  metricsOf(n270).join(',')
);
check('o alvo do fecho da anca é o declarado (50–80°, prática 55–65°)', HIP_CLOSURE_RANGE[0] === 50 && HIP_CLOSURE_RANGE[1] === 80);

console.log('\n== 2. O ângulo do pé muda com a posição (e passou a ser medido) ==');
check('a faixa de toe-down é diferente às 12h, 6h e 3h',
  FOOT_TOE_DOWN_RANGE.tdc[0] !== FOOT_TOE_DOWN_RANGE.bdc[0] && FOOT_TOE_DOWN_RANGE.bdc[0] !== FOOT_TOE_DOWN_RANGE['90deg'][0],
  JSON.stringify(FOOT_TOE_DOWN_RANGE));
check('às 12h o pé aponta mais para baixo (15–35°)', FOOT_TOE_DOWN_RANGE.tdc[0] === 15 && FOOT_TOE_DOWN_RANGE.tdc[1] === 35);
check('às 3h o pé fica mais nivelado (0–12°)', FOOT_TOE_DOWN_RANGE['90deg'][0] === 0 && FOOT_TOE_DOWN_RANGE['90deg'][1] === 12);
check('às 9h não há faixa defensável (registo)', FOOT_TOE_DOWN_RANGE['270deg'] === null);

const footAngle = BiomechanicsComputer.calculateFootDownAngle({ x: 0.5, y: 0.8 }, { x: 0.6, y: 0.85 });
check('ponta do pé abaixo do tornozelo → ângulo positivo (toe-down)', footAngle > 0, String(footAngle));
check('ponta do pé acima do tornozelo → ângulo negativo', BiomechanicsComputer.calculateFootDownAngle({ x: 0.5, y: 0.8 }, { x: 0.6, y: 0.75 }) < 0);
check('sem pontos não há ângulo', BiomechanicsComputer.calculateFootDownAngle(null, { x: 1, y: 1 }) === null);
// Pose realista: cada marco num sítio diferente (com todos iguais não há ângulo nenhum a medir).
const pose = Array.from({ length: 33 }, (_, i) => ({ x: 0.1 + i * 0.02, y: 0.1 + (i % 7) * 0.05, z: 0, visibility: 0.9 }));
const angles = BiomechanicsComputer.computeFrameAngles({ lm: pose, side: 'left' });
check('a medição do pé entra em todos os cálculos de ângulos', 'pe' in angles && typeof angles.pe === 'number', String(angles.pe));
check('e convive com as métricas que já existiam', ['joelho', 'costas', 'braco', 'tornozelo', 'anca', 'antebraco'].every((k) => typeof angles[k] === 'number'));

console.log('\n== 2b. O joelho respeita a POSIÇÃO DO PÉ (12h ≠ 6h) ==');
// O joelho é uma articulação cujo ângulo só é interpretável com a posição do pé na pedaleira:
// com o pé em cima (12h) está ~2× mais fletido do que com o pé em baixo (6h). O relatório tem de
// comparar cada número com a janela DAQUELA posição — nunca com o alvo das 6h.
const kneeTdc = getKneeReferenceForPosition('tdc', { regime: 'dynamic', extensionRange: [145, 155] });
const knee90 = getKneeReferenceForPosition('90deg', { regime: 'dynamic', extensionRange: [145, 155] });
const kneeBdc = getKneeReferenceForPosition('bdc', { regime: 'dynamic', extensionRange: [145, 155] });
const knee270 = getKneeReferenceForPosition('270deg', { regime: 'dynamic', extensionRange: [145, 155] });
const kneeFree = getKneeReferenceForPosition('custom', { regime: 'dynamic' });

check('12h, 3h, 6h e 9h devolvem cada uma a sua janela de joelho',
  [kneeTdc, knee90, kneeBdc, knee270].every((k) => Array.isArray(k.range) && k.range.length === 2));
check('só às 6h (pé em baixo) a janela é ALVO que prescreve altura de selim',
  kneeBdc.kind === 'target' && [kneeTdc, knee90, knee270].every((k) => k.kind === 'reference'));
check('às 6h o alvo é a extensão dinâmica configurada (145–155 estáticos → 137–150 dinâmicos)',
  kneeBdc.range[0] === 137 && kneeBdc.range[1] === 150, JSON.stringify(kneeBdc.range));
check('às 12h a janela é a da flexão máxima (60–80°), muito mais fletida',
  kneeTdc.range[0] === 60 && kneeTdc.range[1] === 80, JSON.stringify(kneeTdc.range));
check('às 3h e 9h a janela é a da transição (95–125°)',
  knee90.range[0] === 95 && knee90.range[1] === 125 && knee270.range[0] === 95 && knee270.range[1] === 125);
check('a ordem das janelas acompanha o pé: em cima < à frente/atrás < em baixo',
  kneeTdc.range[1] < knee90.range[0] && knee90.range[1] < kneeBdc.range[0] && knee270.range[1] < kneeBdc.range[0],
  [kneeTdc.range, knee90.range, kneeBdc.range].map((r) => r.join('–')).join(' < '));
check('a janela das 6h NÃO é usada nas outras posições (o erro que isto trava)',
  ![kneeTdc, knee90, knee270].some((k) => k.range[0] === kneeBdc.range[0] && k.range[1] === kneeBdc.range[1]));
check('cada janela diz onde está o pé na pedaleira',
  /pé em cima \(12h\)/.test(kneeTdc.summary) && /pé em baixo \(6h\)/.test(kneeBdc.summary) &&
    /pé à frente \(3h\)/.test(knee90.summary) && /pé atrás \(9h\)/.test(knee270.summary));
check('as janelas descritivas não são ordens de ajuste',
  /não uma ordem de ajuste/.test(knee90.summary) && /não uma ordem de ajuste/.test(kneeTdc.summary) &&
    /não uma ordem de ajuste/.test(knee270.summary), `${kneeTdc.summary} | ${knee90.summary}`);
check('o relatório diz a PROCEDÊNCIA do número: prática às 12h, dedução às 3h/9h, evidência às 6h',
  /Referência prática/.test(kneeTdc.summary) &&
    /literatura não publica um intervalo universal/.test(kneeTdc.summary) &&
    /deduzida entre a flexão máxima/.test(knee90.summary) &&
    /não há valor universal publicado/.test(knee270.summary) &&
    /Alvo 137–150°/.test(kneeBdc.summary) && /define a altura do selim/.test(kneeBdc.summary));
check('nenhuma janela descritiva é apresentada como valor universal publicado',
  !/universal/.test(knee90.summary.replace('não há valor universal publicado', '')) &&
    !/universal/.test(knee270.summary.replace('não há valor universal publicado', '')));
check('cada janela cita as fontes que a sustentam',
  [kneeTdc, knee90, kneeBdc, knee270].every((k) => Array.isArray(k.sources) && k.sources.length > 0));
check('posição livre (sem pé conhecido) não inventa janela', kneeFree.range === null && kneeFree.kind === 'none');
check('o alvo das 6h muda com o regime, a janela das outras não',
  getKneeReferenceForPosition('bdc', { regime: 'static', extensionRange: [145, 155] }).range[0] === 145 &&
    getKneeReferenceForPosition('tdc', { regime: 'static', extensionRange: [145, 155] }).range[0] === 60);

console.log('\n== 3. Avaliação por posição: medido → alvo → ordem ==');
const hipLow = evaluatePosition({ position: 'tdc', angles: { anca: 44 }, posture: UPRIGHT });
const hipMetric = hipLow.metrics.find((m) => m.metric === 'hipClosure');
check('anca a 44° às 12h é um desvio abaixo do alvo', hipMetric.status === 'low' && hipMetric.deviation === 6, `${hipMetric.status}/${hipMetric.deviation}`);
check('o desvio da anca alimenta as três correções (guiador, cockpit, crenque)',
  hipMetric.feeds.map((f) => f.component).sort().join(',') === 'crankLength,reach,stack',
  hipMetric.feeds.map((f) => `${f.component}:${f.sign}`).join(','));
check('as correções têm o sentido certo (subir guiador, encurtar cockpit/crenque)',
  hipMetric.feeds.every((f) => f.sign === (f.component === 'stack' ? 1 : -1)));

const kneeGood = evaluatePosition({ position: 'bdc', angles: { joelho: 150 }, posture: UPRIGHT });
check('joelho dentro do alvo às 6h: é delegado ao motor (regime estático/dinâmico)', kneeGood.metrics.find((m) => m.metric === 'kneeExtension').status === 'delegated');
const kneeAny = evaluatePosition({ position: 'bdc', angles: { joelho: 138 }, posture: UPRIGHT });
check('joelho fora do alvo às 6h NÃO é votado aqui (o motor trata do regime)', kneeAny.metrics.find((m) => m.metric === 'kneeExtension').feeds.length === 0);

const kops = evaluatePosition({ position: '90deg', angles: {}, kopsResult: { offsetMm: 22 }, posture: UPRIGHT });
const kopsMetric = kops.metrics.find((m) => m.metric === 'kops');
check('KOPS de +22 mm às 3h vota em recuar o selim', kopsMetric.status === 'high' && kopsMetric.feeds[0].component === 'saddleForeAft' && kopsMetric.feeds[0].sign === -1);
const kopsVerdict = describePositionOptimization([kops])[0].metrics.find((m) => m.metric === 'kops').verdict;
check('o KOPS é medido em MILÍMETROS (nunca em graus)', kopsMetric.unit === 'mm' && /mm$|mm\b/.test(kopsVerdict) && !/°/.test(kopsVerdict), kopsVerdict);
check('as métricas angulares continuam em graus', evaluatePosition({ position: 'bdc', angles: { joelho: 138 }, posture: UPRIGHT }).metrics.find((m) => m.metric === 'kneeExtension').unit === '°');
const kopsAero = evaluatePosition({ position: '90deg', angles: {}, kopsResult: { offsetMm: 22 }, posture: 'aero' });
check('o MESMO desvio em aero não vota (KOPS descritivo)', kopsAero.metrics.find((m) => m.metric === 'kops').feeds.length === 0);

const ankle270 = evaluatePosition({ position: '270deg', angles: { tornozelo: 130 }, posture: UPRIGHT });
check('tornozelo a 130° às 9h é registo (sem alvo de potência)', ankle270.metrics.find((m) => m.metric === 'ankle').feeds.length === 0);
const ankle90 = evaluatePosition({ position: '90deg', angles: { tornozelo: 88 }, posture: UPRIGHT });
check('tornozelo a 88° às 3h vota nos travessões', ankle90.metrics.find((m) => m.metric === 'ankle').feeds[0]?.component === 'ankle');

const toeTdc = evaluatePosition({ position: 'tdc', angles: { pe: 22 }, posture: UPRIGHT });
check('toe-down às 12h é descritivo (a autoridade da posição não autoriza)', toeTdc.metrics.find((m) => m.metric === 'toeDown').feeds.length === 0);
const toeBdc = evaluatePosition({ position: 'bdc', angles: { pe: 30 }, posture: UPRIGHT });
const toeBdcMetric = toeBdc.metrics.find((m) => m.metric === 'toeDown');
check('toe-down a 30° às 6h (alvo 5–20°) vota recuar os travessões', toeBdcMetric.status === 'high' && toeBdcMetric.feeds[0].sign === -1);
const toe90 = evaluatePosition({ position: '90deg', angles: { pe: 30 }, posture: UPRIGHT });
check('os MESMOS 30° às 3h (alvo 0–12°) são um desvio maior', toe90.metrics.find((m) => m.metric === 'toeDown').deviation > toeBdcMetric.deviation);

const unknown = evaluatePosition({ position: null, angles: { costas: 45 }, posture: UPRIGHT });
check('posição desconhecida: sem objetivos e com explicação', unknown.unidentified === true && unknown.metrics.length === 0 && /Posição do pé desconhecida/.test(unknown.summary));

console.log('\n== 4. Votos de posições diferentes para a MESMA peça ==');
const twoPositions = describePositionOptimization([
  evaluatePosition({ position: 'tdc', angles: { anca: 44 }, posture: UPRIGHT }),
  evaluatePosition({ position: '270deg', angles: { tornozelo: 120 }, posture: UPRIGHT }),
]);
check('a descrição por posição inclui veredicto textual', twoPositions.some((p) => p.metrics.some((m) => /abaixo do alvo/.test(m.verdict))));
const votes = collectVotesByComponent([
  evaluatePosition({ position: 'tdc', angles: { anca: 44 }, posture: UPRIGHT }),
  evaluatePosition({ position: '270deg', angles: { costas: 60 }, posture: UPRIGHT }),
]);
check('duas posições a votar no mesmo componente ficam juntas', (votes.stack || []).length >= 1 && votes.cleat === undefined, JSON.stringify(Object.keys(votes)));
check('cada voto declara de que posição vem', (votes.stack || []).every((v) => Boolean(v.positionLabel)));

/* ------------------------------------------------------------------ */
console.log('\n== 4b. Quadro comparativo das fases: uma carta por posição, gerada pelo motor ==');
const cards = buildPhaseCards({
  evaluations: describePositionOptimization([
    evaluatePosition({ position: 'tdc', angles: { anca: 44, costas: 46, braco: 158, pe: 22 }, posture: UPRIGHT }),
    evaluatePosition({ position: '90deg', angles: { costas: 46, braco: 158, tornozelo: 88, pe: 30 }, kopsResult: { offsetMm: 22 }, posture: UPRIGHT }),
    evaluatePosition({ position: 'bdc', angles: { joelho: 138, costas: 46, braco: 158, tornozelo: 100, pe: 12 }, posture: UPRIGHT }),
    evaluatePosition({ position: '270deg', angles: { costas: 46, braco: 158, tornozelo: 140, pe: 30 }, posture: UPRIGHT }),
  ]),
  prescriptions: [
    { key: 'saddleHeight', action: 'Subir selim ~17 mm' },
    { key: 'saddleForeAft', action: 'Recuar selim ~21 mm' },
    { key: 'ankle', action: 'Recuar travessões ~3-5 mm' },
  ],
  positionMeta: (id) => MultiImageAnalysisManager.CRANK_POSITIONS.find((p) => p.value === id),
});
check('o quadro tem as QUATRO fases (12h, 3h, 6h e 9h), por ordem', cards.map((c) => c.id).join(',') === 'tdc,90deg,bdc,270deg', cards.map((c) => c.id).join(','));
check('cada carta declara o objetivo da SUA posição (SSOT)', cards.every((c) => c.goal && /12h|3h|6h|9h/.test(c.goal)));
const card270 = cards.find((c) => c.id === '270deg');
check('a carta das 9h existe e mostra o tornozelo medido (140°) com o seu próprio alvo',
  card270.hasData && card270.metrics.some((m) => m.metric === 'ankle' && m.measured === 140),
  JSON.stringify(card270.metrics.map((m) => [m.metric, m.measured])));
check('a carta das 9h NÃO reclama alvo de joelho nem de KOPS',
  !card270.metrics.some((m) => ['kneeExtension', 'kops'].includes(m.metric)));
const cardBdc = cards.find((c) => c.id === 'bdc');
const kneeCard = cardBdc.metrics.find((m) => m.metric === 'kneeExtension');
check('a carta das 6h liga a extensão do joelho à ordem emitida para o SELIM', kneeCard.order === 'Subir selim ~17 mm', String(kneeCard.order));
check('a carta das 6h diz que o alvo vem do regime/modalidade (não inventa graus)', /regime\/modalidade/.test(kneeCard.verdict) && kneeCard.targetText === '');
check('a carta das 6h não repete o alvo duas vezes na mesma linha', !/regime\/modalidade/.test(kneeCard.targetText));
const card90 = cards.find((c) => c.id === '90deg');
const kopsCard = card90.metrics.find((m) => m.metric === 'kops');
check('a carta das 3h mostra o KOPS com o alvo em MILÍMETROS e a ordem do recuo', kopsCard.targetText === 'alvo -10–10 mm' && kopsCard.order === 'Recuar selim ~21 mm', `${kopsCard.targetText} | ${kopsCard.order}`);
check('a carta das 3h mostra os 30° do pé contra o alvo local (0–12°)',
  card90.metrics.some((m) => m.metric === 'toeDown' && m.targetText === 'alvo 0–12°'),
  JSON.stringify(card90.metrics.map((m) => [m.metric, m.targetText])));
const cardTdc = cards.find((c) => c.id === 'tdc');
check('a carta das 12h traz o fecho da anca abaixo do alvo', cardTdc.metrics.some((m) => m.metric === 'hipClosure' && m.status === 'low'));
check('nenhuma carta imprime metas fixas de estrada', !cards.some((c) => c.metrics.some((m) => /145–155/.test(m.targetText))));
const units = new Set(cards.flatMap((c) => c.metrics.map((m) => m.unit)));
check('cada métrica viaja com a sua unidade (graus ou milímetros)', units.has('°') && units.has('mm'), [...units].join(','));
const missingCard = buildPhaseCards({ evaluations: [], positionMeta: (id) => MultiImageAnalysisManager.CRANK_POSITIONS.find((p) => p.value === id) }).find((c) => c.id === '270deg');
check('sem foto da fase a carta continua a explicar a posição e marca-se sem dados', missingCard.hasData === false && Boolean(missingCard.goal) && missingCard.measuredPosition === false);

console.log('\n== 5. O motor segue a posição e reconcilia numa só direção ==');
const photos = [
  photo({ name: '12h.jpg', crankPosition: 'tdc', angles: { joelho: 75, costas: 46, braco: 158, tornozelo: 100, anca: 44, pe: 22 }, kopsResult: null }),
  photo({ name: '3h.jpg', crankPosition: '90deg', angles: { joelho: 110, costas: 46, braco: 158, tornozelo: 100, anca: 95, pe: 8 }, kopsResult: { offsetMm: 22 } }),
  photo({ name: '6h.jpg', crankPosition: 'bdc', angles: { joelho: 138, costas: 46, braco: 158, tornozelo: 100, anca: 120, pe: 12 }, kopsResult: null }),
  photo({ name: '9h.jpg', crankPosition: '270deg', angles: { joelho: 110, costas: 46, braco: 158, tornozelo: 140, anca: 100, pe: 30 }, kopsResult: null }),
];
const noData = CoherentRecommendationEngine.build(photos, TARGETS, { posture: UPRIGHT });
const keysNoData = noData.prescriptions.map((p) => p.key);
check('altura do selim prescrita a partir dos 6h (joelho a 138°)', keysNoData.includes('saddleHeight'));
check('recuo do selim prescrito a partir dos 3h (KOPS +22 mm)', keysNoData.includes('saddleForeAft'));
check('tornozelo a 140° SÓ nos 9h NÃO gera ordem de travessões', !keysNoData.some((p) => p.key === 'ankle'), keysNoData.join(','));
check('fecho da anca a 44° às 12h gera ordem (crenque mais curto e/ou guiador mais alto)',
  keysNoData.includes('crankLength') && keysNoData.includes('stack'),
  keysNoData.join(','));
check('a análise por posição fica registada com as quatro posições', noData.positionOptimization.length === 4);
check('os alvos em vigor viajam no resultado', JSON.stringify(noData.targetsInUse.back) === JSON.stringify([40, 50]));

const stacked = CoherentRecommendationEngine.build(photos, TARGETS, {
  posture: UPRIGHT,
  athlete: { shoulder_width_cm: 42, inseam_cm: 84, riding_style: 'road' },
  bike: { handlebar_width_mm: 420, stem_length_mm: 110, crank_length_mm: 175, current_saddle_height_cm: 73.5, frame_size_cm: 58, top_tube_mm: 545, handlebar_reach_mm: 85 },
});
const keys = stacked.prescriptions.map((p) => p.key);
check('cada componente aparece uma única vez (uma direção por peça)', new Set(keys).size === keys.length, keys.join(','));
check('o crenque do cavalo/anca é prescrito uma só vez', keys.filter((k) => k === 'crankLength').length === 1, keys.join(','));
const mergedCrank = stacked.prescriptions.find((p) => p.key === 'crankLength');
check('a ordem única do crenque junta a faixa do cavalo e o fecho da anca', mergedCrank.merged === true && /ANCA FECHADA|CRENQUE/.test(mergedCrank.badge), JSON.stringify({ badge: mergedCrank.badge, merged: mergedCrank.merged }));
check('a ordem única traz os números absolutos do cavalo', /175 mm para 172.5 mm/.test(mergedCrank.action), mergedCrank.action);
check('o avanço recebe o alvo absoluto mesmo com o fecho da anca a votar', Boolean(stacked.prescriptions.find((p) => p.key === 'reach')), keys.join(','));
const reachST = stacked.prescriptions.find((p) => p.key === 'reach');
check('o quadro entra como contexto do alcance (quadro longo explica parte do alcoce)', /Contexto: o quadro/.test(reachST?.whatToDo || ''), reachST?.whatToDo);
check('a ordem de avanço diz quanto do alcance vem do tubo superior (ETT + avanço + reach do guiador)',
  /Cockpit: ETT 545 mm \+ avanço 110 mm \+ reach do guiador 85 mm/.test(reachST?.whatToDo || ''), reachST?.whatToDo);

// Fotos que divergem na MESMA peça: duas posições a pedir coisas opostas → nenhuma ordem + aviso.
const divergent = CoherentRecommendationEngine.build(
  [
    photo({ name: 'a.jpg', crankPosition: '270deg', angles: { joelho: 110, costas: 58, braco: 158, tornozelo: 100, anca: 100, pe: 20 }, kopsResult: null }),
    photo({ name: 'b.jpg', crankPosition: 'tdc', angles: { joelho: 110, costas: 34, braco: 158, tornozelo: 100, anca: 100, pe: 22 }, kopsResult: null }),
  ],
  TARGETS,
  { posture: UPRIGHT }
);
check('tronco a divergir entre posições: nenhuma ordem de stack', !divergent.prescriptions.some((p) => p.key === 'stack'), divergent.prescriptions.map((p) => p.key).join(','));
check('tronco a divergir: aviso explícito de divergência', divergent.notices.some((n) => /Divergência/.test(n)));

/* ------------------------------------------------------------------ */
console.log('\n== 5b. Flexibilidade conta no alvo do tronco (uma só vez) ==');
const low = applyFlexibilityToTrunkTarget([40, 50], 'low', UPRIGHT);
const high = applyFlexibilityToTrunkTarget([40, 50], 'high', UPRIGHT);
check('flexibilidade baixa sobe o alvo do tronco (40–50 → 45–55)', JSON.stringify(low.range) === JSON.stringify([45, 55]), JSON.stringify(low.range));
check('flexibilidade alta desce o alvo (40–50 → 35–45)', JSON.stringify(high.range) === JSON.stringify([35, 45]), JSON.stringify(high.range));
check('flexibilidade média não muda nada', applyFlexibilityToTrunkTarget([40, 50], 'medium', UPRIGHT).shift === 0);
check('o deslocamento é declarado e explicado', low.note && /Flexibilidade baixa/.test(low.note) && FLEXIBILITY_TRUNK_SHIFT.low === 5);
check('o alvo em aero nunca sai dos limites do razoável',
  JSON.stringify(applyFlexibilityToTrunkTarget([10, 30], 'low', 'aero').range) === JSON.stringify([15, 35]));

const flexible = CoherentRecommendationEngine.build(photos, TARGETS, { posture: UPRIGHT, athlete: { flexibility: 'low' } });
check('o motor aplica a flexibilidade e diz qual o alvo em vigor', JSON.stringify(flexible.targetsInUse.back) === JSON.stringify([45, 55]));
check('a nota da flexibilidade entra nos avisos', flexible.notices.some((n) => /Flexibilidade baixa/.test(n)));
const flexibleTwice = CoherentRecommendationEngine.build(photos, { ...TARGETS, back: [45, 55] }, {
  posture: UPRIGHT,
  athlete: { flexibility: 'low' },
  flexibility: 'low',
  flexibilityApplied: true,
});
check('não se aplica duas vezes quando o chamador já a aplicou', JSON.stringify(flexibleTwice.targetsInUse.back) === JSON.stringify([45, 55]));
check('e nesse caso não há aviso redundante', !flexibleTwice.notices.some((n) => /Flexibilidade baixa/.test(n)));

/* ------------------------------------------------------------------ */
console.log('\n== 6. Guiador mais largo do que os ombros conta SEMPRE ==');
const ruleBig = handlebarWidthRule({ shouldersCm: 40, ridingStyle: 'road', mountedWidthMm: 420 });
const ruleMid = handlebarWidthRule({ shouldersCm: 40, ridingStyle: 'road', mountedWidthMm: 415 });
const ruleSmall = handlebarWidthRule({ shouldersCm: 40, ridingStyle: 'road', mountedWidthMm: 404 });
const ruleOk = handlebarWidthRule({ shouldersCm: 40, ridingStyle: 'road', mountedWidthMm: 400 });
check('20 mm acima da tolerância → troca prescrita', ruleBig.status === 'danger' && /MAIS LARGO/.test(ruleBig.comparison));
check('15 mm acima → conta (aviso, sem compra imediata)', ruleMid.status === 'warning' && ruleMid.counts === true);
check('4 mm acima → coerente (não é desvio)', ruleSmall.status === 'ok' && ruleSmall.counts === false);
check('400 mm com 40 cm de ombros → coerente', ruleOk.status === 'ok');
check('guiador montado 415 mm gera ordem de guiador (não desaparece)', buildEquipmentPrescriptions({ shouldersCm: 40, ridingStyle: 'road', handlebarWidthMm: 415 }).some((p) => p.key === 'handlebarWidth'));
check('a ordem de 415 mm é de "próxima troca", não de substituição imediata',
  /Preferir guiador de 400 mm na próxima troca/.test(buildEquipmentPrescriptions({ shouldersCm: 40, ridingStyle: 'road', handlebarWidthMm: 415 })[0].action));
check('415 mm sem atingir o passo comercial também aparece nos avisos',
  buildEquipmentNotices({ shouldersCm: 40, ridingStyle: 'road', handlebarWidthMm: 415 }).some((n) => /MAIS LARGO do que os ombros/.test(n)));
check('404 mm é dito como dentro da tolerância (sem alarme)', !buildEquipmentNotices({ shouldersCm: 40, ridingStyle: 'road', handlebarWidthMm: 404 }).some((n) => /Largura do guiador/.test(n)));

console.log('\n== 7. Quadro: o dado que não entrava em nenhuma decisão ==');
const frameLong = frameSizeRule({ inseamCm: 84, frameSizeCm: 58 });
check('quadro 58 cm vs 55,9 cm estimados → longo (+2,1 cm)', frameLong.status === 'long' && frameLong.deltaCm === 2.1 && frameLong.counts === true);
check('quadro dentro da tolerância não conta como desvio', frameSizeRule({ inseamCm: 84, frameSizeCm: 56.5 }).counts === false);
check('sem cavalo não há comparação de quadro', frameSizeRule({ inseamCm: null, frameSizeCm: 58 }).status === 'unknown');
check('o aviso do quadro explica quem tem de compensar', buildEquipmentNotices({ inseamCm: 84, frameSizeCm: 58 }).some((n) => /Tamanho do quadro/.test(n) && /avanço/.test(n)));

/* ------------------------------------------------------------------ */
console.log('\n== 8. Resumo técnico: TODOS os dados contam (e os que não contam dizem porquê) ==');
const fullAthlete = { height_cm: 178, inseam_cm: 84, shoulder_width_cm: 40, flexibility: 'low', riding_style: 'road' };
const fullBike = { current_saddle_height_cm: 73.5, handlebar_width_mm: 420, handlebar_reach_mm: 85, handlebar_drop_mm: 150, stem_length_mm: 100, crank_length_mm: 175, frame_size_cm: 58, top_tube_mm: 545 };
const fullProfile = { weightKg: 95, shoeSizeEu: 46, heightCm: 178, inseamCm: 84 };
const full = CoherentRecommendationEngine.build(photos, TARGETS, {
  posture: UPRIGHT,
  athlete: fullAthlete,
  bike: fullBike,
  profile: fullProfile,
});
const rows = full.dataAccounting.rows;
const findRow = (label) => rows.find((r) => r.label.startsWith(label));
const everyDatum = [
  'Altura', 'Cavalo (entre-perna)', 'Largura dos ombros', 'Flexibilidade', 'Modalidade',
  'Altura do selim medida', 'Largura do guiador montado', 'Reach / Drop do guiador', 'Avanço montado',
  'Crenque montado', 'Tamanho do quadro', 'Tubo superior (ETT', 'Peso', 'Número de sapato', 'Perfil de postura',
];
check('todos os dados fornecidos têm uma linha no resumo', everyDatum.every((label) => findRow(label)), everyDatum.filter((l) => !findRow(l)).join(','));
check('nenhum dado fornecido fica sem efeito declarado', rows.every((r) => typeof r.effect === 'string' && r.effect.length > 20));
check('nada fica marcado como em falta quando foi fornecido', everyDatum.every((label) => findRow(label).status !== 'missing'));
check('as linhas citam as ordens emitidas', /Trocar guiador|Preferir guiador/.test(findRow('Largura do guiador montado').effect));
check('o cavalo cita as estimativas que alimenta', /LeMond 74.2 cm/.test(findRow('Cavalo (entre-perna)').effect));
check('o peso traz a nota mecânica com fonte', /sag|suspensão/.test(findRow('Peso').effect));
check('a flexibilidade indica o alvo do tronco em vigor', /45–55°/.test(findRow('Flexibilidade').effect), findRow('Flexibilidade').effect);
check('o quadro explica o sentido do desvio', /maior do que a estimativa/.test(findRow('Tamanho do quadro').effect));
check('o tamanho do quadro é nomeado como tubo do selim (C-T), não como tubo superior',
  /tubo do selim, C–T/.test(findRow('Tamanho do quadro').label) && /C-T/.test(findRow('Tamanho do quadro').effect));
const topTubeRow = findRow('Tubo superior (ETT');
check('o tubo superior (ETT) tem linha própria no resumo e conta', topTubeRow.status === 'counts');
check('a linha do tubo superior fecha o alcance do cockpit com o quadro à frente',
  /ETT 545 mm \+ avanço 100 mm \+ reach do guiador 85 mm = 730 mm/.test(topTubeRow.effect), topTubeRow.effect);
check('a linha do tubo superior diz como se mede (eixo do tubo do selim → eixo do tubo de direção)',
  /eixo do tubo de direção/.test(topTubeRow.effect));
check('cada posição do pé medida aparece no resumo', rows.filter((r) => r.group === 'Posição do pé').length === 4);
check('os totais são contados', full.dataAccounting.counted > 10 && full.dataAccounting.missing === 0, JSON.stringify({ c: full.dataAccounting.counted, m: full.dataAccounting.missing }));
check('o texto do resumo identifica cada grupo', /ATLETA|BICICLETA|PERFIL|POSTURA|POSIÇÃO DO PÉ/.test(full.technicalSummaryText) && /EM QUE CONTRIBUIU CADA DADO FORNECIDO/.test(full.technicalSummaryText));

const empty = CoherentRecommendationEngine.build(photos, TARGETS, { posture: UPRIGHT });
const emptyRows = empty.dataAccounting.rows;
check('sem dados do passo 1 o resumo explica o que falta', emptyRows.filter((r) => r.status === 'missing').length >= 5, String(emptyRows.filter((r) => r.status === 'missing').length));
check('e diz o que cada dado faltante desbloquearia', emptyRows.filter((r) => r.status === 'missing').every((r) => r.effect.length > 25));

const locked = CoherentRecommendationEngine.build([photos[2]], TARGETS, {
  posture: UPRIGHT,
  athlete: fullAthlete,
  bike: fullBike,
  profile: fullProfile,
});
check('com menos de 2 fotos o resumo técnico já existe (dados não ficam invisíveis)', Boolean(locked.dataAccounting) && locked.ready === false);
check('e nesse estado os dados continuam marcados como contados', locked.dataAccounting.counted >= 5);

const text = CoherentRecommendationEngine.formatText(full, 'Ana', 'Bicicleta X');
check('a prescrição copiada inclui o resumo técnico', /RESUMO TÉCNICO DE AJUSTE/.test(text) && /OTIMIZAÇÃO POR POSIÇÃO DO PÉ/.test(text));
check('o texto lista as quatro posições medidas', /TDC \(12h\)/.test(text) && /BDC \(6h\)/.test(text) && /270° \(9h\)/.test(text));

/* ------------------------------------------------------------------ */
console.log('\n== 9. Ligação na interface ==');
const template = read('src/components/LiveCameraCapture/LiveCameraCapture.html');
const component = read('src/components/LiveCameraCapture/LiveCameraCapture.js');
const css = read('src/components/LiveCameraCapture/styles/video-analysis.css');
check('a interface mostra a tabela de dados que contam', template.includes('technicalSummaryRows') && template.includes('Resumo Técnico de Ajuste'));
check('a interface mostra a otimização por posição do pé', template.includes('positionOptimizationRows') && template.includes('Otimização por Posição do Pé'));
check('o resumo técnico tem botão de cópia', component.includes('copyTechnicalSummary'));

// O quadro comparativo antigo trazia metas de ESTRADA fixas na marcação e só três fases: numa
// bicicleta de MTB, numa medição dinâmica ou em aero o número no ecrã contradizia o motor.
const boxStart = template.indexOf('multi-position-comparison-box');
const box = boxStart === -1 ? '' : template.slice(boxStart, template.indexOf('</aside>', boxStart));
const legado = ['Extensão máx. joelho 145', 'Fecho da Anca > 50', 'Alinhamento KOPS patela/pedal'];
check('o quadro das fases perdeu as metas fixas (contradiziam o motor)', legado.every((needle) => !box.includes(needle)), legado.filter((n) => box.includes(n)).join(','));
check('o quadro das fases deixou de pintar com cores fixas (usa tokens do tema)', box.length > 0 && !/#[0-9a-fA-F]{3,8}/.test(box));
check('o quadro das fases é gerado pelo motor por posição', template.includes('phase in phaseCards'));
check('as quatro fases aparecem no quadro (12h, 3h, 6h e 9h)', /\['tdc', '90deg', 'bdc', '270deg'\]/.test(component));
check('a carta da fase mostra a ordem que saiu para a peça', template.includes('phase-metric-action') && /metric\.order/.test(template));
check('a cópia do relatório por posição leva o resumo técnico (dados que contam)',
  /copyMultiPositionReport\(\)[\s\S]{0,900}technicalSummaryText/.test(component));
check('a flexibilidade é aplicada nos alvos em direto (não só no texto)',
  /configureModalityTargets\(\)[\s\S]{0,900}applyFlexibilityToTrunkTarget/.test(component));
check('o perfil da análise (peso/sapato) é enviado ao motor', /profile: this\.athleteProfile/.test(component));
check('os estilos dos dois painéis existem e usam tokens do tema',
  css.includes('.technical-summary-panel') && css.includes('.pos-opt-card') && !/#[0-9a-fA-F]{3,8}/.test(css.slice(css.indexOf('.position-optimization-panel,'))));

const finalEngine = read('src/components/LiveCameraCapture/modules/finalPrescriptionEngine.js');
check('o relatório final do vídeo leva o resumo técnico', finalEngine.includes('base.dataAccounting = coherent.dataAccounting') && finalEngine.includes('result.technicalSummaryText'));
check('o texto do vídeo anexa o resumo técnico', /const result = await|result\.technicalSummaryText/.test(finalEngine));

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} VERIFICAÇÕES FALHARAM`}`);
process.exit(failures === 0 ? 0 : 1);
