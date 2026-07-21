// Regression test for B1 fix (2026-05-28): the renderer's
// onAudioCaptureFailed handler must surface BOTH 'system' and 'mic'
// channel failures.
//
// Earlier code (NativelyInterface.tsx:929-940 pre-fix) had:
//
//   if (payload.channel !== 'system') return; // mic failures already shown via STT status
//
// That assumption is wrong: stt-status only reports WebSocket state.
// When TCC has silently zero-filled the mic, the WebSocket stays
// "connected" while the audio stream is dead silence, so the user
// saw a green STT status with no transcript and no banner.
//
// The regression we guard against here: a future contributor
// reintroduces the `channel !== 'system'` early-return — the comment
// "mic failures already shown via STT status" is a tempting (and
// wrong) refactor target. This test fails fast if that early-return
// comes back, while still allowing the handler body to gate on
// `terminal || stuck` so transient recovery attempts don't spam the
// banner.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const tsxPath = path.join(root, 'src/components/NativelyInterface.tsx');
const source = fs.readFileSync(tsxPath, 'utf8');

// Extract the onAudioCaptureFailed handler body. We capture from the
// subscription up to the cleanup return, which is the idiomatic shape
// used elsewhere in this file:
//
//   const unsub = window.electronAPI?.onAudioCaptureFailed?.((payload) => {
//     ...handler body...
//   });
//   return () => unsub?.();
const HANDLER_RE =
  /onAudioCaptureFailed\?\.\(\((?:payload|[^)]*)\)\s*=>\s*\{[\s\S]*?\}\s*\)\s*;[\s\S]*?return\s*\(\)\s*=>\s*unsub\?\.\(\)\s*;/g;

describe('B1: mic-channel audio-capture-failed must surface in the renderer', () => {
  it('contains exactly one onAudioCaptureFailed subscription', () => {
    const subscriptions = source.match(/onAudioCaptureFailed/g) || [];
    // We expect: one subscription site. The handler reference may also
    // appear in the electron preload type, but that lives in a
    // different file — within NativelyInterface.tsx itself there should
    // be a single call site.
    assert.equal(
      subscriptions.length,
      1,
      `BUG: expected exactly 1 onAudioCaptureFailed subscription in NativelyInterface.tsx, found ${subscriptions.length}. ` +
        'If you intentionally added a second handler, consolidate them — multiple handlers fragment the surface logic.',
    );
  });

  it('handler body does NOT contain the regression sentinel `payload.channel !== \'system\'`', () => {
    const matches = source.match(HANDLER_RE);
    assert.ok(matches && matches.length === 1, 'could not locate onAudioCaptureFailed handler');
    const body = matches[0];
    assert.ok(
      !/payload\.channel\s*!==\s*['"]system['"]/.test(body),
      'BUG: the early-return `payload.channel !== \'system\'` is back. ' +
        'This drops mic-channel failures (TCC zero-fill, terminal STT init, etc.) ' +
        'and the user sees no banner. See B1 fix (2026-05-28).',
    );
  });

  it('handler body does NOT contain any `channel !== \'system\'` comparison (loose catch)', () => {
    const matches = source.match(HANDLER_RE);
    assert.ok(matches && matches.length === 1, 'could not locate onAudioCaptureFailed handler');
    const body = matches[0];
    // Catches refactors like `const { channel } = payload; if (channel !== 'system') ...`
    assert.ok(
      !/channel\s*!==\s*['"]system['"]/.test(body),
      'BUG: a `channel !== \'system\'` comparison was reintroduced in the handler. ' +
        'Even via destructuring, this filters mic failures out of the banner UX.',
    );
    // Also guard the inverse phrasing `'system' !== ... channel`.
    assert.ok(
      !/['"]system['"]\s*!==\s*[\w.]*channel/.test(body),
      'BUG: inverse-phrased channel filter (`\'system\' !== payload.channel`) was reintroduced.',
    );
  });

  it('handler still gates on `terminal` or `stuck` to avoid banner spam during transient recovery', () => {
    const matches = source.match(HANDLER_RE);
    assert.ok(matches && matches.length === 1, 'could not locate onAudioCaptureFailed handler');
    const body = matches[0];
    assert.match(
      body,
      /payload\.terminal\s*\|\|\s*payload\.stuck|payload\.stuck\s*\|\|\s*payload\.terminal/,
      'BUG: handler must gate on `payload.terminal || payload.stuck`. ' +
        'Without this, every transient capture restart spams the banner — recovery usually succeeds in ~1.5s.',
    );
  });

  it('handler calls setSystemAudioWarning with kind:\'audio-capture-failure\'', () => {
    const matches = source.match(HANDLER_RE);
    assert.ok(matches && matches.length === 1, 'could not locate onAudioCaptureFailed handler');
    const body = matches[0];
    assert.match(
      body,
      /setSystemAudioWarning\s*\(\s*\{[\s\S]*?kind:\s*['"]audio-capture-failure['"]/,
      'BUG: handler must set the warning kind to \'audio-capture-failure\' (not \'screen-recording-permission\'). ' +
        'The banner JSX branches on this discriminant.',
    );
  });

  it('the gate and the setSystemAudioWarning call live within ~30 lines of each other', () => {
    // Defensive: if a contributor splits the handler so the gate guards
    // some OTHER side-effect while a separate code path unconditionally
    // sets the warning, the per-assertion checks above could all pass
    // while the behaviour silently changes. Enforce co-location.
    const matches = source.match(HANDLER_RE);
    assert.ok(matches && matches.length === 1, 'could not locate onAudioCaptureFailed handler');
    const body = matches[0];

    const gateIdx = body.search(/payload\.terminal\s*\|\|\s*payload\.stuck|payload\.stuck\s*\|\|\s*payload\.terminal/);
    const setIdx = body.search(/setSystemAudioWarning\s*\(\s*\{[\s\S]*?kind:\s*['"]audio-capture-failure['"]/);
    assert.ok(gateIdx >= 0 && setIdx >= 0, 'gate and setter must both be present');

    // Count newlines between them.
    const between = body.slice(Math.min(gateIdx, setIdx), Math.max(gateIdx, setIdx));
    const lineDistance = (between.match(/\n/g) || []).length;
    assert.ok(
      lineDistance <= 30,
      `BUG: the terminal/stuck gate and setSystemAudioWarning call are ${lineDistance} lines apart. ` +
        'Keep them adjacent so the gate visibly guards the setter — see B1 fix for the intended shape.',
    );
  });
});
