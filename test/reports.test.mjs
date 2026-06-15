import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaiolStore } from '../src/store.js';
import { monthSummary, productSummary, monthsEndingAt, profitTrend } from '../src/reports.js';

function storeWithSales() {
  const s = new PaiolStore();
  s.upsertRecipe({ id: 'r', name: 'R', yieldNominal: 10, yieldUnit: 'un', activeMinutes: 60, ovenMinutes: 0, fermentMinutes: 0, components: [] });
  s.upsertProduct({ id: 'p1', name: 'Bolo', components: [{ kind: 'recipe', id: 'r', qty: 1 }], packagingCost: 0 });
  s.upsertProduct({ id: 'p2', name: 'Torta', components: [{ kind: 'recipe', id: 'r', qty: 1 }], packagingCost: 0 });
  // May: two sales (different products); June: one sale.
  s.addSale({ id: 's1', at: '2026-05-10T12:00:00.000Z', productId: 'p1', qty: 2, unitPrice: 10, paymentFeePct: 0.05, costSnapshot: 4 });
  s.addSale({ id: 's2', at: '2026-05-20T12:00:00.000Z', productId: 'p2', qty: 1, unitPrice: 30, paymentFeePct: 0, costSnapshot: 12 });
  s.addSale({ id: 's3', at: '2026-06-01T12:00:00.000Z', productId: 'p1', qty: 1, unitPrice: 10, paymentFeePct: 0, costSnapshot: 4 });
  // Batches: 90 min active in May.
  s.addBatch({ id: 'b1', at: '2026-05-10T08:00:00.000Z', recipeId: 'r', yieldActual: 10, activeMinutes: 90 });
  return s;
}

test('monthSummary aggregates revenue, cost, fees, profit, hours', () => {
  const s = storeWithSales();
  const m = monthSummary(s, '2026-05');
  // revenue = 2*10 + 1*30 = 50; cost = 2*4 + 1*12 = 20; fees = 20*0.05 = 1; profit = 50-20-1 = 29
  assert.equal(m.receita, 50);
  assert.equal(m.custo, 20);
  assert.equal(m.taxas, 1);
  assert.equal(m.lucro, 29);
  assert.equal(m.unidades, 3);
  assert.equal(m.nVendas, 2);
  assert.equal(m.horas, 1.5);                 // 90 min
  assert.ok(Math.abs(m.lucroHora - 29 / 1.5) < 1e-9);
  assert.ok(Math.abs(m.margem - 29 / 50) < 1e-9);
});

test('monthSummary excludes other months', () => {
  const s = storeWithSales();
  const jun = monthSummary(s, '2026-06');
  assert.equal(jun.receita, 10);
  assert.equal(jun.lucro, 6);
  assert.equal(jun.horas, 0);                 // no batches in June
  assert.equal(jun.lucroHora, null);
});

test('productSummary ranks products by revenue in the month', () => {
  const s = storeWithSales();
  const rows = productSummary(s, '2026-05');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Torta');         // 30 > 20
  assert.equal(rows[0].receita, 30);
  assert.equal(rows[1].name, 'Bolo');
  assert.equal(rows[1].lucro, 20 - 8 - 1);     // 2*10 - 2*4 - 1 fee = 11
});

test('monthsEndingAt returns N months oldest-first, crossing year boundaries', () => {
  assert.deepEqual(monthsEndingAt('2026-02', 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('profitTrend gives lucro per month over the window', () => {
  const s = storeWithSales();
  const t = profitTrend(s, '2026-06', 3);
  assert.deepEqual(t.map((x) => x.month), ['2026-04', '2026-05', '2026-06']);
  assert.deepEqual(t.map((x) => x.lucro), [0, 29, 6]);
});
