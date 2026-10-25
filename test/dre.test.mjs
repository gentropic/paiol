import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaiolStore } from '../src/store.js';
import { ensureFinanceFoundation, categoryByKey } from '../src/finance.js';
import { managerialDre } from '../src/dre.js';

const ids = () => { let value = 0; return () => `auto-${++value}`; };

function fixture() {
  const store = new PaiolStore();
  const nextId = ids(); ensureFinanceFoundation(store, nextId);
  store.upsertClient({ id: 'client', name: 'Cliente' });
  store.upsertProduct({ id: 'product', name: 'Bolo', components: [], packagingCost: 0 });
  store.upsertEncomenda({ id: 'order', at: '2026-07-01T12:00:00Z', deliveryDate: '2026-07-05T12:00:00Z', entregue: true, clienteId: 'client', itens: [{ productId: 'product', qty: 1, unitPrice: 100 }], total: 100 });
  ensureFinanceFoundation(store, nextId);
  store.addSale({ id: 'sale', at: '2026-07-06T12:00:00Z', productId: 'product', qty: 1, unitPrice: 50, paymentFeePct: 0, costSnapshot: 0 });
  store.upsertFinanceTitle({ id: 'other', direction: 'receber', issuedAt: '2026-07-07', competenceDate: '2026-07-07', dueDate: '2026-07-20', amount: 20, description: 'Outra receita', categoryId: categoryByKey(store, 'outras-receitas').id, sourceType: 'manual' });
  store.upsertFinanceTitle({ id: 'cost', direction: 'pagar', issuedAt: '2026-07-08', competenceDate: '2026-07-08', dueDate: '2026-08-10', amount: 60, description: 'Insumos', categoryId: categoryByKey(store, 'insumos').id, sourceType: 'manual' });
  store.upsertFinanceTitle({ id: 'expense', direction: 'pagar', issuedAt: '2026-07-09', competenceDate: '2026-07-09', dueDate: '2026-07-09', amount: 30, description: 'Aluguel', categoryId: categoryByKey(store, 'aluguel').id, sourceType: 'manual' });
  store.addFinanceSettlement({ id: 'paid-expense', at: '2026-07-09', titleId: 'expense', amount: 30, method: 'Pix' });
  store.upsertFinanceTitle({ id: 'investment', direction: 'pagar', issuedAt: '2026-07-10', competenceDate: '2026-07-10', dueDate: '2026-07-10', amount: 500, description: 'Forno novo', categoryId: categoryByKey(store, 'maquinas').id, sourceType: 'manual' });
  return store;
}

test('managerialDre uses competence, includes paid and pending titles, and excludes investments', () => {
  const dre = managerialDre(fixture(), '2026-07-01', '2026-07-31');
  assert.equal(dre.salesRevenue, 150);
  assert.equal(dre.otherRevenue, 20);
  assert.equal(dre.grossRevenue, 170);
  assert.equal(dre.directCosts, 60);
  assert.equal(dre.grossProfit, 110);
  assert.equal(dre.operatingExpenses, 30);
  assert.equal(dre.netResult, 80);
  assert.equal(dre.openReceivables, 120);
  assert.equal(dre.openPayables, 60);
  assert.equal(dre.excluded, 500);
  assert.ok(dre.diagnostics.some((row) => row.title === 'Resultado positivo'));
  assert.ok(dre.diagnostics.some((row) => row.title === 'Aquisições e investimentos fora do lucro'));
});

test('managerialDre follows competenceDate rather than due or settlement date', () => {
  const store = fixture();
  assert.equal(managerialDre(store, '2026-08-01', '2026-08-31').directCosts, 0);
  assert.equal(managerialDre(store, '2026-07-01', '2026-07-31').directCosts, 60);
});

test('a stock-only purchase does not enter Accounts Payable or the DRE', () => {
  const store = new PaiolStore(); ensureFinanceFoundation(store, ids());
  store.upsertPurchase({ id: 'stock-only', at: '2026-07-12', items: [], total: 90, financiallyTracked: false });
  store.upsertPurchase({ id: 'legacy-financial', at: '2026-07-13', items: [], total: 40 });
  const dre = managerialDre(store, '2026-07-01', '2026-07-31');
  assert.equal(dre.directCosts, 0);
  assert.equal(dre.excluded, 130);
  assert.equal(store.state.financeTitles.length, 0);
});

test('a discount granted when settling an old customer invoice reduces revenue only in the grant period', () => {
  const store = fixture();
  const title = store.state.financeTitles.find((row) => row.sourceType === 'encomenda' && row.sourceId === 'order');
  store.addFinanceSettlement({ id: 'discount-aug', at: '2026-08-03', titleId: title.id, amount: 10, kind: 'discount' });
  store.addFinanceSettlement({ id: 'received-aug', at: '2026-08-03', titleId: title.id, amount: 90, kind: 'client-payment-allocation', paymentId: 'cash-aug' });
  store.addCashAdjustment({ id: 'cash-aug', at: '2026-08-03', kind: 'client-payment', direction: 'entrada', clientId: 'client', amount: 90, creditAmount: 0 });
  const july = managerialDre(store, '2026-07-01', '2026-07-31');
  const august = managerialDre(store, '2026-08-01', '2026-08-31');
  assert.equal(july.salesRevenue, 150);
  assert.equal(july.salesDiscounts, 0);
  assert.equal(august.salesGross, 0);
  assert.equal(august.salesDiscounts, 10);
  assert.equal(august.salesRevenue, -10);
  assert.equal(august.grossRevenue, -10);
  assert.equal(august.netResult, -10);
});

test('DRE warns when ingredient balances are negative and omits them from estimated stock value', () => {
  const store = new PaiolStore();
  store.upsertIngredient({ id: 'flour', name: 'Farinha', stockUnit: 'kg', stockQty: 0 });
  store.addPriceChange({ id: 'price', at: '2026-07-01', ingredientId: 'flour', price: 5 });
  store.addInventoryAdjustment({ id: 'adjust', at: '2026-07-02', ingredientId: 'flour', delta: -2 });
  const dre = managerialDre(store, '2026-07-01', '2026-07-31');
  assert.equal(dre.negativeInventory, 1);
  assert.equal(dre.inventoryValue, 0);
  assert.ok(dre.diagnostics.some((item) => item.title === 'Estoque negativo'));
});
