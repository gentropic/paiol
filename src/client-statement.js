// Detailed client financial statement. It joins operational orders with their append-only
// payments and manual receivables without duplicating the finance title generated for an order.

import { titleSettlements, titleState } from './finance.js';
import { bundleCompositionText } from './bundles.js';

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
      const composition = bundleCompositionText(store, item);
      return { productId: item.productId, name: `${product?.name || '(produto removido)'}${composition ? ` (${composition})` : ''}`, qty, unitPrice, total: qty * unitPrice };
    });
    const title = store.state.financeTitles.find((t) => t.sourceType === 'encomenda' && t.sourceId === order.id);
    const state = title ? titleState(store, title) : null;
    const paid = state ? state.paid : Math.max(0, store.paidFor(order.id));
    const total = Number(order.total) || 0;
    allMovements.push({
      id: `order:${order.id}`, type: 'purchase', at: order.deliveryDate || order.at,
      orderId: order.id, description: 'Compra / encomenda', amount: total, items,
      paid: Math.min(total, paid), discounted: state?.discounted || 0, balance: state ? state.balance : Math.max(0, total - paid),
      deliveryMethod: order.deliveryMethod || 'retirada', freight: Number(order.frete) || 0, discount: Number(order.discount) || 0, notes: order.notes,
    });
    for (const payment of store.state.payments.filter((p) => p.encomendaId === order.id && !store.isReversed('payment', p.id))) {
      allMovements.push({
        id: `payment:${payment.id}`, type: 'payment', at: payment.at, orderId: order.id,
        description: `Pagamento da compra de ${statementDate(order.deliveryDate || order.at)}`,
        amount: Number(payment.valor) || 0, method: payment.forma,
      });
    }
    for (const settlement of title ? titleSettlements(store, title).filter((row) => row.kind === 'discount') : []) {
      allMovements.push({ id: `discount:${settlement.id}`, type: 'discount', at: settlement.at, orderId: order.id, description: 'Desconto concedido na quitação', amount: Number(settlement.amount) || 0 });
    }
  }

  // Manually entered receivables belong in the financial statement too. The finance title whose
  // source is an order is deliberately excluded because that order and its payments are above.
  for (const title of store.state.financeTitles.filter((t) => t.direction === 'receber' && t.partyId === clientId && t.sourceType !== 'encomenda' && !t.cancelledAt)) {
    const amount = Number(title.amount) || 0;
    const settlements = titleSettlements(store, title);
    const paid = settlements.filter((row) => row.kind !== 'discount').reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const discounted = settlements.filter((row) => row.kind === 'discount').reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    allMovements.push({
      id: `title:${title.id}`, type: 'charge', at: title.issuedAt || title.competenceDate || title.dueDate,
      titleId: title.id, description: title.description || 'Valor a receber', amount,
      paid: Math.min(amount, paid), discounted, balance: Math.max(0, amount - paid - discounted), dueDate: title.dueDate,
    });
    for (const settlement of settlements) {
      allMovements.push({
        id: `settlement:${settlement.id}`, type: settlement.kind === 'discount' ? 'discount' : 'payment', at: settlement.at, titleId: title.id,
        description: settlement.kind === 'discount' ? 'Desconto concedido na quitação' : `Pagamento de ${title.description || 'valor a receber'}`,
        amount: Number(settlement.amount) || 0, method: settlement.method,
      });
    }
  }

  allMovements.sort((a, b) => String(a.at).localeCompare(String(b.at)) || (a.type === 'payment' ? 1 : -1));
  const movements = allMovements.filter((row) => statementInPeriod(row.at, start, end));
  const charges = (rows) => rows.filter((row) => !['payment', 'discount'].includes(row.type)).reduce((sum, row) => sum + row.amount, 0);
  const payments = (rows) => rows.filter((row) => row.type === 'payment').reduce((sum, row) => sum + row.amount, 0);
  const discounts = (rows) => rows.filter((row) => row.type === 'discount').reduce((sum, row) => sum + row.amount, 0);
  const totalCharged = charges(allMovements);
  const totalPaid = payments(allMovements);

  return {
    client, clientId, start, end, movements,
    periodPurchases: charges(movements),
    periodPayments: payments(movements),
    periodDiscounts: discounts(movements),
    periodBalance: charges(movements) - payments(movements) - discounts(movements),
    totalCharged, totalPaid, totalDiscounted: discounts(allMovements), currentBalance: Math.max(0, totalCharged - totalPaid - discounts(allMovements)),
  };
}
