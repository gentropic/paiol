import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  indexStore, priceOf,
  estimateLens, actualLens,
  costBreakdown, cmvPerUnit, recipeUnitCost,
  productUnitCost, productPrice, priceFromCost,
  CycleError, RefError, PriceError, YieldError, MarkupError,
} from '../src/cost-engine.js';

// ── Fixture: bolo de cenoura = massa (sub) + cobertura (sub) ───────────────────
// Single price per ingredient so the roll-up arithmetic is hand-checkable.

const config = {
  valorHora: 30,                 // BRL/hour
  taxaGas: 0.5,                  // BRL/minute of oven
  custosFixosMes: 1000,
  expectedActiveMinutesMonth: 2400,
  targetMarginPct: 0.30,
  paymentFeePct: 0.05,
  rateioBase: 'active-time',
};

function fixture() {
  return indexStore({
    ingredients: [
      { id: 'farinha', name: 'Farinha de trigo', stockUnit: 'kg' },
      { id: 'acucar', name: 'Acucar', stockUnit: 'kg' },
      { id: 'ovo', name: 'Ovo', stockUnit: 'un', conversions: [{ from: 'un', to: 'g', factor: 50 }] },
      { id: 'cenoura', name: 'Cenoura', stockUnit: 'kg' },
      { id: 'chocolate', name: 'Chocolate', stockUnit: 'kg' },
    ],
    recipes: [
      {
        id: 'massa', name: 'Massa base', yieldNominal: 1000, yieldUnit: 'g',
        activeMinutes: 20, ovenMinutes: 40, fermentMinutes: 0,
        components: [
          { ref: { kind: 'ingredient', id: 'farinha' }, qty: 300, unit: 'g' },
          { ref: { kind: 'ingredient', id: 'acucar' }, qty: 200, unit: 'g' },
          { ref: { kind: 'ingredient', id: 'ovo' }, qty: 3, unit: 'un' },
          { ref: { kind: 'ingredient', id: 'cenoura' }, qty: 250, unit: 'g' },
        ],
      },
      {
        id: 'cobertura', name: 'Cobertura', yieldNominal: 200, yieldUnit: 'g',
        activeMinutes: 10, ovenMinutes: 0, fermentMinutes: 0,
        components: [
          { ref: { kind: 'ingredient', id: 'chocolate' }, qty: 150, unit: 'g' },
          { ref: { kind: 'ingredient', id: 'acucar' }, qty: 50, unit: 'g' },
        ],
      },
      {
        id: 'bolo', name: 'Bolo de cenoura', yieldNominal: 1, yieldUnit: 'un',
        activeMinutes: 15, ovenMinutes: 0, fermentMinutes: 0,
        components: [
          { ref: { kind: 'recipe', id: 'massa' }, qty: 800, unit: 'g' },
          { ref: { kind: 'recipe', id: 'cobertura' }, qty: 150, unit: 'g' },
        ],
      },
    ],
    products: [
      { id: 'fatia', name: 'Fatia de bolo', recipeId: 'bolo', portion: 0.125, packagingCost: 0.5 },
    ],
    priceChanges: [
      { id: 'p1', at: '2026-01-01', ingredientId: 'farinha', price: 5.0 },
      { id: 'p2', at: '2026-01-01', ingredientId: 'acucar', price: 4.0 },
      { id: 'p3', at: '2026-01-01', ingredientId: 'ovo', price: 0.5 },
      { id: 'p4', at: '2026-01-01', ingredientId: 'cenoura', price: 6.0 },
      { id: 'p5', at: '2026-01-01', ingredientId: 'chocolate', price: 30.0 },
    ],
    batches: [],
    sales: [],
  });
}

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ~= ${b} (diff ${Math.abs(a - b)})`);

// ── CMV roll-up (§4.1) ────────────────────────────────────────────────────────

test('CMV per unit — leaf recipes', () => {
  const s = fixture();
  const est = estimateLens(config);
  // massa batch ingredients: 0.3kg*5 + 0.2kg*4 + 3un*0.5 + 0.25kg*6 = 1.5+0.8+1.5+1.5 = 5.30
  approx(cmvPerUnit(s, 'massa', config, est), 5.30 / 1000);
  // cobertura: 0.15kg*30 + 0.05kg*4 = 4.5+0.2 = 4.70
  approx(cmvPerUnit(s, 'cobertura', config, est), 4.70 / 200);
});

test('CMV per unit — nested recipe rolls up the DAG', () => {
  const s = fixture();
  const est = estimateLens(config);
  // bolo: 800g massa @ 0.0053/g (4.24) + 150g cobertura @ 0.0235/g (3.525) = 7.765
  approx(cmvPerUnit(s, 'bolo', config, est), 7.765);
});

// ── Full breakdown: labor / gas / fixed also roll up ──────────────────────────

test('full breakdown rolls up all four cost dimensions', () => {
  const s = fixture();
  const est = estimateLens(config);
  const b = costBreakdown(s, 'bolo', config, est);

  approx(b.ingredients, 7.765);
  // labor: bolo own 30*(15/60)=7.50 + massa 0.01/g*800=8.00 + cobertura 0.025/g*150=3.75 = 19.25
  approx(b.labor, 19.25);
  // gas: bolo 0 + massa 0.02/g*800=16.00 + cobertura 0 = 16.00
  approx(b.gas, 16.00);
  // fixed: bolo 1000*15/2400=6.25 + massa (1000*20/2400)/1000*800=6.6667 + cobertura (1000*10/2400)/200*150=3.125
  approx(b.fixed, 6.25 + (1000 * 20 / 2400) / 1000 * 800 + (1000 * 10 / 2400) / 200 * 150);
  approx(recipeUnitCost(s, 'bolo', config, est), b.ingredients + b.labor + b.gas + b.fixed);
});

// ── Markup / price (§4.4) ─────────────────────────────────────────────────────

test('product unit cost applies portion + packaging', () => {
  const s = fixture();
  const est = estimateLens(config);
  const boloCost = recipeUnitCost(s, 'bolo', config, est);
  approx(productUnitCost(s, 'fatia', config, est), boloCost * 0.125 + 0.5);
});

test('price divisor excludes MEI tax (only fee + margin)', () => {
  approx(priceFromCost(65, config), 65 / (1 - 0.05 - 0.30)); // = 100
});

test('impossible markup throws', () => {
  assert.throws(() => priceFromCost(10, { paymentFeePct: 0.5, targetMarginPct: 0.6 }), MarkupError);
});

test('productPrice returns cost and price together', () => {
  const s = fixture();
  const est = estimateLens(config);
  const { unitCost, price } = productPrice(s, 'fatia', config, est);
  approx(price, unitCost / 0.65);
});

// ── Estimate vs actual lens (§4.5) ────────────────────────────────────────────

test('actual lens trues up yield and time from a Batch', () => {
  const raw = fixture();
  // A massa fornada: only 900g came out (some failed), and it took 25 active minutes.
  raw.batches.push({ id: 'b1', at: '2026-06-10', recipeId: 'massa', yieldActual: 900, activeMinutes: 25 });
  const s = indexStore({ ...rawToObject(raw) });

  const est = estimateLens(config);
  const act = actualLens(s, config); // no month window → fixed denom falls back to expected

  // Actual CMV per gram is higher: same 5.30 batch cost over fewer grams.
  approx(cmvPerUnit(s, 'massa', config, est), 5.30 / 1000);
  approx(cmvPerUnit(s, 'massa', config, act), 5.30 / 900);
  assert.ok(cmvPerUnit(s, 'massa', config, act) > cmvPerUnit(s, 'massa', config, est));

  // Actual labor per gram reflects 25 min over 900g, vs estimate 20 min over 1000g.
  approx(costBreakdown(s, 'massa', config, act).labor, (30 * (25 / 60)) / 900);
  approx(costBreakdown(s, 'massa', config, est).labor, (30 * (20 / 60)) / 1000);
});

test('actual lens defaults omitted phase times to the recipe estimate', () => {
  const raw = fixture();
  // Batch logs yield + active minutes but NOT oven minutes → oven defaults to recipe's 40.
  raw.batches.push({ id: 'b1', at: '2026-06-10', recipeId: 'massa', yieldActual: 1000, activeMinutes: 20 });
  const s = indexStore(rawToObject(raw));
  const act = actualLens(s, config);
  // gas uses the recipe's 40 oven minutes (unchanged) over the actual yield 1000 → same as estimate.
  approx(costBreakdown(s, 'massa', config, act).gas, (0.5 * 40) / 1000);
});

// ── Prices over time ──────────────────────────────────────────────────────────

test('priceOf time-travels to the latest change at-or-before a date', () => {
  const s = indexStore({
    ingredients: [{ id: 'x', name: 'X', stockUnit: 'kg' }],
    priceChanges: [
      { id: 'a', at: '2026-01-01', ingredientId: 'x', price: 5 },
      { id: 'b', at: '2026-05-01', ingredientId: 'x', price: 8 },
    ],
  });
  assert.equal(priceOf(s, 'x', null), 8);                                  // latest
  assert.equal(priceOf(s, 'x', new Date('2026-03-01').getTime()), 5);      // before the May bump
  assert.equal(priceOf(s, 'x', new Date('2026-05-01').getTime()), 8);      // inclusive of the bump day
});

// ── Guards & errors ───────────────────────────────────────────────────────────

test('cycle guard catches a recipe that transitively contains itself', () => {
  const s = indexStore({
    ingredients: [{ id: 'f', name: 'F', stockUnit: 'kg' }],
    recipes: [
      { id: 'a', name: 'A', yieldNominal: 1, yieldUnit: 'un', activeMinutes: 0, ovenMinutes: 0, fermentMinutes: 0,
        components: [{ ref: { kind: 'recipe', id: 'b' }, qty: 1, unit: 'un' }] },
      { id: 'b', name: 'B', yieldNominal: 1, yieldUnit: 'un', activeMinutes: 0, ovenMinutes: 0, fermentMinutes: 0,
        components: [{ ref: { kind: 'recipe', id: 'a' }, qty: 1, unit: 'un' }] },
    ],
    priceChanges: [],
  });
  assert.throws(() => recipeUnitCost(s, 'a', config, estimateLens(config)), CycleError);
});

test('missing price throws PriceError', () => {
  const s = indexStore({
    ingredients: [{ id: 'f', name: 'F', stockUnit: 'kg' }],
    recipes: [{ id: 'r', name: 'R', yieldNominal: 1, yieldUnit: 'un', activeMinutes: 0, ovenMinutes: 0, fermentMinutes: 0,
      components: [{ ref: { kind: 'ingredient', id: 'f' }, qty: 1, unit: 'kg' }] }],
    priceChanges: [],
  });
  assert.throws(() => cmvPerUnit(s, 'r', config, estimateLens(config)), PriceError);
});

test('unknown ref throws RefError', () => {
  const s = fixture();
  assert.throws(() => recipeUnitCost(s, 'nao-existe', config, estimateLens(config)), RefError);
});

test('zero yield throws YieldError', () => {
  const s = indexStore({
    ingredients: [{ id: 'f', name: 'F', stockUnit: 'kg' }],
    recipes: [{ id: 'r', name: 'R', yieldNominal: 0, yieldUnit: 'un', activeMinutes: 0, ovenMinutes: 0, fermentMinutes: 0,
      components: [] }],
    priceChanges: [],
  });
  assert.throws(() => recipeUnitCost(s, 'r', config, estimateLens(config)), YieldError);
});

// Re-serialize an indexed store back to raw arrays (for tests that push a batch then re-index).
function rawToObject(s) {
  return {
    ingredients: [...s.ingredients.values()],
    recipes: [...s.recipes.values()],
    products: [...s.products.values()],
    priceChanges: s.priceChanges,
    batches: s.batches,
    sales: s.sales,
  };
}
