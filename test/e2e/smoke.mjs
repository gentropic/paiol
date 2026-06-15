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

// Navigate the bottom nav (+ segmented sub-nav) to a screen by its PT label.
const SCREEN_SECTION = {
  Insumos: 'cadastros', Receitas: 'cadastros', Produtos: 'cadastros',
  Fornadas: 'operacao', Vendas: 'operacao', Preços: 'analise', Relatórios: 'analise',
  Ajustes: 'ajustes', Início: 'inicio',
};
const SCREEN_ID = {
  Insumos: 'insumos', Receitas: 'receitas', Produtos: 'produtos', Fornadas: 'fornadas',
  Vendas: 'vendas', Preços: 'precos', Relatórios: 'relatorios', Ajustes: 'ajustes', Início: 'inicio',
};
async function goto(page, screen) {
  await page.locator(`.pa-navbtn[data-section="${SCREEN_SECTION[screen]}"]`).click();
  const seg = page.locator(`.pa-segbtn[data-screen="${SCREEN_ID[screen]}"]`);
  if (await seg.count()) await seg.click();
}

// Seed a fresh business (priced insumo → recipe with a component → product) for tests that need
// downstream data. Leaves the page on the Produtos tab.
async function seedBusiness(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => new Promise((r) => {
    const q = indexedDB.deleteDatabase('paiol');
    q.onsuccess = q.onerror = q.onblocked = () => r();
  }));
  await page.reload({ waitUntil: 'networkidle' });
  await goto(page, 'Insumos');
  await page.fill('[data-testid="ins-name"]', 'Farinha');
  await page.selectOption('[data-testid="ins-unit"]', 'kg');
  await page.fill('[data-testid="ins-price"]', '5');
  await page.click('[data-testid="ins-add"]');
  await goto(page, 'Receitas');
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
  await goto(page, 'Produtos');
  await page.fill('[data-testid="prod-name"]', 'Pãozinho');
  await page.click('[data-testid="prod-create"]');
  await page.waitForSelector('[data-testid="prodcomp-ref"]');
  await page.selectOption('[data-testid="prodcomp-ref"]', { label: 'Receita: Pão' });
  await page.fill('[data-testid="prodcomp-qty"]', '1');
  await page.click('[data-testid="prodcomp-add"]');
  await page.waitForSelector('.pa-sub-card .pa-list-item');
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
    await goto(page, 'Insumos');

    await page.fill('[data-testid="ins-name"]', 'Farinha de trigo');
    await page.selectOption('[data-testid="ins-unit"]', 'kg');
    await page.click('[data-testid="ins-add"]');

    await page.waitForSelector('.pa-list-item');
    assert.match(await page.textContent('.pa-list'), /Farinha de trigo/);

    await page.waitForTimeout(1200); // let the debounced IndexedDB save (800ms) flush
    await page.reload({ waitUntil: 'networkidle' });
    await goto(page, 'Insumos');

    await page.waitForSelector('.pa-list-item');
    assert.match(await page.textContent('.pa-list'), /Farinha de trigo/, 'insumo did not persist across reload');
    await page.close();
  });

  test('removing an insumo persists too', async () => {
    const page = await context.newPage();
    page.on('dialog', (d) => d.accept());                  // confirm-on-remove
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await goto(page, 'Insumos');
    await page.waitForSelector('.pa-list-item');           // the farinha from the prior test
    await page.click('.pa-list-item button[title="Remover"]');
    await page.waitForFunction(() => !document.querySelector('.pa-list-item'));
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: 'networkidle' });
    await goto(page, 'Insumos');
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
    await goto(page, 'Insumos');

    // Insumo with a price.
    await page.fill('[data-testid="ins-name"]', 'Farinha');
    await page.selectOption('[data-testid="ins-unit"]', 'kg');
    await page.fill('[data-testid="ins-price"]', '5');
    await page.click('[data-testid="ins-add"]');
    await page.waitForSelector('.pa-list-item');

    // Receita using that insumo.
    await goto(page, 'Receitas');
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

    // Produto from that receita (one recipe component).
    await goto(page, 'Produtos');
    await page.fill('[data-testid="prod-name"]', 'Pãozinho');
    await page.click('[data-testid="prod-create"]');
    await page.waitForSelector('[data-testid="prodcomp-ref"]');
    await page.selectOption('[data-testid="prodcomp-ref"]', { label: 'Receita: Pão' });
    await page.fill('[data-testid="prodcomp-qty"]', '1');
    await page.click('[data-testid="prodcomp-add"]');
    await page.waitForSelector('.pa-sub-card .pa-list-item');

    // Preços: a real suggested price, no "incompleto".
    await goto(page, 'Preços');
    await page.waitForSelector('.pa-price');
    const priceText = await page.textContent('.pa-price');
    assert.match(priceText, /R\$\s*\d+,\d{2}/, `expected a money price, got "${priceText}"`);
    assert.doesNotMatch(await page.textContent('.pa-card'), /incompleto/, 'pricing reported incomplete');
    assert.deepEqual(errors, [], `errors during flow: ${errors.join(' | ')}`);
    await page.close();
  });

  test('Lote 1.5: build a cesta (product of products) and it prices', async () => {
    const page = await context.newPage();
    await seedBusiness(page); // → product "Pãozinho" (priced via recipe Pão)

    await goto(page, 'Produtos');
    await page.fill('[data-testid="prod-name"]', 'Cesta');
    await page.fill('[data-testid="prod-pkg"]', '3');
    await page.click('[data-testid="prod-create"]');

    // Add Pãozinho ×2 as a sub-product of the Cesta. Scope to the Cesta card by its header strong
    // (exact) — `hasText: 'Cesta'` would also match the other card, whose dropdown lists "Cesta".
    const cestaCard = page.locator('.pa-sub-card').filter({ has: page.locator('strong', { hasText: /^Cesta$/ }) });
    await cestaCard.locator('[data-testid="prodcomp-ref"]').selectOption({ label: 'Produto: Pãozinho' });
    await cestaCard.locator('[data-testid="prodcomp-qty"]').fill('2');
    await cestaCard.locator('[data-testid="prodcomp-add"]').click();
    await cestaCard.locator('.pa-list-item', { hasText: 'Pãozinho' }).waitFor();

    // Preços: the cesta has a real price (no "sem preço").
    await goto(page, 'Preços');
    const cestaPreco = page.locator('.pa-sub-card').filter({ has: page.locator('strong', { hasText: /^Cesta$/ }) });
    await cestaPreco.locator('.pa-price').waitFor();
    const txt = await cestaPreco.textContent();
    assert.match(txt, /R\$\s*\d/);
    assert.doesNotMatch(txt, /sem preço/);
    await page.close();
  });

  test('recipe component units are constrained to the ingredient dimension', async () => {
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => new Promise((r) => {
      const q = indexedDB.deleteDatabase('paiol');
      q.onsuccess = q.onerror = q.onblocked = () => r();
    }));
    await page.reload({ waitUntil: 'networkidle' });
    await goto(page, 'Insumos');

    await page.fill('[data-testid="ins-name"]', 'Ovo');
    await page.selectOption('[data-testid="ins-unit"]', 'un');
    await page.click('[data-testid="ins-add"]');
    await page.fill('[data-testid="ins-name"]', 'Farinha');
    await page.selectOption('[data-testid="ins-unit"]', 'kg');
    await page.click('[data-testid="ins-add"]');

    await goto(page, 'Receitas');
    await page.fill('[data-testid="rec-name"]', 'Bolo');
    await page.fill('[data-testid="rec-yield"]', '1');
    await page.selectOption('[data-testid="rec-yunit"]', 'un');
    await page.click('[data-testid="rec-create"]');
    await page.waitForSelector('[data-testid="rec-compref"]');

    // Eggs are countable → only "un" offered (no weighing).
    await page.selectOption('[data-testid="rec-compref"]', { label: 'Insumo: Ovo' });
    assert.deepEqual(await page.locator('[data-testid="rec-compunit"] option').allTextContents(), ['un']);
    // Flour bought in kg → same-dimension units only.
    await page.selectOption('[data-testid="rec-compref"]', { label: 'Insumo: Farinha' });
    assert.deepEqual((await page.locator('[data-testid="rec-compunit"] option').allTextContents()).sort(), ['g', 'kg']);
    await page.close();
  });

  test('log a fornada and a venda (actuals), with running totals', async () => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await seedBusiness(page);

    // Fornada for the recipe.
    await goto(page, 'Fornadas');
    await page.selectOption('[data-testid="forn-recipe"]', { label: 'Pão' });
    await page.fill('[data-testid="forn-units"]', '9');
    await page.fill('[data-testid="forn-active"]', '35');
    await page.click('[data-testid="forn-add"]');
    await page.waitForSelector('.pa-list-item');
    assert.match(await page.textContent('.pa-list'), /Pão/);

    // Venda — price comes pre-filled from the suggested price; just register.
    await goto(page, 'Vendas');
    await page.selectOption('[data-testid="venda-product"]', { label: 'Pãozinho' });
    await page.fill('[data-testid="venda-qty"]', '3');
    await page.click('[data-testid="venda-add"]');
    await page.waitForSelector('.pa-list-item');
    assert.match(await page.textContent('.pa-list'), /Pãozinho/);
    assert.match(await page.textContent('.pa-card'), /lucro/); // running profit total

    // Survives reload (events persisted to IndexedDB).
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: 'networkidle' });
    await goto(page, 'Vendas');
    await page.waitForSelector('.pa-list-item');
    assert.match(await page.textContent('.pa-list'), /Pãozinho/);

    assert.deepEqual(errors, [], `errors during actuals flow: ${errors.join(' | ')}`);
    await page.close();
  });

  test('import merges an interchange YAML file into the app', async () => {
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => new Promise((r) => {
      const q = indexedDB.deleteDatabase('paiol');
      q.onsuccess = q.onerror = q.onblocked = () => r();
    }));
    await page.reload({ waitUntil: 'networkidle' });

    const yaml = [
      'version: 1',
      'insumos:',
      '  - nome: "Açúcar"',
      '    unidade: "kg"',
      '    preco: 4',
      'receitas:',
      '  - nome: "Calda"',
      '    rende: 10',
      '    unidade: "un"',
      '    minutosAtivos: 5',
      '    minutosForno: 0',
      '    itens:',
      '      - insumo: "Açúcar"',
      '        qtd: 200',
      '        unidade: "g"',
      'produtos:',
      '  - nome: "Calda (pote)"',
      '    receita: "Calda"',
      '    porcao: 1',
      '    embalagem: 0.5',
      '',
    ].join('\n');

    await goto(page, 'Ajustes');
    await page.setInputFiles('[data-testid="import-file"]', { name: 'dados.yaml', mimeType: 'text/yaml', buffer: Buffer.from(yaml) });
    await page.waitForFunction(() => /Importado/.test(document.querySelector('.pa-status')?.textContent || ''));

    await goto(page, 'Insumos');
    await page.waitForSelector('.pa-list-item');
    assert.match(await page.textContent('.pa-list'), /Açúcar/);

    await goto(page, 'Preços');
    await page.waitForSelector('.pa-price');
    assert.match(await page.textContent('.pa-price'), /R\$\s*\d/);
    await page.close();
  });

  test('imports without prices and flags the missing ones by name', async () => {
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => new Promise((r) => {
      const q = indexedDB.deleteDatabase('paiol');
      q.onsuccess = q.onerror = q.onblocked = () => r();
    }));
    await page.reload({ waitUntil: 'networkidle' });

    const yaml = [
      'version: 1',
      'insumos:',
      '  - nome: "Manteiga"',     // no preco on purpose
      '    unidade: "kg"',
      'receitas:',
      '  - nome: "Massa"',
      '    rende: 10',
      '    unidade: "un"',
      '    minutosAtivos: 5',
      '    minutosForno: 0',
      '    itens:',
      '      - insumo: "Manteiga"',
      '        qtd: 100',
      '        unidade: "g"',
      'produtos:',
      '  - nome: "Biscoito"',
      '    receita: "Massa"',
      '    porcao: 1',
      '    embalagem: 0',
      '',
    ].join('\n');

    await goto(page, 'Ajustes');
    await page.setInputFiles('[data-testid="import-file"]', { name: 'd.yaml', mimeType: 'text/yaml', buffer: Buffer.from(yaml) });
    await page.waitForFunction(() => /Importado/.test(document.querySelector('.pa-status')?.textContent || ''));

    // Insumos: count banner.
    await goto(page, 'Insumos');
    await page.waitForSelector('.pa-status.pa-bad');
    assert.match(await page.textContent('.pa-status.pa-bad'), /1 insumo\(s\) sem preço/);

    // Preços: the product is flagged and the missing ingredient is named.
    await goto(page, 'Preços');
    await page.waitForSelector('.pa-sub-card');
    assert.match(await page.textContent('.pa-card'), /Defina o preço de: Manteiga/);
    await page.close();
  });

  test('Lote 1: search filters the insumos list', async () => {
    const page = await context.newPage();
    await seedBusiness(page); // Farinha exists
    await goto(page, 'Insumos');
    await page.waitForSelector('[data-testid="ins-search"]');
    await page.fill('[data-testid="ins-search"]', 'zzznao');
    await page.waitForFunction(() => {
      const li = [...document.querySelectorAll('.pa-list-item')].find((x) => /Farinha/.test(x.textContent));
      return li && li.style.display === 'none';
    });
    await page.fill('[data-testid="ins-search"]', 'fari'); // accent/case-insensitive
    await page.waitForFunction(() => {
      const li = [...document.querySelectorAll('.pa-list-item')].find((x) => /Farinha/.test(x.textContent));
      return li && li.style.display !== 'none';
    });
    await page.close();
  });

  test('Lote 1: edit an insumo name and it persists', async () => {
    const page = await context.newPage();
    await seedBusiness(page);
    await goto(page, 'Insumos');
    await page.click('.pa-list-item button[title="Editar"]');
    await page.fill('[data-testid="ins-edit-name"]', 'Farinha especial');
    await page.click('[data-testid="ins-edit-save"]');
    await page.waitForFunction(() => /Farinha especial/.test(document.querySelector('.pa-list')?.textContent || ''));
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: 'networkidle' });
    await goto(page, 'Insumos');
    assert.match(await page.textContent('.pa-list'), /Farinha especial/);
    await page.close();
  });

  test('Lote 1: Preços shows profit per unit and per hour', async () => {
    const page = await context.newPage();
    await seedBusiness(page);
    await goto(page, 'Preços');
    await page.waitForSelector('.pa-price');
    const txt = await page.textContent('.pa-card');
    assert.match(txt, /Lucro por unidade/);
    assert.match(txt, /Lucro por hora/);
    await page.close();
  });

  test('Lote 1: log a venda with a chosen past date', async () => {
    const page = await context.newPage();
    await seedBusiness(page);
    await goto(page, 'Vendas');
    await page.fill('[data-testid="venda-date"]', '2026-05-15');
    await page.fill('[data-testid="venda-qty"]', '1');
    await page.click('[data-testid="venda-add"]');
    await page.waitForSelector('.pa-list-item');
    assert.match(await page.textContent('.pa-list'), /15\/05\/2026/);
    await page.close();
  });

  test('Lote 1: edit a receita to add an observação', async () => {
    const page = await context.newPage();
    await seedBusiness(page);
    await goto(page, 'Receitas');
    await page.click('[data-testid="rec-edit"]');
    await page.fill('[data-testid="rec-edit-notes"]', 'Misturar bem e assar 30min');
    await page.click('[data-testid="rec-edit-save"]');
    await page.waitForSelector('.pa-obs');
    assert.match(await page.textContent('.pa-obs'), /Misturar bem/);
    await page.close();
  });

  test('Lote 2: Relatórios shows the month P&L, per-product, and a chart', async () => {
    const page = await context.newPage();
    await seedBusiness(page); // priceable product "Pãozinho"

    // Log a sale today (default date → current month, which Relatórios defaults to).
    await goto(page, 'Vendas');
    await page.fill('[data-testid="venda-qty"]', '2');
    await page.click('[data-testid="venda-add"]');
    await page.waitForSelector('.pa-list-item');

    await goto(page, 'Relatórios');
    await page.waitForSelector('.pa-kv');
    const txt = await page.textContent('.pa-card');
    assert.match(txt, /Receita/);
    assert.match(txt, /Lucro/);
    assert.match(txt, /Pãozinho/);                       // per-product row
    assert.equal(await page.locator('svg.pa-chart').count(), 1); // trend chart present
    await page.close();
  });

  test('nav: bottom tab bar + Início dashboard with quick actions', async () => {
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => new Promise((r) => {
      const q = indexedDB.deleteDatabase('paiol');
      q.onsuccess = q.onerror = q.onblocked = () => r();
    }));
    await page.reload({ waitUntil: 'networkidle' });

    await page.waitForSelector('.pa-bottomnav');
    assert.match(await page.textContent('.pa-card'), /Este mês/);        // lands on Início dashboard

    await page.click('[data-testid="home-venda"]');                       // quick action → Operação/Vendas
    await page.waitForSelector('.pa-navbtn[data-section="operacao"].active');

    await page.click('.pa-navbtn[data-section="cadastros"]');             // bottom nav → Cadastro
    await page.waitForSelector('[data-testid="ins-add"]');
    assert.equal(await page.locator('.pa-segbtn[data-screen="receitas"]').count(), 1); // segmented sub-nav

    // Add an insumo with NO price → "sem preço" (guards the parseNum '' → null fix), then the
    // dashboard surfaces the alert.
    await page.fill('[data-testid="ins-name"]', 'Baunilha');
    await page.selectOption('[data-testid="ins-unit"]', 'un');
    await page.click('[data-testid="ins-add"]');
    await page.waitForSelector('.pa-status.pa-bad');                       // Insumos "sem preço" banner
    await page.click('.pa-navbtn[data-section="inicio"]');
    assert.match(await page.textContent('section'), /sem preço/);          // dashboard alert
    await page.close();
  });

  test('Dropbox panel starts disconnected and builds a correct PKCE authorize URL', async () => {
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await goto(page, 'Ajustes'); // Dropbox lives under Ajustes now
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
    await goto(page, 'Insumos');
    await page.fill('[data-testid="ins-name"]', 'Açúcar');
    await page.selectOption('[data-testid="ins-unit"]', 'kg');
    await page.click('[data-testid="ins-add"]');
    await page.waitForSelector('.pa-list-item');
    assert.match(await page.textContent('.pa-list'), /Açúcar/);
    assert.deepEqual(errors, [], `console/page errors in built file: ${errors.join(' | ')}`);
    await page.close();
  });
});
