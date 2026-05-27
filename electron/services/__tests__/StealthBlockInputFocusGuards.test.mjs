// Regression test for the input-focus / mouse-down guard chain in
// src/components/NativelyInterface.tsx — the heart of PR #250 (issue #246,
// "Windows chat input unclickable in stealth mode") plus the M1 / M2 senior-
// review fixes.
//
// Guard logic lives in src/lib/overlayStealthFocusGuards.mjs (production).
// Structural assertions below guard against silent removal from NativelyInterface.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveCgEventTapAvailable,
  shouldBlockFocus,
  shouldFireStealthTapStart,
} from '../../../src/lib/overlayStealthFocusGuards.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const NATIVELY_INTERFACE = path.join(root, 'src/components/NativelyInterface.tsx');

describe('blockInputFocus: ref-driven focus-blocking truth table', () => {
  test('Windows (CGEventTap unavailable) does NOT block input focus — fixes #246', () => {
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: resolveCgEventTapAvailable('win32'),
      }),
      false,
    );
  });

  test('Linux (CGEventTap unavailable) does NOT block input focus', () => {
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: resolveCgEventTapAvailable('linux'),
      }),
      false,
    );
  });

  test('macOS with tap available DOES block focus (stealth invariant)', () => {
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: resolveCgEventTapAvailable('darwin'),
      }),
      true,
    );
  });

  test('macOS with IME enabled does NOT block focus — CJK composition path', () => {
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: false,
        isCgEventTapAvailable: resolveCgEventTapAvailable('darwin'),
      }),
      false,
    );
  });

  test('macOS with tap unavailable at runtime does NOT block focus', () => {
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: false,
      }),
      false,
    );
  });

  test('default-false isCgEventTapAvailable: input clickable on non-darwin', () => {
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: true,
        isCgEventTapAvailable: false,
      }),
      false,
    );
  });

  test('macOS with both refs false does NOT block focus', () => {
    assert.equal(
      shouldBlockFocus({
        stealthAutoEngageOk: false,
        isCgEventTapAvailable: false,
      }),
      false,
    );
  });
});

describe('mount-effect onMouseDown: ref-driven tap-engage truth table', () => {
  test('macOS happy path: not active, auto-engage ok, stealth-engage target → fires start', () => {
    assert.equal(
      shouldFireStealthTapStart({
        stealthTapActive: false,
        stealthAutoEngageOk: true,
        isStealthEngageTarget: true,
      }),
      true,
    );
  });

  test('macOS tap already active: does not re-fire start', () => {
    assert.equal(
      shouldFireStealthTapStart({
        stealthTapActive: true,
        stealthAutoEngageOk: true,
        isStealthEngageTarget: true,
      }),
      false,
    );
  });

  test('macOS with IME present: does not fire start', () => {
    assert.equal(
      shouldFireStealthTapStart({
        stealthTapActive: false,
        stealthAutoEngageOk: false,
        isStealthEngageTarget: true,
      }),
      false,
    );
  });

  test('click outside data-stealth-engage target does not fire start (opt-in model)', () => {
    assert.equal(
      shouldFireStealthTapStart({
        stealthTapActive: false,
        stealthAutoEngageOk: true,
        isStealthEngageTarget: false,
      }),
      false,
    );
  });

  test('symmetry: blockInputFocus does not block when isCgEventTapAvailable=false', () => {
    for (const stealthAutoEngageOk of [true, false]) {
      assert.equal(
        shouldBlockFocus({
          stealthAutoEngageOk,
          isCgEventTapAvailable: false,
        }),
        false,
      );
    }
  });
});

describe('NativelyInterface.tsx: guard implementation must keep checking both refs', () => {
  const source = fs.readFileSync(NATIVELY_INTERFACE, 'utf8');

  test('isCgEventTapAvailableRef defaults from resolveCgEventTapAvailable(platform)', () => {
    assert.match(
      source,
      /const isCgEventTapAvailableRef\s*=\s*useRef<boolean>\(\s*resolveCgEventTapAvailable\(window\.electronAPI\?\.platform/,
    );
  });

  test('blockInputFocus checks isCgEventTapAvailableRef before preventDefault', () => {
    const body = source.match(
      /const blockInputFocus = useCallback\([\s\S]*?\}, \[\]\);/,
    );
    assert.ok(body, 'blockInputFocus callback not found');
    const idxAvailCheck = body[0].indexOf('isCgEventTapAvailableRef.current');
    const idxPreventDefault = body[0].indexOf('e.preventDefault()');
    assert.ok(idxAvailCheck >= 0);
    assert.ok(idxPreventDefault >= 0);
    assert.ok(idxAvailCheck < idxPreventDefault);
  });

  test('click-to-engage uses shouldFireStealthTapStart and data-stealth-engage opt-in', () => {
    const effectMatch = source.match(
      /useEffect\(\(\) => \{[\s\S]*?if \(!window\.electronAPI\?\.stealthTapStart\) return;[\s\S]*?shouldFireStealthTapStart[\s\S]*?stealthTapStart\(\)[\s\S]*?\}, \[\]\);/,
    );
    assert.ok(effectMatch, 'click-to-engage mount effect not found');
    assert.match(effectMatch[0], /data-stealth-engage="true"/);
    assert.match(effectMatch[0], /shouldFireStealthTapStart\(/);
  });

  test('stealthTapStart failure is swallowed on click-to-engage path', () => {
    assert.match(source, /stealthTapStart\(\)\.catch\(\(\) => \{\}\);/);
  });

  test('onStealthTapState sets stealthPermissionMissing on permission revoke', () => {
    const stateHandler = source.match(
      /const unsubState = window\.electronAPI\.onStealthTapState\(\(\{[\s\S]*?\}\) => \{[\s\S]*?\}\);/,
    );
    assert.ok(stateHandler, 'onStealthTapState handler not found');
    assert.match(
      stateHandler[0],
      /reason === 'permission'[\s\S]*?setStealthPermissionMissing\(true\)/,
    );
  });
});

describe('dead stealth IPCs have no runtime callers in renderer/components', () => {
  test('no component invokes removed stealthTap IPC helpers', () => {
    function walk(dir, acc = []) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') {
            continue;
          }
          walk(full, acc);
        } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx'))) {
          acc.push(full);
        }
      }
      return acc;
    }
    const files = walk(path.join(root, 'src/components'));
    const dead = [
      'stealthTapPermissionGranted',
      'stealthTapRequestPermission',
      'stealthTapIsActive',
    ];
    const offenders = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const name of dead) {
        if (text.includes(name)) offenders.push(`${path.relative(root, file)} — ${name}`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});
