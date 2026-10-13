/**
 * Verificação automática da BANCADA DIRECTML E DO PALCO DE VÍDEO.
 *
 * Executar com:  npm run verify:workbench
 *
 * O pedido do utilizador que este ficheiro trava:
 *   "as recomendações são poucas na bancada DirectML, e talvez no restante... deveria falar sobre o
 *    avanço, cleats, altura do selim, guiador, tamanho do reach do guiador, tamanho da bike
 *    comparativamente ao tamanho da pessoa. se houver ligação à internet, pode até ir consultar o
 *    tamanho da bicicleta e consultar para que tamanho de pessoas é indicado"
 *   "o tamanho do vídeo deveria dar para aumentar e diminuir, não só mudar de resolução" (o palco
 *    tem de poder crescer de verdade e escapar ao limite de 1240px da página)
 *   "quero uma opção de poder tirar uma foto (print) na imagem no momento sem o HUD por cima"
 *
 * Prova-se, sem navegador:
 *  1. As tabelas publicadas de tamanho (Giant/Trek/Specialized/Canyon) estão lá, com fonte, e a
 *     comparação altura ↔ tamanho do quadro decide como esperado (coerente / acima / abaixo).
 *  2. A bancada produz 7 cartões: selim, avanço, guiador, travessões, crenque, tamanho da bike e
 *     cockpit — com evidência e fonte em cada um.
 *  3. Sem dados do atleta NENHUM cartão inventa um alvo: todos dizem o que falta.
 *  4. O desvio do selim usa a mesma conversão do motor coerente (2,4 mm por grau) e dá o alvo
 *     absoluto em cm quando o atleta declara a altura do selim.
 *  5. O avanço segue o cotovelo (alvo da postura/modalidade) e dá o alvo absoluto em mm.
 *  6. Os dados do atleta entram na bancada a partir do perfil guardado (passo 1), sem nova pergunta.
 *  7. O componente da bancada usa o construtor novo e já não tem o diagnóstico fixo de três cartões.
 *  8. O palco de vídeo tem zoom real (aumentar/diminuir), presets, modo expandido que escapa ao
 *     limite de 1240px, e a fotografia do fotograma sem HUD.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RIDER_SIZE_CHARTS,
  chartRowsForStyle,
  compareBikeToRider,
  sizeReferencesForHeight,
} from '../src/components/workbench/modules/bikeSizeGuide.js';
import {
  BAR_SHAPE_TYPES,
  classifyBar,
  stemRangeForFrameSize,
} from '../src/components/workbench/modules/componentReference.js';
import {
  buildWorkbenchRecommendations,
  loadWorkbenchAthleteForm,
  toAthleteProfileInput,
} from '../src/components/workbench/modules/workbenchRecommendations.js';
import { PROFILE_STORAGE_KEY } from '../src/components/AthleteOnboarding/modules/athleteProfiles.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failures = 0;
function check(label, condition, extra = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` :: ${extra}` : ''}`);
}

/** Perfil do passo 1 realista (é o formulário que o atleta preenche). */
const fullProfile = {
  name: 'Atleta Teste',
  weight_kg: 74,
  shoe_size_eu: 43,
  waist_cm: 82,
  height_cm: 178,
  inseam_cm: 84,
  shoulder_width_cm: 40,
  riding_style: 'road',
  current_saddle_height_cm: 74,
  frame_size_cm: 54,
  top_tube_mm: 545,
  handlebar_width_mm: 420,
  handlebar_reach_mm: 75,
  handlebar_drop_mm: 145,
  stem_length_mm: 110,
  crank_length_mm: 172.5,
  cleat_position: 'forward',
};

/* ------------------------------------------------------------------ */
console.log('\n== 1. Tabelas publicadas: altura do atleta → tamanho do quadro ==');
check('há tabelas de estrada, gravel e MTB', ['road', 'gravel', 'mtb'].every((style) => RIDER_SIZE_CHARTS.some((c) => c.style === style)));
check('cada tabela declara a fonte', RIDER_SIZE_CHARTS.every((c) => typeof c.source === 'string' && c.source.startsWith('https://')));
check('estrada: a estrada tem tabelas com tubo do selim em cm (Giant/Canyon)', RIDER_SIZE_CHARTS.some((c) => c.style === 'road' && c.seatTubeComparable && c.rows.some((r) => typeof r.seatTubeCm === 'number')));
check('MTB: nenhuma tabela de MTB é comparada por cm (só rótulo)', RIDER_SIZE_CHARTS.filter((c) => c.style === 'mtb').every((c) => c.seatTubeComparable === false));

const refs172 = sizeReferencesForHeight({ heightCm: 172, ridingStyle: 'road' });
check('172 cm em estrada cai em vários rótulos de marcas diferentes (as faixas sobrepõem-se)', refs172.brandsMatching.length >= 2, refs172.brandsMatching.join(','));
check('172 cm inclui Trek 54 (168–174 cm)', refs172.references.some((r) => r.brand === 'Trek' && r.label === '54'));
check('172 cm inclui Giant S ou M', refs172.references.some((r) => r.brand === 'Giant' && ['S', 'M'].includes(r.label)));
check('172 cm inclui Specialized 52', refs172.references.some((r) => r.brand === 'Specialized' && r.label === '52'));

const mtbRefs = sizeReferencesForHeight({ heightCm: 175, ridingStyle: 'mtb' });
check('em MTB os cm do tubo do selim nunca são marcados como comparáveis', mtbRefs.references.every((r) => r.seatTubeComparable === false));
check('em MTB o rótulo é o que se reporta (há pelo menos uma marca com tamanho para 175 cm)', mtbRefs.references.some((r) => r.containsHeight));
check('MTB diz que o dimensionamento não é por altura como a estrada', /reach/i.test(mtbRefs.sizingNote), mtbRefs.sizingNote);

/* ------------------------------------------------------------------ */
console.log('\n== 2. Comparação bike ↔ atleta: coerente, acima e abaixo ==');
const matchCase = compareBikeToRider({ heightCm: 180, frameSizeCm: 51.5, ridingStyle: 'road' });
check('180 cm com quadro 51,5 cm → coerente (BMC/Giant M/L e Canyon M para 180 cm)', matchCase.status === 'match', `${matchCase.status} :: ${matchCase.headline}`);

const longCase = compareBikeToRider({ heightCm: 170, frameSizeCm: 56.5, ridingStyle: 'road' });
check('170 cm com quadro 56,5 cm → um tamanho ACIMA', longCase.status === 'too-long', `${longCase.status} :: ${longCase.headline}`);
check('o aviso explica a consequência (tronco esticado / avanço a compensar)', /esticad|encurtar o avanço/i.test(longCase.detail));

const shortCase = compareBikeToRider({ heightCm: 190, frameSizeCm: 43, ridingStyle: 'road' });
check('190 cm com quadro 43 cm → um tamanho ABAIXO', shortCase.status === 'too-short', `${shortCase.status} :: ${shortCase.headline}`);

const mtbCase = compareBikeToRider({ heightCm: 175, frameSizeCm: 45, ridingStyle: 'mtb' });
check('em MTB o veredicto é por rótulo, não por cm', mtbCase.status === 'label-only', mtbCase.status);

const noHeight = compareBikeToRider({ frameSizeCm: 54, ridingStyle: 'road' });
check('sem altura não há comparação inventada', noHeight.status === 'no-height' && noHeight.missing.includes('height_cm'));

const heightOnly = compareBikeToRider({ heightCm: 165, ridingStyle: 'road' });
check('com altura e sem tamanho declarado listam-se as referências publicadas', heightOnly.status === 'height-only' && /Trek|Giant|Canyon|Specialized/.test(heightOnly.detail));

check('a tabela de apresentação traz todas as linhas da modalidade', chartRowsForStyle('road').length >= 20, String(chartRowsForStyle('road').length));

/* ------------------------------------------------------------------ */
console.log('\n== 3. Bancada: 7 cartões, com evidência e fonte ==');
const built = buildWorkbenchRecommendations({
  measurements: { knee: 140, torso: 55, elbow: 170, ankle: 100 },
  form: fullProfile,
  posture: 'upright',
  ridingStyle: 'road',
});

const keys = built.cards.map((c) => c.key);
check(
  'os sete componentes estão cobertos',
  ['saddle', 'stem', 'handlebar', 'cleats', 'crank', 'bikeSize', 'cockpit'].every((key) => keys.includes(key)),
  keys.join(',')
);
check('todos os cartões têm evidência', built.cards.every((c) => Array.isArray(c.evidence) && c.evidence.length > 0));
check('todos os cartões citam a fonte', built.cards.every((c) => typeof c.source === 'string' && c.source.length > 3));
check('todos os cartões dizem o que fazer (ação não vazia)', built.cards.every((c) => typeof c.action === 'string' && c.action.length > 10));

const saddleCard = built.cards.find((c) => c.key === 'saddle');
check('joelho 140° (abaixo de 145–155°) → subir o selim', /Subir o selim/.test(saddleCard.action), saddleCard.action);
check('desvio do selim pela conversão de 2,4 mm por grau (5° → 12 mm)', saddleCard.deltaMm === 12, String(saddleCard.deltaMm));
check('alvo absoluto em cm quando a altura do selim é declarada (74 → 75,2 cm)', /74 cm para 75\.2 cm/.test(saddleCard.action), saddleCard.action);
check('cruza com a fórmula de LeMond do cavalo do passo 1', /LeMond/.test(saddleCard.extraNote), saddleCard.extraNote);

const stemCard = built.cards.find((c) => c.key === 'stem');
check('cotovelo 170° (acima de 150–165°) → encurtar o avanço', /Encurtar o avanço 15 mm/.test(stemCard.action), stemCard.action);
check('alvo absoluto do avanço em mm (110 → 95)', /110 mm → 95 mm/.test(stemCard.action), stemCard.action);
check('o avanço é lido contra a faixa publicada do tamanho do quadro (54 cm → 90–110 mm)', /90–110 mm/.test(stemCard.extraNote), stemCard.extraNote);

const barCard = built.cards.find((c) => c.key === 'handlebar');
check('40 cm de ombros com guiador de 420 mm → trocar para 400 mm', /400 mm/.test(barCard.action) && barCard.status === 'danger', barCard.action);
check('o guiador é julgado também pela curva (reach/drop declarados)', /reach 75 mm · drop 145 mm/.test(barCard.evidence.join(' | ')), barCard.evidence.join(' | '));

const cleatCard = built.cards.find((c) => c.key === 'cleats');
check('os travessões têm recuo de referência pelo número de sapato (43 EU → 9–11 mm)', /9–11 mm/.test(cleatCard.targetText), cleatCard.targetText);
check('a posição declarada do travessão é tida em conta', /avançados/i.test(cleatCard.measuredText), cleatCard.measuredText);

const crankCard = built.cards.find((c) => c.key === 'crank');
check('crenque 172,5 mm com cavalo de 84 cm → no alvo', crankCard.status === 'ok', crankCard.badge);

const bikeCard = built.cards.find((c) => c.key === 'bikeSize');
check('o cartão do tamanho da bike compara 178 cm com o quadro de 54 cm', bikeCard.status === 'ok' && /178|tamanho certo/i.test(bikeCard.why + bikeCard.action), bikeCard.action);
check('o cartão do tamanho da bike lista as referências publicadas da altura', (bikeCard.references || []).length >= 2, String((bikeCard.references || []).length));

const cockpitCard = built.cards.find((c) => c.key === 'cockpit');
check('o alcance total soma quadro + avanço + guiador (545 + 110 + 75 = 730 mm)', cockpitCard.measuredText === '730 mm', cockpitCard.measuredText);

/* ------------------------------------------------------------------ */
console.log('\n== 4. Sem dados do atleta, nenhum alvo é inventado ==');
const emptyBuilt = buildWorkbenchRecommendations({ measurements: {}, form: {} });
check('todos os cartões ficam em falta quando não há medições nem passo 1', emptyBuilt.cards.every((c) => c.status === 'missing'), emptyBuilt.cards.map((c) => `${c.key}:${c.status}`).join(','));
check('nenhum cartão devolve desvio numérico sem dados', emptyBuilt.cards.every((c) => c.deltaMm === undefined));
check('cada cartão diz exatamente o que falta', emptyBuilt.cards.every((c) => /falta|sem |não/i.test(c.action + c.measuredLabel)));

const notesOnly = buildWorkbenchRecommendations({
  measurements: {},
  form: { name: 'Só corpo', height_cm: 172, inseam_cm: 80, shoe_size_eu: 42, shoulder_width_cm: 39 },
});
const notesBikeCard = notesOnly.cards.find((c) => c.key === 'bikeSize');
check('só com altura, o tamanho da bike devolve a referência publicada (não um veredicto)', notesBikeCard.status === 'attention', notesBikeCard.badge);
check('o crenque sem medida montada diz que falta o crenque', /Falta o comprimento do crenque/.test(notesOnly.cards.find((c) => c.key === 'crank').action));

/* ------------------------------------------------------------------ */
console.log('\n== 5. Postura/modalidade mudam os alvos (fonte única: postureMode) ==');
const ttBuilt = buildWorkbenchRecommendations({
  measurements: { knee: 148, torso: 25, elbow: 100, ankle: 100 },
  form: { ...fullProfile, riding_style: 'tt' },
  posture: 'aero',
  ridingStyle: 'tt',
});
check('em aero o alvo do cotovelo é 80–115°', /80°–115°/.test(ttBuilt.cards.find((c) => c.key === 'stem').targetText), ttBuilt.cards.find((c) => c.key === 'stem').targetText);
check('cotovelo 100° em aero está no alvo', ttBuilt.cards.find((c) => c.key === 'stem').status === 'ok');
check('em MTB o alvo do joelho é 140–150°', (() => {
  const mtb = buildWorkbenchRecommendations({ measurements: { knee: 145 }, form: { ...fullProfile, riding_style: 'mtb' }, ridingStyle: 'mtb' });
  return /140°–150°/.test(mtb.cards.find((c) => c.key === 'saddle').targetText);
})());

/* ------------------------------------------------------------------ */
console.log('\n== 6. Os dados do passo 1 entram sozinhos na bancada ==');
const fakeStorage = {
  getItem: (key) => {
    if (key !== PROFILE_STORAGE_KEY) return null;
    return JSON.stringify([
      { ...fullProfile, name: 'Antigo', savedAt: 1000, frame_size_cm: 50 },
      { ...fullProfile, name: 'Recente', savedAt: 5000, frame_size_cm: 54 },
    ]);
  },
};
const loaded = loadWorkbenchAthleteForm(fakeStorage);
check('lê o perfil mais recente do passo 1', loaded.form.frame_size_cm === 54 && loaded.source === 'onboarding-profile', loaded.sourceLabel);
check('assinala que há dados da bicicleta', loaded.hasBikeData === true);
check('sem armazenamento devolve "sem dados" em vez de rebentar', loadWorkbenchAthleteForm(undefined).source === 'none');
check('a conversão para o perfil antropométrico usa os nomes esperados (camelCase)', toAthleteProfileInput(fullProfile).inseamCm === 84 && toAthleteProfileInput(fullProfile).cleatPosition === 'forward');

/* ------------------------------------------------------------------ */
console.log('\n== 7. O componente da bancada usa o diagnóstico novo ==');
const workbenchSource = read('src/components/workbench/BiomechanicalWorkbench.vue');
check('importa o construtor das recomendações', /buildWorkbenchRecommendations/.test(workbenchSource));
check('carrega o perfil do passo 1', /loadWorkbenchAthleteForm/.test(workbenchSource));
check('já não tem o diagnóstico fixo de três cartões', !/saddleDiagnosis|cockpitDiagnosis/.test(workbenchSource));
check('apresenta as tabelas publicadas com as fontes', /publishedSizeRows/.test(workbenchSource) && /publishedSizeSources/.test(workbenchSource));
check('mostra de onde vêm os dados do atleta', /athleteDataSourceLabel/.test(workbenchSource));
check('prefere as amostras do BDC para a extensão do joelho', /isBdc/.test(workbenchSource) && /preferBdc/.test(workbenchSource));

/*
 * Cada import relativo do componente tem de existir mesmo no disco. Este erro (caminho a menos, com
 * um `../..` a mais) só aparecia no `npm run build`, não nas verificações: fica travado aqui.
 */
const workbenchDir = path.join(root, 'src/components/workbench');
const relativeImports = [...workbenchSource.matchAll(/from '(\.\.?\/[^']+)'/g)].map((m) => m[1]);
const unresolved = relativeImports.filter((spec) => {
  const base = path.resolve(workbenchDir, spec);
  return !['', '.js', '.vue', '.mjs'].some((ext) => fs.existsSync(base + ext)) && !fs.existsSync(path.join(base, 'index.js'));
});
check('todos os imports relativos do componente existem no disco', unresolved.length === 0, unresolved.join(', '));
check('o componente importa os alvos de postura do módulo de vídeo', relativeImports.some((spec) => /postureMode$/.test(spec)));

const storeSource = read('src/stores/inferenceStore.js');
check('a telemetria guarda o tornozelo e a marca de BDC vindos do backend', /ankle: data\.angles\.ankle/.test(storeSource) && /isBdc: Boolean\(data\.is_bdc\)/.test(storeSource));
check(
  'o esquema das amostras continua a ter tempo/joelho/tronco/braço (gráfico intacto)',
  /time: Number\(timeSec/.test(storeSource) &&
    /knee: data\.angles\.knee/.test(storeSource) &&
    /torso: data\.angles\.torso/.test(storeSource) &&
    /arm: data\.angles\.arm_elbow/.test(storeSource)
);

/* ------------------------------------------------------------------ */
console.log('\n== 8. Palco de vídeo: aumentar/diminuir e foto sem HUD ==');
const playerSource = read('src/components/video/VideoPlayerVLC.vue');
check('o zoom é uma LARGURA em percentagem (aumenta e diminui o vídeo a sério)', /zoomPercent/.test(playerSource) && /width: zoomPercent \+ '%'/.test(playerSource));
check('há passos de +/- e limites mínimo/máximo', /MIN_ZOOM_PERCENT/.test(playerSource) && /MAX_ZOOM_PERCENT/.test(playerSource) && /stepZoom/.test(playerSource));
check('há predefinições de largura para clicar', /zoomPresets/.test(playerSource));
check('o modo expandido escapa ao limite de 1240px da página', /is-expanded-stage/.test(playerSource) && /min\(calc\(100vw - 24px\), 1920px\)/.test(playerSource));
check('o palco expandido fica centrado no viewport (não sai para a direita)', /margin-left: calc\(50% - min\(50vw - 12px, 960px\)\)/.test(playerSource));
check('a fotografia captura o fotograma nativo sem desenhar HUD nem esqueleto', /const capturePhoto/.test(playerSource) && /ctx\.drawImage\(video, 0, 0, width, height\)/.test(playerSource) && !/strokeStyle|fillText/.test(playerSource.split('const capturePhoto')[1]?.split('// Se detetar')[0] || ''));
check('a foto é transferida como ficheiro JPEG', /anchor\.download = filename/.test(playerSource) && /image\/jpeg/.test(playerSource));
check('há atalho de teclado (P) e aviso ao utilizador', /KeyP/.test(playerSource) && /showPhotoToast/.test(playerSource));

/* ------------------------------------------------------------------ */
console.log('\n== 9. Voz dos cartões: os assuntos pedidos pelo utilizador ==');
const allText = built.cards.map((c) => `${c.title} ${c.action} ${c.why}`).join(' \n ');
[
  ['avanço', /avanço/i],
  ['cleats / travessões', /travessões|cleat/i],
  ['altura do selim', /selim/i],
  ['guiador (largura)', /guiador/i],
  ['reach do guiador', /reach/i],
  ['tamanho da bike vs pessoa', /tamanho.*(bike|quadro)|quadro.*tamanho/i],
].forEach(([label, regex]) => check(`a bancada fala de ${label}`, regex.test(allText)));

check('as curvas de guiador de referência estão documentadas (compacta/ergo/tradicional/gravel)', BAR_SHAPE_TYPES.length >= 4 && BAR_SHAPE_TYPES.every((t) => t.source.startsWith('https://')));
check('a classificação da curva separa compacta de funda', classifyBar({ barDropMm: 125 }).typeId === 'compact' && classifyBar({ barDropMm: 145 }).typeId === 'traditional');
check('a faixa de avanço por tamanho de quadro é declarada (54 → 90–110 mm)', stemRangeForFrameSize(54).minMm === 90 && stemRangeForFrameSize(54).maxMm === 110);

/* ------------------------------------------------------------------ */
console.log(`\n${failures === 0 ? '✅ TODAS AS VERIFICAÇÕES PASSARAM' : `❌ ${failures} VERIFICAÇÃO(ÕES) FALHARAM`}`);
process.exit(failures === 0 ? 0 : 1);
