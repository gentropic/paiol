import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaiolStore, emptyState, StoreError } from '../src/store.js';
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
