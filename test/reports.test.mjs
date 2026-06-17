import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaiolStore } from '../src/store.js';
import { monthSummary, despesasByCategory, productSummary, clientSummary, monthsEndingAt, revenueTrend } from '../src/reports.js';

// May: a walk-up sale (R$20, paid), an encomenda (R$60 delivered, R$40 received), a R$200 variável +
// R$600 fixa despesa, a R$10 perda. A priced product so productSummary can estimate a margin.
function fixture() {
  const s = new PaiolStore();
  s.upsertIngredient({ id: 'far', name: 'Farinha', stockUnit: 'kg' });
  s.addPriceChange({ id: 'pc', at: '2026-05-01', ingredientId: 'far', price: 5 });
  s.upsertRecipe({ id: 'r', name: 'R', yieldNominal: 10, yieldUnit: 'un', activeMinutes: 0, ovenMinutes: 0, fermentMinutes: 0, components: [{ ref: { kind: 'ingredient', id: 'far' }, qty: 500, unit: 'g' }] });
  s.upsertProduct({ id: 'p1', name: 'Bolo', components: [{ kind: 'recipe', id: 'r', qty: 1 }], packagingCost: 0 });
  s.upsertClient({ id: 'c1', name: 'Dona Márcia' });
  s.upsertCategory({ id: 'cvar', name: 'Matéria-prima', kind: 'despesaVariavel' });
  s.upsertCategory({ id: 'cfix', name: 'Aluguel', kind: 'despesaFixa' });
  s.addSale({ id: 's1', at: '2026-05-10T12:00:00Z', productId: 'p1', qty: 2, unitPrice: 10, paymentFeePct: 0, costSnapshot: 0 });
  s.upsertEncomenda({ id: 'e1', at: '2026-05-05T12:00:00Z', deliveryDate: '2026-05-08T12:00:00Z', clienteId: 'c1', itens: [{ productId: 'p1', qty: 5, unitPrice: 12 }], total: 60, costSnapshot: 0 });
  s.addPayment({ id: 'pg1', at: '2026-05-09T12:00:00Z', encomendaId: 'e1', valor: 40 });
  s.addDespesa({ id: 'dvar', at: '2026-05-12T12:00:00Z', valor: 200, categoryId: 'cvar' });
  s.addDespesa({ id: 'dfix', at: '2026-05-12T12:00:00Z', valor: 600, categoryId: 'cfix' });
  s.addPerda({ id: 'pd1', at: '2026-05-13T12:00:00Z', amount: 10 });
  return s;
}

test('monthSummary: cash basis = recebido (vendas + pagamentos) − despesas − perdas', () => {
  const m = monthSummary(fixture(), '2026-05');
  assert.equal(m.recebidoVendas, 20);
  assert.equal(m.recebidoPagamentos, 40);
  assert.equal(m.recebido, 60);
  assert.equal(m.despVar, 200);
  assert.equal(m.despFix, 600);
  assert.equal(m.perdas, 10);
  assert.equal(m.despesas, 810);
  assert.equal(m.lucro, 60 - 810);     // −750 (big-purchase month, by design)
  assert.equal(m.faturado, 80);        // 20 sale + 60 encomenda delivered
  assert.equal(m.aReceber, 20);        // e1 saldo
  assert.equal(m.unidades, 2);
});

test('monthSummary: the result NEVER uses recipe/fixed pricing cost (no duplicity, §9)', () => {
  const s = fixture();
  const base = monthSummary(s, '2026-05').lucro;
  s.setConfig({ custosFixosMes: 99999, valorHora: 999 }); // pricing world
  assert.equal(monthSummary(s, '2026-05').lucro, base);   // cash result unchanged
});

test('monthSummary: legacy variableCosts fold into variável; estorno excludes everything', () => {
  const s = fixture();
  s.addVariableCost({ id: 'v1', at: '2026-05-15T12:00:00Z', amount: 30 });
  assert.equal(monthSummary(s, '2026-05').despVar, 230);
  s.addReversal({ id: 'rv1', at: '2026-05-16T12:00:00Z', kind: 'variableCost', refId: 'v1' });
  s.addReversal({ id: 'rv2', at: '2026-05-16T12:00:00Z', kind: 'despesa', refId: 'dfix' });
  s.addReversal({ id: 'rv3', at: '2026-05-16T12:00:00Z', kind: 'payment', refId: 'pg1' });
  s.addReversal({ id: 'rv4', at: '2026-05-16T12:00:00Z', kind: 'perda', refId: 'pd1' });
  const m = monthSummary(s, '2026-05');
  assert.equal(m.despVar, 200);            // legacy reversed
  assert.equal(m.despFix, 0);              // aluguel reversed
  assert.equal(m.recebidoPagamentos, 0);   // payment reversed
  assert.equal(m.perdas, 0);
  assert.equal(m.recebido, 20);            // only the walk-up sale remains
});

test('monthSummary excludes other months', () => {
  const m = monthSummary(fixture(), '2026-06');
  assert.equal(m.recebido, 0);
  assert.equal(m.despesas, 0);
  assert.equal(m.lucro, 0);
});

test('despesasByCategory groups + ranks by total', () => {
  const rows = despesasByCategory(fixture(), '2026-05');
  assert.equal(rows[0].name, 'Aluguel'); assert.equal(rows[0].total, 600); assert.equal(rows[0].kind, 'despesaFixa');
  assert.equal(rows[1].name, 'Matéria-prima'); assert.equal(rows[1].total, 200);
});

test('despesasByCategory folds legacy variableCosts into an "antigos" bucket', () => {
  const s = fixture();
  s.addVariableCost({ id: 'v1', at: '2026-05-15T12:00:00Z', amount: 30 });
  const legacy = despesasByCategory(s, '2026-05').find((r) => r.id === '__legacy__');
  assert.equal(legacy.total, 30);
});

test('productSummary combines walk-up sales + encomenda items; lucro is estimate-based', () => {
  const rows = productSummary(fixture(), '2026-05');
  const bolo = rows.find((r) => r.name === 'Bolo');
  assert.equal(bolo.qty, 7);            // 2 sale + 5 encomenda
  assert.equal(bolo.faturamento, 80);   // 20 + 60
  assert.ok(bolo.lucroEstimado > 0 && bolo.lucroEstimado <= 80); // revenue minus a small recipe cost
});

test('clientSummary totals per client for the month', () => {
  const rows = clientSummary(fixture(), '2026-05');
  const c = rows.find((r) => r.id === 'c1');
  assert.equal(c.total, 60);
  assert.equal(c.recebido, 40);
  assert.equal(c.saldo, 20);
  assert.equal(c.n, 1);
});

test('monthsEndingAt crosses year boundaries; revenueTrend gives recebido + lucro per month', () => {
  assert.deepEqual(monthsEndingAt('2026-02', 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
  const t = revenueTrend(fixture(), '2026-05', 2);
  assert.deepEqual(t.map((x) => x.month), ['2026-04', '2026-05']);
  assert.equal(t[1].recebido, 60);
  assert.equal(t[1].lucro, -750);
});
