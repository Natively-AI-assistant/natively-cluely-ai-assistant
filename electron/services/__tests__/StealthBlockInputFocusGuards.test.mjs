// Regression test for the input-focus / mouse-down guard chain in
// src/components/NativelyInterface.tsx — the heart of PR #250 (issue #246,
// "Windows chat input unclickable in stealth mode") plus the M1 / M2 senior-
// review fixes.
//
// The guard chain lives in two places that MUST stay symmetric:
//
//   1. blockInputFocus (src/components/NativelyInterface.tsx ~line 3281)
//        const blockInputFocus = useCallback((e) => {
//          if (!stealthAutoEngageOkRef.current) return;
//          if (!isCgEventTapAvailableRef.current) return;     // M1
//          e.preventDefault();
//          if (document.activeElement === textInputRef.current) {
//            textInputRef.current?.blur();
//          }
//        }, []);
//
//   2. mount-effect onMouseDown (same file, ~line 3223)
//        const onMouseDown = (e) => {
//          if (stealthTapActiveRef.current) return;
//          if (!stealthAutoEngageOkRef.current) return;
//          if (!isCgEventTapAvailableRef.current) return;     // M2
//          ...
//          window.electronAPI.stealthTapStart().catch(...);
//        };
//
// These two short-circuit checks form a truth table that is small enough to
// enumerate exhaustively. The tests below mirror the guard logic as a pure
// function so we can assert "should focus be blocked under these conditions?"
// without booting React, jsdom, or Electron.
//
//   ⚠ If the production guards change, this file MUST be updated. The point
//   is to document the truth table and catch any regression that would re-
//   trap the input on Windows or any other failure mode below.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const NATIVELY_INTERFACE = path.join(
  root,
  'src/components/NativelyInterface.tsx',
);

// ── Mirrored guard logic ──────────────────────────────────────────────────
// This is intentionally a 1:1 transcription of the production code's two
// guard chains. Keep it dumb and readable — the value of this file is that
// the truth-table is right next to the assertions.

function shouldBlockFocus(refs) {
  // Mirrors blockInputFocus in NativelyInterface.tsx (~line 3281).
  if (!refs.stealthAutoEngageOk) return false;
  if (!refs.isCgEventTapAvailable) return false;
  return true;
}

function shouldFireStealthTapStart(refs) {
  // Mirrors the mount-effect onMouseDown in NativelyInterface.tsx (~line 3223).
  if (refs.stealthTapActive) return false;
  if (!refs.stealthAutoEngageOk) return false;
  if (!refs.isCgEventTapAvailable) return false;
  return true;
}

// ── blockInputFocus truth table ──────────────────────────────────────────

describe('blockInputFocus: ref-driven focus-blocking truth table', () => {
  test('Windows (CGEventTap unavailable) does NOT block input focus — fixes #246', () => {
    // Windows: stealthAutoEngageOk=true (non-darwin stealth-tap:should-auto-engage
    // returns true unconditionally), isCgEventTapAvailable=false (stealth-tap:
    // available returns false on non-darwin). Result: input clickable.
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: false,
      }),
      false,
      'Windows must never have its chat input focus blocked — that is the original #246 regression',
    );
  });

  test('Linux (CGEventTap unavailable) does NOT block input focus', () => {
    // Same shape as Windows.
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: false,
      }),
      false,
    );
  });

  test('macOS with tap available DOES block focus (stealth invariant)', () => {
    // The whole point of the tap: keep DOM focus off the panel so it never
    // becomes key window. This is the only state where focus blocking fires.
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: true,
      }),
      true,
    );
  });

  test('macOS with IME enabled (Pinyin/Hangul/Kanji) does NOT block focus — CJK composition path', () => {
    // stealthAutoEngageOk=false because shouldAutoEngageStealthTap() detected
    // an IME via `defaults read com.apple.HIToolbox`. Letting the browser
    // focus the input means the OS Text Input System routes keystrokes through
    // the IME and CJK composition works normally. This is issue #239.
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: false,
        isCgEventTapAvailable: true,
      }),
      false,
    );
  });

  test('macOS with tap loaded but Accessibility revoked at runtime does NOT block focus — fixes M1', () => {
    // M1 fix: when onStealthTapState fires {active:false, reason:'permission'},
    // isCgEventTapAvailableRef.current is flipped to false. Without this, the
    // user revokes Accessibility, the tap fails to engage, but the guard
    // still blocks DOM focus — chat input becomes permanently dead until app
    // restart. Exact symptom #246 had on Windows.
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: false,
      }),
      false,
      'M1: Accessibility revocation must un-trap the input by flipping isCgEventTapAvailableRef to false',
    );
  });

  test('default-false safety: input clickable until IPC confirms availability', () => {
    // M1's new safe-false default. Before the stealth-tap:available IPC
    // resolves, isCgEventTapAvailableRef=false → input is clickable. The
    // ~50ms race window between mount and IPC resolve is acceptable; the
    // alternative (safe-true default) would re-trap the input on Windows.
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: false,
      }),
      false,
    );
  });

  test('macOS with both refs false (worst case during boot) does NOT block focus', () => {
    // Belt-and-braces: if both probes failed/rejected, default-false on both
    // refs means the user always retains the ability to click the input.
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: false,
        isCgEventTapAvailable: false,
      }),
      false,
    );
  });
});

// ── onMouseDown (capture phase) truth table ──────────────────────────────

describe('mount-effect onMouseDown: ref-driven tap-engage truth table', () => {
  test('Windows: does NOT fire stealthTapStart — M2 symmetry with blockInputFocus', () => {
    // Without the M2 fix, on Windows every click on the chat input would fire
    // stealthTapStart() — harmless today (the handler returns false) but
    // fragile tomorrow if anyone adds a side effect on the Windows path.
    assert.equal(
      shouldFireStealthTapStart({
        stealthTapActive: false,
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: false,
      }),
      false,
      'M2: mouseDown must short-circuit when CGEventTap unavailable, mirroring blockInputFocus',
    );
  });

  test('macOS happy path: tap available, no IME, not yet active → fires start', () => {
    assert.equal(
      shouldFireStealthTapStart({
        stealthTapActive: false,
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: true,
      }),
      true,
    );
  });

  test('macOS tap already active: does not re-fire start (would be a no-op anyway)', () => {
    assert.equal(
      shouldFireStealthTapStart({
        stealthTapActive: true,
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: true,
      }),
      false,
    );
  });

  test('macOS with IME present: does not fire start (CJK composition would break)', () => {
    assert.equal(
      shouldFireStealthTapStart({
        stealthTapActive: false,
        stealthAutoEngageOk: false,
        isCgEventTapAvailable: true,
      }),
      false,
    );
  });

  test('symmetry: blockInputFocus and onMouseDown agree on every shape that isCgEventTapAvailable=false', () => {
    // The M2 fix is precisely about restoring this symmetry. Enumerate the
    // four boolean combinations of the other two refs and confirm that
    // both gates return false whenever isCgEventTapAvailable=false.
    for (const stealthAutoEngageOk of [true, false]) {
      for (const stealthTapActive of [true, false]) {
        const refs = {
          stealthAutoEngageOk,
          stealthTapActive,
          isCgEventTapAvailable: false,
        };
        assert.equal(
          shouldBlockFocus(refs),
          false,
          `blockInputFocus must NOT block when isCgEventTapAvailable=false (refs=${JSON.stringify(refs)})`,
        );
        assert.equal(
          shouldFireStealthTapStart(refs),
          false,
          `onMouseDown must NOT fire stealthTapStart when isCgEventTapAvailable=false (refs=${JSON.stringify(refs)})`,
        );
      }
    }
  });
});

// ── Structural assertions on the real source ────────────────────────────
//
// The truth-table tests above guard *behaviour*. These assertions guard the
// *implementation* against silent removal — if the production code stops
// checking isCgEventTapAvailableRef in either gate, the file changes and we
// surface it loud.

describe('NativelyInterface.tsx: guard implementation must keep checking both refs', () => {
  const source = fs.readFileSync(NATIVELY_INTERFACE, 'utf8');

  test('isCgEventTapAvailableRef defaults to false (M1 safe default)', () => {
    // The ref declaration must initialise to false. A `useRef<boolean>(true)`
    // would re-introduce the M1 hazard: input trapped until the IPC resolves.
    const refDecl = source.match(
      /const isCgEventTapAvailableRef\s*=\s*useRef<boolean>\(([^)]+)\)/,
    );
    assert.ok(refDecl, 'isCgEventTapAvailableRef declaration not found');
    assert.equal(
      refDecl[1].trim(),
      'false',
      'isCgEventTapAvailableRef must default to false so the input is clickable until availability is confirmed (M1)',
    );
  });

  test('blockInputFocus checks isCgEventTapAvailableRef before preventDefault', () => {
    // Pull the blockInputFocus body. We assert both the availability check
    // and that it sits BEFORE e.preventDefault().
    const body = source.match(
      /const blockInputFocus = useCallback\([\s\S]*?\}, \[\]\);/,
    );
    assert.ok(body, 'blockInputFocus callback not found');
    const idxAvailCheck = body[0].indexOf('isCgEventTapAvailableRef.current');
    const idxPreventDefault = body[0].indexOf('e.preventDefault()');
    assert.ok(
      idxAvailCheck >= 0,
      'blockInputFocus must consult isCgEventTapAvailableRef (M1 guard)',
    );
    assert.ok(
      idxPreventDefault >= 0,
      'blockInputFocus must call e.preventDefault() in the happy path',
    );
    assert.ok(
      idxAvailCheck < idxPreventDefault,
      'isCgEventTapAvailableRef check must precede e.preventDefault() — otherwise focus is blocked before the guard runs',
    );
  });

  test('mount-effect onMouseDown checks isCgEventTapAvailableRef before stealthTapStart (M2)', () => {
    // The chat-input click-to-engage listener. Find the onMouseDown that
    // sits inside the same useEffect as stealthTapStart and assert it
    // short-circuits when the ref is false.
    const effectMatch = source.match(
      /useEffect\(\(\) => \{[\s\S]*?stealthTapShouldAutoEngage[\s\S]*?stealthTapAvailable[\s\S]*?const onMouseDown[\s\S]*?stealthTapStart\([\s\S]*?\}, \[\]\);/,
    );
    assert.ok(
      effectMatch,
      'click-to-engage mount effect (stealthTapAvailable + onMouseDown + stealthTapStart) not found',
    );
    assert.match(
      effectMatch[0],
      /if \(!isCgEventTapAvailableRef\.current\) return;/,
      'M2: mount-effect onMouseDown must short-circuit when isCgEventTapAvailableRef is false (symmetric with blockInputFocus)',
    );
  });

  test('stealthTapStart() failure is logged, not swallowed (m5)', () => {
    // The m5 fix replaced `.catch(() => {})` with a console.warn so failures
    // surface in dev tools instead of silently ignoring.
    assert.match(
      source,
      /stealthTapStart\(\)\.catch\(\(err\) => \{[\s\S]*?console\.warn\(['"]\[stealth\] tap start IPC failed['"], err\);[\s\S]*?\}\);/,
      'm5: stealthTapStart failure must be logged via console.warn, not silently swallowed',
    );
  });

  test('onStealthTapState flips isCgEventTapAvailableRef to false on permission revoke and true on active', () => {
    // M1 contract: the state listener must update isCgEventTapAvailableRef in
    // both directions.
    const stateHandler = source.match(
      /const unsubState = window\.electronAPI\.onStealthTapState\(\(\{[\s\S]*?\}\) => \{[\s\S]*?\}\);/,
    );
    assert.ok(stateHandler, 'onStealthTapState handler not found');
    // false branch on permission revoke
    assert.match(
      stateHandler[0],
      /reason === 'permission'[\s\S]*?isCgEventTapAvailableRef\.current = false;/,
      'M1: onStealthTapState({active:false, reason:"permission"}) must flip isCgEventTapAvailableRef to false',
    );
    // true branch on active=true
    assert.match(
      stateHandler[0],
      /if \(active\) \{[\s\S]*?isCgEventTapAvailableRef\.current = true;[\s\S]*?\}/,
      'M1: onStealthTapState({active:true}) must promote isCgEventTapAvailableRef to true',
    );
  });

  test('window.focus listener calls stealthTapRefreshIme (M3)', () => {
    // M3 contract: refresh IME on window focus so mid-session input-source
    // changes don't silently break CJK composition.
    assert.match(
      source,
      /window\.addEventListener\(['"]focus['"], onFocusRefresh\)/,
      'M3: must register a window focus listener that refreshes IME state',
    );
    assert.match(
      source,
      /stealthTapRefreshIme\?\.\(\)/,
      'M3: focus listener must call stealthTapRefreshIme',
    );
    // And the cleanup must remove the listener — otherwise we leak a handler
    // on every component remount (HMR, route changes, etc.).
    assert.match(
      source,
      /window\.removeEventListener\(['"]focus['"], onFocusRefresh\)/,
      'M3: focus listener cleanup must remove the listener to avoid leaks across remounts',
    );
  });
});

// ── Dead-IPC removal assertion (m5 / M5) ──────────────────────────────────

describe('dead stealth IPCs are fully removed across renderer surface', () => {
  test('no caller of stealthTapPermissionGranted, stealthTapRequestPermission, or stealthTapIsActive remains', () => {
    function walk(dir, acc = []) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            entry.name === 'node_modules' ||
            entry.name === '__tests__' ||
            entry.name === 'dist-electron' ||
            entry.name === 'dist'
          ) continue;
          walk(full, acc);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.tsx') ||
            entry.name.endsWith('.ts') ||
            entry.name.endsWith('.js'))
        ) {
          acc.push(full);
        }
      }
      return acc;
    }
    const files = [
      ...walk(path.join(root, 'src')),
      ...walk(path.join(root, 'electron')),
    ];
    const dead = [
      'stealthTapPermissionGranted',
      'stealthTapRequestPermission',
      'stealthTapIsActive',
    ];
    const offenders = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const name of dead) {
        if (text.includes(name)) {
          offenders.push(`${path.relative(root, file)} — ${name}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Dead stealth IPCs must have zero callers (M5 removed them):\n${offenders.join('\n')}`,
    );
  });
});
