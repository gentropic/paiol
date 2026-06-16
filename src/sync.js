// paiol — sync engine (§5). Backend-agnostic: it reconciles the local store against a remote
// YAML file over a VFS. The remote is a DropboxBackend in production, but the engine neither
// knows nor cares — any VFS works, which is why it's testable against a MemoryBackend.
//
// Convergence rests on the append-only log (§2.2): pull the remote, union-by-id into local,
// push the union back. Two devices that both append merge cleanly — there is no field-level
// conflict to resolve, only set union. (A true concurrent-write race is still possible in the
// window between read and write; the dated snapshots are the backstop, and v0.1 is single-user.)

import { PaiolStore } from './store.js';
import { saveStore, snapshotStore, DEFAULT_PATH } from './persist.js';
import { VFS, DropboxBackend } from '../vendor/@gcu/vfs/index.js';

/**
 * Reconcile `localStore` with the remote file at `path` on `vfs`. Mutates `localStore` to the
 * union, and writes the union back to the remote only if it actually changed (no redundant
 * uploads). Returns what moved each way.
 *
 * @param {PaiolStore} localStore
 * @param {object} vfs                      a @gcu/vfs VFS whose mount is the remote (e.g. Dropbox)
 * @param {{ path?: string, snapshotLabel?: string }} [opts]
 * @returns {Promise<{ pulledEvents: number, pulledMaster: number, pushed: boolean }>}
 */
export async function syncOnce(localStore, vfs, opts = {}) {
  const path = opts.path || DEFAULT_PATH;

  const remoteText = (await vfs.exists(path)) ? await vfs.readFile(path, 'utf8') : null;
  const remote = remoteText == null ? new PaiolStore() : PaiolStore.fromYaml(remoteText);

  const pulled = localStore.merge(remote);

  const localText = localStore.toYaml();
  let pushed = false;
  if (localText !== remoteText) {
    // Snapshot the prior remote before overwriting, so recovery never depends on Dropbox's own
    // version history (§5 safety net).
    if (opts.snapshotLabel && remoteText != null) {
      // Place snapshots NEXT TO the business file (e.g. /snapshots beside /business.yaml), not
      // under a hard-coded /paiol — on the Dropbox app folder the app root already is "paiol".
      const dir = path.slice(0, path.lastIndexOf('/'));
      await snapshotStore(vfs, remote, opts.snapshotLabel, `${dir}/snapshots`).catch(() => {});
    }
    await saveStore(vfs, localStore, path);
    pushed = true;
  }

  return { pulledEvents: pulled.eventsAdded, pulledMaster: pulled.masterUpserted, pushed };
}

/**
 * Drive sync automatically and SAFELY. Data-loss avoidance is the whole point, so:
 *  - every run goes through {@link syncOnce} (pull → union-merge → push) — a push never
 *    blind-overwrites the remote, and the prior remote is snapshotted first;
 *  - the local store is flushed to its source-of-truth (IndexedDB) BEFORE and AFTER each run, so
 *    nothing is lost even if the remote write fails;
 *  - runs never overlap (a request mid-flight is coalesced into a single follow-up), so two
 *    concurrent pushes can't race on this device;
 *  - bursts of changes debounce into one push.
 *
 * Pure/injectable (timers + remote are injected) so it is unit-testable against a MemoryBackend.
 *
 * @param {object} deps
 * @param {() => PaiolStore} deps.getStore
 * @param {() => Promise<void>} deps.flushLocal          persist the local store now
 * @param {() => Promise<object>} deps.openRemote        mount the remote VFS
 * @param {() => (string|undefined)} [deps.snapshotLabel]
 * @param {(res: {ok:boolean, pulledEvents?:number, pulledMaster?:number, pushed?:boolean, error?:string}, meta: object) => void} [deps.onResult]
 * @param {{ path?: string, debounceMs?: number, setTimeoutFn?: Function, clearTimeoutFn?: Function }} [deps.opts]
 */
export function createSyncController(deps) {
  const { getStore, flushLocal, openRemote, snapshotLabel, onResult } = deps;
  const o = deps.opts || {};
  const path = o.path || DEFAULT_PATH;
  const debounceMs = o.debounceMs ?? 5000;
  const setT = o.setTimeoutFn || setTimeout;
  const clearT = o.clearTimeoutFn || clearTimeout;
  let running = false; let pending = false; let timer = null;

  async function runNow(meta = {}) {
    if (running) { pending = true; return null; }   // coalesce — never two runs at once on this device
    running = true;
    if (timer) { clearT(timer); timer = null; }
    let res;
    try {
      await flushLocal();                            // local is the source of truth — save it first
      const vfs = await openRemote();
      const r = await syncOnce(getStore(), vfs, { path, snapshotLabel: snapshotLabel ? snapshotLabel() : undefined });
      await flushLocal();                            // persist the merged-in remote changes locally
      res = { ok: true, pulledEvents: r.pulledEvents, pulledMaster: r.pulledMaster, pushed: r.pushed };
    } catch (e) {
      res = { ok: false, error: String((e && e.message) || e) };   // stay quiet; retried on next trigger
    } finally {
      running = false;
    }
    if (onResult) onResult(res, meta);
    if (pending) { pending = false; void runNow({ trigger: 'coalesced' }); } // a change arrived mid-run
    return res;
  }

  return {
    /** Reconcile immediately (manual button, page-hide, boot, network back). */
    runNow,
    /** Coalesce a burst of changes into one push after a quiet period. */
    schedule() { if (timer) clearT(timer); timer = setT(() => { timer = null; void runNow({ trigger: 'debounced' }); }, debounceMs); },
    /** Drop any pending debounce without running. */
    cancel() { if (timer) { clearT(timer); timer = null; } },
    get busy() { return running; },
  };
}

/**
 * Mount a VFS over Dropbox using an injected `getToken` (from the token manager). The App-folder
 * app sees its own folder as the root, so `root` is usually '' and paths are relative to
 * `/Apps/Paiol/`.
 *
 * @param {() => Promise<string>} getToken
 * @param {{ root?: string }} [opts]
 * @returns {Promise<object>} a mounted VFS
 */
export async function openDropboxVfs(getToken, opts = {}) {
  const vfs = new VFS();
  await vfs.mount('/', new DropboxBackend({ getToken, root: opts.root || '' }));
  return vfs;
}
