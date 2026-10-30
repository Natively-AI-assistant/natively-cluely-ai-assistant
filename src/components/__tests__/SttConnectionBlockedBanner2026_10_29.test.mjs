// A Windows customer's transcription only worked after turning off Kaspersky,
// Defender and the firewall (2026-10-29). Meanwhile the overlay said "Check
// your transcription provider and its key in Settings" — the one thing that
// was fine — and only in English, to a Spanish speaker.
//
//  - Node's own certificate errors (what an antivirus re-signing the
//    connection produces) read as "Secure Connection Blocked", not as a lost
//    internet connection or a provider fault;
//  - the banner tells an intercepted or unreachable connection apart from a
//    key or provider problem and gives the advice that fits;
//  - every sentence the banner shows has a row in src/i18n.sttStatus.ts for
//    ru / zh / ja / es, and the table carries no leftover rows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { categorizeSttError, sttConnectionCause } from '../../lib/sttErrorMapper.ts';
import { makeFakeAvChain } from '../../../electron/utils/__tests__/fakeAvChain.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** The exact message and code Node gives for a connection re-signed by an unknown root. */
async function realInterceptedError() {
  const chain = makeFakeAvChain();
  const server = https.createServer({
    key: chain.serverKeyPem,
    cert: chain.serverPem,
  }, (_req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await new Promise((resolve) => {
      https.get(`https://localhost:${server.address().port}/`, (res) => { res.resume(); resolve(null); })
        .on('error', (err) => resolve(err));
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Node\'s real certificate error reads as Secure Connection Blocked', async () => {
  const err = await realInterceptedError();
  assert.ok(err, 'the fake antivirus root must be rejected');
  // main.ts appends the code: "<message> (<CODE>)".
  const raw = `${err.message} (${err.code})`;
  const c = categorizeSttError(raw);
  assert.equal(c.category, 'secure_connection_blocked', raw);
  assert.equal(c.title, 'Secure Connection Blocked');
  assert.match(c.body, /antivirus/i);
  // The bare message alone is enough too (providers that drop the code).
  assert.equal(categorizeSttError(err.message).category, 'secure_connection_blocked', err.message);
});

test('every certificate error an interceptor causes is caught', () => {
  for (const raw of [
    'self-signed certificate in certificate chain',
    'self signed certificate in certificate chain',
    'unable to get local issuer certificate',
    'Hostname/IP does not match certificate\'s altnames: Host: api.natively.software. is not in the cert\'s altnames',
    'certificate has expired (CERT_HAS_EXPIRED)',
    'socket hang up (DEPTH_ZERO_SELF_SIGNED_CERT)',
  ]) {
    assert.equal(categorizeSttError(raw).category, 'secure_connection_blocked', raw);
  }
});

test('the other categories keep their meaning', () => {
  assert.equal(categorizeSttError('401 Unauthorized').category, 'auth');
  assert.equal(categorizeSttError('read ECONNRESET (ECONNRESET)').category, 'connection_lost');
  assert.equal(categorizeSttError('connect ETIMEDOUT 1.2.3.4:443 (ETIMEDOUT)').category, 'timed_out');
  assert.equal(categorizeSttError('transcription_quota_exceeded').category, 'quota');
});

test('the banner cause: intercepted, unreachable, or neither', () => {
  assert.equal(sttConnectionCause(['unable to verify the first certificate (UNABLE_TO_VERIFY_LEAF_SIGNATURE)', '']), 'secure-connection');
  // An intercepted channel wins over a merely unreachable one.
  assert.equal(sttConnectionCause(['read ECONNRESET', 'self-signed certificate in certificate chain']), 'secure-connection');
  assert.equal(sttConnectionCause(['', 'connect ECONNREFUSED 1.2.3.4:443']), 'unreachable');
  assert.equal(sttConnectionCause(['connect ETIMEDOUT 1.2.3.4:443']), 'unreachable');
  assert.equal(sttConnectionCause(['401 Unauthorized']), null);
  assert.equal(sttConnectionCause(['', '']), null);
});

test('the overlay banner picks its advice from the cause', () => {
  const src = read('components/NativelyInterface.tsx');
  assert.match(src, /import \{ categorizeSttError, sttConnectionCause \} from '\.\.\/lib\/sttErrorMapper';/);
  const start = src.indexOf('const sttConnectionAdvice');
  const end = src.indexOf('// Whether the vision chip will render', start);
  assert.ok(start > 0 && end > start, 'banner block found');
  const block = src.slice(start, end);
  assert.match(block, /sttConnectionCause\(\[/);
  assert.match(block, /sttConnectionAdvice \?\? t\('Check your transcription provider and its key in Settings\.'\)/);
  assert.match(block, /sttConnectionAdvice \?\? t\('Retrying\.'\)/);
});

test('every banner sentence is translated, and the table has no leftover rows', async () => {
  const src = read('components/NativelyInterface.tsx');
  // From the advice to the backup-provider banner, whose sentences live elsewhere.
  const start = src.indexOf('const sttConnectionAdvice');
  const end = src.indexOf("title: t('Transcribing on a backup provider')", start);
  assert.ok(start > 0 && end > start, 'banner block found');
  const block = src.slice(start, end);
  const used = [...block.matchAll(/\bt\('((?:[^'\\]|\\.)+)'\)/g)].map((m) => m[1].replace(/\\'/g, "'"));
  assert.ok(used.length >= 9, `found ${used.length} sentences`);

  const table = await import(pathToFileURL(path.join(SRC, 'i18n.sttStatus.ts')).href);
  const rows = new Set(table.STT_STATUS_EN);
  for (const sentence of used) assert.ok(rows.has(sentence), `no translation row for: ${sentence}`);
  for (const row of rows) assert.ok(used.includes(row), `leftover row: ${row}`);
  for (const lang of ['RU', 'ZH', 'JA', 'ES']) {
    const column = table[`STT_STATUS_${lang}`];
    for (const sentence of used) {
      assert.ok(column[sentence] && column[sentence] !== sentence, `${lang} missing: ${sentence}`);
    }
  }

  const i18n = read('i18n.tsx');
  for (const lang of ['RU', 'ZH', 'JA', 'ES']) assert.match(i18n, new RegExp(`\\.\\.\\.STT_STATUS_${lang},`));
});
