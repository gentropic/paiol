import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VFS } from '../vendor/@gcu/vfs/index.js';
import { PaiolStore } from '../src/store.js';
import { syncOnce, createSyncController } from '../src/sync.js';

// A shared MemoryBackend VFS stands in for the Dropbox remote: syncOnce is backend-agnostic, so
// what passes here is exactly what runs against a DropboxBackend mount in production.
const remote = () => VFS.create();

const sale = (id, productId) => ({
  id, at: '2026-06-01', productId, qty: 1, unitPrice: 10, paymentFeePct: 0.05, costSnapshot: 4,
});

test('first sync pushes local state to an empty remote', async () => {
  const v = await remote();
  const a = new PaiolStore();
  a.upsertIngredient({ id: 'farinha', name: 'Farinha', stockUnit: 'kg' });
  a.addSale(sale('s1', 'p'));

  const r = await syncOnce(a, v);
  assert.equal(r.pushed, true);
  assert.equal(r.pulledEvents, 0);

  // A fresh device pulls everything.
  const b = new PaiolStore();
  const r2 = await syncOnce(b, v);
  assert.equal(r2.pulledEvents, 1);
  assert.equal(b.get('ingredients', 'farinha').name, 'Farinha');
  assert.equal(b.state.sales.length, 1);
});

test('two devices converge via union-by-id', async () => {
  const v = await remote();
  const a = new PaiolStore();
  const b = new PaiolStore();
  a.addSale(sale('s1', 'p'));
  b.addSale(sale('s2', 'p'));

  await syncOnce(a, v);       // remote = {s1}
  await syncOnce(b, v);       // b pulls s1, pushes s2 -> remote = {s1, s2}
  await syncOnce(a, v);       // a pulls s2 -> a = {s1, s2}

  assert.equal(a.state.sales.length, 2);
  assert.equal(b.state.sales.length, 2);
  // Identical businesses → identical canonical YAML.
  assert.equal(a.toYaml(), b.toYaml());
});

test('a converged sync makes no redundant write', async () => {
  const v = await remote();
  const a = new PaiolStore();
  a.addSale(sale('s1', 'p'));
  await syncOnce(a, v);
  const second = await syncOnce(a, v); // nothing new either way
  assert.equal(second.pushed, false);
  assert.equal(second.pulledEvents, 0);
});

test('overwriting an existing remote writes a snapshot first', async () => {
  const v = await remote();
  const a = new PaiolStore();
  a.addSale(sale('s1', 'p'));
  await syncOnce(a, v);                          // remote now exists
  a.addSale(sale('s2', 'p'));
  await syncOnce(a, v, { snapshotLabel: '2026-06' });
  assert.ok(await v.exists('/paiol/snapshots/paiol-2026-06.yaml'));
});

// ── createSyncController (automatic, safe orchestration) ──────────────────────

const tick = () => new Promise((r) => setTimeout(r, 0));

test('controller.runNow reconciles through syncOnce and flushes local before + after', async () => {
  const v = await remote();
  const a = new PaiolStore(); a.addSale(sale('s1', 'p'));
  let flushes = 0; const seen = [];
  const ctrl = createSyncController({
    getStore: () => a, flushLocal: async () => { flushes++; }, openRemote: async () => v,
    onResult: (res, meta) => seen.push([res, meta]),
  });
  const res = await ctrl.runNow({ manual: true });
  assert.equal(res.ok, true);
  assert.equal(res.pushed, true);
  assert.ok(flushes >= 2, 'local flushed before and after');
  assert.equal(seen[0][1].manual, true);

  // A second device pulls what the first pushed.
  const b = new PaiolStore();
  const ctrlB = createSyncController({ getStore: () => b, flushLocal: async () => {}, openRemote: async () => v });
  const r2 = await ctrlB.runNow();
  assert.equal(r2.pulledEvents, 1);
});

test('controller never runs two syncs at once — a mid-run request coalesces into one follow-up', async () => {
  const v = await remote();
  const a = new PaiolStore(); a.addSale(sale('s1', 'p'));
  let opens = 0; let release;
  const gate = new Promise((r) => { release = r; });
  const openRemote = async () => { opens += 1; if (opens === 1) await gate; return v; };
  const ctrl = createSyncController({ getStore: () => a, flushLocal: async () => {}, openRemote });

  const p1 = ctrl.runNow();        // starts, blocks inside openRemote (opens=1)
  await tick();
  const p2 = await ctrl.runNow();  // already running → returns null immediately
  assert.equal(p2, null, 'overlapping run is rejected, not started');
  release();                       // let the first finish
  await p1;
  await tick(); await tick();      // the coalesced follow-up runs
  assert.equal(opens, 2, 'exactly one follow-up, not one-per-request');
});

test('controller.schedule coalesces a burst of changes into a single run', async () => {
  const v = await remote();
  const a = new PaiolStore(); a.addSale(sale('s1', 'p'));
  let opens = 0; const queue = [];
  const setTimeoutFn = (fn) => { const id = { fn }; queue.push(id); return id; };
  const clearTimeoutFn = (id) => { const i = queue.indexOf(id); if (i >= 0) queue.splice(i, 1); };
  const ctrl = createSyncController({
    getStore: () => a, flushLocal: async () => {}, openRemote: async () => { opens += 1; return v; },
    opts: { debounceMs: 100, setTimeoutFn, clearTimeoutFn },
  });
  ctrl.schedule(); ctrl.schedule(); ctrl.schedule();   // three rapid changes
  assert.equal(queue.length, 1, 'only the latest timer is armed');
  queue.shift().fn();                                  // fire the debounce
  await tick();
  assert.equal(opens, 1, 'one sync for the whole burst');
});

test('controller surfaces a sync failure without throwing (retried on next trigger)', async () => {
  const a = new PaiolStore();
  let reported;
  const ctrl = createSyncController({
    getStore: () => a, flushLocal: async () => {}, openRemote: async () => { throw new Error('offline'); },
    onResult: (res) => { reported = res; },
  });
  const out = await ctrl.runNow();
  assert.equal(out.ok, false);
  assert.match(out.error, /offline/);
  assert.equal(reported.ok, false);
});

test('snapshots land next to the business file (root path → /snapshots)', async () => {
  const v = await remote();
  const a = new PaiolStore();
  a.addSale(sale('s1', 'p'));
  await syncOnce(a, v, { path: '/business.yaml' });        // the app's real remote layout
  a.addSale(sale('s2', 'p'));
  await syncOnce(a, v, { path: '/business.yaml', snapshotLabel: '2026-06' });
  assert.ok(await v.exists('/snapshots/paiol-2026-06.yaml'), 'snapshot not beside business.yaml');
  assert.ok(!(await v.exists('/paiol/snapshots/paiol-2026-06.yaml')), 'snapshot wrongly nested under /paiol');
});
