import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.resolve(repoRoot, rel), 'utf8');

const modulePath = path.resolve(
  repoRoot,
  'dist-electron/electron/services/acceleratorValidation.js'
);
const load = () => import(pathToFileURL(modulePath).href);

// A user bound a global shortcut to a bare "₹" (rupee sign, no modifier).
// Electron's gin converter cannot turn that string into a ui::Accelerator, so
// EVERY globalShortcut call with it throws
//   TypeError: Error processing argument at index 0, conversion failure from ₹
// registerGlobalShortcuts() caught that. revalidateShortcuts() did not: its
// isRegistered() probe sat OUTSIDE the try, so the throw escaped the Map.forEach,
// escaped the health-check setInterval, and became an uncaughtException —
// killing the main process ~10s after every launch that reached overlay mode.
// The app "closed by itself" in a loop. (natively_debug 2026-08-28, pid 7388.)

// ---------------------------------------------------------------- validation

test('a bare rupee sign is rejected as an accelerator', async () => {
  const { isRegisterableAccelerator } = await load();
  assert.equal(
    isRegisterableAccelerator('₹'),
    false,
    'the exact accelerator that crashed the app must never reach globalShortcut.',
  );
});

test('non-ASCII keys are rejected whatever the modifiers', async () => {
  const { isRegisterableAccelerator } = await load();
  // An Option+key press on a non-US layout yields the composed character, so
  // these arrive looking perfectly ordinary to the recorder.
  for (const acc of ['₹', 'CommandOrControl+₹', 'Alt+é', '€', 'Shift+ü', '→']) {
    assert.equal(isRegisterableAccelerator(acc), false, `${acc} must be rejected`);
  }
});

test('an unknown token is rejected rather than thrown on', async () => {
  const { isRegisterableAccelerator } = await load();
  // Electron throws the same conversion TypeError for these, not a false return.
  for (const acc of ['Comand+B', 'CommandOrControl+Retrun', 'Ctrl+NotAKey', '']) {
    assert.equal(isRegisterableAccelerator(acc), false, `${acc} must be rejected`);
  }
});

test('ordinary accelerators are accepted', async () => {
  const { isRegisterableAccelerator } = await load();
  const ok = [
    'CommandOrControl+B', 'CommandOrControl+Shift+Enter', 'CommandOrControl+Alt+Left',
    'CommandOrControl+Shift+Space', 'Alt+F4', 'Shift+Plus', 'A', 'CommandOrControl+1',
    'Command+Option+8', 'Control+num5', 'CommandOrControl+/', 'MediaPlayPause',
  ];
  for (const acc of ok) {
    assert.equal(isRegisterableAccelerator(acc), true, `${acc} must be accepted`);
  }
});

test('every shipped default keybind survives the validator', async () => {
  // Guards the other direction: a validator that over-rejects would silently
  // strip the app's own shortcuts on load.
  const { isRegisterableAccelerator } = await load();
  const src = read('electron/services/KeybindManager.ts');
  const block = src.slice(
    src.indexOf('export const DEFAULT_KEYBINDS'),
    src.indexOf('export class KeybindManager'),
  );
  const accels = [...block.matchAll(/\baccelerator:\s*'([^']*)'/g)].map(m => m[1]);
  assert.ok(accels.length >= 20, `expected the default table, found ${accels.length}`);
  for (const acc of accels) {
    assert.equal(isRegisterableAccelerator(acc), true, `default ${acc} must be accepted`);
  }
});

// --------------------------------------------------------------- safe probe

test('probeAccelerator reports invalid instead of throwing when Electron throws', async () => {
  const { probeAccelerator } = await load();
  // Exactly what globalShortcut.isRegistered does with an unconvertible string.
  const throwing = () => {
    throw new TypeError('Error processing argument at index 0, conversion failure from ₹');
  };
  assert.equal(
    probeAccelerator('₹', throwing),
    'invalid',
    'the health-check probe must absorb the throw — this is the crash.',
  );
});

test('probeAccelerator never calls Electron for an accelerator it can reject itself', async () => {
  const { probeAccelerator } = await load();
  let calls = 0;
  const spy = () => { calls++; return true; };
  assert.equal(probeAccelerator('₹', spy), 'invalid');
  assert.equal(calls, 0, 'an unregisterable accelerator must not be handed to globalShortcut at all.');
});

test('probeAccelerator distinguishes a live shortcut from one the OS dropped', async () => {
  const { probeAccelerator } = await load();
  assert.equal(probeAccelerator('CommandOrControl+B', () => true), 'alive');
  assert.equal(probeAccelerator('CommandOrControl+B', () => false), 'lost');
});

// ------------------------------------------------------ structural guards
// KeybindManager and main.ts import `electron` at module scope and build into
// 22 MB bundles, so they have no runtime test seam (same reason as
// GlobalShortcutRecovery.test.mjs). These pin the call sites.

test('revalidateShortcuts probes through the safe helper, never bare isRegistered', () => {
  const src = read('electron/services/KeybindManager.ts');
  const fn = src.slice(
    src.indexOf('public revalidateShortcuts('),
    src.indexOf('private startHealthCheck('),
  );
  assert.ok(fn.length > 0, 'revalidateShortcuts() not found');
  assert.match(
    fn,
    /probeAccelerator\(/,
    'revalidateShortcuts must probe via probeAccelerator() — a bare globalShortcut.isRegistered() outside the try is what killed the main process.',
  );
  // The invariant is positional: everything before the try{ runs unguarded, so
  // no globalShortcut call may appear there. (The isRegistered() *inside* the
  // try is fine — that one always was.)
  const tryAt = fn.indexOf('try {');
  assert.ok(tryAt > 0, 'the register-retry try block not found');
  const beforeTry = fn
    .slice(0, tryAt)
    .split('\n')
    .filter(line => !line.includes('probeAccelerator(')) // the probe's own try covers this one
    .filter(line => !line.trim().startsWith('//'))       // comments describe the old bug by name
    .join('\n');
  assert.doesNotMatch(
    beforeTry,
    /globalShortcut\./,
    'no globalShortcut call may run before the try in revalidateShortcuts — an accelerator Electron cannot convert throws from isRegistered() just as it does from register(), and that throw escapes to the health-check timer.',
  );
});

test('the passthrough-toggle caller cannot let revalidateShortcuts kill the process', () => {
  const main = read('electron/main.ts');
  const start = main.indexOf('setOverlayMousePassthrough(state: boolean)');
  assert.ok(start >= 0, 'setOverlayMousePassthrough not found');
  const block = main.slice(start, start + 2000);
  const call = block.indexOf('revalidateShortcuts()');
  assert.ok(call >= 0, 'setOverlayMousePassthrough must still revalidate shortcuts');
  assert.match(
    block.slice(0, call),
    /try\s*{/,
    'the revalidateShortcuts() call in setOverlayMousePassthrough must be inside a try — the other three callers already are.',
  );
});

test('keybinds loaded from disk are validated before registration', () => {
  const src = read('electron/services/KeybindManager.ts');
  const load = src.slice(src.indexOf('private load()'), src.indexOf('private save()'));
  assert.ok(load.length > 0, 'load() not found');
  assert.match(
    load,
    /isRegisterableAccelerator\(/,
    'load() must drop an unregisterable accelerator already persisted in keybinds.json — that is what unbricks a user who is currently crash-looping.',
  );
});

test('the renderer cannot record an unrepresentable key as an accelerator', () => {
  const src = read('src/utils/keyboardUtils.ts');
  const fn = src.slice(src.indexOf('export function keysToAccelerator('));
  assert.ok(fn.length > 0, 'keysToAccelerator() not found');
  const dflt = fn.slice(fn.indexOf('default:'), fn.indexOf('return ['));
  assert.ok(dflt.length > 0, 'the default branch of keysToAccelerator not found');
  assert.match(
    dflt,
    /isRepresentableKey\(key\)/,
    'the default branch must gate on isRepresentableKey — that is where "₹" entered the system.',
  );
  assert.doesNotMatch(
    dflt,
    /^\s*mainKey = key\.toUpperCase\(\);/m,
    'no ungated assignment of a raw event.key may remain in the default branch.',
  );
});

// ---------------------------------------------- consequences of the guard
// Gating keysToAccelerator changed what an unsupported keypress DOES: it used
// to yield "₹" (and crash main); without further care it would now yield "" —
// which is a valid accelerator meaning "unbound", so the keypress would
// silently clear the shortcut. These pin the two places that must absorb it.

test('the recorder ignores an unrepresentable key instead of clearing the binding', () => {
  const src = read('src/components/ui/KeyRecorder.tsx');
  const handler = src.slice(
    src.indexOf('const handleKeyDown'),
    src.indexOf('return ('),
  );
  assert.ok(handler.length > 0, 'handleKeyDown not found');
  assert.match(
    handler,
    /isRepresentableKey\(/,
    'KeyRecorder must drop a key Electron cannot bind, rather than emit it and let keysToAccelerator collapse the combo to "" (which unbinds the shortcut).',
  );
});

test('a rejected setKeybind still re-syncs the renderer', () => {
  const src = read('electron/services/KeybindManager.ts');
  const fn = src.slice(src.indexOf('public setKeybind('), src.indexOf('public resetKeybinds('));
  assert.ok(fn.length > 0, 'setKeybind() not found');
  const reject = fn.slice(fn.indexOf('isRegisterableAccelerator('), fn.indexOf('const currentKb'));
  assert.match(
    reject,
    /broadcastUpdate\(\)/,
    'the renderer applies the new combo optimistically, so a silent early return would leave Settings showing a shortcut main never accepted.',
  );
});
