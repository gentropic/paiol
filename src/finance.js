// Paiol — núcleo financeiro. Mantém títulos (obrigações/direitos) separados das baixas
// (dinheiro que efetivamente entrou/saiu), evitando misturar caixa realizado com projeções.

import { saleNet } from './bundles.js';

const financeDay = (iso) => String(iso || '').slice(0, 10);
const financeNorm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const inRange = (iso, start, end) => (!start || financeDay(iso) >= start) && (!end || financeDay(iso) <= end);

export const DEFAULT_ACCOUNTS = [
  { systemKey: 'caixa', name: 'Caixa da confeitaria', accountType: 'caixa', openingBalance: 0 },
  { systemKey: 'banco-pix', name: 'Banco principal / Pix', accountType: 'conta-corrente', openingBalance: 0 },
];

// `kind` is retained for backwards compatibility with the pricing/report screens. The richer
// metadata lets the financial reports classify nature, behaviour and cash-flow group separately.
export const DEFAULT_CHART = [
  { code: '1', name: 'Receitas operacionais', systemKey: 'receitas', nature: 'receita', kind: 'receita', cashFlowGroup: 'operacional' },
  { code: '1.1', name: 'Vendas de produtos e pronta entrega', systemKey: 'vendas', parentKey: 'receitas', nature: 'receita', kind: 'receita', cashFlowGroup: 'operacional' },
  { code: '1.2', name: 'Vendas por encomenda', systemKey: 'vendas-encomendas', parentKey: 'receitas', nature: 'receita', kind: 'receita', cashFlowGroup: 'operacional' },
  { code: '1.3', name: 'Frete e taxa de entrega cobrados', systemKey: 'frete-receita', parentKey: 'receitas', nature: 'receita', kind: 'receita', cashFlowGroup: 'operacional' },
  { code: '1.4', name: 'Cursos, oficinas e eventos', systemKey: 'cursos-eventos', parentKey: 'receitas', nature: 'receita', kind: 'receita', cashFlowGroup: 'operacional' },
  { code: '1.9', name: 'Outras receitas operacionais', systemKey: 'outras-receitas', parentKey: 'receitas', nature: 'receita', kind: 'receita', cashFlowGroup: 'operacional' },
  { code: '2', name: 'Custos diretos', systemKey: 'custos', nature: 'custo', kind: 'custo', cashFlowGroup: 'operacional' },
  { code: '2.1', name: 'Ingredientes e matérias-primas', systemKey: 'insumos', parentKey: 'custos', nature: 'custo', kind: 'custo', behavior: 'variavel', cashFlowGroup: 'operacional' },
  { code: '2.2', name: 'Embalagens', systemKey: 'embalagens', parentKey: 'custos', nature: 'custo', kind: 'custo', behavior: 'variavel', cashFlowGroup: 'operacional' },
  { code: '2.3', name: 'Mão de obra direta e diaristas', systemKey: 'mao-obra-direta', parentKey: 'custos', nature: 'custo', kind: 'custo', behavior: 'variavel', cashFlowGroup: 'operacional' },
  { code: '2.4', name: 'Gás de produção', systemKey: 'gas-producao', parentKey: 'custos', nature: 'custo', kind: 'custo', behavior: 'variavel', cashFlowGroup: 'operacional' },
  { code: '2.5', name: 'Energia usada na produção', systemKey: 'energia-producao', parentKey: 'custos', nature: 'custo', kind: 'custo', behavior: 'variavel', cashFlowGroup: 'operacional' },
  { code: '2.6', name: 'Motoboy e frete de vendas', systemKey: 'motoboy', parentKey: 'custos', nature: 'custo', kind: 'custo', behavior: 'variavel', cashFlowGroup: 'operacional' },
  { code: '2.7', name: 'Taxas de cartão e plataformas', systemKey: 'taxas-venda', parentKey: 'custos', nature: 'custo', kind: 'custo', behavior: 'variavel', cashFlowGroup: 'operacional' },
  { code: '2.8', name: 'Perdas de produção', systemKey: 'perdas-producao', parentKey: 'custos', nature: 'custo', kind: 'perda', behavior: 'variavel', cashFlowGroup: 'nao-caixa' },
  { code: '2.9', name: 'Outros custos diretos', systemKey: 'outros-custos', parentKey: 'custos', nature: 'custo', kind: 'custo', behavior: 'variavel', cashFlowGroup: 'operacional' },
  { code: '3', name: 'Despesas operacionais', systemKey: 'despesas', nature: 'despesa', kind: 'despesaFixa', cashFlowGroup: 'operacional' },
  { code: '3.1', name: 'Aluguel, condomínio e IPTU', systemKey: 'aluguel', parentKey: 'despesas', nature: 'despesa', kind: 'despesaFixa', behavior: 'fixa', cashFlowGroup: 'operacional' },
  { code: '3.2', name: 'Água', systemKey: 'agua', parentKey: 'despesas', nature: 'despesa', kind: 'despesaFixa', behavior: 'variavel', cashFlowGroup: 'operacional' },
  { code: '3.3', name: 'Energia elétrica administrativa', systemKey: 'energia', parentKey: 'despesas', nature: 'despesa', kind: 'despesaFixa', behavior: 'variavel', cashFlowGroup: 'operacional' },
  { code: '3.4', name: 'Internet e telefone', systemKey: 'internet', parentKey: 'despesas', nature: 'despesa', kind: 'despesaFixa', behavior: 'fixa', cashFlowGroup: 'operacional' },
  { code: '3.5', name: 'Pró-labore', systemKey: 'pro-labore', parentKey: 'despesas', nature: 'despesa', kind: 'despesaFixa', behavior: 'fixa', cashFlowGroup: 'operacional' },
  { code: '3.6', name: 'Salários e encargos', systemKey: 'salarios', parentKey: 'despesas', nature: 'despesa', kind: 'despesaFixa', behavior: 'fixa', cashFlowGroup: 'operacional' },
  { code: '3.7', name: 'Honorários contábeis', systemKey: 'contabilidade', parentKey: 'despesas', nature: 'despesa', kind: 'despesaFixa', behavior: 'fixa', cashFlowGroup: 'operacional' },
  { code: '3.8', name: 'DAS, impostos, licenças e alvarás', systemKey: 'impostos', parentKey: 'despesas', nature: 'despesa', kind: 'despesaFixa', cashFlowGroup: 'operacional' },
  { code: '3.9', name: 'Marketing e vendas', systemKey: 'marketing', parentKey: 'despesas', nature: 'despesa', kind: 'despesaVariavel', behavior: 'variavel', cashFlowGroup: 'operacional' },
  { code: '3.10', name: 'Limpeza, higiene e descartáveis', systemKey: 'limpeza', parentKey: 'despesas', nature: 'despesa', kind: 'despesaVariavel', cashFlowGroup: 'operacional' },
  { code: '3.11', name: 'Manutenção e pequenos reparos', systemKey: 'manutencao', parentKey: 'despesas', nature: 'despesa', kind: 'despesaVariavel', cashFlowGroup: 'operacional' },
  { code: '3.12', name: 'Material de escritório', systemKey: 'material-escritorio', parentKey: 'despesas', nature: 'despesa', kind: 'despesaVariavel', cashFlowGroup: 'operacional' },
  { code: '3.13', name: 'Sistemas, aplicativos e assinaturas', systemKey: 'sistemas', parentKey: 'despesas', nature: 'despesa', kind: 'despesaFixa', behavior: 'fixa', cashFlowGroup: 'operacional' },
  { code: '3.14', name: 'Tarifas bancárias', systemKey: 'tarifas', parentKey: 'despesas', nature: 'despesa', kind: 'despesaVariavel', cashFlowGroup: 'operacional' },
  { code: '3.15', name: 'Cursos e capacitação', systemKey: 'capacitacao', parentKey: 'despesas', nature: 'despesa', kind: 'despesaVariavel', cashFlowGroup: 'operacional' },
  { code: '3.16', name: 'Combustível e transporte', systemKey: 'transporte', parentKey: 'despesas', nature: 'despesa', kind: 'despesaVariavel', cashFlowGroup: 'operacional' },
  { code: '3.17', name: 'Perdas com clientes', systemKey: 'perdas-clientes', parentKey: 'despesas', nature: 'despesa', kind: 'despesaVariavel', cashFlowGroup: 'nao-caixa' },
  { code: '3.99', name: 'Outras despesas', systemKey: 'outras-despesas', parentKey: 'despesas', nature: 'despesa', kind: 'despesaVariavel', cashFlowGroup: 'operacional' },
  { code: '4', name: 'Investimentos e imobilizado', systemKey: 'investimentos', nature: 'investimento', kind: 'custo', cashFlowGroup: 'investimento' },
  { code: '4.1', name: 'Máquinas e equipamentos', systemKey: 'maquinas', parentKey: 'investimentos', nature: 'investimento', kind: 'custo', cashFlowGroup: 'investimento' },
  { code: '4.2', name: 'Móveis e utensílios duráveis', systemKey: 'moveis', parentKey: 'investimentos', nature: 'investimento', kind: 'custo', cashFlowGroup: 'investimento' },
  { code: '4.3', name: 'Reformas e benfeitorias', systemKey: 'reformas', parentKey: 'investimentos', nature: 'investimento', kind: 'custo', cashFlowGroup: 'investimento' },
  { code: '5', name: 'Proprietária, empréstimos e financiamentos', systemKey: 'movimentos-patrimoniais', nature: 'movimento', kind: 'receita', cashFlowGroup: 'financiamento' },
  { code: '5.1', name: 'Aportes da proprietária', systemKey: 'aportes', parentKey: 'movimentos-patrimoniais', nature: 'movimento', kind: 'receita', direction: 'receber', cashFlowGroup: 'financiamento' },
  { code: '5.2', name: 'Retiradas da proprietária', systemKey: 'retiradas', parentKey: 'movimentos-patrimoniais', nature: 'movimento', kind: 'despesaVariavel', direction: 'pagar', cashFlowGroup: 'financiamento' },
  { code: '5.3', name: 'Empréstimos recebidos', systemKey: 'emprestimos-recebidos', parentKey: 'movimentos-patrimoniais', nature: 'movimento', kind: 'receita', direction: 'receber', cashFlowGroup: 'financiamento' },
  { code: '5.4', name: 'Pagamento do principal de empréstimos', systemKey: 'emprestimos-principal', parentKey: 'movimentos-patrimoniais', nature: 'movimento', kind: 'despesaVariavel', direction: 'pagar', cashFlowGroup: 'financiamento' },
  { code: '5.5', name: 'Juros de empréstimos', systemKey: 'emprestimos-juros', parentKey: 'movimentos-patrimoniais', nature: 'despesa', kind: 'despesaVariavel', direction: 'pagar', cashFlowGroup: 'financiamento' },
];

const LEGACY_CATEGORY_ALIASES = {
  vendas: ['vendas'], insumos: ['matéria-prima', 'materia-prima'], motoboy: ['frete'],
  'gas-producao': ['gás', 'gas'], 'outras-despesas': ['outras'], salarios: ['salários', 'salarios'],
};

/** Seed/upgrade financial master data and keep one receivable title per active historical order. */
export function ensureFinanceFoundation(store, idFactory = () => crypto.randomUUID()) {
  let changed = 0;
  for (const spec of DEFAULT_ACCOUNTS) {
    let account = store.state.cashAccounts.find((a) => a.systemKey === spec.systemKey);
    if (!account) { store.upsertCashAccount({ id: idFactory(), ...spec }); changed++; }
  }

  const byKey = new Map(store.state.categories.filter((c) => c.systemKey).map((c) => [c.systemKey, c]));
  for (const spec of DEFAULT_CHART) {
    let cat = byKey.get(spec.systemKey);
    if (!cat) {
      // Reuse a legacy category with the same name whenever possible, preserving its id/history.
      const aliases = [spec.name, ...(LEGACY_CATEGORY_ALIASES[spec.systemKey] || [])].map(financeNorm);
      cat = store.state.categories.find((c) => !c.systemKey && aliases.includes(financeNorm(c.name)));
      const parentId = spec.parentKey ? byKey.get(spec.parentKey)?.id : undefined;
      const record = { ...(cat || {}), id: cat?.id || idFactory(), ...spec, ...(parentId ? { parentId } : {}) };
      delete record.parentKey;
      store.upsertCategory(record); byKey.set(spec.systemKey, record); changed++;
    } else {
      const parentId = spec.parentKey ? byKey.get(spec.parentKey)?.id : undefined;
      const upgraded = { ...cat, ...spec, ...(parentId ? { parentId } : {}) };
      delete upgraded.parentKey;
      if (JSON.stringify(upgraded) !== JSON.stringify(cat)) { store.upsertCategory(upgraded); changed++; }
      byKey.set(spec.systemKey, upgraded);
    }
  }

  for (const order of store.state.encomendas) changed += syncOrderReceivable(store, order, idFactory) ? 1 : 0;
  changed += applyClientCredits(store, idFactory);
  if ((store.state.version || 0) < 2) { store.state.version = 2; changed++; }
  return changed;
}

/** Create/update the financial title derived from an order. Idempotent by sourceType+sourceId. */
export function syncOrderReceivable(store, order, idFactory = () => crypto.randomUUID()) {
  let title = store.state.financeTitles.find((t) => t.sourceType === 'encomenda' && t.sourceId === order.id);
  const client = order.clienteId ? store.get('clients', order.clienteId) : null;
  const salesCat = store.state.categories.find((c) => c.systemKey === 'vendas');
  const record = {
    ...(title || {}), id: title?.id || idFactory(), direction: 'receber',
    issuedAt: order.at || order.deliveryDate, competenceDate: order.deliveryDate || order.at,
    dueDate: order.deliveryDate || order.at, amount: Number(order.total) || 0,
    description: `Encomenda${client?.name ? ` · ${client.name}` : ''}`,
    categoryId: salesCat?.id, partyType: 'cliente', partyId: order.clienteId,
    partyName: client?.name || 'Sem cliente', sourceType: 'encomenda', sourceId: order.id,
    ...(order.desistenciaAt ? { cancelledAt: order.desistenciaAt } : {}),
  };
  if (!order.desistenciaAt) delete record.cancelledAt;
  if (title && JSON.stringify(title) === JSON.stringify(record)) return false;
  store.upsertFinanceTitle(record); return true;
}

export function categoryByKey(store, key) {
  return store.state.categories.find((c) => c.systemKey === key) || null;
}

export function defaultCashAccount(store) {
  return store.state.cashAccounts.find((a) => a.systemKey === 'caixa') || store.state.cashAccounts.find((a) => !a.archived) || null;
}

export function titleSettlements(store, title) {
  const activeSettlement = (s) => !store.isReversed('financeSettlement', s.id)
    && (s.kind !== 'client-payment-allocation' || !store.isReversed('cashAdjustment', s.paymentId));
  if (title.sourceType === 'encomenda') {
    const payments = store.state.payments.filter((p) => p.encomendaId === title.sourceId && !store.isReversed('payment', p.id))
      .map((p) => ({ id: p.id, at: p.at, titleId: title.id, amount: Number(p.valor) || 0, method: p.forma, kind: 'payment', legacyKind: 'payment' }));
    const adjustments = store.state.financeSettlements.filter((s) => s.titleId === title.id && activeSettlement(s));
    return [...payments, ...adjustments];
  }
  if (title.sourceType === 'sale') {
    const sale = store.get('sales', title.sourceId);
    return sale && !store.isReversed('sale', sale.id) ? [{ id: sale.id, at: sale.at, titleId: title.id, amount: title.amount, legacyKind: 'sale' }] : [];
  }
  if (title.sourceType === 'income') {
    const income = store.get('incomes', title.sourceId);
    return income && !store.isReversed('income', income.id) ? [{ id: income.id, at: income.at, titleId: title.id, amount: title.amount, legacyKind: 'income' }] : [];
  }
  if (title.sourceType === 'despesa') {
    const expense = store.get('despesas', title.sourceId);
    return expense && !store.isReversed('despesa', expense.id) ? [{ id: expense.id, at: expense.at, titleId: title.id, amount: title.amount, legacyKind: 'despesa' }] : [];
  }
  return store.state.financeSettlements.filter((s) => s.titleId === title.id && activeSettlement(s));
}

export function titlePaid(store, title) {
  return titleSettlements(store, title).filter((s) => !['discount', 'credit', 'loss'].includes(s.kind)).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
}

export function titleState(store, title, today = financeDay(new Date().toISOString())) {
  const paid = Math.max(0, titlePaid(store, title));
  const discounted = Math.max(0, titleSettlements(store, title).filter((s) => s.kind === 'discount').reduce((sum, s) => sum + (Number(s.amount) || 0), 0));
  const credited = Math.max(0, titleSettlements(store, title).filter((s) => s.kind === 'credit').reduce((sum, s) => sum + (Number(s.amount) || 0), 0));
  const writtenOff = Math.max(0, titleSettlements(store, title).filter((s) => s.kind === 'loss').reduce((sum, s) => sum + (Number(s.amount) || 0), 0));
  const settled = paid + discounted + credited + writtenOff;
  const balance = Math.max(0, (Number(title.amount) || 0) - settled);
  let status = 'aberto';
  if (title.cancelledAt) status = 'cancelado';
  else if (balance <= 0.005) status = writtenOff > 0.005 ? 'perda' : 'quitado';
  else if (financeDay(title.dueDate) < today) status = 'vencido';
  else if (settled > 0.005) status = 'parcial';
  return { paid, discounted, credited, writtenOff, settled, balance, status, overdueDays: status === 'vencido' ? Math.max(1, Math.floor((new Date(`${today}T12:00:00`) - new Date(`${financeDay(title.dueDate)}T12:00:00`)) / 86400000)) : 0 };
}

/** Cash received beyond a client's titles, minus credit already used on later titles. */
function clientCreditNet(store, clientId) {
  let credit = 0;
  for (const title of store.state.financeTitles.filter((t) => t.direction === 'receber' && t.partyId === clientId && !t.cancelledAt)) {
    const settlements = titleSettlements(store, title);
    const paid = settlements.filter((s) => !['discount', 'credit', 'loss'].includes(s.kind)).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const discounted = settlements.filter((s) => s.kind === 'discount').reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const applied = settlements.filter((s) => s.kind === 'credit').reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const amount = Number(title.amount) || 0;
    const writtenOff = settlements.filter((s) => s.kind === 'loss').reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    credit += Math.max(0, paid + applied + Math.min(discounted + writtenOff, Math.max(0, amount - applied)) - amount);
    credit -= applied;
  }
  for (const entry of store.state.cashAdjustments) {
    if (entry.kind === 'client-credit' && entry.clientId === clientId && !store.isReversed('cashAdjustment', entry.id)) credit += Number(entry.amount) || 0;
    if (entry.kind === 'client-payment' && entry.clientId === clientId && !store.isReversed('cashAdjustment', entry.id)) credit += Number(entry.creditAmount) || 0;
  }
  return Math.round(credit * 100) / 100;
}

export function clientCreditBalance(store, clientId) {
  return Math.max(0, clientCreditNet(store, clientId));
}

/** Apply available credit once per title. Credit use changes debt, never cash flow. */
export function applyClientCredits(store, idFactory = () => crypto.randomUUID()) {
  let changed = 0;
  for (const client of store.state.clients) {
    // A corrected or reversed payment can remove credit that was already used. Reopen the
    // affected title instead of leaving it marked as paid by credit that no longer exists.
    const used = store.state.financeSettlements.filter((s) => s.kind === 'credit' && !store.isReversed('financeSettlement', s.id)
      && store.get('financeTitles', s.titleId)?.partyId === client.id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    for (const settlement of used) {
      if (clientCreditNet(store, client.id) >= -0.005) break;
      store.addReversal({ id: idFactory(), at: new Date().toISOString(), kind: 'financeSettlement', refId: settlement.id });
      changed++;
    }
    let available = clientCreditBalance(store, client.id);
    if (available < 0.005) continue;
    const titles = store.state.financeTitles.filter((t) => t.direction === 'receber' && t.partyId === client.id && !t.cancelledAt)
      .sort((a, b) => String(a.issuedAt || '').localeCompare(String(b.issuedAt || '')));
    for (const title of titles) {
      if (available < 0.005) break;
      const balance = titleState(store, title).balance;
      if (balance < 0.005) continue;
      const amount = Math.round(Math.min(available, balance) * 100) / 100;
      store.addFinanceSettlement({ id: idFactory(), at: new Date().toISOString(), titleId: title.id, amount, kind: 'credit', notes: 'Crédito do cliente aplicado automaticamente' });
      available = Math.round((available - amount) * 100) / 100;
      changed++;
    }
  }
  return changed;
}

export function listTitles(store, filters = {}) {
  let rows = store.state.financeTitles.map((title) => ({ title, ...titleState(store, title, filters.today) }));
  if (filters.direction) rows = rows.filter((r) => r.title.direction === filters.direction);
  if (filters.start || filters.end) rows = rows.filter((r) => inRange(r.title.dueDate, filters.start, filters.end));
  if (filters.status && filters.status !== 'todos') {
    if (filters.status === 'aberto') rows = rows.filter((r) => ['aberto', 'parcial', 'vencido'].includes(r.status));
    else if (filters.status === 'parcial') rows = rows.filter((r) => r.settled > 0.005 && r.balance > 0.005);
    else rows = rows.filter((r) => r.status === filters.status);
  }
  if (filters.partyId) rows = rows.filter((r) => r.title.partyId === filters.partyId);
  if (filters.categoryId) rows = rows.filter((r) => r.title.categoryId === filters.categoryId);
  if (filters.method) rows = rows.filter((r) => r.title.expectedMethod === filters.method || titleSettlements(store, r.title).some((s) => (s.method || '') === filters.method));
  return rows.sort((a, b) => financeDay(a.title.dueDate).localeCompare(financeDay(b.title.dueDate)) || a.title.description.localeCompare(b.title.description));
}

/** Actual cash movements only. Losses are managerial/stock facts and intentionally absent. */
export function cashMovements(store) {
  const out = [];
  const fallbackAccount = defaultCashAccount(store)?.id;
  for (const s of store.state.sales) if (!store.isReversed('sale', s.id)) out.push({ id: `sale:${s.id}`, at: s.at, direction: 'entrada', amount: saleNet(s), label: 'Venda rápida', sourceType: 'sale', sourceId: s.id, accountId: fallbackAccount, categoryId: categoryByKey(store, 'vendas')?.id });
  for (const p of store.state.payments) if (!store.isReversed('payment', p.id)) {
    const order = store.get('encomendas', p.encomendaId); const title = store.state.financeTitles.find((t) => t.sourceType === 'encomenda' && t.sourceId === p.encomendaId);
    out.push({ id: `payment:${p.id}`, at: p.at, direction: 'entrada', amount: Number(p.valor) || 0, label: title?.partyName || 'Recebimento de venda', method: p.forma, sourceType: 'payment', sourceId: p.id, accountId: fallbackAccount, categoryId: title?.categoryId, order });
  }
  for (const i of store.state.incomes) if (!store.isReversed('income', i.id)) out.push({ id: `income:${i.id}`, at: i.at, direction: 'entrada', amount: Number(i.valor) || 0, label: i.description || 'Outra receita', sourceType: 'income', sourceId: i.id, accountId: fallbackAccount, categoryId: i.categoryId });
  for (const d of store.state.despesas) if (!store.isReversed('despesa', d.id)) out.push({ id: `despesa:${d.id}`, at: d.at, direction: 'saida', amount: Number(d.valor) || 0, label: d.description || store.get('categories', d.categoryId)?.name || 'Despesa', sourceType: 'despesa', sourceId: d.id, accountId: fallbackAccount, categoryId: d.categoryId });
  for (const v of store.state.variableCosts) if (!store.isReversed('variableCost', v.id)) out.push({ id: `variableCost:${v.id}`, at: v.at, direction: 'saida', amount: Number(v.amount) || 0, label: v.description || v.note || 'Custo antigo', sourceType: 'variableCost', sourceId: v.id, accountId: fallbackAccount, categoryId: categoryByKey(store, 'outros-custos')?.id });
  for (const st of store.state.financeSettlements) {
    if (store.isReversed('financeSettlement', st.id)) continue;
    if (['discount', 'credit', 'loss', 'client-payment-allocation'].includes(st.kind)) continue;
    const title = store.get('financeTitles', st.titleId); if (!title) continue;
    out.push({ id: `financeSettlement:${st.id}`, at: st.at, direction: title.direction === 'receber' ? 'entrada' : 'saida', amount: Number(st.amount) || 0, label: title.description, method: st.method, sourceType: 'financeSettlement', sourceId: st.id, titleId: title.id, accountId: st.accountId || fallbackAccount, categoryId: title.categoryId });
  }
  for (const a of store.state.cashAdjustments) if (!store.isReversed('cashAdjustment', a.id)) {
    if (a.kind === 'transfer') {
      out.push({ id: `cashAdjustment:${a.id}:out`, at: a.at, direction: 'saida', amount: Number(a.amount) || 0, label: a.description || 'Transferência', sourceType: 'cashAdjustment', sourceId: a.id, accountId: a.accountId, transfer: true });
      out.push({ id: `cashAdjustment:${a.id}:in`, at: a.at, direction: 'entrada', amount: Number(a.amount) || 0, label: a.description || 'Transferência', sourceType: 'cashAdjustment', sourceId: a.id, accountId: a.toAccountId, transfer: true });
    } else out.push({ id: `cashAdjustment:${a.id}`, at: a.at, direction: a.direction || 'entrada', amount: Number(a.amount) || 0, label: a.description || 'Ajuste financeiro', sourceType: 'cashAdjustment', sourceId: a.id, accountId: a.accountId || fallbackAccount, categoryId: a.categoryId, adjustment: true });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

function projectedMovements(store, start, end, filters = {}) {
  return listTitles(store, { status: 'aberto' }).filter((r) => r.balance > 0.005 && inRange(r.title.dueDate, start, end) && (!filters.accountId || true) && (!filters.categoryId || r.title.categoryId === filters.categoryId)).map((r) => ({
    id: `projected:${r.title.id}`, at: r.title.dueDate, direction: r.title.direction === 'receber' ? 'entrada' : 'saida', amount: r.balance,
    label: r.title.description, projected: true, titleId: r.title.id, categoryId: r.title.categoryId,
  }));
}

export function cashFlow(store, start, end, filters = {}) {
  const allAccounts = store.state.cashAccounts.filter((a) => !a.archived && (!filters.accountId || a.id === filters.accountId));
  const opening = allAccounts.reduce((sum, a) => sum + (Number(a.openingBalance) || 0), 0);
  // A transfer is relevant inside one selected account, but must disappear from the
  // consolidated company flow so it does not inflate both receipts and payments.
  const actualAll = cashMovements(store).filter((m) => filters.accountId ? m.accountId === filters.accountId : !m.transfer).filter((m) => !filters.categoryId || m.categoryId === filters.categoryId);
  const prior = actualAll.filter((m) => financeDay(m.at) < start).reduce((sum, m) => sum + (m.direction === 'entrada' ? m.amount : -m.amount), opening);
  const movements = actualAll.filter((m) => inRange(m.at, start, end));
  const projected = filters.projected ? projectedMovements(store, start, end, filters) : [];
  const map = new Map();
  for (const m of [...movements, ...projected]) {
    const key = financeDay(m.at); const row = map.get(key) || { date: key, in: 0, out: 0, projectedIn: 0, projectedOut: 0, movements: [] };
    if (m.projected) { if (m.direction === 'entrada') row.projectedIn += m.amount; else row.projectedOut += m.amount; }
    else if (m.direction === 'entrada') row.in += m.amount; else row.out += m.amount;
    row.movements.push(m); map.set(key, row);
  }
  let cumulative = prior;
  const days = [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => { cumulative += r.in - r.out; return { ...r, balance: r.in - r.out, cumulative }; });
  return { start, end, opening: prior, days, totalIn: days.reduce((s, r) => s + r.in, 0), totalOut: days.reduce((s, r) => s + r.out, 0), projectedIn: days.reduce((s, r) => s + r.projectedIn, 0), projectedOut: days.reduce((s, r) => s + r.projectedOut, 0), ending: cumulative };
}

export function financeDashboard(store, month, today = financeDay(new Date().toISOString())) {
  const start = `${month}-01`; const endDate = new Date(`${start}T12:00:00`); endDate.setMonth(endDate.getMonth() + 1); endDate.setDate(0);
  const end = financeDay(endDate.toISOString());
  const flow = cashFlow(store, start, end, { projected: true });
  const receivables = listTitles(store, { direction: 'receber', status: 'aberto' });
  const payables = listTitles(store, { direction: 'pagar', status: 'aberto' });
  return {
    flow,
    receivable: receivables.reduce((s, r) => s + r.balance, 0), payable: payables.reduce((s, r) => s + r.balance, 0),
    overdueReceivable: receivables.filter((r) => r.status === 'vencido').reduce((s, r) => s + r.balance, 0),
    overduePayable: payables.filter((r) => r.status === 'vencido').reduce((s, r) => s + r.balance, 0),
    dueSoon: [...receivables, ...payables].filter((r) => r.title.dueDate >= today && r.title.dueDate <= financeDay(new Date(new Date(`${today}T12:00:00`).getTime() + 7 * 86400000).toISOString())).length,
  };
}
