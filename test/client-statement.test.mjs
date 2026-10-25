import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaiolStore } from '../src/store.js';
import { clientFinancialStatement } from '../src/client-statement.js';

function fixture() {
  const store = new PaiolStore();
  store.upsertClient({ id: 'c1', name: 'Cliente Teste', phone: '11999999999' });
  store.upsertProduct({ id: 'p1', name: 'Bolo', components: [], packagingCost: 0, salePrice: 12 });
  store.upsertEncomenda({ id: 'e1', at: '2026-05-05T12:00:00Z', deliveryDate: '2026-05-08T12:00:00Z', clienteId: 'c1', itens: [{ productId: 'p1', qty: 5, unitPrice: 12 }], total: 60, costSnapshot: 0 });
  store.addPayment({ id: 'pg1', at: '2026-05-09T12:00:00Z', encomendaId: 'e1', valor: 40, forma: 'Pix' });
  store.addPayment({ id: 'pg2', at: '2026-06-01T12:00:00Z', encomendaId: 'e1', valor: 20, forma: 'Dinheiro' });
  store.upsertFinanceTitle({ id: 't1', direction: 'receber', issuedAt: '2026-06-05T12:00:00Z', dueDate: '2026-06-10T12:00:00Z', amount: 30, description: 'Taxa adicional', partyType: 'cliente', partyId: 'c1', partyName: 'Cliente Teste', sourceType: 'manual' });
  store.addFinanceSettlement({ id: 'st1', at: '2026-06-06T12:00:00Z', titleId: 't1', amount: 10, method: 'Pix' });
  return store;
}

test('clientFinancialStatement joins detailed purchases, payments and manual receivables', () => {
  const statement = clientFinancialStatement(fixture(), 'c1');
  assert.equal(statement.client.name, 'Cliente Teste');
  assert.equal(statement.totalCharged, 90);
  assert.equal(statement.totalPaid, 70);
  assert.equal(statement.currentBalance, 20);
  assert.equal(statement.movements.length, 5);
  const purchase = statement.movements.find((row) => row.type === 'purchase');
  assert.equal(purchase.items[0].name, 'Bolo');
  assert.equal(purchase.items[0].qty, 5);
  assert.equal(purchase.balance, 0);
});

test('clientFinancialStatement period filters each movement by its own date without hiding the current all-time balance', () => {
  const statement = clientFinancialStatement(fixture(), 'c1', '2026-06-01', '2026-06-30');
  assert.equal(statement.periodPurchases, 30);
  assert.equal(statement.periodPayments, 30);
  assert.equal(statement.periodBalance, 0);
  assert.equal(statement.currentBalance, 20);
  assert.equal(statement.movements.length, 3);
  assert.ok(statement.movements.some((row) => row.description.includes('compra de 2026-05-08')));
});

test('client statement includes quick sales and the full value of a custom basket', () => {
  const store = fixture();
  store.upsertProduct({ id: 'basket', name: 'Cesta', saleKind: 'cesta', components: [], salePrice: 15 });
  store.upsertEncomenda({ id: 'quick', at: '2026-06-10T12:00:00Z', deliveryDate: '2026-06-12T12:00:00Z', quickSale: true,
    clienteId: 'c1', itens: [{ productId: 'basket', qty: 2, unitPrice: 15, bundleItems: [{ productId: 'p1', qty: 3, unitPrice: 12 }] }], total: 102 });
  const row = clientFinancialStatement(store, 'c1').movements.find((movement) => movement.orderId === 'quick' && movement.type === 'purchase');
  assert.equal(row.description, 'Venda rápida');
  assert.equal(row.at, '2026-06-10T12:00:00Z');
  assert.equal(row.items[0].qty, 2);
  assert.equal(row.items[0].unitPrice, 51);
  assert.equal(row.items[0].total, 102);
  assert.match(row.items[0].name, /3× Bolo/);
});
