import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

test('comanda derives orders and keeps avulso production, status and availability', async () => {
  const port = 8091;
  const base = `http://localhost:${port}/`;
  const server = spawn(process.execPath, ['tools/dev-server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  let browser;
  try {
    const deadline = Date.now() + 10_000;
    for (;;) {
      try { if ((await fetch(base)).ok) break; } catch { /* server still starting */ }
      if (Date.now() > deadline) throw new Error('Local Paiol server did not start');
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const { chromium } = await import(process.env.PAIOL_PLAYWRIGHT_PATH || 'playwright');
    const executable = process.env.PAIOL_BROWSER_EXECUTABLE;
    browser = await chromium.launch(executable && existsSync(executable) ? { executablePath: executable } : {});
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });

    const openScreen = async (section, screen) => {
      await page.locator(`.pa-navbtn[data-section="${section}"]`).click();
      await page.locator(`.pa-modulebtn[data-screen="${screen}"]`).click();
    };
    await openScreen('cadastro', 'produtos');
    await page.click('[data-testid="prod-new"]');
    await page.fill('[data-testid="prod-name"]', 'Pão avulso');
    await page.fill('[data-testid="prod-sale-price"]', '10');
    await page.click('[data-testid="prod-save"]');
    await page.waitForSelector('.pa-backdrop', { state: 'detached' });

    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const showToday = async () => {
      await openScreen('producao', 'comanda');
      await page.fill('[data-testid="cmd-week-start"]', iso);
      await page.dispatchEvent('[data-testid="cmd-week-start"]', 'change');
      await page.fill('[data-testid="cmd-week-end"]', iso);
      await page.dispatchEvent('[data-testid="cmd-week-end"]', 'change');
    };
    await showToday();
    assert.equal(await page.locator('[data-testid="cmd-period-day"]').count(), 0);
    assert.match(await page.locator('.pa-main').innerText(), /Período sem encomendas ou produção avulsa/);

    await page.click('[data-testid="cmd-avulso-add"]');
    await page.fill('[data-testid="cmd-avulso-search"]', 'Pão');
    await page.click('[data-testid="cmd-avulso-result"]');
    await page.fill('[data-testid="cmd-avulso-qty"]', '3');
    await page.click('[data-testid="cmd-avulso-save"]');
    await page.waitForSelector('[data-testid="cmd-prevista"]');
    assert.equal(await page.inputValue('[data-testid="cmd-prevista"]'), '3');
    await page.fill('[data-testid="cmd-realizado"]', '2');
    await page.check('[data-testid="cmd-feito"]');
    assert.match(await page.textContent('[data-testid="cmd-disponivel"]'), /\b2\b/);
    assert.match(await page.textContent('.pa-cmd-item'), /saldo a produzir: 1/);

    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: 'networkidle' });
    await showToday();
    assert.equal(await page.inputValue('[data-testid="cmd-prevista"]'), '3');
    assert.equal(await page.inputValue('[data-testid="cmd-realizado"]'), '2');
    assert.equal(await page.isChecked('[data-testid="cmd-feito"]'), true);

    await page.click('[data-testid="cmd-del"]');
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: 'networkidle' });
    await showToday();
    assert.equal(await page.locator('[data-testid="cmd-period-day"]').count(), 0);

    await openScreen('pedidos', 'encomendas');
    await page.click('[data-testid="enc-new"]');
    await page.fill('[data-testid="enc-prodsearch"]', 'Pão');
    await page.click('[data-testid="enc-prodresult"]');
    await page.click('[data-testid="enc-save"]');
    await page.waitForSelector('.pa-backdrop', { state: 'detached' });
    await showToday();
    assert.equal(await page.inputValue('[data-testid="cmd-prevista"]'), '1');
    await page.fill('[data-testid="cmd-realizado"]', '2');
    assert.match(await page.textContent('[data-testid="cmd-disponivel"]'), /\b1\b/);
    await page.close();
  } finally {
    await browser?.close();
    server.kill();
  }
});
