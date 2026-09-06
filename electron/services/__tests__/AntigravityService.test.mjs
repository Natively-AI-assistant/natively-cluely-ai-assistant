import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const fakeElectron = { shell: { openExternal: async () => undefined } };
const originalModuleLoad = Module._load;
Module._load = function patchedModuleLoad(request, parent, isMain) {
  if (request === 'electron') return fakeElectron;
  return originalModuleLoad.call(this, request, parent, isMain);
};

async function loadService() {
  const built = path.join(root, 'dist-electron/electron/services/AntigravityService.js');
  assert.ok(fs.existsSync(built), `compiled AntigravityService is missing: ${built}`);
  return import(pathToFileURL(built).href);
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}


function requestCallback(pathname, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: 51121,
      path: pathname,
      method,
      headers,
    }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
    request.end();
  });
}

async function assertCallbackPortFree() {
  const probe = http.createServer();
  try {
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(51121, '127.0.0.1', resolve); });
  } finally { await new Promise(resolve => probe.close(resolve)); }
}

function storageWith(tokens, save = true) {
  let current = tokens ? { ...tokens } : null;
  return {
    getAntigravityOAuthTokens: () => current && { ...current },
    setAntigravityOAuthTokens: next => {
      if (!save) return false;
      current = { ...next };
      return true;
    },
    clearAntigravityOAuthTokens: () => {
      if (!save) return false;
      current = null;
      return true;
    },
    current: () => current && { ...current },
  };
}

function prepareService(mod, stored) {
  const service = mod.AntigravityService.getInstance();
  const oldGetter = service.getCredentialsManager;
  service.dispose();
  service.getCredentialsManager = () => stored;
  service.initialize();
  return { service, oldGetter };
}

function cleanupService(service, oldGetter) {
  try { service.signOut(); } catch { /* noop */ }
  service.dispose();
  service.getCredentialsManager = oldGetter;
}

async function waitForBrowserUrl(opened) {
  for (let i = 0; i < 100 && !opened.value; i += 1) await delay(10);
  assert.ok(opened.value, 'browser URL should be opened after the listener binds');
  return new URL(opened.value);
}

test('Antigravity pins the Voice-app OAuth contract', async () => {
  const mod = await loadService();
  assert.equal(mod.ANTIGRAVITY_CLIENT_ID, '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com');
  assert.equal(mod.ANTIGRAVITY_REDIRECT_URI, 'http://localhost:51121/oauth-callback');
  assert.equal(mod.ANTIGRAVITY_TOKEN_URL, 'https://oauth2.googleapis.com/token');
  assert.deepEqual(mod.ANTIGRAVITY_SCOPES, [
    'openid',
    ...['cloud-platform', 'userinfo.email', 'userinfo.profile', 'cclog', 'experimentsandconfigs']
      .map(scope => `https://www.googleapis.com/auth/${scope}`),
  ]);
});

test('Antigravity PKCE uses a 32-byte base64url verifier and S256 challenge', async () => {
  const mod = await loadService();
  const pkce = mod.generateAntigravityPkce();
  assert.equal(pkce.verifier.length, 43);
  assert.match(pkce.verifier, /^[A-Za-z0-9_-]+$/);
  assert.equal(
    pkce.challenge,
    crypto.createHash('sha256').update(pkce.verifier).digest('base64url'),
  );
  const url = new URL(mod.buildAntigravityAuthorizationUrl(pkce));
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:51121/oauth-callback');
  assert.equal(url.searchParams.get('scope'), mod.ANTIGRAVITY_SCOPES.join(' '));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
});

test('Antigravity filters and orders only quota-bearing public models', async () => {
  const mod = await loadService();
  const models = mod.parseAntigravityModels({ models: {
    'gemini-3.6-flash-low': { displayName: 'Flash low', quotaInfo: { remainingFraction: 0.4 } },
    'gemini-3-flash': { displayName: 'Flash', quotaInfo: { remainingFraction: 0.4 } },
    'zeta-flash': { displayName: 'Zeta', quotaInfo: { remainingFraction: 0.4 } },
    'alpha-pro': { displayName: 'Alpha', quotaInfo: { remainingFraction: 0.4 } },
    'internal': { displayName: 'Internal', quotaInfo: { remainingFraction: 0.4 }, isInternal: true },
    'no-quota': { displayName: 'No quota', quotaInfo: { remainingFraction: 0 } },
    'gemini-3.5-flash': { displayName: 'Old', quotaInfo: { remainingFraction: 1 } },
    'foo-image': { displayName: 'Image', quotaInfo: { remainingFraction: 1 } },
    'flash-lite': { displayName: 'Flash Lite', quotaInfo: { remainingFraction: 1 } },
  } });
  assert.deepEqual(models.map(model => model.id), [
    'gemini-3.6-flash-low', 'gemini-3-flash', 'zeta-flash', 'alpha-pro',
  ]);
  assert.equal(mod.resolveAntigravityWireModel('models/Gemini-3.7-flash-low'), 'gemini-3.7-flash-tiered');
  assert.equal(mod.resolveAntigravityWireModel('gemini-3.6-flash-low'), 'gemini-3.6-flash-tiered');
  assert.equal(mod.resolveAntigravityWireModel('gemini-3.1-pro-high'), 'gemini-pro-agent');
});

test('Antigravity request payload and SSE parser match the Code Assist wire shape', async () => {
  const mod = await loadService();
  const payload = mod.buildAntigravityRequestPayload({
    projectId: 'account-project',
    model: 'gemini-3.7-flash-low',
    systemPrompt: 'Use the existing Natively answer rules.',
    userPrompt: 'Answer this.',
    images: [{ mimeType: 'image/png', data: 'aGVsbG8=' }],
    maxOutputTokens: 77,
  });
  assert.equal(payload.model, 'gemini-3.7-flash-tiered');
  assert.equal(payload.project, 'account-project');
  assert.match(payload.requestId, /^agent-[0-9a-f-]{36}$/);
  assert.equal(payload.requestType, 'agent');
  assert.equal(payload.request.contents[0].parts[0].text, 'System instruction: Use the existing Natively answer rules.');
  assert.deepEqual(payload.request.contents[1].parts[1].inlineData, { mimeType: 'image/png', data: 'aGVsbG8=' });
  assert.deepEqual(payload.request.generationConfig, {
    candidateCount: 1,
    maxOutputTokens: 77,
    temperature: 0.45,
    thinkingConfig: { thinkingLevel: 'low' },
  });
  assert.deepEqual(mod.parseAntigravityEvent(JSON.stringify({ response: {
    candidates: [{ content: { parts: [
      { text: 'Hello ' }, { thought: true, text: 'hidden' }, { text: 'world' },
    ] }, finishReason: 'STOP' }],
  } })), 'Hello world');
  assert.throws(() => mod.parseAntigravityEvent('{bad-json}'), /malformed streaming data/i);
});

test('Antigravity refresh rotates tokens, deduplicates, and sends form headers', async () => {
  const mod = await loadService();
  const service = mod.AntigravityService.getInstance();
  const oldGetter = service.getCredentialsManager;
  const stored = storageWith({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 0, projectId: 'p' });
  service.getCredentialsManager = () => stored;
  service.initialize();
  const originalFetch = globalThis.fetch;
  const calls = [];
  let release;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    await new Promise(resolve => { release = resolve; });
    return jsonResponse({ access_token: 'new-access', refresh_token: 'rotated-refresh', expires_in: 3600 });
  };
  try {
    const a = service.refreshTokens();
    const b = service.refreshTokens();
    await delay(5);
    assert.equal(calls.length, 1);
    release();
    const [nextA, nextB] = await Promise.all([a, b]);
    assert.equal(nextA.accessToken, 'new-access');
    assert.equal(nextB.refreshToken, 'rotated-refresh');
    assert.equal(stored.current().refreshToken, 'rotated-refresh');
    assert.equal(calls[0].url, mod.ANTIGRAVITY_TOKEN_URL);
    assert.equal(calls[0].init.headers['User-Agent'], mod.GOOGLE_API_USER_AGENT);
    const form = new URLSearchParams(calls[0].init.body);
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('refresh_token'), 'old-refresh');
    assert.equal(form.get('client_id'), mod.ANTIGRAVITY_CLIENT_ID);
  } finally {
    globalThis.fetch = originalFetch;
    service.dispose();
    service.getCredentialsManager = oldGetter;
  }
});

test('Antigravity failed persistence and logout races never adopt new tokens', async () => {
  const mod = await loadService();
  const service = mod.AntigravityService.getInstance();
  const oldGetter = service.getCredentialsManager;
  const originalFetch = globalThis.fetch;
  const stored = storageWith({ accessToken: 'old', refreshToken: 'old-refresh', expiresAt: 0, projectId: 'p' }, false);
  service.getCredentialsManager = () => stored;
  service.initialize();
  globalThis.fetch = async () => jsonResponse({ access_token: 'new', refresh_token: 'new-refresh', expires_in: 3600 });
  await assert.rejects(service.refreshTokens(), error => error.code === 'storage');
  assert.equal(stored.current().accessToken, 'old');

  let release;
  const raceStorage = storageWith({ accessToken: 'old', refreshToken: 'old-refresh', expiresAt: 0, projectId: 'p' });
  service.getCredentialsManager = () => raceStorage;
  service.initialize();
  globalThis.fetch = async () => {
    await new Promise(resolve => { release = resolve; });
    return jsonResponse({ access_token: 'late', refresh_token: 'late-refresh', expires_in: 3600 });
  };
  const pending = service.refreshTokens();
  await delay(5);
  const signout = service.signOut();
  assert.equal(signout.success, true);
  release();
  await assert.rejects(pending, error => error.code === 'cancelled');
  assert.equal(service.getStatus().signedIn, false);
  assert.equal(raceStorage.current(), null);
  globalThis.fetch = originalFetch;
  service.dispose();
  service.getCredentialsManager = oldGetter;
});

test('Antigravity callback validates host/state and releases the fixed listener', async () => {
  const mod = await loadService();
  const electron = fakeElectron;
  const service = mod.AntigravityService.getInstance();
  const oldGetter = service.getCredentialsManager;
  const oldOpen = electron.shell.openExternal;
  const oldFetch = globalThis.fetch;
  const stored = storageWith(null);
  service.getCredentialsManager = () => stored;
  service.initialize();
  const opened = {};
  electron.shell.openExternal = async url => { opened.value = url; };
  globalThis.fetch = async (url) => {
    if (url === mod.ANTIGRAVITY_TOKEN_URL) return jsonResponse({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    if (url.endsWith('/v1internal:loadCodeAssist')) return jsonResponse({ cloudaicompanionProject: 'project-from-google' });
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const login = service.startLogin();
    const state = (await waitForBrowserUrl(opened)).searchParams.get('state');
    assert.ok(state);
    assert.equal(await requestCallback(`/oauth-callback?code=wrong&state=${state}`, { host: 'evil.test' }), 400);
    assert.equal(await requestCallback(`http://evil.test/oauth-callback?code=wrong&state=${state}`, { host: 'localhost:51121' }), 400);
    assert.equal(await requestCallback('/oauth-callback?code=stale&state=old-attempt'), 400);
    assert.equal(await requestCallback('/oauth-callback?code=missing-state'), 400);
    assert.equal(service.getStatus().inProgress, true, 'unrelated callbacks must not consume the active login');
    assert.equal(await requestCallback(`/oauth-callback?code=auth-code&state=${state}`, { host: 'localhost:51121' }), 200);
    const tokens = await login;
    assert.equal(tokens.projectId, 'project-from-google');
    assert.equal(service.getStatus().signedIn, true);
    assert.equal(stored.current().projectId, 'project-from-google');
  } finally {
    service.signOut();
    service.dispose();
    service.getCredentialsManager = oldGetter;
    electron.shell.openExternal = oldOpen;
    globalThis.fetch = oldFetch;
  }
});

const validTokens = () => ({ accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000, projectId: 'p' });
const catalog = { models: { 'gemini-3-flash': { displayName: 'Flash', quotaInfo: { remainingFraction: 1 } } } };
const answer = JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }] } });
const collect = async stream => { let text = ''; for await (const chunk of stream) text += chunk; return text; };

test('failed disconnect preserves connected state until credentials are actually cleared', async () => {
  const mod = await loadService();
  const stored = storageWith(validTokens());
  const { service, oldGetter } = prepareService(mod, stored);
  const clear = stored.clearAntigravityOAuthTokens;
  stored.clearAntigravityOAuthTokens = () => false;
  try {
    assert.equal(service.signOut().success, false);
    assert.equal(service.getStatus().signedIn, true);
    assert.match(service.getStatus().error, /Disconnect failed/);
    assert.equal(await service.getAccessToken(), 'access');
    service.dispose();
    service.initialize();
    assert.equal(service.getStatus().signedIn, true, 'restart must agree with the failed disconnect status');
    stored.clearAntigravityOAuthTokens = clear;
    assert.equal(service.signOut().success, true);
    assert.equal(stored.current(), null);
    service.dispose();
    service.initialize();
    assert.equal(service.getStatus().signedIn, false, 'successful disconnect must survive restart');
  } finally { stored.clearAntigravityOAuthTokens = clear; cleanupService(service, oldGetter); }
});

test('only OAuth invalid_grant clears credentials; transient refresh and invalid expiry preserve them', async () => {
  const mod = await loadService();
  const oldFetch = globalThis.fetch;
  for (const [status, body, revoked] of [
    [503, { error: 'temporarily_unavailable', error_description: 'upstream session expired' }, false],
    [400, { error: 'invalid_client' }, false],
    [200, { access_token: 'new', expires_in: 0 }, false],
    [400, { error: 'invalid_grant' }, true],
  ]) {
    const stored = storageWith(validTokens());
    const { service, oldGetter } = prepareService(mod, stored);
    globalThis.fetch = async () => jsonResponse(body, status);
    try {
      await assert.rejects(service.refreshTokens(), error => error.code === (revoked ? 'auth_revoked' : 'token_refresh'));
      assert.equal(service.getStatus().signedIn, !revoked);
      assert.equal(stored.current()?.accessToken ?? null, revoked ? null : 'access');
    } finally { cleanupService(service, oldGetter); globalThis.fetch = oldFetch; }
  }
});

test('models and inference replay a 401 once with refreshed access; 403 retains the session', async () => {
  const mod = await loadService();
  const oldFetch = globalThis.fetch;
  for (const operation of ['models', 'stream']) {
    for (const status of [401, 403]) {
      const stored = storageWith(validTokens());
      const { service, oldGetter } = prepareService(mod, stored);
      let resourceCalls = 0;
      let refreshCalls = 0;
      globalThis.fetch = async (url, init) => {
        if (url === mod.ANTIGRAVITY_TOKEN_URL) {
          refreshCalls++;
          return jsonResponse({ access_token: 'refreshed', expires_in: 3600 });
        }
        resourceCalls++;
        assert.equal(init.headers.Authorization, `Bearer ${resourceCalls === 1 ? 'access' : 'refreshed'}`);
        if (resourceCalls === 1) return jsonResponse({ error: 'rejected' }, status);
        return operation === 'models' ? jsonResponse(catalog) : jsonResponse(JSON.parse(answer));
      };
      try {
        const pending = operation === 'models' ? service.getModels(true) : collect(service.stream({ model: 'gemini-3-flash', userPrompt: 'Question' }));
        if (status === 403) await assert.rejects(pending, error => error.status === 403);
        else assert.deepEqual(await pending, operation === 'models' ? [{ id: 'gemini-3-flash', label: 'Flash' }] : 'answer');
        assert.equal(resourceCalls, status === 401 ? 2 : 1);
        assert.equal(refreshCalls, status === 401 ? 1 : 0);
        assert.equal(stored.current().refreshToken, 'refresh', 'missing refresh token must retain the existing one');
        assert.equal(service.getStatus().signedIn, true);
      } finally { cleanupService(service, oldGetter); globalThis.fetch = oldFetch; }
    }
  }
});

test('disconnect blocks requests queued before token acquisition and discards late model discovery', async () => {
  const mod = await loadService();
  const oldFetch = globalThis.fetch;
  for (const operation of ['models', 'stream', 'late-models']) {
    const stored = storageWith(validTokens());
    const { service, oldGetter } = prepareService(mod, stored);
    let calls = 0;
    let release;
    globalThis.fetch = async () => {
      calls++;
      await new Promise(resolve => { release = resolve; });
      return jsonResponse(catalog);
    };
    try {
      const pending = operation === 'stream' ? collect(service.stream({ model: 'gemini-3-flash', userPrompt: 'Q' })) : service.getModels(true);
      if (operation === 'late-models') await delay(5);
      service.signOut();
      release?.();
      await assert.rejects(pending, error => error.code === 'cancelled');
      assert.equal(calls, operation === 'late-models' ? 1 : 0);
      assert.equal(service.cachedModels, null);
      assert.equal(stored.current(), null);
    } finally { cleanupService(service, oldGetter); globalThis.fetch = oldFetch; }
  }
});

test('revocation during a 401 retry reports authentication failure instead of user cancellation', async () => {
  const mod = await loadService();
  const oldFetch = globalThis.fetch;
  for (const operation of ['models', 'stream']) {
    const { service, oldGetter } = prepareService(mod, storageWith(validTokens()));
    globalThis.fetch = async url => url === mod.ANTIGRAVITY_TOKEN_URL
      ? jsonResponse({ error: 'invalid_grant' }, 400) : jsonResponse({}, 401);
    try {
      const pending = operation === 'models' ? service.getModels(true) : collect(service.stream({ model: 'gemini-3-flash', userPrompt: 'Q' }));
      await assert.rejects(pending, error => error.code === 'auth_revoked');
      assert.equal(service.getStatus().signedIn, false);
    } finally { cleanupService(service, oldGetter); globalThis.fetch = oldFetch; }
  }
});

test('disconnect aborts a stream after headers and never returns buffered stale text', async () => {
  const mod = await loadService();
  const { service, oldGetter } = prepareService(mod, storageWith(validTokens()));
  const oldFetch = globalThis.fetch;
  let requestSignal;
  globalThis.fetch = async (_url, init) => {
    requestSignal = init.signal;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${answer}\n\n`));
      init.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
    } }));
  };
  try {
    const stream = service.stream({ model: 'gemini-3-flash', userPrompt: 'Q' });
    assert.equal((await stream.next()).value, 'answer');
    const pending = stream.next();
    service.signOut();
    await assert.rejects(pending, error => error.code === 'cancelled');
    assert.equal(requestSignal.aborted, true);
  } finally { cleanupService(service, oldGetter); globalThis.fetch = oldFetch; }
});

test('DNS resolution failures retry, other network and HTTP failures do not', async () => {
  const mod = await loadService();
  const oldFetch = globalThis.fetch;
  for (const failure of ['ENOTFOUND', 'ENETUNREACH', 'http']) {
    const { service, oldGetter } = prepareService(mod, storageWith(validTokens()));
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls > 1) return jsonResponse(catalog);
      if (failure === 'http') return jsonResponse({}, 503);
      throw new TypeError('fetch failed', { cause: { code: failure } });
    };
    try {
      if (failure === 'ENOTFOUND') assert.equal((await service.getModels(true)).length, 1);
      else await assert.rejects(service.getModels(true));
      assert.equal(calls, failure === 'ENOTFOUND' ? 2 : 1);
      assert.deepEqual([12, 4, 3, 2, 1].map(mod.dnsRetryDelayMillis), [250, 250, 500, 1000, 2000]);
    } finally { cleanupService(service, oldGetter); globalThis.fetch = oldFetch; }
  }
});

test('callback handles denial, missing code, cancellation and browser failure with cleanup', async () => {
  const mod = await loadService();
  const oldFetch = globalThis.fetch;
  const oldOpen = fakeElectron.shell.openExternal;
  for (const scenario of ['denied', 'missing-code', 'cancel', 'browser']) {
    const stored = storageWith(null);
    const { service, oldGetter } = prepareService(mod, stored);
    const opened = {};
    let networkCalls = 0;
    fakeElectron.shell.openExternal = async url => {
      opened.value = url;
      if (scenario === 'browser') throw new Error('browser unavailable');
    };
    globalThis.fetch = async () => { networkCalls++; throw new Error('unexpected exchange'); };
    try {
      const login = service.startLogin();
      const rejected = assert.rejects(login, error => error.code === (scenario === 'cancel' ? 'cancelled' : scenario === 'browser' ? 'browser' : 'callback'));
      const url = await waitForBrowserUrl(opened);
      const state = url.searchParams.get('state');
      if (scenario === 'cancel') service.cancelLogin();
      else if (scenario !== 'browser') {
        assert.equal(await requestCallback('/oauth-callback', {}, 'POST'), 405);
        const query = scenario === 'denied' ? `error=access_denied&state=${state}` : `state=${state}`;
        await requestCallback(`/oauth-callback?${query}`);
      }
      await rejected;
      assert.equal(networkCalls, 0);
      assert.equal(stored.current(), null);
      assert.equal(service.getStatus().inProgress, false);
      await assertCallbackPortFree();
    } finally { cleanupService(service, oldGetter); globalThis.fetch = oldFetch; fakeElectron.shell.openExternal = oldOpen; }
  }
});

test('busy callback port fails before opening the browser', async () => {
  const mod = await loadService();
  const { service, oldGetter } = prepareService(mod, storageWith(null));
  const blocker = http.createServer();
  const oldOpen = fakeElectron.shell.openExternal;
  let opened = false;
  fakeElectron.shell.openExternal = async () => { opened = true; };
  try {
    await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(51121, '127.0.0.1', resolve); });
    await assert.rejects(service.startLogin(), /port is busy/);
    assert.equal(opened, false);
  } finally {
    await new Promise(resolve => blocker.close(resolve));
    cleanupService(service, oldGetter);
    fakeElectron.shell.openExternal = oldOpen;
  }
});

test('OAuth exchange and onboarding use reference headers, PKCE verifier, selected tier and account project', async () => {
  const mod = await loadService();
  const stored = storageWith(null);
  const { service, oldGetter } = prepareService(mod, stored);
  const oldFetch = globalThis.fetch;
  const oldOpen = fakeElectron.shell.openExternal;
  const opened = {};
  let polls = 0;
  fakeElectron.shell.openExternal = async url => { opened.value = url; };
  globalThis.fetch = async (url, init) => {
    if (url === mod.ANTIGRAVITY_TOKEN_URL) {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('redirect_uri'), mod.ANTIGRAVITY_REDIRECT_URI);
      assert.equal(form.get('code'), 'code');
      assert.equal(form.get('client_secret'), mod.ANTIGRAVITY_CLIENT_SECRET);
      assert.equal(crypto.createHash('sha256').update(form.get('code_verifier')).digest('base64url'), new URL(opened.value).searchParams.get('code_challenge'));
      return jsonResponse({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    }
    assert.equal(init.headers.Authorization, 'Bearer access');
    assert.equal(init.headers['User-Agent'], mod.GOOGLE_API_USER_AGENT);
    const body = JSON.parse(init.body);
    assert.equal(body.metadata.ideType, 'ANTIGRAVITY');
    if (url.endsWith(':loadCodeAssist')) return jsonResponse({ allowedTiers: [{ id: 'chosen-tier', isDefault: true }] });
    assert.ok(url.endsWith(':onboardUser'));
    assert.equal(body.tierId, 'chosen-tier');
    polls++;
    return jsonResponse(polls === 1 ? { done: false } : { done: true, response: { cloudaicompanionProject: { id: 'own-project' } } });
  };
  try {
    const login = service.startLogin();
    const url = await waitForBrowserUrl(opened);
    await requestCallback(`/oauth-callback?code=code&state=${url.searchParams.get('state')}`);
    assert.equal((await login).projectId, 'own-project');
    assert.equal(polls, 2);
    assert.equal(stored.current().projectId, 'own-project');
    await assertCallbackPortFree();
  } finally { cleanupService(service, oldGetter); globalThis.fetch = oldFetch; fakeElectron.shell.openExternal = oldOpen; }
});

// A tier carrying `userDefinedCloudaicompanionProject` means Google is waiting
// for a project id this client never sends — onboardUser's LRO can only stay
// pending. The old code polled it five times and reported "did not finish",
// which reads as a transient failure and sent users round the sign-in loop
// forever. Assert it stops before the first onboardUser and says why.
test('a tier that requires a caller-supplied project fails fast instead of polling onboardUser', async () => {
  const mod = await loadService();
  const stored = storageWith(null);
  const { service, oldGetter } = prepareService(mod, stored);
  const oldFetch = globalThis.fetch;
  const oldOpen = fakeElectron.shell.openExternal;
  const opened = {};
  let onboardCalls = 0;
  // Explicitly unset: the fail-fast only fires when no project is supplied, and
  // a stray env var in the runner would silently turn this assertion vacuous.
  const oldEnv = { p: process.env.GOOGLE_CLOUD_PROJECT, i: process.env.GOOGLE_CLOUD_PROJECT_ID };
  delete process.env.GOOGLE_CLOUD_PROJECT; delete process.env.GOOGLE_CLOUD_PROJECT_ID;
  fakeElectron.shell.openExternal = async url => { opened.value = url; };
  globalThis.fetch = async (url, init) => {
    if (url === mod.ANTIGRAVITY_TOKEN_URL) {
      return jsonResponse({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    }
    if (url.endsWith(':loadCodeAssist')) {
      return jsonResponse({ allowedTiers: [{ id: 'standard-tier', isDefault: true, userDefinedCloudaicompanionProject: true }] });
    }
    onboardCalls++;
    return jsonResponse({ done: false });
  };
  try {
    const login = service.startLogin();
    const url = await waitForBrowserUrl(opened);
    // Handler attached BEFORE the callback resolves it — same shape as the
    // cancel/browser/callback cases above. Awaiting requestCallback first
    // leaves a window where the rejection is unhandled and node --test fails
    // the run on that, not on the assertion.
    const rejected = assert.rejects(login, error => error.code === 'setup' && /own Google Cloud project/.test(error.message));
    await requestCallback(`/oauth-callback?code=code&state=${url.searchParams.get('state')}`);
    await rejected;
    assert.equal(onboardCalls, 0, 'onboardUser must not be called when the tier needs a project id');
    await assertCallbackPortFree();
  } finally {
    cleanupService(service, oldGetter); globalThis.fetch = oldFetch; fakeElectron.shell.openExternal = oldOpen;
    if (oldEnv.p !== undefined) process.env.GOOGLE_CLOUD_PROJECT = oldEnv.p;
    if (oldEnv.i !== undefined) process.env.GOOGLE_CLOUD_PROJECT_ID = oldEnv.i;
  }
});

// Google refuses this client the free tier outright (observed live:
// ineligibleTiers [{ tierId: 'free-tier', reasonCode: 'UNSUPPORTED_CLIENT' }]),
// leaving only the bring-your-own-project standard-tier. Assert the supplied
// project reaches BOTH calls — loadCodeAssist as well as onboardUser, which is
// what the reference client does and what this service used to omit entirely.
test('GOOGLE_CLOUD_PROJECT is sent on loadCodeAssist and onboardUser and completes the standard tier', async () => {
  const mod = await loadService();
  const stored = storageWith(null);
  const { service, oldGetter } = prepareService(mod, stored);
  const oldFetch = globalThis.fetch;
  const oldOpen = fakeElectron.shell.openExternal;
  const oldEnv = process.env.GOOGLE_CLOUD_PROJECT;
  const opened = {};
  const sentProject = {};
  process.env.GOOGLE_CLOUD_PROJECT = 'my-gcp-project';
  fakeElectron.shell.openExternal = async url => { opened.value = url; };
  globalThis.fetch = async (url, init) => {
    if (url === mod.ANTIGRAVITY_TOKEN_URL) {
      return jsonResponse({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    }
    const body = JSON.parse(init.body);
    if (url.endsWith(':loadCodeAssist')) {
      sentProject.load = body.cloudaicompanionProject;
      return jsonResponse({ allowedTiers: [{ id: 'standard-tier', isDefault: true, userDefinedCloudaicompanionProject: true }], ineligibleTiers: [{ tierId: 'free-tier', reasonCode: 'UNSUPPORTED_CLIENT' }] });
    }
    sentProject.onboard = body.cloudaicompanionProject;
    return jsonResponse({ done: true, response: { cloudaicompanionProject: { id: 'my-gcp-project' } } });
  };
  try {
    const login = service.startLogin();
    const url = await waitForBrowserUrl(opened);
    await requestCallback(`/oauth-callback?code=code&state=${url.searchParams.get('state')}`);
    assert.equal((await login).projectId, 'my-gcp-project');
    assert.equal(sentProject.load, 'my-gcp-project');
    assert.equal(sentProject.onboard, 'my-gcp-project');
    await assertCallbackPortFree();
  } finally {
    cleanupService(service, oldGetter); globalThis.fetch = oldFetch; fakeElectron.shell.openExternal = oldOpen;
    if (oldEnv === undefined) delete process.env.GOOGLE_CLOUD_PROJECT; else process.env.GOOGLE_CLOUD_PROJECT = oldEnv;
  }
});

test('preferredCloudProject prefers GOOGLE_CLOUD_PROJECT and ignores blank values', async () => {
  const mod = await loadService();
  assert.equal(mod.preferredCloudProject({ GOOGLE_CLOUD_PROJECT: ' a ', GOOGLE_CLOUD_PROJECT_ID: 'b' }), 'a');
  assert.equal(mod.preferredCloudProject({ GOOGLE_CLOUD_PROJECT: '   ', GOOGLE_CLOUD_PROJECT_ID: 'b' }), 'b');
  assert.equal(mod.preferredCloudProject({}), undefined);
});

test.after(() => { Module._load = originalModuleLoad; });
