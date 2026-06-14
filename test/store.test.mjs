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

test('YAML round-trip preserves the whole business', () => {
  const s = seeded();
  s.addBatch({ id: 'b1', at: '2026-06-10', recipeId: 'pao', yieldActual: 9, activeMinutes: 35 });
  const back = PaiolStore.fromYaml(s.toYaml());
  assert.deepEqual(back.state, s.state);
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
