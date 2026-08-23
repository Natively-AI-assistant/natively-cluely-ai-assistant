// F-302 regression test (audit/autopilot-2026-08-18).
//
// The primary manual-chat path set its "first useful" flag on ANY token
// object, while every other call site in the repo uses a content threshold
// (>=5/8/10 chars). raceStreamWithDeadline forwards every yielded value
// unfiltered, so a leading "\n\n" flipped the flag and (a) swapped the 7s
// first-useful budget for the 8s inter-token stall guard, and (b) made the
// blank-answer fallback unreachable for a whitespace-only response —
// committing an EMPTY bubble, which is exactly what the comment above that
// fallback promises never happens.
//
// Measured in scripts/audit/F-302-repro.mjs: pre-fix stall_timeout at 8003ms
// with the fallback suppressed; post-fix first_useful_timeout at ~700ms with
// the fallback firing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const distLlm = path.join(root, 'dist-electron/electron/llm');
const src = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

test('the manual-chat useful predicate requires real content, not just a token', () => {
  const i = src.indexOf('isUsefulYet: () => manualFirstUseful');
  assert.notEqual(i, -1, 'manual-chat deadline wiring not found');
  const onToken = src.indexOf('onToken: (token: string) => {', i);
  assert.notEqual(onToken, -1);
  // Window sized from the CLOSING of the guard rather than a fixed byte count:
  // a fixed window silently fails the moment an explanatory comment grows (it
  // did, for R-09), which reads as a regression when nothing behavioural moved.
  const guard = src.indexOf('manualFirstUseful = true;', onToken);
  assert.notEqual(guard, -1, 'the useful-flag assignment must follow onToken');
  const body = src.slice(onToken, guard + 40);
  assert.ok(
    !/onToken: \(token: string\) => \{\s*\n\s*manualFirstUseful = true;/.test(body),
    'manualFirstUseful must not be set unconditionally on any token (F-302)'
  );
  assert.ok(
    /trim\(\)\.length[\s\S]{0,80}>=\s*\d+[\s\S]{0,80}manualFirstUseful = true/.test(body),
    'the flag must be gated on accumulated trimmed content reaching a threshold (F-302)'
  );
});

test('whitespace-only output leaves the turn not-useful so the fallback can fire', async () => {
  const { raceStreamWithDeadline } = await import(pathToFileURL(path.join(distLlm, 'liveDeadlines.js')).href);
  async function* whitespaceThenHang() { yield '\n\n'; await new Promise(() => {}); }

  let text = '';
  let useful = false;
  const outcome = await raceStreamWithDeadline({
    stream: whitespaceThenHang(),
    firstUsefulDeadlineMs: 400,
    isUsefulYet: () => useful,
    shouldAbort: () => false,
    onFirstUsefulTimeout: () => {},
    onStallTimeout: () => {},
    onCleanup: () => {},
    onToken: (token) => {
      if (text.trim().length + token.trim().length >= 5) useful = true;
      text += token;
    },
  });

  assert.equal(outcome, 'first_useful_timeout',
    'a whitespace-only stream must time out on the FIRST-USEFUL budget, not drift onto the stall guard');
  assert.equal(useful, false);
  assert.ok(!useful && !text.trim(),
    'the blank-answer fallback predicate (!useful && !text.trim()) must be true so a real answer is substituted');
});
