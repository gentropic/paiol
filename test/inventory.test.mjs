import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaiolStore, emptyState } from '../src/store.js';
import { inventorySummary } from '../src/inventory.js';

test('inventory uses opening + purchases - production - ingredient losses, never sales', () => {
  const state = emptyState();
  state.ingredients = [{ id: 'flour', name: 'Farinha', stockUnit: 'kg', stockQty: 10, minStockQty: 3 }];
  state.recipes = [{ id: 'r', name: 'Massa', yieldNominal: 10, yieldUnit: 'un', activeMinutes: 0, ovenMinutes: 0, components: [{ ref: { kind: 'ingredient', id: 'flour' }, qty: 5, unit: 'kg' }] }];
  state.products = [{ id: 'p', name: 'Bolo', components: [{ kind: 'recipe', id: 'r', qty: 1 }], packagingCost: 0 }];
  state.purchases = [{ id: 'buy', at: '2026-07-01', items: [{ ingredientId: 'flour', qty: 2, unitPrice: 5 }], total: 10 }];
  state.comandas = [{ id: '2026-07-02', date: '2026-07-02', itens: [{ productId: 'p', realizado: 4 }] }];
  state.perdas = [{ id: 'loss', at: '2026-07-03', refKind: 'insumo', refId: 'flour', qty: 1, amount: 5 }];
  state.sales = [{ id: 'sale', at: '2026-07-04', productId: 'p', qty: 999, unitPrice: 10, paymentFeePct: 0, costSnapshot: 0 }];
  const row = inventorySummary(new PaiolStore(state))[0];
  assert.equal(row.current, 9); // 10 + 2 - (4 × 0.5) - 1
  assert.equal(row.production, 2);
  assert.equal(row.low, false);
});

test('negative stock warns even when the minimum has not been entered', () => {
  const state = emptyState();
  state.ingredients = [{ id: 'flour', name: 'Farinha', stockUnit: 'kg', stockQty: 0, minStockQty: 0 }];
  state.recipes = [{ id: 'r', name: 'Massa', yieldNominal: 1, yieldUnit: 'un', components: [{ ref: { kind: 'ingredient', id: 'flour' }, qty: 0.5, unit: 'kg' }] }];
  state.products = [{ id: 'p', name: 'Pão', components: [{ kind: 'recipe', id: 'r', qty: 1 }] }];
  state.comandas = [{ id: 'cmd', date: '2026-07-02', itens: [{ productId: 'p', realizado: 1 }] }];
  const row = inventorySummary(new PaiolStore(state))[0];
  assert.equal(row.current, -0.5);
  assert.equal(row.low, true);
});

test('physical count adjusts current stock without rewriting opening stock and survives backup merge', () => {
  const state = emptyState();
  state.ingredients = [{ id: 'flour', name: 'Farinha', stockUnit: 'kg', stockQty: 2 }];
  state.purchases = [{ id: 'buy', at: '2026-07-01', items: [{ ingredientId: 'flour', qty: 3, unitPrice: 5 }] }];
  const store = new PaiolStore(state);
  const before = inventorySummary(store)[0].current;
  store.addInventoryAdjustment({ id: 'count', at: '2026-07-02T10:00:00Z', ingredientId: 'flour', before, after: 4, delta: 4 - before, reason: 'Contagem física' });
  assert.equal(store.get('ingredients', 'flour').stockQty, 2);
  assert.equal(inventorySummary(store)[0].current, 4);
  const restored = PaiolStore.fromYaml(store.toYaml());
  assert.equal(inventorySummary(restored)[0].current, 4);
  const merged = new PaiolStore(state);
  merged.merge(restored);
  merged.merge(restored);
  assert.equal(merged.state.inventoryAdjustments.length, 1);
  assert.equal(inventorySummary(merged)[0].current, 4);
});

test('a reversed physical count no longer changes inventory', () => {
  const store = new PaiolStore(emptyState());
  store.upsertIngredient({ id: 'flour', name: 'Farinha', stockUnit: 'kg', stockQty: 1 });
  store.addInventoryAdjustment({ id: 'count', at: '2026-07-02', ingredientId: 'flour', delta: 2 });
  assert.equal(inventorySummary(store)[0].current, 3);
  store.addReversal({ id: 'undo', at: '2026-07-03', kind: 'inventoryAdjustment', refId: 'count' });
  assert.equal(inventorySummary(store)[0].current, 1);
});

test('editing a recipe later does not change ingredient usage already recorded in a comanda', () => {
  const store = new PaiolStore();
  store.upsertIngredient({ id: 'flour', name: 'Farinha', stockUnit: 'kg', stockQty: 10 });
  store.upsertRecipe({ id: 'recipe', name: 'Pão', yieldNominal: 2, yieldUnit: 'un', components: [{ ref: { kind: 'ingredient', id: 'flour' }, qty: 1, unit: 'kg' }] });
  store.upsertProduct({ id: 'bread', name: 'Pão', components: [{ kind: 'recipe', id: 'recipe', qty: 1 }] });
  store.upsertComanda({ id: '2026-07-02', date: '2026-07-02', itens: [{ productId: 'bread', realizado: 4 }] });
  assert.equal(inventorySummary(store)[0].production, 2);
  assert.equal(store.get('comandas', '2026-07-02').itens[0].ingredientUsagePerUnit.flour, 0.5);
  store.upsertRecipe({ ...store.get('recipes', 'recipe'), components: [{ ref: { kind: 'ingredient', id: 'flour' }, qty: 2, unit: 'kg' }] });
  assert.equal(inventorySummary(store)[0].production, 2);
  store.upsertComanda({ id: '2026-07-02', date: '2026-07-02', itens: [{ productId: 'bread', realizado: 5 }] });
  assert.equal(inventorySummary(store)[0].production, 2.5);
  assert.equal(inventorySummary(PaiolStore.fromYaml(store.toYaml()))[0].production, 2.5);
});
