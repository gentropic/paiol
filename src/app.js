// paiol — application boot & wiring. Composes the tested pieces (store, persistence, sync, auth)
// behind the UI. Local-first: IndexedDB is the source of truth; Dropbox is opt-in sync on top.

import { VFS } from '../vendor/@gcu/vfs/index.js';
import { loadStore, createDebouncedSaver } from './persist.js';
import { syncOnce, openDropboxVfs } from './sync.js';
import { handleRedirectIfPresent, startDropboxLink, dropboxTokenManager, isLinked, forgetToken } from './auth-flow.js';
import { renderApp } from './ui.js';
import { LOCAL_DB_NAME, REMOTE_BUSINESS_PATH } from './config.js';

export async function boot(root) {
  // UI-level state (not part of the business; lives only for this session).
  const view = { linked: false, busy: false, status: null };

  // 1. Complete an OAuth redirect if we just came back from Dropbox.
  const redirect = await handleRedirectIfPresent();
  if (redirect.error) view.status = `Falha ao conectar: ${redirect.error}`;
  view.linked = redirect.linked || (await isLinked());

  // 2. Local store over IndexedDB.
  const localVfs = await VFS.create({ type: 'idb', name: LOCAL_DB_NAME });
  const store = await loadStore(localVfs);
  const saver = createDebouncedSaver(localVfs, () => store);

  const ctx = { store, get linked() { return view.linked; }, get busy() { return view.busy; }, get status() { return view.status; }, actions: {} };
  const rerender = () => renderApp(root, ctx);

  // If we linked on this load, pull immediately so the device starts in sync.
  if (redirect.linked) void doSync(true);

  ctx.actions = {
    connect: () => startDropboxLink(),       // navigates away; nothing after resolves
    disconnect() {
      forgetToken();
      view.linked = false;
      view.status = 'Dropbox desconectado deste aparelho.';
      rerender();
    },
    sync: () => doSync(false),
    addIngredient({ name, stockUnit }) {
      store.upsertIngredient({ id: crypto.randomUUID(), name, stockUnit });
      saver.schedule();
      rerender();
    },
    removeIngredient(id) {
      store.removeIngredient(id);
      saver.schedule();
      rerender();
    },
  };

  async function doSync(silent) {
    if (view.busy) return;
    view.busy = true;
    if (!silent) view.status = null;
    rerender();
    try {
      const mgr = dropboxTokenManager();
      const remoteVfs = await openDropboxVfs(() => mgr.getToken());
      const r = await syncOnce(store, remoteVfs, { path: REMOTE_BUSINESS_PATH, snapshotLabel: monthLabel() });
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
function monthLabel() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
