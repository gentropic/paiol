// Cestas, kits e combos. O produto "pai" identifica a venda/montagem; os itens internos
// indicam o que precisa ser produzido. Assim o dashboard conta o conjunto uma única vez,
// enquanto a comanda recebe a necessidade operacional completa.

export const PRODUCT_SALE_KINDS = ['normal', 'cesta', 'kit', 'combo'];

export function productSaleKind(product) {
  return PRODUCT_SALE_KINDS.includes(product?.saleKind) ? product.saleKind : 'normal';
}

export function isBundleProduct(product) {
  return productSaleKind(product) !== 'normal';
}

export function bundleKindLabel(product) {
  return ({ cesta: 'Cesta', kit: 'Kit', combo: 'Combo' })[productSaleKind(product)] || 'Produto';
}

/** Catalog composition of one bundle; orders copy it so later catalog edits keep history intact. */
export function bundleProductItems(product) {
  return (product?.components || []).filter((component) => component.kind === 'product' && component.id && Number(component.qty) > 0)
    .map((component) => ({ productId: component.id, qty: Number(component.qty) }));
}

export function orderItemGross(item) {
  return Math.max(0, Number(item?.qty) || 0) * Math.max(0, Number(item?.unitPrice) || 0);
}

export function saleNet(sale) {
  const gross = Math.max(0, Number(sale?.qty) || 0) * Math.max(0, Number(sale?.unitPrice) || 0);
  return Math.max(0, gross - Math.min(gross, Math.max(0, Number(sale?.discount) || 0)));
}

export function orderGross(order) {
  return (order?.itens || []).reduce((sum, item) => sum + orderItemGross(item), 0) + Math.max(0, Number(order?.frete) || 0);
}

export function orderDiscount(order) {
  return Math.min(orderGross(order), Math.max(0, Number(order?.discount) || 0));
}

export function orderNet(order) {
  return Math.max(0, orderGross(order) - orderDiscount(order));
}

/**
 * Unit cost of an order line. The parent product contains only its physical packaging/details;
 * dynamically selected child products are added here once, per bundle.
 */
export function orderItemUnitCost(store, item, unitCost) {
  const parent = store.get('products', item.productId);
  const parentCost = unitCost(item.productId);
  if (parentCost == null) return null;
  let total = Number(parentCost) || 0;
  // The catalog cost includes its standard products. Replace those with the composition
  // saved on this particular order, which may have been customized at the time of sale.
  if (isBundleProduct(parent)) for (const child of bundleProductItems(parent)) {
    const childCost = unitCost(child.productId);
    if (childCost == null) return null;
    total -= child.qty * (Number(childCost) || 0);
  }
  for (const child of item.bundleItems || []) {
    const childCost = unitCost(child.productId);
    if (childCost == null) return null;
    total += (Number(child.qty) || 0) * (Number(childCost) || 0);
  }
  return Math.max(0, total);
}

/**
 * Product requirements created by an order item. A normal product produces itself. A bundle
 * produces its assembly marker and every nested product multiplied by the bundle quantity.
 */
export function orderItemProduction(item, add = new Map()) {
  const parentQty = Math.max(0, Number(item?.qty) || 0);
  if (!item?.productId || !(parentQty > 0)) return add;
  add.set(item.productId, (add.get(item.productId) || 0) + parentQty);
  for (const child of item.bundleItems || []) {
    const qty = parentQty * Math.max(0, Number(child.qty) || 0);
    if (child.productId && qty > 0) add.set(child.productId, (add.get(child.productId) || 0) + qty);
  }
  return add;
}

export function orderProduction(order, add = new Map()) {
  for (const item of order?.itens || []) orderItemProduction(item, add);
  return add;
}

export function bundleCompositionText(store, item) {
  return (item?.bundleItems || []).map((child) => {
    const product = store.get('products', child.productId);
    return `${Number(child.qty) || 0}× ${product?.name || '(produto removido)'}`;
  }).join(', ');
}
