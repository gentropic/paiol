import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CATEGORIES, PaiolStore } from '../src/store.js';
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
  assert.deepEqual(titleState(s, title, '2026-07-10'), { paid: 35, discounted: 0, credited: 0, writtenOff: 0, settled: 35, balance: 65, status: 'parcial', overdueDays: 0 });
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
  const { updatedAt, ...savedOrder } = s.get('encomendas', 'e1');
  assert.ok(updatedAt);
  assert.deepEqual(savedOrder, order);
  const { updatedAt: comandaUpdatedAt, ...savedComanda } = s.get('comandas', '2026-07-20');
  assert.ok(comandaUpdatedAt);
  assert.deepEqual(savedComanda, command);
});

test('legacy data is upgraded without deleting existing operational collections', () => {
  const s = new PaiolStore({ version: 1, clients: [{ id: 'c1', name: 'Cliente antigo' }], recipes: [{ id: 'r1', name: 'Receita antiga', components: [] }] });
  ensureFinanceFoundation(s, ids());
  assert.equal(s.state.version, 4);
  assert.equal(s.get('clients', 'c1').name, 'Cliente antigo');
  assert.equal(s.get('recipes', 'r1').name, 'Receita antiga');
  assert.ok(s.state.cashAccounts.length >= 2);
  assert.ok(s.state.categories.some((c) => c.systemKey === 'vendas'));
});

test('default chart covers the main accounting groups of a bakery', () => {
  const s = new PaiolStore(); ensureFinanceFoundation(s, ids());
  const requiredKeys = [
    'vendas', 'vendas-encomendas', 'insumos', 'embalagens', 'mao-obra-direta',
    'gas-producao', 'taxas-venda', 'perdas-producao', 'aluguel',
    'pro-labore', 'impostos', 'marketing', 'manutencao', 'investimentos',
    'aportes', 'retiradas',
  ];
  for (const systemKey of requiredKeys) {
    assert.ok(categoryByKey(s, systemKey), `missing category ${systemKey}`);
  }
});

test('repeated system categories are archived without changing historical category ids', () => {
  const s = new PaiolStore(); ensureFinanceFoundation(s, ids());
  const water = categoryByKey(s, 'agua');
  s.upsertCategory({ ...water, id: 'agua-repetida', name: 'Água antiga' });
  s.addDespesa({ id: 'despesa-antiga', at: '2026-07-10', valor: 35, categoryId: 'agua-repetida' });
  s.upsertFinanceTitle({ id: 'conta-antiga', direction: 'pagar', issuedAt: '2026-07-10', dueDate: '2026-07-10', amount: 35, description: 'Água', categoryId: 'agua-repetida', sourceType: 'manual' });
  ensureFinanceFoundation(s, ids());
  assert.equal(s.state.categories.filter((c) => c.systemKey === 'agua' && !c.archived).length, 1);
  assert.equal(s.state.categories.filter((c) => c.systemKey === 'agua' && c.archived).length, 1);
  assert.equal(s.state.despesas[0].categoryId, 'agua-repetida');
  assert.equal(s.get('financeTitles', 'conta-antiga').categoryId, 'agua-repetida');
  assert.ok(categoryByKey(s, 'agua') && !categoryByKey(s, 'agua').archived);
  assert.equal(listTitles(s, { categoryId: categoryByKey(s, 'agua').id }).some((row) => row.title.id === 'conta-antiga'), true);
  assert.equal(cashFlow(s, '2026-07-01', '2026-07-31', { categoryId: categoryByKey(s, 'agua').id }).totalOut, 35);
});

test('legacy aliases and custom duplicates are archived while custom names stay editable', () => {
  const s = new PaiolStore(); ensureFinanceFoundation(s, ids());
  const root = categoryByKey(s, 'despesas');
  s.upsertCategory({ id: 'legacy-internet', name: 'Internet', kind: 'despesaFixa' });
  s.upsertCategory({ ...root, id: 'despesas-repetidas' });
  s.upsertCategory({ id: 'child-old-parent', name: 'Despesa específica', kind: 'despesaVariavel', nature: 'despesa', parentId: 'despesas-repetidas' });
  s.upsertCategory({ id: 'custom-1', name: 'Feiras extras', kind: 'despesaVariavel', nature: 'despesa', parentId: root.id });
  s.upsertCategory({ id: 'custom-2', name: 'Feiras extras', kind: 'despesaVariavel', nature: 'despesa', parentId: root.id });
  const water = categoryByKey(s, 'agua');
  s.upsertCategory({ ...water, name: 'Água e esgoto', code: '3.20', customName: true, customCode: true });
  ensureFinanceFoundation(s, ids());
  assert.equal(s.get('categories', 'legacy-internet').archived, true);
  assert.equal(s.get('categories', 'child-old-parent').parentId, root.id);
  assert.equal(s.state.categories.filter((c) => c.name === 'Feiras extras' && !c.archived).length, 1);
  assert.equal(categoryByKey(s, 'agua').name, 'Água e esgoto');
  assert.equal(categoryByKey(s, 'agua').code, '3.20');
});

test('first-run legacy categories leave one active chart of accounts', () => {
  const s = new PaiolStore();
  DEFAULT_CATEGORIES.forEach((category, index) => s.upsertCategory({ id: `legacy-${index}`, ...category }));
  ensureFinanceFoundation(s, ids());
  const active = s.state.categories.filter((category) => !category.archived);
  assert.equal(active.filter((category) => category.systemKey === 'vendas').length, 1);
  assert.equal(active.filter((category) => category.name === 'Gás').length, 0);
  assert.equal(active.filter((category) => category.name === 'Internet').length, 0);
  assert.equal(active.filter((category) => category.name === 'Outras').length, 0);
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
