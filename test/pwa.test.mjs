import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSw } from '../vendor/@gcu/sw/make.mjs';

const CONFIG = {
  app: 'paiol',
  cache: 'paiol-shell-v1',
  precache: ['./', './index.html', './manifest.webmanifest'],
  navFallback: './index.html',
};

test('makeSw emits a self-contained classic-script sw.js (config header + core)', () => {
  const sw = makeSw(CONFIG);
  assert.match(sw, /const GCU_SW_CONFIG = \{/);     // config baked in above the core
  assert.match(sw, /"cache": "paiol-shell-v1"/);
  assert.match(sw, /addEventListener\('install'/);  // the core is present
  assert.match(sw, /self\.skipWaiting\(\)/);        // installs immediately (content updates, not the SW)
  assert.match(sw, /gcu-sw:update-available/);      // stale-while-revalidate update signal
});

test('makeSw validates the config (build-time, not in the field)', () => {
  assert.throws(() => makeSw({ cache: 'x', precache: ['./'] }), /app is required/);
  assert.throws(() => makeSw({ app: 'paiol', precache: ['./'] }), /cache is required/);
  assert.throws(() => makeSw({ app: 'paiol', cache: 'x' }), /precache/);
  assert.throws(() => makeSw({ ...CONFIG, routes: [{ prefix: '/x/' }] }), /missing strategy/);
});
