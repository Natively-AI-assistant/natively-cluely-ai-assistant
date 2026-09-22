// F-201 regression pin (audit/autopilot-2026-08-14).
//
// ws@8 close() on a CONNECTING socket emits the abort error on the next tick
// unconditionally; the strip-then-close pattern (removeAllListeners() then
// close()) therefore produces a listener-less 'error' emit → process-level
// uncaughtException → main.ts's emergencyCloseDatabase (irreversible; on
// this branch the process keeps running with dead persistence).
// Live-reproduced through the real OpenAI provider (stalled TLS handshake)
// in scripts/audit/F-201-repro.mjs. Related: main's 21c4e22f fixes the
// NativelyProSTT site with fuller lifecycle machinery.
//
// Contracts pinned here: no STT provider file contains a bare
// strip-then-close on a WebSocket; every former site routes through
// safeDetachAndClose (which re-attaches a no-op error sink before close).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audioDir = path.join(__dirname, '..', '..', 'audio');

const PROVIDER_FILES = [
  'OpenAIStreamingSTT.ts',
  'ElevenLabsStreamingSTT.ts',
  'NativelyProSTT.ts',
  'SonioxStreamingSTT.ts',
  'DeepgramStreamingSTT.ts',
];

test('no STT provider strips listeners and closes a ws without an error sink', () => {
  for (const file of PROVIDER_FILES) {
    const p = path.join(audioDir, file);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    const bare = src.match(/removeAllListeners\(\)[^\n]*;?\s*\n\s*(?:this\.ws|ws|dying|socket)\??\.close\(\)/g) ?? [];
    // try{...}catch wrappers around the same adjacency count too — the emit
    // is asynchronous, so try/catch does not contain it.
    const bareTry = src.match(/removeAllListeners\(\);\s*\}\s*catch\s*\{\s*\}\s*\n\s*try\s*\{\s*(?:this\.ws|ws|dying|socket)\??\.close\(\)/g) ?? [];
    assert.equal(
      bare.length + bareTry.length,
      0,
      `${file}: bare strip-then-close on a WebSocket — a CONNECTING socket's abort error escapes as uncaughtException → irreversible DB shutdown (F-201). Use safeDetachAndClose.`
    );
  }
});

test('every former strip-then-close site keeps an error sink across the close', () => {
  // The contract is that an 'error' listener survives the close, NOT that a
  // particular function spells it. Two sites route through the shared helper.
  //
  // NativelyProSTT does not, deliberately: main's 21c4e22f had already fixed
  // this site with fuller lifecycle machinery (this file's own header and
  // wsSafeTeardown.ts's module doc both say so). Its inline version is the
  // stronger of the two — it strips per-event instead of blanket-stripping,
  // attaches error+close listeners that RELEASE EACH OTHER on close so a
  // discarded socket does not retain a listener forever (these sockets are
  // cycled every meeting, where the helper's permanent no-op sink accumulates),
  // and it distinguishes CONNECTING/OPEN from CLOSING/CLOSED. Requiring it to
  // adopt the helper would be a downgrade, so assert the invariant instead.
  for (const file of ['OpenAIStreamingSTT.ts', 'ElevenLabsStreamingSTT.ts']) {
    const src = fs.readFileSync(path.join(audioDir, file), 'utf8');
    assert.ok(
      /safeDetachAndClose\(/.test(src),
      `${file}: expected safeDetachAndClose usage (F-201)`
    );
  }

  const proSrc = fs.readFileSync(path.join(audioDir, 'NativelyProSTT.ts'), 'utf8');
  const sinkIdx = proSrc.search(/dying\.on\(\s*'error'/);
  const closeIdx = proSrc.search(/dying\.close\(\)/);
  assert.ok(
    sinkIdx >= 0,
    'NativelyProSTT.ts: the detached socket must keep an error sink — ws@8 emits the abort error one '
    + 'tick after close() on a CONNECTING socket, and a listener-less emit becomes an uncaughtException '
    + 'that irreversibly closes the database (F-201).'
  );
  assert.ok(
    closeIdx > sinkIdx,
    'NativelyProSTT.ts: the error sink must be attached BEFORE close() — attaching it afterwards loses '
    + 'the race with abortHandshake()\'s next-tick emit.'
  );
});

test('safeDetachAndClose attaches the error sink between strip and close', () => {
  const src = fs.readFileSync(path.join(audioDir, 'wsSafeTeardown.ts'), 'utf8');
  // lastIndexOf: the doc comment quotes the anti-pattern; the code comes last.
  const strip = src.lastIndexOf('removeAllListeners()');
  const sink = src.lastIndexOf("ws.on('error'");
  const close = src.lastIndexOf('ws.close()');
  assert.ok(strip !== -1 && sink !== -1 && close !== -1, 'helper structure missing');
  assert.ok(strip < sink && sink < close, 'error sink must be attached AFTER stripping and BEFORE close()');
});
