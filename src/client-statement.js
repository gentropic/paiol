// Detailed client financial statement. It joins operational orders with their append-only
// payments and manual receivables without duplicating the finance title generated for an order.

import { titleSettlements } from './finance.js';

const statementDate = (iso) => String(iso || '').slice(0, 10);
const statementInPeriod = (iso, start, end) => (!start || statementDate(iso) >= start) && (!end || statementDate(iso) <= end);

/**
 * @param {import('./store.js').PaiolStore} store
 * @param {string} clientId
 * @param {string} [start] YYYY-MM-DD; blank means since the first record
 * @param {string} [end] YYYY-MM-DD; blank means through the latest record
 */
export function clientFinancialStatement(store, clientId, start = '', end = '') {
  const client = store.get('clients', clientId) || null;
  const allMovements = [];

  for (const order of store.state.encomendas.filter((e) => e.clienteId === clientId && !e.desistenciaAt)) {
    const items = (order.itens || []).map((item) => {
      const product = store.get('products', item.productId);
      const qty = Number(item.qty) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      return { productId: item.productId, name: product?.name || '(produto removido)', qty, unitPrice, total: qty * unitPrice };
    });
    const paid = Math.max(0, store.paidFor(order.id));
    const total = Number(order.total) || 0;
    allMovements.push({
      id: `order:${order.id}`, type: 'purchase', at: order.deliveryDate || order.at,
      orderId: order.id, description: 'Compra / encomenda', amount: total, items,
      paid: Math.min(total, paid), balance: Math.max(0, total - paid),
      deliveryMethod: order.deliveryMethod || 'retirada', freight: Number(order.frete) || 0, notes: order.notes,
    });
    for (const payment of store.state.payments.filter((p) => p.encomendaId === order.id && !store.isReversed('payment', p.id))) {
      allMovements.push({
        id: `payment:${payment.id}`, type: 'payment', at: payment.at, orderId: order.id,
        description: `Pagamento da compra de ${statementDate(order.deliveryDate || order.at)}`,
        amount: Number(payment.valor) || 0, method: payment.forma,
      });
    }
  }

  // Manually entered receivables belong in the financial statement too. The finance title whose
  // source is an order is deliberately excluded because that order and its payments are above.
  for (const title of store.state.financeTitles.filter((t) => t.direction === 'receber' && t.partyId === clientId && t.sourceType !== 'encomenda' && !t.cancelledAt)) {
    const amount = Number(title.amount) || 0;
    const settlements = titleSettlements(store, title);
    const paid = settlements.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    allMovements.push({
      id: `title:${title.id}`, type: 'charge', at: title.issuedAt || title.competenceDate || title.dueDate,
      titleId: title.id, description: title.description || 'Valor a receber', amount,
      paid: Math.min(amount, paid), balance: Math.max(0, amount - paid), dueDate: title.dueDate,
    });
    for (const settlement of settlements) {
      allMovements.push({
        id: `settlement:${settlement.id}`, type: 'payment', at: settlement.at, titleId: title.id,
        description: `Pagamento de ${title.description || 'valor a receber'}`,
        amount: Number(settlement.amount) || 0, method: settlement.method,
      });
    }
  }

  allMovements.sort((a, b) => String(a.at).localeCompare(String(b.at)) || (a.type === 'payment' ? 1 : -1));
  const movements = allMovements.filter((row) => statementInPeriod(row.at, start, end));
  const charges = (rows) => rows.filter((row) => row.type !== 'payment').reduce((sum, row) => sum + row.amount, 0);
  const payments = (rows) => rows.filter((row) => row.type === 'payment').reduce((sum, row) => sum + row.amount, 0);
  const totalCharged = charges(allMovements);
  const totalPaid = payments(allMovements);

  return {
    client, clientId, start, end, movements,
    periodPurchases: charges(movements),
    periodPayments: payments(movements),
    periodBalance: charges(movements) - payments(movements),
    totalCharged, totalPaid, currentBalance: Math.max(0, totalCharged - totalPaid),
  };
}
