// paiol — the business store. The whole business is one in-memory state object that
// serializes to a single diffable YAML document (§5). Master data is mutable; the
// money-relevant facts (prices, batches, sales) are append-only immutable events (§2).
//
// Local-first: this object is the source of truth. Persistence (IndexedDB / Dropbox) and
// the UI sit on top; the cost engine reads `toEngineStore()`. Nothing here touches I/O.

import { indexStore } from './cost-engine.js';
import { toYaml, fromYaml } from './yaml-bridge.js';

export const SCHEMA_VERSION = 1;

/** Append-only, immutable event collections (§2.2). */
const EVENT_COLLECTIONS = ['priceChanges', 'batches', 'sales'];
/** Mutable master-data collections (§2.1). */
const MASTER_COLLECTIONS = ['ingredients', 'recipes', 'products'];
const ALL = [...MASTER_COLLECTIONS, ...EVENT_COLLECTIONS];

/**
 * Engine config defaults (§4). Placeholders Nayara tunes in Ajustes; `rateioBase` stays hidden
 * (§4.3). `custosFixosMes` is the whole monthly fixed pool, DAS included (R$ 82,05 for 2026).
 * @type {import('./domain.js').Config}
 */
export const DEFAULT_CONFIG = {
  valorHora: 20,                    // BRL/hour of hands-on time
  taxaGas: 0.10,                    // BRL/minute of oven
  custosFixosMes: 500,              // monthly fixed pool (rent, internet, DAS, …)
  expectedActiveMinutesMonth: 2400, // ~40h/month (pricing-lens rateio denominator; §8.3)
  targetMarginPct: 0.30,
  paymentFeePct: 0.05,
  rateioBase: 'active-time',
};
const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);

/**
 * @typedef {object} State
 * @property {number} version
 * @property {import('./domain.js').Config} config
 * @property {import('./domain.js').Ingredient[]}  ingredients
 * @property {import('./domain.js').Recipe[]}      recipes
 * @property {import('./domain.js').Product[]}     products
 * @property {import('./domain.js').PriceChange[]} priceChanges
 * @property {import('./domain.js').Batch[]}       batches
 * @property {import('./domain.js').Sale[]}        sales
 */

/** @returns {State} a fresh empty state. */
export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    config: { ...DEFAULT_CONFIG },
    ingredients: [], recipes: [], products: [],
    priceChanges: [], batches: [], sales: [],
  };
}

export class PaiolStore {
  /** @param {Partial<State>} [state] */
  constructor(state) {
    /** @type {State} */
    this.state = { ...emptyState(), ...(state || {}) };
    // Normalize: ensure every collection exists and is an array.
    for (const c of ALL) if (!Array.isArray(this.state[c])) this.state[c] = [];
    this.state.version = this.state.version || SCHEMA_VERSION;
    // Backfill config defaults for any missing key (forward-compatible loads).
    this.state.config = { ...DEFAULT_CONFIG, ...(this.state.config || {}) };
    // Migrate legacy products (recipeId + portion) to the component-list shape.
    for (const p of this.state.products) {
      if (!Array.isArray(p.components)) {
        p.components = p.recipeId ? [{ kind: 'recipe', id: p.recipeId, qty: p.portion ?? 1 }] : [];
      }
      delete p.recipeId;
      delete p.portion;
    }
    // Read-model memo (§perf): the UI re-renders the whole panel on every action and looks records
    // up per-row, so id/price scans must be O(1). `_rev` bumps on every mutation; the lazily-built
    // indexes (and the engine store) are rebuilt only when stale. Not serialized.
    this._rev = 0;
    this._index = null; this._indexRev = -1;
    this._engineStore = null; this._engineRev = -1;
  }

  /** Lazily-built lookup maps (by-id per master collection + latest price per ingredient). */
  _idx() {
    if (this._index && this._indexRev === this._rev) return this._index;
    const maps = {};
    for (const c of MASTER_COLLECTIONS) {
      const m = new Map();
      for (const x of this.state[c]) m.set(x.id, x);
      maps[c] = m;
    }
    const price = new Map(); // ingredientId → { price, at } of the latest PriceChange (ties: last wins)
    for (const pc of this.state.priceChanges) {
      const cur = price.get(pc.ingredientId);
      if (!cur || pc.at >= cur.at) price.set(pc.ingredientId, { price: pc.price, at: pc.at });
    }
    maps.price = price;
    this._index = maps; this._indexRev = this._rev;
    return maps;
  }

  // ── Config (engine settings; §4) ─────────────────────────────────────────────

  /** @returns {import('./domain.js').Config} */
  getConfig() { return this.state.config; }

  /** Patch config in place. @param {Partial<import('./domain.js').Config>} partial */
  setConfig(partial) { Object.assign(this.state.config, partial); this._rev++; return this.state.config; }

  /** Latest price for an ingredient (BRL per stockUnit), or null if none recorded yet. */
  currentPrice(ingredientId) {
    const e = this._idx().price.get(ingredientId);
    return e ? e.price : null;
  }

  /** ISO date of the latest recorded price for an ingredient, or null. */
  lastPriceAt(ingredientId) {
    const e = this._idx().price.get(ingredientId);
    return e ? e.at : null;
  }

  /** Full price history for an ingredient, newest first: [{ at, price }]. */
  priceHistory(ingredientId) {
    return this.state.priceChanges
      .filter((pc) => pc.ingredientId === ingredientId)
      .map((pc) => ({ at: pc.at, price: pc.price }))
      .sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  // ── Master data (mutable upsert/remove) ──────────────────────────────────────

  /** @param {import('./domain.js').Ingredient} x */
  upsertIngredient(x) { return this._upsert('ingredients', x); }
  /** @param {import('./domain.js').Recipe} x */
  upsertRecipe(x) { return this._upsert('recipes', x); }
  /** @param {import('./domain.js').Product} x */
  upsertProduct(x) { return this._upsert('products', x); }

  removeIngredient(id) { return this._remove('ingredients', id); }
  removeRecipe(id) { return this._remove('recipes', id); }
  removeProduct(id) { return this._remove('products', id); }

  // ── Events (append-only) ─────────────────────────────────────────────────────

  /** @param {import('./domain.js').PriceChange} ev */
  addPriceChange(ev) { return this._append('priceChanges', ev); }
  /** @param {import('./domain.js').Batch} ev */
  addBatch(ev) { return this._append('batches', ev); }
  /** @param {import('./domain.js').Sale} ev */
  addSale(ev) { return this._append('sales', ev); }

  // ── Read model ───────────────────────────────────────────────────────────────

  /** Index the state for the cost engine (memoized until the next mutation). */
  toEngineStore() {
    if (this._engineStore && this._engineRev === this._rev) return this._engineStore;
    this._engineStore = indexStore(this.state);
    this._engineRev = this._rev;
    return this._engineStore;
  }

  /** Get a master record by id, or undefined. O(1) via the memoized index. */
  get(collection, id) {
    const m = this._idx()[collection];
    return m ? m.get(id) : this.state[collection].find((x) => x.id === id);
  }

  // ── Merge (sync — union by id; §2.2) ─────────────────────────────────────────

  /**
   * Merge another store/state into this one. Events union by id (immutable, so a shared
   * id means identical content — duplicates are dropped). Master data: incoming replaces
   * existing by id (last-writer; v0.1 single-user, no vector clocks yet).
   * @param {PaiolStore | State} other
   * @returns {{ eventsAdded: number, masterUpserted: number }}
   */
  merge(other) {
    const o = other instanceof PaiolStore ? other.state : other;
    let eventsAdded = 0;
    let masterUpserted = 0;

    for (const c of EVENT_COLLECTIONS) {
      const seen = new Set(this.state[c].map((x) => x.id));
      for (const ev of o[c] || []) {
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        this.state[c].push(ev);
        eventsAdded++;
      }
    }
    for (const c of MASTER_COLLECTIONS) {
      for (const rec of o[c] || []) {
        this._upsert(c, rec);
        masterUpserted++;
      }
    }
    // Config is a singleton: incoming wins (last-writer; v0.1 single-user, no vector clocks).
    if (o.config) this.setConfig(o.config);
    return { eventsAdded, masterUpserted };
  }

  // ── Serialization (§5 — one YAML document) ───────────────────────────────────

  /**
   * @returns {string} canonical strict-YAML of the whole business.
   * Deterministic regardless of insertion/merge order: collection key order is fixed, events
   * are sorted chronologically by (at, id), master data by id. This is what makes the file
   * diff-stable (§5) AND makes sync converge byte-identically across devices — two stores with
   * the same data serialize to the same bytes.
   */
  toYaml() {
    const ordered = { version: this.state.version, config: orderedConfig(this.state.config) };
    for (const c of MASTER_COLLECTIONS) ordered[c] = sortBy(this.state[c], byId);
    for (const c of EVENT_COLLECTIONS) ordered[c] = sortBy(this.state[c], byAtThenId);
    return toYaml(ordered);
  }

  /** @param {string} text @returns {PaiolStore} */
  static fromYaml(text) {
    return new PaiolStore(/** @type {Partial<State>} */ (fromYaml(text)));
  }

  /** @returns {PaiolStore} a deep-ish copy (records shared; collections fresh). */
  clone() {
    const copy = emptyState();
    copy.version = this.state.version;
    copy.config = { ...this.state.config };
    for (const c of ALL) copy[c] = this.state[c].slice();
    return new PaiolStore(copy);
  }

  // ── internals ────────────────────────────────────────────────────────────────

  _upsert(collection, rec) {
    if (!rec || typeof rec.id !== 'string' || !rec.id) {
      throw new StoreError(`registro de ${collection} precisa de um id`);
    }
    const arr = this.state[collection];
    const i = arr.findIndex((x) => x.id === rec.id);
    if (i >= 0) arr[i] = rec; else arr.push(rec);
    this._rev++;
    return rec;
  }

  _remove(collection, id) {
    const arr = this.state[collection];
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) { arr.splice(i, 1); this._rev++; return true; }
    return false;
  }

  _append(collection, ev) {
    if (!ev || typeof ev.id !== 'string' || !ev.id) {
      throw new StoreError(`evento de ${collection} precisa de um id`);
    }
    if (typeof ev.at !== 'string' || !ev.at) {
      throw new StoreError(`evento de ${collection} precisa de uma data (at)`);
    }
    if (this.state[collection].some((x) => x.id === ev.id)) {
      throw new StoreError(`evento duplicado em ${collection}: ${ev.id}`);
    }
    this.state[collection].push(ev);
    this._rev++;
    return ev;
  }
}

// Deterministic ordering for serialization (does not mutate the live arrays).
function orderedConfig(config) {
  const out = {};
  for (const k of CONFIG_KEYS) if (config[k] !== undefined) out[k] = config[k];
  return out;
}
function sortBy(arr, cmp) { return arr.slice().sort(cmp); }
function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
function byAtThenId(a, b) {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  return byId(a, b);
}

export class StoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreError';
  }
}
