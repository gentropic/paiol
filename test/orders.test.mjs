import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaiolStore } from '../src/store.js';
import { addOrAppendOrder } from '../src/orders.js';
import { ensureFinanceFoundation, titleState } from '../src/finance.js';
import { clientFinancialStatement } from '../src/client-statement.js';
import { orderProduction } from '../src/bundles.js';

const first = () => ({ id: 'e1', at: '2026-10-18T08:00:00Z', deliveryDate: '2026-10-20T12:00:00Z', clienteId: 'natalia', itens: [{ productId: 'bolo', qty: 1, unitPrice: 20 }], total: 25, frete: 5, costSnapshot: 8, deliveryMethod: 'motoboy' });
const second = () => ({ id: 'e2', at: '2026-10-18T12:00:00Z', deliveryDate: '2026-10-20T15:00:00Z', clienteId: 'natalia', itens: [{ productId: 'pao', qty: 2, unitPrice: 15 }], total: 28, discount: 2, costSnapshot: 10, deliveryMethod: 'retirada', notes: 'Sem pimenta' });

test('second request on the same day joins the open order and preserves payments and client history', () => {
  const store = new PaiolStore();
  store.upsertClient({ id: 'natalia', name: 'Natália' });
  store.upsertProduct({ id: 'bolo', name: 'Bolo', salePrice: 20 });
  store.upsertProduct({ id: 'pao', name: 'Pão', salePrice: 15 });
  addOrAppendOrder(store, first());
  ensureFinanceFoundation(store, () => 'title-1');
  store.addPayment({ id: 'pay-1', at: '2026-10-18T09:00:00Z', encomendaId: 'e1', valor: 25, forma: 'Pix' });
  const oldCopy = store.clone();

  const result = addOrAppendOrder(store, second());
  ensureFinanceFoundation(store, () => 'title-2');
  assert.equal(result.appended, true);
  assert.equal(store.state.encomendas.length, 1);
  assert.equal(result.order.id, 'e1');
  assert.deepEqual(result.order.itens.map((item) => item.productId), ['bolo', 'pao']);
  assert.equal(result.order.total, 53);
  assert.equal(result.order.frete, 5);
  assert.equal(result.order.discount, 2);
  assert.equal(result.order.deliveryMethod, 'motoboy');
  assert.equal(result.order.costSnapshot, 18);
  assert.deepEqual([...orderProduction(result.order)], [['bolo', 1], ['pao', 2]]);
  assert.equal(store.state.financeTitles.length, 1);
  assert.equal(titleState(store, store.state.financeTitles[0]).balance, 28);

  const statement = clientFinancialStatement(store, 'natalia');
  assert.equal(statement.movements.filter((row) => row.type === 'purchase').length, 1);
  assert.equal(statement.movements.find((row) => row.type === 'purchase').items.length, 2);
  assert.equal(statement.totalCharged, 53);
  assert.equal(statement.totalPaid, 25);
  assert.equal(statement.currentBalance, 28);
  store.merge(oldCopy);
  assert.equal(store.get('encomendas', 'e1').itens.length, 2);
});

test('a delivered order stays closed; another day or an unidentified customer makes a separate order', () => {
  const store = new PaiolStore();
  store.upsertEncomenda({ ...first(), entregue: true });
  assert.equal(addOrAppendOrder(store, second()).appended, false);
  assert.equal(store.state.encomendas.length, 2);
  assert.equal(addOrAppendOrder(store, { ...second(), id: 'e3', deliveryDate: '2026-10-21T12:00:00Z' }).appended, false);
  assert.equal(addOrAppendOrder(store, { ...second(), id: 'e4', clienteId: undefined }).appended, false);
  assert.equal(store.state.encomendas.length, 4);
});

test('paid and unpaid orders both appear in the registered client statement', () => {
  const store = new PaiolStore();
  store.upsertClient({ id: 'natalia', name: 'Natália' });
  store.upsertEncomenda({ ...first(), entregue: true });
  addOrAppendOrder(store, second());
  ensureFinanceFoundation(store, (() => { let id = 0; return () => `title-${++id}`; })());
  store.addPayment({ id: 'pay-1', at: '2026-10-19T12:00:00Z', encomendaId: 'e1', valor: 25, forma: 'Pix' });
  const purchases = clientFinancialStatement(store, 'natalia').movements.filter((row) => row.type === 'purchase');
  assert.equal(purchases.length, 2);
  assert.deepEqual(purchases.map((row) => row.balance).sort((a, b) => a - b), [0, 28]);
});
