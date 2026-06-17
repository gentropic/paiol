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
 * @property {string}       [lastSupplier] // fornecedor da última compra (free text)
 * @property {string[]}     [tags]         // etiquetas (ex.: "revenda", "festa") — busca/filtro
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
 * @property {string}     [notes]         // observacao / modo de preparo (free text, not costed)
 * @property {number}     [weightTotal]   // optional peso total do lote — enables per-kg quoting (D1)
 * @property {Unit}       [weightUnit]    // "g" | "kg" — unit of weightTotal
 * @property {string[]}   [tags]          // etiquetas
 */

/**
 * A line in a product's bill of materials — a recipe, a sub-product (cestas/kits), or a bought
 * ingredient (finished item priced via the insumos registry). `qty` is in the referenced thing's
 * natural unit: recipe → its yield-unit; product → a count; ingredient → its stockUnit.
 * @typedef {object} ProductComponent
 * @property {'recipe' | 'product' | 'ingredient'} kind
 * @property {string} id
 * @property {number} qty
 */

/**
 * Produto — what is actually sold. A product is a bill of materials (cestas/kits/combos), so it
 * may roll up recipes, other products, and bought ingredients. A simple one-recipe product is
 * just a single `recipe` component. Cost = sum of components + packaging.
 * @typedef {object} Product
 * @property {string}             id
 * @property {string}             name          // "Bolo de cenoura — 500 g", "Cesta de Natal"
 * @property {ProductComponent[]} components
 * @property {number}             packagingCost // BRL per unit (embalagem)
 * @property {string}            [packagingDesc] // ex.: boleira, pacote, tubo, lata
 * @property {number}            [targetMarginPct] // optional per-product margin override (0..1); falls back to Config
 * @property {string[]}          [tags]          // etiquetas
 * // Legacy shape (recipeId + portion) is migrated to a single `recipe` component on load.
 */

/**
 * Cliente — a customer (Rev 04). Most are recurring, so the cadastro speeds order entry, and
 * encomendas attach to a client to build the printable ficha/histórico de compras.
 * @typedef {object} Cliente
 * @property {string}  id
 * @property {string}  name        // nome
 * @property {string} [phone]      // telefone
 * @property {string} [address]    // endereço
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
 * Custo variável — a dated, ad-hoc expense (Rev 03 #4): logged as it happens, deducted from the
 * period profit. Not part of a product's unit cost (those are the recipe/insumo costs); this is
 * for things like delivery fuel, an extra bag, a one-off purchase.
 * @typedef {object} VariableCost
 * @property {string}  id
 * @property {string}  at           // ISO date
 * @property {number}  amount       // BRL
 * @property {string} [description] // ex.: "gasolina entrega", "sacola extra"
 */

/**
 * Perda — a loss/write-off (Rev 03 #3): value lost to waste (a failed batch, an unsold product,
 * damaged packaging). `amount` is the BRL value lost, snapshotted at log time; the optional ref/qty
 * are for the record. Deducted from the period profit.
 * @typedef {object} Perda
 * @property {string}  id
 * @property {string}  at          // ISO date
 * @property {number}  amount      // BRL value lost (snapshot)
 * @property {'insumo'|'produto'|'embalagem'|'outro'} [refKind]
 * @property {string} [refId]      // ingredient/product id when applicable
 * @property {number} [qty]
 * @property {string} [note]       // free description
 */

/**
 * Estorno — a reversal of a prior append-only event (Rev 03). Append-only itself, so the original
 * stays in the history (audit trail) but no longer counts. `kind` + `refId` point at the reversed
 * event.
 * @typedef {object} Reversal
 * @property {string} id
 * @property {string} at
 * @property {'sale'|'batch'|'variableCost'|'perda'} kind
 * @property {string} refId
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
