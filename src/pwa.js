// paiol — PWA glue over the vendored @gcu/sw companion. Installable + offline + storage that
// survives eviction (vital: IndexedDB is the source of truth). The SW serves the cached shell
// instantly and, when a new deploy changes the bytes, broadcasts an update so we can offer a
// reload — see app.js. The @gcu/sw core is dumb plumbing; the CONTENT is what updates.

import { registerGcuSw } from '../vendor/@gcu/sw/register.js';

/**
 * Register the service worker and request persistent storage. No-op in local dev (a SW would cache
 * the shell and fight live-reload / the e2e harness, both on localhost). Safe everywhere else: the
 * companion never throws and degrades where service workers aren't supported (file://, old engines).
 *
 * @param {() => void} onUpdateAvailable  called when a newer shell has been fetched in the background
 * @returns {{ applyUpdate: () => void } | null}
 */
export function setupPwa(onUpdateAvailable) {
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '') return null;
  return registerGcuSw({
    url: './sw.js',
    persist: true, // navigator.storage.persist() — keep the IndexedDB business safe from eviction
    onUpdateAvailable,
  });
}
