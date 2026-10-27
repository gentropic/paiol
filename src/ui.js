// paiol — UI (PT-BR surface). Vanilla DOM, no framework. English identifiers in code, every
// label Nayara sees in Portuguese. A tabbed shell over the tested core: Insumos, Receitas,
// Produtos, the Preços payoff view (where the cost engine surfaces), and Ajustes.
//
// renderApp rebuilds the DOM from (store, view, actions) on every change. Add-forms only mutate
// on submit, so typing is never interrupted by a re-render.

import {
  indexStore, estimateLens, costBreakdown, priceFromCost, productUnitCost, productPrice, productBreakdown,
  effectiveMargin, effectiveSalesRates, PriceError, CycleError, YieldError, MarkupError, RefError,
} from './cost-engine.js';
import { ConversionError } from './units.js';
import { generateFichasPdf, generateReciboPdf, generateCommercialDocumentPdf, generateComandaPdf, generateClientStatementPdf, generateDrePdf, savePdf } from './pdf.js';
import { workbookBytes, parseInterchange, previewExchange } from './xlsx-exchange.js';
import { monthSummary, despesasByCategory, productSummary, clientSummary, revenueTrend, salesPeriodSummary, businessPeriodSummary, businessProfitTrend } from './reports.js';
import { DEFAULT_CHART, listTitles, titleState, titleSettlements, cashMovements, cashFlow, financeDashboard, categoryByKey, canonicalCategoryId, defaultCashAccount } from './finance.js';
import { clientFinancialStatement } from './client-statement.js';
import { managerialDre, orderMaterialEstimate } from './dre.js';
import { assetDepreciation } from './assets.js';
import { inventorySummary, ingredientInventory } from './inventory.js';
import { APP_VERSION } from './config.js';
import { productSaleKind, isBundleProduct, bundleKindLabel, orderItemGross, orderItemSaleLines, orderProduction, orderItemUnitCost, bundleCompositionText, saleNet } from './bundles.js';
import { findOpenOrderForClientDate, addOrAppendOrder } from './orders.js';

const STOCK_UNITS = ['g', 'kg', 'ml', 'l', 'un'];
// Built-in unit dimensions. A recipe component is offered only the units in its ingredient's
// (or sub-recipe's) own dimension, defaulting to that unit — so eggs bought in `un` are used in
// `un` (no weighing), while flour bought in `kg` can still be used in `g` (same dimension).
const UNIT_GROUPS = [['g', 'kg'], ['ml', 'l'], ['un']];
function unitsInDimension(u) {
  const group = UNIT_GROUPS.find((g) => g.includes(u)) || [u];
  return [u, ...group.filter((x) => x !== u)]; // natural unit first = the default selection
}
// Bottom-nav sections (iOS-native tab bar). Each section holds 1+ screens shown as a top
// segmented control. Grouped by frequency/mental-model so 8 screens fit ~5 thumb-reachable tabs.
const SECTIONS = [
  { id: 'inicio', label: 'Início', icon: '⌂', screens: [['inicio', 'Início']] },
  { id: 'pedidos', label: 'Pedidos', icon: '▤', screens: [['encomendas', 'Encomendas'], ['vendas', 'Vendidos']] },
  { id: 'producao', label: 'Produção', icon: '◇', screens: [['comanda', 'Comanda'], ['perdas', 'Perdas']] },
  { id: 'cadastro', label: 'Cadastro', icon: '＋', screens: [['insumos', 'Insumos'], ['receitas', 'Receitas'], ['produtos', 'Catálogo'], ['clientes', 'Clientes'], ['fornecedores', 'Fornecedores'], ['funcionarios', 'Funcionários']] },
  { id: 'financeiro', label: 'Financeiro', icon: '$', screens: [['fin-inicio', 'Início'], ['fin-dashboard', 'Dashboard'], ['fin-receber', 'A Receber'], ['fin-ficha', 'Ficha do cliente'], ['fin-pagar', 'A Pagar'], ['financeiro', 'Lançamentos'], ['fin-fluxo', 'Fluxo de Caixa'], ['fin-documentos', 'Recibo / Orçamento'], ['simulador', 'Simulador']] },
  { id: 'ajustes', label: 'Ajustes', icon: '⚙', screens: [['ajustes', 'Ajustes']] },
];
const SECTION_OF = {};
for (const sec of SECTIONS) for (const [sid] of sec.screens) SECTION_OF[sid] = sec;
for (const sid of ['fin-compras', 'fin-plano', 'fin-relatorios', 'fin-dre', 'precos', 'relatorios']) SECTION_OF[sid] = SECTIONS.find((s) => s.id === 'financeiro');

// Built-in help (PT-BR, Nayara's voice). One friendly entry per screen + a few plain-language
// concept answers. The ? button opens it with the current screen's topic expanded.
const HELP_SCREENS = [
  { id: 'inicio', icon: '🏠', label: 'Início', paras: [
    'Sua visão geral do mês e a agenda de hoje: contas que vencem, lembretes, aniversários e itens da lista de compras. Um lembrete sai da tela quando você marca “Feito”.',
  ] },
  { id: 'insumos', icon: '🧺', label: 'Insumos', paras: [
    'Tudo que você compra pra produzir — farinha, ovos, chocolate — e também embalagens e itens prontos de revenda (bombom, laço, cartãozinho). Cadastre cada um com a unidade de compra e o preço.',
    'Informe também a quantidade inicial e o estoque mínimo. Compras aumentam o saldo; a produção anotada na comanda e as perdas de insumo diminuem. Vendas não mexem nesse estoque.',
  ] },
  { id: 'receitas', icon: '📖', label: 'Receitas', paras: [
    'Aqui fica a ficha técnica completa: ingredientes/insumos, rendimento, tempos, embalagem, margem e o produto vendido relacionado.',
    'O custo soma ingredientes, gás, embalagem e custos fixos proporcionais. A mão de obra aparece como indicador, pois salários e pró-labore devem estar nos custos fixos. Em Financeiro, use o Simulador para testar rendimento, custo e lucro sem alterar a receita original.',
  ] },
  { id: 'produtos', icon: '🎂', label: 'Catálogo', paras: [
    'É a lista simples do que aparece nas comandas e vendas: nome, unidade ou peso e valor de venda.',
    'A composição e os cálculos ficam em Receitas. Ao relacionar uma receita a um produto, o custo calculado passa a servir de referência para a rentabilidade desse produto.',
  ] },
  { id: 'clientes', icon: '👥', label: 'Clientes', paras: [
    'Seus clientes — nome, telefone e endereço. Como a maioria é recorrente, cadastrar uma vez agiliza lançar os pedidos e montar a ficha (histórico de compras) de cada um.',
    'Ao abrir um cliente, você vê o histórico dele: total comprado, total pago, saldo pendente, as compras e os pagamentos. No fim da tela você gera as fichas em PDF (3 por folha, pra imprimir e arquivar): todas as vendas, só as em aberto (com saldo) ou só as pagas — sempre com uma prévia pra conferir antes.',
  ] },
  { id: 'precos', icon: '💰', label: 'Preços', paras: [
    'Para cada produto, mostra o custo de ingredientes, gás, custos fixos proporcionais e embalagem. A mão de obra é apenas indicador; salários já entram nos custos fixos. O preço sugerido considera também taxas de pagamento, comissão e margem desejada.',
    'Se aparecer “sem preço”, é porque falta cadastrar o preço de algum insumo usado.',
  ] },
  { id: 'encomendas', icon: '📋', label: 'Encomendas', paras: [
    'Os pedidos com data de entrega. Busque o cliente pelo nome, escolha a data e vá buscando os produtos — o total sai calculado. Toda encomenda de um cliente cadastrado entra na ficha dele, paga ou pendente.',
    'A lista começa mostrando todas as datas. Ordene por urgentes, retirada, motoboy ou nome do cliente; filtre por cliente, produto, entrega e situação. Marque ⭐ para destacar urgências e “Entregar” quando sair.',
    'Um novo pedido para o mesmo cliente cadastrado e a mesma data entra na encomenda ainda não entregue. Os produtos, frete, desconto e observações são somados sem perder pagamentos já lançados. Se a encomenda anterior já foi entregue, começa outro pedido.',
    'Em “Fichas do dia”, escolha uma data e marque os clientes cujas encomendas quer imprimir. A prévia gera o mesmo PDF compacto de 3 fichas por folha, com o valor e o saldo dos pedidos dessa data.',
  ] },
  { id: 'comanda', icon: '📝', label: 'Comanda do dia', paras: [
    'A Quantidade encomendada é calculada automaticamente a partir dos pedidos da data. Produção avulsa e estoque já existente são informados separadamente. Em Produzidos hoje, anote apenas o que você fez hoje. Marque ✓ quando terminar.',
    'Você pode adicionar produtos avulsos mesmo sem encomenda. O disponível para venda considera o estoque já existente, a produção registrada e os pedidos do dia. O custo da produção conta apenas o que foi produzido hoje.',
  ] },
  { id: 'fiado', icon: '💳', label: 'A Receber', paras: [
    'Quem ainda tem valor a pagar das encomendas — o total a receber e cada pendência. Toque numa para registrar um pagamento (total ou parcial); o saldo é recalculado sozinho.',
    'Para corrigir um pagamento lançado errado, use o estorno (↩) na encomenda — ele cancela sem apagar o histórico.',
  ] },
  { id: 'vendas', icon: '🛒', label: 'Vendidos', paras: [
    'Mostra as encomendas entregues pela data de entrega e as vendas rápidas pela data da venda. Entregue e pago são informações independentes: uma venda pode continuar a receber.',
    'Marque um ou mais produtos para filtrar e digite o nome do cliente para escolhê-lo. O filtro Todos inclui vendas recebidas e pendentes. Desistências ficam em uma visão separada.',
  ] },
  { id: 'financeiro', icon: '$', label: 'Financeiro', paras: [
    'Centraliza o dinheiro que entrou e saiu: pagamentos de vendas, outras receitas, despesas fixas, despesas variáveis e custos.',
    'O controle de pagamentos é somente financeiro e manual — sem QR Code, cobrança automática ou links de pagamento.',
  ] },
  { id: 'funcionarios', icon: '🧑‍🍳', label: 'Funcionários', paras: [
    'Cadastre nome, função, telefone e aniversário das pessoas que trabalham com você. Funcionários ativos que fazem aniversário hoje aparecem na agenda do Início.',
  ] },
  { id: 'fin-documentos', icon: '🧾', label: 'Recibo / Orçamento', paras: [
    'Gere um orçamento ou recibo não fiscal em PDF A4, com logo e dados da empresa, cliente, itens, valores e condição de pagamento.',
    'Você pode escolher um cliente cadastrado ou informar o nome de uma pessoa apenas para aquele documento. Nada é lançado no caixa automaticamente.',
  ] },
  { id: 'perdas', icon: '🗑️', label: 'Perdas', paras: [
    'O que se perdeu e não virou venda: uma massa que deu errado, um produto que não vendeu, uma embalagem danificada. Para insumo ou produto, o valor já vem calculado pela quantidade.',
    'O valor fica no relatório gerencial de produção. Ele não cria uma segunda saída de caixa quando a compra do insumo já foi paga.',
  ] },
  { id: 'relatorios', icon: '📊', label: 'Relatórios', paras: [
    'Seu balanço por mês: faturamento, custos, taxas, lucro e margem, com gráfico e o resultado por produto. Dá pra exportar.',
  ] },
  { id: 'fin-dre', icon: '📈', label: 'DRE gerencial', paras: [
    'Mostra receitas, custos e despesas pelo período a que pertencem, mesmo que ainda não tenham sido pagos ou recebidos. Escolha mês, ano ou datas específicas e gere o PDF A4.',
    'Depois da limpeza dos registros de teste, períodos sem lançamentos aparecem zerados. A DRE gerencial não substitui a demonstração contábil formal.',
  ] },
  { id: 'simulador', icon: '⚖️', label: 'Simulador', paras: [
    'Faça contas de “e se…”. Escolha uma receita e veja o que acontece com o custo e a margem se você fizer um lote maior — os ingredientes crescem junto, mas a mão de obra costuma subir pouco, então o custo por unidade cai.',
    'Compare a margem e o lucro a um preço fixo. Ajuda a decidir se mantém, adapta ou tira um produto do cardápio.',
  ] },
  { id: 'ajustes', icon: '⚙️', label: 'Ajustes', paras: [
    'Os valores manuais salvos já entram na precificação. Compare-os com as estimativas dos últimos meses completos; elas só substituem seus valores quando você escolher adotá-las.',
    'Aqui também ficam o histórico das notificações, a lista de compras, a lixeira, o backup e a importação/exportação. Você pode criar lembretes datados e acrescentar itens livres à lista.',
  ] },
];
const HELP_CONCEPTS = [
  { q: 'Por que um produto fica “sem preço”?', a: 'Quando algum insumo que ele usa ainda não tem preço cadastrado. Cadastre o preço em Insumos e o preço do produto aparece sozinho.' },
  { q: 'Estimativa x realidade', a: 'O app usa estimativas (das receitas) pra sugerir preços, e os dados reais (vendas e o que você produziu na comanda) pra mostrar a verdade nos relatórios.' },
  { q: 'Margem, taxa, comissão e imposto', a: 'O preço sugerido cobre insumos, gás, embalagem e custos fixos proporcionais. Depois reserva, sobre o preço de venda, a margem desejada, a taxa de pagamento, a comissão e eventual imposto percentual. O DAS do MEI já está nos custos fixos.' },
  { q: 'Meus dados estão seguros?', a: 'Ficam salvos no seu aparelho. Conecte o Dropbox em Ajustes pra ter backup e poder usar em mais de um lugar.' },
];

// ── DOM + format helpers ───────────────────────────────────────────────────────

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'value') node.value = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

const brl = (n) => 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',');
const pct = (frac) => (Number(frac) || 0) * 100;
const fmtNum = (n) => String(Math.round((Number(n) || 0) * 100) / 100).replace('.', ','); // up to 2 dp, comma decimal
const pctStr = (frac) => `${Math.round((Number(frac) || 0) * 100)}%`;
const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; } };
const fmtDateTime = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; } };
/** Parse a number that may use a comma decimal or currency symbols; '' / invalid → null. */
function parseNum(s) {
  if (s == null) return null;
  const str = String(s).replace(/[^\d.,-]/g, '').replace(',', '.'); // strip "R$", spaces, etc.
  if (str === '') return null;
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}
const fmtMoneyInput = (n) => (Number(n) || 0).toFixed(2).replace('.', ',');

/** A currency input (R$ prefix, formats to 2 decimals on blur). Read its value via `.input.value`. */
function moneyField(value, testid) {
  const input = el('input', { class: 'pa-money-input', type: 'text', inputmode: 'decimal', ...(testid ? { 'data-testid': testid } : {}) });
  input.value = value != null ? fmtMoneyInput(value) : '';
  input.addEventListener('blur', () => { const n = parseNum(input.value); if (n != null) input.value = fmtMoneyInput(n); });
  const wrap = el('div', { class: 'pa-money' }, [el('span', { class: 'pa-money-pfx', text: 'R$' }), input]);
  wrap.input = input;
  return wrap;
}
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Backward compatible: products created before this field existed are available for sale.
const productIsActive = (product) => !!product && product.active !== false;
const todayInput = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (ym) => { const [y, m] = String(ym).split('-'); return `${m}/${(y || '').slice(2)}`; };
const dateOnly = (iso) => {
  const value = String(iso || '');
  if (!value.includes('T')) return value.slice(0, 10);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const inDateRange = (iso, start, end) => (!start || dateOnly(iso) >= start) && (!end || dateOnly(iso) <= end);

function periodFields(start, end, onChange, prefix) {
  const from = el('input', { class: 'pa-input', 'data-testid': `${prefix}-start`, type: 'date', value: start || '' });
  const to = el('input', { class: 'pa-input', 'data-testid': `${prefix}-end`, type: 'date', value: end || '' });
  from.addEventListener('change', () => onChange({ start: from.value || null, end: to.value || null }));
  to.addEventListener('change', () => onChange({ start: from.value || null, end: to.value || null }));
  return el('div', { class: 'pa-period' }, [field('Data inicial', from), el('span', { class: 'pa-period-arrow', text: 'até' }), field('Data final', to)]);
}

// Day bucketing for the operação logs (Fornadas/Vendas) — local-day key + a friendly header.
const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function dayLabel(iso) {
  const now = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const k = dayKey(iso);
  if (k === dayKey(now)) return 'Hoje';
  if (k === dayKey(yest)) return 'Ontem';
  return fmtDate(iso);
}
/** A read-only event log (newest first), with a subtle date header whenever the day changes. */
function logList(items, rowFn) {
  const children = [];
  let last = null;
  for (const it of items) {
    const k = dayKey(it.at);
    if (k !== last) { children.push(el('li', { class: 'pa-daygroup', text: dayLabel(it.at) })); last = k; }
    children.push(rowFn(it));
  }
  return el('ul', { class: 'pa-list' }, children);
}
// Local "YYYY-MM" of an event — for the operação month scope (matches the <input type=month> value).
const monthOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
/** Live, focus-preserving text filter over a logList ul — also hides a day header when its rows all hide. */
function logSearchInput(placeholder, ul, testid) {
  const inp = el('input', { class: 'pa-input pa-search', type: 'search', placeholder, ...(testid ? { 'data-testid': testid } : {}) });
  inp.addEventListener('input', () => {
    const q = norm(inp.value);
    for (const child of ul.children) {
      if (!child.classList.contains('pa-list-item')) continue;
      const hay = child.getAttribute('data-search') ?? child.textContent;
      child.style.display = (!q || norm(hay).includes(q)) ? '' : 'none';
    }
    // Reconcile day headers: a header shows only if a visible row follows it (before the next header).
    let header = null; let seen = false;
    const flush = () => { if (header) header.style.display = seen ? '' : 'none'; };
    for (const child of ul.children) {
      if (child.classList.contains('pa-daygroup')) { flush(); header = child; seen = false; }
      else if (child.classList.contains('pa-list-item') && child.style.display !== 'none') seen = true;
    }
    flush();
  });
  return inp;
}
/** The search + month-scope control row shared by the two operação logs. */
function logFilters(ctx, ul, { searchPlaceholder, searchTestid, monthTestid }) {
  const month = ctx.view.logMonth || '';
  const monthInput = el('input', { class: 'pa-input pa-narrow', 'data-testid': monthTestid, type: 'month', value: month });
  monthInput.addEventListener('change', () => ctx.actions.setLogMonth(monthInput.value || null));
  return el('div', { class: 'pa-row pa-form pa-logfilters' }, [
    logSearchInput(searchPlaceholder, ul, searchTestid),
    monthInput,
  ]);
}

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  for (const c of [].concat(children)) if (c != null) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}

/**
 * A search box that live-filters a container's direct children by their `data-search` attribute
 * (pure DOM toggle — no re-render, so typing never loses focus). Set `data-search` on each row.
 */
function searchInput(placeholder, container, testid) {
  const inp = el('input', { class: 'pa-input pa-search', type: 'search', placeholder, ...(testid ? { 'data-testid': testid } : {}) });
  inp.addEventListener('input', () => {
    const q = norm(inp.value);
    for (const child of container.children) {
      const hay = child.getAttribute('data-search') ?? child.textContent;
      child.style.display = (!q || norm(hay).includes(q)) ? '' : 'none';
    }
  });
  return inp;
}

// ── Shell ───────────────────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} root
 * @param {{ store: import('./store.js').PaiolStore, view: { tab: string, busy: boolean, status: ?string, linked: boolean }, actions: object }} ctx
 */
export function renderApp(root, ctx) {
  const panels = {
    inicio: inicioPanel,
    insumos: insumosPanel, receitas: receitasPanel, produtos: produtosPanel, clientes: clientesPanel, fornecedores: fornecedoresPanel, funcionarios: funcionariosPanel,
    precos: precosPanel, vendas: vendasPanel,
    encomendas: encomendasPanel, comanda: comandaPeriodPanel, fiado: fiadoPanel, financeiro: financeiroPanel, despesas: financeiroPanel, perdas: perdasPanel,
    'fin-inicio': financeHomePanel, 'fin-dashboard': financeDashboardPanel, 'fin-receber': financeReceivablePanel, 'fin-ficha': financeClientStatementPanel, 'fin-pagar': financePayablePanel,
    'fin-fluxo': financeCashFlowPanel, 'fin-documentos': financeCommercialDocumentsPanel, 'fin-compras': financePurchasesPanel, 'fin-plano': financeChartPanel, 'fin-relatorios': financeReportsPanel, 'fin-dre': financeDrePanel,
    relatorios: relatoriosPanel, simulador: simuladorPanel, ajustes: ajustesPanel,
  };
  const section = SECTION_OF[ctx.view.tab] || SECTIONS[0];
  const tab = SECTION_OF[ctx.view.tab] === section ? ctx.view.tab : section.screens[0][0];

  const content = [];
  if (ctx.view.updateReady) {
    content.push(el('div', { class: 'pa-update', 'data-testid': 'update-banner' }, [
      el('span', { class: 'pa-grow', text: '✨ Nova versão disponível' }),
      el('button', { class: 'pa-btn pa-sm', 'data-testid': 'update-apply', onclick: () => ctx.actions.applyUpdate() }, 'Atualizar'),
    ]));
  }
  if (section.screens.length > 1 && section.id !== 'financeiro') {
    content.push(el('div', { class: 'pa-modulebar', 'aria-label': `Módulos de ${section.label}` }, section.screens.map(([sid, label]) =>
      el('button', { class: 'pa-modulebtn' + (sid === tab ? ' active' : ''), 'data-screen': sid, onclick: () => ctx.actions.setTab(sid) }, label))));
  }
  content.push((panels[tab] || inicioPanel)(ctx));

  const shell = [
    el('header', { class: 'pa-header' }, [
      el('div', { class: 'pa-brand pa-grow' }, [
        el('img', { class: 'pa-brand-logo', src: './brand-logo.png', alt: 'Quitutes do Paiol' }),
        el('div', { class: 'pa-brand-copy' }, [
          el('span', { class: 'pa-eyebrow', text: 'Gestão da confeitaria' }),
          el('h1', {}, [el('span', { text: 'Quitutes do Paiol' }), el('span', { class: 'pa-beta', title: 'Em evolução', text: 'beta' })]),
          el('p', { class: 'pa-sub', text: 'Organização simples. Decisões melhores.' }),
        ]),
      ]),
      el('div', { class: 'pa-help-area' }, [
        el('button', { class: 'pa-help-btn', 'data-testid': 'help-open', title: 'Ajuda', 'aria-label': 'Ajuda', onclick: () => ctx.actions.openModal({ kind: 'help' }) }, '?'),
        el('span', { class: 'pa-version', title: `Versão ${APP_VERSION}`, 'data-testid': 'app-version', text: `v${APP_VERSION}` }),
      ]),
    ]),
    el('main', { class: 'pa-main' }, content),
    el('nav', { class: 'pa-bottomnav' }, SECTIONS.map((sec) =>
      el('button', { class: 'pa-navbtn' + (sec === section ? ' active' : ''), 'data-section': sec.id, onclick: () => ctx.actions.setTab(sec.screens[0][0]) }, [
        el('span', { class: 'pa-navico', text: sec.icon }),
        el('span', { class: 'pa-navlbl', text: sec.label }),
      ]))),
  ];
  const existingBackdrop = root.querySelector(':scope > .pa-backdrop');
  if (ctx.view.modal && existingBackdrop?.paiolModal === ctx.view.modal) {
    // Data may sync while a form is open. Keep the same dialog node so its fields and focus survive.
    const oldShell = [...root.children].filter((child) => child !== existingBackdrop);
    existingBackdrop.before(...shell);
    for (const child of oldShell) child.remove();
  } else root.replaceChildren(...shell, ...(ctx.view.modal ? [modalOverlay(ctx)] : []));
}

/**
 * Sync ONLY the modal overlay — open/close a sheet without rebuilding the panel (and its hundreds
 * of rows) underneath. Big perf win on the most frequent interaction (tap a row → edit sheet), and
 * it preserves the list's scroll position. Full re-renders (on data mutations) go through renderApp.
 */
export function renderModal(root, ctx) {
  const existing = root.querySelector('.pa-backdrop');
  if (existing) existing.remove();
  if (ctx.view.modal) root.append(modalOverlay(ctx));
}

// ── Modal / bottom sheet ─────────────────────────────────────────────────────────

const MODALS = {}; // kind → (ctx, modal) → sheet body element. Registered alongside each screen.

function modalOverlay(ctx) {
  const m = ctx.view.modal;
  const build = MODALS[m.kind];
  const body = build ? build(ctx, m) : el('div');
  const backdrop = el('div', { class: 'pa-backdrop' });
  backdrop.paiolModal = m;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) ctx.actions.closeModal(); });
  backdrop.append(el('div', { class: 'pa-sheet', role: 'dialog' }, body));
  return backdrop;
}

/** Standard sheet scaffold: title, body rows, a Salvar/Cancelar footer, optional danger action. */
function sheet({ title, rows, onSave, saveTestid, saveLabel, danger }) {
  const dangers = !danger ? [] : (Array.isArray(danger) ? danger : [danger]);
  return [
    el('div', { class: 'pa-sheet-grab' }),
    el('h2', { class: 'pa-sheet-title', text: title }),
    el('div', { class: 'pa-sheet-body' }, rows),
    el('div', { class: 'pa-sheet-actions' }, [
      onSave && el('button', { class: 'pa-btn pa-primary pa-grow', 'data-testid': saveTestid, onclick: onSave }, saveLabel || 'Salvar'),
    ].filter(Boolean)),
    ...dangers.map((d) => el('button', { class: `pa-btn pa-ghost pa-sheet-danger ${d.className || 'pa-bad'}`, 'data-testid': d.testid, onclick: d.onClick }, d.label)),
  ].filter(Boolean);
}

function field(label, control) {
  return el('div', { class: 'pa-field' }, [el('label', { text: label }), control]);
}

function statCard(label, value, tone = 'soft') {
  return el('div', { class: `pa-stat pa-stat-${tone}` }, [el('span', { text: label }), el('strong', { text: value })]);
}

/** A comma-separated tags input. `.value()` → a clean, de-duplicated string[]. */
function tagsInput(tags, testid) {
  const inp = el('input', { class: 'pa-input', 'data-testid': testid, type: 'text', placeholder: 'etiquetas separadas por vírgula (ex.: festa, vegano)', value: (tags || []).join(', ') });
  return {
    el: inp,
    value: () => [...new Set(inp.value.split(',').map((t) => t.trim()).filter(Boolean))],
  };
}

/** Small chips rendering a record's tags (or nothing). */
function tagChips(tags) {
  if (!tags || !tags.length) return null;
  return el('span', { class: 'pa-tags' }, tags.map((t) => el('span', { class: 'pa-tag', text: t })));
}

function clientLabel(client) {
  return client?.code ? `${client.code} · ${client.name}` : (client?.name || 'Cliente');
}

const comparePtNames = (a, b) => String(a || '').localeCompare(String(b || ''), 'pt-BR', { sensitivity: 'base' });
const compareNamed = (a, b) => comparePtNames(a?.name, b?.name) || comparePtNames(a?.code, b?.code) || comparePtNames(a?.id, b?.id);

function clientSearchText(client) {
  return [client?.name, client?.code, client?.phone, ...(client?.tags || [])].filter(Boolean).join(' ');
}

MODALS.confirm = (ctx, m) => [
  el('h2', { class: 'pa-sheet-title', text: m.title || 'Confirmar' }),
  el('p', { class: 'pa-sheet-msg', text: m.message }),
  el('div', { class: 'pa-sheet-actions' }, [
    el('button', { class: 'pa-btn pa-ghost pa-grow', onclick: () => ctx.actions.closeModal() }, 'Cancelar'),
    el('button', { class: 'pa-btn pa-danger-btn pa-grow', 'data-testid': 'confirm-yes', onclick: () => m.onYes() }, m.yesLabel || 'Excluir'),
  ]),
];

/** Open a confirmation sheet before a destructive mutation. */
function confirmRemove(ctx, label, fn) {
  ctx.actions.openModal({
    kind: 'confirm', title: 'Remover?', message: `Remover ${label}? O registro ficará na Lixeira por 30 dias e poderá ser restaurado em Ajustes.`,
    yesLabel: 'Remover', onYes: () => ctx.actions.mutate(fn),
  });
}

function confirmDesistencia(ctx, enc) {
  ctx.actions.openModal({
    kind: 'confirm', title: 'Marcar como desistência?',
    message: 'A encomenda continuará no histórico. Os produtos sairão do previsto da comanda e o que já foi produzido ficará disponível para venda.',
    yesLabel: 'Confirmar desistência',
    onYes: () => ctx.actions.mutate((s) => s.markEncomendaDesistencia(enc.id, nowIso())),
  });
}

// Estorno — append-only events can't be edited/deleted, so a correction is a REVERSAL event that
// cancels the original (which stays in the history). Used on the operação logs.
function confirmEstorno(ctx, kind, id) {
  ctx.actions.openModal({
    kind: 'confirm', title: 'Estornar?', message: 'A entrada será cancelada — continua no histórico, mas não conta mais nos totais.',
    yesLabel: 'Estornar', onYes: () => ctx.actions.mutate((s) => s.addReversal({ id: uuid(), at: nowIso(), kind, refId: id })),
  });
}
/** Per-row estorno control: an "estornado" badge if already reversed, else an undo button. */
function estornoControl(ctx, kind, id) {
  if (ctx.store.isReversed(kind, id)) return el('span', { class: 'pa-badge', text: 'estornado' });
  return el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Estornar', 'data-testid': 'estornar', onclick: (e) => { e.stopPropagation(); confirmEstorno(ctx, kind, id); } }, '↩');
}

// Built-in help — opens with the current screen's topic expanded; everything else is browsable.
MODALS.help = (ctx) => {
  const here = ctx.view.tab;
  const topic = (s) => el('details', { class: 'pa-help-det', ...(s.id === here ? { open: 'open' } : {}) }, [
    el('summary', {}, [el('span', { text: `${s.icon} ${s.label}` }), s.id === here && el('span', { class: 'pa-badge', text: 'você está aqui' })].filter(Boolean)),
    ...s.paras.map((t) => el('p', { class: 'pa-help-p', text: t })),
  ]);
  const concept = (c) => el('details', { class: 'pa-help-det' }, [
    el('summary', { text: c.q }),
    el('p', { class: 'pa-help-p', text: c.a }),
  ]);
  return [
    el('div', { class: 'pa-sheet-grab' }),
    el('h2', { class: 'pa-sheet-title', text: 'Ajuda' }),
    el('p', { class: 'pa-sheet-msg', text: 'O paiol responde três perguntas: quanto cada coisa custa pra fazer, quanto cobrar, e se você está lucrando.' }),
    el('h3', { class: 'pa-h3', text: 'As telas' }),
    ...HELP_SCREENS.map(topic),
    el('h3', { class: 'pa-h3', text: 'Dúvidas comuns' }),
    ...HELP_CONCEPTS.map(concept),
    el('div', { class: 'pa-sheet-actions' }, [
      el('button', { class: 'pa-btn pa-primary pa-grow', 'data-testid': 'help-close', onclick: () => ctx.actions.closeModal() }, 'Entendi'),
    ]),
  ];
};

MODALS['install-app'] = (ctx) => {
  const instructions = [
    ['Android', 'Abra o Paiol no Chrome. Toque em ⋮ e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”. Confirme em Instalar.'],
    ['iPhone ou iPad', 'Abra o Paiol no Safari. Toque em Compartilhar, depois “Adicionar à Tela de Início” e em Adicionar. Se aparecer “Abrir como app”, ative essa opção.'],
    ['Computador', 'Abra o Paiol no Chrome ou Edge. Use o ícone de instalação na barra de endereços ou o menu ⋮ para instalar o site como aplicativo.'],
  ];
  const agent = navigator.userAgent;
  const suggested = /iPhone|iPad|iPod/.test(agent) ? 'iPhone ou iPad' : /Android/.test(agent) ? 'Android' : 'Computador';
  const address = 'https://gentropic.org/paiol/';
  const copy = el('button', { class: 'pa-btn', type: 'button', 'data-testid': 'install-copy' }, 'Copiar endereço');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(address); copy.textContent = 'Endereço copiado'; }
    catch { window.prompt('Copie o endereço do Paiol:', address); }
  });
  return sheet({ title: 'Paiol na tela inicial', rows: [
    el('p', { class: 'pa-hint', text: 'Instale um atalho com o ícone do Paiol para abrir o sistema sem procurar o link.' }),
    ctx.view.install?.available && el('button', { class: 'pa-btn pa-primary', type: 'button', 'data-testid': 'install-native', onclick: () => void ctx.actions.installApp() }, 'Instalar aplicativo agora'),
    el('p', { class: 'pa-hint', text: 'Se a opção de instalar não abrir aqui, use o navegador do seu aparelho:' }),
    ...instructions.map(([label, steps]) => el('details', { class: 'pa-help-det', ...(label === suggested ? { open: 'open' } : {}) }, [
      el('summary', { text: label }), el('p', { class: 'pa-help-p', text: steps }),
    ])),
    el('div', { class: 'pa-row pa-form' }, [el('a', { href: address, target: '_blank', rel: 'noopener', text: address }), copy]),
    el('p', { class: 'pa-hint', text: 'Se você abrir em outro navegador, conecte o Dropbox em Ajustes para ver nele os mesmos dados.' }),
  ].filter(Boolean) });
};

// ── Início (dashboard / cockpit) ─────────────────────────────────────────────────

const birthdayMatches = (birthday, date = todayInput()) => String(birthday || '').slice(5, 10) === String(date).slice(5, 10);
function birthdaysToday(store, date = todayInput()) {
  return [
    ...store.state.clients.filter((person) => birthdayMatches(person.birthday, date)).map((person) => ({ ...person, type: 'Cliente' })),
    ...store.state.employees.filter((person) => !person.inactive && birthdayMatches(person.birthday, date)).map((person) => ({ ...person, type: 'Funcionário' })),
    ...store.state.suppliers.filter((person) => !person.archived && birthdayMatches(person.birthday, date)).map((person) => ({ ...person, type: 'Fornecedor' })),
  ].sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
}

function workClockSessions(store) {
  const events = [...(store.state.workTimeEvents || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const starts = new Map(); const sessions = [];
  for (const event of events) {
    if (event.kind === 'start') starts.set(event.id, event);
    else if (event.kind === 'end' && starts.has(event.startId)) {
      const start = starts.get(event.startId); starts.delete(event.startId);
      const minutes = Math.max(0, (Date.parse(event.at) - Date.parse(start.at)) / 60000);
      if (Number.isFinite(minutes)) sessions.push({ start, end: event, minutes });
    }
  }
  return { sessions, active: [...starts.values()].at(-1) || null };
}

function workClockCard(ctx) {
  const { sessions, active } = workClockSessions(ctx.store);
  const today = todayInput();
  const todayMinutes = sessions.filter((session) => dateOnly(session.start.at) === today).reduce((sum, session) => sum + session.minutes, 0);
  const action = active
    ? () => ctx.actions.mutate((store) => store.addWorkTimeEvent({ id: uuid(), at: nowIso(), kind: 'end', startId: active.id }))
    : () => ctx.actions.mutate((store) => store.addWorkTimeEvent({ id: uuid(), at: nowIso(), kind: 'start' }));
  return el('section', { class: 'pa-card', 'data-testid': 'work-clock' }, [
    el('div', { class: 'pa-cardhead' }, [el('h2', { class: 'pa-grow', text: 'Horário de trabalho' }), el('button', { class: `pa-btn ${active ? '' : 'pa-primary'} pa-sm`, 'data-testid': 'work-clock-action', onclick: action }, active ? 'Encerrar atividades' : 'Iniciar atividades')]),
    el('p', { class: 'pa-hint', text: active ? `Iniciado em ${fmtDateTime(active.at)}. Encerre ao terminar as atividades do dia.` : 'Registre o início e o fim das atividades. Esse tempo é uma referência e não altera automaticamente o custo das receitas.' }),
    el('p', { class: 'pa-muted', text: `Tempo encerrado hoje: ${fmtNum(todayMinutes / 60)} h` }),
  ]);
}

function inicioPanel(ctx) {
  const { store } = ctx;
  const month = currentMonth();
  const sum = monthSummary(store, month);
  const [year, monthNumber] = month.split('-').map(Number);
  const payableMonth = listTitles(store, {
    direction: 'pagar', start: `${month}-01`,
    end: `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}`,
    status: 'aberto',
  }).reduce((total, row) => total + row.balance, 0);
  const semPreco = store.state.ingredients.filter((i) => store.currentPrice(i.id) == null).length;
  const vazio = !store.state.ingredients.length && !store.state.recipes.length && !store.state.products.length;
  const today = todayInput();
  const payableToday = listTitles(store, { direction: 'pagar', start: today, end: today, status: 'aberto' })
    .filter((row) => !row.title.cancelledAt && row.balance > 0.005);
  const payableTodayTotal = payableToday.reduce((total, row) => total + row.balance, 0);
  const openPayablesToday = () => {
    ctx.actions.setFinanceView({
      finPayPeriod: 'custom', finPayStart: today, finPayEnd: today, finStatus: 'aberto',
      finPartyId: '', finTitleCategory: '', finMethod: '',
    });
    ctx.actions.setTab('fin-pagar');
  };
  const notifications = store.state.notifications.filter((item) => item.date === today && !item.done).sort((a, b) => norm(a.title).localeCompare(norm(b.title)));
  const birthdays = birthdaysToday(store, today);
  const lowStock = inventorySummary(store).filter((row) => row.low && !row.ingredient.shoppingHidden);
  const manualShopping = store.state.shoppingItems.filter((item) => !item.done);
  const hasDailyNotices = notifications.length || birthdays.length || lowStock.length || manualShopping.length;

  return el('section', {}, [
    el('section', { class: 'pa-card pa-home-agenda' }, [
      el('div', { class: 'pa-cardhead' }, [
        el('div', { class: 'pa-grow' }, [
          el('span', { class: 'pa-eyebrow', text: 'Agenda financeira' }),
          el('h2', { text: `Hoje — ${fmtDate(`${today}T12:00:00`)}` }),
        ]),
      ]),
      el('button', { class: `pa-agenda-payable${payableTodayTotal > 0.005 ? ' pa-agenda-payable-due' : ''}`, type: 'button', 'data-testid': 'home-payable-today', onclick: openPayablesToday }, [
        el('div', { class: 'pa-grow' }, [
          el('strong', { text: payableTodayTotal > 0.005 ? 'Saldo a pagar hoje' : 'Nenhuma conta vence hoje' }),
          el('span', { class: 'pa-muted', text: payableToday.length ? `${payableToday.length} ${payableToday.length === 1 ? 'conta em aberto' : 'contas em aberto'}` : 'Toque para consultar o Contas a Pagar' }),
        ]),
        el('div', { class: 'pa-agenda-value' }, [
          el('strong', { text: brl(payableTodayTotal) }),
          el('span', { text: 'Ver contas ›' }),
        ]),
      ]),
    ]),
    el('section', { class: 'pa-card', 'data-testid': 'home-notifications' }, [
      el('div', { class: 'pa-cardhead' }, [
        el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Agenda do dia' }), el('h2', { text: 'Notificações' })]),
        el('button', { class: 'pa-btn pa-sm', onclick: () => ctx.actions.setTab('ajustes') }, 'Consultar histórico'),
      ]),
      !hasDailyNotices && el('p', { class: 'pa-empty', text: 'Nenhuma notificação para hoje.' }),
      ...notifications.map((item) => el('div', { class: 'pa-list-item', 'data-testid': 'home-notification' }, [
        el('div', { class: 'pa-grow' }, [el('strong', { text: item.title }), item.notes && el('span', { class: 'pa-muted', text: item.notes })].filter(Boolean)),
        el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'notification-done', onclick: () => ctx.actions.mutate((s) => s.upsertNotification({ ...item, done: true, doneAt: nowIso() })) }, 'Feito'),
      ])),
      ...birthdays.map((person) => el('div', { class: 'pa-list-item' }, [el('span', { class: 'pa-grow', text: `🎂 Aniversário: ${person.name}` }), el('span', { class: 'pa-badge', text: person.type })])),
      lowStock.length > 0 && el('div', { class: 'pa-callout' }, [
        el('strong', { text: 'Lista de compras · estoque baixo ou negativo' }),
        el('ul', { class: 'pa-list pa-tight' }, lowStock.map((row) => el('li', { class: 'pa-list-item' }, [el('span', { class: 'pa-grow', text: row.ingredient.name }), el('strong', { class: 'pa-bad', text: `${fmtNum(row.current)} ${row.ingredient.stockUnit}` })]))),
      ]),
      manualShopping.length > 0 && el('div', { class: 'pa-callout' }, [
        el('strong', { text: 'Itens incluídos na lista de compras' }),
        el('ul', { class: 'pa-list pa-tight' }, manualShopping.map((item) => el('li', { class: 'pa-list-item' }, [el('span', { class: 'pa-grow', text: item.name }), el('strong', { text: [fmtNum(item.qty), item.unit].filter(Boolean).join(' ') })]))),
      ]),
    ].filter(Boolean)),
    workClockCard(ctx),
    el('section', { class: 'pa-card' }, [
      el('div', { class: 'pa-row' }, [
        el('h2', { class: 'pa-grow', text: `Este mês — ${monthLabel(month)}` }),
      ]),
      el('table', { class: 'pa-kv' }, [
        el('tr', {}, [el('td', { text: 'Recebido' }), el('td', { class: 'pa-num', text: brl(sum.recebido) })]),
        el('tr', {}, [el('td', { text: 'A receber (saldo atual)' }), el('td', { class: 'pa-num', text: brl(sum.aReceber) })]),
        el('tr', {}, [el('td', { text: 'Pagos' }), el('td', { class: 'pa-num', text: brl(sum.despesas) })]),
        el('tr', {}, [el('td', { text: 'A pagar' }), el('td', { class: 'pa-num', text: brl(payableMonth) })]),
        el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Saldo de caixa' }), el('td', { class: 'pa-num' + (sum.saldoCaixa >= 0 ? '' : ' pa-bad'), text: brl(sum.saldoCaixa) })]),
      ]),
      el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'home-rel', onclick: () => ctx.actions.setTab('relatorios') }, 'Ver relatório completo →'),
    ]),
    semPreco > 0 && el('section', { class: 'pa-card' }, [
      el('p', { class: 'pa-status pa-bad' }, [el('strong', { text: `⚠ ${semPreco} insumo(s) sem preço` }), ' — produtos que os usam ficam sem preço.']),
      el('button', { class: 'pa-btn pa-sm', onclick: () => ctx.actions.setTab('insumos') }, 'Ir para Insumos'),
    ]),
    el('section', { class: 'pa-card' }, [
      el('h3', { class: 'pa-h3', text: 'Ações rápidas' }),
      el('div', { class: 'pa-row pa-form' }, [
        el('button', { class: 'pa-btn pa-primary', 'data-testid': 'home-encomenda', onclick: () => ctx.actions.setTab('encomendas') }, 'Nova encomenda'),
        el('button', { class: 'pa-btn', 'data-testid': 'home-comanda', onclick: () => ctx.actions.setTab('comanda') }, 'Comanda do dia'),
      ]),
      vazio && el('p', { class: 'pa-hint', text: 'Comece cadastrando seus insumos e receitas em Cadastro.' }),
    ]),
    !ctx.view.install?.installed && el('section', { class: 'pa-card', 'data-testid': 'home-install' }, [
      el('div', { class: 'pa-cardhead' }, [el('h2', { class: 'pa-grow', text: 'Paiol na sua tela inicial' })]),
      el('p', { class: 'pa-hint', text: 'Acesse o sistema pelo ícone, como um aplicativo.' }),
      el('button', { class: 'pa-btn pa-primary', 'data-testid': 'home-install-open', onclick: () => ctx.actions.openModal({ kind: 'install-app' }) }, 'Adicionar à tela inicial'),
    ]),
  ]);
}

// ── Insumos ───────────────────────────────────────────────────────────────────

function insumosPanel(ctx) {
  const { store } = ctx;
  const semPreco = store.state.ingredients.filter((i) => store.currentPrice(i.id) == null).length;
  const list = el('ul', { class: 'pa-list pa-rows' }, store.state.ingredients.slice().sort(compareNamed).map((ing) => insumoRow(ctx, ing)));
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('h2', { class: 'pa-grow', text: 'Insumos' }),
      el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'ins-new', onclick: () => ctx.actions.openModal({ kind: 'insumo-add' }) }, '+ Novo'),
    ]),
    semPreco > 0 && el('p', { class: 'pa-status pa-bad' },
      [el('strong', { text: `${semPreco} insumo(s) sem preço` }), ' — produtos que os usam ficam sem preço.']),
    store.state.ingredients.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhum insumo. Toque em “+ Novo” para começar.' })
      : el('div', {}, [el('p', { class: 'pa-hint pa-tap', text: 'Toque em um item para editar.' }), searchInput('Buscar insumo…', list, 'ins-search'), list]),
  ]);
}

// Clean, scannable row — the whole row opens the edit sheet.
function insumoRow(ctx, ing) {
  const { store } = ctx;
  const price = store.currentPrice(ing.id);
  const lastAt = store.lastPriceAt(ing.id);
  const inventory = ingredientInventory(store, ing.id);
  return el('li', { class: 'pa-row-item', 'data-search': `${ing.name} ${ing.lastSupplier || ''} ${(ing.tags || []).join(' ')}`, onclick: () => ctx.actions.openModal({ kind: 'insumo-edit', id: ing.id }) }, [
    el('div', { class: 'pa-grow' }, [
      el('div', {}, el('strong', { text: ing.name })),
      price != null
        ? el('span', { class: 'pa-muted', text: `${ing.stockUnit} · ${brl(price)}/${ing.stockUnit}${lastAt ? ` · ${fmtDate(lastAt)}` : ''}${ing.lastSupplier ? ` · ${ing.lastSupplier}` : ''}` })
        : el('span', {}, [el('span', { class: 'pa-muted', text: `${ing.stockUnit} · ` }), el('span', { class: 'pa-badge pa-bad', text: 'sem preço' })]),
      inventory && el('span', { class: inventory.low ? 'pa-badge pa-bad' : 'pa-muted', text: `Estoque: ${fmtNum(inventory.current)} ${ing.stockUnit}${inventory.minimum > 0 ? ` · mínimo ${fmtNum(inventory.minimum)}` : ''}` }),
      tagChips(ing.tags),
    ].filter(Boolean)),
    el('span', { class: 'pa-chev', text: '›' }),
  ]);
}

MODALS['insumo-add'] = (ctx) => insumoSheet(ctx, null);
MODALS['insumo-edit'] = (ctx, m) => insumoSheet(ctx, ctx.store.get('ingredients', m.id) || null);

function insumoSheet(ctx, ing) {
  const name = el('input', { class: 'pa-input', 'data-testid': 'ins-name', type: 'text', placeholder: 'Nome (ex.: Farinha de trigo)', value: ing ? ing.name : '' });
  const unit = el('select', { class: 'pa-input', 'data-testid': 'ins-unit' },
    STOCK_UNITS.map((u) => el('option', { value: u, text: u, ...(ing && u === ing.stockUnit ? { selected: 'selected' } : {}) })));
  const price = moneyField(ing ? ctx.store.currentPrice(ing.id) : null, 'ins-price');
  const supplier = el('input', { class: 'pa-input', 'data-testid': 'ins-supplier', type: 'text', placeholder: 'fornecedor da última compra', value: ing ? (ing.lastSupplier || '') : '' });
  const stockQty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'ins-stock', type: 'text', inputmode: 'decimal', placeholder: '0', value: ing && ing.stockQty != null ? String(ing.stockQty).replace('.', ',') : '' });
  const minStockQty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'ins-min-stock', type: 'text', inputmode: 'decimal', placeholder: '0', value: ing && ing.minStockQty != null ? String(ing.minStockQty).replace('.', ',') : '' });
  const physicalQty = ing && el('input', { class: 'pa-input pa-narrow', 'data-testid': 'ins-physical-stock', type: 'text', inputmode: 'decimal', placeholder: 'Digite a contagem de hoje' });
  const tags = tagsInput(ing && ing.tags, 'ins-tags');

  function save() {
    const nm = name.value.trim();
    if (!nm) { name.focus(); return; }
    const p = parseNum(price.input.value);
    const sup = supplier.value.trim();
    const tg = tags.value();
    const id = ing ? ing.id : uuid();
    const counted = physicalQty?.value.trim() ? parseNum(physicalQty.value) : null;
    if (physicalQty?.value.trim() && (counted == null || !Number.isFinite(counted) || counted < 0)) { physicalQty.focus(); return; }
    if (ing && !window.confirm(`Salvar alterações no insumo ${ing.name}?`)) return;
    ctx.actions.mutate((s) => {
      s.upsertIngredient({ ...(ing || {}), id, name: nm, stockUnit: unit.value, lastSupplier: sup || undefined, tags: tg.length ? tg : undefined,
        stockQty: Math.max(0, parseNum(stockQty.value) || 0), minStockQty: Math.max(0, parseNum(minStockQty.value) || 0), shoppingHidden: false });
      if (counted != null) {
        const before = ingredientInventory(s, id)?.current || 0;
        const delta = counted - before;
        if (Math.abs(delta) > 0.000001) s.addInventoryAdjustment({ id: uuid(), at: nowIso(), ingredientId: id, before, after: counted, delta, reason: 'Contagem física' });
      }
      const cur = ing ? s.currentPrice(id) : null;
      if (p != null && p !== cur) s.addPriceChange({ id: uuid(), at: nowIso(), ingredientId: id, price: p });
    });
  }

  const history = ing ? ctx.store.priceHistory(ing.id) : [];
  const stockHistory = ing ? (ctx.store.state.inventoryAdjustments || []).filter((entry) => entry.ingredientId === ing.id && !ctx.store.isReversed('inventoryAdjustment', entry.id)).slice().sort((a, b) => String(b.at).localeCompare(String(a.at))) : [];
  const currentStock = ing ? ingredientInventory(ctx.store, ing.id) : null;
  const rows = [
    field('Nome', name),
    field('Unidade de compra', unit),
    field('Preço (por ' + (ing ? ing.stockUnit : 'unidade') + ')', price),
    el('div', { class: 'pa-filtergrid' }, [field('Estoque inicial/base (não é o saldo de hoje)', stockQty), field('Estoque mínimo permitido', minStockQty)]),
    ing && el('div', { class: 'pa-detail-card' }, [
      el('strong', { text: `Saldo calculado agora: ${fmtNum(currentStock?.current || 0)} ${ing.stockUnit}` }),
      field('Contagem física de hoje (opcional)', physicalQty),
      el('p', { class: 'pa-hint', text: 'Digite aqui a quantidade que existe de verdade. Ao salvar, a diferença vira um ajuste registrado no histórico; você não precisa alterar o estoque inicial para acertar o saldo atual.' }),
    ]),
    el('p', { class: 'pa-hint', text: 'O saldo atual soma estoque inicial, compras e ajustes de contagem, depois desconta a produção registrada e as perdas. Vendas não alteram o estoque.' }),
    field('Fornecedor (opcional)', supplier),
    field('Etiquetas (opcional)', tags.el),
    history.length > 1 && el('details', { class: 'pa-history' }, [
      el('summary', { text: `histórico de preços (${history.length})` }),
      el('ul', { class: 'pa-list pa-tight' }, history.map((h) =>
        el('li', { class: 'pa-list-item' }, [el('span', { class: 'pa-muted', text: `${fmtDate(h.at)} — ${brl(h.price)}` })]))),
    ]),
    stockHistory.length > 0 && el('details', { class: 'pa-history' }, [
      el('summary', { text: `Histórico de contagens (${stockHistory.length})` }),
      el('ul', { class: 'pa-list pa-tight' }, stockHistory.map((entry) => el('li', { class: 'pa-list-item' }, [
        el('span', { class: 'pa-muted', text: `${fmtDate(entry.at)} · ${fmtNum(entry.before)} → ${fmtNum(entry.after)} ${ing.stockUnit}` }),
      ]))),
    ]),
  ].filter(Boolean);

  return sheet({
    title: ing ? 'Editar insumo' : 'Novo insumo',
    rows,
    onSave: save,
    saveTestid: 'ins-save',
    danger: ing ? { label: '🗑 Excluir insumo', testid: 'ins-delete', onClick: () => confirmRemove(ctx, `o insumo "${ing.name}"`, (s) => s.removeIngredient(ing.id)) } : null,
  });
}

// ── Receitas ──────────────────────────────────────────────────────────────────

function receitasPanel(ctx) {
  const { store } = ctx;
  const list = el('ul', { class: 'pa-list pa-rows' }, store.state.recipes.map((r) => receitaRow(ctx, r)));
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('h2', { class: 'pa-grow', text: 'Receitas' }),
      el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'rec-new', onclick: () => ctx.actions.openModal({ kind: 'receita-add' }) }, '+ Novo'),
    ]),
    store.state.recipes.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhuma receita. Toque em “+ Novo” para começar.' })
      : el('div', {}, [el('p', { class: 'pa-hint pa-tap', text: 'Toque em uma receita para editar o rendimento, os tempos e os itens.' }), searchInput('Buscar receita…', list, 'rec-search'), list]),
  ]);
}

// Clean, scannable row — the whole row opens the edit sheet.
function receitaRow(ctx, recipe) {
  const { store } = ctx;
  const n = recipe.components.length;
  const semPreco = unpricedInRecipe(store, recipe.id).length > 0;
  const linked = linkedProductForRecipe(store, recipe.id);
  return el('li', { class: 'pa-row-item', 'data-search': `${recipe.name} ${(recipe.tags || []).join(' ')}`, onclick: () => ctx.actions.openModal({ kind: 'receita-edit', id: recipe.id }) }, [
    el('div', { class: 'pa-grow' }, [
      el('div', {}, el('strong', { text: recipe.name })),
      el('span', { class: 'pa-muted', text: `${recipe.yieldNominal} ${recipe.yieldUnit} · ${recipe.productionMinutes ?? ((Number(recipe.activeMinutes) || 0) + (Number(recipe.ovenMinutes) || 0))}min de produção · ${n} ${n === 1 ? 'item' : 'itens'}` }),
      linked && el('span', { class: 'pa-muted', text: `Produto: ${linked.name} · venda ${brl(linked.salePrice || 0)}` }),
      semPreco && el('span', { class: 'pa-badge pa-bad', text: 'sem preço' }),
      tagChips(recipe.tags),
    ].filter(Boolean)),
    el('span', { class: 'pa-chev', text: '›' }),
  ]);
}

MODALS['receita-add'] = (ctx) => receitaSheet(ctx, null);
MODALS['receita-edit'] = (ctx, m) => receitaSheet(ctx, ctx.store.get('recipes', m.id) || null);

function receitaSheet(ctx, recipe) {
  const { store } = ctx;
  const draftId = recipe?.id || uuid();
  // Local draft of the component list — committed atomically on Salvar (so a new recipe and its
  // items are created in one mutation, and Cancelar discards everything).
  const comps = recipe ? recipe.components.map((c) => ({ ref: { ...c.ref }, qty: c.qty, unit: c.unit, ...(c.purpose ? { purpose: c.purpose } : {}) })) : [];

  const name = el('input', { class: 'pa-input', 'data-testid': 'rec-name', type: 'text', placeholder: 'Nome (ex.: Massa base de bolo)', value: recipe ? recipe.name : '' });
  const yieldQty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-yield', type: 'text', inputmode: 'decimal', placeholder: 'Rend.', value: recipe ? String(recipe.yieldNominal).replace('.', ',') : '' });
  const yieldUnit = el('select', { class: 'pa-input', 'data-testid': 'rec-yunit' },
    STOCK_UNITS.map((u) => el('option', { value: u, text: u, ...(recipe && u === recipe.yieldUnit ? { selected: 'selected' } : {}) })));
  const active = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-active', type: 'text', inputmode: 'numeric', placeholder: 'min ativos', value: recipe ? String(recipe.activeMinutes) : '' });
  const production = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-production', type: 'text', inputmode: 'numeric', placeholder: 'min produção', value: recipe ? String(recipe.productionMinutes ?? ((Number(recipe.activeMinutes) || 0) + (Number(recipe.ovenMinutes) || 0))) : '' });
  const oven = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-oven', type: 'text', inputmode: 'numeric', placeholder: 'min forno', value: recipe ? String(recipe.ovenMinutes) : '' });
  const notes = el('textarea', { class: 'pa-input pa-textarea', 'data-testid': 'rec-notes', rows: '3', placeholder: 'Observação / modo de preparo (opcional)' });
  notes.value = recipe ? (recipe.notes || '') : '';
  const weight = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-weight', type: 'text', inputmode: 'decimal', placeholder: 'peso do lote', value: recipe && recipe.weightTotal != null ? String(recipe.weightTotal).replace('.', ',') : '' });
  const weightUnit = el('select', { class: 'pa-input', 'data-testid': 'rec-wunit' },
    ['g', 'kg'].map((u) => el('option', { value: u, text: u, ...(recipe && u === recipe.weightUnit ? { selected: 'selected' } : {}) })));
  const tags = tagsInput(recipe && recipe.tags, 'rec-tags');
  const currentLinked = recipe ? linkedProductForRecipe(store, recipe.id) : null;
  const initialPackaging = currentLinked ? currentLinked.packagingCost : recipe?.packagingCost;
  const initialPackagingDesc = currentLinked ? currentLinked.packagingDesc : recipe?.packagingDesc;
  const initialMargin = currentLinked && currentLinked.targetMarginPct != null ? currentLinked.targetMarginPct : recipe?.targetMarginPct;
  const packaging = moneyField(initialPackaging || 0, 'rec-pkg');
  const packagingDesc = el('input', { class: 'pa-input', 'data-testid': 'rec-pkgdesc', type: 'text', placeholder: 'Ex.: caixinha, boleira ou saco', value: initialPackagingDesc || '' });
  const margin = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-margin', type: 'text', inputmode: 'decimal', placeholder: `padrão ${pct(store.getConfig().targetMarginPct)}`, value: initialMargin != null ? String(pct(initialMargin)).replace('.', ',') : '' });
  const rateInput = (key, testid, fallback) => {
    const saved = currentLinked?.[key] ?? recipe?.[key];
    return el('input', { class: 'pa-input pa-narrow', 'data-testid': testid, type: 'text', inputmode: 'decimal', placeholder: `padrão ${pct(fallback)}%`, value: saved != null ? String(pct(saved)).replace('.', ',') : '' });
  };
  const paymentFee = rateInput('paymentFeePct', 'rec-payment-fee', store.getConfig().paymentFeePct);
  const commission = rateInput('commissionPct', 'rec-commission', store.getConfig().commissionPct);
  const salesTax = rateInput('salesTaxPct', 'rec-sales-tax', store.getConfig().salesTaxPct);
  salesTax.placeholder = '0 = sem imposto percentual';
  // Component editor (insumos + other recipes, never itself).
  const options = [
    ...store.state.ingredients.slice().sort(compareNamed).map((i) => ({ kind: 'ingredient', id: i.id, label: `Insumo: ${i.name}`, unit: i.stockUnit })),
    ...store.state.recipes.filter((r) => !recipe || r.id !== recipe.id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })).map((r) => ({ kind: 'recipe', id: r.id, label: `Receita: ${r.name}`, unit: r.yieldUnit })),
  ];
  const refSel = el('select', { class: 'pa-input', 'data-testid': 'rec-compref' }, options.map((o, i) => el('option', { value: String(i), text: o.label })));
  const qty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-compqty', type: 'text', inputmode: 'decimal', placeholder: 'qtd' });
  const isPackaging = el('input', { type: 'checkbox', 'data-testid': 'rec-comp-packaging' });
  const unit = el('select', { class: 'pa-input', 'data-testid': 'rec-compunit' });
  function fillUnits() {
    const o = options[Number(refSel.value)] || options[0];
    unit.replaceChildren(...unitsInDimension(o ? o.unit : 'un').map((u) => el('option', { value: u, text: u })));
  }
  fillUnits();
  refSel.addEventListener('change', fillUnits);

  const itemsList = el('ul', { class: 'pa-list pa-tight' });
  const result = el('div', { 'data-testid': 'rec-result' });
  const feedback = el('p', { class: 'pa-hint', 'data-testid': 'rec-catalog-feedback' });
  function draftRecipe() {
    const marginText = margin.value.trim();
    const percentage = (input) => input.value.trim() === '' ? undefined : (parseNum(input.value) || 0) / 100;
    return {
      ...(recipe || { fermentMinutes: 0 }), id: draftId, name: name.value.trim(),
      yieldNominal: parseNum(yieldQty.value) || 0, yieldUnit: yieldUnit.value,
      activeMinutes: parseNum(active.value) || 0,
      productionMinutes: parseNum(production.value) || 0,
      ovenMinutes: parseNum(oven.value) || 0,
      components: comps,
      packagingCost: comps.some((component) => component.purpose === 'packaging') ? 0 : parseNum(packaging.input.value) || 0,
      packagingDesc: packagingDesc.value.trim() || undefined,
      targetMarginPct: marginText === '' ? undefined : (parseNum(marginText) || 0) / 100,
      paymentFeePct: percentage(paymentFee), commissionPct: percentage(commission), salesTaxPct: percentage(salesTax),
    };
  }
  function renderResult() { result.replaceChildren(recipeProfitabilityCard(store, draftRecipe(), currentLinked)); }
  function renderItems() {
    itemsList.replaceChildren(...(comps.length
      ? comps.map((c, idx) => ({ c, idx })).sort((a, b) => refName(store, a.c.ref).localeCompare(refName(store, b.c.ref), 'pt-BR', { sensitivity: 'base' })).map(({ c, idx }) => el('li', { class: 'pa-list-item' }, [
          el('span', { class: 'pa-grow', text: `${c.qty} ${c.unit} — ${refName(store, c.ref)}${c.purpose === 'packaging' ? ' · embalagem' : ''}` }),
          el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Remover item', onclick: () => { comps.splice(idx, 1); renderItems(); } }, '✕'),
        ]))
      : [el('li', { class: 'pa-empty pa-sm', text: 'Sem itens ainda.' })]));
    renderResult();
  }
  renderItems();

  function addComponent() {
    const q = parseNum(qty.value);
    const o = options[Number(refSel.value)];
    if (!o || !(q > 0)) { qty.focus(); return; }
    comps.push({ ref: { kind: o.kind, id: o.id }, qty: q, unit: unit.value, ...(o.kind === 'ingredient' && isPackaging.checked ? { purpose: 'packaging' } : {}) });
    qty.value = '';
    isPackaging.checked = false;
    renderItems();
  }

  function save(destination = 'recipe') {
    const nm = name.value.trim();
    const y = parseNum(yieldQty.value);
    if (!nm || !(y > 0)) { name.focus(); return; }
    const obs = notes.value.trim();
    const w = parseNum(weight.value);
    const tg = tags.value();
    const savedRecipe = {
      ...draftRecipe(), notes: obs || undefined,
      weightTotal: w == null ? undefined : w, weightUnit: w == null ? undefined : weightUnit.value,
      tags: tg.length ? tg : undefined,
    };
    const config = store.getConfig();
    const requestedMargin = savedRecipe.targetMarginPct ?? config.targetMarginPct;
    const rateFields = [[margin, 'margem'], [paymentFee, 'taxa de pagamento'], [commission, 'comissão'], [salesTax, 'imposto sobre a venda']];
    const invalid = rateFields.find(([input]) => input.value.trim() !== '' && (parseNum(input.value) == null || parseNum(input.value) < 0 || parseNum(input.value) >= 100));
    if (invalid) {
      feedback.textContent = `Informe ${invalid[1]} entre 0% e menos de 100%.`;
      invalid[0].focus();
      return;
    }
    const rates = effectiveSalesRates(savedRecipe, config);
    if (requestedMargin + rates.total >= 1) {
      feedback.textContent = 'Margem, taxa de pagamento, comissão e imposto sobre a venda precisam somar menos de 100%.';
      margin.focus();
      return;
    }
    let suggestedPrice;
    if (destination === 'catalog') {
      const matches = store.state.products.filter((p) => norm(p.name) === norm(nm));
      if (!currentLinked && matches.length > 1) {
        feedback.textContent = 'Há mais de um produto com esse nome no catálogo. Ajuste os nomes duplicados antes de incluir a receita.';
        return;
      }
      if (!currentLinked && matches.length === 1 && (matches[0].components || []).some((c) => c.kind === 'recipe' && c.id !== draftId)) {
        feedback.textContent = 'Esse nome já está ligado a outra receita. Ajuste o nome do produto antes de incluir.';
        return;
      }
      try { suggestedPrice = recipePricing(store, savedRecipe, currentLinked).suggested; }
      catch (e) { feedback.textContent = `Confira os custos antes de incluir no catálogo: ${friendlyError(e)}`; return; }
    }
    if (recipe && !window.confirm(`Salvar alterações na receita ${recipe.name}?`)) return;
    ctx.actions.mutate((s) => {
      s.upsertRecipe(savedRecipe);
      if (destination === 'catalog') {
        const matches = s.state.products.filter((p) => norm(p.name) === norm(nm));
        const linked = currentLinked || (matches.length === 1 ? matches[0] : null);
        const component = { kind: 'recipe', id: draftId, qty: linked ? saleQtyInRecipeUnit(linked, savedRecipe) : 1 };
        s.upsertProduct({
          ...(linked || {}), id: linked?.id || uuid(), name: nm,
          components: linked ? [...(linked.components || []).filter((c) => !(c.kind === 'recipe' && c.id === draftId)), component] : [component],
          saleQty: linked?.saleQty || 1, saleUnit: linked?.saleUnit || savedRecipe.yieldUnit,
          salePrice: linked?.salePrice != null ? linked.salePrice : suggestedPrice,
          saleKind: linked?.saleKind || 'normal', active: linked?.active !== false,
          packagingCost: savedRecipe.packagingCost, packagingDesc: savedRecipe.packagingDesc,
          targetMarginPct: savedRecipe.targetMarginPct,
          paymentFeePct: savedRecipe.paymentFeePct, commissionPct: savedRecipe.commissionPct, salesTaxPct: savedRecipe.salesTaxPct,
        });
      } else if (currentLinked) {
        s.upsertProduct({ ...currentLinked, packagingCost: savedRecipe.packagingCost, packagingDesc: savedRecipe.packagingDesc, targetMarginPct: savedRecipe.targetMarginPct, paymentFeePct: savedRecipe.paymentFeePct, commissionPct: savedRecipe.commissionPct, salesTaxPct: savedRecipe.salesTaxPct });
      }
    });
    if (destination === 'simulator') { ctx.view.simRecipeId = draftId; ctx.actions.setTab('simulador'); }
    if (destination === 'catalog') ctx.actions.setTab('produtos');
  }

  const rows = [
    field('Nome', name),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Rende' }), yieldQty, yieldUnit]),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Tempo total de produção (min)' }), production]),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Minutos ativos' }), active, el('span', { class: 'pa-lab', text: 'Minutos de forno' }), oven]),
    el('p', { class: 'pa-hint', text: 'Tempo total: do início da receita até ficar pronta, incluindo preparo e embalagem deste lote; distribui os custos fixos. Minutos ativos: tempo em que alguém trabalha diretamente nela, inclusive para embalar. Minutos de forno: apenas o uso do forno, para calcular o gás. Essas etapas podem se sobrepor; não some automaticamente ativos + forno para preencher o total. A mão de obra é indicador e não duplica salários dos custos fixos.' }),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Peso do lote (opcional)' }), weight, weightUnit]),
    el('p', { class: 'pa-hint', text: 'Peso total que a receita rende — ajuda a cotar por kg numa venda de lote maior.' }),
    field('Observação (modo de preparo)', notes),
    field('Etiquetas (opcional)', tags.el),
    el('h3', { class: 'pa-h3', text: 'Ingredientes e insumos' }),
    itemsList,
    options.length === 0
      ? el('p', { class: 'pa-hint', text: 'Cadastre insumos primeiro para montar a receita.' })
      : el('div', { class: 'pa-row pa-form' }, [refSel, qty, unit, el('label', { class: 'pa-check' }, [isPackaging, el('span', { text: 'É embalagem' })]),
          el('button', { class: 'pa-btn pa-sm', 'data-testid': 'rec-compadd', onclick: addComponent }, '+ item')]),
    el('h3', { class: 'pa-h3', text: 'Embalagem e rentabilidade' }),
    el('p', { class: 'pa-hint', text: 'Cadastre a embalagem em Insumos e adicione sua quantidade acima marcando “É embalagem”. A compra valoriza o estoque; a receita desconta a quantidade utilizada na produção.' }),
    el('details', {}, [el('summary', { text: 'Custo antigo de embalagem sem insumo' }), field('Valor por produto (legado)', packaging), el('p', { class: 'pa-hint', text: 'Este valor antigo só entra se não houver embalagem marcada na lista. Ao escolher um insumo de embalagem, o valor antigo é zerado para evitar duplicidade.' })]),
    field('Descrição da embalagem', packagingDesc),
    el('div', { class: 'pa-field' }, [el('label', { text: 'Margem desejada para esta receita (%)' }), el('div', { class: 'pa-row' }, [margin, el('span', { class: 'pa-lab', text: 'vazio = margem padrão dos Ajustes' })])]),
    el('h3', { class: 'pa-h3', text: 'Percentuais sobre a venda' }),
    el('p', { class: 'pa-hint', text: 'Campos vazios usam os valores de Ajustes. Preencha 0 quando esta receita não tiver a cobrança. Estes percentuais são descontados do preço de venda, junto com a margem desejada.' }),
    field('Taxa de pagamento, cartão ou plataforma (%)', paymentFee),
    field('Comissão de venda (%)', commission),
    field('Imposto proporcional sobre a venda (%)', salesTax),
    el('p', { class: 'pa-hint', text: 'Informe imposto percentual apenas quando incidir sobre o faturamento desta venda. O DAS do MEI já está incluído nos custos fixos de Ajustes e não deve ser lançado novamente aqui.' }),
    result,
    el('button', { class: 'pa-btn', 'data-testid': 'rec-open-simulator', onclick: () => save('simulator') }, '⚖ Salvar e abrir simulador'),
    el('button', { class: 'pa-btn pa-primary', 'data-testid': 'rec-add-catalog', onclick: () => save('catalog') }, currentLinked ? 'Atualizar produto no catálogo' : 'Salvar e incluir produto no catálogo'),
    feedback,
  ];

  [name, yieldQty, yieldUnit, active, production, oven, packaging.input, packagingDesc, margin, paymentFee, commission, salesTax].forEach((control) => {
    control.addEventListener('input', renderResult);
    control.addEventListener('change', renderResult);
  });
  renderResult();

  return sheet({
    title: recipe ? 'Editar receita' : 'Nova receita',
    rows,
    onSave: () => save(),
    saveTestid: 'rec-save',
    danger: recipe ? { label: '🗑 Excluir receita', testid: 'rec-delete', onClick: () => confirmRemove(ctx, `a receita "${recipe.name}"`, (s) => s.removeRecipe(recipe.id)) } : null,
  });
}

function refName(store, ref) {
  const coll = ref.kind === 'ingredient' ? 'ingredients' : 'recipes';
  return store.get(coll, ref.id)?.name || '(removido)';
}

/** Names of ingredients in a recipe's component DAG that have no current price (cycle-guarded). */
function unpricedInRecipe(store, recipeId, seen = new Set()) {
  const r = store.get('recipes', recipeId);
  if (!r || seen.has(recipeId)) return [];
  seen.add(recipeId);
  const out = new Set();
  for (const c of r.components) {
    if (c.ref.kind === 'ingredient') {
      const ing = store.get('ingredients', c.ref.id);
      if (ing && store.currentPrice(ing.id) == null) out.add(ing.name);
    } else {
      for (const n of unpricedInRecipe(store, c.ref.id, seen)) out.add(n);
    }
  }
  return [...out];
}

// ── Produtos ──────────────────────────────────────────────────────────────────

function produtosPanel(ctx) {
  const { store } = ctx;
  const list = el('ul', { class: 'pa-list pa-rows' }, store.state.products.map((p) => produtoRow(ctx, p)));
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('h2', { class: 'pa-grow', text: 'Produtos' }),
      el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'prod-new', onclick: () => ctx.actions.openModal({ kind: 'produto-add' }) }, '+ Novo'),
    ]),
    el('p', { class: 'pa-hint', text: 'Mantenha aqui todo o seu catálogo. Cadastre cestas e kits como embalagens; escolha os produtos internos em cada pedido. Somente produtos ativos aparecem em novas vendas, encomendas e comandas.' }),
    store.state.products.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhum produto ainda.' })
      : el('div', {}, [el('p', { class: 'pa-hint pa-tap', text: 'Toque em um produto para editar nome, unidade/peso e valor de venda.' }), searchInput('Buscar produto…', list, 'prod-search'), list]),
  ]);
}

// Clean, scannable row — the whole row opens the edit sheet.
function produtoRow(ctx, product) {
  const { store } = ctx;
  const semPreco = unpricedInProduct(store, product.id).length > 0;
  const active = productIsActive(product);
  const savedSalePrice = product.salePrice != null && product.salePrice !== '' && Number.isFinite(Number(product.salePrice)) && Number(product.salePrice) >= 0;
  const toggle = (ev) => {
    ev.stopPropagation();
    ctx.actions.mutate((s) => s.upsertProduct({ ...product, active: !active }));
  };
  return el('li', { class: 'pa-row-item' + (active ? '' : ' pa-reversed'), 'data-search': `${product.name} ${(product.tags || []).join(' ')} ${active ? 'ativo' : 'inativo'}`, onclick: () => ctx.actions.openModal({ kind: 'produto-edit', id: product.id }) }, [
    el('div', { class: 'pa-grow' }, [
      el('div', { class: 'pa-enc-title' }, [el('strong', { text: product.name }), isBundleProduct(product) && el('span', { class: 'pa-badge pa-urg', text: bundleKindLabel(product) }), el('span', { class: active ? 'pa-badge pa-ok' : 'pa-badge', text: active ? 'ativo' : 'inativo' })].filter(Boolean)),
      el('span', { class: 'pa-muted', text: `${fmtNum(product.saleQty || 1)} ${product.saleUnit || 'un'} · ${savedSalePrice ? 'venda' : 'sugerido'} ${brl(sellingPrice(store, product.id))}` }),
      semPreco && el('span', { class: 'pa-badge pa-bad', text: 'sem preço' }),
      tagChips(product.tags),
    ].filter(Boolean)),
    el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'prod-toggle-active', title: active ? 'Retirar das novas vendas' : 'Disponibilizar para venda', onclick: toggle }, active ? 'Desativar' : 'Ativar'),
    el('span', { class: 'pa-chev', text: '›' }),
  ]);
}

MODALS['produto-add'] = (ctx) => produtoSheet(ctx, null);
MODALS['produto-edit'] = (ctx, m) => produtoSheet(ctx, ctx.store.get('products', m.id) || null);

function produtoSheet(ctx, product) {
  const { store } = ctx;
  const name = el('input', { class: 'pa-input', 'data-testid': 'prod-name', type: 'text', placeholder: 'Nome (ex.: Bolo 500g, Cesta de Natal)', value: product ? product.name : '' });
  const saleQty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'prod-sale-qty', type: 'text', inputmode: 'decimal', placeholder: '1 ou 500', value: product ? String(product.saleQty || 1).replace('.', ',') : '1' });
  const saleUnit = el('select', { class: 'pa-input', 'data-testid': 'prod-sale-unit' }, STOCK_UNITS.map((u) => el('option', { value: u, text: u, ...((product?.saleUnit || 'un') === u ? { selected: 'selected' } : {}) })));
  const salePrice = moneyField(product ? sellingPrice(store, product.id) : null, 'prod-sale-price');
  const saleKind = el('select', { class: 'pa-input', 'data-testid': 'prod-sale-kind' }, [
    ['normal', 'Produto comum'], ['cesta', 'Cesta'], ['kit', 'Kit'], ['combo', 'Combo'],
  ].map(([value, label]) => el('option', { value, text: label, ...(productSaleKind(product) === value ? { selected: 'selected' } : {}) })));
  const activeChk = el('input', { type: 'checkbox', 'data-testid': 'prod-active' });
  activeChk.checked = product ? productIsActive(product) : true;
  const linkedRecipe = product ? store.state.recipes.find((r) => (product.components || []).some((c) => c.kind === 'recipe' && c.id === r.id)) : null;
  const packagingItems = product ? (product.components || []).filter((c) => c.kind === 'ingredient').map((c) => ({ id: c.id, qty: Number(c.qty) || 0 })) : [];
  const packagingBox = el('div', { class: 'pa-detail-card' });
  const packagingList = el('ul', { class: 'pa-list pa-tight' });
  const packagingIngredient = el('select', { class: 'pa-input', 'data-testid': 'prod-bundle-insumo' }, store.state.ingredients.slice().sort(compareNamed).map((i) => el('option', { value: i.id, text: `${i.name} (${i.stockUnit})` })));
  const packagingQty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'prod-bundle-insumo-qty', type: 'text', inputmode: 'decimal', placeholder: 'Qtd.' });
  const renderPackaging = () => packagingList.replaceChildren(...(packagingItems.length ? packagingItems.map((item, index) => {
    const ingredient = store.get('ingredients', item.id);
    return el('li', { class: 'pa-list-item' }, [el('span', { class: 'pa-grow', text: `${fmtNum(item.qty)} ${ingredient?.stockUnit || 'un'} · ${ingredient?.name || '(insumo removido)'}` }), el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => { packagingItems.splice(index, 1); renderPackaging(); } }, '✕')]);
  }) : [el('li', { class: 'pa-empty pa-sm', text: 'Nenhuma embalagem ou detalhe vinculado.' })]));
  const addPackaging = () => { const q = parseNum(packagingQty.value); if (!packagingIngredient.value || !(q > 0)) { packagingQty.focus(); return; } const current = packagingItems.find((item) => item.id === packagingIngredient.value); if (current) current.qty += q; else packagingItems.push({ id: packagingIngredient.value, qty: q }); packagingQty.value = ''; renderPackaging(); };
  packagingBox.append(el('p', { class: 'pa-hint', text: 'Opcional: informe cesta, caixa, laço, cartão ou outro insumo físico consumido em cada conjunto. O estoque baixa quando a montagem for registrada na comanda.' }), packagingList, store.state.ingredients.length ? el('div', { class: 'pa-row pa-form' }, [packagingIngredient, packagingQty, el('button', { class: 'pa-btn pa-sm', 'data-testid': 'prod-bundle-insumo-add', onclick: addPackaging }, '+ detalhe')]) : el('p', { class: 'pa-hint', text: 'Cadastre as embalagens em Insumos para vinculá-las aqui.' }));
  renderPackaging();
  const reconcileKind = () => { packagingBox.style.display = saleKind.value !== 'normal' ? '' : 'none'; };
  saleKind.addEventListener('change', reconcileKind); reconcileKind();

  function save() {
    const nm = name.value.trim();
    const q = parseNum(saleQty.value);
    const price = parseNum(salePrice.input.value);
    if (!nm || !(q > 0) || price == null || price < 0) { (nm ? saleQty : name).focus(); return; }
    const components = saleKind.value === 'normal'
      ? (product ? (isBundleProduct(product) ? (product.components || []).filter((component) => component.kind === 'recipe') : (product.components || [])) : [])
      : packagingItems.map((item) => ({ kind: 'ingredient', id: item.id, qty: item.qty }));
    if (product && !window.confirm(`Salvar alterações no produto ${product.name}?`)) return;
    ctx.actions.mutate((s) => s.upsertProduct({
      ...(product || {}), id: product ? product.id : uuid(), name: nm,
      components, packagingCost: product?.packagingCost || 0,
      saleQty: q, saleUnit: saleUnit.value, salePrice: price, saleKind: saleKind.value, active: activeChk.checked,
    }));
  }

  const rows = [
    field('Nome', name),
    field('Tipo para venda e Dashboard', saleKind),
    el('p', { class: 'pa-hint', text: 'Use Cesta, Kit ou Combo para identificar a embalagem vendida. Os produtos internos são escolhidos para cada cliente no pedido.' }),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Unidade ou peso vendido' }), saleQty, saleUnit]),
    field('Valor de venda', salePrice),
    product && (product.salePrice == null || product.salePrice === '') && el('p', { class: 'pa-hint', text: 'Este valor foi sugerido automaticamente. Ajuste se necessário e salve o produto para defini-lo como preço de venda praticado.' }),
    packagingBox,
    el('label', { class: 'pa-check' }, [activeChk, el('span', { text: 'Ativo para venda' })]),
    el('p', { class: 'pa-hint', text: 'Se desativado, permanece cadastrado e ligado à receita, mas não aparece em novas vendas, encomendas, comandas avulsas ou estimativas.' }),
    linkedRecipe
      ? el('p', { class: 'pa-callout', text: `Ficha técnica relacionada: ${linkedRecipe.name}. Altere ingredientes, embalagem e margem no cadastro de Receitas.` })
      : el('p', { class: 'pa-hint', text: 'Para produtos comuns, a ficha técnica fica em Receitas. Para cestas e kits, cadastre aqui a embalagem e seus materiais; o custo dos produtos internos será somado conforme cada pedido.' }),
  ];

  return sheet({
    title: product ? 'Editar produto' : 'Novo produto',
    rows,
    onSave: save,
    saveTestid: 'prod-save',
    danger: product ? { label: '🗑 Excluir produto', testid: 'prod-delete', onClick: () => confirmRemove(ctx, `o produto "${product.name}"`, (s) => s.removeProduct(product.id)) } : null,
  });
}

function productCompLabel(store, c) {
  if (c.kind === 'recipe') { const r = store.get('recipes', c.id); return `${c.qty} ${r?.yieldUnit || ''} de ${r?.name || '(removido)'}`; }
  if (c.kind === 'product') { const p = store.get('products', c.id); return `${c.qty} × ${p?.name || '(removido)'}`; }
  const i = store.get('ingredients', c.id); return `${c.qty} ${i?.stockUnit || ''} de ${i?.name || '(removido)'}`;
}

/** Ingredient names with no price reachable through a product's component DAG (cycle-guarded). */
function unpricedInProduct(store, productId, seenP = new Set()) {
  const p = store.get('products', productId);
  if (!p || seenP.has(productId)) return [];
  seenP.add(productId);
  const out = new Set();
  for (const c of p.components || []) {
    if (c.kind === 'recipe') for (const n of unpricedInRecipe(store, c.id)) out.add(n);
    else if (c.kind === 'product') for (const n of unpricedInProduct(store, c.id, seenP)) out.add(n);
    else if (c.kind === 'ingredient') { const ing = store.get('ingredients', c.id); if (ing && store.currentPrice(ing.id) == null) out.add(ing.name); }
  }
  return [...out];
}

// ── Clientes (Rev 04 — master data; encomendas/fichas attach to a client) ────────

function clientesPanel(ctx) {
  const { store } = ctx;
  const list = el('ul', { class: 'pa-list pa-rows' }, store.state.clients
    .slice().sort(compareNamed)
    .map((c) => clienteRow(ctx, c)));
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('h2', { class: 'pa-grow', text: 'Clientes' }),
      el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'cli-new', onclick: () => ctx.actions.openModal({ kind: 'cliente-add' }) }, '+ Novo'),
    ]),
    store.state.clients.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhum cliente. Toque em “+ Novo” para começar.' })
      : el('div', {}, [el('p', { class: 'pa-hint pa-tap', text: 'Busque pelo nome, código ou etiqueta. Toque em um cliente para editar.' }), searchInput('Buscar por nome, código ou etiqueta…', list, 'cli-search'), list]),
    store.state.encomendas.length > 0 && el('div', { class: 'pa-fichas' }, [
      el('h3', { class: 'pa-h3', text: 'Fichas para imprimir (3 por folha)' }),
      el('p', { class: 'pa-hint', text: 'Gera o PDF com as vendas de cada cliente — escolha quais incluir, imprima e arquive.' }),
      el('div', { class: 'pa-row pa-form' }, [
        fichasButton(ctx, '🖨 Todas', () => buildFichas(store, encomendasByMode(store, 'todas')), 'fichas-todas.pdf', 'fichas-todas'),
        fichasButton(ctx, '🖨 Em aberto', () => buildFichas(store, encomendasByMode(store, 'aberto')), 'fichas-em-aberto.pdf', 'fichas-aberto'),
        fichasButton(ctx, '🖨 Pagas', () => buildFichas(store, encomendasByMode(store, 'pagas')), 'fichas-pagas.pdf', 'fichas-pagas'),
      ]),
    ]),
  ].filter(Boolean));
}

function clienteRow(ctx, c) {
  const meta = [c.code && `Código ${c.code}`, c.phone, c.address].filter(Boolean).join(' · ');
  return el('li', { class: 'pa-row-item', 'data-search': clientSearchText(c), onclick: () => ctx.actions.openModal({ kind: 'cliente-edit', id: c.id }) }, [
    el('div', { class: 'pa-grow' }, [
      el('div', { class: 'pa-enc-title' }, [el('strong', { text: c.name }), c.inactive && el('span', { class: 'pa-badge', text: 'inativo' })].filter(Boolean)),
      meta && el('span', { class: 'pa-muted', text: meta }),
      tagChips(c.tags),
    ].filter(Boolean)),
    el('span', { class: 'pa-chev', text: '›' }),
  ]);
}

MODALS['cliente-add'] = (ctx) => clienteSheet(ctx, null);
MODALS['cliente-edit'] = (ctx, m) => clienteSheet(ctx, ctx.store.get('clients', m.id) || null);

// Client financial + commercial history (Rev 07 #6): compras/encomendas, pagamentos, saldo pendente.
function clienteHistorico(store, cli) {
  const orders = store.state.encomendas.filter((e) => e.clienteId === cli.id).sort((a, b) => (a.deliveryDate < b.deliveryDate ? 1 : -1));
  if (!orders.length) return el('p', { class: 'pa-hint', 'data-testid': 'cli-hist', text: 'Ainda sem compras registradas.' });
  const activeOrders = orders.filter((e) => !e.desistenciaAt);
  const totalComprado = activeOrders.reduce((s, e) => s + (e.total || 0), 0);
  const totalPago = activeOrders.reduce((s, e) => s + paymentStatus(store, e).paid, 0);
  const totalDescontado = activeOrders.reduce((s, e) => s + (paymentStatus(store, e).discounted || 0), 0);
  const saldo = activeOrders.reduce((s, e) => s + paymentStatus(store, e).saldo, 0);
  const pays = [];
  for (const e of orders) for (const pg of store.state.payments) if (pg.encomendaId === e.id && !store.isReversed('payment', pg.id)) pays.push(pg);
  pays.sort((a, b) => (a.at < b.at ? 1 : -1));
  const kv = (label, value, bad) => el('tr', bad ? { class: 'pa-kv-total' } : {}, [el('td', { text: label }), el('td', { class: 'pa-num' + (bad ? ' pa-bad' : ''), text: value })]);
  return el('div', { 'data-testid': 'cli-hist' }, [
    el('table', { class: 'pa-kv' }, [
      kv('Total comprado', brl(totalComprado)),
      kv('Total pago', brl(totalPago)),
      totalDescontado > 0.005 && kv('Descontos na quitação', brl(totalDescontado)),
      kv('Saldo pendente', brl(saldo), saldo > 0.005),
    ].filter(Boolean)),
    el('h3', { class: 'pa-h3', text: `Compras (${orders.length})` }),
    el('ul', { class: 'pa-list pa-tight' }, orders.map((e) => {
      const st = paymentStatus(store, e);
      return el('li', { class: 'pa-list-item' }, [
        el('div', { class: 'pa-grow' }, [
          el('div', {}, el('strong', { text: encomendaItemsResumo(store, e) })),
          el('span', { class: 'pa-muted', text: `${fmtDate(e.deliveryDate)}${e.entregue ? ' · entregue' : ''}${e.desistenciaAt ? ' · desistência' : ''}` }),
        ]),
        el('span', { class: 'pa-num', text: brl(e.total) }),
        el('span', { class: e.desistenciaAt ? 'pa-badge pa-bad' : `pa-badge ${st.cls}`, text: e.desistenciaAt ? 'desistência' : st.label }),
      ]);
    })),
    pays.length > 0 && el('h3', { class: 'pa-h3', text: `Pagamentos (${pays.length})` }),
    pays.length > 0 && el('ul', { class: 'pa-list pa-tight' }, pays.map((pg) => el('li', { class: 'pa-list-item' }, [
      el('span', { class: 'pa-grow pa-muted', text: `${fmtDate(pg.at)}${pg.forma ? ` · ${pg.forma}` : ''}` }),
      el('span', { class: 'pa-num', text: brl(pg.valor) }),
    ]))),
  ].filter(Boolean));
}

function clienteSheet(ctx, cli) {
  const code = el('input', { class: 'pa-input', 'data-testid': 'cli-code', type: 'text', placeholder: 'Ex.: 001 ou C-25', value: cli ? (cli.code || '') : '' });
  const name = el('input', { class: 'pa-input', 'data-testid': 'cli-name', type: 'text', placeholder: 'Nome do cliente', value: cli ? cli.name : '' });
  const phone = el('input', { class: 'pa-input', 'data-testid': 'cli-phone', type: 'tel', inputmode: 'tel', placeholder: 'Telefone', value: cli ? (cli.phone || '') : '' });
  const address = el('input', { class: 'pa-input', 'data-testid': 'cli-address', type: 'text', placeholder: 'Endereço', value: cli ? (cli.address || '') : '' });
  const birthday = el('input', { class: 'pa-input', 'data-testid': 'cli-birthday', type: 'date', value: cli ? (cli.birthday || '') : '' });
  const tags = tagsInput(cli?.tags, 'cli-tags');
  tags.el.placeholder = 'Ex.: Não vender, Não come doce';

  function save() {
    const nm = name.value.trim();
    if (!nm) { name.focus(); return; }
    const cd = code.value.trim();
    const duplicate = cd && ctx.store.state.clients.find((client) => client.id !== cli?.id && norm(client.code) === norm(cd));
    if (duplicate) {
      code.setCustomValidity(`Este código já pertence a ${duplicate.name}.`);
      code.reportValidity();
      return;
    }
    code.setCustomValidity('');
    const ph = phone.value.trim();
    const ad = address.value.trim();
    const tg = tags.value();
    ctx.actions.mutate((s) => s.upsertClient({ ...(cli || {}), id: cli ? cli.id : uuid(), name: nm, code: cd || undefined, phone: ph || undefined, address: ad || undefined, birthday: birthday.value || undefined, tags: tg.length ? tg : undefined }));
  }

  code.addEventListener('input', () => code.setCustomValidity(''));
  const rows = [field('Código manual (opcional)', code), field('Nome', name), field('Data de aniversário (opcional)', birthday), field('Telefone (opcional)', phone), field('Endereço (opcional)', address), field('Etiquetas (separadas por vírgula)', tags.el), el('p', { class: 'pa-hint', text: 'Use etiquetas para lembretes importantes, como “Não vender” ou “Não come doce”.' })];
  if (cli) {
    rows.push(el('h3', { class: 'pa-h3', text: 'Histórico' }), clienteHistorico(ctx.store, cli));
    rows.push(el('div', { class: 'pa-row pa-cardfoot' }, [
      fichasButton(ctx, '🖨 Gerar ficha (PDF)', () => buildFichas(ctx.store, ctx.store.state.encomendas.filter((e) => e.clienteId === cli.id)), `ficha-${cli.name}.pdf`),
      el('button', { class: 'pa-btn pa-sm', 'data-testid': 'cli-financial-statement', onclick: () => ctx.actions.openModal({ kind: 'client-statement', clientId: cli.id }) }, 'Ficha financeira detalhada'),
    ]));
  }
  return sheet({
    title: cli ? 'Editar cliente' : 'Novo cliente',
    rows,
    onSave: save,
    saveTestid: 'cli-save',
    danger: cli ? [
      { label: cli.inactive ? 'Reativar cliente' : 'Inativar cliente', className: 'pa-soft-danger', testid: 'cli-inactive', onClick: () => ctx.actions.mutate((s) => s.upsertClient({ ...cli, inactive: !cli.inactive })) },
      { label: '🗑 Excluir cliente', testid: 'cli-delete', onClick: () => confirmRemove(ctx, `o cliente "${cli.name}"`, (s) => s.removeClient(cli.id)) },
    ] : null,
  });
}

// ── Preços (the payoff) ─────────────────────────────────────────────────────────

function funcionariosPanel(ctx) {
  const rows = ctx.store.state.employees.slice().sort((a, b) => norm(a.name).localeCompare(norm(b.name))).map((employee) => el('li', {
    class: `pa-row-item${employee.inactive ? ' pa-reversed' : ''}`, onclick: () => ctx.actions.openModal({ kind: 'employee-edit', id: employee.id }),
  }, [
    el('div', { class: 'pa-grow' }, [el('strong', { text: employee.name }), el('span', { class: 'pa-muted', text: [employee.role, employee.phone, employee.birthday && `aniversário ${fmtDate(`${employee.birthday}T12:00:00`)}`].filter(Boolean).join(' · ') })]),
    employee.inactive && el('span', { class: 'pa-badge', text: 'inativo' }), el('span', { class: 'pa-chev', text: '›' }),
  ].filter(Boolean)));
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [el('h2', { class: 'pa-grow', text: 'Funcionários' }), el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'employee-new', onclick: () => ctx.actions.openModal({ kind: 'employee-add' }) }, '+ Novo')]),
    rows.length ? el('ul', { class: 'pa-list pa-rows' }, rows) : el('p', { class: 'pa-empty', text: 'Nenhum funcionário cadastrado.' }),
  ]);
}

MODALS['employee-add'] = (ctx) => employeeSheet(ctx, null);
MODALS['employee-edit'] = (ctx, modal) => employeeSheet(ctx, ctx.store.get('employees', modal.id) || null);
function employeeSheet(ctx, employee) {
  const name = el('input', { class: 'pa-input', 'data-testid': 'employee-name', type: 'text', value: employee?.name || '', placeholder: 'Nome' });
  const role = el('input', { class: 'pa-input', 'data-testid': 'employee-role', type: 'text', value: employee?.role || '', placeholder: 'Função / cargo' });
  const phone = el('input', { class: 'pa-input', type: 'tel', value: employee?.phone || '', placeholder: 'Telefone' });
  const birthday = el('input', { class: 'pa-input', 'data-testid': 'employee-birthday', type: 'date', value: employee?.birthday || '' });
  const save = () => {
    if (!name.value.trim()) { name.focus(); return; }
    ctx.actions.mutate((store) => store.upsertEmployee({ ...(employee || {}), id: employee?.id || uuid(), name: name.value.trim(), role: role.value.trim() || undefined, phone: phone.value.trim() || undefined, birthday: birthday.value || undefined }));
  };
  return sheet({ title: employee ? 'Editar funcionário' : 'Novo funcionário', rows: [field('Nome', name), field('Função / cargo', role), field('Data de aniversário', birthday), field('Telefone', phone)], onSave: save, saveTestid: 'employee-save', danger: employee ? [
    { label: employee.inactive ? 'Reativar funcionário' : 'Inativar funcionário', className: 'pa-soft-danger', onClick: () => ctx.actions.mutate((store) => store.upsertEmployee({ ...employee, inactive: !employee.inactive })) },
    { label: '🗑 Excluir funcionário', onClick: () => confirmRemove(ctx, `o funcionário "${employee.name}"`, (store) => store.removeEmployee(employee.id)) },
  ] : null });
}

function precosPanel(ctx) {
  const { store } = ctx;
  const config = store.getConfig();
  const es = store.toEngineStore();
  const lens = estimateLens(config);
  const activeProducts = store.state.products.filter(productIsActive);

  const cards = activeProducts.map((p) => {
    const savedSalePrice = p.salePrice != null && p.salePrice !== '' && Number.isFinite(Number(p.salePrice)) && Number(p.salePrice) >= 0
      ? Number(p.salePrice) : null;
    // Most common "incomplete" cause: a used ingredient has no price. Name them explicitly.
    const missing = unpricedInProduct(store, p.id);
    if (missing.length) {
      return el('div', { class: 'pa-sub-card', 'data-search': p.name }, [
        el('div', { class: 'pa-row' }, [
          el('strong', { class: 'pa-grow', text: p.name }),
          el('span', { class: 'pa-badge pa-bad', text: 'sem preço' }),
        ]),
        el('p', { class: 'pa-hint', text: `Valor de venda no cadastro: ${savedSalePrice == null ? 'não informado' : brl(savedSalePrice)}.` }),
        el('p', { class: 'pa-status', text: `Defina o preço de: ${missing.join(', ')}.` }),
      ]);
    }
    try {
      const b = productBreakdown(es, p.id, config, lens);
      const parts = [
        ['Ingredientes', b.ingredients],
        ['Mão de obra direta (indicador; não soma)', b.labor],
        ['Gás (forno)', b.gas],
        ['Custos fixos', b.fixed],
        ['Embalagem', b.packaging + p.packagingCost],
      ];
      const unitCost = productUnitCost(es, p.id, config, lens);
      const margin = effectiveMargin(es, p.id, config);
      const ownMargin = p.targetMarginPct != null;
      const rates = effectiveSalesRates(p, config);
      const price = priceFromCost(unitCost, { ...config, ...rates, targetMarginPct: margin });
      // Produtos displays the suggested price as a default when a sale price was not saved.
      // Use that same displayed value here, while identifying it as provisional.
      const practicedPrice = savedSalePrice == null ? sellingPrice(store, p.id) : savedSalePrice;
      const provisional = savedSalePrice == null;
      const salesRate = rates.total;
      const lucroUnit = practicedPrice - unitCost - practicedPrice * salesRate;
      const practicedMargin = practicedPrice > 0 ? lucroUnit / practicedPrice : null;
      const activeHoursPerUnit = config.valorHora > 0 ? b.labor / config.valorHora : 0;
      const lucroHora = activeHoursPerUnit > 0 ? lucroUnit / activeHoursPerUnit : null;
      const custoHora = activeHoursPerUnit > 0 ? unitCost / activeHoursPerUnit : null;
      const kv = (label, v, cls) => el('tr', cls ? { class: cls } : {}, [el('td', { text: label }), el('td', { class: 'pa-num' + (cls === 'pa-kv-total' ? '' : ''), text: brl(v) })]);
      return el('div', { class: 'pa-sub-card', 'data-search': p.name }, [
        el('div', { class: 'pa-row' }, [
          el('strong', { class: 'pa-grow', text: p.name }),
          el('span', { class: 'pa-price', text: `${provisional ? 'Valor exibido' : 'Praticado'} ${brl(practicedPrice)}` }),
        ]),
        el('table', { class: 'pa-kv' }, [
          ...parts.map(([label, v]) => kv(label, v)),
          kv('Custo unitário', unitCost, 'pa-kv-total'),
          el('tr', {}, [el('td', { text: `Preço sugerido (margem ${pct(margin)}%${ownMargin ? ' própria' : ''}, taxa ${pct(rates.paymentFeePct)}%, comissão ${pct(rates.commissionPct)}%, imposto ${pct(rates.salesTaxPct)}%)` }), el('td', { class: 'pa-num pa-strong', text: brl(price) })]),
          el('tr', {}, [el('td', { text: provisional ? 'Valor de venda exibido em Produtos' : 'Preço de venda praticado (Produtos)' }), el('td', { class: 'pa-num pa-strong', text: brl(practicedPrice) })]),
          el('tr', {}, [el('td', { text: 'Diferença entre valor de venda e sugerido' }), el('td', { class: `pa-num${practicedPrice < price - 0.005 ? ' pa-bad' : ' pa-positive'}`, text: Math.abs(practicedPrice - price) < 0.005 ? brl(0) : `${practicedPrice < price ? '− ' : '+ '}${brl(Math.abs(practicedPrice - price))}` })]),
          el('tr', {}, [el('td', { text: `Lucro por unidade (${provisional ? 'valor exibido' : 'preço praticado'})` }), el('td', { class: `pa-num${lucroUnit < 0 ? ' pa-bad' : ''}`, text: brl(lucroUnit) })]),
          el('tr', {}, [el('td', { text: provisional ? 'Margem estimada no valor exibido' : 'Margem praticada' }), el('td', { class: `pa-num${practicedMargin != null && practicedMargin < 0 ? ' pa-bad' : ''}`, text: practicedMargin == null ? '—' : `${(practicedMargin * 100).toFixed(1).replace('.', ',')}%` })]),
          el('tr', {}, [el('td', { text: `Lucro por hora de trabalho (${provisional ? 'valor exibido' : 'preço praticado'})` }), el('td', { class: `pa-num${lucroHora != null && lucroHora < 0 ? ' pa-bad' : ''}`, text: lucroHora == null ? '—' : brl(lucroHora) })]),
          custoHora != null && el('tr', {}, [el('td', { text: 'Custo por hora de trabalho' }), el('td', { class: 'pa-num', text: brl(custoHora) })]),
        ].filter(Boolean)),
        provisional && el('p', { class: 'pa-hint', text: 'Este valor aparece automaticamente no cadastro porque ainda não há preço de venda salvo. Salve o valor em Produtos para defini-lo como preço praticado.' }),
      ]);
    } catch (e) {
      return el('div', { class: 'pa-sub-card', 'data-search': p.name }, [
        el('div', { class: 'pa-row' }, [el('strong', { class: 'pa-grow', text: p.name }), el('span', { class: 'pa-badge', text: 'incompleto' })]),
        el('p', { class: 'pa-hint', text: `Valor de venda no cadastro: ${savedSalePrice == null ? 'não informado' : brl(savedSalePrice)}.` }),
        el('p', { class: 'pa-status', text: friendlyError(e) }),
      ]);
    }
  });

  const cardsEl = el('div', {}, cards);
  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Preços' }),
    el('p', { class: 'pa-hint', text: 'O valor de venda é o mesmo exibido em Produtos. Quando ainda não foi salvo, o cadastro mostra automaticamente o preço sugerido; os resultados ficam identificados como estimativas. Taxa de pagamento e comissão entram no cálculo.' }),
    activeProducts.length === 0
      ? el('p', { class: 'pa-empty', text: 'Ative um produto para ver custos e preços sugeridos.' })
      : el('div', {}, [searchInput('Buscar produto…', cardsEl, 'preco-search'), cardsEl]),
  ]);
}

function friendlyError(e) {
  if (e instanceof PriceError) return 'Defina o preço de todos os insumos usados nesta receita.';
  if (e instanceof CycleError) return 'Há um ciclo nas receitas (uma receita contém a si mesma).';
  if (e instanceof YieldError) return 'Rendimento inválido — verifique a receita.';
  if (e instanceof MarkupError) return 'Margem + taxa + comissão + imposto somam 100% ou mais — ajuste os percentuais da receita ou em Ajustes.';
  if (e instanceof RefError) return 'A receita deste produto não foi encontrada.';
  if (e instanceof ConversionError) return `Unidade incompatível (${e.from}→${e.to}). Use a mesma unidade do insumo.`;
  return String(e && e.message ? e.message : e);
}

// ── Comanda do dia (production list; Rev 07 rework) ──────────────────────────────
// Each product is a card: "Quantidade Prevista" (seeded from the day's orders, but EDITABLE and
// STORED — so avulso/manual prevista persists), "Produzidos/Estoque" (produced, independent of
// previsto — for stock, extras, or unplanned runs), a feito ✓, and a delete ✕ on avulso items.
// Stored per date in a Comanda record: { productId, prevista?, realizado, feito }. Edits persist
// WITHOUT a re-render (ctx.actions.persist) so inputs keep focus; indicators recompute in place.
function comandaDatesWithProducts(store, start, end) {
  const days = new Set();
  for (const order of store.state.encomendas) {
    const date = dateOnly(order.deliveryDate);
    if (!order.desistenciaAt && date >= start && date <= end && orderProduction(order).size > 0) days.add(date);
  }
  for (const comanda of store.state.comandas) {
    const date = dateOnly(comanda.date || comanda.id);
    if (date >= start && date <= end && (comanda.itens || []).length > 0) days.add(date);
  }
  return [...days].sort();
}

function orderedProductionForDate(store, date) {
  const ordered = new Map();
  for (const order of store.state.encomendas) {
    if (order.desistenciaAt || dateOnly(order.deliveryDate) !== date) continue;
    orderProduction(order, ordered);
  }
  return ordered;
}

function comandaDaySection(ctx, date, unitCost) {
  const { store } = ctx;
  const isToday = date === todayInput();
  const ordered = orderedProductionForDate(store, date);
  const stored = store.get('comandas', date);
  const items = new Map();
  for (const item of stored?.itens || []) items.set(item.productId, {
    manualQty: Math.max(0, Number(item.manualQty ?? (item.prevista == null ? 0 : Number(item.prevista) - (ordered.get(item.productId) || 0))) || 0),
    stockInicial: Math.max(0, Number(item.stockInicial) || 0), realizado: Number(item.realizado) || 0, feito: !!item.feito,
  });
  let productIds = [...new Set([...ordered.keys(), ...items.keys()])].sort((a, b) => norm(store.get('products', a)?.name || '').localeCompare(norm(store.get('products', b)?.name || '')));
  const ensure = (productId) => {
    if (!items.has(productId)) items.set(productId, { manualQty: 0, stockInicial: 0, realizado: 0, feito: false });
    return items.get(productId);
  };
  const previstaOf = (productId) => (ordered.get(productId) || 0) + (items.get(productId)?.manualQty || 0);
  const persist = () => {
    const itens = [...items.entries()].filter(([, item]) => item.manualQty > 0 || item.stockInicial > 0 || item.realizado > 0 || item.feito).map(([productId, item]) => ({ productId, manualQty: item.manualQty || 0, stockInicial: item.stockInicial || 0, realizado: item.realizado || 0, feito: !!item.feito }));
    ctx.actions.persist((s) => { if (itens.length) s.upsertComanda({ id: date, date, itens }); else if (s.get('comandas', date)) s.removeComanda(date); });
  };
  const indicators = el('div', { class: 'pa-comanda-ind' });
  const recompute = () => {
    let planned = 0; let produced = 0; let available = 0; let cost = 0;
    for (const productId of productIds) {
      const expected = Number(previstaOf(productId)) || 0;
      const done = Number(items.get(productId)?.realizado) || 0;
      planned += expected; produced += done; available += Math.max(0, (items.get(productId)?.stockInicial || 0) + done - (ordered.get(productId) || 0)); cost += done * unitCost(productId);
    }
    indicators.replaceChildren(el('table', { class: 'pa-kv' }, [
      el('tr', {}, [el('td', { text: 'Encomendado + avulso · Produzido' }), el('td', { class: 'pa-num', text: `${fmtNum(planned)} · ${fmtNum(produced)}` })]),
      el('tr', {}, [el('td', { text: 'Disponível para venda' }), el('td', { class: 'pa-num', 'data-testid': isToday ? 'cmd-disponivel' : `cmd-disponivel-${date}`, text: `${fmtNum(available)} un` })]),
      el('tr', {}, [el('td', { text: 'Custo da produção registrada' }), el('td', { class: 'pa-num', 'data-testid': isToday ? 'cmd-custo' : `cmd-custo-${date}`, text: brl(cost) })]),
    ]));
  };
  const list = el('div', { class: 'pa-cmd-list' });
  const itemCard = (productId) => {
    const product = store.get('products', productId);
    const item = ensure(productId);
    const avulso = !ordered.has(productId);
    const planned = el('span', { class: 'pa-num', 'data-testid': 'cmd-prevista', text: fmtNum(ordered.get(productId) || 0) });
    const manual = el('input', { class: 'pa-input pa-qty', 'data-testid': 'cmd-manual', type: 'text', inputmode: 'decimal', value: item.manualQty ? fmtNum(item.manualQty) : '', 'aria-label': 'produção avulsa' });
    const initial = el('input', { class: 'pa-input pa-qty', 'data-testid': 'cmd-stock-initial', type: 'text', inputmode: 'decimal', value: item.stockInicial ? fmtNum(item.stockInicial) : '', 'aria-label': 'estoque já existente' });
    const produced = el('input', { class: 'pa-input pa-qty', 'data-testid': 'cmd-realizado', type: 'text', inputmode: 'decimal', value: item.realizado ? fmtNum(item.realizado) : '', 'aria-label': 'produzidos hoje' });
    const done = el('input', { type: 'checkbox', 'data-testid': 'cmd-feito', 'aria-label': 'feito' }); done.checked = item.feito;
    const balance = el('span', { class: 'pa-muted pa-exced' });
    const updateBalance = () => {
      const remaining = Math.max(0, (Number(previstaOf(productId)) || 0) - (Number(item.stockInicial) || 0) - (Number(item.realizado) || 0));
      const available = Math.max(0, (Number(item.stockInicial) || 0) + (Number(item.realizado) || 0) - (ordered.get(productId) || 0));
      balance.textContent = [remaining > 0 ? `saldo a produzir: ${fmtNum(remaining)}` : '', available > 0 ? `disponível para venda: ${fmtNum(available)}` : ''].filter(Boolean).join(' · ');
    };
    const card = el('div', { class: `pa-cmd-item${item.feito ? ' pa-done' : ''}` });
    manual.addEventListener('change', () => { item.manualQty = Math.max(0, parseNum(manual.value) || 0); updateBalance(); recompute(); persist(); });
    initial.addEventListener('change', () => { item.stockInicial = Math.max(0, parseNum(initial.value) || 0); updateBalance(); recompute(); persist(); });
    produced.addEventListener('change', () => { item.realizado = Math.max(0, parseNum(produced.value) || 0); updateBalance(); recompute(); persist(); });
    done.addEventListener('change', () => { item.feito = done.checked; card.classList.toggle('pa-done', done.checked); persist(); });
    const remove = avulso ? el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'cmd-del', title: 'Excluir da comanda', onclick: () => { items.delete(productId); productIds = productIds.filter((id) => id !== productId); card.remove(); recompute(); persist(); } }, '×') : null;
    card.append(
      el('div', { class: 'pa-cmd-head' }, [el('strong', { class: 'pa-grow', text: product?.name || '(produto removido)' }), avulso && el('span', { class: 'pa-badge', text: 'avulso' }), remove].filter(Boolean)),
      el('div', { class: 'pa-cmd-fields' }, [el('label', { class: 'pa-cmd-field' }, [el('span', { text: 'Quantidade encomendada' }), planned]), el('label', { class: 'pa-cmd-field' }, [el('span', { text: 'Produção avulsa' }), manual]), el('label', { class: 'pa-cmd-field' }, [el('span', { text: 'Estoque já existente' }), initial]), el('label', { class: 'pa-cmd-field' }, [el('span', { text: 'Produzidos hoje' }), produced]), el('label', { class: 'pa-cmd-feito' }, [done, el('span', { text: 'Feito' })])]), balance,
    );
    updateBalance();
    return card;
  };
  const renderList = () => list.replaceChildren(...(productIds.length ? productIds.map(itemCard) : [el('p', { class: 'pa-empty', text: 'Nenhum item de produção nesta data.' })]));
  const search = el('input', { class: 'pa-input pa-search', 'data-testid': isToday ? 'cmd-prodsearch' : `cmd-prodsearch-${date}`, type: 'search', placeholder: 'Adicionar produto avulso neste dia…' });
  const suggestions = el('ul', { class: 'pa-list pa-tight pa-suggest', style: 'display:none' });
  search.addEventListener('input', () => {
    const query = norm(search.value);
    const matches = query ? store.state.products.filter((p) => productIsActive(p) && norm(p.name).includes(query) && !items.has(p.id) && !ordered.has(p.id)).slice(0, 6) : [];
    suggestions.style.display = matches.length ? '' : 'none';
    suggestions.replaceChildren(...matches.map((product) => el('li', { class: 'pa-row-item', 'data-testid': isToday ? 'cmd-prodresult' : `cmd-prodresult-${date}`, onclick: () => {
      if (isBundleProduct(product)) { ctx.actions.openModal({ kind: 'comanda-bundle-add', date, productId: product.id }); return; }
      items.set(product.id, { manualQty: 1, stockInicial: 0, realizado: 0, feito: false }); productIds.push(product.id); productIds.sort((a, b) => norm(store.get('products', a)?.name || '').localeCompare(norm(store.get('products', b)?.name || '')));
      search.value = ''; suggestions.style.display = 'none'; renderList(); recompute(); persist();
    } }, [el('strong', { class: 'pa-grow', text: product.name }), el('span', { class: 'pa-add', text: '+' })])));
  });
  const spec = buildComandaSpec(store, date);
  const orders = spec.groups.length ? el('details', { class: 'pa-history' }, [
    el('summary', { text: `Ver pedidos agrupados por cliente (${spec.groups.length})` }),
    ...spec.groups.map((group) => el('div', { class: 'pa-preview-group' }, [el('strong', { text: group.clientName }), el('span', { class: 'pa-muted', text: group.items.map((item) => `${fmtNum(item.qty)}× ${item.name}`).join(' · ') }), group.notes && el('span', { class: 'pa-muted', text: `Obs.: ${group.notes}` })].filter(Boolean))),
  ]) : null;
  renderList(); recompute();
  return el('section', { class: 'pa-detail-card', 'data-testid': 'cmd-period-day' }, [
    el('div', { class: 'pa-cardhead' }, [el('h3', { class: 'pa-h3 pa-grow', text: fmtDate(`${date}T12:00:00`) }), el('span', { class: 'pa-badge', text: `${productIds.length} item(ns)` })]),
    list, search, suggestions, indicators, orders,
  ].filter(Boolean));
}

MODALS['comanda-bundle-add'] = (ctx, modal) => comandaBundleSheet(ctx, modal);
MODALS['comanda-avulso-add'] = (ctx, modal) => comandaAvulsoSheet(ctx, modal);
function comandaAvulsoSheet(ctx, modal) {
  const { store } = ctx;
  const products = store.state.products.filter(productIsActive).sort((a, b) => norm(a.name).localeCompare(norm(b.name), 'pt-BR'));
  const date = el('input', { class: 'pa-input', type: 'date', min: modal.start, max: modal.end, value: modal.date, 'data-testid': 'cmd-avulso-date' });
  const search = el('input', { class: 'pa-input pa-search', type: 'search', placeholder: 'Digite o nome do produto…', 'data-testid': 'cmd-avulso-search' });
  const suggestions = el('ul', { class: 'pa-list pa-tight pa-suggest', style: 'display:none;max-height:240px;overflow-y:auto' });
  const chosen = el('div', { class: 'pa-cli-picker' });
  const qty = el('input', { class: 'pa-input pa-narrow', type: 'text', inputmode: 'decimal', value: '1', 'data-testid': 'cmd-avulso-qty' });
  const openingStock = el('input', { class: 'pa-input pa-narrow', type: 'text', inputmode: 'decimal', value: '0', 'data-testid': 'cmd-avulso-stock' });
  let productId = '';
  const choose = (product) => {
    productId = product.id;
    chosen.replaceChildren(el('div', { class: 'pa-cli-chip' }, [
      el('span', { class: 'pa-grow', text: product.name }),
      el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Trocar produto', onclick: () => { productId = ''; chosen.replaceChildren(); search.style.display = ''; search.value = ''; search.focus(); } }, '✕'),
    ]));
    search.value = '';
    search.style.display = 'none';
    suggestions.style.display = 'none';
  };
  search.addEventListener('input', () => {
    const query = norm(search.value);
    const matches = query ? products.filter((product) => norm(product.name).includes(query)).slice(0, 8) : [];
    suggestions.replaceChildren(...matches.map((product) => el('li', { class: 'pa-row-item', 'data-testid': 'cmd-avulso-result', onclick: () => choose(product) }, [el('strong', { class: 'pa-grow', text: product.name }), el('span', { class: 'pa-add', text: '+' })])));
    suggestions.style.display = matches.length ? '' : 'none';
  });
  function save() {
    const product = store.get('products', productId);
    const amount = parseNum(qty.value);
    if (!date.value || date.value < modal.start || date.value > modal.end) { date.focus(); return; }
    if (!product) { search.focus(); return; }
    const stock = parseNum(openingStock.value);
    if (!(amount > 0) && !(stock > 0)) { qty.focus(); return; }
    if (stock == null || stock < 0) { openingStock.focus(); return; }
    if (isBundleProduct(product)) {
      ctx.actions.openModal({ kind: 'comanda-bundle-add', date: date.value, productId, qty: amount });
      return;
    }
    ctx.actions.mutate((s) => {
      const current = s.get('comandas', date.value);
      const byId = new Map((current?.itens || []).map((item) => [item.productId, { ...item }]));
      const row = byId.get(productId) || { productId, realizado: 0, feito: false };
      const orderedQty = orderedProductionForDate(s, date.value).get(productId) || 0;
      row.manualQty = Math.max(0, Number(row.manualQty ?? (row.prevista == null ? 0 : Number(row.prevista) - orderedQty)) || 0) + Math.max(0, amount || 0);
      row.stockInicial = Math.max(0, Number(row.stockInicial) || 0) + stock;
      delete row.prevista;
      row.feito = false;
      byId.set(productId, row);
      s.upsertComanda({ id: date.value, date: date.value, itens: [...byId.values()] });
    });
  }
  return sheet({ title: 'Incluir item avulso na comanda', rows: [
    el('p', { class: 'pa-hint', text: 'Escolha uma data do período e o produto a produzir para estoque ou pronta entrega. O item aparecerá na comanda desse dia.' }),
    field('Data de produção', date),
    field('Produto', el('div', {}, [search, suggestions, chosen])),
    field('Quantidade avulsa a produzir', qty),
    field('Estoque já existente', openingStock),
    !products.length && el('p', { class: 'pa-empty', text: 'Cadastre um produto para incluir produção avulsa.' }),
  ].filter(Boolean), onSave: save, saveTestid: 'cmd-avulso-save', saveLabel: 'Incluir na comanda' });
}
function comandaBundleSheet(ctx, modal) {
  const { store } = ctx; const product = store.get('products', modal.productId);
  if (!product || !isBundleProduct(product)) return sheet({ title: 'Conjunto não encontrado', rows: [] });
  const bundleQty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'cmd-bundle-qty', type: 'text', inputmode: 'decimal', value: fmtNum(modal.qty || 1) });
  const children = [];
  const itemsBox = el('div', { class: 'pa-detail-card' });
  const candidates = store.state.products.filter((p) => productIsActive(p) && !isBundleProduct(p) && p.id !== product.id);
  const render = () => {
    const list = children.map((child, index) => {
      const p = store.get('products', child.productId); const qty = el('input', { class: 'pa-input pa-qty', type: 'text', inputmode: 'decimal', value: fmtNum(child.qty) });
      qty.addEventListener('input', () => { child.qty = parseNum(qty.value) || 0; });
      return el('li', { class: 'pa-list-item' }, [qty, el('span', { class: 'pa-grow', text: p?.name || '(produto removido)' }), el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => { children.splice(index, 1); render(); } }, '✕')]);
    });
    const search = el('input', { class: 'pa-input pa-search', 'data-testid': 'cmd-bundle-product', type: 'search', placeholder: 'Digite o produto para incluir…' });
    const suggestions = el('ul', { class: 'pa-list pa-tight pa-suggest', style: 'display:none;max-height:220px;overflow-y:auto' });
    search.addEventListener('input', () => {
      const query = norm(search.value);
      const matches = query ? candidates.filter((p) => norm(p.name).includes(query)).slice(0, 8) : [];
      suggestions.replaceChildren(...matches.map((p) => el('li', { class: 'pa-row-item', 'data-testid': 'cmd-bundle-result', onclick: () => {
        const current = children.find((child) => child.productId === p.id);
        if (current) current.qty += 1; else children.push({ productId: p.id, qty: 1 });
        render();
      } }, [el('strong', { class: 'pa-grow', text: p.name }), el('span', { class: 'pa-add', text: '+' })])));
      suggestions.style.display = matches.length ? '' : 'none';
    });
    itemsBox.replaceChildren(el('ul', { class: 'pa-list pa-tight' }, list.length ? list : [el('li', { class: 'pa-empty pa-sm', text: 'Adicione os produtos do conjunto.' })]), candidates.length ? el('div', {}, [search, suggestions]) : el('p', { class: 'pa-hint', text: 'Não há produtos comuns ativos para montar este conjunto.' }));
  };
  render();
  function save() {
    const qty = parseNum(bundleQty.value); if (!(qty > 0) || !children.some((child) => child.qty > 0)) { bundleQty.focus(); return; }
    const required = orderProduction({ itens: [{ productId: product.id, qty, bundleItems: children }] });
    const ordered = orderedProductionForDate(store, modal.date); const current = store.get('comandas', modal.date); const byId = new Map((current?.itens || []).map((item) => [item.productId, { ...item }]));
    for (const [productId, extra] of required) {
      const row = byId.get(productId) || { productId, realizado: 0, feito: false };
      row.manualQty = Math.max(0, Number(row.manualQty ?? (row.prevista == null ? 0 : Number(row.prevista) - (ordered.get(productId) || 0))) || 0) + extra;
      delete row.prevista;
      row.feito = false;
      byId.set(productId, row);
    }
    ctx.actions.mutate((s) => s.upsertComanda({ id: modal.date, date: modal.date, itens: [...byId.values()] }));
  }
  return sheet({ title: `Adicionar ${bundleKindLabel(product)} à comanda`, rows: [el('div', { class: 'pa-callout' }, [el('strong', { text: product.name }), el('span', { text: ` · ${fmtDate(`${modal.date}T12:00:00`)}` })]), field(`Quantidade de ${bundleKindLabel(product).toLowerCase()}s`, bundleQty), el('h3', { class: 'pa-h3', text: 'Produtos dentro de cada conjunto' }), el('p', { class: 'pa-hint', text: 'Escolha os produtos desta montagem. A composição pode mudar a cada cesta ou kit.' }), itemsBox, el('p', { class: 'pa-hint', text: 'Aqui você planeja apenas a produção. Para registrar cliente, preço, desconto e valor a receber, crie uma Encomenda.' })], onSave: save, saveTestid: 'cmd-bundle-save' });
}

function comandaPeriodPanel(ctx) {
  const { store } = ctx;
  const config = store.getConfig();
  const engineStore = store.toEngineStore();
  const lens = estimateLens(config);
  const unitCost = (productId) => { try { return productUnitCost(engineStore, productId, config, lens); } catch { return 0; } };
  const start = ctx.view.comandaStart || presetRange('semana')[0];
  const end = ctx.view.comandaEnd || presetRange('semana')[1];
  const startInput = el('input', { class: 'pa-input', 'data-testid': 'cmd-week-start', type: 'date', value: start });
  const endInput = el('input', { class: 'pa-input', 'data-testid': 'cmd-week-end', type: 'date', value: end });
  const updateRange = () => {
    const nextStart = startInput.value || start;
    const nextEnd = endInput.value && endInput.value >= nextStart ? endInput.value : nextStart;
    ctx.actions.setComandaRange({ comandaStart: nextStart, comandaEnd: nextEnd });
  };
  startInput.addEventListener('change', updateRange); endInput.addEventListener('change', updateRange);
  const days = comandaDatesWithProducts(store, start, end);
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Planejamento e registro' }), el('h2', { text: 'Comanda de produção' })]),
      el('button', { class: 'pa-btn pa-sm', 'data-testid': 'cmd-avulso-add', disabled: !store.state.products.some(productIsActive), onclick: () => ctx.actions.openModal({ kind: 'comanda-avulso-add', start, end, date: todayInput() >= start && todayInput() <= end ? todayInput() : start }) }, '+ Item avulso'),
      el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'cmd-preview', disabled: days.length === 0, onclick: () => ctx.actions.openModal({ kind: 'comanda-preview', start, end }) }, 'Visualizar / PDF'),
    ]),
    el('div', { class: 'pa-period' }, [field('Data inicial', startInput), el('span', { class: 'pa-period-arrow', text: 'até' }), field('Data final', endInput)]),
    el('p', { class: 'pa-hint', text: 'Aparecem apenas as datas com produtos encomendados ou produção avulsa registrada. Ajuste quantidades e registre a produção diretamente em cada dia.' }),
    ...days.map((day) => comandaDaySection(ctx, day, unitCost)),
    days.length === 0 && el('p', { class: 'pa-empty', text: 'Período sem encomendas ou produção avulsa registradas. Use “+ Item avulso” para planejar uma produção.' }),
  ].filter(Boolean));
}

function comandaPanel(ctx) {
  const { store } = ctx;
  const config = store.getConfig();
  const es = store.toEngineStore();
  const lens = estimateLens(config);
  const unitCost = (pid) => { try { return productUnitCost(es, pid, config, lens); } catch { return 0; } };

  const date = ctx.view.comandaDate || todayInput();
  const dateInput = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'cmd-date', type: 'date', value: date });
  dateInput.addEventListener('change', () => ctx.actions.setComandaDate(dateInput.value || todayInput()));

  const rangeStart = ctx.view.comandaStart || presetRange('semana')[0];
  const rangeEnd = ctx.view.comandaEnd || presetRange('semana')[1];
  const startInput = el('input', { class: 'pa-input', 'data-testid': 'cmd-week-start', type: 'date', value: rangeStart });
  const endInput = el('input', { class: 'pa-input', 'data-testid': 'cmd-week-end', type: 'date', value: rangeEnd });
  startInput.addEventListener('change', () => {
    const start = startInput.value || rangeStart;
    const end = endInput.value && endInput.value >= start ? endInput.value : start;
    ctx.actions.setComandaRange({ comandaStart: start, comandaEnd: end, comandaDate: start });
  });
  endInput.addEventListener('change', () => {
    const end = endInput.value || rangeEnd;
    const start = startInput.value && startInput.value <= end ? startInput.value : end;
    ctx.actions.setComandaRange({ comandaStart: start, comandaEnd: end, comandaDate: start });
  });

  const rangeDays = [];
  const cursor = new Date(`${rangeStart}T12:00:00`);
  const last = new Date(`${rangeEnd}T12:00:00`);
  while (cursor <= last && rangeDays.length < 31) {
    rangeDays.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  const weekCards = rangeDays.map((day) => {
    const planned = new Map();
    for (const order of store.state.encomendas) {
      if (order.desistenciaAt || dateOnly(order.deliveryDate) !== day) continue;
      for (const item of order.itens || []) planned.set(item.productId, (planned.get(item.productId) || 0) + (Number(item.qty) || 0));
    }
    const command = store.get('comandas', day);
    const produced = new Map((command?.itens || []).map((item) => [item.productId, Number(item.realizado) || 0]));
    const ids = [...new Set([...planned.keys(), ...produced.keys()])];
    const lines = ids.sort((a, b) => norm(store.get('products', a)?.name || '').localeCompare(norm(store.get('products', b)?.name || ''))).map((id) => {
      const product = store.get('products', id);
      const expected = planned.get(id) || 0; const done = produced.get(id) || 0;
      return el('li', { class: 'pa-list-item' }, [el('span', { class: 'pa-grow', text: product?.name || '(produto removido)' }), el('strong', { text: `${fmtNum(expected)} previsto · ${fmtNum(done)} produzido` })]);
    });
    return el('section', { class: `pa-detail-card${day === date ? ' pa-insight-teal' : ''}`, 'data-testid': 'cmd-week-day' }, [
      el('div', { class: 'pa-row' }, [
        el('strong', { class: 'pa-grow', text: fmtDate(`${day}T12:00:00`) }),
        el('button', { class: `pa-btn pa-sm${day === date ? ' pa-primary' : ''}`, onclick: () => ctx.actions.setComandaDate(day) }, day === date ? 'Dia selecionado' : 'Abrir dia'),
      ]),
      lines.length ? el('ul', { class: 'pa-list pa-tight' }, lines) : el('span', { class: 'pa-muted', text: 'Sem produção prevista.' }),
    ]);
  });
  const weekOverview = el('section', { class: 'pa-detail-card' }, [
    el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Calendário de produção' }), el('h3', { class: 'pa-h3', text: 'Período selecionado' })])]),
    el('div', { class: 'pa-period' }, [field('Data inicial', startInput), el('span', { class: 'pa-period-arrow', text: 'até' }), field('Data final', endInput)]),
    el('p', { class: 'pa-hint', text: 'Escolha o primeiro e o último dia como em uma reserva de viagem. O sistema reúne as encomendas de cada data sem alterar os pedidos.' }),
    ...weekCards,
    rangeDays.length >= 31 && el('p', { class: 'pa-callout', text: 'Para manter a leitura simples, a visualização mostra no máximo 31 dias por vez.' }),
  ].filter(Boolean));

  // Previsto seeded from the day's orders (per product).
  const ordered = new Map();
  for (const e of store.state.encomendas) {
    if (e.desistenciaAt || (e.deliveryDate || '').slice(0, 10) !== date) continue;
    for (const it of (e.itens || [])) ordered.set(it.productId, (ordered.get(it.productId) || 0) + (Number(it.qty) || 0));
  }
  // Working copy of the stored comanda: productId → { prevista|undefined, realizado, feito }.
  const stored = store.get('comandas', date);
  const items = new Map();
  for (const it of (stored?.itens || [])) items.set(it.productId, { prevista: it.prevista == null ? undefined : Number(it.prevista), realizado: Number(it.realizado) || 0, feito: !!it.feito });

  // Order products ∪ stored (avulso) products, by name. Mutable so add/remove avulso re-render rows.
  let pids = [...new Set([...ordered.keys(), ...items.keys()])]
    .sort((a, b) => norm(store.get('products', a)?.name || '').localeCompare(norm(store.get('products', b)?.name || '')));

  const ensure = (pid) => { let v = items.get(pid); if (!v) { v = { prevista: undefined, realizado: 0, feito: false }; items.set(pid, v); } return v; };
  const previstaOf = (pid) => { const v = items.get(pid); return v && v.prevista != null ? v.prevista : (ordered.get(pid) || 0); };
  const isAvulso = (pid) => !ordered.has(pid);

  function persistComanda() {
    const itens = [];
    for (const [pid, v] of items) {
      if ((v.prevista != null && v.prevista > 0) || (v.realizado || 0) > 0 || v.feito) {
        itens.push({ productId: pid, ...(v.prevista != null ? { prevista: v.prevista } : {}), realizado: v.realizado || 0, feito: !!v.feito });
      }
    }
    ctx.actions.persist((s) => { if (itens.length) s.upsertComanda({ id: date, date, itens }); else if (s.get('comandas', date)) s.removeComanda(date); });
  }

  const indEl = el('div', { class: 'pa-comanda-ind', 'data-testid': 'cmd-indicadores' });
  function recompute() {
    let custo = 0, totalPrev = 0, totalProd = 0, disponivel = 0;
    for (const pid of pids) {
      const prod = items.get(pid)?.realizado || 0;
      const prevista = previstaOf(pid);
      custo += prod * unitCost(pid);
      totalPrev += prevista; totalProd += prod;
      disponivel += Math.max(0, prod - prevista); // produced beyond the prevista → free to sell
    }
    indEl.replaceChildren(
      el('table', { class: 'pa-kv' }, [
        el('tr', {}, [el('td', { text: 'Previsto · Produzido' }), el('td', { class: 'pa-num', text: `${fmtNum(totalPrev)} · ${fmtNum(totalProd)}` })]),
        el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Disponível para venda' }), el('td', { class: 'pa-num', 'data-testid': 'cmd-disponivel', text: `${fmtNum(disponivel)} un` })]),
        el('tr', {}, [el('td', { text: 'Custo de produção' }), el('td', { class: 'pa-num', 'data-testid': 'cmd-custo', text: brl(custo) })]),
      ]),
      el('p', { class: 'pa-hint', text: 'Produzido/estoque = o que você FEZ (não o que vendeu) — vale pra estoque ou produção extra. O que passar do previsto fica disponível pra vender avulso. O dinheiro recebido e o lucro ficam em A Receber / Relatórios.' }),
    );
  }

  const list = el('div', { class: 'pa-cmd-list' });
  function itemCard(pid) {
    const p = store.get('products', pid);
    const v = items.get(pid) || { prevista: undefined, realizado: 0, feito: false };
    const avulso = isAvulso(pid);
    const prevInput = el('input', { class: 'pa-input pa-qty', 'data-testid': 'cmd-prevista', type: 'text', inputmode: 'decimal', value: v.prevista != null ? fmtNum(v.prevista) : (ordered.get(pid) ? fmtNum(ordered.get(pid)) : ''), 'aria-label': 'quantidade prevista' });
    const prodInput = el('input', { class: 'pa-input pa-qty', 'data-testid': 'cmd-realizado', type: 'text', inputmode: 'decimal', value: v.realizado ? fmtNum(v.realizado) : '', 'aria-label': 'produzidos/estoque' });
    const chk = el('input', { type: 'checkbox', 'data-testid': 'cmd-feito', 'aria-label': 'feito' }); chk.checked = v.feito;
    const saldo = el('span', { class: 'pa-muted pa-exced' });
    const updSaldo = () => { const prod = items.get(pid)?.realizado || 0; const d = prod - previstaOf(pid); saldo.textContent = d > 0 ? `disponível para venda: ${fmtNum(d)}` : (prod > 0 && d < 0 ? `saldo a produzir: ${fmtNum(-d)}` : ''); };
    prevInput.addEventListener('input', () => { const n = parseNum(prevInput.value); ensure(pid).prevista = n == null ? undefined : n; updSaldo(); recompute(); persistComanda(); });
    prodInput.addEventListener('input', () => { ensure(pid).realizado = parseNum(prodInput.value) || 0; updSaldo(); recompute(); persistComanda(); });
    const card = el('div', { class: 'pa-cmd-item' + (v.feito ? ' pa-done' : '') });
    chk.addEventListener('change', () => { ensure(pid).feito = chk.checked; card.classList.toggle('pa-done', chk.checked); persistComanda(); });
    updSaldo();
    const del = avulso ? el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'cmd-del', title: 'Excluir da comanda', onclick: () => { items.delete(pid); pids = pids.filter((x) => x !== pid); card.remove(); recompute(); persistComanda(); } }, '✕') : null;
    card.append(
      el('div', { class: 'pa-cmd-head' }, [
        el('strong', { class: 'pa-grow', text: p ? p.name : '(produto removido)' }),
        avulso && el('span', { class: 'pa-badge', text: 'avulso' }),
        del,
      ].filter(Boolean)),
      el('div', { class: 'pa-cmd-fields' }, [
        el('label', { class: 'pa-cmd-field' }, [el('span', { text: 'Quantidade Prevista' }), prevInput]),
        el('label', { class: 'pa-cmd-field' }, [el('span', { text: 'Produzidos/Estoque' }), prodInput]),
        el('label', { class: 'pa-cmd-feito' }, [chk, el('span', { text: 'Feito' })]),
      ]),
      saldo,
    );
    return card;
  }
  function renderList() {
    list.replaceChildren(...(pids.length ? pids.map(itemCard)
      : [el('p', { class: 'pa-empty', text: 'Nada para este dia. Faça uma encomenda com entrega nesta data, ou adicione um produto avulso abaixo.' })]));
  }
  renderList();
  recompute();

  // Add an avulso product (stock / pronta-entrega — not from an order). Appended in place (no full
  // re-render), so an unfilled row survives; it persists as soon as she types a prevista/produzido.
  const search = el('input', { class: 'pa-input pa-search', 'data-testid': 'cmd-prodsearch', type: 'search', placeholder: 'Adicionar produto avulso (estoque, pronta entrega)…' });
  const results = el('ul', { class: 'pa-list pa-tight pa-suggest', style: 'display:none' });
  function renderResults() {
    const q = norm(search.value);
    if (!q) { results.style.display = 'none'; results.replaceChildren(); return; }
    const matches = store.state.products.filter((p) => productIsActive(p) && norm(p.name).includes(q) && !items.has(p.id) && !ordered.has(p.id)).slice(0, 6);
    results.style.display = matches.length ? '' : 'none';
    results.replaceChildren(...matches.map((p) => el('li', { class: 'pa-row-item', 'data-testid': 'cmd-prodresult', onclick: () => {
      items.set(p.id, { prevista: undefined, realizado: 0, feito: false });
      pids = [...new Set([...pids, p.id])].sort((a, b) => norm(store.get('products', a)?.name || '').localeCompare(norm(store.get('products', b)?.name || '')));
      search.value = ''; renderResults(); renderList();
    } }, [el('div', { class: 'pa-grow' }, el('strong', { text: p.name })), el('span', { class: 'pa-add', text: '+' })])));
  }
  search.addEventListener('input', renderResults);

  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('h2', { class: 'pa-grow', text: 'Produção semanal' }),
      el('button', { class: 'pa-btn pa-sm', 'data-testid': 'cmd-preview', onclick: () => ctx.actions.openModal({ kind: 'comanda-preview', date }) }, 'Visualizar / PDF'),
      dateInput,
    ]),
    el('p', { class: 'pa-hint', text: 'Veja a produção de vários dias de uma vez. Abra um dia para conferir as encomendas, ajustar quantidades e registrar o que foi produzido.' }),
    weekOverview,
    el('h3', { class: 'pa-h3', text: `Comanda do dia · ${fmtDate(`${date}T12:00:00`)}` }),
    el('p', { class: 'pa-hint', text: 'A Quantidade Prevista vem das encomendas deste dia. Você pode ajustar e anotar o que PRODUZIU em Produzidos/Estoque, inclusive produtos avulsos.' }),
    list,
    search, results,
    indEl,
  ]);
}

// ── Vendas (Sale — revenue, with snapshotted cost for true margin) ───────────────

function buildComandaSpec(store, date) {
  const groups = new Map();
  const ordered = orderedProductionForDate(store, date);
  for (const enc of store.state.encomendas) {
    if (enc.desistenciaAt || dateOnly(enc.deliveryDate) !== date) continue;
    const key = enc.clienteId || `name:${norm(enc.customerName || 'Sem cliente')}`;
    const client = enc.clienteId ? store.get('clients', enc.clienteId) : null;
    const group = groups.get(key) || { clientName: client?.name || enc.customerName || 'Sem cliente / pronta entrega', contact: [client?.phone, client?.address].filter(Boolean).join(' · '), items: new Map(), notes: [] };
    for (const it of enc.itens || []) {
      const composition = bundleCompositionText(store, it);
      const itemKey = `${it.productId}|${composition}`;
      const current = group.items.get(itemKey) || { productId: it.productId, qty: 0, composition };
      current.qty += Number(it.qty) || 0;
      group.items.set(itemKey, current);
    }
    if (enc.notes) group.notes.push(enc.notes);
    groups.set(key, group);
  }
  const stored = store.get('comandas', date);
  const produced = new Map((stored?.itens || []).map((it) => [it.productId, Number(it.realizado) || 0]));
  const manual = new Map((stored?.itens || []).map((it) => [it.productId, Math.max(0, Number(it.manualQty ?? (it.prevista == null ? 0 : Number(it.prevista) - (ordered.get(it.productId) || 0))) || 0)]));
  const productionIds = [...new Set([...ordered.keys(), ...produced.keys(), ...manual.keys()])];
  return {
    date: fmtDate(`${date}T12:00:00`),
    groups: [...groups.values()].map((g) => ({
      clientName: g.clientName, contact: g.contact,
      items: [...g.items.values()].map((item) => ({ name: `${store.get('products', item.productId)?.name || '(produto removido)'}${item.composition ? ` (${item.composition})` : ''}`, qty: item.qty })),
      notes: g.notes.join(' · '),
    })).sort((a, b) => norm(a.clientName).localeCompare(norm(b.clientName))),
    production: productionIds.map((id) => ({
      productId: id,
      name: store.get('products', id)?.name || '(produto removido)',
      prevista: (ordered.get(id) || 0) + (manual.get(id) || 0),
      produzido: produced.get(id) || 0,
    })).sort((a, b) => norm(a.name).localeCompare(norm(b.name))),
  };
}

function buildComandaPeriodSpec(store, start, end) {
  const days = comandaDatesWithProducts(store, start, end).map((date) => ({ isoDate: date, ...buildComandaSpec(store, date) }));
  const consolidated = new Map();
  for (const day of days) for (const item of day.production) {
    const key = item.productId || norm(item.name);
    const current = consolidated.get(key) || { productId: item.productId, name: item.name, prevista: 0, produzido: 0 };
    current.prevista += Number(item.prevista) || 0;
    current.produzido += Number(item.produzido) || 0;
    consolidated.set(key, current);
  }
  return {
    start, end,
    period: start === end ? fmtDate(`${start}T12:00:00`) : `${fmtDate(`${start}T12:00:00`)} a ${fmtDate(`${end}T12:00:00`)}`,
    generatedAt: new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date()),
    production: [...consolidated.values()].sort((a, b) => norm(a.name).localeCompare(norm(b.name))),
  };
}

function sellingPrice(store, productId) {
  const product = store.get('products', productId);
  if (product && Number(product.salePrice) >= 0 && product.salePrice !== '') return Number(product.salePrice) || 0;
  try { return productPrice(store.toEngineStore(), productId, store.getConfig(), estimateLens(store.getConfig())).price; }
  catch { return 0; }
}

function linkedProductForRecipe(store, recipeId) {
  return store.state.products.find((p) => (p.components || []).some((c) => c.kind === 'recipe' && c.id === recipeId)) || null;
}

function saleQtyInRecipeUnit(product, recipe) {
  const qty = Number(product?.saleQty) || 1;
  const from = product?.saleUnit || 'un';
  const to = recipe?.yieldUnit || 'un';
  if (from === to) return qty;
  if (from === 'kg' && to === 'g') return qty * 1000;
  if (from === 'g' && to === 'kg') return qty / 1000;
  if (from === 'l' && to === 'ml') return qty * 1000;
  if (from === 'ml' && to === 'l') return qty / 1000;
  return 1;
}

function recipePricing(store, recipe, linkedProduct = null) {
  const config = store.getConfig();
  const es = indexStore({ ...store.state, recipes: [...store.state.recipes.filter((r) => r.id !== recipe.id), recipe] });
  const lens = estimateLens(config);
  const breakdown = costBreakdown(es, recipe.id, config, lens);
  const yieldQty = Number(recipe.yieldNominal) || 0;
  const linkedQty = Number(linkedProduct?.components?.find((c) => c.kind === 'recipe' && c.id === recipe.id)?.qty) || 1;
  const unitCost = (breakdown.ingredients + breakdown.packaging + breakdown.gas + breakdown.fixed) * linkedQty + (Number(recipe.packagingCost) || 0);
  const targetMargin = recipe.targetMarginPct ?? config.targetMarginPct;
  const rates = effectiveSalesRates(recipe, config);
  const suggested = Math.ceil(priceFromCost(unitCost, { ...config, ...rates, targetMarginPct: targetMargin }) * 100 - 1e-9) / 100;
  const productUnits = yieldQty / linkedQty;
  const salesRate = rates.total;
  const profitPerUnit = suggested * (1 - salesRate) - unitCost;
  const productionHours = (Number(recipe.productionMinutes) || (Number(recipe.activeMinutes) || 0) + (Number(recipe.ovenMinutes) || 0)) / 60;
  return { breakdown, yieldQty, linkedQty, productUnits, unitCost, targetMargin, rates, suggested,
    salesRate, profitPerUnit, totalCost: unitCost * productUnits, totalSale: suggested * productUnits,
    totalProfit: profitPerUnit * productUnits, profitHour: productionHours > 0 ? profitPerUnit * productUnits / productionHours : null };
}

function recipeProfitabilityCard(store, recipe, linkedProduct = null) {
  if (!(Number(recipe?.yieldNominal) > 0)) return el('p', { class: 'pa-hint', text: 'Informe o rendimento para ver o resultado da receita.' });
  try {
    const p = recipePricing(store, recipe, linkedProduct);
    const line = (label, value, tone = '') => el('tr', {}, [el('td', { text: label }), el('td', { class: `pa-num ${tone}`, text: value })]);
    const practiced = Number(linkedProduct?.salePrice);
    const practicedProfit = practiced * (1 - p.salesRate) - p.unitCost;
    return el('section', { class: 'pa-detail-card' }, [
      el('strong', { text: 'Resultado da receita completa' }),
      el('table', { class: 'pa-kv' }, [
        line('Rendimento', `${fmtNum(p.yieldQty)} ${recipe.yieldUnit}`),
        line('Ingredientes', brl(p.breakdown.ingredients * p.yieldQty)),
        line('Gás', brl(p.breakdown.gas * p.yieldQty)),
        line('Custos fixos proporcionais', brl(p.breakdown.fixed * p.yieldQty)),
        line('Embalagens', brl((p.breakdown.packaging || 0) * p.yieldQty + (Number(recipe.packagingCost) || 0) * p.productUnits)),
        line('Custo total da receita', brl(p.totalCost)),
        line('Custo por produto', brl(p.unitCost)),
        line('Margem desejada', pctStr(p.targetMargin)),
        line('Taxa de pagamento', pctStr(p.rates.paymentFeePct)),
        line('Comissão', pctStr(p.rates.commissionPct)),
        line('Imposto sobre a venda', pctStr(p.rates.salesTaxPct)),
        line('Preço sugerido por produto', brl(p.suggested), 'pa-strong'),
        line('Venda total da receita nesse preço', brl(p.totalSale)),
        line('Lucro por produto', brl(p.profitPerUnit), p.profitPerUnit >= 0 ? 'pa-positive' : 'pa-bad'),
        line('Lucro total da receita', brl(p.totalProfit), p.totalProfit >= 0 ? 'pa-positive' : 'pa-bad'),
        line('Lucro por hora de produção', p.profitHour == null ? '—' : brl(p.profitHour)),
        ...(practiced > 0 ? [
          line('Preço praticado no catálogo', brl(practiced)),
          line('Margem no preço praticado', pctStr(practicedProfit / practiced), practicedProfit >= 0 ? 'pa-positive' : 'pa-bad'),
        ] : []),
      ]),
      el('span', { class: 'pa-muted', text: `Valores recalculados conforme a margem e os percentuais digitados. Taxa, comissão e imposto (${pctStr(p.salesRate)}) já descontados do lucro. Mão de obra direta é apenas indicador, pois salários estão nos custos fixos.` }),
    ]);
  } catch (e) { return el('p', { class: 'pa-hint', text: `Confira os custos para ver o resultado: ${friendlyError(e)}` }); }
}

MODALS['comanda-preview'] = (ctx, m) => {
  const start = m.start || m.date || todayInput();
  const end = m.end || start;
  const spec = buildComandaPeriodSpec(ctx.store, start, end);
  const preview = el('div', { class: 'pa-print-preview', 'data-testid': 'cmd-print-preview' }, [
    el('h3', { class: 'pa-h3', text: `Comanda de produção · ${spec.period}` }),
    el('p', { class: 'pa-muted', text: `Comanda gerada em ${spec.generatedAt}` }),
    el('strong', { text: 'Lista única de produção' }),
    ...(spec.production.length ? spec.production.map((p) => el('div', { class: 'pa-preview-line', 'data-testid': 'cmd-preview-item' }, [
      el('span', { class: 'pa-grow', text: p.name }),
      el('strong', { text: `${fmtNum(p.prevista)} encomendada + avulsa · ${fmtNum(p.produzido)} produzida` }),
    ])) : [el('span', { class: 'pa-muted', text: 'Sem itens de produção no período.' })]),
  ]);
  const btn = el('button', { class: 'pa-btn pa-primary pa-grow', 'data-testid': 'cmd-pdf' }, 'Gerar PDF A4');
  btn.addEventListener('click', async () => {
    const old = btn.textContent; btn.textContent = 'Gerando…'; btn.disabled = true;
    try { await savePdf(await generateComandaPdf(spec), `comanda-${start}-a-${end}.pdf`); }
    catch (e) { window.alert('Não foi possível gerar o PDF: ' + ((e && e.message) || e)); }
    finally { btn.textContent = old; btn.disabled = false; }
  });
  return sheet({ title: 'Comanda para impressão', rows: [el('p', { class: 'pa-hint', text: 'O PDF apresenta uma única lista para todo o período e soma automaticamente os produtos repetidos.' }), preview, el('div', { class: 'pa-sheet-actions' }, [btn])] });
};

function vendasPanel(ctx) {
  const { store } = ctx;
  const products = store.state.products;
  const activeProducts = products.filter((p) => productIsActive(p) && !isBundleProduct(p));
  const { vendaStart: start, vendaEnd: end, vendaStatus: status, vendaProductIds: requestedProductIds, vendaClientId: requestedClientId } = ctx.view;
  const productIds = [...new Set(Array.isArray(requestedProductIds) ? requestedProductIds : [])].filter((id) => products.some((p) => p.id === id));
  const hasProductFilter = productIds.length > 0;
  const productKind = ['normal', 'cesta', 'kit', 'combo'].includes(ctx.view.vendaProductKind) ? ctx.view.vendaProductKind : '';
  const hasItemFilter = hasProductFilter || Boolean(productKind);
  const matchesProduct = (id) => (!hasProductFilter || productIds.includes(id)) && (!productKind || productSaleKind(store.get('products', id)) === productKind);
  const clientId = requestedClientId === '__sem__' || store.state.clients.some((c) => c.id === requestedClientId) ? requestedClientId : '';
  const report = salesPeriodSummary(store, start, end, status);
  const chip = (key, label) => el('button', { class: 'pa-chip' + (status === key ? ' pa-chip-on' : ''), 'data-testid': `venda-f-${key}`, onclick: () => ctx.actions.setVendaPeriod({ vendaStatus: key }) }, label);
  const period = periodFields(start, end, ({ start: s, end: e }) => ctx.actions.setVendaPeriod({ vendaStart: s, vendaEnd: e }), 'venda');
  const productFilter = el('details', { 'data-testid': 'venda-product-filter' });
  const stagedProductIds = new Set(productIds);
  const productChoices = products.filter((p) => !productKind || productSaleKind(p) === productKind).sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
  const kindFilter = el('select', { class: 'pa-input', 'data-testid': 'venda-kind-filter' }, [
    ['', 'Todos os tipos'], ['cesta', 'Cestas'], ['kit', 'Kits'], ['combo', 'Combos'], ['normal', 'Produtos comuns'],
  ].map(([value, label]) => el('option', { value, text: label, ...(productKind === value ? { selected: 'selected' } : {}) })));
  kindFilter.addEventListener('change', () => ctx.actions.setVendaPeriod({ vendaProductKind: kindFilter.value, vendaProductIds: [] }));
  const productSummary = el('summary', { class: 'pa-input', style: 'cursor:pointer', text: hasProductFilter ? `${productIds.length} produto(s) selecionado(s)` : 'Todos os produtos' });
  const productSearch = el('input', { class: 'pa-input', type: 'search', placeholder: 'Digite para localizar um produto…', 'aria-label': 'Buscar produto no filtro' });
  const productOptions = el('div', { style: 'max-height:240px;overflow-y:auto;margin:8px 0' });
  const allCheck = el('input', { type: 'checkbox', checked: !hasProductFilter, 'data-testid': 'venda-product-all' });
  const choices = productChoices.map((p) => {
    const check = el('input', { type: 'checkbox', checked: stagedProductIds.has(p.id), value: p.id, 'data-testid': 'venda-product-check' });
    const label = el('label', { class: 'pa-check' }, [check, el('span', { text: p.name })]);
    check.addEventListener('change', () => {
      if (check.checked) stagedProductIds.add(p.id); else stagedProductIds.delete(p.id);
      allCheck.checked = stagedProductIds.size === 0;
    });
    return { p, check, label };
  });
  allCheck.addEventListener('change', () => {
    stagedProductIds.clear();
    allCheck.checked = true;
    for (const { check } of choices) check.checked = false;
  });
  productOptions.append(el('label', { class: 'pa-check' }, [allCheck, el('strong', { text: 'Todos os produtos' })]), ...choices.map(({ label }) => label));
  productSearch.addEventListener('input', () => {
    const query = norm(productSearch.value);
    for (const { p, label } of choices) label.style.display = norm(p.name).includes(query) ? '' : 'none';
  });
  productFilter.append(productSummary, productSearch, productOptions,
    el('button', { class: 'pa-btn pa-primary pa-sm', type: 'button', 'data-testid': 'venda-product-apply', onclick: () => ctx.actions.setVendaPeriod({ vendaProductIds: [...stagedProductIds] }) }, 'Aplicar filtro'));

  const clientFilter = el('div', { class: 'pa-cli-picker', 'data-testid': 'venda-client-filter' });
  const selectClient = (id) => ctx.actions.setVendaPeriod({ vendaClientId: id });
  if (clientId) {
    const clientName = clientId === '__sem__' ? 'Sem cliente / venda rápida' : clientLabel(store.get('clients', clientId));
    clientFilter.append(el('div', { class: 'pa-cli-chip' }, [
      el('span', { class: 'pa-grow', text: clientName }),
      el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Mostrar todos os clientes', 'aria-label': 'Mostrar todos os clientes', onclick: () => selectClient('') }, '✕'),
    ]));
  } else {
    const clientSearch = el('input', { class: 'pa-input pa-search', type: 'search', placeholder: 'Todos os clientes — digite um nome…', 'data-testid': 'venda-client-search' });
    const suggestions = el('ul', { class: 'pa-list pa-tight pa-suggest', role: 'listbox', style: 'display:none;max-height:240px;overflow-y:auto' });
    const option = (label, id) => el('li', { class: 'pa-row-item', role: 'option', tabindex: '0', onclick: () => selectClient(id), onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectClient(id); } } }, label);
    const update = () => {
      const query = norm(clientSearch.value);
      const showAll = !query || query === 'todos' || query === 'todas' || query.startsWith('todos os clientes');
      const matches = showAll ? [] : store.state.clients.filter((c) => norm(clientSearchText(c)).includes(query)).sort(compareNamed).slice(0, 8);
      suggestions.replaceChildren(...(showAll ? [option('Todos os clientes', '')] : []), ...((!query || norm('Sem cliente / venda rápida').includes(query)) ? [option('Sem cliente / venda rápida', '__sem__')] : []), ...matches.map((c) => option(clientLabel(c), c.id)));
      suggestions.style.display = suggestions.childElementCount ? '' : 'none';
    };
    clientSearch.addEventListener('focus', update);
    clientSearch.addEventListener('input', update);
    clientSearch.addEventListener('keydown', (event) => { if (event.key === 'Escape') suggestions.style.display = 'none'; });
    clientFilter.append(clientSearch, suggestions);
  }

  const selectedOrderLines = (item) => {
    const lines = orderItemSaleLines(item);
    if (!hasItemFilter) return lines;
    // Selecting a cesta/kit means the whole filled set; selecting an internal product
    // finds that product even when it appears inside a set.
    if (isBundleProduct(store.get('products', item.productId)) && matchesProduct(item.productId)) return [{ productId: item.productId, qty: Number(item.qty) || 0, total: orderItemGross(item) }];
    return lines.filter((line) => matchesProduct(line.productId));
  };
  const hasSelectedProduct = (row) => !hasItemFilter || (row.kind === 'sale'
    ? matchesProduct(row.sale.productId)
    : (row.order.itens || []).some((it) => selectedOrderLines(it).length > 0));
  const visibleRows = report.rows.filter((row) => (row.kind === 'sale' || row.order.entregue || row.order.quickSale) && (!clientId || row.clientId === clientId) && hasSelectedProduct(row));
  const visibleCancellations = report.cancellations.filter((row) => (!clientId || row.clientId === clientId) && hasSelectedProduct(row));
  const rowMetrics = (row) => {
    if (!hasItemFilter) return { total: row.total, received: row.received || 0, pending: row.pending || 0 };
    const gross = row.kind === 'sale' ? row.total : (row.order.itens || []).reduce((sum, it) => sum + selectedOrderLines(it).reduce((lineSum, line) => lineSum + line.total, 0), 0);
    const itemGross = row.kind === 'sale' ? gross : (row.order.itens || []).reduce((sum, it) => sum + orderItemGross(it), 0);
    const discountFactor = itemGross > 0 ? Math.max(0, itemGross - (Number(row.order?.discount) || 0)) / itemGross : 1;
    const total = gross * discountFactor;
    const ratio = row.total > 0 ? total / row.total : 0;
    const received = Math.min(total, (row.received || 0) * ratio);
    return { total, received, pending: Math.max(0, total - received) };
  };
  const filteredTotals = visibleRows.reduce((acc, row) => { const m = rowMetrics(row); acc.total += m.total; acc.received += m.received; acc.pending += m.pending; return acc; }, { total: 0, received: 0, pending: 0 });
  const productSummaryMap = new Map();
  const addFilteredProduct = (id, qty, total) => { const p = productSummaryMap.get(id) || { id, qty: 0, total: 0 }; p.qty += qty; p.total += total; productSummaryMap.set(id, p); };
  for (const row of visibleRows) {
    if (row.kind === 'sale') addFilteredProduct(row.sale.productId, Number(row.sale.qty) || 0, row.total);
    else {
      const itemGross = (row.order.itens || []).reduce((sum, item) => sum + orderItemGross(item), 0);
      const discountFactor = itemGross > 0 ? Math.max(0, itemGross - (Number(row.order.discount) || 0)) / itemGross : 1;
      for (const it of row.order.itens || []) for (const line of selectedOrderLines(it)) addFilteredProduct(line.productId, line.qty, line.total * discountFactor);
    }
  }
  const filteredProducts = [...productSummaryMap.values()].map((p) => ({ ...p, name: store.get('products', p.id)?.name || '(produto removido)' })).sort((a, b) => b.total - a.total);

  const detailRows = visibleRows.map((row) => {
    if (row.kind === 'sale') return saleRow(ctx, row.sale);
    const enc = row.order;
    const cli = enc.clienteId ? store.get('clients', enc.clienteId) : null;
    return el('li', { class: 'pa-row-item', onclick: () => ctx.actions.openModal({ kind: 'encomenda-edit', id: enc.id }) }, [
      el('div', { class: 'pa-grow' }, [
        el('div', { class: 'pa-enc-title' }, [el('strong', { text: cli?.name || enc.customerName || 'Sem cliente' }), el('span', { class: enc.entregue ? 'pa-badge pa-ok' : 'pa-badge', text: enc.entregue ? 'entregue' : 'não entregue' }), el('span', { class: row.paid ? 'pa-badge pa-ok' : 'pa-badge pa-warn', text: row.paid ? 'recebido' : 'a receber' })]),
        el('span', { class: 'pa-muted', text: `${fmtDate(enc.deliveryDate)} · ${encomendaItemsResumo(store, enc)}` }),
      ]),
      el('strong', { class: 'pa-num', text: brl(rowMetrics(row).total) }),
      el('span', { class: 'pa-chev', text: '›' }),
    ]);
  });

  const cancellationRows = visibleCancellations.map((row) => {
    if (row.kind === 'sale') {
      const p = store.get('products', row.sale.productId);
      return el('li', { class: 'pa-list-item' }, [el('div', { class: 'pa-grow' }, [el('strong', { text: 'Sem cliente' }), el('span', { class: 'pa-muted', text: `${p?.name || '(produto removido)'} · ${fmtDate(row.at)}` })]), el('strong', { class: 'pa-num pa-bad', text: brl(row.total) })]);
    }
    const cli = row.order.clienteId ? store.get('clients', row.order.clienteId) : null;
    return el('li', { class: 'pa-row-item pa-cancelled', onclick: () => ctx.actions.openModal({ kind: 'encomenda-edit', id: row.order.id }) }, [
      el('div', { class: 'pa-grow' }, [el('strong', { text: cli?.name || 'Sem cliente' }), el('span', { class: 'pa-muted', text: `${encomendaItemsResumo(store, row.order)} · ${fmtDate(row.at)}` })]),
      el('strong', { class: 'pa-num pa-bad', text: brl(rowMetrics({ ...row, received: 0, pending: row.total }).total) }), el('span', { class: 'pa-chev', text: '›' }),
    ]);
  });

  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Relatório gerencial' }), el('h2', { text: 'Vendidos' })]),
      activeProducts.length > 0 && el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'venda-new', onclick: () => ctx.actions.openModal({ kind: 'venda-add' }) }, '+ Venda rápida'),
    ].filter(Boolean)),
    el('p', { class: 'pa-hint', text: 'Encomendas entregues pela data de entrega e vendas rápidas pela data da venda. Filtre Cestas ou Kits para ver os conjuntos com seus produtos internos; também é possível pesquisar um produto vendido dentro deles. Itens avulsos aparecem separados no pedido.' }),
    period,
    el('div', { class: 'pa-filtergrid' }, [field('Tipo de produto', kindFilter), field('Filtrar por produto', productFilter), field('Filtrar por cliente', clientFilter)]),
    el('div', { class: 'pa-chiprow' }, [chip('todos', 'Todos'), chip('recebidos', 'Recebidos'), chip('naorecebidos', 'Não recebidos'), chip('desistencias', 'Desistências')]),
    status === 'desistencias'
      ? el('div', {}, [
          el('div', { class: 'pa-statgrid' }, [statCard('Total de desistências', brl(visibleCancellations.reduce((sum, row) => sum + rowMetrics({ ...row, received: 0, pending: row.total }).total, 0)), 'bad')]),
          cancellationRows.length ? el('ul', { class: 'pa-list pa-rows' }, cancellationRows) : el('p', { class: 'pa-empty', text: 'Nenhuma desistência neste período.' }),
        ])
      : el('div', {}, [
          el('div', { class: 'pa-statgrid' }, [statCard('Total vendido', brl(filteredTotals.total), 'navy'), statCard('Recebido', brl(filteredTotals.received), 'ok'), statCard('Pendente', brl(filteredTotals.pending), filteredTotals.pending > 0.005 ? 'warn' : 'soft'), productKind && statCard(`${({ cesta: 'Cestas', kit: 'Kits', combo: 'Combos', normal: 'Produtos comuns' })[productKind]} vendidos`, fmtNum(filteredProducts.reduce((sum, product) => sum + product.qty, 0)), 'teal')].filter(Boolean)),
          filteredProducts.length > 0 && el('h3', { class: 'pa-h3', text: 'Produtos vendidos' }),
          filteredProducts.length > 0 && el('div', { class: 'pa-report-list' }, filteredProducts.map((p) => el('div', { class: 'pa-preview-line' }, [el('span', { class: 'pa-grow', text: p.name }), el('span', { class: 'pa-muted', text: `${fmtNum(p.qty)} un` }), el('strong', { class: 'pa-num', text: brl(p.total) })]))),
          el('h3', { class: 'pa-h3', text: 'Vendidos no período' }),
          detailRows.length ? el('ul', { class: 'pa-list pa-rows' }, detailRows) : el('p', { class: 'pa-empty', text: 'Nenhuma venda com este filtro.' }),
        ]),
  ].filter(Boolean));
}

// Read-only log entry (append-only — no edit; an estorno would be a new event).
// In the period report each row carries its own date and gross value.
function saleRow(ctx, s) {
  const { store } = ctx;
  const reversed = store.isReversed('sale', s.id);
  const p = store.get('products', s.productId);
  const rev = saleNet(s);
  return el('li', { class: 'pa-list-item' + (reversed ? ' pa-reversed' : ''), 'data-search': `${p ? p.name : ''} ${s.channel || ''}` }, [
    el('div', { class: 'pa-grow' }, [
      el('div', {}, el('strong', { text: p ? p.name : '(produto removido)' })),
      el('span', { class: 'pa-muted', text: `${fmtDate(s.at)} · ${s.qty} × ${brl(s.unitPrice)}${s.channel ? ` · ${s.channel}` : ''}` }),
    ]),
    el('span', { class: 'pa-num', text: brl(rev) }),
    estornoControl(ctx, 'sale', s.id),
  ]);
}

MODALS['venda-add'] = (ctx) => vendaSheet(ctx);

function vendaSheet(ctx) {
  const { store } = ctx;
  const config = store.getConfig();
  const products = store.state.products.filter((p) => productIsActive(p) && !isBundleProduct(p));
  const es = store.toEngineStore();
  const lens = estimateLens(config);
  const suggested = (pid) => sellingPrice(store, pid);
  const client = clientePicker(store, '');
  const looseName = el('input', { class: 'pa-input', type: 'text', placeholder: 'Nome apenas para esta venda (opcional)', 'data-testid': 'venda-customer-name' });
  const delivery = el('select', { class: 'pa-input', 'data-testid': 'venda-delivery' }, [el('option', { value: 'retirada', text: 'Retirada' }), el('option', { value: 'motoboy', text: 'Motoboy' })]);
  const delivered = el('input', { type: 'checkbox', 'data-testid': 'venda-delivered' }); delivered.checked = true;
  const situation = el('select', { class: 'pa-input', 'data-testid': 'venda-payment-status' }, [el('option', { value: 'pago', text: 'Já pago' }), el('option', { value: 'crediario', text: 'A receber / crediário' })]);
  const method = paymentMethodSelect(store, 'venda-payment-method');

  const prodSel = el('select', { class: 'pa-input', 'data-testid': 'venda-product' },
    products.map((p) => el('option', { value: p.id, text: p.name })));
  const date = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'venda-date', type: 'date', value: todayInput() });
  const qty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'venda-qty', type: 'text', inputmode: 'decimal', value: '1' });
  const price = moneyField(products[0] ? suggested(products[0].id) : null, 'venda-price');
  const discount = moneyField(null, 'venda-discount');
  const channel = el('input', { class: 'pa-input', 'data-testid': 'venda-canal', type: 'text', placeholder: 'canal (opcional)' });
  situation.addEventListener('change', () => { method.disabled = situation.value !== 'pago'; });
  date.addEventListener('change', () => { delivered.checked = date.value === todayInput(); });

  prodSel.addEventListener('change', () => {
    const s = suggested(prodSel.value);
    price.input.value = s != null ? fmtMoneyInput(s) : '';
  });

  function save() {
    const p = store.get('products', prodSel.value);
    const q = parseNum(qty.value);
    const up = parseNum(price.input.value);
    const discountValue = Math.max(0, parseNum(discount.input.value) || 0);
    if (!p || !(q > 0) || up == null || discountValue > q * up + 0.005) { discount.input.focus(); return; }
    let cost = 0;
    try { cost = productUnitCost(es, p.id, config, lens); } catch { /* leave 0 if not yet priceable */ }
    const rates = effectiveSalesRates(p, config);
    const orderId = uuid(); const at = nowIso(); const total = Math.max(0, q * up - discountValue);
    const materials = orderMaterialEstimate(store, { itens: [{ productId: p.id, qty: q }] });
    ctx.actions.mutate((s) => {
      s.upsertEncomenda({
        id: orderId, at, deliveryDate: dateIso(date.value || todayInput()),
        clienteId: client.value() || undefined, customerName: client.value() ? undefined : looseName.value.trim() || undefined,
        itens: [{ productId: p.id, qty: q, unitPrice: up }], total, discount: discountValue || undefined,
        costSnapshot: q * cost,
        ...(materials.missing ? {} : { materialCostSnapshot: materials.ingredients, packagingCostSnapshot: materials.packaging }),
        paymentFeePct: rates.paymentFeePct, commissionPct: rates.commissionPct,
        salesTaxPct: rates.salesTaxPct, deliveryMethod: delivery.value, entregue: delivered.checked,
        quickSale: true, ...(channel.value.trim() ? { channel: channel.value.trim() } : {}),
      });
      if (situation.value === 'pago' && total > 0) s.addPayment({ id: uuid(), at, encomendaId: orderId, valor: total, forma: method.value });
    });
  }

  const rows = [
    field('Cliente cadastrado (opcional)', client.el),
    field('Ou nome apenas para esta venda', looseName),
    field('Produto', prodSel),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Data de retirada/entrega' }), date, el('span', { class: 'pa-lab', text: 'Qtd' }), qty]),
    field('Preço de venda', price),
    field('Desconto total (opcional)', discount),
    field('Entrega', delivery),
    el('label', { class: 'pa-check' }, [delivered, el('span', { text: 'Já foi entregue' })]),
    field('Pagamento', situation),
    field('Forma de pagamento (se já pago)', method),
    field('Canal (opcional)', channel),
    el('p', { class: 'pa-hint', text: 'A venda entra em Vendidos e na comanda da data escolhida. Se escolher um cliente cadastrado, também entra na ficha dele. Venda a receber cria uma fatura; a entrega pode ficar agendada.' }),
  ];
  return sheet({ title: 'Registrar venda', rows, onSave: save, saveTestid: 'venda-add' });
}

// ── Encomendas (Rev 04 — the order = the sale; mutable, editable) ────────────────

/** A search-to-select client picker (Rev 07) — scales past a dropdown when there are many clients.
 *  `.value()` → the selected client id (or '' for sem cliente). */
function clientePicker(store, initialId, onChange = () => {}) {
  let selected = initialId || '';
  const container = el('div', { class: 'pa-cli-picker' });
  function render() {
    const cli = selected ? store.get('clients', selected) : null;
    if (cli) {
      container.replaceChildren(el('div', { class: 'pa-cli-chip', 'data-testid': 'enc-cliente-chip' }, [
        el('span', { class: 'pa-grow', text: clientLabel(cli) }),
        el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Trocar cliente', onclick: () => { selected = ''; render(); onChange(); } }, '✕'),
      ]));
      return;
    }
    const search = el('input', { class: 'pa-input pa-search', 'data-testid': 'enc-cliente-search', type: 'search', placeholder: 'Buscar cliente por nome ou código…' });
    const results = el('ul', { class: 'pa-list pa-tight pa-suggest', style: 'display:none' });
    search.addEventListener('input', () => {
      const q = norm(search.value);
      if (!q) { results.style.display = 'none'; results.replaceChildren(); return; }
      const matches = store.state.clients.filter((c) => !c.inactive && norm(clientSearchText(c)).includes(q)).sort(compareNamed).slice(0, 6);
      results.style.display = matches.length ? '' : 'none';
      results.replaceChildren(...matches.map((c) => el('li', { class: 'pa-row-item', 'data-testid': 'enc-cliente-result', onclick: () => { selected = c.id; render(); onChange(); } }, [el('div', { class: 'pa-grow' }, [el('strong', { text: clientLabel(c) }), tagChips(c.tags)].filter(Boolean)), el('span', { class: 'pa-add', text: '+' })])));
    });
    container.replaceChildren(search, results);
  }
  render();
  return { el: container, value: () => selected };
}

function encomendasPanel(ctx) {
  const { store } = ctx;
  const products = store.state.products;
  const activeProducts = products.filter(productIsActive);
  const {
    encSort: sort, encStatus: status, encStart: start, encEnd: end,
    encClientId: requestedClientId, encProductId: requestedProductId, encDeliveryMethod: requestedDeliveryMethod,
  } = ctx.view;
  const clientId = store.state.clients.some((c) => c.id === requestedClientId) ? requestedClientId : '';
  const productId = products.some((p) => p.id === requestedProductId) ? requestedProductId : '';
  const deliveryMethod = ['retirada', 'motoboy'].includes(requestedDeliveryMethod) ? requestedDeliveryMethod : '';
  const cliName = (e) => norm(store.get('clients', e.clienteId)?.name || 'zzz');

  let list = store.state.encomendas.filter((e) => inDateRange(e.deliveryDate, start, end));
  if (clientId) list = list.filter((e) => e.clienteId === clientId);
  if (productId) list = list.filter((e) => (e.itens || []).some((it) => it.productId === productId || (it.bundleItems || []).some((child) => child.productId === productId)));
  if (deliveryMethod) list = list.filter((e) => (e.deliveryMethod || 'retirada') === deliveryMethod);
  if (status === 'desistencias') list = list.filter((e) => e.desistenciaAt);
  else if (status === 'naoentregue') list = list.filter((e) => !e.desistenciaAt && !e.entregue);
  else if (status === 'entregues') list = list.filter((e) => !e.desistenciaAt && e.entregue);
  else if (status === 'areceber') list = list.filter((e) => !e.desistenciaAt && paymentStatus(store, e).saldo > 0.005);
  else if (status === 'pagas') list = list.filter((e) => !e.desistenciaAt && paymentStatus(store, e).saldo <= 0.005);
  else if (status === 'urgentes') list = list.filter((e) => !e.desistenciaAt && e.urgente);
  list.sort((a, b) => {
    const aUrgent = Boolean(a.urgente && !a.desistenciaAt);
    const bUrgent = Boolean(b.urgente && !b.desistenciaAt);
    if (sort === 'urgentes' && aUrgent !== bUrgent) return aUrgent ? -1 : 1;
    if (sort === 'retirada' || sort === 'motoboy') {
      const aFirst = (a.deliveryMethod || 'retirada') === sort;
      const bFirst = (b.deliveryMethod || 'retirada') === sort;
      if (aFirst !== bFirst) return aFirst ? -1 : 1;
    }
    if (sort === 'cliente') {
      const byName = cliName(a).localeCompare(cliName(b), 'pt-BR');
      if (byName) return byName;
    }
    return String(a.deliveryDate || '').localeCompare(String(b.deliveryDate || '')) || cliName(a).localeCompare(cliName(b), 'pt-BR');
  });
  const ul = el('ul', { class: 'pa-list pa-rows' }, list.map((e) => encomendaRow(ctx, e)));

  const chip = (k, label) => el('button', { class: 'pa-chip' + (status === k ? ' pa-chip-on' : ''), 'data-testid': `enc-f-${k}`, onclick: () => ctx.actions.setEncStatus(k) }, label);
  const sortSel = el('select', { class: 'pa-input pa-narrow', 'data-testid': 'enc-sort' }, [['urgentes', 'Urgentes primeiro'], ['retirada', 'Retirada primeiro'], ['motoboy', 'Motoboy primeiro'], ['cliente', 'Clientes A–Z']].map(([v, t]) => el('option', { value: v, text: t, ...(sort === v ? { selected: 'selected' } : {}) })));
  sortSel.addEventListener('change', () => ctx.actions.setEncSort(sortSel.value));
  const period = periodFields(start, end, ({ start: s, end: e }) => ctx.actions.setEncPeriod({ encStart: s, encEnd: e }), 'enc');
  const clientFilter = el('select', { class: 'pa-input', 'data-testid': 'enc-client-filter' }, [
    el('option', { value: '', text: 'Todos os clientes', ...(!clientId ? { selected: 'selected' } : {}) }),
    ...store.state.clients.slice().sort(compareNamed).map((c) => el('option', { value: c.id, text: clientLabel(c), ...(clientId === c.id ? { selected: 'selected' } : {}) })),
  ]);
  const productFilter = el('select', { class: 'pa-input', 'data-testid': 'enc-product-filter' }, [
    el('option', { value: '', text: 'Todos os produtos', ...(!productId ? { selected: 'selected' } : {}) }),
    ...products.slice().sort((a, b) => norm(a.name).localeCompare(norm(b.name))).map((p) => el('option', { value: p.id, text: p.name, ...(productId === p.id ? { selected: 'selected' } : {}) })),
  ]);
  const deliveryFilter = el('select', { class: 'pa-input', 'data-testid': 'enc-delivery-filter' }, [
    el('option', { value: '', text: 'Retirada ou motoboy', ...(!deliveryMethod ? { selected: 'selected' } : {}) }),
    el('option', { value: 'retirada', text: 'Retirada', ...(deliveryMethod === 'retirada' ? { selected: 'selected' } : {}) }),
    el('option', { value: 'motoboy', text: 'Motoboy', ...(deliveryMethod === 'motoboy' ? { selected: 'selected' } : {}) }),
  ]);
  clientFilter.addEventListener('change', () => ctx.actions.setEncPeriod({ encClientId: clientFilter.value }));
  productFilter.addEventListener('change', () => ctx.actions.setEncPeriod({ encProductId: productFilter.value }));
  deliveryFilter.addEventListener('change', () => ctx.actions.setEncPeriod({ encDeliveryMethod: deliveryFilter.value }));

  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('h2', { class: 'pa-grow', text: 'Encomendas' }),
      store.state.encomendas.length > 0 && el('button', { class: 'pa-btn pa-sm', 'data-testid': 'enc-fichas-dia', onclick: () => ctx.actions.openModal({ kind: 'encomendas-fichas-dia', date: start && start === end ? start : todayInput() }) }, '🖨 Fichas do dia'),
      activeProducts.length > 0 && el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'enc-new', onclick: () => ctx.actions.openModal({ kind: 'encomenda-add' }) }, '+ Nova encomenda'),
    ].filter(Boolean)),
    el('p', { class: 'pa-hint', text: 'Todas as encomendas ficam aqui, inclusive entregues, pagas e desistências. Use os filtros apenas quando quiser reduzir a lista.' }),
    activeProducts.length === 0 && el('p', { class: 'pa-hint', text: products.length ? 'Ative um produto para criar uma nova encomenda.' : 'Crie um produto primeiro.' }),
    store.state.encomendas.length === 0
      ? activeProducts.length > 0 && el('p', { class: 'pa-empty', text: 'Nenhuma encomenda. Toque em “+ Nova”.' })
      : el('div', {}, [
          period,
          (start || end) && el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'enc-all-dates', onclick: () => ctx.actions.setEncPeriod({ encStart: '', encEnd: '' }) }, 'Mostrar todas as datas'),
          el('div', { class: 'pa-filtergrid' }, [field('Cliente', clientFilter), field('Produto', productFilter), field('Entrega', deliveryFilter)]),
          el('div', { class: 'pa-row pa-sortrow' }, [el('span', { class: 'pa-lab', text: `${list.length} encomenda(s) · ordenar por` }), sortSel]),
          el('div', { class: 'pa-chiprow' }, [chip('todas', 'Todas'), chip('naoentregue', 'Não entregues'), chip('entregues', 'Entregues'), chip('areceber', 'A pagar'), chip('pagas', 'Pagas'), chip('urgentes', 'Urgentes'), chip('desistencias', 'Desistências')]),
          searchInput('Buscar cliente ou produto…', ul, 'enc-search'),
          list.length ? ul : el('p', { class: 'pa-empty', text: 'Nenhuma encomenda com esse filtro.' }),
        ].filter(Boolean)),
  ].filter(Boolean));
}

MODALS['encomendas-fichas-dia'] = (ctx, modal) => encomendasFichasDiaSheet(ctx, modal);

function encomendasFichasDiaSheet(ctx, modal) {
  const { store } = ctx;
  const date = el('input', { class: 'pa-input', type: 'date', value: modal.date || todayInput(), 'data-testid': 'enc-fichas-date' });
  const status = el('select', { class: 'pa-input', 'data-testid': 'enc-fichas-status' }, [
    el('option', { value: 'todos', text: 'Todos os pedidos' }),
    el('option', { value: 'areceber', text: 'A receber' }),
  ]);
  const search = el('input', { class: 'pa-input pa-search', type: 'search', placeholder: 'Buscar cliente pelo nome…', 'data-testid': 'enc-fichas-search' });
  const all = el('input', { type: 'checkbox', 'data-testid': 'enc-fichas-all' });
  const list = el('div', { style: 'max-height:320px;overflow-y:auto', 'data-testid': 'enc-fichas-clients' });
  const count = el('span', { class: 'pa-muted' });
  const print = el('button', { class: 'pa-btn pa-primary pa-grow', 'data-testid': 'enc-fichas-print' }, 'Conferir fichas para imprimir');
  const selected = new Set();
  let dayOrders = [];
  let choices = [];

  const updateSelection = () => {
    all.checked = choices.length > 0 && selected.size === choices.length;
    print.disabled = selected.size === 0;
    count.textContent = `${selected.size} de ${choices.length} cliente(s) marcado(s)`;
  };
  const updateSearch = () => {
    const query = norm(search.value);
    for (const { client, label } of choices) label.style.display = norm(clientSearchText(client)).includes(query) ? '' : 'none';
  };
  const renderClients = () => {
    selected.clear();
    all.checked = false;
    dayOrders = store.state.encomendas.filter((order) => !order.desistenciaAt && dateOnly(order.deliveryDate) === date.value && order.clienteId && store.get('clients', order.clienteId) && (status.value !== 'areceber' || paymentStatus(store, order).saldo > 0.005));
    const grouped = new Map();
    for (const order of dayOrders) {
      const orders = grouped.get(order.clienteId) || [];
      orders.push(order);
      grouped.set(order.clienteId, orders);
    }
    choices = [...grouped.entries()].map(([id, orders]) => {
      const client = store.get('clients', id);
      const check = el('input', { type: 'checkbox', value: id, 'data-testid': 'enc-fichas-client-check' });
      const total = orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
      const balance = orders.reduce((sum, order) => sum + paymentStatus(store, order).saldo, 0);
      const label = el('label', { class: 'pa-check' }, [check, el('span', {}, [
        el('strong', { text: clientLabel(client) }),
        el('span', { class: 'pa-muted', text: ` · ${orders.length} pedido(s) · ${brl(total)} · saldo ${brl(balance)}` }),
      ])]);
      check.addEventListener('change', () => { if (check.checked) selected.add(id); else selected.delete(id); updateSelection(); });
      return { client, check, label };
    }).sort((a, b) => compareNamed(a.client, b.client));
    list.replaceChildren(...(choices.length ? choices.map(({ label }) => label) : [el('p', { class: 'pa-empty', text: status.value === 'areceber' ? 'Nenhuma encomenda a receber nesta data.' : 'Nenhuma encomenda de cliente cadastrado nesta data.' })]));
    updateSearch();
    updateSelection();
  };
  date.addEventListener('change', () => { search.value = ''; renderClients(); });
  status.addEventListener('change', renderClients);
  search.addEventListener('input', updateSearch);
  all.addEventListener('change', () => {
    selected.clear();
    if (all.checked) for (const { check } of choices) selected.add(check.value);
    for (const { check } of choices) check.checked = selected.has(check.value);
    updateSelection();
  });
  print.addEventListener('click', () => {
    if (!selected.size) return;
    const fichas = buildFichas(store, dayOrders.filter((order) => selected.has(order.clienteId)))
      .sort((a, b) => compareNamed(a.client, b.client));
    ctx.actions.openModal({ kind: 'ficha-preview', fichas, filename: `fichas-encomendas-${date.value}.pdf` });
  });
  renderClients();
  return sheet({ title: 'Fichas das encomendas do dia', rows: [
    el('p', { class: 'pa-hint', text: 'Escolha a data, filtre os pedidos e marque os clientes cadastrados. “A receber” inclui apenas pedidos com saldo pendente; desistências e pedidos sem cliente cadastrado ficam fora.' }),
    field('Data de entrega', date),
    field('Situação', status),
    search,
    el('label', { class: 'pa-check' }, [all, el('strong', { text: 'Marcar todos os clientes desta data' })]),
    list,
    count,
    el('div', { class: 'pa-sheet-actions' }, [print]),
  ] });
}

function encomendaItemsResumo(store, e) {
  const hasBundle = (e.itens || []).some((it) => isBundleProduct(store.get('products', it.productId)));
  return (e.itens || []).map((it) => {
    const p = store.get('products', it.productId);
    const composition = bundleCompositionText(store, it);
    return `${hasBundle && !isBundleProduct(p) ? 'Avulso: ' : ''}${fmtNum(it.qty)}× ${p ? p.name : '?'}${composition ? ` [dentro: ${composition}]` : ''}`;
  }).join(' · ');
}

/** Derived payment status of an order from its payments (never a stored flag). */
function paymentStatus(store, e) {
  const title = store.state.financeTitles.find((t) => t.sourceType === 'encomenda' && t.sourceId === e.id);
  const finance = title ? titleState(store, title) : null;
  const paid = finance ? finance.paid : store.paidFor(e.id);
  const discounted = finance ? finance.discounted : 0;
  const credited = finance ? finance.credited : 0;
  const saldo = finance ? finance.balance : Math.max(0, (e.total || 0) - paid);
  if (saldo <= 0.005) return { label: 'pago', cls: 'pa-ok', paid, discounted, credited, saldo: 0 };
  if (paid + discounted + credited > 0.005) return { label: 'parcial', cls: 'pa-warn', paid, discounted, credited, saldo };
  return { label: 'não pago', cls: 'pa-warn', paid, discounted, credited, saldo };
}

function encomendaRow(ctx, e) {
  const { store } = ctx;
  const cli = e.clienteId ? store.get('clients', e.clienteId) : null;
  const resumo = encomendaItemsResumo(store, e);
  const st = paymentStatus(store, e);
  const paymentLabel = st.saldo <= 0.005 ? 'pago' : (st.paid + st.credited > 0.005 ? 'parcial · a pagar' : 'a pagar');
  const deliveryLabel = (e.deliveryMethod || 'retirada') === 'motoboy' ? 'Motoboy' : 'Retirada';
  const stop = (fn) => (ev) => { ev.stopPropagation(); fn(); };
  const urg = !e.desistenciaAt && el('button', { class: 'pa-btn pa-ghost pa-sm pa-urg-btn', title: e.urgente ? 'Tirar urgência' : 'Marcar urgente', onclick: stop(() => ctx.actions.mutate((s) => s.upsertEncomenda({ ...e, urgente: !e.urgente }))) }, e.urgente ? '⭐' : '☆');
  const ent = !e.desistenciaAt && el('button', { class: 'pa-ent' + (e.entregue ? ' pa-ent-on' : ''), 'data-testid': 'enc-entregue', title: e.entregue ? 'Entregue' : 'Marcar como entregue', onclick: stop(() => ctx.actions.mutate((s) => s.upsertEncomenda({ ...e, entregue: !e.entregue }))) }, e.entregue ? '✓ Entregue' : 'Entregar');
  return el('li', { class: 'pa-row-item' + (e.urgente ? ' pa-urgente' : '') + (e.entregue ? ' pa-row-done' : '') + (e.desistenciaAt ? ' pa-cancelled' : ''), 'data-search': `${cli?.name || e.customerName || ''} ${resumo} ${deliveryLabel}`, onclick: () => ctx.actions.openModal({ kind: 'encomenda-edit', id: e.id }) }, [
    el('div', { class: 'pa-grow' }, [
      el('div', { class: 'pa-enc-title' }, [e.desistenciaAt && el('span', { class: 'pa-badge pa-bad', text: 'DESISTÊNCIA' }), e.urgente && !e.desistenciaAt && el('span', { class: 'pa-badge pa-urg', text: 'URGENTE' }), el('strong', { text: cli?.name || e.customerName || 'Sem cliente' }), !e.desistenciaAt && el('span', { class: `pa-badge ${st.cls}`, text: paymentLabel }), el('span', { class: 'pa-badge', text: deliveryLabel })].filter(Boolean)),
      el('span', { class: 'pa-muted', text: `Pedido ${fmtDate(e.at)} · entrega agendada ${fmtDate(e.deliveryDate)}` }),
      el('span', { class: 'pa-muted', text: resumo }),
      el('div', { class: 'pa-enc-actions' }, [el('span', { class: 'pa-num pa-grow', text: brl(e.total) }), urg, ent].filter(Boolean)),
    ]),
  ]);
}

MODALS['encomenda-add'] = (ctx) => encomendaSheet(ctx, null);
MODALS['encomenda-edit'] = (ctx, m) => encomendaSheet(ctx, ctx.store.get('encomendas', m.id) || null);

function encomendaSheet(ctx, enc) {
  const { store } = ctx;
  const config = store.getConfig();
  const es = store.toEngineStore();
  const lens = estimateLens(config);
  const suggested = (pid) => sellingPrice(store, pid);
  const unitCost = (pid) => { try { return productUnitCost(es, pid, config, lens); } catch { return 0; } };

  const items = enc ? enc.itens.map((it) => ({ productId: it.productId, qty: it.qty, unitPrice: it.unitPrice, ...(it.bundleItems ? { bundleItems: it.bundleItems.map((child) => ({ ...child })) } : {}) })) : [];

  const cliPicker = clientePicker(store, enc ? enc.clienteId : '', refreshMatchingOrder);
  const customerName = el('input', { class: 'pa-input', type: 'text', value: enc?.customerName || '', placeholder: 'Nome somente neste pedido', 'data-testid': 'enc-customer-name' });
  const urgenteChk = el('input', { type: 'checkbox', 'data-testid': 'enc-urgente' }); urgenteChk.checked = !!(enc && enc.urgente);
  const date = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'enc-date', type: 'date', value: enc ? enc.deliveryDate.slice(0, 10) : todayInput() });
  const entrega = el('select', { class: 'pa-input', 'data-testid': 'enc-entrega' }, [['retirada', 'Retirada'], ['motoboy', 'Motoboy']].map(([v, t]) => el('option', { value: v, text: t, ...(enc && enc.deliveryMethod === v ? { selected: 'selected' } : {}) })));
  const frete = moneyField(enc ? enc.frete : null, 'enc-frete');
  const discount = moneyField(enc ? enc.discount : null, 'enc-discount');
  const notes = el('textarea', { class: 'pa-input pa-textarea', 'data-testid': 'enc-notes', rows: '2', placeholder: 'Observações (opcional)' });
  notes.value = enc ? (enc.notes || '') : '';
  const mergeNotice = el('p', { class: 'pa-callout', 'data-testid': 'enc-merge-notice', style: 'display:none' });
  function refreshMatchingOrder() {
    if (enc) return;
    const current = findOpenOrderForClientDate(store, cliPicker.value(), date.value);
    mergeNotice.style.display = current ? '' : 'none';
    if (current) {
      entrega.value = current.deliveryMethod || 'retirada';
      entrega.disabled = true;
      mergeNotice.textContent = `Já existe uma encomenda aberta para este cliente em ${fmtDate(current.deliveryDate)}. Os novos produtos serão acrescentados a ela; pagamentos já registrados serão preservados.`;
    } else entrega.disabled = false;
  }
  date.addEventListener('change', refreshMatchingOrder);
  refreshMatchingOrder();

  const totalEl = el('strong', { 'data-testid': 'enc-total' });
  const grossTotal = () => items.reduce((s, it) => s + orderItemGross(it), 0) + (parseNum(frete.input.value) || 0);
  const grandTotal = () => Math.max(0, grossTotal() - Math.min(grossTotal(), parseNum(discount.input.value) || 0));
  const renderTotal = () => { totalEl.textContent = brl(grandTotal()); discount.input.setCustomValidity(''); };

  const itemsList = el('ul', { class: 'pa-list pa-tight' });
  function bundleEditor(it, product, renderLine, totalLabel, lineTot) {
    it.bundleItems ||= [];
    const box = el('div', { class: 'pa-bundle-editor', 'data-testid': 'enc-bundle-editor' });
    const render = () => {
      const rows = (it.bundleItems || []).map((child, childIndex) => {
        const childProduct = store.get('products', child.productId);
        const childQty = el('input', { class: 'pa-input pa-qty', type: 'text', inputmode: 'decimal', value: fmtNum(child.qty), 'aria-label': 'quantidade dentro do conjunto' });
        const childPrice = el('input', { class: 'pa-input pa-unit', type: 'text', inputmode: 'decimal', value: fmtMoneyInput(child.unitPrice || 0), 'aria-label': `Preço de ${childProduct?.name || 'produto'} dentro do conjunto` });
        childQty.addEventListener('input', () => { child.qty = parseNum(childQty.value) || 0; renderLine(); renderTotal(); });
        childPrice.addEventListener('input', () => { child.unitPrice = parseNum(childPrice.value) || 0; renderLine(); renderTotal(); });
        return el('li', { class: 'pa-list-item' }, [childQty, el('span', { class: 'pa-grow', text: childProduct?.name || '(produto removido)' }), el('span', { class: 'pa-lab', text: 'R$' }), childPrice, el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => { it.bundleItems.splice(childIndex, 1); render(); renderLine(); renderTotal(); } }, '✕')]);
      });
      const candidates = store.state.products.filter((p) => productIsActive(p) && !isBundleProduct(p) && p.id !== it.productId);
      const search = el('input', { class: 'pa-input pa-search', 'data-testid': 'enc-bundle-product', type: 'search', placeholder: 'Digite o produto para incluir…' });
      const suggestions = el('ul', { class: 'pa-list pa-tight pa-suggest', style: 'display:none;max-height:220px;overflow-y:auto' });
      const showSuggestions = () => {
        const query = norm(search.value);
        const matches = query ? candidates.filter((p) => norm(p.name).includes(query)).slice(0, 8) : [];
        suggestions.replaceChildren(...matches.map((p) => el('li', { class: 'pa-row-item', 'data-testid': 'enc-bundle-result', onclick: () => {
          const current = it.bundleItems.find((child) => child.productId === p.id);
          if (current) current.qty += 1; else it.bundleItems.push({ productId: p.id, qty: 1, unitPrice: suggested(p.id) });
          render(); renderLine(); renderTotal();
        } }, [el('strong', { class: 'pa-grow', text: p.name }), el('span', { class: 'pa-add', text: '+' })])));
        suggestions.style.display = matches.length ? '' : 'none';
      };
      search.addEventListener('input', showSuggestions);
      box.replaceChildren(el('div', { class: 'pa-enc-title' }, [el('strong', { text: `Produtos dentro de cada ${bundleKindLabel(product).toLowerCase()}` }), el('span', { class: 'pa-badge pa-urg', text: bundleKindLabel(product) })]), el('p', { class: 'pa-hint', text: 'Escolha o conteúdo deste pedido. As quantidades serão multiplicadas pelo número de conjuntos e aparecerão na comanda. Outros produtos adicionados ao pedido ficam avulsos.' }), el('ul', { class: 'pa-list pa-tight' }, rows.length ? rows : [el('li', { class: 'pa-empty pa-sm', text: 'Escolha os produtos que compõem este conjunto.' })]), candidates.length ? el('div', {}, [search, suggestions]) : el('p', { class: 'pa-hint', text: 'Cadastre ao menos um produto comum ativo para montar o conjunto.' }), el('div', { class: 'pa-bundle-total' }, [totalLabel, lineTot]));
    };
    render();
    return box;
  }
  function renderItems() {
    itemsList.replaceChildren(...(items.length ? items.map((it, idx) => {
      const p = store.get('products', it.productId);
      const bundle = p && isBundleProduct(p);
      const qty = el('input', { class: 'pa-input pa-qty', type: 'text', inputmode: 'decimal', value: fmtNum(it.qty), 'aria-label': 'quantidade' });
      const price = el('input', { class: 'pa-input pa-unit', type: 'text', inputmode: 'decimal', value: fmtMoneyInput(it.unitPrice), 'aria-label': 'preço' });
      const lineTot = el(bundle ? 'strong' : 'span', { class: bundle ? 'pa-num' : 'pa-muted pa-linetot', ...(bundle ? { 'data-testid': 'enc-bundle-total' } : {}) });
      const totalLabel = bundle ? el('strong', { class: 'pa-grow' }) : null;
      const renderLine = () => {
        lineTot.textContent = brl(orderItemGross(it));
        if (totalLabel) totalLabel.textContent = `Total ${bundleKindLabel(p) === 'Cesta' ? 'da' : 'do'} ${bundleKindLabel(p).toLowerCase()}${Number(it.qty) > 1 ? ` (${fmtNum(it.qty)} unidades)` : ''}`;
      };
      qty.addEventListener('input', () => { it.qty = parseNum(qty.value) || 0; renderLine(); renderTotal(); });
      price.addEventListener('input', () => { it.unitPrice = parseNum(price.value) || 0; renderLine(); renderTotal(); });
      renderLine();
      return el('li', { class: 'pa-list-item pa-encitem' }, [
        qty,
        el('div', { class: 'pa-grow' }, [el('div', { class: 'pa-enc-title' }, [el('span', { text: p ? p.name : '(produto removido)' }), bundle && el('span', { class: 'pa-badge pa-urg', text: bundleKindLabel(p) })].filter(Boolean)), bundle ? bundleEditor(it, p, renderLine, totalLabel, lineTot) : lineTot]),
        el('span', { class: 'pa-lab', text: bundle ? 'Embalagem R$' : 'R$' }), price,
        el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Remover item', onclick: () => { items.splice(idx, 1); renderItems(); renderTotal(); } }, '✕'),
      ]);
    }) : [el('li', { class: 'pa-empty pa-sm', text: 'Sem itens ainda — busque um produto abaixo.' })]));
  }
  renderItems();

  // Product search-to-add (scales to her ~76 products better than a dropdown).
  const search = el('input', { class: 'pa-input pa-search', 'data-testid': 'enc-prodsearch', type: 'search', placeholder: 'Buscar produto para adicionar…' });
  const results = el('ul', { class: 'pa-list pa-tight pa-suggest', style: 'display:none' });
  function renderResults() {
    const q = norm(search.value);
    if (!q) { results.style.display = 'none'; results.replaceChildren(); return; }
    const matches = store.state.products.filter((p) => productIsActive(p) && norm(p.name).includes(q)).slice(0, 6);
    results.style.display = matches.length ? '' : 'none';
    results.replaceChildren(...matches.map((p) => el('li', { class: 'pa-row-item', 'data-testid': 'enc-prodresult', onclick: () => { items.push({ productId: p.id, qty: 1, unitPrice: suggested(p.id), ...(isBundleProduct(p) ? { bundleItems: [] } : {}) }); search.value = ''; renderResults(); renderItems(); renderTotal(); } }, [
      el('div', { class: 'pa-grow' }, [el('strong', { text: p.name }), isBundleProduct(p) && el('span', { class: 'pa-badge pa-urg', text: `${bundleKindLabel(p)} · escolher conteúdo` })].filter(Boolean)), el('span', { class: 'pa-add', text: '+' }),
    ])));
  }
  search.addEventListener('input', renderResults);
  frete.input.addEventListener('input', renderTotal);
  discount.input.addEventListener('input', renderTotal);
  renderTotal();

  function save() {
    if (!items.length) { search.focus(); return; }
    const incompleteBundle = items.find((it) => isBundleProduct(store.get('products', it.productId)) && !(it.bundleItems || []).some((child) => (Number(child.qty) || 0) > 0));
    if (incompleteBundle) { window.alert('Escolha os produtos que compõem cada cesta, kit ou combo antes de salvar.'); return; }
    const discountValue = Math.max(0, parseNum(discount.input.value) || 0);
    if (discountValue > grossTotal() + 0.005) { discount.input.setCustomValidity('O desconto não pode ser maior que o total bruto.'); discount.input.reportValidity(); return; }
    const cost = items.reduce((s, it) => s + (Number(it.qty) || 0) * (orderItemUnitCost(store, it, unitCost) || 0), 0);
    const materials = orderMaterialEstimate(store, { itens: items });
    const fr = parseNum(frete.input.value);
    const ob = notes.value.trim();
    if (enc && !window.confirm('Salvar alterações neste pedido? O total e a comanda podem mudar.')) return;
    ctx.actions.mutate((s) => {
      const order = {
        ...(enc || { at: nowIso() }),
        id: enc ? enc.id : uuid(),
        deliveryDate: date.value ? new Date(`${date.value}T12:00:00`).toISOString() : nowIso(),
        clienteId: cliPicker.value() || undefined,
        customerName: cliPicker.value() ? undefined : customerName.value.trim() || undefined,
        itens: items.map((it) => ({ productId: it.productId, qty: Number(it.qty) || 0, unitPrice: Number(it.unitPrice) || 0, ...(it.bundleItems?.length ? { bundleItems: it.bundleItems.map((child) => ({ productId: child.productId, qty: Number(child.qty) || 0, unitPrice: Number(child.unitPrice) || 0 })) } : {}) })),
        total: grandTotal(),
        discount: discountValue || undefined,
        costSnapshot: cost,
        ...(materials.missing ? {} : { materialCostSnapshot: materials.ingredients, packagingCostSnapshot: materials.packaging }),
        deliveryMethod: entrega.value,
        frete: fr == null ? undefined : fr,
        notes: ob || undefined,
        urgente: urgenteChk.checked || undefined,
      };
      if (enc) s.upsertEncomenda(order);
      else addOrAppendOrder(s, order);
    });
  }

  // Payment summary + history (edit mode). Registering a payment happens from Fiado (or here, after
  // a save) so unsaved item edits can't be lost — the order's saldo/status are always derived.
  const paymentSection = [];
  if (enc) {
    const st = paymentStatus(store, enc);
    const hist = store.state.payments.filter((pg) => pg.encomendaId === enc.id).sort((a, b) => (a.at < b.at ? 1 : -1));
    paymentSection.push(
      el('h3', { class: 'pa-h3', text: 'Pagamento' }),
      el('table', { class: 'pa-kv' }, [
        el('tr', {}, [el('td', { text: 'Total' }), el('td', { class: 'pa-num', text: brl(enc.total) })]),
        el('tr', {}, [el('td', { text: 'Pago' }), el('td', { class: 'pa-num', text: brl(st.paid) })]),
        st.discounted > 0.005 && el('tr', {}, [el('td', { text: 'Desconto na quitação' }), el('td', { class: 'pa-num', text: brl(st.discounted) })]),
        el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Saldo' }), el('td', { class: 'pa-num' + (st.saldo > 0.005 ? ' pa-bad' : ''), text: brl(st.saldo) })]),
      ]),
      hist.length > 0 && el('ul', { class: 'pa-list pa-tight' }, hist.map((pg) => el('li', { class: 'pa-list-item' + (store.isReversed('payment', pg.id) ? ' pa-reversed' : '') }, [
        el('span', { class: 'pa-grow pa-muted', text: `${fmtDate(pg.at)}${pg.forma ? ` · ${pg.forma}` : ''}` }),
        el('span', { class: 'pa-num', text: brl(pg.valor) }),
        !store.isReversed('payment', pg.id) && el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'payment-correct', onclick: () => {
          const title = store.state.financeTitles.find((entry) => entry.sourceType === 'encomenda' && entry.sourceId === enc.id);
          if (title) ctx.actions.openModal({ kind: 'finance-settlement-edit', titleId: title.id, settlementId: pg.id, settlementKind: 'payment' });
        } }, 'Corrigir'),
        estornoControl(ctx, 'payment', pg.id),
      ].filter(Boolean)))),
      el('div', { class: 'pa-row pa-form' }, [
        st.saldo > 0.005 && !enc.desistenciaAt && el('button', { class: 'pa-btn pa-sm', 'data-testid': 'enc-pagar', onclick: () => ctx.actions.openModal({ kind: 'pagamento-add', encomendaId: enc.id }) }, '+ Registrar pagamento'),
        st.paid > 0.005 && reciboButton(ctx, enc),
      ].filter(Boolean)),
    );
  }

  const rows = [
    enc && enc.desistenciaAt && el('div', { class: 'pa-callout pa-callout-danger' }, [
      el('strong', { text: 'Desistência registrada' }),
      el('span', { text: ` em ${fmtDate(enc.desistenciaAt)}. A encomenda foi mantida no histórico.` }),
    ]),
    field('Cliente', cliPicker.el),
    enc?.quickSale && field('Nome sem cadastro', customerName),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Entrega' }), date, entrega]),
    !enc && mergeNotice,
    el('label', { class: 'pa-check' }, [urgenteChk, el('span', { text: 'Marcar como URGENTE (vai pro topo da lista)' })]),
    el('h3', { class: 'pa-h3', text: 'Itens' }),
    el('p', { class: 'pa-hint', text: 'Adicione uma cesta ou kit e escolha os produtos dentro dele. O total soma a embalagem e o conteúdo. Para um produto fora do conjunto, adicione-o separadamente; se as cestas tiverem conteúdos diferentes, adicione uma linha para cada uma.' }),
    itemsList,
    search, results,
    el('div', { class: 'pa-row pa-totals' }, [el('span', { class: 'pa-grow' }, [el('strong', { text: 'Total ' }), totalEl])]),
    field('Frete (opcional)', frete),
    field('Desconto da venda (opcional)', discount),
    el('p', { class: 'pa-hint', text: 'Este desconto reduz o valor da venda. Um desconto negociado somente na quitação pode ser registrado depois em Financeiro › A Receber.' }),
    field('Observações (opcional)', notes),
    enc && enc.clienteId && el('button', { class: 'pa-btn pa-sm', 'data-testid': 'enc-client-statement', onclick: () => ctx.actions.openClientStatement(enc.clienteId) }, 'Abrir ficha do cliente'),
    ...paymentSection.filter(Boolean),
  ];

  const cliName = enc && enc.clienteId ? (store.get('clients', enc.clienteId)?.name || 'cliente') : 'sem cliente';
  return sheet({
    title: enc ? 'Editar encomenda' : 'Nova encomenda',
    rows,
    onSave: save,
    saveTestid: 'enc-save',
    danger: enc ? [
      !enc.desistenciaAt && { label: 'Marcar como desistência', className: 'pa-soft-danger', testid: 'enc-desistencia', onClick: () => confirmDesistencia(ctx, enc) },
      { label: '🗑 Excluir encomenda', testid: 'enc-delete', onClick: () => confirmRemove(ctx, `a encomenda de ${cliName}`, (s) => s.removeEncomenda(enc.id)) },
    ].filter(Boolean) : null,
  });
}

// ── Pagamentos (Rev 04 — append-only; saldo/status derived; estorno corrige) ─────

MODALS['pagamento-add'] = (ctx, m) => pagamentoSheet(ctx, m.encomendaId);

function pagamentoSheet(ctx, encomendaId) {
  const { store } = ctx;
  const enc = store.get('encomendas', encomendaId);
  const cli = enc && enc.clienteId ? store.get('clients', enc.clienteId) : null;
  const cliName = cli ? cli.name : 'Sem cliente';
  const saldo = enc ? paymentStatus(store, enc).saldo : 0;
  const date = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'pag-date', type: 'date', value: todayInput() });
  const valor = moneyField(saldo > 0 ? saldo : null, 'pag-valor');
  const forma = paymentMethodSelect(store, 'pag-forma');

  function save() {
    const v = parseNum(valor.input.value);
    if (v == null || !(v > 0)) { valor.input.focus(); return; }
    const at = date.value ? new Date(`${date.value}T12:00:00`).toISOString() : nowIso();
    ctx.actions.mutate((s) => s.addPayment({ id: uuid(), at, encomendaId, valor: v, forma: forma.value }));
  }
  return sheet({
    title: 'Registrar pagamento',
    rows: [
      // Client name in destaque so she confirms WHO before giving baixa (reduces operational errors).
      el('div', { class: 'pa-pag-cli', 'data-testid': 'pag-cliente' }, [
        el('span', { class: 'pa-muted', text: 'Pagamento de' }),
        el('strong', { text: cliName }),
        el('span', { class: 'pa-muted', text: enc ? `${encomendaItemsResumo(store, enc)} · entrega ${fmtDate(enc.deliveryDate)}` : '' }),
      ]),
      el('p', { class: 'pa-hint', text: `Saldo a receber: ${brl(saldo)}` }),
      field('Data', date),
      field('Valor', valor),
      field('Forma', forma),
    ],
    onSave: save,
    saveTestid: 'pag-add',
  });
}

// ── Fichas (Rev 04 — printable client folders, 3 per A4, via lazy pdf-lib) ───────

/** Group encomendas by client into ficha specs (orders + saldo) for the PDF generator. */
function buildFichas(store, encomendas) {
  const groups = new Map();
  for (const e of encomendas.filter((x) => !x.desistenciaAt)) {
    const key = e.clienteId || '__none__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups.entries()].map(([key, ords]) => {
    const client = key === '__none__' ? null : store.get('clients', key);
    const orders = ords.slice().sort((a, b) => (a.deliveryDate < b.deliveryDate ? 1 : -1)).map((e) => ({
      date: fmtDate(e.deliveryDate), resumo: encomendaItemsResumo(store, e), total: e.total || 0, saldo: paymentStatus(store, e).saldo,
    }));
    return { client, orders, saldoTotal: orders.reduce((s, o) => s + Math.max(0, o.saldo), 0) };
  });
}

/** Encomendas filtered by payment state, for the ficha report modes. */
function encomendasByMode(store, mode) {
  return store.state.encomendas.filter((e) => {
    if (e.desistenciaAt) return false;
    const saldo = paymentStatus(store, e).saldo;
    if (mode === 'aberto') return saldo > 0.005;     // em aberto + parcialmente pagas
    if (mode === 'pagas') return saldo <= 0.005;      // quitadas
    return true;                                      // todas
  });
}

/** A button that generates + saves a fichas PDF, with inline "Gerando…" feedback. */
function fichasButton(ctx, label, getFichas, filename, testid = 'gerar-fichas') {
  const btn = el('button', { class: 'pa-btn pa-sm', 'data-testid': testid }, label);
  btn.addEventListener('click', () => {
    const fichas = getFichas();
    if (!fichas.length) { window.alert('Nenhuma ficha para gerar com esse filtro.'); return; }
    ctx.actions.openModal({ kind: 'ficha-preview', fichas, filename });
  });
  return btn;
}

MODALS['ficha-preview'] = (ctx, m) => fichaPreviewSheet(ctx, m);

// Preview-before-print (Rev 07 #5): show the fichas' data for conferência, then "Gerar PDF".
function fichaPreviewSheet(ctx, m) {
  const { fichas, filename } = m;
  const preview = el('div', { class: 'pa-ficha-prev', 'data-testid': 'ficha-preview' }, fichas.map((f) => el('div', { class: 'pa-ficha-card' }, [
    el('div', {}, el('strong', { text: (f.client && f.client.name) || 'Sem cliente' })),
    f.client && (f.client.phone || f.client.address) && el('div', { class: 'pa-muted', text: [f.client.phone, f.client.address].filter(Boolean).join(' · ') }),
    el('ul', { class: 'pa-list pa-tight' }, f.orders.slice(0, 6).map((o) => el('li', { class: 'pa-list-item' }, [
      el('span', { class: 'pa-grow pa-muted', text: `${o.date} · ${o.resumo}` }),
      el('span', { class: 'pa-num', text: brl(o.total) }),
      el('span', { class: o.saldo > 0.005 ? 'pa-badge pa-warn' : 'pa-badge pa-ok', text: o.saldo > 0.005 ? `deve ${brl(o.saldo)}` : 'pago' }),
    ]))),
    f.orders.length > 6 && el('p', { class: 'pa-hint', text: `+ ${f.orders.length - 6} pedido(s)…` }),
    el('div', { class: 'pa-row pa-totals' }, [el('span', { class: 'pa-grow' }, [el('strong', { text: 'Saldo devedor ' }), el('strong', { class: f.saldoTotal > 0.005 ? 'pa-bad' : '', text: brl(f.saldoTotal) })])]),
  ].filter(Boolean))));
  const genBtn = el('button', { class: 'pa-btn pa-primary pa-grow', 'data-testid': 'ficha-gerar' }, '🖨 Gerar PDF para imprimir');
  genBtn.addEventListener('click', async () => {
    const orig = genBtn.textContent; genBtn.textContent = 'Gerando…'; genBtn.disabled = true;
    try { await savePdf(await generateFichasPdf(fichas), filename); ctx.actions.closeModal(); }
    catch (e) { window.alert('Não foi possível gerar o PDF: ' + (e && e.message ? e.message : e)); genBtn.textContent = orig; genBtn.disabled = false; }
  });
  return sheet({
    title: `Fichas — prévia (${fichas.length})`,
    rows: [
      el('p', { class: 'pa-hint', text: 'Confira os dados antes de imprimir. O PDF sai com 3 fichas por folha, pra recortar e arquivar.' }),
      preview,
      el('div', { class: 'pa-row pa-form' }, [genBtn]),
    ],
  });
}

/** Assemble a recibo (payment proof) object from an encomenda + its derived payment state. */
function buildRecibo(store, enc) {
  const client = enc.clienteId ? store.get('clients', enc.clienteId) : null;
  const st = paymentStatus(store, enc);
  const formas = new Set(store.state.payments.filter((pg) => pg.encomendaId === enc.id && !store.isReversed('payment', pg.id) && pg.forma).map((pg) => pg.forma));
  return {
    numero: 'Nº ' + enc.id.slice(0, 8),
    date: fmtDate(nowIso()),
    clientName: client ? client.name : 'Consumidor',
    clientContato: client ? [client.phone, client.address].filter(Boolean).join(' · ') : '',
    items: enc.itens.map((it) => { const p = store.get('products', it.productId); const composition = bundleCompositionText(store, it); const qty = Number(it.qty) || 0; const total = orderItemGross(it); return { name: `${p ? p.name : '(produto)'}${composition ? ` (${composition})` : ''}`, qty, unitPrice: qty > 0 ? total / qty : 0, total }; }),
    referente: `pedido de ${fmtDate(enc.deliveryDate)}`,
    subtotal: (Number(enc.total) || 0) + (Number(enc.discount) || 0),
    desconto: Number(enc.discount) || 0,
    total: enc.total || 0,
    pago: st.paid,
    descontoQuitacao: st.discounted || 0,
    saldo: st.saldo,
    forma: formas.size === 1 ? [...formas][0] : undefined,
    observacoes: enc.notes || undefined,
    empresa: store.getConfig().empresa || undefined,
  };
}

/** A button that generates + saves a recibo PDF for one order, with inline "Gerando…" feedback. */
function reciboButton(ctx, enc) {
  const { store } = ctx;
  const btn = el('button', { class: 'pa-btn pa-sm', 'data-testid': 'gerar-recibo' }, '🧾 Recibo (PDF)');
  btn.addEventListener('click', async () => {
    const orig = btn.textContent;
    btn.textContent = 'Gerando…'; btn.disabled = true;
    try {
      const r = buildRecibo(store, enc);
      const safe = (r.clientName || 'cliente').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      await savePdf(await generateReciboPdf(r), `recibo-${safe}.pdf`);
    } catch (e) { window.alert('Não foi possível gerar o PDF: ' + (e && e.message ? e.message : e)); }
    finally { btn.textContent = orig; btn.disabled = false; }
  });
  return btn;
}

// ── Fiado / Quem me deve (Rev 04 — outstanding order balances) ───────────────────

function fiadoPanel(ctx) {
  const { store } = ctx;
  const { fiadoStart: start, fiadoEnd: end, fiadoStatus: status } = ctx.view;
  let orders = store.state.encomendas.filter((e) => !e.desistenciaAt && inDateRange(e.deliveryDate, start, end));
  if (status === 'aberto') orders = orders.filter((e) => paymentStatus(store, e).saldo > 0.005);
  else if (status === 'recebidos') orders = orders.filter((e) => paymentStatus(store, e).saldo <= 0.005);
  const grouped = new Map();
  for (const e of orders) {
    const key = e.clienteId || '__sem__';
    const g = grouped.get(key) || { key, orders: [], total: 0, received: 0, pending: 0 };
    const statusRow = paymentStatus(store, e); const paid = Math.min(Number(e.total) || 0, statusRow.paid);
    g.orders.push(e); g.total += Number(e.total) || 0; g.received += paid; g.pending += statusRow.saldo;
    grouped.set(key, g);
  }
  const groups = [...grouped.values()].sort((a, b) => {
    const an = a.key === '__sem__' ? 'zzz' : norm(store.get('clients', a.key)?.name || '');
    const bn = b.key === '__sem__' ? 'zzz' : norm(store.get('clients', b.key)?.name || '');
    return an.localeCompare(bn);
  });
  const displayValue = (g) => status === 'aberto' ? g.pending : status === 'recebidos' ? g.received : g.total;
  const total = groups.reduce((sum, g) => sum + displayValue(g), 0);
  const totalLabel = status === 'aberto' ? 'Total a receber' : status === 'recebidos' ? 'Total recebido' : 'Total das compras';
  const ul = el('ul', { class: 'pa-list pa-rows' }, groups.map((g) => {
    const cli = g.key === '__sem__' ? null : store.get('clients', g.key);
    return el('li', { class: 'pa-row-item', 'data-testid': 'fiado-row', 'data-search': cli?.name || 'sem cliente', onclick: () => ctx.actions.openModal({ kind: 'fiado-cliente', clientKey: g.key, orderIds: g.orders.map((e) => e.id), status }) }, [
      el('div', { class: 'pa-grow' }, [el('strong', { text: cli?.name || 'Sem cliente' }), el('span', { class: 'pa-muted', text: `${g.orders.length} compra(s) · recebido ${brl(g.received)}` })]),
      el('div', { class: 'pa-list-value' }, [el('span', { class: 'pa-muted', text: status === 'aberto' ? 'em aberto' : status === 'recebidos' ? 'recebido' : 'total' }), el('strong', { class: g.pending > 0.005 && status !== 'recebidos' ? 'pa-bad' : '', text: brl(displayValue(g)) })]),
      el('span', { class: 'pa-chev', text: '›' }),
    ]);
  }));
  const period = periodFields(start, end, ({ start: s, end: e }) => ctx.actions.setFiadoPeriod({ fiadoStart: s, fiadoEnd: e }), 'fiado');
  const chip = (key, label) => el('button', { class: 'pa-chip' + (status === key ? ' pa-chip-on' : ''), onclick: () => ctx.actions.setFiadoPeriod({ fiadoStatus: key }) }, label);
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('h2', { class: 'pa-grow', text: 'A Receber' }),
      orders.length > 0 && fichasButton(ctx, '🖨 Fichas', () => buildFichas(store, orders), 'fichas-a-receber.pdf'),
    ].filter(Boolean)),
    el('p', { class: 'pa-hint', text: 'Compras agrupadas por cliente. Abra um cliente para conferir cada data, produto e pagamento.' }),
    period,
    el('div', { class: 'pa-chiprow' }, [chip('aberto', 'A receber'), chip('recebidos', 'Recebidos'), chip('todos', 'Todos')]),
    el('div', { class: 'pa-statgrid' }, [statCard(totalLabel, brl(total), status === 'aberto' && total > 0.005 ? 'warn' : 'ok')]),
    groups.length ? el('div', {}, [searchInput('Buscar cliente…', ul, 'fiado-search'), ul]) : el('p', { class: 'pa-empty', text: 'Nenhuma compra com este filtro.' }),
  ]);
}

MODALS['fiado-cliente'] = (ctx, m) => {
  const { store } = ctx;
  const cli = m.clientKey === '__sem__' ? null : store.get('clients', m.clientKey);
  const orders = m.orderIds.map((id) => store.get('encomendas', id)).filter(Boolean).sort((a, b) => (a.deliveryDate < b.deliveryDate ? 1 : -1));
  return sheet({
    title: cli?.name || 'Sem cliente',
    rows: [
      cli && (cli.phone || cli.address) && el('p', { class: 'pa-sheet-msg', text: [cli.phone, cli.address].filter(Boolean).join(' · ') }),
      ...orders.map((e) => {
        const st = paymentStatus(store, e);
        return el('section', { class: 'pa-detail-card' }, [
          el('div', { class: 'pa-row' }, [el('strong', { class: 'pa-grow', text: fmtDate(e.deliveryDate) }), el('span', { class: `pa-badge ${st.cls}`, text: st.label })]),
          el('p', { class: 'pa-muted', text: encomendaItemsResumo(store, e) }),
          el('table', { class: 'pa-kv' }, [el('tr', {}, [el('td', { text: 'Compra' }), el('td', { class: 'pa-num', text: brl(e.total) })]), el('tr', {}, [el('td', { text: 'Recebido' }), el('td', { class: 'pa-num', text: brl(st.paid) })]), el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Em aberto' }), el('td', { class: 'pa-num', text: brl(st.saldo) })])]),
          st.saldo > 0.005 && el('button', { class: 'pa-btn pa-sm', onclick: () => ctx.actions.openModal({ kind: 'pagamento-add', encomendaId: e.id }) }, 'Registrar pagamento'),
        ].filter(Boolean));
      }),
    ].filter(Boolean),
  });
};

// ── Custos variáveis (Rev 03 #4 — dated expense ledger) ──────────────────────────

// ── Despesas (Rev 06 — categorized cash-expense ledger; feeds the cash-basis result) ─────────────

// ── Financeiro ERP — títulos, baixas, caixa, compras e relatórios ─────────────────────────────

const FIN_STATUS = { aberto: ['Em aberto', 'pa-warn'], parcial: ['Parcial', 'pa-warn'], vencido: ['Vencido', 'pa-bad'], quitado: ['Quitado', 'pa-ok'], perda: ['Perda', 'pa-bad'], cancelado: ['Cancelado', ''] };
const titleBadge = (status) => el('span', { class: `pa-badge ${FIN_STATUS[status]?.[1] || ''}`, text: FIN_STATUS[status]?.[0] || status });
const activeFinanceCategories = (store, direction, selectedId = '') => {
  const categories = store.state.categories.filter((c) => {
    if (c.id === selectedId) return true;
    if (c.archived || !c.parentId || c.cashFlowGroup === 'nao-caixa') return false;
    if (c.direction) return c.direction === direction;
    return direction === 'receber'
      ? (c.nature === 'receita' || c.kind === 'receita')
      : (['custo', 'despesa', 'investimento'].includes(c.nature || '') || ['custo', 'despesaFixa', 'despesaVariavel'].includes(c.kind));
  }).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true }));
  const unique = new Map();
  for (const category of categories) {
    const key = norm(category.name) || category.id;
    const previous = unique.get(key);
    if (!previous || category.id === selectedId || (previous.id !== selectedId && category.systemKey && !previous.systemKey)) unique.set(key, category);
  }
  return [...unique.values()];
};
const accountOptions = (store) => store.state.cashAccounts.filter((a) => !a.archived);
const paymentMethodRecords = (store) => {
  const configured = store.getConfig().paymentMethods;
  const fallback = ['Pix', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Transferência bancária', 'Boleto', 'Outro'];
  const source = Array.isArray(configured) && configured.length ? configured : fallback;
  return source.map((method, index) => typeof method === 'string'
    ? { id: `forma-${index}-${norm(method).replace(/[^a-z0-9]+/g, '-')}`, name: method }
    : method).filter((method) => method && method.name);
};
const paymentMethodNames = (store, includeArchived = false) => paymentMethodRecords(store)
  .filter((method) => includeArchived || !method.archived)
  .map((method) => method.name);
const paymentMethodSelect = (store, testid, selected = '') => {
  const names = paymentMethodNames(store);
  if (selected && !names.includes(selected)) names.push(selected);
  return el('select', { class: 'pa-input', ...(testid ? { 'data-testid': testid } : {}) }, names.map((name) => el('option', { value: name, text: name, ...(selected === name ? { selected: 'selected' } : {}) })));
};
const dateIso = (value) => value ? new Date(`${value}T12:00:00`).toISOString() : nowIso();

function dashboardProfitLine(series) {
  const width = 360; const height = 155; const left = 38; const right = 10; const top = 14; const bottom = 28;
  const values = series.map((row) => Number(row.profit) || 0);
  const minimum = Math.min(0, ...values); const maximum = Math.max(0, ...values);
  const range = Math.max(1, maximum - minimum); const plotWidth = width - left - right; const plotHeight = height - top - bottom;
  const x = (index) => left + (series.length <= 1 ? plotWidth / 2 : index * plotWidth / (series.length - 1));
  const y = (value) => top + (maximum - value) * plotHeight / range;
  const zeroY = y(0); const labelEvery = Math.max(1, Math.ceil(series.length / 6));
  const children = [
    svgEl('line', { x1: left, y1: zeroY, x2: width - right, y2: zeroY, stroke: 'var(--au-border)', 'stroke-width': 1 }),
    svgEl('text', { x: left - 4, y: top + 4, 'text-anchor': 'end', 'font-size': 8, fill: 'var(--au-fg-soft)' }, `${Math.round(maximum)}`),
    svgEl('text', { x: left - 4, y: height - bottom, 'text-anchor': 'end', 'font-size': 8, fill: 'var(--au-fg-soft)' }, `${Math.round(minimum)}`),
  ];
  if (series.length) {
    const points = series.map((row, index) => `${x(index)},${y(Number(row.profit) || 0)}`).join(' ');
    children.push(svgEl('polyline', { points, fill: 'none', stroke: 'var(--pa-teal)', 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    series.forEach((row, index) => {
      const value = Number(row.profit) || 0;
      children.push(svgEl('circle', { cx: x(index), cy: y(value), r: 3.5, fill: value >= 0 ? 'var(--pa-teal)' : 'var(--pa-terra)' }, [svgEl('title', {}, `${row.label}: ${brl(value)}`)]));
      if (index % labelEvery === 0 || index === series.length - 1) children.push(svgEl('text', { x: x(index), y: height - 9, 'text-anchor': 'middle', 'font-size': 8, fill: 'var(--au-fg-soft)' }, row.label));
    });
  }
  return svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'pa-chart', width: '100%', preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Evolução do lucro gerencial', 'data-testid': 'dashboard-profit-chart' }, children);
}

function dashboardProductVolume(rows) {
  const visible = rows.slice(0, 8); const width = 360; const left = 132; const right = 38; const rowHeight = 27; const height = Math.max(82, visible.length * rowHeight + 18);
  const maximum = Math.max(1, ...visible.map((row) => Number(row.qty) || 0)); const plotWidth = width - left - right;
  const children = [];
  visible.forEach((row, index) => {
    const y = 8 + index * rowHeight; const barWidth = Math.max(2, (Number(row.qty) || 0) * plotWidth / maximum);
    const name = row.name.length > 21 ? row.name.slice(0, 20) + '…' : row.name;
    children.push(svgEl('text', { x: left - 7, y: y + 14, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--au-fg)' }, name));
    children.push(svgEl('rect', { x: left, y: y + 3, width: barWidth, height: 15, rx: 5, fill: 'var(--pa-gold)' }, [svgEl('title', {}, `${row.name}: ${fmtNum(row.qty)} unidade(s)`) ]));
    children.push(svgEl('text', { x: Math.min(width - right + 4, left + barWidth + 5), y: y + 14, 'font-size': 9, fill: 'var(--au-fg-soft)' }, fmtNum(row.qty)));
  });
  if (!visible.length) children.push(svgEl('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--au-fg-soft)' }, 'Sem vendas no período'));
  return svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'pa-chart', width: '100%', preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Volume de produtos vendidos', 'data-testid': 'dashboard-volume-chart' }, children);
}

function financeHomePanel(ctx) {
  const quick = (icon, label, tab, tone = '') => el('button', { class: `pa-fin-home-link ${tone}`, onclick: () => tab === 'fin-ficha' ? ctx.actions.openClientStatement() : ctx.actions.setTab(tab) }, [el('span', { class: 'pa-fin-home-icon', text: icon }), el('strong', { text: label })]);
  return el('section', { class: 'pa-card pa-fin-home' }, [
    el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Central financeira' }), el('h2', { text: 'O que você quer consultar?' })])]),
    el('p', { class: 'pa-hint', text: 'Todos os atalhos financeiros ficam reunidos aqui. Cada função aparece uma única vez.' }),
    el('div', { class: 'pa-fin-home-grid' }, [
      quick('▦', 'Dashboard', 'fin-dashboard', 'pa-fin-home-primary'), quick('↓', 'Contas a receber', 'fin-receber'), quick('👤', 'Ficha do cliente', 'fin-ficha'), quick('↑', 'Contas a pagar', 'fin-pagar'),
      quick('↔', 'Fluxo de caixa', 'fin-fluxo'), quick('＋', 'Lançamentos', 'financeiro'), quick('▤', 'Recibo / Orçamento', 'fin-documentos'),
      quick('🛒', 'Compras', 'fin-compras'), quick('☷', 'Plano de Contas', 'fin-plano'), quick('▥', 'Relatórios financeiros', 'fin-relatorios'),
      quick('📈', 'DRE gerencial', 'fin-dre'), quick('⌁', 'Relatório gerencial', 'relatorios'), quick('R$', 'Preços e custos', 'precos'), quick('≈', 'Simular preço', 'simulador'),
    ]),
  ]);
}

function financeDashboardPanel(ctx) {
  const { store, view } = ctx;
  const start = view.dashboardStart; const end = view.dashboardEnd; const presetKey = view.dashboardPreset || 'mes';
  const flow = cashFlow(store, start, end, { projected: true });
  const receivableRows = listTitles(store, { direction: 'receber', status: 'aberto', start, end });
  const payableRows = listTitles(store, { direction: 'pagar', status: 'aberto', start, end });
  const receivable = receivableRows.reduce((sum, row) => sum + row.balance, 0);
  const payable = payableRows.reduce((sum, row) => sum + row.balance, 0);
  const overdueReceivable = receivableRows.filter((row) => row.status === 'vencido').reduce((sum, row) => sum + row.balance, 0);
  const overduePayable = payableRows.filter((row) => row.status === 'vencido').reduce((sum, row) => sum + row.balance, 0);
  const decision = businessPeriodSummary(store, start, end);
  const profitTrend = businessProfitTrend(store, start, end);
  const preset = (key, label) => el('button', { class: 'pa-chip' + (presetKey === key ? ' pa-chip-on' : ''), 'data-testid': `dashboard-${key}`, onclick: () => { if (key === 'personalizado') ctx.actions.setDashboardView({ dashboardPreset: key }); else { const [s, e] = presetRange(key); ctx.actions.setDashboardView({ dashboardPreset: key, dashboardStart: s, dashboardEnd: e }); } } }, label);
  const productQty = (row) => { const p = row ? store.get('products', row.id) : null; return row ? `${fmtNum(row.qty)} ${p?.saleUnit || 'un'}` : 'Sem dados'; };
  const insight = (label, title, detail, tone = 'soft') => el('section', { class: `pa-insight pa-insight-${tone}` }, [el('span', { class: 'pa-eyebrow', text: label }), el('strong', { text: title || 'Sem dados no período' }), detail && el('span', { class: 'pa-muted', text: detail })].filter(Boolean));
  return el('section', { class: 'pa-card pa-fin-hero' }, [
    el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Visão financeira e comercial' }), el('h2', { text: 'Dashboard do negócio' })])]),
    el('div', { class: 'pa-chiprow' }, [preset('hoje', 'Hoje'), preset('semana', 'Semana'), preset('mes', 'Mês'), preset('ano', 'Ano'), preset('personalizado', 'Período específico')]),
    presetKey === 'personalizado'
      ? periodFields(start, end, ({ start: s, end: e }) => ctx.actions.setDashboardView({ dashboardStart: s, dashboardEnd: e }), 'dashboard')
      : el('p', { class: 'pa-hint', text: `Período selecionado automaticamente: ${fmtDate(`${start}T12:00:00`)} até ${fmtDate(`${end}T12:00:00`)}` }),
    el('p', { class: 'pa-hint', text: 'Caixa realizado mostra somente dinheiro que entrou ou saiu. Indicadores de vendas usam a data da venda ou da entrega agendada.' }),
    el('div', { class: 'pa-statgrid' }, [statCard('Entradas no caixa', brl(flow.totalIn), 'ok'), statCard('Pagamentos efetuados', brl(flow.totalOut), flow.totalOut ? 'warn' : 'soft'), statCard('Saldo de caixa no período', brl(flow.totalIn - flow.totalOut), flow.totalIn - flow.totalOut >= 0 ? 'navy' : 'bad')]),
    el('div', { class: 'pa-statgrid' }, [statCard('A receber no período', brl(receivable), receivable ? 'warn' : 'soft'), statCard('A pagar no período', brl(payable), payable ? 'warn' : 'soft'), statCard('Vencido a receber', brl(overdueReceivable), overdueReceivable ? 'bad' : 'ok'), statCard('Vencido a pagar', brl(overduePayable), overduePayable ? 'bad' : 'ok')]),
    el('div', { class: 'pa-dashboard-chartgrid' }, [
      el('section', { class: 'pa-detail-card' }, [el('h3', { class: 'pa-h3', text: 'Evolução do lucro' }), dashboardProfitLine(profitTrend), el('p', { class: 'pa-hint', text: 'Resultado gerencial por competência, agrupado por dia, semana ou mês conforme o período.' })]),
      el('section', { class: 'pa-detail-card' }, [el('h3', { class: 'pa-h3', text: 'Volume de produtos vendidos' }), dashboardProductVolume(decision.soldProducts), el('p', { class: 'pa-hint', text: 'Quantidade dos produtos vendidos no período, do maior para o menor volume.' })]),
    ]),
    el('h3', { class: 'pa-h3', text: 'Clientes' }),
    el('div', { class: 'pa-insight-grid' }, [
      insight('Maior frequência', decision.mostFrequentClient?.name, decision.mostFrequentClient ? `${decision.mostFrequentClient.orders} compra(s) · ${brl(decision.mostFrequentClient.total)}` : null, 'teal'),
      insight('Maior valor comprado', decision.highestValueClient?.name, decision.highestValueClient ? `${brl(decision.highestValueClient.total)} · ${decision.highestValueClient.orders} compra(s)` : null, 'gold'),
    ]),
    el('h3', { class: 'pa-h3', text: 'Produtos' }),
    el('div', { class: 'pa-insight-grid' }, [
      insight('Mais vendido', decision.mostSoldProduct?.name, decision.mostSoldProduct ? `${productQty(decision.mostSoldProduct)} · ${brl(decision.mostSoldProduct.revenue)}` : null, 'teal'),
      insight('Menos vendido entre os vendidos', decision.leastSoldProduct?.name, decision.leastSoldProduct ? `${productQty(decision.leastSoldProduct)} · ${brl(decision.leastSoldProduct.revenue)}` : null),
      insight('Melhor margem estimada', decision.bestMarginProduct?.name, decision.bestMarginProduct ? `${pctStr(decision.bestMarginProduct.marginPct)} · lucro estimado ${brl(decision.bestMarginProduct.profit)}` : null, 'green'),
      insight('Menor margem estimada', decision.worstMarginProduct?.name, decision.worstMarginProduct ? `${pctStr(decision.worstMarginProduct.marginPct)} · lucro estimado ${brl(decision.worstMarginProduct.profit)}` : null, decision.worstMarginProduct?.marginPct < 0 ? 'red' : 'soft'),
      insight('Cestas, kits e combos', decision.baskets.length ? decision.baskets.map((p) => p.name).slice(0, 3).join(', ') : null, decision.baskets.length ? `${fmtNum(decision.basketQty)} unidade(s) · ${brl(decision.basketRevenue)}` : null, 'gold'),
      insight('Produtos sem vendas', String(decision.productsWithoutSales), 'Itens do catálogo sem venda no período selecionado'),
    ]),
    decision.soldProducts.some((p) => p.qty > 0 && p.marginPct == null) && el('p', { class: 'pa-callout', text: 'Alguns produtos vendidos ainda não têm margem calculável. Complete os preços dos insumos e a ficha técnica da receita.' }),
  ].filter(Boolean));
}

function financeTitlePanel(ctx, direction) {
  const { store } = ctx;
  const requestedStatus = ctx.view.finStatus === 'parcial' ? 'aberto' : ctx.view.finStatus || 'aberto';
  const status = direction === 'pagar' && !['aberto', 'vencido', 'quitado', 'todos'].includes(requestedStatus) ? 'aberto' : requestedStatus;
  const receivePeriod = ctx.view.finReceivePeriod || 'all';
  const payPeriod = ctx.view.finPayPeriod || 'all';
  const selectedPeriod = direction === 'receber' ? receivePeriod : payPeriod;
  const start = selectedPeriod === 'all' ? '' : direction === 'receber' ? ctx.view.finReceiveStart || '' : ctx.view.finPayStart || '';
  const end = selectedPeriod === 'all' ? '' : direction === 'receber' ? ctx.view.finReceiveEnd || '' : ctx.view.finPayEnd || '';
  const receivedMethod = direction === 'receber' ? ctx.view.finMethod || '' : '';
  const parties = direction === 'receber' ? store.state.clients : store.state.suppliers;
  const partyMap = new Map(parties.map((p) => [p.id, { key: p.id, name: direction === 'receber' ? clientLabel(p) : p.name, sortName: p.name }]));
  for (const title of store.state.financeTitles.filter((t) => t.direction === direction && t.partyName)) {
    const origin = direction === 'receber' && title.partyType === 'origem';
    const key = origin ? `origin:${norm(title.partyName)}` : title.partyId || `name:${norm(title.partyName)}`;
    if (!partyMap.has(key)) partyMap.set(key, { key, name: origin ? `Origem: ${title.partyName}` : title.partyName, sortName: title.partyName });
  }
  const partyChoices = [...partyMap.values()].sort((a, b) => comparePtNames(a.sortName, b.sortName));
  const personKey = (title) => title.partyType === 'origem' ? `origin:${norm(title.partyName || 'Sem origem')}` : `name:${norm(store.get('clients', title.partyId)?.name || title.partyName || 'Sem cliente')}`;
  const financeCategoryMap = new Map();
  if (direction === 'pagar') for (const title of store.state.financeTitles.filter((t) => t.direction === 'pagar' && !t.cancelledAt)) {
    const category = title.categoryId ? store.get('categories', canonicalCategoryId(store, title.categoryId)) : null;
    const name = category?.name || 'Sem categoria';
    const key = category?.id || '__sem_categoria__';
    if (!financeCategoryMap.has(key)) financeCategoryMap.set(key, { key, name });
  }
  const financeCategories = [...financeCategoryMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const selectedParty = partyChoices.some((p) => p.key === ctx.view.finPartyId) ? ctx.view.finPartyId : undefined;
  const selectedPersonKey = direction === 'receber' && selectedParty ? selectedParty.startsWith('name:') || selectedParty.startsWith('origin:') ? selectedParty : `name:${norm(store.get('clients', selectedParty)?.name || partyMap.get(selectedParty)?.name)}` : '';
  const selectedCategory = financeCategories.some((c) => c.key === ctx.view.finTitleCategory) ? ctx.view.finTitleCategory : '';
  let rows = listTitles(store, { direction, start: receivedMethod ? undefined : start, end: receivedMethod ? undefined : end, status });
  if (selectedCategory) rows = rows.filter((row) => {
    const category = row.title.categoryId ? store.get('categories', canonicalCategoryId(store, row.title.categoryId)) : null;
    return (category?.id || '__sem_categoria__') === selectedCategory;
  });
  if (direction === 'receber') rows = rows.filter((r) => !r.title.cancelledAt);
  const methodReceipts = (title) => titleSettlements(store, title).filter((s) => !['discount', 'credit', 'loss'].includes(s.kind) && norm(s.method) === norm(receivedMethod) && inDateRange(s.at, start, end));
  if (receivedMethod) rows = rows.map((r) => ({ ...r, methodPaid: methodReceipts(r.title).reduce((sum, s) => sum + (Number(s.amount) || 0), 0) })).filter((r) => r.methodPaid > 0.005);
  if (selectedParty) rows = rows.filter((r) => direction === 'receber' ? personKey(r.title) === selectedPersonKey : r.title.partyId === selectedParty || (!r.title.partyId && `name:${norm(r.title.partyName)}` === selectedParty));
  const total = rows.reduce((s, r) => s + (receivedMethod ? r.methodPaid : status === 'quitado' ? r.paid : status === 'perda' ? r.writtenOff : r.balance), 0);
  const currentClientBalance = direction === 'receber' ? listTitles(store, { direction: 'receber' }).filter((r) => !r.title.cancelledAt && (!selectedPersonKey || personKey(r.title) === selectedPersonKey)).reduce((sum, r) => sum + r.balance, 0) : 0;
  const filteredGroups = new Map();
  if (direction === 'receber' && status === 'todos' && receivePeriod === 'all' && !receivedMethod) {
    for (const client of store.state.clients) {
      const key = `name:${norm(client.name)}`;
      if (selectedPersonKey && key !== selectedPersonKey) continue;
      if (!filteredGroups.has(key)) filteredGroups.set(key, { key, name: client.name, kind: 'cliente', amount: 0, count: 0, date: '' });
    }
  }
  if (direction === 'receber') for (const row of rows) {
    const key = personKey(row.title);
    const group = filteredGroups.get(key) || { key, name: store.get('clients', row.title.partyId)?.name || row.title.partyName || 'Sem cliente', kind: row.title.partyType === 'origem' ? 'origem' : 'cliente', amount: 0, count: 0, date: '' };
    group.amount += receivedMethod ? row.methodPaid : status === 'quitado' ? row.paid : status === 'perda' ? row.writtenOff : row.balance;
    group.count++;
    const receiptDates = receivedMethod || status === 'quitado'
      ? titleSettlements(store, row.title).filter((s) => !['discount', 'credit', 'loss'].includes(s.kind) && (!receivedMethod || norm(s.method) === norm(receivedMethod)) && inDateRange(s.at, start, end)).map((s) => s.at).sort()
      : [];
    const date = receiptDates.length ? receiptDates[receiptDates.length - 1] : row.title.dueDate;
    if (date && (!group.date || (receivedMethod || status === 'quitado' ? date > group.date : date < group.date))) group.date = date;
    filteredGroups.set(key, group);
  }
  const filteredClients = [...filteredGroups.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'pt-BR'));
  const filteredClientList = direction === 'receber' && el('ul', { class: 'pa-list pa-rows', style: 'max-height:480px;overflow-y:auto', 'data-testid': 'fin-receber-client-balances' }, filteredClients.map((p) => el('li', {
    class: 'pa-row-item', 'data-search': p.name, 'data-testid': 'fin-receber-client-balance', role: 'button', tabindex: '0', onclick: () => ctx.actions.openClientStatement(p.key), onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); ctx.actions.openClientStatement(p.key); } },
  }, [el('div', { class: 'pa-grow' }, [el('div', { class: 'pa-row' }, [el('strong', { text: p.name }), p.kind === 'origem' && el('span', { class: 'pa-badge', text: 'Outra origem' })].filter(Boolean)), el('span', { class: 'pa-muted', text: p.date ? `${receivedMethod || status === 'quitado' ? 'Último recebimento' : 'Vencimento mais antigo'}: ${fmtDate(p.date)}${p.count > 1 ? ` · ${p.count} lançamentos` : ''}` : 'Sem lançamentos' })]),
    el('div', { class: 'pa-list-value' }, [el('span', { class: 'pa-muted', text: status === 'perda' ? 'Perda' : receivedMethod || status === 'quitado' ? 'Recebido' : 'Saldo' }), el('strong', { class: p.amount > 0.005 && status !== 'quitado' && !receivedMethod ? 'pa-bad' : '', text: brl(p.amount) })]), el('span', { class: 'pa-chev', text: '›' })])));
  const ul = el('ul', { class: 'pa-list pa-rows' }, rows.map((r) => el('li', { class: 'pa-row-item', 'data-search': `${r.title.partyName || ''} ${r.title.description}`, onclick: () => ctx.actions.openModal({ kind: 'finance-title-detail', id: r.title.id }) }, [
    el('div', { class: 'pa-grow' }, [el('div', { class: 'pa-enc-title' }, [el('strong', { text: r.title.partyName || r.title.description }), titleBadge(r.status)]), el('span', { class: 'pa-muted', text: `${fmtDate(r.title.dueDate)} · ${r.title.description}${r.overdueDays ? ` · ${r.overdueDays} dia(s) em atraso` : ''}` })]),
    el('div', { class: 'pa-list-value' }, [el('span', { class: 'pa-muted', text: receivedMethod ? `recebido por ${receivedMethod}` : r.status === 'perda' ? 'perda' : r.status === 'quitado' ? 'recebido/pago' : 'saldo' }), el('strong', { class: r.status === 'vencido' ? 'pa-bad' : '', text: brl(receivedMethod ? r.methodPaid : r.status === 'perda' ? r.writtenOff : r.status === 'quitado' ? r.paid : r.balance) })]), el('span', { class: 'pa-chev', text: '›' }),
  ])));
  const chip = (key, label) => el('button', { class: 'pa-chip' + (status === key ? ' pa-chip-on' : ''), onclick: () => ctx.actions.setFinanceView({ finStatus: key }) }, label);
  const partyFilter = direction === 'receber' ? (() => {
    const picker = el('div', { class: 'pa-cli-picker', 'data-testid': 'fin-receber-party' });
    const selected = partyChoices.find((p) => p.key === selectedParty);
    if (selected) {
      picker.append(el('div', { class: 'pa-cli-chip' }, [
        el('span', { class: 'pa-grow', text: selected.name }),
        el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Mostrar todos os clientes e origens', 'aria-label': 'Mostrar todos os clientes e origens', onclick: () => ctx.actions.setFinanceView({ finPartyId: '', finStatus: 'todos', finMethod: '', finReceivePeriod: 'all', finReceiveStart: '', finReceiveEnd: '' }) }, '✕'),
      ]));
    } else {
      const search = el('input', { class: 'pa-input pa-search', type: 'search', placeholder: 'Todos — digite cliente ou origem…', 'data-testid': 'fin-receber-party-search' });
      const suggestions = el('ul', { class: 'pa-list pa-tight pa-suggest', style: 'display:none;max-height:240px;overflow-y:auto' });
      search.addEventListener('input', () => {
        const query = norm(search.value);
        const all = query === 'todos' || query === 'todas' || query.startsWith('todos os clientes') || query.startsWith('todas as origens');
        const matches = all ? partyChoices : query ? partyChoices.filter((p) => norm(p.name).includes(query)).slice(0, 8) : [];
        const showAll = () => ctx.actions.setFinanceView({ finPartyId: '', finStatus: 'todos', finMethod: '', finReceivePeriod: 'all', finReceiveStart: '', finReceiveEnd: '' });
        const allOption = all ? [el('li', { class: 'pa-row-item', role: 'option', tabindex: '0', 'data-testid': 'fin-receber-party-all', onclick: showAll, onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showAll(); } } }, 'Todos os clientes e origens — mostrar totais')] : [];
        suggestions.replaceChildren(...allOption, ...matches.map((p) => el('li', { class: 'pa-row-item', role: 'option', tabindex: '0', 'data-testid': 'fin-receber-party-suggestion', onclick: () => ctx.actions.setFinanceView({ finPartyId: p.key }), onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); ctx.actions.setFinanceView({ finPartyId: p.key }); } } }, p.name)));
        suggestions.style.display = allOption.length || matches.length ? '' : 'none';
      });
      picker.append(search, suggestions);
    }
    return picker;
  })() : (() => {
    const picker = el('div', { class: 'pa-cli-picker', 'data-testid': 'fin-pagar-party' });
    const selected = partyChoices.find((p) => p.key === selectedParty);
    const showAll = () => ctx.actions.setFinanceView({ finPartyId: '' });
    if (selected) {
      picker.append(el('div', { class: 'pa-cli-chip' }, [
        el('span', { class: 'pa-grow', text: selected.name }),
        el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Mostrar todos os fornecedores', 'aria-label': 'Mostrar todos os fornecedores', onclick: showAll }, '✕'),
      ]));
    } else {
      const search = el('input', { class: 'pa-input pa-search', type: 'search', placeholder: 'Todos os fornecedores — digite um nome…', 'data-testid': 'fin-pagar-party-search' });
      const suggestions = el('ul', { class: 'pa-list pa-tight pa-suggest', role: 'listbox', style: 'display:none;max-height:240px;overflow-y:auto' });
      const selectParty = (key) => ctx.actions.setFinanceView({ finPartyId: key });
      const option = (label, key, testid) => el('li', { class: 'pa-row-item', role: 'option', tabindex: '0', 'data-testid': testid, onclick: () => selectParty(key), onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectParty(key); } } }, label);
      const update = () => {
        const query = norm(search.value);
        const all = !query || query === 'todos' || query === 'todas' || query.startsWith('todos os fornecedores');
        const matches = all ? [] : partyChoices.filter((p) => norm(p.name).includes(query)).slice(0, 8);
        suggestions.replaceChildren(...(all ? [option('Todos os fornecedores', '', 'fin-pagar-party-all')] : []), ...matches.map((p) => option(p.name, p.key, 'fin-pagar-party-suggestion')));
        suggestions.style.display = all || matches.length ? '' : 'none';
      };
      search.addEventListener('focus', update);
      search.addEventListener('input', update);
      search.addEventListener('keydown', (event) => { if (event.key === 'Escape') suggestions.style.display = 'none'; });
      picker.append(search, suggestions);
    }
    return picker;
  })();
  const catFilter = direction === 'pagar' && el('select', { class: 'pa-input', 'data-testid': 'fin-pagar-category', onchange: (e) => ctx.actions.setFinanceView({ finTitleCategory: e.target.value }) }, [el('option', { value: '', text: 'Todas as categorias' }), ...financeCategories.map((c) => el('option', { value: c.key, text: c.name, ...(selectedCategory === c.key ? { selected: 'selected' } : {}) }))]);
  const methodNames = [...new Set([...paymentMethodNames(store), ...store.state.payments.filter((p) => !store.isReversed('payment', p.id)).map((p) => p.forma), ...store.state.financeSettlements.filter((s) => !store.isReversed('financeSettlement', s.id) && !['discount', 'credit', 'loss'].includes(s.kind)).map((s) => s.method), ...store.state.cashAdjustments.filter((a) => a.kind === 'client-payment' && !store.isReversed('cashAdjustment', a.id)).map((a) => a.method)].filter(Boolean))];
  const methodFilter = el('select', { class: 'pa-input', onchange: (e) => ctx.actions.setFinanceView({ finMethod: e.target.value, ...(e.target.value ? { finStatus: 'quitado' } : {}) }) }, [el('option', { value: '', text: 'Todas as formas' }), ...methodNames.map((m) => el('option', { value: m, text: m, ...(ctx.view.finMethod === m ? { selected: 'selected' } : {}) }))]);
  const headerActions = el('div', { class: 'pa-row pa-form' }, [
    direction === 'receber' && el('button', { class: 'pa-btn pa-sm', 'data-testid': 'fin-client-statement-open', onclick: () => ctx.actions.openClientStatement(selectedParty || '') }, selectedPersonKey.startsWith('origin:') ? 'Ficha da origem' : 'Ficha do cliente'),
    el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': `fin-${direction}-new`, onclick: () => ctx.actions.openModal({ kind: 'finance-title-add', direction }) }, direction === 'receber' ? '+ Nova entrada' : '+ Nova saída'),
  ].filter(Boolean));
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: direction === 'receber' ? 'Clientes e receitas' : 'Fornecedores e despesas' }), el('h2', { text: direction === 'receber' ? 'Contas a Receber' : 'Contas a Pagar' })]), headerActions]),
    el('p', { class: 'pa-hint', text: direction === 'receber' ? 'Vendas a prazo entram automaticamente. Cada cliente ou origem aparece uma vez, com o valor total do filtro. Clique no nome para ver os lançamentos e pagamentos.' : 'Registre vencimentos antes de pagar. Uma compra de insumos entra aqui somente quando você escolher criar a conta a pagar no lançamento.' }),
    el('div', { class: 'pa-chiprow' }, [
      el('button', { class: 'pa-chip' + (selectedPeriod === 'all' ? ' pa-chip-on' : ''), 'data-testid': `fin-${direction}-period-all`, onclick: () => ctx.actions.setFinanceView(direction === 'receber' ? { finReceivePeriod: 'all', finReceiveStart: '', finReceiveEnd: '' } : { finPayPeriod: 'all', finPayStart: '', finPayEnd: '' }) }, 'Período completo'),
      el('button', { class: 'pa-chip' + (selectedPeriod === 'custom' ? ' pa-chip-on' : ''), 'data-testid': `fin-${direction}-period-custom`, onclick: () => ctx.actions.setFinanceView(direction === 'receber' ? { finReceivePeriod: 'custom' } : { finPayPeriod: 'custom' }) }, 'Selecionar datas'),
    ]),
    selectedPeriod === 'custom' && periodFields(start, end, ({ start: s, end: e }) => ctx.actions.setFinanceView(direction === 'receber' ? { finReceiveStart: s, finReceiveEnd: e } : { finPayStart: s, finPayEnd: e }), `fin-${direction}`),
    selectedPeriod === 'custom' && !receivedMethod && el('p', { class: 'pa-hint', text: 'As datas limitam a lista aos títulos com vencimento no período escolhido.' }),
    receivedMethod && el('p', { class: 'pa-hint', text: `Mostrando recebimentos por ${receivedMethod} nas datas selecionadas. Para incluir contas ainda não quitadas, escolha “Em aberto” ou “Todos”.` }),
    el('div', { class: 'pa-filtergrid' }, [field(direction === 'receber' ? 'Cliente ou origem' : 'Fornecedor', partyFilter), direction === 'pagar' && field('Categoria', catFilter), direction === 'receber' && field('Forma recebida', methodFilter)].filter(Boolean)),
    direction === 'pagar' && el('p', { class: 'pa-hint', text: 'Em aberto inclui contas pendentes, parcialmente pagas e vencidas.' }),
    el('div', { class: 'pa-chiprow' }, [chip('aberto', 'Em aberto'), chip('vencido', 'Vencidos'), chip('quitado', 'Quitados'), direction === 'receber' && chip('perda', 'Perdas'), chip('todos', 'Todos')].filter(Boolean)),
    direction === 'receber' && (receivePeriod === 'custom' || status !== 'aberto' || receivedMethod) && el('p', { class: 'pa-hint', text: `Saldo em aberto em todo o histórico: ${brl(currentClientBalance)}. Esse valor não muda com os filtros de datas, situação ou forma recebida.` }),
    el('div', { class: 'pa-statgrid' }, [statCard(direction === 'receber' ? receivedMethod ? `Recebido por ${receivedMethod} no filtro` : status === 'perda' ? 'Perdas no filtro' : status === 'quitado' ? 'Recebido no filtro' : 'Saldo do filtro' : status === 'quitado' ? 'Total pago' : 'Saldo do filtro', brl(total), total && status !== 'quitado' && !receivedMethod ? 'warn' : 'ok')]),
    direction === 'receber' && el('h3', { class: 'pa-h3', text: `Clientes e origens no filtro (${filteredClients.length})` }),
    direction === 'receber' && (filteredClients.length ? el('div', {}, [!selectedParty && searchInput('Buscar na lista de clientes e origens…', filteredClientList, 'fin-receber-client-list-search'), filteredClientList].filter(Boolean)) : el('p', { class: 'pa-empty', text: 'Nenhum cliente ou origem com lançamentos neste filtro.' })),
    direction === 'pagar' && (rows.length ? ul : el('p', { class: 'pa-empty', text: 'Nenhum título com este filtro.' })),
  ]);
}
const financeReceivablePanel = (ctx) => financeTitlePanel(ctx, 'receber');
const financePayablePanel = (ctx) => financeTitlePanel(ctx, 'pagar');

function financeCommercialDocumentsPanel(ctx) {
  const company = ctx.store.getConfig().empresa || {};
  const missing = [!company.nome && 'nome', !company.cnpj && 'CNPJ', !company.telefone && 'telefone', !company.logo && 'logo'].filter(Boolean);
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Documentos comerciais' }), el('h2', { text: 'Recibo / Orçamento' })]),
    ]),
    el('p', { class: 'pa-hint', text: 'Gere documentos em PDF A4 para clientes cadastrados ou pessoas informadas somente no momento. Emitir o PDF não altera vendas, pagamentos nem o Fluxo de Caixa.' }),
    missing.length
      ? el('p', { class: 'pa-callout', text: `Complete em Ajustes os seguintes dados que ainda faltam no cabeçalho: ${missing.join(', ')}.` })
      : el('p', { class: 'pa-status', text: 'Dados e identidade da empresa prontos para os documentos.' }),
    el('div', { class: 'pa-actiongrid' }, [
      el('button', { class: 'pa-btn pa-primary', 'data-testid': 'commercial-budget-new', onclick: () => ctx.actions.openModal({ kind: 'commercial-document', type: 'orcamento' }) }, 'Novo orçamento'),
      el('button', { class: 'pa-btn', 'data-testid': 'commercial-receipt-new', onclick: () => ctx.actions.openModal({ kind: 'commercial-document', type: 'recibo' }) }, 'Novo recibo não fiscal'),
    ]),
    el('div', { class: 'pa-insight-grid' }, [
      el('section', { class: 'pa-insight pa-insight-teal' }, [el('span', { class: 'pa-eyebrow', text: 'Orçamento' }), el('strong', { text: 'Proposta para aprovação' }), el('span', { class: 'pa-muted', text: 'Itens, quantidades, preços, validade e condição de pagamento.' })]),
      el('section', { class: 'pa-insight pa-insight-gold' }, [el('span', { class: 'pa-eyebrow', text: 'Recibo não fiscal' }), el('strong', { text: 'Comprovante de pagamento' }), el('span', { class: 'pa-muted', text: 'Valor total, valor pago, saldo a pagar e forma ou condição de pagamento.' })]),
    ]),
  ]);
}

function commercialDefaultValidity() {
  const d = new Date(); d.setDate(d.getDate() + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

MODALS['commercial-document'] = (ctx, modal) => commercialDocumentSheet(ctx, modal);

function commercialDocumentSheet(ctx, modal = {}) {
  const { store } = ctx;
  const order = modal.orderId ? store.get('encomendas', modal.orderId) : null;
  const initialType = modal.type === 'recibo' ? 'recibo' : 'orcamento';
  const initialClientId = modal.clientId || order?.clienteId || '';
  const clients = store.state.clients.slice().sort(compareNamed);
  const type = el('select', { class: 'pa-input', 'data-testid': 'commercial-type' }, [
    el('option', { value: 'orcamento', text: 'Orçamento', ...(initialType === 'orcamento' ? { selected: 'selected' } : {}) }),
    el('option', { value: 'recibo', text: 'Recibo não fiscal', ...(initialType === 'recibo' ? { selected: 'selected' } : {}) }),
  ]);
  const date = el('input', { class: 'pa-input', 'data-testid': 'commercial-date', type: 'date', value: todayInput() });
  const validity = el('input', { class: 'pa-input', 'data-testid': 'commercial-validity', type: 'date', value: commercialDefaultValidity() });
  const client = el('select', { class: 'pa-input', 'data-testid': 'commercial-client' }, [
    el('option', { value: '', text: 'Pessoa não cadastrada' }),
    ...clients.map((c) => el('option', { value: c.id, text: `${clientLabel(c)}${c.inactive ? ' (inativo)' : ''}`, ...(c.id === initialClientId ? { selected: 'selected' } : {}) })),
  ]);
  const manualName = el('input', { class: 'pa-input', 'data-testid': 'commercial-client-name', type: 'text', placeholder: 'Nome da pessoa', value: modal.clientName || order?.customerName || '' });
  const manualPhone = el('input', { class: 'pa-input', 'data-testid': 'commercial-client-phone', type: 'tel', placeholder: 'Telefone (opcional)' });
  const manualAddress = el('input', { class: 'pa-input', 'data-testid': 'commercial-client-address', type: 'text', placeholder: 'Endereço (opcional)' });
  const manualFields = el('div', { class: 'pa-filtergrid' }, [field('Nome', manualName), field('Telefone', manualPhone), field('Endereço', manualAddress)]);
  const registeredInfo = el('p', { class: 'pa-sheet-msg' });
  const itemsBox = el('div', { 'data-testid': 'commercial-items' });
  const totalPreview = el('div', { class: 'pa-statgrid', 'data-testid': 'commercial-totals' });
  const paid = moneyField(order ? Math.min(Number(order.total) || 0, Math.max(0, store.paidFor(order.id))) : 0, 'commercial-paid');
  const condition = el('input', { class: 'pa-input', 'data-testid': 'commercial-condition', type: 'text', placeholder: 'Ex.: Pix à vista ou 50% na encomenda e 50% na entrega' });
  const notes = el('textarea', { class: 'pa-input', 'data-testid': 'commercial-notes', rows: '3', placeholder: 'Observações adicionais (opcional)' });
  if (order?.notes) notes.value = order.notes;
  const receiptFields = el('div', {}, [field('Valor pago', paid)]);
  const budgetFields = el('div', {}, [field('Validade do orçamento', validity)]);
  const lines = [];
  const purchasePicker = el('div', { class: 'pa-detail-card', 'data-testid': 'commercial-purchases' });
  const selectedPurchaseIds = new Set(order ? [order.id] : []);

  const currentClient = () => client.value ? store.get('clients', client.value) : null;
  function renderClient() {
    const selected = currentClient();
    manualFields.style.display = selected ? 'none' : '';
    registeredInfo.style.display = selected ? '' : 'none';
    registeredInfo.textContent = selected ? [selected.name, selected.phone, selected.address].filter(Boolean).join(' · ') : '';
  }
  function documentTotal() {
    return lines.reduce((sum, line) => sum + (parseNum(line.qty.value) || 0) * (parseNum(line.price.input.value) || 0), 0);
  }
  function renderTotals() {
    const total = documentTotal(); const paidValue = Math.max(0, parseNum(paid.input.value) || 0); const balance = Math.max(0, total - paidValue);
    totalPreview.replaceChildren(
      statCard('Total do documento', brl(total), 'navy'),
      type.value === 'recibo' ? statCard('Valor pago', brl(paidValue), 'ok') : statCard('Validade', validity.value ? fmtDate(`${validity.value}T12:00:00`) : 'Não informada', 'soft'),
      type.value === 'recibo' ? statCard('A pagar', brl(balance), balance > 0.005 ? 'warn' : 'ok') : statCard('Situação', 'Orçamento', 'teal'),
    );
  }
  function renderType() {
    budgetFields.style.display = type.value === 'orcamento' ? '' : 'none';
    receiptFields.style.display = type.value === 'recibo' ? '' : 'none';
    renderTotals();
  }
  function addLine(seed = {}) {
    const seedProduct = seed.productId ? store.get('products', seed.productId) : null;
    const choices = store.state.products.filter((p) => productIsActive(p) || p.id === seed.productId).slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const product = el('select', { class: 'pa-input', 'data-testid': 'commercial-item-product' }, [
      el('option', { value: '', text: 'Outro item / descrição livre' }),
      ...choices.map((p) => el('option', { value: p.id, text: p.name, ...(p.id === seed.productId ? { selected: 'selected' } : {}) })),
    ]);
    const description = el('input', { class: 'pa-input', 'data-testid': 'commercial-item-name', type: 'text', placeholder: 'Descrição do item', value: seed.name || seedProduct?.name || '' });
    const qty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'commercial-item-qty', type: 'text', inputmode: 'decimal', value: String(seed.qty ?? 1).replace('.', ',') });
    const price = moneyField(seed.unitPrice ?? (seedProduct ? sellingPrice(store, seedProduct.id) : null), 'commercial-item-price');
    const line = { product, description, qty, price, row: null };
    const remove = el('button', { class: 'pa-btn pa-ghost pa-sm', type: 'button', onclick: () => { line.row.remove(); lines.splice(lines.indexOf(line), 1); if (!lines.length) addLine(); renderTotals(); } }, 'Remover item');
    line.row = el('section', { class: 'pa-detail-card' }, [
      field('Produto cadastrado (opcional)', product), field('Descrição', description),
      el('div', { class: 'pa-filtergrid' }, [field('Quantidade', qty), field('Valor unitário', price)]), remove,
    ]);
    product.addEventListener('change', () => {
      const selected = product.value ? store.get('products', product.value) : null;
      if (selected) { description.value = selected.name; price.input.value = fmtMoneyInput(sellingPrice(store, selected.id)); }
      renderTotals();
    });
    qty.addEventListener('input', renderTotals); price.input.addEventListener('input', renderTotals);
    lines.push(line); itemsBox.append(line.row); renderTotals();
  }

  const itemsOfOrder = (purchase) => {
    const gross = (purchase.itens || []).reduce((sum, item) => sum + orderItemGross(item), Number(purchase.frete) || 0);
    const factor = gross > 0 ? Math.max(0, Number(purchase.total) || 0) / gross : 1;
    const entries = (purchase.itens || []).map((item) => {
      const composition = bundleCompositionText(store, item); const qty = Number(item.qty) || 0;
      return { productId: item.productId, name: `${store.get('products', item.productId)?.name || '(produto removido)'}${composition ? ` (${composition})` : ''}`, qty, unitPrice: (qty > 0 ? orderItemGross(item) / qty : 0) * factor };
    });
    if (Number(purchase.frete) > 0) entries.push({ name: 'Frete / entrega', qty: 1, unitPrice: Number(purchase.frete) * factor });
    return entries;
  };
  const loadPurchases = () => {
    const purchases = store.state.encomendas.filter((purchase) => selectedPurchaseIds.has(purchase.id) && !purchase.desistenciaAt);
    lines.splice(0); itemsBox.replaceChildren();
    for (const purchase of purchases) for (const item of itemsOfOrder(purchase)) addLine(item);
    if (!lines.length) addLine();
    paid.input.value = fmtMoneyInput(Math.min(documentTotal(), purchases.reduce((sum, purchase) => sum + store.paidFor(purchase.id), 0)));
    renderTotals();
  };
  const renderPurchasePicker = () => {
    const purchases = store.state.encomendas.filter((purchase) => purchase.clienteId === client.value && !purchase.desistenciaAt)
      .slice().sort((a, b) => String(b.deliveryDate || b.at).localeCompare(String(a.deliveryDate || a.at)));
    purchasePicker.style.display = client.value && purchases.length ? '' : 'none';
    purchasePicker.replaceChildren(el('strong', { text: 'Usar compras da ficha do cliente' }),
      el('p', { class: 'pa-hint', text: 'Marque uma ou mais encomendas ou vendas rápidas. Os produtos e valores serão copiados para este recibo e poderão ser ajustados antes de imprimir.' }),
      ...purchases.map((purchase) => {
        const check = el('input', { type: 'checkbox', value: purchase.id, 'data-testid': 'commercial-purchase-check' }); check.checked = selectedPurchaseIds.has(purchase.id);
        check.addEventListener('change', () => { if (check.checked) selectedPurchaseIds.add(purchase.id); else selectedPurchaseIds.delete(purchase.id); });
        return el('label', { class: 'pa-check' }, [check, el('span', { text: `${fmtDate(purchase.deliveryDate || purchase.at)} · ${purchase.quickSale ? 'Venda rápida' : 'Encomenda'} · ${encomendaItemsResumo(store, purchase)} · ${brl(purchase.total)}` })]);
      }),
      el('button', { class: 'pa-btn pa-sm', type: 'button', 'data-testid': 'commercial-load-purchases', onclick: loadPurchases }, 'Carregar compras marcadas'));
  };
  if (order) itemsOfOrder(order).forEach(addLine); else addLine();
  client.addEventListener('change', () => { selectedPurchaseIds.clear(); renderClient(); renderPurchasePicker(); }); type.addEventListener('change', renderType);
  validity.addEventListener('change', renderTotals); paid.input.addEventListener('input', renderTotals);
  renderClient(); renderType(); renderPurchasePicker();

  async function generate(event) {
    const selected = currentClient(); const clientName = selected?.name || manualName.value.trim();
    if (!clientName) { window.alert('Informe o nome do cliente.'); manualName.focus(); return; }
    const documentItems = lines.map((line) => {
      const qtyValue = parseNum(line.qty.value); const unitPrice = parseNum(line.price.input.value);
      return { name: line.description.value.trim(), qty: qtyValue, unitPrice, total: (qtyValue || 0) * (unitPrice || 0) };
    });
    if (!documentItems.length || documentItems.some((item) => !item.name || !(item.qty > 0) || item.unitPrice == null || item.unitPrice < 0)) {
      window.alert('Confira a descrição, quantidade e valor de todos os itens.'); return;
    }
    const total = documentItems.reduce((sum, item) => sum + item.total, 0);
    const paidValue = type.value === 'recibo' ? (parseNum(paid.input.value) ?? 0) : 0;
    if (paidValue < 0 || paidValue > total + 0.005) { window.alert('O valor pago não pode ser negativo nem maior que o total.'); return; }
    const button = event?.currentTarget; const old = button?.textContent;
    if (button) { button.textContent = 'Gerando PDF…'; button.disabled = true; }
    try {
      const stamp = `${String(date.value || todayInput()).replaceAll('-', '')}-${String(Date.now()).slice(-6)}`;
      const prefix = type.value === 'orcamento' ? 'ORC' : 'REC';
      const spec = {
        type: type.value, numero: `${prefix}-${stamp}`, date: date.value || todayInput(), validUntil: type.value === 'orcamento' ? validity.value : undefined,
        clientName, clientPhone: selected?.phone || manualPhone.value.trim(), clientAddress: selected?.address || manualAddress.value.trim(),
        items: documentItems, total, paid: paidValue, balance: Math.max(0, total - paidValue), paymentCondition: condition.value.trim(), notes: notes.value.trim(),
        empresa: store.getConfig().empresa || {},
      };
      const safe = norm(clientName).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cliente';
      await savePdf(await generateCommercialDocumentPdf(spec), `${type.value}-${safe}-${date.value || todayInput()}.pdf`);
    } catch (error) { window.alert('Não foi possível gerar o documento: ' + ((error && error.message) || error)); }
    finally { if (button) { button.textContent = old; button.disabled = false; } }
  }

  return sheet({
    title: 'Gerar recibo / orçamento',
    rows: [
      el('p', { class: 'pa-hint', text: 'O documento não faz lançamento financeiro. Confira os dados antes de gerar o PDF.' }),
      el('div', { class: 'pa-filtergrid' }, [field('Tipo de documento', type), field('Data', date)]),
      field('Cliente', client), registeredInfo, manualFields, purchasePicker,
      el('h3', { class: 'pa-h3', text: 'Itens' }), itemsBox,
      el('button', { class: 'pa-btn pa-sm', 'data-testid': 'commercial-item-add', type: 'button', onclick: () => addLine() }, '+ Adicionar item'),
      budgetFields, receiptFields, field('Condição ou forma de pagamento', condition), field('Observações', notes), totalPreview,
    ],
    onSave: generate, saveTestid: 'commercial-pdf', saveLabel: 'Gerar PDF A4',
  });
}

MODALS['client-statement'] = (ctx, m) => clientStatementSheet(ctx, m);
MODALS['client-statement-payment'] = (ctx, m) => clientStatementPaymentSheet(ctx, m.clientId);

function clientStatementPaymentSheet(ctx, clientId) {
  const { store } = ctx; const client = store.get('clients', clientId);
  if (!client) return sheet({ title: 'Cliente não encontrado', rows: [] });
  const openTitles = store.state.financeTitles.filter((t) => t.direction === 'receber' && t.partyId === clientId && !t.cancelledAt)
    .map((title) => ({ title, balance: titleState(store, title).balance }))
    .filter((row) => row.balance > 0.005)
    .sort((a, b) => String(a.title.issuedAt || '').localeCompare(String(b.title.issuedAt || '')));
  const totalOpen = Math.round(openTitles.reduce((sum, row) => sum + row.balance, 0) * 100) / 100;
  const date = el('input', { class: 'pa-input', type: 'date', value: todayInput(), 'data-testid': 'client-payment-date' });
  const amount = moneyField(totalOpen || null, 'client-payment-amount');
  const discount = moneyField(null, 'client-payment-discount');
  const method = paymentMethodSelect(store, 'client-payment-method');
  const account = el('select', { class: 'pa-input', 'data-testid': 'client-payment-account' }, accountOptions(store).map((a) => el('option', { value: a.id, text: a.name })));
  const notes = el('input', { class: 'pa-input', type: 'text', placeholder: 'Observação (opcional)' });
  discount.input.addEventListener('input', () => {
    const value = Math.max(0, parseNum(discount.input.value) || 0);
    amount.input.value = fmtMoneyInput(Math.max(0, Math.round((totalOpen - value) * 100) / 100));
    discount.input.setCustomValidity(''); amount.input.setCustomValidity('');
  });
  amount.input.addEventListener('input', () => amount.input.setCustomValidity(''));
  function save() {
    const value = Math.round((parseNum(amount.input.value) || 0) * 100) / 100;
    const discountValue = Math.round(Math.max(0, parseNum(discount.input.value) || 0) * 100) / 100;
    if (value < 0 || (value <= 0 && discountValue <= 0)) { amount.input.focus(); return; }
    const latestOpen = store.state.financeTitles.filter((t) => t.direction === 'receber' && t.partyId === clientId && !t.cancelledAt)
      .map((title) => ({ title, balance: titleState(store, title).balance }))
      .filter((row) => row.balance > 0.005)
      .sort((a, b) => String(a.title.issuedAt || '').localeCompare(String(b.title.issuedAt || '')));
    const currentTotal = Math.round(latestOpen.reduce((sum, row) => sum + row.balance, 0) * 100) / 100;
    if (discountValue > currentTotal + 0.005) {
      discount.input.setCustomValidity('O desconto não pode ultrapassar o saldo total em aberto.'); discount.input.reportValidity(); return;
    }
    const due = Math.max(0, Math.round((currentTotal - discountValue) * 100) / 100);
    if (value + 0.005 < due) {
      amount.input.setCustomValidity(`Para quitar todas as faturas com esse desconto, informe pelo menos ${brl(due)}. Para uma fatura, use “Quitar esta fatura” na ficha.`);
      amount.input.reportValidity(); return;
    }
    const at = dateIso(date.value);
    ctx.actions.mutate((s) => {
      const paymentId = uuid();
      const creditAmount = Math.max(0, Math.round((value - due) * 100) / 100);
      if (value > 0) s.addCashAdjustment({ id: paymentId, at, kind: 'client-payment', direction: 'entrada', clientId, amount: value, creditAmount, method: method.value, accountId: account.value || undefined, description: notes.value.trim() || `Pagamento total de ${clientLabel(client)}` });
      let remainingDiscount = discountValue;
      for (const row of latestOpen) {
        const granted = Math.min(Math.round(row.balance * 100) / 100, remainingDiscount);
        remainingDiscount = Math.round((remainingDiscount - granted) * 100) / 100;
        if (granted > 0) s.addFinanceSettlement({ id: uuid(), at, titleId: row.title.id, amount: granted, kind: 'discount', notes: notes.value.trim() || 'Desconto na quitação total do cliente' });
        const allocated = Math.round((row.balance - granted) * 100) / 100;
        if (allocated > 0) s.addFinanceSettlement({ id: uuid(), at, titleId: row.title.id, amount: allocated, kind: 'client-payment-allocation', paymentId, method: method.value, notes: 'Quitação pelo pagamento total do cliente' });
      }
    });
    if (ctx.view.tab !== 'fin-ficha') ctx.actions.openModal({ kind: 'client-statement', clientId });
  }
  return sheet({ title: 'Registrar pagamento total', rows: [el('p', { class: 'pa-hint', text: `Cliente: ${clientLabel(client)}. Quite todas as faturas com um único recebimento. O desconto é aplicado primeiro às faturas mais antigas; o valor pago a mais vira crédito para a próxima compra.` }), el('div', { class: 'pa-callout' }, [el('span', { text: 'Total em aberto: ' }), el('strong', { text: brl(totalOpen) })]), field('Data', date), field('Desconto total concedido (opcional)', discount), field('Valor recebido de fato', amount), el('p', { class: 'pa-hint', text: 'Só o valor recebido entra no caixa. O desconto aparece na ficha do cliente e reduz a receita na DRE do período da concessão.' }), field('Forma', method), field('Conta financeira', account), field('Observação', notes)], onSave: save, saveTestid: 'client-payment-save' });
}

function financeClientStatementPanel(ctx) {
  return clientStatementSheet(ctx, { clientId: ctx.view.finStatementClientId }, true);
}

function clientStatementSheet(ctx, modal = {}, inline = false) {
  const { store } = ctx;
  let clientId = '';
  const statementView = (rows) => inline ? el('section', { class: 'pa-card', 'data-testid': 'fin-client-statement-panel' }, [
    el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Clientes e receitas' }), el('h2', { text: clientId.startsWith('origin:') ? 'Ficha da origem' : 'Ficha do cliente' })]), el('button', { class: 'pa-btn pa-sm', onclick: () => ctx.actions.setTab('fin-receber') }, '← Contas a receber')]),
    ...rows,
  ]) : sheet({ title: clientId.startsWith('origin:') ? 'Ficha financeira da origem' : 'Ficha financeira do cliente', rows });
  const clients = store.state.clients.slice().sort(compareNamed);
  const namedParties = [...new Map(store.state.financeTitles.filter((t) => t.direction === 'receber' && t.partyType !== 'origem' && t.partyName && !t.cancelledAt && (!t.partyId || !store.get('clients', t.partyId))).map((t) => [`name:${norm(t.partyName)}`, t.partyName])).entries()]
    .filter(([key]) => !clients.some((c) => `name:${norm(c.name)}` === key))
    .map(([id, name]) => ({ id, name }));
  const originParties = [...new Map(store.state.financeTitles.filter((t) => t.direction === 'receber' && t.partyType === 'origem' && t.partyName && !t.cancelledAt).map((t) => [`origin:${norm(t.partyName)}`, t.partyName])).entries()]
    .map(([id, name]) => ({ id, name }));
  if (!clients.length && !namedParties.length && !originParties.length) return statementView([el('p', { class: 'pa-empty', text: 'Cadastre um cliente ou lance uma entrada para consultar a ficha financeira.' })]);

  const hasNamedParty = (id) => String(id || '').startsWith('name:') && (clients.some((c) => `name:${norm(c.name)}` === id) || namedParties.some((p) => p.id === id));
  clientId = clients.some((c) => c.id === modal.clientId) || hasNamedParty(modal.clientId) || originParties.some((p) => p.id === modal.clientId) ? modal.clientId : '';
  const registeredClientIds = () => clientId.startsWith('origin:') ? [] : clientId.startsWith('name:') ? clients.filter((c) => `name:${norm(c.name)}` === clientId).map((c) => c.id) : clientId ? [clientId] : [];
  const clientPicker = el('div', { class: 'pa-cli-picker', 'data-testid': 'client-statement-client' });
  const mode = el('select', { class: 'pa-input', 'data-testid': 'client-statement-mode' }, [el('option', { value: 'geral', text: 'Geral — todo o histórico' }), el('option', { value: 'periodo', text: 'Período específico' })]);
  const start = el('input', { class: 'pa-input', 'data-testid': 'client-statement-start', type: 'date', value: ctx.view.finStart || '' });
  const end = el('input', { class: 'pa-input', 'data-testid': 'client-statement-end', type: 'date', value: ctx.view.finEnd || '' });
  const period = el('div', { class: 'pa-period', 'data-testid': 'client-statement-period', style: 'display:none' }, [field('Data inicial', start), el('span', { class: 'pa-period-arrow', text: 'até' }), field('Data final', end)]);
  const preview = el('div', { 'data-testid': 'client-statement-preview' });
  const print = el('button', { class: 'pa-btn pa-primary pa-grow', 'data-testid': 'client-statement-pdf' }, 'Imprimir Extrato do cliente');

  const currentStatement = () => clientFinancialStatement(store, clientId, mode.value === 'periodo' ? start.value : '', mode.value === 'periodo' ? end.value : '');
  const movementRow = (row) => {
    const purchase = row.type === 'purchase'; const charge = row.type === 'charge'; const payment = row.type === 'payment'; const discountRow = row.type === 'discount'; const creditRow = row.type === 'credit-application'; const lossRow = row.type === 'loss';
    return el('section', { class: 'pa-detail-card', 'data-testid': `client-statement-${row.type}` }, [
      el('div', { class: 'pa-row' }, [
        el('div', { class: 'pa-grow' }, [el('strong', { text: payment ? 'Pagamento' : discountRow ? 'Desconto na quitação' : creditRow ? 'Crédito utilizado' : lossRow ? 'Perda registrada' : purchase ? row.description : 'Valor a receber' }), el('span', { class: 'pa-muted', text: fmtDate(row.at) })]),
        el('strong', { class: payment ? 'pa-positive' : discountRow || creditRow || lossRow ? 'pa-warn' : 'pa-num', text: `${payment ? '+ ' : discountRow || creditRow || lossRow ? '− ' : ''}${brl(row.amount)}` }),
      ]),
      purchase && el('ul', { class: 'pa-list pa-tight' }, row.items.map((item) => el('li', { class: 'pa-list-item' }, [
        el('span', { class: 'pa-grow', text: `${fmtNum(item.qty)}× ${item.name}` }),
        el('span', { class: 'pa-muted', text: `${brl(item.unitPrice)} cada` }),
        el('strong', { class: 'pa-num', text: brl(item.total) }),
      ]))),
      purchase && el('p', { class: 'pa-muted', text: [`Entrega: ${row.deliveryMethod === 'motoboy' ? 'Motoboy' : 'Retirada'}`, row.freight > 0 && `Frete ${brl(row.freight)}`, row.notes && `Obs.: ${row.notes}`].filter(Boolean).join(' · ') }),
      purchase && row.discount > 0 && el('p', { class: 'pa-badge pa-ok', text: `Desconto da venda: ${brl(row.discount)}` }),
      !purchase && el('p', { class: 'pa-muted', text: `${row.description}${payment && row.method ? ` · ${row.method}` : ''}` }),
      payment && row.id.startsWith('payment:') && !store.isReversed('payment', row.id.slice(8)) && el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => {
        const title = store.state.financeTitles.find((entry) => entry.sourceType === 'encomenda' && entry.sourceId === row.orderId);
        if (title) ctx.actions.openModal({ kind: 'finance-settlement-edit', titleId: title.id, settlementId: row.id.slice(8), settlementKind: 'payment' });
      } }, 'Corrigir pagamento'),
      (purchase || charge) && el('div', { class: 'pa-row' }, [
        el('span', { class: 'pa-muted pa-grow', text: `Recebido ${brl(row.paid)}` }),
        row.discounted > 0.005 && el('span', { class: 'pa-muted', text: `Desconto ${brl(row.discounted)}` }),
        row.credited > 0.005 && el('span', { class: 'pa-muted', text: `Crédito usado ${brl(row.credited)}` }),
        row.writtenOff > 0.005 && el('span', { class: 'pa-muted', text: `Perda ${brl(row.writtenOff)}` }),
        el('span', { class: row.balance > 0.005 ? 'pa-badge pa-warn' : row.writtenOff > 0.005 ? 'pa-badge pa-bad' : 'pa-badge pa-ok', text: row.balance > 0.005 ? `em aberto ${brl(row.balance)}` : row.writtenOff > 0.005 ? 'baixa por perda' : 'quitado' }),
        row.titleId && row.balance > 0.005 && el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'client-statement-settle-title', onclick: () => ctx.actions.openModal({ kind: 'finance-settle', id: row.titleId, fullOnly: true }) }, 'Quitar esta fatura'),
        row.titleId && row.balance > 0.005 && el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'client-statement-loss-title', onclick: () => ctx.actions.openModal({ kind: 'finance-title-loss', id: row.titleId }) }, 'Registrar como perda'),
        row.orderId && row.clientId && el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'client-statement-order-receipt', onclick: () => ctx.actions.openModal({ kind: 'commercial-document', type: 'recibo', clientId: row.clientId, orderId: row.orderId }) }, 'Gerar recibo'),
        row.orderId && el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'client-statement-open-order', onclick: () => ctx.actions.openModal({ kind: 'encomenda-edit', id: row.orderId }) }, 'Abrir encomenda'),
        row.titleId && el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'client-statement-open-title', onclick: () => ctx.actions.openModal({ kind: 'finance-title-detail', id: row.titleId }) }, 'Abrir lançamento'),
      ].filter(Boolean)),
    ].filter(Boolean));
  };
  function renderStatement() {
    details.style.display = clientId ? '' : 'none';
    if (!clientId) return;
    const actionClientIds = registeredClientIds();
    payment.style.display = actionClientIds.length === 1 ? '' : 'none';
    receipt.style.display = actionClientIds.length === 1 ? '' : 'none';
    period.style.display = mode.value === 'periodo' ? '' : 'none';
    const statement = currentStatement();
    const label = mode.value === 'periodo' ? 'no período' : 'no histórico geral';
    preview.replaceChildren(
      el('div', { class: 'pa-statgrid' }, [statCard(`${statement.isOrigin ? 'Lançamentos' : 'Compras'} ${label}`, brl(statement.periodPurchases), 'navy'), statCard(`Pagamentos ${label}`, brl(statement.periodPayments), 'ok'), statement.periodLosses > 0.005 && statCard(`Perdas ${label}`, brl(statement.periodLosses), 'bad'), statCard('Saldo atual', brl(statement.currentBalance), statement.currentBalance > 0.005 ? 'bad' : 'ok'), !statement.isOrigin && statCard('Crédito disponível', brl(statement.creditBalance), 'ok')].filter(Boolean)),
      el('p', { class: 'pa-hint', text: statement.isOrigin ? 'O saldo atual considera todo o histórico, mesmo quando a visualização está limitada a um período.' : 'O saldo atual e o crédito disponível consideram todo o histórico, mesmo quando a visualização está limitada a um período.' }),
      statement.movements.length ? el('div', {}, statement.movements.slice().reverse().map(movementRow)) : el('p', { class: 'pa-empty', text: statement.isOrigin ? 'Nenhum lançamento ou pagamento com este filtro.' : 'Nenhuma compra ou pagamento com este filtro.' }),
    );
  }
  function renderClientPicker() {
    const selected = clientId && (store.get('clients', clientId) || (clientId.startsWith('origin:') ? { name: `Origem: ${originParties.find((p) => p.id === clientId)?.name || clientId.slice(7)}` } : clientId.startsWith('name:') ? { name: clients.find((c) => `name:${norm(c.name)}` === clientId)?.name || namedParties.find((p) => p.id === clientId)?.name || clientId.slice(5) } : null));
    if (selected) {
      clientPicker.replaceChildren(el('div', { class: 'pa-cli-chip' }, [el('span', { class: 'pa-grow', text: clientLabel(selected) }), el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Trocar cliente ou origem', onclick: () => { if (inline) ctx.actions.setFinanceView({ finStatementClientId: '' }); else { clientId = ''; preview.replaceChildren(); renderClientPicker(); renderStatement(); } } }, '✕')]));
      return;
    }
    const search = el('input', { class: 'pa-input pa-search', type: 'search', placeholder: 'Digite cliente ou origem…', 'data-testid': 'client-statement-search' });
    const results = el('ul', { class: 'pa-list pa-tight pa-suggest', style: 'display:none' });
    search.addEventListener('input', () => {
      const query = norm(search.value);
      const matches = query ? [...clients.filter((c) => norm(clientSearchText(c)).includes(query)), ...namedParties.filter((p) => norm(p.name).includes(query)), ...originParties.filter((p) => norm(p.name).includes(query))].sort(compareNamed).slice(0, 8) : [];
      results.style.display = matches.length ? '' : 'none';
      results.replaceChildren(...matches.map((c) => el('li', { class: 'pa-row-item', 'data-testid': 'client-statement-suggestion', onclick: () => { if (inline) ctx.actions.setFinanceView({ finStatementClientId: c.id }); else { clientId = c.id; renderClientPicker(); renderStatement(); } } }, c.id.startsWith('origin:') ? `Origem: ${c.name}` : clientLabel(c))));
    });
    clientPicker.replaceChildren(search, results);
  }
  mode.addEventListener('change', renderStatement); start.addEventListener('change', renderStatement); end.addEventListener('change', renderStatement);
  print.addEventListener('click', async () => {
    const statement = currentStatement(); const original = print.textContent; print.textContent = 'Gerando PDF…'; print.disabled = true;
    try {
      const safe = norm(statement.client?.name || 'cliente').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cliente';
      const suffix = statement.start || statement.end ? `${statement.start || 'inicio'}-${statement.end || 'hoje'}` : 'geral';
      await savePdf(await generateClientStatementPdf(statement), `ficha-financeira-${safe}-${suffix}.pdf`);
    } catch (error) { window.alert('Não foi possível gerar a ficha financeira: ' + ((error && error.message) || error)); }
    finally { print.textContent = original; print.disabled = false; }
  });
  const receipt = el('button', { class: 'pa-btn pa-grow', 'data-testid': 'client-statement-receipt', onclick: () => ctx.actions.openModal({ kind: 'commercial-document', type: 'recibo', clientId: registeredClientIds()[0] }) }, 'Novo recibo para o cliente');
  const payment = el('button', { class: 'pa-btn pa-grow', 'data-testid': 'client-statement-add-payment', onclick: () => ctx.actions.openModal({ kind: 'client-statement-payment', clientId: registeredClientIds()[0] }) }, 'Registrar pagamento total');
  const details = el('div', {}, [field('Visualização', mode), period, preview, el('div', { class: 'pa-sheet-actions' }, [payment, receipt, print])]);
  renderClientPicker();
  renderStatement();
  return statementView([el('p', { class: 'pa-hint', text: 'Busque um cliente ou uma origem para consultar os lançamentos e pagamentos.' }), field('Cliente ou origem', clientPicker), details]);
}

function financeClientPicker(store, initialId = '', testid = 'fin-title-client') {
  const clients = store.state.clients.filter((client) => !client.inactive || client.id === initialId)
    .sort(compareNamed);
  let clientId = clients.some((client) => client.id === initialId) ? initialId : '';
  const picker = el('div', { class: 'pa-cli-picker', 'data-testid': testid });
  const render = () => {
    const selected = clients.find((client) => client.id === clientId);
    if (selected) {
      picker.replaceChildren(el('div', { class: 'pa-cli-chip' }, [
        el('span', { class: 'pa-grow', text: clientLabel(selected) }),
        el('button', { class: 'pa-btn pa-ghost pa-sm', type: 'button', title: 'Trocar cliente', 'aria-label': 'Trocar cliente', onclick: () => { clientId = ''; render(); } }, '✕'),
      ]));
      return;
    }
    const search = el('input', { class: 'pa-input pa-search', type: 'search', placeholder: 'Digite o nome do cliente…', 'data-testid': `${testid}-search` });
    const suggestions = el('ul', { class: 'pa-list pa-tight pa-suggest', role: 'listbox', style: 'display:none;max-height:240px;overflow-y:auto' });
    search.addEventListener('input', () => {
      const query = norm(search.value);
      const matches = query ? clients.filter((client) => norm(clientSearchText(client)).includes(query)).slice(0, 8) : [];
      suggestions.replaceChildren(...matches.map((client) => el('li', { class: 'pa-row-item', role: 'option', tabindex: '0', 'data-testid': `${testid}-suggestion`, onclick: () => { clientId = client.id; render(); }, onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); clientId = client.id; render(); } } }, clientLabel(client))));
      suggestions.style.display = matches.length ? '' : 'none';
    });
    picker.replaceChildren(search, suggestions);
  };
  render();
  return { element: picker, selected: () => clients.find((client) => client.id === clientId), focus: () => picker.querySelector('input')?.focus() };
}

MODALS['finance-title-add'] = (ctx, m) => financeTitleAddSheet(ctx, m.direction || 'pagar');
function financeTitleAddSheet(ctx, direction) {
  const { store } = ctx; const isReceive = direction === 'receber';
  const issue = el('input', { class: 'pa-input', type: 'date', value: todayInput(), 'data-testid': 'fin-title-issue' }); const due = el('input', { class: 'pa-input', type: 'date', value: todayInput(), 'data-testid': 'fin-title-due' });
  const suppliers = store.state.suppliers.filter((s) => !s.archived);
  const supplier = el('select', { class: 'pa-input', 'data-testid': 'fin-title-party' }, [el('option', { value: '', text: 'Sem fornecedor / outro' }), ...suppliers.map((p) => el('option', { value: p.id, text: p.name }))]);
  const sourceType = el('select', { class: 'pa-input', 'data-testid': 'fin-title-source-type' }, [el('option', { value: 'cliente', text: 'Cliente cadastrado' }), el('option', { value: 'origem', text: 'Outra origem' })]);
  const clientPicker = financeClientPicker(store);
  const originName = el('input', { class: 'pa-input', type: 'text', placeholder: 'Ex.: feira, curso, parceria', 'data-testid': 'fin-title-origin-name' });
  const sourceFields = el('div', {}, [field('Cliente', clientPicker.element), el('p', { class: 'pa-hint', text: 'Digite o nome e escolha uma sugestão para vincular ao cadastro.' })]);
  const originFields = el('div', { style: 'display:none' }, [field('Nome da origem', originName), el('p', { class: 'pa-hint', text: 'Identifique de onde virá o valor. Esta entrada ficará separada das fichas de clientes.' })]);
  const sourceError = el('p', { class: 'pa-sheet-msg', role: 'alert' });
  sourceType.addEventListener('change', () => {
    sourceError.textContent = '';
    sourceFields.style.display = sourceType.value === 'cliente' ? '' : 'none';
    originFields.style.display = sourceType.value === 'origem' ? '' : 'none';
  });
  const description = el('input', { class: 'pa-input', type: 'text', placeholder: isReceive ? 'Ex.: encomenda especial' : 'Ex.: conta de energia', 'data-testid': 'fin-title-desc' }); const amount = moneyField(null, 'fin-title-amount');
  const preferredCategory = categoryByKey(store, isReceive ? 'outras-receitas' : 'outras-despesas');
  const preferred = preferredCategory?.archived ? null : preferredCategory;
  const categories = activeFinanceCategories(store, direction, preferred?.id);
  const category = el('select', { class: 'pa-input', 'data-testid': 'fin-title-category' }, categories.map((c) => el('option', { value: c.id, text: `${c.code || ''} ${c.name}`.trim(), ...(preferred?.id === c.id ? { selected: 'selected' } : {}) })));
  const situation = el('select', { class: 'pa-input', 'data-testid': 'fin-title-situation' }, [el('option', { value: 'pendente', text: isReceive ? 'Ainda não recebi' : 'Ainda não paguei' }), el('option', { value: 'quitado', text: isReceive ? 'Já foi recebido' : 'Já foi pago' })]);
  const method = paymentMethodSelect(store, 'fin-title-method');
  const account = el('select', { class: 'pa-input', 'data-testid': 'fin-title-account' }, accountOptions(store).map((a) => el('option', { value: a.id, text: a.name }))); const notes = el('textarea', { class: 'pa-input', rows: '2', placeholder: 'Observações (opcional)' });
  function save() {
    sourceError.textContent = '';
    const value = parseNum(amount.input.value); if (!(value > 0)) { amount.input.focus(); return; }
    const client = isReceive && sourceType.value === 'cliente' ? clientPicker.selected() : null;
    const otherOrigin = isReceive && sourceType.value === 'origem' ? originName.value.trim() : '';
    if (isReceive && sourceType.value === 'cliente' && !client) { sourceError.textContent = 'Digite o nome e selecione um cliente sugerido.'; clientPicker.focus(); return; }
    if (isReceive && sourceType.value === 'origem' && !otherOrigin) { sourceError.textContent = 'Informe o nome da origem desta entrada.'; originName.focus(); return; }
    const selectedSupplier = !isReceive ? suppliers.find((p) => p.id === supplier.value) : null;
    const id = uuid();
    ctx.actions.mutate((s) => {
      s.upsertFinanceTitle({ id, direction, issuedAt: dateIso(issue.value), competenceDate: dateIso(issue.value), dueDate: dateIso(due.value), amount: value, description: description.value.trim() || (isReceive ? 'Receita manual' : 'Conta manual'), categoryId: category.value || undefined, partyType: isReceive ? sourceType.value : 'fornecedor', partyId: client?.id || selectedSupplier?.id, partyName: client?.name || otherOrigin || selectedSupplier?.name || 'Outro fornecedor', expectedMethod: method.value, sourceType: 'manual', notes: notes.value.trim() || undefined });
      if (situation.value === 'quitado') s.addFinanceSettlement({ id: uuid(), at: dateIso(issue.value), titleId: id, amount: value, method: method.value, accountId: account.value || undefined });
    });
  }
  return sheet({ title: isReceive ? 'Nova entrada' : 'Nova saída', rows: [el('p', { class: 'pa-hint', text: isReceive ? 'Escolha se o valor vem de um cliente cadastrado ou de outra origem. Depois registre a situação da entrada.' : 'Registre uma saída já paga ou uma conta que ainda será paga.' }), field('Data do lançamento', issue), field('Vencimento', due), isReceive ? field('Origem da entrada', sourceType) : field('Fornecedor / destino', supplier), isReceive && sourceFields, isReceive && originFields, isReceive && sourceError, field('Descrição', description), field('Valor', amount), field('Categoria do plano de contas', category), field('Situação', situation), field('Forma de pagamento', method), field('Conta financeira', account), field('Observações', notes)].filter(Boolean), onSave: save, saveTestid: 'fin-title-save' });
}

MODALS['finance-title-detail'] = (ctx, m) => financeTitleDetailSheet(ctx, m.id);
function financeTitleDetailSheet(ctx, id) {
  const title = ctx.store.get('financeTitles', id); if (!title) return sheet({ title: 'Título não encontrado', rows: [] }); const state = titleState(ctx.store, title); const settlements = titleSettlements(ctx.store, title); const cat = title.categoryId ? ctx.store.get('categories', title.categoryId) : null;
  const history = settlements.length ? el('ul', { class: 'pa-list pa-tight' }, settlements.slice().sort((a, b) => a.at < b.at ? 1 : -1).map((s) => {
    const correctionKind = s.legacyKind === 'payment' ? 'payment' : ctx.store.get('financeSettlements', s.id) ? 'financeSettlement' : null;
    const isDiscount = s.kind === 'discount'; const isCredit = s.kind === 'credit'; const isLoss = s.kind === 'loss'; const isAllocation = s.kind === 'client-payment-allocation';
    return el('li', { class: 'pa-list-item' }, [el('div', { class: 'pa-grow' }, [el('strong', { text: fmtDate(s.at) }), el('span', { class: 'pa-muted', text: isDiscount ? 'Desconto concedido na quitação' : isCredit ? 'Crédito do cliente utilizado' : isLoss ? 'Baixa por perda, sem entrada no caixa' : isAllocation ? 'Quitação pelo pagamento total do cliente' : (s.method || 'Forma não informada') })]), el('strong', { class: isDiscount || isCredit || isLoss ? 'pa-warn' : 'pa-positive', text: brl(s.amount) }), isLoss && el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'fin-loss-reverse', onclick: () => ctx.actions.openModal({ kind: 'confirm', title: 'Estornar perda?', message: 'O valor voltará a ficar em aberto nesta fatura.', yesLabel: 'Estornar perda', onYes: () => ctx.actions.mutate((store) => store.addReversal({ id: uuid(), at: nowIso(), kind: 'financeSettlement', refId: s.id })) }) }, 'Estornar perda'), correctionKind && !isCredit && !isLoss && !isAllocation && el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'fin-settlement-edit', onclick: () => ctx.actions.openModal({ kind: 'finance-settlement-edit', titleId: title.id, settlementId: s.id, settlementKind: correctionKind }) }, 'Corrigir')].filter(Boolean));
  })) : el('p', { class: 'pa-empty', text: 'Nenhuma baixa registrada.' });
  const editAction = title.sourceType === 'manual' && !title.cancelledAt
    ? el('button', { class: 'pa-btn', 'data-testid': 'fin-title-edit', onclick: () => ctx.actions.openModal({ kind: 'finance-title-edit', id: title.id }) }, 'Editar valor e dados')
    : title.sourceType === 'encomenda' && title.sourceId
      ? el('button', { class: 'pa-btn', 'data-testid': 'fin-title-edit-order', onclick: () => ctx.actions.openModal({ kind: 'encomenda-edit', id: title.sourceId }) }, 'Editar encomenda')
      : null;
  const rows = [el('div', { class: 'pa-row' }, [el('strong', { class: 'pa-grow', text: title.partyName || title.description }), titleBadge(state.status)]), el('p', { class: 'pa-muted', text: title.description }), el('table', { class: 'pa-kv' }, [el('tr', {}, [el('td', { text: 'Emissão' }), el('td', { class: 'pa-num', text: fmtDate(title.issuedAt) })]), el('tr', {}, [el('td', { text: 'Vencimento' }), el('td', { class: 'pa-num', text: fmtDate(title.dueDate) })]), el('tr', {}, [el('td', { text: 'Categoria' }), el('td', { class: 'pa-num', text: cat?.name || 'Sem categoria' })]), el('tr', {}, [el('td', { text: 'Valor' }), el('td', { class: 'pa-num', text: brl(title.amount) })]), el('tr', {}, [el('td', { text: title.direction === 'receber' ? 'Recebido' : 'Pago' }), el('td', { class: 'pa-num', text: brl(state.paid) })]), state.discounted > 0.005 && el('tr', {}, [el('td', { text: 'Desconto na quitação' }), el('td', { class: 'pa-num', text: brl(state.discounted) })]), state.credited > 0.005 && el('tr', {}, [el('td', { text: 'Crédito utilizado' }), el('td', { class: 'pa-num', text: brl(state.credited) })]), state.writtenOff > 0.005 && el('tr', {}, [el('td', { text: 'Perda registrada' }), el('td', { class: 'pa-num', text: brl(state.writtenOff) })]), el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Saldo' }), el('td', { class: 'pa-num', text: brl(state.balance) })])].filter(Boolean)), editAction, state.balance > 0.005 && !title.cancelledAt && el('button', { class: 'pa-btn pa-primary', 'data-testid': 'fin-settle-open', onclick: () => ctx.actions.openModal({ kind: 'finance-settle', id: title.id, fullOnly: title.direction === 'receber' }) }, title.direction === 'receber' ? 'Quitar esta fatura' : 'Registrar pagamento'), title.direction === 'receber' && state.balance > 0.005 && !title.cancelledAt && el('button', { class: 'pa-btn', 'data-testid': 'fin-loss-open', onclick: () => ctx.actions.openModal({ kind: 'finance-title-loss', id: title.id }) }, 'Registrar como perda'), el('h3', { class: 'pa-h3', text: 'Histórico de baixas' }), history, title.sourceType && el('p', { class: 'pa-hint', text: `Origem: ${title.sourceType}. O vínculo evita lançamentos duplicados.` })].filter(Boolean);
  return sheet({ title: title.direction === 'receber' ? 'Detalhe a receber' : 'Detalhe a pagar', rows, danger: !title.cancelledAt && state.balance > 0.005 ? { label: 'Cancelar título', testid: 'fin-title-cancel', onClick: () => ctx.actions.openModal({ kind: 'confirm', title: 'Cancelar título?', message: 'O histórico e as baixas já realizadas serão preservados.', yesLabel: 'Cancelar título', onYes: () => ctx.actions.mutate((s) => s.upsertFinanceTitle({ ...title, cancelledAt: nowIso() })) }) } : null });
}

MODALS['finance-title-edit'] = (ctx, m) => financeTitleEditSheet(ctx, m.id);
function financeTitleEditSheet(ctx, id) {
  const title = ctx.store.get('financeTitles', id); if (!title) return sheet({ title: 'Lançamento não encontrado', rows: [] });
  const isReceive = title.direction === 'receber'; const state = titleState(ctx.store, title);
  const issue = el('input', { class: 'pa-input', type: 'date', value: dateOnly(title.issuedAt), 'data-testid': 'fin-edit-issue' });
  const due = el('input', { class: 'pa-input', type: 'date', value: dateOnly(title.dueDate), 'data-testid': 'fin-edit-due' });
  const suppliers = ctx.store.state.suppliers.filter((s) => !s.archived || s.id === title.partyId);
  const supplier = el('select', { class: 'pa-input', 'data-testid': 'fin-edit-party' }, [el('option', { value: '', text: 'Sem fornecedor / outro', ...(!title.partyId ? { selected: 'selected' } : {}) }), ...suppliers.map((p) => el('option', { value: p.id, text: p.name, ...(title.partyId === p.id ? { selected: 'selected' } : {}) }))]);
  const initialSourceType = title.partyType === 'origem' || !title.partyId ? 'origem' : 'cliente';
  const sourceType = el('select', { class: 'pa-input', 'data-testid': 'fin-edit-source-type' }, [el('option', { value: 'cliente', text: 'Cliente cadastrado', ...(initialSourceType === 'cliente' ? { selected: 'selected' } : {}) }), el('option', { value: 'origem', text: 'Outra origem', ...(initialSourceType === 'origem' ? { selected: 'selected' } : {}) })]);
  const clientPicker = financeClientPicker(ctx.store, title.partyId, 'fin-edit-client');
  const originName = el('input', { class: 'pa-input', type: 'text', value: initialSourceType === 'origem' ? title.partyName || '' : '', placeholder: 'Ex.: feira, curso, parceria', 'data-testid': 'fin-edit-origin-name' });
  const clientFields = el('div', { style: initialSourceType === 'cliente' ? '' : 'display:none' }, [field('Cliente', clientPicker.element)]);
  const originFields = el('div', { style: initialSourceType === 'origem' ? '' : 'display:none' }, [field('Nome da origem', originName)]);
  const sourceError = el('p', { class: 'pa-sheet-msg', role: 'alert' });
  sourceType.addEventListener('change', () => { sourceError.textContent = ''; clientFields.style.display = sourceType.value === 'cliente' ? '' : 'none'; originFields.style.display = sourceType.value === 'origem' ? '' : 'none'; });
  const description = el('input', { class: 'pa-input', type: 'text', value: title.description || '', 'data-testid': 'fin-edit-desc' });
  const amount = moneyField(title.amount, 'fin-edit-amount'); const categories = activeFinanceCategories(ctx.store, title.direction, title.categoryId);
  const category = el('select', { class: 'pa-input', 'data-testid': 'fin-edit-category' }, categories.map((c) => el('option', { value: c.id, text: `${c.code || ''} ${c.name}${c.archived ? ' (arquivada)' : ''}`.trim(), ...(title.categoryId === c.id ? { selected: 'selected' } : {}) })));
  const method = paymentMethodSelect(ctx.store, 'fin-edit-method', title.expectedMethod || '');
  const notes = el('textarea', { class: 'pa-input', rows: '2', 'data-testid': 'fin-edit-notes' }); notes.value = title.notes || '';
  amount.input.addEventListener('input', () => amount.input.setCustomValidity(''));
  function save() {
    sourceError.textContent = '';
    const value = parseNum(amount.input.value); if (!(value > 0) || value + 0.005 < state.settled) { amount.input.setCustomValidity(`O valor não pode ser menor que o já baixado (${brl(state.settled)}).`); amount.input.reportValidity(); return; }
    const client = isReceive && sourceType.value === 'cliente' ? clientPicker.selected() : null;
    const otherOrigin = isReceive && sourceType.value === 'origem' ? originName.value.trim() : '';
    if (isReceive && sourceType.value === 'cliente' && !client) { sourceError.textContent = 'Digite o nome e selecione um cliente sugerido.'; clientPicker.focus(); return; }
    if (isReceive && sourceType.value === 'origem' && !otherOrigin) { sourceError.textContent = 'Informe o nome da origem desta entrada.'; originName.focus(); return; }
    const selectedSupplier = !isReceive ? suppliers.find((p) => p.id === supplier.value) : null;
    const manualDue = title.sourceType === 'encomenda' && dateOnly(due.value) !== dateOnly(title.dueDate);
    if (!window.confirm('Salvar alterações neste lançamento financeiro?')) return;
    ctx.actions.mutate((s) => s.upsertFinanceTitle({ ...title, issuedAt: dateIso(issue.value), competenceDate: dateIso(issue.value), dueDate: dateIso(due.value), ...(manualDue ? { paymentDueManual: true } : {}), amount: value, description: description.value.trim() || title.description, categoryId: category.value || undefined, partyType: isReceive ? sourceType.value : 'fornecedor', partyId: client?.id || selectedSupplier?.id, partyName: client?.name || otherOrigin || selectedSupplier?.name || title.partyName || 'Outro fornecedor', expectedMethod: method.value, notes: notes.value.trim() || undefined }));
  }
  return sheet({ title: 'Editar lançamento', rows: [el('p', { class: 'pa-hint', text: 'Altere o valor, as datas ou a classificação. Pagamentos já registrados permanecem no histórico.' }), field('Emissão', issue), field('Vencimento', due), isReceive ? field('Origem da entrada', sourceType) : field('Fornecedor', supplier), isReceive && clientFields, isReceive && originFields, isReceive && sourceError, field('Descrição', description), field('Valor total', amount), field('Categoria', category), field('Forma prevista', method), field('Observações', notes)].filter(Boolean), onSave: save, saveTestid: 'fin-edit-save' });
}

MODALS['finance-settlement-edit'] = (ctx, m) => financeSettlementEditSheet(ctx, m);
function financeSettlementEditSheet(ctx, m) {
  const title = ctx.store.get('financeTitles', m.titleId); const isPayment = m.settlementKind === 'payment';
  const original = isPayment ? ctx.store.get('payments', m.settlementId) : ctx.store.get('financeSettlements', m.settlementId);
  if (!title || !original) return sheet({ title: 'Pagamento não encontrado', rows: [] });
  const isDiscount = !isPayment && original.kind === 'discount';
  const state = titleState(ctx.store, title); const oldAmount = Number(isPayment ? original.valor : original.amount) || 0;
  const date = el('input', { class: 'pa-input', type: 'date', value: dateOnly(original.at), 'data-testid': 'fin-correct-date' });
  const amount = moneyField(oldAmount, 'fin-correct-amount');
  const currentMethod = isPayment ? original.forma : original.method;
  const method = paymentMethodSelect(ctx.store, 'fin-correct-method', currentMethod || '');
  const account = el('select', { class: 'pa-input', 'data-testid': 'fin-correct-account' }, accountOptions(ctx.store).map((a) => el('option', { value: a.id, text: a.name, ...(!isPayment && original.accountId === a.id ? { selected: 'selected' } : {}) })));
  amount.input.addEventListener('input', () => amount.input.setCustomValidity(''));
  function save() {
    const value = parseNum(amount.input.value); const otherSettled = Math.max(0, state.settled - oldAmount); const maximum = Math.max(0, title.amount - otherSettled);
    if (!(value > 0) || value > maximum + 0.005) { amount.input.setCustomValidity(`O valor máximo para este lançamento é ${brl(maximum)}.`); amount.input.reportValidity(); return; }
    if (!window.confirm('Confirmar correção? O pagamento anterior será estornado e um novo registro será criado.')) return;
    ctx.actions.mutate((s) => {
      s.addReversal({ id: uuid(), at: nowIso(), kind: isPayment ? 'payment' : 'financeSettlement', refId: original.id });
      if (isPayment) s.addPayment({ id: uuid(), at: dateIso(date.value), encomendaId: original.encomendaId, valor: value, forma: method.value });
      else s.addFinanceSettlement({ id: uuid(), at: dateIso(date.value), titleId: title.id, amount: value, kind: isDiscount ? 'discount' : 'payment', ...(isDiscount ? {} : { method: method.value, accountId: account.value || undefined }), notes: `Correção do lançamento de ${fmtDate(original.at)}` });
      if (title.sourceType === 'manual' && state.balance <= 0.005) s.upsertFinanceTitle({ ...title, amount: otherSettled + value });
    });
  }
  return sheet({ title: isDiscount ? 'Corrigir desconto' : title.direction === 'receber' ? 'Corrigir recebimento' : 'Corrigir pagamento', rows: [el('div', { class: 'pa-callout' }, [el('span', { text: 'Valor anterior: ' }), el('strong', { text: brl(oldAmount) })]), el('p', { class: 'pa-hint', text: 'A correção não apaga o registro anterior: ele será estornado e o novo valor ficará no histórico.' }), field('Data', date), field('Valor correto', amount), !isDiscount && field('Forma', method), !isPayment && !isDiscount && field('Conta financeira', account)].filter(Boolean), onSave: save, saveTestid: 'fin-correct-save' });
}

MODALS['finance-settle'] = (ctx, m) => financeSettleSheet(ctx, m.id, m.fullOnly);
function financeSettleSheet(ctx, id, fullOnly = false) {
  const title = ctx.store.get('financeTitles', id); const state = title && titleState(ctx.store, title); if (!title || !state) return sheet({ title: 'Título não encontrado', rows: [] });
  const date = el('input', { class: 'pa-input', type: 'date', value: todayInput(), 'data-testid': 'fin-settle-date' }); const amount = moneyField(state.balance, 'fin-settle-amount'); const discount = moneyField(null, 'fin-settle-discount'); const method = paymentMethodSelect(ctx.store, 'fin-settle-method', title.expectedMethod || ''); const account = el('select', { class: 'pa-input', 'data-testid': 'fin-settle-account' }, accountOptions(ctx.store).map((a) => el('option', { value: a.id, text: a.name }))); const notes = el('input', { class: 'pa-input', type: 'text', placeholder: 'Observação (opcional)' });
  const isReceivable = title.direction === 'receber';
  const canCredit = isReceivable && title.partyId && ctx.store.get('clients', title.partyId);
  if (fullOnly) amount.input.readOnly = true;
  if (fullOnly && isReceivable) discount.input.addEventListener('input', () => {
    const requested = parseNum(discount.input.value);
    const value = requested == null ? 0 : Math.max(0, requested);
    amount.input.value = fmtMoneyInput(Math.max(0, Math.round((state.balance - value) * 100) / 100));
    discount.input.setCustomValidity('');
  });
  function save() {
    const value = Math.round(Math.max(0, parseNum(amount.input.value) || 0) * 100) / 100;
    const discountValue = isReceivable ? Math.round(Math.max(0, parseNum(discount.input.value) || 0) * 100) / 100 : 0;
    const currentBalance = titleState(ctx.store, title).balance;
    if (isReceivable && discountValue > currentBalance + 0.005) {
      discount.input.setCustomValidity('O desconto não pode ultrapassar o saldo desta fatura.'); discount.input.reportValidity(); return;
    }
    if (fullOnly && (Math.abs(currentBalance - state.balance) > 0.005 || Math.abs(value + discountValue - currentBalance) > 0.005 || currentBalance <= 0.005)) {
      discount.input.setCustomValidity('O saldo desta fatura mudou. Reabra a quitação para conferir o valor atual.'); discount.input.reportValidity(); return;
    }
    if (!fullOnly && (!(value + discountValue > 0) || discountValue > currentBalance + 0.005 || (!canCredit && value + discountValue > currentBalance + 0.005))) { amount.input.focus(); return; }
    ctx.actions.mutate((s) => {
      if (value > 0 && title.sourceType === 'encomenda') s.addPayment({ id: uuid(), at: dateIso(date.value), encomendaId: title.sourceId, valor: value, forma: method.value });
      else if (value > 0) s.addFinanceSettlement({ id: uuid(), at: dateIso(date.value), titleId: title.id, amount: value, kind: 'payment', method: method.value, accountId: account.value || undefined, notes: notes.value.trim() || undefined });
      if (discountValue > 0) s.addFinanceSettlement({ id: uuid(), at: dateIso(date.value), titleId: title.id, amount: discountValue, kind: 'discount', notes: notes.value.trim() || 'Desconto concedido na quitação' });
    });
  }
  return sheet({ title: fullOnly ? 'Quitar esta fatura' : isReceivable ? 'Registrar recebimento' : 'Registrar pagamento', rows: [el('div', { class: 'pa-callout' }, [el('span', { text: 'Saldo atual ' }), el('strong', { text: brl(state.balance) })]), field('Data', date), isReceivable && field('Desconto concedido na quitação (opcional)', discount), field(isReceivable ? 'Valor recebido de fato' : 'Valor pago', amount), isReceivable && el('p', { class: 'pa-hint', text: fullOnly ? 'O valor recebido é o saldo menos o desconto. Apenas o recebido entra no caixa; o desconto aparece separadamente na ficha e na DRE do período em que foi concedido.' : canCredit ? 'O valor recebido entra no caixa. Se for maior que o saldo, o excedente vira crédito para a próxima compra. O desconto reduz apenas o saldo.' : 'O valor recebido entra no caixa. O desconto reduz apenas o saldo.' }), field('Forma', method), field('Conta financeira', account), field('Observação', notes)].filter(Boolean), onSave: save, saveTestid: 'fin-settle-save', saveLabel: fullOnly ? 'Quitar fatura' : undefined });
}

MODALS['finance-title-loss'] = (ctx, m) => financeTitleLossSheet(ctx, m.id);
function financeTitleLossSheet(ctx, id) {
  const title = ctx.store.get('financeTitles', id); const state = title && titleState(ctx.store, title);
  if (!title || !state || title.direction !== 'receber' || title.cancelledAt || state.balance <= 0.005) return sheet({ title: 'Fatura sem saldo em aberto', rows: [] });
  const date = el('input', { class: 'pa-input', type: 'date', value: todayInput(), 'data-testid': 'fin-loss-date' });
  const notes = el('textarea', { class: 'pa-input', rows: '2', placeholder: 'Motivo da perda (opcional)', 'data-testid': 'fin-loss-notes' });
  function save() {
    const current = titleState(ctx.store, title);
    if (current.balance <= 0.005) return;
    ctx.actions.mutate((store) => store.addFinanceSettlement({ id: uuid(), at: dateIso(date.value), titleId: title.id, amount: current.balance, kind: 'loss', notes: notes.value.trim() || 'Baixa por perda' }));
  }
  return sheet({ title: 'Registrar como perda', rows: [el('p', { class: 'pa-hint', text: `Fatura de ${title.partyName || 'cliente'} · ${title.description}. A perda encerrará apenas o saldo restante desta fatura, sem entrada no caixa.` }), el('div', { class: 'pa-callout' }, [el('span', { text: 'Saldo a baixar: ' }), el('strong', { text: brl(state.balance) })]), field('Data da perda', date), field('Motivo', notes)], onSave: save, saveTestid: 'fin-loss-save', saveLabel: 'Registrar perda' });
}

function presetRange(key) {
  const now = new Date(); const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (key === 'hoje') return [local(now), local(now)];
  if (key === 'semana') { const s = new Date(now); s.setDate(now.getDate() - ((now.getDay() + 6) % 7)); const e = new Date(s); e.setDate(s.getDate() + 6); return [local(s), local(e)]; }
  if (key === 'ano') return [`${now.getFullYear()}-01-01`, `${now.getFullYear()}-12-31`];
  const e = new Date(now.getFullYear(), now.getMonth() + 1, 0); return [`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, local(e)];
}

function financeCashFlowPanel(ctx) {
  const { store, view } = ctx; const start = view.finStart; const end = view.finEnd;
  const flow = cashFlow(store, start, end, { projected: view.finProjected, accountId: view.finAccountId || undefined, categoryId: view.finCategoryId || undefined });
  const preset = (key, label) => el('button', { class: 'pa-chip' + (view.finFlowPreset === key ? ' pa-chip-on' : ''), 'data-testid': `fin-flow-${key}`, onclick: () => { if (key === 'personalizado') ctx.actions.setFinanceView({ finFlowPreset: key }); else { const [s, e] = presetRange(key); ctx.actions.setFinanceView({ finFlowPreset: key, finStart: s, finEnd: e }); } } }, label);
  const account = el('select', { class: 'pa-input', 'data-testid': 'fin-flow-account', onchange: (e) => ctx.actions.setFinanceView({ finAccountId: e.target.value }) }, [el('option', { value: '', text: 'Todas as contas' }), ...accountOptions(store).map((a) => el('option', { value: a.id, text: a.name, ...(view.finAccountId === a.id ? { selected: 'selected' } : {}) }))]);
  const categories = store.state.categories.filter((c) => !c.archived && c.parentId && c.cashFlowGroup !== 'nao-caixa');
  const category = el('select', { class: 'pa-input', 'data-testid': 'fin-flow-category', onchange: (e) => ctx.actions.setFinanceView({ finCategoryId: e.target.value }) }, [el('option', { value: '', text: 'Todas as categorias' }), ...categories.map((c) => el('option', { value: c.id, text: c.name, ...(view.finCategoryId === c.id ? { selected: 'selected' } : {}) }))]);

  let actual = cashMovements(store).filter((m) => inDateRange(m.at, start, end));
  actual = actual.filter((m) => view.finAccountId ? m.accountId === view.finAccountId : !m.transfer);
  if (view.finCategoryId) actual = actual.filter((m) => canonicalCategoryId(store, m.categoryId) === canonicalCategoryId(store, view.finCategoryId));
  actual.sort((a, b) => dateOnly(a.at).localeCompare(dateOnly(b.at)) || a.label.localeCompare(b.label, 'pt-BR'));

  let pending = view.finProjected ? listTitles(store, { status: 'aberto', categoryId: view.finCategoryId || undefined }) : [];
  pending = pending.filter((r) => !r.title.cancelledAt && r.balance > 0.005 && (inDateRange(r.title.dueDate, start, end) || (r.status === 'vencido' && start && dateOnly(r.title.dueDate) < start)));

  const detailHeader = () => el('div', { class: 'pa-cash-head', 'aria-hidden': 'true' }, [el('span', { text: 'Data' }), el('span', { text: 'Descrição' }), el('span', { text: 'Valor' })]);
  const actualRows = actual.map((m) => {
    const cat = m.categoryId ? store.get('categories', m.categoryId) : null; const acc = m.accountId ? store.get('cashAccounts', m.accountId) : null;
    let correction = null;
    if (m.sourceType === 'financeSettlement' && m.titleId) correction = { titleId: m.titleId, settlementId: m.sourceId, settlementKind: 'financeSettlement' };
    if (m.sourceType === 'payment' && m.order?.id) {
      const orderTitle = store.state.financeTitles.find((t) => t.sourceType === 'encomenda' && t.sourceId === m.order.id);
      if (orderTitle) correction = { titleId: orderTitle.id, settlementId: m.sourceId, settlementKind: 'payment' };
    }
    const meta = [m.direction === 'entrada' ? 'Entrada realizada' : 'Saída realizada', cat?.name, acc?.name, m.method, correction ? 'Toque para corrigir' : null].filter(Boolean).join(' · ');
    return el(correction ? 'button' : 'div', { class: `pa-cash-row ${m.direction === 'entrada' ? 'pa-cash-in' : 'pa-cash-out'}${correction ? ' pa-cash-editable' : ''}`, 'data-testid': 'fin-flow-actual-row', ...(correction ? { onclick: () => ctx.actions.openModal({ kind: 'finance-settlement-edit', ...correction }) } : {}) }, [el('time', { class: 'pa-cash-date', datetime: dateOnly(m.at), text: fmtDate(m.at) }), el('div', { class: 'pa-cash-description' }, [el('strong', { text: m.label }), el('span', { class: 'pa-muted', text: meta })]), el('strong', { class: `pa-cash-value ${m.direction === 'entrada' ? 'pa-positive' : 'pa-bad'}`, text: `${m.direction === 'entrada' ? '+' : '−'} ${brl(m.amount)}` })]);
  });
  const pendingRows = pending.map((r) => {
    const title = r.title; const isIn = title.direction === 'receber'; const overdue = r.status === 'vencido'; const cat = title.categoryId ? store.get('categories', title.categoryId) : null;
    const meta = [isIn ? 'A receber' : 'A pagar', cat?.name, r.settled > 0.005 ? `Parcial · já baixado ${brl(r.settled)}` : null].filter(Boolean).join(' · ');
    return el('button', { class: `pa-cash-row pa-cash-pending ${isIn ? 'pa-cash-in' : 'pa-cash-out'}${overdue ? ' pa-cash-overdue' : ''}`, 'data-testid': 'fin-flow-pending-row', onclick: () => ctx.actions.openModal({ kind: 'finance-title-detail', id: title.id }) }, [el('time', { class: 'pa-cash-date', datetime: dateOnly(title.dueDate), text: fmtDate(title.dueDate) }), el('div', { class: 'pa-cash-description' }, [el('div', {}, [el('strong', { text: title.partyName || title.description }), overdue && el('span', { class: 'pa-badge pa-warn', text: 'Vencido' })].filter(Boolean)), el('span', { class: 'pa-muted', text: `${title.description} · ${meta}` })]), el('strong', { class: `pa-cash-value ${isIn ? 'pa-positive' : 'pa-bad'}`, text: `${isIn ? '+' : '−'} ${brl(r.balance)}` })]);
  });

  const dayTable = flow.days.length ? el('div', { class: 'pa-table-scroll' }, el('table', { class: 'pa-kv pa-report' }, [el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Dia' }), el('td', { class: 'pa-num', text: 'Entradas' }), el('td', { class: 'pa-num', text: 'Saídas' }), el('td', { class: 'pa-num', text: 'Saldo dia' }), el('td', { class: 'pa-num', text: 'Acumulado' })]), ...flow.days.map((r) => el('tr', {}, [el('td', { text: fmtDate(`${r.date}T12:00:00`) }), el('td', { class: 'pa-num pa-positive', text: brl(r.in) }), el('td', { class: 'pa-num pa-bad', text: brl(r.out) }), el('td', { class: 'pa-num', text: brl(r.balance) }), el('td', { class: 'pa-num', text: brl(r.cumulative) })]))])) : el('p', { class: 'pa-empty', text: 'Nenhuma movimentação realizada neste período.' });
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Realizado e futuro' }), el('h2', { text: 'Fluxo de Caixa' })]),
      el('div', { class: 'pa-row pa-form' }, [
        el('button', { class: 'pa-btn pa-sm', 'data-testid': 'dre-open', onclick: () => ctx.actions.openModal({ kind: 'dre-preview', start, end }) }, 'DRE do período'),
        el('label', { class: 'pa-toggle' }, [el('input', { type: 'checkbox', ...(view.finProjected ? { checked: 'checked' } : {}), onchange: (e) => ctx.actions.setFinanceView({ finProjected: e.target.checked }) }), el('span', { text: 'Mostrar valores a quitar' })]),
      ]),
    ]),
    el('div', { class: 'pa-chiprow' }, [preset('hoje', 'Hoje'), preset('semana', 'Semana'), preset('mes', 'Mês'), preset('ano', 'Ano'), preset('personalizado', 'Período específico')]),
    view.finFlowPreset === 'personalizado' ? periodFields(start, end, ({ start: s, end: e }) => ctx.actions.setFinanceView({ finStart: s, finEnd: e }), 'fin-flow') : el('p', { class: 'pa-hint', text: `Período selecionado automaticamente: ${fmtDate(`${start}T12:00:00`)} até ${fmtDate(`${end}T12:00:00`)}` }),
    el('p', { class: 'pa-hint', text: 'A DRE usa este mesmo período e considera toda a empresa. Os filtros de conta e categoria abaixo servem apenas para analisar o caixa.' }),
    el('div', { class: 'pa-filtergrid' }, [field('Conta', account), field('Categoria', category)]),
    el('div', { class: 'pa-statgrid' }, [statCard('Entradas realizadas', brl(flow.totalIn), 'ok'), statCard('Saídas realizadas', brl(flow.totalOut), flow.totalOut ? 'warn' : 'soft'), statCard('Saldo realizado', brl(flow.totalIn - flow.totalOut), flow.totalIn - flow.totalOut >= 0 ? 'navy' : 'bad'), statCard('Saldo acumulado', brl(flow.ending), flow.ending >= 0 ? 'navy' : 'bad')]),
    view.finProjected && el('div', { class: 'pa-callout' }, view.finAccountId
      ? [el('strong', { text: 'Previsão por conta indisponível' }), el('span', { text: ' Contas ainda não quitadas não têm conta de caixa definida. Selecione “Todas as contas” para ver a previsão da empresa; os valores realizados continuam filtrados pela conta escolhida.' })]
      : [el('strong', { text: `Previsão do período: +${brl(flow.projectedIn)} · −${brl(flow.projectedOut)}` }), el('span', { text: ' Contas pendentes não alteram o realizado. Vencidos anteriores também aparecem no alerta abaixo.' })]),
    el('h3', { class: 'pa-h3', text: 'Tudo que entrou e saiu' }),
    actualRows.length ? el('div', { class: 'pa-cash-list' }, [detailHeader(), ...actualRows]) : el('p', { class: 'pa-empty', text: 'Nenhuma entrada ou saída realizada neste período.' }),
    view.finProjected && el('h3', { class: 'pa-h3', text: 'Valores a quitar' }),
    view.finProjected && (pendingRows.length ? el('div', { class: 'pa-cash-list' }, [detailHeader(), ...pendingRows]) : el('p', { class: 'pa-empty', text: 'Nenhum valor pendente neste período.' })),
    el('h3', { class: 'pa-h3', text: 'Resumo por dia' }), dayTable,
  ].filter(Boolean));
}

MODALS['dre-preview'] = (ctx, modal) => drePreviewSheet(ctx, modal);

function dreReportRows(ctx, start, end) {
  const dre = managerialDre(ctx.store, start, end);
  const line = (label, amount, options = {}) => el('tr', options.total ? { class: 'pa-kv-total' } : {}, [
    el('td', { class: options.detail ? 'pa-muted' : '', text: `${options.detail ? '— ' : ''}${label}` }),
    el('td', { class: `pa-num${options.bad ? ' pa-bad' : ''}${options.good ? ' pa-positive' : ''}`, text: options.negative ? `− ${brl(amount)}` : brl(amount) }),
  ]);
  const diagnosis = dre.diagnostics.map((item) => el('section', { class: `pa-callout${item.tone === 'bad' ? ' pa-callout-danger' : ''}`, 'data-testid': `dre-diagnosis-${item.tone}` }, [el('strong', { text: item.title }), el('span', { text: ` ${item.text}` })]));
  const pdf = el('button', { class: 'pa-btn pa-primary pa-grow', 'data-testid': 'dre-pdf' }, 'Gerar DRE em PDF A4');
  pdf.addEventListener('click', async () => {
    const original = pdf.textContent; pdf.textContent = 'Gerando PDF…'; pdf.disabled = true;
    try { await savePdf(await generateDrePdf(dre), `dre-${start}-${end}.pdf`); }
    catch (error) { window.alert('Não foi possível gerar a DRE: ' + ((error && error.message) || error)); }
    finally { pdf.textContent = original; pdf.disabled = false; }
  });
  return [
    el('p', { class: 'pa-callout', text: `Competência de ${fmtDate(`${start}T12:00:00`)} até ${fmtDate(`${end}T12:00:00`)}. Vendas entram quando marcadas como entregues. Compras ficam em estoque até o consumo dos produtos vendidos.` }),
    dre.grossRevenue === 0 && dre.directCosts === 0 && dre.operatingExpenses === 0 && el('p', { class: 'pa-empty', text: 'Nenhum registro financeiro neste período. Selecione outras datas para consultar a DRE.' }),
    el('table', { class: 'pa-kv pa-report', 'data-testid': 'dre-table' }, [
      line('Receita bruta de vendas', dre.salesGross),
      line('Descontos concedidos', dre.salesDiscounts, { detail: true, negative: true }),
      line('Devoluções registradas', dre.salesReturns, { detail: true, negative: true }),
      line('Tributos variáveis sobre vendas', dre.salesTaxes, { detail: true, negative: true }),
      line('Receita líquida de vendas', dre.salesRevenue - dre.salesReturns - dre.salesTaxes, { total: true }),
      line('Outras receitas', dre.otherRevenue), line('Receita total líquida', dre.grossRevenue, { total: true }),
      line('Insumos dos produtos vendidos (estimado)', dre.materialCosts, { detail: true, negative: true }),
      line('Embalagens dos produtos vendidos (estimado)', dre.packagingCosts, { detail: true, negative: true }),
      ...dre.costRows.map((row) => line(row.name, row.amount, { detail: true, negative: true })),
      line('Depreciação de equipamentos de produção', dre.productionDepreciation, { detail: true, negative: true }),
      line('Custos dos produtos vendidos e produção', dre.directCosts, { total: true, negative: true }),
      line('Lucro bruto', dre.grossProfit, { total: true, bad: dre.grossProfit < 0, good: dre.grossProfit >= 0 }),
      ...dre.sellingRows.map((row) => line(row.name, row.amount, { detail: true, negative: true })),
      line('Frete, taxas e comissões de venda', dre.sellingExpenses, { total: true, negative: true }),
      ...dre.expenseRows.map((row) => line(row.name, row.amount, { detail: true, negative: true })),
      line('Despesas operacionais', dre.operatingExpenses, { total: true, negative: true }),
      line('Depreciação administrativa', dre.administrationDepreciation, { detail: true, negative: true }),
      line('Lucro líquido / prejuízo do período', dre.netResult, { total: true, bad: dre.netResult < 0, good: dre.netResult >= 0 }),
    ]),
    el('p', { class: 'pa-hint', text: `Dentro dos custos de produção: ${brl(dre.indirectCosts)} classificados como indiretos. Dentro das despesas operacionais: ${brl(dre.fixedExpenses)} classificados como fixos e ${brl(dre.clientLosses)} de perdas confirmadas com clientes. Contas apenas vencidas não são perda.` }),
    el('p', { class: 'pa-callout', text: `Estoque de insumos e embalagens: ${brl(dre.inventoryValue)} estimados pelo preço mais recente. É patrimônio em estoque, não despesa adicional desta DRE.${dre.unpricedInventory ? ` ${dre.unpricedInventory} item(ns) sem preço não entraram na soma.` : ''}${dre.negativeInventory ? ` ${dre.negativeInventory} item(ns) com saldo negativo precisam de conferência.` : ''}` }),
    el('div', { class: 'pa-statgrid' }, [statCard('Margem bruta', dre.grossMarginPct == null ? 'Sem receita' : `${Math.round(dre.grossMarginPct * 100)}%`, dre.grossProfit >= 0 ? 'navy' : 'bad'), statCard('Margem líquida', dre.netMarginPct == null ? 'Sem receita' : `${Math.round(dre.netMarginPct * 100)}%`, dre.netResult >= 0 ? 'ok' : 'bad'), statCard('Ainda a receber', brl(dre.openReceivables), dre.openReceivables ? 'warn' : 'soft'), statCard('Ainda a pagar', brl(dre.openPayables), dre.openPayables ? 'warn' : 'soft')]),
    el('h3', { class: 'pa-h3', text: 'Diagnóstico automático' }), ...diagnosis,
    el('p', { class: 'pa-hint', text: 'Esta é uma DRE gerencial simplificada para decisão. Para obrigações fiscais e contábeis formais, valide a classificação com seu contador.' }),
    el('div', { class: 'pa-sheet-actions' }, [pdf, el('button', { class: 'pa-btn', onclick: () => { ctx.actions.closeModal(); ctx.actions.setTab('fin-plano'); } }, 'Editar plano de contas'), el('button', { class: 'pa-btn', onclick: () => { ctx.actions.closeModal(); ctx.actions.setTab('ajustes'); } }, 'Abrir patrimônio em Ajustes')]),
  ].filter(Boolean);
}

function drePreviewSheet(ctx, modal = {}) {
  const start = modal.start || ctx.view.finStart; const end = modal.end || ctx.view.finEnd;
  return sheet({ title: 'DRE gerencial do período', rows: dreReportRows(ctx, start, end) });
}

function financeDrePanel(ctx) {
  const { view } = ctx;
  const start = view.finDreStart; const end = view.finDreEnd;
  const preset = (key, label) => el('button', { class: `pa-chip${view.finDrePreset === key ? ' pa-chip-on' : ''}`, 'data-testid': `fin-dre-${key}`, onclick: () => {
    if (key === 'personalizado') ctx.actions.setFinanceView({ finDrePreset: key });
    else { const [s, e] = presetRange(key); ctx.actions.setFinanceView({ finDrePreset: key, finDreStart: s, finDreEnd: e }); }
  } }, label);
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Resultado por competência' }), el('h2', { text: 'DRE gerencial' })])]),
    el('p', { class: 'pa-hint', text: 'Veja receitas, custos e despesas do período, inclusive valores ainda a receber ou pagar. A DRE mede o resultado; o Fluxo de Caixa mostra quando o dinheiro entrou ou saiu.' }),
    el('div', { class: 'pa-chiprow' }, [preset('hoje', 'Hoje'), preset('semana', 'Semana'), preset('mes', 'Mês'), preset('ano', 'Ano'), preset('personalizado', 'Período específico')]),
    view.finDrePreset === 'personalizado' ? periodFields(start, end, ({ start: s, end: e }) => ctx.actions.setFinanceView({ finDreStart: s, finDreEnd: e }), 'fin-dre-period') : el('p', { class: 'pa-hint', text: `Período selecionado: ${fmtDate(`${start}T12:00:00`)} até ${fmtDate(`${end}T12:00:00`)}` }),
    ...(start > end ? [el('p', { class: 'pa-empty', text: 'A data inicial deve ser anterior ou igual à data final.' })] : dreReportRows(ctx, start, end)),
  ]);
}

function financePurchasesPanel(ctx) {
  const rows = ctx.store.state.purchases.slice().sort((a, b) => a.at < b.at ? 1 : -1);
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Fornecedores e insumos' }), el('h2', { text: 'Compras' })]), el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'purchase-new', onclick: () => ctx.actions.openModal({ kind: 'purchase-add' }) }, '+ Compra')]),
    el('p', { class: 'pa-hint', text: 'Toda compra atualiza o custo dos insumos, fornecedor, histórico e estoque. Frete, impostos, juros e encargos são rateados entre os itens. Você decide no lançamento se o total também deve entrar no Contas a Pagar.' }),
    rows.length ? el('ul', { class: 'pa-list pa-rows' }, rows.map((purchase) => {
      const supplier = purchase.supplierId ? ctx.store.get('suppliers', purchase.supplierId) : null;
      const title = purchase.titleId ? ctx.store.get('financeTitles', purchase.titleId) : null;
      const state = title ? titleState(ctx.store, title) : null;
      return el('li', { class: 'pa-row-item', onclick: () => title && ctx.actions.openModal({ kind: 'finance-title-detail', id: title.id }) }, [
        el('div', { class: 'pa-grow' }, [
          el('div', { class: 'pa-enc-title' }, [el('strong', { text: supplier?.name || 'Sem fornecedor' }), state ? titleBadge(state.status) : el('span', { class: 'pa-badge', text: 'Somente estoque' })]),
          el('span', { class: 'pa-muted', text: `${fmtDate(purchase.at)} · ${(purchase.items || []).map((item) => ctx.store.get('ingredients', item.ingredientId)?.name).filter(Boolean).join(', ')}` }),
          ['freight', 'taxes', 'interest', 'fees'].some((key) => Number(purchase[key]) > 0) && el('span', { class: 'pa-muted', text: [['Frete', purchase.freight], ['Impostos', purchase.taxes], ['Juros', purchase.interest], ['Encargos', purchase.fees]].filter(([, value]) => Number(value) > 0).map(([label, value]) => `${label}: ${brl(value)}`).join(' · ') }),
        ]),
        el('strong', { class: 'pa-num', text: brl(purchase.total) }),
        title && el('span', { class: 'pa-chev', text: '›' }),
      ].filter(Boolean));
    })) : el('p', { class: 'pa-empty', text: 'Nenhuma compra registrada.' }),
  ]);
}

MODALS['purchase-add'] = (ctx) => purchaseAddSheet(ctx);
function purchaseAddSheet(ctx) {
  const { store } = ctx; const suppliers = store.state.suppliers.filter((s) => !s.archived); const ingredients = store.state.ingredients.slice().sort(compareNamed);
  if (!suppliers.length) return sheet({ title: 'Nova compra', rows: [el('p', { class: 'pa-callout', text: 'Cadastre pelo menos um fornecedor antes da primeira compra.' }), el('button', { class: 'pa-btn pa-primary', onclick: () => ctx.actions.openModal({ kind: 'finance-suppliers' }) }, 'Cadastrar fornecedor')] });
  if (!ingredients.length) return sheet({ title: 'Nova compra', rows: [el('p', { class: 'pa-callout', text: 'Cadastre os insumos antes de registrar uma compra.' })] });
  const supplier = el('select', { class: 'pa-input', 'data-testid': 'purchase-supplier' }, suppliers.map((s) => el('option', { value: s.id, text: s.name })));
  const date = el('input', { class: 'pa-input', type: 'date', value: todayInput(), 'data-testid': 'purchase-date' });
  const financeChoice = el('select', { class: 'pa-input', 'data-testid': 'purchase-finance' }, [el('option', { value: 'sim', text: 'Sim · criar no Contas a Pagar' }), el('option', { value: 'nao', text: 'Não · somente histórico e estoque' })]);
  const due = el('input', { class: 'pa-input', type: 'date', value: todayInput(), 'data-testid': 'purchase-due' });
  const situation = el('select', { class: 'pa-input', 'data-testid': 'purchase-situation' }, [el('option', { value: 'pendente', text: 'Pagar depois' }), el('option', { value: 'quitado', text: 'Pago agora' })]);
  const method = paymentMethodSelect(store, 'purchase-method');
  const account = el('select', { class: 'pa-input', 'data-testid': 'purchase-account' }, accountOptions(store).map((a) => el('option', { value: a.id, text: a.name })));
  const preferredPurchaseCategory = categoryByKey(store, 'insumos');
  const defaultCategory = preferredPurchaseCategory?.archived ? null : preferredPurchaseCategory;
  const payableCategories = activeFinanceCategories(store, 'pagar', defaultCategory?.id);
  const category = el('select', { class: 'pa-input', 'data-testid': 'purchase-category' }, payableCategories.map((item) => el('option', { value: item.id, text: `${item.code ? `${item.code} · ` : ''}${item.name}`, ...(item.id === defaultCategory?.id ? { selected: 'selected' } : {}) })));
  const itemsBox = el('div', { class: 'pa-detail-list' }); const lines = []; let nextLineIndex = 0;
  const freight = moneyField(0, 'purchase-freight');
  const taxes = moneyField(0, 'purchase-taxes');
  const interest = moneyField(0, 'purchase-interest');
  const fees = moneyField(0, 'purchase-fees');
  const extraFields = { freight, taxes, interest, fees };
  const costPreview = el('section', { class: 'pa-detail-card', 'data-testid': 'purchase-cost-preview' });
  const readItems = () => lines.map((line) => ({ ingredientId: line.ing.value, qty: parseNum(line.qty.value) || 0, unitPrice: parseNum(line.price.input.value) || 0 }));
  const readExtras = () => Object.fromEntries(Object.entries(extraFields).map(([key, control]) => [key, control.input.value.trim() ? parseNum(control.input.value) : 0]));
  function allocateCosts(items, extras) {
    const baseCosts = items.map((item) => item.qty * item.unitPrice);
    const subtotal = baseCosts.reduce((sum, value) => sum + value, 0);
    const extraCents = Object.values(extras).reduce((sum, value) => sum + Math.round(value * 100), 0);
    let cumulativeBase = 0; let allocated = 0;
    const allocatedItems = items.map((item, index) => {
      cumulativeBase += baseCosts[index];
      const nextAllocated = index === items.length - 1 ? extraCents : Math.round(extraCents * cumulativeBase / subtotal);
      const allocatedCharges = (nextAllocated - allocated) / 100;
      allocated = nextAllocated;
      return { ...item, allocatedCharges, totalCost: baseCosts[index] + allocatedCharges, landedUnitPrice: (baseCosts[index] + allocatedCharges) / item.qty };
    });
    return { items: allocatedItems, subtotal, total: Math.round(subtotal * 100 + extraCents) / 100 };
  }
  function renderCostPreview() {
    const items = readItems().filter((item) => item.qty > 0 && item.unitPrice > 0);
    const extras = readExtras();
    if (!items.length || Object.values(extras).some((value) => value == null || value < 0)) {
      costPreview.replaceChildren(el('p', { class: 'pa-hint', text: 'Informe os itens e valores positivos para ver o rateio.' }));
      return;
    }
    const costs = allocateCosts(items, extras);
    costPreview.replaceChildren(
      el('h3', { class: 'pa-h3', text: 'Resumo e rateio da compra' }),
      el('table', { class: 'pa-kv' }, [
        el('tr', {}, [el('td', { text: 'Itens' }), el('td', { class: 'pa-num', text: brl(costs.subtotal) })]),
        ...[['Frete', extras.freight], ['Impostos', extras.taxes], ['Juros', extras.interest], ['Encargos', extras.fees]].map(([label, value]) => el('tr', {}, [el('td', { text: label }), el('td', { class: 'pa-num', text: brl(value) })])),
        el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Total da compra' }), el('td', { class: 'pa-num', 'data-testid': 'purchase-total', text: brl(costs.total) })]),
      ]),
      el('p', { class: 'pa-hint', text: 'Custos adicionais distribuídos proporcionalmente ao valor de cada item:' }),
      ...costs.items.map((item) => el('p', { class: 'pa-muted', text: `${store.get('ingredients', item.ingredientId)?.name || 'Insumo'} · adicional ${brl(item.allocatedCharges)} · custo R$ ${item.landedUnitPrice.toFixed(4).replace('.', ',')} por ${store.get('ingredients', item.ingredientId)?.stockUnit || 'unidade'}` })),
    );
  }
  function addLine() {
    const index = nextLineIndex++;
    const ing = el('select', { class: 'pa-input', 'data-testid': `purchase-item-${index}` }, ingredients.map((i) => el('option', { value: i.id, text: `${i.name} (${i.stockUnit})` })));
    const qty = el('input', { class: 'pa-input pa-narrow', type: 'number', min: '0.001', step: 'any', value: '1', 'data-testid': `purchase-qty-${index}` });
    const price = moneyField(null, `purchase-price-${index}`);
    const line = { ing, qty, price, row: null };
    line.row = el('div', { class: 'pa-detail-card' }, [
      field('Insumo/embalagem', ing),
      el('div', { class: 'pa-filtergrid' }, [field('Quantidade', qty), field('Preço por unidade de compra', price)]),
      el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => { line.row.remove(); lines.splice(lines.indexOf(line), 1); renderCostPreview(); } }, 'Remover item'),
    ]);
    lines.push(line); itemsBox.append(line.row);
    [ing, qty, price.input].forEach((control) => { control.addEventListener('input', renderCostPreview); control.addEventListener('change', renderCostPreview); });
    renderCostPreview();
  }
  addLine();
  Object.values(extraFields).forEach((control) => control.input.addEventListener('input', renderCostPreview));
  const financeFields = el('section', { class: 'pa-detail-card', 'data-testid': 'purchase-finance-fields' }, [
    field('Categoria no Plano de Contas', category),
    el('div', { class: 'pa-filtergrid' }, [field('Vencimento', due), field('Situação', situation)]),
    field('Forma de pagamento', method), field('Conta financeira', account),
  ]);
  const syncFinanceVisibility = () => { financeFields.style.display = financeChoice.value === 'sim' ? '' : 'none'; };
  financeChoice.addEventListener('change', syncFinanceVisibility); syncFinanceVisibility();
  function save() {
    const items = readItems();
    if (!items.length || items.some((item) => !(item.qty > 0) || !(item.unitPrice > 0))) { window.alert('Informe quantidade e preço válidos em todos os itens da compra.'); return; }
    const extras = readExtras();
    if (Object.values(extras).some((value) => !Number.isFinite(value) || value < 0)) { window.alert('Frete, impostos, juros e encargos devem ter valores numéricos iguais ou maiores que zero.'); return; }
    const costs = allocateCosts(items, extras);
    const total = costs.total; const purchaseId = uuid(); const financiallyTracked = financeChoice.value === 'sim'; const titleId = financiallyTracked ? uuid() : undefined; const selectedSupplier = store.get('suppliers', supplier.value);
    ctx.actions.mutate((nextStore) => {
      nextStore.upsertPurchase({ id: purchaseId, at: dateIso(date.value), supplierId: supplier.value, items: costs.items, subtotal: costs.subtotal, ...extras, total, financiallyTracked, ...(titleId ? { titleId } : {}) });
      if (financiallyTracked) nextStore.upsertFinanceTitle({ id: titleId, direction: 'pagar', issuedAt: dateIso(date.value), competenceDate: dateIso(date.value), dueDate: dateIso(due.value), amount: total, description: `Compra · ${selectedSupplier?.name || 'Fornecedor'}`, categoryId: category.value || undefined, partyType: 'fornecedor', partyId: supplier.value, partyName: selectedSupplier?.name || 'Fornecedor', expectedMethod: method.value, sourceType: 'compra', sourceId: purchaseId });
      const byIngredient = new Map();
      for (const item of costs.items) {
        const sum = byIngredient.get(item.ingredientId) || { qty: 0, totalCost: 0 };
        sum.qty += item.qty; sum.totalCost += item.totalCost;
        byIngredient.set(item.ingredientId, sum);
      }
      for (const [ingredientId, sum] of byIngredient) {
        const ingredient = nextStore.get('ingredients', ingredientId);
        nextStore.addPriceChange({ id: uuid(), at: dateIso(date.value), ingredientId, price: sum.totalCost / sum.qty });
        if (ingredient) nextStore.upsertIngredient({ ...ingredient, lastSupplier: selectedSupplier?.name || ingredient.lastSupplier, shoppingHidden: false });
      }
      if (financiallyTracked && situation.value === 'quitado') nextStore.addFinanceSettlement({ id: uuid(), at: dateIso(date.value), titleId, amount: total, method: method.value, accountId: account.value || undefined });
    });
  }
  return sheet({ title: 'Registrar compra', rows: [field('Fornecedor', supplier), field('Data da compra', date), itemsBox, el('button', { class: 'pa-btn', onclick: addLine }, '+ Adicionar item'), el('div', { class: 'pa-filtergrid' }, [field('Frete', freight), field('Impostos', taxes), field('Juros', interest), field('Encargos', fees)]), costPreview, field('Entrar no Contas a Pagar?', financeChoice), financeFields, el('p', { class: 'pa-hint', text: 'Se escolher “Não”, a compra atualizará custo, fornecedor, histórico e estoque, mas não entrará no Contas a Pagar nem na DRE.' }), el('p', { class: 'pa-hint', text: 'Informe o preço por kg, litro ou unidade — a mesma unidade cadastrada no insumo. Os custos adicionais são rateados pelo valor dos itens.' })], onSave: save, saveTestid: 'purchase-save' });
}

function financeChartPanel(ctx) {
  const cats = ctx.store.state.categories.filter((c) => !c.archived).slice()
    .sort((a, b) => String(a.code || '99').localeCompare(String(b.code || '99'), undefined, { numeric: true }) || a.name.localeCompare(b.name, 'pt-BR'));
  return el('section', { class: 'pa-card' }, [el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Organização contábil da confeitaria' }), el('h2', { text: 'Plano de Contas' })]), el('button', { class: 'pa-btn pa-sm', 'data-testid': 'cat-manage', onclick: () => ctx.actions.openModal({ kind: 'categorias' }) }, 'Organizar categorias')]), el('p', { class: 'pa-hint', text: 'O plano separa receitas, custos diretos, despesas operacionais, investimentos e movimentações da proprietária. Categorias repetidas são arquivadas sem alterar lançamentos antigos.' }), el('div', { class: 'pa-actiongrid' }, [el('button', { class: 'pa-btn', onclick: () => ctx.actions.openModal({ kind: 'finance-accounts' }) }, 'Contas e bancos'), el('button', { class: 'pa-btn', onclick: () => ctx.actions.openModal({ kind: 'finance-methods' }) }, 'Formas de pagamento'), el('button', { class: 'pa-btn', onclick: () => ctx.actions.openModal({ kind: 'finance-suppliers' }) }, 'Fornecedores')]), el('ul', { class: 'pa-list pa-tight' }, cats.map((c) => el('li', { class: 'pa-list-item' }, [el('span', { class: 'pa-num pa-muted pa-category-code', text: c.code || '' }), el('div', { class: 'pa-grow pa-category-info' }, [el('strong', { text: `${c.parentId ? '— ' : ''}${c.name}` }), el('span', { class: 'pa-muted', text: [c.nature || c.kind, c.behavior, c.cashFlowGroup].filter(Boolean).join(' · ') })]), el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => ctx.actions.openModal({ kind: 'category-edit', id: c.id }) }, 'Editar')])))]);
}

function fornecedoresPanel(ctx) {
  const suppliers = ctx.store.state.suppliers.filter((supplier) => !supplier.archived)
    .slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [el('h2', { class: 'pa-grow', text: 'Fornecedores' }), el('button', { class: 'pa-btn pa-primary pa-sm', onclick: () => ctx.actions.openModal({ kind: 'finance-suppliers' }) }, '+ Cadastrar ou editar')]),
    suppliers.length ? el('ul', { class: 'pa-list pa-tight' }, suppliers.map((supplier) => el('li', { class: 'pa-list-item' }, [el('strong', { class: 'pa-grow', text: supplier.name }), el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => ctx.actions.openModal({ kind: 'finance-suppliers' }) }, 'Editar')]))) : el('p', { class: 'pa-empty', text: 'Nenhum fornecedor cadastrado.' }),
  ]);
}

MODALS['finance-suppliers'] = (ctx) => financeSuppliersSheet(ctx);
function financeSuppliersSheet(ctx) {
  const name = el('input', { class: 'pa-input', type: 'text', placeholder: 'Nome do fornecedor', 'data-testid': 'supplier-name' });
  const birthday = el('input', { class: 'pa-input', type: 'date', 'data-testid': 'supplier-birthday' });
  const rows = ctx.store.state.suppliers.map((supplier) => {
    const editName = el('input', { class: 'pa-input', type: 'text', value: supplier.name });
    const editBirthday = el('input', { class: 'pa-input', type: 'date', value: supplier.birthday || '' });
    return el('section', { class: `pa-detail-card${supplier.archived ? ' pa-reversed' : ''}` }, [
      el('div', { class: 'pa-filtergrid' }, [field('Nome', editName), field('Data de aniversário', editBirthday)]),
      el('div', { class: 'pa-row' }, [
        el('button', { class: 'pa-btn pa-primary pa-sm', onclick: () => ctx.actions.mutateModal((store) => store.upsertSupplier({ ...supplier, name: editName.value.trim() || supplier.name, birthday: editBirthday.value || undefined })) }, 'Salvar'),
        el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => ctx.actions.mutateModal((store) => store.upsertSupplier({ ...supplier, archived: !supplier.archived })) }, supplier.archived ? 'Reativar' : 'Arquivar'),
      ]),
    ]);
  });
  return sheet({ title: 'Fornecedores', rows: [el('div', { class: 'pa-filtergrid' }, [field('Nome', name), field('Data de aniversário', birthday)]), el('button', { class: 'pa-btn pa-primary', 'data-testid': 'supplier-add', onclick: () => { if (name.value.trim()) ctx.actions.mutateModal((store) => store.upsertSupplier({ id: uuid(), name: name.value.trim(), birthday: birthday.value || undefined })); } }, '+ Adicionar fornecedor'), ...rows] });
}

MODALS['finance-accounts'] = (ctx) => financeAccountsSheet(ctx);
function financeAccountsSheet(ctx) {
  const types = [['caixa', 'Caixa em dinheiro'], ['conta-corrente', 'Conta corrente'], ['poupanca', 'Poupança'], ['carteira-digital', 'Carteira digital'], ['maquininha', 'Conta de maquininha'], ['outro', 'Outra']];
  const rows = ctx.store.state.cashAccounts.map((a) => {
    const name = el('input', { class: 'pa-input', type: 'text', value: a.name || '' });
    const institution = el('input', { class: 'pa-input', type: 'text', value: a.institution || '', placeholder: 'Ex.: Nubank, Sicredi, Mercado Pago' });
    const type = el('select', { class: 'pa-input' }, types.map(([value, label]) => el('option', { value, text: label, ...((a.accountType || 'outro') === value ? { selected: 'selected' } : {}) })));
    const balance = moneyField(a.openingBalance || 0);
    const date = el('input', { class: 'pa-input', type: 'date', value: dateOnly(a.openingDate) || todayInput() });
    const save = () => {
      if (!name.value.trim()) { name.focus(); return; }
      ctx.actions.mutateModal((s) => s.upsertCashAccount({ ...a, name: name.value.trim(), institution: institution.value.trim() || undefined, accountType: type.value, openingBalance: parseNum(balance.input.value) || 0, openingDate: dateIso(date.value) }));
    };
    return el('section', { class: 'pa-detail-card' + (a.archived ? ' pa-reversed' : '') }, [
      el('div', { class: 'pa-filtergrid' }, [field('Nome da conta', name), field('Banco ou instituição', institution), field('Tipo', type), field('Saldo inicial', balance), field('Data inicial', date)]),
      el('div', { class: 'pa-row pa-form' }, [
        el('button', { class: 'pa-btn pa-primary pa-sm', onclick: save }, 'Salvar alterações'),
        el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => ctx.actions.mutateModal((s) => s.upsertCashAccount({ ...a, archived: !a.archived })) }, a.archived ? 'Reativar' : 'Arquivar'),
      ]),
    ]);
  });
  const name = el('input', { class: 'pa-input', type: 'text', placeholder: 'Ex.: Banco Inter' });
  const institution = el('input', { class: 'pa-input', type: 'text', placeholder: 'Banco ou instituição' });
  const type = el('select', { class: 'pa-input' }, types.map(([value, label]) => el('option', { value, text: label })));
  const add = () => {
    if (!name.value.trim()) { name.focus(); return; }
    ctx.actions.mutateModal((s) => s.upsertCashAccount({ id: uuid(), name: name.value.trim(), institution: institution.value.trim() || undefined, accountType: type.value, openingBalance: 0 }));
  };
  return sheet({ title: 'Contas, caixas e bancos', rows: [
    el('p', { class: 'pa-hint', text: 'Cadastre onde o dinheiro fica. Você pode alterar o nome, o banco, o tipo e o saldo inicial sem perder o histórico.' }),
    ...rows,
    el('h3', { class: 'pa-h3', text: 'Adicionar nova conta' }),
    el('div', { class: 'pa-filtergrid' }, [field('Nome da conta', name), field('Banco ou instituição', institution), field('Tipo', type)]),
    el('div', { class: 'pa-row pa-form' }, [el('button', { class: 'pa-btn pa-primary', 'data-testid': 'finance-account-add', onclick: add }, '+ Adicionar conta'), el('button', { class: 'pa-btn', onclick: () => ctx.actions.openModal({ kind: 'finance-adjustment' }) }, 'Ajuste ou transferência')]),
  ] });
}

MODALS['finance-methods'] = (ctx) => financeMethodsSheet(ctx);
function financeMethodsSheet(ctx) {
  const methods = paymentMethodRecords(ctx.store);
  const saveMethods = (next) => ctx.actions.mutateModal((store) => store.setConfig({ paymentMethods: next }));
  const rows = methods.map((method) => {
    const name = el('input', { class: 'pa-input pa-grow', type: 'text', value: method.name });
    return el('div', { class: 'pa-row pa-detail-card' + (method.archived ? ' pa-reversed' : '') }, [
      name,
      el('button', { class: 'pa-btn pa-sm', onclick: () => { const value = name.value.trim(); if (!value) { name.focus(); return; } saveMethods(methods.map((item) => item.id === method.id ? { ...item, name: value } : item)); } }, 'Salvar'),
      el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => saveMethods(methods.map((item) => item.id === method.id ? { ...item, archived: !item.archived } : item)) }, method.archived ? 'Reativar' : 'Arquivar'),
    ]);
  });
  const newName = el('input', { class: 'pa-input pa-grow', 'data-testid': 'finance-method-name', type: 'text', placeholder: 'Ex.: Link de pagamento, Vale, Fiado' });
  const add = () => {
    const name = newName.value.trim(); if (!name) { newName.focus(); return; }
    saveMethods([...methods, { id: uuid(), name }]);
  };
  return sheet({ title: 'Formas de pagamento', rows: [
    el('p', { class: 'pa-hint', text: 'Estas opções aparecem nos recebimentos, pagamentos e filtros. Arquivar mantém o histórico antigo e retira a opção dos novos lançamentos.' }),
    ...rows,
    el('div', { class: 'pa-row' }, [newName, el('button', { class: 'pa-btn pa-primary', 'data-testid': 'finance-method-add', onclick: add }, '+ Adicionar')]),
  ] });
}

function financeReportsPanel(ctx) {
  const { store, view } = ctx;
  const start = view.finStart; const end = view.finEnd;
  const mode = view.finReportMode || 'realizado';
  const hideReversals = view.finHideReversals !== false;
  const openPeriod = view.finReportOpenPeriod || 'all';
  const filterStart = mode === 'aberto' && openPeriod === 'all' ? null : start;
  const filterEnd = mode === 'aberto' && openPeriod === 'all' ? null : end;
  const direction = view.finReportDirection || 'todos';
  const selectedCategory = view.finReportCategoryId || '';
  const purchaseExtras = [['freight', 'frete-compras', 'Frete'], ['taxes', 'impostos-compras', 'Impostos'], ['interest', 'juros-compras', 'Juros'], ['fees', 'encargos-compras', 'Encargos']];
  const baseMovements = mode === 'aberto'
    ? listTitles(store, { status: 'aberto' }).filter((row) => row.balance > 0.005).map((row) => ({
      id: `open:${row.title.id}`, titleId: row.title.id, at: row.title.dueDate,
      direction: row.title.direction === 'receber' ? 'entrada' : 'saida', amount: row.balance,
      label: row.title.description, partyName: row.title.partyName, status: row.status, categoryId: row.title.categoryId,
    }))
    : cashMovements(store, { includeReversed: !hideReversals }).filter((movement) => !movement.transfer);
  const allMovements = baseMovements.flatMap((movement) => {
    if (!movement.titleId || movement.direction !== 'saida') return [movement];
    const title = store.get('financeTitles', movement.titleId);
    const purchase = title?.sourceType === 'compra' ? store.get('purchases', title.sourceId) : null;
    if (!purchase) return [movement];
    const extras = purchaseExtras.map(([field, key, label]) => ({ key, label, cents: Math.round((Number(purchase[field]) || 0) * 100) })).filter((part) => part.cents > 0);
    if (!extras.length) return [movement];
    const purchaseCents = Math.round((Number(purchase.total) || 0) * 100);
    const extraCents = extras.reduce((sum, part) => sum + part.cents, 0);
    if (purchaseCents < extraCents || purchaseCents <= 0) return [movement];
    const parts = [{ key: 'items', label: 'Itens', cents: purchaseCents - extraCents, categoryId: movement.categoryId },
      ...extras.map((part) => ({ ...part, categoryId: categoryByKey(store, part.key)?.id || movement.categoryId }))];
    const paidCents = Math.round(movement.amount * 100);
    let cumulative = 0; let assigned = 0;
    return parts.map((part, index) => {
      cumulative += part.cents;
      const nextAssigned = index === parts.length - 1 ? paidCents : Math.round(paidCents * cumulative / purchaseCents);
      const amount = (nextAssigned - assigned) / 100;
      assigned = nextAssigned;
      return { ...movement, id: `${movement.id}:${part.key}`, label: `${movement.label} · ${part.label}`, amount, categoryId: part.categoryId };
    }).filter((part) => part.amount > 0);
  });
  const categoryId = (movement) => canonicalCategoryId(store, movement.categoryId) || '__sem__';
  const categoryName = (id) => id === '__sem__' ? 'Sem categoria' : store.get('categories', id)?.name || 'Categoria antiga';
  const categories = new Map();
  const directions = direction === 'todos' ? ['receber', 'pagar'] : [direction === 'entrada' ? 'receber' : 'pagar'];
  for (const value of directions) for (const category of activeFinanceCategories(store, value)) {
    const id = canonicalCategoryId(store, category.id);
    if (!categories.has(id)) categories.set(id, store.get('categories', id) || category);
  }
  for (const movement of allMovements) {
    if (direction !== 'todos' && movement.direction !== direction) continue;
    const id = categoryId(movement);
    if (!categories.has(id)) categories.set(id, store.get('categories', id) || null);
  }
  const categoryOptions = [...categories.entries()].sort((a, b) => {
    if (a[0] === '__sem__') return 1;
    if (b[0] === '__sem__') return -1;
    return String(a[1]?.code || '').localeCompare(String(b[1]?.code || ''), undefined, { numeric: true }) || categoryName(a[0]).localeCompare(categoryName(b[0]), 'pt-BR');
  });
  const movements = allMovements.filter((m) => inDateRange(m.at, filterStart, filterEnd)
    && (direction === 'todos' || m.direction === direction)
    && (!selectedCategory || categoryId(m) === selectedCategory));
  const openTitleCount = mode === 'aberto' ? new Set(movements.map((movement) => movement.titleId)).size : 0;
  const inTotal = movements.filter((m) => !m.reversed && m.direction === 'entrada').reduce((s, m) => s + m.amount, 0);
  const outTotal = movements.filter((m) => !m.reversed && m.direction === 'saida').reduce((s, m) => s + m.amount, 0);
  const byCategory = new Map();
  for (const movement of movements) {
    if (movement.reversed) continue;
    const id = categoryId(movement);
    const totals = byCategory.get(id) || { entrada: 0, saida: 0 };
    totals[movement.direction] += movement.amount;
    byCategory.set(id, totals);
  }
  const overdue = mode === 'realizado' ? listTitles(store, { direction: 'receber', status: 'vencido' }) : [];
  const categoryRows = [...byCategory.entries()].sort((a, b) => (b[1].entrada + b[1].saida) - (a[1].entrada + a[1].saida)).map(([id, totals]) => el('tr', {}, [
    el('td', { text: categoryName(id) }),
    el('td', { class: 'pa-num', text: brl(totals.entrada) }),
    el('td', { class: 'pa-num', text: brl(totals.saida) }),
  ]));
  const movementRows = movements.map((movement) => el('tr', { class: movement.reversed ? 'pa-reversed' : '' }, [
    el('td', { text: fmtDate(movement.at) }),
    mode === 'aberto' && el('td', { text: movement.partyName || 'Não informado' }),
    el('td', {}, mode === 'aberto' ? el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => ctx.actions.openModal({ kind: 'finance-title-detail', id: movement.titleId }) }, movement.label) : [el('span', { text: movement.label }), movement.reversed && el('span', { class: 'pa-badge', text: 'estornado' })].filter(Boolean)),
    el('td', { text: categoryName(categoryId(movement)) }),
    mode === 'aberto' && el('td', { text: FIN_STATUS[movement.status]?.[0] || movement.status || 'Em aberto' }),
    el('td', { class: `pa-num${movement.direction === 'saida' ? ' pa-bad' : ' pa-positive'}`, text: `${movement.direction === 'saida' ? '− ' : '+ '}${brl(movement.amount)}` }),
  ]));
  const overdueRows = overdue.map((r) => el('tr', {}, [
    el('td', { text: `${r.title.partyName || 'Sem cliente'} · ${r.overdueDays} dia(s)` }),
    el('td', { class: 'pa-num pa-bad', text: brl(r.balance) }),
  ]));
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Decisões com clareza' }), el('h2', { text: 'Relatórios financeiros' })]), el('button', { class: 'pa-btn pa-sm', onclick: () => {
      const lines = [['Data', 'Tipo', 'Pessoa / fornecedor', 'Descrição', 'Plano de conta', 'Situação', 'Valor'], ...movements.map((m) => [dateOnly(m.at), m.direction === 'entrada' ? 'Entrada' : 'Saída', m.partyName || '', m.label, categoryName(categoryId(m)), m.reversed ? 'Estornado' : mode === 'aberto' ? FIN_STATUS[m.status]?.[0] || m.status || 'Em aberto' : 'Realizado', m.amount.toFixed(2).replace('.', ',')])];
      downloadFile(`financeiro-${mode}-${filterStart || 'inicio'}-${filterEnd || 'fim'}.csv`, lines.map((r) => r.map(csvCell).join(';')).join('\n'), 'text/csv');
    } }, 'Exportar CSV')]),
    el('div', { class: 'pa-chiprow' }, [
      el('button', { class: `pa-chip${mode === 'realizado' ? ' pa-chip-on' : ''}`, 'data-testid': 'fin-report-realized', onclick: () => ctx.actions.setFinanceView({ finReportMode: 'realizado', finReportCategoryId: '' }) }, 'Pagamentos e recebimentos'),
      el('button', { class: `pa-chip${mode === 'aberto' ? ' pa-chip-on' : ''}`, 'data-testid': 'fin-report-open', onclick: () => ctx.actions.setFinanceView({ finReportMode: 'aberto', finReportCategoryId: '' }) }, 'Contas em aberto'),
    ]),
    mode === 'aberto' && el('div', { class: 'pa-chiprow' }, [
      el('button', { class: `pa-chip${openPeriod === 'all' ? ' pa-chip-on' : ''}`, 'data-testid': 'fin-report-period-all', onclick: () => ctx.actions.setFinanceView({ finReportOpenPeriod: 'all' }) }, 'Todos os vencimentos'),
      el('button', { class: `pa-chip${openPeriod === 'custom' ? ' pa-chip-on' : ''}`, 'data-testid': 'fin-report-period-custom', onclick: () => ctx.actions.setFinanceView({ finReportOpenPeriod: 'custom' }) }, 'Selecionar datas'),
    ]),
    (mode === 'realizado' || openPeriod === 'custom') && periodFields(start, end, ({ start: s, end: e }) => ctx.actions.setFinanceView({ finStart: s, finEnd: e }), 'fin-report'),
    mode === 'realizado' && el('label', { class: 'pa-toggle' }, [el('input', { type: 'checkbox', 'data-testid': 'fin-report-hide-reversals', ...(hideReversals ? { checked: 'checked' } : {}), onchange: (event) => ctx.actions.setFinanceView({ finHideReversals: event.target.checked }) }), el('span', { text: 'Ocultar estornos' })]),
    el('div', { class: 'pa-filtergrid' }, [
      field(mode === 'aberto' ? 'Tipo de conta' : 'Tipo de movimentação', el('select', { class: 'pa-input', 'data-testid': 'fin-report-direction', onchange: (event) => ctx.actions.setFinanceView({ finReportDirection: event.target.value, finReportCategoryId: '' }) }, mode === 'aberto' ? [
        el('option', { value: 'todos', text: 'A receber e a pagar', ...(direction === 'todos' ? { selected: 'selected' } : {}) }),
        el('option', { value: 'entrada', text: 'Contas a receber', ...(direction === 'entrada' ? { selected: 'selected' } : {}) }),
        el('option', { value: 'saida', text: 'Contas a pagar', ...(direction === 'saida' ? { selected: 'selected' } : {}) }),
      ] : [
        el('option', { value: 'todos', text: 'Todas as entradas e saídas', ...(direction === 'todos' ? { selected: 'selected' } : {}) }),
        el('option', { value: 'entrada', text: 'Receitas e outras entradas', ...(direction === 'entrada' ? { selected: 'selected' } : {}) }),
        el('option', { value: 'saida', text: 'Despesas e outras saídas', ...(direction === 'saida' ? { selected: 'selected' } : {}) }),
      ])),
      field('Plano de conta', el('select', { class: 'pa-input', 'data-testid': 'fin-report-category', onchange: (event) => ctx.actions.setFinanceView({ finReportCategoryId: event.target.value }) }, [
        el('option', { value: '', text: 'Todos os planos de conta' }),
        ...categoryOptions.map(([id, category]) => el('option', { value: id, text: `${category?.code ? `${category.code} · ` : ''}${categoryName(id)}`, ...(selectedCategory === id ? { selected: 'selected' } : {}) })),
      ])),
    ]),
    el('p', { class: 'pa-hint', text: mode === 'aberto'
      ? 'Mostra o saldo que ainda falta receber ou pagar. Com datas selecionadas, o filtro usa o vencimento; pagamentos parciais já foram abatidos. Nas compras, os valores adicionais são distribuídos proporcionalmente ao saldo restante.'
      : 'Os valores consideram a data em que o dinheiro entrou ou saiu. Contas ainda em aberto e registros estornados não entram nos totais. Nas compras, frete, impostos, juros e encargos aparecem em contas próprias; os itens permanecem na categoria escolhida no registro.' }),
    el('div', { class: 'pa-statgrid' }, [statCard(mode === 'aberto' ? 'A receber' : 'Entradas recebidas', brl(inTotal), 'ok'), statCard(mode === 'aberto' ? 'A pagar' : 'Saídas pagas', brl(outTotal), outTotal ? 'warn' : 'soft'), statCard(mode === 'aberto' ? 'Diferença do filtro' : 'Saldo do filtro', brl(inTotal - outTotal), inTotal - outTotal >= 0 ? 'navy' : 'bad')]),
    el('h3', { class: 'pa-h3', text: 'Total por plano de conta' }),
    categoryRows.length ? el('div', { class: 'pa-table-scroll' }, el('table', { class: 'pa-kv pa-report' }, [el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Plano de conta' }), el('td', { class: 'pa-num', text: mode === 'aberto' ? 'A receber' : 'Entradas' }), el('td', { class: 'pa-num', text: mode === 'aberto' ? 'A pagar' : 'Saídas' })]), ...categoryRows])) : el('p', { class: 'pa-empty', text: 'Nenhuma conta encontrada para estes filtros.' }),
    el('h3', { class: 'pa-h3', text: mode === 'aberto' ? `Contas em aberto (${openTitleCount} título(s), ${movements.length} linha(s) por conta)` : `Lançamentos do filtro (${movements.length})` }),
    movementRows.length ? el('div', { class: 'pa-table-scroll' }, el('table', { class: 'pa-kv pa-report', 'data-testid': 'fin-report-movements' }, [el('tr', { class: 'pa-kv-total' }, [el('td', { text: mode === 'aberto' ? 'Vencimento' : 'Data' }), mode === 'aberto' && el('td', { text: 'Cliente / fornecedor' }), el('td', { text: 'Descrição' }), el('td', { text: 'Plano de conta' }), mode === 'aberto' && el('td', { text: 'Situação' }), el('td', { class: 'pa-num', text: mode === 'aberto' ? 'Saldo' : 'Valor' })]), ...movementRows])) : el('p', { class: 'pa-empty', text: 'Nenhum lançamento encontrado para estes filtros.' }),
    mode === 'realizado' && el('details', {}, [el('summary', { text: `Clientes inadimplentes (${overdueRows.length})` }), overdueRows.length ? el('table', { class: 'pa-kv pa-report' }, overdueRows) : el('p', { class: 'pa-empty', text: 'Nenhum cliente inadimplente.' }), el('p', { class: 'pa-hint', text: 'Consulta do saldo atual dos clientes; não segue os filtros deste relatório.' })]),
    mode === 'realizado' && el('p', { class: 'pa-hint', text: 'Saldo de caixa não é o mesmo que lucro. Perdas sem movimentação de dinheiro ficam fora deste relatório e continuam no relatório gerencial de produção.' }),
  ]);
}

const CATEGORY_KINDS = [
  ['despesaVariavel', 'Despesa Variável', 'Despesas Variáveis'],
  ['despesaFixa', 'Despesa Fixa', 'Despesas Fixas'],
  ['custo', 'Custo', 'Custos'],
  ['receita', 'Receita', 'Receitas'],
  ['perda', 'Perda', 'Perdas'],
];
const kindShort = (k) => ({ despesaFixa: 'Fixa', despesaVariavel: 'Variável', custo: 'Custo', receita: 'Receita', perda: 'Perda' }[k] || '');

/** <optgroup>s of the despesa-able categories (fixa/variável), subcategorias indented, archived hidden. */
function despesaCategoryGroups(store) {
  return [['despesaVariavel', 'Despesas Variáveis'], ['despesaFixa', 'Despesas Fixas'], ['custo', 'Custos']].map(([kind, label]) => {
    const cats = store.state.categories.filter((c) => c.kind === kind && !c.archived);
    const tops = cats.filter((c) => !c.parentId);
    const opts = [];
    for (const t of tops) {
      opts.push(el('option', { value: t.id, text: t.name }));
      for (const sub of cats.filter((c) => c.parentId === t.id)) opts.push(el('option', { value: sub.id, text: `— ${sub.name}` }));
    }
    for (const orphan of cats.filter((c) => c.parentId && !tops.some((t) => t.id === c.parentId))) opts.push(el('option', { value: orphan.id, text: orphan.name }));
    return opts.length ? el('optgroup', { label }, opts) : null;
  }).filter(Boolean);
}

function financeiroPanel(ctx) {
  const { store } = ctx;
  const month = ctx.view.financeMonth || currentMonth();
  const [dreYear, dreMonthNumber] = month.split('-').map(Number);
  const dreMonthStart = `${month}-01`;
  const dreMonthEnd = `${month}-${String(new Date(dreYear, dreMonthNumber, 0).getDate()).padStart(2, '0')}`;
  const type = ctx.view.financeType || 'todos';
  const catName = (id) => store.get('categories', id)?.name || '(sem categoria)';
  const movements = [];
  for (const s of store.state.sales) movements.push({ id: s.id, at: s.at, type: 'receita', label: store.get('products', s.productId)?.name || 'Venda rápida', description: s.channel || 'Venda', amount: (s.qty || 0) * (s.unitPrice || 0), reversalKind: 'sale', reversed: store.isReversed('sale', s.id) });
  for (const p of store.state.payments) {
    const enc = store.get('encomendas', p.encomendaId); const cli = enc?.clienteId ? store.get('clients', enc.clienteId) : null;
    movements.push({ id: p.id, at: p.at, type: 'receita', label: cli?.name || 'Pagamento de venda', description: ['Pagamento', p.forma].filter(Boolean).join(' · '), amount: p.valor || 0, reversalKind: 'payment', reversed: store.isReversed('payment', p.id) });
  }
  for (const income of store.state.incomes || []) movements.push({ id: income.id, at: income.at, type: 'receita', label: catName(income.categoryId), description: income.description || 'Outra receita', amount: income.valor || 0, reversalKind: 'income', reversed: store.isReversed('income', income.id) });
  for (const d of store.state.despesas) {
    const kind = store.get('categories', d.categoryId)?.kind;
    const movType = kind === 'custo' ? 'custo' : 'despesa';
    movements.push({ id: d.id, at: d.at, type: movType, label: catName(d.categoryId), description: [kindShort(kind), d.description].filter(Boolean).join(' · '), amount: d.valor || 0, reversalKind: 'despesa', reversed: store.isReversed('despesa', d.id) });
  }
  for (const v of store.state.variableCosts) movements.push({ id: v.id, at: v.at, type: 'custo', label: 'Custo antigo', description: v.note || '', amount: v.amount || 0, reversalKind: 'variableCost', reversed: store.isReversed('variableCost', v.id) });
  for (const st of store.state.financeSettlements) {
    const title = store.get('financeTitles', st.titleId); if (!title) continue;
    if (st.kind === 'client-payment-allocation' || st.kind === 'credit') continue;
    const kind = store.get('categories', title.categoryId)?.nature;
    const discount = st.kind === 'discount'; const loss = st.kind === 'loss';
    movements.push({ id: st.id, at: st.at, type: discount || loss ? 'despesa' : title.direction === 'receber' ? 'receita' : kind === 'custo' ? 'custo' : 'despesa', label: loss ? 'Perda com cliente' : discount ? 'Desconto concedido na quitação' : (title.partyName || title.description), description: [title.description, discount || loss ? 'sem movimento de caixa' : st.method].filter(Boolean).join(' · '), amount: st.amount || 0, reversalKind: 'financeSettlement', reversed: store.isReversed('financeSettlement', st.id), noncash: discount || loss });
  }
  for (const title of store.state.financeTitles) {
    const state = titleState(store, title); if (title.cancelledAt || state.balance <= 0.005) continue;
    const nature = store.get('categories', title.categoryId)?.nature;
    movements.push({ id: `pending-${title.id}`, at: title.dueDate, type: title.direction === 'receber' ? 'receita' : nature === 'custo' ? 'custo' : 'despesa', label: title.partyName || title.description, description: `${state.status === 'vencido' ? 'Vencido' : 'Pendente'} · ${title.description}`, amount: state.balance, pending: true });
  }
  for (const loss of store.state.perdas) movements.push({ id: loss.id, at: loss.at, type: 'custo', label: 'Perda de produção', description: loss.note || 'Sem saída de caixa', amount: loss.amount || 0, reversalKind: 'perda', reversed: store.isReversed('perda', loss.id), noncash: true });
  for (const a of store.state.cashAdjustments) movements.push({ id: a.id, at: a.at, type: a.direction === 'saida' ? 'despesa' : 'receita', label: a.kind === 'transfer' ? 'Transferência entre contas' : a.kind === 'client-payment' ? 'Pagamento total de cliente' : 'Ajuste financeiro', description: a.description || '', amount: a.amount || 0, reversalKind: 'cashAdjustment', reversed: store.isReversed('cashAdjustment', a.id), transfer: a.kind === 'transfer' });
  let items = movements.filter((m) => monthOf(m.at) === month);
  if (type !== 'todos') items = items.filter((m) => m.type === type);
  const hideReversals = ctx.view.finHideReversals !== false;
  if (hideReversals) items = items.filter((m) => !m.reversed);
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  const entrada = items.reduce((s, m) => !m.reversed && !m.pending && !m.noncash && !m.transfer && m.type === 'receita' ? s + m.amount : s, 0);
  const saida = items.reduce((s, m) => !m.reversed && !m.pending && !m.noncash && !m.transfer && m.type !== 'receita' ? s + m.amount : s, 0);
  const list = logList(items, (m) => el('li', { class: 'pa-list-item' + (m.reversed ? ' pa-reversed' : ''), 'data-search': `${m.label} ${m.description}` }, [
    el('div', { class: 'pa-grow' }, [el('div', {}, [el('strong', { text: m.label }), m.pending && el('span', { class: 'pa-badge pa-warn', text: 'previsto' }), m.noncash && el('span', { class: 'pa-badge', text: 'sem caixa' })].filter(Boolean)), el('span', { class: 'pa-muted', text: m.description })]),
    el('span', { class: `pa-num ${m.pending || m.noncash ? 'pa-muted' : m.type === 'receita' ? 'pa-positive' : 'pa-bad'}`, text: `${m.pending || m.noncash ? '◌' : m.type === 'receita' ? '+' : '−'} ${brl(m.amount)}` }),
    m.reversalKind && estornoControl(ctx, m.reversalKind, m.id),
  ]));
  const monthInput = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'fin-month', type: 'month', value: month });
  monthInput.addEventListener('change', () => ctx.actions.setFinanceMonth(monthInput.value || currentMonth()));
  const chip = (key, label) => el('button', { class: 'pa-chip' + (type === key ? ' pa-chip-on' : ''), onclick: () => ctx.actions.setFinanceType(key) }, label);
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Entradas e saídas' }), el('h2', { text: 'Lançamentos' })]),
      el('div', { class: 'pa-row pa-form' }, [
        el('button', { class: 'pa-btn pa-sm', 'data-testid': 'dre-month-open', onclick: () => ctx.actions.openModal({ kind: 'dre-preview', start: dreMonthStart, end: dreMonthEnd }) }, 'DRE do mês'),
        el('button', { class: 'pa-btn pa-sm', 'data-testid': 'cat-manage', onclick: () => ctx.actions.openModal({ kind: 'categorias' }) }, 'Categorias'),
        el('button', { class: 'pa-btn pa-sm', 'data-testid': 'fin-accounts-open', onclick: () => ctx.actions.openModal({ kind: 'finance-accounts' }) }, 'Contas e bancos'),
        el('button', { class: 'pa-btn pa-sm', 'data-testid': 'fin-methods-open', onclick: () => ctx.actions.openModal({ kind: 'finance-methods' }) }, 'Formas de pagamento'),
      ]),
    ]),
    el('div', { class: 'pa-actiongrid' }, [
      el('button', { class: 'pa-btn pa-primary', 'data-testid': 'fin-entry-new', onclick: () => ctx.actions.openModal({ kind: 'finance-title-add', direction: 'receber' }) }, '+ Nova entrada'),
      el('button', { class: 'pa-btn', 'data-testid': 'fin-exit-new', onclick: () => ctx.actions.openModal({ kind: 'finance-title-add', direction: 'pagar' }) }, '+ Nova saída'),
    ]),
    el('p', { class: 'pa-hint', text: 'Escolha apenas Entrada ou Saída. Dentro do lançamento você informa se já foi quitado ou se ficará pendente, além da data, categoria, forma de pagamento e conta financeira.' }),
    el('div', { class: 'pa-row pa-period-title' }, [el('span', { class: 'pa-lab', text: 'Mês de referência' }), monthInput]),
    el('div', { class: 'pa-statgrid' }, [statCard('Entradas', brl(entrada), 'ok'), statCard('Saídas', brl(saida), saida > 0 ? 'warn' : 'soft'), statCard('Saldo', brl(entrada - saida), entrada - saida >= 0 ? 'navy' : 'bad')]),
    el('div', { class: 'pa-chiprow' }, [chip('todos', 'Todos'), chip('receita', 'Receitas'), chip('despesa', 'Despesas'), chip('custo', 'Custos')]),
    el('label', { class: 'pa-toggle' }, [el('input', { type: 'checkbox', 'data-testid': 'fin-entries-hide-reversals', ...(hideReversals ? { checked: 'checked' } : {}), onchange: (event) => ctx.actions.setFinanceView({ finHideReversals: event.target.checked }) }), el('span', { text: 'Ocultar estornos' })]),
    items.length ? el('div', {}, [searchInput('Buscar movimentação…', list, 'fin-search'), list]) : el('p', { class: 'pa-empty', text: 'Nenhuma movimentação com este filtro.' }),
  ]);
}

MODALS['finance-adjustment'] = (ctx) => financeAdjustmentSheet(ctx);
function financeAdjustmentSheet(ctx) {
  const accounts = accountOptions(ctx.store);
  const kind = el('select', { class: 'pa-input', 'data-testid': 'fin-adjust-kind' }, [el('option', { value: 'adjustment', text: 'Ajuste de entrada ou saída' }), el('option', { value: 'transfer', text: 'Transferência entre contas' })]);
  const direction = el('select', { class: 'pa-input' }, [el('option', { value: 'entrada', text: 'Entrada' }), el('option', { value: 'saida', text: 'Saída' })]);
  const from = el('select', { class: 'pa-input' }, accounts.map((a) => el('option', { value: a.id, text: a.name }))); const to = el('select', { class: 'pa-input' }, accounts.map((a) => el('option', { value: a.id, text: a.name })));
  const date = el('input', { class: 'pa-input', type: 'date', value: todayInput() }); const amount = moneyField(null, 'fin-adjust-amount'); const description = el('input', { class: 'pa-input', type: 'text', placeholder: 'Motivo do ajuste' });
  const directionField = field('Tipo do ajuste', direction); const toField = field('Conta de destino', to);
  const reconcile = () => { const transfer = kind.value === 'transfer'; directionField.style.display = transfer ? 'none' : ''; toField.style.display = transfer ? '' : 'none'; };
  kind.addEventListener('change', reconcile); reconcile();
  function save() { const value = parseNum(amount.input.value); if (!(value > 0)) { amount.input.focus(); return; } if (kind.value === 'transfer' && from.value === to.value) { to.focus(); return; } ctx.actions.mutate((s) => s.addCashAdjustment({ id: uuid(), at: dateIso(date.value), kind: kind.value, direction: direction.value, amount: value, accountId: from.value || undefined, ...(kind.value === 'transfer' ? { toAccountId: to.value } : {}), description: description.value.trim() || (kind.value === 'transfer' ? 'Transferência' : 'Ajuste financeiro') })); }
  return sheet({ title: 'Ajuste financeiro', rows: [field('Operação', kind), field(kind.value === 'transfer' ? 'Conta de origem' : 'Conta', from), toField, directionField, field('Data', date), field('Valor', amount), field('Descrição', description), el('p', { class: 'pa-hint', text: 'Transferências mudam o dinheiro de lugar, mas não são receita nem despesa.' })], onSave: save, saveTestid: 'fin-adjust-save' });
}

MODALS['despesa-add'] = (ctx) => despesaSheet(ctx);
MODALS['income-add'] = (ctx) => incomeSheet(ctx);

function incomeSheet(ctx) {
  const { store } = ctx;
  const cats = store.state.categories.filter((c) => c.kind === 'receita' && !c.archived);
  const date = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'income-date', type: 'date', value: todayInput() });
  const preferred = cats.find((c) => norm(c.name).includes('outra')) || cats[0];
  const catSel = el('select', { class: 'pa-input', 'data-testid': 'income-cat' }, cats.map((c) => el('option', { value: c.id, text: c.name, ...(preferred && c.id === preferred.id ? { selected: 'selected' } : {}) })));
  const desc = el('input', { class: 'pa-input', 'data-testid': 'income-desc', type: 'text', placeholder: 'Ex.: oficina, reembolso, renda extra' });
  const amount = moneyField(null, 'income-amount');
  function save() {
    const valor = parseNum(amount.input.value);
    if (!(valor > 0)) { amount.input.focus(); return; }
    const at = date.value ? new Date(`${date.value}T12:00:00`).toISOString() : nowIso();
    ctx.actions.mutate((s) => s.addIncome({ id: uuid(), at, valor, categoryId: catSel.value || undefined, description: desc.value.trim() || 'Outra receita' }));
  }
  return sheet({ title: 'Lançar outra receita', rows: [field('Data', date), cats.length ? field('Categoria', catSel) : null, field('Descrição', desc), field('Valor recebido', amount), el('p', { class: 'pa-hint', text: 'Use somente para dinheiro que não veio de uma venda. Pagamentos de encomendas já entram sozinhos.' })].filter(Boolean), onSave: save, saveTestid: 'income-save' });
}

function despesaSheet(ctx) {
  const { store } = ctx;
  const groups = despesaCategoryGroups(store);
  const date = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'desp-date', type: 'date', value: todayInput() });
  const catSel = el('select', { class: 'pa-input', 'data-testid': 'desp-cat' }, groups);
  const desc = el('input', { class: 'pa-input', 'data-testid': 'desp-desc', type: 'text', placeholder: 'descrição (opcional)' });
  const amount = moneyField(null, 'desp-amount');
  function save() {
    const a = parseNum(amount.input.value);
    if (!catSel.value) { catSel.focus(); return; }
    if (a == null || !(a > 0)) { amount.input.focus(); return; }
    const at = date.value ? new Date(`${date.value}T12:00:00`).toISOString() : nowIso();
    ctx.actions.mutate((s) => s.addDespesa({ id: uuid(), at, valor: a, categoryId: catSel.value, ...(desc.value.trim() ? { description: desc.value.trim() } : {}) }));
  }
  if (!groups.length) {
    return sheet({ title: 'Lançar despesa', rows: [el('p', { class: 'pa-hint', text: 'Crie uma categoria de despesa primeiro — toque em “Categorias” na tela de Despesas.' })] });
  }
  return sheet({
    title: 'Lançar despesa',
    rows: [field('Data', date), field('Categoria', catSel), field('Descrição', desc), field('Valor', amount)],
    onSave: save, saveTestid: 'desp-add',
  });
}

MODALS['categorias'] = (ctx) => categoriasSheet(ctx);

const categoryNature = (kind) => kind === 'receita' ? 'receita' : kind === 'custo' || kind === 'perda' ? 'custo' : 'despesa';
const categoryRootKey = (kind) => kind === 'receita' ? 'receitas' : kind === 'custo' || kind === 'perda' ? 'custos' : 'despesas';
const categoryInUse = (store, id) => ['despesas', 'incomes', 'financeTitles', 'cashAdjustments']
  .some((collection) => store.state[collection].some((record) => record.categoryId === id))
  || store.state.categories.some((category) => category.parentId === id);
const categoryDirection = (category) => category.direction || (category.nature === 'receita' || category.kind === 'receita' ? 'receber' : 'pagar');
const categoryNameConflict = (store, name, direction, exceptId = '') => store.state.categories.some((category) =>
  !category.archived && category.id !== exceptId && categoryDirection(category) === direction && norm(category.name) === norm(name));
const categoryCodeConflict = (store, code, exceptId = '') => Boolean(code) && store.state.categories.some((category) =>
  !category.archived && category.id !== exceptId && String(category.code || '').trim() === code);
const categoryParents = (store, kind, exceptId = '') => store.state.categories.filter((category) =>
  !category.archived && !category.parentId && category.id !== exceptId && category.nature === categoryNature(kind));
function nextCategoryCode(store, parentId) {
  const parent = store.get('categories', parentId);
  if (!parent?.code) return '';
  const prefix = `${parent.code}.`;
  const used = new Set(store.state.categories.map((category) => String(category.code || '')));
  let number = 1;
  while (used.has(`${prefix}${number}`)) number++;
  return `${prefix}${number}`;
}

// Keep old category ids for financial history; archived categories stay available for inspection.
function categoriasSheet(ctx) {
  const { store } = ctx;
  const nameI = el('input', { class: 'pa-input pa-grow', 'data-testid': 'cat-name', type: 'text', placeholder: 'Nova categoria' });
  const codeI = el('input', { class: 'pa-input', 'data-testid': 'cat-code', type: 'text', placeholder: 'Código automático' });
  const kindSel = el('select', { class: 'pa-input', 'data-testid': 'cat-kind' }, CATEGORY_KINDS.map(([v, t]) => el('option', { value: v, text: t })));
  const parentSel = el('select', { class: 'pa-input', 'data-testid': 'cat-parent' });
  const error = el('p', { class: 'pa-sheet-msg', role: 'alert' });
  function fillParents() {
    const previous = parentSel.value;
    const root = categoryByKey(store, categoryRootKey(kindSel.value));
    const tops = categoryParents(store, kindSel.value);
    parentSel.replaceChildren(el('option', { value: '', text: '— categoria principal —' }), ...tops.map((top) => el('option', { value: top.id, text: top.name })));
    parentSel.value = tops.some((top) => top.id === previous) ? previous : tops.some((top) => top.id === root?.id) ? root.id : '';
  }
  fillParents();
  kindSel.addEventListener('change', fillParents);
  function add() {
    const nm = nameI.value.trim();
    const code = codeI.value.trim() || nextCategoryCode(store, parentSel.value);
    error.textContent = '';
    if (!nm) { error.textContent = 'Informe o nome da categoria.'; nameI.focus(); return; }
    if (categoryNameConflict(store, nm, kindSel.value === 'receita' ? 'receber' : 'pagar')) { error.textContent = 'Já existe uma categoria ativa com esse nome para esta operação.'; nameI.focus(); return; }
    if (categoryCodeConflict(store, code)) { error.textContent = 'Esse código já pertence a outra categoria ativa.'; codeI.focus(); return; }
    const parent = store.get('categories', parentSel.value);
    ctx.actions.mutateModal((s) => s.upsertCategory({ id: uuid(), name: nm, ...(code ? { code } : {}), kind: kindSel.value, nature: categoryNature(kindSel.value), cashFlowGroup: kindSel.value === 'perda' ? 'nao-caixa' : parent?.cashFlowGroup || 'operacional', ...(parentSel.value ? { parentId: parentSel.value } : {}) }));
  }

  const active = store.state.categories.filter((category) => !category.archived).slice()
    .sort((a, b) => String(a.code || '99').localeCompare(String(b.code || '99'), undefined, { numeric: true }) || a.name.localeCompare(b.name, 'pt-BR'));
  const archived = store.state.categories.filter((category) => category.archived).slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const catRow = (category) => el('li', { class: 'pa-list-item', 'data-testid': 'cat-row' }, [
    el('span', { class: 'pa-num pa-muted pa-category-code', text: category.code || '' }),
    el('div', { class: 'pa-grow pa-category-info' }, [el('strong', { text: `${category.parentId ? '— ' : ''}${category.name}` }), el('span', { class: 'pa-muted', text: [kindShort(category.kind) || category.nature, category.duplicateOf ? `Consolidada em ${store.get('categories', category.duplicateOf)?.name || 'outra categoria'}` : category.archived ? 'Arquivada' : 'Ativa'].join(' · ') })]),
    !category.archived && el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'cat-edit', onclick: () => ctx.actions.openModal({ kind: 'category-edit', id: category.id }) }, 'Editar'),
    !category.archived && el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Arquivar', onclick: () => {
      if (!window.confirm(`Arquivar a categoria “${category.name}”? Os lançamentos antigos continuam vinculados, mas ela sairá das novas escolhas.`)) return;
      ctx.actions.mutateModal((s) => s.upsertCategory({ ...category, archived: true }));
    } }, '🗄'),
    category.archived && !category.duplicateOf && el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => ctx.actions.mutateModal((s) => s.upsertCategory({ ...category, archived: false })) }, 'Reativar'),
    !category.archived && !category.systemKey && !categoryInUse(store, category.id) && el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Excluir categoria nunca usada', onclick: () => {
      if (!window.confirm(`Excluir a categoria “${category.name}”? Esta opção só está disponível porque ela não possui lançamentos vinculados.`)) return;
      ctx.actions.mutateModal((s) => s.removeCategory(category.id));
    } }, '✕'),
  ].filter(Boolean));

  return sheet({
    title: 'Organizar categorias',
    rows: [
      el('p', { class: 'pa-hint', text: 'Cada receita, custo ou despesa deve ter uma categoria clara. As cópias consolidadas ficam arquivadas; os lançamentos antigos continuam com seus vínculos.' }),
      field('Nova categoria', nameI),
      el('div', { class: 'pa-filtergrid' }, [field('Tipo', kindSel), field('Grupo principal', parentSel), field('Código (opcional)', codeI)]),
      error,
      el('div', { class: 'pa-row' }, [el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'cat-add', onclick: add }, '+ Adicionar')]),
      el('h3', { class: 'pa-h3', text: `Categorias ativas (${active.length})` }),
      el('ul', { class: 'pa-list pa-tight' }, active.map(catRow)),
      archived.length && el('details', {}, [el('summary', { text: `Categorias arquivadas (${archived.length})` }), el('ul', { class: 'pa-list pa-tight' }, archived.map(catRow))]),
      el('div', { class: 'pa-row pa-cardfoot' }, [el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'cat-done', onclick: () => ctx.actions.closeModal() }, 'Concluir')]),
    ].filter(Boolean),
  });
}

MODALS['category-edit'] = (ctx, modal) => categoryEditSheet(ctx, modal.id);
function categoryEditSheet(ctx, id) {
  const { store } = ctx;
  const category = store.get('categories', id);
  if (!category) return sheet({ title: 'Categoria não encontrada', rows: [] });
  const locked = Boolean(category.systemKey || categoryInUse(store, id));
  const name = el('input', { class: 'pa-input', type: 'text', value: category.name, 'data-testid': 'cat-edit-name' });
  const code = el('input', { class: 'pa-input', type: 'text', value: category.code || '', 'data-testid': 'cat-edit-code' });
  const kind = el('select', { class: 'pa-input', 'data-testid': 'cat-edit-kind' }, CATEGORY_KINDS.map(([value, label]) => el('option', { value, text: label, ...(value === category.kind ? { selected: 'selected' } : {}) })));
  const parent = el('select', { class: 'pa-input', 'data-testid': 'cat-edit-parent' });
  const fillParents = () => {
    const choices = categoryParents(store, kind.value, id);
    const root = categoryByKey(store, categoryRootKey(kind.value));
    const previous = parent.value || category.parentId;
    parent.replaceChildren(el('option', { value: '', text: '— categoria principal —' }), ...choices.map((item) => el('option', { value: item.id, text: item.name })));
    parent.value = choices.some((item) => item.id === previous) ? previous : choices.some((item) => item.id === root?.id) ? root.id : '';
  };
  fillParents(); kind.addEventListener('change', fillParents);
  const error = el('p', { class: 'pa-sheet-msg', role: 'alert' });
  function save() {
    const newName = name.value.trim(); const newCode = code.value.trim();
    const newKind = locked ? category.kind : kind.value;
    const newParentId = locked ? category.parentId : parent.value || undefined;
    error.textContent = '';
    if (!newName) { error.textContent = 'Informe o nome da categoria.'; name.focus(); return; }
    if (norm(newName) !== norm(category.name) && categoryNameConflict(store, newName, categoryDirection({ ...category, kind: newKind, nature: categoryNature(newKind) }), id)) { error.textContent = 'Já existe uma categoria ativa com esse nome para esta operação.'; name.focus(); return; }
    if (newCode !== String(category.code || '').trim() && categoryCodeConflict(store, newCode, id)) { error.textContent = 'Esse código já pertence a outra categoria ativa.'; code.focus(); return; }
    const parentCategory = store.get('categories', newParentId);
    const record = category.systemKey
      ? { ...category, name: newName, code: newCode, customName: newName !== DEFAULT_CHART.find((entry) => entry.systemKey === category.systemKey)?.name, customCode: newCode !== DEFAULT_CHART.find((entry) => entry.systemKey === category.systemKey)?.code }
      : { ...category, name: newName, code: newCode || undefined, kind: newKind, nature: locked ? category.nature : categoryNature(newKind), parentId: newParentId, cashFlowGroup: locked ? category.cashFlowGroup : newKind === 'perda' ? 'nao-caixa' : parentCategory?.cashFlowGroup || 'operacional' };
    ctx.actions.mutateModal((s) => s.upsertCategory(record));
    ctx.actions.openModal({ kind: 'categorias' });
  }
  return sheet({ title: `Editar categoria · ${category.name}`, rows: [
    field('Nome', name), field('Código do plano de contas', code),
    locked ? el('p', { class: 'pa-hint', text: category.systemKey ? 'Esta categoria faz parte do plano padrão. O tipo e o grupo são fixos para preservar os relatórios; nome e código podem ser editados.' : 'Esta categoria já tem lançamentos ou subcategorias. Para preservar o histórico, edite apenas o nome e o código.' }) : el('div', { class: 'pa-filtergrid' }, [field('Tipo', kind), field('Grupo principal', parent)]),
    error, el('button', { class: 'pa-btn pa-ghost', onclick: () => ctx.actions.openModal({ kind: 'categorias' }) }, '← Voltar às categorias'),
  ], onSave: save, saveTestid: 'cat-edit-save' });
}

// ── Perdas / baixas (Rev 03 #3 — value lost to waste) ────────────────────────────

const PERDA_KINDS = [['insumo', 'Insumo'], ['produto', 'Produto'], ['embalagem', 'Embalagem'], ['outro', 'Outro']];

function perdasPanel(ctx) {
  const { store } = ctx;
  const all = store.state.perdas.slice().sort((a, b) => (a.at < b.at ? 1 : -1));
  const month = ctx.view.logMonth;
  const items = month ? all.filter((p) => monthOf(p.at) === month) : all;
  const total = items.reduce((s, p) => (store.isReversed('perda', p.id) ? s : s + (p.amount || 0)), 0);
  const list = logList(items, (p) => {
    const kindLabel = PERDA_KINDS.find((k) => k[0] === p.refKind)?.[1] || 'Outro';
    const resolved = (p.refKind === 'insumo' && p.refId && store.get('ingredients', p.refId)?.name)
      || (p.refKind === 'produto' && p.refId && store.get('products', p.refId)?.name) || null;
    // Title = the lost item (Insumo/Produto) in bold; observação (note) below in smaller type.
    const title = resolved ? (p.qty ? `${resolved} · ${fmtNum(p.qty)}` : resolved) : (p.note || kindLabel);
    const subtitle = resolved ? (p.note || kindLabel) : (p.note ? kindLabel : '');
    return el('li', { class: 'pa-list-item' + (store.isReversed('perda', p.id) ? ' pa-reversed' : ''), 'data-search': `${resolved || ''} ${p.note || ''}` }, [
      el('div', { class: 'pa-grow' }, [
        el('div', {}, el('strong', { text: title })),
        subtitle && el('span', { class: 'pa-muted', text: subtitle }),
      ].filter(Boolean)),
      el('span', { class: 'pa-num pa-bad', text: `− ${brl(p.amount)}` }),
      estornoControl(ctx, 'perda', p.id),
    ]);
  });
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('h2', { class: 'pa-grow', text: 'Perdas' }),
      el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'perda-new', onclick: () => ctx.actions.openModal({ kind: 'perda-add' }) }, '+ Registrar'),
    ]),
    el('p', { class: 'pa-hint', text: 'O que se perdeu: massa que deu errado, produto que não vendeu, embalagem danificada. A perda afeta o resultado gerencial da produção, mas não cria outra saída de dinheiro.' }),
    all.length > 0 && logFilters(ctx, list, { searchPlaceholder: 'Buscar perda…', searchTestid: 'perda-search', monthTestid: 'perda-month' }),
    items.length > 0 && el('div', { class: 'pa-row pa-totals' }, [el('span', { class: 'pa-grow' }, [el('strong', { text: `Total${month ? ` (${monthLabel(month)})` : ''} ` }), brl(total)])]),
    all.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhuma perda registrada. Toque em “+ Registrar”.' })
      : items.length === 0 ? el('p', { class: 'pa-empty', text: 'Nenhuma perda neste mês.' }) : list,
  ].filter(Boolean));
}

MODALS['perda-add'] = (ctx) => perdaSheet(ctx);

function perdaSheet(ctx) {
  const { store } = ctx;
  const config = store.getConfig();
  const es = store.toEngineStore();
  const lens = estimateLens(config);
  const date = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'perda-date', type: 'date', value: todayInput() });
  const kind = el('select', { class: 'pa-input', 'data-testid': 'perda-kind' }, PERDA_KINDS.map(([v, t]) => el('option', { value: v, text: t })));
  const qty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'perda-qty', type: 'text', inputmode: 'decimal', placeholder: 'qtd', value: '1' });
  const refSel = el('select', { class: 'pa-input', 'data-testid': 'perda-ref' });
  const note = el('input', { class: 'pa-input', 'data-testid': 'perda-note', type: 'text', placeholder: 'descrição (opcional)' });
  const amount = moneyField(null, 'perda-amount');
  const refRow = el('div', { class: 'pa-row pa-form' }, [refSel, qty]);

  const unitCostOf = (k, id) => {
    try {
      if (k === 'insumo') return store.currentPrice(id);
      if (k === 'produto') return productUnitCost(es, id, config, lens);
    } catch { /* unpriced */ }
    return null;
  };
  function fillRefs() {
    const k = kind.value;
    const opts = (k === 'insumo' ? store.state.ingredients : k === 'produto' ? store.state.products : []).slice().sort(compareNamed);
    refSel.replaceChildren(...opts.map((o) => el('option', { value: o.id, text: o.name })));
    const refable = k === 'insumo' || k === 'produto';
    refRow.style.display = refable ? '' : 'none';
    recalc();
  }
  function recalc() {
    const k = kind.value;
    if (k !== 'insumo' && k !== 'produto') return; // 'embalagem'/'outro' → she types the amount
    const c = unitCostOf(k, refSel.value);
    const q = parseNum(qty.value) || 0;
    if (c != null) amount.input.value = fmtMoneyInput(c * q);
  }
  kind.addEventListener('change', fillRefs);
  refSel.addEventListener('change', recalc);
  qty.addEventListener('input', recalc);
  fillRefs();

  function save() {
    const a = parseNum(amount.input.value);
    if (a == null || !(a > 0)) { amount.input.focus(); return; }
    const k = kind.value;
    const refable = k === 'insumo' || k === 'produto';
    const ref = refable ? store.get(k === 'insumo' ? 'ingredients' : 'products', refSel.value) : null;
    const q = parseNum(qty.value);
    const noteText = note.value.trim() || (ref ? `${q} × ${ref.name}` : '');
    const at = date.value ? new Date(`${date.value}T12:00:00`).toISOString() : nowIso();
    ctx.actions.mutate((s) => s.addPerda({
      id: uuid(), at, amount: a, refKind: k,
      ...(refable && ref ? { refId: ref.id, qty: q } : {}),
      ...(noteText ? { note: noteText } : {}),
    }));
  }
  return sheet({
    title: 'Registrar perda',
    rows: [field('Data', date), field('Tipo', kind), refRow, field('Descrição (opcional)', note), field('Valor perdido', amount),
      el('p', { class: 'pa-hint', text: 'Para insumo ou produto, o valor já vem calculado pela quantidade — ajuste se precisar.' })],
    onSave: save, saveTestid: 'perda-add',
  });
}

// ── Relatórios (period P&L; §4.5 actuals) ────────────────────────────────────────

function relatoriosPanel(ctx) {
  const { store } = ctx;
  const month = ctx.view.reportMonth || currentMonth();
  const sum = monthSummary(store, month);
  const despCat = despesasByCategory(store, month);
  const sortKey = ctx.view.prodSort || 'lucro';
  const byProduct = productSummary(store, month).sort((a, b) =>
    sortKey === 'qtd' ? b.qty - a.qty : sortKey === 'faturamento' ? b.faturamento - a.faturamento : b.lucroEstimado - a.lucroEstimado);
  const byClient = clientSummary(store, month);

  const monthInput = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rel-month', type: 'month', value: month });
  monthInput.addEventListener('change', () => ctx.actions.setReportMonth(monthInput.value || currentMonth()));

  const kv = (label, value, cls, bad) => el('tr', cls ? { class: cls } : {}, [el('td', { text: label }), el('td', { class: 'pa-num' + (bad ? ' pa-bad' : ''), text: value })]);
  const empty = sum.recebido === 0 && sum.despesas === 0 && sum.faturado === 0 && sum.perdas === 0;

  // The cash-basis result.
  const resultado = el('table', { class: 'pa-kv' }, [
    el('tr', { class: 'pa-kv-sec' }, [el('td', { colspan: '2', text: 'Entrou' })]),
    kv('Recebido', brl(sum.recebido)),
    sum.recebidoOutrasReceitas > 0 && kv('Outras receitas', brl(sum.recebidoOutrasReceitas)),
    sum.faturado !== sum.recebidoVendas && kv('Vendas e encomendas do mês', brl(sum.faturado)),
    sum.aReceber > 0 && kv('A receber (saldo atual)', brl(sum.aReceber)),
    el('tr', { class: 'pa-kv-sec' }, [el('td', { colspan: '2', text: 'Saiu' })]),
    kv('Despesas variáveis', brl(sum.despVar)),
    kv('Despesas fixas', brl(sum.despFix)),
    sum.custos > 0 && kv('Custos', brl(sum.custos)),
    sum.perdas > 0 && kv('Perdas', brl(sum.perdas)),
          kv('Saldo de caixa', brl(sum.saldoCaixa), 'pa-kv-total', sum.saldoCaixa < 0),
    // Margem only when the month is profitable — on a stocking-up month (despesas ≫ recebido) the
    // % is extreme noise; the negative Lucro do mês already tells the story.
    sum.recebido > 0 && sum.lucro >= 0 && kv('Margem', `${(sum.margem * 100).toFixed(0)}%`),
  ].filter(Boolean));

  const prodSortBtn = (key, label) => el('button', { class: 'pa-chip' + (sortKey === key ? ' pa-chip-on' : ''), 'data-testid': `rel-sort-${key}`, onclick: () => ctx.actions.setProdSort(key) }, label);

  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-row' }, [
      el('h2', { class: 'pa-grow', text: 'Relatórios' }),
      el('span', { class: 'pa-lab', text: 'Mês' }), monthInput,
    ]),
    empty
      ? el('p', { class: 'pa-empty', text: 'Nada registrado neste mês.' })
      : el('div', {}, [
          resultado,
          el('p', { class: 'pa-hint', text: 'Saldo de caixa = dinheiro recebido − pagamentos realizados. Perdas sem pagamento no momento ficam separadas para não contar o mesmo custo duas vezes.' }),

          despCat.length > 0 && el('h3', { class: 'pa-h3', text: 'Despesas por categoria' }),
          despCat.length > 0 && el('table', { class: 'pa-kv pa-report' }, despCat.map((d) => el('tr', {}, [
            el('td', { text: d.name }), el('td', { class: 'pa-num', text: brl(d.total) }),
          ]))),

          el('h3', { class: 'pa-h3', text: 'Saldo de caixa nos últimos meses' }),
          barChart(revenueTrend(store, month, 6)),

          byProduct.length > 0 && el('div', { class: 'pa-row pa-h3row' }, [el('h3', { class: 'pa-h3 pa-grow', text: 'Por produto' }), prodSortBtn('lucro', 'Lucro'), prodSortBtn('qtd', 'Qtd'), prodSortBtn('faturamento', 'Faturamento')]),
          byProduct.length > 0 && el('table', { class: 'pa-kv pa-report' }, [
            el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Produto' }), el('td', { class: 'pa-num', text: 'Qtd' }), el('td', { class: 'pa-num', text: 'Fatur.' }), el('td', { class: 'pa-num', text: 'Lucro*' })]),
            ...byProduct.map((r) => el('tr', {}, [
              el('td', { text: r.name }),
              el('td', { class: 'pa-num', text: fmtNum(r.qty) }),
              el('td', { class: 'pa-num', text: brl(r.faturamento) }),
              el('td', { class: 'pa-num' + (r.lucroEstimado >= 0 ? '' : ' pa-bad'), text: brl(r.lucroEstimado) }),
            ])),
          ]),
          byProduct.length > 0 && el('p', { class: 'pa-hint', text: '* lucro por produto é uma estimativa (preço − custo da receita), para comparar produtos — não é o lucro do caixa acima.' }),

          byClient.length > 0 && el('h3', { class: 'pa-h3', text: 'Por cliente' }),
          byClient.length > 0 && el('table', { class: 'pa-kv pa-report' }, [
            el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Cliente' }), el('td', { class: 'pa-num', text: 'Comprou' }), el('td', { class: 'pa-num', text: 'Recebido' }), el('td', { class: 'pa-num', text: 'A receber' })]),
            ...byClient.map((c) => el('tr', {}, [
              el('td', { text: c.name }),
              el('td', { class: 'pa-num', text: brl(c.total) }),
              el('td', { class: 'pa-num', text: brl(c.recebido) }),
              el('td', { class: 'pa-num' + (c.saldo > 0.005 ? ' pa-bad' : ''), text: brl(c.saldo) }),
            ])),
          ]),

          el('div', { class: 'pa-row pa-form' }, [
            el('button', { class: 'pa-btn', 'data-testid': 'rel-export', onclick: () => downloadFile(`relatorio-${month}.csv`, reportCsv(month, sum, despCat, byProduct, byClient), 'text/csv') }, 'Exportar CSV'),
          ]),
        ].filter(Boolean)),
  ]);
}

/** Tiny zero-dependency SVG bar chart of monthly profit (green up / red down). */
function barChart(series) {
  const W = 320; const H = 132; const top = 10; const bottom = 26; const left = 6;
  const plotH = H - top - bottom;
  const vals = series.map((s) => s.lucro);
  const hasNeg = vals.some((v) => v < 0);
  const maxAbs = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const zeroY = hasNeg ? top + plotH / 2 : top + plotH;
  const scale = (hasNeg ? plotH / 2 : plotH) / maxAbs;
  const bw = (W - left * 2) / Math.max(1, series.length);

  const kids = [svgEl('line', { x1: left, y1: zeroY, x2: W - left, y2: zeroY, stroke: 'var(--au-border)' })];
  series.forEach((s, i) => {
    const x = left + i * bw + bw * 0.16;
    const w = bw * 0.68;
    const h = Math.max(1, Math.abs(s.lucro) * scale);
    const y = s.lucro >= 0 ? zeroY - h : zeroY;
    kids.push(svgEl('rect', { x, y, width: w, height: h, rx: 2, fill: s.lucro >= 0 ? 'var(--au-ok)' : '#b3261e' }));
    kids.push(svgEl('text', { x: x + w / 2, y: H - bottom + 14, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--au-fg-soft)' }, monthLabel(s.month)));
    kids.push(svgEl('text', { x: x + w / 2, y: s.lucro >= 0 ? y - 2 : y + h + 9, 'text-anchor': 'middle', 'font-size': 8, fill: 'var(--au-fg-soft)' }, `${Math.round(s.lucro)}`));
  });
  return svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pa-chart', width: '100%', preserveAspectRatio: 'xMidYMid meet' }, kids);
}

const csvCell = (v) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function reportCsv(month, sum, despCat, byProduct, byClient) {
  const n2 = (x) => x.toFixed(2).replace('.', ','); // pt-BR decimals; ';' separator
  const rows = [
    ['Relatório', month], [],
    ['Recebido', n2(sum.recebido)],
    ['Vendas e encomendas do mês', n2(sum.faturado)],
    ['A receber (saldo atual)', n2(sum.aReceber)],
    ['Despesas variáveis', n2(sum.despVar)],
    ['Despesas fixas', n2(sum.despFix)],
    ['Custos', n2(sum.custos || 0)],
    ['Perdas', n2(sum.perdas)],
    ['Saldo de caixa', n2(sum.saldoCaixa)],
    ['Margem %', (sum.margem * 100).toFixed(1).replace('.', ',')],
    [],
    ['Despesa (categoria)', 'Valor'],
    ...despCat.map((d) => [d.name, n2(d.total)]),
    [],
    ['Produto', 'Qtd', 'Faturamento', 'Lucro estimado'],
    ...byProduct.map((r) => [r.name, String(r.qty), n2(r.faturamento), n2(r.lucroEstimado)]),
    [],
    ['Cliente', 'Comprou', 'Recebido', 'A receber'],
    ...byClient.map((c) => [c.name, n2(c.total), n2(c.recebido), n2(c.saldo)]),
  ];
  return rows.map((r) => r.map(csvCell).join(';')).join('\n');
}

// ── Simulador (what-if: escalar a receita) ───────────────────────────────────────
//
// Natalia's menu-decision tool: "se eu aumentar a receita em 50% o rendimento sobe e a mão de obra
// sobe pouco → margem maior. Preciso disso pra decidir se mantenho, adapto ou tiro o produto."
// We run the REAL engine on a scaled throwaway recipe (ingredients + yield × factor → ingredient
// cost/un is invariant; only labor/gas/fixed per unit move with the new yield + minutes), then
// compare cost, margin and profit against the registered baseline.

/** Per-unit cost breakdown of recipe `recipeId` as if its batch were scaled, with editable times. */
function simulateRecipeBreakdown(store, recipeId, factor, production, active, oven, config) {
  const real = store.get('recipes', recipeId);
  const sim = {
    ...real,
    yieldNominal: real.yieldNominal * factor,
    productionMinutes: production, activeMinutes: active, ovenMinutes: oven,
    components: real.components.map((c) => ({ ...c, qty: c.qty * factor })), // ingredients scale with the batch
  };
  const raw = {
    ingredients: store.state.ingredients,
    recipes: store.state.recipes.map((r) => (r.id === recipeId ? sim : r)),
    products: store.state.products,
    priceChanges: store.state.priceChanges, batches: store.state.batches, sales: store.state.sales,
  };
  return costBreakdown(indexStore(raw), recipeId, config, estimateLens(config));
}
// Direct labor is diagnostic only: salaries and payroll charges already live in fixed costs.
const breakdownTotal = (b) => b.ingredients + (b.packaging || 0) + b.gas + b.fixed;

function simuladorPanel(ctx) {
  const { store } = ctx;
  const config = store.getConfig();
  const recipes = store.state.recipes;
  if (recipes.length === 0) {
    return el('section', { class: 'pa-card' }, [el('h2', { text: 'Simulador' }), el('p', { class: 'pa-empty', text: 'Crie uma receita primeiro.' })]);
  }
  const sel = el('select', { class: 'pa-input', 'data-testid': 'sim-recipe' }, recipes.map((r) => el('option', { value: r.id, text: r.name })));
  if (recipes.some((r) => r.id === ctx.view.simRecipeId)) sel.value = ctx.view.simRecipeId;
  const body = el('div', {});
  const rebuild = () => body.replaceChildren(simuladorBody(ctx, store.get('recipes', sel.value), config));
  sel.addEventListener('change', () => { ctx.view.simRecipeId = sel.value; rebuild(); });
  rebuild();
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [el('h2', { class: 'pa-grow', text: 'Simulador' })]),
    el('p', { class: 'pa-hint', text: 'Veja o que acontece com o custo e a margem se você fizer um lote maior — pra decidir se mantém, adapta ou tira um produto do cardápio.' }),
    field('Receita', sel),
    body,
  ]);
}

function simuladorBody(ctx, recipe, config) {
  const { store } = ctx;
  let baseBreak;
  try { baseBreak = costBreakdown(store.toEngineStore(), recipe.id, config, estimateLens(config)); }
  catch (e) { return el('p', { class: 'pa-status', text: friendlyError(e) }); }
  const baseRecipeCost = breakdownTotal(baseBreak);
  const product = linkedProductForRecipe(store, recipe.id);
  const recipeComponent = product?.components?.find((component) => component.kind === 'recipe' && component.id === recipe.id);
  const recipeQty = Number(recipeComponent?.qty) || 1;
  let registeredProductCost = baseRecipeCost * recipeQty + (Number(recipe.packagingCost) || 0);
  if (product) {
    try { registeredProductCost = productUnitCost(store.toEngineStore(), product.id, config, estimateLens(config)); }
    catch { /* keep the recipe-only cost */ }
  }
  const registeredExtras = Math.max(0, registeredProductCost - baseRecipeCost * recipeQty);

  const rates = effectiveSalesRates(product || recipe, config);
  const salesRate = rates.total;
  const fmtHora = (v) => (v == null ? '—' : brl(v));
  const factor = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'sim-factor', type: 'text', inputmode: 'decimal', value: '1,5' });
  const production = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'sim-production', type: 'text', inputmode: 'numeric', value: String(recipe.productionMinutes ?? ((Number(recipe.activeMinutes) || 0) + (Number(recipe.ovenMinutes) || 0))) });
  const active = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'sim-active', type: 'text', inputmode: 'numeric', value: String(recipe.activeMinutes) });
  const oven = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'sim-oven', type: 'text', inputmode: 'numeric', value: String(recipe.ovenMinutes) });
  const packaging = moneyField(registeredExtras, 'sim-packaging');
  const initialMargin = product?.targetMarginPct ?? recipe.targetMarginPct ?? config.targetMarginPct;
  const targetMargin = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'sim-margin', type: 'text', inputmode: 'decimal', value: String(pct(initialMargin)).replace('.', ',') });
  const initialPrice = product && product.salePrice != null && product.salePrice !== ''
    ? Number(product.salePrice) : priceFromCost(registeredProductCost, { ...config, ...rates, targetMarginPct: initialMargin });
  const price = moneyField(initialPrice, 'sim-price');
  const results = el('div', { 'data-testid': 'sim-results' });
  // Capture the registered scenario once. Inputs below belong only to the simulated column.
  const basePrice = initialPrice;
  const baseTargetPrice = 1 - salesRate - initialMargin > 0
    ? registeredProductCost / (1 - salesRate - initialMargin) : null;

  function recompute() {
    let f = parseNum(factor.value); if (!(f > 0)) f = 1;
    const t = parseNum(production.value) || 0;
    const a = parseNum(active.value) || 0;
    const o = parseNum(oven.value) || 0;
    const p = parseNum(price.input.value) || 0;
    const extras = Math.max(0, parseNum(packaging.input.value) || 0);
    const target = Math.max(0, (parseNum(targetMargin.value) || 0) / 100);
    let simBreak;
    try { simBreak = simulateRecipeBreakdown(store, recipe.id, f, t, a, o, config); }
    catch (e) { results.replaceChildren(el('p', { class: 'pa-status', text: friendlyError(e) })); return; }
    const simRecipeCost = breakdownTotal(simBreak);
    const baseYield = Number(recipe.yieldNominal) || 0;
    const simYield = baseYield * f;
    const baseProductUnits = recipeQty > 0 ? baseYield / recipeQty : 0;
    const simProductUnits = recipeQty > 0 ? simYield / recipeQty : 0;
    const baseRecipeTotal = baseRecipeCost * baseYield;
    const simRecipeTotal = simRecipeCost * simYield;
    const baseIngredientsTotal = baseBreak.ingredients * baseYield;
    const simIngredientsTotal = simBreak.ingredients * simYield;
    const baseLaborIndicator = baseBreak.labor * baseYield;
    const simLaborIndicator = simBreak.labor * simYield;
    // The recipe roll-up includes ingredients, gas, and proportional fixed costs. Add each
    // sellable product's packaging/complements so the displayed batch total is fully loaded.
    const baseTotalCost = baseRecipeTotal + registeredExtras * baseProductUnits;
    const simTotalCost = simRecipeTotal + extras * simProductUnits;
    const baseRevenue = basePrice * baseProductUnits;
    const simRevenue = p * simProductUnits;
    const totalProfit = (revenue, cost) => revenue - cost - revenue * salesRate;
    const baseProfit = totalProfit(baseRevenue, baseTotalCost);
    const simProfit = totalProfit(simRevenue, simTotalCost);
    const margin = (revenue, cost) => revenue > 0 ? totalProfit(revenue, cost) / revenue : 0;
    const baseProductionMinutes = Number(recipe.productionMinutes) || (Number(recipe.activeMinutes) || 0) + (Number(recipe.ovenMinutes) || 0);
    const profitHour = (profit, minutes) => minutes > 0 ? profit / (minutes / 60) : null;
    const divisor = 1 - salesRate - target;
    const simCostPerProduct = simProductUnits > 0 ? simTotalCost / simProductUnits : 0;
    const baseCostPerProduct = baseProductUnits > 0 ? baseTotalCost / baseProductUnits : 0;
    const baseProfitPerProduct = baseProductUnits > 0 ? baseProfit / baseProductUnits : 0;
    const simProfitPerProduct = simProductUnits > 0 ? simProfit / simProductUnits : 0;
    const targetPrice = divisor > 0 ? simCostPerProduct / divisor : null;
    const col = (atual, simu, fmt) => [el('td', { class: 'pa-num', text: fmt(atual) }), el('td', { class: 'pa-num pa-strong', text: fmt(simu) })];
    const explained = (label, explanation) => el('td', {}, [
      el('span', { text: label }), el('span', { class: 'pa-sim-explain', text: `(${explanation})` }),
    ]);
    const reachedTarget = margin(simRevenue, simTotalCost) + 0.0001 >= target;
    results.replaceChildren(el('table', { class: 'pa-kv pa-sim' }, [
      el('tr', { class: 'pa-sim-head' }, [el('td', {}), el('td', { class: 'pa-num', text: 'Atual' }), el('td', { class: 'pa-num', text: `Simulado (${fmtNum(f)}×)` })]),
      el('tr', {}, [el('td', { text: 'Rendimento da receita' }), ...col(baseYield, simYield, (v) => `${fmtNum(v)} ${recipe.yieldUnit}`)]),
      el('tr', {}, [el('td', { text: 'Unidades vendáveis deste lote' }), ...col(baseProductUnits, simProductUnits, (v) => fmtNum(v))]),
      el('tr', {}, [el('td', { text: 'Custo total dos ingredientes' }), ...col(baseIngredientsTotal, simIngredientsTotal, brl)]),
      el('tr', {}, [el('td', { text: 'Custo da receita (ingredientes, gás e fixos)' }), ...col(baseRecipeTotal, simRecipeTotal, brl)]),
      el('tr', {}, [el('td', { text: 'Embalagem e complementos do lote' }), ...col(registeredExtras * baseProductUnits, extras * simProductUnits, brl)]),
      el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Custo total da receita com embalagem' }), ...col(baseTotalCost, simTotalCost, brl)]),
      el('tr', {}, [el('td', { text: 'Custo por produto (unidade vendida)' }), ...col(baseCostPerProduct, simCostPerProduct, brl)]),
      el('tr', {}, [explained('Mão de obra direta', 'minutos ativos × valor da hora; apenas indicador'), ...col(baseLaborIndicator, simLaborIndicator, brl)]),
      el('tr', {}, [el('td', { text: 'Preço de venda por produto' }), ...col(basePrice, p, brl)]),
      el('tr', {}, [el('td', { text: 'Faturamento se vender o lote inteiro' }), ...col(baseRevenue, simRevenue, brl)]),
      el('tr', {}, [explained('Margem desejada', 'meta: quanto você quer que sobre de cada venda, em %'), ...col(initialMargin, target, pctStr)]),
      el('tr', {}, [explained('Margem líquida no preço informado', 'quanto realmente sobra depois dos custos e taxas, em %'), el('td', { class: 'pa-num', text: pctStr(margin(baseRevenue, baseTotalCost)) }), el('td', { class: `pa-num pa-strong${reachedTarget ? ' pa-positive' : ' pa-bad'}`, text: pctStr(margin(simRevenue, simTotalCost)) })]),
      el('tr', {}, [el('td', { text: 'Lucro total da receita' }), ...col(baseProfit, simProfit, brl)]),
      el('tr', {}, [el('td', { text: 'Lucro por produto' }), ...col(baseProfitPerProduct, simProfitPerProduct, brl)]),
      el('tr', {}, [el('td', { text: 'Lucro por hora de produção' }), ...col(profitHour(baseProfit, baseProductionMinutes), profitHour(simProfit, t), fmtHora)]),
      el('tr', { class: 'pa-kv-total' }, [explained('Preço para margem desejada', 'valor por produto para alcançar a meta acima'), el('td', { class: 'pa-num', text: baseTargetPrice == null ? 'Margem inválida' : brl(baseTargetPrice) }), el('td', { class: 'pa-num', text: targetPrice == null ? 'Margem inválida' : brl(targetPrice) })]),
    ]), el('p', { class: reachedTarget ? 'pa-status' : 'pa-callout', text: reachedTarget ? 'A simulação alcança a margem desejada com o preço informado.' : `A margem ficou abaixo da meta. Considere preço próximo de ${targetPrice == null ? '—' : brl(targetPrice)} ou reveja embalagem, rendimento e tempo.` }));
  }
  [factor, production, active, oven, packaging.input, targetMargin, price.input].forEach((i) => i.addEventListener('input', recompute));
  recompute();

  return el('div', {}, [
    el('p', { class: 'pa-muted', text: `Atual: rende ${fmtNum(recipe.yieldNominal)} ${recipe.yieldUnit} · ${recipe.productionMinutes ?? ((Number(recipe.activeMinutes) || 0) + (Number(recipe.ovenMinutes) || 0))}min de produção · ${recipe.activeMinutes}min ativos · ${recipe.ovenMinutes}min forno${product ? ` · produto ${product.name}` : ''}` }),
    el('h3', { class: 'pa-h3', text: 'E se eu fizer um lote maior?' }),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Escala' }), factor, el('span', { class: 'pa-lab', text: '× a receita' })]),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Tempo total de produção do lote simulado (min)' }), production]),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Minutos ativos do lote simulado' }), active, el('span', { class: 'pa-lab', text: 'Minutos de forno do lote simulado' }), oven]),
    el('p', { class: 'pa-hint', text: 'A escala aumenta ingredientes e rendimento, mas mantém os tempos cadastrados até você alterá-los acima. Se o lote maior exigir mais tempo, informe: tempo total para ratear custos fixos e calcular lucro por hora; minutos ativos de trabalho direto, inclusive embalar, para o indicador de mão de obra; minutos de forno para o gás. A mão de obra não é somada novamente ao custo, pois salários já entram nos custos fixos.' }),
    el('div', { class: 'pa-filtergrid' }, [field('Embalagem e complementos por produto', packaging), field('Margem desejada no cenário (meta de lucro sobre a venda, em %)', targetMargin), field('Preço de venda para testar', price)]),
    el('p', { class: 'pa-hint', text: 'A coluna Atual usa os valores cadastrados e permanece fixa. A margem desejada altera o preço recomendado; o lucro do cenário depende do preço de venda informado. Lucro ou margem negativos indicam que este preço não cobre o custo e os percentuais de venda.' }),
    el('p', { class: 'pa-hint', text: product ? 'Embalagem e complementos começam com a diferença entre o custo total do produto e a parte da receita. Você pode alterar livremente para comparar cenários.' : 'Esta receita ainda não está vinculada a um produto. Informe manualmente embalagem e preço para fazer a simulação.' }),
    el('p', { class: 'pa-hint', text: `Taxa de pagamento + comissão + imposto variável considerados nos dois cenários: ${pctStr(salesRate)}.` }),
    results,
  ]);
}

// ── Ajustes (config + Dropbox) ───────────────────────────────────────────────────

function automaticConfigSuggestions(store) {
  const today = new Date();
  const months = [];
  // An unfinished month understates recurring expenses and production capacity.
  // Use up to the last three completed calendar months for every suggestion.
  for (let i = 3; i >= 1; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const start = `${months[0]}-01`;
  const lastCompleteDay = new Date(today.getFullYear(), today.getMonth(), 0);
  const end = `${lastCompleteDay.getFullYear()}-${String(lastCompleteDay.getMonth() + 1).padStart(2, '0')}-${String(lastCompleteDay.getDate()).padStart(2, '0')}`;
  const actual = cashMovements(store).filter((m) => !m.transfer && dateOnly(m.at) >= start && dateOnly(m.at) <= end);
  const category = (m) => m.categoryId ? store.get('categories', m.categoryId) : null;
  const fixedExcluded = new Set(['tarifas']);
  // These recurring operating costs have no separate per-recipe rate in the engine.
  // Include their monthly average in the same production-time allocation as overhead.
  const monthlyOverhead = new Set(['energia-producao', 'limpeza', 'manutencao']);
  const isMonthlyOverhead = (category) => {
    const seen = new Set();
    for (let current = category; current && !seen.has(current.id); current = current.parentId ? store.get('categories', current.parentId) : null) {
      if (monthlyOverhead.has(current.systemKey)) return true;
      seen.add(current.id);
    }
    return false;
  };
  const fixed = actual.filter((m) => {
    const c = category(m);
    return m.direction === 'saida' && c &&
      (c.kind === 'despesaFixa' || c.behavior === 'fixa' || isMonthlyOverhead(c)) &&
      !fixedExcluded.has(c.systemKey);
  });
  const fixedMonths = new Set(fixed.map((m) => dateOnly(m.at).slice(0, 7)));
  const fixedTotal = fixed.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  const gasTotal = actual.filter((m) => m.direction === 'saida' && category(m)?.systemKey === 'gas-producao').reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  const laborTotal = actual.filter((m) => m.direction === 'saida' && ['pro-labore', 'salarios'].includes(category(m)?.systemKey)).reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  const tariffTotal = actual.filter((m) => m.direction === 'saida' && category(m)?.systemKey === 'tarifas').reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  const salesReceived = actual.filter((m) => m.direction === 'entrada' && category(m)?.systemKey === 'vendas').reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  const batches = store.state.batches.filter((b) => dateOnly(b.at) >= start && dateOnly(b.at) <= end);
  const convertSimple = (value, from, to) => {
    if (from === to) return value;
    if (from === 'kg' && to === 'g') return value * 1000;
    if (from === 'g' && to === 'kg') return value / 1000;
    if (from === 'l' && to === 'ml') return value * 1000;
    if (from === 'ml' && to === 'l') return value / 1000;
    return value;
  };
  const recipeMinutesPerUnit = (recipeId, phase, stack = new Set()) => {
    const recipe = store.get('recipes', recipeId);
    if (!recipe || stack.has(recipeId) || !(Number(recipe.yieldNominal) > 0)) return 0;
    stack.add(recipeId);
    const recipePhase = phase === 'productionMinutes'
      ? (Number(recipe.productionMinutes) || (Number(recipe.activeMinutes) || 0) + (Number(recipe.ovenMinutes) || 0))
      : (Number(recipe[phase]) || 0);
    let total = recipePhase / Number(recipe.yieldNominal);
    for (const component of recipe.components || []) if (component.ref?.kind === 'recipe') {
      const sub = store.get('recipes', component.ref.id);
      if (sub) total += convertSimple(Number(component.qty) || 0, component.unit, sub.yieldUnit) * recipeMinutesPerUnit(sub.id, phase, stack);
    }
    stack.delete(recipeId);
    return total;
  };
  const productMinutesPerUnit = (productId, phase, stack = new Set()) => {
    const product = store.get('products', productId);
    if (!product || stack.has(productId)) return 0;
    stack.add(productId);
    let total = 0;
    for (const component of product.components || []) {
      if (component.kind === 'recipe') total += (Number(component.qty) || 0) * recipeMinutesPerUnit(component.id, phase);
      else if (component.kind === 'product' && !isBundleProduct(product)) total += (Number(component.qty) || 0) * productMinutesPerUnit(component.id, phase, stack);
    }
    stack.delete(productId);
    return total;
  };
  const commandas = store.state.comandas.filter((c) => dateOnly(c.date || c.id) >= start && dateOnly(c.date || c.id) <= end);
  const estimatedFromCommandas = (phase) => commandas.reduce((sum, command) => sum + (command.itens || []).reduce((itemSum, item) => itemSum + (Number(item.realizado) || 0) * productMinutesPerUnit(item.productId, phase), 0), 0);
  const hasBatches = batches.length > 0;
  const activeMinutes = hasBatches
    ? batches.reduce((sum, b) => sum + (Number(b.activeMinutes) || Number(store.get('recipes', b.recipeId)?.activeMinutes) || 0), 0)
    : estimatedFromCommandas('activeMinutes');
  const ovenMinutes = hasBatches
    ? batches.reduce((sum, b) => sum + (Number(b.ovenMinutes) || Number(store.get('recipes', b.recipeId)?.ovenMinutes) || 0), 0)
    : estimatedFromCommandas('ovenMinutes');
  const productionMinutes = hasBatches
    ? batches.reduce((sum, b) => {
        const recipe = store.get('recipes', b.recipeId);
        return sum + (Number(b.productionMinutes) || Number(recipe?.productionMinutes) || (Number(b.activeMinutes ?? recipe?.activeMinutes) || 0) + (Number(b.ovenMinutes ?? recipe?.ovenMinutes) || 0));
      }, 0)
    : estimatedFromCommandas('productionMinutes');
  const productionMonths = new Set((hasBatches ? batches.map((b) => b.at) : commandas.filter((c) => (c.itens || []).some((it) => (Number(it.realizado) || 0) > 0)).map((c) => c.date || c.id)).map((iso) => dateOnly(iso).slice(0, 7)));
  const clockSessions = workClockSessions(store).sessions.filter((session) => dateOnly(session.start.at) >= start && dateOnly(session.start.at) <= end);
  const clockHours = clockSessions.reduce((sum, session) => sum + session.minutes / 60, 0);
  return {
    period: `${fmtDate(`${start}T12:00:00`)} a ${fmtDate(`${end}T12:00:00`)}`,
    values: {
      custosFixosMes: fixedMonths.size ? fixedTotal / fixedMonths.size : null,
      taxaGas: gasTotal > 0 && ovenMinutes > 0 ? gasTotal / ovenMinutes : null,
      valorHora: laborTotal > 0 && (clockHours > 0 || activeMinutes > 0) ? laborTotal / (clockHours || (activeMinutes / 60)) : null,
      expectedProductionMinutesMonth: productionMonths.size && productionMinutes > 0 ? productionMinutes / productionMonths.size : null,
    },
    observedFeePct: tariffTotal > 0 && salesReceived > 0 ? tariffTotal / salesReceived : null,
    facts: { fixedMonths: fixedMonths.size, gasTotal, laborTotal, tariffTotal, salesReceived, productions: hasBatches ? batches.length : commandas.length, productionSource: hasBatches ? 'tempos reais' : 'estimativa das comandas', activeMinutes, ovenMinutes, productionMinutes, clockHours, clockSessions: clockSessions.length },
  };
}

const SETTINGS_HELPERS = {
  valorHora: {
    title: 'Calcular o valor da sua hora', configKey: 'valorHora', suffix: 'R$/h',
    intro: 'Este valor serve como indicador de esforço. Salários, pró-labore e encargos continuam nos custos fixos e não serão somados duas vezes.',
    fields: [['monthlyPay', 'Salários + pró-labore + encargos no mês (R$)'], ['monthlyHours', 'Horas ativas de trabalho no mês']],
    calculate: (v) => v.monthlyPay > 0 && v.monthlyHours > 0 ? v.monthlyPay / v.monthlyHours : null,
    explanation: 'salários, pró-labore e encargos ÷ horas ativas',
  },
  taxaGas: {
    title: 'Calcular o gás por minuto', configKey: 'taxaGas', suffix: 'R$/min',
    intro: 'Use o valor pago no botijão ou na recarga e uma estimativa de quantos minutos de forno ele dura.',
    fields: [['gasCost', 'Valor do botijão ou recarga (R$)'], ['gasMinutes', 'Duração estimada em minutos de forno']],
    calculate: (v) => v.gasCost > 0 && v.gasMinutes > 0 ? v.gasCost / v.gasMinutes : null,
    explanation: 'valor do gás ÷ minutos de uso do forno',
  },
  custosFixosMes: {
    title: 'Somar os custos fixos do mês', configKey: 'custosFixosMes', suffix: 'R$/mês',
    intro: 'Informe a média mensal de cada gasto apenas uma vez. Inclua energia da produção aqui se ela ainda não entrar em outro custo. Campos vazios contam como zero.',
    fields: [['rent', 'Aluguel, condomínio e IPTU'], ['utilities', 'Água e energia de toda a operação'], ['internet', 'Internet e telefone'], ['payroll', 'Salários, pró-labore, diaristas e encargos'], ['accounting', 'Contador'], ['taxes', 'DAS, licenças e taxas fixas'], ['cleaning', 'Limpeza e higiene'], ['maintenance', 'Manutenção e reposição de equipamentos'], ['systems', 'Sistemas e assinaturas'], ['other', 'Outros custos fixos']],
    calculate: (v) => Object.values(v).reduce((sum, value) => sum + Math.max(0, value || 0), 0),
    explanation: 'soma dos custos fixos informados',
  },
  expected: {
    title: 'Calcular o tempo total de produção mensal', configKey: 'expectedProductionMinutesMonth', suffix: 'min/mês',
    intro: 'Considere o tempo total em que a estrutura da confeitaria fica dedicada à produção.',
    fields: [['workDays', 'Dias de produção por mês'], ['hoursPerDay', 'Horas de produção por dia']],
    calculate: (v) => v.workDays > 0 && v.hoursPerDay > 0 ? v.workDays * v.hoursPerDay * 60 : null,
    explanation: 'dias de produção × horas produtivas × 60',
  },
  margin: {
    title: 'Estimar uma margem-alvo', configKey: 'targetMarginPct', suffix: '%', percent: true,
    intro: 'A margem é uma decisão do negócio. Esta conta ajuda a partir do faturamento e do lucro que você gostaria de alcançar.',
    fields: [['revenue', 'Faturamento mensal esperado (R$)'], ['profit', 'Lucro que deseja ter no mês (R$)']],
    calculate: (v) => v.revenue > 0 && v.profit >= 0 ? (v.profit / v.revenue) * 100 : null,
    explanation: 'lucro desejado ÷ faturamento esperado',
  },
  fee: {
    title: 'Calcular a taxa média de pagamento', configKey: 'paymentFeePct', suffix: '%', percent: true,
    intro: 'Use um mês comum: some as taxas de cartão, maquininha e plataformas e compare com o que recebeu.',
    fields: [['fees', 'Total de taxas pagas no mês (R$)'], ['received', 'Total recebido no mês (R$)']],
    calculate: (v) => v.received > 0 && v.fees >= 0 ? (v.fees / v.received) * 100 : null,
    explanation: 'taxas pagas ÷ total recebido',
  },
  commission: {
    title: 'Calcular a comissão média sobre vendas', configKey: 'commissionPct', suffix: '%', percent: true,
    intro: 'Informe o total de comissões pagas e o valor das vendas que geraram essas comissões.',
    fields: [['commissions', 'Total de comissões no período (R$)'], ['sales', 'Total de vendas no período (R$)']],
    calculate: (v) => v.sales > 0 && v.commissions >= 0 ? (v.commissions / v.sales) * 100 : null,
    explanation: 'comissões pagas ÷ vendas correspondentes',
  },
};

MODALS['settings-helper'] = (ctx, modal) => settingsHelperSheet(ctx, modal.key);
function settingsHelperSheet(ctx, key) {
  const spec = SETTINGS_HELPERS[key];
  if (!spec) return sheet({ title: 'Ajuda de cálculo', rows: [el('p', { class: 'pa-empty', text: 'Este cálculo não está disponível.' })] });
  const savedInputs = ctx.store.getConfig().settingsHelperInputs?.[key] || {};
  const inputs = Object.fromEntries(spec.fields.map(([fieldKey]) => [fieldKey, el('input', { class: 'pa-input', type: 'text', inputmode: 'decimal', placeholder: '0', value: savedInputs[fieldKey] ?? '' })]));
  const result = el('div', { class: 'pa-callout' });
  let calculated = null;
  const recompute = () => {
    const values = Object.fromEntries(Object.entries(inputs).map(([fieldKey, input]) => [fieldKey, parseNum(input.value) || 0]));
    calculated = spec.calculate(values);
    result.replaceChildren(calculated == null || !Number.isFinite(calculated)
      ? el('span', { text: 'Preencha os dados acima para ver o resultado.' })
      : el('div', {}, [el('span', { text: 'Resultado sugerido: ' }), el('strong', { text: `${fmtNum(calculated)} ${spec.suffix}` }), el('p', { class: 'pa-hint', text: `Cálculo: ${spec.explanation}.` })]));
  };
  Object.values(inputs).forEach((input) => input.addEventListener('input', recompute));
  recompute();
  const save = () => {
    if (calculated == null || !Number.isFinite(calculated) || calculated < 0) { Object.values(inputs)[0].focus(); return; }
    const stored = spec.percent ? calculated / 100 : calculated;
    const current = ctx.store.getConfig();
    const otherRates = ['targetMarginPct', 'paymentFeePct', 'commissionPct', 'salesTaxPct']
      .filter((rateKey) => rateKey !== spec.configKey)
      .reduce((sum, rateKey) => sum + (Number(current[rateKey]) || 0), 0);
    if (spec.percent && stored + otherRates >= 1) { window.alert('O resultado precisa ficar abaixo de 100% quando somado à margem, à taxa, à comissão e ao imposto sobre a venda.'); return; }
    const entered = Object.fromEntries(Object.entries(inputs).map(([fieldKey, input]) => [fieldKey, input.value.trim()]));
    ctx.actions.mutate((store) => store.setConfig({
      [spec.configKey]: stored,
      settingsHelperInputs: { ...(store.getConfig().settingsHelperInputs || {}), [key]: entered },
    }));
  };
  return sheet({ title: spec.title, rows: [el('p', { class: 'pa-hint', text: spec.intro }), Object.keys(savedInputs).length > 0 && el('p', { class: 'pa-hint', text: 'Dados do último cálculo aplicado. Você pode alterá-los e usar um novo resultado.' }), ...spec.fields.map(([fieldKey, label]) => field(label, inputs[fieldKey])), result].filter(Boolean), onSave: save, saveLabel: 'Usar este resultado', saveTestid: `settings-helper-${key}` });
}

function ajustesPanel(ctx) {
  const { store } = ctx;
  const c = store.getConfig();
  const automatic = automaticConfigSuggestions(store);
  const f = {};
  const draft = ctx.view.settingsDraft || (ctx.view.settingsDraft = {});
  const field = (key, label, value, hint, helperKey) => {
    const input = el('input', { class: 'pa-input pa-narrow', type: 'text', inputmode: 'decimal', value: draft[key] ?? String(value).replace('.', ',') });
    input.addEventListener('input', () => { draft[key] = input.value; });
    f[key] = input;
    return el('div', { class: 'pa-field' }, [el('label', { text: label }), el('div', { class: 'pa-row' }, [input, helperKey && el('button', { class: 'pa-btn pa-ghost pa-sm', type: 'button', onclick: () => ctx.actions.openModal({ kind: 'settings-helper', key: helperKey }) }, 'Calcular comigo')].filter(Boolean)), hint && el('span', { class: 'pa-hint', text: hint })]);
  };

  function save() {
    const labels = {
      valorHora: 'valor da hora', taxaGas: 'gás por minuto', custosFixosMes: 'custos fixos',
      expected: 'minutos de produção', margin: 'margem', fee: 'taxa de pagamento', commission: 'comissão', salesTax: 'imposto sobre a venda',
    };
    for (const [key, label] of Object.entries(labels)) {
      if (!Object.hasOwn(draft, key)) continue;
      const value = parseNum(f[key].value);
      if (value == null || value < 0 || (key === 'expected' && value === 0)) {
        window.alert(`Informe um valor válido para ${label}${key === 'expected' ? ' (maior que zero)' : ''}.`);
        f[key].focus();
        return;
      }
    }
    const next = {
      valorHora: parseNum(f.valorHora.value) ?? c.valorHora,
      taxaGas: parseNum(f.taxaGas.value) ?? c.taxaGas,
      custosFixosMes: parseNum(f.custosFixosMes.value) ?? c.custosFixosMes,
      expectedProductionMinutesMonth: parseNum(f.expected.value) ?? c.expectedProductionMinutesMonth ?? c.expectedActiveMinutesMonth,
      targetMarginPct: (parseNum(f.margin.value) ?? pct(c.targetMarginPct)) / 100,
      paymentFeePct: (parseNum(f.fee.value) ?? pct(c.paymentFeePct)) / 100,
      commissionPct: (parseNum(f.commission.value) ?? pct(c.commissionPct || 0)) / 100,
      salesTaxPct: (parseNum(f.salesTax.value) ?? pct(c.salesTaxPct || 0)) / 100,
    };
    const keys = { valorHora: 'valorHora', taxaGas: 'taxaGas', custosFixosMes: 'custosFixosMes', expected: 'expectedProductionMinutesMonth', margin: 'targetMarginPct', fee: 'paymentFeePct', commission: 'commissionPct', salesTax: 'salesTaxPct' };
    const changed = Object.fromEntries(Object.entries(keys).filter(([inputKey]) => Object.hasOwn(draft, inputKey)).map(([inputKey, configKey]) => [configKey, next[configKey]]));
    const prospective = { ...store.getConfig(), ...changed };
    if (prospective.targetMarginPct + prospective.paymentFeePct + prospective.commissionPct + (prospective.salesTaxPct || 0) >= 1) {
      window.alert('Margem, taxa de pagamento, comissão e imposto sobre a venda precisam somar menos de 100%.');
      return;
    }
    ctx.view.settingsDraft = null;
    ctx.actions.setConfig(changed);
  }

  const autoRows = [
    ['Valor da hora', automatic.values.valorHora, 'R$/h', automatic.facts.clockHours > 0 ? `${fmtNum(automatic.facts.clockHours)} h observadas no ponto` : automatic.facts.activeMinutes > 0 ? `${fmtNum(automatic.facts.activeMinutes / 60)} h · ${automatic.facts.productionSource}` : 'registre horários ou produção'],
    ['Horas registradas no ponto', automatic.facts.clockHours || null, 'h', automatic.facts.clockSessions ? `${automatic.facts.clockSessions} período(s) encerrado(s)` : 'inicie e encerre suas atividades em Início'],
    ['Gás por minuto', automatic.values.taxaGas, 'R$/min', automatic.facts.ovenMinutes > 0 ? `${fmtNum(automatic.facts.ovenMinutes)} min · ${automatic.facts.productionSource}` : 'registre produção e tempo de forno'],
    ['Custos fixos por mês', automatic.values.custosFixosMes, 'R$', automatic.facts.fixedMonths ? `${automatic.facts.fixedMonths} mês(es) com lançamentos` : 'lance despesas fixas pagas'],
    ['Minutos de produção por mês', automatic.values.expectedProductionMinutesMonth, 'min', automatic.facts.productions ? `${automatic.facts.productions} registro(s) · ${automatic.facts.productionSource}` : 'registre produção nas comandas'],
  ].map(([label, value, unit, source]) => el('div', { class: 'pa-auto-row' }, [
    el('div', { class: 'pa-grow' }, [el('strong', { text: label }), el('span', { class: 'pa-muted', text: source })]),
    el('strong', { class: value == null ? 'pa-muted' : 'pa-positive', text: value == null ? 'dados insuficientes' : (unit === 'R$' ? brl(value) : `${fmtNum(value)} ${unit}`) }),
  ]));
  const applicable = Object.fromEntries(Object.entries(automatic.values).filter(([, value]) => value != null && Number.isFinite(value)));
  const applyAutomatic = () => {
    ctx.view.settingsDraft = null;
    ctx.actions.setConfig({ ...applicable });
  };

  return el('section', {}, [
    el('section', { class: 'pa-card' }, [
      el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Custos e formação de preço' }), el('h2', { text: 'Ajustes' })])]),
      el('p', { class: 'pa-hint', text: 'Os valores salvos à esquerda já são usados para calcular custos e preços. Compare com os dados registrados antes de decidir se quer substituí-los.' }),
      el('div', { class: 'pa-settings-grid' }, [
        el('section', { class: 'pa-settings-column' }, [
          el('h3', { class: 'pa-h3', text: 'Seus valores atuais' }),
          field('valorHora', 'Valor da hora de mão de obra (indicador)', c.valorHora, 'Usado para analisar o esforço dos minutos ativos; não é somado novamente ao custo.', 'valorHora'),
          field('taxaGas', 'Gás por minuto de forno (R$/min)', c.taxaGas, null, 'taxaGas'),
          field('custosFixosMes', 'Custos fixos no mês (R$, inclui DAS)', c.custosFixosMes, null, 'custosFixosMes'),
          field('expected', 'Minutos totais de produção esperados no mês', c.expectedProductionMinutesMonth ?? c.expectedActiveMinutesMonth, null, 'expected'),
          field('margin', 'Margem alvo (%)', pct(c.targetMarginPct), null, 'margin'),
          field('fee', 'Taxa de pagamento (%)', pct(c.paymentFeePct), null, 'fee'),
          field('commission', 'Comissão sobre vendas (%)', pct(c.commissionPct || 0), 'Entra na formação do preço da mesma forma que a taxa de pagamento.', 'commission'),
          field('salesTax', 'Tributo variável sobre faturamento (%) — para formar preço', pct(c.salesTaxPct || 0), 'É só uma estimativa para a precificação; não cria lançamento na DRE. Deixe 0% se paga apenas o DAS mensal fixo. Registre DAS, taxas de nota fiscal e tributos efetivos no Financeiro, na categoria apropriada, sem contar o mesmo valor duas vezes.'),
          el('div', { class: 'pa-row pa-form' }, [el('button', { class: 'pa-btn pa-primary', onclick: save }, 'Salvar e usar valores manuais')]),
        ]),
        el('aside', { class: 'pa-settings-column pa-auto-card', 'data-testid': 'automatic-settings' }, [
          el('h3', { class: 'pa-h3', text: 'Calculado pelo sistema' }),
          el('p', { class: 'pa-hint', text: `Estimativas a partir dos pagamentos e da produção registrados entre ${automatic.period} (meses completos). Confira se todos os gastos foram lançados.` }),
          ...autoRows,
          el('div', { class: 'pa-auto-row' }, [el('div', { class: 'pa-grow' }, [el('strong', { text: 'Taxa financeira observada' }), el('span', { class: 'pa-muted', text: 'tarifas ÷ recebimentos; apenas comparação' })]), el('strong', { class: automatic.observedFeePct == null ? 'pa-muted' : '', text: automatic.observedFeePct == null ? 'dados insuficientes' : pctStr(automatic.observedFeePct) })]),
          el('button', { class: 'pa-btn pa-primary', 'data-testid': 'apply-automatic-settings', disabled: Object.keys(applicable).length === 0, onclick: applyAutomatic }, 'Adotar valores calculados na precificação'),
          el('p', { class: 'pa-hint', text: 'Este botão substitui apenas os valores calculáveis acima: custo fixo mensal, gás, tempo de produção e valor da hora (indicador). A margem, a taxa de pagamento, a comissão e o imposto sobre a venda continuam como você salvou à esquerda.' }),
        ]),
      ]),
    ]),
    orderPaymentDueCard(ctx),
    patrimonioCard(ctx),
    notificationSettingsCard(ctx),
    shoppingSettingsCard(ctx),
    empresaCard(ctx),
    dadosCard(ctx),
    trashPanel(ctx),
    dropboxPanel(ctx),
  ]);
}

function patrimonioCard(ctx) {
  const assets = ctx.store.state.assets.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const month = todayInput().slice(0, 7);
  const monthEnd = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0);
  const end = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`;
  const current = assets.reduce((sum, asset) => sum + assetDepreciation(asset, `${month}-01`, end), 0);
  return el('section', { class: 'pa-card', 'data-testid': 'settings-assets' }, [
    el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Máquinas e itens duráveis' }), el('h2', { text: 'Patrimônio e depreciação' })]), el('button', { class: 'pa-btn pa-primary pa-sm', onclick: () => ctx.actions.openModal({ kind: 'asset-edit' }) }, '+ Bem')]),
    el('p', { class: 'pa-hint', text: 'Informe o custo do bem, valor residual, data em que começou a ser usado e vida útil estimada. A compra fica fora do lucro imediato; o desgaste estimado entra na DRE durante o uso. Registre também a compra no Financeiro para acompanhar o caixa.' }),
    el('p', { class: 'pa-hint', text: `Depreciação estimada neste mês: ${brl(current)}. O cálculo usa linha reta e distribui dias parciais proporcionalmente.` }),
    assets.length ? el('ul', { class: 'pa-list pa-tight' }, assets.map((asset) => el('li', { class: 'pa-list-item' }, [
      el('div', { class: 'pa-grow' }, [el('strong', { text: asset.name }), el('span', { class: 'pa-muted', text: `${asset.use === 'producao' ? 'Produção' : 'Administrativo'} · ${brl(asset.cost)} · ${asset.usefulMonths} meses · desde ${fmtDate(`${asset.inUseDate}T12:00:00`)}` })]),
      el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => ctx.actions.openModal({ kind: 'asset-edit', id: asset.id }) }, 'Editar'),
    ]))) : el('p', { class: 'pa-empty', text: 'Nenhum bem cadastrado. A DRE ainda não calcula depreciação.' }),
  ]);
}

MODALS['asset-edit'] = (ctx, modal) => assetEditSheet(ctx, modal.id);
function assetEditSheet(ctx, id) {
  const asset = id ? ctx.store.get('assets', id) : null;
  const name = el('input', { class: 'pa-input', type: 'text', value: asset?.name || '', placeholder: 'Ex.: forno elétrico' });
  const cost = el('input', { class: 'pa-input', type: 'text', inputmode: 'decimal', value: asset?.cost != null ? fmtMoneyInput(asset.cost) : '' });
  const residual = el('input', { class: 'pa-input', type: 'text', inputmode: 'decimal', value: asset?.residualValue != null ? fmtMoneyInput(asset.residualValue) : '0' });
  const months = el('input', { class: 'pa-input', type: 'number', min: '1', step: '1', value: asset?.usefulMonths || '60' });
  const start = el('input', { class: 'pa-input', type: 'date', value: asset?.inUseDate || todayInput() });
  const disposal = el('input', { class: 'pa-input', type: 'date', value: asset?.disposalDate || '' });
  const use = el('select', { class: 'pa-input' }, [['producao', 'Produção'], ['administracao', 'Administrativo']].map(([value, label]) => el('option', { value, text: label, ...(value === (asset?.use || 'producao') ? { selected: 'selected' } : {}) })));
  const error = el('p', { class: 'pa-sheet-msg', role: 'alert' });
  const save = () => {
    const value = parseNum(cost.value); const rest = parseNum(residual.value); const life = Number(months.value);
    if (!name.value.trim() || !(value > 0) || rest == null || rest < 0 || rest >= value || !Number.isSafeInteger(life) || life < 1 || !start.value || (disposal.value && disposal.value < start.value)) {
      error.textContent = 'Confira nome, custo positivo, valor residual menor que o custo, vida útil em meses e datas.';
      return;
    }
    if (asset && !window.confirm(`Salvar alterações de ${asset.name}? A DRE histórica pode ser recalculada.`)) return;
    ctx.actions.mutate((store) => store.upsertAsset({ ...(asset || { id: uuid() }), name: name.value.trim(), cost: value, residualValue: rest, usefulMonths: life, inUseDate: start.value, disposalDate: disposal.value || undefined, use: use.value }));
  };
  const remove = asset && el('button', { class: 'pa-btn pa-ghost', onclick: () => {
    if (!window.confirm(`Excluir ${asset.name} do patrimônio? O cálculo de depreciação será removido da DRE, inclusive dos períodos anteriores.`)) return;
    ctx.actions.mutate((store) => store.removeAsset(asset.id));
  } }, 'Excluir bem');
  return sheet({ title: asset ? 'Editar bem do patrimônio' : 'Novo bem do patrimônio', rows: [
    field('Bem', name), field('Custo de aquisição (R$)', cost), field('Valor residual esperado ao fim do uso (R$)', residual),
    field('Vida útil estimada (meses)', months), field('Disponível para uso desde', start), field('Uso principal', use),
    field('Data da baixa/venda (opcional)', disposal),
    el('p', { class: 'pa-hint', text: 'Se a aquisição foi registrada como investimento em Lançamentos, ela não reduz o lucro integralmente. A depreciação será custo de produção ou despesa administrativa conforme o uso principal.' }),
    error, remove,
  ].filter(Boolean), onSave: save, saveLabel: 'Salvar bem' });
}

function orderPaymentDueCard(ctx) {
  const configuredDays = Number(ctx.store.getConfig().orderPaymentDueDays);
  const currentDays = Number.isSafeInteger(configuredDays) && configuredDays >= 0 ? configuredDays : 0;
  const input = el('input', { class: 'pa-input pa-narrow', type: 'number', min: '0', step: '1', value: String(currentDays), 'data-testid': 'order-payment-due-days' });
  const overdue = listTitles(ctx.store, { direction: 'receber', status: 'vencido' }).filter((row) => !row.title.cancelledAt);
  const overdueTotal = overdue.reduce((sum, row) => sum + row.balance, 0);
  const save = () => {
    const days = Number(input.value);
    if (input.value.trim() === '' || !Number.isSafeInteger(days) || days < 0) {
      input.setCustomValidity('Informe um número inteiro de dias igual ou maior que zero.');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
    ctx.actions.setConfig({ orderPaymentDueDays: days });
  };
  input.addEventListener('input', () => input.setCustomValidity(''));
  return el('section', { class: 'pa-card', 'data-testid': 'order-payment-due-settings' }, [
    el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Contas a receber' }), el('h2', { text: 'Vencimento das encomendas' })])]),
    el('p', { class: 'pa-hint', text: 'Defina quantos dias após a entrega o pagamento deve vencer. Zero dia significa vencimento na própria data da entrega. Uma encomenda com saldo pendente passa a constar como vencida no dia seguinte ao vencimento.' }),
    el('div', { class: 'pa-field' }, [el('label', { text: 'Prazo padrão após a entrega (dias)' }), input]),
    el('p', { class: 'pa-hint', text: 'O prazo vale para encomendas existentes e futuras. Datas de vencimento alteradas manualmente na conta a receber são preservadas.' }),
    el('div', { class: 'pa-row pa-form' }, [el('button', { class: 'pa-btn pa-primary', type: 'button', onclick: save }, 'Salvar prazo')]),
    el('p', { text: `${overdue.length} conta(s) a receber vencida(s) · saldo ${brl(overdueTotal)}` }),
    el('button', { class: 'pa-btn pa-ghost', type: 'button', onclick: () => { ctx.actions.setFinanceView({ finStatus: 'vencido', finPartyId: '', finMethod: '', finReceivePeriod: 'all', finReceiveStart: '', finReceiveEnd: '' }); ctx.actions.setTab('fin-receber'); } }, 'Ver contas vencidas'),
  ]);
}

// Dados da empresa (Rev 06) — recibo header. Stored in config (synced/backed up), never in source.
function empresaCard(ctx) {
  const emp = ctx.store.getConfig().empresa || {};
  const draft = ctx.view.companyDraft || (ctx.view.companyDraft = {});
  let logo = draft.logo ?? emp.logo ?? '';
  const f = {};
  const tf = (key, label, ph) => {
    const i = el('input', { class: 'pa-input', 'data-testid': `emp-${key}`, type: 'text', placeholder: ph || '', value: draft[key] ?? emp[key] ?? '' });
    i.addEventListener('input', () => { draft[key] = i.value; });
    f[key] = i;
    return el('div', { class: 'pa-field' }, [el('label', { text: label }), i]);
  };
  const preview = el('div', { class: 'pa-logo-preview' });
  const renderPreview = () => preview.replaceChildren(logo
    ? el('img', { src: logo, alt: 'logo', class: 'pa-logo-img' })
    : el('span', { class: 'pa-hint', text: 'Sem logo ainda.' }));
  renderPreview();
  const fileInput = el('input', {
    type: 'file', accept: 'image/png,image/jpeg', style: 'display:none', 'data-testid': 'emp-logo-file',
    onchange: (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { logo = String(reader.result); draft.logo = logo; renderPreview(); };
      reader.readAsDataURL(file);
      e.target.value = '';
    },
  });
  function save() {
    ctx.view.companyDraft = null;
    ctx.actions.setConfig({ empresa: {
      nome: f.nome.value.trim(), cnpj: f.cnpj.value.trim(), endereco: f.endereco.value.trim(),
      telefone: f.telefone.value.trim(), responsavel: f.responsavel.value.trim(), logo,
    } });
  }
  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Dados da empresa' }),
    el('p', { class: 'pa-hint', text: 'Aparecem no cabeçalho do recibo. Ficam só no seu aparelho e no backup — não vão pro código.' }),
    tf('nome', 'Nome', 'Quitutes do Paiol'),
    tf('cnpj', 'CNPJ / MEI', '00.000.000/0001-00'),
    tf('endereco', 'Endereço'),
    tf('telefone', 'Telefone / contato'),
    tf('responsavel', 'Responsável'),
    el('div', { class: 'pa-field' }, [
      el('label', { text: 'Logo' }),
      preview,
      el('div', { class: 'pa-row pa-form' }, [
        el('button', { class: 'pa-btn pa-sm', 'data-testid': 'emp-logo-btn', onclick: () => fileInput.click() }, 'Escolher imagem'),
        logo && el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => { logo = ''; draft.logo = ''; renderPreview(); } }, 'Remover'),
      ].filter(Boolean)),
      fileInput,
    ]),
    el('div', { class: 'pa-row pa-form' }, [el('button', { class: 'pa-btn pa-primary', 'data-testid': 'emp-save', onclick: save }, 'Salvar dados da empresa')]),
  ]);
}

function dadosCard(ctx) {
  const fileInput = el('input', {
    type: 'file', accept: '.yaml,.yml,.txt', style: 'display:none', 'data-testid': 'import-file',
    onchange: async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try { ctx.actions.importData(await f.text()); }
      catch (err) { ctx.actions.importFailed(String(err && err.message ? err.message : err)); }
      e.target.value = '';
    },
  });
  // Excel (.xlsx) — the friendly, formatted face of the same name-based interchange.
  const xlsxInput = el('input', {
    type: 'file', accept: '.xlsx', style: 'display:none', 'data-testid': 'xlsx-file',
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const data = await parseInterchange(bytes);
        ctx.actions.openModal({ kind: 'import-xlsx', data, preview: previewExchange(ctx.store, data), filename: file.name });
      } catch (err) { ctx.actions.importFailed(String((err && err.message) || err)); }
      e.target.value = '';
    },
  });
  const xlsxExportBtn = el('button', { class: 'pa-btn', 'data-testid': 'xlsx-export' }, '🟢 Exportar planilha');
  xlsxExportBtn.addEventListener('click', async () => {
    const orig = xlsxExportBtn.textContent; xlsxExportBtn.textContent = 'Gerando…'; xlsxExportBtn.disabled = true;
    try { downloadFile('paiol-planilha.xlsx', await workbookBytes(ctx.store), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); }
    catch (e) { window.alert('Não foi possível gerar a planilha: ' + ((e && e.message) || e)); }
    finally { xlsxExportBtn.textContent = orig; xlsxExportBtn.disabled = false; }
  });

  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Dados' }),
    el('h3', { class: 'pa-h3', text: 'Planilha (Excel)' }),
    el('div', { class: 'pa-row pa-form' }, [
      xlsxExportBtn,
      el('button', { class: 'pa-btn', 'data-testid': 'xlsx-import', onclick: () => xlsxInput.click() }, '🟢 Importar planilha'),
      xlsxInput,
    ]),
    el('p', { class: 'pa-hint', text: 'Baixa seus insumos, receitas e produtos numa planilha bonita (uma aba por receita). Edite no Excel e importe de volta — mostra um resumo antes, mescla pelos nomes e não apaga nada.' }),
    el('h3', { class: 'pa-h3', text: 'Backup completo' }),
    el('div', { class: 'pa-row pa-form' }, [
      el('button', {
        class: 'pa-btn pa-primary', 'data-testid': 'backup-extra', disabled: ctx.view.backupBusy,
        onclick: () => {
          downloadFile(`paiol-backup-${backupFileStamp()}.yaml`, ctx.store.toYaml());
          void ctx.actions.backupExtra();
        },
      }, ctx.view.backupBusy ? 'Criando backup…' : 'Criar backup extra agora'),
      el('button', { class: 'pa-btn', 'data-testid': 'import-btn', onclick: () => fileInput.click() }, 'Importar dados'),
      fileInput,
    ]),
    el('p', { class: 'pa-hint', text: 'Baixa todos os dados deste negócio neste aparelho. Se o Dropbox estiver conectado, também cria uma cópia extra na pasta de backups da nuvem. A opção Importar dados acima importa apenas o catálogo.' }),
    el('h3', { class: 'pa-h3', text: 'Limpeza dos registros de teste' }),
    el('p', { class: 'pa-hint', text: 'Remove todos os pedidos e estorna as despesas, pagamentos e vendas rápidas existentes. As contas ligadas a esses registros serão canceladas. Guarde um backup completo antes de continuar.' }),
    el('button', { class: 'pa-btn pa-ghost', 'data-testid': 'clear-orders-expenses', onclick: () => {
      const orders = ctx.store.state.encomendas.length;
      const expenses = ctx.store.state.despesas.filter((item) => !ctx.store.isReversed('despesa', item.id)).length
        + ctx.store.state.variableCosts.filter((item) => !ctx.store.isReversed('variableCost', item.id)).length;
      const payables = ctx.store.state.financeTitles.filter((item) => item.direction === 'pagar' && !item.cancelledAt).length;
      if (!window.confirm(`Limpar ${orders} pedido(s), ${expenses} despesa(s) e cancelar ${payables} conta(s) a pagar? Os pedidos poderão ser recuperados da lixeira por 30 dias. Confirme somente depois de baixar o backup completo.`)) return;
      ctx.actions.mutate((store) => store.clearOrdersAndExpenses(nowIso(), uuid));
      window.alert('Limpeza concluída. Pedidos na lixeira e lançamentos financeiros estornados.');
    } }, 'Limpar pedidos e despesas'),
  ]);
}

function notificationSettingsCard(ctx) {
  const notices = ctx.store.state.notifications.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return el('section', { class: 'pa-card', 'data-testid': 'notification-settings' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Agenda e lembretes' }), el('h2', { text: 'Notificações' })]),
      el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'notification-new', onclick: () => ctx.actions.openModal({ kind: 'notification-add' }) }, '+ Notificação'),
    ]),
    el('p', { class: 'pa-hint', text: 'A notificação aparece no Início somente na data marcada e sai de lá quando você indicar que foi feita. O histórico completo permanece aqui.' }),
    ...(notices.length ? notices.map((notice) => el('div', { class: `pa-detail-card${notice.done ? ' pa-reversed' : ''}`, 'data-testid': 'notification-history-item' }, [
      el('div', { class: 'pa-row' }, [
        el('div', { class: 'pa-grow' }, [el('strong', { text: notice.title || 'Lembrete' }), el('span', { class: 'pa-muted', text: `${fmtDate(`${notice.date}T12:00:00`)}${notice.notes ? ` · ${notice.notes}` : ''}` })]),
        el('span', { class: notice.done ? 'pa-badge' : 'pa-badge pa-warn', text: notice.done ? 'Feito' : 'Pendente' }),
      ]),
      el('div', { class: 'pa-row pa-form' }, [
        el('button', { class: 'pa-btn pa-sm', onclick: () => ctx.actions.mutate((store) => store.upsertNotification({ ...notice, done: !notice.done, doneAt: !notice.done ? nowIso() : undefined })) }, notice.done ? 'Reabrir' : 'Marcar feito'),
        el('button', { class: 'pa-btn pa-sm', onclick: () => ctx.actions.openModal({ kind: 'notification-edit', id: notice.id }) }, 'Editar'),
        el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => { if (window.confirm('Enviar esta notificação para a lixeira?')) ctx.actions.mutate((store) => store.removeNotification(notice.id, nowIso())); } }, 'Excluir'),
      ]),
    ])) : [el('p', { class: 'pa-empty', text: 'Nenhuma notificação criada.' })]),
  ]);
}

MODALS['notification-add'] = (ctx) => notificationSheet(ctx);
MODALS['notification-edit'] = (ctx, modal) => notificationSheet(ctx, ctx.store.get('notifications', modal.id));
function notificationSheet(ctx, notice = null) {
  const date = el('input', { class: 'pa-input', type: 'date', value: notice?.date || todayInput(), 'data-testid': 'notification-date' });
  const title = el('input', { class: 'pa-input', type: 'text', value: notice?.title || '', placeholder: 'Ex.: Confirmar encomenda da Maria', 'data-testid': 'notification-title' });
  const notes = el('textarea', { class: 'pa-input', rows: '3', value: notice?.notes || '', placeholder: 'Detalhes opcionais' });
  const save = () => {
    if (!date.value) { date.focus(); return; }
    if (!title.value.trim()) { title.focus(); return; }
    ctx.actions.mutate((store) => store.upsertNotification({ ...(notice || {}), id: notice?.id || uuid(), date: date.value, title: title.value.trim(), notes: notes.value.trim() || undefined, done: Boolean(notice?.done), createdAt: notice?.createdAt || nowIso() }));
  };
  return sheet({ title: notice ? 'Editar notificação' : 'Nova notificação', rows: [field('Data em que deve aparecer', date), field('Lembrete', title), field('Detalhes', notes)], onSave: save, saveTestid: 'notification-save' });
}

function shoppingSettingsCard(ctx) {
  const automatic = inventorySummary(ctx.store).filter((row) => row.low && !row.ingredient.shoppingHidden);
  const manual = ctx.store.state.shoppingItems.filter((item) => !item.done).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
  const name = el('input', { class: 'pa-input pa-grow', type: 'text', placeholder: 'Ex.: Papel manteiga', 'data-testid': 'shopping-name' });
  const qty = el('input', { class: 'pa-input pa-narrow', type: 'text', inputmode: 'decimal', placeholder: 'Qtd.' });
  const unit = el('input', { class: 'pa-input pa-narrow', type: 'text', placeholder: 'un, kg…' });
  const add = () => {
    if (!name.value.trim()) { name.focus(); return; }
    ctx.actions.mutate((store) => store.upsertShoppingItem({ id: uuid(), name: name.value.trim(), qty: Math.max(0, parseNum(qty.value) || 0) || undefined, unit: unit.value.trim() || undefined, createdAt: nowIso(), done: false }));
  };
  const automaticRows = automatic.map((row) => el('div', { class: 'pa-detail-card', 'data-testid': 'shopping-auto-item' }, [
    el('div', { class: 'pa-row' }, [el('div', { class: 'pa-grow' }, [el('strong', { text: row.ingredient.name }), el('span', { class: 'pa-muted', text: `Estoque ${fmtNum(row.current)} ${row.ingredient.stockUnit} · mínimo ${fmtNum(row.minimum)} ${row.ingredient.stockUnit}` })]), el('span', { class: 'pa-badge pa-warn', text: 'Estoque baixo' })]),
    el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => ctx.actions.mutate((store) => store.upsertIngredient({ ...row.ingredient, shoppingHidden: true })) }, 'Ocultar desta lista'),
  ]));
  const manualRows = manual.map((item) => el('div', { class: 'pa-row pa-detail-card', 'data-testid': 'shopping-manual-item' }, [
    el('div', { class: 'pa-grow' }, [el('strong', { text: item.name }), (item.qty || item.unit) && el('span', { class: 'pa-muted', text: [item.qty && fmtNum(item.qty), item.unit].filter(Boolean).join(' ') })].filter(Boolean)),
    el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => ctx.actions.mutate((store) => store.removeShoppingItem(item.id, nowIso())) }, 'Excluir'),
  ]));
  return el('section', { class: 'pa-card', 'data-testid': 'shopping-settings' }, [
    el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Reposição de materiais' }), el('h2', { text: 'Lista de compras' })])]),
    el('p', { class: 'pa-hint', text: 'O sistema inclui automaticamente insumos que atingiram o estoque mínimo ou ficaram com saldo negativo. Saldo negativo pede conferência das compras, do estoque inicial e da produção registrada. Você também pode acrescentar itens livres.' }),
    ...automaticRows,
    ...manualRows,
    (!automaticRows.length && !manualRows.length) && el('p', { class: 'pa-empty', text: 'Nenhum item aguardando compra.' }),
    el('h3', { class: 'pa-h3', text: 'Adicionar item manual' }),
    el('div', { class: 'pa-row pa-form' }, [name, qty, unit, el('button', { class: 'pa-btn pa-primary', 'data-testid': 'shopping-add', onclick: add }, 'Adicionar')]),
    el('p', { class: 'pa-hint', text: 'A lista automática desaparece quando a compra eleva o estoque acima do mínimo. Ocultar não altera o estoque; apenas dispensa aquele aviso.' }),
  ].filter(Boolean));
}

function backupFileStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

function trashPanel(ctx) {
  const items = ctx.store.activeTrash();
  const typeNames = {
    ingredients: 'Insumo', recipes: 'Receita', products: 'Produto', clients: 'Cliente', employees: 'Funcionário', encomendas: 'Encomenda',
    comandas: 'Comanda', categories: 'Categoria', suppliers: 'Fornecedor', cashAccounts: 'Conta financeira',
    financeTitles: 'Lançamento financeiro', purchases: 'Compra', notifications: 'Notificação', shoppingItems: 'Item da lista de compras',
  };
  const rows = items.map((item) => {
    const remaining = Math.max(0, Math.ceil((new Date(item.expiresAt).getTime() - Date.now()) / 86400000));
    return el('div', { class: 'pa-detail-card', 'data-testid': 'trash-item' }, [
      el('div', { class: 'pa-row' }, [
        el('div', { class: 'pa-grow' }, [
          el('strong', { text: item.label || item.recordId }),
          el('span', { class: 'pa-muted', text: `${typeNames[item.collection] || 'Registro'} · excluído em ${fmtDateTime(item.deletedAt)}` }),
        ]),
        el('span', { class: remaining <= 5 ? 'pa-badge pa-warn' : 'pa-badge', text: remaining === 1 ? '1 dia restante' : `${remaining} dias restantes` }),
      ]),
      el('div', { class: 'pa-row pa-form' }, [
        el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'trash-restore', onclick: () => ctx.actions.restoreTrash(item.id) }, 'Restaurar'),
      ]),
    ]);
  });
  return el('section', { class: 'pa-card', 'data-testid': 'trash-panel' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Proteção contra exclusões acidentais' }), el('h2', { text: `Lixeira${items.length ? ` (${items.length})` : ''}` })]),
    ]),
    el('p', { class: 'pa-hint', text: 'Registros excluídos ficam aqui por 30 dias e podem ser restaurados. Depois desse prazo, o conteúdo é eliminado automaticamente.' }),
    ...(rows.length ? rows : [el('p', { class: 'pa-empty', text: 'A lixeira está vazia.' })]),
  ]);
}

MODALS['import-xlsx'] = (ctx, m) => importXlsxSheet(ctx, m);

// Preview-before-apply for the xlsx import: show what will be created/updated + warnings; confirm
// applies (name-based merge, never deletes), Cancelar discards.
function importXlsxSheet(ctx, m) {
  const { data, preview, filename } = m;
  if (preview.error) {
    return sheet({ title: 'Importar planilha', rows: [el('p', { class: 'pa-status pa-bad', text: 'Não foi possível ler a planilha: ' + preview.error })] });
  }
  const line = (label, c) => el('tr', {}, [el('td', { text: label }), el('td', { class: 'pa-num', text: `${c.novos} novo(s) · ${c.att} atualizado(s)` })]);
  const rows = [
    el('p', { class: 'pa-hint', text: `Arquivo: ${filename}. Confira antes de importar — mescla pelos nomes e NÃO apaga nada do que já existe.` }),
    el('table', { class: 'pa-kv', 'data-testid': 'xlsx-preview' }, [
      line('Insumos', preview.insumos), line('Receitas', preview.receitas), line('Produtos', preview.produtos),
    ]),
    preview.warnings.length > 0 && el('div', {}, [
      el('h3', { class: 'pa-h3', text: `Avisos (${preview.warnings.length})` }),
      el('ul', { class: 'pa-list pa-tight' }, preview.warnings.slice(0, 15).map((w) => el('li', { class: 'pa-list-item' }, el('span', { class: 'pa-muted', text: w })))),
      preview.warnings.length > 15 && el('p', { class: 'pa-hint', text: `… e mais ${preview.warnings.length - 15}.` }),
    ].filter(Boolean)),
  ].filter(Boolean);
  return sheet({
    title: 'Importar planilha',
    rows,
    onSave: () => ctx.actions.importParsed(data),
    saveTestid: 'xlsx-apply', saveLabel: 'Importar',
  });
}

function downloadFile(name, text, mime = 'text/yaml') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dropboxPanel(ctx) {
  const { linked, busy, status, lastSyncAt, lastBackupAt, syncError } = ctx.view;
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-row' }, [
      el('strong', { text: 'Dropbox' }),
      el('span', { class: linked ? 'pa-badge pa-ok' : 'pa-badge', text: linked ? 'Conectado' : 'Não conectado' }),
    ]),
    el('div', { class: 'pa-row' }, [
      linked
        ? el('button', { class: 'pa-btn', disabled: busy, onclick: () => ctx.actions.sync() }, busy ? 'Sincronizando…' : 'Sincronizar agora')
        : el('button', { class: 'pa-btn pa-primary', onclick: () => ctx.actions.connect() }, 'Conectar ao Dropbox'),
      linked && el('button', { class: 'pa-btn pa-ghost', onclick: () => ctx.actions.disconnect() }, 'Desconectar'),
    ]),
    status && el('p', { class: 'pa-status', text: status }),
    // Sync runs automatically (on abrir, ao mudar algo, ao sair do app). Show the last result so a
    // silent failure can't hide a stale backup.
    linked && syncError
      ? el('p', { class: 'pa-status pa-bad' }, [el('strong', { text: '⚠ Backup pode estar desatualizado. ' }), 'Seus dados estão salvos no aparelho; tentaremos sincronizar de novo automaticamente.'])
      : linked && lastSyncAt && el('p', { class: 'pa-hint', text: `Sincronizado automaticamente · última vez ${fmtDateTime(lastSyncAt)}.` }),
    lastBackupAt && el('p', { class: 'pa-hint', text: `Último backup extra solicitado em ${fmtDateTime(lastBackupAt)}.` }),
    el('p', { class: 'pa-hint', text: 'Seus dados ficam primeiro neste aparelho. O Dropbox mantém uma cópia sincronizada e permite recuperar os dados em outro aparelho.' }),
  ]);
}
