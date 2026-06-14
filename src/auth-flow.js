// paiol — browser glue for the Dropbox PKCE flow. The pure mechanics live in dropbox-auth.js
// (tested headless); this file is the thin browser edge: redirect, callback, token storage.
//
//   connect → stash verifier, redirect to Dropbox
//   ...user consents, Dropbox redirects back with ?code=...
//   handleRedirectIfPresent → exchange code for tokens, persist, clean the URL
//   dropboxTokenManager → yields getToken() for the DropboxBackend, refreshing silently

import {
  generateVerifier, challengeFromVerifier, buildAuthUrl,
  exchangeCode, createTokenManager,
} from './dropbox-auth.js';
import { DROPBOX_APP_KEY, redirectUri } from './config.js';

const TOKEN_KEY = 'paiol.dropbox.token';     // localStorage — persists across sessions
const VERIFIER_KEY = 'paiol.dropbox.verifier'; // sessionStorage — one-shot, survives the redirect
const STATE_KEY = 'paiol.dropbox.state';

/** @returns {import('./dropbox-auth.js').TokenSet | null} */
function loadToken() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch { return null; }
}
function saveToken(t) { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); }
export function forgetToken() { localStorage.removeItem(TOKEN_KEY); }

/** Begin linking: stash a fresh verifier, then redirect the whole page to Dropbox's consent screen. */
export async function startDropboxLink() {
  const verifier = generateVerifier();
  const state = generateVerifier(); // reuse the CSPRNG helper for an opaque state token
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const challenge = await challengeFromVerifier(verifier);
  location.assign(buildAuthUrl({
    clientId: DROPBOX_APP_KEY,
    redirectUri: redirectUri(),
    challenge,
    state,
  }));
}

/**
 * If the current URL is an OAuth callback (`?code=…`), complete the exchange and persist tokens.
 * Cleans the query off the URL afterwards so a reload doesn't re-trigger. No-op otherwise.
 * @returns {Promise<{ linked: boolean, error?: string }>}
 */
export async function handleRedirectIfPresent() {
  const params = new URLSearchParams(location.search);
  if (params.has('error')) {
    cleanUrl();
    return { linked: false, error: params.get('error_description') || params.get('error') };
  }
  const code = params.get('code');
  if (!code) return { linked: false };

  const expectedState = sessionStorage.getItem(STATE_KEY);
  if (expectedState && params.get('state') !== expectedState) {
    cleanUrl();
    return { linked: false, error: 'state mismatch (possivel CSRF) — tente novamente' };
  }
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) { cleanUrl(); return { linked: false, error: 'sessao de login expirada — tente novamente' }; }

  try {
    const tokens = await exchangeCode({
      clientId: DROPBOX_APP_KEY,
      redirectUri: redirectUri(),
      code,
      verifier,
    });
    saveToken(tokens);
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    cleanUrl();
    return { linked: true };
  } catch (e) {
    cleanUrl();
    return { linked: false, error: String(e.message || e) };
  }
}

/** A token manager bound to browser storage — pass `.getToken` to the DropboxBackend. */
export function dropboxTokenManager() {
  return createTokenManager({
    clientId: DROPBOX_APP_KEY,
    load: loadToken,
    save: saveToken,
  });
}

/** Whether we currently hold (refreshable) Dropbox credentials. */
export function isLinked() {
  return dropboxTokenManager().isLinked();
}

function cleanUrl() {
  history.replaceState(null, '', location.pathname);
}
