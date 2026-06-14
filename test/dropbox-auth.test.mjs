import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateVerifier, challengeFromVerifier, buildAuthUrl,
  exchangeCode, refreshAccessToken, createTokenManager, DropboxAuthError,
} from '../src/dropbox-auth.js';

// A mock token endpoint.
function mockFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init?.body });
    return {
      ok, status,
      json: async () => payload,
      text: async () => (ok ? '' : JSON.stringify(payload)),
      statusText: 'err',
    };
  };
  fn.calls = calls;
  return fn;
}

test('verifier is 43+ chars from the PKCE unreserved subset', () => {
  const v = generateVerifier();
  assert.ok(v.length >= 43, `length ${v.length}`);
  assert.match(v, /^[A-Za-z0-9\-_]+$/);
});

test('S256 challenge matches the RFC 7636 test vector', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = await challengeFromVerifier(verifier);
  assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('auth URL carries PKCE + offline params', () => {
  const url = new URL(buildAuthUrl({
    clientId: 'KEY123', redirectUri: 'https://gentropic.org/paiol/', challenge: 'CH', state: 'xyz',
  }));
  assert.equal(url.origin + url.pathname, 'https://www.dropbox.com/oauth2/authorize');
  const q = url.searchParams;
  assert.equal(q.get('client_id'), 'KEY123');
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('code_challenge'), 'CH');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('token_access_type'), 'offline'); // -> refresh token
  assert.equal(q.get('redirect_uri'), 'https://gentropic.org/paiol/');
  assert.equal(q.get('state'), 'xyz');
  assert.match(q.get('scope'), /files\.content\.write/);
});

test('exchangeCode posts the code + verifier and parses tokens', async () => {
  const fetchFn = mockFetch({ access_token: 'AT', refresh_token: 'RT', expires_in: 14400, account_id: 'acc1' });
  const set = await exchangeCode({
    clientId: 'KEY', redirectUri: 'https://x/cb', code: 'CODE', verifier: 'VER',
    fetchFn, now: () => 1000,
  });
  assert.equal(set.accessToken, 'AT');
  assert.equal(set.refreshToken, 'RT');
  assert.equal(set.accountId, 'acc1');
  assert.equal(set.expiresAt, 1000 + 14400 * 1000);
  const sent = new URLSearchParams(fetchFn.calls[0].body);
  assert.equal(sent.get('grant_type'), 'authorization_code');
  assert.equal(sent.get('code'), 'CODE');
  assert.equal(sent.get('code_verifier'), 'VER');
});

test('refresh keeps the existing refresh token when the response omits it', async () => {
  const fetchFn = mockFetch({ access_token: 'AT2', expires_in: 14400 });
  const set = await refreshAccessToken({ clientId: 'KEY', refreshToken: 'RT', fetchFn, now: () => 0 });
  assert.equal(set.accessToken, 'AT2');
  assert.equal(set.refreshToken, 'RT'); // preserved
});

test('token endpoint failure throws DropboxAuthError', async () => {
  const fetchFn = mockFetch({ error: 'invalid_grant' }, { ok: false, status: 400 });
  await assert.rejects(
    () => exchangeCode({ clientId: 'K', redirectUri: 'r', code: 'c', verifier: 'v', fetchFn }),
    DropboxAuthError,
  );
});

test('token manager returns a valid token without refreshing', async () => {
  const fetchFn = mockFetch({}); // should never be called
  let now = 10_000;
  const stored = { accessToken: 'AT', refreshToken: 'RT', expiresAt: 10_000 + 3_600_000 };
  const mgr = createTokenManager({ clientId: 'K', load: () => stored, save: () => {}, fetchFn, now: () => now });
  assert.equal(await mgr.getToken(), 'AT');
  assert.equal(fetchFn.calls.length, 0);
});

test('token manager refreshes a near-expired token and persists it', async () => {
  const fetchFn = mockFetch({ access_token: 'FRESH', expires_in: 14400 });
  let now = 10_000;
  let stored = { accessToken: 'OLD', refreshToken: 'RT', expiresAt: 10_000 + 30_000 }; // within skew
  const mgr = createTokenManager({
    clientId: 'K', load: () => stored, save: (t) => { stored = t; }, fetchFn, now: () => now,
  });
  assert.equal(await mgr.getToken(), 'FRESH');
  assert.equal(stored.accessToken, 'FRESH');
  assert.equal(stored.refreshToken, 'RT');
});

test('token manager coalesces concurrent refreshes into one call', async () => {
  const fetchFn = mockFetch({ access_token: 'FRESH', expires_in: 14400 });
  const stored = { accessToken: 'OLD', refreshToken: 'RT', expiresAt: 0 };
  const mgr = createTokenManager({ clientId: 'K', load: () => stored, save: () => {}, fetchFn, now: () => 10_000 });
  const [a, b, c] = await Promise.all([mgr.getToken(), mgr.getToken(), mgr.getToken()]);
  assert.deepEqual([a, b, c], ['FRESH', 'FRESH', 'FRESH']);
  assert.equal(fetchFn.calls.length, 1); // one network refresh, not three
});

test('token manager throws when not linked', async () => {
  const mgr = createTokenManager({ clientId: 'K', load: () => null, save: () => {}, fetchFn: mockFetch({}), now: () => 0 });
  await assert.rejects(() => mgr.getToken(), DropboxAuthError);
});
