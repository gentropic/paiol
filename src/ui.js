// paiol — UI (PT-BR surface). Vanilla DOM, no framework. English identifiers in code, every
// label Nayara sees in Portuguese. A tabbed shell over the tested core: Insumos, Receitas,
// Produtos, the Preços payoff view (where the cost engine surfaces), and Ajustes.
//
// renderApp rebuilds the DOM from (store, view, actions) on every change. Add-forms only mutate
// on submit, so typing is never interrupted by a re-render.

import {
  estimateLens, costBreakdown, priceFromCost,
  PriceError, CycleError, YieldError, MarkupError, RefError,
} from './cost-engine.js';

const STOCK_UNITS = ['g', 'kg', 'ml', 'l', 'un'];
const TABS = [
  ['insumos', 'Insumos'], ['receitas', 'Receitas'], ['produtos', 'Produtos'],
  ['precos', 'Preços'], ['ajustes', 'Ajustes'],
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
const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
/** Parse a number that may use a comma decimal; '' / invalid → null. */
function parseNum(s) {
  if (s == null) return null;
  const n = Number(String(s).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// ── Shell ───────────────────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} root
 * @param {{ store: import('./store.js').PaiolStore, view: { tab: string, busy: boolean, status: ?string, linked: boolean }, actions: object }} ctx
 */
export function renderApp(root, ctx) {
  const panels = {
    insumos: insumosPanel, receitas: receitasPanel, produtos: produtosPanel,
    precos: precosPanel, ajustes: ajustesPanel,
  };
  root.replaceChildren(
    el('header', { class: 'pa-header' }, [
      el('h1', { text: 'Quitutes do Paiol' }),
      el('p', { class: 'pa-sub', text: 'Custos, receitas e vendas' }),
    ]),
    el('nav', { class: 'pa-nav' }, TABS.map(([id, label]) =>
      el('button', {
        class: 'pa-tab' + (ctx.view.tab === id ? ' active' : ''),
        onclick: () => ctx.actions.setTab(id),
      }, label))),
    (panels[ctx.view.tab] || insumosPanel)(ctx),
  );
}

// ── Insumos ───────────────────────────────────────────────────────────────────

function insumosPanel(ctx) {
  const { store } = ctx;
  const nameInput = el('input', { class: 'pa-input', 'data-testid': 'ins-name', type: 'text', placeholder: 'Nome (ex.: Farinha de trigo)' });
  const unitSelect = el('select', { class: 'pa-input', 'data-testid': 'ins-unit' }, STOCK_UNITS.map((u) => el('option', { value: u, text: u })));
  const priceInput = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'ins-price', type: 'text', inputmode: 'decimal', placeholder: 'Preço' });

  function add() {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const price = parseNum(priceInput.value);
    const id = uuid();
    ctx.actions.mutate((s) => {
      s.upsertIngredient({ id, name, stockUnit: unitSelect.value });
      if (price != null) s.addPriceChange({ id: uuid(), at: nowIso(), ingredientId: id, price });
    });
  }

  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Insumos' }),
    store.state.ingredients.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhum insumo ainda. Adicione o primeiro abaixo.' })
      : el('ul', { class: 'pa-list' }, store.state.ingredients.map((ing) => insumoRow(ctx, ing))),
    el('div', { class: 'pa-row pa-form' }, [
      nameInput, unitSelect, priceInput,
      el('button', { class: 'pa-btn pa-primary', 'data-testid': 'ins-add', onclick: add }, 'Adicionar'),
    ]),
    el('p', { class: 'pa-hint', text: 'O preço é por unidade de compra (ex.: por kg). Atualize quando o preço mudar — o histórico é preservado.' }),
  ]);
}

function insumoRow(ctx, ing) {
  const price = ctx.store.currentPrice(ing.id);
  const priceInput = el('input', { class: 'pa-input pa-narrow', type: 'text', inputmode: 'decimal',
    placeholder: 'novo preço', value: price != null ? String(price).replace('.', ',') : '' });
  function updatePrice() {
    const p = parseNum(priceInput.value);
    if (p == null) return;
    ctx.actions.mutate((s) => s.addPriceChange({ id: uuid(), at: nowIso(), ingredientId: ing.id, price: p }));
  }
  return el('li', { class: 'pa-list-item' }, [
    el('div', { class: 'pa-grow' }, [
      el('strong', { text: ing.name }),
      el('span', { class: 'pa-muted', text: `  ${ing.stockUnit} · ${price != null ? brl(price) + '/' + ing.stockUnit : 'sem preço'}` }),
    ]),
    priceInput,
    el('button', { class: 'pa-btn pa-sm', onclick: updatePrice }, 'Atualizar'),
    el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Remover', onclick: () => ctx.actions.mutate((s) => s.removeIngredient(ing.id)) }, '✕'),
  ]);
}

// ── Receitas ──────────────────────────────────────────────────────────────────

function receitasPanel(ctx) {
  const { store } = ctx;
  const name = el('input', { class: 'pa-input', 'data-testid': 'rec-name', type: 'text', placeholder: 'Nome (ex.: Massa base de bolo)' });
  const yieldQty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-yield', type: 'text', inputmode: 'decimal', placeholder: 'Rend.' });
  const yieldUnit = el('select', { class: 'pa-input', 'data-testid': 'rec-yunit' }, STOCK_UNITS.map((u) => el('option', { value: u, text: u })));
  const active = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-active', type: 'text', inputmode: 'numeric', placeholder: 'min ativos' });
  const oven = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-oven', type: 'text', inputmode: 'numeric', placeholder: 'min forno' });

  function add() {
    const nm = name.value.trim();
    const y = parseNum(yieldQty.value);
    if (!nm || !(y > 0)) { name.focus(); return; }
    ctx.actions.mutate((s) => s.upsertRecipe({
      id: uuid(), name: nm, yieldNominal: y, yieldUnit: yieldUnit.value,
      activeMinutes: parseNum(active.value) || 0, ovenMinutes: parseNum(oven.value) || 0,
      fermentMinutes: 0, components: [],
    }));
  }

  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Receitas' }),
    store.state.recipes.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhuma receita ainda.' })
      : el('div', {}, store.state.recipes.map((r) => receitaCard(ctx, r))),
    el('h3', { class: 'pa-h3', text: 'Nova receita' }),
    el('div', { class: 'pa-row pa-form' }, [name]),
    el('div', { class: 'pa-row pa-form' }, [
      el('span', { class: 'pa-lab', text: 'Rende' }), yieldQty, yieldUnit,
    ]),
    el('div', { class: 'pa-row pa-form' }, [active, oven,
      el('button', { class: 'pa-btn pa-primary', 'data-testid': 'rec-create', onclick: add }, 'Criar receita')]),
    el('p', { class: 'pa-hint', text: 'Min ativos = mão na massa; min forno = gás. Fermentação não conta como trabalho.' }),
  ]);
}

function receitaCard(ctx, recipe) {
  const { store } = ctx;
  // Component editor.
  const options = [
    ...store.state.ingredients.map((i) => ({ kind: 'ingredient', id: i.id, label: `Insumo: ${i.name}` })),
    ...store.state.recipes.filter((r) => r.id !== recipe.id).map((r) => ({ kind: 'recipe', id: r.id, label: `Receita: ${r.name}` })),
  ];
  const refSel = el('select', { class: 'pa-input', 'data-testid': 'rec-compref' }, options.map((o, i) => el('option', { value: String(i), text: o.label })));
  const qty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-compqty', type: 'text', inputmode: 'decimal', placeholder: 'qtd' });
  const unit = el('select', { class: 'pa-input', 'data-testid': 'rec-compunit' }, STOCK_UNITS.map((u) => el('option', { value: u, text: u })));

  function addComponent() {
    const q = parseNum(qty.value);
    const o = options[Number(refSel.value)];
    if (!o || !(q > 0)) return;
    ctx.actions.mutate((s) => {
      const r = s.get('recipes', recipe.id);
      r.components.push({ ref: { kind: o.kind, id: o.id }, qty: q, unit: unit.value });
      s.upsertRecipe(r);
    });
  }
  function removeComponent(idx) {
    ctx.actions.mutate((s) => {
      const r = s.get('recipes', recipe.id);
      r.components.splice(idx, 1);
      s.upsertRecipe(r);
    });
  }

  return el('div', { class: 'pa-sub-card' }, [
    el('div', { class: 'pa-row' }, [
      el('strong', { class: 'pa-grow', text: recipe.name }),
      el('span', { class: 'pa-muted', text: `${recipe.yieldNominal} ${recipe.yieldUnit} · ${recipe.activeMinutes}min ativos · ${recipe.ovenMinutes}min forno` }),
      el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Remover receita', onclick: () => ctx.actions.mutate((s) => s.removeRecipe(recipe.id)) }, '✕'),
    ]),
    recipe.components.length === 0
      ? el('p', { class: 'pa-empty pa-sm', text: 'Sem itens. Adicione insumos ou sub-receitas.' })
      : el('ul', { class: 'pa-list pa-tight' }, recipe.components.map((c, idx) =>
          el('li', { class: 'pa-list-item' }, [
            el('span', { class: 'pa-grow', text: `${c.qty} ${c.unit} — ${refName(store, c.ref)}` }),
            el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => removeComponent(idx) }, '✕'),
          ]))),
    options.length === 0
      ? el('p', { class: 'pa-hint', text: 'Cadastre insumos primeiro para montar a receita.' })
      : el('div', { class: 'pa-row pa-form' }, [refSel, qty, unit,
          el('button', { class: 'pa-btn pa-sm', 'data-testid': 'rec-compadd', onclick: addComponent }, '+ item')]),
  ]);
}

function refName(store, ref) {
  const coll = ref.kind === 'ingredient' ? 'ingredients' : 'recipes';
  return store.get(coll, ref.id)?.name || '(removido)';
}

// ── Produtos ──────────────────────────────────────────────────────────────────

function produtosPanel(ctx) {
  const { store } = ctx;
  const name = el('input', { class: 'pa-input', 'data-testid': 'prod-name', type: 'text', placeholder: 'Nome (ex.: Bolo de cenoura 500g)' });
  const recipeSel = el('select', { class: 'pa-input', 'data-testid': 'prod-recipe' }, store.state.recipes.map((r) => el('option', { value: r.id, text: r.name })));
  const portion = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'prod-portion', type: 'text', inputmode: 'decimal', placeholder: 'porção', value: '1' });
  const pkg = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'prod-pkg', type: 'text', inputmode: 'decimal', placeholder: 'embalagem', value: '0' });

  function add() {
    const nm = name.value.trim();
    const p = parseNum(portion.value);
    if (!nm || !recipeSel.value || !(p > 0)) { name.focus(); return; }
    ctx.actions.mutate((s) => s.upsertProduct({
      id: uuid(), name: nm, recipeId: recipeSel.value, portion: p, packagingCost: parseNum(pkg.value) || 0,
    }));
  }

  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Produtos' }),
    store.state.products.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhum produto ainda.' })
      : el('ul', { class: 'pa-list' }, store.state.products.map((p) =>
          el('li', { class: 'pa-list-item' }, [
            el('div', { class: 'pa-grow' }, [
              el('strong', { text: p.name }),
              el('span', { class: 'pa-muted', text: `  ${refName(store, { kind: 'recipe', id: p.recipeId })} · porção ${p.portion} · emb. ${brl(p.packagingCost)}` }),
            ]),
            el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Remover', onclick: () => ctx.actions.mutate((s) => s.removeProduct(p.id)) }, '✕'),
          ]))),
    store.state.recipes.length === 0
      ? el('p', { class: 'pa-hint', text: 'Crie uma receita primeiro.' })
      : el('div', {}, [
          el('h3', { class: 'pa-h3', text: 'Novo produto' }),
          el('div', { class: 'pa-row pa-form' }, [name]),
          el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Receita' }), recipeSel]),
          el('div', { class: 'pa-row pa-form' }, [
            el('span', { class: 'pa-lab', text: 'Porção' }), portion,
            el('span', { class: 'pa-lab', text: 'Emb.' }), pkg,
            el('button', { class: 'pa-btn pa-primary', 'data-testid': 'prod-create', onclick: add }, 'Criar produto'),
          ]),
          el('p', { class: 'pa-hint', text: 'Porção = fração de uma receita (0,5 = meia) ou múltiplo (6 = caixa de 6).' }),
        ]),
  ]);
}

// ── Preços (the payoff) ─────────────────────────────────────────────────────────

function precosPanel(ctx) {
  const { store } = ctx;
  const config = store.getConfig();
  const es = store.toEngineStore();
  const lens = estimateLens(config);

  const cards = store.state.products.map((p) => {
    try {
      const b = costBreakdown(es, p.recipeId, config, lens);
      const parts = [
        ['Ingredientes', b.ingredients * p.portion],
        ['Mão de obra', b.labor * p.portion],
        ['Gás (forno)', b.gas * p.portion],
        ['Custos fixos', b.fixed * p.portion],
        ['Embalagem', p.packagingCost],
      ];
      const unitCost = parts.reduce((s, [, v]) => s + v, 0);
      const price = priceFromCost(unitCost, config);
      return el('div', { class: 'pa-sub-card' }, [
        el('div', { class: 'pa-row' }, [
          el('strong', { class: 'pa-grow', text: p.name }),
          el('span', { class: 'pa-price', text: brl(price) }),
        ]),
        el('table', { class: 'pa-kv' }, parts.map(([label, v]) =>
          el('tr', {}, [el('td', { text: label }), el('td', { class: 'pa-num', text: brl(v) })]))
          .concat([
            el('tr', { class: 'pa-kv-total' }, [el('td', { text: 'Custo unitário' }), el('td', { class: 'pa-num', text: brl(unitCost) })]),
            el('tr', {}, [el('td', { text: `Preço sugerido (margem ${pct(config.targetMarginPct)}%, taxa ${pct(config.paymentFeePct)}%)` }), el('td', { class: 'pa-num pa-strong', text: brl(price) })]),
          ])),
      ]);
    } catch (e) {
      return el('div', { class: 'pa-sub-card' }, [
        el('div', { class: 'pa-row' }, [el('strong', { class: 'pa-grow', text: p.name }), el('span', { class: 'pa-badge', text: 'incompleto' })]),
        el('p', { class: 'pa-status', text: friendlyError(e) }),
      ]);
    }
  });

  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Preços' }),
    store.state.products.length === 0
      ? el('p', { class: 'pa-empty', text: 'Crie produtos para ver custos e preços sugeridos.' })
      : el('div', {}, cards),
  ]);
}

function friendlyError(e) {
  if (e instanceof PriceError) return 'Defina o preço de todos os insumos usados nesta receita.';
  if (e instanceof CycleError) return 'Há um ciclo nas receitas (uma receita contém a si mesma).';
  if (e instanceof YieldError) return 'Rendimento inválido — verifique a receita.';
  if (e instanceof MarkupError) return 'Margem + taxa somam 100% ou mais — ajuste em Ajustes.';
  if (e instanceof RefError) return 'A receita deste produto não foi encontrada.';
  return String(e && e.message ? e.message : e);
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
    dropboxPanel(ctx),
  ]);
}

function dropboxPanel(ctx) {
  const { linked, busy, status } = ctx.view;
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
    el('p', { class: 'pa-hint', text: 'Seus dados ficam no aparelho. O Dropbox é backup e sincronização entre aparelhos.' }),
  ]);
}
