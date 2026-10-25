// A later request for the same registered client and delivery day extends the open order.
// Keep its id so payments, the receivable and the client's history stay attached.
const orderDay = (value) => String(value || '').slice(0, 10);
const amount = (value) => Number(value) || 0;

export function findOpenOrderForClientDate(store, clientId, deliveryDate) {
  if (!clientId || !orderDay(deliveryDate)) return null;
  return store.state.encomendas
    .filter((order) => order.clienteId === clientId && orderDay(order.deliveryDate) === orderDay(deliveryDate) && !order.desistenciaAt && !order.entregue)
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))[0] || null;
}

export function addOrAppendOrder(store, newOrder) {
  const existing = findOpenOrderForClientDate(store, newOrder.clienteId, newOrder.deliveryDate);
  if (!existing) { store.upsertEncomenda(newOrder); return { order: newOrder, appended: false }; }
  const combined = {
    ...existing,
    itens: [...(existing.itens || []), ...(newOrder.itens || [])],
    total: amount(existing.total) + amount(newOrder.total),
    costSnapshot: amount(existing.costSnapshot) + amount(newOrder.costSnapshot),
    materialCostSnapshot: existing.materialCostSnapshot == null || newOrder.materialCostSnapshot == null ? undefined : amount(existing.materialCostSnapshot) + amount(newOrder.materialCostSnapshot),
    packagingCostSnapshot: existing.packagingCostSnapshot == null || newOrder.packagingCostSnapshot == null ? undefined : amount(existing.packagingCostSnapshot) + amount(newOrder.packagingCostSnapshot),
    frete: amount(existing.frete) + amount(newOrder.frete) || undefined,
    discount: amount(existing.discount) + amount(newOrder.discount) || undefined,
    notes: [existing.notes, newOrder.notes].filter(Boolean).join('\n') || undefined,
    urgente: existing.urgente || newOrder.urgente || undefined,
  };
  store.upsertEncomenda(combined);
  return { order: combined, appended: true };
}
