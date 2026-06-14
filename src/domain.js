// paiol — domain types (§2 of the spec).
//
// JSDoc typedefs only — no runtime. The whole ecosystem is plain ES modules
// (the @gcu/build bundler concatenates + scope-isolates, it does NOT transform),
// so we get type-checking via JSDoc, never TypeScript syntax.
//
// English identifiers, PT-BR surface: the names here are English (`Ingredient`,
// `Recipe`, `Batch`); every label Nayara sees is Portuguese, applied at the UI edge.

/**
 * A unit token. Built-in dimensions (mass/volume/count) are known to the engine;
 * any other string (e.g. "xicara", "colher") is a custom unit that MUST be bridged
 * by a per-ingredient {@link Conversion} override.
 * @typedef {string} Unit
 */

/**
 * A per-ingredient unit bridge: `1 from = factor to`.
 * This is the detail that kills naive costing tools (§3): `1 ovo = 50 g`,
 * `1 xicara de farinha = 120 g`. Edges are treated as bidirectional.
 * @typedef {object} Conversion
 * @property {Unit}   from
 * @property {Unit}   to
 * @property {number} factor  // quantity of `to` in one `from`
 */

/**
 * Insumo — a purchased input. Priced in `stockUnit`; the current price is derived
 * from the latest {@link PriceChange} event, never stored on the ingredient.
 * @typedef {object} Ingredient
 * @property {string}        id
 * @property {string}        name          // "Farinha de trigo"
 * @property {Unit}          stockUnit     // unit it is bought/priced in (e.g. "kg")
 * @property {Conversion[]} [conversions]  // cross-dimension / count→mass overrides
 */

/**
 * A line in a recipe's bill of materials — an ingredient or a nested sub-recipe.
 * @typedef {object} Component
 * @property {{ kind: 'ingredient' | 'recipe', id: string }} ref
 * @property {number} qty
 * @property {Unit}   unit
 */

/**
 * Receita — a bill of materials that may nest other recipes (a DAG; cycle-guarded).
 * Phase times are ESTIMATES that drive pricing; {@link Batch} actuals true them up (§4.5).
 * @typedef {object} Recipe
 * @property {string}      id
 * @property {string}      name           // "Massa base de bolo"
 * @property {number}      yieldNominal   // units the batch is expected to produce
 * @property {Unit}        yieldUnit      // "un" | "g" | ...
 * @property {Component[]} components
 * @property {number}      activeMinutes  // hands-on  → labor (mao de obra)
 * @property {number}      ovenMinutes    // oven on   → gas
 * @property {number}      fermentMinutes // passive rest/proof (captured, not a cost driver by default)
 */

/**
 * Produto — what is actually sold.
 * @typedef {object} Product
 * @property {string} id
 * @property {string} name           // "Bolo de cenoura com cobertura — 500 g"
 * @property {string} recipeId
 * @property {number} portion        // fraction/multiple of one recipe yield
 * @property {number} packagingCost  // BRL per unit (embalagem)
 */

// ── Events (append-only, immutable; §2.2) ──

/**
 * Preco — an ingredient price as of a point in time. BRL per the ingredient's stockUnit.
 * @typedef {object} PriceChange
 * @property {string}  id
 * @property {string}  at            // ISO date
 * @property {string}  ingredientId
 * @property {number}  price         // BRL per stockUnit
 */

/**
 * Fornada — a production run. Logs ACTUAL yield; phase times default to the recipe
 * estimate when omitted (Nayara's daily input stays trivial — units + active minutes).
 * @typedef {object} Batch
 * @property {string}  id
 * @property {string}  at             // ISO date
 * @property {string}  recipeId
 * @property {number}  yieldActual    // units that actually came out (<> nominal when something fails)
 * @property {number} [activeMinutes] // logged actual; defaults to recipe estimate if omitted
 * @property {number} [ovenMinutes]   // logged actual; defaults to recipe estimate if omitted
 */

/**
 * Venda — a sale. Snapshots cost + fee so historical margin stays true.
 * @typedef {object} Sale
 * @property {string}  id
 * @property {string}  at
 * @property {string}  productId
 * @property {number}  qty
 * @property {number}  unitPrice       // price actually charged
 * @property {number}  paymentFeePct   // snapshotted at time of sale
 * @property {number}  costSnapshot    // unit cost at time of sale
 * @property {string} [channel]        // single optional tag in v0.1
 */

/**
 * The engine config — a SINGLE internal object, never exposed to Nayara (§4.3).
 * MEI-specific: `das` is a fixed monthly amount living in the fixed pool, never in
 * the markup divisor.
 * @typedef {object} Config
 * @property {number} valorHora              // BRL per HOUR of hands-on time
 * @property {number} taxaGas                // BRL per MINUTE of oven time
 * @property {number} custosFixosMes         // monthly fixed-cost pool (includes `das`)
 * @property {number} targetMarginPct        // 0..1, goes in the markup divisor
 * @property {number} paymentFeePct          // 0..1, goes in the markup divisor
 * @property {number} expectedActiveMinutesMonth // pricing-lens rateio denominator
 * @property {'active-time'|'total-time'} [rateioBase] // default 'active-time' (§4.3; 'per-unit' deferred)
 */

export {}; // types-only module
