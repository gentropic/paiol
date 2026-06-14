// paiol — zero-dependency static dev server. Serves the repo root over http://localhost:8080/
// so native ES modules load directly (no build step in dev) AND the Dropbox redirect URI
// `http://localhost:8080/` resolves to index.html. Usage: `npm run dev`.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
    if (pathname === '/' || pathname.endsWith('/')) pathname += 'index.html';

    // Resolve within ROOT; reject path traversal.
    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (e) {
    if (e.code === 'ENOENT') res.writeHead(404).end('Not found');
    else { res.writeHead(500).end('Server error'); console.error(e); }
  }
}).listen(PORT, () => {
  console.log(`paiol dev → http://localhost:${PORT}/  (serving ${ROOT})`);
});
