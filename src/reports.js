// paiol — reporting aggregations (Rev 06: CASH BASIS). Pure functions over a PaiolStore; no DOM,
// no I/O — unit-testable. The UI (Relatórios) renders these.
//
// The monthly RESULT is a pure cash ledger and NEVER uses the recipe/product unit cost (that lives
// only in pricing — Preços/Simulador). This separation is what guarantees no double-counting (§9):
//   Saldo operacional de caixa = Receitas recebidas − pagamentos realizados.
// Perdas sem pagamento no momento do registro não saem do caixa; ficam como indicador gerencial
// de produção. Isso evita contar novamente o valor de um insumo cuja compra já foi paga.
// Receita is recognized when RECEIVED (walk-up sales are paid on the spot; encomenda payments when
// they land); despesas/perdas when lançadas. The per-PRODUCT analysis (productSummary) DOES use the
// recipe cost — but ONLY as an ESTIMATE for "which products earn most" (a decision tool), never in
// the cash result.

import { estimateLens, productUnitCost } from './cost-engine.js';

const ym = (iso) => String(iso || '').slice(0, 7); // 'YYYY-MM'
const day = (iso) => String(iso || '').slice(0, 10);
const inPeriod = (iso, start, end) => (!start || day(iso) >= start) && (!end || day(iso) <= end);

/**
 * Cash-basis monthly result + reference figures.
 * @param {import('./store.js').PaiolStore} store @param {string} month 'YYYY-MM'
 */
export function monthSummary(store, month) {
  // Receitas recebidas: walk-up sales (paid on the spot) + encomenda payments that landed this month.
  let recebidoVendas = 0; let unidades = 0;
  for (const s of store.state.sales) {
    if (ym(s.at) !== month || store.isReversed('sale', s.id)) continue;
    recebidoVendas += s.qty * s.unitPrice;
    unidades += s.qty;
  }
  let recebidoPagamentos = 0;
  for (const pg of store.state.payments) {
    if (ym(pg.at) !== month || store.isReversed('payment', pg.id)) continue;
    recebidoPagamentos += pg.valor || 0;
  }
  let recebidoOutrasReceitas = 0;
  for (const income of store.state.incomes || []) {
    if (ym(income.at) !== month || store.isReversed('income', income.id)) continue;
    recebidoOutrasReceitas += income.valor || 0;
  }
  let recebidoFinanceiro = 0;
  for (const st of store.state.financeSettlements || []) {
    if (ym(st.at) !== month || store.isReversed('financeSettlement', st.id)) continue;
    const title = store.get('financeTitles', st.titleId);
    if (title?.direction === 'receber') recebidoFinanceiro += st.amount || 0;
  }
  const recebido = recebidoVendas + recebidoPagamentos + recebidoOutrasReceitas + recebidoFinanceiro;

  // Despesas lançadas this month, split by the category's kind (default → variável).
  let despVar = 0; let despFix = 0; let custos = 0;
  for (const d of store.state.despesas) {
    if (ym(d.at) !== month || store.isReversed('despesa', d.id)) continue;
    const kind = store.get('categories', d.categoryId)?.kind;
    if (kind === 'despesaFixa') despFix += d.valor || 0;
    else if (kind === 'custo') custos += d.valor || 0;
    else despVar += d.valor || 0;
  }
  // Legacy ad-hoc variable costs (pre-Rev 06) fold into variável so nothing is lost.
  for (const v of store.state.variableCosts) {
    if (ym(v.at) === month && !store.isReversed('variableCost', v.id)) despVar += v.amount || 0;
  }
  let pagoFinanceiro = 0;
  for (const st of store.state.financeSettlements || []) {
    if (ym(st.at) !== month || store.isReversed('financeSettlement', st.id)) continue;
    const title = store.get('financeTitles', st.titleId); if (title?.direction !== 'pagar') continue;
    const category = store.get('categories', title.categoryId); const value = st.amount || 0;
    pagoFinanceiro += value;
    if (category?.nature === 'custo' || category?.kind === 'custo') custos += value;
    else if (category?.kind === 'despesaFixa' || category?.behavior === 'fixa') despFix += value;
    else despVar += value;
  }
  let perdas = 0;
  for (const p of store.state.perdas) {
    if (ym(p.at) === month && !store.isReversed('perda', p.id)) perdas += p.amount || 0;
  }
  const despesas = despVar + despFix + custos;
  const saldoCaixa = recebido - despesas;
  const lucro = saldoCaixa; // alias legado; a interface usa o nome correto "saldo de caixa".

  // Reference (accrual): what you sold/delivered this month, and what is still owed (current total).
  let faturado = recebidoVendas; // walk-up sales are also "faturado" in their month
  for (const e of store.state.encomendas) if (!e.desistenciaAt && ym(e.deliveryDate) === month) faturado += e.total || 0;
  let aReceber = 0;
  for (const e of store.state.encomendas) {
    if (e.desistenciaAt) continue;
    const saldo = (e.total || 0) - store.paidFor(e.id);
    if (saldo > 0.005) aReceber += saldo;
  }
  for (const t of store.state.financeTitles || []) {
    if (t.direction !== 'receber' || t.sourceType === 'encomenda' || t.cancelledAt) continue;
    const saldo = (t.amount || 0) - store.settledFor(t.id);
    if (saldo > 0.005) aReceber += saldo;
  }

  return {
    month, recebido, recebidoVendas, recebidoPagamentos, recebidoOutrasReceitas, recebidoFinanceiro,
    despVar, despFix, custos, pagoFinanceiro, perdas, despesas, saldoCaixa, lucro,
    faturado, aReceber, unidades,
    margem: recebido > 0 ? lucro / recebido : 0,
  };
}

/** Despesas grouped by category for the month, biggest first; folds legacy costs into a bucket. */
export function despesasByCategory(store, month) {
  const map = new Map();
  for (const d of store.state.despesas) {
    if (ym(d.at) !== month || store.isReversed('despesa', d.id)) continue;
    map.set(d.categoryId, (map.get(d.categoryId) || 0) + (d.valor || 0));
  }
  for (const st of store.state.financeSettlements || []) {
    if (ym(st.at) !== month || store.isReversed('financeSettlement', st.id)) continue;
    const title = store.get('financeTitles', st.titleId);
    if (title?.direction !== 'pagar') continue;
    map.set(title.categoryId || '__sem__', (map.get(title.categoryId || '__sem__') || 0) + (st.amount || 0));
  }
  const rows = [...map.entries()].map(([id, total]) => {
    const c = store.get('categories', id);
    return { id, name: c?.name || '(sem categoria)', kind: c?.kind || 'despesaVariavel', total };
  });
  let legacy = 0;
  for (const v of store.state.variableCosts) if (ym(v.at) === month && !store.isReversed('variableCost', v.id)) legacy += v.amount || 0;
  if (legacy > 0) rows.push({ id: '__legacy__', name: 'Outras (lançamentos antigos)', kind: 'despesaVariavel', total: legacy });
  return rows.sort((a, b) => b.total - a.total);
}

/**
 * Per-product analysis for the month (walk-up sales + encomenda items delivered this month):
 * [{ id, name, qty, faturamento, lucroEstimado }]. `lucroEstimado` uses the recipe unit cost as an
 * ESTIMATE (decision tool — "which products earn most"); it is NOT the cash result. Caller sorts.
 */
export function productSummary(store, month) {
  const config = store.getConfig();
  const es = store.toEngineStore();
  const lens = estimateLens(config);
  const unitCost = (pid) => { try { return productUnitCost(es, pid, config, lens); } catch { return 0; } };
  const map = new Map();
  const add = (pid, qty, revenue) => {
    const e = map.get(pid) || { qty: 0, faturamento: 0, custoEst: 0 };
    e.qty += qty; e.faturamento += revenue; e.custoEst += qty * unitCost(pid);
    map.set(pid, e);
  };
  for (const s of store.state.sales) {
    if (ym(s.at) !== month || store.isReversed('sale', s.id)) continue;
    add(s.productId, s.qty, s.qty * s.unitPrice);
  }
  for (const e of store.state.encomendas) {
    if (e.desistenciaAt || ym(e.deliveryDate) !== month) continue;
    for (const it of e.itens || []) add(it.productId, it.qty || 0, (it.qty || 0) * (it.unitPrice || 0));
  }
  return [...map.entries()].map(([id, e]) => ({
    id, name: store.get('products', id)?.name || '(produto removido)',
    qty: e.qty, faturamento: e.faturamento, lucroEstimado: e.faturamento - e.custoEst,
  }));
}

/** Per-client totals for the month (from encomendas delivered), biggest spender first. */
export function clientSummary(store, month) {
  const map = new Map();
  for (const e of store.state.encomendas) {
    if (e.desistenciaAt || ym(e.deliveryDate) !== month) continue;
    const key = e.clienteId || '__sem__';
    const c = map.get(key) || { total: 0, recebido: 0, n: 0 };
    c.total += e.total || 0; c.recebido += store.paidFor(e.id); c.n += 1;
    map.set(key, c);
  }
  return [...map.entries()].map(([id, c]) => ({
    id, name: id === '__sem__' ? 'Sem cliente' : (store.get('clients', id)?.name || '(removido)'),
    total: c.total, recebido: c.recebido, saldo: c.total - c.recebido, n: c.n,
  })).sort((a, b) => b.total - a.total);
}

/**
 * The `n` month keys ending at `month` (oldest first). Deterministic — no "now" dependency.
 * @param {string} month 'YYYY-MM' @param {number} n @returns {string[]}
 */
export function monthsEndingAt(month, n) {
  const [y, m] = month.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, (m - 1) - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Recebido + lucro per month over a trailing window, for the evolution chart. */
export function revenueTrend(store, month, n = 6) {
  return monthsEndingAt(month, n).map((mo) => {
    const s = monthSummary(store, mo);
    return { month: mo, recebido: s.recebido, lucro: s.lucro };
  });
}

/**
 * Commercial decision indicators for an inclusive period. Sales volume is recognized on the sale
 * date (walk-up) or scheduled delivery date (orders). Margins are estimates using the current
 * technical sheet; they are deliberately separate from realized cash.
 */
export function businessPeriodSummary(store, start, end) {
  const config = store.getConfig();
  const es = store.toEngineStore();
  const lens = estimateLens(config);
  const productCosts = new Map();
  const unitCost = (id) => {
    if (productCosts.has(id)) return productCosts.get(id);
    let value = null;
    const product = store.get('products', id);
    try { if ((product?.components || []).length) value = productUnitCost(es, id, config, lens); } catch { /* incomplete technical sheet */ }
    productCosts.set(id, value); return value;
  };
  // Only active catalog items count as "without sales". An inactive item is still added below if
  // it has a historical sale in this period, preserving the truth of past reports and rankings.
  const products = new Map(store.state.products.filter((p) => p.active !== false).map((p) => [p.id, { id: p.id, name: p.name, qty: 0, revenue: 0, cost: 0, fees: 0, costKnown: true }]));
  const clients = new Map();
  const addProduct = (id, qty, revenue, feePct) => {
    const product = store.get('products', id);
    const row = products.get(id) || { id, name: product?.name || '(produto removido)', qty: 0, revenue: 0, cost: 0, fees: 0, costKnown: true };
    const cost = unitCost(id);
    row.qty += Number(qty) || 0; row.revenue += Number(revenue) || 0; row.fees += (Number(revenue) || 0) * (Number(feePct) || 0);
    if (cost == null) row.costKnown = false; else row.cost += (Number(qty) || 0) * cost;
    products.set(id, row);
  };
  for (const sale of store.state.sales) {
    if (store.isReversed('sale', sale.id) || !inPeriod(sale.at, start, end)) continue;
    addProduct(sale.productId, sale.qty, (Number(sale.qty) || 0) * (Number(sale.unitPrice) || 0), sale.paymentFeePct ?? config.paymentFeePct);
  }
  for (const order of store.state.encomendas) {
    if (order.desistenciaAt || !inPeriod(order.deliveryDate, start, end)) continue;
    const clientId = order.clienteId || '__sem__';
    const client = clients.get(clientId) || { id: clientId, orders: 0, total: 0 };
    client.orders += 1; client.total += Number(order.total) || 0; clients.set(clientId, client);
    for (const item of order.itens || []) addProduct(item.productId, item.qty, (Number(item.qty) || 0) * (Number(item.unitPrice) || 0), config.paymentFeePct);
  }
  const productRows = [...products.values()].map((row) => {
    const profit = row.costKnown ? row.revenue - row.cost - row.fees : null;
    return { ...row, profit, marginPct: profit != null && row.revenue > 0 ? profit / row.revenue : null };
  });
  const sold = productRows.filter((p) => p.qty > 0).sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
  const marginKnown = sold.filter((p) => p.marginPct != null).sort((a, b) => b.marginPct - a.marginPct);
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const isBasket = (row) => {
    const product = store.get('products', row.id);
    const label = normalize(`${row.name} ${(product?.tags || []).join(' ')}`);
    return /(^|\s)(cesta|kit|combo)(\s|$)/.test(label) || (product?.components || []).some((c) => c.kind === 'product');
  };
  const baskets = sold.filter(isBasket);
  const clientRows = [...clients.values()].map((row) => ({ ...row, name: row.id === '__sem__' ? 'Sem cliente' : (store.get('clients', row.id)?.name || '(cliente removido)') }));
  return {
    start, end,
    mostFrequentClient: clientRows.slice().sort((a, b) => b.orders - a.orders || b.total - a.total)[0] || null,
    highestValueClient: clientRows.slice().sort((a, b) => b.total - a.total || b.orders - a.orders)[0] || null,
    mostSoldProduct: sold[0] || null,
    leastSoldProduct: sold.slice().sort((a, b) => a.qty - b.qty || a.revenue - b.revenue)[0] || null,
    bestMarginProduct: marginKnown[0] || null,
    worstMarginProduct: marginKnown[marginKnown.length - 1] || null,
    baskets,
    basketQty: baskets.reduce((sum, p) => sum + p.qty, 0),
    basketRevenue: baskets.reduce((sum, p) => sum + p.revenue, 0),
    productsWithoutSales: productRows.filter((p) => p.qty <= 0).length,
    soldProducts: sold,
    clients: clientRows,
  };
}

/**
 * Managerial sales report for an inclusive date period. Orders are sales; legacy walk-up sales are
 * preserved and treated as received on the spot. Delivery and payment are intentionally unrelated.
 * `status`: todos | recebidos | naorecebidos | desistencias.
 */
export function salesPeriodSummary(store, start, end, status = 'todos') {
  const cancellations = [];
  for (const e of store.state.encomendas) {
    if (!e.desistenciaAt || !inPeriod(e.desistenciaAt, start, end)) continue;
    cancellations.push({
      kind: 'encomenda', id: e.id, at: e.desistenciaAt, order: e,
      clientId: e.clienteId || '__sem__', total: Number(e.total) || 0,
    });
  }
  for (const s of store.state.sales) {
    if (!store.isReversed('sale', s.id) || !inPeriod(s.at, start, end)) continue;
    cancellations.push({ kind: 'sale', id: s.id, at: s.at, sale: s, clientId: '__sem__', total: (Number(s.qty) || 0) * (Number(s.unitPrice) || 0) });
  }
  cancellations.sort((a, b) => (a.at < b.at ? 1 : -1));

  if (status === 'desistencias') {
    return {
      start, end, status, rows: [], clients: [], products: [], cancellations,
      totalVendido: 0, totalRecebido: 0, totalPendente: 0,
      totalDesistencias: cancellations.reduce((sum, x) => sum + x.total, 0),
    };
  }

  const rows = [];
  for (const e of store.state.encomendas) {
    if (e.desistenciaAt || !inPeriod(e.deliveryDate, start, end)) continue;
    const total = Number(e.total) || 0;
    const received = Math.min(total, Math.max(0, store.paidFor(e.id)));
    const pending = Math.max(0, total - received);
    const paid = pending <= 0.005;
    if (status === 'recebidos' && !paid) continue;
    if (status === 'naorecebidos' && paid) continue;
    rows.push({ kind: 'encomenda', id: e.id, at: e.deliveryDate, order: e, clientId: e.clienteId || '__sem__', total, received, pending, paid });
  }
  for (const s of store.state.sales) {
    if (store.isReversed('sale', s.id) || !inPeriod(s.at, start, end) || status === 'naorecebidos') continue;
    const total = (Number(s.qty) || 0) * (Number(s.unitPrice) || 0);
    rows.push({ kind: 'sale', id: s.id, at: s.at, sale: s, clientId: '__sem__', total, received: total, pending: 0, paid: true });
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : -1));

  const clients = new Map();
  const products = new Map();
  const addClient = (id, total, received, pending) => {
    const c = clients.get(id) || { id, total: 0, received: 0, pending: 0, orders: 0 };
    c.total += total; c.received += received; c.pending += pending; c.orders += 1; clients.set(id, c);
  };
  const addProduct = (id, qty, total) => {
    const p = products.get(id) || { id, qty: 0, total: 0 };
    p.qty += qty; p.total += total; products.set(id, p);
  };
  for (const row of rows) {
    addClient(row.clientId, row.total, row.received, row.pending);
    if (row.kind === 'encomenda') {
      for (const it of row.order.itens || []) addProduct(it.productId, Number(it.qty) || 0, (Number(it.qty) || 0) * (Number(it.unitPrice) || 0));
    } else addProduct(row.sale.productId, Number(row.sale.qty) || 0, row.total);
  }

  return {
    start, end, status, rows, cancellations,
    totalVendido: rows.reduce((sum, x) => sum + x.total, 0),
    totalRecebido: rows.reduce((sum, x) => sum + x.received, 0),
    totalPendente: rows.reduce((sum, x) => sum + x.pending, 0),
    totalDesistencias: cancellations.reduce((sum, x) => sum + x.total, 0),
    clients: [...clients.values()].map((c) => ({ ...c, name: c.id === '__sem__' ? 'Sem cliente' : (store.get('clients', c.id)?.name || '(cliente removido)') })).sort((a, b) => b.total - a.total),
    products: [...products.values()].map((p) => ({ ...p, name: store.get('products', p.id)?.name || '(produto removido)' })).sort((a, b) => b.total - a.total),
  };
}
