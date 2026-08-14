// F-201 regression pin (audit/autopilot-2026-08-14).
//
// ws@8 close() on a CONNECTING socket emits the abort error on the next tick
// unconditionally; the strip-then-close pattern (removeAllListeners() then
// close()) therefore produces a listener-less 'error' emit → process-level
// uncaughtException → main.ts's emergencyCloseDatabase (irreversible; on
// this branch the process keeps running with dead persistence).
// Live-reproduced through the real OpenAI provider (stalled TLS handshake)
// in scripts/audit/F-201-repro.mjs. Related: main's 21c4e22f fixes the
// NativelyProSTT site with fuller lifecycle machinery — merge advisory in
// AUDIT_REPORT.md.
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

test('the former strip-then-close sites use safeDetachAndClose', () => {
  for (const file of ['OpenAIStreamingSTT.ts', 'ElevenLabsStreamingSTT.ts', 'NativelyProSTT.ts']) {
    const src = fs.readFileSync(path.join(audioDir, file), 'utf8');
    assert.ok(
      /safeDetachAndClose\(/.test(src),
      `${file}: expected safeDetachAndClose usage (F-201)`
    );
  }
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
