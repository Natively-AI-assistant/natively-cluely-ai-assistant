// src/lib/__tests__/platformUtils.test.mjs
//
// Covers src/utils/platformUtils.ts — platform detection (isMac / isWindows /
// isLinux) and the modifier-key label helpers. The source lives in src/utils,
// but the test lives here because CI's `test:lib` glob only runs
// src/lib/**/__tests__.
//
// The module decides its platform ONCE, at import time, from
// `window.electronAPI?.platform ?? navigator.platform`. So each scenario stubs
// globalThis.window / globalThis.navigator, dynamically imports a FRESH copy of
// the module (a distinct ?query per scenario defeats the ESM cache), and
// restores the globals straight after. process.platform is never touched, so
// the suite behaves the same on macOS, Windows and Linux hosts.
//
// Run: node --experimental-strip-types --test src/lib/__tests__/platformUtils.test.mjs
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

let seq = 0;

/**
 * Import a fresh platformUtils with the given globals in place.
 * @param {{ electronPlatform?: string, navigatorPlatform?: string, noElectronApi?: boolean }} stub
 */
async function loadWith({ electronPlatform, navigatorPlatform, noElectronApi = false } = {}) {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true, enumerable: true });
  const restore = (name, desc) => {
    if (desc) Object.defineProperty(globalThis, name, desc);
    else delete globalThis[name];
  };

  define('window', noElectronApi ? {} : { electronAPI: { platform: electronPlatform } });
  define('navigator', { platform: navigatorPlatform });
  try {
    return await import(`../../utils/platformUtils.ts?scenario=${++seq}`);
  } finally {
    restore('window', savedWindow);
    restore('navigator', savedNavigator);
  }
}

const flags = (m) => ({ isMac: m.isMac, isWindows: m.isWindows, isLinux: m.isLinux });
const MAC = { isMac: true, isWindows: false, isLinux: false };
const WIN = { isMac: false, isWindows: true, isLinux: false };
const LINUX = { isMac: false, isWindows: false, isLinux: true };
const NONE = { isMac: false, isWindows: false, isLinux: false };

describe('platform detection — from the Electron preload (window.electronAPI.platform)', () => {
  test('darwin → mac', async () => {
    assert.deepEqual(flags(await loadWith({ electronPlatform: 'darwin' })), MAC);
  });

  test('win32 → windows', async () => {
    assert.deepEqual(flags(await loadWith({ electronPlatform: 'win32' })), WIN);
  });

  test('linux → linux', async () => {
    assert.deepEqual(flags(await loadWith({ electronPlatform: 'linux' })), LINUX);
  });

  test('an unrecognised platform sets no flag', async () => {
    assert.deepEqual(flags(await loadWith({ electronPlatform: 'freebsd' })), NONE);
  });

  test('the preload value wins over a disagreeing navigator.platform', async () => {
    assert.deepEqual(flags(await loadWith({ electronPlatform: 'win32', navigatorPlatform: 'MacIntel' })), WIN);
    assert.deepEqual(flags(await loadWith({ electronPlatform: 'darwin', navigatorPlatform: 'Win32' })), MAC);
  });
});

describe('platform detection — browser fallback (navigator.platform)', () => {
  test('MacIntel → mac', async () => {
    assert.deepEqual(flags(await loadWith({ noElectronApi: true, navigatorPlatform: 'MacIntel' })), MAC);
  });

  test('Win32 → windows', async () => {
    assert.deepEqual(flags(await loadWith({ noElectronApi: true, navigatorPlatform: 'Win32' })), WIN);
  });

  test('Windows → windows', async () => {
    assert.deepEqual(flags(await loadWith({ noElectronApi: true, navigatorPlatform: 'Windows' })), WIN);
  });

  test('Linux x86_64 → linux', async () => {
    assert.deepEqual(flags(await loadWith({ noElectronApi: true, navigatorPlatform: 'Linux x86_64' })), LINUX);
  });

  test('used when electronAPI exists but exposes no platform', async () => {
    assert.deepEqual(flags(await loadWith({ electronPlatform: undefined, navigatorPlatform: 'MacIntel' })), MAC);
  });

  test('a missing navigator.platform sets no flag and does not throw', async () => {
    assert.deepEqual(flags(await loadWith({ noElectronApi: true, navigatorPlatform: undefined })), NONE);
  });

  test('an empty navigator.platform sets no flag', async () => {
    assert.deepEqual(flags(await loadWith({ noElectronApi: true, navigatorPlatform: '' })), NONE);
  });

  test('exactly one flag is set for each recognised platform', async () => {
    for (const navigatorPlatform of ['MacIntel', 'Win32', 'Linux armv8l']) {
      const m = await loadWith({ noElectronApi: true, navigatorPlatform });
      assert.equal([m.isMac, m.isWindows, m.isLinux].filter(Boolean).length, 1, navigatorPlatform);
    }
  });
});

describe('stubbed globals are restored', () => {
  test('window and navigator are back to their original state after a load', async () => {
    const before = [
      Object.getOwnPropertyDescriptor(globalThis, 'window'),
      Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    ];
    await loadWith({ electronPlatform: 'darwin', navigatorPlatform: 'MacIntel' });
    assert.deepEqual(
      [Object.getOwnPropertyDescriptor(globalThis, 'window'), Object.getOwnPropertyDescriptor(globalThis, 'navigator')],
      before,
    );
  });
});

describe('getModifierSymbol', () => {
  test('macOS: command-style modifiers render as ⌘', async () => {
    const { getModifierSymbol } = await loadWith({ electronPlatform: 'darwin' });
    for (const m of ['commandorcontrol', 'cmd', 'command', 'meta']) {
      assert.equal(getModifierSymbol(m), '⌘', m);
    }
  });

  test('macOS: alt / option render as ⌥ and shift as ⇧', async () => {
    const { getModifierSymbol } = await loadWith({ electronPlatform: 'darwin' });
    assert.equal(getModifierSymbol('alt'), '⌥');
    assert.equal(getModifierSymbol('option'), '⌥');
    assert.equal(getModifierSymbol('shift'), '⇧');
  });

  for (const [label, stub] of [
    ['Windows', { electronPlatform: 'win32' }],
    ['Linux', { electronPlatform: 'linux' }],
    ['unknown platform', { noElectronApi: true, navigatorPlatform: '' }],
  ]) {
    test(`${label}: modifiers render as words`, async () => {
      const { getModifierSymbol } = await loadWith(stub);
      for (const m of ['commandorcontrol', 'cmd', 'command', 'meta', 'ctrl', 'control']) {
        assert.equal(getModifierSymbol(m), 'Ctrl', m);
      }
      assert.equal(getModifierSymbol('alt'), 'Alt');
      assert.equal(getModifierSymbol('option'), 'Alt');
      assert.equal(getModifierSymbol('shift'), 'Shift');
    });
  }

  test('matching is case-insensitive', async () => {
    const mac = await loadWith({ electronPlatform: 'darwin' });
    const win = await loadWith({ electronPlatform: 'win32' });
    assert.equal(mac.getModifierSymbol('CommandOrControl'), '⌘');
    assert.equal(mac.getModifierSymbol('Shift'), '⇧');
    assert.equal(win.getModifierSymbol('CommandOrControl'), 'Ctrl');
    assert.equal(win.getModifierSymbol('ALT'), 'Alt');
  });

  test('an unrecognised modifier is returned unchanged', async () => {
    const mac = await loadWith({ electronPlatform: 'darwin' });
    const win = await loadWith({ electronPlatform: 'win32' });
    assert.equal(mac.getModifierSymbol('Fn'), 'Fn');
    assert.equal(win.getModifierSymbol('Super'), 'Super');
  });
});

describe('getPlatformShortcut', () => {
  test('macOS: names and glyphs both resolve to glyphs', async () => {
    const { getPlatformShortcut } = await loadWith({ electronPlatform: 'darwin' });
    assert.deepEqual(getPlatformShortcut(['⌘', 'command', 'meta', 'cmd']), ['⌘', '⌘', '⌘', '⌘']);
    assert.deepEqual(getPlatformShortcut(['⌃', 'control', 'ctrl']), ['⌃', '⌃', '⌃']);
    assert.deepEqual(getPlatformShortcut(['⌥', 'option', 'alt']), ['⌥', '⌥', '⌥']);
    assert.deepEqual(getPlatformShortcut(['⇧', 'shift']), ['⇧', '⇧']);
  });

  test('Windows: names and glyphs both resolve to words', async () => {
    const { getPlatformShortcut } = await loadWith({ electronPlatform: 'win32' });
    assert.deepEqual(getPlatformShortcut(['⌘', 'command', 'meta', 'cmd']), ['Ctrl', 'Ctrl', 'Ctrl', 'Ctrl']);
    assert.deepEqual(getPlatformShortcut(['⌃', 'control', 'ctrl']), ['Ctrl', 'Ctrl', 'Ctrl']);
    assert.deepEqual(getPlatformShortcut(['⌥', 'option', 'alt']), ['Alt', 'Alt', 'Alt']);
    assert.deepEqual(getPlatformShortcut(['⇧', 'shift']), ['Shift', 'Shift']);
  });

  test('Linux uses the same words as Windows', async () => {
    const { getPlatformShortcut } = await loadWith({ electronPlatform: 'linux' });
    assert.deepEqual(getPlatformShortcut(['⌘', '⌥', '⇧', 'K']), ['Ctrl', 'Alt', 'Shift', 'K']);
  });

  test('a realistic shortcut keeps its order and its non-modifier keys', async () => {
    const mac = await loadWith({ electronPlatform: 'darwin' });
    const win = await loadWith({ electronPlatform: 'win32' });
    assert.deepEqual(mac.getPlatformShortcut(['⌘', '⇧', 'Enter']), ['⌘', '⇧', 'Enter']);
    assert.deepEqual(win.getPlatformShortcut(['⌘', '⇧', 'Enter']), ['Ctrl', 'Shift', 'Enter']);
  });

  test('modifier names are matched case-insensitively', async () => {
    const mac = await loadWith({ electronPlatform: 'darwin' });
    const win = await loadWith({ electronPlatform: 'win32' });
    assert.deepEqual(mac.getPlatformShortcut(['Cmd', 'SHIFT', 'Alt']), ['⌘', '⇧', '⌥']);
    assert.deepEqual(win.getPlatformShortcut(['Cmd', 'SHIFT', 'Alt']), ['Ctrl', 'Shift', 'Alt']);
  });

  test('unrecognised keys pass through with their original casing', async () => {
    const { getPlatformShortcut } = await loadWith({ electronPlatform: 'win32' });
    assert.deepEqual(getPlatformShortcut(['K', 'k', 'F5', 'ArrowUp', '']), ['K', 'k', 'F5', 'ArrowUp', '']);
  });

  test('an empty shortcut maps to an empty array', async () => {
    const { getPlatformShortcut } = await loadWith({ electronPlatform: 'darwin' });
    assert.deepEqual(getPlatformShortcut([]), []);
  });

  test('returns a new array and does not mutate its input', async () => {
    const { getPlatformShortcut } = await loadWith({ electronPlatform: 'win32' });
    const input = ['⌘', 'K'];
    const out = getPlatformShortcut(input);
    assert.notStrictEqual(out, input);
    assert.deepEqual(input, ['⌘', 'K']);
  });
});
