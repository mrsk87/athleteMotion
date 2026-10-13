/**
 * Verificação automática da ANÁLISE INTEGRAL DO VÍDEO e da PRESCRIÇÃO FINAL ÚNICA.
 *
 * Executar com:  npm run verify:full-analysis
 *
 * Garante, sem navegador e sem dependências, que:
 *  1. O perfil do atleta (peso + nº de sapato) é validado e produz notas mecânicas com fonte.
 *  2. A fase do cranque é reconstruída da órbita do pé (12h/3h/6h/9h), incluindo o sentido
 *     do pedalar (perfil virado à direita ou à esquerda) e a cadência.
 *  3. O varrimento percorre o vídeo por ordem, conta amostras, tolera falhas e cancela.
 *  4. A pipeline em duas passagens mede cada posição cardeal com fotogramas phase-matched.
 *  5. **NENHUMA prescrição existe antes de o vídeo estar todo analisado** (estado bloqueado).
 *  6. A prescrição final é estatística (mediana + MAD + nº de pedaladas) e respeita o alvo
 *     DINÂMICO do joelho (≈137–150°), diferente do alvo estático das fotos (145–155°).
 *  7. É determinística: recalcular a partir da mesma análise dá exatamente o mesmo resultado.
 *  8. O GIF animado leva os TRAÇOS DO CORPO (MediaPipe): compõe-se um contexto 2D falso, corre-se
 *     a função real de composição e exigem-se esqueleto, cores de conformidade e valores angulares.
 */
import { AthleteProfile, CLEAT_SETBACK_BY_SHOE_SIZE } from '../src/components/LiveCameraCapture/modules/athleteProfile.js';
import { CrankPhaseTracker, angularDistance } from '../src/components/LiveCameraCapture/modules/crankPhaseTracker.js';
import { FullVideoScanRunner } from '../src/components/LiveCameraCapture/modules/fullVideoScanRunner.js';
import { FullVideoAnalysisPipeline } from '../src/components/LiveCameraCapture/modules/fullVideoAnalysisPipeline.js';
import { FinalPrescriptionEngine, median, medianAbsoluteDeviation } from '../src/components/LiveCameraCapture/modules/finalPrescriptionEngine.js';
import {
  getKneeTargetForRegime,
  KNEE_EXTENSION_RANGE,
  KNEE_EXTENSION_RANGE_DYNAMIC,
  DEFAULT_PHASE_WINDOW_DEG,
} from '../src/components/LiveCameraCapture/modules/crankPositionRules.js';
import { LiveTuningReportManager } from '../src/components/LiveCameraCapture/modules/liveTuningReportManager.js';
import { buildDataAccounting } from '../src/components/LiveCameraCapture/modules/technicalSummary.js';
import { GifFramePlanner, MAX_GIF_FRAMES } from '../src/components/LiveCameraCapture/modules/gifFramePlanner.js';
import {
  composeAnnotatedGifFrame,
  drawAnnotatedOverlay,
  mirrorLandmarks,
} from '../src/components/LiveCameraCapture/modules/annotatedGifFrame.js';
import { AnglesTimelineChart } from '../src/components/LiveCameraCapture/modules/anglesTimelineChart.js';
import {
  FootOrbitTrace,
  MIN_ORBIT_POINTS,
  MAX_DRAWN_POINTS,
  directionOf,
  drawFootOrbit,
  fitCircle,
  subsample,
  turnsOf,
} from '../src/components/LiveCameraCapture/modules/footOrbitTrace.js';
import { CoherentRecommendationEngine } from '../src/components/LiveCameraCapture/modules/coherentRecommendationEngine.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (rel) =>
  fs.readFileSync(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), rel), 'utf8');

const targets = { knee: [145, 155], back: [40, 50], elbow: [150, 165], ankle: [95, 105], head: [35, 55] };
let failures = 0;
function check(label, condition, extra = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` :: ${extra}` : ''}`);
}

// ---------------------------------------------------------------------------
// Simulador de atleta: órbita do pé + ângulos coerentes com a fase do cranque
// ---------------------------------------------------------------------------
const CENTER = { x: 500, y: 400 };
const RADIUS = { x: 62, y: 72 };
const DURATION = 12; // segundos de vídeo
const CADENCE_RPM = 90;
const PERIOD = 60 / CADENCE_RPM; // 0.6667 s por pedalada
const BDC_KNEE = 132; // extensão fraca no BDC -> deve gerar ordem de SUBIR o selim

/** Ponto da órbita do pé na fase `deg` (0 = 12h, 90 = 3h, 180 = 6h, 270 = 9h). */
function orbitPoint(deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: CENTER.x + RADIUS.x * Math.sin(rad), y: CENTER.y - RADIUS.y * Math.cos(rad) };
}

/** Observação biomecânica sintética no instante `time` (fase linear no tempo). */
function observationAt(time, { mirrored = false } = {}) {
  const revolutions = time / PERIOD;
  const deg = (((mirrored ? -revolutions : revolutions) * 360) % 360 + 360) % 360;
  const rad = (deg * Math.PI) / 180;
  return {
    time,
    ankle: orbitPoint(deg),
    knee: { x: CENTER.x + 10, y: CENTER.y - 120 },
    hip: { x: CENTER.x - 30, y: CENTER.y - 240 },
    angles: {
      joelho: BDC_KNEE - 40 + 40 * ((1 - Math.cos(rad)) / 2),
      costas: 46,
      braco: 152,
      tornozelo: 100,
      cabeca: 42,
      anca: 58 + 4 * Math.cos(rad),
    },
    kops: { offsetMm: 18 + 2 * Math.cos(rad), status: 'ahead' },
    isFullBodyVisible: true,
    missingSegments: [],
  };
}

// ---------------------------------------------------------------------------
console.log('\n== 1. Perfil do atleta (peso, nº de sapato e dados opcionais) ==');
const profile = AthleteProfile.normalize({ weightKg: '82,5', shoeSizeEu: '43', heightCm: 178, inseamCm: 83 });
check('aceita vírgula decimal (82,5 kg)', profile.weightKg === 82.5);
check('perfil fica completo com peso + sapato', profile.complete === true);
check('sem problemas de validação', profile.issues.length === 0);

const incomplete = AthleteProfile.normalize({ weightKg: 70 });
check('peso sem sapato => incompleto e lista o que falta', !incomplete.complete && incomplete.missingRequired.includes('shoeSizeEu'));
check('texto do que falta em português', AthleteProfile.missingLabels(incomplete.missingRequired).join(', ') === 'número de sapato');

const absurd = AthleteProfile.normalize({ weightKg: 999, shoeSizeEu: 43 });
check('peso absurdo é rejeitado com motivo', absurd.weightKg === null && absurd.issues.length === 1);

check('recuo do travessão para 43 => 9 a 11 mm', JSON.stringify(AthleteProfile.cleatSetbackForShoeSize(43)) === '{"min":9,"max":11,"band":"42–43"}');
check('recuo do travessão para 47 => 11 a 14 mm', AthleteProfile.cleatSetbackForShoeSize(47).min === 11);
check('faixas de travessão ordenadas e sem repetir tamanhos', CLEAT_SETBACK_BY_SHOE_SIZE.every((b, i) => i === 0 || b.upTo > CLEAT_SETBACK_BY_SHOE_SIZE[i - 1].upTo));
check('tamanho fora das faixas publicadas => sem referência', AthleteProfile.cleatSetbackForShoeSize(55) === null);

const lemond = AthleteProfile.saddleHeightFromInseam({ inseamCm: 83 });
check('LeMond com costura real: 83 × 0,883 ≈ 73 cm', lemond.cm === 73 && lemond.estimatedFromHeight === false);
const lemondHeight = AthleteProfile.saddleHeightFromInseam({ heightCm: 178 });
check('sem costura, estima da altura e AVISA', lemondHeight !== null && lemondHeight.estimatedFromHeight === true);
check('sem altura nem costura => sem estimativa', AthleteProfile.saddleHeightFromInseam({ weightKg: 80 }) === null);

// Cintura (perímetro abdominal): pedida no passo 1, entra como CONTEXTO — nunca como alvo.
const withWaist = AthleteProfile.normalize({ weightKg: 78, shoeSizeEu: 43, waistCm: '84' });
check('a cintura é aceite e normalizada (aceita vírgula/ponto como os outros campos)', withWaist.waistCm === 84);
check('cintura absurda é rejeitada com motivo (não entra no relatório)',
  AthleteProfile.normalize({ weightKg: 78, shoeSizeEu: 43, waistCm: 250 }).waistCm === null &&
    AthleteProfile.normalize({ weightKg: 78, shoeSizeEu: 43, waistCm: 250 }).issues.some((i) => i.field === 'waistCm'));
check('a cintura é opcional: o mínimo obrigatório continua a ser peso + sapato',
  withWaist.complete === true && AthleteProfile.normalize({ waistCm: 84 }).complete === false);
const waistNote = AthleteProfile.describe({ weightKg: 78, shoeSizeEu: 43, waistCm: 84 }).find((n) => n.key === 'waist');
check('a nota da cintura remete para o fecho da anca medido às 12h (alvo 50–80°)',
  Boolean(waistNote) && /fecho da anca/i.test(waistNote.text) && /50–80°/.test(waistNote.text));
check('a nota da cintura diz explicitamente que nenhum alvo muda por causa dela',
  /Nenhum alvo desta análise muda/.test(waistNote.text));
check('a nota da cintura declara que não há regra publicada que a converta em ângulo',
  /sem regra de fit publicada/.test(waistNote.source));
check('a linha do perfil mostra a cintura quando existe',
  /cintura 84 cm/.test(AthleteProfile.formatLine({ weightKg: 78, shoeSizeEu: 43, waistCm: 84 })) &&
    !/cintura/.test(AthleteProfile.formatLine({ weightKg: 78, shoeSizeEu: 43 })));

const notes = AthleteProfile.describe({ weightKg: 96, shoeSizeEu: 45, inseamCm: 84 });
check('notas mecânicas cobrem peso, sapato e selim', notes.length === 3);
check('atleta pesado => nota de sag de suspensão', /sag de suspensão/.test(notes[0].text) && notes[0].text.includes('25–33%'));
check('nota do sapato traz a referência dos travessões', /10–12 mm/.test(notes[1].text));
check('toda a nota declara a fonte', notes.every((n) => Boolean(n.source)));

// ---------------------------------------------------------------------------
console.log('\n== 2. Fase do cranque a partir da órbita do pé ==');
const gridStep = 1 / 30;
const gridTimes = [];
for (let t = 0; t < DURATION - gridStep / 2; t += gridStep) gridTimes.push(Math.round(t * 10000) / 10000);

const tracker = new CrankPhaseTracker();
gridTimes.forEach((time) => tracker.addObservation(observationAt(time)));
const phase = tracker.build();
check('fase reconstruída e fiável', phase.reliable === true, phase.reason || '');
check('12s a 90 rpm => ~18 pedaladas', phase.completeRevolutions === 17 || phase.completeRevolutions === 18, `(${phase.completeRevolutions})`);
check('cadência calculada ≈ 90 rpm', Math.abs(phase.cadenceRpm - CADENCE_RPM) < 1.5, `(${phase.cadenceRpm})`);
check('pedalar detetado no sentido normal', phase.direction === 'forward');
check('cobertura angular completa (maior intervalo entre amostras ≤ 90°)', phase.phaseCoverageDeg >= 270, `(${phase.phaseCoverageDeg})`);

const crossings = tracker.findCrossings(10);
check('4 passagens por pedalada nas últimas 10 pedaladas', crossings.length === 40, `(${crossings.length})`);
const bdcCrossings = crossings.filter((c) => c.key === 'bdc');
check(
  'BDC cai onde o pé está mais baixo',
  bdcCrossings.every((c) => Math.abs(observationAt(c.time).ankle.y - (CENTER.y + RADIUS.y)) < 2),
  `(max ${CENTER.y + RADIUS.y})`
);
const tdcCrossings = crossings.filter((c) => c.key === 'tdc');
check(
  'TDC (12h) cai onde o pé está mais alto',
  tdcCrossings.every((c) => Math.abs(observationAt(c.time).ankle.y - (CENTER.y - RADIUS.y)) < 2)
);
const threeCrossings = crossings.filter((c) => c.key === '90deg');
check(
  '90° (3h) cai no ponto mais avançado do pé',
  threeCrossings.every((c) => observationAt(c.time).ankle.x > CENTER.x + RADIUS.x - 2)
);

// Perfil virado à esquerda: a órbita corre ao contrário e tem de ser espelhada.
const mirroredTracker = new CrankPhaseTracker();
gridTimes.forEach((time) => mirroredTracker.addObservation(observationAt(time, { mirrored: true })));
const mirroredPhase = mirroredTracker.build();
check('sentido inverso detetado como espelhado', mirroredPhase.mirrored === true && mirroredPhase.direction === 'mirrored');
const mirroredBdc = mirroredTracker.findCrossings(4).filter((c) => c.key === 'bdc');
check('com o perfil virado à esquerda, o BDC continua no ponto mais baixo', mirroredBdc.every((c) => Math.abs(observationAt(c.time, { mirrored: true }).ankle.y - (CENTER.y + RADIUS.y)) < 2));

// Órbita inexistente (o ciclista não pedala): fase não pode ser dada como fiável.
const flatTracker = new CrankPhaseTracker();
gridTimes.forEach((time) => flatTracker.addObservation({ time, ankle: { x: 500, y: 400 } }));
const flatPhase = flatTracker.build();
check('trajetória imóvel => fase não fiável com motivo', flatPhase.reliable === false && Boolean(flatPhase.reason));

// Janela de tolerância: um fotograma desviado 30° tem de ser rejeitado.
const offObservation = { ...observationAt(PERIOD * (1 + 30 / 360)), ankle: orbitPoint(210), intended: { key: 'bdc', revolution: 0 } };
const bucketed = CrankPhaseTracker.bucketPassages([offObservation], phase.bounds, phase.mirrored, 12);
check('amostra a 30° do BDC é rejeitada', bucketed.passages.bdc.length === 0 && bucketed.rejected.length === 1);
check('distância angular é simétrica', angularDistance(10, 350) === 20 && angularDistance(200, 10) === 170);

// ---------------------------------------------------------------------------
console.log('\n== 3. Varrimento integral (ordem, progresso, falhas e cancelamento) ==');
const gridEntries = FullVideoScanRunner.buildGridEntries({ start: 0, end: DURATION, stepSeconds: gridStep });
check('malha cobre o vídeo inteiro', gridEntries.length === gridTimes.length && gridEntries[0].time === 0);
check('malha é estritamente crescente (leitura sequencial)', gridEntries.every((e, i) => i === 0 || e.time > gridEntries[i - 1].time));
check('malha nunca pede além da duração', gridEntries[gridEntries.length - 1].time < DURATION);
check('passo adapta-se à duração do vídeo', FullVideoAnalysisPipeline.computeGridStep(60) <= 0.1 && FullVideoAnalysisPipeline.computeGridStep(2) === 1 / 30);

const emptyRunner = new FullVideoScanRunner({ processFrame: async () => null, maxConsecutiveFailures: 5 });
const emptyRun = await emptyRunner.runGrid({ start: 0, end: 5, stepSeconds: 0.5 });
check('sem pose em nenhuma amostra => varrimento abortado', emptyRun.status === 'failed' && emptyRun.samples === 0);
check('aborta após 5 falhas consecutivas', emptyRun.scanned === 5, `(${emptyRun.scanned})`);

let progressCalls = 0;
const cancelRunner = new FullVideoScanRunner({
  processFrame: async (time) => {
    if (time > 1) cancelRunner.cancel();
    return observationAt(time);
  },
  onProgress: () => progressCalls++,
});
const cancelled = await cancelRunner.runGrid({ start: 0, end: 10, stepSeconds: 1 / 30 });
check('cancelamento interrompe o varrimento', cancelled.status === 'cancelled');
check('progresso reportado durante o varrimento', progressCalls > 0, `(${progressCalls})`);
check('observações recolhidas ficam guardadas', cancelRunner.observations.length > 0);

// ---------------------------------------------------------------------------
console.log('\n== 4. Pipeline em duas passagens (malha + refinação phase-matched) ==');
const scanner = new FullVideoScanRunner({ processFrame: async (time) => observationAt(time) });
const progressStages = [];
const pipeline = new FullVideoAnalysisPipeline({
  scanner,
  onProgress: (payload) => progressStages.push(payload.stage),
});
const analysis = await pipeline.run({ duration: DURATION });
check('análise concluída dentro das duas passagens', analysis.status === 'done' && analysis.scan.grid.status === 'done');
check('refinação executada', Boolean(analysis.scan.refine) && analysis.scan.refine.samples === 40, `(${analysis.scan.refine?.samples})`);
check('progresso passa pela malha e pela refinação', progressStages.includes('grid') && progressStages.includes('refine') && progressStages.includes('complete'));
check('progresso começa em 0% e acaba em 100%', progressStages[0] === 'grid');
check('fase final fiável depois da refinação', analysis.phase.reliable === true);
check(
  'todas as posições cardeais têm passagens válidas',
  ['tdc', '90deg', 'bdc', '270deg'].every((key) => analysis.phase.coverage[key].revolutions >= 5),
  JSON.stringify(analysis.phase.coverage)
);
check(
  'erro de fase das amostras refinadas fica na janela',
  analysis.phase.rejected.length === 0 && ['tdc', '90deg', 'bdc', '270deg'].every((key) => analysis.phase.passages[key].every((p) => p.phaseErrorDeg <= 12))
);
check('prova estatística: 10 pedaladas por posição', analysis.phase.passages.bdc.length === 10, `(${analysis.phase.passages.bdc.length})`);

// ---------------------------------------------------------------------------
console.log('\n== 5. BLOQUEIO: nada é prescrito antes do fim da análise ==');
const whileScanning = FinalPrescriptionEngine.build({
  analysis: null,
  scanning: true,
  progress: { percent: 43 },
  profile,
  targets,
});
check('durante o varrimento: estado pendente e bloqueado', whileScanning.status === 'pending' && whileScanning.locked === true);
check('durante o varrimento: ZERO prescrições', whileScanning.prescriptions.length === 0);
check('durante o varrimento: percentagem divulgada', whileScanning.percent === 43);
check('durante o varrimento: motivo explícito', /em curso/.test(whileScanning.lockReason));

const notLoaded = FinalPrescriptionEngine.build({ analysis: null, scanning: false, progress: null, profile, targets });
check('sem análise nenhuma: continua bloqueado', notLoaded.status === 'pending' && notLoaded.prescriptions.length === 0);

const failedAnalysis = FinalPrescriptionEngine.build({ analysis: { status: 'failed', reason: 'vídeo corrompido' }, profile, targets });
check('análise falhada: sem prescrição e motivo visível', failedAnalysis.status === 'failed' && failedAnalysis.prescriptions.length === 0 && failedAnalysis.lockReason === 'vídeo corrompido');

const cancelledAnalysis = FinalPrescriptionEngine.build({ analysis: { status: 'cancelled', reason: 'x' }, profile, targets });
check('análise cancelada: sem prescrição', cancelledAnalysis.status === 'cancelled' && cancelledAnalysis.prescriptions.length === 0);

const noBdc = FinalPrescriptionEngine.build({
  analysis: {
    status: 'done',
    scan: { duration: 10, stepSeconds: 0.1, samples: 100, failures: 0 },
    phase: {
      reliable: true,
      direction: 'forward',
      completeRevolutions: 5,
      cadenceRpm: 85,
      phaseCoverageDeg: 360,
      sampleCount: 100,
      windowDeg: 12,
      rejected: [],
      coverage: { tdc: { revolutions: 5, samples: 5 }, '90deg': { revolutions: 5, samples: 5 }, bdc: { revolutions: 0, samples: 0 }, '270deg': { revolutions: 5, samples: 5 } },
      passages: {
        tdc: [],
        '270deg': [],
        bdc: [],
        '90deg': [
          {
            revolution: 0,
            time: 1,
            phaseErrorDeg: 1,
            observation: observationAt(PERIOD / 4),
          },
        ],
      },
    },
  },
  profile,
  targets,
});
check('sem passagem pelo BDC: análise insuficiente', noBdc.status === 'insufficient');
check('sem BDC: nenhuma prescrição de altura de selim', !noBdc.prescriptions.some((p) => p.key === 'saddleHeight'));
check('sem BDC: posição em falta nomeada', noBdc.missingPositions.includes('BDC (6h)'));
check('sem BDC: vista de interface sem itens', FinalPrescriptionEngine.toReportView(noBdc).items.length === 0);

// ---------------------------------------------------------------------------
console.log('\n== 6. Prescrição final única (depois de 100% analisado) ==');
const final = FinalPrescriptionEngine.build({
  analysis,
  profile,
  targets,
  video: { name: 'pedalada.mp4', durationSeconds: DURATION },
});
check('estado final: pronto e desbloqueado', final.status === 'ready' && final.locked === false);
check('confiança alta com 10 pedaladas e dispersão nula', final.confidence.level === 'high' && final.confidence.score === 100);
check('prescreve altura do selim (joelho a 132° no BDC)', final.prescriptions.some((p) => p.key === 'saddleHeight'));
const saddle = final.prescriptions.find((p) => p.key === 'saddleHeight');
check('ordem é SUBIR o selim', saddle.direction === 'raise' && /Subir selim/.test(saddle.action));
check('prova estatística anexada à prescrição', saddle.statistics.revolutions === 10 && saddle.statistics.position === 'BDC (6h)');
check(
  'texto do alvo não atribui o método ESTÁTICO Holmes a uma medição dinâmica',
  /dinâmica de pedalada ativa/.test(saddle.degreesInfo) && !/Holmes/.test(saddle.degreesInfo)
);
const staticCase = CoherentRecommendationEngine.build(
  [
    { status: 'done', name: 'bdc1.jpg', crankPosition: 'bdc', angles: { joelho: 132, costas: 46, braco: 152, tornozelo: 100 }, kopsResult: null },
    { status: 'done', name: 'bdc2.jpg', crankPosition: 'bdc', angles: { joelho: 132, costas: 46, braco: 152, tornozelo: 100 }, kopsResult: null },
  ],
  targets
);
check(
  'numa medição estática o texto cita corretamente o método Holmes',
  /Holmes/.test(staticCase.prescriptions[0].degreesInfo)
);
check('mediana do joelho no BDC lida corretamente', final.positions.bdc.metrics.find((m) => m.key === 'knee').value === BDC_KNEE);
check('dispersão medida (MAD)', final.positions.bdc.metrics.find((m) => m.key === 'knee').mad === 0);
check('KOPS às 3h gera recuo do selim', final.prescriptions.some((p) => p.key === 'saddleForeAft' && p.direction === 'back'));
check('três componentes coerentes no máximo', final.prescriptions.length === 2, `(${final.prescriptions.length})`);
check('nenhuma ordem contraditória sobre o selim', new Set(final.prescriptions.filter((p) => p.key.startsWith('saddle')).map((p) => p.key)).size === 2);
check('score final coerente com as prescrições', final.score === 76, `(${final.score})`);
check('corpo inteiro enquadrado é reportado por posição', final.fullBodyRatio === 1 && final.positions.bdc.fullBodyRatio === 1);

// Se parte do vídeo não tiver o corpo todo, a fração tem de o dizer (o painel clínico usa-a).
const partialBody = {
  ...analysis,
  phase: {
    ...analysis.phase,
    passages: {
      ...analysis.phase.passages,
      bdc: analysis.phase.passages.bdc.map((entry, index) => ({
        ...entry,
        observation: { ...entry.observation, isFullBodyVisible: index % 2 === 0 },
      })),
    },
  },
};
const partialReport = FinalPrescriptionEngine.build({ analysis: partialBody, profile, targets });
check('vídeo com enquadramento parcial é sinalizado (0.5, não 1.0)', partialReport.fullBodyRatio === 0.5, `(${partialReport.fullBodyRatio})`);

// -------------------------------------------------------------------------
console.log('\n== 6b. O MESMO ângulo é lido de forma diferente conforme o regime de medição ==');
check('alvo estático mantém-se 145–155°', JSON.stringify(getKneeTargetForRegime(KNEE_EXTENSION_RANGE, 'static')) === JSON.stringify(KNEE_EXTENSION_RANGE));
check('alvo dinâmico passa a 137–150°', JSON.stringify(getKneeTargetForRegime(KNEE_EXTENSION_RANGE, 'dynamic')) === JSON.stringify(KNEE_EXTENSION_RANGE_DYNAMIC));

/** Reconstrói a análise sintética com uma extensão do joelho específica (todas as posições). */
function analysisWithKnee(value) {
  const passages = {};
  ['tdc', '90deg', 'bdc', '270deg'].forEach((key) => {
    passages[key] = analysis.phase.passages[key].map((entry) => ({
      ...entry,
      observation: { ...entry.observation, angles: { ...entry.observation.angles, joelho: value } },
    }));
  });
  return { ...analysis, phase: { ...analysis.phase, passages } };
}

const knee143Video = FinalPrescriptionEngine.build({ analysis: analysisWithKnee(143), profile, targets });
check(
  '143° medidos em pedalada ativa (vídeo) NÃO geram ordem de mexer no selim',
  !knee143Video.prescriptions.some((p) => p.key === 'saddleHeight')
);
const knee143Static = LiveTuningReportManager.generateReport({
  bdcKneeAngle: 143,
  liveAngles: { joelho: 143 },
  targets,
  crankPosition: 'bdc',
});
check(
  'os MESMOS 143° numa medição estática (foto) SÃO desvio e pedem subir o selim',
  knee143Static.items.some((item) => /Subir selim/.test(item.action))
);

// ---------------------------------------------------------------------------
console.log('\n== 7. Determinismo, vista de interface e texto exportável ==');
const again = FinalPrescriptionEngine.build({ analysis, profile, targets, video: { name: 'pedalada.mp4', durationSeconds: DURATION } });
check('recalcular dá exatamente a mesma prescrição', JSON.stringify(again.prescriptions) === JSON.stringify(final.prescriptions));
const recomputed = FinalPrescriptionEngine.build({ analysis, profile, targets, video: { name: 'pedalada.mp4', durationSeconds: DURATION } });
check('nenhuma medida ao vivo entra no cálculo final (objeto inteiro igual)', JSON.stringify(recomputed) === JSON.stringify(again));

const view = FinalPrescriptionEngine.toReportView(final);
check('vista de interface expõe os itens prescritos', view.items.filter((i) => i.status !== 'ok').length === 2);
check('medidas descritivas entram como informação, não como ordem', view.items.filter((i) => i.descriptive).every((i) => i.status === 'ok' && i.badge.includes('DESCRITIVO')));
check('vista bloqueada não mostra itens', FinalPrescriptionEngine.toReportView(whileScanning).items.length === 0);

const text = FinalPrescriptionEngine.formatText(final, { athleteName: 'Ana', bikeModel: 'Bicicleta X' });
check('texto identifica o relatório FINAL', /RELATÓRIO FINAL ÚNICO/.test(text));
check('texto explica como foi medido', /COMO FOI MEDIDO/.test(text) && /pedaladas completas/i.test(text));
check('texto lista as medições por posição do cranque', /MEDIÇÕES POR POSIÇÃO DO CRANQUE/.test(text) && /BDC \(6h\)/.test(text));
check('texto traz a prova por número de pedaladas', /mediana de 10 pedalada\(s\)/.test(text));
check('texto inclui o perfil do atleta', /82.5 kg/.test(text) && /sapato 43 EU/.test(text));
check('texto declara a imutabilidade', /não\nmuda com o avançar da reprodução/.test(text));
check('texto bloqueado explica porque não há prescrição', /PRESCRIÇÃO INDISPONÍVEL/.test(FinalPrescriptionEngine.formatText(whileScanning, {})));

check('mediana e MAD robustos a um valor extremo', median([10, 11, 12, 900]) === 11.5 && medianAbsoluteDeviation([10, 11, 12, 900]) === 1);

// ---------------------------------------------------------------------------
// 7b. A perna respeita a posição do pé: o joelho de cada fase é lido contra a janela
//     DAQUELA posição (o joelho com o pé em cima é ~2x mais fletido do que com o pé
//     em baixo — comparar os dois com o mesmo alvo é um erro de leitura do relatório).
// ---------------------------------------------------------------------------
console.log('\n== 7b. O relatório é fiel à posição do pé na pedaleira ==');
const kneeOf = (key) => final.positions[key].metrics.find((m) => m.key === 'knee');
const bdcKnee = kneeOf('bdc');
const tdcKnee = kneeOf('tdc');
const threeKnee = kneeOf('90deg');
const nineKnee = kneeOf('270deg');

check(
  'cada posição declara onde está o pé',
  ['tdc', '90deg', 'bdc', '270deg'].every((key) => /pé/.test(final.positions[key].footPositionPt || '')),
  JSON.stringify(['tdc', '90deg', 'bdc', '270deg'].map((key) => final.positions[key].footPositionPt))
);
check(
  'só o joelho com o pé EM BAIXO (6h) prescreve altura de selim',
  Array.isArray(bdcKnee.target) && !tdcKnee.target && !threeKnee.target && !nineKnee.target
);
check(
  'o joelho com o pé EM CIMA (12h) leva a janela DESSA posição (e é muito mais fletido)',
  tdcKnee.referenceRange[0] === 60 &&
    tdcKnee.referenceRange[1] === 80 &&
    tdcKnee.referenceRange[1] < bdcKnee.target[0] - 40,
  JSON.stringify({ tdc: tdcKnee.referenceRange, bdc: bdcKnee.target })
);
check(
  'o joelho a 3h e a 9h fica na transição, entre a flexão máxima e a extensão',
  threeKnee.referenceRange[0] === 95 &&
    nineKnee.referenceRange[1] === 125 &&
    threeKnee.referenceRange[0] > tdcKnee.referenceRange[1] &&
    threeKnee.referenceRange[1] < bdcKnee.target[0]
);
check(
  'as janelas de referência citam as fontes que as sustentam',
  (bdcKnee.referenceSources || []).length > 0 && (tdcKnee.referenceSources || []).length > 0
);
check(
  'a nota do joelho nomeia a posição do pé em todas as fases',
  /pé em baixo \(6h\)/.test(bdcKnee.note) &&
    /pé em cima \(12h\)/.test(tdcKnee.note) &&
    /pé à frente \(3h\)/.test(threeKnee.note) &&
    /pé atrás \(9h\)/.test(nineKnee.note)
);
check(
  'todas as ordens de ajuste levam a posição do pé (nenhuma linha sem posição)',
  view.items.filter((i) => i.status !== 'ok').every((i) => Boolean(i.positionLabel)),
  JSON.stringify(view.items.filter((i) => i.status !== 'ok').map((i) => i.positionLabel))
);
check(
  'a linha da tabela de ajustes identifica onde está o pé',
  view.items.some((i) => /pé/.test(i.positionFoot || '')),
  JSON.stringify(view.items.map((i) => i.positionFoot).filter(Boolean))
);
check(
  'o texto relata a posição do pé de cada fase medida',
  /pé em baixo \(6h\)/.test(text) && /pé em cima \(12h\)/.test(text) && /pé à frente \(3h\)/.test(text) && /pé atrás \(9h\)/.test(text)
);
check(
  'o texto usa a janela DA POSIÇÃO (não a do BDC) nas medições descritivas',
  /referência nesta posição 60–80°/.test(text) && /referência nesta posição 95–125°/.test(text)
);
check('o texto diz que a janela é contexto e não ordem', /posição do pé:/.test(text));
check(
  'o texto declara a procedência: prática às 12h e dedução às 3h/9h',
  /Referência prática 60–80°/.test(text) && /deduzida entre a flexão máxima às 12h/.test(text)
);

// ---------------------------------------------------------------------------
// 7d. O GIF ANIMADO leva os traços do corpo (MediaPipe) e cobre o vídeo inteiro
// ---------------------------------------------------------------------------
console.log('\n== 7d. O GIF do vídeo leva os traços do corpo ==');
const plannerLive = new GifFramePlanner();
check('a reprodução guarda um fotograma a cada 100 ms (10 FPS)',
  plannerLive.shouldCaptureLive(1000) === true &&
    plannerLive.shouldCaptureLive(1050) === false &&
    plannerLive.shouldCaptureLive(1100) === true &&
    plannerLive.shouldCaptureLive(1200) === true);

const plannerScan = new GifFramePlanner();
const duration = 12;
const sampled = [];
// Malha ao estilo do varrimento (1/30 s) e depois a refinação, que RECUA no tempo: a ordem
// não pode contar para a cobertura.
for (let t = 0; t < duration; t += 1 / 30) sampled.push(Math.round(t * 100) / 100);
for (let t = duration - 0.5; t >= 0; t -= 0.5) sampled.push(Math.round(t * 100) / 100);
sampled.forEach((t) => {
  if (plannerScan.shouldCaptureAtTime(t, duration)) plannerScan.markCaptured();
});
check('o varrimento enche o álbum até ao limite (nunca o ultrapassa)', plannerScan.count === MAX_GIF_FRAMES, String(plannerScan.count));
check('os fotogramas ficam distribuídos por TODAS as fatias do vídeo (cobertura completa)',
  plannerScan.coveredSlots === MAX_GIF_FRAMES, String(plannerScan.coveredSlots));
check('amostras fora de ordem não duplicam fatias (a refinação recua no tempo)',
  plannerScan.shouldCaptureAtTime(1, duration) === false && plannerScan.shouldCaptureAtTime(11.6, duration) === false);
check('álbum cheio deixa de aceitar fotogramas',
  plannerScan.full === true && plannerScan.shouldCaptureAtTime(6, duration) === false && plannerScan.shouldCaptureLive(999999) === false);
check('tempo negativo ou fora do vídeo cai na última fatia válida',
  (() => { const p = new GifFramePlanner(); return p.shouldCaptureAtTime(-3, duration) === true && p.shouldCaptureAtTime(999, duration) === true && p.shouldCaptureAtTime(0, duration) === false; })());
check('sem duração conhecida o varrimento cai no ritmo da reprodução (nunca captura em rajada)',
  (() => { const p = new GifFramePlanner(); const a = p.shouldCaptureAtTime(1, 0); const b = p.shouldCaptureAtTime(1.5, 0); return a === true && b === false; })());
check('`reset` limpa o álbum para a análise seguinte',
  (() => { const p = new GifFramePlanner(); p.shouldCaptureLive(0); p.markCaptured(); p.reset(); return p.count === 0 && p.coveredSlots === 0 && p.shouldCaptureLive(10) === true; })());

// --- 7d.1 Prova COMPORTAMENTAL: o que sai no fotograma do GIF -------------------------
// Um contexto 2D falso grava tudo o que é desenhado, e a função REAL que compõe o fotograma
// do GIF é executada sobre ele com marcos do MediaPipe. Sem traços gravados, não havia teste.
function createRecordingContext() {
  const calls = [];
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'calls') return calls;
      if (prop in t) return t[prop];
      // `measureText` devolve métricas: sem isto o desenho de guias rebentava no contexto falso.
      if (prop === 'measureText') return (text) => ({ width: String(text).length * 7 });
      return (...args) => {
        calls.push({ name: String(prop), args });
        return undefined;
      };
    },
    set(t, prop, value) {
      calls.push({ name: `set:${String(prop)}`, args: [value] });
      t[prop] = value;
      return true;
    },
  });
}

/** 33 marcos ao estilo do MediaPipe Pose (ímpares = esquerdo), todos bem visíveis. */
function fakeLandmarks() {
  const base = [
    [0.50, 0.12], [0.48, 0.16], [0.52, 0.16], [0.46, 0.18], [0.54, 0.18],
    [0.44, 0.20], [0.56, 0.20], [0.47, 0.14], [0.53, 0.14], [0.45, 0.22],
    [0.55, 0.22], [0.46, 0.30], [0.55, 0.30], [0.44, 0.42], [0.57, 0.42],
    [0.43, 0.52], [0.58, 0.52], [0.43, 0.54], [0.58, 0.54], [0.42, 0.56],
    [0.59, 0.56], [0.42, 0.58], [0.59, 0.58], [0.45, 0.55], [0.54, 0.55],
    [0.45, 0.72], [0.55, 0.72], [0.45, 0.88], [0.55, 0.88], [0.45, 0.90],
    [0.55, 0.90], [0.46, 0.92], [0.54, 0.92],
  ];
  return base.map(([x, y]) => ({ x, y, z: 0, visibility: 0.9 }));
}

const gifLandmarks = fakeLandmarks();
const gifVideo = { readyState: 4, videoWidth: 1280, videoHeight: 720 };
const goodAngles = { joelho: 150, costas: 45, braco: 158, tornozelo: 100, cabeca: 45 };
const count = (calls, name) => calls.filter((c) => c.name === name).length;
const colors = (calls, prop) => calls.filter((c) => c.name === `set:${prop}`).map((c) => String(c.args[0]));

const recGood = createRecordingContext();
const composed = composeAnnotatedGifFrame(recGood, gifVideo, {
  width: 1280,
  height: 720,
  landmarks: gifLandmarks,
  angles: goodAngles,
  targets,
  side: 'left',
  flipped: false,
});
check('o fotograma do GIF leva a imagem do vídeo', composed === true && count(recGood.calls, 'drawImage') === 1);
check('o fotograma do GIF leva o ESQUELETO: um traço por osso, com espessura e cor',
  count(recGood.calls, 'lineTo') >= 16 && count(recGood.calls, 'stroke') >= 16,
  `${count(recGood.calls, 'lineTo')} segmentos / ${count(recGood.calls, 'stroke')} traços`);
check('cada segmento sai com a espessura definida (não são traços degenerados)',
  colors(recGood.calls, 'lineWidth').length >= 16 && colors(recGood.calls, 'lineCap').includes('round'));
check('as articulações principais levam o valor angular impresso',
  recGood.calls.filter((c) => c.name === 'fillText' && /°/.test(String(c.args[0]))).length >= 5,
  recGood.calls.filter((c) => c.name === 'fillText' && /°/.test(String(c.args[0]))).map((c) => c.args[0]).join(' '));
check('marcador de cada articulação leva halo (arc + fill)',
  count(recGood.calls, 'arc') >= 10 && count(recGood.calls, 'fill') >= 5);
check('com os ângulos dentro do alvo os traços saem a VERDE (conformidade)',
  colors(recGood.calls, 'strokeStyle').includes('rgba(0, 255, 0, 0.85)'));
check('dentro do alvo não se desenham guias de correção (setLineDash ausente)',
  count(recGood.calls, 'setLineDash') === 0);

const recBad = createRecordingContext();
composeAnnotatedGifFrame(recBad, gifVideo, {
  width: 1280,
  height: 720,
  landmarks: gifLandmarks,
  angles: { ...goodAngles, joelho: 120 },
  targets,
  side: 'left',
  flipped: false,
});
check('com o joelho longe do alvo os traços saem a VERMELHO e com guias tracejadas',
  colors(recBad.calls, 'strokeStyle').includes('rgba(255, 51, 51, 0.85)') &&
    count(recBad.calls, 'setLineDash') > 0);

const recNoFrame = createRecordingContext();
check('vídeo ainda sem fotograma descodificado não gera imagem às escuras',
  composeAnnotatedGifFrame(recNoFrame, { readyState: 1, videoWidth: 1280, videoHeight: 720 }, {
    width: 1280,
    height: 720,
    landmarks: gifLandmarks,
    angles: goodAngles,
    targets,
  }) === false && recNoFrame.calls.length === 0);

check('sem marcos da pose o fotograma não é dado como anotado',
  composeAnnotatedGifFrame(createRecordingContext(), gifVideo, {
    width: 1280,
    height: 720,
    angles: goodAngles,
    targets,
  }) === false);

const recFlipped = createRecordingContext();
composeAnnotatedGifFrame(recFlipped, gifVideo, {
  width: 1280,
  height: 720,
  landmarks: gifLandmarks,
  angles: goodAngles,
  targets,
  side: 'left',
  flipped: true,
});
const originalX = gifLandmarks[11].x;
const expectedMirrorX = (1 - originalX) * 1280;
const firstMove = recFlipped.calls.find((c) => c.name === 'moveTo');
check('vídeo espelhado: o esqueleto é espelhado com ele (cai sobre o corpo)',
  recFlipped.calls.some((c) => c.name === 'scale' && c.args[0] === -1 && c.args[1] === 1) &&
    firstMove && Math.abs(firstMove.args[0] - expectedMirrorX) < 0.5,
  firstMove ? `x=${firstMove.args[0]} esperado=${expectedMirrorX}` : 'sem traço');
check('espelhar marcos não altera o original',
  Math.abs(mirrorLandmarks(gifLandmarks)[11].x - (1 - originalX)) < 1e-9 &&
    gifLandmarks[11].x === originalX);

// A camada do GIF é a MESMA do overlay ao vivo: o que se vê no ecrã é o que sai no GIF.
const recLive = createRecordingContext();
const liveOk = drawAnnotatedOverlay(recLive, 1280, 720, {
  landmarks: gifLandmarks,
  angles: goodAngles,
  targets,
  side: 'left',
});
check('a camada partilhada desenha os mesmos traços do overlay ao vivo',
  liveOk === true &&
    count(recLive.calls, 'stroke') === count(recGood.calls, 'stroke') &&
    count(recLive.calls, 'fillText') === count(recGood.calls, 'fillText'),
  `${count(recLive.calls, 'stroke')} vs ${count(recGood.calls, 'stroke')} traços`);

// --- 7d.2 A ligação no componente ------------------------------------------------
const gifJs = read('src/components/LiveCameraCapture/LiveCameraCapture.js');
check('o fotograma do GIF é COMPOSTO por nós (vídeo + traçado), não copiado do ecrã',
  /captureAnnotatedGifFrame/.test(gifJs) &&
    /composeAnnotatedGifFrame\(ctx, video, \{[\s\S]{0,220}?landmarks: frame\.landmarks \|\| this\.lastSmoothedLandmarks/.test(gifJs) &&
    /angles: frame\.angles \|\| this\.liveAngles/.test(gifJs));
check('o esqueleto ao vivo e o do GIF vêm da MESMA camada (não podem divergir)',
  /drawAnnotatedOverlay\(ctx, w, h, \{[\s\S]{0,240}?landmarks: this\.lastSmoothedLandmarks/.test(gifJs) &&
    /import \{ composeAnnotatedGifFrame, drawAnnotatedOverlay \} from '\.\/modules\/annotatedGifFrame'/.test(gifJs));
check('o traçado é desenhado com os pontos E os ângulos DAQUELE fotograma (não os ao vivo)',
  /collectGifFrame\(time, \{\s*landmarks: results\.poseLandmarks,\s*angles: observation\.angles,/.test(gifJs));
check('o fotograma é desenhado fora do ecrã (não mexe no que o utilizador vê)',
  gifJs.includes("document.createElement('canvas')") && gifJs.includes("toDataURL('image/jpeg'"));
check('o varrimento integral alimenta o GIF com o instante amostrado',
  /collectGifFrame\(time, \{\s*landmarks: results\.poseLandmarks,\s*angles: observation\.angles,\s*\}, \{ evenSpread: true \}\)/.test(gifJs));
check('a reprodução alimenta o GIF no mesmo caminho anotado',
  /this\.collectGifFrame\(this\.videoCurrentTime \|\| 0\)/.test(gifJs));
check('já não se exporta o canvas visível tal como estiver',
  !/\$refs\.canvas\.toDataURL/.test(gifJs));
check('a exportação sem fotogramas guardados ainda compõe um fotograma anotado',
  /if \(!this\.videoCapturedFrames\.length\) \{[\s\S]{0,320}?captureAnnotatedGifFrame\(\)/.test(gifJs));
/** Corpo de um método (da assinatura até ao fecho do objeto), para asserções por conteúdo. */
function methodBody(js, signature) {
  const start = js.indexOf(signature);
  if (start < 0) return '';
  const end = js.indexOf('\n    },', start);
  return end < 0 ? js.slice(start) : js.slice(start, end);
}

// A distância entre linhas não é o que importa: o que importa é que os dois reinícios
// (álbum do GIF e curva/órbita) estejam DENTRO do mesmo método de reinício da análise.
const resetBody = methodBody(gifJs, 'resetVideoAnalysisState() {');
check(
  'vídeo novo/análise nova começa com o álbum do GIF, a curva e a órbita vazios',
  resetBody.includes('this.videoCapturedFrames = []') &&
    resetBody.includes('this.gifPlanner.reset()') &&
    resetBody.includes('this.videoSamplesHistory = []') &&
    resetBody.includes('this.footOrbitTrace.reset()'),
  resetBody ? `${resetBody.length} caracteres de corpo` : 'método não encontrado'
);

// ---------------------------------------------------------------------------
// 7e. A curva dos ângulos sai da ANÁLISE e a órbita do pé é medida e desenhada
// ---------------------------------------------------------------------------
console.log('\n== 7e. Dinâmica do pé e curva dos ângulos ==');

// --- 7e.1 O gráfico desenha mesmo (contexto 2D falso que grava o que é desenhado) ---------
const chartSamples = [];
for (let t = 0; t < 12; t += 0.2) {
  chartSamples.push({
    time: t,
    joelho: 150 + 8 * Math.sin(t * 2),
    costas: 45 + 3 * Math.sin(t * 1.3),
    braco: 158,
    cabeca: 45,
    tornozelo: 100,
    isFullBody: true,
  });
}

const recChart = createRecordingContext();
AnglesTimelineChart.render(recChart, 900, 160, chartSamples, 5, 12, targets, null, {
  emptyLabel: 'SEM-AMOSTRAS',
});
const chartStrokes = count(recChart.calls, 'stroke');
const chartLines = count(recChart.calls, 'lineTo');
check('o gráfico desenha as curvas das amostras (não fica em branco)',
  chartStrokes >= 6 && chartLines >= 4 * chartSamples.length,
  `${chartStrokes} traços / ${chartLines} segmentos`);
check('o gráfico desenha a grelha de graus e a faixa do alvo do joelho',
  count(recChart.calls, 'fillText') >= 5 && count(recChart.calls, 'strokeRect') >= 1);
check('o cursor temporal marca o instante em reprodução',
  count(recChart.calls, 'moveTo') >= 5 &&
    recChart.calls.some((c) => c.name === 'fillText' && String(c.args[0]) === '5.0s'));
check('com amostras NÃO aparece o texto de espera',
  !recChart.calls.some((c) => c.name === 'fillText' && String(c.args[0]).includes('SEM-AMOSTRAS')));
const seriesColors = [
  ...new Set(recChart.calls.filter((c) => c.name === 'set:strokeStyle').map((c) => String(c.args[0]))),
].filter((color) => color && color !== 'undefined');
check('as quatro séries saem com cores distintas vindas dos tokens do tema',
  seriesColors.length >= 4, seriesColors.join(' | '));

const recOneSampleChart = createRecordingContext();
AnglesTimelineChart.render(recOneSampleChart, 900, 160, [{ time: 3, joelho: 110, costas: 45, braco: 160, cabeca: 50 }], 3, 12, targets, null, { emptyLabel: 'SEM-AMOSTRAS' });

const recEmptyChart = createRecordingContext();
AnglesTimelineChart.render(recEmptyChart, 900, 160, [], 0, 12, targets, null, {
  emptyLabel: 'SEM-AMOSTRAS',
});
check('sem amostras o gráfico escreve o texto de espera traduzido (o que vem do i18n)',
  recEmptyChart.calls.some((c) => c.name === 'fillText' && String(c.args[0]) === 'SEM-AMOSTRAS'));
check('sem amostras o gráfico escreve o texto de espera num segundo reforço (para quem lê os píxeis não ver um bloco vazio)',
  recEmptyChart.calls
    .filter((c) => c.name === 'fillText')
    .some((c) => String(c.args[0]) === 'SEM-AMOSTRAS' && c.args[2] === recEmptyChart.calls.find((c) => c.name === 'fillText' && String(c.args[0]) === 'SEM-AMOSTRAS')?.args[2] + 16),
  recEmptyChart.calls.filter((c) => c.name === 'fillText').map((c) => `${c.args[0]} @ y=${c.args[2]}`).join(' | '));
check('o gráfico só reforça o texto de espera quando explicitamente sem amostras (não em qualquer vazio)',
  recChart.calls.filter((c) => c.name === 'fillText' && String(c.args[0]) === 'SEM-AMOSTRAS').length === 0,
  recChart.calls.filter((c) => c.name === 'fillText').map((c) => `${c.args[0]} @ y=${c.args[2]}`).join(' | '));
check('com uma amostra o gráfico ainda traça a série (não fica preso num "nada")',
  recOneSampleChart.calls.some((c) => c.name === 'stroke'),
  recOneSampleChart.calls.filter((c) => c.name === 'stroke').length + ' strokes, ' + recOneSampleChart.calls.filter((c) => c.name === 'lineTo').length + ' lineTo');
check('o gráfico com uma amostra não reforça o texto de espera (o DOM já informou que há amostras)',
  recOneSampleChart.calls.filter((c) => c.name === 'fillText' && String(c.args[0]) === 'SEM-AMOSTRAS').length === 0,
  recOneSampleChart.calls.filter((c) => c.name === 'fillText').map((c) => `${c.args[0]} @ y=${c.args[1]}`).join(' | '));
check('o gráfico com uma amostra executa os mesmos comandos de renderização que com muitas amostras (não pula a série quando é curta)',
  count(recOneSampleChart.calls, 'stroke') === count(recChart.calls, 'stroke') && count(recOneSampleChart.calls, 'moveTo') === count(recChart.calls, 'moveTo'),
  `com uma amostra: ${count(recOneSampleChart.calls, 'stroke')} traços / ${count(recOneSampleChart.calls, 'moveTo')} moveTo | com muitas: ${count(recChart.calls, 'stroke')} traços / ${count(recChart.calls, 'moveTo')} moveTo`);
check('o texto de espera vem do i18n e NÃO está preso no módulo do gráfico (não há frase presa)',
  /emptyLabel: this\.t\('anglesTimelineEmpty'\)/.test(read('src/components/LiveCameraCapture/LiveCameraCapture.js')) &&
    /options\.emptyLabel \|\|/.test(read('src/components/LiveCameraCapture/modules/anglesTimelineChart.js')));
check('o gráfico vazio tem também a mensagem no DOM (não fica preso só no canvas)',
  /chartHasSamples/.test(read('src/components/LiveCameraCapture/LiveCameraCapture.js')) &&
    /chart-empty-hint/.test(read('src/components/LiveCameraCapture/LiveCameraCapture.html')) && !
    /chartHasSamples/.test(read('src/components/LiveCameraCapture/modules/anglesTimelineChart.js')));

// --- 7e.2 A órbita do pé: geometria pura ------------------------------------------------
const circlePoints = (count2, radius, laps = 1, counterClockwise = false) => {
  const out = [];
  const total = Math.round(count2 * laps);
  for (let i = 0; i < total; i++) {
    const angle = (i / count2) * 2 * Math.PI * (counterClockwise ? -1 : 1);
    out.push({ time: i / 30, x: 0.5 + radius * Math.cos(angle), y: 0.5 + radius * Math.sin(angle) });
  }
  return out;
};
const cwOrbit = circlePoints(60, 0.08, 1, false);
const ccwOrbit = circlePoints(60, 0.08, 1, true);
check('o sentido da órbita é lido dos pontos (horário vs anti-horário)',
  directionOf(cwOrbit) === 'cw' && directionOf(ccwOrbit) === 'ccw');
check('um percurso em linha não tem sentido de rotação defensável',
  directionOf([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]) === null);
check('as voltas são contadas pelo ângulo percorrido (3 pedaladas = 3 voltas)',
  Math.abs(turnsOf(circlePoints(60, 0.08, 3)) - 3) < 0.05,
  String(turnsOf(circlePoints(60, 0.08, 3))));
const exactFit = fitCircle(cwOrbit);
check('o círculo ajustado acerta no centro e no raio de uma órbita perfeita',
  Math.abs(exactFit.cx - 0.5) < 1e-6 && Math.abs(exactFit.cy - 0.5) < 1e-6 && Math.abs(exactFit.r - 0.08) < 1e-6,
  `cx=${exactFit.cx.toFixed(4)} cy=${exactFit.cy.toFixed(4)} r=${exactFit.r.toFixed(4)}`);
const noisyFit = fitCircle(cwOrbit.map((p, i) => ({ x: p.x + 0.004 * Math.sin(i), y: p.y + 0.004 * Math.cos(i * 1.7) })));
check('uma órbita torta é reportada como tal (resíduo medido, não escondido)',
  noisyFit.residual > 0 && noisyFit.residual < 0.2, String(noisyFit.residual.toFixed(3)));

// --- 7e.3 A órbita a partir das observações do varrimento -------------------------------
// Órbita sintética do tornozelo em píxeis (centro 640×360, raio 60 px) com amostras inválidas
// pelo meio, para provar que são descartadas em vez de partirem a curva.
const ankleAt = (step) => ({
  x: Math.round((640 + 60 * Math.cos((step / 8) * 2 * Math.PI)) * 1000) / 1000,
  y: Math.round((360 + 60 * Math.sin((step / 8) * 2 * Math.PI)) * 1000) / 1000,
});
const orbitObservations = [
  { time: 1.0, ankle: ankleAt(4), angles: { joelho: 150 }, isFullBodyVisible: true },
  { time: 0.0, ankle: ankleAt(0), angles: { joelho: 148 } },
  { time: 0.5, ankle: ankleAt(2), angles: { joelho: 149 } },
  { time: 0.75, angles: { joelho: 151 } },
  { time: 0.25, ankle: { x: null, y: 10 }, angles: { joelho: 147 } },
  { time: 1.25, ankle: ankleAt(5), angles: { joelho: 152 } },
  { time: 1.5, ankle: ankleAt(6), angles: { joelho: 153 } },
  { time: 1.75, ankle: ankleAt(7), angles: { joelho: 154 } },
  { time: 2.0, ankle: ankleAt(1), angles: { joelho: 155 } },
  { time: 2.25, ankle: ankleAt(3), angles: { joelho: 156 } },
];
const orbitTrace = FootOrbitTrace.fromObservations(orbitObservations, { frame: { width: 1280, height: 720 } });
check('a órbita ignora amostras sem tornozelo válido e fica por ordem temporal',
  orbitTrace.length === 8 && orbitTrace.points.map((p) => p.time).join(',') === '0,0.5,1,1.25,1.5,1.75,2,2.25',
  `${orbitTrace.length} pontos: ${orbitTrace.points.map((p) => p.time).join(',')}`);
check('os pontos ficam normalizados (independentes da resolução do vídeo)',
  Math.abs(orbitTrace.points[0].x - ankleAt(0).x / 1280) < 1e-9 &&
    Math.abs(orbitTrace.points[0].y - ankleAt(0).y / 720) < 1e-9 &&
    orbitTrace.points.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) &&
    JSON.stringify(orbitTrace.frame) === '{"width":1280,"height":720}',
  `${orbitTrace.points[0].x.toFixed(4)} , ${orbitTrace.points[0].y.toFixed(4)}`);
check('sem amostras suficientes não se inventa uma órbita',
  FootOrbitTrace.fromObservations([], {}).summary() === null &&
    new FootOrbitTrace().summary() === null &&
    new FootOrbitTrace().isDrawable === false);
/** Órbita de raio `radius` PÍXEIS num fotograma de 1000×500 (o que o varrimento regista). */
const pixelOrbitTrace = (laps = 1, radius = 60, counterClockwise = false) => {
  const trace = new FootOrbitTrace();
  const total = 40 * laps;
  for (let i = 0; i < total; i++) {
    const angle = (i / 40) * 2 * Math.PI * (counterClockwise ? -1 : 1);
    trace.addPoint(
      i / 30,
      (500 + radius * Math.cos(angle)) / 1000,
      (250 + radius * Math.sin(angle)) / 500
    );
  }
  trace.frame = { width: 1000, height: 500 };
  return trace;
};
check('o resumo traz voltas, sentido, diâmetro e trajeto do pé', (() => {
  const summary = pixelOrbitTrace(2, 60, false).summary({ pixelsPerMm: 2 });
  return (
    summary &&
    Math.abs(summary.turns - 2) < 0.05 &&
    summary.direction === 'cw' &&
    summary.diameterPx === 120 &&
    summary.diameterMm === 60 &&
    summary.travelPx.width === 120 &&
    summary.isCircular === true
  );
})());
check('o diâmetro em milímetros só existe com calibração métrica', (() => {
  const summary = pixelOrbitTrace(1, 60, false).summary();
  return summary.diameterPx === 120 && summary.diameterMm === null;
})());
check('o círculo é ajustado em píxeis (num fotograma 16:9 não vira elipse)', (() => {
  const frame = { width: 1280, height: 720 };
  const trace = new FootOrbitTrace();
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * 2 * Math.PI;
    trace.addPoint(i / 30, (640 + 90 * Math.cos(angle)) / 1280, (360 + 90 * Math.sin(angle)) / 720);
  }
  trace.frame = frame;
  const inPixels = trace.circlePixels();
  const normalized = trace.circle();
  return (
    inPixels &&
    Math.abs(inPixels.r - 90) < 1e-6 &&
    inPixels.residual < 1e-6 &&
    // Em coordenadas normalizadas o MESMO círculo de 90 px já não é um círculo.
    normalized.residual > 0.1 &&
    trace.summary().diameterPx === 180
  );
})());
check('sem resolução do fotograma não há diâmetro (não se adivinha a escala)', (() => {
  const trace = new FootOrbitTrace();
  circlePoints(40, 0.06, 1, false).forEach((p, i) => trace.addPoint(i / 30, p.x, p.y));
  const summary = trace.summary();
  return summary !== null && summary.diameterPx === null && trace.circlePixels() === null;
})());
check(`o traço é subamostrado até ${MAX_DRAWN_POINTS} pontos (o desenho fica leve)`,
  subsample(Array.from({ length: 1000 }, (_, i) => ({ x: i, y: 0 })), MAX_DRAWN_POINTS).length <= MAX_DRAWN_POINTS + 1);

// --- 7e.4 O desenho da órbita no vídeo --------------------------------------------------
const recOrbit = createRecordingContext();
const orbitDrawn = drawFootOrbit(recOrbit, orbitTrace, {
  width: 1280,
  height: 720,
  currentTime: 1.4,
  currentLabel: '1.4s',
});
check('a órbita é desenhada como percurso fechado (traços + halo) e marcador do instante atual',
  orbitDrawn === orbitTrace.length &&
    count(recOrbit.calls, 'stroke') >= 2 &&
    count(recOrbit.calls, 'lineTo') >= orbitTrace.length - 1 &&
    recOrbit.calls.some((c) => c.name === 'fillText' && String(c.args[0]) === '1.4s'),
  `${orbitDrawn} pontos / ${count(recOrbit.calls, 'stroke')} traços`);
check('a órbita mostra o círculo ajustado e o marcador do pé (3 arcos)',
  count(recOrbit.calls, 'arc') === 3, String(count(recOrbit.calls, 'arc')));
const recOrbitNoCircle = createRecordingContext();
drawFootOrbit(recOrbitNoCircle, orbitTrace, { width: 1280, height: 720, currentTime: 1.4, showCircle: false });
check('o círculo ajustado pode ser desligado sem perder o percurso',
  count(recOrbitNoCircle.calls, 'arc') === 2 && count(recOrbitNoCircle.calls, 'lineTo') > 0);
const recOrbitTiny = createRecordingContext();
check('com poucos pontos a órbita não é desenhada (nada de linhas soltas)',
  drawFootOrbit(recOrbitTiny, FootOrbitTrace.fromObservations([{ time: 0, ankle: { x: 1, y: 1 } }], { frame: { width: 10, height: 10 } }), {
    width: 1280,
    height: 720,
  }) === 0 && recOrbitTiny.calls.length === 0);
check('pontos sem resolução de fotograma não entram na órbita',
  FootOrbitTrace.fromObservations([{ time: 0, ankle: { x: 10, y: 10 } }], { frame: { width: 0, height: 0 } }).length === 0 &&
    orbitTrace.length >= MIN_ORBIT_POINTS);

// --- 7e.4b A POSIÇÃO DO PÉ NA PEDALEIRA (12h em cima, 6h em baixo, 3h/9h nos intermédios) ---
// Órbita sintética perfeita entregue em PÍXEIS (como o varrimento entrega) num fotograma
// 1000×500: o sentido horário no ecrã dá 3h à direita e o anti-horário espelha as horas.
const PIXEL_FRAME = { width: 1000, height: 500 };
const pixelOrbitObservations = (radius = 60, counterClockwise = false, samples = 40) =>
  Array.from({ length: samples }, (_, i) => {
    const angle = (i / samples) * 2 * Math.PI * (counterClockwise ? -1 : 1);
    return { time: i / 30, ankle: { x: 500 + radius * Math.cos(angle), y: 250 + radius * Math.sin(angle) } };
  });
const clockTrace = FootOrbitTrace.fromObservations(pixelOrbitObservations(60, false), { frame: PIXEL_FRAME });
const clockBox = clockTrace.bounds();
const clockMarks = Object.fromEntries(clockTrace.cardinalMarks().map((mark) => [mark.hour, mark]));
check('as horas ficam marcadas na órbita: 12h em cima, 6h em baixo, 3h à direita e 9h à esquerda',
  Math.abs(clockMarks['12h'].y - clockBox.minY) < 1e-9 &&
    Math.abs(clockMarks['6h'].y - clockBox.maxY) < 1e-9 &&
    Math.abs(clockMarks['3h'].x - clockBox.maxX) < 1e-9 &&
    Math.abs(clockMarks['9h'].x - clockBox.minX) < 1e-9,
  `12h y=${clockMarks['12h'].y.toFixed(3)} (topo ${clockBox.minY.toFixed(3)}) | 3h x=${clockMarks['3h'].x.toFixed(3)} (direita ${clockBox.maxX.toFixed(3)})`);
check('a posição do pé em cada instante é lida como 12h/3h/6h/9h',
  [0, 10 / 30, 20 / 30, 1].map((time) => clockTrace.positionAt(time).hour).join(',') === '3h,6h,9h,12h' &&
    [0, 10 / 30, 20 / 30, 1].every((time) => clockTrace.positionAt(time).atCardinal === true),
  [0, 10 / 30, 20 / 30, 1].map((time) => clockTrace.positionAt(time).hour).join(','));
check('a posição diz em que ponto da pedalada está o pé (rótulo da regra, com a hora)',
  clockTrace.positionAt(0).label.includes('3h') &&
    clockTrace.positionAt(10 / 30).label.includes('6h') &&
    clockTrace.positionAt(1).label.includes('12h') &&
    clockTrace.positionAt(0).footPositionPt.includes('3h') &&
    ['90deg', 'bdc', '270deg', 'tdc'].join(',') ===
      [0, 10 / 30, 20 / 30, 1].map((time) => clockTrace.positionAt(time).key).join(','),
  `${['90deg', 'bdc', '270deg', 'tdc'].join(',')} vs ${[0, 10 / 30, 20 / 30, 1].map((time) => clockTrace.positionAt(time).key).join(',')}`);
check('meia volta depois o pé está na posição oposta (a leitura acompanha a reprodução)',
  Math.abs(angularDistance(clockTrace.positionAt(0).phaseDeg, clockTrace.positionAt(20 / 30).phaseDeg) - 180) < 1e-6 &&
    clockTrace.positionAt(20 / 30).time === 20 / 30,
  `${clockTrace.positionAt(0).phaseDeg}° → ${clockTrace.positionAt(20 / 30).phaseDeg}°`);
const betweenHours = clockTrace.positionAt(5 / 30);
check('entre duas horas a leitura sai como APROXIMADA, com a distância em graus (nada de precisão fingida)',
  betweenHours.atCardinal === false &&
    Math.abs(betweenHours.deltaDeg - 45) < 1e-6 &&
    /12h|3h/.test(betweenHours.label),
  `${betweenHours.label} ±${betweenHours.deltaDeg}°`);
// A tolerância é a janela da análise (±12°): 9° de fase ainda é 3h, 18° já é "entre posições".
check('a hora aproximada usa a JANELA de tolerância da análise (a mesma régua dos dois lados)',
  DEFAULT_PHASE_WINDOW_DEG === 12 &&
    clockTrace.positionAt(1 / 30).atCardinal === true &&
    clockTrace.positionAt(2 / 30).atCardinal === false &&
    clockTrace.positionAt(2 / 30).deltaDeg === 18,
  `9°=${clockTrace.positionAt(1 / 30).atCardinal} 18°=${clockTrace.positionAt(2 / 30).atCardinal}`);
const mirroredClock = FootOrbitTrace.fromObservations(pixelOrbitObservations(60, true), { frame: PIXEL_FRAME });
check('atleta virado à esquerda: a órbita é detetada como espelhada e 3h/9h trocam de lado',
  mirroredClock.phaseModel().mirrored === true &&
    mirroredClock.summary().facing === 'left' &&
    Math.abs(mirroredClock.cardinalMarks().find((m) => m.hour === '3h').x - clockBox.minX) < 1e-9 &&
    Math.abs(mirroredClock.cardinalMarks().find((m) => m.hour === '9h').x - clockBox.maxX) < 1e-9 &&
    // O topo e o fundo (12h/6h) são os mesmos nos dois lados do filme: nunca trocam.
    Math.abs(mirroredClock.cardinalMarks().find((m) => m.hour === '12h').y - clockBox.minY) < 1e-9 &&
    Math.abs(mirroredClock.cardinalMarks().find((m) => m.hour === '6h').y - clockBox.maxY) < 1e-9);
check('pedalada horária: 3h à direita do ecrã (a posição em que o pé está à frente)',
  clockTrace.summary().facing === 'right' && clockTrace.positionAt(0).hour === '3h');
check('a órbita e a análise integral concordam no sentido do pedalar (uma só verdade da fase)',
  (() => {
    const runTracker = (counterClockwise) => {
      const tracker = new CrankPhaseTracker();
      tracker.addAll(pixelOrbitObservations(60, counterClockwise));
      return tracker.build();
    };
    const cw = runTracker(false);
    const ccw = runTracker(true);
    return cw && ccw && cw.mirrored === false && ccw.mirrored === true &&
      cw.mirrored === clockTrace.phaseModel().mirrored &&
      ccw.mirrored === mirroredClock.phaseModel().mirrored;
  })());

// O traço tem de ser uma linha FINA desenhada como a lápis: várias passagens sobrepostas.
const recPencilOneLap = createRecordingContext();
drawFootOrbit(recPencilOneLap, clockTrace, { width: 1000, height: 500, currentTime: 20 / 30, currentLabel: 'BDC (6h) · 0.7s' });
const recPencilThreeLaps = createRecordingContext();
drawFootOrbit(recPencilThreeLaps, pixelOrbitTrace(3, 60, false), { width: 1000, height: 500 });
check('o rasto é traçado a LÁPIS: uma passagem por pedalada (3 voltas → mais traços que 1)',
  count(recPencilThreeLaps.calls, 'stroke') > count(recPencilOneLap.calls, 'stroke'),
  `${count(recPencilOneLap.calls, 'stroke')} vs ${count(recPencilThreeLaps.calls, 'stroke')} traços`);
check('o traço é fino e translúcido (as passagens somam cor em vez de taparem o vídeo)',
  colors(recPencilOneLap.calls, 'lineWidth').every((width) => Number(width) > 0 && Number(width) <= 3) &&
    colors(recPencilOneLap.calls, 'globalAlpha').some((alpha) => Number(alpha) > 0 && Number(alpha) < 1) &&
    colors(recPencilOneLap.calls, 'globalAlpha').includes('1'),
  `espessuras ${[...new Set(colors(recPencilOneLap.calls, 'lineWidth'))].join(', ')}`);
check('o rasto deixou de ser tracejado (é linha contínua, como um lápis)',
  count(recPencilThreeLaps.calls, 'setLineDash') === 0);
check('as quatro horas ficam escritas sobre a órbita e o marcador leva a hora do instante',
  ['12h', '3h', '6h', '9h'].every((hour) =>
    recPencilOneLap.calls.some((c) => c.name === 'fillText' && String(c.args[0]) === hour)) &&
    recPencilOneLap.calls.some((c) => c.name === 'fillText' && String(c.args[0]) === 'BDC (6h) · 0.7s'));
check('sem horas pedidas (showHours: false) a órbita continua a ser desenhada',
  (() => {
    const recNoHours = createRecordingContext();
    const drawnPoints = drawFootOrbit(recNoHours, clockTrace, { width: 1000, height: 500, showHours: false });
    return drawnPoints > 0 && count(recNoHours.calls, 'lineTo') > 0 &&
      !recNoHours.calls.some((c) => c.name === 'fillText' && String(c.args[0]) === '12h');
  })());

// --- 7e.5 A ligação no componente -------------------------------------------------------
const orbitJs = read('src/components/LiveCameraCapture/LiveCameraCapture.js');
const scanBody = methodBody(orbitJs, 'async startFullVideoAnalysis() {');
check('a curva dos ângulos passa a sair da análise integral (não só da reprodução)',
  scanBody.includes('this.publishScanSamples(scanner.observations, {') &&
    scanBody.indexOf('this.publishScanSamples(scanner.observations, {') >
      scanBody.indexOf('const analysis = await pipeline.run('),
  `${scanBody.length} caracteres de corpo`);
check('o varrimento publica as amostras no gráfico E na órbita do pé',
  /publishScanSamples\(observations = \[\], frame = null\) \{/.test(orbitJs) &&
    /this\.videoSamplesHistory\.push\(\{[\s\S]{0,260}?joelho: angles\.joelho/.test(orbitJs) &&
    /this\.footOrbitTrace\.addObservation\(o, frame\)/.test(orbitJs) &&
    /this\.chartSampleSource = ordered\.length \? 'scan' : null;/.test(orbitJs));
check('a reprodução não mistura amostras ao vivo por cima da curva da análise',
  /if \(this\.chartSampleSource !== 'scan'\) \{[\s\S]{0,320}?this\.videoSamplesHistory\.push\(\{/.test(orbitJs));
check('cada fotograma ao vivo alimenta a órbita do pé',
  /this\.recordFootOrbitPoint\(computed\.points, w, h\)/.test(orbitJs) &&
    /recordFootOrbitPoint\(points, width, height\) \{/.test(orbitJs) &&
    /this\.footOrbitTrace\.addPoint\([\s\S]{0,120}?ankle\.x \/ width, ankle\.y \/ height/.test(orbitJs));
check('a órbita só é desenhada com o seletor ligado',
  /if \(this\.showFootOrbit && this\.footOrbitTrace\?\.isDrawable\) \{[\s\S]{0,220}?drawFootOrbit\(ctx, this\.footOrbitTrace, \{/.test(orbitJs));
check('o seletor está ligado, persistido no dispositivo e pode ser desligado',
  /toggleFootOrbit\(value\) \{/.test(orbitJs) &&
    /loadFootOrbitPreference\(\)[\s\S]{0,400}?localStorage\.getItem\(FOOT_ORBIT_STORAGE_KEY\)/.test(orbitJs) &&
    /persistFootOrbitPreference\(\)[\s\S]{0,320}?localStorage\.setItem\(FOOT_ORBIT_STORAGE_KEY/.test(orbitJs) &&
    /showFootOrbit: true,/.test(orbitJs));
check('análise nova, vídeo novo e troca de lado reiniciam a órbita',
  (orbitJs.match(/this\.footOrbitTrace\.reset\(\)/g) || []).length >= 3 &&
    methodBody(orbitJs, 'setProfileSide(side) {').includes('this.footOrbitTrace.reset()'));
check('o texto do gráfico vazio vem do i18n (não há frase presa no módulo)',
  /\{ emptyLabel: this\.t\('anglesTimelineEmpty'\) \}/.test(orbitJs) &&
    /options\.emptyLabel \|\|/.test(read('src/components/LiveCameraCapture/modules/anglesTimelineChart.js')));

const orbitHtml = read('src/components/LiveCameraCapture/LiveCameraCapture.html');
check('o seletor mostrar/ocultar existe na interface (dois botões, como o CromaTrack)',
  /foot-orbit-group/.test(orbitHtml) &&
    /@click="showFootOrbit && toggleFootOrbit\(false\)"/.test(orbitHtml) &&
    /@click="!showFootOrbit && toggleFootOrbit\(true\)"/.test(orbitHtml) &&
    /diagram="footOrbit"/.test(orbitHtml) &&
    /footOrbitText \|\| t\('footOrbitNoData'\)/.test(orbitHtml));
// A distância entre linhas não é o que interessa: o que interessa é o que está DENTRO do
// computado da posição (por isso se mede o corpo do método, como no resto deste ficheiro).
const positionBody = methodBody(orbitJs, 'footOrbitPositionText() {');
check('a posição do pé NA PEDALEIRA é lida da órbita no instante em reprodução',
  positionBody.includes('this.footOrbitTrace.positionAt(this.videoCurrentTime)') &&
    positionBody.includes("this.t('footOrbitPosition')") &&
    positionBody.includes('position.atCardinal'),
  positionBody ? `${positionBody.length} caracteres de corpo` : 'computado não encontrado');
check('a leitura da posição depende do resumo reativo (o rasto é markRaw: sem isto ficava em cache vazio)',
  positionBody.includes('if (!this.footOrbitSummary || !this.footOrbitTrace?.isDrawable) return') &&
    positionBody.includes('position.time.toFixed(1)'));
check('a interface mostra a hora do pé e admite quando ela é aproximada',
  /class="foot-orbit-line foot-orbit-position" v-if="footOrbitPositionText"/.test(orbitHtml) &&
    /v-if="footOrbitPositionText"/.test(orbitHtml) &&
    /≈ \$\{position\.label\} ±\$\{Math\.round\(position\.deltaDeg\)\}°/.test(orbitJs));
check('o marcador desenhado sobre o vídeo leva a hora do instante (e as horas vão ligadas)',
  /currentLabel: position \? `\$\{position\.label\} · \$\{position\.time\.toFixed\(1\)\}s` : null/.test(orbitJs) &&
    /showHours: true,/.test(orbitJs) &&
    /const position = this\.footOrbitTrace\.positionAt\(this\.videoCurrentTime\)/.test(orbitJs));

const orbitI18n = read('src/i18n.js');
const ORBIT_KEYS = [
  'footOrbitGroupTitle', 'footOrbitLabel', 'footOrbitOn', 'footOrbitOff', 'footOrbitTitle',
  'footOrbitHelpSummary', 'footOrbitStep1', 'footOrbitStep2', 'footOrbitStep3', 'footOrbitHelpSource',
  'footOrbitNoData', 'footOrbitTurns', 'footOrbitClockwise', 'footOrbitCounterClockwise',
  'footOrbitDiameter', 'footOrbitTravel', 'footOrbitCircular', 'footOrbitNotCircular',
  'footOrbitPosition', 'anglesTimelineEmpty',
];
check('os textos da dinâmica do pé existem em português e em inglês',
  ORBIT_KEYS.every((key) => (orbitI18n.match(new RegExp(`\\b${key}:`, 'g')) || []).length === 2),
  ORBIT_KEYS.filter((key) => (orbitI18n.match(new RegExp(`\\b${key}:`, 'g')) || []).length !== 2).join(', '));
check('o resumo do pé é construído com os números medidos (voltas, sentido, diâmetro, trajeto)',
  /footOrbitText\(\) \{/.test(orbitJs) &&
    ['footOrbitTurns', 'footOrbitDiameter', 'footOrbitTravel', 'footOrbitCircular'].every((key) =>
      orbitJs.includes(`this.t('${key}')`)
    ));

// ---------------------------------------------------------------------------
// 7c. O passo 1 pede peso/sapato/cintura e o passo 2 NÃO volta a perguntar
// ---------------------------------------------------------------------------
console.log('\n== 7c. O perfil do passo 1 chega ao passo 2 (sem perguntar duas vezes) ==');
const captureJs = read('src/components/LiveCameraCapture/LiveCameraCapture.js');
const captureHtml = read('src/components/LiveCameraCapture/LiveCameraCapture.html');
check('o passo 2 lê o perfil que veio do passo 1',
  captureJs.includes('this.sessionData?.athleteProfile') &&
    ['stepOne.weightKg', 'stepOne.shoeSizeEu', 'stepOne.waistCm'].every((key) => captureJs.includes(key)));
check('o perfil da sessão vence a memória do dispositivo ao entrar no passo 2',
  captureJs.includes('this.prefillProfileFromSession({ override: true })'));
check('o perfil recolhido no passo 1 já é suficiente para a análise arrancar',
  AthleteProfile.isComplete({ weightKg: 78, shoeSizeEu: 43 }) === true);
check('o perfil do passo 2 guarda e limpa a cintura',
  (captureJs.match(/waistCm:/g) || []).length >= 4 && captureJs.includes('waistCm: normalized.waistCm ?? \'\''));
check('o modal do passo 2 mostra a cintura e diz que os dados vêm do passo 1',
  captureHtml.includes('v-model="athleteProfile.waistCm"') && /já são\s*\n?\s*pedidos no passo 1/.test(captureHtml));

// A cintura conta no resumo técnico ("todos os dados fornecidos têm de contar").
const waistAccounting = buildDataAccounting({
  profile: { weightKg: 78, shoeSizeEu: 43, waistCm: 84 },
  targets,
  prescriptions: [],
  evaluations: [],
});
const waistRow = waistAccounting.rows.find((r) => /Cintura/.test(r.label));
check('a cintura aparece no resumo técnico (não se perde um dado fornecido)', Boolean(waistRow));
check('a cintura entra como contexto (não como dado que muda um alvo)',
  waistRow && waistRow.status === 'context' && waistRow.value === 84 && waistRow.unit === 'cm');
check('a linha da cintura explica o que ela pode explicar (fecho da anca)',
  waistRow && /fecho da anca/i.test(waistRow.effect));
const noWaistAccounting = buildDataAccounting({ profile: { weightKg: 78, shoeSizeEu: 43 }, targets, evaluations: [] });
check('sem cintura não se inventa uma linha com valor nenhum',
  !noWaistAccounting.rows.some((r) => /Cintura/.test(r.label)));

// ---------------------------------------------------------------------------
// 8. Regressão: em modo ficheiro `activeTuningReport` é `null` até o vídeo estar todo
//    analisado. O template não pode ler `.locked`/`.items` de `null` (rebentava o render
//    no momento de carregar o vídeo). Cada leitura tem de estar guardada.
// ---------------------------------------------------------------------------
console.log('\n== 8. Template tolera relatório nulo (modo ficheiro) ==');
const componentHtml = read('src/components/LiveCameraCapture/LiveCameraCapture.html');
check('o card de afinações só aparece quando existe relatório', /v-if="activeTuningReport"\s*\n\s*class="tuning-summary-card"/.test(componentHtml));
check('o card de afinações está todo dentro da guarda (não há cartão sem `v-if`)', (componentHtml.match(/class="tuning-summary-card"/g) || []).length === 1);
const vIfsReadingItems = (componentHtml.match(/v-if="[^"]*"/g) || []).filter(
  (attr) => attr.includes('activeTuningReport.items') || attr.includes('activeTuningReport?.items'),
);
check(
  'nenhum `v-if` lê `activeTuningReport.items` sem guarda',
  vIfsReadingItems.length >= 2 &&
    vIfsReadingItems.every((attr) => attr.includes('activeTuningReport &&') || attr.includes('activeTuningReport?.items?.')),
  vIfsReadingItems.join(' | '),
);
check('as contagens de itens usam optional chaining', /v-if="activeTuningReport\?\.items\?\.length"/.test(componentHtml) && /showTuningReportModal && activeTuningReport\?\.items\?\.length/.test(componentHtml));
check('o badge de resultado usa optional chaining', componentHtml.includes('activeTuningReport?.verdictColor'));
check(
  'o cabeçalho do modo não rebenta se o estilo de pedalada faltar no perfil',
  /\(sessionData\.athlete\?\.riding_style \|\| 'road'\)\.toUpperCase\(\)/.test(componentHtml),
  'sem alternativa, uma sessão sem riding_style rebentava o render inteiro do modo de análise'
);

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
