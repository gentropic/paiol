import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaiolStore } from '../src/store.js';
import { toExchange, exportYaml, applyExchange, importYaml } from '../src/exchange.js';

// Deterministic id/clock for assertions.
function det() {
  let n = 0;
  return { id: () => `id${++n}`, now: () => '2026-06-14T00:00:00.000Z' };
}

const DOC = {
  version: 1,
  insumos: [
    { nome: 'Farinha de trigo', unidade: 'kg', preco: 5 },
    { nome: 'Ovo', unidade: 'un', preco: 0.7 },
  ],
  receitas: [
    {
      nome: 'Massa base', rende: 1000, unidade: 'g', minutosAtivos: 20, minutosForno: 40,
      itens: [
        { insumo: 'Farinha de trigo', qtd: 300, unidade: 'g' },
        { insumo: 'Ovo', qtd: 3, unidade: 'un' },
      ],
    },
    {
      nome: 'Bolo', rende: 1, unidade: 'un', minutosAtivos: 15, minutosForno: 0,
      itens: [{ receita: 'Massa base', qtd: 800, unidade: 'g' }],
    },
  ],
  produtos: [{ nome: 'Fatia', receita: 'Bolo', porcao: 0.125, embalagem: 0.5 }],
};

test('import creates insumos, receitas (with sub-recipe refs), produtos', () => {
  const s = new PaiolStore();
  const r = applyExchange(s, DOC, det());
  assert.deepEqual([r.insumos, r.receitas, r.produtos], [2, 2, 1]);
  assert.deepEqual(r.warnings, []);

  // Sub-recipe reference resolved by name.
  const bolo = s.state.recipes.find((x) => x.name === 'Bolo');
  assert.equal(bolo.components[0].ref.kind, 'recipe');
  assert.equal(s.get('recipes', bolo.components[0].ref.id).name, 'Massa base');

  // Price became an event.
  const farinha = s.state.ingredients.find((x) => x.name === 'Farinha de trigo');
  assert.equal(s.currentPrice(farinha.id), 5);
});

test('round-trips: export then import reproduces the same business', () => {
  const a = new PaiolStore();
  applyExchange(a, DOC, det());
  const yaml = exportYaml(a);

  const b = new PaiolStore();
  importYaml(b, yaml, det());
  assert.equal(exportYaml(b), exportYaml(a)); // interchange is stable across the round-trip
});

test('import dedups by name (case-insensitive) instead of duplicating', () => {
  const s = new PaiolStore();
  applyExchange(s, DOC, det());
  // Re-import the same names with different casing + a new price.
  applyExchange(s, {
    insumos: [{ nome: 'FARINHA DE TRIGO', unidade: 'kg', preco: 6 }],
  }, det());
  assert.equal(s.state.ingredients.filter((i) => /farinha/i.test(i.name)).length, 1);
  const f = s.state.ingredients.find((i) => /farinha/i.test(i.name));
  assert.equal(s.currentPrice(f.id), 6); // latest price wins
});

test('warns on an unresolved sub-recipe / product reference', () => {
  const s = new PaiolStore();
  const r = applyExchange(s, {
    receitas: [{ nome: 'X', rende: 1, unidade: 'un', itens: [{ receita: 'NãoExiste', qtd: 1, unidade: 'un' }] }],
    produtos: [{ nome: 'P', receita: 'Fantasma', porcao: 1, embalagem: 0 }],
  }, det());
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings.join('|'), /NãoExiste/);
  assert.match(r.warnings.join('|'), /Fantasma/);
});

test('imports a cesta (product of products + bought insumo) and round-trips it', () => {
  const s = new PaiolStore();
  const r = applyExchange(s, {
    insumos: [{ nome: 'Bombom', unidade: 'un', preco: 1.5 }],
    produtos: [
      { nome: 'Caixa 6', embalagem: 2, componentes: [{ insumo: 'Bombom', qtd: 6 }] },
      { nome: 'Cesta', embalagem: 5, componentes: [{ produto: 'Caixa 6', qtd: 2 }, { insumo: 'Bombom', qtd: 3 }] },
    ],
  }, det());
  assert.deepEqual(r.warnings, []);
  const cesta = s.state.products.find((p) => p.name === 'Cesta');
  assert.equal(cesta.components.length, 2);
  assert.equal(cesta.components[0].kind, 'product');
  assert.equal(cesta.components[1].kind, 'ingredient');

  const yaml = exportYaml(s);
  const b = new PaiolStore();
  importYaml(b, yaml, det());
  assert.equal(exportYaml(b), yaml); // stable round-trip in the component shape
});

test('imports legacy product shape (receita + porcao) as a recipe component', () => {
  const s = new PaiolStore();
  applyExchange(s, {
    insumos: [{ nome: 'Farinha', unidade: 'kg', preco: 5 }],
    receitas: [{ nome: 'Pão', rende: 10, unidade: 'un', itens: [{ insumo: 'Farinha', qtd: 1, unidade: 'kg' }] }],
    produtos: [{ nome: 'Pãozinho', receita: 'Pão', porcao: 1, embalagem: 0 }],
  }, det());
  const prod = s.state.products.find((p) => p.name === 'Pãozinho');
  assert.deepEqual(prod.components, [{ kind: 'recipe', id: prod.components[0].id, qty: 1 }]);
  assert.equal(prod.components[0].kind, 'recipe');
});

test('toExchange omits preco when an ingredient has no price', () => {
  const s = new PaiolStore();
  s.upsertIngredient({ id: 'i1', name: 'Sal', stockUnit: 'kg' });
  const ex = toExchange(s);
  assert.deepEqual(ex.insumos[0], { nome: 'Sal', unidade: 'kg' });
});
