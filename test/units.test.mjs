import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert, isBuiltinUnit, ConversionError } from '../src/units.js';

test('identity conversion', () => {
  assert.equal(convert(5, 'g', 'g'), 5);
  assert.equal(convert(0, 'kg', 'kg'), 0);
});

test('within-dimension built-ins', () => {
  assert.equal(convert(1, 'kg', 'g'), 1000);
  assert.equal(convert(250, 'g', 'kg'), 0.25);
  assert.equal(convert(1, 'l', 'ml'), 1000);
  assert.equal(convert(500, 'mg', 'g'), 0.5);
});

test('cross-dimension requires a per-ingredient override', () => {
  assert.throws(() => convert(2, 'un', 'g'), ConversionError);
  // `1 ovo = 50 g`: an egg ingredient priced per un, recipe specifies grams.
  const ovo = [{ from: 'un', to: 'g', factor: 50 }];
  assert.equal(convert(2, 'un', 'g', ovo), 100);
  assert.equal(convert(100, 'g', 'un', ovo), 2); // reverse direction
});

test('override bridges through a built-in dimension', () => {
  // `1 xicara de farinha = 120 g`; ingredient priced per kg.
  const farinha = [{ from: 'xicara', to: 'g', factor: 120 }];
  // 2 xicaras -> 240 g -> 0.24 kg
  assert.equal(convert(2, 'xicara', 'kg', farinha), 0.24);
});

test('custom unit with no path throws', () => {
  assert.throws(() => convert(1, 'colher', 'g'), ConversionError);
});

test('isBuiltinUnit', () => {
  assert.ok(isBuiltinUnit('g'));
  assert.ok(isBuiltinUnit('un'));
  assert.ok(!isBuiltinUnit('xicara'));
});
