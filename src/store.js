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
 * @typedef {object} State
 * @property {number} version
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

  /** Index the state for the cost engine. */
  toEngineStore() { return indexStore(this.state); }

  /** Get a master record by id, or undefined. */
  get(collection, id) { return this.state[collection].find((x) => x.id === id); }

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
    return { eventsAdded, masterUpserted };
  }

  // ── Serialization (§5 — one YAML document) ───────────────────────────────────

  /** @returns {string} canonical strict-YAML of the whole business. */
  toYaml() {
    // Fixed key order for diff stability.
    const ordered = { version: this.state.version };
    for (const c of ALL) ordered[c] = this.state[c];
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
    return rec;
  }

  _remove(collection, id) {
    const arr = this.state[collection];
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) { arr.splice(i, 1); return true; }
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
    return ev;
  }
}

export class StoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreError';
  }
}
