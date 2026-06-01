// Regression test for UX4 fix (2026-05-28): the in-Settings "Audio Test"
// dialog used to probe ONLY the microphone. Users had no pre-meeting
// signal that their system-audio capture path was working — the only
// indicators were post-meeting watchdogs that fired 8-12s after meeting
// start, far too late for a smooth "verify then proceed" onboarding flow.
//
// Fix: extend _startAudioTestImpl to also construct a parallel
// SystemAudioCapture (after first probing screen-recording capability via
// resolveMacScreenCaptureCapability), wire it to emit
// `audio-test-system-level` IPC events for the renderer's level meter,
// and emit `audio-test-system-error` on permission denial or construction
// failure so the renderer can render an inline notice next to the level
// bar. stopAudioTest tears down BOTH captures. Preload exposes
// `onAudioTestSystemLevel`/`onAudioTestSystemError` bridges; types are
// declared in electron.d.ts; SettingsOverlay subscribes and renders a
// "System Audio Level" progress bar.
//
// Regression we guard against: a future contributor "simplifies" the
// audio test back to mic-only (removing the system probe, the parallel
// IPC wiring, the inline error notice, or the level bar). That silently
// regresses pre-meeting verification UX and reintroduces the "I started a
// meeting and only my mic worked" failure mode.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const mainPath = path.join(root, 'electron/main.ts');
const preloadPath = path.join(root, 'electron/preload.ts');
const dtsPath = path.join(root, 'src/types/electron.d.ts');
const overlayPath = path.join(root, 'src/components/SettingsOverlay.tsx');

const mainSrc = fs.readFileSync(mainPath, 'utf8');
const preloadSrc = fs.readFileSync(preloadPath, 'utf8');
const dtsSrc = fs.readFileSync(dtsPath, 'utf8');
const overlaySrc = fs.readFileSync(overlayPath, 'utf8');

// Balanced-brace extractor for a function body. Walks forward from the
// opening `{`, honoring //, /* */, and string literals. Mirrors the
// helper used by SetupSystemAudioPipelinePermissionAlwaysChecked.test.mjs.
function extractFunctionBody(src, signaturePattern) {
  const sigRe = new RegExp(signaturePattern);
  const m = sigRe.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  if (src[i - 1] !== '{') {
    while (i < src.length && src[i] !== '{') i++;
    if (i >= src.length) return null;
    i++;
  }
  const bodyStart = i;
  let depth = 1;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = null;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(bodyStart, i);
    }
    i++;
  }
  return null;
}

const startBody = extractFunctionBody(
  mainSrc,
  String.raw`private\s+async\s+_startAudioTestImpl\s*\([^)]*\)\s*:\s*Promise<void>\s*\{`,
);
const stopBody = extractFunctionBody(
  mainSrc,
  String.raw`public\s+stopAudioTest\s*\(\s*\)\s*:\s*void\s*\{`,
);

describe('UX4: audio test probes system audio in parallel with the mic', () => {
  it('0. _startAudioTestImpl and stopAudioTest function bodies extract cleanly', () => {
    assert.ok(
      startBody !== null && startBody.length > 0,
      'BUG: could not extract _startAudioTestImpl body. Signature shape changed — update the test if the rename was intentional. The UX4 parallel-system-probe contract still applies.',
    );
    assert.ok(
      stopBody !== null && stopBody.length > 0,
      'BUG: could not extract stopAudioTest body. Signature shape changed — update the test if rename was intentional.',
    );
  });

  it('1. _startAudioTestImpl constructs a parallel SystemAudioCapture', () => {
    assert.ok(
      /new\s+SystemAudioCapture\s*\(/.test(startBody),
      'BUG (UX4 REGRESSION): _startAudioTestImpl no longer constructs `new SystemAudioCapture(`. The UX4 fix REQUIRES a parallel system probe so users can verify their system-audio path BEFORE starting a meeting. Reverting to mic-only loses the pre-meeting verification UX — restore the parallel SystemAudioCapture construction.',
    );
  });

  it('2. _startAudioTestImpl emits `audio-test-system-level` IPC events', () => {
    assert.ok(
      startBody.includes("'audio-test-system-level'"),
      'BUG (UX4 REGRESSION): _startAudioTestImpl no longer sends `audio-test-system-level` IPC events. Without this channel the renderer cannot render the System Audio Level meter, defeating the entire pre-meeting verification flow.',
    );
  });

  it('3. _startAudioTestImpl emits `audio-test-system-error` on probe failure', () => {
    assert.ok(
      startBody.includes("'audio-test-system-error'"),
      'BUG (UX4 REGRESSION): _startAudioTestImpl no longer sends `audio-test-system-error` IPC events on permission denial or construction throw. Without this channel the renderer silently shows an empty/zero meter instead of an actionable "screen recording denied" notice — users have no idea why their system audio is dead.',
    );
  });

  it('4. _startAudioTestImpl calls resolveMacScreenCaptureCapability BEFORE constructing the system probe', () => {
    assert.ok(
      /resolveMacScreenCaptureCapability\s*\(/.test(startBody),
      'BUG (UX4 REGRESSION): _startAudioTestImpl no longer calls resolveMacScreenCaptureCapability. Without the permission probe, constructing SystemAudioCapture on a TCC-denied system either throws or zero-fills forever with no actionable signal. The fix REQUIRES the capability check to gate the probe construction.',
    );

    // Structural ordering: the resolveMacScreenCaptureCapability call MUST
    // appear before the `new SystemAudioCapture(` call. Otherwise we'd be
    // constructing the probe and only checking permission afterwards.
    const resolveIdx = startBody.search(/resolveMacScreenCaptureCapability\s*\(/);
    const ctorIdx = startBody.search(/new\s+SystemAudioCapture\s*\(/);
    assert.ok(
      resolveIdx !== -1 && ctorIdx !== -1 && resolveIdx < ctorIdx,
      `BUG (UX4 REGRESSION): resolveMacScreenCaptureCapability (idx ${resolveIdx}) must appear BEFORE \`new SystemAudioCapture(\` (idx ${ctorIdx}) in _startAudioTestImpl. The current ordering attempts to construct the probe before verifying permission, which races TCC and silently emits a zero-fill meter.`,
    );
  });

  it('5. stopAudioTest tears down `audioTestSystemCapture` with a .stop() call', () => {
    assert.ok(
      /audioTestSystemCapture/.test(stopBody),
      'BUG (UX4 REGRESSION): stopAudioTest no longer references `audioTestSystemCapture`. The parallel system probe must be torn down alongside the mic capture — leaving it running after the dialog closes leaks native capture threads and holds an exclusive system-audio handle into the next meeting.',
    );
    assert.ok(
      /audioTestSystemCapture[\s\S]*?\.stop\s*\(\s*\)/.test(stopBody),
      'BUG (UX4 REGRESSION): stopAudioTest references audioTestSystemCapture but never calls .stop() on it. Nulling the reference without stopping leaks the native capture thread.',
    );
    assert.ok(
      /this\.audioTestSystemCapture\s*=\s*null/.test(stopBody),
      'BUG (UX4 REGRESSION): stopAudioTest does not null `this.audioTestSystemCapture` after .stop(). Leaving the dead wrapper around causes the next startAudioTest call to skip constructing a fresh probe (if the construction path is gated on the field being null).',
    );
  });

  it('6. preload.ts exposes onAudioTestSystemLevel AND onAudioTestSystemError bridges', () => {
    assert.ok(
      /onAudioTestSystemLevel\s*:/.test(preloadSrc),
      'BUG (UX4 REGRESSION): preload.ts no longer exposes `onAudioTestSystemLevel`. Without this bridge, the renderer cannot subscribe to system-level IPC events and the level meter goes dark.',
    );
    assert.ok(
      /onAudioTestSystemError\s*:/.test(preloadSrc),
      'BUG (UX4 REGRESSION): preload.ts no longer exposes `onAudioTestSystemError`. Without this bridge, permission-denied errors never reach the renderer and the user sees a silently empty meter.',
    );
    assert.ok(
      /ipcRenderer\.on\s*\(\s*['"]audio-test-system-level['"]/.test(preloadSrc),
      'BUG: onAudioTestSystemLevel bridge is not subscribed to the `audio-test-system-level` IPC channel. The bridge name and channel name must align with main.ts.',
    );
    assert.ok(
      /ipcRenderer\.on\s*\(\s*['"]audio-test-system-error['"]/.test(preloadSrc),
      'BUG: onAudioTestSystemError bridge is not subscribed to the `audio-test-system-error` IPC channel. The bridge name and channel name must align with main.ts.',
    );
  });

  it('7. electron.d.ts declares onAudioTestSystemLevel and onAudioTestSystemError type signatures', () => {
    assert.ok(
      /onAudioTestSystemLevel\s*:\s*\(/.test(dtsSrc),
      'BUG (UX4 REGRESSION): src/types/electron.d.ts no longer declares `onAudioTestSystemLevel`. Without the type declaration, the renderer call `window.electronAPI?.onAudioTestSystemLevel?.(...)` silently becomes `any` and TypeScript will not catch a future rename or removal.',
    );
    assert.ok(
      /onAudioTestSystemError\s*:\s*\(/.test(dtsSrc),
      'BUG (UX4 REGRESSION): src/types/electron.d.ts no longer declares `onAudioTestSystemError`. Without the type declaration, the renderer subscription becomes `any` and a future contributor could remove the preload bridge without a compile error.',
    );
  });

  it('8. SettingsOverlay.tsx subscribes to onAudioTestSystemLevel AND onAudioTestSystemError', () => {
    assert.ok(
      overlaySrc.includes('onAudioTestSystemLevel'),
      'BUG (UX4 REGRESSION): SettingsOverlay.tsx no longer subscribes to `onAudioTestSystemLevel`. Without the subscription, the level meter never updates even though the IPC fires — pre-meeting verification UX silently dies.',
    );
    assert.ok(
      overlaySrc.includes('onAudioTestSystemError'),
      'BUG (UX4 REGRESSION): SettingsOverlay.tsx no longer subscribes to `onAudioTestSystemError`. Without the subscription, permission-denied notices never render and users have no idea why their system audio is dead.',
    );
  });

  it('9. SettingsOverlay.tsx renders the literal "System Audio Level" label', () => {
    assert.ok(
      overlaySrc.includes('System Audio Level'),
      'BUG (UX4 REGRESSION): SettingsOverlay.tsx no longer renders the literal "System Audio Level" label next to the level bar. Without this label users cannot distinguish the system meter from the mic meter — the entire point of the UX4 fix is to surface system-audio health PARALLEL to mic health.',
    );
  });

  it('10. SettingsOverlay.tsx binds the level bar width to `systemAudioLevel`', () => {
    // Accept either tagged-template width:`${systemAudioLevel}%` or
    // generic style references that include systemAudioLevel.
    const taggedTemplate = /width\s*:\s*`\$\{\s*systemAudioLevel\s*\}%`/.test(overlaySrc);
    const styleReference = /width\s*:[^,;}]*systemAudioLevel/.test(overlaySrc);
    assert.ok(
      taggedTemplate || styleReference,
      'BUG (UX4 REGRESSION): SettingsOverlay.tsx no longer binds the System Audio Level bar width to the `systemAudioLevel` state. Without this binding the bar is either static or invisible — the meter renders but never animates against the live level, defeating the visual verification.',
    );
  });
});
