// The opt-in diagnostic report, device side (2026-11-18, #759).
// What a person agrees to when they click "Send diagnostic report": the
// connection check's result and the tail of the app's own log, masked a second
// time here. The text shown in the preview IS the text sent. Pure: the log is
// passed in, the network is injected, so macOS and Windows run the same cases.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tailLog, maskLog, buildDiagnosticReport, sendDiagnosticReport, LOG_LIMITS } from '../diagnosticReport.ts';
import { checkFunnelProps } from '../../../src/lib/funnel/funnelCatalog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALL = '0f8fad5b-d9cb-469f-a165-70867728950e';
// The real credential masker, as the app injects it; a stand-in that masks the one shape these tests use.
const maskCredentials = (t) => t.replace(/natively_sk_[A-Za-z0-9_-]{6,}/g, 'natively_sk_…');

describe('tailLog', () => {
  test('keeps the newest lines, never half a line', () => {
    const text = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n');
    const t = tailLog(text, { lines: 5, chars: 10_000 });
    assert.equal(t, 'line 995\nline 996\nline 997\nline 998\nline 999');
  });
  test('the character limit cuts on a line boundary, newest kept', () => {
    const text = ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)].join('\n');
    const t = tailLog(text, { lines: 100, chars: 120 });
    assert.equal(t, `${'b'.repeat(50)}\n${'c'.repeat(50)}`);
  });
  test('one line longer than the limit is cut, not dropped', () => {
    assert.equal(tailLog('x'.repeat(500), { lines: 10, chars: 100 }).length, 100);
  });
  test('Windows line endings and an empty log', () => {
    assert.equal(tailLog('a\r\nb\r\nc', { lines: 2, chars: 100 }), 'b\nc');
    assert.equal(tailLog('', LOG_LIMITS), '');
  });
});

describe('maskLog: a second pass over a log that was already redacted', () => {
  const mask = (s) => maskLog(s, maskCredentials);
  test('keys, e-mail addresses, ids and addresses', () => {
    const out = mask('key natively_sk_abcdef123456 mail jo.doe+x@example.co.uk id 0f8fad5b-d9cb-469f-a165-70867728950e ip 203.0.113.9 v6 2001:db8:85a3::8a2e:370:7334 Bearer abcdefghijklmnop');
    for (const leak of ['abcdef123456', 'jo.doe', 'example.co.uk', '0f8fad5b', '203.0.113.9', '2001:db8', 'abcdefghijklmnop']) assert.ok(!out.includes(leak), leak);
  });
  test('the person\'s name in a home folder, on either OS', () => {
    const out = mask('at /Users/evin/Library/Logs/x.log and C:\\Users\\Eugene Lopin\\AppData\\Roaming\\Natively\\y and /home/sam/.config/z');
    assert.ok(!/evin|Eugene|Lopin|sam\b/.test(out), out);
    assert.match(out, /\/Users\/<user>\/Library/);
    assert.match(out, /C:\\Users\\<user>\\AppData/);
  });
  test('what support needs survives: codes, hosts, versions, our own words', () => {
    const line = '[ProReconciler] plan lookup failed: fetch failed (CERT_HAS_EXPIRED) api.natively.software v3.2.1 ETIMEDOUT retrying in 30s';
    assert.equal(mask(line), line);
  });
  test('masking twice is the same as once', () => {
    const once = mask('a@b.co 203.0.113.9 /Users/evin/x');
    assert.equal(mask(once), once);
  });
});

describe('buildDiagnosticReport', () => {
  const diag = { reason: 'pro_check', verdict: 'stale_store', report: { reason: 'pro_check', verdict: 'stale_store', tls_builtin: 'ok', tls_merged: 'cert_has_expired', certs_merged: 22, healed: false } };
  const build = (over = {}) => buildDiagnosticReport({ logText: 'one\ntwo natively_sk_abcdef123456\nthree', installId: INSTALL, appVersion: '3.2.1', platform: 'win32', diagnosis: diag, mask: maskCredentials, ...over });

  test('the payload says it was sent by the person, and masks the log', () => {
    const { payload } = build();
    assert.equal(payload.sent_by_user, true);
    assert.equal(payload.install_id, INSTALL);
    assert.equal(payload.verdict, 'stale_store');
    assert.equal(payload.reason, 'pro_check');
    assert.ok(!payload.log_text.includes('abcdef123456'));
    assert.equal(checkFunnelProps('connect_diag', payload.report).ok, true);
  });
  test('the preview shows exactly the log that is sent, with its header', () => {
    const { payload, preview } = build();
    assert.ok(preview.includes(payload.log_text));
    assert.match(preview, /stale_store/);
    assert.match(preview, /3\.2\.1/);
    assert.ok(!preview.includes('abcdef123456'));
  });
  test('without a connection check the log still goes: reason "manual", no verdict', () => {
    const { payload } = build({ diagnosis: undefined });
    assert.equal(payload.reason, 'manual');
    assert.equal(payload.verdict, undefined);
    assert.equal(payload.report, undefined);
  });
  test('a report that would fail the catalogue is left out, not sent', () => {
    const { payload } = build({ diagnosis: { reason: 'pro_check', verdict: 'blocked', report: { note: 'free text' } } });
    assert.equal(payload.report, undefined);
    assert.equal(payload.verdict, 'blocked');
  });
  test('the log is cut to the limits before it is masked and sent', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
    const { payload } = build({ logText: big });
    assert.ok(payload.log_text.length <= LOG_LIMITS.chars);
    assert.ok(payload.log_text.split('\n').length <= LOG_LIMITS.lines);
    assert.ok(payload.log_text.endsWith('line 4999 ' + 'x'.repeat(40)));
  });

  // The server's own validator accepts what the app builds (skipped when the API checkout is absent).
  const serverFile = [path.resolve(HERE, '../../../natively-api/diagnosticReports.js'), '/Users/evin/natively-cluely-ai-assistant/natively-api/diagnosticReports.js'].find((p) => fs.existsSync(p));
  test('the server validator accepts it', { skip: serverFile ? false : 'natively-api/diagnosticReports.js not present' }, async () => {
    const server = await import(pathToFileURL(serverFile).href);
    for (const d of [diag, undefined]) {
      const { payload } = build({ diagnosis: d });
      const r = server.normalizeDiagnosticBody(payload);
      assert.equal(r.ok, true, JSON.stringify(r));
    }
  });
});

describe('sendDiagnosticReport', () => {
  const payload = { schema: 1, sent_by_user: true, install_id: INSTALL, log_text: 'x' };
  const send = (fetchImpl) => sendDiagnosticReport({ payload, endpoint: 'https://example.test/v1/diagnostics/report', headers: async () => ({ 'x-install-id': INSTALL, 'x-install-token': 't' }), fetchImpl, timeoutMs: 50 });
  const answer = (status, json = {}) => async () => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });

  test('201 → the reference to quote to support', async () => {
    const r = await send(answer(201, { ok: true, ref: 'abcd1234' }));
    assert.deepEqual(r, { ok: true, ref: 'abcd1234' });
  });
  test('sends JSON with the identity headers', async () => {
    let got;
    await send(async (url, init) => { got = { url, init }; return new Response('{"ok":true,"ref":"r"}', { status: 201 }); });
    assert.equal(got.init.method, 'POST');
    assert.equal(got.init.headers['content-type'], 'application/json');
    assert.equal(got.init.headers['x-install-id'], INSTALL);
    assert.equal(JSON.parse(got.init.body).sent_by_user, true);
  });
  test('each failure has its own plain outcome', async () => {
    assert.deepEqual(await send(answer(429)), { ok: false, error: 'rate_limited' });
    assert.deepEqual(await send(answer(503)), { ok: false, error: 'unavailable' });
    assert.deepEqual(await send(answer(401)), { ok: false, error: 'rejected' });
    assert.deepEqual(await send(answer(403)), { ok: false, error: 'rejected' });
    assert.deepEqual(await send(answer(413)), { ok: false, error: 'rejected' });
    assert.deepEqual(await send(async () => { throw new TypeError('fetch failed'); }), { ok: false, error: 'network' });
    assert.deepEqual(await send(() => new Promise(() => {})), { ok: false, error: 'network' });
  });
  test('headers that cannot be built do not stop the attempt or throw', async () => {
    const r = await sendDiagnosticReport({ payload, endpoint: 'https://example.test/x', headers: async () => { throw new Error('x'); }, fetchImpl: answer(401), timeoutMs: 50 });
    assert.deepEqual(r, { ok: false, error: 'rejected' });
  });
});
