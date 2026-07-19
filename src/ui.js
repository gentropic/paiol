// paiol — UI (PT-BR surface). Vanilla DOM, no framework. English identifiers in code, every
// label Nayara sees in Portuguese. A tabbed shell over the tested core: Insumos, Receitas,
// Produtos, the Preços payoff view (where the cost engine surfaces), and Ajustes.
//
// renderApp rebuilds the DOM from (store, view, actions) on every change. Add-forms only mutate
// on submit, so typing is never interrupted by a re-render.

import {
  indexStore, estimateLens, costBreakdown, recipeUnitCost, priceFromCost, productUnitCost, productPrice, productBreakdown,
  effectiveMargin, PriceError, CycleError, YieldError, MarkupError, RefError,
} from './cost-engine.js';
import { ConversionError } from './units.js';
import { exportYaml } from './exchange.js';
import { generateFichasPdf, generateReciboPdf, generateCommercialDocumentPdf, generateComandaPdf, generateClientStatementPdf, generateDrePdf, savePdf } from './pdf.js';
import { workbookBytes, parseInterchange, previewExchange } from './xlsx-exchange.js';
import { monthSummary, despesasByCategory, productSummary, clientSummary, revenueTrend, salesPeriodSummary, businessPeriodSummary } from './reports.js';
import { listTitles, titleState, titleSettlements, cashMovements, cashFlow, financeDashboard, categoryByKey, defaultCashAccount } from './finance.js';
import { clientFinancialStatement } from './client-statement.js';
import { managerialDre } from './dre.js';

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
  { id: 'pedidos', label: 'Pedidos', icon: '▤', screens: [['encomendas', 'Encomendas'], ['vendas', 'Vendas']] },
  { id: 'producao', label: 'Produção', icon: '◇', screens: [['comanda', 'Comanda'], ['perdas', 'Perdas']] },
  { id: 'cadastro', label: 'Cadastro', icon: '＋', screens: [['insumos', 'Insumos'], ['receitas', 'Receitas'], ['simulador', 'Simulador'], ['produtos', 'Produtos'], ['clientes', 'Clientes']] },
  { id: 'financeiro', label: 'Financeiro', icon: '$', screens: [['fin-dashboard', 'Dashboard'], ['fin-receber', 'A Receber'], ['fin-pagar', 'A Pagar'], ['financeiro', 'Lançamentos'], ['fin-fluxo', 'Fluxo de Caixa'], ['fin-documentos', 'Recibo / Orçamento']] },
  { id: 'ajustes', label: 'Ajustes', icon: '⚙', screens: [['ajustes', 'Ajustes']] },
];
const SECTION_OF = {};
for (const sec of SECTIONS) for (const [sid] of sec.screens) SECTION_OF[sid] = sec;
for (const sid of ['fin-compras', 'fin-plano', 'fin-relatorios', 'precos', 'relatorios']) SECTION_OF[sid] = SECTIONS.find((s) => s.id === 'financeiro');

// Built-in help (PT-BR, Nayara's voice). One friendly entry per screen + a few plain-language
// concept answers. The ? button opens it with the current screen's topic expanded.
const HELP_SCREENS = [
  { id: 'inicio', icon: '🏠', label: 'Início', paras: [
    'Sua visão geral do mês: quanto você vendeu e lucrou, avisos (como insumos sem preço) e atalhos pra lançar uma encomenda ou abrir a comanda do dia.',
  ] },
  { id: 'insumos', icon: '🧺', label: 'Insumos', paras: [
    'Tudo que você compra pra produzir — farinha, ovos, chocolate — e também embalagens e itens prontos de revenda (bombom, laço, cartãozinho). Cadastre cada um com a unidade de compra e o preço.',
    'Toque em “+ Novo” pra adicionar, ou em qualquer linha pra mudar o preço (o histórico fica guardado) ou excluir. Sem o preço, os produtos que usam o insumo também ficam sem preço.',
  ] },
  { id: 'receitas', icon: '📖', label: 'Receitas', paras: [
    'Aqui fica a ficha técnica completa: ingredientes/insumos, rendimento, tempos, embalagem, margem e o produto vendido relacionado.',
    'O app soma ingredientes, mão de obra, gás e custos fixos. Use o Simulador ao lado para testar rendimento, custo, lucro e viabilidade sem alterar a receita original.',
  ] },
  { id: 'produtos', icon: '🎂', label: 'Produtos', paras: [
    'É a lista simples do que aparece nas comandas e vendas: nome, unidade ou peso e valor de venda.',
    'A composição e os cálculos ficam em Receitas. Ao relacionar uma receita a um produto, o custo calculado passa a servir de referência para a rentabilidade desse produto.',
  ] },
  { id: 'clientes', icon: '👥', label: 'Clientes', paras: [
    'Seus clientes — nome, telefone e endereço. Como a maioria é recorrente, cadastrar uma vez agiliza lançar os pedidos e montar a ficha (histórico de compras) de cada um.',
    'Ao abrir um cliente, você vê o histórico dele: total comprado, total pago, saldo pendente, as compras e os pagamentos. No fim da tela você gera as fichas em PDF (3 por folha, pra imprimir e arquivar): todas as vendas, só as em aberto (com saldo) ou só as pagas — sempre com uma prévia pra conferir antes.',
  ] },
  { id: 'precos', icon: '💰', label: 'Preços', paras: [
    'O coração do app: pra cada produto mostra quanto custa fazer (ingredientes, sua mão de obra, gás, custos fixos e embalagem) e sugere um preço de venda já com a sua margem.',
    'Se aparecer “sem preço”, é porque falta cadastrar o preço de algum insumo usado.',
  ] },
  { id: 'encomendas', icon: '📋', label: 'Encomendas', paras: [
    'Os pedidos com data de entrega. Busque o cliente pelo nome, escolha a data e vá buscando os produtos — o total sai calculado. A encomenda já conta como venda e entra no histórico do cliente.',
    'A lista começa mostrando todas as datas. Dá pra ordenar por entrega, cliente ou data do pedido; filtrar separadamente por cliente, produto, retirada/motoboy e situação; e criar outra encomenda sem voltar ao Início. Marque ⭐ pra deixar uma encomenda URGENTE (vai pro topo) e “Entregar” quando sair.',
  ] },
  { id: 'comanda', icon: '📝', label: 'Comanda do dia', paras: [
    'A lista do que produzir num dia. A Quantidade Prevista vem sozinha das encomendas com entrega nessa data (e dá pra ajustar). Em Produzidos/Estoque você anota quanto PRODUZIU de verdade — não o que vendeu; vale pra estoque ou produção extra. Marque ✓ quando terminar.',
    'Dá pra adicionar produtos avulsos (estoque, pronta entrega) mesmo sem encomenda, e excluir (✕) os que não quiser. O que passar do previsto fica “disponível para venda”. No fim aparecem o total disponível e o custo de produção; o dinheiro e o lucro ficam em A Receber / Relatórios.',
  ] },
  { id: 'fiado', icon: '💳', label: 'A Receber', paras: [
    'Quem ainda tem valor a pagar das encomendas — o total a receber e cada pendência. Toque numa para registrar um pagamento (total ou parcial); o saldo é recalculado sozinho.',
    'Para corrigir um pagamento lançado errado, use o estorno (↩) na encomenda — ele cancela sem apagar o histórico.',
  ] },
  { id: 'vendas', icon: '🛒', label: 'Vendas', paras: [
    'Relatório gerencial das vendas por período. O filtro Todos inclui vendas pagas e pendentes; apenas desistências ficam separadas. Veja quanto vendeu, recebeu e ainda tem a receber, além dos totais por cliente e produto.',
    'Filtre por produto, cliente ou pelos dois juntos para ver quantas unidades foram vendidas, em que data, quem comprou, o valor e se a venda foi recebida ou continua a receber.',
    'Entregue e pago são informações independentes. O filtro Desistências mostra os pedidos cancelados sem apagar o histórico.',
  ] },
  { id: 'financeiro', icon: '$', label: 'Financeiro', paras: [
    'Centraliza o dinheiro que entrou e saiu: pagamentos de vendas, outras receitas, despesas fixas, despesas variáveis e custos.',
    'O controle de pagamentos é somente financeiro e manual — sem QR Code, cobrança automática ou links de pagamento.',
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
  { id: 'simulador', icon: '⚖️', label: 'Simulador', paras: [
    'Faça contas de “e se…”. Escolha uma receita e veja o que acontece com o custo e a margem se você fizer um lote maior — os ingredientes crescem junto, mas a mão de obra costuma subir pouco, então o custo por unidade cai.',
    'Compare a margem e o lucro a um preço fixo. Ajuda a decidir se mantém, adapta ou tira um produto do cardápio.',
  ] },
  { id: 'ajustes', icon: '⚙️', label: 'Ajustes', paras: [
    'Compare suas bases manuais com o que o sistema consegue calcular pelos lançamentos dos últimos meses. Nada é substituído sem você apertar o botão de aplicar.',
    'Margem-alvo continua sendo uma decisão do negócio. Custo de gás e valor da hora só são sugeridos quando também existem minutos reais de produção suficientes. Aqui também ficam backup e importação/exportação.',
  ] },
];
const HELP_CONCEPTS = [
  { q: 'Por que um produto fica “sem preço”?', a: 'Quando algum insumo que ele usa ainda não tem preço cadastrado. Cadastre o preço em Insumos e o preço do produto aparece sozinho.' },
  { q: 'Estimativa x realidade', a: 'O app usa estimativas (das receitas) pra sugerir preços, e os dados reais (vendas e o que você produziu na comanda) pra mostrar a verdade nos relatórios.' },
  { q: 'Margem e taxa', a: 'Margem é o lucro que você quer sobre o custo; taxa é o que a maquininha/pagamento cobra. O preço sugerido já considera as duas.' },
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
const dateOnly = (iso) => String(iso || '').slice(0, 10);
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
    insumos: insumosPanel, receitas: receitasPanel, produtos: produtosPanel, clientes: clientesPanel,
    precos: precosPanel, vendas: vendasPanel,
    encomendas: encomendasPanel, comanda: comandaPanel, fiado: fiadoPanel, financeiro: financeiroPanel, despesas: financeiroPanel, perdas: perdasPanel,
    'fin-dashboard': financeDashboardPanel, 'fin-receber': financeReceivablePanel, 'fin-pagar': financePayablePanel,
    'fin-fluxo': financeCashFlowPanel, 'fin-documentos': financeCommercialDocumentsPanel, 'fin-compras': financePurchasesPanel, 'fin-plano': financeChartPanel, 'fin-relatorios': financeReportsPanel,
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
  if (section.screens.length > 1) {
    content.push(el('div', { class: 'pa-modulebar', 'aria-label': `Módulos de ${section.label}` }, section.screens.map(([sid, label]) =>
      el('button', { class: 'pa-modulebtn' + (sid === tab ? ' active' : ''), 'data-screen': sid, onclick: () => ctx.actions.setTab(sid) }, label))));
  }
  content.push((panels[tab] || inicioPanel)(ctx));

  root.replaceChildren(...[
    el('header', { class: 'pa-header' }, [
      el('div', { class: 'pa-brand pa-grow' }, [
        el('img', { class: 'pa-brand-logo', src: './brand-logo.png', alt: 'Quitutes do Paiol' }),
        el('div', { class: 'pa-brand-copy' }, [
          el('span', { class: 'pa-eyebrow', text: 'Gestão da confeitaria' }),
          el('h1', {}, [el('span', { text: 'Quitutes do Paiol' }), el('span', { class: 'pa-beta', title: 'Em evolução', text: 'beta' })]),
          el('p', { class: 'pa-sub', text: 'Organização simples. Decisões melhores.' }),
        ]),
      ]),
      el('button', { class: 'pa-help-btn', 'data-testid': 'help-open', title: 'Ajuda', 'aria-label': 'Ajuda', onclick: () => ctx.actions.openModal({ kind: 'help' }) }, '?'),
    ]),
    el('main', { class: 'pa-main' }, content),
    el('nav', { class: 'pa-bottomnav' }, SECTIONS.map((sec) =>
      el('button', { class: 'pa-navbtn' + (sec === section ? ' active' : ''), 'data-section': sec.id, onclick: () => ctx.actions.setTab(sec.screens[0][0]) }, [
        el('span', { class: 'pa-navico', text: sec.icon }),
        el('span', { class: 'pa-navlbl', text: sec.label }),
      ]))),
    ctx.view.modal && modalOverlay(ctx),
  ].filter(Boolean)); // drop the falsy modal slot — replaceChildren would coerce it to a "null" text node
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

// ── Início (dashboard / cockpit) ─────────────────────────────────────────────────

function inicioPanel(ctx) {
  const { store } = ctx;
  const sum = monthSummary(store, currentMonth());
  const semPreco = store.state.ingredients.filter((i) => store.currentPrice(i.id) == null).length;
  const vazio = !store.state.ingredients.length && !store.state.recipes.length && !store.state.products.length;

  return el('section', {}, [
    el('section', { class: 'pa-card' }, [
      el('div', { class: 'pa-row' }, [
        el('h2', { class: 'pa-grow', text: `Este mês — ${monthLabel(currentMonth())}` }),
      ]),
      el('table', { class: 'pa-kv' }, [
        el('tr', {}, [el('td', { text: 'Recebido' }), el('td', { class: 'pa-num', text: brl(sum.recebido) })]),
        sum.aReceber > 0 && el('tr', {}, [el('td', { text: 'A receber' }), el('td', { class: 'pa-num', text: brl(sum.aReceber) })]),
      el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Saldo de caixa' }), el('td', { class: 'pa-num' + (sum.saldoCaixa >= 0 ? '' : ' pa-bad'), text: brl(sum.saldoCaixa) })]),
      ].filter(Boolean)),
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
  ]);
}

// ── Insumos ───────────────────────────────────────────────────────────────────

function insumosPanel(ctx) {
  const { store } = ctx;
  const semPreco = store.state.ingredients.filter((i) => store.currentPrice(i.id) == null).length;
  const list = el('ul', { class: 'pa-list pa-rows' }, store.state.ingredients.map((ing) => insumoRow(ctx, ing)));
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
  return el('li', { class: 'pa-row-item', 'data-search': `${ing.name} ${ing.lastSupplier || ''} ${(ing.tags || []).join(' ')}`, onclick: () => ctx.actions.openModal({ kind: 'insumo-edit', id: ing.id }) }, [
    el('div', { class: 'pa-grow' }, [
      el('div', {}, el('strong', { text: ing.name })),
      price != null
        ? el('span', { class: 'pa-muted', text: `${ing.stockUnit} · ${brl(price)}/${ing.stockUnit}${lastAt ? ` · ${fmtDate(lastAt)}` : ''}${ing.lastSupplier ? ` · ${ing.lastSupplier}` : ''}` })
        : el('span', {}, [el('span', { class: 'pa-muted', text: `${ing.stockUnit} · ` }), el('span', { class: 'pa-badge pa-bad', text: 'sem preço' })]),
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
  const tags = tagsInput(ing && ing.tags, 'ins-tags');

  function save() {
    const nm = name.value.trim();
    if (!nm) { name.focus(); return; }
    const p = parseNum(price.input.value);
    const sup = supplier.value.trim();
    const tg = tags.value();
    const id = ing ? ing.id : uuid();
    ctx.actions.mutate((s) => {
      s.upsertIngredient({ ...(ing || {}), id, name: nm, stockUnit: unit.value, lastSupplier: sup || undefined, tags: tg.length ? tg : undefined });
      const cur = ing ? s.currentPrice(id) : null;
      if (p != null && p !== cur) s.addPriceChange({ id: uuid(), at: nowIso(), ingredientId: id, price: p });
    });
  }

  const history = ing ? ctx.store.priceHistory(ing.id) : [];
  const rows = [
    field('Nome', name),
    field('Unidade de compra', unit),
    field('Preço (por ' + (ing ? ing.stockUnit : 'unidade') + ')', price),
    field('Fornecedor (opcional)', supplier),
    field('Etiquetas (opcional)', tags.el),
    history.length > 1 && el('details', { class: 'pa-history' }, [
      el('summary', { text: `histórico de preços (${history.length})` }),
      el('ul', { class: 'pa-list pa-tight' }, history.map((h) =>
        el('li', { class: 'pa-list-item' }, [el('span', { class: 'pa-muted', text: `${fmtDate(h.at)} — ${brl(h.price)}` })]))),
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
      el('button', { class: 'pa-btn pa-sm', 'data-testid': 'rec-simulator', onclick: () => ctx.actions.setTab('simulador') }, '⚖ Simulador'),
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
      el('span', { class: 'pa-muted', text: `${recipe.yieldNominal} ${recipe.yieldUnit} · ${recipe.activeMinutes}min ativos · ${n} ${n === 1 ? 'item' : 'itens'}` }),
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
  // Local draft of the component list — committed atomically on Salvar (so a new recipe and its
  // items are created in one mutation, and Cancelar discards everything).
  const comps = recipe ? recipe.components.map((c) => ({ ref: { ...c.ref }, qty: c.qty, unit: c.unit })) : [];

  const name = el('input', { class: 'pa-input', 'data-testid': 'rec-name', type: 'text', placeholder: 'Nome (ex.: Massa base de bolo)', value: recipe ? recipe.name : '' });
  const yieldQty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-yield', type: 'text', inputmode: 'decimal', placeholder: 'Rend.', value: recipe ? String(recipe.yieldNominal).replace('.', ',') : '' });
  const yieldUnit = el('select', { class: 'pa-input', 'data-testid': 'rec-yunit' },
    STOCK_UNITS.map((u) => el('option', { value: u, text: u, ...(recipe && u === recipe.yieldUnit ? { selected: 'selected' } : {}) })));
  const active = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-active', type: 'text', inputmode: 'numeric', placeholder: 'min ativos', value: recipe ? String(recipe.activeMinutes) : '' });
  const oven = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-oven', type: 'text', inputmode: 'numeric', placeholder: 'min forno', value: recipe ? String(recipe.ovenMinutes) : '' });
  const notes = el('textarea', { class: 'pa-input pa-textarea', 'data-testid': 'rec-notes', rows: '3', placeholder: 'Observação / modo de preparo (opcional)' });
  notes.value = recipe ? (recipe.notes || '') : '';
  const weight = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-weight', type: 'text', inputmode: 'decimal', placeholder: 'peso do lote', value: recipe && recipe.weightTotal != null ? String(recipe.weightTotal).replace('.', ',') : '' });
  const weightUnit = el('select', { class: 'pa-input', 'data-testid': 'rec-wunit' },
    ['g', 'kg'].map((u) => el('option', { value: u, text: u, ...(recipe && u === recipe.weightUnit ? { selected: 'selected' } : {}) })));
  const tags = tagsInput(recipe && recipe.tags, 'rec-tags');
  const currentLinked = recipe ? linkedProductForRecipe(store, recipe.id) : null;
  const productLink = el('select', { class: 'pa-input', 'data-testid': 'rec-product-link' }, [
    el('option', { value: '', text: 'Nenhum produto relacionado' }),
    ...store.state.products.slice().sort((a, b) => norm(a.name).localeCompare(norm(b.name))).map((p) => el('option', { value: p.id, text: p.name, ...(currentLinked?.id === p.id ? { selected: 'selected' } : {}) })),
  ]);
  const initialPackaging = currentLinked ? currentLinked.packagingCost : recipe?.packagingCost;
  const initialPackagingDesc = currentLinked ? currentLinked.packagingDesc : recipe?.packagingDesc;
  const initialMargin = currentLinked && currentLinked.targetMarginPct != null ? currentLinked.targetMarginPct : recipe?.targetMarginPct;
  const packaging = moneyField(initialPackaging || 0, 'rec-pkg');
  const packagingDesc = el('input', { class: 'pa-input', 'data-testid': 'rec-pkgdesc', type: 'text', placeholder: 'Ex.: caixinha, boleira ou saco', value: initialPackagingDesc || '' });
  const margin = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-margin', type: 'text', inputmode: 'decimal', placeholder: `padrão ${pct(store.getConfig().targetMarginPct)}`, value: initialMargin != null ? String(pct(initialMargin)).replace('.', ',') : '' });
  productLink.addEventListener('change', () => {
    const p = store.get('products', productLink.value);
    if (!p) return;
    packaging.input.value = fmtMoneyInput(p.packagingCost || 0);
    packagingDesc.value = p.packagingDesc || '';
    margin.value = p.targetMarginPct != null ? String(pct(p.targetMarginPct)).replace('.', ',') : '';
  });

  // Component editor (insumos + other recipes, never itself).
  const options = [
    ...store.state.ingredients.map((i) => ({ kind: 'ingredient', id: i.id, label: `Insumo: ${i.name}`, unit: i.stockUnit })),
    ...store.state.recipes.filter((r) => !recipe || r.id !== recipe.id).map((r) => ({ kind: 'recipe', id: r.id, label: `Receita: ${r.name}`, unit: r.yieldUnit })),
  ];
  const refSel = el('select', { class: 'pa-input', 'data-testid': 'rec-compref' }, options.map((o, i) => el('option', { value: String(i), text: o.label })));
  const qty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-compqty', type: 'text', inputmode: 'decimal', placeholder: 'qtd' });
  const unit = el('select', { class: 'pa-input', 'data-testid': 'rec-compunit' });
  function fillUnits() {
    const o = options[Number(refSel.value)] || options[0];
    unit.replaceChildren(...unitsInDimension(o ? o.unit : 'un').map((u) => el('option', { value: u, text: u })));
  }
  fillUnits();
  refSel.addEventListener('change', fillUnits);

  const itemsList = el('ul', { class: 'pa-list pa-tight' });
  function renderItems() {
    itemsList.replaceChildren(...(comps.length
      ? comps.map((c, idx) => el('li', { class: 'pa-list-item' }, [
          el('span', { class: 'pa-grow', text: `${c.qty} ${c.unit} — ${refName(store, c.ref)}` }),
          el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Remover item', onclick: () => { comps.splice(idx, 1); renderItems(); } }, '✕'),
        ]))
      : [el('li', { class: 'pa-empty pa-sm', text: 'Sem itens ainda.' })]));
  }
  renderItems();

  function addComponent() {
    const q = parseNum(qty.value);
    const o = options[Number(refSel.value)];
    if (!o || !(q > 0)) { qty.focus(); return; }
    comps.push({ ref: { kind: o.kind, id: o.id }, qty: q, unit: unit.value });
    qty.value = '';
    renderItems();
  }

  function save() {
    const nm = name.value.trim();
    const y = parseNum(yieldQty.value);
    if (!nm || !(y > 0)) { name.focus(); return; }
    const obs = notes.value.trim();
    const w = parseNum(weight.value);
    const tg = tags.value();
    const id = recipe ? recipe.id : uuid();
    const packageValue = parseNum(packaging.input.value) || 0;
    const packageDescription = packagingDesc.value.trim();
    const marginText = margin.value.trim();
    const marginValue = marginText === '' ? undefined : (parseNum(marginText) || 0) / 100;
    ctx.actions.mutate((s) => {
      const savedRecipe = {
      ...(recipe || { fermentMinutes: 0 }), id, name: nm,
      yieldNominal: y, yieldUnit: yieldUnit.value,
      activeMinutes: parseNum(active.value) || 0, ovenMinutes: parseNum(oven.value) || 0,
      components: comps, ...(obs ? { notes: obs } : { notes: undefined }),
      weightTotal: w == null ? undefined : w, weightUnit: w == null ? undefined : weightUnit.value,
      tags: tg.length ? tg : undefined,
      packagingCost: packageValue, packagingDesc: packageDescription || undefined,
      targetMarginPct: marginValue,
      };
      s.upsertRecipe(savedRecipe);
      if (currentLinked && currentLinked.id !== productLink.value) {
        s.upsertProduct({ ...currentLinked, components: (currentLinked.components || []).filter((c) => !(c.kind === 'recipe' && c.id === id)) });
      }
      const linked = productLink.value ? s.get('products', productLink.value) : null;
      if (linked) {
        const components = (linked.components || []).filter((c) => !(c.kind === 'recipe' && c.id === id));
        components.push({ kind: 'recipe', id, qty: saleQtyInRecipeUnit(linked, savedRecipe) });
        s.upsertProduct({ ...linked, components, packagingCost: packageValue, packagingDesc: packageDescription || undefined, targetMarginPct: marginValue });
      }
    });
  }

  const rows = [
    field('Nome', name),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Rende' }), yieldQty, yieldUnit]),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'min ativos' }), active, el('span', { class: 'pa-lab', text: 'min forno' }), oven]),
    el('p', { class: 'pa-hint', text: 'Min ativos = mão na massa; min forno = gás. Fermentação não conta como trabalho.' }),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Peso do lote (opcional)' }), weight, weightUnit]),
    el('p', { class: 'pa-hint', text: 'Peso total que a receita rende — ajuda a cotar por kg numa venda de lote maior.' }),
    field('Observação (modo de preparo)', notes),
    field('Etiquetas (opcional)', tags.el),
    el('h3', { class: 'pa-h3', text: 'Ingredientes e insumos' }),
    itemsList,
    options.length === 0
      ? el('p', { class: 'pa-hint', text: 'Cadastre insumos primeiro para montar a receita.' })
      : el('div', { class: 'pa-row pa-form' }, [refSel, qty, unit,
          el('button', { class: 'pa-btn pa-sm', 'data-testid': 'rec-compadd', onclick: addComponent }, '+ item')]),
    el('h3', { class: 'pa-h3', text: 'Embalagem e rentabilidade' }),
    field('Produto vendido relacionado (opcional)', productLink),
    el('p', { class: 'pa-hint', text: 'Essa relação liga a ficha técnica ao item usado nas comandas, sem misturar os dois cadastros.' }),
    field('Custo da embalagem por produto', packaging),
    field('Descrição da embalagem', packagingDesc),
    el('div', { class: 'pa-field' }, [el('label', { text: 'Margem desejada para esta receita (%)' }), el('div', { class: 'pa-row' }, [margin, el('span', { class: 'pa-lab', text: 'vazio = margem padrão dos Ajustes' })])]),
    recipeProfitabilityCard(store, recipe),
  ];

  return sheet({
    title: recipe ? 'Editar receita' : 'Nova receita',
    rows,
    onSave: save,
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
    el('p', { class: 'pa-hint', text: 'Mantenha aqui todo o seu catálogo. Somente produtos ativos aparecem em novas vendas, encomendas, comandas avulsas e estimativas; ingredientes, embalagem e rentabilidade ficam em Receitas.' }),
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
  const toggle = (ev) => {
    ev.stopPropagation();
    ctx.actions.mutate((s) => s.upsertProduct({ ...product, active: !active }));
  };
  return el('li', { class: 'pa-row-item' + (active ? '' : ' pa-reversed'), 'data-search': `${product.name} ${(product.tags || []).join(' ')} ${active ? 'ativo' : 'inativo'}`, onclick: () => ctx.actions.openModal({ kind: 'produto-edit', id: product.id }) }, [
    el('div', { class: 'pa-grow' }, [
      el('div', { class: 'pa-enc-title' }, [el('strong', { text: product.name }), el('span', { class: active ? 'pa-badge pa-ok' : 'pa-badge', text: active ? 'ativo' : 'inativo' })]),
      el('span', { class: 'pa-muted', text: `${fmtNum(product.saleQty || 1)} ${product.saleUnit || 'un'} · venda ${brl(sellingPrice(store, product.id))}` }),
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
  const activeChk = el('input', { type: 'checkbox', 'data-testid': 'prod-active' });
  activeChk.checked = product ? productIsActive(product) : true;
  const linkedRecipe = product ? store.state.recipes.find((r) => (product.components || []).some((c) => c.kind === 'recipe' && c.id === r.id)) : null;

  function save() {
    const nm = name.value.trim();
    const q = parseNum(saleQty.value);
    const price = parseNum(salePrice.input.value);
    if (!nm || !(q > 0) || price == null || price < 0) { (nm ? saleQty : name).focus(); return; }
    ctx.actions.mutate((s) => s.upsertProduct({
      ...(product || {}), id: product ? product.id : uuid(), name: nm,
      components: product ? (product.components || []) : [], packagingCost: product?.packagingCost || 0,
      saleQty: q, saleUnit: saleUnit.value, salePrice: price, active: activeChk.checked,
    }));
  }

  const rows = [
    field('Nome', name),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Unidade ou peso vendido' }), saleQty, saleUnit]),
    field('Valor de venda', salePrice),
    el('label', { class: 'pa-check' }, [activeChk, el('span', { text: 'Ativo para venda' })]),
    el('p', { class: 'pa-hint', text: 'Se desativado, permanece cadastrado e ligado à receita, mas não aparece em novas vendas, encomendas, comandas avulsas ou estimativas.' }),
    linkedRecipe
      ? el('p', { class: 'pa-callout', text: `Ficha técnica relacionada: ${linkedRecipe.name}. Altere ingredientes, embalagem e margem no cadastro de Receitas.` })
      : el('p', { class: 'pa-hint', text: 'Depois, em Receitas, você pode relacionar uma ficha técnica a este produto para calcular custo e rentabilidade.' }),
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
  const list = el('ul', { class: 'pa-list pa-rows' }, store.state.clients.map((c) => clienteRow(ctx, c)));
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('h2', { class: 'pa-grow', text: 'Clientes' }),
      el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'cli-new', onclick: () => ctx.actions.openModal({ kind: 'cliente-add' }) }, '+ Novo'),
    ]),
    store.state.clients.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhum cliente. Toque em “+ Novo” para começar.' })
      : el('div', {}, [el('p', { class: 'pa-hint pa-tap', text: 'Toque em um cliente para editar.' }), searchInput('Buscar cliente…', list, 'cli-search'), list]),
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
  const meta = [c.phone, c.address].filter(Boolean).join(' · ');
  return el('li', { class: 'pa-row-item', 'data-search': `${c.name} ${c.phone || ''}`, onclick: () => ctx.actions.openModal({ kind: 'cliente-edit', id: c.id }) }, [
    el('div', { class: 'pa-grow' }, [
      el('div', { class: 'pa-enc-title' }, [el('strong', { text: c.name }), c.inactive && el('span', { class: 'pa-badge', text: 'inativo' })].filter(Boolean)),
      meta && el('span', { class: 'pa-muted', text: meta }),
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
  const totalPago = activeOrders.reduce((s, e) => s + store.paidFor(e.id), 0);
  const saldo = totalComprado - totalPago;
  const pays = [];
  for (const e of orders) for (const pg of store.state.payments) if (pg.encomendaId === e.id && !store.isReversed('payment', pg.id)) pays.push(pg);
  pays.sort((a, b) => (a.at < b.at ? 1 : -1));
  const kv = (label, value, bad) => el('tr', bad ? { class: 'pa-kv-total' } : {}, [el('td', { text: label }), el('td', { class: 'pa-num' + (bad ? ' pa-bad' : ''), text: value })]);
  return el('div', { 'data-testid': 'cli-hist' }, [
    el('table', { class: 'pa-kv' }, [
      kv('Total comprado', brl(totalComprado)),
      kv('Total pago', brl(totalPago)),
      kv('Saldo pendente', brl(saldo), saldo > 0.005),
    ]),
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
  const name = el('input', { class: 'pa-input', 'data-testid': 'cli-name', type: 'text', placeholder: 'Nome do cliente', value: cli ? cli.name : '' });
  const phone = el('input', { class: 'pa-input', 'data-testid': 'cli-phone', type: 'tel', inputmode: 'tel', placeholder: 'Telefone', value: cli ? (cli.phone || '') : '' });
  const address = el('input', { class: 'pa-input', 'data-testid': 'cli-address', type: 'text', placeholder: 'Endereço', value: cli ? (cli.address || '') : '' });

  function save() {
    const nm = name.value.trim();
    if (!nm) { name.focus(); return; }
    const ph = phone.value.trim();
    const ad = address.value.trim();
    ctx.actions.mutate((s) => s.upsertClient({ ...(cli || {}), id: cli ? cli.id : uuid(), name: nm, phone: ph || undefined, address: ad || undefined }));
  }

  const rows = [field('Nome', name), field('Telefone (opcional)', phone), field('Endereço (opcional)', address)];
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

function precosPanel(ctx) {
  const { store } = ctx;
  const config = store.getConfig();
  const es = store.toEngineStore();
  const lens = estimateLens(config);
  const activeProducts = store.state.products.filter(productIsActive);

  const cards = activeProducts.map((p) => {
    // Most common "incomplete" cause: a used ingredient has no price. Name them explicitly.
    const missing = unpricedInProduct(store, p.id);
    if (missing.length) {
      return el('div', { class: 'pa-sub-card', 'data-search': p.name }, [
        el('div', { class: 'pa-row' }, [
          el('strong', { class: 'pa-grow', text: p.name }),
          el('span', { class: 'pa-badge pa-bad', text: 'sem preço' }),
        ]),
        el('p', { class: 'pa-status', text: `Defina o preço de: ${missing.join(', ')}.` }),
      ]);
    }
    try {
      const b = productBreakdown(es, p.id, config, lens);
      const parts = [
        ['Ingredientes', b.ingredients],
        ['Mão de obra', b.labor],
        ['Gás (forno)', b.gas],
        ['Custos fixos', b.fixed],
        ['Embalagem', b.packaging + p.packagingCost],
      ];
      const unitCost = parts.reduce((s, [, v]) => s + v, 0);
      const margin = effectiveMargin(es, p.id, config);
      const ownMargin = p.targetMarginPct != null;
      const price = priceFromCost(unitCost, { ...config, targetMarginPct: margin });
      // Per-unit profit and per-hour metrics (her spreadsheet's decision numbers).
      const lucroUnit = price - unitCost - price * config.paymentFeePct;
      const activeHoursPerUnit = config.valorHora > 0 ? b.labor / config.valorHora : 0;
      const lucroHora = activeHoursPerUnit > 0 ? lucroUnit / activeHoursPerUnit : null;
      const custoHora = activeHoursPerUnit > 0 ? unitCost / activeHoursPerUnit : null;
      const kv = (label, v, cls) => el('tr', cls ? { class: cls } : {}, [el('td', { text: label }), el('td', { class: 'pa-num' + (cls === 'pa-kv-total' ? '' : ''), text: brl(v) })]);
      return el('div', { class: 'pa-sub-card', 'data-search': p.name }, [
        el('div', { class: 'pa-row' }, [
          el('strong', { class: 'pa-grow', text: p.name }),
          el('span', { class: 'pa-price', text: brl(price) }),
        ]),
        el('table', { class: 'pa-kv' }, [
          ...parts.map(([label, v]) => kv(label, v)),
          kv('Custo unitário', unitCost, 'pa-kv-total'),
          el('tr', {}, [el('td', { text: `Preço sugerido (margem ${pct(margin)}%${ownMargin ? ' própria' : ''}, taxa ${pct(config.paymentFeePct)}%)` }), el('td', { class: 'pa-num pa-strong', text: brl(price) })]),
          el('tr', {}, [el('td', { text: 'Lucro por unidade' }), el('td', { class: 'pa-num' + (lucroUnit >= 0 ? '' : ' pa-bad'), text: brl(lucroUnit) })]),
          lucroHora != null && el('tr', {}, [el('td', { text: 'Lucro por hora de trabalho' }), el('td', { class: 'pa-num' + (lucroHora >= 0 ? '' : ' pa-bad'), text: brl(lucroHora) })]),
          custoHora != null && el('tr', {}, [el('td', { text: 'Custo por hora de trabalho' }), el('td', { class: 'pa-num', text: brl(custoHora) })]),
        ].filter(Boolean)),
      ]);
    } catch (e) {
      return el('div', { class: 'pa-sub-card', 'data-search': p.name }, [
        el('div', { class: 'pa-row' }, [el('strong', { class: 'pa-grow', text: p.name }), el('span', { class: 'pa-badge', text: 'incompleto' })]),
        el('p', { class: 'pa-status', text: friendlyError(e) }),
      ]);
    }
  });

  const cardsEl = el('div', {}, cards);
  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Preços' }),
    activeProducts.length === 0
      ? el('p', { class: 'pa-empty', text: 'Ative um produto para ver custos e preços sugeridos.' })
      : el('div', {}, [searchInput('Buscar produto…', cardsEl, 'preco-search'), cardsEl]),
  ]);
}

function friendlyError(e) {
  if (e instanceof PriceError) return 'Defina o preço de todos os insumos usados nesta receita.';
  if (e instanceof CycleError) return 'Há um ciclo nas receitas (uma receita contém a si mesma).';
  if (e instanceof YieldError) return 'Rendimento inválido — verifique a receita.';
  if (e instanceof MarkupError) return 'Margem + taxa somam 100% ou mais — ajuste em Ajustes.';
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
function comandaPanel(ctx) {
  const { store } = ctx;
  const config = store.getConfig();
  const es = store.toEngineStore();
  const lens = estimateLens(config);
  const unitCost = (pid) => { try { return productUnitCost(es, pid, config, lens); } catch { return 0; } };

  const date = ctx.view.comandaDate || todayInput();
  const dateInput = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'cmd-date', type: 'date', value: date });
  dateInput.addEventListener('change', () => ctx.actions.setComandaDate(dateInput.value || todayInput()));

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
      el('h2', { class: 'pa-grow', text: 'Comanda do dia' }),
      el('button', { class: 'pa-btn pa-sm', 'data-testid': 'cmd-preview', onclick: () => ctx.actions.openModal({ kind: 'comanda-preview', date }) }, 'Visualizar / PDF'),
      dateInput,
    ]),
    el('p', { class: 'pa-hint', text: 'O que produzir hoje. A Quantidade Prevista vem das encomendas do dia (dá pra ajustar), e você anota o que PRODUZIU em Produzidos/Estoque. Pode adicionar produtos avulsos pra estoque ou pronta entrega.' }),
    list,
    search, results,
    indEl,
  ]);
}

// ── Vendas (Sale — revenue, with snapshotted cost for true margin) ───────────────

function buildComandaSpec(store, date) {
  const groups = new Map();
  const ordered = new Map();
  for (const enc of store.state.encomendas) {
    if (enc.desistenciaAt || dateOnly(enc.deliveryDate) !== date) continue;
    const key = enc.clienteId || '__sem__';
    const client = enc.clienteId ? store.get('clients', enc.clienteId) : null;
    const group = groups.get(key) || { clientName: client?.name || 'Sem cliente / pronta entrega', contact: [client?.phone, client?.address].filter(Boolean).join(' · '), items: new Map(), notes: [] };
    for (const it of enc.itens || []) {
      group.items.set(it.productId, (group.items.get(it.productId) || 0) + (Number(it.qty) || 0));
      ordered.set(it.productId, (ordered.get(it.productId) || 0) + (Number(it.qty) || 0));
    }
    if (enc.notes) group.notes.push(enc.notes);
    groups.set(key, group);
  }
  const stored = store.get('comandas', date);
  const produced = new Map((stored?.itens || []).map((it) => [it.productId, Number(it.realizado) || 0]));
  const explicit = new Map((stored?.itens || []).filter((it) => it.prevista != null).map((it) => [it.productId, Number(it.prevista) || 0]));
  const productionIds = [...new Set([...ordered.keys(), ...produced.keys(), ...explicit.keys()])];
  return {
    date: fmtDate(`${date}T12:00:00`),
    groups: [...groups.values()].map((g) => ({
      clientName: g.clientName, contact: g.contact,
      items: [...g.items.entries()].map(([id, qty]) => ({ name: store.get('products', id)?.name || '(produto removido)', qty })),
      notes: g.notes.join(' · '),
    })).sort((a, b) => norm(a.clientName).localeCompare(norm(b.clientName))),
    production: productionIds.map((id) => ({
      name: store.get('products', id)?.name || '(produto removido)',
      prevista: explicit.has(id) ? explicit.get(id) : (ordered.get(id) || 0),
      produzido: produced.get(id) || 0,
    })).sort((a, b) => norm(a.name).localeCompare(norm(b.name))),
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

function recipeProfitabilityCard(store, recipe) {
  if (!recipe) return null;
  const product = linkedProductForRecipe(store, recipe.id);
  const config = store.getConfig();
  try {
    const es = store.toEngineStore();
    const lens = estimateLens(config);
    const recipeCost = recipeUnitCost(es, recipe.id, config, lens);
    if (!product) return el('section', { class: 'pa-detail-card' }, [
      el('strong', { text: 'Custo calculado da receita' }),
      el('span', { class: 'pa-muted', text: `${brl(recipeCost)} por ${recipe.yieldUnit}. Relacione um produto para comparar com o valor de venda.` }),
    ]);
    const unitCost = productUnitCost(es, product.id, config, lens);
    const suggested = productPrice(es, product.id, config, lens).price;
    const salePrice = Number(product.salePrice) || suggested;
    const fee = salePrice * (Number(config.paymentFeePct) || 0);
    const profit = salePrice - unitCost - fee;
    const margin = salePrice > 0 ? profit / salePrice : 0;
    return el('section', { class: 'pa-detail-card' }, [
      el('strong', { text: `Rentabilidade · ${product.name}` }),
      el('table', { class: 'pa-kv' }, [
        el('tr', {}, [el('td', { text: 'Custo por produto' }), el('td', { class: 'pa-num', text: brl(unitCost) })]),
        el('tr', {}, [el('td', { text: 'Venda cadastrada' }), el('td', { class: 'pa-num', text: brl(salePrice) })]),
        el('tr', {}, [el('td', { text: 'Preço sugerido' }), el('td', { class: 'pa-num', text: brl(suggested) })]),
        el('tr', {}, [el('td', { text: 'Lucro estimado' }), el('td', { class: `pa-num ${profit >= 0 ? 'pa-positive' : 'pa-bad'}`, text: brl(profit) })]),
        el('tr', {}, [el('td', { text: 'Margem estimada' }), el('td', { class: `pa-num ${margin >= 0 ? 'pa-positive' : 'pa-bad'}`, text: pctStr(margin) })]),
      ]),
    ]);
  } catch (e) {
    return el('p', { class: 'pa-hint', text: friendlyError(e) });
  }
}

MODALS['comanda-preview'] = (ctx, m) => {
  const spec = buildComandaSpec(ctx.store, m.date);
  const preview = el('div', { class: 'pa-print-preview', 'data-testid': 'cmd-print-preview' }, [
    el('h3', { class: 'pa-h3', text: `Produção · ${spec.date}` }),
    ...spec.production.map((p) => el('div', { class: 'pa-preview-line' }, [el('span', { class: 'pa-grow', text: p.name }), el('strong', { text: `${fmtNum(p.prevista)} previsto · ${fmtNum(p.produzido)} produzido` })])),
    el('h3', { class: 'pa-h3', text: 'Pedidos agrupados por cliente' }),
    ...spec.groups.map((g) => el('section', { class: 'pa-preview-group' }, [
      el('strong', { text: g.clientName }),
      g.contact && el('span', { class: 'pa-muted', text: g.contact }),
      el('ul', { class: 'pa-list pa-tight' }, g.items.map((it) => el('li', { class: 'pa-list-item' }, [el('span', { class: 'pa-grow', text: it.name }), el('strong', { text: `${fmtNum(it.qty)} un` })]))),
      g.notes && el('span', { class: 'pa-muted', text: `Obs.: ${g.notes}` }),
    ].filter(Boolean))),
  ]);
  const btn = el('button', { class: 'pa-btn pa-primary pa-grow', 'data-testid': 'cmd-pdf' }, 'Gerar PDF A4');
  btn.addEventListener('click', async () => {
    const old = btn.textContent; btn.textContent = 'Gerando…'; btn.disabled = true;
    try { await savePdf(await generateComandaPdf(spec), `comanda-${m.date}.pdf`); }
    catch (e) { window.alert('Não foi possível gerar o PDF: ' + ((e && e.message) || e)); }
    finally { btn.textContent = old; btn.disabled = false; }
  });
  return sheet({ title: 'Comanda para impressão', rows: [el('p', { class: 'pa-hint', text: 'Pedidos do mesmo cliente e dia aparecem juntos, evitando comandas duplicadas.' }), preview, el('div', { class: 'pa-sheet-actions' }, [btn])] });
};

function vendasPanel(ctx) {
  const { store } = ctx;
  const products = store.state.products;
  const activeProducts = products.filter(productIsActive);
  const { vendaStart: start, vendaEnd: end, vendaStatus: status, vendaProductId: requestedProductId, vendaClientId: requestedClientId } = ctx.view;
  const productId = products.some((p) => p.id === requestedProductId) ? requestedProductId : '';
  const clientId = requestedClientId === '__sem__' || store.state.clients.some((c) => c.id === requestedClientId) ? requestedClientId : '';
  const selectedProduct = productId ? store.get('products', productId) : null;
  const report = salesPeriodSummary(store, start, end, status);
  const chip = (key, label) => el('button', { class: 'pa-chip' + (status === key ? ' pa-chip-on' : ''), 'data-testid': `venda-f-${key}`, onclick: () => ctx.actions.setVendaPeriod({ vendaStatus: key }) }, label);
  const period = periodFields(start, end, ({ start: s, end: e }) => ctx.actions.setVendaPeriod({ vendaStart: s, vendaEnd: e }), 'venda');
  const productFilter = el('select', { class: 'pa-input', 'data-testid': 'venda-product-filter' }, [
    el('option', { value: '', text: 'Todos os produtos', ...(!productId ? { selected: 'selected' } : {}) }),
    ...products.slice().sort((a, b) => norm(a.name).localeCompare(norm(b.name))).map((p) => el('option', { value: p.id, text: p.name, ...(productId === p.id ? { selected: 'selected' } : {}) })),
  ]);
  productFilter.addEventListener('change', () => ctx.actions.setVendaPeriod({ vendaProductId: productFilter.value }));
  const clientFilter = el('select', { class: 'pa-input', 'data-testid': 'venda-client-filter' }, [
    el('option', { value: '', text: 'Todos os clientes', ...(!clientId ? { selected: 'selected' } : {}) }),
    el('option', { value: '__sem__', text: 'Sem cliente / venda rápida', ...(clientId === '__sem__' ? { selected: 'selected' } : {}) }),
    ...store.state.clients.slice().sort((a, b) => norm(a.name).localeCompare(norm(b.name))).map((c) => el('option', { value: c.id, text: c.name, ...(clientId === c.id ? { selected: 'selected' } : {}) })),
  ]);
  clientFilter.addEventListener('change', () => ctx.actions.setVendaPeriod({ vendaClientId: clientFilter.value }));

  const visibleRows = report.rows.filter((row) => (!clientId || row.clientId === clientId) && (!productId || (row.kind === 'sale'
    ? row.sale.productId === productId
    : (row.order.itens || []).some((it) => it.productId === productId))));
  const visibleCancellations = report.cancellations.filter((row) => (!clientId || row.clientId === clientId) && (!productId || (row.kind === 'sale'
    ? row.sale.productId === productId
    : (row.order.itens || []).some((it) => it.productId === productId))));
  const rowMetrics = (row) => {
    if (!productId) return { total: row.total, received: row.received || 0, pending: row.pending || 0 };
    const total = row.kind === 'sale' ? row.total : (row.order.itens || []).filter((it) => it.productId === productId).reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
    const ratio = row.total > 0 ? total / row.total : 0;
    const received = Math.min(total, (row.received || 0) * ratio);
    return { total, received, pending: Math.max(0, total - received) };
  };
  const filteredTotals = visibleRows.reduce((acc, row) => { const m = rowMetrics(row); acc.total += m.total; acc.received += m.received; acc.pending += m.pending; return acc; }, { total: 0, received: 0, pending: 0 });
  const productSales = selectedProduct ? visibleRows.map((row) => {
    if (row.kind === 'sale') return {
      id: row.id, at: row.at, clientName: 'Sem cliente / venda rápida', qty: Number(row.sale.qty) || 0,
      total: row.total, received: true,
    };
    const cli = row.order.clienteId ? store.get('clients', row.order.clienteId) : null;
    const matching = (row.order.itens || []).filter((it) => it.productId === productId);
    return {
      id: row.id, at: row.at, clientName: cli?.name || 'Sem cliente',
      qty: matching.reduce((sum, it) => sum + (Number(it.qty) || 0), 0),
      total: matching.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0),
      received: row.paid, partial: !row.paid && row.received > 0.005,
    };
  }) : [];
  const clientSummaryMap = new Map();
  const productSummaryMap = new Map();
  const addFilteredProduct = (id, qty, total) => { const p = productSummaryMap.get(id) || { id, qty: 0, total: 0 }; p.qty += qty; p.total += total; productSummaryMap.set(id, p); };
  for (const row of visibleRows) {
    const metrics = rowMetrics(row);
    const c = clientSummaryMap.get(row.clientId) || { id: row.clientId, total: 0, pending: 0 };
    c.total += metrics.total; c.pending += metrics.pending; clientSummaryMap.set(row.clientId, c);
    if (row.kind === 'sale') addFilteredProduct(row.sale.productId, Number(row.sale.qty) || 0, row.total);
    else for (const it of row.order.itens || []) if (!productId || it.productId === productId) addFilteredProduct(it.productId, Number(it.qty) || 0, (Number(it.qty) || 0) * (Number(it.unitPrice) || 0));
  }
  const filteredClients = [...clientSummaryMap.values()].map((c) => ({ ...c, name: c.id === '__sem__' ? 'Sem cliente / venda rápida' : (store.get('clients', c.id)?.name || '(cliente removido)') })).sort((a, b) => b.total - a.total);
  const filteredProducts = [...productSummaryMap.values()].map((p) => ({ ...p, name: store.get('products', p.id)?.name || '(produto removido)' })).sort((a, b) => b.total - a.total);

  const detailRows = visibleRows.map((row) => {
    if (row.kind === 'sale') return saleRow(ctx, row.sale);
    const enc = row.order;
    const cli = enc.clienteId ? store.get('clients', enc.clienteId) : null;
    return el('li', { class: 'pa-row-item', onclick: () => ctx.actions.openModal({ kind: 'encomenda-edit', id: enc.id }) }, [
      el('div', { class: 'pa-grow' }, [
        el('div', { class: 'pa-enc-title' }, [el('strong', { text: cli?.name || 'Sem cliente' }), el('span', { class: enc.entregue ? 'pa-badge pa-ok' : 'pa-badge', text: enc.entregue ? 'entregue' : 'não entregue' }), el('span', { class: row.paid ? 'pa-badge pa-ok' : 'pa-badge pa-warn', text: row.paid ? 'recebido' : 'a receber' })]),
        el('span', { class: 'pa-muted', text: `${fmtDate(enc.deliveryDate)} · ${encomendaItemsResumo(store, enc)}` }),
      ]),
      el('strong', { class: 'pa-num', text: brl(row.total) }),
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
      el('strong', { class: 'pa-num pa-bad', text: brl(row.total) }), el('span', { class: 'pa-chev', text: '›' }),
    ]);
  });

  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Relatório gerencial' }), el('h2', { text: 'Vendas' })]),
      activeProducts.length > 0 && el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'venda-new', onclick: () => ctx.actions.openModal({ kind: 'venda-add' }) }, '+ Venda rápida'),
    ].filter(Boolean)),
    el('p', { class: 'pa-hint', text: 'Todos = vendas pagas e pendentes do período. Desistências ficam separadas. Entregue e pago são controles independentes.' }),
    period,
    el('div', { class: 'pa-filtergrid' }, [field('Filtrar por produto', productFilter), field('Filtrar por cliente', clientFilter)]),
    el('div', { class: 'pa-chiprow' }, [chip('todos', 'Todos'), chip('recebidos', 'Recebidos'), chip('naorecebidos', 'Não recebidos'), chip('desistencias', 'Desistências')]),
    status === 'desistencias'
      ? el('div', {}, [
          el('div', { class: 'pa-statgrid' }, [statCard('Total de desistências', brl(visibleCancellations.reduce((sum, row) => sum + rowMetrics({ ...row, received: 0, pending: row.total }).total, 0)), 'bad')]),
          cancellationRows.length ? el('ul', { class: 'pa-list pa-rows' }, cancellationRows) : el('p', { class: 'pa-empty', text: 'Nenhuma desistência neste período.' }),
        ])
      : el('div', {}, [
          el('div', { class: 'pa-statgrid' }, [statCard('Total vendido', brl(filteredTotals.total), 'navy'), statCard('Recebido', brl(filteredTotals.received), 'ok'), statCard('Pendente', brl(filteredTotals.pending), filteredTotals.pending > 0.005 ? 'warn' : 'soft')]),
          selectedProduct && el('section', { class: 'pa-detail-card', 'data-testid': 'venda-product-detail' }, [
            el('div', { class: 'pa-cardhead' }, [
              el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Produto selecionado' }), el('h3', { class: 'pa-h3', text: selectedProduct.name })]),
              el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => ctx.actions.setVendaPeriod({ vendaProductId: '' }) }, 'Limpar'),
            ]),
            el('div', { class: 'pa-statgrid' }, [
              statCard('Quantidade vendida', `${fmtNum(productSales.reduce((sum, row) => sum + row.qty, 0))} un`, 'navy'),
              statCard('Valor do produto', brl(productSales.reduce((sum, row) => sum + row.total, 0)), 'soft'),
            ]),
            el('h3', { class: 'pa-h3', text: 'Quando, quem comprou e situação' }),
            productSales.length ? el('ul', { class: 'pa-list pa-rows' }, productSales.map((row) => el('li', { class: 'pa-list-item' }, [
              el('time', { class: 'pa-muted', text: fmtDate(row.at) }),
              el('div', { class: 'pa-grow' }, [el('strong', { text: row.clientName }), el('span', { class: 'pa-muted', text: `${fmtNum(row.qty)} un` })]),
              el('span', { class: row.received ? 'pa-badge pa-ok' : 'pa-badge pa-warn', text: row.received ? 'recebida' : (row.partial ? 'parcial · a receber' : 'a receber') }),
              el('strong', { class: 'pa-num', text: brl(row.total) }),
            ]))) : el('p', { class: 'pa-empty', text: 'Nenhuma venda deste produto com os filtros escolhidos.' }),
          ]),
          filteredClients.length > 0 && el('h3', { class: 'pa-h3', text: 'Clientes que compraram' }),
          filteredClients.length > 0 && el('div', { class: 'pa-report-list' }, filteredClients.map((c) => el('div', { class: 'pa-preview-line' }, [el('span', { class: 'pa-grow', text: c.name }), el('strong', { text: brl(c.total) }), c.pending > 0.005 && el('span', { class: 'pa-badge pa-warn', text: `falta ${brl(c.pending)}` })].filter(Boolean)))),
          filteredProducts.length > 0 && el('h3', { class: 'pa-h3', text: 'Produtos vendidos' }),
          filteredProducts.length > 0 && el('div', { class: 'pa-report-list' }, filteredProducts.map((p) => el('div', { class: 'pa-preview-line' }, [el('span', { class: 'pa-grow', text: p.name }), el('span', { class: 'pa-muted', text: `${fmtNum(p.qty)} un` }), el('strong', { text: brl(p.total) })]))),
          detailRows.length > 0 && el('h3', { class: 'pa-h3', text: 'Vendas do período' }),
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
  const rev = s.qty * s.unitPrice;
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
  const products = store.state.products.filter(productIsActive);
  const es = store.toEngineStore();
  const lens = estimateLens(config);
  const suggested = (pid) => sellingPrice(store, pid);

  const prodSel = el('select', { class: 'pa-input', 'data-testid': 'venda-product' },
    products.map((p) => el('option', { value: p.id, text: p.name })));
  const date = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'venda-date', type: 'date', value: todayInput() });
  const qty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'venda-qty', type: 'text', inputmode: 'decimal', value: '1' });
  const price = moneyField(products[0] ? suggested(products[0].id) : null, 'venda-price');
  const channel = el('input', { class: 'pa-input', 'data-testid': 'venda-canal', type: 'text', placeholder: 'canal (opcional)' });

  prodSel.addEventListener('change', () => {
    const s = suggested(prodSel.value);
    price.input.value = s != null ? fmtMoneyInput(s) : '';
  });

  function save() {
    const p = store.get('products', prodSel.value);
    const q = parseNum(qty.value);
    const up = parseNum(price.input.value);
    if (!p || !(q > 0) || up == null) { return; }
    let cost = 0;
    try { cost = productUnitCost(es, p.id, config, lens); } catch { /* leave 0 if not yet priceable */ }
    const at = date.value ? new Date(`${date.value}T12:00:00`).toISOString() : nowIso();
    ctx.actions.mutate((s) => s.addSale({
      id: uuid(), at, productId: p.id, qty: q, unitPrice: up,
      paymentFeePct: config.paymentFeePct, costSnapshot: cost,
      ...(channel.value.trim() ? { channel: channel.value.trim() } : {}),
    }));
  }

  const rows = [
    field('Produto', prodSel),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Data' }), date, el('span', { class: 'pa-lab', text: 'Qtd' }), qty]),
    field('Preço de venda', price),
    field('Canal (opcional)', channel),
    el('p', { class: 'pa-hint', text: 'O preço sugerido já vem preenchido — edite se vendeu por outro valor. O custo é congelado na venda para a margem ficar verdadeira.' }),
  ];
  return sheet({ title: 'Registrar venda', rows, onSave: save, saveTestid: 'venda-add' });
}

// ── Encomendas (Rev 04 — the order = the sale; mutable, editable) ────────────────

/** A search-to-select client picker (Rev 07) — scales past a dropdown when there are many clients.
 *  `.value()` → the selected client id (or '' for sem cliente). */
function clientePicker(store, initialId) {
  let selected = initialId || '';
  const container = el('div', { class: 'pa-cli-picker' });
  function render() {
    const cli = selected ? store.get('clients', selected) : null;
    if (cli) {
      container.replaceChildren(el('div', { class: 'pa-cli-chip', 'data-testid': 'enc-cliente-chip' }, [
        el('span', { class: 'pa-grow', text: cli.name }),
        el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Trocar cliente', onclick: () => { selected = ''; render(); } }, '✕'),
      ]));
      return;
    }
    const search = el('input', { class: 'pa-input pa-search', 'data-testid': 'enc-cliente-search', type: 'search', placeholder: 'Buscar cliente (ou deixe sem cliente)…' });
    const results = el('ul', { class: 'pa-list pa-tight pa-suggest', style: 'display:none' });
    search.addEventListener('input', () => {
      const q = norm(search.value);
      if (!q) { results.style.display = 'none'; results.replaceChildren(); return; }
      const matches = store.state.clients.filter((c) => !c.inactive && norm(c.name).includes(q)).slice(0, 6);
      results.style.display = matches.length ? '' : 'none';
      results.replaceChildren(...matches.map((c) => el('li', { class: 'pa-row-item', 'data-testid': 'enc-cliente-result', onclick: () => { selected = c.id; render(); } }, [el('div', { class: 'pa-grow' }, el('strong', { text: c.name })), el('span', { class: 'pa-add', text: '+' })])));
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
  if (productId) list = list.filter((e) => (e.itens || []).some((it) => it.productId === productId));
  if (deliveryMethod) list = list.filter((e) => (e.deliveryMethod || 'retirada') === deliveryMethod);
  if (status === 'desistencias') list = list.filter((e) => e.desistenciaAt);
  else if (status === 'naoentregue') list = list.filter((e) => !e.desistenciaAt && !e.entregue);
  else if (status === 'entregues') list = list.filter((e) => !e.desistenciaAt && e.entregue);
  else if (status === 'areceber') list = list.filter((e) => !e.desistenciaAt && (e.total || 0) - store.paidFor(e.id) > 0.005);
  else if (status === 'pagas') list = list.filter((e) => !e.desistenciaAt && (e.total || 0) - store.paidFor(e.id) <= 0.005);
  else if (status === 'urgentes') list = list.filter((e) => !e.desistenciaAt && e.urgente);
  list.sort((a, b) => {
    if (!!a.urgente !== !!b.urgente) return a.urgente ? -1 : 1; // urgentes pinned to the top
    if (sort === 'cliente') return cliName(a).localeCompare(cliName(b));
    if (sort === 'pedido') return (a.at < b.at ? 1 : -1);        // most recently lançada first
    return (a.deliveryDate < b.deliveryDate ? 1 : -1);           // by delivery date
  });
  const ul = el('ul', { class: 'pa-list pa-rows' }, list.map((e) => encomendaRow(ctx, e)));

  const chip = (k, label) => el('button', { class: 'pa-chip' + (status === k ? ' pa-chip-on' : ''), 'data-testid': `enc-f-${k}`, onclick: () => ctx.actions.setEncStatus(k) }, label);
  const sortSel = el('select', { class: 'pa-input pa-narrow', 'data-testid': 'enc-sort' }, [['entrega', 'Entrega'], ['cliente', 'Cliente'], ['pedido', 'Pedido']].map(([v, t]) => el('option', { value: v, text: t, ...(sort === v ? { selected: 'selected' } : {}) })));
  sortSel.addEventListener('change', () => ctx.actions.setEncSort(sortSel.value));
  const period = periodFields(start, end, ({ start: s, end: e }) => ctx.actions.setEncPeriod({ encStart: s, encEnd: e }), 'enc');
  const clientFilter = el('select', { class: 'pa-input', 'data-testid': 'enc-client-filter' }, [
    el('option', { value: '', text: 'Todos os clientes', ...(!clientId ? { selected: 'selected' } : {}) }),
    ...store.state.clients.slice().sort((a, b) => norm(a.name).localeCompare(norm(b.name))).map((c) => el('option', { value: c.id, text: c.name, ...(clientId === c.id ? { selected: 'selected' } : {}) })),
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

function encomendaItemsResumo(store, e) {
  return (e.itens || []).map((it) => { const p = store.get('products', it.productId); return `${fmtNum(it.qty)}× ${p ? p.name : '?'}`; }).join(', ');
}

/** Derived payment status of an order from its payments (never a stored flag). */
function paymentStatus(store, e) {
  const paid = store.paidFor(e.id);
  const saldo = (e.total || 0) - paid;
  if (saldo <= 0.005) return { label: 'pago', cls: 'pa-ok', paid, saldo: 0 };
  if (paid > 0.005) return { label: 'parcial', cls: 'pa-warn', paid, saldo };
  return { label: 'não pago', cls: 'pa-warn', paid, saldo };
}

function encomendaRow(ctx, e) {
  const { store } = ctx;
  const cli = e.clienteId ? store.get('clients', e.clienteId) : null;
  const resumo = encomendaItemsResumo(store, e);
  const st = paymentStatus(store, e);
  const paymentLabel = st.saldo <= 0.005 ? 'pago' : (st.paid > 0.005 ? 'parcial · a pagar' : 'a pagar');
  const deliveryLabel = (e.deliveryMethod || 'retirada') === 'motoboy' ? 'Motoboy' : 'Retirada';
  const stop = (fn) => (ev) => { ev.stopPropagation(); fn(); };
  const urg = !e.desistenciaAt && el('button', { class: 'pa-btn pa-ghost pa-sm pa-urg-btn', title: e.urgente ? 'Tirar urgência' : 'Marcar urgente', onclick: stop(() => ctx.actions.mutate((s) => s.upsertEncomenda({ ...e, urgente: !e.urgente }))) }, e.urgente ? '⭐' : '☆');
  const ent = !e.desistenciaAt && el('button', { class: 'pa-ent' + (e.entregue ? ' pa-ent-on' : ''), 'data-testid': 'enc-entregue', title: e.entregue ? 'Entregue' : 'Marcar como entregue', onclick: stop(() => ctx.actions.mutate((s) => s.upsertEncomenda({ ...e, entregue: !e.entregue }))) }, e.entregue ? '✓ Entregue' : 'Entregar');
  return el('li', { class: 'pa-row-item' + (e.urgente ? ' pa-urgente' : '') + (e.entregue ? ' pa-row-done' : '') + (e.desistenciaAt ? ' pa-cancelled' : ''), 'data-search': `${cli ? cli.name : ''} ${resumo} ${deliveryLabel}`, onclick: () => ctx.actions.openModal({ kind: 'encomenda-edit', id: e.id }) }, [
    el('div', { class: 'pa-grow' }, [
      el('div', { class: 'pa-enc-title' }, [e.desistenciaAt && el('span', { class: 'pa-badge pa-bad', text: 'DESISTÊNCIA' }), e.urgente && !e.desistenciaAt && el('span', { class: 'pa-badge pa-urg', text: 'URGENTE' }), el('strong', { text: cli ? cli.name : 'Sem cliente' }), !e.desistenciaAt && el('span', { class: `pa-badge ${st.cls}`, text: paymentLabel }), el('span', { class: 'pa-badge', text: deliveryLabel })].filter(Boolean)),
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

  const items = enc ? enc.itens.map((it) => ({ productId: it.productId, qty: it.qty, unitPrice: it.unitPrice })) : [];

  const cliPicker = clientePicker(store, enc ? enc.clienteId : '');
  const urgenteChk = el('input', { type: 'checkbox', 'data-testid': 'enc-urgente' }); urgenteChk.checked = !!(enc && enc.urgente);
  const date = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'enc-date', type: 'date', value: enc ? enc.deliveryDate.slice(0, 10) : todayInput() });
  const entrega = el('select', { class: 'pa-input', 'data-testid': 'enc-entrega' }, [['retirada', 'Retirada'], ['motoboy', 'Motoboy']].map(([v, t]) => el('option', { value: v, text: t, ...(enc && enc.deliveryMethod === v ? { selected: 'selected' } : {}) })));
  const frete = moneyField(enc ? enc.frete : null, 'enc-frete');
  const notes = el('textarea', { class: 'pa-input pa-textarea', 'data-testid': 'enc-notes', rows: '2', placeholder: 'Observações (opcional)' });
  notes.value = enc ? (enc.notes || '') : '';

  const totalEl = el('strong', { 'data-testid': 'enc-total' });
  const grandTotal = () => items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0) + (parseNum(frete.input.value) || 0);
  const renderTotal = () => { totalEl.textContent = brl(grandTotal()); };

  const itemsList = el('ul', { class: 'pa-list pa-tight' });
  function renderItems() {
    itemsList.replaceChildren(...(items.length ? items.map((it, idx) => {
      const p = store.get('products', it.productId);
      const qty = el('input', { class: 'pa-input pa-qty', type: 'text', inputmode: 'decimal', value: fmtNum(it.qty), 'aria-label': 'quantidade' });
      const price = el('input', { class: 'pa-input pa-unit', type: 'text', inputmode: 'decimal', value: fmtMoneyInput(it.unitPrice), 'aria-label': 'preço' });
      const lineTot = el('span', { class: 'pa-muted pa-linetot' });
      const renderLine = () => { lineTot.textContent = brl((Number(it.qty) || 0) * (Number(it.unitPrice) || 0)); };
      qty.addEventListener('input', () => { it.qty = parseNum(qty.value) || 0; renderLine(); renderTotal(); });
      price.addEventListener('input', () => { it.unitPrice = parseNum(price.value) || 0; renderLine(); renderTotal(); });
      renderLine();
      return el('li', { class: 'pa-list-item pa-encitem' }, [
        qty,
        el('div', { class: 'pa-grow' }, [el('div', { text: p ? p.name : '(produto removido)' }), lineTot]),
        el('span', { class: 'pa-lab', text: 'R$' }), price,
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
    results.replaceChildren(...matches.map((p) => el('li', { class: 'pa-row-item', 'data-testid': 'enc-prodresult', onclick: () => { items.push({ productId: p.id, qty: 1, unitPrice: suggested(p.id) }); search.value = ''; renderResults(); renderItems(); renderTotal(); } }, [
      el('div', { class: 'pa-grow' }, el('strong', { text: p.name })), el('span', { class: 'pa-add', text: '+' }),
    ])));
  }
  search.addEventListener('input', renderResults);
  frete.input.addEventListener('input', renderTotal);
  renderTotal();

  function save() {
    if (!items.length) { search.focus(); return; }
    const cost = items.reduce((s, it) => s + (Number(it.qty) || 0) * unitCost(it.productId), 0);
    const fr = parseNum(frete.input.value);
    const ob = notes.value.trim();
    ctx.actions.mutate((s) => s.upsertEncomenda({
      ...(enc || { at: nowIso() }),
      id: enc ? enc.id : uuid(),
      deliveryDate: date.value ? new Date(`${date.value}T12:00:00`).toISOString() : nowIso(),
      clienteId: cliPicker.value() || undefined,
      itens: items.map((it) => ({ productId: it.productId, qty: Number(it.qty) || 0, unitPrice: Number(it.unitPrice) || 0 })),
      total: grandTotal(),
      costSnapshot: cost,
      deliveryMethod: entrega.value,
      frete: fr == null ? undefined : fr,
      notes: ob || undefined,
      urgente: urgenteChk.checked || undefined,
    }));
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
        el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Saldo' }), el('td', { class: 'pa-num' + (st.saldo > 0.005 ? ' pa-bad' : ''), text: brl(st.saldo) })]),
      ]),
      hist.length > 0 && el('ul', { class: 'pa-list pa-tight' }, hist.map((pg) => el('li', { class: 'pa-list-item' + (store.isReversed('payment', pg.id) ? ' pa-reversed' : '') }, [
        el('span', { class: 'pa-grow pa-muted', text: `${fmtDate(pg.at)}${pg.forma ? ` · ${pg.forma}` : ''}` }),
        el('span', { class: 'pa-num', text: brl(pg.valor) }),
        estornoControl(ctx, 'payment', pg.id),
      ]))),
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
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Entrega' }), date, entrega]),
    el('label', { class: 'pa-check' }, [urgenteChk, el('span', { text: 'Marcar como URGENTE (vai pro topo da lista)' })]),
    el('h3', { class: 'pa-h3', text: 'Itens' }),
    itemsList,
    search, results,
    el('div', { class: 'pa-row pa-totals' }, [el('span', { class: 'pa-grow' }, [el('strong', { text: 'Total ' }), totalEl])]),
    field('Frete (opcional)', frete),
    field('Observações (opcional)', notes),
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
  const saldo = enc ? Math.max(0, (enc.total || 0) - store.paidFor(encomendaId)) : 0;
  const date = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'pag-date', type: 'date', value: todayInput() });
  const valor = moneyField(saldo > 0 ? saldo : null, 'pag-valor');
  const forma = el('select', { class: 'pa-input', 'data-testid': 'pag-forma' }, ['Pix', 'Dinheiro', 'Cartão', 'Outro'].map((f) => el('option', { value: f, text: f })));

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
      date: fmtDate(e.deliveryDate), resumo: encomendaItemsResumo(store, e), total: e.total || 0, saldo: (e.total || 0) - store.paidFor(e.id),
    }));
    return { client, orders, saldoTotal: orders.reduce((s, o) => s + Math.max(0, o.saldo), 0) };
  });
}

/** Encomendas filtered by payment state, for the ficha report modes. */
function encomendasByMode(store, mode) {
  return store.state.encomendas.filter((e) => {
    if (e.desistenciaAt) return false;
    const saldo = (e.total || 0) - store.paidFor(e.id);
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
    items: enc.itens.map((it) => { const p = store.get('products', it.productId); return { name: p ? p.name : '(produto)', qty: it.qty, unitPrice: it.unitPrice, total: (Number(it.qty) || 0) * (Number(it.unitPrice) || 0) }; }),
    referente: `pedido de ${fmtDate(enc.deliveryDate)}`,
    total: enc.total || 0,
    pago: st.paid,
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
  if (status === 'aberto') orders = orders.filter((e) => (e.total || 0) - store.paidFor(e.id) > 0.005);
  else if (status === 'recebidos') orders = orders.filter((e) => (e.total || 0) - store.paidFor(e.id) <= 0.005);
  const grouped = new Map();
  for (const e of orders) {
    const key = e.clienteId || '__sem__';
    const g = grouped.get(key) || { key, orders: [], total: 0, received: 0, pending: 0 };
    const paid = Math.min(Number(e.total) || 0, Math.max(0, store.paidFor(e.id)));
    g.orders.push(e); g.total += Number(e.total) || 0; g.received += paid; g.pending += Math.max(0, (Number(e.total) || 0) - paid);
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

const FIN_STATUS = { aberto: ['Em aberto', 'pa-warn'], parcial: ['Parcial', 'pa-warn'], vencido: ['Vencido', 'pa-bad'], quitado: ['Quitado', 'pa-ok'], cancelado: ['Cancelado', ''] };
const titleBadge = (status) => el('span', { class: `pa-badge ${FIN_STATUS[status]?.[1] || ''}`, text: FIN_STATUS[status]?.[0] || status });
const activeFinanceCategories = (store, direction) => store.state.categories.filter((c) => !c.archived && c.parentId && c.cashFlowGroup !== 'nao-caixa' && (direction === 'receber' ? (c.nature === 'receita' || c.kind === 'receita') : (['custo', 'despesa', 'investimento'].includes(c.nature || '') || ['custo', 'despesaFixa', 'despesaVariavel'].includes(c.kind)))).sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true }));
const accountOptions = (store) => store.state.cashAccounts.filter((a) => !a.archived);
const dateIso = (value) => value ? new Date(`${value}T12:00:00`).toISOString() : nowIso();

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
  const preset = (key, label) => el('button', { class: 'pa-chip' + (presetKey === key ? ' pa-chip-on' : ''), 'data-testid': `dashboard-${key}`, onclick: () => { if (key === 'personalizado') ctx.actions.setDashboardView({ dashboardPreset: key }); else { const [s, e] = presetRange(key); ctx.actions.setDashboardView({ dashboardPreset: key, dashboardStart: s, dashboardEnd: e }); } } }, label);
  const productQty = (row) => { const p = row ? store.get('products', row.id) : null; return row ? `${fmtNum(row.qty)} ${p?.saleUnit || 'un'}` : 'Sem dados'; };
  const insight = (label, title, detail, tone = 'soft') => el('section', { class: `pa-insight pa-insight-${tone}` }, [el('span', { class: 'pa-eyebrow', text: label }), el('strong', { text: title || 'Sem dados no período' }), detail && el('span', { class: 'pa-muted', text: detail })].filter(Boolean));
  const quick = (label, tab, tone = '') => el('button', { class: `pa-btn ${tone}`, onclick: () => ctx.actions.setTab(tab) }, label);
  return el('section', { class: 'pa-card pa-fin-hero' }, [
    el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Visão financeira e comercial' }), el('h2', { text: 'Dashboard do negócio' })])]),
    el('div', { class: 'pa-chiprow' }, [preset('hoje', 'Hoje'), preset('semana', 'Semana'), preset('mes', 'Mês'), preset('ano', 'Ano'), preset('personalizado', 'Período específico')]),
    presetKey === 'personalizado'
      ? periodFields(start, end, ({ start: s, end: e }) => ctx.actions.setDashboardView({ dashboardStart: s, dashboardEnd: e }), 'dashboard')
      : el('p', { class: 'pa-hint', text: `Período selecionado automaticamente: ${fmtDate(`${start}T12:00:00`)} até ${fmtDate(`${end}T12:00:00`)}` }),
    el('p', { class: 'pa-hint', text: 'Caixa realizado mostra somente dinheiro que entrou ou saiu. Indicadores de vendas usam a data da venda ou da entrega agendada.' }),
    el('div', { class: 'pa-statgrid' }, [statCard('Entradas do período', brl(flow.totalIn), 'ok'), statCard('Saídas do período', brl(flow.totalOut), flow.totalOut ? 'warn' : 'soft'), statCard('Saldo do período', brl(flow.totalIn - flow.totalOut), flow.totalIn - flow.totalOut >= 0 ? 'navy' : 'bad')]),
    el('div', { class: 'pa-statgrid' }, [statCard('A receber no período', brl(receivable), receivable ? 'warn' : 'soft'), statCard('A pagar no período', brl(payable), payable ? 'warn' : 'soft'), statCard('Vencido a receber', brl(overdueReceivable), overdueReceivable ? 'bad' : 'ok'), statCard('Vencido a pagar', brl(overduePayable), overduePayable ? 'bad' : 'ok')]),
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
    el('div', { class: 'pa-actiongrid' }, [quick('Contas a receber', 'fin-receber', 'pa-primary'), quick('Contas a pagar', 'fin-pagar'), quick('Fluxo de caixa', 'fin-fluxo'), quick('Lançamentos', 'financeiro'), quick('Recibo / Orçamento', 'fin-documentos'), quick('Compras', 'fin-compras'), quick('Plano de Contas', 'fin-plano'), quick('Relatórios financeiros', 'fin-relatorios'), quick('Relatório gerencial', 'relatorios'), quick('Preços e custos', 'precos'), quick('Simular preço', 'simulador')]),
  ].filter(Boolean));
}

function financeTitlePanel(ctx, direction) {
  const { store } = ctx; const status = ctx.view.finStatus || 'aberto'; const start = ctx.view.finStart; const end = ctx.view.finEnd;
  const parties = direction === 'receber' ? store.state.clients : store.state.suppliers;
  const partyMap = new Map(parties.map((p) => [p.id, { key: p.id, name: p.name }]));
  for (const title of store.state.financeTitles.filter((t) => t.direction === direction && t.partyName)) {
    const key = title.partyId || `name:${norm(title.partyName)}`;
    if (!partyMap.has(key)) partyMap.set(key, { key, name: title.partyName });
  }
  const partyChoices = [...partyMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const financeCategories = activeFinanceCategories(store, direction);
  const selectedParty = partyChoices.some((p) => p.key === ctx.view.finPartyId) ? ctx.view.finPartyId : undefined;
  const selectedCategory = financeCategories.some((c) => c.id === ctx.view.finTitleCategory) ? ctx.view.finTitleCategory : undefined;
  let rows = listTitles(store, { direction, start, end, status, categoryId: selectedCategory, method: direction === 'receber' ? ctx.view.finMethod || undefined : undefined });
  if (selectedParty) rows = rows.filter((r) => r.title.partyId === selectedParty || (!r.title.partyId && `name:${norm(r.title.partyName)}` === selectedParty));
  const total = rows.reduce((s, r) => s + (status === 'quitado' ? r.paid : r.balance), 0);
  const ul = el('ul', { class: 'pa-list pa-rows' }, rows.map((r) => el('li', { class: 'pa-row-item', 'data-search': `${r.title.partyName || ''} ${r.title.description}`, onclick: () => ctx.actions.openModal({ kind: 'finance-title-detail', id: r.title.id }) }, [
    el('div', { class: 'pa-grow' }, [el('div', { class: 'pa-enc-title' }, [el('strong', { text: r.title.partyName || r.title.description }), titleBadge(r.status)]), el('span', { class: 'pa-muted', text: `${fmtDate(r.title.dueDate)} · ${r.title.description}${r.overdueDays ? ` · ${r.overdueDays} dia(s) em atraso` : ''}` })]),
    el('div', { class: 'pa-list-value' }, [el('span', { class: 'pa-muted', text: r.status === 'quitado' ? 'recebido/pago' : 'saldo' }), el('strong', { class: r.status === 'vencido' ? 'pa-bad' : '', text: brl(r.status === 'quitado' ? r.paid : r.balance) })]), el('span', { class: 'pa-chev', text: '›' }),
  ])));
  const chip = (key, label) => el('button', { class: 'pa-chip' + (status === key ? ' pa-chip-on' : ''), onclick: () => ctx.actions.setFinanceView({ finStatus: key }) }, label);
  const partyFilter = el('select', { class: 'pa-input', 'data-testid': `fin-${direction}-party`, onchange: (e) => ctx.actions.setFinanceView({ finPartyId: e.target.value }) }, [el('option', { value: '', text: direction === 'receber' ? 'Todos os clientes' : 'Todos os fornecedores' }), ...partyChoices.map((p) => el('option', { value: p.key, text: p.name, ...(selectedParty === p.key ? { selected: 'selected' } : {}) }))]);
  const catFilter = el('select', { class: 'pa-input', onchange: (e) => ctx.actions.setFinanceView({ finTitleCategory: e.target.value }) }, [el('option', { value: '', text: 'Todas as categorias' }), ...financeCategories.map((c) => el('option', { value: c.id, text: c.name, ...(selectedCategory === c.id ? { selected: 'selected' } : {}) }))]);
  const methodFilter = el('select', { class: 'pa-input', onchange: (e) => ctx.actions.setFinanceView({ finMethod: e.target.value }) }, [el('option', { value: '', text: 'Todas as formas' }), ...['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Boleto', 'Outro'].map((m) => el('option', { value: m, text: m, ...(ctx.view.finMethod === m ? { selected: 'selected' } : {}) }))]);
  const headerActions = el('div', { class: 'pa-row pa-form' }, [
    direction === 'receber' && el('button', { class: 'pa-btn pa-sm', 'data-testid': 'fin-client-statement-open', onclick: () => ctx.actions.openModal({ kind: 'client-statement', clientId: store.get('clients', selectedParty)?.id }) }, 'Ficha do cliente'),
    el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': `fin-${direction}-new`, onclick: () => ctx.actions.openModal({ kind: 'finance-title-add', direction }) }, '+ Novo'),
  ].filter(Boolean));
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: direction === 'receber' ? 'Clientes e receitas' : 'Fornecedores e despesas' }), el('h2', { text: direction === 'receber' ? 'Contas a Receber' : 'Contas a Pagar' })]), headerActions]),
    el('p', { class: 'pa-hint', text: direction === 'receber' ? 'Vendas a prazo entram automaticamente. Abra um título para receber total ou parcialmente; use Ficha do cliente para consultar e imprimir compras, produtos e pagamentos.' : 'Registre vencimentos antes de pagar. Compras de insumos também geram contas automaticamente.' }),
    periodFields(start, end, ({ start: s, end: e }) => ctx.actions.setFinanceView({ finStart: s, finEnd: e }), `fin-${direction}`),
    el('div', { class: 'pa-filtergrid' }, [field(direction === 'receber' ? 'Cliente' : 'Fornecedor', partyFilter), field('Categoria', catFilter), direction === 'receber' && field('Forma de pagamento', methodFilter)].filter(Boolean)),
    el('div', { class: 'pa-chiprow' }, [chip('aberto', 'Em aberto'), chip('parcial', 'Parciais'), chip('vencido', 'Vencidos'), chip('quitado', 'Quitados'), chip('todos', 'Todos')]),
    el('div', { class: 'pa-statgrid' }, [statCard(status === 'quitado' ? (direction === 'receber' ? 'Total recebido' : 'Total pago') : 'Saldo do filtro', brl(total), total && status !== 'quitado' ? 'warn' : 'ok')]),
    rows.length ? el('div', {}, [searchInput(direction === 'receber' ? 'Buscar cliente…' : 'Buscar fornecedor…', ul, `fin-${direction}-search`), ul]) : el('p', { class: 'pa-empty', text: 'Nenhum título com este filtro.' }),
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
  const clients = store.state.clients.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const type = el('select', { class: 'pa-input', 'data-testid': 'commercial-type' }, [
    el('option', { value: 'orcamento', text: 'Orçamento', ...(initialType === 'orcamento' ? { selected: 'selected' } : {}) }),
    el('option', { value: 'recibo', text: 'Recibo não fiscal', ...(initialType === 'recibo' ? { selected: 'selected' } : {}) }),
  ]);
  const date = el('input', { class: 'pa-input', 'data-testid': 'commercial-date', type: 'date', value: todayInput() });
  const validity = el('input', { class: 'pa-input', 'data-testid': 'commercial-validity', type: 'date', value: commercialDefaultValidity() });
  const client = el('select', { class: 'pa-input', 'data-testid': 'commercial-client' }, [
    el('option', { value: '', text: 'Pessoa não cadastrada' }),
    ...clients.map((c) => el('option', { value: c.id, text: `${c.name}${c.inactive ? ' (inativo)' : ''}`, ...(c.id === initialClientId ? { selected: 'selected' } : {}) })),
  ]);
  const manualName = el('input', { class: 'pa-input', 'data-testid': 'commercial-client-name', type: 'text', placeholder: 'Nome da pessoa', value: modal.clientName || '' });
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

  const orderItems = order ? (order.itens || []).map((item) => ({
    productId: item.productId, name: store.get('products', item.productId)?.name || '(produto removido)',
    qty: Number(item.qty) || 0, unitPrice: Number(item.unitPrice) || 0,
  })) : [];
  if (order && Number(order.frete) > 0) orderItems.push({ name: 'Frete / entrega', qty: 1, unitPrice: Number(order.frete) });
  if (orderItems.length) orderItems.forEach(addLine); else addLine();
  client.addEventListener('change', renderClient); type.addEventListener('change', renderType);
  validity.addEventListener('change', renderTotals); paid.input.addEventListener('input', renderTotals);
  renderClient(); renderType();

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
      field('Cliente', client), registeredInfo, manualFields,
      el('h3', { class: 'pa-h3', text: 'Itens' }), itemsBox,
      el('button', { class: 'pa-btn pa-sm', 'data-testid': 'commercial-item-add', type: 'button', onclick: () => addLine() }, '+ Adicionar item'),
      budgetFields, receiptFields, field('Condição ou forma de pagamento', condition), field('Observações', notes), totalPreview,
    ],
    onSave: generate, saveTestid: 'commercial-pdf', saveLabel: 'Gerar PDF A4',
  });
}

MODALS['client-statement'] = (ctx, m) => clientStatementSheet(ctx, m);

function clientStatementSheet(ctx, modal = {}) {
  const { store } = ctx;
  const clients = store.state.clients.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (!clients.length) return sheet({ title: 'Ficha financeira do cliente', rows: [el('p', { class: 'pa-empty', text: 'Cadastre um cliente primeiro para consultar sua ficha financeira.' })] });

  const initialId = clients.some((c) => c.id === modal.clientId) ? modal.clientId : clients[0].id;
  const client = el('select', { class: 'pa-input', 'data-testid': 'client-statement-client' }, clients.map((c) => el('option', { value: c.id, text: `${c.name}${c.inactive ? ' (inativo)' : ''}`, ...(c.id === initialId ? { selected: 'selected' } : {}) })));
  const mode = el('select', { class: 'pa-input', 'data-testid': 'client-statement-mode' }, [el('option', { value: 'geral', text: 'Geral — todo o histórico' }), el('option', { value: 'periodo', text: 'Período específico' })]);
  const start = el('input', { class: 'pa-input', 'data-testid': 'client-statement-start', type: 'date', value: ctx.view.finStart || '' });
  const end = el('input', { class: 'pa-input', 'data-testid': 'client-statement-end', type: 'date', value: ctx.view.finEnd || '' });
  const period = el('div', { class: 'pa-period', 'data-testid': 'client-statement-period', style: 'display:none' }, [field('Data inicial', start), el('span', { class: 'pa-period-arrow', text: 'até' }), field('Data final', end)]);
  const preview = el('div', { 'data-testid': 'client-statement-preview' });
  const print = el('button', { class: 'pa-btn pa-primary pa-grow', 'data-testid': 'client-statement-pdf' }, 'Gerar PDF A4 para imprimir');

  const currentStatement = () => clientFinancialStatement(store, client.value, mode.value === 'periodo' ? start.value : '', mode.value === 'periodo' ? end.value : '');
  const movementRow = (row) => {
    const purchase = row.type === 'purchase'; const payment = row.type === 'payment';
    return el('section', { class: 'pa-detail-card', 'data-testid': `client-statement-${row.type}` }, [
      el('div', { class: 'pa-row' }, [
        el('div', { class: 'pa-grow' }, [el('strong', { text: payment ? 'Pagamento' : purchase ? 'Compra / encomenda' : 'Valor a receber' }), el('span', { class: 'pa-muted', text: fmtDate(row.at) })]),
        el('strong', { class: payment ? 'pa-positive' : 'pa-num', text: `${payment ? '+ ' : ''}${brl(row.amount)}` }),
      ]),
      purchase && el('ul', { class: 'pa-list pa-tight' }, row.items.map((item) => el('li', { class: 'pa-list-item' }, [
        el('span', { class: 'pa-grow', text: `${fmtNum(item.qty)}× ${item.name}` }),
        el('span', { class: 'pa-muted', text: `${brl(item.unitPrice)} cada` }),
        el('strong', { class: 'pa-num', text: brl(item.total) }),
      ]))),
      purchase && el('p', { class: 'pa-muted', text: [`Entrega: ${row.deliveryMethod === 'motoboy' ? 'Motoboy' : 'Retirada'}`, row.freight > 0 && `Frete ${brl(row.freight)}`, row.notes && `Obs.: ${row.notes}`].filter(Boolean).join(' · ') }),
      !purchase && el('p', { class: 'pa-muted', text: `${row.description}${payment && row.method ? ` · ${row.method}` : ''}` }),
      !payment && el('div', { class: 'pa-row' }, [
        el('span', { class: 'pa-muted pa-grow', text: `Recebido ${brl(row.paid)}` }),
        el('span', { class: row.balance > 0.005 ? 'pa-badge pa-warn' : 'pa-badge pa-ok', text: row.balance > 0.005 ? `em aberto ${brl(row.balance)}` : 'quitado' }),
        row.orderId && el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'client-statement-order-receipt', onclick: () => ctx.actions.openModal({ kind: 'commercial-document', type: 'recibo', clientId: client.value, orderId: row.orderId }) }, 'Gerar recibo'),
        row.orderId && el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'client-statement-open-order', onclick: () => ctx.actions.openModal({ kind: 'encomenda-edit', id: row.orderId }) }, 'Abrir encomenda'),
      ].filter(Boolean)),
    ].filter(Boolean));
  };
  function renderStatement() {
    period.style.display = mode.value === 'periodo' ? '' : 'none';
    const statement = currentStatement();
    const label = mode.value === 'periodo' ? 'no período' : 'no histórico geral';
    preview.replaceChildren(
      el('div', { class: 'pa-statgrid' }, [statCard(`Compras ${label}`, brl(statement.periodPurchases), 'navy'), statCard(`Pagamentos ${label}`, brl(statement.periodPayments), 'ok'), statCard('Saldo do filtro', brl(statement.periodBalance), statement.periodBalance > 0.005 ? 'warn' : 'soft'), statCard('Saldo atual geral', brl(statement.currentBalance), statement.currentBalance > 0.005 ? 'bad' : 'ok')]),
      el('p', { class: 'pa-hint', text: 'O saldo atual geral considera toda a vida financeira do cliente, mesmo quando a visualização está limitada a um período.' }),
      statement.movements.length ? el('div', {}, statement.movements.slice().reverse().map(movementRow)) : el('p', { class: 'pa-empty', text: 'Nenhuma compra ou pagamento com este filtro.' }),
    );
  }
  client.addEventListener('change', renderStatement); mode.addEventListener('change', renderStatement); start.addEventListener('change', renderStatement); end.addEventListener('change', renderStatement);
  print.addEventListener('click', async () => {
    const statement = currentStatement(); const original = print.textContent; print.textContent = 'Gerando PDF…'; print.disabled = true;
    try {
      const safe = norm(statement.client?.name || 'cliente').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cliente';
      const suffix = statement.start || statement.end ? `${statement.start || 'inicio'}-${statement.end || 'hoje'}` : 'geral';
      await savePdf(await generateClientStatementPdf(statement), `ficha-financeira-${safe}-${suffix}.pdf`);
    } catch (error) { window.alert('Não foi possível gerar a ficha financeira: ' + ((error && error.message) || error)); }
    finally { print.textContent = original; print.disabled = false; }
  });
  const receipt = el('button', { class: 'pa-btn pa-grow', 'data-testid': 'client-statement-receipt', onclick: () => ctx.actions.openModal({ kind: 'commercial-document', type: 'recibo', clientId: client.value }) }, 'Novo recibo para o cliente');
  renderStatement();
  return sheet({ title: 'Ficha financeira do cliente', rows: [el('p', { class: 'pa-hint', text: 'Consulte compras, produtos e pagamentos. A impressão detalhada permite recuperar posteriormente o histórico de uma encomenda.' }), field('Cliente', client), field('Visualização', mode), period, preview, el('div', { class: 'pa-sheet-actions' }, [receipt, print])] });
}

MODALS['finance-title-add'] = (ctx, m) => financeTitleAddSheet(ctx, m.direction || 'pagar');
function financeTitleAddSheet(ctx, direction) {
  const { store } = ctx; const isReceive = direction === 'receber';
  const issue = el('input', { class: 'pa-input', type: 'date', value: todayInput(), 'data-testid': 'fin-title-issue' }); const due = el('input', { class: 'pa-input', type: 'date', value: todayInput(), 'data-testid': 'fin-title-due' });
  const parties = isReceive ? store.state.clients.filter((c) => !c.inactive) : store.state.suppliers.filter((s) => !s.archived);
  const party = el('select', { class: 'pa-input', 'data-testid': 'fin-title-party' }, [el('option', { value: '', text: isReceive ? 'Sem cliente / outro' : 'Sem fornecedor / outro' }), ...parties.map((p) => el('option', { value: p.id, text: p.name }))]);
  const description = el('input', { class: 'pa-input', type: 'text', placeholder: isReceive ? 'Ex.: encomenda especial' : 'Ex.: conta de energia', 'data-testid': 'fin-title-desc' }); const amount = moneyField(null, 'fin-title-amount');
  const categories = activeFinanceCategories(store, direction); const preferred = categoryByKey(store, isReceive ? 'outras-receitas' : 'outras-despesas');
  const category = el('select', { class: 'pa-input', 'data-testid': 'fin-title-category' }, categories.map((c) => el('option', { value: c.id, text: `${c.code || ''} ${c.name}`.trim(), ...(preferred?.id === c.id ? { selected: 'selected' } : {}) })));
  const situation = el('select', { class: 'pa-input', 'data-testid': 'fin-title-situation' }, [el('option', { value: 'pendente', text: 'Pendente — pagar/receber depois' }), el('option', { value: 'quitado', text: isReceive ? 'Recebido agora' : 'Pago agora' })]);
  const method = el('select', { class: 'pa-input', 'data-testid': 'fin-title-method' }, ['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Boleto', 'Outro'].map((x) => el('option', { value: x, text: x })));
  const account = el('select', { class: 'pa-input', 'data-testid': 'fin-title-account' }, accountOptions(store).map((a) => el('option', { value: a.id, text: a.name }))); const notes = el('textarea', { class: 'pa-input', rows: '2', placeholder: 'Observações (opcional)' });
  function save() { const value = parseNum(amount.input.value); if (!(value > 0)) { amount.input.focus(); return; } const selectedParty = parties.find((p) => p.id === party.value); const id = uuid(); ctx.actions.mutate((s) => { s.upsertFinanceTitle({ id, direction, issuedAt: dateIso(issue.value), competenceDate: dateIso(issue.value), dueDate: dateIso(due.value), amount: value, description: description.value.trim() || (isReceive ? 'Receita manual' : 'Conta manual'), categoryId: category.value || undefined, partyType: isReceive ? 'cliente' : 'fornecedor', partyId: selectedParty?.id, partyName: selectedParty?.name || (isReceive ? 'Outro cliente' : 'Outro fornecedor'), expectedMethod: method.value, sourceType: 'manual', notes: notes.value.trim() || undefined }); if (situation.value === 'quitado') s.addFinanceSettlement({ id: uuid(), at: dateIso(issue.value), titleId: id, amount: value, method: method.value, accountId: account.value || undefined }); }); }
  return sheet({ title: isReceive ? 'Novo valor a receber' : 'Nova conta a pagar', rows: [field('Emissão', issue), field('Vencimento', due), field(isReceive ? 'Cliente' : 'Fornecedor', party), field('Descrição', description), field('Valor', amount), field('Categoria', category), field('Situação', situation), field('Forma de pagamento', method), field('Conta financeira', account), field('Observações', notes)], onSave: save, saveTestid: 'fin-title-save' });
}

MODALS['finance-title-detail'] = (ctx, m) => financeTitleDetailSheet(ctx, m.id);
function financeTitleDetailSheet(ctx, id) {
  const title = ctx.store.get('financeTitles', id); if (!title) return sheet({ title: 'Título não encontrado', rows: [] }); const state = titleState(ctx.store, title); const settlements = titleSettlements(ctx.store, title); const cat = title.categoryId ? ctx.store.get('categories', title.categoryId) : null;
  const history = settlements.length ? el('ul', { class: 'pa-list pa-tight' }, settlements.slice().sort((a, b) => a.at < b.at ? 1 : -1).map((s) => {
    const correctionKind = s.legacyKind === 'payment' ? 'payment' : ctx.store.get('financeSettlements', s.id) ? 'financeSettlement' : null;
    return el('li', { class: 'pa-list-item' }, [el('div', { class: 'pa-grow' }, [el('strong', { text: fmtDate(s.at) }), el('span', { class: 'pa-muted', text: s.method || 'Forma não informada' })]), el('strong', { class: 'pa-positive', text: brl(s.amount) }), correctionKind && el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'fin-settlement-edit', onclick: () => ctx.actions.openModal({ kind: 'finance-settlement-edit', titleId: title.id, settlementId: s.id, settlementKind: correctionKind }) }, 'Corrigir')].filter(Boolean));
  })) : el('p', { class: 'pa-empty', text: 'Nenhuma baixa registrada.' });
  const editAction = title.sourceType === 'manual' && !title.cancelledAt
    ? el('button', { class: 'pa-btn', 'data-testid': 'fin-title-edit', onclick: () => ctx.actions.openModal({ kind: 'finance-title-edit', id: title.id }) }, 'Editar valor e dados')
    : title.sourceType === 'encomenda' && title.sourceId
      ? el('button', { class: 'pa-btn', 'data-testid': 'fin-title-edit-order', onclick: () => ctx.actions.openModal({ kind: 'encomenda-edit', id: title.sourceId }) }, 'Editar encomenda')
      : null;
  const rows = [el('div', { class: 'pa-row' }, [el('strong', { class: 'pa-grow', text: title.partyName || title.description }), titleBadge(state.status)]), el('p', { class: 'pa-muted', text: title.description }), el('table', { class: 'pa-kv' }, [el('tr', {}, [el('td', { text: 'Emissão' }), el('td', { class: 'pa-num', text: fmtDate(title.issuedAt) })]), el('tr', {}, [el('td', { text: 'Vencimento' }), el('td', { class: 'pa-num', text: fmtDate(title.dueDate) })]), el('tr', {}, [el('td', { text: 'Categoria' }), el('td', { class: 'pa-num', text: cat?.name || 'Sem categoria' })]), el('tr', {}, [el('td', { text: 'Valor' }), el('td', { class: 'pa-num', text: brl(title.amount) })]), el('tr', {}, [el('td', { text: title.direction === 'receber' ? 'Recebido' : 'Pago' }), el('td', { class: 'pa-num', text: brl(state.paid) })]), el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Saldo' }), el('td', { class: 'pa-num', text: brl(state.balance) })])]), editAction, state.balance > 0.005 && !title.cancelledAt && el('button', { class: 'pa-btn pa-primary', 'data-testid': 'fin-settle-open', onclick: () => ctx.actions.openModal({ kind: 'finance-settle', id: title.id }) }, title.direction === 'receber' ? 'Registrar recebimento' : 'Registrar pagamento'), el('h3', { class: 'pa-h3', text: 'Histórico de baixas' }), history, title.sourceType && el('p', { class: 'pa-hint', text: `Origem: ${title.sourceType}. O vínculo evita lançamentos duplicados.` })].filter(Boolean);
  return sheet({ title: title.direction === 'receber' ? 'Detalhe a receber' : 'Detalhe a pagar', rows, danger: !title.cancelledAt && state.balance > 0.005 ? { label: 'Cancelar título', testid: 'fin-title-cancel', onClick: () => ctx.actions.openModal({ kind: 'confirm', title: 'Cancelar título?', message: 'O histórico e as baixas já realizadas serão preservados.', yesLabel: 'Cancelar título', onYes: () => ctx.actions.mutate((s) => s.upsertFinanceTitle({ ...title, cancelledAt: nowIso() })) }) } : null });
}

MODALS['finance-title-edit'] = (ctx, m) => financeTitleEditSheet(ctx, m.id);
function financeTitleEditSheet(ctx, id) {
  const title = ctx.store.get('financeTitles', id); if (!title) return sheet({ title: 'Lançamento não encontrado', rows: [] });
  const isReceive = title.direction === 'receber'; const state = titleState(ctx.store, title);
  const issue = el('input', { class: 'pa-input', type: 'date', value: dateOnly(title.issuedAt), 'data-testid': 'fin-edit-issue' });
  const due = el('input', { class: 'pa-input', type: 'date', value: dateOnly(title.dueDate), 'data-testid': 'fin-edit-due' });
  const parties = isReceive ? ctx.store.state.clients.filter((c) => !c.inactive) : ctx.store.state.suppliers.filter((s) => !s.archived);
  const party = el('select', { class: 'pa-input', 'data-testid': 'fin-edit-party' }, [el('option', { value: '', text: isReceive ? 'Sem cliente / outro' : 'Sem fornecedor / outro', ...(!title.partyId ? { selected: 'selected' } : {}) }), ...parties.map((p) => el('option', { value: p.id, text: p.name, ...(title.partyId === p.id ? { selected: 'selected' } : {}) }))]);
  const description = el('input', { class: 'pa-input', type: 'text', value: title.description || '', 'data-testid': 'fin-edit-desc' });
  const amount = moneyField(title.amount, 'fin-edit-amount'); const categories = activeFinanceCategories(ctx.store, title.direction);
  const category = el('select', { class: 'pa-input', 'data-testid': 'fin-edit-category' }, categories.map((c) => el('option', { value: c.id, text: `${c.code || ''} ${c.name}`.trim(), ...(title.categoryId === c.id ? { selected: 'selected' } : {}) })));
  const method = el('select', { class: 'pa-input', 'data-testid': 'fin-edit-method' }, ['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Boleto', 'Outro'].map((x) => el('option', { value: x, text: x, ...(title.expectedMethod === x ? { selected: 'selected' } : {}) })));
  const notes = el('textarea', { class: 'pa-input', rows: '2', 'data-testid': 'fin-edit-notes' }); notes.value = title.notes || '';
  amount.input.addEventListener('input', () => amount.input.setCustomValidity(''));
  function save() {
    const value = parseNum(amount.input.value); if (!(value > 0) || value + 0.005 < state.paid) { amount.input.setCustomValidity(`O valor não pode ser menor que o já quitado (${brl(state.paid)}).`); amount.input.reportValidity(); return; }
    const selectedParty = parties.find((p) => p.id === party.value);
    ctx.actions.mutate((s) => s.upsertFinanceTitle({ ...title, issuedAt: dateIso(issue.value), competenceDate: dateIso(issue.value), dueDate: dateIso(due.value), amount: value, description: description.value.trim() || title.description, categoryId: category.value || undefined, partyId: selectedParty?.id, partyName: selectedParty?.name || title.partyName || (isReceive ? 'Outro cliente' : 'Outro fornecedor'), expectedMethod: method.value, notes: notes.value.trim() || undefined }));
  }
  return sheet({ title: 'Editar lançamento', rows: [el('p', { class: 'pa-hint', text: 'Altere o valor, as datas ou a classificação. Pagamentos já registrados permanecem no histórico.' }), field('Emissão', issue), field('Vencimento', due), field(isReceive ? 'Cliente' : 'Fornecedor', party), field('Descrição', description), field('Valor total', amount), field('Categoria', category), field('Forma prevista', method), field('Observações', notes)], onSave: save, saveTestid: 'fin-edit-save' });
}

MODALS['finance-settlement-edit'] = (ctx, m) => financeSettlementEditSheet(ctx, m);
function financeSettlementEditSheet(ctx, m) {
  const title = ctx.store.get('financeTitles', m.titleId); const isPayment = m.settlementKind === 'payment';
  const original = isPayment ? ctx.store.get('payments', m.settlementId) : ctx.store.get('financeSettlements', m.settlementId);
  if (!title || !original) return sheet({ title: 'Pagamento não encontrado', rows: [] });
  const state = titleState(ctx.store, title); const oldAmount = Number(isPayment ? original.valor : original.amount) || 0;
  const date = el('input', { class: 'pa-input', type: 'date', value: dateOnly(original.at), 'data-testid': 'fin-correct-date' });
  const amount = moneyField(oldAmount, 'fin-correct-amount');
  const currentMethod = isPayment ? original.forma : original.method;
  const method = el('select', { class: 'pa-input', 'data-testid': 'fin-correct-method' }, ['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Boleto', 'Outro'].map((x) => el('option', { value: x, text: x, ...(currentMethod === x ? { selected: 'selected' } : {}) })));
  const account = el('select', { class: 'pa-input', 'data-testid': 'fin-correct-account' }, accountOptions(ctx.store).map((a) => el('option', { value: a.id, text: a.name, ...(!isPayment && original.accountId === a.id ? { selected: 'selected' } : {}) })));
  amount.input.addEventListener('input', () => amount.input.setCustomValidity(''));
  function save() {
    const value = parseNum(amount.input.value); const otherPaid = Math.max(0, state.paid - oldAmount); const maximum = Math.max(0, title.amount - otherPaid);
    if (!(value > 0) || value > maximum + 0.005) { amount.input.setCustomValidity(`O valor máximo para este lançamento é ${brl(maximum)}.`); amount.input.reportValidity(); return; }
    ctx.actions.mutate((s) => {
      s.addReversal({ id: uuid(), at: nowIso(), kind: isPayment ? 'payment' : 'financeSettlement', refId: original.id });
      if (isPayment) s.addPayment({ id: uuid(), at: dateIso(date.value), encomendaId: original.encomendaId, valor: value, forma: method.value });
      else s.addFinanceSettlement({ id: uuid(), at: dateIso(date.value), titleId: title.id, amount: value, method: method.value, accountId: account.value || undefined, notes: `Correção do lançamento de ${fmtDate(original.at)}` });
      if (title.sourceType === 'manual' && state.balance <= 0.005) s.upsertFinanceTitle({ ...title, amount: otherPaid + value });
    });
  }
  return sheet({ title: title.direction === 'receber' ? 'Corrigir recebimento' : 'Corrigir pagamento', rows: [el('div', { class: 'pa-callout' }, [el('span', { text: 'Valor anterior: ' }), el('strong', { text: brl(oldAmount) })]), el('p', { class: 'pa-hint', text: 'A correção não apaga o registro anterior: ele será estornado e o novo valor ficará no histórico.' }), field('Data', date), field('Valor correto', amount), field('Forma', method), !isPayment && field('Conta financeira', account)].filter(Boolean), onSave: save, saveTestid: 'fin-correct-save' });
}

MODALS['finance-settle'] = (ctx, m) => financeSettleSheet(ctx, m.id);
function financeSettleSheet(ctx, id) {
  const title = ctx.store.get('financeTitles', id); const state = title && titleState(ctx.store, title); if (!title || !state) return sheet({ title: 'Título não encontrado', rows: [] });
  const date = el('input', { class: 'pa-input', type: 'date', value: todayInput(), 'data-testid': 'fin-settle-date' }); const amount = moneyField(state.balance, 'fin-settle-amount'); const method = el('select', { class: 'pa-input', 'data-testid': 'fin-settle-method' }, ['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Boleto', 'Outro'].map((x) => el('option', { value: x, text: x, ...(title.expectedMethod === x ? { selected: 'selected' } : {}) }))); const account = el('select', { class: 'pa-input', 'data-testid': 'fin-settle-account' }, accountOptions(ctx.store).map((a) => el('option', { value: a.id, text: a.name }))); const notes = el('input', { class: 'pa-input', type: 'text', placeholder: 'Observação (opcional)' });
  function save() { const value = parseNum(amount.input.value); if (!(value > 0) || value > state.balance + 0.005) { amount.input.focus(); return; } ctx.actions.mutate((s) => { if (title.sourceType === 'encomenda') s.addPayment({ id: uuid(), at: dateIso(date.value), encomendaId: title.sourceId, valor: value, forma: method.value }); else s.addFinanceSettlement({ id: uuid(), at: dateIso(date.value), titleId: title.id, amount: value, method: method.value, accountId: account.value || undefined, notes: notes.value.trim() || undefined }); }); }
  return sheet({ title: title.direction === 'receber' ? 'Registrar recebimento' : 'Registrar pagamento', rows: [el('div', { class: 'pa-callout' }, [el('span', { text: 'Saldo atual ' }), el('strong', { text: brl(state.balance) })]), field('Data', date), field('Valor', amount), field('Forma', method), field('Conta financeira', account), field('Observação', notes)], onSave: save, saveTestid: 'fin-settle-save' });
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
  if (view.finCategoryId) actual = actual.filter((m) => m.categoryId === view.finCategoryId);
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
    const meta = [isIn ? 'A receber' : 'A pagar', cat?.name, r.paid > 0.005 ? `Parcial · já quitado ${brl(r.paid)}` : null].filter(Boolean).join(' · ');
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
    view.finProjected && el('div', { class: 'pa-callout' }, [el('strong', { text: `Previsão do período: +${brl(flow.projectedIn)} · −${brl(flow.projectedOut)}` }), el('span', { text: ' Contas pendentes não alteram o realizado. Vencidos anteriores também aparecem no alerta abaixo.' })]),
    el('h3', { class: 'pa-h3', text: 'Tudo que entrou e saiu' }),
    actualRows.length ? el('div', { class: 'pa-cash-list' }, [detailHeader(), ...actualRows]) : el('p', { class: 'pa-empty', text: 'Nenhuma entrada ou saída realizada neste período.' }),
    view.finProjected && el('h3', { class: 'pa-h3', text: 'Valores a quitar' }),
    view.finProjected && (pendingRows.length ? el('div', { class: 'pa-cash-list' }, [detailHeader(), ...pendingRows]) : el('p', { class: 'pa-empty', text: 'Nenhum valor pendente neste período.' })),
    el('h3', { class: 'pa-h3', text: 'Resumo por dia' }), dayTable,
  ].filter(Boolean));
}

MODALS['dre-preview'] = (ctx, modal) => drePreviewSheet(ctx, modal);

function drePreviewSheet(ctx, modal = {}) {
  const start = modal.start || ctx.view.finStart; const end = modal.end || ctx.view.finEnd;
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
  return sheet({ title: 'DRE gerencial do período', rows: [
    el('p', { class: 'pa-callout', text: `Competência de ${fmtDate(`${start}T12:00:00`)} até ${fmtDate(`${end}T12:00:00`)}. Valores quitados e pendentes entram integralmente; investimentos e transferências ficam fora.` }),
    el('table', { class: 'pa-kv pa-report', 'data-testid': 'dre-table' }, [
      line('Receita de vendas', dre.salesRevenue), line('Outras receitas operacionais', dre.otherRevenue), line('Receita operacional', dre.grossRevenue, { total: true }),
      ...dre.costRows.map((row) => line(row.name, row.amount, { detail: true, negative: true })), line('Custos diretos', dre.directCosts, { total: true, negative: true }),
      line('Lucro bruto', dre.grossProfit, { total: true, bad: dre.grossProfit < 0, good: dre.grossProfit >= 0 }),
      ...dre.expenseRows.map((row) => line(row.name, row.amount, { detail: true, negative: true })), line('Despesas operacionais', dre.operatingExpenses, { total: true, negative: true }),
      line('Resultado do período', dre.netResult, { total: true, bad: dre.netResult < 0, good: dre.netResult >= 0 }),
    ]),
    el('div', { class: 'pa-statgrid' }, [statCard('Margem bruta', dre.grossMarginPct == null ? 'Sem receita' : `${Math.round(dre.grossMarginPct * 100)}%`, dre.grossProfit >= 0 ? 'navy' : 'bad'), statCard('Margem líquida', dre.netMarginPct == null ? 'Sem receita' : `${Math.round(dre.netMarginPct * 100)}%`, dre.netResult >= 0 ? 'ok' : 'bad'), statCard('Ainda a receber', brl(dre.openReceivables), dre.openReceivables ? 'warn' : 'soft'), statCard('Ainda a pagar', brl(dre.openPayables), dre.openPayables ? 'warn' : 'soft')]),
    el('h3', { class: 'pa-h3', text: 'Diagnóstico automático' }), ...diagnosis,
    el('p', { class: 'pa-hint', text: 'Esta é uma DRE gerencial simplificada para decisão. Para obrigações fiscais e contábeis formais, valide a classificação com seu contador.' }),
    el('div', { class: 'pa-sheet-actions' }, [pdf]),
  ] });
}

function financePurchasesPanel(ctx) {
  const rows = ctx.store.state.purchases.slice().sort((a, b) => a.at < b.at ? 1 : -1);
  return el('section', { class: 'pa-card' }, [el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Fornecedores e insumos' }), el('h2', { text: 'Compras' })]), el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'purchase-new', onclick: () => ctx.actions.openModal({ kind: 'purchase-add' }) }, '+ Compra')]), el('p', { class: 'pa-hint', text: 'A compra atualiza o último fornecedor e o preço do insumo, além de gerar a conta a pagar sem duplicidade.' }), rows.length ? el('ul', { class: 'pa-list pa-rows' }, rows.map((p) => { const supplier = p.supplierId ? ctx.store.get('suppliers', p.supplierId) : null; const title = p.titleId ? ctx.store.get('financeTitles', p.titleId) : null; const st = title ? titleState(ctx.store, title) : null; return el('li', { class: 'pa-row-item', onclick: () => title && ctx.actions.openModal({ kind: 'finance-title-detail', id: title.id }) }, [el('div', { class: 'pa-grow' }, [el('div', { class: 'pa-enc-title' }, [el('strong', { text: supplier?.name || 'Sem fornecedor' }), st && titleBadge(st.status)]), el('span', { class: 'pa-muted', text: `${fmtDate(p.at)} · ${(p.items || []).map((it) => ctx.store.get('ingredients', it.ingredientId)?.name).filter(Boolean).join(', ')}` })]), el('strong', { class: 'pa-num', text: brl(p.total) }), el('span', { class: 'pa-chev', text: '›' })]); })) : el('p', { class: 'pa-empty', text: 'Nenhuma compra registrada.' })]);
}

MODALS['purchase-add'] = (ctx) => purchaseAddSheet(ctx);
function purchaseAddSheet(ctx) {
  const { store } = ctx; const suppliers = store.state.suppliers.filter((s) => !s.archived); const ingredients = store.state.ingredients;
  if (!suppliers.length) return sheet({ title: 'Nova compra', rows: [el('p', { class: 'pa-callout', text: 'Cadastre pelo menos um fornecedor antes da primeira compra.' }), el('button', { class: 'pa-btn pa-primary', onclick: () => ctx.actions.openModal({ kind: 'finance-suppliers' }) }, 'Cadastrar fornecedor')] });
  if (!ingredients.length) return sheet({ title: 'Nova compra', rows: [el('p', { class: 'pa-callout', text: 'Cadastre os insumos antes de registrar uma compra.' })] });
  const supplier = el('select', { class: 'pa-input', 'data-testid': 'purchase-supplier' }, suppliers.map((s) => el('option', { value: s.id, text: s.name }))); const date = el('input', { class: 'pa-input', type: 'date', value: todayInput(), 'data-testid': 'purchase-date' }); const due = el('input', { class: 'pa-input', type: 'date', value: todayInput(), 'data-testid': 'purchase-due' }); const situation = el('select', { class: 'pa-input', 'data-testid': 'purchase-situation' }, [el('option', { value: 'pendente', text: 'Pagar depois' }), el('option', { value: 'quitado', text: 'Pago agora' })]); const account = el('select', { class: 'pa-input', 'data-testid': 'purchase-account' }, accountOptions(store).map((a) => el('option', { value: a.id, text: a.name })));
  const itemsBox = el('div', { class: 'pa-detail-list' }); const lines = [];
  function addLine() { const index = lines.length; const ing = el('select', { class: 'pa-input', 'data-testid': `purchase-item-${index}` }, ingredients.map((i) => el('option', { value: i.id, text: `${i.name} (${i.stockUnit})` }))); const qty = el('input', { class: 'pa-input pa-narrow', type: 'number', min: '0.001', step: 'any', value: '1', 'data-testid': `purchase-qty-${index}` }); const price = moneyField(null, `purchase-price-${index}`); const line = { ing, qty, price, row: null }; line.row = el('div', { class: 'pa-detail-card' }, [field('Insumo/embalagem', ing), el('div', { class: 'pa-filtergrid' }, [field('Quantidade', qty), field('Preço por unidade de compra', price)]), el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => { line.row.remove(); lines.splice(lines.indexOf(line), 1); } }, 'Remover item')]); lines.push(line); itemsBox.append(line.row); }
  addLine();
  function save() { const items = lines.map((l) => ({ ingredientId: l.ing.value, qty: Number(l.qty.value) || 0, unitPrice: parseNum(l.price.input.value) || 0 })).filter((x) => x.qty > 0 && x.unitPrice > 0); if (!items.length) return; const total = items.reduce((s, x) => s + x.qty * x.unitPrice, 0); const purchaseId = uuid(); const titleId = uuid(); const sup = store.get('suppliers', supplier.value); const isPackaging = items.every((x) => { const i = store.get('ingredients', x.ingredientId); return norm(`${i?.name} ${(i?.tags || []).join(' ')}`).includes('embalag'); }); const cat = categoryByKey(store, isPackaging ? 'embalagens' : 'insumos'); ctx.actions.mutate((s) => { s.upsertPurchase({ id: purchaseId, at: dateIso(date.value), supplierId: supplier.value, items, total, titleId }); s.upsertFinanceTitle({ id: titleId, direction: 'pagar', issuedAt: dateIso(date.value), competenceDate: dateIso(date.value), dueDate: dateIso(due.value), amount: total, description: `Compra · ${sup?.name || 'Fornecedor'}`, categoryId: cat?.id, partyType: 'fornecedor', partyId: supplier.value, partyName: sup?.name || 'Fornecedor', sourceType: 'compra', sourceId: purchaseId }); for (const item of items) { const ing = s.get('ingredients', item.ingredientId); s.addPriceChange({ id: uuid(), at: dateIso(date.value), ingredientId: item.ingredientId, price: item.unitPrice }); if (ing) s.upsertIngredient({ ...ing, lastSupplier: sup?.name || ing.lastSupplier }); } if (situation.value === 'quitado') s.addFinanceSettlement({ id: uuid(), at: dateIso(date.value), titleId, amount: total, method: 'Pix', accountId: account.value || undefined }); }); }
  return sheet({ title: 'Registrar compra', rows: [field('Fornecedor', supplier), el('div', { class: 'pa-filtergrid' }, [field('Data da compra', date), field('Vencimento', due)]), itemsBox, el('button', { class: 'pa-btn', onclick: addLine }, '+ Adicionar item'), field('Situação', situation), field('Conta financeira', account), el('p', { class: 'pa-hint', text: 'Informe o preço por kg, litro ou unidade — a mesma unidade cadastrada no insumo.' })], onSave: save, saveTestid: 'purchase-save' });
}

function financeChartPanel(ctx) {
  const cats = ctx.store.state.categories.filter((c) => c.systemKey).slice().sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true }));
  return el('section', { class: 'pa-card' }, [el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Organização simples' }), el('h2', { text: 'Plano de Contas' })]), el('button', { class: 'pa-btn pa-sm', 'data-testid': 'cat-manage', onclick: () => ctx.actions.openModal({ kind: 'categorias' }) }, 'Personalizar')]), el('p', { class: 'pa-hint', text: 'A categoria diz o que o valor representa. A classificação de caixa separa operação, investimento e financiamento.' }), el('div', { class: 'pa-actiongrid' }, [el('button', { class: 'pa-btn', onclick: () => ctx.actions.openModal({ kind: 'finance-accounts' }) }, 'Caixas e contas'), el('button', { class: 'pa-btn', onclick: () => ctx.actions.openModal({ kind: 'finance-suppliers' }) }, 'Fornecedores')]), el('ul', { class: 'pa-list pa-tight' }, cats.map((c) => el('li', { class: 'pa-list-item' + (c.archived ? ' pa-reversed' : '') }, [el('span', { class: 'pa-num pa-muted', text: c.code || '' }), el('div', { class: 'pa-grow' }, [el('strong', { text: c.name }), el('span', { class: 'pa-muted', text: [c.nature, c.behavior, c.cashFlowGroup].filter(Boolean).join(' · ') })])])))]);
}

MODALS['finance-suppliers'] = (ctx) => financeSuppliersSheet(ctx);
function financeSuppliersSheet(ctx) {
  const name = el('input', { class: 'pa-input pa-grow', type: 'text', placeholder: 'Nome do fornecedor', 'data-testid': 'supplier-name' }); const rows = ctx.store.state.suppliers.map((s) => el('li', { class: 'pa-list-item' + (s.archived ? ' pa-reversed' : '') }, [el('span', { class: 'pa-grow', text: s.name }), el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => ctx.actions.mutateModal((st) => st.upsertSupplier({ ...s, archived: !s.archived })) }, s.archived ? 'Reativar' : 'Arquivar')]));
  return sheet({ title: 'Fornecedores', rows: [el('div', { class: 'pa-row' }, [name, el('button', { class: 'pa-btn pa-primary', 'data-testid': 'supplier-add', onclick: () => { if (name.value.trim()) ctx.actions.mutateModal((s) => s.upsertSupplier({ id: uuid(), name: name.value.trim() })); } }, '+ Adicionar')]), rows.length ? el('ul', { class: 'pa-list pa-tight' }, rows) : el('p', { class: 'pa-empty', text: 'Nenhum fornecedor cadastrado.' })] });
}

MODALS['finance-accounts'] = (ctx) => financeAccountsSheet(ctx);
function financeAccountsSheet(ctx) {
  const rows = ctx.store.state.cashAccounts.map((a) => { const balance = moneyField(a.openingBalance || 0); const date = el('input', { class: 'pa-input', type: 'date', value: dateOnly(a.openingDate) || todayInput() }); return el('section', { class: 'pa-detail-card' }, [el('strong', { text: a.name }), el('div', { class: 'pa-filtergrid' }, [field('Saldo inicial', balance), field('Data inicial', date)]), el('button', { class: 'pa-btn pa-sm', onclick: () => ctx.actions.mutateModal((s) => s.upsertCashAccount({ ...a, openingBalance: parseNum(balance.input.value) || 0, openingDate: dateIso(date.value) })) }, 'Salvar saldo')]); }); const name = el('input', { class: 'pa-input', type: 'text', placeholder: 'Ex.: Conta corrente' });
  return sheet({ title: 'Caixas e contas', rows: [el('p', { class: 'pa-hint', text: 'O saldo inicial é o dinheiro existente quando o controle começou.' }), ...rows, el('div', { class: 'pa-row' }, [name, el('button', { class: 'pa-btn', onclick: () => { if (name.value.trim()) ctx.actions.mutateModal((s) => s.upsertCashAccount({ id: uuid(), name: name.value.trim(), openingBalance: 0 })); } }, '+ Conta')])] });
}

function financeReportsPanel(ctx) {
  const start = ctx.view.finStart; const end = ctx.view.finEnd;
  const movements = cashMovements(ctx.store).filter((m) => inDateRange(m.at, start, end));
  const inTotal = movements.filter((m) => m.direction === 'entrada' && !m.transfer).reduce((s, m) => s + m.amount, 0);
  const outTotal = movements.filter((m) => m.direction === 'saida' && !m.transfer).reduce((s, m) => s + m.amount, 0);
  const byCategory = new Map();
  for (const m of movements.filter((x) => x.direction === 'saida' && !x.transfer)) byCategory.set(m.categoryId || '__sem__', (byCategory.get(m.categoryId || '__sem__') || 0) + m.amount);
  const overdue = listTitles(ctx.store, { direction: 'receber', status: 'vencido' });
  const categoryRows = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([id, total]) => el('tr', {}, [
    el('td', { text: id === '__sem__' ? 'Sem categoria' : ctx.store.get('categories', id)?.name || 'Categoria antiga' }),
    el('td', { class: 'pa-num', text: brl(total) }),
  ]));
  const overdueRows = overdue.map((r) => el('tr', {}, [
    el('td', { text: `${r.title.partyName || 'Sem cliente'} · ${r.overdueDays} dia(s)` }),
    el('td', { class: 'pa-num pa-bad', text: brl(r.balance) }),
  ]));
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Decisões com clareza' }), el('h2', { text: 'Relatórios financeiros' })]), el('button', { class: 'pa-btn pa-sm', onclick: () => { const lines = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Valor'], ...movements.map((m) => [dateOnly(m.at), m.direction === 'entrada' ? 'Entrada' : 'Saída', m.label, ctx.store.get('categories', m.categoryId)?.name || '', m.amount.toFixed(2).replace('.', ',')])]; downloadFile(`financeiro-${start}-${end}.csv`, lines.map((r) => r.map(csvCell).join(';')).join('\n'), 'text/csv'); } }, 'Exportar CSV')]),
    periodFields(start, end, ({ start: s, end: e }) => ctx.actions.setFinanceView({ finStart: s, finEnd: e }), 'fin-report'),
    el('div', { class: 'pa-statgrid' }, [statCard('Recebimentos', brl(inTotal), 'ok'), statCard('Pagamentos', brl(outTotal), outTotal ? 'warn' : 'soft'), statCard('Saldo de caixa', brl(inTotal - outTotal), inTotal - outTotal >= 0 ? 'navy' : 'bad')]),
    el('h3', { class: 'pa-h3', text: 'Saídas por categoria' }), categoryRows.length ? el('table', { class: 'pa-kv pa-report' }, categoryRows) : el('p', { class: 'pa-empty', text: 'Sem saídas no período.' }),
    el('h3', { class: 'pa-h3', text: 'Clientes inadimplentes' }), overdueRows.length ? el('table', { class: 'pa-kv pa-report' }, overdueRows) : el('p', { class: 'pa-empty', text: 'Nenhum cliente inadimplente.' }),
    el('p', { class: 'pa-hint', text: 'Saldo de caixa não é o mesmo que lucro. Perdas sem movimentação de dinheiro ficam fora deste relatório e continuam no relatório gerencial de produção.' }),
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
    const kind = store.get('categories', title.categoryId)?.nature;
    movements.push({ id: st.id, at: st.at, type: title.direction === 'receber' ? 'receita' : kind === 'custo' ? 'custo' : 'despesa', label: title.partyName || title.description, description: [title.description, st.method].filter(Boolean).join(' · '), amount: st.amount || 0, reversalKind: 'financeSettlement', reversed: store.isReversed('financeSettlement', st.id) });
  }
  for (const title of store.state.financeTitles) {
    const state = titleState(store, title); if (title.cancelledAt || state.balance <= 0.005) continue;
    const nature = store.get('categories', title.categoryId)?.nature;
    movements.push({ id: `pending-${title.id}`, at: title.dueDate, type: title.direction === 'receber' ? 'receita' : nature === 'custo' ? 'custo' : 'despesa', label: title.partyName || title.description, description: `${state.status === 'vencido' ? 'Vencido' : 'Pendente'} · ${title.description}`, amount: state.balance, pending: true });
  }
  for (const loss of store.state.perdas) movements.push({ id: loss.id, at: loss.at, type: 'custo', label: 'Perda de produção', description: loss.note || 'Sem saída de caixa', amount: loss.amount || 0, reversalKind: 'perda', reversed: store.isReversed('perda', loss.id), noncash: true });
  for (const a of store.state.cashAdjustments) movements.push({ id: a.id, at: a.at, type: a.direction === 'saida' ? 'despesa' : 'receita', label: a.kind === 'transfer' ? 'Transferência entre contas' : 'Ajuste financeiro', description: a.description || '', amount: a.amount || 0, reversalKind: 'cashAdjustment', reversed: store.isReversed('cashAdjustment', a.id), transfer: a.kind === 'transfer' });
  let items = movements.filter((m) => monthOf(m.at) === month);
  if (type !== 'todos') items = items.filter((m) => m.type === type);
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
      ]),
    ]),
    el('div', { class: 'pa-actiongrid' }, [
      el('button', { class: 'pa-btn pa-primary', 'data-testid': 'income-new', onclick: () => ctx.actions.openModal({ kind: 'income-add' }) }, '+ Receita recebida'),
      el('button', { class: 'pa-btn', 'data-testid': 'desp-new', onclick: () => ctx.actions.openModal({ kind: 'despesa-add' }) }, '+ Saída paga'),
      el('button', { class: 'pa-btn', 'data-testid': 'fin-title-receive-new', onclick: () => ctx.actions.openModal({ kind: 'finance-title-add', direction: 'receber' }) }, '+ Valor a receber'),
      el('button', { class: 'pa-btn', 'data-testid': 'fin-title-new', onclick: () => ctx.actions.openModal({ kind: 'finance-title-add', direction: 'pagar' }) }, '+ Conta a pagar'),
      el('button', { class: 'pa-btn', 'data-testid': 'fin-adjust-new', onclick: () => ctx.actions.openModal({ kind: 'finance-adjustment' }) }, '+ Ajuste ou transferência'),
    ]),
    el('p', { class: 'pa-hint', text: 'Use Receita recebida ou Saída paga para fatos já quitados. Em Valor a receber e Conta a pagar você escolhe pendente ou quitado e informa vencimento, forma e conta financeira.' }),
    el('div', { class: 'pa-row pa-period-title' }, [el('span', { class: 'pa-lab', text: 'Mês de referência' }), monthInput]),
    el('div', { class: 'pa-statgrid' }, [statCard('Entradas', brl(entrada), 'ok'), statCard('Saídas', brl(saida), saida > 0 ? 'warn' : 'soft'), statCard('Saldo', brl(entrada - saida), entrada - saida >= 0 ? 'navy' : 'bad')]),
    el('div', { class: 'pa-chiprow' }, [chip('todos', 'Todos'), chip('receita', 'Receitas'), chip('despesa', 'Despesas'), chip('custo', 'Custos')]),
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

// Manage categorias + subcategorias. CRUD happens in place (mutateModal) so the list updates without
// closing the sheet. Archive (soft) keeps history labeled; hard-delete only when never used.
function categoriasSheet(ctx) {
  const { store } = ctx;
  const nameI = el('input', { class: 'pa-input pa-grow', 'data-testid': 'cat-name', type: 'text', placeholder: 'Nova categoria' });
  const kindSel = el('select', { class: 'pa-input', 'data-testid': 'cat-kind' }, CATEGORY_KINDS.map(([v, t]) => el('option', { value: v, text: t })));
  const parentSel = el('select', { class: 'pa-input', 'data-testid': 'cat-parent' });
  function fillParents() {
    const tops = store.state.categories.filter((c) => c.kind === kindSel.value && !c.parentId && !c.archived);
    parentSel.replaceChildren(el('option', { value: '', text: '— categoria principal —' }), ...tops.map((t) => el('option', { value: t.id, text: `sub de: ${t.name}` })));
  }
  fillParents();
  kindSel.addEventListener('change', fillParents);
  function add() {
    const nm = nameI.value.trim();
    if (!nm) { nameI.focus(); return; }
    const nature = kindSel.value === 'receita' ? 'receita' : kindSel.value === 'custo' || kindSel.value === 'perda' ? 'custo' : 'despesa';
    ctx.actions.mutateModal((s) => s.upsertCategory({ id: uuid(), name: nm, kind: kindSel.value, nature, cashFlowGroup: kindSel.value === 'perda' ? 'nao-caixa' : 'operacional', ...(parentSel.value ? { parentId: parentSel.value } : {}) }));
  }

  const used = (id) => store.state.despesas.some((d) => d.categoryId === id && !store.isReversed('despesa', d.id)) || store.state.financeTitles.some((t) => t.categoryId === id);
  const catRow = (c, sub) => el('li', { class: 'pa-list-item' + (c.archived ? ' pa-reversed' : ''), 'data-testid': 'cat-row' }, [
    el('span', { class: 'pa-grow', text: (sub ? '— ' : '') + c.name }),
    el('button', { class: 'pa-btn pa-ghost pa-sm', title: c.archived ? 'Reativar' : 'Arquivar', onclick: () => ctx.actions.mutateModal((s) => s.upsertCategory({ ...c, archived: !c.archived })) }, c.archived ? '↺' : '🗄'),
    !used(c.id) && el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Excluir', onclick: () => ctx.actions.mutateModal((s) => s.removeCategory(c.id)) }, '✕'),
  ].filter(Boolean));
  const groups = CATEGORY_KINDS.map(([kind, , label]) => {
    const cats = store.state.categories.filter((c) => c.kind === kind);
    if (!cats.length) return null;
    const tops = cats.filter((c) => !c.parentId);
    const lis = [];
    for (const t of tops) { lis.push(catRow(t, false)); for (const s of cats.filter((c) => c.parentId === t.id)) lis.push(catRow(s, true)); }
    for (const orphan of cats.filter((c) => c.parentId && !tops.some((t) => t.id === c.parentId))) lis.push(catRow(orphan, false));
    return el('div', {}, [el('h3', { class: 'pa-h3', text: label }), el('ul', { class: 'pa-list pa-tight' }, lis)]);
  }).filter(Boolean);

  return sheet({
    title: 'Categorias',
    rows: [
      el('div', { class: 'pa-row pa-form' }, [nameI]),
      el('div', { class: 'pa-row pa-form' }, [kindSel, parentSel]),
      el('div', { class: 'pa-row' }, [el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'cat-add', onclick: add }, '+ Adicionar')]),
      el('p', { class: 'pa-hint', text: 'Arquive (🗄) o que não usa mais — o histórico continua certo. Excluir (✕) só aparece nas que nunca foram usadas.' }),
      ...groups,
      el('div', { class: 'pa-row pa-cardfoot' }, [el('button', { class: 'pa-btn pa-ghost pa-sm', 'data-testid': 'cat-done', onclick: () => ctx.actions.closeModal() }, 'Concluir')]),
    ],
  });
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
    const opts = k === 'insumo' ? store.state.ingredients : k === 'produto' ? store.state.products : [];
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
  const empty = sum.recebido === 0 && sum.despesas === 0 && sum.faturado === 0;

  // The cash-basis result.
  const resultado = el('table', { class: 'pa-kv' }, [
    el('tr', { class: 'pa-kv-sec' }, [el('td', { colspan: '2', text: 'Entrou' })]),
    kv('Recebido', brl(sum.recebido)),
    sum.recebidoOutrasReceitas > 0 && kv('Outras receitas', brl(sum.recebidoOutrasReceitas)),
    sum.faturado !== sum.recebidoVendas && kv('Faturado (entregue)', brl(sum.faturado)),
    sum.aReceber > 0 && kv('A receber', brl(sum.aReceber)),
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
    ['Faturado (entregue)', n2(sum.faturado)],
    ['A receber', n2(sum.aReceber)],
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
// compare cost, margin and profit at a fixed price.

/** Per-unit cost breakdown of recipe `recipeId` as if its batch were scaled by `factor`, with new active/oven minutes. */
function simulateRecipeBreakdown(store, recipeId, factor, active, oven, config) {
  const real = store.get('recipes', recipeId);
  const sim = {
    ...real,
    yieldNominal: real.yieldNominal * factor,
    activeMinutes: active, ovenMinutes: oven,
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
const breakdownTotal = (b) => b.ingredients + b.labor + b.gas + b.fixed;

function simuladorPanel(ctx) {
  const { store } = ctx;
  const config = store.getConfig();
  const recipes = store.state.recipes;
  if (recipes.length === 0) {
    return el('section', { class: 'pa-card' }, [el('h2', { text: 'Simulador' }), el('p', { class: 'pa-empty', text: 'Crie uma receita primeiro.' })]);
  }
  const sel = el('select', { class: 'pa-input', 'data-testid': 'sim-recipe' }, recipes.map((r) => el('option', { value: r.id, text: r.name })));
  const body = el('div', {});
  const rebuild = () => body.replaceChildren(simuladorBody(ctx, store.get('recipes', sel.value), config));
  sel.addEventListener('change', rebuild);
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
  const baseCost = breakdownTotal(baseBreak);

  const fee = config.paymentFeePct;
  // Lucro/hora: profit per unit ÷ hours of hands-on work per unit (labor cost / valorHora, like Preços).
  const lucroHora = (b, lucroUnit) => {
    const hpu = config.valorHora > 0 ? b.labor / config.valorHora : 0;
    return hpu > 0 ? lucroUnit / hpu : null;
  };
  const fmtHora = (v) => (v == null ? '—' : brl(v));
  const factor = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'sim-factor', type: 'text', inputmode: 'decimal', value: '1,5' });
  const active = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'sim-active', type: 'text', inputmode: 'numeric', value: String(recipe.activeMinutes) });
  const oven = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'sim-oven', type: 'text', inputmode: 'numeric', value: String(recipe.ovenMinutes) });
  const price = moneyField(priceFromCost(baseCost, config), 'sim-price');
  const results = el('div', { 'data-testid': 'sim-results' });

  function recompute() {
    let f = parseNum(factor.value); if (!(f > 0)) f = 1;
    const a = parseNum(active.value) || 0;
    const o = parseNum(oven.value) || 0;
    const p = parseNum(price.input.value) || 0;
    let simBreak;
    try { simBreak = simulateRecipeBreakdown(store, recipe.id, f, a, o, config); }
    catch (e) { results.replaceChildren(el('p', { class: 'pa-status', text: friendlyError(e) })); return; }
    const simCost = breakdownTotal(simBreak);
    const margin = (cost) => (p > 0 ? 1 - fee - cost / p : 0);
    const lucro = (cost) => p - cost - p * fee;
    const col = (atual, simu, fmt) => [el('td', { class: 'pa-num', text: fmt(atual) }), el('td', { class: 'pa-num pa-strong', text: fmt(simu) })];
    const better = margin(simCost) >= margin(baseCost);
    results.replaceChildren(el('table', { class: 'pa-kv pa-sim' }, [
      el('tr', { class: 'pa-sim-head' }, [el('td', {}), el('td', { class: 'pa-num', text: 'Atual' }), el('td', { class: 'pa-num', text: `${fmtNum(f)}×` })]),
      el('tr', {}, [el('td', { text: 'Rendimento' }), ...col(recipe.yieldNominal, recipe.yieldNominal * f, (v) => `${fmtNum(v)} ${recipe.yieldUnit}`)]),
      el('tr', {}, [el('td', { text: 'Custo por unidade' }), ...col(baseCost, simCost, brl)]),
      el('tr', {}, [el('td', { text: `Margem a ${brl(p)}` }), el('td', { class: 'pa-num', text: pctStr(margin(baseCost)) }), el('td', { class: 'pa-num pa-strong' + (better ? '' : ' pa-bad'), text: pctStr(margin(simCost)) })]),
      el('tr', {}, [el('td', { text: 'Lucro por unidade' }), ...col(lucro(baseCost), lucro(simCost), brl)]),
      el('tr', {}, [el('td', { text: 'Lucro por hora de trabalho' }), ...col(lucroHora(baseBreak, lucro(baseCost)), lucroHora(simBreak, lucro(simCost)), fmtHora)]),
    ]));
  }
  [factor, active, oven, price.input].forEach((i) => i.addEventListener('input', recompute));
  recompute();

  return el('div', {}, [
    el('p', { class: 'pa-muted', text: `Atual: rende ${fmtNum(recipe.yieldNominal)} ${recipe.yieldUnit} · ${recipe.activeMinutes}min ativos · ${recipe.ovenMinutes}min forno` }),
    el('h3', { class: 'pa-h3', text: 'E se eu fizer um lote maior?' }),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Escala' }), factor, el('span', { class: 'pa-lab', text: '× a receita' })]),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'min ativos' }), active, el('span', { class: 'pa-lab', text: 'min forno' }), oven]),
    el('p', { class: 'pa-hint', text: 'Ingredientes e rendimento crescem com a escala. Ajuste os minutos para o lote maior — a mão de obra costuma subir pouco.' }),
    field('Preço de venda (para comparar a margem)', price),
    results,
  ]);
}

// ── Ajustes (config + Dropbox) ───────────────────────────────────────────────────

function automaticConfigSuggestions(store) {
  const today = new Date();
  const months = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const start = `${months[0]}-01`;
  const end = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const actual = cashMovements(store).filter((m) => !m.transfer && dateOnly(m.at) >= start && dateOnly(m.at) <= end);
  const category = (m) => m.categoryId ? store.get('categories', m.categoryId) : null;
  const fixedExcluded = new Set(['pro-labore', 'salarios', 'tarifas']);
  const fixed = actual.filter((m) => {
    const c = category(m);
    return m.direction === 'saida' && c && (c.kind === 'despesaFixa' || c.behavior === 'fixa') && !fixedExcluded.has(c.systemKey);
  });
  const fixedMonths = new Set(fixed.map((m) => dateOnly(m.at).slice(0, 7)));
  const fixedTotal = fixed.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  const gasTotal = actual.filter((m) => m.direction === 'saida' && category(m)?.systemKey === 'gas-producao').reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
  const laborTotal = actual.filter((m) => m.direction === 'saida' && category(m)?.systemKey === 'pro-labore').reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
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
    let total = (Number(recipe[phase]) || 0) / Number(recipe.yieldNominal);
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
      else if (component.kind === 'product') total += (Number(component.qty) || 0) * productMinutesPerUnit(component.id, phase, stack);
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
  const productionMonths = new Set((hasBatches ? batches.map((b) => b.at) : commandas.filter((c) => (c.itens || []).some((it) => (Number(it.realizado) || 0) > 0)).map((c) => c.date || c.id)).map((iso) => dateOnly(iso).slice(0, 7)));
  return {
    period: `${fmtDate(`${start}T12:00:00`)} a ${fmtDate(`${end}T12:00:00`)}`,
    values: {
      custosFixosMes: fixedMonths.size ? fixedTotal / fixedMonths.size : null,
      taxaGas: gasTotal > 0 && ovenMinutes > 0 ? gasTotal / ovenMinutes : null,
      valorHora: laborTotal > 0 && activeMinutes > 0 ? laborTotal / (activeMinutes / 60) : null,
      expectedActiveMinutesMonth: productionMonths.size && activeMinutes > 0 ? activeMinutes / productionMonths.size : null,
    },
    observedFeePct: tariffTotal > 0 && salesReceived > 0 ? tariffTotal / salesReceived : null,
    facts: { fixedMonths: fixedMonths.size, gasTotal, laborTotal, tariffTotal, salesReceived, productions: hasBatches ? batches.length : commandas.length, productionSource: hasBatches ? 'tempos reais' : 'estimativa das comandas', activeMinutes, ovenMinutes },
  };
}

function ajustesPanel(ctx) {
  const { store } = ctx;
  const c = store.getConfig();
  const automatic = automaticConfigSuggestions(store);
  const f = {};
  const field = (key, label, value, hint) => {
    const input = el('input', { class: 'pa-input pa-narrow', type: 'text', inputmode: 'decimal', value: String(value).replace('.', ',') });
    f[key] = input;
    return el('div', { class: 'pa-field' }, [el('label', { text: label }), input, hint && el('span', { class: 'pa-hint', text: hint })]);
  };

  function save() {
    ctx.actions.setConfig({
      valorHora: parseNum(f.valorHora.value) ?? c.valorHora,
      taxaGas: parseNum(f.taxaGas.value) ?? c.taxaGas,
      custosFixosMes: parseNum(f.custosFixosMes.value) ?? c.custosFixosMes,
      expectedActiveMinutesMonth: parseNum(f.expected.value) ?? c.expectedActiveMinutesMonth,
      targetMarginPct: (parseNum(f.margin.value) ?? pct(c.targetMarginPct)) / 100,
      paymentFeePct: (parseNum(f.fee.value) ?? pct(c.paymentFeePct)) / 100,
    });
  }

  const autoRows = [
    ['Valor da hora', automatic.values.valorHora, 'R$/h', automatic.facts.activeMinutes > 0 ? `${fmtNum(automatic.facts.activeMinutes / 60)} h · ${automatic.facts.productionSource}` : 'registre produção nas comandas'],
    ['Gás por minuto', automatic.values.taxaGas, 'R$/min', automatic.facts.ovenMinutes > 0 ? `${fmtNum(automatic.facts.ovenMinutes)} min · ${automatic.facts.productionSource}` : 'registre produção e tempo de forno'],
    ['Custos fixos por mês', automatic.values.custosFixosMes, 'R$', automatic.facts.fixedMonths ? `${automatic.facts.fixedMonths} mês(es) com lançamentos` : 'lance despesas fixas pagas'],
    ['Minutos ativos por mês', automatic.values.expectedActiveMinutesMonth, 'min', automatic.facts.productions ? `${automatic.facts.productions} registro(s) · ${automatic.facts.productionSource}` : 'registre produção nas comandas'],
  ].map(([label, value, unit, source]) => el('div', { class: 'pa-auto-row' }, [
    el('div', { class: 'pa-grow' }, [el('strong', { text: label }), el('span', { class: 'pa-muted', text: source })]),
    el('strong', { class: value == null ? 'pa-muted' : 'pa-positive', text: value == null ? 'dados insuficientes' : (unit === 'R$' ? brl(value) : `${fmtNum(value)} ${unit}`) }),
  ]));
  const applicable = Object.fromEntries(Object.entries(automatic.values).filter(([, value]) => value != null && Number.isFinite(value)));
  const applyAutomatic = () => ctx.actions.setConfig({ ...applicable });
  const automaticMargin = el('input', {
    class: 'pa-input pa-narrow', 'data-testid': 'automatic-target-margin', type: 'text', inputmode: 'decimal',
    value: String(pct(c.targetMarginPct)).replace('.', ','), 'aria-label': 'Margem alvo dos cálculos (%)',
  });
  const saveAutomaticMargin = () => {
    const value = parseNum(automaticMargin.value);
    const feePct = Number(c.paymentFeePct) || 0;
    if (value == null || value < 0 || value / 100 + feePct >= 1) {
      window.alert(`Informe uma margem válida. Somada à taxa de pagamento de ${pctStr(feePct)}, ela precisa ficar abaixo de 100%.`);
      return;
    }
    ctx.actions.setConfig({ targetMarginPct: value / 100 });
  };

  return el('section', {}, [
    el('section', { class: 'pa-card' }, [
      el('div', { class: 'pa-cardhead' }, [el('div', { class: 'pa-grow' }, [el('span', { class: 'pa-eyebrow', text: 'Custos e formação de preço' }), el('h2', { text: 'Ajustes' })])]),
      el('p', { class: 'pa-hint', text: 'Compare o que você definiu manualmente com os dados registrados. O sistema nunca substitui seus valores sozinho.' }),
      el('div', { class: 'pa-settings-grid' }, [
        el('section', { class: 'pa-settings-column' }, [
          el('h3', { class: 'pa-h3', text: 'Seus valores atuais' }),
          field('valorHora', 'Valor da hora (R$/h)', c.valorHora),
          field('taxaGas', 'Gás por minuto de forno (R$/min)', c.taxaGas),
          field('custosFixosMes', 'Custos fixos no mês (R$, inclui DAS)', c.custosFixosMes),
          field('expected', 'Minutos ativos esperados no mês', c.expectedActiveMinutesMonth),
          field('margin', 'Margem alvo (%)', pct(c.targetMarginPct)),
          field('fee', 'Taxa de pagamento (%)', pct(c.paymentFeePct)),
          el('div', { class: 'pa-row pa-form' }, [el('button', { class: 'pa-btn pa-primary', onclick: save }, 'Salvar valores manuais')]),
        ]),
        el('aside', { class: 'pa-settings-column pa-auto-card', 'data-testid': 'automatic-settings' }, [
          el('h3', { class: 'pa-h3', text: 'Calculado pelo sistema' }),
          el('p', { class: 'pa-hint', text: `Base: valores efetivamente pagos e produção registrada de ${automatic.period}.` }),
          ...autoRows,
          el('div', { class: 'pa-auto-row' }, [el('div', { class: 'pa-grow' }, [el('strong', { text: 'Taxa financeira observada' }), el('span', { class: 'pa-muted', text: 'tarifas ÷ recebimentos; apenas comparação' })]), el('strong', { class: automatic.observedFeePct == null ? 'pa-muted' : '', text: automatic.observedFeePct == null ? 'dados insuficientes' : pctStr(automatic.observedFeePct) })]),
          el('div', { class: 'pa-auto-row' }, [
            el('div', { class: 'pa-grow' }, [el('strong', { text: 'Margem alvo dos cálculos' }), el('span', { class: 'pa-muted', text: 'definida por você; afeta preços e indicadores' })]),
            el('div', { class: 'pa-row' }, [automaticMargin, el('span', { class: 'pa-muted', text: '%' })]),
          ]),
          el('button', { class: 'pa-btn', 'data-testid': 'save-automatic-target-margin', onclick: saveAutomaticMargin }, 'Atualizar margem dos cálculos'),
          el('button', { class: 'pa-btn pa-primary', 'data-testid': 'apply-automatic-settings', disabled: Object.keys(applicable).length === 0, onclick: applyAutomatic }, 'Usar valores calculados disponíveis'),
          el('p', { class: 'pa-hint', text: 'Custos só são atualizados quando há dados suficientes. A margem muda apenas quando você confirmar no botão acima; a taxa de pagamento não muda automaticamente.' }),
        ]),
      ]),
    ]),
    empresaCard(ctx),
    dadosCard(ctx),
    trashPanel(ctx),
    dropboxPanel(ctx),
  ]);
}

// Dados da empresa (Rev 06) — recibo header. Stored in config (synced/backed up), never in source.
function empresaCard(ctx) {
  const emp = ctx.store.getConfig().empresa || {};
  let logo = emp.logo || '';
  const f = {};
  const tf = (key, label, ph) => {
    const i = el('input', { class: 'pa-input', 'data-testid': `emp-${key}`, type: 'text', placeholder: ph || '', value: emp[key] || '' });
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
      reader.onload = () => { logo = String(reader.result); renderPreview(); };
      reader.readAsDataURL(file);
      e.target.value = '';
    },
  });
  function save() {
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
        logo && el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => { logo = ''; renderPreview(); } }, 'Remover'),
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
          downloadFile(`paiol-backup-${backupFileStamp()}.yaml`, exportYaml(ctx.store));
          void ctx.actions.backupExtra();
        },
      }, ctx.view.backupBusy ? 'Criando backup…' : 'Criar backup extra agora'),
      el('button', { class: 'pa-btn', 'data-testid': 'import-btn', onclick: () => fileInput.click() }, 'Importar dados'),
      fileInput,
    ]),
    el('p', { class: 'pa-hint', text: 'Baixa uma cópia completa neste aparelho. Se o Dropbox estiver conectado, também cria uma cópia extra na pasta de backups da nuvem.' }),
  ]);
}

function backupFileStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

function trashPanel(ctx) {
  const items = ctx.store.activeTrash();
  const typeNames = {
    ingredients: 'Insumo', recipes: 'Receita', products: 'Produto', clients: 'Cliente', encomendas: 'Encomenda',
    comandas: 'Comanda', categories: 'Categoria', suppliers: 'Fornecedor', cashAccounts: 'Conta financeira',
    financeTitles: 'Lançamento financeiro', purchases: 'Compra',
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
