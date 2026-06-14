// paiol — build + stage for deploy. Builds the single-file app and copies it into the GitHub
// Pages repo as paiol/index.html (so it serves at gentropic.org/paiol/, matching the registered
// OAuth redirect). Does NOT git-commit/push — review and push from the Pages repo yourself.
//
// Usage: node tools/deploy.mjs [destDir]   (default: ../gentropic.github.io/paiol)

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = resolve(ROOT, process.argv[2] || '../gentropic.github.io/paiol');

execFileSync(process.execPath, ['build.js'], { cwd: ROOT, stdio: 'inherit' });
mkdirSync(dest, { recursive: true });
const out = resolve(dest, 'index.html');
copyFileSync(resolve(ROOT, 'paiol.html'), out);

console.log(`\nCopied → ${out}`);
console.log('Next: in the Pages repo →  git add paiol/index.html && git commit && git push');
console.log('Live at https://gentropic.org/paiol/ after Pages rebuilds (~1 min).');
