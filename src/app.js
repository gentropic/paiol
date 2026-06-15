// paiol — application boot & wiring. Composes the tested pieces (store, persistence, sync, auth)
// behind the UI. Local-first: IndexedDB is the source of truth; Dropbox is opt-in sync on top.

import { VFS } from '../vendor/@gcu/vfs/index.js';
import { loadStore, createDebouncedSaver } from './persist.js';
import { syncOnce, openDropboxVfs } from './sync.js';
import { handleRedirectIfPresent, startDropboxLink, dropboxTokenManager, isLinked, forgetToken } from './auth-flow.js';
import { renderApp, renderModal } from './ui.js';
import { setupPwa } from './pwa.js';
import { importYaml } from './exchange.js';
import { LOCAL_DB_NAME, REMOTE_BUSINESS_PATH } from './config.js';

export async function boot(root) {
  // UI-level state (not part of the business; lives only for this session).
  const view = { tab: 'inicio', linked: false, busy: false, status: null, reportMonth: null, logMonth: null, modal: null, updateReady: false };

  // 1. Complete an OAuth redirect if we just came back from Dropbox.
  const redirect = await handleRedirectIfPresent();
  if (redirect.error) { view.status = `Falha ao conectar: ${redirect.error}`; view.tab = 'ajustes'; }
  view.linked = redirect.linked || (await isLinked());
  if (redirect.linked) view.tab = 'ajustes';

  // 2. Local store over IndexedDB.
  const localVfs = await VFS.create({ type: 'idb', name: LOCAL_DB_NAME });
  const store = await loadStore(localVfs);
  const saver = createDebouncedSaver(localVfs, () => store);

  const ctx = { store, view, actions: {} };
  const rerender = () => renderApp(root, ctx);
  const rerenderModal = () => renderModal(root, ctx); // overlay-only; leaves the panel DOM in place

  // PWA: install the service worker (no-op in local dev). When a newer shell is cached in the
  // background, surface a one-tap "atualizar" banner instead of reloading under her.
  const sw = setupPwa(() => { view.updateReady = true; rerender(); });

  // If we linked on this load, pull immediately so the device starts in sync.
  if (redirect.linked) void doSync(true);

  ctx.actions = {
    setTab(tab) { view.tab = tab; view.status = null; view.modal = null; view.logMonth = null; rerender(); },
    setReportMonth(month) { view.reportMonth = month; rerender(); },
    setLogMonth(month) { view.logMonth = month; rerender(); },
    // Modal/bottom-sheet (add/edit forms, confirmations).
    openModal(modal) { view.modal = modal; rerenderModal(); },
    closeModal() { view.modal = null; rerenderModal(); },
    // Generic business mutation: run fn(store), persist (debounced), re-render. Closes any sheet.
    mutate(fn) { fn(store); view.modal = null; saver.schedule(); rerender(); },
    setConfig(partial) { store.setConfig(partial); saver.schedule(); view.status = 'Ajustes salvos.'; rerender(); },
    importData(text) {
      const r = importYaml(store, text);
      saver.schedule();
      const parts = [`${r.insumos} insumo(s)`, `${r.receitas} receita(s)`, `${r.produtos} produto(s)`];
      if (r.vendas) parts.push(`${r.vendas} venda(s)`);
      if (r.fornadas) parts.push(`${r.fornadas} fornada(s)`);
      const avisos = r.warnings.length ? ` · ${r.warnings.length} aviso(s)` : '';
      view.status = `Importado: ${parts.join(', ')}${avisos}.`;
      rerender();
      return r;
    },
    importFailed(msg) { view.status = `Falha ao importar: ${msg}`; rerender(); },
    applyUpdate() { if (sw) sw.applyUpdate(); }, // coordinated reload of all tabs onto the new shell
    connect: () => startDropboxLink(),       // navigates away; nothing after resolves
    disconnect() {
      forgetToken();
      view.linked = false;
      view.status = 'Dropbox desconectado deste aparelho.';
      rerender();
    },
    sync: () => doSync(false),
  };

  async function doSync(silent) {
    if (view.busy) return;
    view.busy = true;
    if (!silent) view.status = null;
    rerender();
    try {
      const mgr = dropboxTokenManager();
      const remoteVfs = await openDropboxVfs(() => mgr.getToken());
      const r = await syncOnce(store, remoteVfs, { path: REMOTE_BUSINESS_PATH, snapshotLabel: snapshotMonthLabel() });
      await saver.flushNow(); // persist the merged result locally
      view.status = r.pushed || r.pulledEvents
        ? `Sincronizado — ${r.pulledEvents} novo(s) do Dropbox${r.pushed ? ', enviado' : ''}.`
        : 'Já estava sincronizado.';
    } catch (e) {
      view.status = `Erro ao sincronizar: ${String(e.message || e)}`;
    } finally {
      view.busy = false;
      rerender();
    }
  }

  rerender();
}

// e.g. "2026-06" — month-granular snapshot label.
function snapshotMonthLabel() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
