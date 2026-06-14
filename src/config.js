// paiol — app configuration. The Dropbox app key is a PUBLIC client id (PKCE uses no secret),
// so it lives in the shipped file. The redirect URI must EXACTLY match one registered in the
// Dropbox App Console; we pick by origin.

export const DROPBOX_APP_KEY = 'co3pz3u3sqx84m2';

// Where Dropbox stores everything (App-folder app → relative to /Apps/Paiol/).
export const REMOTE_BUSINESS_PATH = '/business.yaml';
// Local IndexedDB database name (via @gcu/vfs idb backend).
export const LOCAL_DB_NAME = 'paiol';

/**
 * The OAuth redirect URI for the current origin. Must be registered verbatim in the App Console:
 *   - http://localhost:8080/        (local dev — served by tools/dev-server.js)
 *   - https://gentropic.org/paiol/  (production, §6)
 * @returns {string}
 */
export function redirectUri() {
  const { hostname } = location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:8080/';
  return 'https://gentropic.org/paiol/';
}
