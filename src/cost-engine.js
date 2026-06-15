// paiol — cost engine (§4). All costs resolve to BRL per sellable unit.
//
// Pure functions over an indexed { ingredients, recipes, products, priceChanges,
// batches, sales } store plus a Config. The estimate/actuals split (§4.5) is the spine:
// it lives in a `lens` object the caller supplies, so the SAME engine computes both the
// pricing view (estimates) and the reporting view (actuals) with no branching inside.
//
// Build a lens with estimateLens(config) or actualLens(store, config, {...}).

import { convert } from './units.js';

// ── Store indexing ──────────────────────────────────────────────────────────

/**
 * @typedef {object} RawStore
 * @property {import('./domain.js').Ingredient[]}  [ingredients]
 * @property {import('./domain.js').Recipe[]}      [recipes]
 * @property {import('./domain.js').Product[]}     [products]
 * @property {import('./domain.js').PriceChange[]} [priceChanges]
 * @property {import('./domain.js').Batch[]}       [batches]
 * @property {import('./domain.js').Sale[]}        [sales]
 */

/**
 * Index a raw store into Maps for O(1) lookup. Idempotent-friendly: pass the result
 * back in and it is returned as-is.
 * @param {RawStore | Store} raw
 * @returns {Store}
 */
export function indexStore(raw) {
  if (raw && raw.__indexed) return /** @type {Store} */ (raw);
  const byId = (arr) => new Map((arr || []).map((x) => [x.id, x]));
  return {
    __indexed: true,
    ingredients: byId(raw.ingredients),
    recipes: byId(raw.recipes),
    products: byId(raw.products),
    priceChanges: (raw.priceChanges || []).slice(),
    batches: (raw.batches || []).slice(),
    sales: (raw.sales || []).slice(),
  };
}

/**
 * @typedef {object} Store
 * @property {true} __indexed
 * @property {Map<string, import('./domain.js').Ingredient>} ingredients
 * @property {Map<string, import('./domain.js').Recipe>}     recipes
 * @property {Map<string, import('./domain.js').Product>}    products
 * @property {import('./domain.js').PriceChange[]}           priceChanges
 * @property {import('./domain.js').Batch[]}                 batches
 * @property {import('./domain.js').Sale[]}                  sales
 */

const ms = (iso) => new Date(iso).getTime();

// ── Prices ──────────────────────────────────────────────────────────────────

/**
 * The price of an ingredient (BRL per its stockUnit) as of `atMs`. The latest
 * PriceChange at-or-before `atMs`; if `atMs` is null, the latest of all time.
 * @param {Store} store
 * @param {string} ingredientId
 * @param {number|null} [atMs]
 * @returns {number}
 */
export function priceOf(store, ingredientId, atMs = null) {
  let best = null;
  let bestAt = -Infinity;
  for (const pc of store.priceChanges) {
    if (pc.ingredientId !== ingredientId) continue;
    const t = ms(pc.at);
    if (atMs != null && t > atMs) continue;
    if (t >= bestAt) { bestAt = t; best = pc; }
  }
  if (!best) throw new PriceError(ingredientId);
  return best.price;
}

// ── Lenses (estimate vs actual; §4.5) ─────────────────────────────────────────

/**
 * @typedef {object} Lens
 * @property {number|null} priceAt                         // null = latest price
 * @property {(r: import('./domain.js').Recipe) => number} yieldOf
 * @property {(r: import('./domain.js').Recipe) => { active: number, oven: number }} timesOf
 * @property {number} totalActiveMinutesMonth              // fixed-rateio denominator
 */

/**
 * Pricing lens — drives prices. Nominal yields, recipe phase-time estimates, the
 * expected monthly active-minute budget.
 * @param {import('./domain.js').Config} config
 * @returns {Lens}
 */
export function estimateLens(config) {
  return {
    priceAt: null,
    yieldOf: (r) => r.yieldNominal,
    timesOf: (r) => ({ active: r.activeMinutes, oven: r.ovenMinutes }),
    totalActiveMinutesMonth: config.expectedActiveMinutesMonth,
  };
}

/**
 * Reporting lens — reports reality. Actual yields and phase times from Batch events
 * (defaulting to the recipe estimate where a batch omits them), and the month's actual
 * summed active minutes as the rateio denominator.
 *
 * @param {Store} store
 * @param {import('./domain.js').Config} config
 * @param {{ atMs?: number|null, monthStartMs?: number, monthEndMs?: number }} [opts]
 * @returns {Lens}
 */
export function actualLens(store, config, opts = {}) {
  const atMs = opts.atMs ?? null;
  // Latest batch per recipe at-or-before atMs.
  /** @type {Map<string, import('./domain.js').Batch>} */
  const latest = new Map();
  for (const b of store.batches) {
    const t = ms(b.at);
    if (atMs != null && t > atMs) continue;
    const prev = latest.get(b.recipeId);
    if (!prev || t >= ms(prev.at)) latest.set(b.recipeId, b);
  }

  // Month's actual active minutes, summed from batches in [monthStart, monthEnd).
  let totalActive = 0;
  if (opts.monthStartMs != null && opts.monthEndMs != null) {
    for (const b of store.batches) {
      const t = ms(b.at);
      if (t < opts.monthStartMs || t >= opts.monthEndMs) continue;
      const r = store.recipes.get(b.recipeId);
      totalActive += b.activeMinutes ?? r?.activeMinutes ?? 0;
    }
  }

  return {
    priceAt: atMs,
    yieldOf: (r) => latest.get(r.id)?.yieldActual ?? r.yieldNominal,
    timesOf: (r) => {
      const b = latest.get(r.id);
      return {
        active: b?.activeMinutes ?? r.activeMinutes,
        oven: b?.ovenMinutes ?? r.ovenMinutes,
      };
    },
    totalActiveMinutesMonth: totalActive || config.expectedActiveMinutesMonth,
  };
}

// ── Cost roll-up (§4.1–4.3) ───────────────────────────────────────────────────
//
// The DAG roll-up is unified across ALL FOUR cost dimensions, not just ingredients.
// The spec spells out CMV roll-up explicitly (§4.1) and is silent on labor/gas/fixed —
// but `Batch` events are per-recipe (a `massa` fornada logs its OWN active/oven minutes,
// and that massa is reused across many bolos), so a bolo's true cost must absorb the
// massa's per-gram labor/gas/fixed scaled by how much massa it consumes. Rolling up only
// ingredients would make every sub-recipe's baking time vanish and underprice the product.
//
// So each recipe contributes its OWN per-unit ingredients/labor/gas/fixed, plus, for every
// sub-recipe component, that sub's full per-unit breakdown scaled by (qty consumed / yield).

/**
 * @typedef {object} Breakdown
 * @property {number} ingredients  // CMV per yield-unit (the rolled-up §4.1 figure)
 * @property {number} labor        // mao de obra, per yield-unit
 * @property {number} gas          // oven gas, per yield-unit
 * @property {number} fixed        // allocated fixed cost (rateio), per yield-unit
 */

/**
 * Full per-yield-unit cost breakdown of a recipe, rolling the component DAG. Cycle-guarded:
 * a recipe may not, directly or transitively, contain itself (§2.2).
 *
 *   labor = valorHora * (activeMinutes / 60) / yield   // active time only, in HOURS
 *   gas   = taxaGas   *  ovenMinutes        / yield     // oven priced by the minute
 *
 * Note: the spec's §4.2 labor line wrote `activeMinutes * valorHora`, mixing minutes with a
 * per-hour rate (off by 60x). `valorHora` is BRL/hour here, so active minutes / 60. Gas is
 * consistent — `taxaGas` is BRL/minute.
 *
 * @param {Store} store @param {string} recipeId
 * @param {import('./domain.js').Config} config @param {Lens} lens
 * @param {Set<string>} [stack]  // recipes currently being expanded (cycle guard)
 * @returns {Breakdown}
 */
export function costBreakdown(store, recipeId, config, lens, stack = new Set()) {
  const recipe = store.recipes.get(recipeId);
  if (!recipe) throw new RefError('recipe', recipeId);
  if (stack.has(recipeId)) throw new CycleError([...stack, recipeId]);
  stack.add(recipeId);

  const yield_ = yieldOrThrow(recipe, lens);
  const { active, oven } = lens.timesOf(recipe);

  // The recipe's own (non-component) costs.
  const out = {
    ingredients: 0,
    labor: (config.valorHora * (active / 60)) / yield_,
    gas: (config.taxaGas * oven) / yield_,
    fixed: fixedShare(config, lens, active, oven) / yield_,
  };

  for (const c of recipe.components) {
    if (c.ref.kind === 'ingredient') {
      const ing = store.ingredients.get(c.ref.id);
      if (!ing) throw new RefError('ingredient', c.ref.id);
      const qtyInStock = convert(c.qty, c.unit, ing.stockUnit, ing.conversions);
      out.ingredients += (qtyInStock * priceOf(store, ing.id, lens.priceAt)) / yield_;
    } else {
      const sub = store.recipes.get(c.ref.id);
      if (!sub) throw new RefError('recipe', c.ref.id);
      const subPerUnit = costBreakdown(store, sub.id, config, lens, stack);
      // Sub-yield-units consumed per one unit of THIS recipe.
      const qtyInYield = convert(c.qty, c.unit, sub.yieldUnit); // recipe refs use built-in units only
      const share = qtyInYield / yield_;
      out.ingredients += subPerUnit.ingredients * share;
      out.labor += subPerUnit.labor * share;
      out.gas += subPerUnit.gas * share;
      out.fixed += subPerUnit.fixed * share;
    }
  }

  stack.delete(recipeId);
  return out;
}

/**
 * Fixed-cost share for one BATCH's worth of a recipe (BRL, pre-division by yield). MEI:
 * the monthly pool already absorbs the DAS (a fixed amount, not a percentage), so it never
 * enters the markup divisor (§4.3).
 *
 * Default base 'active-time' — her hands are the scarce capacity:
 *   share = custosFixosMes * activeMinutes / totalActiveMinutesMonth
 * 'total-time' uses active+oven (constraint is space/equipment). The base is engine config;
 * switching is a pure recompute since phase times are captured granularly.
 *
 * @param {import('./domain.js').Config} config @param {Lens} lens
 * @param {number} active @param {number} oven
 * @returns {number}
 */
function fixedShare(config, lens, active, oven) {
  if (lens.totalActiveMinutesMonth <= 0) return 0;
  const minutes = (config.rateioBase || 'active-time') === 'total-time' ? active + oven : active;
  return (config.custosFixosMes * minutes) / lens.totalActiveMinutesMonth;
}

/**
 * CMV per yield-unit (the §4.1 figure): rolled-up ingredient cost / yield.
 * "The cookie that burned is paid for by the eleven that survived."
 * @param {Store} store @param {string} recipeId
 * @param {import('./domain.js').Config} config @param {Lens} lens
 * @returns {number}
 */
export function cmvPerUnit(store, recipeId, config, lens) {
  return costBreakdown(store, recipeId, config, lens).ingredients;
}

/**
 * Full unit cost of a recipe's yield-unit: ingredients + labor + gas + fixed.
 * @param {Store} store @param {string} recipeId
 * @param {import('./domain.js').Config} config @param {Lens} lens
 * @returns {number}
 */
export function recipeUnitCost(store, recipeId, config, lens) {
  const d = costBreakdown(store, recipeId, config, lens);
  return d.ingredients + d.labor + d.gas + d.fixed;
}

/**
 * The components of a product, tolerating the legacy `recipeId` + `portion` shape (migrated to a
 * single `recipe` component) so the engine is robust even on un-migrated raw data.
 * @param {import('./domain.js').Product} product
 * @returns {import('./domain.js').ProductComponent[]}
 */
export function productComponents(product) {
  if (Array.isArray(product.components)) return product.components;
  if (product.recipeId) return [{ kind: 'recipe', id: product.recipeId, qty: product.portion ?? 1 }];
  return [];
}

/**
 * Per-yield-unit cost breakdown of a PRODUCT (excluding packaging), rolling up its component DAG:
 * recipes contribute their breakdown, sub-products recurse, bought ingredients are pure ingredient
 * cost. Cycle-guarded — a product may not, directly or transitively, contain itself.
 *
 * @param {Store} store @param {string} productId
 * @param {import('./domain.js').Config} config @param {Lens} lens
 * @param {Set<string>} [stack]
 * @returns {Breakdown}
 */
export function productBreakdown(store, productId, config, lens, stack = new Set()) {
  const product = store.products.get(productId);
  if (!product) throw new RefError('product', productId);
  if (stack.has(productId)) throw new CycleError([...stack, productId]);
  stack.add(productId);

  // 5th dimension `packaging` accumulates SUB-products' packaging (the product's OWN packaging is
  // added by productUnitCost / shown separately). Recipes contribute 0 packaging.
  const out = { ingredients: 0, labor: 0, gas: 0, fixed: 0, packaging: 0 };
  for (const c of productComponents(product)) {
    const qty = Number(c.qty) || 0;
    if (c.kind === 'recipe') {
      addScaled(out, costBreakdown(store, c.id, config, lens), qty);
    } else if (c.kind === 'product') {
      const sub = store.products.get(c.id);
      if (!sub) throw new RefError('product', c.id);
      addScaled(out, productBreakdown(store, c.id, config, lens, stack), qty); // sub's components (incl. its sub-packaging)
      out.packaging += (Number(sub.packagingCost) || 0) * qty;                 // + sub's OWN packaging
    } else if (c.kind === 'ingredient') {
      const ing = store.ingredients.get(c.id);
      if (!ing) throw new RefError('ingredient', c.id);
      out.ingredients += priceOf(store, ing.id, lens.priceAt) * qty; // qty is in the ingredient's stockUnit
    } else {
      throw new RefError('component', String(c.kind));
    }
  }

  stack.delete(productId);
  return out;
}

function addScaled(out, b, q) {
  out.ingredients += (b.ingredients || 0) * q;
  out.labor += (b.labor || 0) * q;
  out.gas += (b.gas || 0) * q;
  out.fixed += (b.fixed || 0) * q;
  if ('packaging' in out) out.packaging += (b.packaging || 0) * q;
}

/**
 * Unit cost of a PRODUCT: the rolled-up component cost (incl. sub-products' packaging) plus its
 * own packaging.
 * @param {Store} store @param {string} productId
 * @param {import('./domain.js').Config} config @param {Lens} lens
 * @returns {number}
 */
export function productUnitCost(store, productId, config, lens) {
  const product = store.products.get(productId);
  if (!product) throw new RefError('product', productId);
  const b = productBreakdown(store, productId, config, lens);
  return b.ingredients + b.labor + b.gas + b.fixed + b.packaging + (Number(product.packagingCost) || 0);
}

/**
 * Suggested price from a unit cost (§4.4):
 *   price = unitCost / (1 - paymentFeePct - targetMarginPct)
 * Only the payment fee and target margin go in the divisor — the MEI tax is already a
 * fixed cost. (Simples Nacional, by contrast, would put a tax % back in the divisor.)
 *
 * @param {number} unitCost
 * @param {{ paymentFeePct: number, targetMarginPct: number }} config
 * @returns {number}
 */
export function priceFromCost(unitCost, config) {
  const divisor = 1 - config.paymentFeePct - config.targetMarginPct;
  if (divisor <= 0) throw new MarkupError(config.paymentFeePct, config.targetMarginPct);
  return unitCost / divisor;
}

/**
 * Convenience: the suggested price for a product under a lens.
 * @param {Store} store @param {string} productId
 * @param {import('./domain.js').Config} config @param {Lens} lens
 * @returns {{ unitCost: number, price: number }}
 */
export function productPrice(store, productId, config, lens) {
  const unitCost = productUnitCost(store, productId, config, lens);
  return { unitCost, price: priceFromCost(unitCost, config) };
}

// ── Helpers & errors ──────────────────────────────────────────────────────────

function yieldOrThrow(recipe, lens) {
  const y = lens.yieldOf(recipe);
  if (!(y > 0)) throw new YieldError(recipe.id, y);
  return y;
}

export class RefError extends Error {
  /** @param {string} kind @param {string} id */
  constructor(kind, id) {
    super(`${kind} nao encontrado: "${id}"`);
    this.name = 'RefError';
    this.kind = kind;
    this.id = id;
  }
}

export class CycleError extends Error {
  /** @param {string[]} path */
  constructor(path) {
    super(`Ciclo de receitas: ${path.join(' -> ')}`);
    this.name = 'CycleError';
    this.path = path;
  }
}

export class PriceError extends Error {
  /** @param {string} ingredientId */
  constructor(ingredientId) {
    super(`Sem preco registrado para o insumo "${ingredientId}".`);
    this.name = 'PriceError';
    this.ingredientId = ingredientId;
  }
}

export class YieldError extends Error {
  /** @param {string} recipeId @param {number} value */
  constructor(recipeId, value) {
    super(`Rendimento invalido (${value}) para a receita "${recipeId}".`);
    this.name = 'YieldError';
    this.recipeId = recipeId;
    this.value = value;
  }
}

export class MarkupError extends Error {
  /** @param {number} fee @param {number} margin */
  constructor(fee, margin) {
    super(
      `Taxa (${fee}) + margem (${margin}) >= 100% — preco impossivel. ` +
      `Reduza a margem ou a taxa.`,
    );
    this.name = 'MarkupError';
    this.fee = fee;
    this.margin = margin;
  }
}
