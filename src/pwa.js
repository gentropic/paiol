// paiol — PWA glue over the vendored @gcu/sw companion. Installable + offline + storage that
// survives eviction (vital: IndexedDB is the source of truth). The SW serves the cached shell
// instantly and, when a new deploy changes the bytes, broadcasts an update so we can offer a
// reload — see app.js. The @gcu/sw core is dumb plumbing; the CONTENT is what updates.

import { registerGcuSw } from '../vendor/@gcu/sw/register.js';

let pendingInstallPrompt = null;
const installListeners = new Set();
const notifyInstallChange = () => { for (const listener of installListeners) listener(); };

// Capture this as soon as the module loads: IndexedDB boot and cloud sync may take longer
// than the browser waits before offering its one-use installation prompt.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  pendingInstallPrompt = event;
  notifyInstallChange();
});
window.addEventListener('appinstalled', () => {
  pendingInstallPrompt = null;
  notifyInstallChange();
});

export function installState() {
  return {
    available: !!pendingInstallPrompt,
    installed: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  };
}

export function watchInstall(onChange) {
  installListeners.add(onChange);
  return () => installListeners.delete(onChange);
}

export async function requestInstall() {
  const prompt = pendingInstallPrompt;
  if (!prompt) return 'unavailable';
  try {
    const opened = prompt.prompt(); // call directly within the user's click gesture
    pendingInstallPrompt = null;
    notifyInstallChange();
    await opened;
    const choice = await prompt.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    pendingInstallPrompt = null;
    notifyInstallChange();
    return 'unavailable';
  }
}

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
