import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

test('Início shows low stock and dated notifications from Ajustes', async () => {
  const port = 8092;
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
      if (screen !== section) await page.locator(`.pa-modulebtn[data-screen="${screen}"]`).click();
    };
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const tomorrow = await page.evaluate(() => {
      const d = new Date(); d.setDate(d.getDate() + 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });

    await openScreen('cadastro', 'insumos');
    await page.click('[data-testid="ins-new"]');
    await page.fill('[data-testid="ins-name"]', 'Farinha para aviso');
    await page.selectOption('[data-testid="ins-unit"]', 'kg');
    await page.fill('[data-testid="ins-stock"]', '1');
    await page.fill('[data-testid="ins-min-stock"]', '2');
    await page.click('[data-testid="ins-save"]');
    await page.waitForSelector('.pa-backdrop', { state: 'detached' });

    await openScreen('ajustes', 'ajustes');
    const addNotice = async (date, title) => {
      await page.click('[data-testid="notification-new"]');
      await page.fill('[data-testid="notification-date"]', date);
      await page.fill('[data-testid="notification-title"]', title);
      await page.click('[data-testid="notification-save"]');
      await page.waitForSelector('.pa-backdrop', { state: 'detached' });
    };
    await addNotice(today, 'Separar embalagens hoje');
    await addNotice(tomorrow, 'Separar embalagens amanhã');
    assert.equal(await page.locator('[data-testid="notification-history-item"]').count(), 2);
    assert.match(await page.locator('[data-testid="notification-history-item"]').last().innerText(), /Separar embalagens hoje/);
    assert.match(await page.locator('[data-testid="shopping-auto-item"]').textContent(), /Estoque 1 kg · mínimo 2 kg/);

    await openScreen('inicio', 'inicio');
    const agenda = page.locator('[data-testid="home-notifications"]');
    assert.match(await agenda.textContent(), /Separar embalagens hoje/);
    assert.match(await agenda.textContent(), /Farinha para aviso/);
    assert.doesNotMatch(await agenda.textContent(), /Separar embalagens amanhã/);

    await page.click('[data-testid="notification-done"]');
    await page.waitForSelector('[data-testid="home-notification"]', { state: 'detached' });
    assert.match(await agenda.textContent(), /Farinha para aviso/);

    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: 'networkidle' });
    assert.match(await page.locator('[data-testid="home-notifications"]').textContent(), /Farinha para aviso/);
    assert.doesNotMatch(await page.locator('[data-testid="home-notifications"]').textContent(), /Separar embalagens hoje/);
    await openScreen('ajustes', 'ajustes');
    assert.match(await page.locator('[data-testid="notification-history-item"]').first().innerText(), /Separar embalagens amanhã/);
    assert.match(await page.locator('[data-testid="notification-history-item"]').last().innerText(), /Separar embalagens hoje/);
    await page.close();
  } finally {
    await browser?.close();
    server.kill();
  }
});
