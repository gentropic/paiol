// paiol — Dropbox PKCE OAuth (§5). PKCE = no client secret in the browser. The vendored
// DropboxBackend is auth-agnostic: it calls an injected `getToken()` per request and never
// touches OAuth. This module owns that token — the authorize redirect, the code exchange, and
// silent refresh — and hands a `getToken` to the backend.
//
// Pure where it can be: PKCE generation, URL building, and the exchange/refresh calls take an
// injected `fetch`/`crypto`/clock/storage, so the whole flow is testable headless. Only the
// actual browser redirect (window.location) lives at the edge.

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
// App-folder app: these are the scopes paiol needs (declare the same set in the App Console).
const DEFAULT_SCOPES = ['files.content.read', 'files.content.write', 'files.metadata.read'];

// ── PKCE primitives ───────────────────────────────────────────────────────────

const b64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * Generate a PKCE code verifier (RFC 7636): 43–128 chars from the unreserved set. base64url of
 * random bytes is a valid subset.
 * @param {Crypto} [cryptoObj]
 * @returns {string}
 */
export function generateVerifier(cryptoObj = globalThis.crypto) {
  const bytes = new Uint8Array(64);
  cryptoObj.getRandomValues(bytes);
  return b64url(bytes); // ~86 chars
}

/**
 * The S256 code challenge for a verifier: base64url(SHA-256(verifier)).
 * @param {string} verifier
 * @param {Crypto} [cryptoObj]
 * @returns {Promise<string>}
 */
export async function challengeFromVerifier(verifier, cryptoObj = globalThis.crypto) {
  const data = new TextEncoder().encode(verifier);
  const digest = await cryptoObj.subtle.digest('SHA-256', data);
  return b64url(new Uint8Array(digest));
}

/**
 * Build the authorize URL to redirect the user to. `token_access_type=offline` is what yields a
 * refresh token (so she only consents once).
 * @param {{ clientId: string, redirectUri: string, challenge: string, scopes?: string[], state?: string }} p
 * @returns {string}
 */
export function buildAuthUrl({ clientId, redirectUri, challenge, scopes = DEFAULT_SCOPES, state }) {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    scope: scopes.join(' '),
  });
  if (state) q.set('state', state);
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

// ── Token exchange / refresh ───────────────────────────────────────────────────

/**
 * @typedef {object} TokenSet
 * @property {string} accessToken
 * @property {string} [refreshToken]
 * @property {number} expiresAt       // epoch ms when the access token expires
 * @property {string} [accountId]
 */

/**
 * Exchange an authorization code for tokens (after the redirect back).
 * @param {{ clientId: string, redirectUri: string, code: string, verifier: string, fetchFn?: Function, now?: () => number }} p
 * @returns {Promise<TokenSet>}
 */
export async function exchangeCode({ clientId, redirectUri, code, verifier, fetchFn = fetch, now = Date.now }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  return postToken(fetchFn, body, now);
}

/**
 * Silently mint a fresh access token from a refresh token.
 * @param {{ clientId: string, refreshToken: string, fetchFn?: Function, now?: () => number }} p
 * @returns {Promise<TokenSet>}
 */
export async function refreshAccessToken({ clientId, refreshToken, fetchFn = fetch, now = Date.now }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const set = await postToken(fetchFn, body, now);
  // Refresh responses omit the refresh_token; keep the one we already have.
  if (!set.refreshToken) set.refreshToken = refreshToken;
  return set;
}

async function postToken(fetchFn, body, now) {
  const resp = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new DropboxAuthError(`token endpoint ${resp.status}: ${text || resp.statusText}`);
  }
  const j = await resp.json();
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: now() + (j.expires_in ?? 14400) * 1000,
    accountId: j.account_id,
  };
}

// ── Token manager (what you inject into the DropboxBackend) ─────────────────────

/**
 * A token manager that returns a valid access token on demand, refreshing silently when the
 * current one is near expiry. Persist the token set however you like (IndexedDB / localStorage)
 * via `load`/`save`.
 *
 * @param {object} p
 * @param {string}   p.clientId
 * @param {() => (TokenSet|null|Promise<TokenSet|null>)} p.load   // read the stored token set
 * @param {(t: TokenSet) => void|Promise<void>}          p.save   // persist a refreshed set
 * @param {Function} [p.fetchFn]
 * @param {() => number} [p.now]
 * @param {number}  [p.skewMs]   // refresh this many ms before actual expiry (default 60s)
 * @returns {{ getToken: () => Promise<string>, isLinked: () => Promise<boolean> }}
 */
export function createTokenManager({ clientId, load, save, fetchFn = fetch, now = Date.now, skewMs = 60_000 }) {
  /** @type {Promise<string>|null} */
  let inflight = null;

  async function resolve() {
    const set = await load();
    if (!set || !set.accessToken) throw new DropboxAuthError('nao conectado ao Dropbox');
    if (set.expiresAt - skewMs > now()) return set.accessToken; // still valid
    if (!set.refreshToken) throw new DropboxAuthError('token expirado e sem refresh token — reconecte');
    const fresh = await refreshAccessToken({ clientId, refreshToken: set.refreshToken, fetchFn, now });
    await save(fresh);
    return fresh.accessToken;
  }

  return {
    getToken() {
      // Coalesce concurrent callers so we refresh at most once.
      if (!inflight) inflight = resolve().finally(() => { inflight = null; });
      return inflight;
    },
    async isLinked() {
      const set = await load();
      return !!(set && (set.refreshToken || set.expiresAt - skewMs > now()));
    },
  };
}

export class DropboxAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DropboxAuthError';
  }
}
