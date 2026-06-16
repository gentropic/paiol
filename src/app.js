// paiol — application boot & wiring. Composes the tested pieces (store, persistence, sync, auth)
// behind the UI. Local-first: IndexedDB is the source of truth; Dropbox is opt-in sync on top.

import { VFS } from '../vendor/@gcu/vfs/index.js';
import { loadStore, createDebouncedSaver } from './persist.js';
import { createSyncController, openDropboxVfs } from './sync.js';
import { handleRedirectIfPresent, startDropboxLink, dropboxTokenManager, isLinked, forgetToken } from './auth-flow.js';
import { renderApp, renderModal } from './ui.js';
import { setupPwa } from './pwa.js';
import { importYaml } from './exchange.js';
import { LOCAL_DB_NAME, REMOTE_BUSINESS_PATH } from './config.js';

export async function boot(root) {
  // UI-level state (not part of the business; lives only for this session).
  const view = { tab: 'inicio', linked: false, busy: false, status: null, reportMonth: null, logMonth: null, modal: null, updateReady: false, lastSyncAt: null, syncError: null };

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

  // Automatic, safe Dropbox sync (data-loss avoidance): pull on boot, debounce-push after changes,
  // flush on hide, retry when back online. Every run reconciles through syncOnce (merge, snapshot).
  const sync = createSyncController({
    getStore: () => store,
    flushLocal: () => saver.flushNow(),
    openRemote: () => openDropboxVfs(() => dropboxTokenManager().getToken()),
    snapshotLabel: snapshotMonthLabel,
    opts: { path: REMOTE_BUSINESS_PATH },
    onResult(res, meta) {
      if (res.ok) {
        view.lastSyncAt = new Date().toISOString();
        view.syncError = null;
        if (meta.manual) view.status = (res.pushed || res.pulledEvents) ? `Sincronizado — ${res.pulledEvents} novo(s) do Dropbox${res.pushed ? ', enviado' : ''}.` : 'Já estava sincronizado.';
        if (meta.manual || res.pulledEvents || res.pulledMaster) rerender(); // refresh if data came in
      } else {
        view.syncError = res.error;                  // surfaced quietly in Ajustes; not a nag
        if (meta.manual) { view.status = `Erro ao sincronizar: ${res.error}`; rerender(); }
      }
    },
  });
  // Pull on every boot when already linked — keeps a device fresh and shrinks the conflict window.
  const autoSync = () => { if (view.linked) void sync.runNow(); };
  const scheduleSync = () => { if (view.linked) sync.schedule(); };
  autoSync();

  // Page-hide is the last reliable moment on mobile: flush local FIRST (so a change made seconds
  // before backgrounding survives even if the tab is killed), then attempt a remote push.
  const onHide = () => { void saver.flushNow(); sync.cancel(); autoSync(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onHide(); });
  window.addEventListener('pagehide', onHide);
  window.addEventListener('online', autoSync);

  ctx.actions = {
    setTab(tab) { view.tab = tab; view.status = null; view.modal = null; view.logMonth = null; rerender(); },
    setReportMonth(month) { view.reportMonth = month; rerender(); },
    setLogMonth(month) { view.logMonth = month; rerender(); },
    // Modal/bottom-sheet (add/edit forms, confirmations).
    openModal(modal) { view.modal = modal; rerenderModal(); },
    closeModal() { view.modal = null; rerenderModal(); },
    // Generic business mutation: run fn(store), persist locally (debounced) + sync (debounced), re-render.
    mutate(fn) { fn(store); view.modal = null; saver.schedule(); scheduleSync(); rerender(); },
    setConfig(partial) { store.setConfig(partial); saver.schedule(); scheduleSync(); view.status = 'Ajustes salvos.'; rerender(); },
    importData(text) {
      const r = importYaml(store, text);
      saver.schedule();
      scheduleSync();
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
      sync.cancel();
      forgetToken();
      view.linked = false;
      view.lastSyncAt = null;
      view.syncError = null;
      view.status = 'Dropbox desconectado deste aparelho.';
      rerender();
    },
    // Manual "Sincronizar agora": show the spinner, then let onResult fill the status.
    async sync() {
      if (sync.busy) return;
      view.busy = true; view.status = null; rerender();
      await sync.runNow({ manual: true });
      view.busy = false; rerender();
    },
  };

  rerender();
}

// e.g. "2026-06" — month-granular snapshot label.
function snapshotMonthLabel() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
