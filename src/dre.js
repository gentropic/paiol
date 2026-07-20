// DRE gerencial por competência. Diferente do fluxo de caixa: considera o valor integral quando
// a receita/despesa pertence ao período, independentemente da data de recebimento ou pagamento.

import { titleState } from './finance.js';

const dreDay = (iso) => String(iso || '').slice(0, 10);
const dreInPeriod = (iso, start, end) => (!start || dreDay(iso) >= start) && (!end || dreDay(iso) <= end);
const dreAmount = (value) => Number(value) || 0;

export function managerialDre(store, start, end) {
  const revenue = new Map(); const costs = new Map(); const expenses = new Map();
  const linkedSources = new Set();
  let salesRevenue = 0; let otherRevenue = 0; let directCosts = 0; let operatingExpenses = 0;
  let fixedExpenses = 0; let variableExpenses = 0; let excluded = 0; let unclassified = 0;
  let openReceivables = 0; let openPayables = 0;

  const categoryOf = (id) => id ? store.get('categories', id) : null;
  const addRow = (map, category, fallback, amount) => {
    const id = category?.id || `__${fallback}`;
    const row = map.get(id) || { id, name: category?.name || fallback, amount: 0 };
    row.amount += amount; map.set(id, row);
  };
  const classify = (direction, amount, category, fallback, sourceKind) => {
    if (!(amount > 0)) return false;
    const nature = category?.nature || (category?.kind === 'receita' ? 'receita' : category?.kind === 'custo' || category?.kind === 'perda' ? 'custo' : category?.kind ? 'despesa' : null);
    if (category?.cashFlowGroup === 'investimento' || category?.cashFlowGroup === 'financiamento' || nature === 'investimento' || nature === 'movimento') { excluded += amount; return false; }
    if (!category) unclassified += 1;
    if (direction === 'receber') {
      addRow(revenue, category, fallback || 'Receita sem categoria', amount);
      if (category?.systemKey === 'vendas' || sourceKind === 'sale' || sourceKind === 'encomenda') salesRevenue += amount;
      else otherRevenue += amount;
    } else if (nature === 'custo') {
      addRow(costs, category, fallback || 'Custo sem categoria', amount); directCosts += amount;
    } else {
      addRow(expenses, category, fallback || 'Despesa sem categoria', amount); operatingExpenses += amount;
      if (category?.behavior === 'fixa' || category?.kind === 'despesaFixa') fixedExpenses += amount;
      else variableExpenses += amount;
    }
    return true;
  };

  for (const title of store.state.financeTitles) {
    if (title.sourceType && title.sourceId) linkedSources.add(`${title.sourceType}:${title.sourceId}`);
    if (title.cancelledAt || !dreInPeriod(title.competenceDate || title.issuedAt || title.dueDate, start, end)) continue;
    const amount = dreAmount(title.amount); const category = categoryOf(title.categoryId);
    const included = classify(title.direction, amount, category, title.description, title.sourceType);
    if (included) {
      const state = titleState(store, title);
      if (title.direction === 'receber') openReceivables += state.balance; else openPayables += state.balance;
    }
  }

  // Operational records created before the title-based Financeiro remain valid and are included
  // only when no linked title exists, preventing double counting after migrations.
  for (const order of store.state.encomendas) if (!order.desistenciaAt && !linkedSources.has(`encomenda:${order.id}`) && dreInPeriod(order.deliveryDate || order.at, start, end)) {
    classify('receber', dreAmount(order.total), store.state.categories.find((c) => c.systemKey === 'vendas'), 'Vendas de quitutes', 'encomenda');
    openReceivables += Math.max(0, dreAmount(order.total) - store.paidFor(order.id));
  }
  for (const sale of store.state.sales) if (!store.isReversed('sale', sale.id) && !linkedSources.has(`sale:${sale.id}`) && dreInPeriod(sale.at, start, end)) {
    classify('receber', dreAmount(sale.qty) * dreAmount(sale.unitPrice), store.state.categories.find((c) => c.systemKey === 'vendas'), 'Vendas rápidas', 'sale');
  }
  for (const income of store.state.incomes) if (!store.isReversed('income', income.id) && !linkedSources.has(`income:${income.id}`) && dreInPeriod(income.at, start, end)) {
    classify('receber', dreAmount(income.valor), categoryOf(income.categoryId), income.description || 'Outras receitas', 'income');
  }
  for (const expense of store.state.despesas) if (!store.isReversed('despesa', expense.id) && !linkedSources.has(`despesa:${expense.id}`) && dreInPeriod(expense.at, start, end)) {
    classify('pagar', dreAmount(expense.valor), categoryOf(expense.categoryId), expense.description || 'Despesa', 'despesa');
  }
  for (const legacy of store.state.variableCosts) if (!store.isReversed('variableCost', legacy.id) && dreInPeriod(legacy.at, start, end)) {
    classify('pagar', dreAmount(legacy.amount), store.state.categories.find((c) => c.systemKey === 'outros-custos'), legacy.description || legacy.note || 'Custo antigo', 'variableCost');
  }
  for (const purchase of store.state.purchases) if (!linkedSources.has(`compra:${purchase.id}`) && dreInPeriod(purchase.at, start, end)) {
    classify('pagar', dreAmount(purchase.total), store.state.categories.find((c) => c.systemKey === 'insumos'), 'Compra de insumos', 'compra');
  }
  for (const loss of store.state.perdas) if (!store.isReversed('perda', loss.id) && dreInPeriod(loss.at, start, end)) {
    classify('pagar', dreAmount(loss.amount), store.state.categories.find((c) => c.systemKey === 'perdas-producao'), 'Perdas de produção', 'perda');
  }

  const grossRevenue = salesRevenue + otherRevenue;
  const grossProfit = grossRevenue - directCosts;
  const netResult = grossProfit - operatingExpenses;
  const grossMarginPct = grossRevenue > 0 ? grossProfit / grossRevenue : null;
  const netMarginPct = grossRevenue > 0 ? netResult / grossRevenue : null;
  const diagnostics = [];
  const note = (tone, title, text) => diagnostics.push({ tone, title, text });
  if (grossRevenue <= 0) note('warn', 'Sem receita no período', 'Não há vendas ou outras receitas por competência. Confira as datas e categorias dos lançamentos.');
  else {
    if (directCosts <= 0) note('warn', 'Custos diretos não informados', 'O resultado pode estar superestimado. Classifique insumos, embalagens, gás e outros custos no plano de contas.');
    else if (directCosts / grossRevenue > 0.60) note('warn', 'Custos diretos elevados', `Os custos consomem ${Math.round((directCosts / grossRevenue) * 100)}% da receita. Revise compras, perdas, rendimento e preços.`);
    else note('ok', 'Margem bruta acompanhada', `A margem bruta do período é de ${Math.round(grossMarginPct * 100)}%. Compare a evolução entre períodos.`);
    if (netResult < 0) note('bad', 'Prejuízo no período', 'Custos e despesas superaram as receitas. Priorize os maiores grupos e reveja preços e gastos recorrentes.');
    else if (netMarginPct < 0.10) note('warn', 'Margem líquida apertada', `A margem líquida ficou em ${Math.round(netMarginPct * 100)}%. Há pouca folga para imprevistos e reinvestimentos.`);
    else note('ok', 'Resultado positivo', `A margem líquida gerencial ficou em ${Math.round(netMarginPct * 100)}% no período.`);
    if (operatingExpenses / grossRevenue > 0.35) note('warn', 'Despesas operacionais elevadas', `As despesas representam ${Math.round((operatingExpenses / grossRevenue) * 100)}% da receita. Observe principalmente os gastos fixos.`);
  }
  if (openReceivables > 0.005) note('info', 'Lucro não é dinheiro em caixa', `Há R$ ${openReceivables.toFixed(2).replace('.', ',')} de receitas desta DRE ainda a receber.`);
  if (openPayables > 0.005) note('info', 'Obrigações pendentes', `Há R$ ${openPayables.toFixed(2).replace('.', ',')} de custos e despesas desta DRE ainda a pagar.`);
  if (unclassified) note('warn', 'Lançamentos sem categoria', `${unclassified} lançamento(s) foram incluídos por direção, mas precisam ser classificados para melhorar a precisão da DRE.`);
  if (excluded > 0.005) note('info', 'Valores fora da DRE', 'Investimentos, financiamentos e movimentações patrimoniais permanecem no Fluxo de Caixa, mas não reduzem nem aumentam o lucro operacional desta DRE.');

  const rows = (map) => [...map.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'pt-BR'));
  return {
    start, end, salesRevenue, otherRevenue, grossRevenue, directCosts, grossProfit,
    operatingExpenses, fixedExpenses, variableExpenses, netResult, grossMarginPct, netMarginPct,
    openReceivables, openPayables, excluded, unclassified, diagnostics,
    revenueRows: rows(revenue), costRows: rows(costs), expenseRows: rows(expenses),
  };
}
