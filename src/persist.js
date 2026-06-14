// paiol — persistence over @gcu/vfs. Backend-agnostic by design: the SAME code persists
// to IndexedDB (local source of truth) and to Dropbox (durable backup / sync) because both
// are just VFS backends. The store serializes to one YAML document (§5).
//
// This module does I/O but knows nothing about which backend it's writing to — the caller
// mounts a VFS (IDBBackend for local, DropboxBackend for remote) and hands it in.

import { PaiolStore } from './store.js';

export const DEFAULT_PATH = '/paiol/business.yaml';
export const SNAPSHOT_DIR = '/paiol/snapshots';

/**
 * Load the business from a VFS path. Returns a fresh empty store if the file is absent.
 * @param {object} vfs  a @gcu/vfs VFS instance
 * @param {string} [path]
 * @returns {Promise<PaiolStore>}
 */
export async function loadStore(vfs, path = DEFAULT_PATH) {
  if (!(await vfs.exists(path))) return new PaiolStore();
  const text = await vfs.readFile(path, 'utf8');
  return PaiolStore.fromYaml(text);
}

/**
 * Write the whole business to a VFS path (atomic at the backend level — Dropbox commits the
 * whole file or nothing). Creates parent directories as needed.
 * @param {object} vfs @param {PaiolStore} store @param {string} [path]
 * @returns {Promise<string>} the path written
 */
export async function saveStore(vfs, store, path = DEFAULT_PATH) {
  await ensureDir(vfs, parentOf(path));
  await vfs.writeFile(path, store.toYaml());
  return path;
}

/**
 * Write a dated snapshot (`paiol-2026-06.yaml`) so recovery doesn't depend on the backend's
 * own version retention (§5 safety nets).
 * @param {object} vfs @param {PaiolStore} store @param {string} label  e.g. "2026-06"
 * @param {string} [dir]
 * @returns {Promise<string>} the snapshot path
 */
export async function snapshotStore(vfs, store, label, dir = SNAPSHOT_DIR) {
  await ensureDir(vfs, dir);
  const path = `${dir}/paiol-${label}.yaml`;
  await vfs.writeFile(path, store.toYaml());
  return path;
}

/**
 * A debounced background saver (§5 write path): IndexedDB is written shortly after each
 * change rather than on every keystroke. `schedule()` coalesces bursts; `flushNow()` forces
 * an immediate write (call on page hide / before sync).
 *
 * @param {object} vfs
 * @param {() => PaiolStore} getStore  // late-bound so the latest state is always saved
 * @param {{ path?: string, delayMs?: number, setTimeoutFn?: Function, clearTimeoutFn?: Function }} [opts]
 */
export function createDebouncedSaver(vfs, getStore, opts = {}) {
  const path = opts.path || DEFAULT_PATH;
  const delayMs = opts.delayMs ?? 800;
  const setT = opts.setTimeoutFn || setTimeout;
  const clearT = opts.clearTimeoutFn || clearTimeout;
  let timer = null;
  let dirty = false;
  /** @type {Promise<void>|null} */
  let inflight = null;

  async function flush() {
    dirty = false;
    inflight = saveStore(vfs, getStore(), path).then(() => {}, (e) => { dirty = true; throw e; });
    await inflight;
    inflight = null;
  }

  return {
    /** Mark dirty and (re)arm the debounce timer. */
    schedule() {
      dirty = true;
      if (timer) clearT(timer);
      timer = setT(() => { timer = null; flush().catch(() => {}); }, delayMs);
    },
    /** Force an immediate save if anything is pending. Awaits any in-flight write. */
    async flushNow() {
      if (timer) { clearT(timer); timer = null; }
      if (inflight) await inflight;
      if (dirty) await flush();
    },
    get pending() { return dirty || !!timer; },
  };
}

// ── path helpers ──────────────────────────────────────────────────────────────

function parentOf(path) {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

async function ensureDir(vfs, dir) {
  if (!dir || dir === '/') return;
  if (!(await vfs.exists(dir))) await vfs.mkdir(dir, { recursive: true });
}
