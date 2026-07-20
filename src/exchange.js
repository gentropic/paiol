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
import { estimateLens, productUnitCost } from './cost-engine.js';

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

  const compName = (c) => (c.kind === 'recipe' ? recipeName(c.id)
    : c.kind === 'product' ? store.get('products', c.id)?.name : ingName(c.id));
  const compKey = (c) => (c.kind === 'recipe' ? 'receita' : c.kind === 'product' ? 'produto' : 'insumo');
  const produtos = store.state.products.map((p) => ({
    nome: p.name,
    quantidadeVenda: p.saleQty || 1,
    unidadeVenda: p.saleUnit || 'un',
    precoVenda: Number(p.salePrice) || 0,
    ativo: p.active !== false,
    embalagem: p.packagingCost,
    ...(p.packagingDesc ? { descricaoEmbalagem: p.packagingDesc } : {}),
    componentes: (p.components || []).map((c) => ({ [compKey(c)]: compName(c), qtd: c.qty })),
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

  // Pass 4a: product shells (so cestas-of-products resolve regardless of order).
  for (const p of data.produtos || []) {
    if (!p || !p.nome) { warnings.push('produto sem nome ignorado'); continue; }
    const k = norm(p.nome);
    if (!prodByName.get(k)) {
      const shell = { id: newId(), name: String(p.nome).trim(), components: [], packagingCost: 0, active: true };
      store.upsertProduct(shell);
      prodByName.set(k, shell);
    }
  }

  // Pass 4b: fill product components + packaging. Accepts the new `componentes` list AND the
  // legacy `receita` + `porcao` shape (→ a single recipe component).
  let nProd = 0;
  for (const p of data.produtos || []) {
    if (!p || !p.nome) continue;
    const prod = prodByName.get(norm(p.nome));
    prod.packagingCost = num(p.embalagem, 0);
    prod.saleQty = num(p.quantidadeVenda, prod.saleQty || 1);
    prod.saleUnit = p.unidadeVenda || prod.saleUnit || 'un';
    if (p.precoVenda != null) prod.salePrice = num(p.precoVenda, prod.salePrice || 0);
    prod.active = p.ativo == null ? prod.active !== false : p.ativo !== false;
    if (p.descricaoEmbalagem) prod.packagingDesc = String(p.descricaoEmbalagem).trim();
    prod.components = [];

    const raw = Array.isArray(p.componentes) ? p.componentes
      : (p.receita != null ? [{ receita: p.receita, qtd: p.porcao }] : []);
    for (const c of raw) {
      if (c.receita != null) {
        const rec = recByName.get(norm(c.receita));
        if (!rec) { warnings.push(`produto "${p.nome}": receita "${c.receita}" não encontrada`); continue; }
        prod.components.push({ kind: 'recipe', id: rec.id, qty: num(c.qtd, 1) });
      } else if (c.produto != null) {
        const sub = prodByName.get(norm(c.produto));
        if (!sub) { warnings.push(`produto "${p.nome}": sub-produto "${c.produto}" não encontrado`); continue; }
        prod.components.push({ kind: 'product', id: sub.id, qty: num(c.qtd, 1) });
      } else if (c.insumo != null) {
        const ing = ensureIngredient(c.insumo, c.unidade);
        prod.components.push({ kind: 'ingredient', id: ing.id, qty: num(c.qtd, 1) });
      } else {
        warnings.push(`produto "${p.nome}": componente sem receita/produto/insumo`);
      }
    }
    store.upsertProduct(prod);
    nProd++;
  }

  // Pass 5 (optional, for seed/demo files): operational events. costSnapshot is computed now from
  // current prices/config. Export stays master-only; import accepts these when present.
  let nVendas = 0; let nFornadas = 0;
  const config = store.getConfig();
  const lens = estimateLens(config);
  const toAt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00.000Z`).toISOString() : now());

  for (const f of data.fornadas || []) {
    const rec = recByName.get(norm(f && f.receita));
    if (!rec) { warnings.push(`fornada referencia receita "${f && f.receita}" inexistente`); continue; }
    store.addBatch({
      id: newId(), at: toAt(f.data), recipeId: rec.id, yieldActual: num(f.unidades, rec.yieldNominal),
      ...(f.minutosAtivos != null ? { activeMinutes: num(f.minutosAtivos, 0) } : {}),
      ...(f.minutosForno != null ? { ovenMinutes: num(f.minutosForno, 0) } : {}),
    });
    nFornadas++;
  }
  for (const v of data.vendas || []) {
    const prod = prodByName.get(norm(v && v.produto));
    if (!prod) { warnings.push(`venda referencia produto "${v && v.produto}" inexistente`); continue; }
    let cost = 0;
    try { cost = productUnitCost(store.toEngineStore(), prod.id, config, lens); } catch { /* unpriced → 0 */ }
    store.addSale({
      id: newId(), at: toAt(v.data), productId: prod.id, qty: num(v.qtd, 1),
      unitPrice: num(v.preco, 0), paymentFeePct: v.taxa != null ? num(v.taxa, 0) : config.paymentFeePct,
      costSnapshot: cost, ...(v.canal ? { channel: String(v.canal).trim() } : {}),
    });
    nVendas++;
  }

  return { insumos: nIns, receitas: nRec, produtos: nProd, vendas: nVendas, fornadas: nFornadas, warnings };
}

/** Parse interchange YAML text and merge it into the store. */
export function importYaml(store, text, opts) {
  return applyExchange(store, fromYaml(text), opts);
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
