/**
 * Verificação automática das ESTIMATIVAS BIOMECÂNICAS TEÓRICAS.
 *
 * Executar com:  npm run verify:estimates
 *
 * Garante, sem navegador e sem dependências, que:
 *  1. **Sem dado = sem número.** O formulário arranca vazio e nenhuma estimativa aparece sem
 *     o campo de que depende: sem cavalo não há selim/quadro/crenque, sem biacromial não há guiador.
 *  2. As fórmulas e as faixas são as MESMAS que a ajuda documenta (LeMond ×0,883, 109% ×1,09,
 *     quadro ×0,665, crenque por faixas, guiador arredondado a 400/420/440 mm, MTB 720–780 mm).
 *  3. Dados inválidos (fora dos limites, texto, negativo, vazio) não produzem números nem rebentam.
 *  4. A comparação com a bicicleta atual (selim, quadro, guiador, crenque) só existe com os dois
 *     lados e usa a tolerância declarada.
 *  5. O template liga cada número ao seu campo de origem e mostra o que falta, em vez de
 *     esconder o painel ou inventar um valor por omissão.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MIN_INSEAM_CM,
  MTB_HANDLEBAR_RANGE_MM,
  TOLERANCES,
  compareWithCurrent,
  computeTheoreticalEstimates,
  crankLengthForInseam,
  handlebarWidthFor,
  usableInseam,
} from '../src/components/AthleteOnboarding/modules/theoreticalEstimates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failures = 0;
function check(label, condition, extra = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` :: ${extra}` : ''}`);
}

// ---------------------------------------------------------------------------
console.log('== 1. SEM DADO = SEM NÚMERO ==');
const empty = computeTheoreticalEstimates({});
check('formulário vazio: nenhuma estimativa pronta', Object.values(empty.ready).every((r) => r === false), JSON.stringify(empty.ready));
check('formulário vazio: nada para mostrar', empty.any === false);
check(
  'formulário vazio: todos os valores são nulos (nem 0 nem por omissão)',
  ['lemond_saddle_height_cm', 'hamley_109_saddle_height_cm', 'estimated_frame_size_cm', 'recommended_crank_length_mm', 'recommended_handlebar_width_mm'].every(
    (key) => empty.values[key] === null
  ),
  JSON.stringify(empty.values)
);
check('formulário vazio: aponta o que falta, pela ordem do formulário', JSON.stringify(empty.missing) === JSON.stringify(['inseam_cm', 'shoulder_width_cm']), JSON.stringify(empty.missing));

const onlyShoulders = computeTheoreticalEstimates({ shoulder_width_cm: 42 });
check('só ombros: guiador pronto mas selim/quadro/crenque NÃO', onlyShoulders.ready.handlebarWidth === true && onlyShoulders.ready.saddleHeight === false && onlyShoulders.ready.frameSize === false && onlyShoulders.ready.crankLength === false);
check('só ombros: o guiador não inventa selim', onlyShoulders.values.lemond_saddle_height_cm === null);
check('só ombros: continua a faltar o cavalo', JSON.stringify(onlyShoulders.missing) === JSON.stringify(['inseam_cm']), JSON.stringify(onlyShoulders.missing));

const onlyInseam = computeTheoreticalEstimates({ inseam_cm: 84 });
check('só cavalo: selim/quadro/crenque prontos', onlyInseam.ready.saddleHeight && onlyInseam.ready.frameSize && onlyInseam.ready.crankLength);
check('só cavalo: guiador fica por calcular', onlyInseam.ready.handlebarWidth === false && onlyInseam.values.recommended_handlebar_width_mm === null);
check('só cavalo: falta a biacromial', JSON.stringify(onlyInseam.missing) === JSON.stringify(['shoulder_width_cm']), JSON.stringify(onlyInseam.missing));

// ---------------------------------------------------------------------------
console.log('\n== 2. FÓRMULAS E FAIXAS (as da ajuda) ==');
const full = computeTheoreticalEstimates({ inseam_cm: 84, shoulder_width_cm: 42, riding_style: 'road' });
check('LeMond: cavalo × 0,883 → 74,2 cm', full.values.lemond_saddle_height_cm === 74.2, String(full.values.lemond_saddle_height_cm));
check('109% (Hamley): cavalo × 1,09 → 91,6 cm', full.values.hamley_109_saddle_height_cm === 91.6, String(full.values.hamley_109_saddle_height_cm));
check('quadro: cavalo × 0,665 → 55,9 cm', full.values.estimated_frame_size_cm === 55.9, String(full.values.estimated_frame_size_cm));
check('crenque com 84 cm de cavalo → 172,5 mm', full.values.recommended_crank_length_mm === 172.5, String(full.values.recommended_crank_length_mm));
check('guiador com 42 cm de ombros → 420 mm', full.values.recommended_handlebar_width_mm === 420, String(full.values.recommended_handlebar_width_mm));

const crankBands = [
  [70, 165],
  [73.5, 165],
  [74, 170],
  [81, 170],
  [81.5, 172.5],
  [86, 172.5],
  [86.5, 175],
  [95, 175],
];
check(
  'faixas do crenque: <74 → 165 · 74–81 → 170 · 81–86 → 172,5 · >86 → 175',
  crankBands.every(([inseam, expected]) => crankLengthForInseam(inseam) === expected),
  crankBands.map(([i, e]) => `${i}→${crankLengthForInseam(i)} (esperado ${e})`).join(', ')
);

// Arredondamento ao valor comercial MAIS PRÓXIMO: as fronteiras ficam a meio caminho entre
// tamanhos (41 cm e 43 cm). A fronteira anterior estava no próprio 40 cm e dava 420 mm a quem tem
// 40 cm de ombros — contra a ajuda da aplicação ("ombros ≈ 40 → 400 mm") e contra o pedido do
// utilizador ("se tenho 40 de ombros, o guiador não pode ser de 42").
const barCases = [
  [38, 400],
  [39.5, 400],
  [40, 400],
  [41, 400],
  [41.5, 420],
  [42, 420],
  [43, 420],
  [43.5, 440],
  [46, 440],
];
check(
  'guiador arredondado ao valor comercial mais próximo: ≤41 → 400 · 41–43 → 420 · >43 → 440',
  barCases.every(([shoulder, expected]) => handlebarWidthFor(shoulder, 'road').mm === expected),
  barCases.map(([s, e]) => `${s}→${handlebarWidthFor(s, 'road').mm} (esperado ${e})`).join(', ')
);

const mtb = handlebarWidthFor(42, 'mtb');
check(
  `MTB: faixa convencional ${MTB_HANDLEBAR_RANGE_MM[0]}–${MTB_HANDLEBAR_RANGE_MM[1]} mm em vez de um número inventado`,
  mtb.mm === null && JSON.stringify(mtb.rangeMm) === JSON.stringify(MTB_HANDLEBAR_RANGE_MM) && mtb.conventional === true,
  JSON.stringify(mtb)
);
const mtbEstimates = computeTheoreticalEstimates({ inseam_cm: 84, shoulder_width_cm: 42, riding_style: 'mtb' });
check('MTB: o painel continua pronto (tem referência) mas sem valor único', mtbEstimates.ready.handlebarWidth === true && mtbEstimates.values.recommended_handlebar_width_mm === null && mtbEstimates.values.handlebar_is_convention === true);
check('MTB: o selim continua a vir do cavalo', mtbEstimates.values.lemond_saddle_height_cm === 74.2);

// ---------------------------------------------------------------------------
console.log('\n== 3. DADOS INVÁLIDOS NÃO PRODUZEM NÚMEROS ==');
[0, -5, 39.9, 121, 200, '', null, undefined, 'abc', NaN, Infinity].forEach((value) => {
  const result = computeTheoreticalEstimates({ inseam_cm: value });
  check(
    `cavalo inválido (${String(value)}) → sem altura de selim`,
    result.values.lemond_saddle_height_cm === null && result.ready.saddleHeight === false,
    JSON.stringify(result.values.lemond_saddle_height_cm)
  );
});
check('o limite mínimo é 40 cm e o valor de 40 cm é aceite', MIN_INSEAM_CM === 40 && usableInseam(40) === 40);
check('cavalo escrito com vírgula é interpretado (84,5 → 84,5)', computeTheoreticalEstimates({ inseam_cm: '84,5' }).values.lemond_saddle_height_cm === 74.6);
check('ombros inválidos não geram guiador', handlebarWidthFor(0, 'road') === null && handlebarWidthFor('x', 'road') === null);

// ---------------------------------------------------------------------------
console.log('\n== 4. COMPARAÇÃO COM A BICICLETA ATUAL ==');
const saddleOk = compareWithCurrent({ recommended: 74.2, current: 74, tolerance: TOLERANCES.saddleHeightCm });
const saddleOff = compareWithCurrent({ recommended: 74.2, current: 76.5, tolerance: TOLERANCES.saddleHeightCm });
check('selim a 74 cm vs 74,2 recomendado → dentro da tolerância', saddleOk.withinTolerance === true && saddleOk.delta === -0.2, JSON.stringify(saddleOk));
check('selim a 76,5 cm → fora da tolerância, com diferença +2,3 cm', saddleOff.withinTolerance === false && saddleOff.delta === 2.3, JSON.stringify(saddleOff));
check('sem o valor atual não há comparação', compareWithCurrent({ recommended: 74.2, current: null, tolerance: 1.5 }) === null);
check('sem recomendação não há comparação', compareWithCurrent({ recommended: null, current: 74, tolerance: 1.5 }) === null);
check(
  'quadro: 54 cm vs 55,9 estimado → fora (±1,5 cm)',
  compareWithCurrent({ recommended: 55.9, current: 54, tolerance: TOLERANCES.frameSizeCm }).withinTolerance === false,
  JSON.stringify(compareWithCurrent({ recommended: 55.9, current: 54, tolerance: TOLERANCES.frameSizeCm }))
);
check(
  'guiador: 400 mm vs 420 recomendado → fora (±10 mm)',
  compareWithCurrent({ recommended: 420, current: 400, tolerance: TOLERANCES.handlebarWidthMm }).withinTolerance === false
);
check(
  'crenque: 172,5 mm vs 172,5 → igual, dentro do esperado',
  compareWithCurrent({ recommended: 172.5, current: 172.5, tolerance: TOLERANCES.crankLengthMm }).withinTolerance === true
);
check(
  'crenque: 170 mm vs 172,5 recomendado → um passo diferente, é assinalado',
  compareWithCurrent({ recommended: 172.5, current: 170, tolerance: TOLERANCES.crankLengthMm }).withinTolerance === false
);
check(
  'as tolerâncias são as declaradas no módulo (selim ±1,5 cm · quadro ±1,5 cm · guiador ±10 mm · crenque exato)',
  TOLERANCES.saddleHeightCm === 1.5 && TOLERANCES.frameSizeCm === 1.5 && TOLERANCES.handlebarWidthMm === 10 && TOLERANCES.crankLengthMm === 0,
  JSON.stringify(TOLERANCES)
);

// ---------------------------------------------------------------------------
console.log('\n== 5. FORMULÁRIO VAZIO E PAINEL LIGADO AOS DADOS ==');
const component = read('src/components/AthleteOnboarding/AthleteOnboarding.js');
const template = read('src/components/AthleteOnboarding/AthleteOnboarding.html');

check('o formulário não arranca com valores de amostra (sem 178/84/42/74/172,5)',
  !/height_cm:\s*178/.test(component) && !/inseam_cm:\s*84/.test(component) && !/current_saddle_height_cm:\s*74/.test(component) && !/crank_length_mm:\s*172\.5/.test(component)
);
check('os campos começam a `null` (nem 0 nem string vazia com significado)',
  /height_cm:\s*null/.test(component) && /inseam_cm:\s*null/.test(component) && /shoulder_width_cm:\s*null/.test(component) && /current_saddle_height_cm:\s*null/.test(component)
);
check('as estimativas vêm do módulo (fonte única)', component.includes("from './modules/theoreticalEstimates'") && component.includes('computeTheoreticalEstimates(form)'));
check('o painel só aparece quando há estimativas', template.includes('v-if="hasEstimates"') && !template.includes('v-if="theoreticalEstimates"'));
check('existe um painel de espera para quando não há dados', template.includes('class="estimates-pending-panel"') && template.includes("t('estimatesPendingIntro')"));
check('o painel de espera diz o que falta', template.includes('v-for="label in missingLabels"') && template.includes("t('estimatesMissingLabel')"));

const gatedItems = [
  ['altura do selim (LeMond)', 'v-if="estimates.ready.saddleHeight"'],
  ['tamanho de quadro', 'v-if="estimates.ready.frameSize"'],
  ['largura de guiador', 'v-if="estimates.ready.handlebarWidth"'],
  ['comprimento de crenque', 'v-if="estimates.ready.crankLength"'],
];
gatedItems.forEach(([label, condition]) => check(`cada número está condicionado ao seu dado (${label})`, template.includes(condition)));

check('o crenque tem o mesmo gate do selim (ambos precisam do cavalo)', (template.match(/v-if="estimates\.ready\.(saddleHeight|frameSize|crankLength)"/g) || []).length >= 4);
check('cada número diz de que campo veio', (template.match(/\{\{ basisNote\(/g) || []).length >= 4);
check('o guiador em MTB mostra a faixa, não um valor único', template.includes('handlebar_is_convention') && template.includes("t('mtbHandlebarNote')"));
check('as comparações com a bicicleta atual existem para quadro, guiador e crenque',
  template.includes('v-if="frameComparison"') && template.includes('v-if="handlebarComparison"') && template.includes('v-if="crankComparison"')
);
check(
  'uma diferença fora da tolerância fica assinalada (quadro, guiador e crenque)',
  (template.match(/delta-warning': (frame|handlebar|crank)Comparison && !\w+Comparison\.withinTolerance/g) || []).length === 3,
  String((template.match(/!\w+Comparison\.withinTolerance/g) || []).length)
);
check('modelo de dados: o crenque tem uma linha de comparação com o crenque montado', template.includes('v-if="crankComparison"') && template.includes('comparisonText(crankComparison'));
check('a comparação da altura do selim continua a ter o seu cartão dedicado', template.includes('v-if="saddleComparison"') && template.includes('saddleDeltaIsWarning'));
check('já não há números de amostra escritos no template das estimativas',
  !template.includes('theoreticalEstimates.lemond_saddle_height_cm') && !template.includes('saddleDelta > 0 ?')
);
check('o aviso de cavalo inválido existe no componente', component.includes("t.value('invalidInseam')"));
check('a sessão continua a receber a forma antiga (compatível com o chip LeMond da etapa 2)',
  component.includes('theoreticalEstimates: estimates.value.values') && read('src/components/LiveCameraCapture/LiveCameraCapture.html').includes('theoreticalEstimates.lemond_saddle_height_cm')
);

const i18n = read('src/i18n.js');
['estimatesPendingIntro', 'estimatesMissingLabel', 'estimateCurrentLabel', 'estimateDeltaLabel', 'estimateWithinTolerance', 'estimateBasisInseam', 'estimateBasisShoulders', 'saddleCurrentHigher', 'saddleCurrentLower', 'mtbHandlebarNote', 'invalidInseam'].forEach((key) => {
  check(`a chave ${key} existe em pt e em inglês`, (i18n.match(new RegExp(`${key}:`, 'g')) || []).length === 2);
});

// ---------------------------------------------------------------------------
console.log('\n----------------------------------------------------------------------');
if (failures) {
  console.log(`❌ ${failures} verificação(ões) FALHARAM.`);
  process.exit(1);
}
console.log('✅ Todas as verificações das estimativas teóricas passaram.');
