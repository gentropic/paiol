// paiol — interchange format (import/export of master data). A human-friendly, hand-editable
// YAML document for insumos + receitas + produtos, referenced BY NAME (not id) so it survives
// round-trips between devices, spreadsheets, and edits. This is the "standard" for getting data
// in and out — distinct from the full event-sourced business.yaml (which carries ids + events).
//
// Shape (PT-BR surface, matching the UI):
//   version: 1
//   insumos:   [{ nome, unidade, preco? }]
//   receitas:  [{ nome, rende, unidade, minutosAtivos?, minutosForno?,
//                 itens: [{ insumo|receita: <nome>, qtd, unidade }] }]
//   produtos:  [{ nome, receita: <nome>, porcao, embalagem }]

import { toYaml, fromYaml } from './yaml-bridge.js';

export const EXCHANGE_VERSION = 1;

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * Project a store into the interchange shape (names, no ids/events).
 * @param {import('./store.js').PaiolStore} store
 */
export function toExchange(store) {
  const recipeName = (id) => store.get('recipes', id)?.name ?? null;
  const ingName = (id) => store.get('ingredients', id)?.name ?? null;

  const insumos = store.state.ingredients.map((i) => {
    const preco = store.currentPrice(i.id);
    return { nome: i.name, unidade: i.stockUnit, ...(preco != null ? { preco } : {}) };
  });

  const receitas = store.state.recipes.map((r) => ({
    nome: r.name,
    rende: r.yieldNominal,
    unidade: r.yieldUnit,
    minutosAtivos: r.activeMinutes,
    minutosForno: r.ovenMinutes,
    itens: r.components.map((c) => ({
      [c.ref.kind === 'ingredient' ? 'insumo' : 'receita']:
        c.ref.kind === 'ingredient' ? ingName(c.ref.id) : recipeName(c.ref.id),
      qtd: c.qty,
      unidade: c.unit,
    })),
  }));

  const produtos = store.state.products.map((p) => ({
    nome: p.name,
    receita: recipeName(p.recipeId),
    porcao: p.portion,
    embalagem: p.packagingCost,
  }));

  return { version: EXCHANGE_VERSION, insumos, receitas, produtos };
}

/** Serialize a store to interchange YAML. */
export function exportYaml(store) {
  return toYaml(toExchange(store));
}

// ── Import ──────────────────────────────────────────────────────────────────

/**
 * Merge an interchange document into a store, resolving references by name. Existing records
 * with the same (case-insensitive) name are updated in place rather than duplicated; new ones
 * are created with fresh ids. A `preco` on an insumo is appended as a PriceChange event.
 *
 * @param {import('./store.js').PaiolStore} store
 * @param {object} data  parsed interchange object
 * @param {{ now?: () => string, id?: () => string }} [opts]  injectable for tests
 * @returns {{ insumos: number, receitas: number, produtos: number, warnings: string[] }}
 */
export function applyExchange(store, data, opts = {}) {
  const now = opts.now || (() => new Date().toISOString());
  const newId = opts.id || (() => crypto.randomUUID());
  const warnings = [];
  const norm = (s) => String(s || '').trim().toLowerCase();

  // Index existing records by normalized name.
  const ingByName = new Map(store.state.ingredients.map((i) => [norm(i.name), i]));
  const recByName = new Map(store.state.recipes.map((r) => [norm(r.name), r]));
  const prodByName = new Map(store.state.products.map((p) => [norm(p.name), p]));

  const ensureIngredient = (nome, unidade) => {
    const k = norm(nome);
    let ing = ingByName.get(k);
    if (!ing) {
      ing = { id: newId(), name: String(nome).trim(), stockUnit: unidade || 'un' };
      store.upsertIngredient(ing);
      ingByName.set(k, ing);
    } else if (unidade && ing.stockUnit !== unidade) {
      ing = { ...ing, stockUnit: unidade };
      store.upsertIngredient(ing);
      ingByName.set(k, ing);
    }
    return ing;
  };

  // Pass 1: insumos (+ prices).
  let nIns = 0;
  for (const it of data.insumos || []) {
    if (!it || !it.nome) { warnings.push('insumo sem nome ignorado'); continue; }
    const ing = ensureIngredient(it.nome, it.unidade);
    if (it.preco != null && Number.isFinite(Number(it.preco))) {
      store.addPriceChange({ id: newId(), at: now(), ingredientId: ing.id, price: Number(it.preco) });
    }
    nIns++;
  }

  // Pass 2: recipe shells (so sub-recipe references resolve regardless of order).
  for (const r of data.receitas || []) {
    if (!r || !r.nome) { warnings.push('receita sem nome ignorada'); continue; }
    const k = norm(r.nome);
    if (!recByName.get(k)) {
      const shell = {
        id: newId(), name: String(r.nome).trim(), yieldNominal: 1, yieldUnit: 'un',
        components: [], activeMinutes: 0, ovenMinutes: 0, fermentMinutes: 0,
      };
      store.upsertRecipe(shell);
      recByName.set(k, shell);
    }
  }

  // Pass 3: fill recipe fields + components.
  let nRec = 0;
  for (const r of data.receitas || []) {
    if (!r || !r.nome) continue;
    const rec = recByName.get(norm(r.nome));
    rec.yieldNominal = num(r.rende, 1);
    rec.yieldUnit = r.unidade || 'un';
    rec.activeMinutes = num(r.minutosAtivos, 0);
    rec.ovenMinutes = num(r.minutosForno, 0);
    rec.fermentMinutes = num(r.fermentMinutes, 0);
    rec.components = [];
    for (const item of r.itens || []) {
      if (item.insumo != null) {
        const ing = ensureIngredient(item.insumo, item.unidade);
        rec.components.push({ ref: { kind: 'ingredient', id: ing.id }, qty: num(item.qtd, 0), unit: item.unidade || ing.stockUnit });
      } else if (item.receita != null) {
        const sub = recByName.get(norm(item.receita));
        if (!sub) { warnings.push(`sub-receita "${item.receita}" (em "${r.nome}") não encontrada`); continue; }
        rec.components.push({ ref: { kind: 'recipe', id: sub.id }, qty: num(item.qtd, 0), unit: item.unidade || sub.yieldUnit });
      } else {
        warnings.push(`item sem insumo/receita em "${r.nome}"`);
      }
    }
    store.upsertRecipe(rec);
    nRec++;
  }

  // Pass 4: produtos.
  let nProd = 0;
  for (const p of data.produtos || []) {
    if (!p || !p.nome) { warnings.push('produto sem nome ignorado'); continue; }
    const rec = recByName.get(norm(p.receita));
    if (!rec) { warnings.push(`produto "${p.nome}" referencia receita "${p.receita}" inexistente`); continue; }
    const existing = prodByName.get(norm(p.nome));
    const prod = {
      id: existing ? existing.id : newId(),
      name: String(p.nome).trim(),
      recipeId: rec.id,
      portion: num(p.porcao, 1),
      packagingCost: num(p.embalagem, 0),
    };
    store.upsertProduct(prod);
    prodByName.set(norm(p.nome), prod);
    nProd++;
  }

  return { insumos: nIns, receitas: nRec, produtos: nProd, warnings };
}

/** Parse interchange YAML text and merge it into the store. */
export function importYaml(store, text, opts) {
  return applyExchange(store, fromYaml(text), opts);
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
