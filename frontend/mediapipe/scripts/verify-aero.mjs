/**
 * Verificação automática da DETEÇÃO DE POSTURA AERO e dos ALVOS ESPECÍFICOS.
 *
 * Executar com:  npm run verify:aero
 *
 * Garante, sem navegador e sem dependências, que:
 *  1. Os alvos de aero e de estrada são distintos onde a evidência o permite — e IGUAIS no
 *     joelho (a altura do selim não muda por o atleta estar em aero).
 *  2. A modalidade TT já não altera o alvo do joelho (148–158° foi removido: não tem suporte).
 *  3. A autoridade das métricas muda com a postura (KOPS/anca/cabeça deixam de prescrever em aero).
 *  4. O detetor decide com os sinais geométricos certos: aplica aero sozinho quando a evidência é
 *     franca, PERGUNTA quando é parcial e nunca sobrepõe uma escolha manual em silêncio.
 *  5. O centro de gravidade do pedido: com os braços fletidos sobre as almofadas, o sistema NÃO
 *     emite \"braços bloqueados\" nem manda recuar o selim pelo KOPS.
 *  6. Os alvos aplicados ficam escritos no relatório (com as fontes) — em direto e na análise final.
 */
import { BiomechanicsComputer } from '../src/components/LiveCameraCapture/modules/biomechanicsComputer.js';
import {
  AERO_TARGETS,
  POSTURE_AERO,
  POSTURE_UPRIGHT,
  UPRIGHT_TARGETS,
  formatTargetsLine,
  getPostureMetricAuthority,
  resolveTargets,
} from '../src/components/LiveCameraCapture/modules/postureMode.js';
import {
  ASK_CONFIDENCE,
  AUTO_SWITCH_CONFIDENCE,
  MIN_SAMPLES_FOR_DETECTION,
  analyzeArmGeometry,
  detectAeroPosture,
} from '../src/components/LiveCameraCapture/modules/aeroPostureDetector.js';
import { LiveTuningReportManager } from '../src/components/LiveCameraCapture/modules/liveTuningReportManager.js';
import { FinalPrescriptionEngine } from '../src/components/LiveCameraCapture/modules/finalPrescriptionEngine.js';
import { CoherentRecommendationEngine } from '../src/components/LiveCameraCapture/modules/coherentRecommendationEngine.js';

let failures = 0;
function check(label, condition, extra = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` :: ${extra}` : ''}`);
}
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------------------
console.log('== 1. ALVOS POR POSTURA (postureMode) ==');
const upright = resolveTargets({ posture: POSTURE_UPRIGHT, ridingStyle: 'road' });
const aero = resolveTargets({ posture: POSTURE_AERO, ridingStyle: 'road' });

check('estrada: tronco 40–50°', same(upright.back, UPRIGHT_TARGETS.back), JSON.stringify(upright.back));
check('estrada: cotovelo 150–165°', same(upright.elbow, UPRIGHT_TARGETS.elbow), JSON.stringify(upright.elbow));
check('estrada: sem alvo de antebraço', upright.antebraco === null, String(upright.antebraco));
check('aero: tronco plano 10–30°', same(aero.back, [10, 30]), JSON.stringify(aero.back));
check(
  'aero: cotovelo claramente fletido (80–115°)',
  same(aero.elbow, [80, 115]),
  JSON.stringify(aero.elbow)
);
check('aero: antebraço 0–20° (referência de tri/TT)', same(aero.antebraco, [0, 20]), JSON.stringify(aero.antebraco));
check(
  'JOELHO IGUAL em estrada e aero (alvo de altura de selim não muda)',
  same(aero.knee, upright.knee) && same(aero.knee, [145, 155]),
  `${JSON.stringify(upright.knee)} vs ${JSON.stringify(aero.knee)}`
);
check('aero: cabeça deixa de ter alvo numérico', aero.head === null, String(aero.head));

const tt = resolveTargets({ posture: POSTURE_UPRIGHT, ridingStyle: 'tt' });
check('modalidade TT já NÃO altera o joelho (148–158 removido)', same(tt.knee, [145, 155]), JSON.stringify(tt.knee));
const mtb = resolveTargets({ posture: POSTURE_UPRIGHT, ridingStyle: 'mtb' });
check('modalidade MTB mantém o seu alvo próprio de joelho', same(mtb.knee, [140, 150]), JSON.stringify(mtb.knee));
const mtbAero = resolveTargets({ posture: POSTURE_AERO, ridingStyle: 'mtb' });
check(
  'MTB + aero: postura manda no tronco, modalidade manda no joelho',
  same(mtbAero.back, [10, 30]) && same(mtbAero.knee, [140, 150]),
  JSON.stringify({ back: mtbAero.back, knee: mtbAero.knee })
);

// ---------------------------------------------------------------------------
console.log('\n== 2. AUTORIDADE DAS MÉTRICAS por postura ==');
const authUpright = getPostureMetricAuthority({ posture: POSTURE_UPRIGHT, position: '90deg' });
const authAero = getPostureMetricAuthority({ posture: POSTURE_AERO, position: '90deg' });
check('estrada às 3h: KOPS prescreve', authUpright.kops === true, String(authUpright.kops));
check('aero às 3h: KOPS NÃO prescreve (é descritivo)', authAero.kops === false, String(authAero.kops));
check('aero: fecho da anca descritivo', authAero.hipClosure === 'descriptive', String(authAero.hipClosure));
check('aero: cabeça descritiva', authAero.head === 'descriptive', String(authAero.head));
check('aero: antebraço passa a prescritivo', authAero.forearm === true, String(authAero.forearm));
check('estrada: antebraço não prescreve', !authUpright.forearm, String(authUpright.forearm));
check(
  'aero: o joelho no BDC continua a prescrever altura de selim',
  getPostureMetricAuthority({ posture: POSTURE_AERO, position: 'bdc' }).knee === 'extension'
);

const line = formatTargetsLine(POSTURE_AERO, aero);
check('linha de alvos nomeia a postura', /Aero/.test(line), line);
check('linha de alvos diz que o joelho não muda', /igual em estrada e aero/.test(line), line);
check('linha de alvos avisa que o KOPS é descritivo em aero', /KOPS e fecho da anca descritivos/.test(line), line);

// ---------------------------------------------------------------------------
console.log('\n== 3. MEDIÇÃO DO ANTEBRAÇO (biomechanicsComputer) ==');
/** Landmarks mínimos: aero = cotovelo sob o ombro com antebraço plano à frente. */
function landmarks({ hip, shoulder, elbow, wrist, knee }) {
  const lm = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.5, visibility: 1 }));
  // Índices oficiais: lado esquerdo = ímpares (23 coxa, 25 joelho, 27 tornozelo, 11 ombro, 13 cotovelo, 15 punho)
  lm[23] = hip;
  lm[24] = hip;
  lm[25] = knee;
  lm[26] = knee;
  lm[27] = { x: knee.x, y: knee.y + 0.12 };
  lm[28] = lm[27];
  lm[11] = shoulder;
  lm[12] = shoulder;
  lm[13] = elbow;
  lm[14] = elbow;
  lm[15] = wrist;
  lm[16] = wrist;
  lm[7] = { x: shoulder.x + 0.06, y: shoulder.y - 0.06, visibility: 1 };
  lm[8] = lm[7];
  return lm;
}

const aeroPose = landmarks({
  hip: { x: 0.3, y: 0.6, visibility: 1 },
  shoulder: { x: 0.52, y: 0.56, visibility: 1 },
  elbow: { x: 0.52, y: 0.7, visibility: 1 },
  wrist: { x: 0.72, y: 0.705, visibility: 1 },
  knee: { x: 0.34, y: 0.78, visibility: 1 },
});
const aeroAngles = BiomechanicsComputer.computeFrameAngles({ lm: aeroPose, side: 'left', manualTracker: null });
check('antebraço é medido (não nulo)', typeof aeroAngles.antebraco === 'number', String(aeroAngles.antebraco));
check(
  'posição aero: antebraço praticamente horizontal (≤ 20°)',
  aeroAngles.antebraco <= 20,
  `${aeroAngles.antebraco}°`
);
check(
  'posição aero: cotovelo claramente fletido (< 120°)',
  aeroAngles.braco < 120,
  `${aeroAngles.braco}°`
);
check('posição aero: tronco plano (< 35°)', aeroAngles.costas < 35, `${aeroAngles.costas}°`);

const uprightPose = landmarks({
  hip: { x: 0.42, y: 0.78, visibility: 1 },
  shoulder: { x: 0.4, y: 0.42, visibility: 1 },
  elbow: { x: 0.36, y: 0.56, visibility: 1 },
  wrist: { x: 0.28, y: 0.66, visibility: 1 },
  knee: { x: 0.46, y: 0.9, visibility: 1 },
});
const uprightAngles = BiomechanicsComputer.computeFrameAngles({ lm: uprightPose, side: 'left', manualTracker: null });
check('posição ereta: antebraço bem acima da horizontal (> 30°)', uprightAngles.antebraco > 30, `${uprightAngles.antebraco}°`);
check('posição ereta: tronco >= 40°', uprightAngles.costas >= 40, `${uprightAngles.costas}°`);

const aeroGeom = analyzeArmGeometry(aeroAngles.points);
const uprightGeom = analyzeArmGeometry(uprightAngles.points);
check('geometria aero: cotovelo abaixo do ombro', aeroGeom && aeroGeom.elbowDropRatio >= 0.25, JSON.stringify(aeroGeom));
check(
  'geometria ereta: não passa o teste do cotovelo sob o ombro',
  uprightGeom && uprightGeom.forearmInclinationDeg > 30,
  JSON.stringify(uprightGeom)
);

// ---------------------------------------------------------------------------
console.log('\n== 4. DETEÇÃO AUTOMÁTICA (aero vs estrada) ==');
const aeroFrames = new Array(10).fill(null).map(() => ({
  costas: 24,
  braco: 105,
  points: aeroAngles.points,
}));
const uprightFrames = new Array(10).fill(null).map(() => ({
  costas: 45,
  braco: 158,
  points: uprightAngles.points,
}));
/** Caso ambíguo real: tronco de estrada mas antebraço plano (má afinação ou aero mal detetado). */
const ambiguousFrames = new Array(10).fill(null).map(() => ({
  costas: 44,
  braco: 135,
  points: {
    hipPt: { x: 0.42, y: 0.78 },
    shoulderPt: { x: 0.4, y: 0.42 },
    elbowPt: { x: 0.4, y: 0.6 },
    wristPt: { x: 0.6, y: 0.605 },
  },
}));

const detection = detectAeroPosture({ frames: aeroFrames });
check('10 fotogramas aero: amostras suficientes', detection.sufficient === true);
check('aero detetado sozinho (action = auto)', detection.action === 'auto', detection.action);
check(
  `confiança >= ${AUTO_SWITCH_CONFIDENCE} para aplicar sem perguntar`,
  detection.confidence >= AUTO_SWITCH_CONFIDENCE,
  String(detection.confidence)
);
check('aero: pontuação de estrada fica a zero', detection.uprightScore === 0, String(detection.uprightScore));
check(
  'aero: as razões citam tronco, cotovelo e antebraço',
  detection.reasons.some((r) => /Tronco/.test(r)) &&
    detection.reasons.some((r) => /Cotovelo/.test(r)) &&
    detection.reasons.some((r) => /Antebraço/.test(r)),
  detection.reasons.join(' | ')
);

const upDetection = detectAeroPosture({ frames: uprightFrames });
check('postura de estrada: nada muda (action = keep)', upDetection.action === 'keep', upDetection.action);
check('postura de estrada: pontuação aero a zero', upDetection.aeroScore === 0, String(upDetection.aeroScore));
check('postura de estrada: pontuação de estrada alta', upDetection.uprightScore >= 0.75, String(upDetection.uprightScore));

const askDetection = detectAeroPosture({ frames: ambiguousFrames });
check('caso ambíguo: PERGUNTA em vez de decidir', askDetection.action === 'ask', askDetection.action);
check(
  'caso ambíguo: nunca chega ao limiar de auto-aplicação',
  askDetection.aeroScore >= ASK_CONFIDENCE && askDetection.aeroScore < AUTO_SWITCH_CONFIDENCE,
  `${askDetection.aeroScore}`
);

const manualDetection = detectAeroPosture({
  frames: aeroFrames,
  confirmedPosture: POSTURE_UPRIGHT,
  isManualChoice: true,
});
check(
  'escolha manual (estrada) + evidência aero: pergunta, NÃO sobrepõe',
  manualDetection.action === 'ask' && manualDetection.posture === POSTURE_UPRIGHT,
  `${manualDetection.action} → ${manualDetection.posture}`
);

const alreadyAero = detectAeroPosture({ frames: uprightFrames, confirmedPosture: POSTURE_AERO, isManualChoice: true });
check(
  'já em aero com evidência de estrada: pergunta antes de voltar atrás',
  alreadyAero.action === 'ask' && alreadyAero.posture === POSTURE_AERO,
  `${alreadyAero.action} → ${alreadyAero.posture}`
);

const fewFrames = detectAeroPosture({ frames: aeroFrames.slice(0, MIN_SAMPLES_FOR_DETECTION - 1) });
check('poucas amostras: não decide nada', fewFrames.sufficient === false && fewFrames.action === 'keep');

const standing = detectAeroPosture({
  frames: new Array(10).fill(null).map(() => ({ costas: 88, braco: 172, points: null })),
});
check(
  'atleta de pé ao lado da bicicleta NÃO é classificado como aero',
  standing.action === 'keep' && standing.aeroScore === 0,
  `${standing.action} / ${standing.aeroScore}`
);

// ---------------------------------------------------------------------------
console.log('\n== 5. RELATÓRIO EM DIRETO em posição aero ==');
const kopsOff = { offsetMm: 26, isAligned: false, actionPt: 'Recuar selim ~21 mm nos carris' };
const baseReport = {
  bdcKneeAngle: 150,
  liveAngles: { joelho: 150, costas: 24, braco: 105, tornozelo: 100, cabeca: 30, antebraco: 8 },
  kopsResult: kopsOff,
  rpm: 85,
  psi: 90,
  // O KOPS só é avaliado às 3h (90°): é a posição que a regra da posição autoriza.
  crankPosition: '90deg',
};

const reportAero = LiveTuningReportManager.generateReport({ ...baseReport, targets: aero, posture: POSTURE_AERO });
const reportUpright = LiveTuningReportManager.generateReport({ ...baseReport, targets: upright, posture: POSTURE_UPRIGHT });

const kopsAero = reportAero.items.find((i) => /KOPS|Recuo do Selim/i.test(i.component));
const kopsUpright = reportUpright.items.find((i) => /KOPS|Recuo do Selim/i.test(i.component));
check('aero: o KOPS aparece como DESCRITIVO', kopsAero && /DESCRITIVO/.test(kopsAero.badge), kopsAero?.badge);
check('aero: o KOPS não é tratado como não-conformidade', kopsAero?.status === 'ok');
check(
  'aero: a mensagem do KOPS explica que a referência é o ângulo de assento',
  /78–86/.test(kopsAero?.whatToDo || ''),
  kopsAero?.whatToDo
);
check('estrada: o mesmo desvio gera ordem de recuar o selim', kopsUpright && kopsUpright.status !== 'ok', kopsUpright?.badge);check(
  'aero: 26 mm de desvio NÃO geram ordem de mexer no selim',
  !reportAero.items.some((i) => i.status !== 'ok' && /selim/i.test(i.action))
);
const bdcReport = LiveTuningReportManager.generateReport({
  ...baseReport,
  crankPosition: 'bdc',
  targets: aero,
  posture: POSTURE_AERO,
});
check(
  'aero: fora das 3h o KOPS nem aparece (não é medível nessa posição)',
  !bdcReport.items.some((i) => /KOPS/i.test(i.component)),
  bdcReport.items.map((i) => i.component).join(' | ')
);

const armAero = reportAero.items.find((i) => /Cotovelo/i.test(i.component));
check('aero: cotovelo a 105° está dentro do alvo (sem "cotovelo bloqueado")', armAero && armAero.status === 'ok', armAero?.badge);
check('aero: o texto do cotovelo fala das almofadas', /almofada/i.test(armAero?.why || ''), armAero?.component);
const armUpright = reportUpright.items.find((i) => /Avanço\/Mesa/.test(i.component));
check('estrada: os mesmos 105° gerariam ordem de cockpit', armUpright && armUpright.status !== 'ok', armUpright?.badge);

const trunkAero = reportAero.items.find((i) => /Tronco\/Stack/i.test(i.component));
check('aero: tronco a 24° é o objetivo, não um desvio', trunkAero && trunkAero.status === 'ok', trunkAero?.badge);
check('aero: o tronco é avaliado contra o alvo de aero', /10° a 30°/.test(trunkAero?.degreesInfo || ''), trunkAero?.degreesInfo);

const forearmItem = reportAero.items.find((i) => /Antebraço/i.test(i.component));
check('aero: o antebraço entra no relatório com alvo próprio', forearmItem && forearmItem.status === 'ok', forearmItem?.badge);
check('aero: níveis de antebraço fora do alvo geram aviso', (() => {
  const forked = LiveTuningReportManager.generateReport({
    ...baseReport,
    liveAngles: { ...baseReport.liveAngles, antebraco: 41 },
    targets: aero,
    posture: POSTURE_AERO,
  });
  return forked.items.some((i) => /Antebraço/i.test(i.component) && i.status !== 'ok');
})());

const headAero = reportAero.items.find((i) => /Cabeça/i.test(i.component));
check('aero: cabeça baixa é descritiva (não é desvio)', headAero && headAero.status === 'ok' && /DESCRITIVO/.test(headAero.badge), headAero?.badge);
check(
  'relatório declara com que postura foi feito',
  reportAero.posture?.id === POSTURE_AERO && /Aero/.test(reportAero.posture.targetsLine),
  reportAero.posture?.targetsLine
);
check('relatório cita as fontes dos alvos', Array.isArray(reportAero.posture.sources) && reportAero.posture.sources.length >= 2);
check(
  'aero: a pontuação de conformidade não é castigada pelo KOPS',
  reportAero.score > reportUpright.score,
  `${reportAero.score} vs ${reportUpright.score}`
);

const textAero = LiveTuningReportManager.formatTextSummary(reportAero, 'Ana', 'Bicicleta X');
check('texto copiado inclui a linha de alvos', /Alvos aplicados: Aero/.test(textAero));
check('texto copiado inclui as fontes', /Fonte dos alvos:/.test(textAero));

// ---------------------------------------------------------------------------
console.log('\n== 6. PRESCRIÇÃO FINAL do vídeo em posição aero ==');
function observation(angles, kopsMm = 26) {
  return {
    time: 1,
    ankle: { x: 500, y: 470 },
    knee: { x: 510, y: 350 },
    hip: { x: 470, y: 230 },
    angles,
    kops: { offsetMm: kopsMm, status: 'misaligned' },
    isFullBodyVisible: true,
    missingSegments: [],
  };
}
const aeroObs = observation({ joelho: 144, costas: 24, braco: 105, tornozelo: 100, cabeca: 30, anca: 78, antebraco: 8 });
const entrance = (key, times) => times.map((t) => ({ revolution: t, time: t, phaseErrorDeg: 1, observation: { ...aeroObs, time: t } }));
const analysis = {
  status: 'done',
  scan: { duration: 12, stepSeconds: 0.1, samples: 120, failures: 0 },
  phase: {
    reliable: true,
    direction: 'forward',
    completeRevolutions: 5,
    cadenceRpm: 88,
    phaseCoverageDeg: 360,
    sampleCount: 120,
    windowDeg: 12,
    rejected: [],
    coverage: { tdc: { revolutions: 5, samples: 5 }, '90deg': { revolutions: 5, samples: 5 }, bdc: { revolutions: 5, samples: 5 }, '270deg': { revolutions: 5, samples: 5 } },
    passages: {
      tdc: entrance('tdc', [0.1, 0.78, 1.46, 2.14, 2.82]),
      '90deg': entrance('90deg', [0.27, 0.95, 1.63, 2.31, 2.99]),
      bdc: entrance('bdc', [0.44, 1.12, 1.8, 2.48, 3.16]),
      '270deg': entrance('270deg', [0.61, 1.29, 1.97, 2.65, 3.33]),
    },
  },
  notes: [],
};
const profile = { weightKg: 72, shoeSizeEu: 43, heightCm: 178, inseamCm: 84 };
const finalUpright = FinalPrescriptionEngine.build({ analysis, profile, targets: upright });
const finalAero = FinalPrescriptionEngine.build({ analysis, profile, targets: aero, posture: POSTURE_AERO });

check('análise final: pronta nos dois casos', finalUpright.status === 'ready' && finalAero.status === 'ready');
check(
  'estrada: o KOPS a 3h gera prescrição de recuo do selim',
  finalUpright.prescriptions.some((p) => p.key === 'saddleForeAft'),
  finalUpright.prescriptions.map((p) => p.key).join(',')
);
check(
  'aero: o MESMO desvio de KOPS não gera prescrição de selim',
  !finalAero.prescriptions.some((p) => p.key === 'saddleForeAft'),
  finalAero.prescriptions.map((p) => p.key).join(',')
);
check(
  'aero: o KOPS fica como métrica descritiva (registada, não prescrita)',
  (finalAero.metrics || []).some((m) => m.key === 'kops' && m.descriptive === true),
  JSON.stringify((finalAero.metrics || []).filter((m) => m.key === 'kops'))
);
check(
  'aero: o antebraço entra como métrica com alvo próprio',
  (finalAero.metrics || []).some((m) => m.key === 'forearm' && m.target && m.value !== null),
  JSON.stringify((finalAero.metrics || []).filter((m) => m.key === 'forearm'))
);
check(
  'estrada: não existe métrica de antebraço',
  !(finalUpright.metrics || []).some((m) => m.key === 'forearm')
);
check('aero: o tronco é julgado contra 10–30°', (finalAero.metrics || []).some((m) => m.key === 'trunk' && m.target && m.target[0] === 10));
check(
  'aero: a prescrição final declara a postura e as fontes',
  finalAero.posture?.id === POSTURE_AERO && /Aero/.test(finalAero.posture.targetsLine) && finalAero.posture.sources.length >= 2,
  finalAero.posture?.targetsLine
);
check(
  'aero: a altura do selim continua a ser prescrita (joelho no BDC)',
  finalAero.prescriptions.some((p) => p.key === 'saddleHeight') || finalAero.metrics.some((m) => m.key === 'knee' && m.target),
  finalAero.prescriptions.map((p) => p.key).join(',')
);
const finalText = FinalPrescriptionEngine.formatText(finalAero, { athleteName: 'Ana', bikeModel: 'Bicicleta X' });
check('texto final inclui os alvos aplicados', /Alvos aplicados: Aero/.test(finalText));
check('texto final inclui as fontes dos alvos', /Fontes dos alvos:/.test(finalText));
check('texto final inclui a métrica do antebraço', /Antebraço/.test(finalText));

// ---------------------------------------------------------------------------
console.log('\n== 7. FOTOS analisadas em postura aero ==');
const photoItems = [
  {
    name: 'foto-bdc.jpg',
    status: 'done',
    crankPosition: 'bdc',
    angles: { joelho: 150, costas: 24, braco: 105, tornozelo: 100 },
    isFullBodyVisible: true,
  },
  {
    name: 'foto-90.jpg',
    status: 'done',
    crankPosition: '90deg',
    angles: { joelho: 110, costas: 24, braco: 105, tornozelo: 100 },
    kopsResult: { offsetMm: 26, isAligned: false, actionPt: 'Recuar selim ~21 mm nos carris' },
    isFullBodyVisible: true,
  },
];
const photosUpright = CoherentRecommendationEngine.build(photoItems, upright, { posture: POSTURE_UPRIGHT });
const photosAero = CoherentRecommendationEngine.build(photoItems, aero, { posture: POSTURE_AERO });
check(
  'fotos em estrada: prescrição de recuo do selim pelo KOPS',
  photosUpright.prescriptions.some((p) => p.key === 'saddleForeAft'),
  photosUpright.prescriptions.map((p) => p.key).join(',')
);
check(
  'fotos em aero: o KOPS não gera prescrição',
  !photosAero.prescriptions.some((p) => p.key === 'saddleForeAft'),
  photosAero.prescriptions.map((p) => p.key).join(',')
);
check(
  'fotos em aero: aviso a explicar que a referência é o ângulo de assento',
  photosAero.notices.some((n) => /ângulo de assento/.test(n)),
  photosAero.notices.join(' | ')
);

// ---------------------------------------------------------------------------
console.log('\n== 8. COERÊNCIA dos textos com a evidência ==');
check(
  'os números citados existem nas fontes registadas (tronco 10–30, antebraço 0–20)',
  POSTURE_TEXT_BACK_PROBE() && POSTURE_TEXT_ANTEBRACO_PROBE(),
  `${JSON.stringify(aero.back)} / ${JSON.stringify(aero.antebraco)}`
);
function POSTURE_TEXT_BACK_PROBE() {
  return aero.back[0] === 10 && aero.back[1] === 30;
}
function POSTURE_TEXT_ANTEBRACO_PROBE() {
  return aero.antebraco[0] === 0 && aero.antebraco[1] === 20;
}
const aeroModuleText = formatTargetsLine(POSTURE_AERO, aero);
check('a linha de alvos não cita o joelho como diferente em aero', /joelho no BDC 145–155° \(igual em estrada e aero\)/.test(aeroModuleText), aeroModuleText);

// ---------------------------------------------------------------------------
console.log('\n----------------------------------------------------------------------');
if (failures) {
  console.log(`❌ ${failures} verificação(ões) FALHARAM.`);
  process.exit(1);
}
console.log('✅ Todas as verificações de postura aero passaram.');
