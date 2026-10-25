// DRE gerencial por competência. Diferente do fluxo de caixa: considera o valor integral quando
// a receita/despesa pertence ao período, independentemente da data de recebimento ou pagamento.

import { titleState } from './finance.js';
import { bundleProductItems, isBundleProduct, orderGross, saleNet } from './bundles.js';
import { estimateLens, productBreakdown } from './cost-engine.js';
import { inventorySummary } from './inventory.js';
import { depreciationSummary } from './assets.js';

const dreDay = (iso) => String(iso || '').slice(0, 10);
const dreInPeriod = (iso, start, end) => (!start || dreDay(iso) >= start) && (!end || dreDay(iso) <= end);
const dreAmount = (value) => Number(value) || 0;

/** Ingredient and packaging cost of products sold, without allocated salaries or fixed costs. */
export function orderMaterialEstimate(store, order) {
  const engine = store.toEngineStore();
  const config = store.getConfig(); const lens = estimateLens(config);
  let ingredients = 0; let packaging = 0; let missing = 0;
  const one = (id, qty, sign = 1) => {
    if (!(qty > 0)) return;
    try {
      const product = store.get('products', id);
      const parts = productBreakdown(engine, id, config, lens);
      ingredients += (Number(parts.ingredients) || 0) * qty * sign;
      packaging += ((Number(parts.packaging) || 0) + (Number(product?.packagingCost) || 0)) * qty * sign;
    } catch { missing++; }
  };
  for (const item of order.itens || []) {
    const qty = Math.max(0, Number(item.qty) || 0);
    one(item.productId, qty);
    // Older catalog bundles can contain standard products. An order with a saved custom
    // composition replaces them, rather than consuming both sets of products.
    const parent = store.get('products', item.productId);
    if (isBundleProduct(parent) && Array.isArray(item.bundleItems)) {
      for (const child of bundleProductItems(parent)) one(child.productId, qty * child.qty, -1);
    }
    for (const child of item.bundleItems || []) one(child.productId, qty * Math.max(0, Number(child.qty) || 0));
  }
  return { ingredients: Math.max(0, ingredients), packaging: Math.max(0, packaging), missing };
}

export function managerialDre(store, start, end) {
  const revenue = new Map(); const costs = new Map(); const expenses = new Map(); const selling = new Map();
  const linkedSources = new Set();
  let salesRevenue = 0; let otherRevenue = 0; let directCosts = 0; let operatingExpenses = 0;
  let salesDiscounts = 0; let settlementDiscounts = 0; let salesReturns = 0; let salesTaxes = 0; let sellingExpenses = 0; let indirectCosts = 0; let clientLosses = 0;
  let missingMaterials = 0; let undeliveredSales = 0; let legacyCostEstimates = 0;
  let fixedExpenses = 0; let variableExpenses = 0; let excluded = 0; let unclassified = 0;
  let openReceivables = 0; let openPayables = 0; let overdueReceivables = 0;

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
    if (direction === 'pagar' && category?.systemKey === 'devolucoes-vendas') { salesReturns += amount; return true; }
    if (direction === 'pagar' && category?.systemKey === 'tributos-vendas') { salesTaxes += amount; return true; }
    if (direction === 'receber') {
      addRow(revenue, category, fallback || 'Receita sem categoria', amount);
      if (category?.systemKey === 'vendas' || sourceKind === 'sale' || sourceKind === 'encomenda') salesRevenue += amount;
      else otherRevenue += amount;
    } else if (['taxas-venda', 'motoboy', 'comissoes-venda'].includes(category?.systemKey)) {
      addRow(selling, category, fallback || 'Despesa de venda', amount); sellingExpenses += amount;
    } else if (nature === 'custo') {
      addRow(costs, category, fallback || 'Custo sem categoria', amount); directCosts += amount;
      if (category?.behavior === 'fixa' || category?.systemKey === 'indiretos-producao') indirectCosts += amount;
    } else {
      addRow(expenses, category, fallback || 'Despesa sem categoria', amount); operatingExpenses += amount;
      if (category?.behavior === 'fixa' || (!category?.behavior && category?.kind === 'despesaFixa')) fixedExpenses += amount;
      else variableExpenses += amount;
      if (category?.systemKey === 'perdas-clientes') clientLosses += amount;
    }
    return true;
  };

  for (const title of store.state.financeTitles) {
    if (title.sourceType && title.sourceId) linkedSources.add(`${title.sourceType}:${title.sourceId}`);
    if (title.cancelledAt || !dreInPeriod(title.competenceDate || title.issuedAt || title.dueDate, start, end)) continue;
    // The stock purchase creates an asset. Its materials enter the result when products are sold.
    if (title.sourceType === 'compra') { excluded += Math.max(0, dreAmount(title.amount)); continue; }
    const order = title.sourceType === 'encomenda' ? store.get('encomendas', title.sourceId) : null;
    if (order && (order.desistenciaAt || !order.entregue)) { if (!order.desistenciaAt) undeliveredSales++; continue; }
    const state = titleState(store, title);
    // The original sale belongs to its delivery period. A later settlement discount is
    // recognized separately on the date it was granted, without moving cash.
    const amount = Math.max(0, dreAmount(title.amount)); const category = categoryOf(title.categoryId);
    if (title.direction === 'receber' && (order || ['vendas', 'vendas-encomendas'].includes(category?.systemKey))) {
      salesDiscounts += order ? Math.max(0, orderGross(order) - dreAmount(title.amount)) : 0;
    }
    const included = classify(title.direction, amount, category, title.description, title.sourceType);
    if (included) {
      if (title.direction === 'receber') {
        openReceivables += state.balance;
        if (dreDay(title.dueDate) < dreDay(new Date().toISOString())) overdueReceivables += state.balance;
      } else openPayables += state.balance;
    }
  }

  for (const settlement of store.state.financeSettlements) {
    if (settlement.kind === 'discount' && !store.isReversed('financeSettlement', settlement.id)) {
      const title = store.get('financeTitles', settlement.titleId);
      const order = title?.sourceType === 'encomenda' ? store.get('encomendas', title.sourceId) : null;
      const recognitionAt = order?.entregue && dreDay(settlement.at) < dreDay(order.deliveryDate) ? order.deliveryDate : settlement.at;
      if (title?.direction === 'receber' && !title.cancelledAt && !order?.desistenciaAt && (!order || order.entregue) && dreInPeriod(recognitionAt, start, end)) settlementDiscounts += Math.max(0, dreAmount(settlement.amount));
    }
    if (settlement.kind !== 'loss' || store.isReversed('financeSettlement', settlement.id) || !dreInPeriod(settlement.at, start, end)) continue;
    const title = store.get('financeTitles', settlement.titleId);
    if (title?.direction === 'receber' && !title.cancelledAt) classify('pagar', dreAmount(settlement.amount), store.state.categories.find((c) => c.systemKey === 'perdas-clientes'), `Perda com cliente · ${title.partyName || title.description}`, 'loss');
  }

  // Operational records created before the title-based Financeiro remain valid and are included
  // only when no linked title exists, preventing double counting after migrations.
  for (const order of store.state.encomendas) if (!order.desistenciaAt && !linkedSources.has(`encomenda:${order.id}`) && dreInPeriod(order.deliveryDate || order.at, start, end)) {
    if (!order.entregue) { undeliveredSales++; continue; }
    classify('receber', dreAmount(order.total), store.state.categories.find((c) => c.systemKey === 'vendas'), 'Vendas de quitutes', 'encomenda');
    salesDiscounts += Math.max(0, orderGross(order) - dreAmount(order.total));
    openReceivables += Math.max(0, dreAmount(order.total) - store.paidFor(order.id));
  }
  for (const sale of store.state.sales) if (!store.isReversed('sale', sale.id) && !linkedSources.has(`sale:${sale.id}`) && dreInPeriod(sale.at, start, end)) {
    classify('receber', saleNet(sale), store.state.categories.find((c) => c.systemKey === 'vendas'), 'Vendas rápidas', 'sale');
    salesDiscounts += Math.max(0, dreAmount(sale.discount));
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
  for (const purchase of store.state.purchases) if (!linkedSources.has(`compra:${purchase.id}`) && dreInPeriod(purchase.at, start, end)) excluded += Math.max(0, dreAmount(purchase.total));
  for (const loss of store.state.perdas) if (!store.isReversed('perda', loss.id) && dreInPeriod(loss.at, start, end)) {
    classify('pagar', dreAmount(loss.amount), store.state.categories.find((c) => c.systemKey === 'perdas-producao'), 'Perdas de produção', 'perda');
  }

  let materialCosts = 0; let packagingCosts = 0;
  for (const order of store.state.encomendas) if (order.entregue && !order.desistenciaAt && dreInPeriod(order.deliveryDate || order.at, start, end)) {
    const estimate = orderMaterialEstimate(store, order);
    if (order.materialCostSnapshot == null || order.packagingCostSnapshot == null) legacyCostEstimates++;
    materialCosts += order.materialCostSnapshot != null ? Math.max(0, dreAmount(order.materialCostSnapshot)) : estimate.ingredients;
    packagingCosts += order.packagingCostSnapshot != null ? Math.max(0, dreAmount(order.packagingCostSnapshot)) : estimate.packaging;
    missingMaterials += estimate.missing;
  }
  for (const sale of store.state.sales) if (!store.isReversed('sale', sale.id) && dreInPeriod(sale.at, start, end)) {
    const estimate = orderMaterialEstimate(store, { itens: [{ productId: sale.productId, qty: sale.qty }] });
    if (sale.materialCostSnapshot == null || sale.packagingCostSnapshot == null) legacyCostEstimates++;
    materialCosts += sale.materialCostSnapshot != null ? Math.max(0, dreAmount(sale.materialCostSnapshot)) : estimate.ingredients;
    packagingCosts += sale.packagingCostSnapshot != null ? Math.max(0, dreAmount(sale.packagingCostSnapshot)) : estimate.packaging;
    missingMaterials += estimate.missing;
  }
  const depreciation = depreciationSummary(store, start, end);
  const inventory = inventorySummary(store);
  let inventoryValue = 0; let unpricedInventory = 0; let negativeInventory = 0;
  for (const row of inventory) {
    if (row.current < -0.000001) negativeInventory++;
    if (!(row.current > 0)) continue;
    const price = store.currentPrice(row.ingredient.id);
    if (price == null) unpricedInventory++;
    else inventoryValue += row.current * Math.max(0, dreAmount(price));
  }
  directCosts += materialCosts + packagingCosts + depreciation.production;
  const grossRevenue = salesRevenue + otherRevenue - settlementDiscounts - salesReturns - salesTaxes;
  const grossProfit = grossRevenue - directCosts;
  const netResult = grossProfit - operatingExpenses - sellingExpenses - depreciation.administration;
  const grossMarginPct = grossRevenue > 0 ? grossProfit / grossRevenue : null;
  const netMarginPct = grossRevenue > 0 ? netResult / grossRevenue : null;
  const diagnostics = [];
  const note = (tone, title, text) => diagnostics.push({ tone, title, text });
  if (grossRevenue <= 0) note('warn', 'Sem receita líquida no período', 'Não houve receita líquida positiva neste período. Confira vendas entregues, descontos concedidos e outras receitas.');
  else {
    if (directCosts <= 0) note('warn', 'Custos de produção não informados', 'O resultado pode estar superestimado. Cadastre receitas, preços dos insumos e despesas de produção.');
    else if (directCosts / grossRevenue > 0.60) note('warn', 'Custos diretos elevados', `Os custos consomem ${Math.round((directCosts / grossRevenue) * 100)}% da receita. Revise compras, perdas, rendimento e preços.`);
    else note('ok', 'Margem bruta acompanhada', `A margem bruta do período é de ${Math.round(grossMarginPct * 100)}%. Compare a evolução entre períodos.`);
    if (netResult < 0) note('bad', 'Prejuízo no período', 'Custos e despesas superaram as receitas. Priorize os maiores grupos e reveja preços e gastos recorrentes.');
    else if (netMarginPct < 0.10) note('warn', 'Margem líquida apertada', `A margem líquida ficou em ${Math.round(netMarginPct * 100)}%. Há pouca folga para imprevistos e reinvestimentos.`);
    else note('ok', 'Resultado positivo', `A margem líquida gerencial ficou em ${Math.round(netMarginPct * 100)}% no período.`);
    if (operatingExpenses / grossRevenue > 0.35) note('warn', 'Despesas operacionais elevadas', `As despesas representam ${Math.round((operatingExpenses / grossRevenue) * 100)}% da receita. Observe principalmente os gastos fixos.`);
  }
  if (openReceivables > 0.005) note('info', 'Lucro não é dinheiro em caixa', `Há R$ ${openReceivables.toFixed(2).replace('.', ',')} de receitas desta DRE ainda a receber.`);
  if (overdueReceivables > 0.005) note('warn', 'Contas vencidas', 'O saldo vencido é um risco; só a perda confirmada reduz o lucro líquido.');
  if (openPayables > 0.005) note('info', 'Obrigações pendentes', `Há R$ ${openPayables.toFixed(2).replace('.', ',')} de custos e despesas desta DRE ainda a pagar.`);
  if (unclassified) note('warn', 'Lançamentos sem categoria', `${unclassified} lançamento(s) foram incluídos por direção, mas precisam ser classificados para melhorar a precisão da DRE.`);
  if (excluded > 0.005) note('info', 'Aquisições e investimentos fora do lucro', 'Compras de estoque, equipamentos e movimentações patrimoniais não são despesa integral no dia da compra.');
  if (undeliveredSales) note('info', 'Pedidos ainda não entregues', `${undeliveredSales} pedido(s) ainda não entram como venda nesta DRE.`);
  if (missingMaterials) note('warn', 'Custos de produtos incompletos', `${missingMaterials} item(ns) vendidos não tiveram o custo de insumos calculado. Confira o cadastro e os preços de compra.`);
  if (legacyCostEstimates) note('info', 'Vendas antigas sem custo congelado', `${legacyCostEstimates} venda(s) antigas usam os preços atuais de insumos como estimativa. Mudanças de preço podem alterar a DRE histórica.`);
  if (unpricedInventory) note('warn', 'Estoque sem preço', `${unpricedInventory} insumo(s) com estoque não têm preço e ficaram fora do valor estimado.`);
  if (negativeInventory) note('warn', 'Estoque negativo', `${negativeInventory} insumo(s) apresentam saldo negativo. Confira as contagens físicas antes de usar o valor de estoque para decidir.`);

  const rows = (map) => [...map.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'pt-BR'));
  return {
    start, end, salesRevenue: salesRevenue - settlementDiscounts, salesGross: salesRevenue + salesDiscounts, salesDiscounts: salesDiscounts + settlementDiscounts, salesReturns, salesTaxes,
    otherRevenue, grossRevenue, directCosts, materialCosts, packagingCosts, productionDepreciation: depreciation.production,
    administrationDepreciation: depreciation.administration, inventoryValue, unpricedInventory, negativeInventory, missingMaterials, legacyCostEstimates,
    grossProfit, sellingExpenses, indirectCosts, clientLosses,
    operatingExpenses, fixedExpenses, variableExpenses, netResult, grossMarginPct, netMarginPct,
    openReceivables, openPayables, overdueReceivables, excluded, unclassified, diagnostics,
    revenueRows: rows(revenue), costRows: rows(costs), sellingRows: rows(selling), expenseRows: rows(expenses),
  };
}
