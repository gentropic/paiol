// paiol — application boot & wiring. Composes the tested pieces (store, persistence, sync, auth)
// behind the UI. Local-first: IndexedDB is the source of truth; Dropbox is opt-in sync on top.

import { VFS } from '../vendor/@gcu/vfs/index.js';
import { loadStore, createDebouncedSaver, snapshotStore } from './persist.js';
import { createSyncController, openDropboxVfs } from './sync.js';
import { handleRedirectIfPresent, startDropboxLink, dropboxTokenManager, isLinked, forgetToken } from './auth-flow.js';
import { renderApp, renderModal } from './ui.js';
import { setupPwa } from './pwa.js';
import { importYaml, applyExchange } from './exchange.js';
import { DEFAULT_CATEGORIES } from './store.js';
import { ensureFinanceFoundation } from './finance.js';
import { LOCAL_DB_NAME, REMOTE_BUSINESS_PATH } from './config.js';

export async function boot(root) {
  // UI-level state (not part of the business; lives only for this session).
  const today = new Date();
  const initialEnd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const initialStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const initialMonthEnd = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`;
  const view = {
    tab: 'inicio', linked: false, busy: false, status: null, reportMonth: null, prodSort: 'lucro',
    logMonth: null, financeMonth: null, financeType: 'todos', comandaDate: null, encSort: 'entrega', encStatus: 'todas',
    encStart: '', encEnd: '', encClientId: '', encProductId: '', encDeliveryMethod: '',
    vendaStart: initialStart, vendaEnd: initialEnd, vendaStatus: 'todos', vendaProductId: '', vendaClientId: '',
    dashboardPreset: 'mes', dashboardStart: initialStart, dashboardEnd: initialMonthEnd,
    fiadoStart: initialStart, fiadoEnd: initialEnd, fiadoStatus: 'aberto',
    finStart: initialStart, finEnd: initialMonthEnd, finStatus: 'aberto', finProjected: true,
    finDirection: 'receber', finAccountId: '', finCategoryId: '', finFlowPreset: 'mes',
    finPartyId: '', finMethod: '', finTitleCategory: '',
    modal: null, updateReady: false, lastSyncAt: null, syncError: null, backupBusy: false, lastBackupAt: null,
  };

  // 1. Complete an OAuth redirect if we just came back from Dropbox.
  const redirect = await handleRedirectIfPresent();
  if (redirect.error) { view.status = `Falha ao conectar: ${redirect.error}`; view.tab = 'ajustes'; }
  view.linked = redirect.linked || (await isLinked());
  if (redirect.linked) view.tab = 'ajustes';

  // 2. Local store over IndexedDB.
  const localVfs = await VFS.create({ type: 'idb', name: LOCAL_DB_NAME });
  const store = await loadStore(localVfs);
  const saver = createDebouncedSaver(localVfs, () => store);

  // Seed financial categories on first run (Rev 06) so the Despesas picker is never empty. Only when
  // none exist — once seeded (or if she's reshaped them) this never re-runs and overwrites nothing.
  if (store.state.categories.length === 0) {
    for (const c of DEFAULT_CATEGORIES) store.upsertCategory({ id: crypto.randomUUID(), ...c });
    saver.schedule();
  }
  // Forward-compatible financial groups for stores created before the Financeiro module.
  if (!store.state.categories.some((c) => c.kind === 'receita')) {
    store.upsertCategory({ id: crypto.randomUUID(), name: 'Outras receitas', kind: 'receita' });
    saver.schedule();
  }
  if (!store.state.categories.some((c) => c.kind === 'custo')) {
    store.upsertCategory({ id: crypto.randomUUID(), name: 'Custos de produção', kind: 'custo' });
    saver.schedule();
  }
  if (ensureFinanceFoundation(store) > 0) saver.schedule();
  if (store.purgeExpiredTrash(new Date().toISOString()) > 0) saver.schedule();

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
  const maintainStore = () => { store.purgeExpiredTrash(new Date().toISOString()); ensureFinanceFoundation(store); };
  autoSync();

  // Page-hide is the last reliable moment on mobile: flush local FIRST (so a change made seconds
  // before backgrounding survives even if the tab is killed), then attempt a remote push.
  const onHide = () => { void saver.flushNow(); sync.cancel(); autoSync(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onHide(); });
  window.addEventListener('pagehide', onHide);
  window.addEventListener('online', autoSync);

  ctx.actions = {
    setTab(tab) { view.tab = tab; view.status = null; view.modal = null; view.logMonth = null; rerender(); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' })); },
    setReportMonth(month) { view.reportMonth = month; rerender(); },
    setProdSort(key) { view.prodSort = key; rerender(); },
    setEncSort(key) { view.encSort = key; rerender(); },
    setEncStatus(key) { view.encStatus = key; rerender(); },
    setEncPeriod(partial) { Object.assign(view, partial); rerender(); },
    setVendaPeriod(partial) { Object.assign(view, partial); rerender(); },
    setFiadoPeriod(partial) { Object.assign(view, partial); rerender(); },
    setFinanceMonth(month) { view.financeMonth = month; rerender(); },
    setFinanceType(type) { view.financeType = type; rerender(); },
    setFinanceView(partial) { Object.assign(view, partial); rerender(); },
    setDashboardView(partial) { Object.assign(view, partial); rerender(); },
    setLogMonth(month) { view.logMonth = month; rerender(); },
    setComandaDate(date) { view.comandaDate = date; rerender(); },
    // Modal/bottom-sheet (add/edit forms, confirmations).
    openModal(modal) { view.modal = modal; rerenderModal(); },
    closeModal() { view.modal = null; rerenderModal(); },
    // Generic business mutation: run fn(store), persist locally (debounced) + sync (debounced), re-render.
    mutate(fn) { fn(store); maintainStore(); view.modal = null; saver.schedule(); scheduleSync(); rerender(); },
    // Mutate but KEEP the modal open, re-rendering only the overlay — for in-place CRUD inside a
    // sheet (managing categorias) where each add/archive/delete should update the list, not close it.
    mutateModal(fn) { fn(store); maintainStore(); saver.schedule(); scheduleSync(); rerenderModal(); },
    // Like mutate but WITHOUT a re-render — for in-place edits (the comanda's realizado/feito inputs)
    // that update their own DOM, so the panel must not rebuild under them (keeps input focus).
    persist(fn) { fn(store); maintainStore(); saver.schedule(); scheduleSync(); },
    restoreTrash(itemId) {
      const item = store.get('trashItems', itemId);
      const label = item && (item.label || item.recordId);
      const restored = store.restoreTrash(itemId, new Date().toISOString());
      maintainStore();
      if (restored) {
        saver.schedule(); scheduleSync();
        view.status = `${label || 'Registro'} restaurado com sucesso.`;
      } else view.status = 'Este registro não está mais disponível para restauração.';
      rerender();
    },
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
    // Apply already-parsed interchange (the xlsx import, after the preview-confirm). Closes the modal.
    importParsed(data) {
      const r = applyExchange(store, data);
      view.modal = null;
      saver.schedule();
      scheduleSync();
      const parts = [`${r.insumos} insumo(s)`, `${r.receitas} receita(s)`, `${r.produtos} produto(s)`];
      const avisos = r.warnings.length ? ` · ${r.warnings.length} aviso(s)` : '';
      view.status = `Planilha importada: ${parts.join(', ')}${avisos}.`;
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
    async backupExtra() {
      if (view.backupBusy) return;
      view.backupBusy = true; view.status = null; rerender();
      try {
        maintainStore();
        saver.schedule();
        await saver.flushNow();
        if (view.linked) {
          const remote = await openDropboxVfs(() => dropboxTokenManager().getToken());
          const dir = REMOTE_BUSINESS_PATH.slice(0, REMOTE_BUSINESS_PATH.lastIndexOf('/'));
          await snapshotStore(remote, store, manualBackupLabel(), `${dir}/snapshots`);
          view.lastBackupAt = new Date().toISOString();
          view.status = 'Backup extra baixado e também salvo no Dropbox.';
        } else {
          view.lastBackupAt = new Date().toISOString();
          view.status = 'Backup extra baixado neste aparelho. Conecte o Dropbox para guardar uma segunda cópia na nuvem.';
        }
      } catch (e) {
        view.status = `O arquivo foi baixado, mas não foi possível criar a cópia no Dropbox: ${String((e && e.message) || e)}.`;
      } finally {
        view.backupBusy = false; rerender();
      }
    },
  };

  rerender();
}

// e.g. "2026-06" — month-granular snapshot label.
function snapshotMonthLabel() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function manualBackupLabel() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  return `manual-${date}-${time}`;
}
