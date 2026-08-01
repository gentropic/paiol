import test from 'node:test';
import assert from 'node:assert/strict';
import { PaiolStore } from '../src/store.js';
import { orderProduction, orderNet, orderItemUnitCost } from '../src/bundles.js';
import { businessPeriodSummary } from '../src/reports.js';
import { ensureFinanceFoundation, titleState, cashMovements } from '../src/finance.js';

test('bundle sale counts the parent once and expands every child in production', () => {
  const store = new PaiolStore();
  store.upsertProduct({ id: 'bolo', name: 'Bolo', saleKind: 'normal', components: [], salePrice: 20 });
  store.upsertProduct({ id: 'doce', name: 'Doce', saleKind: 'normal', components: [], salePrice: 5 });
  store.upsertProduct({ id: 'cesta', name: 'Presente especial', saleKind: 'cesta', components: [], salePrice: 60 });
  const item = { productId: 'cesta', qty: 2, unitPrice: 60, bundleItems: [{ productId: 'bolo', qty: 1 }, { productId: 'doce', qty: 3 }] };
  const production = orderProduction({ itens: [item] });
  assert.deepEqual(Object.fromEntries(production), { cesta: 2, bolo: 2, doce: 6 });
  assert.equal(orderItemUnitCost(store, item, (id) => ({ cesta: 0, bolo: 10, doce: 2 })[id]), 16);
  store.upsertEncomenda({ id: 'e1', at: '2026-07-01', deliveryDate: '2026-07-02', itens: [item], total: 120, costSnapshot: 32 });
  const dashboard = businessPeriodSummary(store, '2026-07-01', '2026-07-31');
  assert.equal(dashboard.basketQty, 2);
  assert.equal(dashboard.baskets[0].id, 'cesta');
  assert.equal(dashboard.soldProducts.some((row) => row.id === 'bolo'), false);
});

test('sale discount reduces the order net total', () => {
  assert.equal(orderNet({ itens: [{ qty: 2, unitPrice: 50 }], frete: 10, discount: 15 }), 95);
});

test('settlement discount closes receivable without creating cash', () => {
  const store = new PaiolStore();
  store.upsertEncomenda({ id: 'e1', at: '2026-07-01', deliveryDate: '2026-07-02', itens: [], total: 100, costSnapshot: 0 });
  let n = 0; ensureFinanceFoundation(store, () => `id-${++n}`);
  const title = store.state.financeTitles.find((row) => row.sourceId === 'e1');
  store.addPayment({ id: 'payment', at: '2026-07-03', encomendaId: 'e1', valor: 90, forma: 'Pix' });
  store.addFinanceSettlement({ id: 'discount', at: '2026-07-03', titleId: title.id, amount: 10, kind: 'discount' });
  assert.deepEqual(titleState(store, title), { paid: 90, discounted: 10, settled: 100, balance: 0, status: 'quitado', overdueDays: 0 });
  assert.equal(cashMovements(store).reduce((sum, row) => sum + (row.direction === 'entrada' ? row.amount : 0), 0), 90);
});
