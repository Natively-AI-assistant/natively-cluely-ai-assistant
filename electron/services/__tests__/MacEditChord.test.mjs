import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const modulePath = path.resolve(root, 'dist-electron/electron/services/macEditChord.js');

async function load() {
  return import(pathToFileURL(modulePath).href);
}

// The macOS stealth tap sees keys before the app's Carbon hot keys, and while
// typing it takes Cmd+A/C/V/X as edits (PR #633). A user who bound one of those
// four as a Natively shortcut lost it while typing. This table, which
// native-module/src/edit_shortcut.rs mac_edit_letter_is_app_chord reads (vk =
// the letter's code, mods = MOD_CTRL for Cmd alone), names the binds the tap
// must leave to the hot key.

test('Cmd plus an editing letter becomes a chord, in each spelling', async () => {
  const { acceleratorToMacEditChord } = await load();
  assert.deepEqual(acceleratorToMacEditChord('CommandOrControl+V', 'id'), { vk: 0x56, mods: 1, id: 'id' });
  assert.deepEqual(acceleratorToMacEditChord('Command+A', 'id'), { vk: 0x41, mods: 1, id: 'id' });
  assert.deepEqual(acceleratorToMacEditChord('Cmd+c', 'id'), { vk: 0x43, mods: 1, id: 'id' });
  assert.deepEqual(acceleratorToMacEditChord('CmdOrCtrl+X', 'id'), { vk: 0x58, mods: 1, id: 'id' });
});

test('anything the tap does not take as an edit is left out', async () => {
  const { acceleratorToMacEditChord } = await load();
  for (const acc of [
    'CommandOrControl+Shift+V', // the tap passes Cmd+Shift through already
    'Command+Alt+V',
    'Control+V', // Ctrl on macOS, never an edit key there
    'CommandOrControl+B', // not one of the four
    'CommandOrControl+Enter',
    'V',
    '',
  ]) {
    assert.equal(acceleratorToMacEditChord(acc, 'id'), null, acc);
  }
});

test('only global binds go in the table', async () => {
  const { buildMacEditChordTable } = await load();
  const table = buildMacEditChordTable([
    { id: 'global-v', accelerator: 'CommandOrControl+V', isGlobal: true },
    { id: 'local-a', accelerator: 'CommandOrControl+A', isGlobal: false },
    { id: 'global-b', accelerator: 'CommandOrControl+B', isGlobal: true },
  ]);
  assert.deepEqual(table, [{ vk: 0x56, mods: 1, id: 'global-v' }]);
});

test('the tap gets the table on macOS, and the guard stays Windows only', () => {
  const manager = readFileSync(path.join(root, 'electron/services/StealthKeyboardManager.ts'), 'utf8');
  assert.match(manager, /if \(process\.platform !== 'win32' && process\.platform !== 'darwin'\) return \[\];/);
  assert.match(manager, /: KeybindManager\.getInstance\(\)\.getMacEditChordTable\(\);/);
  const guard = manager.slice(manager.indexOf('private maybeStartGuard(): void {'));
  assert.match(guard, /^private maybeStartGuard\(\): void \{\s*if \(process\.platform !== 'win32'\) return;/);
  const tap = readFileSync(path.join(root, 'native-module/src/keyboard_tap.rs'), 'utf8');
  assert.match(tap, /!mac_edit_letter_is_app_chord\(chords\.as_slice\(\), l\)/);
  assert.doesNotMatch(tap, /_app_chords: Vec<AppChordInput>/, 'the macOS tap reads the table now');
});
