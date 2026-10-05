import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadPage() {
  const built = path.join(root, 'dist-electron/electron/services/oauth/callbackPage.js');
  assert.ok(fs.existsSync(built), `compiled callbackPage is missing: ${built}`);
  return import(pathToFileURL(built).href);
}

const PROVIDERS = ['codex', 'antigravity', 'calendar'];
const OUTCOMES = [{ kind: 'returned' }, { kind: 'connected' }, { kind: 'error', reason: 'Denied.' }];

test('every provider × outcome renders a locked-down page with no network subresources', async () => {
  const { renderOAuthCallbackPage } = await loadPage();
  for (const provider of PROVIDERS) {
    for (const outcome of OUTCOMES) {
      const { headers, body } = renderOAuthCallbackPage(provider, outcome, 'darwin');
      assert.equal(headers['Content-Type'], 'text/html; charset=utf-8');
      assert.match(headers['Content-Security-Policy'], /default-src 'none'/);
      assert.equal(headers['Referrer-Policy'], 'no-referrer');
      assert.equal(headers['Cache-Control'], 'no-store');
      assert.match(body, new RegExp(`data-state="${outcome.kind}"`));
      // The callback URL carries ?code= and the Calendar server closes right after
      // answering: nothing may be fetched from anywhere.
      assert.doesNotMatch(body, /(src|href)="https?:/i, `${provider}/${outcome.kind} references a remote resource`);
      assert.doesNotMatch(body, /url\(\s*['"]?https?:/i);
    }
  }
});

test('the only script runs under the nonce the CSP names, and it strips the code from the URL', async () => {
  const { renderOAuthCallbackPage } = await loadPage();
  const { headers, body } = renderOAuthCallbackPage('codex', { kind: 'returned' }, 'darwin');
  const nonce = /'nonce-([^']+)'/.exec(headers['Content-Security-Policy'])?.[1];
  assert.ok(nonce);
  const scripts = [...body.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0][1].trim(), `nonce="${nonce}"`);
  assert.match(scripts[0][2], /history\.replaceState\(null,\s*"",\s*location\.pathname\)/);
  const again = renderOAuthCallbackPage('codex', { kind: 'returned' }, 'darwin');
  assert.notEqual(/'nonce-([^']+)'/.exec(again.headers['Content-Security-Policy'])?.[1], nonce);
});

test('a hostile error reason is escaped, not rendered', async () => {
  const { renderOAuthCallbackPage, describeOAuthError } = await loadPage();
  const reason = describeOAuthError('invalid_request', '<img src=x onerror=alert(1)>"\'&');
  const { body } = renderOAuthCallbackPage('antigravity', { kind: 'error', reason }, 'win32');
  assert.doesNotMatch(body, /<img src=x/);
  assert.match(body, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/);
});

test('describeOAuthError: consent denial, description, bare code, nothing', async () => {
  const { describeOAuthError } = await loadPage();
  assert.equal(describeOAuthError('access_denied', 'ignored'), 'Access was declined on the consent screen.');
  assert.equal(describeOAuthError('invalid_scope', 'Scope not allowed'), 'Scope not allowed');
  assert.equal(describeOAuthError('server_error'), 'The provider returned “server_error”.');
  assert.equal(describeOAuthError(null, null), 'The sign-in response was incomplete.');
  assert.equal(describeOAuthError('x', 'y'.repeat(1000)).length, 300);
});

test('copy never claims "connected" before the token exchange has run', async () => {
  const { renderOAuthCallbackPage } = await loadPage();
  for (const provider of ['codex', 'antigravity']) {
    const { body } = renderOAuthCallbackPage(provider, { kind: 'returned' }, 'darwin');
    assert.doesNotMatch(body, /connected/i, `${provider} "returned" page mentions connected`);
    assert.match(body, /<h1 class="reveal">Signed in to (ChatGPT|Google)<\/h1>/);
    assert.match(body, /Natively is finishing setup/);
  }
  const { body } = renderOAuthCallbackPage('calendar', { kind: 'connected' }, 'darwin');
  assert.match(body, /<h1 class="reveal">Google Calendar connected<\/h1>/);
  assert.match(body, /Connected<\/span>/);
});

test('error pages show the reason and no success tick', async () => {
  const { renderOAuthCallbackPage } = await loadPage();
  const { body } = renderOAuthCallbackPage('calendar', { kind: 'error', reason: 'Expired.' }, 'darwin');
  assert.doesNotMatch(body, /class="tick"/);
  assert.match(body, /<div class="reason reveal">Expired\.<\/div>/);
  assert.match(body, /<h1 class="reveal">Couldn’t sign in<\/h1>/);
  assert.match(body, /Not connected<\/span>/);
});

test('the real Natively app icon is inlined for the page and the favicon', async () => {
  const { renderOAuthCallbackPage } = await loadPage();
  const { body } = renderOAuthCallbackPage('codex', { kind: 'returned' }, 'darwin');
  const icons = body.match(/data:image\/webp;base64,[A-Za-z0-9+/=]{1000,}/g) || [];
  assert.equal(icons.length, 3, 'favicon, the blurred aura behind the glass, and the icon itself');
  assert.match(body, /<img class="app-icon" src="data:image\/webp;base64,[^"]+" alt="Natively"/);
  assert.match(body, /<link rel="icon" href="data:image\/webp;base64,/);
});

test('each provider shows its own account mark', async () => {
  const { renderOAuthCallbackPage } = await loadPage();
  assert.match(renderOAuthCallbackPage('codex', { kind: 'returned' }, 'darwin').body, /class="badge openai"/);
  assert.match(renderOAuthCallbackPage('antigravity', { kind: 'returned' }, 'darwin').body, /class="badge google"/);
  assert.match(renderOAuthCallbackPage('calendar', { kind: 'connected' }, 'darwin').body, /class="badge google"/);
});

test('close-tab shortcut follows the platform: ⌘W on darwin, Ctrl+W on win32', async () => {
  const { renderOAuthCallbackPage } = await loadPage();
  const mac = renderOAuthCallbackPage('codex', { kind: 'returned' }, 'darwin').body;
  const win = renderOAuthCallbackPage('codex', { kind: 'returned' }, 'win32').body;
  assert.match(mac, /data-fallback="Press ⌘W"/);
  assert.doesNotMatch(mac, /Ctrl\+W/);
  assert.match(win, /data-fallback="Press Ctrl\+W"/);
  assert.doesNotMatch(win, /⌘W/);
});

test('the embedded font is allowed by the CSP and declared as a variable face', async () => {
  const { renderOAuthCallbackPage } = await loadPage();
  const { headers, body } = renderOAuthCallbackPage('codex', { kind: 'returned' }, 'darwin');
  assert.match(headers['Content-Security-Policy'], /font-src data:/);
  assert.match(body, /@font-face\{font-family:"Instrument Sans";src:url\(data:font\/woff2;base64,/);
  assert.match(body, /font-weight:400 700;font-stretch:75% 100%/);
  // System fonts stay behind it for glyphs outside the subset (⌘, provider error text).
  assert.match(body, /--font:"Instrument Sans",-apple-system/);
});

test('no inline event handlers: the CSP would block them, so the nonced script wires the buttons', async () => {
  const { renderOAuthCallbackPage } = await loadPage();
  for (const outcome of OUTCOMES) {
    const { body } = renderOAuthCallbackPage('calendar', outcome, 'win32');
    assert.doesNotMatch(body, /\son[a-z]+\s*=/i);
  }
});

test('success offers Close tab with a keyboard fallback; errors offer Copy details without secrets', async () => {
  const { renderOAuthCallbackPage } = await loadPage();
  const ok = renderOAuthCallbackPage('codex', { kind: 'returned' }, 'win32').body;
  assert.match(ok, /<button type="button" id="close" data-fallback="Press Ctrl\+W">/);
  assert.doesNotMatch(ok, /id="copy"/);
  const mac = renderOAuthCallbackPage('calendar', { kind: 'connected' }, 'darwin').body;
  assert.match(mac, /data-fallback="Press ⌘W"/);

  const err = renderOAuthCallbackPage('antigravity', { kind: 'error', reason: 'Access was declined on the consent screen.' }, 'darwin').body;
  assert.doesNotMatch(err, /id="close"/);
  const details = /id="copy" data-details="([^"]*)"/.exec(err)?.[1];
  assert.equal(details, 'Natively sign-in: Antigravity\nReason: Access was declined on the consent screen.');
  assert.doesNotMatch(details, /code|state/i);
});
