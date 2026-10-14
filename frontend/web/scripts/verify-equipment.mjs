/**
 * Verificação automática das REGRAS ATLETA ↔ EQUIPAMENTO.
 *
 * Executar com:  npm run verify:equipment
 *
 * O pedido do utilizador que este ficheiro trava:
 *   "os dados fornecidos ao início têm de pesar na decisão da recomendação de ajustes.
 *    se tenho 40 de ombros, o guiador não pode ser de 42"
 *   "nos dados de início deve perguntar de quanto é o reach, drop e width do guiador assim como o avanço"
 *
 * Prova-se, sem navegador:
 *  1. A largura do guiador é confrontada com a largura biacromial (o exemplo dos 40 cm → 400 mm).
 *  2. O crenque é confrontado com a faixa do cavalo.
 *  3. As ordens passam a ter alvo ABSOLUTO (selim em cm, avanço em mm) quando o atleta declara o que tem.
 *  4. A forma do guiador (reach/drop) é lida contra o ângulo do tronco medido.
 *  5. Sem dados do atleta não há peça inventada — há aviso do que falta.
 *  6. O motor coerente junta estas ordens às dos ângulos sem duplicar componentes.
 *  7. O formulário inicial pergunta largura, reach, drop e avanço, e os valores viajam até ao backend.
 *  8. O TUBO SUPERIOR (ETT) é uma medida própria, distinta do tamanho do quadro (tubo do selim),
 *     e entra no alcance do cockpit (ETT + avanço + reach do guiador).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEEP_BAR_DROP_MM,
  HANDLEBAR_REPLACE_DELTA_MM,
  barShapeReading,
  buildEquipmentNotices,
  buildEquipmentPrescriptions,
  cockpitReading,
  crankLengthRule,
  describeSaddleTarget,
  describeStemTarget,
  handlebarWidthRule,
  resolveEquipment,
} from '../src/components/LiveCameraCapture/modules/equipmentFitRules.js';
import { CoherentRecommendationEngine } from '../src/components/LiveCameraCapture/modules/coherentRecommendationEngine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failures = 0;
function check(label, condition, extra = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` :: ${extra}` : ''}`);
}

/* ------------------------------------------------------------------ */
console.log('\n== 1. O caso do utilizador: 40 cm de ombros, guiador de 420 mm ==');
const shoulders40 = { athlete: { shoulder_width_cm: 40, inseam_cm: 84 }, bike: { handlebar_width_mm: 420, stem_length_mm: 100, crank_length_mm: 172.5, current_saddle_height_cm: 73.5 } };
const equipment40 = resolveEquipment(shoulders40);
check('os dados do atleta e da bicicleta são reunidos num só objeto', equipment40.shouldersCm === 40 && equipment40.inseamCm === 84 && equipment40.handlebarWidthMm === 420);

const rule40 = handlebarWidthRule({ shouldersCm: 40, ridingStyle: 'road', mountedWidthMm: 420 });
check('40 cm de ombros recomendam 400 mm', rule40.recommendedMm === 400, String(rule40.recommendedMm));
check('um guiador de 420 mm fica 20 mm largo demais', rule40.deltaMm === 20, String(rule40.deltaMm));
check('20 mm fora é caso para trocar (não é tolerância)', rule40.status === 'danger' && HANDLEBAR_REPLACE_DELTA_MM === 20);

const prescriptions40 = buildEquipmentPrescriptions(equipment40);
const barPrescription = prescriptions40.find((item) => item.key === 'handlebarWidth');
check('nasce uma ordem de GUIADOR', Boolean(barPrescription), prescriptions40.map((p) => p.key).join(','));
check('a ordem diz o número absoluto (420 → 400)', /420 mm → 400 mm/.test(barPrescription.action), barPrescription.action);
check('a ordem cita os ombros que a originaram', /Largura biacromial: 40 cm/.test(barPrescription.degreesInfo), barPrescription.degreesInfo);
check('a ordem explica o dano evitado', /peito|respira/.test(barPrescription.harmDone));
check('a ordem não mexe no avanço (componente diferente)', barPrescription.component.includes('Largura'));

check('42 cm de ombros → 420 mm (o valor montado está certo: nada é prescrito)',
  handlebarWidthRule({ shouldersCm: 42, ridingStyle: 'road', mountedWidthMm: 420 }).status === 'ok');
check('41,5 cm de ombros → 420 mm (arredonda ao comercial mais próximo)',
  handlebarWidthRule({ shouldersCm: 41.5, ridingStyle: 'road', mountedWidthMm: 420 }).status === 'ok');
check('41 cm de ombros continua a pedir 400 mm (fronteira a meio caminho)',
  handlebarWidthRule({ shouldersCm: 41, ridingStyle: 'road', mountedWidthMm: 400 }).status === 'ok');
check('45 cm de ombros com guiador de 400 mm pede um guiador MAIS LARGO (delta −40 mm)',
  handlebarWidthRule({ shouldersCm: 45, ridingStyle: 'road', mountedWidthMm: 400 }).deltaMm === -40);
check('sem saber o guiador montado não há comparação (só a recomendação)',
  handlebarWidthRule({ shouldersCm: 40, ridingStyle: 'road', mountedWidthMm: null }).reason === 'no-mounted-width');
check('em MTB a largura é convenção: não há alvo único nem troca de guiador',
  handlebarWidthRule({ shouldersCm: 40, ridingStyle: 'mtb', mountedWidthMm: 740 }).status === 'convention');

console.log('\n== 2. Crenque contra a faixa do cavalo ==');
const crankOk = crankLengthRule({ inseamCm: 84, mountedCrankMm: 172.5 });
check('cavalo 84 → 172,5 mm (o montado coincide)', crankOk.recommendedMm === 172.5 && crankOk.status === 'ok');
const crankLong = crankLengthRule({ inseamCm: 84, mountedCrankMm: 175 });
check('crenque de 175 mm com cavalo de 84 fica fora da faixa', crankLong.status === 'warning' && crankLong.deltaMm === 2.5);
check('cavalo abaixo de 74 → 165 mm', crankLengthRule({ inseamCm: 72, mountedCrankMm: 170 }).recommendedMm === 165);
check('sem cavalo não há faixa (nada inventado)', crankLengthRule({ inseamCm: null, mountedCrankMm: 175 }).recommendedMm === null);

const crankPrescription = buildEquipmentPrescriptions({ inseamCm: 84, crankMm: 175 }).find((item) => item.key === 'crankLength');
check('nasce uma ordem de CRENQUE com o valor absoluto', /175 mm para 172.5 mm/.test(crankPrescription.action), crankPrescription.action);
check('a ordem do crenque explica o efeito no joelho e na anca', /joelho/.test(crankPrescription.why) && /anca/.test(crankPrescription.harmDone) && /joelho/.test(crankPrescription.harmDone));

/* ------------------------------------------------------------------ */
console.log('\n== 3. Alvos ABSOLUTOS (o atleta já disse o que tem montado) ==');
const saddleTarget = describeSaddleTarget({ currentSaddleHeightCm: 73.5, deltaMm: 17 });
check('altura do selim: 73,5 cm + 17 mm → 75,2 cm', saddleTarget.targetCm === 75.2, String(saddleTarget.targetCm));
check('a ordem diz de que valor para que valor', /de 73.5 cm para 75.2 cm/.test(saddleTarget.text), saddleTarget.text);
check('descer 8 mm a partir de 74 cm → 73,2 cm', describeSaddleTarget({ currentSaddleHeightCm: 74, deltaMm: -8 }).targetCm === 73.2);
check('sem altura atual não se inventa um número', describeSaddleTarget({ currentSaddleHeightCm: null, deltaMm: 10 }).text === null);

const stemTarget = describeStemTarget({ currentStemMm: 100, deltaMm: -15 });
check('avanço: 100 mm − 15 mm → 85 mm', stemTarget.targetMm === 85, String(stemTarget.targetMm));
check('a ordem diz "avanço atual 100 mm → 85 mm"', /avanço atual 100 mm → 85 mm/.test(stemTarget.text), stemTarget.text);
check('sem avanço medido fica a ordem relativa', describeStemTarget({ currentStemMm: null, deltaMm: -15 }).text === null);

console.log('\n== 4. Reach/drop do guiador contra o ângulo do tronco ==');
const compact = barShapeReading({ barReachMm: 85, barDropMm: 150, trunkAngle: 55, trunkTarget: [40, 50] });
check('drop profundo + tronco acima do alvo → guiador compacto, não avanço mais curto', compact.suggestsCompactBar === true);
check('a leitura cita reach e drop medidos', /reach 85 mm/.test(compact.text) && /drop 150 mm/.test(compact.text), compact.text);
check('a faixa compacta é a documentada', compact.compactRangeMm[0] === 115 && compact.compactRangeMm[1] === 130);
check('um drop profundo com tronco dentro do alvo não gera ordem de forma', barShapeReading({ barDropMm: 150, trunkAngle: 45, trunkTarget: [40, 50] }).suggestsCompactBar === false);
check('um drop compacto não gera ordem', barShapeReading({ barDropMm: 120, trunkAngle: 55, trunkTarget: [40, 50] }).suggestsCompactBar === false);
check('sem reach/drop declarados não há leitura de forma', barShapeReading({ barReachMm: null, barDropMm: null }) === null);
check('o limite do drop profundo é declarado', DEEP_BAR_DROP_MM === 140);

const shapePrescription = buildEquipmentPrescriptions(
  { barReachMm: 85, barDropMm: 150 },
  { trunkAngle: 55, trunkTarget: [40, 50] }
).find((item) => item.key === 'handlebarShape');
check('nasce a ordem de FORMA do guiador', Boolean(shapePrescription), 'componente Guiador — Reach/Drop');
check('a ordem explica que não se mexe no avanço', /não encurtar o avanço|e não encurtar/.test(shapePrescription.whatToDo), shapePrescription.whatToDo);

/* ------------------------------------------------------------------ */
console.log('\n== 5. Sem dados do atleta: aviso, nunca peça inventada ==');
const emptyEquipment = resolveEquipment({ athlete: {}, bike: {} });
check('sem dados: nada é resolvido', emptyEquipment.hasAthlete === false && emptyEquipment.hasBike === false && emptyEquipment.shouldersCm === null);
check('sem ombros: nenhuma ordem de guiador', buildEquipmentPrescriptions({}).length === 0);
const notices = buildEquipmentNotices({ shouldersCm: 40, inseamCm: null, ridingStyle: 'road', handlebarWidthMm: null });
check('diz que falta o guiador montado para comparar', notices.some((n) => /falta a largura do guiador montado/.test(n)), notices.join(' | '));
check('diz que sem cavalo não há faixa de crenque', notices.some((n) => /cavalo/.test(n)), notices.join(' | '));
check('em MTB explica que a referência não é a biacromial', buildEquipmentNotices({ shouldersCm: 40, ridingStyle: 'mtb', handlebarWidthMm: 740 }).some((n) => /convenção/.test(n)));
check('texto em falta é admitido quando não há ombros', buildEquipmentNotices({ shouldersCm: null }).some((n) => /Sem largura de ombros/.test(n)));

/* ------------------------------------------------------------------ */
console.log('\n== 6. Integração no motor coerente (fotos) ==');
const photo = (item) => ({ status: 'done', isFullBodyVisible: true, ...item });
const bdc = photo({ name: 'bdc.jpg', crankPosition: 'bdc', angles: { joelho: 138, costas: 55, braco: 175, tornozelo: 100 }, kopsResult: null });
const ninety = photo({ name: 'noventa.jpg', crankPosition: '90deg', angles: { joelho: 110, costas: 46, braco: 158, tornozelo: 100 }, kopsResult: { offsetMm: 22 } });
const targets = { knee: [145, 155], back: [40, 50], elbow: [150, 165], ankle: [95, 105] };

const withoutData = CoherentRecommendationEngine.build([bdc, ninety], targets, { posture: 'upright' });
check('sem dados do passo 1: nenhuma ordem de guiador/crenque', !withoutData.prescriptions.some((p) => ['handlebarWidth', 'crankLength', 'handlebarShape'].includes(p.key)));
check('sem dados: nenhum contexto de equipamento', withoutData.equipment === null);

const withData = CoherentRecommendationEngine.build([bdc, ninety], targets, {
  posture: 'upright',
  athlete: { shoulder_width_cm: 40, inseam_cm: 84, riding_style: 'road' },
  bike: { handlebar_width_mm: 420, handlebar_reach_mm: 85, handlebar_drop_mm: 150, stem_length_mm: 100, crank_length_mm: 175, current_saddle_height_cm: 73.5 },
});
const keys = withData.prescriptions.map((p) => p.key);
check('com dados: a largura do guiador entra na prescrição das fotos', keys.includes('handlebarWidth'), keys.join(','));
check('com dados: o crenque entra na prescrição das fotos', keys.includes('crankLength'), keys.join(','));
check('com dados: a forma do guiador entra (tronco a 55° e drop de 150 mm)', keys.includes('handlebarShape'), keys.join(','));
check('cada componente aparece uma só vez (uma direção por peça)', new Set(keys).size === keys.length, keys.join(','));

const saddle = withData.prescriptions.find((p) => p.key === 'saddleHeight');
check('o selim ganha alvo absoluto com a altura declarada (73,5 → 75,2 cm)', saddle.equipmentTarget?.targetCm === 75.2, JSON.stringify(saddle.equipmentTarget));
check('a ação do selim mostra os dois valores', /73.5 cm para 75.2 cm/.test(saddle.action), saddle.action);
const reach = withData.prescriptions.find((p) => p.key === 'reach');
check('o avanço ganha alvo absoluto com o comprimento declarado (100 → 85 mm)', reach.equipmentTarget?.targetMm === 85, JSON.stringify(reach.equipmentTarget));
check('a ação do avanço passa a citar o número da peça', /85 mm$/.test(reach.action), reach.action);
check('o contexto do equipamento fica disponível para a interface', withData.equipment?.handlebarWidthMm === 420 && withData.equipment?.barShape?.deep === true);

const lemondNotice = CoherentRecommendationEngine.build([bdc, ninety], targets, {
  athlete: { inseam_cm: 84 },
  bike: { current_saddle_height_cm: 78 },
}).notices.find((n) => /LeMond/.test(n));
check('altura de selim muito longe da estimativa LeMond é assinalada', Boolean(lemondNotice), lemondNotice);

const text = CoherentRecommendationEngine.formatText(withData, 'Ana', 'Bicicleta X');
check('o texto exportado declara o equipamento do atleta', /Equipamento declarado:/.test(text) && /guiador 420 mm/.test(text) && /drop 150 mm/.test(text));
const equipmentBlocks = text.split('----------------------------------------------------------------------').filter((block) => /Guiador — Largura|Transmissão — Comprimento do Crenque|Guiador — Reach\/Drop/.test(block));
check('as ordens de equipamento são completas no texto (nada de campos vazios)', equipmentBlocks.length === 3 && equipmentBlocks.every((block) => /O QUE FAZER: \S/.test(block) && /ONDE ESTÁ MAL: \S/.test(block) && /PORQUÊ: \S/.test(block) && /DANO EVITADO: \S/.test(block) && /FONTE \(fotos\): \S/.test(block) && !/undefined/.test(block)), `${equipmentBlocks.length} ordens`);
check('a ordem do guiador cita o passo 1 como origem', /Passo 1 \(dados do atleta\)/.test(text));

check('o motor do vídeo também recebe os dados do passo 1', /CoherentRecommendationEngine\.build\(items, dynamicTargets, \{[\s\S]{0,200}athlete: equipment\?\.athlete/.test(read('src/components/LiveCameraCapture/modules/finalPrescriptionEngine.js')));
check('a vista do vídeo expõe o equipamento', read('src/components/LiveCameraCapture/modules/finalPrescriptionEngine.js').includes('base.equipment = coherent.equipment'));

/* ------------------------------------------------------------------ */
console.log('\n== 7. Pergunta no início e persistência ==');
const onboardingHtml = read('src/components/AthleteOnboarding/AthleteOnboarding.html');
const onboardingJs = read('src/components/AthleteOnboarding/AthleteOnboarding.js');
const i18n = read('src/i18n.js');
const help = read('src/components/AthleteOnboarding/modules/theoreticalHelp.js');

['handlebar_width_mm', 'handlebar_reach_mm', 'handlebar_drop_mm', 'stem_length_mm'].forEach((field) => {
  check(`o formulário inicial pergunta ${field}`, onboardingHtml.includes(`form.${field}`));
});
check('cada um desses campos tem selo de ajuda', (onboardingHtml.match(/help\.handlebar(Width|Reach|Drop)|help\.stemLength/g) || []).length >= 4, String((onboardingHtml.match(/help\.handlebar(Width|Reach|Drop)|help\.stemLength/g) || []).length));
check('o formulário começa vazio nos campos novos (nada de amostras)', /handlebar_reach_mm:\s*null/.test(onboardingJs) && /handlebar_drop_mm:\s*null/.test(onboardingJs));
check('os campos novos viajam para o backend', /handlebar_reach_mm: form\.handlebar_reach_mm \|\| null/.test(onboardingJs) && /handlebar_drop_mm: form\.handlebar_drop_mm \|\| null/.test(onboardingJs));
check('o modo local também leva o equipamento (senão a análise ficava sem dados)', /handlebar_reach_mm: form\.handlebar_reach_mm \|\| null,[\s\S]{0,700}?current_saddle_height_cm: form\.current_saddle_height_cm \|\| null/.test(onboardingJs));

// O utilizador pediu flexibilidade total no reach e drop do guiador (sem restrições rígidas de 70–100 ou 100–130)
check('o reach do guiador é flexível (sem limites restritivos)', /id="handlebar_reach"[\s\S]{0,220}?step="any"/.test(onboardingHtml));
check('o drop do guiador é flexível (sem limites restritivos)', /id="handlebar_drop"[\s\S]{0,220}?step="any"/.test(onboardingHtml));

['handlebarReachMm', 'handlebarReachHelp', 'handlebarDropMm', 'handlebarDropHelp'].forEach((key) => {
  check(`o rótulo ${key} existe em pt e en`, (i18n.match(new RegExp(`${key}:`, 'g')) || []).length === 2);
});
['handlebarReach', 'handlebarDrop', 'stemLength'].forEach((key) => {
  check(`a ajuda técnica ${key} existe`, new RegExp(`\\n  ${key}: \\{`).test(help));
});
check('a ajuda diz o que é, como se mede, o cálculo e a fonte', /reach: tubo → fundo da curva|Distância \*\*horizontal\*\*/.test(help) && /compacto 115–130/.test(help) && /centro a centro/.test(help));

const diagram = read('src/components/common/HelpTip/diagrams.js');
check('há desenho para o reach/drop do guiador', diagram.includes('handlebarReachDrop: frame('));
check('há desenho para o comprimento do avanço', diagram.includes('stemLength: frame('));

console.log('\n== 8. O backend aceita e guarda os novos campos ==');
const schema = read('../../backend/src/athletemotion/schemas/fit.py');
const models = read('../../backend/src/athletemotion/infrastructure/models.py');
const bikesApi = read('../../backend/src/athletemotion/api/v1/bikes.py');
check('BikeCreate aceita handlebar_reach_mm e handlebar_drop_mm', /handlebar_reach_mm: float \| None = Field/.test(schema) && /handlebar_drop_mm: float \| None = Field/.test(schema));
check('BikeResponse devolve os dois campos', /handlebar_reach_mm: float \| None/.test(schema) && /handlebar_drop_mm: float \| None/.test(schema));
check('o modelo da base de dados tem as colunas', /handlebar_reach_mm: Mapped\[float \| None\]/.test(models) && /handlebar_drop_mm: Mapped\[float \| None\]/.test(models));
check('o endpoint grava os dois campos', /handlebar_reach_mm=payload\.handlebar_reach_mm/.test(bikesApi) && /handlebar_drop_mm=payload\.handlebar_drop_mm/.test(bikesApi));
const alembicMigration = read('../../backend/migrations/versions/0002_handlebar_and_cleats.py');
check('migração Alembic versionada adiciona as colunas', /handlebar_reach_mm/.test(alembicMigration) && /handlebar_drop_mm/.test(alembicMigration));

/* ------------------------------------------------------------------ */
// O pedido: "o tamanho do quadro da bike é o tubo que vai do selim ao avanço, não é o que vai do
// selim à roda pedaleira". As duas coisas são medidas diferentes e ambas têm de existir: o TAMANHO
// DO QUADRO é o tubo do selim (eixo pedaleiro → topo, C-T) e o TUBO SUPERIOR (ETT) é o comprimento
// que o atleta sente no cockpit. O ETT passa a existir, corretamente nomeado, e conta como contexto.
console.log('\n== 9. Tubo superior (ETT) e o alcance do cockpit ==');
const cockpit = cockpitReading({ topTubeMm: 545, stemMm: 100, barReachMm: 85, ridingStyle: 'road' });
check('o cockpit soma tubo superior + avanço + reach do guiador', cockpit.totalMm === 730 && cockpit.complete === true, String(cockpit.totalMm));
check('o cockpit diz a fatia que vem do quadro', cockpit.frameSharePct === 75, String(cockpit.frameSharePct));
check('sem uma das três parcelas não há total (nada inventado)',
  cockpitReading({ topTubeMm: 545, stemMm: 100 }).totalMm === null && cockpitReading({ topTubeMm: 545, stemMm: 100 }).complete === false);
check('sem tubo superior a leitura fica incompleta (não fecha o alcance)',
  cockpitReading({ stemMm: 100, barReachMm: 85 }).complete === false &&
    cockpitReading({ stemMm: 100, barReachMm: 85 }).totalMm === null &&
    /não se fecha o alcance total|falta/.test(cockpitReading({ stemMm: 100, barReachMm: 85 }).text));
check('sem nenhum dado de cockpit não há leitura (nada inventado)', cockpitReading({}) === null);
check('o tubo superior fora da faixa habitual da modalidade é assinalado',
  cockpitReading({ topTubeMm: 640, stemMm: 100, ridingStyle: 'road' }).withinTypical === false &&
    cockpitReading({ topTubeMm: 545, stemMm: 100, ridingStyle: 'road' }).withinTypical === true);
check('em MTB o tubo superior usa a faixa da modalidade',
  JSON.stringify(cockpitReading({ topTubeMm: 610, stemMm: 60, ridingStyle: 'mtb' }).typicalRangeMm) === JSON.stringify([580, 640]));
check('o tubo superior escrito no passo 1 é reconhecido como equipamento',
  resolveEquipment({ bike: { top_tube_mm: 545, stem_length_mm: 100 } }).topTubeMm === 545 &&
    resolveEquipment({ bike: { top_tube_mm: 545 } }).hasBike === true);
check('a nota do cockpit entra nos avisos (com o alcance total)',
  buildEquipmentNotices({ topTubeMm: 545, stemMm: 100, barReachMm: 85 }).some((n) => /Cockpit \(do passo 1\)/.test(n) && /730 mm/.test(n)));
check('o tubo superior é descritivo: não gera ordem de peça',
  !buildEquipmentPrescriptions({ topTubeMm: 660, stemMm: 100, barReachMm: 85 }).some((p) => /topTube|Tubo superior/i.test(`${p.key} ${p.component}`)));

check('o formulário inicial pergunta o tubo superior (ETT)', onboardingHtml.includes('form.top_tube_mm') && /top_tube_mm:\s*null/.test(onboardingJs));
check('o tubo superior viaja para o backend e para o modo local',
  /top_tube_mm: form\.top_tube_mm \|\| null/.test(onboardingJs) &&
    /frame_size_cm: form\.frame_size_cm \|\| null,[\s\S]{0,120}?top_tube_mm: form\.top_tube_mm \|\| null,[\s\S]{0,700}?current_saddle_height_cm: form\.current_saddle_height_cm \|\| null/.test(onboardingJs));
check('o rótulo e a dica do tubo superior existem em pt e en',
  ['topTubeMm', 'topTubeHelp'].every((key) => (i18n.match(new RegExp(`${key}:`, 'g')) || []).length === 2));
check('o campo do tubo superior tem selo de ajuda próprio', onboardingHtml.includes('help.topTube'));
check('há desenho próprio do tubo superior / ETT', diagram.includes('topTube: frame('));
check('BikeCreate/BikeResponse aceitam e devolvem o top_tube_mm',
  /top_tube_mm: float \| None = Field/.test(schema) && /top_tube_mm: float \| None/.test(schema));
check('o modelo da base de dados tem a coluna do tubo superior', /top_tube_mm: Mapped\[float \| None\]/.test(models));
check('a coluna nova entra na base de dados', /top_tube_mm/.test(models));
check('o endpoint grava o tubo superior', /top_tube_mm=payload\.top_tube_mm/.test(bikesApi));

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} VERIFICAÇÕES FALHARAM`}`);
process.exit(failures === 0 ? 0 : 1);
