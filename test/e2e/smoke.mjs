// paiol — end-to-end UI smoke (real Chromium via Playwright). Verifies the things node:test
// can't: the module graph actually boots in a browser, IndexedDB persistence survives a reload,
// and the Dropbox "connect" button assembles a correct PKCE authorize URL (intercepted, never
// actually navigated, so it needs no real Dropbox).
//
// Not part of `npm test` (named *.mjs, not *.test.mjs). Run with `npm run test:e2e`.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';

const PORT = 8080;
const BASE = `http://localhost:${PORT}/`;

let chromium, server, browser, context;

async function waitForServer(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`dev server did not start at ${url}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe('paiol UI smoke', () => {
  before(async () => {
    ({ chromium } = await import('playwright'));
    // Build the single-file artifact fresh, so the "built paiol.html" test exercises current src.
    execFileSync(process.execPath, ['build.js'], { stdio: 'ignore' });
    server = spawn(process.execPath, ['tools/dev-server.js'], {
      env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
    });
    await waitForServer(BASE);
    browser = await chromium.launch();
    context = await browser.newContext();
  });

  after(async () => {
    await context?.close();
    await browser?.close();
    server?.kill();
  });

  test('boots with no console/page errors and shows the PT-BR header', async () => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('h1');
    assert.equal((await page.textContent('h1')).trim(), 'Quitutes do Paiol');
    assert.deepEqual(errors, [], `console/page errors: ${errors.join(' | ')}`);
    await page.close();
  });

  test('adds an insumo that survives a reload (IndexedDB persistence)', async () => {
    const page = await context.newPage();
    await page.goto(BASE);
    // Deterministic start: wipe the local DB, then reload into a clean app.
    await page.evaluate(() => new Promise((r) => {
      const req = indexedDB.deleteDatabase('paiol');
      req.onsuccess = req.onerror = req.onblocked = () => r();
    }));
    await page.reload({ waitUntil: 'networkidle' });

    await page.fill('[data-testid="ins-name"]', 'Farinha de trigo');
    await page.selectOption('[data-testid="ins-unit"]', 'kg');
    await page.click('[data-testid="ins-add"]');

    await page.waitForSelector('.pa-list-item');
    assert.match(await page.textContent('.pa-list'), /Farinha de trigo/);

    await page.waitForTimeout(1200); // let the debounced IndexedDB save (800ms) flush
    await page.reload({ waitUntil: 'networkidle' });

    await page.waitForSelector('.pa-list-item');
    assert.match(await page.textContent('.pa-list'), /Farinha de trigo/, 'insumo did not persist across reload');
    await page.close();
  });

  test('removing an insumo persists too', async () => {
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.pa-list-item');           // the farinha from the prior test
    await page.click('.pa-list-item button[title="Remover"]');
    await page.waitForFunction(() => !document.querySelector('.pa-list-item'));
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('.pa-list-item').count(), 0, 'removal did not persist');
    await page.close();
  });

  test('full flow: insumo → receita → produto → a suggested price appears', async () => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => new Promise((r) => {
      const req = indexedDB.deleteDatabase('paiol');
      req.onsuccess = req.onerror = req.onblocked = () => r();
    }));
    await page.reload({ waitUntil: 'networkidle' });

    // Insumo with a price.
    await page.fill('[data-testid="ins-name"]', 'Farinha');
    await page.selectOption('[data-testid="ins-unit"]', 'kg');
    await page.fill('[data-testid="ins-price"]', '5');
    await page.click('[data-testid="ins-add"]');
    await page.waitForSelector('.pa-list-item');

    // Receita using that insumo.
    await page.click('button.pa-tab:has-text("Receitas")');
    await page.fill('[data-testid="rec-name"]', 'Pão');
    await page.fill('[data-testid="rec-yield"]', '10');
    await page.selectOption('[data-testid="rec-yunit"]', 'un');
    await page.fill('[data-testid="rec-active"]', '30');
    await page.fill('[data-testid="rec-oven"]', '40');
    await page.click('[data-testid="rec-create"]');
    await page.waitForSelector('[data-testid="rec-compref"]');
    await page.selectOption('[data-testid="rec-compref"]', { label: 'Insumo: Farinha' });
    await page.fill('[data-testid="rec-compqty"]', '500');
    await page.selectOption('[data-testid="rec-compunit"]', 'g');
    await page.click('[data-testid="rec-compadd"]');
    await page.waitForSelector('.pa-sub-card .pa-list-item');

    // Produto from that receita.
    await page.click('button.pa-tab:has-text("Produtos")');
    await page.fill('[data-testid="prod-name"]', 'Pãozinho');
    await page.selectOption('[data-testid="prod-recipe"]', { label: 'Pão' });
    await page.fill('[data-testid="prod-portion"]', '1');
    await page.click('[data-testid="prod-create"]');
    await page.waitForSelector('.pa-list-item');

    // Preços: a real suggested price, no "incompleto".
    await page.click('button.pa-tab:has-text("Preços")');
    await page.waitForSelector('.pa-price');
    const priceText = await page.textContent('.pa-price');
    assert.match(priceText, /R\$\s*\d+,\d{2}/, `expected a money price, got "${priceText}"`);
    assert.doesNotMatch(await page.textContent('.pa-card'), /incompleto/, 'pricing reported incomplete');
    assert.deepEqual(errors, [], `errors during flow: ${errors.join(' | ')}`);
    await page.close();
  });

  test('Dropbox panel starts disconnected and builds a correct PKCE authorize URL', async () => {
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('button.pa-tab:has-text("Ajustes")'); // Dropbox lives under Ajustes now
    assert.match(await page.textContent('.pa-badge'), /Não conectado/);

    // Intercept the redirect to Dropbox: capture the URL, never actually navigate.
    let authUrl = null;
    await page.route('https://www.dropbox.com/**', (route) => {
      authUrl = route.request().url();
      return route.abort();
    });
    await page.click('button:has-text("Conectar ao Dropbox")');
    await page.waitForFunction(() => true); // yield a tick
    for (let i = 0; i < 40 && !authUrl; i++) await page.waitForTimeout(50);

    assert.ok(authUrl, 'connect did not navigate to the Dropbox authorize endpoint');
    const u = new URL(authUrl);
    const q = u.searchParams;
    assert.equal(u.host, 'www.dropbox.com');
    assert.equal(u.pathname, '/oauth2/authorize');
    assert.equal(q.get('client_id'), 'co3pz3u3sqx84m2');
    assert.equal(q.get('response_type'), 'code');
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.equal(q.get('token_access_type'), 'offline'); // → refresh token
    assert.equal(q.get('redirect_uri'), 'http://localhost:8080/');
    assert.ok(q.get('code_challenge'), 'missing PKCE challenge');
    assert.match(q.get('scope'), /files\.content\.write/);
    await page.close();
  });

  test('the built single-file paiol.html boots and works (deploy artifact)', async () => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${BASE}paiol.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => new Promise((r) => {
      const req = indexedDB.deleteDatabase('paiol');
      req.onsuccess = req.onerror = req.onblocked = () => r();
    }));
    await page.reload({ waitUntil: 'networkidle' });

    assert.equal((await page.textContent('h1')).trim(), 'Quitutes do Paiol');
    // Prove the inlined modules wired up: a real interaction through the bundle.
    await page.fill('[data-testid="ins-name"]', 'Açúcar');
    await page.selectOption('[data-testid="ins-unit"]', 'kg');
    await page.click('[data-testid="ins-add"]');
    await page.waitForSelector('.pa-list-item');
    assert.match(await page.textContent('.pa-list'), /Açúcar/);
    assert.deepEqual(errors, [], `console/page errors in built file: ${errors.join(' | ')}`);
    await page.close();
  });
});
