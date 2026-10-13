/**
 * Verificação das NORMAS PROFISSIONAIS DE BIKE FIT (ProfessionalFitStandards).
 *
 * Executar com:  npm run verify:fit-standards
 *
 * Garante, sem navegador e sem dependências, que:
 *  1. As duas convenções do joelho (incluído vs flexão) são coerentes e convertíveis.
 *  2. O erro de repetição publicado é usado: uma diferença dentro dele NÃO é um erro.
 *  3. As faixas vêm com grau de evidência e com fonte (nada de números sem origem).
 *  4. Convenções não comparáveis NUNCA geram veredicto automático.
 *  5. A assimetria esquerda/direita não tem limiar inventado.
 *  6. Não existe limiar de lesão angulado afirmado a partir de um ângulo.
 *  7. O protocolo de captura é auditável e reporta o que faltou.
 *  8. A leitura por posição do pé prioriza o desvio real mais grosseiro.
 */
import {
  ASYMMETRY_POLICY,
  CAPTURE_PROTOCOL,
  EVIDENCE,
  FIT_REFERENCE_TABLE,
  INJURY_EVIDENCE,
  MEASUREMENT_UNCERTAINTY_DEG,
  assessMetricAtPosition,
  auditCaptureProtocol,
  buildProfessionalReading,
  flexionToIncluded,
  includedToFlexion,
  referenceFor,
  uncertaintyFor,
} from '../src/components/LiveCameraCapture/modules/professionalFitStandards.js';

let failures = 0;
function check(label, condition, extra = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` :: ${extra}` : ''}`);
}

// ---------------------------------------------------------------------------
console.log('\n== 1. Convenções do joelho (incluído vs flexão) ==');
const knee = FIT_REFERENCE_TABLE.knee;
check('o joelho declara as duas convenções', knee.conventions.length === 2);
const included = knee.conventions.find((c) => c.id === 'included');
const flexion = knee.conventions.find((c) => c.id === 'flexion');
check('a aplicação usa a convenção do ângulo incluído', included.usedByApp === true);
check('a convenção incluída tem 180° = perna esticada', included.straightIs === 180);
check('a convenção de flexão tem 0° = perna esticada', flexion.straightIs === 0);
// 30° de flexão residual E 150° incluído são a MESMA posição — é isto que evita a confusão.
check('30° de flexão = 150° incluído', flexionToIncluded(30) === 150, String(flexionToIncluded(30)));
check('150° incluído = 30° de flexão', includedToFlexion(150) === 30, String(includedToFlexion(150)));
check('conversão em cadeia devolve o valor original', includedToFlexion(flexionToIncluded(25)) === 25);

// ---------------------------------------------------------------------------
console.log('\n== 2. Erro de repetição: o que cabe lá dentro não é erro ==');
check('joelho dinâmico tem 1,7° publicado', uncertaintyFor('knee', 'dynamic') === 1.7);
check('joelho estático tem 4,2° publicado', uncertaintyFor('knee', 'static') === 4.2);
check('tornozelo dinâmico tem 4,2° publicado', uncertaintyFor('ankle', 'dynamic') === 4.2);
check('junta sem valor publicado devolve null (não inventa)', uncertaintyFor('hip', 'dynamic') === null);
check('junta desconhecida devolve null', uncertaintyFor('nonsense', 'dynamic') === null);
check(
  'o joelho estático tem erro MAIOR que o dinâmico (medido assim)',
  MEASUREMENT_UNCERTAINTY_DEG.knee.static > MEASUREMENT_UNCERTAINTY_DEG.knee.dynamic
);

// Desvio de 1° no joelho dinâmico (alvo 140–150): cabe dentro de 1,7° => tolerado, não erro.
const tiny = assessMetricAtPosition({ joint: 'knee', value: 139, position: 'bdc', regime: 'dynamic' });
check('1° fora do alvo é tolerado (dentro do erro)', tiny.status === 'acceptable', `${tiny.status}`);
check('o desvio é declarado e marcado como dentro do erro', tiny.withinUncertainty === true && tiny.deviationDeg === 1);
check('o desvio pequeno explica-se ao utilizador', /erro de repetição/.test(tiny.note || ''), tiny.note);

const gross = assessMetricAtPosition({ joint: 'knee', value: 132, position: 'bdc', regime: 'dynamic' });
check('8° fora do alvo é um desvio real', gross.status === 'out', `${gross.status}`);
check('o desvio real não é mascarado pelo erro', gross.withinUncertainty === false && gross.deviationDeg === 8);
check('o desvio real tem direção', gross.direction === 'low');
check('o desvio fora da faixa tolerada é marcado como claro', gross.severity === 'clear', `${gross.severity}`);
check('a nota do desvio claro diz que é aqui que se intervém', /é aqui que um fitter intervém/.test(gross.note));

const inBand = assessMetricAtPosition({ joint: 'knee', value: 145, position: 'bdc', regime: 'dynamic' });
check('dentro da faixa => good', inBand.status === 'good');

// No regime estático o MESMO desvio de 3° já é tolerado (erro de 4,2°).
const staticThree = assessMetricAtPosition({ joint: 'knee', value: 142, position: 'bdc', regime: 'static' });
check('estático tolera 3° (erro 4,2°)', staticThree.status === 'acceptable' && staticThree.withinUncertainty === true);
// 137° está na faixa tolerada mas o desvio (3°) excede o erro dinâmico (1,7°): é REAL, só é tolerado.
const dynamicThree = assessMetricAtPosition({ joint: 'knee', value: 137, position: 'bdc', regime: 'dynamic' });
check('dinâmico com 3° já sai da faixa boa', dynamicThree.status === 'out', dynamicThree.status);
check('mas o desvio de 3° é tolerado pela faixa larga', dynamicThree.severity === 'tolerated', `${dynamicThree.severity}`);
check('a nota distingue "real" de "fora de tudo"', /ainda dentro da faixa tolerada/.test(dynamicThree.note), dynamicThree.note);

// ---------------------------------------------------------------------------
console.log('\n== 3. Rasto até à fonte e grau de evidência ==');
const dynamicBdc = referenceFor('knee', 'bdc', { regime: 'dynamic' });
check('a faixa dinâmica do BDC é 140–150 (30–40° de flexão)', JSON.stringify(dynamicBdc.good) === '[140,150]', JSON.stringify(dynamicBdc.good));
check('o BDC dinâmico é evidência MEDIDA', dynamicBdc.evidence === EVIDENCE.MEASURED);
check('o BDC dinâmico cita fontes', dynamicBdc.sources.length >= 2, `${dynamicBdc.sources.length} fontes`);
check('cada fonte é um URL', dynamicBdc.sources.every((s) => /^https?:\/\//.test(s)));
check('o BDC estático é CONVENÇÃO, não medida', referenceFor('knee', 'bdc', { regime: 'static' }).evidence === EVIDENCE.CONVENTION);
check(
  'as fontes citam o estudo do erro de repetição',
  dynamicBdc.sources.includes('https://jsc-journal.com/index.php/JSC/article/view/94')
);

// Toda a tabela tem de ter fonte ou uma razão explícita para não ter número.
const joints = Object.keys(FIT_REFERENCE_TABLE);
check('existem pelo menos 8 juntas tabeladas', joints.length >= 8, `${joints.length}`);
// Rasto à fonte: as fontes podem estar na junta, na posição ou no variante de regime —
// qualquer um serve, mas TEM de existir pelo menos um.
const sourcesOf = (joint) => {
  const entry = FIT_REFERENCE_TABLE[joint];
  const collected = [...(entry.sources || [])];
  Object.values(entry.positions || {}).forEach((slot) => {
    collected.push(...(slot.sources || []));
    ['dynamic', 'static'].forEach((regime) => {
      if (slot[regime]) collected.push(...(slot[regime].sources || []));
    });
  });
  return collected.filter(Boolean);
};
const missingProvenance = joints.filter((joint) => sourcesOf(joint).length === 0);
check('nenhuma junta fica sem fonte', missingProvenance.length === 0, missingProvenance.join(', '));
check('todas as fontes são URLs verificáveis', joints.every((j) => sourcesOf(j).every((s) => /^https?:\/\//.test(s))));
check('o joelho tem fontes próprias', sourcesOf('knee').length >= 3, `${sourcesOf('knee').length}`);

// ---------------------------------------------------------------------------
console.log('\n== 4. Convenções não comparáveis nunca geram veredicto ==');
check('o fecho da anca está marcado como incomparável', FIT_REFERENCE_TABLE.hipClosure.comparability === 'mismatch');
check('o tornozelo está marcado como incomparável', FIT_REFERENCE_TABLE.ankle.comparability === 'mismatch');
check('o ombro está marcado como incomparável', FIT_REFERENCE_TABLE.shoulder.comparability === 'mismatch');
check('a incomparabilidade é explicada', /landmarks diferentes/.test(FIT_REFERENCE_TABLE.hipClosure.comparabilityNote));

const hip = assessMetricAtPosition({ joint: 'hipClosure', value: 40, position: 'tdc' });
check('fecho da anca fica descritivo mesmo com valor extremo', hip.status === 'descriptive', hip.status);
check('fecho da anca explica por que não julga', /landsmarks|landmarks/.test(hip.note || ''), hip.note);
const ankle = assessMetricAtPosition({ joint: 'ankle', value: 60, position: 'bdc' });
check('tornozelo fica descritivo (convenção diferente da publicada)', ankle.status === 'descriptive', ankle.status);

// As faixas por flexibilidade existem e diferem (atleta rígido vs móvel).
const rigid = referenceFor('hipClosure', 'tdc', { flexibility: 'low' });
const mobile = referenceFor('hipClosure', 'tdc', { flexibility: 'high' });
check('atleta rígido tem faixa de fecho própria', JSON.stringify(rigid.good) === '[52,58]', JSON.stringify(rigid.good));
check('atleta móvel tolera mais fecho da anca', JSON.stringify(mobile.good) === '[44,50]', JSON.stringify(mobile.good));
check('a convenção alternativa é guardada e não misturada', JSON.stringify(rigid.alternativeConvention.good) === '[55,65]');

// ---------------------------------------------------------------------------
console.log('\n== 5. Assimetria: sem limiar inventado ==');
check('não existe limiar de assimetria', ASYMMETRY_POLICY.thresholdDeg === null);
check('a política diz que não existe normal publicado', /não existe intervalo normal publicado/i.test(ASYMMETRY_POLICY.notSupported));
check('a política liga a assimetria ao erro de repetição', /erro de repetição/.test(ASYMMETRY_POLICY.rule));
check('a política cita fontes de assimetria', ASYMMETRY_POLICY.sources.length >= 2);

// ---------------------------------------------------------------------------
console.log('\n== 6. Saúde: nenhum limiar de lesão afirmado ==');
check('não existe limiar de lesão', INJURY_EVIDENCE.thresholdDeg === null);
check('o texto nega explicitamente a existência de limiar validado', /Nenhum limiar angular validado/i.test(INJURY_EVIDENCE.statement));
check('o texto recusa transformar ângulo em diagnóstico', /não um diagnóstico nem uma probabilidade/i.test(INJURY_EVIDENCE.statement));
check('a revisão sistemática é citada', INJURY_EVIDENCE.sources.some((s) => s.includes('PMC5717478')));
check('há pelo menos 3 afirmações suportadas listadas', INJURY_EVIDENCE.whatSourcesDoSupport.length >= 3);

// ---------------------------------------------------------------------------
console.log('\n== 7. Protocolo de captura auditável ==');
const bad = auditCaptureProtocol({ durationSeconds: 40, completeCycles: 1, cadenceRpm: 45, framesPerSecond: 30, cameraDistanceM: 5 });
check('captura fora do protocolo não fica pronta', bad.ready === false);
check('a captura curta é assinalada', bad.failed.some((f) => f.id === 'duration'));
check('o nº de ciclos insuficiente é assinalado', bad.failed.some((f) => f.id === 'cycles'));
check('a cadência fora da janela é assinalada', bad.failed.some((f) => f.id === 'cadence'));
check('a distância errada da câmara é assinalada', bad.failed.some((f) => f.id === 'distance'));

const good = auditCaptureProtocol({ durationSeconds: 150, completeCycles: 12, cadenceRpm: 85, framesPerSecond: 60, cameraDistanceM: 2.5 });
check('captura conforme o protocolo fica pronta', good.ready === true && good.failed.length === 0);
check('o resumo confirma que os ângulos são medidas', /podem ser lidos como medidas/.test(good.summary));
check('o resumo da má captura avisa que são indicativos', /indicativos/.test(bad.summary));
check('o protocolo exige 2 min e 3 ciclos', CAPTURE_PROTOCOL.minDurationSeconds === 120 && CAPTURE_PROTOCOL.minCompleteCycles === 3);
check('o protocolo prefere 60 fps e aceita 30', CAPTURE_PROTOCOL.preferredFps === 60 && CAPTURE_PROTOCOL.minimumFps === 30);

// ---------------------------------------------------------------------------
console.log('\n== 8. Leitura por posição do pé e prioridade ==');
const reading = buildProfessionalReading({
  evaluations: [
    {
      position: 'bdc',
      label: 'BDC (6h)',
      summary: 'Pé em baixo',
      metrics: [
        { metric: 'knee', label: 'Joelho', measured: 132, target: [145, 155], status: 'low', unit: '°' },
        { metric: 'ankle', label: 'Tornozelo', measured: 100, target: [95, 105], status: 'ok', unit: '°' },
      ],
    },
    {
      position: '90deg',
      label: '90° (3h)',
      summary: 'Pé à frente',
      metrics: [{ metric: 'knee', label: 'Joelho', measured: 110, target: null, status: 'descriptive', unit: '°' }],
    },
  ],
  posture: 'upright',
  flexibility: 'medium',
  regime: 'dynamic',
});

check('há uma entrada por posição medida', reading.positions.length === 2);
check('a posição 6h tem veredictos', reading.positions[0].verdicts.length === 2);
check('o joelho a 132° é um desvio real', reading.positions[0].verdicts.find((v) => v.joint === 'knee').status === 'out');
check('o tornozelo é descritivo (convenção)', reading.positions[0].verdicts.find((v) => v.joint === 'ankle').status === 'descriptive');
check('a posição 3h não julga o joelho (sem referência)', reading.positions[1].verdicts[0].status === 'no-reference', reading.positions[1].verdicts[0].status);
check('a prioridade da posição é o desvio mais grosseiro', reading.positions[0].priorityFix?.joint === 'knee');
check('a manchete da posição 6h manda corrigir', /Prioridade/.test(reading.positions[0].headline), reading.positions[0].headline);
check('a posição sem desvio não inventa prioridade', reading.positions[1].priorityFix === null);
check('os limites da leitura são declarados', reading.caveats.length >= 3);
check('as fontes são agregadas sem repetições', reading.sources.length === new Set(reading.sources).size && reading.sources.length > 0, `${reading.sources.length}`);

// Sem medições, a leitura não inventa veredictos.
const empty = buildProfessionalReading({ evaluations: [{ position: 'bdc', label: 'BDC (6h)', metrics: [] }] });
check('sem métricas não há prioridade', empty.positions[0].priorityFix === null);
check('sem métricas a manchete admite-o', /Sem veredicto|Nada a corrigir/.test(empty.positions[0].headline), empty.positions[0].headline);

// ---------------------------------------------------------------------------
console.log('\n== 9. Integração: o relatório passa a trazer a leitura profissional ==');
const { CoherentRecommendationEngine } = await import(
  '../src/components/LiveCameraCapture/modules/coherentRecommendationEngine.js'
);
const targets = { knee: [145, 155], back: [40, 50], elbow: [150, 165], ankle: [95, 105] };
const photo = (over) => ({
  status: 'done',
  name: over.name,
  crankPosition: over.crankPosition,
  angles: { joelho: null, costas: null, braco: null, tornozelo: null, anca: null, ...over.angles },
  kopsResult: over.kopsResult || null,
});

// Joelho a 132° às 6h: desvio real (8° > 1,7° de erro) — TEM de aparecer como prioridade.
const engineResult = CoherentRecommendationEngine.build(
  [
    photo({ name: 'bdc.jpg', crankPosition: 'bdc', angles: { joelho: 132, costas: 45, braco: 158, tornozelo: 100 } }),
    photo({ name: 'noventa.jpg', crankPosition: '90deg', angles: { joelho: 110, costas: 45, braco: 158, tornozelo: 100 }, kopsResult: { offsetMm: 6 } }),
  ],
  targets
);
check('o motor produz a leitura profissional', Boolean(engineResult.professionalReading));
check('a leitura cobre as posições medidas', engineResult.professionalReading.positions.length >= 2);
check('o motor audita o protocolo de captura', Boolean(engineResult.captureAudit));
check('sem dados de captura o protocolo não passa por bom', engineResult.captureAudit.ready === false);
check('o joelho a 132° é o desvio prioritário', engineResult.professionalReading.positions.find((p) => p.position === 'bdc')?.priorityFix?.joint === 'knee');

const summaryText = engineResult.technicalSummaryText;
check('o resumo técnico inclui o bloco profissional', /LEITURA PROFISSIONAL POR POSIÇÃO DO PÉ/.test(summaryText));
check('o resumo cita a convenção/grau de evidência', /\[[^\]]+\]/.test(summaryText), summaryText.match(/\[[^\]]+\]/)?.[0] || 'nenhum');
check('o resumo lista as fontes', /FONTES DAS REFERÊNCIAS:/.test(summaryText));
check('o resumo declara os limites (saúde/assimetria)', /LIMITES QUE A LEITURA RESPEITA:/.test(summaryText));
check('o resumo mostra a leitura de fitter de cada junta', /Leitura:/.test(summaryText));
check('o resumo continua a trazer a otimização por posição', /OTIMIZAÇÃO POR POSIÇÃO DO PÉ/.test(summaryText));

// Os cartões das fases (interface) têm de trazer a prioridade e o grau de evidência.
const { buildPhaseCards } = await import(
  '../src/components/LiveCameraCapture/modules/positionOptimization.js'
);
const cards = buildPhaseCards({ evaluations: engineResult.positionOptimization, regime: 'static' });
const bdcCard = cards.find((card) => card.id === 'bdc');
check('a carta das 6h existe', Boolean(bdcCard) && bdcCard.hasData);
check('a carta das 6h declara a prioridade', typeof bdcCard.priority === 'string' && bdcCard.priority.length > 0, bdcCard.priority);
check('a prioridade explica a evidência', /fora da referência/.test(bdcCard.priorityDetail || ''), bdcCard.priorityDetail);
const kneeMetric = bdcCard.metrics.find((m) => m.metric === 'kneeExtension');
check('a métrica do joelho existe na carta das 6h', Boolean(kneeMetric), bdcCard.metrics.map((m) => m.metric).join(','));
check('a métrica do joelho traz o veredicto profissional', kneeMetric.professionalStatus === 'out', kneeMetric.professionalStatus);
check('o desvio profissional é calculado (não é o bruto do motor)', kneeMetric.professionalDeviation === 13, String(kneeMetric.professionalDeviation));
check('a métrica traz o grau de evidência', Boolean(kneeMetric.evidenceLabel), kneeMetric.evidenceLabel);
check('a métrica explica o desvio', /fora da faixa tolerada/.test(kneeMetric.professionalNote || ''), kneeMetric.professionalNote);

// Uma carta sem desvio real NÃO inventa prioridade.
const calm = CoherentRecommendationEngine.build(
  [
    photo({ name: 'a.jpg', crankPosition: 'bdc', angles: { joelho: 150, costas: 45, braco: 158, tornozelo: 100 } }),
    photo({ name: 'b.jpg', crankPosition: '90deg', angles: { joelho: 110, costas: 45, braco: 158, tornozelo: 100 }, kopsResult: { offsetMm: 4 } }),
  ],
  targets
);
const calmCards = buildPhaseCards({ evaluations: calm.positionOptimization, regime: 'static' });
check('sem desvio real não há prioridade inventada', calmCards.find((c) => c.id === 'bdc').priority === null);

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
