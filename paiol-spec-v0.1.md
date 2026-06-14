# paiol — spec v0.1

Cost, recipe, and sales management for a Brazilian confeitaria operating as **MEI**.
Built for **Quitutes do Paiol** (João Monlevade, MG). Single user (Nayara) for now.
License: CC0 / MIT. Part of the GCU ecosystem.

> シングルファイルデプロイ — one HTML file, browser as runtime, zero dependencies, auditable forever.

---

## 0. What it is

A tool that answers three questions honestly: *what does each thing cost to make, what should I charge, and am I actually making money?* It does this for a maker who is non-technical, usually on a phone, and whose business is a formalized MEI (CNPJ on record).

It is **not** a multi-tenant SaaS, not an accounting package, and not a storefront. "Public" here means *clean enough to share*, not *generalized for arbitrary users*. The course/multi-user arc is explicitly out of scope (§7).

---

## 1. Principles

- **Local-first.** IndexedDB on the device is the source of truth. The UI never blocks on the network. Dropbox is durable backup + cross-device sync, not the live read path.
- **Event-sourced / auditable-forever.** Money-relevant facts (prices, sales, production) are append-only immutable events. Master data is small and mutable. Nothing is silently rewritten; history stays *true*.
- **Estimate for decisions, actuals for truth.** Every allocation has two lenses: an estimate that drives pricing, and a retrospective true-up from logged events that reports reality. This is the spine of the whole engine (§4.5).
- **Zero-dependency, fetch-only.** No Dropbox SDK, no framework runtime. Dropbox is reached over plain HTTP with `fetch`. The whole thing is a single deployable file.
- **English identifiers, PT-BR surface.** Code/schema names are English (`Ingredient`, `Batch`, `Sale`). Every label Nayara sees is Portuguese (`Insumo`, `Fornada`, `Venda`).

---

## 2. Domain model

### 2.1 Master data (mutable)

```ts
// Ingredient — "Insumo"
interface Ingredient {
  id: string;
  name: string;            // "Farinha de trigo"
  stockUnit: Unit;         // unit it is bought/priced in (e.g. kg)
  // current price is derived from the latest PriceChange event (§2.2)
  conversions?: Conversion[]; // e.g. 1 ovo = 50 g, 1 xícara farinha = 120 g
}

// Recipe — "Receita". A bill of materials that may nest other recipes.
interface Recipe {
  id: string;
  name: string;            // "Massa base de bolo"
  yieldNominal: number;    // units the batch is expected to produce
  yieldUnit: Unit;         // un | g | …
  components: Component[]; // ingredients and/or sub-recipes
  // phase-time ESTIMATES (drive pricing; trued up by Batch actuals §4.5)
  activeMinutes: number;   // hands-on
  ovenMinutes: number;     // oven on  → gas
  fermentMinutes: number;  // passive rest/proof (captured, not a cost driver by default)
}

interface Component {
  ref: { kind: "ingredient" | "recipe"; id: string };
  qty: number;
  unit: Unit;
}

// Product — "Produto". What is actually sold.
interface Product {
  id: string;
  name: string;            // "Bolo de cenoura com cobertura — 500 g"
  recipeId: string;
  portion: number;         // fraction/multiple of one recipe yield
  packagingCost: number;   // BRL per unit (embalagem)
}
```

**Recipe nesting is a DAG.** A bolo = massa + recheio + cobertura, each reusable. Cost roll-up traverses the graph with a **cycle guard** (a recipe may not, directly or transitively, contain itself).

### 2.2 Events (append-only)

```ts
interface PriceChange {     // "Preço" — ingredient price over time
  id: string; at: ISODate;
  ingredientId: string;
  price: number;            // BRL per stockUnit
}

interface Batch {           // "Fornada" — a production run
  id: string; at: ISODate;
  recipeId: string;
  yieldActual: number;      // units that actually came out (≠ nominal when something fails)
  activeMinutes?: number;   // logged actual; defaults to recipe estimate if omitted
  ovenMinutes?: number;     // logged actual; defaults to recipe estimate if omitted
  // fermentMinutes rides the recipe estimate; rarely worth logging per batch
}

interface Sale {            // "Venda"
  id: string; at: ISODate;
  productId: string;
  qty: number;
  unitPrice: number;        // price actually charged
  paymentFeePct: number;    // snapshotted at time of sale
  costSnapshot: number;     // unit cost at time of sale, so historical margin stays true
  channel?: string;         // single optional tag in v0.1 (§7)
}
```

**Why events make Dropbox safe:** two devices that both append sales merge as a *union deduped by `id`* — conflicts mostly cannot arise. The auditable-forever instinct is load-bearing, not decoration (§5).

---

## 3. Units & conversions

- Each `Ingredient` has a canonical `stockUnit` (what it is bought and priced in).
- Conversions within a dimension (g↔kg, ml↔l) are built in.
- Cross-dimension or count→mass conversions are **per-ingredient overrides** (`1 ovo = 50 g`, `1 xícara de farinha = 120 g`). This is the detail that kills naïve costing tools; it is first-class here.

---

## 4. Cost engine (MEI)

All costs resolve to **BRL per sellable unit**.

### 4.1 CMV roll-up (ingredient cost)

Traverse the recipe DAG, summing component costs at the chosen price lens (current for repricing; snapshot for historical sales). Divide by **actual** yield where a `Batch` exists, nominal otherwise:

```
cmv_per_unit = cmv_batch / yield
```

Actual-yield awareness means the cookie that burned is paid for by the eleven that survived.

**The roll-up is not ingredients-only — it carries all four cost dimensions.** Because `Batch` events are *per-recipe* (a `massa` fornada logs its own active/oven minutes, and that massa is reused across many bolos), a product's true cost must absorb each sub-recipe's per-unit **labor, gas, and fixed** share too — scaled by the quantity consumed (`sub_per_unit × qty_consumed / yield`). Rolling up only ingredients would silently drop every sub-recipe's baking time and underprice the finished product. So §4.2 and §4.3 below apply at *every* node of the DAG, and the engine sums them up identically to CMV.

### 4.2 Direct costs

Three direct, variable, per-unit costs:

```
ingredients = cmv_per_unit
labor       = valorHora × (activeMinutes / 60) / yield   // mão de obra — hands-on time only
gas         = taxaGas   ×  ovenMinutes        / yield     // oven priced by the minute
```

**Units matter:** `valorHora` is BRL per **hour**, so active minutes are divided by 60; `taxaGas` is BRL per **minute** of oven, applied directly. (Earlier drafts wrote `activeMinutes × valorHora`, which mixed minutes with a per-hour rate — a 60× error, now corrected.)

**Labor is active time, never elapsed.** Fermentation and proofing are not labor — the dough sits while she makes other things. **Gas is a direct cost, removed from the fixed pool** (§4.3); leaving it in both would double-count it.

> Co-baked loads (three trays at once) share oven time. v0.1 accepts the smear or lets her split it manually. Not solved here.

### 4.3 Fixed-cost rateio

Monthly fixed costs — `aluguel`, `internet`, `DAS`, etc. — are pooled and allocated. Because the business is **MEI, the DAS is a fixed monthly amount, not a percentage**, so it lives *in this pool* and never in the markup divisor.

DAS default (2026, comércio/indústria): **R$ 82,05/month** (R$ 81,05 INSS + R$ 1,00 ICMS, 5% of the R$ 1.621 minimum wage). It is a **config value** — it changes with the minimum wage every year and depends on her enquadramento. Verify against an actual guia.

Default allocation base: **active time** (her hands are the scarce capacity, so this coheres with §4.2):

```
fixed_per_unit = custosFixosMes × (activeMinutes/yield) / totalActiveMinutesMonth
```

- **Pricing lens:** `totalActiveMinutesMonth` = expected.
- **Reporting lens:** `totalActiveMinutesMonth` = actual, summed from the month's `Batch` events.

The base is a **single engine config**, never exposed to Nayara. Flip to `total-time` if her real constraint turns out to be space/equipment. (A third `per-unit` base — zero ceremony — is deferred past v0.1; it lacked a coherent denominator without per-recipe volume data.) Because phase times are captured granularly, switching is a **pure recompute** — no migration, no data loss.

### 4.4 Markup / price

```
unitCost = ingredients + labor + gas + fixed_per_unit

price = unitCost / (1 − paymentFeePct − targetMarginPct)
```

Only the payment/PIX/card fee and the target margin go in the divisor. The MEI tax is already absorbed as a fixed cost. That is the clean version of the formula, and it is specific to MEI — Simples Nacional would put a tax % back into the divisor.

### 4.5 The estimate/actuals spine

| Quantity | Estimate (prices) | Actual (reports) |
|---|---|---|
| Yield | `recipe.yieldNominal` | `batch.yieldActual` |
| Active time | `recipe.activeMinutes` | `batch.activeMinutes` |
| Oven time | `recipe.ovenMinutes` | `batch.ovenMinutes` |
| Fixed-cost base total | expected month | summed from batches |
| Sale margin | live unit cost | `sale.costSnapshot` |

Nayara's daily input stays trivial: phase times live as estimates on the recipe; a `Batch` only asks for **active minutes and units produced**. Everything else defaults and trues up on its own.

---

## 5. Sync & storage (Dropbox)

- **Auth:** PKCE OAuth (no client secret in the browser), `token_access_type=offline` for a refresh token. Scoped to an **App folder** (`/Apps/Paiol/`) — the app can only ever see its own data, and the consent screen reads as reassuring rather than alarming.
- **Transport:** plain `fetch` against `api.dropboxapi.com` and `content.dropboxapi.com`. No SDK. シングルファイルデプロイ intact.
- **Write path:** IndexedDB is written synchronously; a debounced background task uploads to Dropbox. Uploads are atomic (Dropbox commits the whole file or nothing) with a **rev-check** to detect a competing write.
- **At-rest format:** `@gcu/yaml` — her entire business is one diffable, forever-readable file.
- **Safety nets:** dated snapshots (`paiol-2026-06.yaml`) so recovery doesn't depend on Dropbox's own version retention; the append-only log makes any merge a union-by-`id`.

---

## 6. Deployment

- **Now:** `gentropic.org/paiol` — single static HTML file on the existing GCU hosting. The OAuth redirect URI must point at the exact callback under that path.
- **Later (only if the courses arc happens):** `gestao.quitutesdopaiol.com` via CNAME.
- **Migration cost:** near zero. Data is anchored to the Dropbox app (app key + `/Apps/Paiol/`), not the URL. A domain move = register the new redirect URI + one re-auth on the new origin. The origin-scoped local cache doesn't carry over, which is harmless because Dropbox is the durable source of truth.

---

## 7. Scope guardrails (v0.1)

In:
- Ingredients, recipes (nested), products, the three event types, the MEI cost engine, Dropbox sync, PT-BR single-user UI.

Out (deferred, not forgotten):
- **Channels:** a single optional `channel` tag and one default payment fee. No per-channel fee matrix yet.
- **Multi-user / accounts / courses:** the `gestao.quitutesdopaiol.com` arc. No multi-tenant anything.
- **Co-baked oven-time apportioning** beyond manual split.
- Note fiscal / NF-e emission, stock/inventory levels, supplier management.

---

## 8. Open questions

1. **Rateio base, empirically:** is Nayara's true bottleneck her hands (→ keep active-time default) or her space/equipment (→ total-time)? Decidable later by recompute.
2. **`valorHora`:** how is her own labor rate set, and is it revisited periodically?
3. **Expected monthly volume** for the pricing-lens rateio: a single number she updates, or derived from a trailing average of actual batches?
4. **Gas rate (`taxaGas`):** derived from botijão price ÷ hours-per-botijão, or a flat estimate she enters?

---

*paiol — GCU Works. CC0 / MIT.*
