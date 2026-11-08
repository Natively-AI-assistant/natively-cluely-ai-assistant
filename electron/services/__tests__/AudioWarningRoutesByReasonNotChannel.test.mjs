// Regression test for the permission-routing fix (2026-08) in
// src/components/NativelyInterface.tsx.
//
// Pre-fix the banner picked its macOS System Settings pane from the audio
// CHANNEL:
//
//   const wantsScreenCapturePane =
//     systemAudioWarning.kind === 'screen-recording-permission' ||
//     systemAudioWarning.channel === 'system';        // <- too broad
//
// `channel` is a TRANSPORT label (which capture stream failed), not a remedy
// label. `sendSystemAudioPermissionDenied` hard-stamps channel:'system' on
// every warning it emits, so a microphone fault routed through it — e.g. the
// 'Microphone Blocked' / 'Microphone Is Silent' titles — rendered a button
// labelled "Open Screen Settings" that deep-linked to Privacy_ScreenCapture.
// The same predicate sent 'Input and Output Are the Same Device' (an output-
// device misconfiguration with no privacy pane at all) to Screen Recording.
//
// Post-fix the remedy is derived from the RAW `titleKey` (the reason encoded
// by main.ts `permissionTitleKey()`) first and `channel` only as a fallback.
//
// Guards, in order of what a future contributor is most likely to break:
//   1. the mic decision is made BEFORE the screen-capture decision, and the
//      screen-capture branch is explicitly gated on !wantsMic;
//   2. the title is substring-matched on the RAW key, never on t(titleKey) —
//      the ja/ru catalogs translate these titles, so matching the rendered
//      string would silently break routing for exactly those locales;
//   3. the channel fallback is written `=== 'system'`, never `!== 'mic'`
//      (`channel` is optional; an absent channel must keep falling through to
//      the internal-Settings fallback).
//
// 2026-09-26: the routing moved out of the JSX into
// src/lib/audioWarningAction.mjs (so Windows gets its own destinations). The
// same three guards are asserted on that helper's darwin branch, and on the
// banner passing it the raw titleKey. Behaviour is executed in
// src/lib/__tests__/audioWarningAction.test.mjs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const ui = fs.readFileSync(path.join(root, 'src/components/NativelyInterface.tsx'), 'utf8');
const source = fs.readFileSync(path.join(root, 'src/lib/audioWarningAction.mjs'), 'utf8');

// The darwin predicate block: from the title read through the two pane returns.
const BLOCK_RE = /const\s+title\s*=[\s\S]*?if\s*\(wantsScreen\)[^\n]*/;

describe('audio warning banner routes by fault reason, not by audio channel', () => {
  it('derives the remedy from the raw titleKey, not from t(titleKey)', () => {
    assert.match(
      ui,
      /audioWarningAction\(\{[\s\S]*?titleKey:\s*systemAudioWarning\.titleKey,/,
      'BUG: the banner must pass the RAW titleKey to the routing, not t(titleKey). Matching a ' +
        'localised title breaks pane routing for ja/ru users only.',
    );
    const m = source.match(BLOCK_RE);
    assert.ok(m, 'could not locate the title → pane predicate block in audioWarningAction.mjs');
    assert.match(m[0], /const\s+title\s*=\s*String\(w\.titleKey\s*\?\?\s*['"]{2}\)/, 'the routing must read the raw titleKey');
    assert.doesNotMatch(
      m[0],
      /\bt\s*\(/,
      'BUG: the routing predicate must not call t(). Titles are i18n KEYS; ' +
        'substring-matching the rendered translation silently mis-routes localised users.',
    );
  });

  it('decides the Microphone pane before the Screen Recording pane, and gates the latter on it', () => {
    const m = source.match(BLOCK_RE);
    assert.ok(m, 'could not locate the title → pane predicate block in audioWarningAction.mjs');
    const block = m[0];
    const micIdx = block.indexOf('const wantsMic');
    const screenIdx = block.indexOf('const wantsScreen');
    assert.ok(micIdx !== -1 && screenIdx !== -1, 'both pane predicates must exist');
    assert.ok(
      micIdx < screenIdx,
      'BUG: `wantsMic` must be computed before `wantsScreen` so the screen-capture branch can ' +
        'exclude it. Reversing them re-opens the mic-fault → "Open Screen Settings" mis-route.',
    );
    const screenAssignment = block.slice(screenIdx, block.indexOf('if (wantsMic)'));
    assert.match(
      screenAssignment,
      /!\s*wantsMic\b/,
      'BUG: `wantsScreen` must be gated on `!wantsMic`. Without it, `channel === \'system\'` ' +
        'swallows microphone faults again (they are all emitted on the system channel).',
    );
    assert.ok(
      block.indexOf('if (wantsMic)') < block.indexOf('if (wantsScreen)'),
      'BUG: the Microphone pane must be returned before the Screen Recording pane.',
    );
  });

  it("NEGATIVE: the channel fallback is `=== 'system'`, never `!== 'mic'`", () => {
    const m = source.match(BLOCK_RE);
    assert.ok(m, 'could not locate the title → pane predicate block in audioWarningAction.mjs');
    assert.doesNotMatch(
      m[0],
      /channel\s*!==\s*['"]mic['"]/,
      "BUG: `channel` is optional and forwarded verbatim from payload.channel. `channel !== 'mic'` " +
        'treats an ABSENT channel as a system fault and deep-links it to Screen Recording.',
    );
  });
});
