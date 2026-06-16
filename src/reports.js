// paiol — reporting aggregations (§4.5 actuals, period view). Pure functions over a PaiolStore;
// no DOM, no I/O — unit-testable. The UI (Relatórios tab) renders these.
//
// Money model note: `costSnapshot` on a sale is the FULL unit cost at sale time, which already
// includes the rateio'd share of fixed costs (paiol folds fixed into the unit cost). So the
// per-sale margin summed here already accounts for fixed costs proportionally; `custosFixosMes`
// is shown separately only as a reference figure, not subtracted again.

const ym = (iso) => String(iso || '').slice(0, 7); // 'YYYY-MM'

/**
 * P&L summary for a month ('YYYY-MM'): revenue, product cost, payment fees, profit, margin, and
 * hours worked (from that month's batches) with profit-per-hour.
 * @param {import('./store.js').PaiolStore} store
 * @param {string} month
 */
export function monthSummary(store, month) {
  const sales = store.state.sales.filter((s) => ym(s.at) === month && !store.isReversed('sale', s.id));
  let receita = 0; let custo = 0; let taxas = 0; let unidades = 0;
  for (const s of sales) {
    const rev = s.qty * s.unitPrice;
    receita += rev;
    custo += s.qty * s.costSnapshot;
    taxas += rev * (s.paymentFeePct || 0);
    unidades += s.qty;
  }
  // Ad-hoc deductions logged for the month (Rev 03): variable costs + losses. These are NOT in
  // costSnapshot (which carries CMV/labor/gas/fixed), so they are additive to the deductions.
  const custoVariavel = (store.state.variableCosts || []).reduce((acc, v) => (ym(v.at) === month && !store.isReversed('variableCost', v.id) ? acc + (v.amount || 0) : acc), 0);
  const perdas = (store.state.perdas || []).reduce((acc, p) => (ym(p.at) === month && !store.isReversed('perda', p.id) ? acc + (p.amount || 0) : acc), 0);
  const lucro = receita - custo - taxas - custoVariavel - perdas;

  let minutos = 0;
  for (const b of store.state.batches) {
    if (ym(b.at) !== month || store.isReversed('batch', b.id)) continue;
    const r = store.get('recipes', b.recipeId);
    minutos += b.activeMinutes ?? r?.activeMinutes ?? 0;
  }
  const horas = minutos / 60;

  return {
    month, receita, custo, taxas, custoVariavel, perdas, lucro, unidades, nVendas: sales.length, horas,
    margem: receita > 0 ? lucro / receita : 0,
    lucroHora: horas > 0 ? lucro / horas : null,
  };
}

/**
 * Per-product totals for a month, sorted by revenue desc: [{ id, name, qty, receita, lucro }].
 * @param {import('./store.js').PaiolStore} store @param {string} month
 */
export function productSummary(store, month) {
  const map = new Map();
  for (const s of store.state.sales) {
    if (ym(s.at) !== month || store.isReversed('sale', s.id)) continue;
    const e = map.get(s.productId) || { qty: 0, receita: 0, lucro: 0 };
    const rev = s.qty * s.unitPrice;
    e.qty += s.qty;
    e.receita += rev;
    e.lucro += rev - s.qty * s.costSnapshot - rev * (s.paymentFeePct || 0);
    map.set(s.productId, e);
  }
  return [...map.entries()]
    .map(([id, e]) => ({ id, name: store.get('products', id)?.name || '(produto removido)', ...e }))
    .sort((a, b) => b.receita - a.receita);
}

/**
 * The `n` month keys ending at `month` (oldest first). Deterministic — no "now" dependency.
 * @param {string} month 'YYYY-MM' @param {number} n
 * @returns {string[]}
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

/** Profit (lucro) per month over a trailing window, for the trend chart. */
export function profitTrend(store, month, n = 6) {
  return monthsEndingAt(month, n).map((mo) => {
    const s = monthSummary(store, mo);
    return { month: mo, receita: s.receita, lucro: s.lucro };
  });
}
