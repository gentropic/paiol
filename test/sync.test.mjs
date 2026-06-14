import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VFS } from '../vendor/@gcu/vfs/index.js';
import { PaiolStore } from '../src/store.js';
import { syncOnce } from '../src/sync.js';

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
