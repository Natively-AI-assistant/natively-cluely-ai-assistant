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
//      screen-capture branch is explicitly gated on !wantsMicrophonePane;
//   2. the title is substring-matched on the RAW key, never on t(titleKey) —
//      the ja/ru catalogs translate these titles, so matching the rendered
//      string would silently break routing for exactly those locales;
//   3. the channel fallback is written `=== 'system'`, never `!== 'mic'`
//      (`channel` is optional; an absent channel must keep falling through to
//      the internal-Settings fallback).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(
  path.join(root, 'src/components/NativelyInterface.tsx'),
  'utf8',
);

// The predicate block: from the rawTitleKey assignment through the end of the
// deepLinkUrl ternary.
const BLOCK_RE =
  /const\s+rawTitleKey\s*=[\s\S]*?const\s+deepLinkUrl\s*=[\s\S]*?:\s*null\s*;/;

describe('audio warning banner routes by fault reason, not by audio channel', () => {
  it('derives the remedy from the raw titleKey, not from t(titleKey)', () => {
    const m = source.match(BLOCK_RE);
    assert.ok(m, 'could not locate the rawTitleKey → deepLinkUrl predicate block');
    const block = m[0];
    assert.match(
      block,
      /const\s+rawTitleKey\s*=\s*systemAudioWarning\.titleKey\s*\?\?\s*['"]{2}/,
      'BUG: the predicate must read `systemAudioWarning.titleKey` raw. Matching a ' +
        'localised title (t(titleKey)) breaks pane routing for ja/ru users only — a ' +
        'defect no English-locale test or manual check would ever surface.',
    );
    assert.doesNotMatch(
      block,
      /\bt\s*\(/,
      'BUG: the routing predicate must not call t(). Titles are i18n KEYS; ' +
        'substring-matching the rendered translation silently mis-routes localised users.',
    );
  });

  it('decides the Microphone pane before the Screen Recording pane, and gates the latter on it', () => {
    const m = source.match(BLOCK_RE);
    assert.ok(m, 'could not locate the rawTitleKey → deepLinkUrl predicate block');
    const block = m[0];

    const micIdx = block.indexOf('const wantsMicrophonePane');
    const screenIdx = block.indexOf('const wantsScreenCapturePane');
    assert.ok(micIdx !== -1 && screenIdx !== -1, 'both pane predicates must exist');
    assert.ok(
      micIdx < screenIdx,
      'BUG: `wantsMicrophonePane` must be computed before `wantsScreenCapturePane` so the ' +
        'screen-capture branch can exclude it. Reversing them re-opens the mic-fault → ' +
        '"Open Screen Settings" mis-route.',
    );

    const screenAssignment = block.slice(screenIdx, block.indexOf('const deepLinkUrl'));
    assert.match(
      screenAssignment,
      /!\s*wantsMicrophonePane/,
      'BUG: `wantsScreenCapturePane` must be gated on `!wantsMicrophonePane`. Without it, ' +
        "`channel === 'system'` swallows microphone faults again (they are all emitted on " +
        'the system channel by sendSystemAudioPermissionDenied).',
    );

    // The deep-link ternary must test the mic pane first for the same reason.
    const ternary = block.slice(block.indexOf('const deepLinkUrl'));
    assert.ok(
      ternary.indexOf('wantsMicrophonePane') < ternary.indexOf('wantsScreenCapturePane'),
      'BUG: the deepLinkUrl ternary must test wantsMicrophonePane first.',
    );
  });

  it("NEGATIVE: the channel fallback is `=== 'system'`, never `!== 'mic'`", () => {
    const m = source.match(BLOCK_RE);
    assert.ok(m, 'could not locate the rawTitleKey → deepLinkUrl predicate block');
    assert.doesNotMatch(
      m[0],
      /channel\s*!==\s*['"]mic['"]/,
      "BUG: `channel` is optional on SystemAudioWarning and forwarded verbatim from " +
        "payload.channel. `channel !== 'mic'` treats an ABSENT channel as a system fault " +
        'and deep-links it to Screen Recording instead of falling back to internal Settings.',
    );
  });
});
