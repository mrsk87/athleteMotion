/**
 * Verificação automática do sistema de temas e da estrutura do layout.
 *
 * Executar com:  npm run verify:theme
 *
 * Garante, sem navegador e sem dependências, que:
 *  1. Existem os três temas (claro, escuro e sóbrio) com o conjunto completo de tokens.
 *  2. O tema sóbrio não tem brilhos (`--glow-*` transparentes e `text-shadow` desligado).
 *  3. Nenhum CSS de componente escreve cores fixas fora de `@media print`.
 *  4. O gestor de temas aplica `data-theme`, persiste a escolha e recusa temas inválidos.
 *  5. O tema é aplicado antes do primeiro desenho (`public/index.html`).
 *  6. A grelha de trabalho tem coluna principal + barra lateral, e os painéis que
 *     estavam soltos (leituras em direto, barra de ações) têm estilo próprio.
 *  7. O gráfico de ângulos lê tokens do tema em vez de cores fixas.
 *  8. O HUD sobre o vídeo mantém as etiquetas dentro do vídeo, alinhadas pelo topo e sem
 *     esticar as vizinhas, mesmo quando uma delas quebra em várias linhas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
console.log('\n== 1. Os três temas e os seus tokens ==');
const theme = read('src/styles/theme.css');

const THEME_IDS = ['light', 'dark', 'sober'];
const REQUIRED_TOKENS = [
  '--bg-app', '--bg-surface', '--bg-surface-2', '--bg-inset', '--bg-elevated', '--bg-hover', '--bg-stage',
  '--border-subtle', '--border', '--border-strong',
  '--text-1', '--text-2', '--text-3', '--text-inverse',
  '--accent', '--accent-text', '--accent-hover', '--accent-contrast', '--accent-border', '--accent-soft',
  '--ok', '--ok-text', '--warn', '--warn-text', '--danger', '--danger-text', '--info', '--info-text',
  '--accent-rgb', '--ok-rgb', '--warn-rgb', '--danger-rgb', '--info-rgb', '--scrim-rgb', '--tint-rgb',
  '--glow-accent', '--glow-ok', '--glow-warn', '--glow-danger', '--glow-info', '--glow-text',
  '--shadow-1', '--shadow-2', '--shadow-3', '--focus-ring', '--control-knob',
  '--chart-bg', '--chart-grid', '--chart-axis', '--chart-band-fill', '--chart-playhead', '--chart-threshold',
  '--chart-series-knee', '--chart-series-torso', '--chart-series-arm', '--chart-series-head',
];

/** Extrai o bloco de declarações de um seletor de tema. */
function block(source, selector) {
  const start = source.indexOf(selector);
  if (start < 0) return '';
  const open = source.indexOf('{', start);
  const close = source.indexOf('\n}', open);
  return source.slice(open, close);
}

check('o tema claro está definido', /\[data-theme='light'\]\s*\{/.test(theme));
check('o tema escuro está definido', /\[data-theme='dark'\]\s*\{/.test(theme));
check('o tema sóbrio está definido', /\[data-theme='sober'\]\s*\{/.test(theme));

const blocks = { dark: block(theme, "[data-theme='dark']"), light: block(theme, "[data-theme='light']"), sober: block(theme, "[data-theme='sober']") };
THEME_IDS.forEach((id) => {
  const missing = REQUIRED_TOKENS.filter((token) => !blocks[id].includes(`${token}:`));
  check(`tema ${id} define todos os ${REQUIRED_TOKENS.length} tokens`, missing.length === 0, missing.slice(0, 5).join(', '));
});

check('o tema claro pede esquema de cor nativo claro', blocks.light.includes('color-scheme: light'));
check('os temas escuros pedem esquema de cor nativo escuro', blocks.dark.includes('color-scheme: dark') && blocks.sober.includes('color-scheme: dark'));
check('o tema sóbrio não usa preto puro como fundo', !blocks.sober.includes('--bg-app: #000') && !/--bg-app:\s*#000000/.test(blocks.sober), blocks.sober.match(/--bg-app:[^;]+/)?.[0]);

/* ------------------------------------------------------------------ */
console.log('\n== 2. O tema sóbrio não tem brilhos ==');
const glowTokens = ['--glow-accent', '--glow-ok', '--glow-warn', '--glow-danger', '--glow-info', '--glow-text'];
glowTokens.forEach((token) => {
  check(`${token} fica transparente no sóbrio`, blocks.sober.includes(`${token}: transparent`));
});
check('o brilho de texto é desligado no sóbrio', /\[data-theme='sober'\][\s\S]{0,80}text-shadow: none\s*!important/.test(theme));
check('o tema escuro mantém brilho (o sóbrio é a exceção)', !blocks.dark.includes('--glow-accent: transparent'));

/* ------------------------------------------------------------------ */
console.log('\n== 3. Nenhuma cor fixa nos CSS dos componentes (fora de impressão) ==');
function cssFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    return entry.name.endsWith('.css') ? [full] : [];
  });
}

/** Remove os blocos `@media print` (papel é branco por definição). */
const withoutPrint = (css) => css.replace(/@media print\s*\{[\s\S]*?\n\}/g, '');

const componentCss = cssFiles(path.join(root, 'src')).filter((file) => !file.endsWith(path.join('styles', 'theme.css')));
const literals = [];
componentCss.forEach((file) => {
  withoutPrint(fs.readFileSync(file, 'utf8'))
    .split('\n')
    .forEach((line, index) => {
      const colors = line.match(/#[0-9a-fA-F]{3,8}\b|(?<!var\()rgba?\((?!var\()/g);
      if (colors) literals.push(`${path.relative(root, file)}:${index + 1}`);
    });
});
check(`nenhuma cor fixa em ${componentCss.length} ficheiros CSS de componentes`, literals.length === 0, literals.slice(0, 4).join(' '));

const printKept = componentCss.some((file) => fs.readFileSync(file, 'utf8').includes('@media print'));
check('os estilos de impressão continuam a preto sobre branco', printKept);

/* ------------------------------------------------------------------ */
console.log('\n== 4. O gestor de temas aplica, persiste e valida ==');
const storage = new Map();
const attributes = {};
globalThis.window = {
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
  },
  matchMedia: () => ({ matches: false }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
};
globalThis.document = {
  documentElement: { setAttribute: (name, value) => { attributes[name] = value; } },
  querySelector: () => null,
};

const { themeManager, THEMES, DEFAULT_THEME } = await import('../src/services/themeManager.js');

check('existem exatamente 3 temas', THEMES.length === 3, THEMES.map((item) => item.id).join(', '));
check('os identificadores são light/dark/sober', THEME_IDS.every((id) => THEMES.some((item) => item.id === id)));
check('cada tema tem rótulo, ícone e descrição', THEMES.every((item) => item.label && item.icon && item.description));

themeManager.init();
check('a inicialização aplica data-theme no <html>', attributes['data-theme'] === DEFAULT_THEME, attributes['data-theme']);
check('tema inválido é recusado', themeManager.setTheme('neon') === false);

check('escolher o tema claro aplica e persiste', themeManager.setTheme('light') === true && attributes['data-theme'] === 'light' && storage.get('athleteMotion.theme') === 'light');
check('escolher o tema sóbrio aplica e persiste', themeManager.setTheme('sober') === true && attributes['data-theme'] === 'sober' && storage.get('athleteMotion.theme') === 'sober');

let notified = null;
const unsubscribe = themeManager.onChange((id) => { notified = id; });
themeManager.setTheme('dark');
check('os interessados são avisados da mudança', notified === 'dark', String(notified));
unsubscribe();
themeManager.setTheme('light');
check('quem cancela a subscrição deixa de ser avisado', notified === 'dark');

themeManager.setTheme('sober');
check(
  'sem DOM o gráfico usa a paleta de recurso do tema',
  themeManager.token('--chart-bg', '#fallback') === '#232833',
  themeManager.token('--chart-bg', '#fallback'),
);
check('um token desconhecido devolve o valor de recurso pedido', themeManager.token('--token-inexistente', '#fallback') === '#fallback');
check('todos os tokens do gráfico têm recurso em todos os temas', ['light', 'dark', 'sober'].every((id) => {
  themeManager.setTheme(id);
  return ['--chart-bg', '--chart-grid', '--chart-axis', '--chart-band-fill', '--chart-playhead', '--chart-threshold', '--chart-series-knee', '--chart-series-torso', '--chart-series-arm', '--chart-series-head', '--text-2']
    .every((name) => themeManager.token(name, '') !== '');
}));

/* ------------------------------------------------------------------ */
console.log('\n== 5. O tema entra antes do primeiro desenho ==');
const indexHtml = read('public/index.html');
check('o <html> já sai com data-theme', /<html[^>]*data-theme="(dark|light|sober)"/.test(indexHtml));
check('há script de arranque que aplica o tema guardado', indexHtml.includes("athleteMotion.theme") && indexHtml.includes('document.documentElement.setAttribute'));
check('o tema guardado é lido antes do bundle', indexHtml.indexOf('athleteMotion.theme') < indexHtml.indexOf('<div id="app">'));
check('a cor da barra do navegador acompanha o tema', indexHtml.includes('name="theme-color"'));

/* ------------------------------------------------------------------ */
console.log('\n== 6. Estrutura do layout do módulo de vídeo ==');
const template = read('src/components/LiveCameraCapture/LiveCameraCapture.html');
const stripComments = (source) => source.replace(/<!--[\s\S]*?-->/g, '');
const templateNoComments = stripComments(template);

const layoutIndex = templateNoComments.indexOf('class="analysis-layout"');
const mainIndex = templateNoComments.indexOf('class="analysis-main"');
const railIndex = templateNoComments.indexOf('<aside class="analysis-rail"');
const metricsIndex = templateNoComments.indexOf('class="live-metrics-panel"');
const layoutEnd = templateNoComments.lastIndexOf('</aside>');

const insideLayout = templateNoComments.slice(layoutIndex, layoutEnd);

check('existe a grelha de trabalho (.analysis-layout)', layoutIndex > 0);
check('a coluna principal vem antes da barra lateral', mainIndex > 0 && railIndex > mainIndex);
check('as leituras em direto estão dentro da barra lateral', metricsIndex > railIndex && metricsIndex < layoutEnd);
check('a grelha fecha depois da barra lateral', layoutEnd > metricsIndex);
check('o palco de vídeo está na coluna principal', insideLayout.includes('class="viewport-wrapper"') && insideLayout.includes('class="analysis-main"'));
check('a grelha contém o vídeo, a análise e o painel lateral', ['viewport-wrapper', 'analysis-main', 'video-full-analysis-card', 'live-metrics-panel'].every((cls) => insideLayout.includes(cls)));
check(
  'a grelha NÃO engole a página inteira (o defeito original)',
  !insideLayout.includes('class="clinical-corrections-panel"') && !insideLayout.includes('class="bottom-actions"'),
);
check('o painel clínico vem depois da grelha', templateNoComments.indexOf('class="clinical-corrections-panel"') > layoutEnd);
check('a barra de ações vem depois do painel clínico', templateNoComments.indexOf('class="bottom-actions"') > templateNoComments.indexOf('class="clinical-corrections-panel"'));

const moduleCss = read('src/components/LiveCameraCapture/LiveCameraCapture.css');
check('a grelha é definida no CSS', /\.analysis-layout\s*\{[\s\S]*?grid-template-columns/.test(moduleCss));
check('as leituras em direto têm estilo próprio (não estavam estilizadas)', moduleCss.includes('.live-metrics-panel {'));
check('a barra de ações inferior tem estilo próprio', moduleCss.includes('.bottom-actions {') && moduleCss.includes('.btn-action {'));
check('os botões principais usam tokens', moduleCss.includes('.primary-btn {') && moduleCss.includes('.snapshot-btn {') && moduleCss.includes('.finish-btn {'));
check('a grelha responde a ecrãs estreitos', /@media \(max-width: 1100px\)[\s\S]*?analysis-layout[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/.test(moduleCss));
check('o cartão não tem mais de uma folha de largura fixa', /\.live-capture-card\s*\{[\s\S]*?max-width: 1560px/.test(moduleCss));

const deadSelectors = ['.metrics-sidebar', '.bottom-actions-bar', '.toast-banner', '.btn-complete', '.btn-snapshot', '.metric-card {'];
const stillThere = deadSelectors.filter((selector) => moduleCss.includes(selector));
check('o CSS morto do módulo foi removido', stillThere.length === 0, stillThere.join(' '));

check('a configuração da leitura está agrupada com rótulos', (templateNoComments.match(/control-group-title/g) || []).length >= 4);
check('as ferramentas avançadas podem ser recolhidas', templateNoComments.includes('showAdvancedTools') && moduleCss.includes('.btn-tools-toggle'));

/* ------------------------------------------------------------------ */
console.log('\n== 6b. O HUD sobre o vídeo aguenta várias linhas sem sair do sítio ==');
/*
 * O defeito que isto trava: as etiquetas do HUD têm larguras muito diferentes ("-- RPM" vs
 * "⚠️ CORPO INCOMPLETO (tornozelo, pé)"). Com o alinhamento por omissão (`stretch`), a etiqueta
 * que quebrava em duas linhas ESTICAVA as vizinhas da mesma linha até à sua altura; e uma
 * etiqueta mais larga que o vídeo era cortada pelo `overflow: hidden` do contentor, porque a
 * faixa não tinha limite de largura.
 */
const hudCss = read('src/components/LiveCameraCapture/styles/camera-hud.css');
const hudOverlayRule = hudCss.slice(hudCss.indexOf('.camera-hud-overlay {'), hudCss.indexOf('.hud-item {'));
const hudItemRule = hudCss.slice(hudCss.indexOf('.hud-item {'), hudCss.indexOf('.hud-active {'));

check('a faixa do HUD tem largura limitada (left E right) — nada pode ser cortado pelo vídeo',
  /left: 10px/.test(hudOverlayRule) && /right: 10px/.test(hudOverlayRule));
check('as etiquetas alinham pelo TOPO, cada uma com a altura do seu próprio texto (sem esticar)',
  /align-items: flex-start/.test(hudOverlayRule));
check('as linhas da faixa são separadas por gap (não ficam coladas)',
  /row-gap: 6px/.test(hudOverlayRule) && /column-gap: 6px/.test(hudOverlayRule));
check('a faixa nunca excede a altura do vídeo', /max-height: calc\(100% - 20px\)/.test(hudOverlayRule));
check('a etiqueta quebra o texto dentro da própria caixa',
  /white-space: normal/.test(hudItemRule) && /overflow-wrap: anywhere/.test(hudItemRule));
check('a etiqueta nunca é mais larga que a faixa', /max-width: 100%/.test(hudItemRule));
check('o emoji e o valor ficam na mesma linha da etiqueta',
  /display: inline-flex/.test(hudItemRule) && /align-items: center/.test(hudItemRule) && /line-height: 1\.35/.test(hudItemRule));
check('a caixa não pode encolher abaixo do texto (o `0` do `flex` impede a etiqueta de ser esmagada)',
  /flex: 0 1 auto/.test(hudItemRule) && /min-width: 0/.test(hudItemRule));
check('a etiqueta de corpo incompleto (a lista longa) ocupa a sua própria linha',
  /\.hud-fullbody-warn\s*\{[\s\S]*?flex: 1 1 100%/.test(hudCss));
check('em ecrãs estreitos o HUD diminui em vez de transbordar',
  /@media \(max-width: 640px\)[\s\S]*?\.hud-item\s*\{[\s\S]*?font-size: 10px/.test(hudCss));
/*
 * O limite da faixa do HUD só faz sentido se a faixa estiver confinada ao palco do vídeo.
 * A implementação mantém o HUD como IRMÃO do contentor do vídeo, dentro do mesmo
 * `.viewport-wrapper` (que é quem define a caixa do palco e é `position: relative`), em vez de o
 * meter dentro do contentor: assim o HUD pode continuar a sair do vídeo nos modos "Fora (Topo/Base)"
 * e só o modo sobreposto é posicionado dentro da caixa do palco. O que se prova aqui é essa
 * contenção — a faixa não pode ter um pai posicionado fora do palco.
 */
const wrapperRule = hudCss.slice(hudCss.indexOf('.viewport-wrapper {'), hudCss.indexOf('.viewport-wrapper.hud-pos-top'));
check('o palco do vídeo é o pai posicionado do HUD (`.viewport-wrapper` com `position: relative`)',
  /position: relative/.test(wrapperRule));
check('o HUD vive dentro do palco do vídeo (o contentor do vídeo é irmão dentro do mesmo wrapper)',
  templateNoComments.indexOf('class="viewport-wrapper"') > 0 &&
    templateNoComments.indexOf('class="camera-hud-container"') > templateNoComments.indexOf('class="viewport-wrapper"') &&
    templateNoComments.indexOf('class="video-canvas-container"') > templateNoComments.indexOf('class="viewport-wrapper"') &&
    templateNoComments.indexOf('class="camera-hud-container"') <
      templateNoComments.indexOf('class="bottom-actions"'));
check('o contentor do vídeo recorta o que fica fora do palco (overflow: hidden)',
  /\.video-canvas-container\s*\{[\s\S]*?overflow: hidden/.test(moduleCss));

/* ------------------------------------------------------------------ */
console.log('\n== 7. O gráfico segue o tema e o cabeçalho oferece os 3 temas ==');
const chart = read('src/components/LiveCameraCapture/modules/anglesTimelineChart.js');
// A extensão `.js` é aceite (os módulos verificados fora do navegador têm de a declarar).
check(
  'o gráfico importa o gestor de temas',
  /from '\.\.\/\.\.\/\.\.\/services\/themeManager(\.js)?'/.test(chart)
);
check('o gráfico não tem cores fixas', !/#[0-9a-fA-F]{6}/.test(chart), (chart.match(/#[0-9a-fA-F]{6}/g) || []).slice(0, 3).join(' '));
check('o gráfico lê os tokens de série', ['--chart-series-knee', '--chart-series-torso', '--chart-series-arm', '--chart-series-head'].every((token) => chart.includes(token)));
check('o fundo do gráfico vem do tema', chart.includes("token('--chart-bg'"));

const appHtml = read('src/App.html');
check('o cabeçalho mostra um botão por tema', appHtml.includes('v-for="option in themes"') && appHtml.includes('class="theme-option"'));
check('o botão de tema anuncia o estado (aria-pressed)', appHtml.includes('aria-pressed'));
const appJs = read('src/App.js');
check('o componente raiz liga o seletor ao gestor de temas', appJs.includes('themeManager.setTheme') && appJs.includes('themeManager.onChange'));

/* ------------------------------------------------------------------ */
console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} VERIFICAÇÕES FALHARAM`}`);
process.exit(failures === 0 ? 0 : 1);
