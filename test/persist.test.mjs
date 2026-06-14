import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VFS } from '../vendor/@gcu/vfs/index.js';
import { PaiolStore } from '../src/store.js';
import { loadStore, saveStore, snapshotStore, createDebouncedSaver, DEFAULT_PATH } from '../src/persist.js';

// VFS.create() with no config mounts a MemoryBackend at '/'. MemoryBackend exercises the same
// VFS interface the IDBBackend (browser) and DropboxBackend (sync) implement — so this
// validates the persistence wiring end-to-end. IndexedDB itself is browser-only and out of
// scope for the node test runner.
function freshVfs() {
  return VFS.create();
}

function seeded() {
  const s = new PaiolStore();
  s.upsertIngredient({ id: 'farinha', name: 'Farinha', stockUnit: 'kg' });
  s.addPriceChange({ id: 'pc1', at: '2026-01-01', ingredientId: 'farinha', price: 5 });
  return s;
}

test('load on a fresh VFS returns an empty store', async () => {
  const v = await freshVfs();
  const s = await loadStore(v);
  assert.equal(s.state.ingredients.length, 0);
});

test('save then load round-trips the business through the VFS', async () => {
  const v = await freshVfs();
  await saveStore(v, seeded());
  assert.ok(await v.exists(DEFAULT_PATH));
  const back = await loadStore(v);
  assert.equal(back.get('ingredients', 'farinha').name, 'Farinha');
  assert.equal(back.state.priceChanges.length, 1);
});

test('save creates parent directories', async () => {
  const v = await freshVfs();
  await saveStore(v, seeded(), '/deep/nested/dir/business.yaml');
  assert.ok(await v.exists('/deep/nested/dir/business.yaml'));
});

test('snapshot writes a dated file', async () => {
  const v = await freshVfs();
  const path = await snapshotStore(v, seeded(), '2026-06');
  assert.equal(path, '/paiol/snapshots/paiol-2026-06.yaml');
  assert.ok(await v.exists(path));
});

test('debounced saver coalesces and flushNow forces a write', async () => {
  const v = await freshVfs();
  const store = seeded();
  const saver = createDebouncedSaver(v, () => store, { delayMs: 10_000 }); // long delay; rely on flushNow
  saver.schedule();
  saver.schedule();
  assert.equal(saver.pending, true);
  await saver.flushNow();
  assert.equal(saver.pending, false);
  const back = await loadStore(v);
  assert.equal(back.get('ingredients', 'farinha').name, 'Farinha');
});
