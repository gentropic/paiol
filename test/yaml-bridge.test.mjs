import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toYaml, fromYaml, toNode, YamlBridgeError } from '../src/yaml-bridge.js';

test('round-trips scalars, arrays, nested objects', () => {
  const value = {
    nome: 'Bolo de cenoura',
    preco: 5.3,
    qtd: 12,
    ativo: true,
    ausente: null,
    tags: ['a', 'b'],
    nested: { x: 1, y: ['z', 2.5] },
  };
  const back = fromYaml(toYaml(value));
  assert.deepEqual(back, value);
});

test('preserves int vs float distinction through emit/parse', () => {
  const back = fromYaml(toYaml({ i: 1000, f: 0.0053 }));
  assert.equal(back.i, 1000);
  assert.equal(back.f, 0.0053);
});

test('omits undefined object properties (optional fields)', () => {
  const text = toYaml({ a: 1, b: undefined, c: 3 });
  const back = fromYaml(text);
  assert.deepEqual(back, { a: 1, c: 3 });
});

test('handles empty collections', () => {
  const back = fromYaml(toYaml({ list: [], obj: {} }));
  assert.deepEqual(back, { list: [], obj: {} });
});

test('strings are quoted — no implicit typing leaks', () => {
  // "yes"/"1.0" must survive as strings, not become bool/float.
  const back = fromYaml(toYaml({ a: 'yes', b: '1.0', c: 'null' }));
  assert.deepEqual(back, { a: 'yes', b: '1.0', c: 'null' });
});

test('round-trips a sequence of maps whose first value is a nested map', () => {
  // Regression for the @gcu/yaml embedded-map round-trip bug (see vendor/@gcu/yaml NOTE):
  // this is exactly the `components: [{ ref: {...}, qty, unit }]` shape paiol relies on.
  const value = {
    components: [
      { ref: { kind: 'ingredient', id: 'farinha' }, qty: 500, unit: 'g' },
      { ref: { kind: 'recipe', id: 'massa' }, qty: 2, unit: 'un' },
    ],
  };
  assert.deepEqual(fromYaml(toYaml(value)), value);
});

test('rejects non-finite numbers', () => {
  assert.throws(() => toNode(Infinity), YamlBridgeError);
  assert.throws(() => toNode(NaN), YamlBridgeError);
});
