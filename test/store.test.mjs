import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaiolStore, emptyState, StoreError, DEFAULT_CATEGORIES } from '../src/store.js';
import { recipeUnitCost, estimateLens } from '../src/cost-engine.js';

function seeded() {
  const s = new PaiolStore();
  s.upsertIngredient({ id: 'farinha', name: 'Farinha', stockUnit: 'kg' });
  s.upsertRecipe({
    id: 'pao', name: 'Pao', yieldNominal: 10, yieldUnit: 'un',
    activeMinutes: 30, ovenMinutes: 40, fermentMinutes: 120,
    components: [{ ref: { kind: 'ingredient', id: 'farinha' }, qty: 500, unit: 'g' }],
  });
  s.addPriceChange({ id: 'pc1', at: '2026-01-01', ingredientId: 'farinha', price: 5 });
  return s;
}

test('empty state has all collections', () => {
  const st = emptyState();
  assert.deepEqual(st.ingredients, []);
  assert.deepEqual(st.sales, []);
  assert.equal(st.version, 1);
});

test('upsert replaces by id; remove deletes', () => {
  const s = new PaiolStore();
  s.upsertIngredient({ id: 'a', name: 'A', stockUnit: 'kg' });
  s.upsertIngredient({ id: 'a', name: 'A2', stockUnit: 'g' });
  assert.equal(s.state.ingredients.length, 1);
  assert.equal(s.get('ingredients', 'a').name, 'A2');
  assert.equal(s.removeIngredient('a'), true);
  assert.equal(s.state.ingredients.length, 0);
});

test('events are append-only: duplicate id rejected', () => {
  const s = new PaiolStore();
  s.addSale({ id: 's1', at: '2026-06-01', productId: 'p', qty: 1, unitPrice: 10, paymentFeePct: 0, costSnapshot: 4 });
  assert.throws(
    () => s.addSale({ id: 's1', at: '2026-06-02', productId: 'p', qty: 9, unitPrice: 99, paymentFeePct: 0, costSnapshot: 4 }),
    StoreError,
  );
  assert.equal(s.state.sales.length, 1);
});

test('events require id and at', () => {
  const s = new PaiolStore();
  assert.throws(() => s.addBatch({ at: '2026-06-01', recipeId: 'r', yieldActual: 1 }), StoreError);
  assert.throws(() => s.addBatch({ id: 'b1', recipeId: 'r', yieldActual: 1 }), StoreError);
});

test('toEngineStore feeds the cost engine', () => {
  const s = seeded();
  const cost = recipeUnitCost(
    s.toEngineStore(),
    'pao',
    { valorHora: 0, taxaGas: 0, custosFixosMes: 0, expectedActiveMinutesMonth: 1, targetMarginPct: 0, paymentFeePct: 0 },
    estimateLens({ expectedActiveMinutesMonth: 1 }),
  );
  // ingredients only: 500g -> 0.5kg * 5 = 2.50, over yield 10 = 0.25/un
  assert.equal(cost, 0.25);
});

test('migrates legacy products (recipeId + portion) to a recipe component on load', () => {
  const s = new PaiolStore({ products: [{ id: 'p', name: 'P', recipeId: 'r', portion: 0.5, packagingCost: 1 }] });
  const prod = s.get('products', 'p');
  assert.deepEqual(prod.components, [{ kind: 'recipe', id: 'r', qty: 0.5 }]);
  assert.equal('recipeId' in prod, false);
  assert.equal('portion' in prod, false);
});

test('config: defaults present, setConfig patches, survives YAML round-trip', () => {
  const s = new PaiolStore();
  assert.equal(s.getConfig().rateioBase, 'active-time');
  s.setConfig({ valorHora: 35, targetMarginPct: 0.4 });
  assert.equal(s.getConfig().valorHora, 35);
  assert.equal(s.getConfig().paymentFeePct, 0.05); // untouched default
  const back = PaiolStore.fromYaml(s.toYaml());
  assert.equal(back.getConfig().valorHora, 35);
  assert.equal(back.getConfig().targetMarginPct, 0.4);
});

test('currentPrice returns the latest price or null', () => {
  const s = new PaiolStore();
  s.upsertIngredient({ id: 'f', name: 'F', stockUnit: 'kg' });
  assert.equal(s.currentPrice('f'), null);
  s.addPriceChange({ id: 'a', at: '2026-01-01', ingredientId: 'f', price: 5 });
  s.addPriceChange({ id: 'b', at: '2026-05-01', ingredientId: 'f', price: 8 });
  assert.equal(s.currentPrice('f'), 8);
});

test('YAML round-trip preserves the whole business', () => {
  const s = seeded();
  s.addBatch({ id: 'b1', at: '2026-06-10', recipeId: 'pao', yieldActual: 9, activeMinutes: 35 });
  s.addVariableCost({ id: 'v1', at: '2026-06-11', amount: 12.5, description: 'gasolina' });
  s.addPerda({ id: 'pd1', at: '2026-06-12', amount: 3.4, refKind: 'insumo', refId: 'farinha', qty: 0.5, note: 'caiu no chão' });
  s.addReversal({ id: 'rv1', at: '2026-06-13', kind: 'variableCost', refId: 'v1' });
  const back = PaiolStore.fromYaml(s.toYaml());
  assert.deepEqual(back.state, s.state);
  assert.equal(back.state.variableCosts.length, 1);
  assert.equal(back.state.perdas[0].refKind, 'insumo');
  assert.equal(back.isReversed('variableCost', 'v1'), true);
  assert.equal(back.isReversed('perda', 'pd1'), false);
});

test('clients are master data: upsert, index lookup, YAML round-trip (Rev 04)', () => {
  const s = new PaiolStore();
  s.upsertClient({ id: 'c1', name: 'Dona Márcia', phone: '11999990000', address: 'Rua X, 10' });
  assert.equal(s.get('clients', 'c1').name, 'Dona Márcia');     // O(1) index
  const back = PaiolStore.fromYaml(s.toYaml());
  assert.deepEqual(back.state.clients, s.state.clients);
  assert.equal(back.get('clients', 'c1').phone, '11999990000');
  s.removeClient('c1');
  assert.equal(s.get('clients', 'c1'), undefined);
});

test('encomendas are mutable master data that round-trip (Rev 04)', () => {
  const s = new PaiolStore();
  s.upsertEncomenda({
    id: 'e1', at: '2026-06-16', deliveryDate: '2026-06-18', clienteId: 'c1',
    itens: [{ productId: 'p1', qty: 2, unitPrice: 10 }], total: 23, costSnapshot: 8,
    deliveryMethod: 'motoboy', frete: 3, notes: 'sem açúcar',
  });
  const back = PaiolStore.fromYaml(s.toYaml());
  assert.deepEqual(back.state.encomendas, s.state.encomendas);
  assert.equal(back.get('encomendas', 'e1').itens[0].qty, 2);
  // mutable: editing replaces the record in place
  s.upsertEncomenda({ ...s.get('encomendas', 'e1'), notes: 'editado' });
  assert.equal(s.get('encomendas', 'e1').notes, 'editado');
  assert.equal(s.state.encomendas.length, 1);
});

test('categorias: master CRUD, subcategoria via parentId, soft-archive, round-trip (Rev 06)', () => {
  const s = new PaiolStore();
  s.upsertCategory({ id: 'fixa', name: 'Despesas Fixas', kind: 'despesaFixa' });
  s.upsertCategory({ id: 'aluguel', name: 'Aluguel', kind: 'despesaFixa', parentId: 'fixa' });
  assert.equal(s.get('categories', 'aluguel').parentId, 'fixa');
  // edit in place (mutable master)
  s.upsertCategory({ ...s.get('categories', 'aluguel'), name: 'Aluguel + condomínio' });
  assert.equal(s.get('categories', 'aluguel').name, 'Aluguel + condomínio');
  // soft-archive keeps the record (so old lançamentos stay labeled)
  s.upsertCategory({ ...s.get('categories', 'aluguel'), archived: true });
  assert.equal(s.get('categories', 'aluguel').archived, true);
  assert.equal(s.state.categories.length, 2);
  const back = PaiolStore.fromYaml(s.toYaml());           // canonical YAML sorts master by id
  assert.equal(back.state.categories.length, 2);
  assert.deepEqual(back.get('categories', 'aluguel'), s.get('categories', 'aluguel'));
  assert.deepEqual(back.get('categories', 'fixa'), s.get('categories', 'fixa'));
  // hard-remove still possible
  s.removeCategory('aluguel');
  assert.equal(s.get('categories', 'aluguel'), undefined);
});

test('despesas: append-only cash expenses classified by category; round-trip + estorno (Rev 06)', () => {
  const s = new PaiolStore();
  s.upsertCategory({ id: 'gas', name: 'Gás', kind: 'despesaVariavel' });
  s.addDespesa({ id: 'd1', at: '2026-06-10', valor: 90, categoryId: 'gas', description: 'botijão' });
  s.addDespesa({ id: 'd2', at: '2026-06-12', valor: 700, categoryId: 'gas' });
  assert.equal(s.state.despesas.length, 2);
  assert.throws(() => s.addDespesa({ id: 'd1', at: '2026-06-13', valor: 1, categoryId: 'gas' }), StoreError); // dup id
  assert.throws(() => s.addDespesa({ valor: 1, categoryId: 'gas' }), StoreError);                              // needs id+at
  // estorno reuses the Reversal mechanism
  s.addReversal({ id: 'rv1', at: '2026-06-14', kind: 'despesa', refId: 'd2' });
  assert.equal(s.isReversed('despesa', 'd2'), true);
  const back = PaiolStore.fromYaml(s.toYaml());
  assert.deepEqual(back.state.despesas, s.state.despesas);
  assert.equal(back.isReversed('despesa', 'd2'), true);
});

test('DEFAULT_CATEGORIES seed: covers the four buckets, valid kinds (Rev 06)', () => {
  const kinds = new Set(DEFAULT_CATEGORIES.map((c) => c.kind));
  assert.ok(kinds.has('despesaFixa') && kinds.has('despesaVariavel') && kinds.has('receita'));
  assert.ok(DEFAULT_CATEGORIES.some((c) => c.name === 'Pró-labore' && c.kind === 'despesaFixa'));
  assert.ok(DEFAULT_CATEGORIES.some((c) => c.name === 'Gás' && c.kind === 'despesaVariavel'));
  for (const c of DEFAULT_CATEGORIES) assert.match(c.kind, /^(receita|despesaFixa|despesaVariavel|perda)$/);
});

test('comandas are master data keyed by date: round-trip + remove (Rev 04)', () => {
  const s = new PaiolStore();
  s.upsertComanda({ id: '2026-06-18', date: '2026-06-18', itens: [{ productId: 'p1', realizado: 6, feito: true }] });
  const back = PaiolStore.fromYaml(s.toYaml());
  assert.deepEqual(back.state.comandas, s.state.comandas);
  assert.equal(back.get('comandas', '2026-06-18').itens[0].realizado, 6);
  assert.equal(back.get('comandas', '2026-06-18').itens[0].feito, true);
  // mutable, keyed by the date string
  s.upsertComanda({ id: '2026-06-18', date: '2026-06-18', itens: [{ productId: 'p1', realizado: 7, feito: true }] });
  assert.equal(s.get('comandas', '2026-06-18').itens[0].realizado, 7);
  assert.equal(s.state.comandas.length, 1);
  s.removeComanda('2026-06-18');
  assert.equal(s.get('comandas', '2026-06-18'), undefined);
});

test('payments: saldo/status derive from append-only payments; estorno reverses (Rev 04)', () => {
  const s = new PaiolStore();
  s.upsertEncomenda({ id: 'e1', at: '2026-06-16', deliveryDate: '2026-06-18', itens: [], total: 100, costSnapshot: 40 });
  assert.equal(s.paidFor('e1'), 0);
  s.addPayment({ id: 'pg1', at: '2026-06-18', encomendaId: 'e1', valor: 30, forma: 'Pix' });   // sinal
  s.addPayment({ id: 'pg2', at: '2026-06-20', encomendaId: 'e1', valor: 70 });                  // quita
  assert.equal(s.paidFor('e1'), 100);            // total ⇒ pago
  // estorno the R$70 → back to R$30 outstanding
  s.addReversal({ id: 'rv1', at: '2026-06-21', kind: 'payment', refId: 'pg2' });
  assert.equal(s.paidFor('e1'), 30);
  // payments round-trip
  const back = PaiolStore.fromYaml(s.toYaml());
  assert.equal(back.paidFor('e1'), 30);
});

test('YAML round-trip preserves the Rev 03 optional fields (supplier, tags, weight, per-product margin)', () => {
  const s = new PaiolStore();
  s.upsertIngredient({ id: 'i', name: 'Farinha', stockUnit: 'kg', lastSupplier: 'Atacadão', tags: ['seco', 'base'] });
  s.upsertRecipe({ id: 'r', name: 'Massa', yieldNominal: 10, yieldUnit: 'un', activeMinutes: 20, ovenMinutes: 30, fermentMinutes: 0, components: [], weightTotal: 1.2, weightUnit: 'kg', tags: ['vegano'] });
  s.upsertProduct({ id: 'p', name: 'Bolo', components: [], packagingCost: 1, targetMarginPct: 0.5, tags: ['festa'] });
  const back = PaiolStore.fromYaml(s.toYaml());
  assert.deepEqual(back.state, s.state);
  assert.equal(back.get('ingredients', 'i').lastSupplier, 'Atacadão');
  assert.deepEqual(back.get('recipes', 'r').tags, ['vegano']);
  assert.equal(back.get('products', 'p').targetMarginPct, 0.5);
});

test('merge unions events by id and drops duplicates', () => {
  const a = seeded();
  const b = seeded(); // same seed, so pc1 is shared
  b.addPriceChange({ id: 'pc2', at: '2026-03-01', ingredientId: 'farinha', price: 6 });
  b.addSale({ id: 's1', at: '2026-06-01', productId: 'x', qty: 1, unitPrice: 9, paymentFeePct: 0, costSnapshot: 1 });

  const summary = a.merge(b);
  // pc1 already present (dropped), pc2 + s1 are new = 2 events.
  assert.equal(summary.eventsAdded, 2);
  assert.equal(a.state.priceChanges.length, 2);
  assert.equal(a.state.sales.length, 1);
});

test('YAML is canonical: insertion order does not affect output', () => {
  const a = new PaiolStore();
  const b = new PaiolStore();
  const s1 = { id: 's1', at: '2026-06-01', productId: 'p', qty: 1, unitPrice: 10, paymentFeePct: 0, costSnapshot: 1 };
  const s2 = { id: 's2', at: '2026-06-02', productId: 'p', qty: 1, unitPrice: 10, paymentFeePct: 0, costSnapshot: 1 };
  a.addSale(s1); a.addSale(s2);
  b.addSale(s2); b.addSale(s1); // reversed
  assert.equal(a.toYaml(), b.toYaml());
});

test('merge is idempotent (re-merging adds no events)', () => {
  const a = seeded();
  const b = seeded();
  b.addSale({ id: 's9', at: '2026-06-01', productId: 'x', qty: 1, unitPrice: 9, paymentFeePct: 0, costSnapshot: 1 });
  a.merge(b);
  const second = a.merge(b);
  assert.equal(second.eventsAdded, 0);
});
