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
import { generateFichasPdf, generateReciboPdf, savePdf } from './pdf.js';
import { workbookBytes, parseInterchange, previewExchange } from './xlsx-exchange.js';
import { monthSummary, despesasByCategory, productSummary, clientSummary, revenueTrend } from './reports.js';

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
  { id: 'inicio', label: 'Início', icon: '🏠', screens: [['inicio', 'Início']] },
  { id: 'cadastros', label: 'Cadastro', icon: '📚', screens: [['insumos', 'Insumos'], ['receitas', 'Receitas'], ['produtos', 'Produtos'], ['clientes', 'Clientes']] },
  { id: 'operacao', label: 'Operação', icon: '🧾', screens: [['encomendas', 'Encomendas'], ['comanda', 'Comanda'], ['fiado', 'A Receber'], ['vendas', 'Vendas'], ['despesas', 'Despesas'], ['perdas', 'Perdas']] },
  { id: 'analise', label: 'Análise', icon: '📊', screens: [['precos', 'Preços'], ['relatorios', 'Relatórios'], ['simulador', 'Simulador']] },
  { id: 'ajustes', label: 'Ajustes', icon: '⚙️', screens: [['ajustes', 'Ajustes']] },
];
const SECTION_OF = {};
for (const sec of SECTIONS) for (const [sid] of sec.screens) SECTION_OF[sid] = sec;

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
    'O modo de fazer cada coisa: o quanto rende, os minutos de mão na massa e de forno, e os insumos (ou outras receitas) que entram.',
    'O app soma tudo e calcula o custo real de cada receita — incluindo o seu tempo de trabalho e o gás do forno.',
  ] },
  { id: 'produtos', icon: '🎂', label: 'Produtos', paras: [
    'O que você vende. Um produto pode ser feito de uma receita, de várias (combos), de outros produtos (cestas!) ou de insumos comprados.',
    'A embalagem entra como custo, com uma descrição (boleira, saco, lata). Toque em “+ Novo” pra criar e montar os itens.',
  ] },
  { id: 'clientes', icon: '👥', label: 'Clientes', paras: [
    'Seus clientes — nome, telefone e endereço. Como a maioria é recorrente, cadastrar uma vez agiliza lançar os pedidos e montar a ficha (histórico de compras) de cada um.',
    'No fim da tela você gera as fichas em PDF (3 por folha, pra imprimir e arquivar): todas as vendas, só as em aberto (com saldo) ou só as pagas.',
  ] },
  { id: 'precos', icon: '💰', label: 'Preços', paras: [
    'O coração do app: pra cada produto mostra quanto custa fazer (ingredientes, sua mão de obra, gás, custos fixos e embalagem) e sugere um preço de venda já com a sua margem.',
    'Se aparecer “sem preço”, é porque falta cadastrar o preço de algum insumo usado.',
  ] },
  { id: 'encomendas', icon: '📋', label: 'Encomendas', paras: [
    'Os pedidos com data de entrega. Escolha o cliente, a data e vá buscando os produtos — o total sai calculado. A encomenda já conta como venda e entra no histórico do cliente.',
    'Tudo é editável. Toque em “+ Nova” para criar, ou numa encomenda para editar. Depois de um pagamento, dá pra gerar um recibo (PDF) ali mesmo — é um comprovante, não substitui nota fiscal.',
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
    'Registre suas vendas. O preço sugerido já vem preenchido; edite se vendeu por outro valor. O lucro de cada venda já desconta o custo e a taxa de pagamento.',
    'Dá pra lançar venda de outro dia pela data, e usar a busca ou o filtro de mês pra encontrar.',
  ] },
  { id: 'despesas', icon: '🧾', label: 'Despesas', paras: [
    'Tudo que você gasta, organizado por categoria: matéria-prima, embalagens, gás, frete, aluguel, água, luz, pró-labore… Lance cada gasto por data, conforme acontece — é assim que o lucro do mês fica real.',
    'Toque em “Categorias” para criar, renomear, arquivar ou apagar categorias e subcategorias do seu jeito. As despesas entram como desconto no lucro do mês, nos Relatórios.',
  ] },
  { id: 'perdas', icon: '🗑️', label: 'Perdas', paras: [
    'O que se perdeu e não virou venda: uma massa que deu errado, um produto que não vendeu, uma embalagem danificada. Para insumo ou produto, o valor já vem calculado pela quantidade.',
    'O total entra como desconto no lucro do mês — deixa o resultado mais verdadeiro.',
  ] },
  { id: 'relatorios', icon: '📊', label: 'Relatórios', paras: [
    'Seu balanço por mês: faturamento, custos, taxas, lucro e margem, com gráfico e o resultado por produto. Dá pra exportar.',
  ] },
  { id: 'simulador', icon: '⚖️', label: 'Simulador', paras: [
    'Faça contas de “e se…”. Escolha uma receita e veja o que acontece com o custo e a margem se você fizer um lote maior — os ingredientes crescem junto, mas a mão de obra costuma subir pouco, então o custo por unidade cai.',
    'Compare a margem e o lucro a um preço fixo. Ajuda a decidir se mantém, adapta ou tira um produto do cardápio.',
  ] },
  { id: 'ajustes', icon: '⚙️', label: 'Ajustes', paras: [
    'Suas configurações: o valor da sua hora de trabalho, o custo do gás por minuto, os custos fixos do mês e a margem que você quer ganhar.',
    'Aqui também ficam o backup no Dropbox e a importação/exportação dos seus dados.',
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
const todayInput = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (ym) => { const [y, m] = String(ym).split('-'); return `${m}/${(y || '').slice(2)}`; };

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
    encomendas: encomendasPanel, comanda: comandaPanel, fiado: fiadoPanel, despesas: despesasPanel, perdas: perdasPanel,
    relatorios: relatoriosPanel, simulador: simuladorPanel, ajustes: ajustesPanel,
  };
  const section = SECTION_OF[ctx.view.tab] || SECTIONS[0];
  const tab = section.screens.some(([sid]) => sid === ctx.view.tab) ? ctx.view.tab : section.screens[0][0];

  const content = [];
  if (ctx.view.updateReady) {
    content.push(el('div', { class: 'pa-update', 'data-testid': 'update-banner' }, [
      el('span', { class: 'pa-grow', text: '✨ Nova versão disponível' }),
      el('button', { class: 'pa-btn pa-sm', 'data-testid': 'update-apply', onclick: () => ctx.actions.applyUpdate() }, 'Atualizar'),
    ]));
  }
  if (section.screens.length > 1) {
    content.push(el('div', { class: 'pa-seg' }, section.screens.map(([sid, label]) =>
      el('button', { class: 'pa-segbtn' + (sid === tab ? ' active' : ''), 'data-screen': sid, onclick: () => ctx.actions.setTab(sid) }, label))));
  }
  content.push((panels[tab] || inicioPanel)(ctx));

  root.replaceChildren(...[
    el('header', { class: 'pa-header' }, [
      el('div', { class: 'pa-grow' }, [
        el('h1', {}, [el('span', { text: 'Quitutes do Paiol' }), el('span', { class: 'pa-beta', title: 'Em testes — novidades chegando', text: 'beta' })]),
        el('p', { class: 'pa-sub', text: 'Custos, receitas e vendas' }),
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
  return [
    el('div', { class: 'pa-sheet-grab' }),
    el('h2', { class: 'pa-sheet-title', text: title }),
    el('div', { class: 'pa-sheet-body' }, rows),
    el('div', { class: 'pa-sheet-actions' }, [
      onSave && el('button', { class: 'pa-btn pa-primary pa-grow', 'data-testid': saveTestid, onclick: onSave }, saveLabel || 'Salvar'),
    ].filter(Boolean)),
    danger && el('button', { class: 'pa-btn pa-ghost pa-bad pa-sheet-danger', 'data-testid': danger.testid, onclick: danger.onClick }, danger.label),
  ].filter(Boolean);
}

function field(label, control) {
  return el('div', { class: 'pa-field' }, [el('label', { text: label }), control]);
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
    kind: 'confirm', title: 'Remover?', message: `Remover ${label}? Esta ação não pode ser desfeita.`,
    yesLabel: 'Remover', onYes: () => ctx.actions.mutate(fn),
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
        el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Lucro do mês' }), el('td', { class: 'pa-num' + (sum.lucro >= 0 ? '' : ' pa-bad'), text: brl(sum.lucro) })]),
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
  return el('li', { class: 'pa-row-item', 'data-search': `${recipe.name} ${(recipe.tags || []).join(' ')}`, onclick: () => ctx.actions.openModal({ kind: 'receita-edit', id: recipe.id }) }, [
    el('div', { class: 'pa-grow' }, [
      el('div', {}, el('strong', { text: recipe.name })),
      el('span', { class: 'pa-muted', text: `${recipe.yieldNominal} ${recipe.yieldUnit} · ${recipe.activeMinutes}min ativos · ${n} ${n === 1 ? 'item' : 'itens'}` }),
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
    ctx.actions.mutate((s) => s.upsertRecipe({
      ...(recipe || { fermentMinutes: 0 }), id: recipe ? recipe.id : uuid(), name: nm,
      yieldNominal: y, yieldUnit: yieldUnit.value,
      activeMinutes: parseNum(active.value) || 0, ovenMinutes: parseNum(oven.value) || 0,
      components: comps, ...(obs ? { notes: obs } : { notes: undefined }),
      weightTotal: w == null ? undefined : w, weightUnit: w == null ? undefined : weightUnit.value,
      tags: tg.length ? tg : undefined,
    }));
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
    el('h3', { class: 'pa-h3', text: 'Itens' }),
    itemsList,
    options.length === 0
      ? el('p', { class: 'pa-hint', text: 'Cadastre insumos primeiro para montar a receita.' })
      : el('div', { class: 'pa-row pa-form' }, [refSel, qty, unit,
          el('button', { class: 'pa-btn pa-sm', 'data-testid': 'rec-compadd', onclick: addComponent }, '+ item')]),
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
  const canBuild = store.state.recipes.length > 0 || store.state.ingredients.length > 0;
  const list = el('ul', { class: 'pa-list pa-rows' }, store.state.products.map((p) => produtoRow(ctx, p)));
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('h2', { class: 'pa-grow', text: 'Produtos' }),
      canBuild && el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'prod-new', onclick: () => ctx.actions.openModal({ kind: 'produto-add' }) }, '+ Novo'),
    ].filter(Boolean)),
    !canBuild && el('p', { class: 'pa-hint', text: 'Crie uma receita ou um insumo primeiro.' }),
    store.state.products.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhum produto ainda.' })
      : el('div', {}, [el('p', { class: 'pa-hint pa-tap', text: 'Toque em um produto para editar (margem, itens, embalagem).' }), searchInput('Buscar produto…', list, 'prod-search'), list]),
  ].filter(Boolean));
}

// Clean, scannable row — the whole row opens the edit sheet.
function produtoRow(ctx, product) {
  const { store } = ctx;
  const n = (product.components || []).length;
  const semPreco = unpricedInProduct(store, product.id).length > 0;
  return el('li', { class: 'pa-row-item', 'data-search': `${product.name} ${(product.tags || []).join(' ')}`, onclick: () => ctx.actions.openModal({ kind: 'produto-edit', id: product.id }) }, [
    el('div', { class: 'pa-grow' }, [
      el('div', {}, el('strong', { text: product.name })),
      el('span', { class: 'pa-muted', text: `emb. ${brl(product.packagingCost)}${product.packagingDesc ? ` (${product.packagingDesc})` : ''} · ${n} ${n === 1 ? 'item' : 'itens'}` }),
      semPreco && el('span', { class: 'pa-badge pa-bad', text: 'sem preço' }),
      tagChips(product.tags),
    ].filter(Boolean)),
    el('span', { class: 'pa-chev', text: '›' }),
  ]);
}

MODALS['produto-add'] = (ctx) => produtoSheet(ctx, null);
MODALS['produto-edit'] = (ctx, m) => produtoSheet(ctx, ctx.store.get('products', m.id) || null);

function produtoSheet(ctx, product) {
  const { store } = ctx;
  // Local draft of components — committed atomically on Salvar (see receitaSheet).
  const comps = product ? (product.components || []).map((c) => ({ kind: c.kind, id: c.id, qty: c.qty })) : [];

  const config = store.getConfig();
  const name = el('input', { class: 'pa-input', 'data-testid': 'prod-name', type: 'text', placeholder: 'Nome (ex.: Bolo 500g, Cesta de Natal)', value: product ? product.name : '' });
  const pkg = moneyField(product ? product.packagingCost : null, 'prod-pkg');
  const pkgDesc = el('input', { class: 'pa-input', 'data-testid': 'prod-pkgdesc', type: 'text', placeholder: 'descrição (ex.: boleira)', value: product ? (product.packagingDesc || '') : '' });
  const margin = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'prod-margin', type: 'text', inputmode: 'decimal', placeholder: `padrão ${pct(config.targetMarginPct)}`, value: product && product.targetMarginPct != null ? String(pct(product.targetMarginPct)) : '' });
  const tags = tagsInput(product && product.tags, 'prod-tags');

  // Component editor: recipes, other products (never itself), and bought insumos.
  const options = [
    ...store.state.recipes.map((r) => ({ kind: 'recipe', id: r.id, label: `Receita: ${r.name}`, unitLabel: r.yieldUnit })),
    ...store.state.products.filter((x) => !product || x.id !== product.id).map((x) => ({ kind: 'product', id: x.id, label: `Produto: ${x.name}`, unitLabel: 'un' })),
    ...store.state.ingredients.map((i) => ({ kind: 'ingredient', id: i.id, label: `Insumo: ${i.name}`, unitLabel: i.stockUnit })),
  ];
  const refSel = el('select', { class: 'pa-input', 'data-testid': 'prodcomp-ref' }, options.map((o, i) => el('option', { value: String(i), text: o.label })));
  const qty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'prodcomp-qty', type: 'text', inputmode: 'decimal', placeholder: 'qtd', value: '1' });
  const unitLab = el('span', { class: 'pa-lab' });
  function refreshUnit() { const o = options[Number(refSel.value)] || options[0]; unitLab.textContent = o ? o.unitLabel : ''; }
  refreshUnit();
  refSel.addEventListener('change', refreshUnit);

  const itemsList = el('ul', { class: 'pa-list pa-tight' });
  function renderItems() {
    itemsList.replaceChildren(...(comps.length
      ? comps.map((c, idx) => el('li', { class: 'pa-list-item' }, [
          el('span', { class: 'pa-grow', text: productCompLabel(store, c) }),
          el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Remover item', onclick: () => { comps.splice(idx, 1); renderItems(); } }, '✕'),
        ]))
      : [el('li', { class: 'pa-empty pa-sm', text: 'Sem itens ainda.' })]));
  }
  renderItems();

  function addComp() {
    const o = options[Number(refSel.value)];
    const q = parseNum(qty.value);
    if (!o || !(q > 0)) { qty.focus(); return; }
    comps.push({ kind: o.kind, id: o.id, qty: q });
    qty.value = '1';
    renderItems();
  }

  function save() {
    const nm = name.value.trim();
    if (!nm) { name.focus(); return; }
    const d = pkgDesc.value.trim();
    const mTxt = margin.value.trim();
    const mPct = mTxt === '' ? null : parseNum(mTxt);
    const tg = tags.value();
    ctx.actions.mutate((s) => s.upsertProduct({
      ...(product || {}), id: product ? product.id : uuid(), name: nm, components: comps,
      packagingCost: parseNum(pkg.input.value) || 0, ...(d ? { packagingDesc: d } : { packagingDesc: undefined }),
      targetMarginPct: mPct == null ? undefined : mPct / 100,
      tags: tg.length ? tg : undefined,
    }));
  }

  const rows = [
    field('Nome', name),
    field('Embalagem', pkg),
    field('Descrição da embalagem (opcional)', pkgDesc),
    el('div', { class: 'pa-field' }, [el('label', { text: 'Margem de lucro (%)' }), el('div', { class: 'pa-row' }, [margin, el('span', { class: 'pa-lab', text: 'deixe vazio para usar a margem padrão' })])]),
    field('Etiquetas (opcional)', tags.el),
    el('h3', { class: 'pa-h3', text: 'Itens' }),
    el('p', { class: 'pa-hint', text: 'Receitas, outros produtos ou insumos comprados. Cesta = vários produtos/itens juntos.' }),
    itemsList,
    options.length === 0
      ? el('p', { class: 'pa-hint', text: 'Cadastre receitas ou insumos para montar o produto.' })
      : el('div', { class: 'pa-row pa-form' }, [refSel, qty, unitLab,
          el('button', { class: 'pa-btn pa-sm', 'data-testid': 'prodcomp-add', onclick: addComp }, '+ item')]),
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
      el('div', {}, el('strong', { text: c.name })),
      meta && el('span', { class: 'pa-muted', text: meta }),
    ].filter(Boolean)),
    el('span', { class: 'pa-chev', text: '›' }),
  ]);
}

MODALS['cliente-add'] = (ctx) => clienteSheet(ctx, null);
MODALS['cliente-edit'] = (ctx, m) => clienteSheet(ctx, ctx.store.get('clients', m.id) || null);

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
    rows.push(el('div', { class: 'pa-row pa-cardfoot' }, [
      fichasButton(ctx, '🖨 Gerar ficha (PDF)', () => buildFichas(ctx.store, ctx.store.state.encomendas.filter((e) => e.clienteId === cli.id)), `ficha-${cli.name}.pdf`),
    ]));
  }
  return sheet({
    title: cli ? 'Editar cliente' : 'Novo cliente',
    rows,
    onSave: save,
    saveTestid: 'cli-save',
    danger: cli ? { label: '🗑 Excluir cliente', testid: 'cli-delete', onClick: () => confirmRemove(ctx, `o cliente "${cli.name}"`, (s) => s.removeClient(cli.id)) } : null,
  });
}

// ── Preços (the payoff) ─────────────────────────────────────────────────────────

function precosPanel(ctx) {
  const { store } = ctx;
  const config = store.getConfig();
  const es = store.toEngineStore();
  const lens = estimateLens(config);

  const cards = store.state.products.map((p) => {
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
    store.state.products.length === 0
      ? el('p', { class: 'pa-empty', text: 'Crie produtos para ver custos e preços sugeridos.' })
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
    if ((e.deliveryDate || '').slice(0, 10) !== date) continue;
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
    const matches = store.state.products.filter((p) => norm(p.name).includes(q) && !items.has(p.id) && !ordered.has(p.id)).slice(0, 6);
    results.style.display = matches.length ? '' : 'none';
    results.replaceChildren(...matches.map((p) => el('li', { class: 'pa-row-item', 'data-testid': 'cmd-prodresult', onclick: () => {
      items.set(p.id, { prevista: undefined, realizado: 0, feito: false });
      pids = [...new Set([...pids, p.id])].sort((a, b) => norm(store.get('products', a)?.name || '').localeCompare(norm(store.get('products', b)?.name || '')));
      search.value = ''; renderResults(); renderList();
    } }, [el('div', { class: 'pa-grow' }, el('strong', { text: p.name })), el('span', { class: 'pa-add', text: '+' })])));
  }
  search.addEventListener('input', renderResults);

  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [el('h2', { class: 'pa-grow', text: 'Comanda do dia' }), dateInput]),
    el('p', { class: 'pa-hint', text: 'O que produzir hoje. A Quantidade Prevista vem das encomendas do dia (dá pra ajustar), e você anota o que PRODUZIU em Produzidos/Estoque. Pode adicionar produtos avulsos pra estoque ou pronta entrega.' }),
    list,
    search, results,
    indEl,
  ]);
}

// ── Vendas (Sale — revenue, with snapshotted cost for true margin) ───────────────

function vendasPanel(ctx) {
  const { store } = ctx;
  const products = store.state.products;
  const all = store.state.sales.slice().sort((a, b) => (a.at < b.at ? 1 : -1));
  const month = ctx.view.logMonth;
  const sales = month ? all.filter((s) => monthOf(s.at) === month) : all;
  // Totals follow the month scope (an all-time headline when no month is chosen); search is a
  // transient find within that scope and does not move the totals.
  let revenue = 0; let profit = 0;
  for (const s of sales) {
    if (store.isReversed('sale', s.id)) continue;
    const rev = s.qty * s.unitPrice;
    revenue += rev;
    profit += rev - rev * s.paymentFeePct - s.qty * s.costSnapshot;
  }
  const list = logList(sales, (s) => saleRow(ctx, s));

  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('h2', { class: 'pa-grow', text: 'Vendas' }),
      products.length > 0 && el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'venda-new', onclick: () => ctx.actions.openModal({ kind: 'venda-add' }) }, '+ Registrar'),
    ].filter(Boolean)),
    products.length === 0 && el('p', { class: 'pa-hint', text: 'Crie um produto primeiro.' }),
    all.length > 0 && logFilters(ctx, list, { searchPlaceholder: 'Buscar produto ou canal…', searchTestid: 'venda-search', monthTestid: 'venda-month' }),
    sales.length > 0 && el('div', { class: 'pa-row pa-totals' }, [
      el('span', { class: 'pa-grow' }, [el('strong', { text: `Receita${month ? ` (${monthLabel(month)})` : ''} ` }), brl(revenue)]),
      el('span', { class: profit >= 0 ? 'pa-badge pa-ok' : 'pa-badge pa-bad', text: `lucro ${brl(profit)}` }),
    ]),
    all.length === 0
      ? products.length > 0 && el('p', { class: 'pa-empty', text: 'Nenhuma venda registrada. Toque em “+ Registrar”.' })
      : sales.length === 0
        ? el('p', { class: 'pa-empty', text: 'Nenhuma venda neste mês.' })
        : list,
  ].filter(Boolean));
}

// Read-only log entry (append-only — no edit; an estorno would be a new event). The day is in the
// group header, so the row shows just quantity × price, channel, and the realized profit.
function saleRow(ctx, s) {
  const { store } = ctx;
  const reversed = store.isReversed('sale', s.id);
  const p = store.get('products', s.productId);
  const rev = s.qty * s.unitPrice;
  const prof = rev - rev * s.paymentFeePct - s.qty * s.costSnapshot;
  return el('li', { class: 'pa-list-item' + (reversed ? ' pa-reversed' : ''), 'data-search': `${p ? p.name : ''} ${s.channel || ''}` }, [
    el('div', { class: 'pa-grow' }, [
      el('div', {}, el('strong', { text: p ? p.name : '(produto removido)' })),
      el('span', { class: 'pa-muted', text: `${s.qty} × ${brl(s.unitPrice)}${s.channel ? ` · ${s.channel}` : ''}` }),
    ]),
    el('span', { class: prof >= 0 ? 'pa-num' : 'pa-num pa-bad', text: brl(prof) }),
    estornoControl(ctx, 'sale', s.id),
  ]);
}

MODALS['venda-add'] = (ctx) => vendaSheet(ctx);

function vendaSheet(ctx) {
  const { store } = ctx;
  const config = store.getConfig();
  const products = store.state.products;
  const es = store.toEngineStore();
  const lens = estimateLens(config);
  const suggested = (pid) => { try { return productPrice(es, pid, config, lens).price; } catch { return null; } };

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

function encomendasPanel(ctx) {
  const { store } = ctx;
  const products = store.state.products;
  const all = store.state.encomendas.slice().sort((a, b) => (a.deliveryDate < b.deliveryDate ? 1 : -1));
  const ul = el('ul', { class: 'pa-list pa-rows' }, all.map((e) => encomendaRow(ctx, e)));
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('h2', { class: 'pa-grow', text: 'Encomendas' }),
      products.length > 0 && el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'enc-new', onclick: () => ctx.actions.openModal({ kind: 'encomenda-add' }) }, '+ Nova'),
    ].filter(Boolean)),
    products.length === 0 && el('p', { class: 'pa-hint', text: 'Crie um produto primeiro.' }),
    all.length === 0
      ? products.length > 0 && el('p', { class: 'pa-empty', text: 'Nenhuma encomenda. Toque em “+ Nova”.' })
      : el('div', {}, [el('p', { class: 'pa-hint pa-tap', text: 'Toque numa encomenda para editar.' }), searchInput('Buscar cliente ou produto…', ul, 'enc-search'), ul]),
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
  return el('li', { class: 'pa-row-item', 'data-search': `${cli ? cli.name : ''} ${resumo}`, onclick: () => ctx.actions.openModal({ kind: 'encomenda-edit', id: e.id }) }, [
    el('div', { class: 'pa-grow' }, [
      el('div', {}, [el('strong', { text: cli ? cli.name : 'Sem cliente' }), el('span', { class: `pa-badge ${st.cls}`, text: st.label })]),
      el('span', { class: 'pa-muted', text: `${fmtDate(e.deliveryDate)} · ${resumo}` }),
    ]),
    el('span', { class: 'pa-num', text: brl(e.total) }),
    el('span', { class: 'pa-chev', text: '›' }),
  ]);
}

MODALS['encomenda-add'] = (ctx) => encomendaSheet(ctx, null);
MODALS['encomenda-edit'] = (ctx, m) => encomendaSheet(ctx, ctx.store.get('encomendas', m.id) || null);

function encomendaSheet(ctx, enc) {
  const { store } = ctx;
  const config = store.getConfig();
  const es = store.toEngineStore();
  const lens = estimateLens(config);
  const suggested = (pid) => { try { return productPrice(es, pid, config, lens).price; } catch { return 0; } };
  const unitCost = (pid) => { try { return productUnitCost(es, pid, config, lens); } catch { return 0; } };

  const items = enc ? enc.itens.map((it) => ({ productId: it.productId, qty: it.qty, unitPrice: it.unitPrice })) : [];

  const cliSel = el('select', { class: 'pa-input', 'data-testid': 'enc-cliente' }, [
    el('option', { value: '', text: '— sem cliente —' }),
    ...store.state.clients.map((c) => el('option', { value: c.id, text: c.name, ...(enc && enc.clienteId === c.id ? { selected: 'selected' } : {}) })),
  ]);
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
    const matches = store.state.products.filter((p) => norm(p.name).includes(q)).slice(0, 6);
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
      clienteId: cliSel.value || undefined,
      itens: items.map((it) => ({ productId: it.productId, qty: Number(it.qty) || 0, unitPrice: Number(it.unitPrice) || 0 })),
      total: grandTotal(),
      costSnapshot: cost,
      deliveryMethod: entrega.value,
      frete: fr == null ? undefined : fr,
      notes: ob || undefined,
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
        st.saldo > 0.005 && el('button', { class: 'pa-btn pa-sm', 'data-testid': 'enc-pagar', onclick: () => ctx.actions.openModal({ kind: 'pagamento-add', encomendaId: enc.id }) }, '+ Registrar pagamento'),
        st.paid > 0.005 && reciboButton(ctx, enc),
      ].filter(Boolean)),
    );
  }

  const rows = [
    field('Cliente', cliSel),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Entrega' }), date, entrega]),
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
    danger: enc ? { label: '🗑 Excluir encomenda', testid: 'enc-delete', onClick: () => confirmRemove(ctx, `a encomenda de ${cliName}`, (s) => s.removeEncomenda(enc.id)) } : null,
  });
}

// ── Pagamentos (Rev 04 — append-only; saldo/status derived; estorno corrige) ─────

MODALS['pagamento-add'] = (ctx, m) => pagamentoSheet(ctx, m.encomendaId);

function pagamentoSheet(ctx, encomendaId) {
  const { store } = ctx;
  const enc = store.get('encomendas', encomendaId);
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
  for (const e of encomendas) {
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
    const saldo = (e.total || 0) - store.paidFor(e.id);
    if (mode === 'aberto') return saldo > 0.005;     // em aberto + parcialmente pagas
    if (mode === 'pagas') return saldo <= 0.005;      // quitadas
    return true;                                      // todas
  });
}

/** A button that generates + saves a fichas PDF, with inline "Gerando…" feedback. */
function fichasButton(ctx, label, getFichas, filename, testid = 'gerar-fichas') {
  const btn = el('button', { class: 'pa-btn pa-sm', 'data-testid': testid }, label);
  btn.addEventListener('click', async () => {
    const fichas = getFichas();
    if (!fichas.length) return;
    const orig = btn.textContent;
    btn.textContent = 'Gerando…'; btn.disabled = true;
    try { await savePdf(await generateFichasPdf(fichas), filename); }
    catch (e) { window.alert('Não foi possível gerar o PDF: ' + (e && e.message ? e.message : e)); }
    finally { btn.textContent = orig; btn.disabled = false; }
  });
  return btn;
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
  const pend = store.state.encomendas
    .map((e) => ({ e, saldo: (e.total || 0) - store.paidFor(e.id) }))
    .filter((x) => x.saldo > 0.005)
    .sort((a, b) => (a.e.deliveryDate < b.e.deliveryDate ? 1 : -1));
  const total = pend.reduce((s, x) => s + x.saldo, 0);
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('h2', { class: 'pa-grow', text: 'A Receber' }),
      pend.length > 0 && fichasButton(ctx, '🖨 Fichas', () => buildFichas(store, pend.map((x) => x.e)), 'fichas-pendentes.pdf'),
    ].filter(Boolean)),
    el('p', { class: 'pa-hint', text: 'Quem ainda tem valor a pagar das encomendas. Toque para registrar um pagamento. “Fichas” gera um PDF (3 por folha) pra imprimir e arquivar.' }),
    pend.length === 0
      ? el('p', { class: 'pa-empty', text: 'Ninguém devendo. 🎉' })
      : el('div', {}, [
          el('div', { class: 'pa-row pa-totals' }, [el('span', { class: 'pa-grow' }, [el('strong', { text: 'A receber ' }), brl(total)])]),
          el('ul', { class: 'pa-list pa-rows' }, pend.map(({ e, saldo }) => {
            const cli = e.clienteId ? store.get('clients', e.clienteId) : null;
            return el('li', { class: 'pa-row-item', 'data-testid': 'fiado-row', onclick: () => ctx.actions.openModal({ kind: 'pagamento-add', encomendaId: e.id }) }, [
              el('div', { class: 'pa-grow' }, [
                el('div', {}, el('strong', { text: cli ? cli.name : 'Sem cliente' })),
                el('span', { class: 'pa-muted', text: `${encomendaItemsResumo(store, e)} · entrega ${fmtDate(e.deliveryDate)}` }),
              ]),
              el('span', { class: 'pa-num pa-bad', text: brl(saldo) }),
              el('span', { class: 'pa-chev', text: '›' }),
            ]);
          })),
        ]),
  ]);
}

// ── Custos variáveis (Rev 03 #4 — dated expense ledger) ──────────────────────────

// ── Despesas (Rev 06 — categorized cash-expense ledger; feeds the cash-basis result) ─────────────

const CATEGORY_KINDS = [
  ['despesaVariavel', 'Despesa Variável', 'Despesas Variáveis'],
  ['despesaFixa', 'Despesa Fixa', 'Despesas Fixas'],
  ['receita', 'Receita', 'Receitas'],
  ['perda', 'Perda', 'Perdas'],
];
const kindShort = (k) => ({ despesaFixa: 'Fixa', despesaVariavel: 'Variável', receita: 'Receita', perda: 'Perda' }[k] || '');

/** <optgroup>s of the despesa-able categories (fixa/variável), subcategorias indented, archived hidden. */
function despesaCategoryGroups(store) {
  return [['despesaVariavel', 'Despesas Variáveis'], ['despesaFixa', 'Despesas Fixas']].map(([kind, label]) => {
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

function despesasPanel(ctx) {
  const { store } = ctx;
  const all = store.state.despesas.slice().sort((a, b) => (a.at < b.at ? 1 : -1));
  const month = ctx.view.logMonth;
  const items = month ? all.filter((d) => monthOf(d.at) === month) : all;
  const total = items.reduce((s, d) => (store.isReversed('despesa', d.id) ? s : s + (d.valor || 0)), 0);
  const catName = (id) => store.get('categories', id)?.name || '(sem categoria)';
  const list = logList(items, (d) => el('li', { class: 'pa-list-item' + (store.isReversed('despesa', d.id) ? ' pa-reversed' : ''), 'data-search': `${catName(d.categoryId)} ${d.description || ''}` }, [
    el('div', { class: 'pa-grow' }, [
      el('div', {}, el('strong', { text: catName(d.categoryId) })),
      el('span', { class: 'pa-muted', text: [kindShort(store.get('categories', d.categoryId)?.kind), d.description].filter(Boolean).join(' · ') }),
    ]),
    el('span', { class: 'pa-num', text: brl(d.valor) }),
    estornoControl(ctx, 'despesa', d.id),
  ]));
  return el('section', { class: 'pa-card' }, [
    el('div', { class: 'pa-cardhead' }, [
      el('h2', { class: 'pa-grow', text: 'Despesas' }),
      el('button', { class: 'pa-btn pa-sm', 'data-testid': 'cat-manage', onclick: () => ctx.actions.openModal({ kind: 'categorias' }) }, 'Categorias'),
      el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'desp-new', onclick: () => ctx.actions.openModal({ kind: 'despesa-add' }) }, '+ Lançar'),
    ]),
    el('p', { class: 'pa-hint', text: 'Tudo que você gasta, por categoria: matéria-prima, embalagens, gás, frete, aluguel, pró-labore… Lançadas por data — entram no lucro do mês (Relatórios).' }),
    all.length > 0 && logFilters(ctx, list, { searchPlaceholder: 'Buscar despesa…', searchTestid: 'desp-search', monthTestid: 'desp-month' }),
    items.length > 0 && el('div', { class: 'pa-row pa-totals' }, [el('span', { class: 'pa-grow' }, [el('strong', { text: `Total${month ? ` (${monthLabel(month)})` : ''} ` }), brl(total)])]),
    all.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhuma despesa lançada. Toque em “+ Lançar”.' })
      : items.length === 0 ? el('p', { class: 'pa-empty', text: 'Nenhuma despesa neste mês.' }) : list,
  ].filter(Boolean));
}

MODALS['despesa-add'] = (ctx) => despesaSheet(ctx);

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
    ctx.actions.mutateModal((s) => s.upsertCategory({ id: uuid(), name: nm, kind: kindSel.value, ...(parentSel.value ? { parentId: parentSel.value } : {}) }));
  }

  const used = (id) => store.state.despesas.some((d) => d.categoryId === id && !store.isReversed('despesa', d.id));
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
    el('p', { class: 'pa-hint', text: 'O que se perdeu: massa que deu errado, produto que não vendeu, embalagem danificada. O valor entra como desconto no lucro do mês.' }),
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
    sum.faturado !== sum.recebidoVendas && kv('Faturado (entregue)', brl(sum.faturado)),
    sum.aReceber > 0 && kv('A receber', brl(sum.aReceber)),
    el('tr', { class: 'pa-kv-sec' }, [el('td', { colspan: '2', text: 'Saiu' })]),
    kv('Despesas variáveis', brl(sum.despVar)),
    kv('Despesas fixas', brl(sum.despFix)),
    sum.perdas > 0 && kv('Perdas', brl(sum.perdas)),
    kv('Lucro do mês', brl(sum.lucro), 'pa-kv-total', sum.lucro < 0),
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
          el('p', { class: 'pa-hint', text: 'Lucro do mês = o que você recebeu − despesas − perdas. Conta só dinheiro que entrou e saiu de verdade (o custo das receitas é só para formar preço).' }),

          despCat.length > 0 && el('h3', { class: 'pa-h3', text: 'Despesas por categoria' }),
          despCat.length > 0 && el('table', { class: 'pa-kv pa-report' }, despCat.map((d) => el('tr', {}, [
            el('td', { text: d.name }), el('td', { class: 'pa-num', text: brl(d.total) }),
          ]))),

          el('h3', { class: 'pa-h3', text: 'Lucro nos últimos meses' }),
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
    ['Perdas', n2(sum.perdas)],
    ['Lucro do mês', n2(sum.lucro)],
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

function ajustesPanel(ctx) {
  const { store } = ctx;
  const c = store.getConfig();
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

  return el('section', {}, [
    el('section', { class: 'pa-card' }, [
      el('h2', { text: 'Ajustes' }),
      field('valorHora', 'Valor da hora (R$/h)', c.valorHora),
      field('taxaGas', 'Gás por minuto de forno (R$/min)', c.taxaGas),
      field('custosFixosMes', 'Custos fixos no mês (R$, inclui DAS)', c.custosFixosMes),
      field('expected', 'Minutos ativos esperados no mês', c.expectedActiveMinutesMonth),
      field('margin', 'Margem alvo (%)', pct(c.targetMarginPct)),
      field('fee', 'Taxa de pagamento (%)', pct(c.paymentFeePct)),
      el('div', { class: 'pa-row pa-form' }, [el('button', { class: 'pa-btn pa-primary', onclick: save }, 'Salvar ajustes')]),
    ]),
    empresaCard(ctx),
    dadosCard(ctx),
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
    el('h3', { class: 'pa-h3', text: 'Backup (YAML)' }),
    el('div', { class: 'pa-row pa-form' }, [
      el('button', { class: 'pa-btn', 'data-testid': 'export-btn', onclick: () => downloadFile('paiol-dados.yaml', exportYaml(ctx.store)) }, 'Exportar dados'),
      el('button', { class: 'pa-btn', 'data-testid': 'import-btn', onclick: () => fileInput.click() }, 'Importar dados'),
      fileInput,
    ]),
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
  const { linked, busy, status, lastSyncAt, syncError } = ctx.view;
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
    el('p', { class: 'pa-hint', text: 'Seus dados ficam no aparelho. O Dropbox é backup e sincroniza entre aparelhos — sozinho, sem precisar apertar nada.' }),
  ]);
}
