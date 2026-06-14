// paiol — UI (PT-BR surface). Vanilla DOM, no framework. English identifiers in code, every
// label Nayara sees in Portuguese. This is the v0.1 shell: the Dropbox panel + the first real
// screen (Insumos). Recipes/products/sales screens layer on from here.

const STOCK_UNITS = ['g', 'kg', 'ml', 'l', 'un'];

/** Tiny hyperscript helper. */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/**
 * Render the whole app into `root` from `ctx`. Idempotent: call again to re-render.
 * @param {HTMLElement} root
 * @param {{ store: import('./store.js').PaiolStore, linked: boolean, busy: boolean, status: ?string,
 *           actions: { connect: Function, disconnect: Function, sync: Function, addIngredient: Function, removeIngredient: Function } }} ctx
 */
export function renderApp(root, ctx) {
  root.replaceChildren(
    el('header', { class: 'pa-header' }, [
      el('h1', { text: 'Quitutes do Paiol' }),
      el('p', { class: 'pa-sub', text: 'Custos, receitas e vendas' }),
    ]),
    dropboxPanel(ctx),
    insumosPanel(ctx),
  );
}

function dropboxPanel(ctx) {
  const { linked, busy, status } = ctx;
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
  ]);
}

function insumosPanel(ctx) {
  const ingredients = ctx.store.state.ingredients;
  const nameInput = el('input', { class: 'pa-input', type: 'text', placeholder: 'Nome do insumo (ex.: Farinha de trigo)' });
  const unitSelect = el('select', { class: 'pa-input' }, STOCK_UNITS.map((u) => el('option', { value: u, text: u })));

  function submit() {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    ctx.actions.addIngredient({ name, stockUnit: unitSelect.value });
    nameInput.value = '';
  }

  return el('section', { class: 'pa-card' }, [
    el('h2', { text: 'Insumos' }),
    ingredients.length === 0
      ? el('p', { class: 'pa-empty', text: 'Nenhum insumo ainda. Adicione o primeiro abaixo.' })
      : el('ul', { class: 'pa-list' }, ingredients.map((ing) =>
          el('li', { class: 'pa-list-item' }, [
            el('span', {}, [el('strong', { text: ing.name }), ` — ${ing.stockUnit}`]),
            el('button', { class: 'pa-btn pa-ghost pa-sm', title: 'Remover', onclick: () => ctx.actions.removeIngredient(ing.id) }, '✕'),
          ]))),
    el('div', { class: 'pa-row pa-form' }, [
      nameInput,
      unitSelect,
      el('button', { class: 'pa-btn pa-primary', onclick: submit }, 'Adicionar'),
    ]),
  ]);
}
