/**
 * Verificação automática da ajuda contextual das estimativas teóricas.
 *
 * Executar com:  npm run verify:help
 *
 * Garante, sem navegador e sem dependências, que:
 *  1. Cada medida tem explicação completa (o que é, como se mede, cálculo e fonte)
 *     nos dois idiomas (pt/en) — nada de painéis vazios.
 *  2. Todos os desenhos são SVG válido, existem e estão todos usados.
 *  3. O painel das estimativas liga uma ajuda a cada medida e a cada campo de
 *     entrada importante (é a ligação que falha silenciosamente num refactor).
 *  4. O componente de ajuda abre com rato, teclado e toque (hover não existe em
 *     telemóvel) e expõe o estado a leitores de ecrã.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HELP_ENTRIES, HELP_KEYS, getTheoreticalHelp } from '../src/components/AthleteOnboarding/modules/theoreticalHelp.js';
import { DIAGRAMS, DIAGRAM_IDS, getDiagram } from '../src/components/common/HelpTip/diagrams.js';
import { CHROMA_JOINT_COLORS } from '../src/services/chroma/markerPalette.js';

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
console.log('\n== 1. Conteúdo completo nos dois idiomas ==');
const fields = ['title', 'summary', 'formula', 'source'];
check('há ajuda para as medidas e para os campos de entrada', HELP_KEYS.length >= 8, HELP_KEYS.join(', '));

['pt', 'en'].forEach((lang) => {
  const incomplete = HELP_KEYS.filter((key) => {
    const entry = HELP_ENTRIES[key][lang];
    return !entry || fields.some((field) => !entry[field] || !String(entry[field]).trim()) || !Array.isArray(entry.steps) || entry.steps.length < 2;
  });
  check(`todas as ajudas estão completas em ${lang.toUpperCase()} (título, resumo, 2+ passos, cálculo, fonte)`, incomplete.length === 0, incomplete.join(', '));
});

check('todos os passos têm texto próprio', HELP_KEYS.every((key) => ['pt', 'en'].every((lang) => HELP_ENTRIES[key][lang].steps.every((step) => typeof step === 'string' && step.trim().length > 15))));
check(
  'o realce `**…**` só aparece nos resumos (é lá que a interface o converte em <strong>)',
  ['pt', 'en'].every((lang) =>
    HELP_KEYS.every((key) => {
      const entry = HELP_ENTRIES[key][lang];
      const marks = (entry.summary.match(/\*\*/g) || []).length;
      const inSteps = entry.steps.some((step) => step.includes('**')) || [entry.title, entry.formula, entry.source].some((value) => value.includes('**'));
      return marks % 2 === 0 && !inSteps;
    }),
  ),
);
check('o texto muda de idioma (pt ≠ en)', HELP_KEYS.every((key) => HELP_ENTRIES[key].pt.summary !== HELP_ENTRIES[key].en.summary));

const ptHelp = getTheoreticalHelp('pt');
const enHelp = getTheoreticalHelp('en');
check('getTheoreticalHelp devolve todas as chaves', Object.keys(ptHelp).length === HELP_KEYS.length);
check('getTheoreticalHelp aceita idioma desconhecido sem falhar', getTheoreticalHelp('xx').inseam.title === HELP_ENTRIES.inseam.pt.title);
check('o idioma inglês é servido em inglês', enHelp.inseam.title === HELP_ENTRIES.inseam.en.title);
check('cada ajuda traz o identificador do desenho resolvido', HELP_KEYS.every((key) => ptHelp[key].diagram === HELP_ENTRIES[key].diagram));

// Nomes e medidas corretos (pesquisa feita a pedido do utilizador): o TAMANHO DO QUADRO é o tubo do
// selim, do eixo pedaleiro ao topo (C-T); o TUBO SUPERIOR (ETT) é o comprimento horizontal entre o
// eixo do tubo do selim e o eixo do tubo de direção — não vai até ao avanço.
check('a ajuda do tamanho do quadro diz que a medida é o tubo do selim, do eixo pedaleiro ao topo (C-T)',
  /C-T/.test(HELP_ENTRIES.frameSize.pt.summary) && /topo do tubo do selim/.test(HELP_ENTRIES.frameSize.pt.summary));
check('a ajuda do tamanho do quadro avisa que a convenção C-C dá cerca de 1–2 cm menos',
  /1–2 cm menos/.test(HELP_ENTRIES.frameSize.pt.steps.join(' ')));
check('a ajuda do tamanho do quadro remete para o tubo superior (não confundir as duas medidas)',
  /tubo superior/i.test(HELP_ENTRIES.frameSize.pt.summary) && /tubo superior/i.test(HELP_ENTRIES.frameSize.pt.steps.join(' ')));
check('a ajuda do tubo superior explica que o tubo liga ao tubo de direção e não vai até ao avanço',
  /tubo de direção/.test(HELP_ENTRIES.topTube.pt.summary) && /não vai até ao avanço/.test(HELP_ENTRIES.topTube.pt.summary));
check('a ajuda do tubo superior dá o alcance total do cockpit (ETT + avanço + reach do guiador)',
  /ETT \+ avanço \+ reach do guiador/.test(HELP_ENTRIES.topTube.pt.steps.join(' ')));
check('as duas ajudas citam a fonte',
  /sheldonbrown/.test(HELP_ENTRIES.frameSize.pt.source) && /geometrygeeks|bikeinsights/.test(HELP_ENTRIES.topTube.pt.source));

/* ------------------------------------------------------------------ */
console.log('\n== 2. Desenhos técnicos ==');
const drawingKeys = HELP_KEYS.map((key) => HELP_ENTRIES[key].diagram).filter(Boolean);
check('todas as ajudas apontam para um desenho', drawingKeys.length === HELP_KEYS.length, `${drawingKeys.length}/${HELP_KEYS.length}`);
check('os desenhos existem no registo', drawingKeys.every((id) => DIAGRAM_IDS.includes(id)), drawingKeys.filter((id) => !DIAGRAM_IDS.includes(id)).join(', '));
// Um desenho está "em uso" se uma ajuda do onboarding o apontar OU se algum template de
// componente o usar (ex.: `diagram="chromaMarkers"` em LiveCameraCapture). Órfão = ninguém usa.
const usedInTemplates = new Set();
const walkTemplates = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkTemplates(full);
    if (!/\.(html|vue)$/.test(entry.name)) return;
    const text = fs.readFileSync(full, 'utf8');
    for (const match of text.matchAll(/diagram="([^"]+)"/g)) usedInTemplates.add(match[1]);
  });
walkTemplates(path.join(root, 'src'));

check(
  'não há desenhos órfãos (usados por uma ajuda ou por um template)',
  DIAGRAM_IDS.every((id) => drawingKeys.includes(id) || usedInTemplates.has(id)),
  DIAGRAM_IDS.filter((id) => !drawingKeys.includes(id) && !usedInTemplates.has(id)).join(', '),
);

const malformed = DIAGRAM_IDS.filter((id) => {
  const svg = DIAGRAMS[id];
  const tags = (svg.match(/<(svg|text|defs|marker|rect|line|circle|path|g)\b/g) || []).length;
  const closed = (svg.match(/<\//g) || []).length + (svg.match(/\/>/g) || []).length;
  return !svg.startsWith('<svg') || !svg.trimEnd().endsWith('</svg>') || !svg.includes('viewBox="0 0 260 132"') || !svg.includes('aria-hidden="true"') || tags !== closed;
});
check('todos os desenhos são SVG bem formado, com viewBox e escondidos de leitores de ecrã', malformed.length === 0, malformed.join(', '));
/**
 * Cores literais são proibidas nos desenhos (têm de seguir o tema) — **exceto** quando a cor
 * É o conteúdo: o desenho do CromaTrack mostra as cores reais dos marcadores físicos, que não
 * podem mudar com o tema. A exceção é nominal e conferida contra a paleta: se a paleta mudar e
 * o desenho não, esta verificação falha. A exceção não pode divergir da fonte de verdade.
 */
const COLOR_LITERALS_BY_DIAGRAM = { chromaMarkers: Object.values(CHROMA_JOINT_COLORS) };
const diagramsWithStrayColors = DIAGRAM_IDS.filter((id) => {
  const svg = DIAGRAMS[id];
  const allowed = COLOR_LITERALS_BY_DIAGRAM[id] || [];
  const hexLiterals = svg.match(/#[0-9a-fA-F]{3,8}/g) || [];
  return /rgb\(/.test(svg) || hexLiterals.some((color) => !allowed.includes(color));
});
check(
  'o desenho usa classes do tema, ou cores semânticas conferidas contra a paleta',
  diagramsWithStrayColors.length === 0,
  diagramsWithStrayColors.join(', '),
);
check('cada desenho tem rótulo legível', DIAGRAM_IDS.every((id) => (DIAGRAMS[id].match(/<text/g) || []).length >= 3));
check('um identificador desconhecido devolve vazio (nunca rebenta)', getDiagram('nao-existe') === '' && getDiagram(undefined) === '');

/* ------------------------------------------------------------------ */
console.log('\n== 3. Ligação à interface ==');
const onboardingHtml = read('src/components/AthleteOnboarding/AthleteOnboarding.html');
const estimatesStart = onboardingHtml.indexOf('class="estimates-panel"');
const estimatesBlock = onboardingHtml.slice(estimatesStart, onboardingHtml.indexOf('form-actions', estimatesStart));

check('o painel das estimativas existe no template', estimatesStart > 0);
['help.lemond', 'help.hamley109', 'help.deltaSaddle', 'help.frameSize', 'help.handlebarWidth', 'help.crankLength'].forEach((binding) => {
  check(`a estimativa usa ${binding}`, estimatesBlock.includes(binding));
});
check('os 6 números das estimativas têm ajuda', (estimatesBlock.match(/<HelpTip/g) || []).length === 6, String((estimatesBlock.match(/<HelpTip/g) || []).length));

const inputHelps = ['help.inseam', 'help.height', 'help.shoulderWidth', 'help.currentSaddle', 'help.topTube'];
inputHelps.forEach((binding) => {
  check(`o campo de entrada usa ${binding}`, onboardingHtml.includes(binding));
});
check('as ajudas dos campos ficam junto do respetivo rótulo', (onboardingHtml.match(/<label[^>]*>[\s\S]{0,120}?<HelpTip/g) || []).length >= 6);
check('o painel explica que as medidas têm ajuda', onboardingHtml.includes("t('theoreticalHelpHint')"));

const onboardingJs = read('src/components/AthleteOnboarding/AthleteOnboarding.js');
check('o componente regista o HelpTip', onboardingJs.includes('components: { HelpTip }'));
check('o componente injeta a ajuda traduzida', onboardingJs.includes('getTheoreticalHelp(locale.value)'));
check('a ajuda acompanha a troca de idioma', /const help = computed\([\s\S]{0,120}locale\.value/.test(onboardingJs));

const i18n = read('src/i18n.js');
check('a dica da ajuda existe em pt e em inglês', (i18n.match(/theoreticalHelpHint:/g) || []).length === 2);

/* ------------------------------------------------------------------ */
console.log('\n== 4. O selo abre em todos os dispositivos de entrada ==');
const helpHtml = read('src/components/common/HelpTip/HelpTip.html');
check('abre com o rato (hover)', helpHtml.includes('@mouseenter="show"') && helpHtml.includes('@mouseleave="scheduleHide"'));
check('abre com o teclado (foco)', helpHtml.includes('@focus="show"'));
check('abre com o toque (clique)', helpHtml.includes('@click.stop="toggle"'));
check('fecha com a tecla Escape', helpHtml.includes('@keydown.escape="hide"'));
check('anuncia o estado a leitores de ecrã', helpHtml.includes(':aria-expanded') && helpHtml.includes(':aria-describedby') && helpHtml.includes(':aria-label'));
check('o painel é um tooltip e mantém-se aberto ao passar o rato por cima', helpHtml.includes('role="tooltip"') && helpHtml.includes('@mouseenter="show"'));
check('o desenho é injetado no painel', helpHtml.includes('v-html="diagramSvg"'));
check('o painel mostra o cálculo e a fonte', helpHtml.includes('help-tip-formula') && helpHtml.includes('help-tip-source'));
check('o realce do resumo é convertido em <strong> (não se veem asteriscos)', helpHtml.includes('summaryParts') && helpHtml.includes('<strong v-if="part.strong">'));
const helpJs = read('src/components/common/HelpTip/HelpTip.js');
check('a conversão do realce está no componente', /split\('\*\*'\)/.test(helpJs) && helpJs.includes('strong: index % 2 === 1'));

/* Um só painel aberto de cada vez: com 6 selos na mesma página, painéis
   acumulados tapavam o formulário. */
check('o estado do painel aberto é partilhado entre instâncias', /const activeTip = ref\(null\)/.test(helpJs));
check('o painel só está aberto se for o do estado partilhado', /open = computed\(\(\) => activeTip\.value === uniqueId\)/.test(helpJs));
check('abrir um selo fecha o anterior', /activeTip\.value = uniqueId/.test(helpJs));
check('sair do selo só fecha se ainda for o nosso', /if \(activeTip\.value === uniqueId\) activeTip\.value = null/.test(helpJs));
check('ao desmontar liberta o painel aberto', /onBeforeUnmount\(\(\) => \{[\s\S]*?activeTip\.value = null/.test(helpJs));

const helpCss = read('src/components/common/HelpTip/HelpTip.css');
check('o estilo usa tokens do tema (sem cores fixas)', !/#[0-9a-fA-F]{3,8}/.test(helpCss) && helpCss.includes('var(--accent-text)'));
check('em ecrãs estreitos o painel abre fixo por baixo (não é cortado)', /@media \(max-width: 640px\)[\s\S]*?position: fixed/.test(helpCss));

/* O desenho é injetado com `v-html`: o estilo dele TEM de ser global, senão
   fica com os valores por omissão do SVG (preto sólido) e desaparece nos temas
   escuros. Este teste trava exatamente esse defeito. */
const diagramCss = read('src/components/common/HelpTip/HelpTip.diagram.css');
const helpVue = read('src/components/common/HelpTip/HelpTip.vue');
check('o desenho tem folha de estilo própria e global', helpVue.includes('<style src="./HelpTip.diagram.css">') && !helpVue.includes('<style scoped src="./HelpTip.diagram.css">'));
check('o estilo do desenho NÃO está no ficheiro scoped', !helpCss.includes('.help-svg-body'));
check('o desenho define traço sem preenchimento (nunca uma mancha preta)', /\.help-svg-body\s*\{[^}]*fill: none/.test(diagramCss));
check('o texto do desenho é colorido por token (não fica preto por omissão)', /\.help-svg text\s*\{[^}]*fill: var\(--text-3\)/.test(diagramCss) && diagramCss.includes('.help-svg-label'));
check('o realce do desenho usa o acento do tema', diagramCss.includes('.help-svg-emphasis') && diagramCss.includes('var(--accent-text)'));
check('a folha do desenho não tem cores fixas', !/#[0-9a-fA-F]{3,8}/.test(diagramCss) && !/rgb\(/.test(diagramCss));

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} VERIFICAÇÕES FALHARAM`}`);
process.exit(failures === 0 ? 0 : 1);
