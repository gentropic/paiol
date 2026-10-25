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
