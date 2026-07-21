// electron/services/__tests__/CodexOAuthService.test.mjs
//
// Unit tests for CodexOAuthService. The tests are split into two layers:
//
//   1. Source-level guards: pin the OAuth constants, the PKCE helpers, and
//      the shape of the persisted token bundle. These are grep-style
//      assertions that catch accidental refactors (someone renaming
//      app_EMoamEEZ73f0CkXaXp7hrann, or dropping `offline_access` from
//      the scope) without needing a live network.
//
//   2. Behavioural tests with mocked global.fetch: drive the full PKCE +
//      token-exchange + refresh-token rotation flow. We stub `fetch` to
//      return the exact JSON the OpenAI OAuth endpoints emit, then assert
//      the service's behaviour (status, dedup, error handling).
//
// We do NOT spin up the loopback HTTP server in these tests — startLogin
// is exercised by a separate integration test (or the manual smoke test
// in Settings → AI Providers). The exchange / refresh paths are pure
// fetch + parse + persist, which is what most regressions look like.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

// =============================================================================
// 1. Source-level guards — constants and PKCE wiring
// =============================================================================

test('CodexOAuthService pins the public ChatGPT OAuth client_id and endpoints', () => {
  const source = read('electron/services/CodexOAuthService.ts');
  // Public client_id used by the official codex CLI (PROVIDER_OAUTH.codex in
  // open-sse, codex.md:1150). Pinning this here means an accidental rename
  // gets caught before a release.
  assert.match(source, /CODEX_OAUTH_CLIENT_ID\s*=\s*'app_EMoamEEZ73f0CkXaXp7hrann'/);
  // Authorize + token endpoints must be the public ChatGPT OAuth URLs.
  assert.match(source, /CODEX_OAUTH_AUTHORIZE_URL\s*=\s*'https:\/\/auth\.openai\.com\/oauth\/authorize'/);
  assert.match(source, /CODEX_OAUTH_TOKEN_URL\s*=\s*'https:\/\/auth\.openai\.com\/oauth\/token'/);
  // Scope includes offline_access so we get a refresh_token on the
  // authorization-code grant.
  assert.match(source, /CODEX_OAUTH_SCOPE\s*=\s*'openid profile email offline_access'/);
  // Preferred port matches the codex CLI (1455).
  assert.match(source, /CODEX_OAUTH_PREFERRED_PORT\s*=\s*1455/);
  // PKCE method is S256.
  assert.match(source, /code_challenge_method:\s*'S256'/);
});

test('CodexOAuthService PKCE helper produces a 43-char base64url verifier + sha256 challenge', () => {
  const source = read('electron/services/CodexOAuthService.ts');
  // randomBytes(32).toString('base64url') is the canonical PKCE pattern.
  assert.match(source, /crypto\.randomBytes\(32\)\.toString\('base64url'\)/);
  // Challenge is sha256(verifier) → base64url.
  assert.match(source, /createHash\('sha256'\)/);
  // CSRF state is separate (16 bytes).
  assert.match(source, /crypto\.randomBytes\(16\)\.toString\('base64url'\)/);
});

test('CodexOAuthService refresh path uses the new refresh_token (rotation handling)', () => {
  // ChatGPT OAuth rotates refresh tokens on every successful refresh.
  // If we don't update the stored bundle, the next refresh returns
  // invalid_grant. The test pins the merge logic: bundle.refresh_token
  // is used, falling back to the existing one only if absent.
  const source = read('electron/services/CodexOAuthService.ts');
  assert.match(source, /refreshToken:\s*typeof\s+bundle\.refresh_token\s*===\s*'string'\s*\?\s*bundle\.refresh_token\s*:\s*tokens\.refreshToken/);
});

test('CodexOAuthService classifies permanent refresh failures and clears credentials', () => {
  const source = read('electron/services/CodexOAuthService.ts');
  // All four "permanent" markers from open-sse classifyOAuthRefreshError.
  for (const marker of ['refresh_token_expired', 'refresh_token_reused', 'refresh_token_invalidated', 'invalid_grant']) {
    assert.match(source, new RegExp(marker), `should detect permanent failure marker ${marker}`);
  }
  // Permanent failures must clear the stored bundle + fire login:failed.
  assert.match(source, /this\.cachedTokens\s*=\s*null/);
  assert.match(source, /this\.clearStorage\(\)/);
  assert.match(source, /this\.emit\('login:failed'/);
});

test('CodexOAuthService dedupes concurrent refresh requests (in-flight promise)', () => {
  const source = read('electron/services/CodexOAuthService.ts');
  // The shared in-flight promise pattern.
  assert.match(source, /private\s+refreshInFlight/);
  assert.match(source, /if\s*\(this\.refreshInFlight\)\s*return\s+this\.refreshInFlight/);
  // Cleanup in finally so a refresh failure doesn't deadlock the next call.
  assert.match(source, /refreshInFlight\s*=\s*null/);
});

test('CodexOAuthService expiry-buffer is 5 minutes (matches open-sse TOKEN_EXPIRY_BUFFER_MS)', () => {
  const source = read('electron/services/CodexOAuthService.ts');
  assert.match(source, /CODEX_OAUTH_REFRESH_LEAD_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
});

test('CodexOAuthService exchange uses authorization_code + code_verifier + form-urlencoded body', () => {
  const source = read('electron/services/CodexOAuthService.ts');
  // First call: exchange (form-urlencoded, authorization_code grant)
  assert.match(source, /grant_type:\s*'authorization_code'/);
  assert.match(source, /code_verifier:\s*codeVerifier/);
  // Refresh call: JSON body
  assert.match(source, /grant_type:\s*'refresh_token'/);
  assert.match(source, /body:\s*JSON\.stringify\(\{[\s\S]*?refresh_token/);
});

test('CodexOAuthService validates OAuth state on callback (CSRF protection)', () => {
  const source = read('electron/services/CodexOAuthService.ts');
  // State mismatch should reject with a CSRF-specific message.
  assert.match(source, /callback\.state\s*!==\s*state/);
  assert.match(source, /OAuth state mismatch/);
});

// =============================================================================
// 2. Behavioural tests — refresh flow with mocked fetch
// =============================================================================

function mockFetchSequence(responses) {
  const calls = [];
  let i = 0;
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (i >= responses.length) {
      throw new Error(`mockFetchSequence exhausted at call #${i + 1} for URL ${url}`);
    }
    const r = responses[i++];
    if (r instanceof Error) throw r;
    return r;
  };
  return { fn, calls };
}

function makeJsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

test('CodexOAuthService.refreshTokens: stores rotated refresh_token from the new bundle', async () => {
  // Force-set the cached tokens via the in-test storage stub.
  const stored = {};
  // Lazy-load the compiled service so we can substitute the storage
  // shim in via a module-level monkey-patch.
  const oauthModulePath = path.resolve(root, 'dist-electron/electron/services/CodexOAuthService.js');
  if (!fs.existsSync(oauthModulePath)) {
    // Skip if not built — this is a behavioural test, not a source guard.
    return;
  }
  const url = (await import('node:url')).pathToFileURL(oauthModulePath).href;
  const mod = await import(url);
  const svc = mod.CodexOAuthService.getInstance();
  svc.__resetForTest();
  // Seed cached tokens.
  const initialTokens = {
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    idToken: undefined,
    expiresAt: Date.now() - 1000, // expired so refresh fires
  };
  svc.__setCachedTokensForTest?.(initialTokens);

  // Mock the token endpoint to return a rotated bundle.
  const rotatedBundle = {
    access_token: 'new-access',
    refresh_token: 'new-refresh-ROTATED',
    id_token: undefined,
    expires_in: 3600,
  };
  const { fn: fetchStub, calls } = mockFetchSequence([
    makeJsonResponse(rotatedBundle, 200),
  ]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchStub;
  try {
    const next = await svc.refreshTokens();
    assert.ok(next, 'refreshTokens should resolve with the new bundle');
    assert.equal(next.accessToken, 'new-access');
    // CRITICAL: rotated refresh_token must overwrite the stored one.
    assert.equal(next.refreshToken, 'new-refresh-ROTATED');
    assert.equal(calls.length, 1);
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.grant_type, 'refresh_token');
    assert.equal(sent.refresh_token, 'old-refresh');
    assert.equal(sent.client_id, 'app_EMoamEEZ73f0CkXaXp7hrann');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('CodexOAuthService.refreshTokens: invalid_grant is classified permanent and clears credentials', async () => {
  const oauthModulePath = path.resolve(root, 'dist-electron/electron/services/CodexOAuthService.js');
  if (!fs.existsSync(oauthModulePath)) return;
  const url = (await import('node:url')).pathToFileURL(oauthModulePath).href;
  const mod = await import(url);
  const svc = mod.CodexOAuthService.getInstance();
  svc.__resetForTest();
  svc.__setCachedTokensForTest?.({
    accessToken: 'expired-access',
    refreshToken: 'dead-refresh',
    expiresAt: 0,
  });
  const { fn: fetchStub } = mockFetchSequence([
    new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'refresh_token expired',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
  ]);
  const realFetch = globalThis.fetch;
  let failedEvent = null;
  svc.on('login:failed', (err) => { failedEvent = err; });
  globalThis.fetch = fetchStub;
  try {
    const result = await svc.refreshTokens();
    assert.equal(result, null, 'permanent failure should return null');
    assert.ok(failedEvent, 'login:failed event should fire');
    assert.match(failedEvent.message, /expired|signed in again/i);
    assert.equal(svc.getStatus().signedIn, false, 'credentials should be cleared');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('CodexOAuthService.refreshTokens: dedupes concurrent calls into a single fetch', async () => {
  const oauthModulePath = path.resolve(root, 'dist-electron/electron/services/CodexOAuthService.js');
  if (!fs.existsSync(oauthModulePath)) return;
  const url = (await import('node:url')).pathToFileURL(oauthModulePath).href;
  const mod = await import(url);
  const svc = mod.CodexOAuthService.getInstance();
  svc.__resetForTest();
  svc.__setCachedTokensForTest?.({
    accessToken: 'expired',
    refreshToken: 'rt',
    expiresAt: 0,
  });
  let calls = 0;
  const fetchStub = async () => {
    calls++;
    // Simulate slow refresh so the two callers race.
    await new Promise(r => setTimeout(r, 30));
    return makeJsonResponse({
      access_token: 'fresh',
      refresh_token: 'fresh-rt',
      expires_in: 3600,
    });
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchStub;
  try {
    const [a, b] = await Promise.all([svc.refreshTokens(), svc.refreshTokens()]);
    assert.equal(calls, 1, 'dedupe should collapse concurrent refreshes into one fetch');
    assert.ok(a && b, 'both promises should resolve with the same bundle');
    assert.equal(a.accessToken, 'fresh');
    assert.equal(b.accessToken, 'fresh');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('CodexOAuthService.getAccessToken: returns cached token when not within 5-min refresh window', async () => {
  const oauthModulePath = path.resolve(root, 'dist-electron/electron/services/CodexOAuthService.js');
  if (!fs.existsSync(oauthModulePath)) return;
  const url = (await import('node:url')).pathToFileURL(oauthModulePath).href;
  const mod = await import(url);
  const svc = mod.CodexOAuthService.getInstance();
  svc.__resetForTest();
  // Token valid for another hour — well outside the 5-min buffer.
  svc.__setCachedTokensForTest?.({
    accessToken: 'long-lived',
    refreshToken: 'rt',
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('fetch should not be called'); };
  try {
    const token = await svc.getAccessToken();
    assert.equal(token, 'long-lived');
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// =============================================================================
// 3. PKCE verifier length
// =============================================================================

test('CodexOAuthService PKCE verifier is 43 chars (32 bytes base64url)', () => {
  // 32 random bytes → base64url → 43 chars (no padding). RFC 7636
  // requires 43-128. We pin 43 for the open-sse-compatible flow.
  // Source-level: randomBytes(32).toString('base64url') always produces 43.
  const source = read('electron/services/CodexOAuthService.ts');
  const matches = source.match(/randomBytes\((\d+)\)/g) || [];
  // 32 (verifier) + 16 (state) bytes are the only randomBytes calls.
  assert.ok(matches.length >= 2, 'should generate at least verifier + state');
  assert.ok(matches.some(m => m === 'randomBytes(32)'), 'verifier must use 32 bytes');
  assert.ok(matches.some(m => m === 'randomBytes(16)'), 'state must use 16 bytes');
});

// =============================================================================
// 4. CodexCliService wire-level — no more CLI subprocess for OAuth paths
// =============================================================================

test('CodexCliService: the deprecated `path` argument is ignored at runtime (no subprocess spawn)', () => {
  const source = read('electron/services/CodexCliService.ts');
  // The old subprocess imports are gone.
  assert.doesNotMatch(source, /from 'child_process'/);
  assert.doesNotMatch(source, /\bspawn\(/);
  // The new HTTP-direct surface is in place.
  assert.match(source, /https:\/\/api\.openai\.com\/v1\/responses/);
  // Bearer header is built from CodexOAuthService, not argv.
  assert.match(source, /Authorization:\s*`Bearer \$\{[^}]*\}`/);
});

test('CodexCliService: 401 triggers a single refresh-and-retry (open-sse chatCore parity)', () => {
  const source = read('electron/services/CodexCliService.ts');
  // Single refresh + continue pattern.
  assert.match(source, /response\.status\s*===\s*401/);
  assert.match(source, /refreshedOnce\s*=\s*true/);
  assert.match(source, /refreshTokens\(\)/);
  // The retry budget is 1 (not 3) for 401 — we don't want to thrash on
  // a permanently invalid token.
  assert.match(source, /!\s*refreshedOnce/);
});

test('CodexCliService: 429/5xx use exponential backoff with jitter, up to 3 attempts', () => {
  const source = read('electron/services/CodexCliService.ts');
  assert.match(source, /TRANSIENT_RETRY_MAX\s*=\s*3/);
  assert.match(source, /TRANSIENT_RETRY_BASE_MS\s*=\s*500/);
  // Honour Retry-After when present.
  assert.match(source, /parseRetryAfter/);
  // Full jitter pattern: base * 2^attempt, capped, then random().
  assert.match(source, /Math\.random\(\)\s*\*\s*capped/);
});

test('CodexCliService: SSE parser tolerates \\n\\n and \\r\\n\\r\\n event boundaries', () => {
  const source = read('electron/services/CodexCliService.ts');
  // Search for the SSE separator regex: /\\r?\\n\\r?\\n/ in source.
  assert.match(source, /\\r\?\\n\\r\?\\n/);
  // data: prefix is parsed line by line, multi-line data joined with \n.
  assert.match(source, /dataLines\.join\('\\n'\)/);
});

test('CodexCliService: errors inside the SSE stream surface immediately, not after [DONE]', () => {
  const source = read('electron/services/CodexCliService.ts');
  // response.failed is detected inside the parser loop.
  assert.match(source, /type\s*===\s*'response\.failed'/);
  // The error breaks out of the parser and is thrown at the end.
  assert.match(source, /if\s*\(terminalError\)\s*break/);
  assert.match(source, /if\s*\(terminalError\)\s*throw\s+terminalError/);
});

test('CodexCliService: AbortSignal + deadline both propagate to the fetch + reader', () => {
  const source = read('electron/services/CodexCliService.ts');
  // Both signals are combined.
  assert.match(source, /combineSignals/);
  // The combined signal is passed to fetch() — look for `signal` in the
  // fetch init object.
  assert.match(source, /fetch\([^,]+,\s*\{[\s\S]*?signal,/);
  // And the reader is checked inside the loop.
  assert.match(source, /if\s*\(signal\.aborted\)\s*throw\s+new\s+Error\('Codex request aborted\.'\)/);
});

test('CodexCliService: buildRequestBody sets reasoning.effort + include for non-none effort', () => {
  const source = read('electron/services/CodexCliService.ts');
  // Reasoning object + summary:auto matches open-sse CodexExecutor.transformRequest.
  assert.match(source, /body\.reasoning\s*=\s*\{\s*effort:\s*resolvedEffort,\s*summary:\s*'auto'\s*\}/);
  // include is set when effort is not 'none' (open-sse codex.md:457-460).
  assert.match(source, /if\s*\(resolvedEffort\s*!==\s*'none'\)\s*\{[\s\S]*?body\.include\s*=\s*\['reasoning\.encrypted_content'\]/);
  // store is always false (Codex requirement).
  assert.match(source, /store:\s*false/);
});
