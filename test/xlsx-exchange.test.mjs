import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs'; // devDependency — the app uses the vendored UMD; tests inject the lib
import { PaiolStore } from '../src/store.js';
import { workbookBytes, parseInterchange, previewExchange } from '../src/xlsx-exchange.js';
import { applyExchange } from '../src/exchange.js';

function seeded() {
  const s = new PaiolStore();
  s.upsertIngredient({ id: 'far', name: 'Farinha', stockUnit: 'kg' });
  s.upsertIngredient({ id: 'ovo', name: 'Ovo', stockUnit: 'un' });
  s.addPriceChange({ id: 'pc', at: '2026-01-01', ingredientId: 'far', price: 5 });
  s.upsertRecipe({ id: 'bolo', name: 'Bolo de cenoura', yieldNominal: 12, yieldUnit: 'un', activeMinutes: 40, ovenMinutes: 30, fermentMinutes: 0, components: [{ ref: { kind: 'ingredient', id: 'far' }, qty: 500, unit: 'g' }, { ref: { kind: 'ingredient', id: 'ovo' }, qty: 3, unit: 'un' }] });
  s.upsertProduct({ id: 'p', name: 'Bolo (fatia)', components: [{ kind: 'recipe', id: 'bolo', qty: 1 }], packagingCost: 1.5, packagingDesc: 'caixinha', saleQty: 120, saleUnit: 'g', salePrice: 9.5, active: false });
  return s;
}

test('xlsx round-trip: export → parse → applyExchange preserves the catalog', async () => {
  const bytes = await workbookBytes(seeded(), ExcelJS);
  assert.ok(bytes.length > 0);
  const data = await parseInterchange(bytes, ExcelJS);
  assert.equal(data.insumos.length, 2);
  assert.equal(data.receitas.length, 1);                 // exemplo tab skipped
  assert.equal(data.receitas[0].nome, 'Bolo de cenoura');
  assert.equal(data.receitas[0].itens.length, 2);
  assert.equal(data.produtos.length, 1);

  const dst = new PaiolStore();
  applyExchange(dst, data);
  assert.equal(dst.state.ingredients.length, 2);
  assert.equal(dst.state.recipes.length, 1);
  assert.equal(dst.state.products.length, 1);
  assert.equal(dst.state.recipes[0].components.length, 2);
  const far = dst.state.ingredients.find((i) => i.name === 'Farinha');
  assert.equal(dst.currentPrice(far.id), 5);             // preço survived the round-trip
  assert.equal(dst.state.products[0].packagingCost, 1.5);
  assert.equal(dst.state.products[0].saleQty, 120);
  assert.equal(dst.state.products[0].saleUnit, 'g');
  assert.equal(dst.state.products[0].salePrice, 9.5);
  assert.equal(dst.state.products[0].active, false);
});

test('previewExchange: novos vs atualizados, and it never mutates the store', async () => {
  const s = seeded();
  const data = await parseInterchange(await workbookBytes(s, ExcelJS), ExcelJS);

  // re-importing her own data over herself = all updates, nothing new
  const pv = previewExchange(s, data);
  assert.equal(pv.insumos.novos, 0);
  assert.equal(pv.insumos.att, 2);
  assert.equal(pv.receitas.att, 1);
  assert.equal(pv.produtos.att, 1);
  assert.deepEqual(pv.warnings, []);

  // into an empty store = all new
  const pv2 = previewExchange(new PaiolStore(), data);
  assert.equal(pv2.insumos.novos, 2);
  assert.equal(pv2.receitas.novos, 1);
  assert.equal(pv2.produtos.novos, 1);

  // the dry-run left the source store untouched
  assert.equal(s.state.ingredients.length, 2);
  assert.equal(s.state.recipes.length, 1);
});

test('previewExchange surfaces a clean error on garbage, never throws', () => {
  const pv = previewExchange(new PaiolStore(), { insumos: [{ /* no nome */ unidade: 'kg' }], receitas: 'not-an-array' });
  // applyExchange tolerates these (warns / ignores) → a result, not a throw
  assert.ok(pv.insumos || pv.error);
});
