// paiol — reporting aggregations (Rev 06: CASH BASIS). Pure functions over a PaiolStore; no DOM,
// no I/O — unit-testable. The UI (Relatórios) renders these.
//
// The monthly RESULT is a pure cash ledger and NEVER uses the recipe/product unit cost (that lives
// only in pricing — Preços/Simulador). This separation is what guarantees no double-counting (§9):
//   Lucro líquido = Receitas recebidas − Despesas Variáveis − Despesas Fixas − Perdas
// Receita is recognized when RECEIVED (walk-up sales are paid on the spot; encomenda payments when
// they land); despesas/perdas when lançadas. The per-PRODUCT analysis (productSummary) DOES use the
// recipe cost — but ONLY as an ESTIMATE for "which products earn most" (a decision tool), never in
// the cash result.

import { estimateLens, productUnitCost } from './cost-engine.js';

const ym = (iso) => String(iso || '').slice(0, 7); // 'YYYY-MM'

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
  const recebido = recebidoVendas + recebidoPagamentos;

  // Despesas lançadas this month, split by the category's kind (default → variável).
  let despVar = 0; let despFix = 0;
  for (const d of store.state.despesas) {
    if (ym(d.at) !== month || store.isReversed('despesa', d.id)) continue;
    if (store.get('categories', d.categoryId)?.kind === 'despesaFixa') despFix += d.valor || 0;
    else despVar += d.valor || 0;
  }
  // Legacy ad-hoc variable costs (pre-Rev 06) fold into variável so nothing is lost.
  for (const v of store.state.variableCosts) {
    if (ym(v.at) === month && !store.isReversed('variableCost', v.id)) despVar += v.amount || 0;
  }
  let perdas = 0;
  for (const p of store.state.perdas) {
    if (ym(p.at) === month && !store.isReversed('perda', p.id)) perdas += p.amount || 0;
  }
  const despesas = despVar + despFix + perdas;
  const lucro = recebido - despesas;

  // Reference (accrual): what you sold/delivered this month, and what is still owed (current total).
  let faturado = recebidoVendas; // walk-up sales are also "faturado" in their month
  for (const e of store.state.encomendas) if (ym(e.deliveryDate) === month) faturado += e.total || 0;
  let aReceber = 0;
  for (const e of store.state.encomendas) {
    const saldo = (e.total || 0) - store.paidFor(e.id);
    if (saldo > 0.005) aReceber += saldo;
  }

  return {
    month, recebido, recebidoVendas, recebidoPagamentos,
    despVar, despFix, perdas, despesas, lucro,
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
    if (ym(e.deliveryDate) !== month) continue;
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
    if (ym(e.deliveryDate) !== month) continue;
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
