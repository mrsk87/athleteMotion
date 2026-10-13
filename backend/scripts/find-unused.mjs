/**
 * Deteta ficheiros de frontend que ninguém importa (candidatos a código morto).
 * Uso: node scripts/find-unused.mjs
 *
 * Conservador de propósito: só reporta um ficheiro quando o seu nome-base não aparece
 * em qualquer import/require dinâmico, nem em HTML (ex.: <script src>), nem no router.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const frontRoot = path.join(root, 'frontend', 'web', 'src');
const exts = new Set(['.js', '.vue', '.html', '.css', '.mjs']);

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return exts.has(path.extname(entry.name)) ? [full] : [];
  });

const files = walk(frontRoot);
const sources = files.map((f) => ({ f, text: fs.readFileSync(f, 'utf8') }));

// Entry points never reported.
const entries = new Set([
  'main.js',
  'App.vue',
  'App.js',
  'App.html',
]);
// Public index.js barrels imported by name from outside are also entries-ish; keep them.
const isEntry = (f) => entries.has(path.basename(f)) || path.basename(f) === 'index.js';

const rel = (f) => path.relative(frontRoot, f).split(path.sep).join('/');
const base = (f) => path.basename(f, path.extname(f));

const unused = [];
for (const { f } of sources) {
  if (isEntry(f)) continue;
  const name = base(f);
  // Ignore CSS (imported by side-effect with the .css extension) and html templates glued by name.
  const kind = path.extname(f);
  const referenced = sources.some(({ f: other, text }) => {
    if (other === f) return false;
    return (
      new RegExp(`['"\`][^'"\`]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`/]`).test(text) ||
      text.includes(`${name}.${kind.slice(1)}`) ||
      text.includes(`/${name}.${kind.slice(1)}`)
    );
  });
  if (!referenced) unused.push(`${rel(f)}  (${fs.readFileSync(f, 'utf8').split('\n').length} linhas)`);
}

console.log(`Ficheiros de frontend sem qualquer referência (${unused.length}):\n`);
unused.sort().forEach((u) => console.log('  ' + u));
