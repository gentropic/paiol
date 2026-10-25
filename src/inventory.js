import { convert } from './units.js';
import { isBundleProduct } from './bundles.js';

const add = (target, source, factor = 1) => {
  for (const [id, qty] of source) target.set(id, (target.get(id) || 0) + qty * factor);
  return target;
};

/** Ingredient quantities in stock units consumed by one yield-unit of a recipe. */
export function recipeIngredientUsage(store, recipeId, stack = new Set()) {
  const recipe = store.get('recipes', recipeId);
  if (!recipe || stack.has(recipeId) || !(Number(recipe.yieldNominal) > 0)) return new Map();
  stack.add(recipeId);
  const result = new Map();
  for (const component of recipe.components || []) {
    if (component.ref?.kind === 'ingredient') {
      const ingredient = store.get('ingredients', component.ref.id);
      if (!ingredient) continue;
      try {
        const stockQty = convert(Number(component.qty) || 0, component.unit, ingredient.stockUnit, ingredient.conversions);
        result.set(ingredient.id, (result.get(ingredient.id) || 0) + stockQty / Number(recipe.yieldNominal));
      } catch { /* incompatible legacy unit: do not invent a stock movement */ }
    } else if (component.ref?.kind === 'recipe') {
      const nested = store.get('recipes', component.ref.id);
      if (!nested) continue;
      try {
        const nestedYieldUnits = convert(Number(component.qty) || 0, component.unit, nested.yieldUnit);
        add(result, recipeIngredientUsage(store, nested.id, stack), nestedYieldUnits / Number(recipe.yieldNominal));
      } catch { /* incompatible legacy unit */ }
    }
  }
  stack.delete(recipeId);
  return result;
}

/** Ingredient quantities in stock units consumed by one produced unit of a product. */
export function productIngredientUsage(store, productId, stack = new Set()) {
  const product = store.get('products', productId);
  if (!product || stack.has(productId)) return new Map();
  stack.add(productId);
  const result = new Map();
  for (const component of product.components || []) {
    const qty = Number(component.qty) || 0;
    if (component.kind === 'recipe') add(result, recipeIngredientUsage(store, component.id), qty);
    // Bundle children appear as separate produced rows in the comanda. Only its physical
    // packaging/details are consumed on the parent row, preventing duplicate stock usage.
    else if (component.kind === 'product' && !isBundleProduct(product)) add(result, productIngredientUsage(store, component.id, stack), qty);
    else if (component.kind === 'ingredient') result.set(component.id, (result.get(component.id) || 0) + qty);
  }
  stack.delete(productId);
  return result;
}

/** Current ingredient stock. Sales never enter this calculation. */
export function inventorySummary(store) {
  const purchased = new Map();
  for (const purchase of store.state.purchases || []) {
    for (const item of purchase.items || []) purchased.set(item.ingredientId, (purchased.get(item.ingredientId) || 0) + (Number(item.qty) || 0));
  }
  const producedUsage = new Map();
  for (const command of store.state.comandas || []) for (const item of command.itens || []) {
    const produced = Number(item.realizado) || 0;
    if (produced > 0) {
      const usage = item.ingredientUsagePerUnit
        ? new Map(Object.entries(item.ingredientUsagePerUnit).filter(([, qty]) => Number.isFinite(Number(qty))).map(([id, qty]) => [id, Number(qty)]))
        : productIngredientUsage(store, item.productId);
      add(producedUsage, usage, produced);
    }
  }
  const lost = new Map();
  for (const loss of store.state.perdas || []) {
    if (store.isReversed('perda', loss.id) || loss.refKind !== 'insumo' || !loss.refId) continue;
    lost.set(loss.refId, (lost.get(loss.refId) || 0) + (Number(loss.qty) || 0));
  }
  const adjustments = new Map();
  for (const adjustment of store.state.inventoryAdjustments || []) {
    if (store.isReversed('inventoryAdjustment', adjustment.id)) continue;
    const delta = Number(adjustment.delta);
    if (!Number.isFinite(delta)) continue;
    adjustments.set(adjustment.ingredientId, (adjustments.get(adjustment.ingredientId) || 0) + delta);
  }
  return (store.state.ingredients || []).map((ingredient) => {
    const opening = Number(ingredient.stockQty) || 0;
    const purchases = purchased.get(ingredient.id) || 0;
    const production = producedUsage.get(ingredient.id) || 0;
    const losses = lost.get(ingredient.id) || 0;
    const adjustment = adjustments.get(ingredient.id) || 0;
    const current = opening + purchases - production - losses + adjustment;
    const minimum = Math.max(0, Number(ingredient.minStockQty) || 0);
    // A missing minimum must not hide an impossible negative balance. Small floating-point
    // residue is ignored so conversions do not create a false shortage warning.
    return { ingredient, opening, purchases, production, losses, adjustment, current, minimum, low: current < -0.000001 || (minimum > 0 && current <= minimum) };
  });
}

export function ingredientInventory(store, ingredientId) {
  return inventorySummary(store).find((row) => row.ingredient.id === ingredientId) || null;
}
