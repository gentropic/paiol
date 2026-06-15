// paiol — single-file builder (シングルファイルデプロイ). Inlines the native ES-module graph rooted
// at src/main.js into one <script type="module"> inside index.html, emitting paiol.html.
//
// Why a bespoke 90-line inliner instead of @gcu/build: @gcu/build is the right general tool, but
// it pulls in @gcu/air + acorn, which would force a node_modules onto this otherwise zero-dep
// repo. paiol's module set is small, authored by us, and provably collision-free (the build
// asserts it), so strip-and-concat is sufficient and itself auditable.
//
// It works because our sources use only: `import { a, b } from './rel.js'`, `import * as ns`,
// `export function|class|const|let|var NAME`, and trailing `export { ... }` — no default exports,
// no `as` aliasing, no dynamic imports, no bare-specifier imports. The build asserts no top-level
// name collides across modules; if that ever breaks, it fails loudly rather than miscompiling.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSw } from './vendor/@gcu/sw/make.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, 'src/main.js');
const TEMPLATE = resolve(HERE, 'index.html');
const OUT = resolve(HERE, 'paiol.html');
const SW_OUT = resolve(HERE, 'sw.js');

// PWA shell to precache (served under /paiol/). The app is one inlined HTML file, so the "shell"
// is just that file plus the PWA sidecars; default stale-while-revalidate catches each new deploy
// by byte-diff and offers a reload. Relative URLs resolve against the SW's own /paiol/ scope.
const SW_CONFIG = {
  app: 'paiol',
  cache: 'paiol-shell-v1',
  precache: ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'],
  navFallback: './index.html',
};

const IMPORT_RE = /import\s+(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"]\s*;?/g;

/** Collect the module graph in dependency-first (post-order) order. */
async function collect(entry) {
  const order = [];
  const seen = new Set();
  async function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const src = await readFile(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (spec.startsWith('.')) await visit(resolve(dirname(file), spec));
      else throw new Error(`${rel(file)}: unexpected bare import "${spec}" — vendor it or use a relative path`);
    }
    order.push({ file, src });
  }
  await visit(entry);
  return order;
}

/** Strip import/export syntax, leaving plain declarations that share one module scope. */
function strip(src) {
  return src
    .replace(IMPORT_RE, '')                                            // drop all imports
    .replace(/^export\s+default\s+/gm, '')                             // (none expected)
    .replace(/^export\s+(?=(?:async\s+function|function|class|const|let|var)\b)/gm, '') // unwrap decls
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '');                    // drop `export { ... }`
}

/** Top-level declared names, for the collision assertion. */
function topLevelNames(src) {
  const names = [];
  const re = /^(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/gm;
  for (const m of src.matchAll(re)) names.push(m[1]);
  return names;
}

const rel = (f) => relative(HERE, f).replace(/\\/g, '/');

async function main() {
  const modules = await collect(ENTRY);

  // Assert no top-level name collides across modules (the safety net for strip-and-concat).
  const owner = new Map();
  const collisions = [];
  for (const { file, src } of modules) {
    for (const name of topLevelNames(strip(src))) {
      if (owner.has(name)) collisions.push(`"${name}" in ${rel(file)} and ${rel(owner.get(name))}`);
      else owner.set(name, file);
    }
  }
  if (collisions.length) {
    throw new Error('top-level name collisions (rename to fix):\n  ' + collisions.join('\n  '));
  }

  const banner = '/* paiol — generated single-file build. Source: github → src/. Do not edit. */';
  const bundle = [banner, ...modules.map(({ file, src }) => `// ── ${rel(file)} ──\n${strip(src).trim()}`)].join('\n\n');

  const template = await readFile(TEMPLATE, 'utf8');
  const marker = /<script\s+type="module"\s+src="\.\/src\/main\.js"\s*>\s*<\/script>/;
  if (!marker.test(template)) throw new Error('index.html: could not find the module <script> to inline');
  // NB: function replacement — a string replacement would interpret `$` sequences in the
  // bundle (e.g. `'$'` inside a regex literal becomes `$'` = "match suffix"), corrupting output.
  const html = template.replace(marker, () => `<script type="module">\n${bundle}\n</script>`);

  await writeFile(OUT, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`paiol.html written — ${modules.length} modules, ${kb} KB`);

  // Emit the service worker (config header + vendored @gcu/sw core) alongside the shell.
  await writeFile(SW_OUT, makeSw(SW_CONFIG));
  console.log(`sw.js written — cache "${SW_CONFIG.cache}", ${SW_CONFIG.precache.length} precache URLs`);
}

main().catch((e) => { console.error('build failed:', e.message); process.exit(1); });
