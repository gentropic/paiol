// paiol — UI (PT-BR surface). Vanilla DOM, no framework. English identifiers in code, every
// label Nayara sees in Portuguese. A tabbed shell over the tested core: Insumos, Receitas,
// Produtos, the Preços payoff view (where the cost engine surfaces), and Ajustes.
//
// renderApp rebuilds the DOM from (store, view, actions) on every change. Add-forms only mutate
// on submit, so typing is never interrupted by a re-render.

import {
  estimateLens, costBreakdown, priceFromCost, productUnitCost, productPrice,
  PriceError, CycleError, YieldError, MarkupError, RefError,
} from './cost-engine.js';
import { ConversionError } from './units.js';
import { exportYaml } from './exchange.js';

const STOCK_UNITS = ['g', 'kg', 'ml', 'l', 'un'];
// Built-in unit dimensions. A recipe component is offered only the units in its ingredient's
// (or sub-recipe's) own dimension, defaulting to that unit — so eggs bought in `un` are used in
// `un` (no weighing), while flour bought in `kg` can still be used in `g` (same dimension).
const UNIT_GROUPS = [['g', 'kg'], ['ml', 'l'], ['un']];
function unitsInDimension(u) {
  const group = UNIT_GROUPS.find((g) => g.includes(u)) || [u];
  return [u, ...group.filter((x) => x !== u)]; // natural unit first = the default selection
}
const TABS = [
  ['insumos', 'Insumos'], ['receitas', 'Receitas'], ['produtos', 'Produtos'],
  ['precos', 'Preços'], ['fornadas', 'Fornadas'], ['vendas', 'Vendas'], ['ajustes', 'Ajustes'],
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
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; } };
/** Parse a number that may use a comma decimal; '' / invalid → null. */
function parseNum(s) {
  if (s == null) return null;
  const n = Number(String(s).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const todayInput = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

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

const isEditing = (ctx, kind, id) => !!ctx.view.editing && ctx.view.editing.kind === kind && ctx.view.editing.id === id;

/** Confirm before a destructive mutation (avoids misclick deletes). */
function confirmRemove(ctx, label, fn) {
  if (typeof confirm === 'function' && !confirm(`Remover ${label}?`)) return;
  ctx.actions.mutate(fn);
}

// ── Shell ───────────────────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} root
 * @param {{ store: import('./store.js').PaiolStore, view: { tab: string, busy: boolean, status: ?string, linked: boolean }, actions: object }} ctx
 */
export function renderApp(root, ctx) {
  const panels = {
    insumos: insumosPanel, receitas: receitasPanel, produtos: produtosPanel,
    precos: precosPanel, fornadas: fornadasPanel, vendas: vendasPanel, ajustes: ajustesPanel,
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

  const semPreco = store.state.ingredients.filter((i) => store.currentPrice(i.id) == null).length;
  const list = el('ul', { class: 'pa-list' }, store.state.ingredients.map((ing) => insumoRow(ctx, ing)));
  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Insumos' }),
    semPreco > 0 && el('p', { class: 'pa-status pa-bad' },
      [el('strong', { text: `${semPreco} insumo(s) sem preço` }), ' — produtos que os usam ficam sem preço até você preencher.']),
    store.state.ingredients.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhum insumo ainda. Adicione o primeiro abaixo.' })
      : el('div', {}, [searchInput('Buscar insumo…', list, 'ins-search'), list]),
    el('h3', { class: 'pa-h3', text: 'Novo insumo' }),
    el('div', { class: 'pa-row pa-form' }, [
      nameInput, unitSelect, priceInput,
      el('button', { class: 'pa-btn pa-primary', 'data-testid': 'ins-add', onclick: add }, 'Adicionar'),
    ]),
    el('p', { class: 'pa-hint', text: 'O preço é por unidade de compra (ex.: por kg). Atualize quando o preço mudar — o histórico é preservado.' }),
  ]);
}

function insumoRow(ctx, ing) {
  const { store } = ctx;
  if (isEditing(ctx, 'ingredient', ing.id)) return insumoEditRow(ctx, ing);

  const price = store.currentPrice(ing.id);
  const lastAt = store.lastPriceAt(ing.id);
  const priceInput = el('input', { class: 'pa-input pa-narrow', type: 'text', inputmode: 'decimal',
    placeholder: 'novo preço', value: price != null ? String(price).replace('.', ',') : '' });
  function updatePrice() {
    const p = parseNum(priceInput.value);
    if (p == null) return;
    ctx.actions.mutate((s) => s.addPriceChange({ id: uuid(), at: nowIso(), ingredientId: ing.id, price: p }));
  }

  const history = store.priceHistory(ing.id);
  return el('li', { class: 'pa-list-item pa-stack', 'data-search': ing.name }, [
    el('div', { class: 'pa-row' }, [
      el('div', { class: 'pa-grow' }, [
        el('strong', { text: ing.name }),
        price != null
          ? el('span', { class: 'pa-muted', text: `  ${ing.stockUnit} · ${brl(price)}/${ing.stockUnit}` + (lastAt ? ` · atualizado ${fmtDate(lastAt)}` : '') })
          : el('span', {}, [el('span', { class: 'pa-muted', text: `  ${ing.stockUnit} · ` }), el('span', { class: 'pa-badge pa-bad', text: 'sem preço' })]),
        history.length > 1 && el('details', { class: 'pa-history' }, [
          el('summary', { text: `histórico (${history.length})` }),
          el('ul', { class: 'pa-list pa-tight' }, history.map((h) =>
            el('li', { class: 'pa-list-item' }, [el('span', { class: 'pa-muted', text: `${fmtDate(h.at)} — ${brl(h.price)}` })]))),
        ]),
      ]),
      priceInput,
      el('button', { class: 'pa-btn pa-sm', onclick: updatePrice }, 'Atualizar'),
      el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Editar', onclick: () => ctx.actions.startEdit('ingredient', ing.id) }, '✎'),
      el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Remover', onclick: () => confirmRemove(ctx, `o insumo "${ing.name}"`, (s) => s.removeIngredient(ing.id)) }, '✕'),
    ]),
  ]);
}

function insumoEditRow(ctx, ing) {
  const name = el('input', { class: 'pa-input', 'data-testid': 'ins-edit-name', type: 'text', value: ing.name });
  const unit = el('select', { class: 'pa-input', 'data-testid': 'ins-edit-unit' },
    STOCK_UNITS.map((u) => el('option', { value: u, text: u, ...(u === ing.stockUnit ? { selected: 'selected' } : {}) })));
  function save() {
    const nm = name.value.trim();
    if (!nm) { name.focus(); return; }
    ctx.actions.mutate((s) => s.upsertIngredient({ ...ing, name: nm, stockUnit: unit.value }));
  }
  return el('li', { class: 'pa-list-item pa-editing' }, [
    el('div', { class: 'pa-row pa-form pa-grow' }, [
      name, unit,
      el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'ins-edit-save', onclick: save }, 'Salvar'),
      el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => ctx.actions.cancelEdit() }, 'Cancelar'),
    ]),
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

  const cards = el('div', {}, store.state.recipes.map((r) => receitaCard(ctx, r)));
  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Receitas' }),
    store.state.recipes.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhuma receita ainda.' })
      : el('div', {}, [searchInput('Buscar receita…', cards, 'rec-search'), cards]),
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
  if (isEditing(ctx, 'recipe', recipe.id)) return receitaEditCard(ctx, recipe);
  // Component editor.
  const options = [
    ...store.state.ingredients.map((i) => ({ kind: 'ingredient', id: i.id, label: `Insumo: ${i.name}`, unit: i.stockUnit })),
    ...store.state.recipes.filter((r) => r.id !== recipe.id).map((r) => ({ kind: 'recipe', id: r.id, label: `Receita: ${r.name}`, unit: r.yieldUnit })),
  ];
  const refSel = el('select', { class: 'pa-input', 'data-testid': 'rec-compref' }, options.map((o, i) => el('option', { value: String(i), text: o.label })));
  const qty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-compqty', type: 'text', inputmode: 'decimal', placeholder: 'qtd' });
  const unit = el('select', { class: 'pa-input', 'data-testid': 'rec-compunit' });
  // Offer only units in the selected item's dimension; re-fill when the item changes.
  function fillUnits() {
    const o = options[Number(refSel.value)] || options[0];
    unit.replaceChildren(...unitsInDimension(o ? o.unit : 'un').map((u) => el('option', { value: u, text: u })));
  }
  fillUnits();
  refSel.addEventListener('change', fillUnits);

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

  return el('div', { class: 'pa-sub-card', 'data-search': recipe.name }, [
    el('div', { class: 'pa-row' }, [
      el('strong', { class: 'pa-grow', text: recipe.name }),
      el('span', { class: 'pa-muted', text: `${recipe.yieldNominal} ${recipe.yieldUnit} · ${recipe.activeMinutes}min ativos · ${recipe.ovenMinutes}min forno` }),
      el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Editar receita', 'data-testid': 'rec-edit', onclick: () => ctx.actions.startEdit('recipe', recipe.id) }, '✎'),
    ]),
    recipe.notes && el('p', { class: 'pa-obs', text: recipe.notes }),
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
    el('div', { class: 'pa-row pa-cardfoot' }, [
      el('button', { class: 'pa-btn pa-ghost pa-sm pa-bad', title: 'Remover receita',
        onclick: () => confirmRemove(ctx, `a receita "${recipe.name}"`, (s) => s.removeRecipe(recipe.id)) }, '🗑 Remover receita'),
    ]),
  ]);
}

function receitaEditCard(ctx, recipe) {
  const name = el('input', { class: 'pa-input', 'data-testid': 'rec-edit-name', type: 'text', value: recipe.name });
  const yQty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-edit-yield', type: 'text', inputmode: 'decimal', value: String(recipe.yieldNominal).replace('.', ',') });
  const yUnit = el('select', { class: 'pa-input', 'data-testid': 'rec-edit-yunit' },
    STOCK_UNITS.map((u) => el('option', { value: u, text: u, ...(u === recipe.yieldUnit ? { selected: 'selected' } : {}) })));
  const active = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-edit-active', type: 'text', inputmode: 'numeric', value: String(recipe.activeMinutes) });
  const oven = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'rec-edit-oven', type: 'text', inputmode: 'numeric', value: String(recipe.ovenMinutes) });
  const notes = el('textarea', { class: 'pa-input pa-textarea', 'data-testid': 'rec-edit-notes', rows: '3', placeholder: 'Observação / modo de preparo (opcional)' });
  notes.value = recipe.notes || '';

  function save() {
    const nm = name.value.trim();
    const y = parseNum(yQty.value);
    if (!nm || !(y > 0)) { name.focus(); return; }
    const obs = notes.value.trim();
    ctx.actions.mutate((s) => s.upsertRecipe({
      ...recipe, name: nm, yieldNominal: y, yieldUnit: yUnit.value,
      activeMinutes: parseNum(active.value) || 0, ovenMinutes: parseNum(oven.value) || 0,
      ...(obs ? { notes: obs } : { notes: undefined }),
    }));
  }
  return el('div', { class: 'pa-sub-card pa-editing' }, [
    el('div', { class: 'pa-row pa-form' }, [name]),
    el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Rende' }), yQty, yUnit]),
    el('div', { class: 'pa-row pa-form' }, [
      el('span', { class: 'pa-lab', text: 'min ativos' }), active,
      el('span', { class: 'pa-lab', text: 'min forno' }), oven,
    ]),
    el('div', { class: 'pa-field' }, [el('label', { text: 'Observação (modo de preparo)' }), notes]),
    el('div', { class: 'pa-row pa-form' }, [
      el('button', { class: 'pa-btn pa-primary pa-sm', 'data-testid': 'rec-edit-save', onclick: save }, 'Salvar'),
      el('button', { class: 'pa-btn pa-ghost pa-sm', onclick: () => ctx.actions.cancelEdit() }, 'Cancelar'),
    ]),
  ]);
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

  const list = el('ul', { class: 'pa-list' }, store.state.products.map((p) =>
    el('li', { class: 'pa-list-item', 'data-search': p.name }, [
      el('div', { class: 'pa-grow' }, [
        el('strong', { text: p.name }),
        el('span', { class: 'pa-muted', text: `  ${refName(store, { kind: 'recipe', id: p.recipeId })} · porção ${p.portion} · emb. ${brl(p.packagingCost)}` }),
      ]),
      el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Remover', onclick: () => confirmRemove(ctx, `o produto "${p.name}"`, (s) => s.removeProduct(p.id)) }, '✕'),
    ])));
  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Produtos' }),
    store.state.products.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhum produto ainda.' })
      : el('div', {}, [searchInput('Buscar produto…', list, 'prod-search'), list]),
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
    // Most common "incomplete" cause: a used ingredient has no price. Name them explicitly.
    const missing = unpricedInRecipe(store, p.recipeId);
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
      // Per-unit profit and per-hour metrics (her spreadsheet's decision numbers).
      const lucroUnit = price - unitCost - price * config.paymentFeePct;
      const activeHoursPerUnit = config.valorHora > 0 ? (b.labor * p.portion) / config.valorHora : 0;
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
          el('tr', {}, [el('td', { text: `Preço sugerido (margem ${pct(config.targetMarginPct)}%, taxa ${pct(config.paymentFeePct)}%)` }), el('td', { class: 'pa-num pa-strong', text: brl(price) })]),
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

// ── Fornadas (Batch — production runs; actuals) ──────────────────────────────────

function fornadasPanel(ctx) {
  const { store } = ctx;
  const recipes = store.state.recipes;
  const recipeSel = el('select', { class: 'pa-input', 'data-testid': 'forn-recipe' },
    recipes.map((r) => el('option', { value: r.id, text: r.name })));
  const units = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'forn-units', type: 'text', inputmode: 'decimal', placeholder: 'un produzidas' });
  const active = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'forn-active', type: 'text', inputmode: 'numeric', placeholder: 'min ativos' });
  const oven = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'forn-oven', type: 'text', inputmode: 'numeric', placeholder: 'min forno' });
  // Prefill the times with the recipe's estimate (she adjusts only if reality differed).
  function prefill() {
    const r = store.get('recipes', recipeSel.value);
    if (r) { active.value = String(r.activeMinutes); oven.value = String(r.ovenMinutes); }
  }
  prefill();
  recipeSel.addEventListener('change', prefill);

  function register() {
    const r = store.get('recipes', recipeSel.value);
    const y = parseNum(units.value);
    if (!r || !(y > 0)) return;
    const a = parseNum(active.value);
    const o = parseNum(oven.value);
    ctx.actions.mutate((s) => s.addBatch({
      id: uuid(), at: nowIso(), recipeId: r.id, yieldActual: y,
      ...(a != null ? { activeMinutes: a } : {}), ...(o != null ? { ovenMinutes: o } : {}),
    }));
  }

  const batches = store.state.batches.slice().sort((a, b) => (a.at < b.at ? 1 : -1));
  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Fornadas' }),
    batches.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhuma fornada registrada.' })
      : el('ul', { class: 'pa-list' }, batches.map((b) => {
          const r = store.get('recipes', b.recipeId);
          return el('li', { class: 'pa-list-item' }, [
            el('div', { class: 'pa-grow' }, [
              el('strong', { text: r ? r.name : '(receita removida)' }),
              el('span', { class: 'pa-muted', text: `  ${fmtDate(b.at)} · ${b.yieldActual} produzidas`
                + (r ? ` (previsto ${r.yieldNominal})` : '') + (b.activeMinutes != null ? ` · ${b.activeMinutes}min` : '') }),
            ]),
          ]);
        })),
    recipes.length === 0
      ? el('p', { class: 'pa-hint', text: 'Crie uma receita primeiro.' })
      : el('div', {}, [
          el('h3', { class: 'pa-h3', text: 'Registrar fornada' }),
          el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Receita' }), recipeSel]),
          el('div', { class: 'pa-row pa-form' }, [
            el('span', { class: 'pa-lab', text: 'Saíram' }), units,
            el('span', { class: 'pa-lab', text: 'ativos' }), active,
            el('span', { class: 'pa-lab', text: 'forno' }), oven,
            el('button', { class: 'pa-btn pa-primary', 'data-testid': 'forn-add', onclick: register }, 'Registrar'),
          ]),
          el('p', { class: 'pa-hint', text: 'Quantas saíram de verdade (ajusta o custo real por unidade). Os minutos já vêm da receita — mude só se foi diferente.' }),
        ]),
  ]);
}

// ── Vendas (Sale — revenue, with snapshotted cost for true margin) ───────────────

function vendasPanel(ctx) {
  const { store } = ctx;
  const config = store.getConfig();
  const products = store.state.products;
  const es = store.toEngineStore();
  const lens = estimateLens(config);
  const suggested = (pid) => { try { return productPrice(es, pid, config, lens).price; } catch { return null; } };

  const prodSel = el('select', { class: 'pa-input', 'data-testid': 'venda-product' },
    products.map((p) => el('option', { value: p.id, text: p.name })));
  const dateInput = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'venda-date', type: 'date', value: todayInput() });
  const qty = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'venda-qty', type: 'text', inputmode: 'decimal', value: '1' });
  const price = el('input', { class: 'pa-input pa-narrow', 'data-testid': 'venda-price', type: 'text', inputmode: 'decimal', placeholder: 'preço' });
  const channel = el('input', { class: 'pa-input pa-narrow', type: 'text', placeholder: 'canal (opc.)' });

  const initSug = products[0] ? suggested(products[0].id) : null;
  if (initSug != null) price.value = initSug.toFixed(2).replace('.', ',');
  prodSel.addEventListener('change', () => {
    const s = suggested(prodSel.value);
    price.value = s != null ? s.toFixed(2).replace('.', ',') : '';
  });

  function register() {
    const p = store.get('products', prodSel.value);
    const q = parseNum(qty.value);
    const up = parseNum(price.value);
    if (!p || !(q > 0) || up == null) return;
    let cost = 0;
    try { cost = productUnitCost(es, p.id, config, lens); } catch { /* leave 0 if not yet priceable */ }
    const at = dateInput.value ? new Date(`${dateInput.value}T12:00:00`).toISOString() : nowIso();
    ctx.actions.mutate((s) => s.addSale({
      id: uuid(), at, productId: p.id, qty: q, unitPrice: up,
      paymentFeePct: config.paymentFeePct, costSnapshot: cost,
      ...(channel.value.trim() ? { channel: channel.value.trim() } : {}),
    }));
  }

  const sales = store.state.sales.slice().sort((a, b) => (a.at < b.at ? 1 : -1));
  let revenue = 0; let profit = 0;
  for (const s of sales) {
    const rev = s.qty * s.unitPrice;
    revenue += rev;
    profit += rev - rev * s.paymentFeePct - s.qty * s.costSnapshot;
  }

  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Vendas' }),
    sales.length > 0 && el('div', { class: 'pa-row pa-totals' }, [
      el('span', { class: 'pa-grow' }, [el('strong', { text: 'Receita ' }), brl(revenue)]),
      el('span', { class: profit >= 0 ? 'pa-badge pa-ok' : 'pa-badge pa-bad', text: `lucro ${brl(profit)}` }),
    ]),
    sales.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhuma venda registrada.' })
      : el('ul', { class: 'pa-list' }, sales.map((s) => saleRow(store, s))),
    products.length === 0
      ? el('p', { class: 'pa-hint', text: 'Crie um produto primeiro.' })
      : el('div', {}, [
          el('h3', { class: 'pa-h3', text: 'Registrar venda' }),
          el('div', { class: 'pa-row pa-form' }, [el('span', { class: 'pa-lab', text: 'Produto' }), prodSel]),
          el('div', { class: 'pa-row pa-form' }, [
            el('span', { class: 'pa-lab', text: 'Data' }), dateInput,
            el('span', { class: 'pa-lab', text: 'Qtd' }), qty,
            el('span', { class: 'pa-lab', text: 'Preço' }), price, channel,
            el('button', { class: 'pa-btn pa-primary', 'data-testid': 'venda-add', onclick: register }, 'Registrar'),
          ]),
          el('p', { class: 'pa-hint', text: 'O preço sugerido já vem preenchido — edite se vendeu por outro valor. O custo é congelado na venda para a margem ficar verdadeira.' }),
        ]),
  ]);
}

function saleRow(store, s) {
  const p = store.get('products', s.productId);
  const rev = s.qty * s.unitPrice;
  const prof = rev - rev * s.paymentFeePct - s.qty * s.costSnapshot;
  return el('li', { class: 'pa-list-item' }, [
    el('div', { class: 'pa-grow' }, [
      el('strong', { text: p ? p.name : '(produto removido)' }),
      el('span', { class: 'pa-muted', text: `  ${fmtDate(s.at)} · ${s.qty} × ${brl(s.unitPrice)}${s.channel ? ` · ${s.channel}` : ''}` }),
    ]),
    el('span', { class: prof >= 0 ? 'pa-num' : 'pa-num pa-bad', text: brl(prof) }),
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
    dadosCard(ctx),
    dropboxPanel(ctx),
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
  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Dados' }),
    el('div', { class: 'pa-row' }, [
      el('button', { class: 'pa-btn', 'data-testid': 'export-btn', onclick: () => downloadFile('paiol-dados.yaml', exportYaml(ctx.store)) }, 'Exportar dados'),
      el('button', { class: 'pa-btn', 'data-testid': 'import-btn', onclick: () => fileInput.click() }, 'Importar dados'),
      fileInput,
    ]),
    el('p', { class: 'pa-hint', text: 'Exporta/importa insumos, receitas e produtos (formato YAML). A importação mescla pelos nomes, sem apagar o que já existe.' }),
  ]);
}

function downloadFile(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/yaml' }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
