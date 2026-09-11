// Issue #558 — a successful `codex login` counted for nothing: Natively only
// accepted its own ChatGPT sign-in. The Codex CLI's session in
// `$CODEX_HOME/auth.json` is now used READ-ONLY when Natively is not signed in
// itself. Never refreshed: ChatGPT OAuth rotates the refresh token, so a
// Natively refresh would sign the CLI out.
//
// Tokens here are synthetic JWTs. Every OS-facing input (env, home dir, path
// flavour, file reads, clock) is injected, so the macOS and Windows branches
// both run on either host without touching process.platform. The one live
// check this file cannot make — a VALID real `codex login` against the backend —
// needs a machine with a fresh CLI login.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/CodexCliAuth2026_09_11.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

// Hermetic: never read the developer's real `codex login`.
process.env.CODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-codex-home-'));

const dist = (p) => pathToFileURL(path.join(root, 'dist-electron/electron/services', p)).href;
const { parseCodexAuthJson, readCodexCliAuth, resetCodexCliAuthCache, CODEX_CLI_TOKEN_SKEW_MS } = await import(dist('CodexCliAuth.js'));
const {
  CodexCliService, getCodexAuthStatus, codexSignedOutMessage, isCodexAuthError,
  CODEX_NOT_SIGNED_IN_MESSAGE, CODEX_CLI_LOGIN_EXPIRED_MESSAGE,
} = await import(dist('CodexCliService.js'));
const { CodexOAuthService } = await import(dist('CodexOAuthService.js'));

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;
const accessToken = (expMs, accountId = 'acct-from-claim') =>
  jwt({ exp: Math.floor(expMs / 1000), 'https://api.openai.com/auth': { chatgpt_account_id: accountId } });
const idToken = jwt({ email: 'ana@example.com', exp: Math.floor((NOW + 3600e3) / 1000) });
const authJson = ({ exp = NOW + 10 * 86400e3, mode = 'chatgpt', accountId = 'acct-123', withTokens = true, apiKey = null } = {}) =>
  JSON.stringify({
    auth_mode: mode,
    OPENAI_API_KEY: apiKey,
    ...(withTokens ? { tokens: { id_token: idToken, access_token: accessToken(exp), refresh_token: 'rt', account_id: accountId } } : {}),
    last_refresh: '2026-09-10T00:00:00Z',
  });

describe('parseCodexAuthJson', () => {
  test('a valid ChatGPT login yields the token, account id and email', () => {
    const s = parseCodexAuthJson(authJson(), NOW);
    assert.equal(s.status, 'ok');
    assert.ok(s.accessToken.split('.').length === 3);
    assert.equal(s.accountId, 'acct-123');
    assert.equal(s.email, 'ana@example.com');
    assert.equal(s.expiresAt, Math.floor((NOW + 10 * 86400e3) / 1000) * 1000);
  });

  test('account id falls back to the access token\'s chatgpt_account_id claim', () => {
    assert.equal(parseCodexAuthJson(authJson({ accountId: '' }), NOW).accountId, 'acct-from-claim');
  });

  test('an expired token is "expired", not usable — Natively never refreshes it', () => {
    const s = parseCodexAuthJson(authJson({ exp: NOW - 18 * 86400e3 }), NOW);
    assert.equal(s.status, 'expired');
    assert.equal(s.email, 'ana@example.com', 'email still shown so the UI can say whose login expired');
    assert.ok(!('accessToken' in s));
  });

  test('a token inside the skew window counts as expired', () => {
    assert.equal(parseCodexAuthJson(authJson({ exp: NOW + CODEX_CLI_TOKEN_SKEW_MS - 1000 }), NOW).status, 'expired');
    assert.equal(parseCodexAuthJson(authJson({ exp: NOW + CODEX_CLI_TOKEN_SKEW_MS + 60_000 }), NOW).status, 'ok');
  });

  test('an API-key CLI login is unusable — the ChatGPT backend takes only ChatGPT tokens', () => {
    assert.equal(parseCodexAuthJson(authJson({ mode: 'apikey' }), NOW).status, 'api-key');
    assert.equal(parseCodexAuthJson(authJson({ mode: undefined, withTokens: false, apiKey: 'sk-test' }), NOW).status, 'api-key');
  });

  test('malformed files are "invalid", never a throw', () => {
    assert.equal(parseCodexAuthJson('not json', NOW).status, 'invalid');
    assert.equal(parseCodexAuthJson('{}', NOW).status, 'invalid');
    assert.equal(parseCodexAuthJson(JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'not-a-jwt' } }), NOW).status, 'invalid');
    assert.equal(parseCodexAuthJson(JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: jwt({ sub: 'x' }) } }), NOW).status, 'invalid');
  });
});

describe('readCodexCliAuth', () => {
  beforeEach(() => resetCodexCliAuthCache());
  const stat = () => ({ mtimeMs: 1, size: 10 });

  test('macOS: reads ~/.codex/auth.json', () => {
    const reads = [];
    const s = readCodexCliAuth({
      env: {}, homeDir: '/Users/ana', pathImpl: path.posix, now: () => NOW, statSync: stat,
      readFileSync: (p) => { reads.push(p); return authJson(); },
    });
    assert.deepEqual(reads, ['/Users/ana/.codex/auth.json']);
    assert.equal(s.status, 'ok');
  });

  test('Windows: reads %USERPROFILE%\\.codex\\auth.json, CODEX_HOME honoured', () => {
    const reads = [];
    const read = (env) => readCodexCliAuth({
      env, homeDir: 'C:\\Users\\Ana Maria', pathImpl: path.win32, now: () => NOW, statSync: stat,
      readFileSync: (p) => { reads.push(p); return authJson(); },
    });
    read({}); read({ CODEX_HOME: 'D:\\codex' });
    assert.deepEqual(reads, ['C:\\Users\\Ana Maria\\.codex\\auth.json', 'D:\\codex\\auth.json']);
  });

  test('no auth.json (CLI never logged in) is "missing"', () => {
    const s = readCodexCliAuth({
      env: {}, homeDir: '/Users/ana', pathImpl: path.posix, now: () => NOW,
      statSync: () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
      readFileSync: () => { throw new Error('unreachable'); },
    });
    assert.equal(s.status, 'missing');
  });

  test('force re-reads even when size and mtime are unchanged', () => {
    let reads = 0;
    const opts = {
      env: {}, homeDir: '/Users/ana', pathImpl: path.posix, now: () => NOW, statSync: stat,
      readFileSync: () => { reads++; return authJson(); },
    };
    readCodexCliAuth(opts); readCodexCliAuth(opts);
    assert.equal(reads, 1);
    readCodexCliAuth({ ...opts, force: true });
    assert.equal(reads, 2);
  });

  test('re-reads only when the file changes; expiry is re-checked every call', () => {
    let reads = 0; let mtimeMs = 1; let now = NOW;
    const opts = {
      env: {}, homeDir: '/Users/ana', pathImpl: path.posix, now: () => now,
      statSync: () => ({ mtimeMs, size: 10 }),
      readFileSync: () => { reads++; return authJson({ exp: NOW + 3600e3 }); },
    };
    readCodexCliAuth(opts); readCodexCliAuth(opts);
    assert.equal(reads, 1, 'unchanged file is not re-read');
    now = NOW + 2 * 3600e3;
    assert.equal(readCodexCliAuth(opts).status, 'expired', 'cached file, fresh clock');
    mtimeMs = 2;
    readCodexCliAuth(opts);
    assert.equal(reads, 2, 'the CLI rewrote the file (its own refresh) → re-read');
  });
});

describe('getCodexAuthStatus (what routing and the renderer see)', () => {
  // Tests run signed out of Natively's own ChatGPT sign-in.
  CodexOAuthService.getInstance().__resetForTest?.();
  CodexOAuthService.getInstance().signOut();
  const cli = (state) => () => state;

  test('a valid CLI login signs Codex in, and the token is NOT in the status', () => {
    const s = getCodexAuthStatus(cli({ status: 'ok', accessToken: 'secret-token', accountId: 'a', email: 'ana@example.com', expiresAt: NOW + 1 }));
    assert.deepEqual(s, { signedIn: true, source: 'codex-cli', email: 'ana@example.com', expiresAt: NOW + 1, cliLogin: 'ok' });
    assert.ok(!JSON.stringify(s).includes('secret-token'));
  });

  test('an expired CLI login is signed out, with the CLI-specific message', () => {
    const s = getCodexAuthStatus(cli({ status: 'expired', email: 'ana@example.com', expiresAt: NOW - 1 }));
    assert.equal(s.signedIn, false);
    assert.equal(s.cliLogin, 'expired');
    assert.equal(codexSignedOutMessage(s), CODEX_CLI_LOGIN_EXPIRED_MESSAGE);
  });

  test('no CLI login and no Natively sign-in → the general sign-in message, naming both routes', () => {
    for (const status of ['missing', 'api-key', 'invalid']) {
      const s = getCodexAuthStatus(cli({ status }));
      assert.equal(s.signedIn, false, status);
      assert.equal(codexSignedOutMessage(s), CODEX_NOT_SIGNED_IN_MESSAGE, status);
    }
    assert.match(CODEX_NOT_SIGNED_IN_MESSAGE, /Settings → AI Providers/);
    assert.match(CODEX_NOT_SIGNED_IN_MESSAGE, /codex login/);
  });

  test('every Codex sign-in message is recognised as an actionable auth error (shown verbatim in chat)', () => {
    assert.ok(isCodexAuthError(new Error(CODEX_CLI_LOGIN_EXPIRED_MESSAGE)));
    assert.ok(isCodexAuthError(new Error(CODEX_NOT_SIGNED_IN_MESSAGE)));
  });
});

describe('a 401 on the CLI session', () => {
  // PR #563 review: the metadata cache keys on mtime+size. A CLI refresh that
  // writes a same-length token within the timestamp resolution leaves both
  // unchanged, so the post-401 re-read must bypass the cache or it reuses the
  // rejected token and wrongly reports the fresh login as expired.
  test('a rotation that keeps size and mtime is picked up: the retry sends the new token', async () => {
    CodexOAuthService.getInstance().signOut();
    resetCodexCliAuthCache();
    const file = path.join(process.env.CODEX_HOME, 'auth.json');
    const exp = Math.floor((Date.now() + 5 * 86400e3) / 1000);
    const tokenFor = (jti) => jwt({ exp, jti, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-123' } });
    const fileFor = (jti) => JSON.stringify({
      auth_mode: 'chatgpt', OPENAI_API_KEY: null,
      tokens: { id_token: idToken, access_token: tokenFor(jti), refresh_token: 'rt', account_id: 'acct-123' },
      last_refresh: '2026-09-10T00:00:00Z',
    });
    assert.equal(fileFor('A').length, fileFor('B').length, 'same-length rotation');
    const pinned = new Date('2026-01-01T00:00:00Z');
    fs.writeFileSync(file, fileFor('A'));
    fs.utimesSync(file, pinned, pinned);
    assert.equal(readCodexCliAuth().status, 'ok', 'cache warmed with token A');

    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      sent.push(String(init.headers.Authorization).replace(/^Bearer /, ''));
      if (sent.length === 1) {
        // The CLI refreshed its session while this request was in flight.
        fs.writeFileSync(file, fileFor('B'));
        fs.utimesSync(file, pinned, pinned);
        return new Response('{"detail":"token expired"}', { status: 401 });
      }
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"ok"}\n\n'
        + 'data: {"type":"response.completed","response":{}}\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    };
    try {
      const out = await CodexCliService.run('', { prompt: 'hi', model: 'gpt-5.5', timeoutMs: 5_000 });
      assert.equal(out, 'ok');
      assert.deepEqual(sent, [tokenFor('A'), tokenFor('B')]);
    } finally {
      globalThis.fetch = realFetch;
      fs.rmSync(file, { force: true });
      resetCodexCliAuthCache();
    }
  });
});

describe('wiring guards', () => {
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

  test('the CLI session is never refreshed or written by Natively', () => {
    const src = read('electron/services/CodexCliAuth.ts');
    assert.doesNotMatch(src, /writeFile|refresh_token['"]?\s*[:=]|oauth\/token/);
    const svc = read('electron/services/CodexCliService.ts');
    const cliBranch = svc.slice(svc.indexOf("credential.source === 'codex-cli'"), svc.indexOf('if (response.status === 401 && !refreshedOnce)'));
    assert.ok(cliBranch.length > 0, '401 branch for the CLI source not found');
    assert.doesNotMatch(cliBranch, /refreshTokens/, 'a 401 on the CLI session must not refresh it');
  });

  test('manual chat refuses a signed-out Codex selection instead of silently answering elsewhere', () => {
    const ipc = read('electron/ipcHandlers.ts');
    assert.match(ipc, /getCodexSelectionAuthError\(\)[\s\S]{0,200}gemini-stream-error/);
  });

  test('the model picker lists Codex only with a usable sign-in', () => {
    const picker = read('src/components/ModelSelectorWindow.tsx');
    assert.match(picker, /codexCliConfig\?\.enabled && codexSignedIn/);
  });
});
