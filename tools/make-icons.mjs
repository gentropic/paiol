// Generate paiol's PWA icons by rasterizing one on-brand SVG (cream cupcake on terracotta) at the
// sizes iOS/Android want. Run once and commit the PNGs: `node tools/make-icons.mjs`. Playwright is
// a devDependency (the app stays zero-dep). Full-bleed terracotta background → opaque (iOS) and
// maskable (Android) at once; the glyph sits inside the central safe zone.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#9a4a2f"/>
  <g fill="#fbf0e6">
    <path d="M178 298 H334 L312 418 Q310 430 298 430 H214 Q202 430 200 418 Z"/>
    <circle cx="208" cy="278" r="46"/>
    <circle cx="304" cy="278" r="46"/>
    <circle cx="256" cy="252" r="58"/>
  </g>
  <circle cx="256" cy="196" r="21" fill="#c0563a"/>
  <g stroke="#9a4a2f" stroke-width="7" stroke-linecap="round" opacity="0.45">
    <line x1="232" y1="312" x2="223" y2="416"/>
    <line x1="256" y1="312" x2="256" y2="420"/>
    <line x1="280" y1="312" x2="289" y2="416"/>
  </g>
</svg>`;

const SIZES = [[512, 'icon-512.png'], [192, 'icon-192.png'], [180, 'apple-touch-icon.png']];

const browser = await chromium.launch();
const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
for (const [size, name] of SIZES) {
  await page.setContent(`<!doctype html><html><body style="margin:0;line-height:0">${svg(size)}</body></html>`);
  const png = await page.locator('svg').screenshot({ type: 'png' });
  writeFileSync(resolve(ROOT, name), png);
  console.log(`wrote ${name} (${size}×${size})`);
}
await browser.close();
