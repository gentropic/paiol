import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaiolStore } from '../src/store.js';
import { ensureFinanceFoundation, listTitles, titleState, cashFlow, cashMovements, categoryByKey } from '../src/finance.js';

const ids = () => { let n = 0; return () => `id-${++n}`; };

test('finance foundation is idempotent and creates one receivable per order', () => {
  const s = new PaiolStore();
  s.upsertClient({ id: 'c1', name: 'Dona Márcia' });
  s.upsertEncomenda({ id: 'e1', at: '2026-07-01T12:00:00Z', deliveryDate: '2026-07-20T12:00:00Z', clienteId: 'c1', itens: [], total: 120, costSnapshot: 0 });
  const makeId = ids();
  assert.ok(ensureFinanceFoundation(s, makeId) > 0);
  const before = s.state.financeTitles.length;
  ensureFinanceFoundation(s, makeId);
  assert.equal(s.state.financeTitles.length, before);
  const row = listTitles(s, { direction: 'receber', status: 'aberto' })[0];
  assert.equal(row.title.sourceId, 'e1'); assert.equal(row.balance, 120); assert.equal(row.title.partyName, 'Dona Márcia');
});

test('order payments remain the single settlement source and support partial receipts', () => {
  const s = new PaiolStore();
  s.upsertEncomenda({ id: 'e1', at: '2026-07-01', deliveryDate: '2026-07-20', itens: [], total: 100, costSnapshot: 0 });
  ensureFinanceFoundation(s, ids()); const title = s.state.financeTitles[0];
  s.addPayment({ id: 'p1', at: '2026-07-05', encomendaId: 'e1', valor: 35, forma: 'Pix' });
  assert.deepEqual(titleState(s, title, '2026-07-10'), { paid: 35, balance: 65, status: 'parcial', overdueDays: 0 });
  assert.equal(cashMovements(s).filter((m) => m.sourceType === 'payment').length, 1);
});

test('payable settlements reduce balance and feed actual cash only when paid', () => {
  const s = new PaiolStore(); ensureFinanceFoundation(s, ids());
  const cat = categoryByKey(s, 'insumos'); const account = s.state.cashAccounts[0];
  s.upsertFinanceTitle({ id: 't1', direction: 'pagar', issuedAt: '2026-07-01', competenceDate: '2026-07-01', dueDate: '2026-07-15', amount: 200, description: 'Farinha', categoryId: cat.id, sourceType: 'manual' });
  let flow = cashFlow(s, '2026-07-01', '2026-07-31', { projected: true });
  assert.equal(flow.totalOut, 0); assert.equal(flow.projectedOut, 200);
  s.addFinanceSettlement({ id: 'st1', at: '2026-07-10', titleId: 't1', amount: 80, method: 'Pix', accountId: account.id });
  assert.equal(titleState(s, s.get('financeTitles', 't1')).balance, 120);
  flow = cashFlow(s, '2026-07-01', '2026-07-31', { projected: true });
  assert.equal(flow.totalOut, 80); assert.equal(flow.projectedOut, 120);
});

test('loss is managerial and never creates a second cash movement', () => {
  const s = new PaiolStore(); ensureFinanceFoundation(s, ids());
  s.addPerda({ id: 'loss', at: '2026-07-10', amount: 50, refKind: 'produto' });
  assert.equal(cashMovements(s).some((m) => m.sourceId === 'loss'), false);
});

test('financial reconciliation preserves essential order and comanda data', () => {
  const s = new PaiolStore();
  const order = { id: 'e1', at: '2026-07-01', deliveryDate: '2026-07-20', itens: [{ productId: 'p1', qty: 3, unitPrice: 10 }], total: 30, costSnapshot: 12, entregue: false };
  const command = { id: '2026-07-20', date: '2026-07-20', itens: [{ productId: 'p1', prevista: 3, realizado: 1, feito: false }] };
  s.upsertEncomenda(order); s.upsertComanda(command); ensureFinanceFoundation(s, ids());
  assert.deepEqual(s.get('encomendas', 'e1'), order);
  assert.deepEqual(s.get('comandas', '2026-07-20'), command);
});

test('legacy data is upgraded without deleting existing operational collections', () => {
  const s = new PaiolStore({ version: 1, clients: [{ id: 'c1', name: 'Cliente antigo' }], recipes: [{ id: 'r1', name: 'Receita antiga', components: [] }] });
  ensureFinanceFoundation(s, ids());
  assert.equal(s.state.version, 3);
  assert.equal(s.get('clients', 'c1').name, 'Cliente antigo');
  assert.equal(s.get('recipes', 'r1').name, 'Receita antiga');
  assert.ok(s.state.cashAccounts.length >= 2);
  assert.ok(s.state.categories.some((c) => c.systemKey === 'vendas'));
});

test('transfers affect each account but not consolidated cash inflow and outflow', () => {
  const s = new PaiolStore(); ensureFinanceFoundation(s, ids());
  const [cash, bank] = s.state.cashAccounts;
  s.addCashAdjustment({ id: 'tr1', at: '2026-07-10', kind: 'transfer', amount: 75, accountId: cash.id, toAccountId: bank.id });
  const consolidated = cashFlow(s, '2026-07-01', '2026-07-31');
  assert.equal(consolidated.totalIn, 0); assert.equal(consolidated.totalOut, 0);
  assert.equal(cashFlow(s, '2026-07-01', '2026-07-31', { accountId: cash.id }).totalOut, 75);
  assert.equal(cashFlow(s, '2026-07-01', '2026-07-31', { accountId: bank.id }).totalIn, 75);
});

test('a corrected settlement preserves the old event and uses only the replacement value', () => {
  const s = new PaiolStore(); ensureFinanceFoundation(s, ids());
  const account = s.state.cashAccounts[0];
  s.upsertFinanceTitle({ id: 't1', direction: 'pagar', issuedAt: '2026-07-01', competenceDate: '2026-07-01', dueDate: '2026-07-10', amount: 100, description: 'Conta corrigível', sourceType: 'manual' });
  s.addFinanceSettlement({ id: 'old', at: '2026-07-10', titleId: 't1', amount: 100, method: 'Pix', accountId: account.id });
  s.addReversal({ id: 'rev', at: '2026-07-11', kind: 'financeSettlement', refId: 'old' });
  s.addFinanceSettlement({ id: 'new', at: '2026-07-10', titleId: 't1', amount: 80, method: 'Pix', accountId: account.id });
  s.upsertFinanceTitle({ ...s.get('financeTitles', 't1'), amount: 80 });
  assert.equal(s.state.financeSettlements.length, 2);
  assert.equal(titleState(s, s.get('financeTitles', 't1')).balance, 0);
  assert.deepEqual(cashMovements(s).filter((m) => m.titleId === 't1').map((m) => m.amount), [80]);
});
