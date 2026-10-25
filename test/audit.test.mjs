import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaiolStore } from '../src/store.js';
import { orderMaterialEstimate, managerialDre } from '../src/dre.js';
import { businessPeriodSummary, productSummary, salesPeriodSummary } from '../src/reports.js';
import { cashFlow, ensureFinanceFoundation } from '../src/finance.js';

function customizedBasket() {
  const store = new PaiolStore();
  store.upsertIngredient({ id: 'old-ingredient', name: 'Antigo', stockUnit: 'un' });
  store.upsertIngredient({ id: 'new-ingredient', name: 'Novo', stockUnit: 'un' });
  store.addPriceChange({ id: 'old-price', ingredientId: 'old-ingredient', at: '2026-07-01', price: 10 });
  store.addPriceChange({ id: 'new-price', ingredientId: 'new-ingredient', at: '2026-07-01', price: 5 });
  store.upsertProduct({ id: 'old', name: 'Produto antigo', components: [{ kind: 'ingredient', id: 'old-ingredient', qty: 1 }] });
  store.upsertProduct({ id: 'new', name: 'Produto escolhido', components: [{ kind: 'ingredient', id: 'new-ingredient', qty: 1 }] });
  store.upsertProduct({ id: 'basket', name: 'Cesta', saleKind: 'cesta', components: [{ kind: 'product', id: 'old', qty: 1 }], packagingCost: 2 });
  store.upsertEncomenda({
    id: 'basket-order', at: '2026-07-10', deliveryDate: '2026-07-10', entregue: true,
    itens: [{ productId: 'basket', qty: 1, unitPrice: 20, bundleItems: [{ productId: 'new', qty: 1, unitPrice: 30 }] }],
    discount: 10, total: 40,
  });
  return store;
}

test('a customized basket replaces old catalog contents in material cost and DRE', () => {
  const store = customizedBasket();
  const estimate = orderMaterialEstimate(store, store.state.encomendas[0]);
  assert.equal(estimate.ingredients, 5);
  assert.equal(estimate.packaging, 2);
  const dre = managerialDre(store, '2026-07-01', '2026-07-31');
  assert.equal(dre.salesRevenue, 40);
  assert.equal(dre.directCosts, 7);
});

test('product reports allocate order discounts and do not count replaced basket contents twice', () => {
  const store = customizedBasket();
  const sales = salesPeriodSummary(store, '2026-07-01', '2026-07-31');
  assert.equal(sales.products.find((row) => row.id === 'basket').total, 16);
  assert.equal(sales.products.find((row) => row.id === 'new').total, 24);
  assert.equal(sales.products.reduce((sum, row) => sum + row.total, 0), sales.totalVendido);
  const products = productSummary(store, '2026-07');
  assert.equal(products.find((row) => row.id === 'basket').lucroEstimado, 14);
  assert.equal(products.find((row) => row.id === 'new').lucroEstimado, 19);
  const business = businessPeriodSummary(store, '2026-07-01', '2026-07-31');
  assert.equal(business.soldProducts.find((row) => row.id === 'basket').cost, 2);
  assert.equal(business.soldProducts.find((row) => row.id === 'new').cost, 5);
});

test('forecasts without an assigned account do not appear under a selected cash account', () => {
  const store = new PaiolStore();
  let seq = 0; ensureFinanceFoundation(store, () => `id-${++seq}`);
  store.upsertFinanceTitle({ id: 'payable', direction: 'pagar', issuedAt: '2026-07-01', dueDate: '2026-07-20', amount: 100, description: 'Fornecedor' });
  assert.equal(cashFlow(store, '2026-07-01', '2026-07-31', { projected: true }).projectedOut, 100);
  assert.equal(cashFlow(store, '2026-07-01', '2026-07-31', { projected: true, accountId: store.state.cashAccounts[0].id }).projectedOut, 0);
});

test('legacy sale margin applies the configured sales tax when the sale has no override', () => {
  const store = new PaiolStore();
  store.setConfig({ salesTaxPct: 0.1, paymentFeePct: 0, commissionPct: 0 });
  store.upsertIngredient({ id: 'flour', name: 'Farinha', stockUnit: 'un' });
  store.addPriceChange({ id: 'price', ingredientId: 'flour', at: '2026-07-01', price: 5 });
  store.upsertProduct({ id: 'bread', name: 'Pão', components: [{ kind: 'ingredient', id: 'flour', qty: 1 }] });
  store.addSale({ id: 'sale', at: '2026-07-10', productId: 'bread', qty: 1, unitPrice: 20 });
  const row = businessPeriodSummary(store, '2026-07-01', '2026-07-31').soldProducts.find((product) => product.id === 'bread');
  assert.equal(row.fees, 2);
  assert.equal(row.profit, 13);
});
