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

// Add an insumo via the "+ Novo" bottom sheet. (Must be on the Insumos screen.)
async function addInsumo(page, name, unit, price) {
  await page.click('[data-testid="ins-new"]');
  await page.waitForSelector('[data-testid="ins-save"]');
  await page.fill('[data-testid="ins-name"]', name);
  if (unit) await page.selectOption('[data-testid="ins-unit"]', unit);
  if (price != null) await page.fill('[data-testid="ins-price"]', String(price));
  await page.click('[data-testid="ins-save"]');
  await page.waitForSelector('.pa-backdrop', { state: 'detached' });
}

// Add a receita via the "+ Novo" bottom sheet, optionally with one component. (Must be on Receitas.)
async function addReceita(page, { name, yield: y, yunit, active, oven, comp } = {}) {
  await page.click('[data-testid="rec-new"]');
  await page.waitForSelector('[data-testid="rec-save"]');
  await page.fill('[data-testid="rec-name"]', name);
  if (y != null) await page.fill('[data-testid="rec-yield"]', String(y));
  if (yunit) await page.selectOption('[data-testid="rec-yunit"]', yunit);
  if (active != null) await page.fill('[data-testid="rec-active"]', String(active));
  if (oven != null) await page.fill('[data-testid="rec-oven"]', String(oven));
  if (comp) {
    await page.selectOption('[data-testid="rec-compref"]', { label: comp.ref });
    await page.fill('[data-testid="rec-compqty"]', String(comp.qty));
    if (comp.unit) await page.selectOption('[data-testid="rec-compunit"]', comp.unit);
    await page.click('[data-testid="rec-compadd"]');
    await page.waitForSelector('.pa-sheet .pa-list-item');
  }
  await page.click('[data-testid="rec-save"]');
  await page.waitForSelector('.pa-backdrop', { state: 'detached' });
}

// Add a produto via the "+ Novo" bottom sheet, optionally with one component. (Must be on Produtos.)
async function addProduto(page, { name, pkg, pkgDesc, comp } = {}) {
  await page.click('[data-testid="prod-new"]');
  await page.waitForSelector('[data-testid="prod-save"]');
  await page.fill('[data-testid="prod-name"]', name);
  if (pkg != null) await page.fill('[data-testid="prod-pkg"]', String(pkg));
  if (pkgDesc) await page.fill('[data-testid="prod-pkgdesc"]', pkgDesc);
  if (comp) {
    await page.selectOption('[data-testid="prodcomp-ref"]', { label: comp.ref });
    await page.fill('[data-testid="prodcomp-qty"]', String(comp.qty));
    await page.click('[data-testid="prodcomp-add"]');
    await page.waitForSelector('.pa-sheet .pa-list-item');
  }
  await page.click('[data-testid="prod-save"]');
  await page.waitForSelector('.pa-backdrop', { state: 'detached' });
}

// Log a fornada via the "+ Registrar" bottom sheet. (Must be on the Fornadas screen.)
async function addFornada(page, { recipe, units, active, oven, date } = {}) {
  await page.click('[data-testid="forn-new"]');
  await page.waitForSelector('[data-testid="forn-add"]');
  if (recipe) await page.selectOption('[data-testid="forn-recipe"]', { label: recipe });
  if (date) await page.fill('[data-testid="forn-date"]', date);
  if (units != null) await page.fill('[data-testid="forn-units"]', String(units));
  if (active != null) await page.fill('[data-testid="forn-active"]', String(active));
  if (oven != null) await page.fill('[data-testid="forn-oven"]', String(oven));
  await page.click('[data-testid="forn-add"]');
  await page.waitForSelector('.pa-backdrop', { state: 'detached' });
}

// Log a venda via the "+ Registrar" bottom sheet. (Must be on the Vendas screen.)
async function addVenda(page, { product, date, qty, price, canal } = {}) {
  await page.click('[data-testid="venda-new"]');
  await page.waitForSelector('[data-testid="venda-add"]');
  if (product) await page.selectOption('[data-testid="venda-product"]', { label: product });
  if (date) await page.fill('[data-testid="venda-date"]', date);
  if (qty != null) await page.fill('[data-testid="venda-qty"]', String(qty));
  if (price != null) await page.fill('[data-testid="venda-price"]', String(price));
  if (canal) await page.fill('[data-testid="venda-canal"]', canal);
  await page.click('[data-testid="venda-add"]');
  await page.waitForSelector('.pa-backdrop', { state: 'detached' });
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
  await addInsumo(page, 'Farinha', 'kg', '5');
  await goto(page, 'Receitas');
  await addReceita(page, { name: 'Pão', yield: 10, yunit: 'un', active: 30, oven: 40, comp: { ref: 'Insumo: Farinha', qty: 500, unit: 'g' } });
  await goto(page, 'Produtos');
  await addProduto(page, { name: 'Pãozinho', comp: { ref: 'Receita: Pão', qty: 1 } });
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
    await addInsumo(page, 'Farinha de trigo', 'kg');

    await page.waitForSelector('.pa-row-item');
    assert.match(await page.textContent('.pa-list'), /Farinha de trigo/);

    await page.waitForTimeout(1200); // let the debounced IndexedDB save (800ms) flush
    await page.reload({ waitUntil: 'networkidle' });
    await goto(page, 'Insumos');

    await page.waitForSelector('.pa-row-item');
    assert.match(await page.textContent('.pa-list'), /Farinha de trigo/, 'insumo did not persist across reload');
    await page.close();
  });

  test('removing an insumo (via edit sheet + confirm) persists', async () => {
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await goto(page, 'Insumos');
    await page.locator('.pa-row-item', { hasText: 'Farinha de trigo' }).click(); // from the prior test
    await page.click('[data-testid="ins-delete"]');
    await page.click('[data-testid="confirm-yes"]');       // in-app confirmation
    await page.waitForFunction(() => !document.querySelector('.pa-row-item'));
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: 'networkidle' });
    await goto(page, 'Insumos');
    assert.equal(await page.locator('.pa-row-item').count(), 0, 'removal did not persist');
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
    await addInsumo(page, 'Farinha', 'kg', '5');
    await page.waitForSelector('.pa-row-item');

    // Receita using that insumo.
    await goto(page, 'Receitas');
    await addReceita(page, { name: 'Pão', yield: 10, yunit: 'un', active: 30, oven: 40, comp: { ref: 'Insumo: Farinha', qty: 500, unit: 'g' } });

    // Produto from that receita (one recipe component).
    await goto(page, 'Produtos');
    await addProduto(page, { name: 'Pãozinho', comp: { ref: 'Receita: Pão', qty: 1 } });

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

    // Build a Cesta = Pãozinho ×2 + R$3 packaging, all in one sheet.
    await goto(page, 'Produtos');
    await addProduto(page, { name: 'Cesta', pkg: 3, comp: { ref: 'Produto: Pãozinho', qty: 2 } });

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
    await addInsumo(page, 'Ovo', 'un');
    await addInsumo(page, 'Farinha', 'kg');

    await goto(page, 'Receitas');
    await page.click('[data-testid="rec-new"]');
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
    await addFornada(page, { recipe: 'Pão', units: 9, active: 35 });
    await page.waitForSelector('.pa-list-item');
    assert.match(await page.textContent('.pa-list'), /Pão/);

    // Venda — price comes pre-filled from the suggested price; just register.
    await goto(page, 'Vendas');
    await addVenda(page, { product: 'Pãozinho', qty: 3 });
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
    await page.waitForSelector('.pa-row-item');
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
      const li = [...document.querySelectorAll('.pa-row-item')].find((x) => /Farinha/.test(x.textContent));
      return li && li.style.display === 'none';
    });
    await page.fill('[data-testid="ins-search"]', 'fari'); // accent/case-insensitive
    await page.waitForFunction(() => {
      const li = [...document.querySelectorAll('.pa-row-item')].find((x) => /Farinha/.test(x.textContent));
      return li && li.style.display !== 'none';
    });
    await page.close();
  });

  test('Lote 1: edit an insumo name and it persists', async () => {
    const page = await context.newPage();
    await seedBusiness(page);
    await goto(page, 'Insumos');
    await page.locator('.pa-row-item', { hasText: 'Farinha' }).click();   // open edit sheet
    await page.fill('[data-testid="ins-name"]', 'Farinha especial');
    await page.click('[data-testid="ins-save"]');
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
    await addVenda(page, { date: '2026-05-15', qty: 1 });
    await page.waitForSelector('.pa-list-item');
    // The chosen day surfaces as the log's date header (not "Hoje"/"Ontem").
    assert.match(await page.textContent('.pa-list'), /15\/05\/2026/);
    await page.close();
  });

  test('Lote 3: Vendas search + month scope narrow the log (and the total)', async () => {
    const page = await context.newPage();
    await seedBusiness(page);
    await goto(page, 'Vendas');
    await addVenda(page, { date: '2026-04-10', qty: 1 });
    await addVenda(page, { date: '2026-05-20', qty: 2 });
    await page.waitForSelector('.pa-list-item');
    assert.equal(await page.locator('.pa-list-item').count(), 2, 'both sales listed with no filter');

    // Month scope → only May rows survive, and the total label reflects the scope.
    await page.fill('[data-testid="venda-month"]', '2026-05');
    await page.waitForFunction(() => document.querySelectorAll('.pa-list-item').length === 1);
    assert.match(await page.textContent('.pa-totals'), /05\/26/);

    // Search within the scope: a miss hides every row, a hit brings rows back (pure DOM, no re-render).
    await page.fill('[data-testid="venda-search"]', 'zzz');
    await page.waitForFunction(() => [...document.querySelectorAll('.pa-list-item')].every((li) => li.style.display === 'none'));
    await page.fill('[data-testid="venda-search"]', 'Pãozinho');
    await page.waitForFunction(() => [...document.querySelectorAll('.pa-list-item')].some((li) => li.style.display !== 'none'));
    await page.close();
  });

  test('Lote 1: edit a receita to add an observação', async () => {
    const page = await context.newPage();
    await seedBusiness(page);
    await goto(page, 'Receitas');
    await page.click('.pa-row-item'); // open the seeded "Pão" in its edit sheet
    await page.waitForSelector('[data-testid="rec-notes"]');
    await page.fill('[data-testid="rec-notes"]', 'Misturar bem e assar 30min');
    await page.click('[data-testid="rec-save"]');
    await page.waitForSelector('.pa-backdrop', { state: 'detached' });
    // Re-open to confirm the note persisted.
    await page.click('.pa-row-item');
    await page.waitForSelector('[data-testid="rec-notes"]');
    assert.match(await page.inputValue('[data-testid="rec-notes"]'), /Misturar bem/);
    await page.close();
  });

  test('Lote 2: Relatórios shows the month P&L, per-product, and a chart', async () => {
    const page = await context.newPage();
    await seedBusiness(page); // priceable product "Pãozinho"

    // Log a sale today (default date → current month, which Relatórios defaults to).
    await goto(page, 'Vendas');
    await addVenda(page, { qty: 2 });
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
    await page.waitForSelector('[data-testid="ins-new"]');
    assert.equal(await page.locator('.pa-segbtn[data-screen="receitas"]').count(), 1); // segmented sub-nav

    // Add an insumo with NO price → "sem preço" (guards the parseNum '' → null fix), then the
    // dashboard surfaces the alert.
    await addInsumo(page, 'Baunilha', 'un');
    await page.waitForSelector('.pa-status.pa-bad');                       // Insumos "sem preço" banner
    await page.click('.pa-navbtn[data-section="inicio"]');
    assert.match(await page.textContent('section'), /sem preço/);          // dashboard alert
    await page.close();
  });

  test('Lote 3: built-in help opens, is context-aware, and closes', async () => {
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await goto(page, 'Insumos');
    await page.click('[data-testid="help-open"]');
    await page.waitForSelector('[data-testid="help-close"]');
    assert.match(await page.textContent('.pa-sheet'), /três perguntas/);   // friendly intro
    const open = await page.locator('.pa-help-det[open] > summary').textContent();
    assert.match(open, /Insumos/);                                          // current screen expanded
    assert.match(open, /você está aqui/);
    await page.click('[data-testid="help-close"]');
    await page.waitForSelector('.pa-backdrop', { state: 'detached' });
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
    await addInsumo(page, 'Açúcar', 'kg');
    await page.waitForSelector('.pa-row-item');
    assert.match(await page.textContent('.pa-list'), /Açúcar/);
    assert.deepEqual(errors, [], `console/page errors in built file: ${errors.join(' | ')}`);
    await page.close();
  });
});
