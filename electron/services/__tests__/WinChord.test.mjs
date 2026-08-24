import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/services/winChord.js'
);

async function load() {
  return import(pathToFileURL(modulePath).href);
}

// The chord table this produces feeds native-module/src/app_chord.rs. Its
// {vk, mods} contract and the MOD_* bit layout MUST stay in lockstep with that
// module (whose own tests assert the matching half). These tests pin the JS
// half: which accelerators become chords, and — just as important — which are
// deliberately excluded so the hook never swallows them.

test('MOD_* bit layout matches the Rust contract', async () => {
  const { MOD_CTRL, MOD_ALT, MOD_SHIFT, MOD_WIN } = await load();
  assert.equal(MOD_CTRL, 1 << 0);
  assert.equal(MOD_ALT, 1 << 1);
  assert.equal(MOD_SHIFT, 1 << 2);
  assert.equal(MOD_WIN, 1 << 3);
});

test('CommandOrControl+Enter -> Ctrl+Enter chord (VK 0x0D)', async () => {
  const { acceleratorToWin32Chord, MOD_CTRL } = await load();
  assert.deepEqual(
    acceleratorToWin32Chord('CommandOrControl+Enter', 'general:process-screenshots'),
    { vk: 0x0d, mods: MOD_CTRL, id: 'general:process-screenshots' }
  );
});

test('CommandOrControl+Shift+Enter carries the Shift bit', async () => {
  const { acceleratorToWin32Chord, MOD_CTRL, MOD_SHIFT } = await load();
  assert.deepEqual(
    acceleratorToWin32Chord('CommandOrControl+Shift+Enter', 'general:capture-and-process'),
    { vk: 0x0d, mods: MOD_CTRL | MOD_SHIFT, id: 'general:capture-and-process' }
  );
});

test('digit and letter chords map to their VKs', async () => {
  const { acceleratorToWin32Chord, MOD_CTRL } = await load();
  assert.equal(acceleratorToWin32Chord('CommandOrControl+1', 'chat:whatToAnswer').vk, 0x31);
  assert.equal(acceleratorToWin32Chord('CommandOrControl+7', 'chat:brainstorm').vk, 0x37);
  assert.equal(acceleratorToWin32Chord('CommandOrControl+H', 'general:take-screenshot').vk, 0x48);
  assert.equal(acceleratorToWin32Chord('CommandOrControl+Shift+Space', 'chat:focusInput').vk, 0x20);
});

test('Alt chords are excluded (AltGr ambiguity)', async () => {
  const { acceleratorToWin32Chord } = await load();
  // Ctrl+Alt+Left (scroll bind) must NOT become a swallowable chord.
  assert.equal(acceleratorToWin32Chord('CommandOrControl+Alt+Left', 'chat:scrollLeft'), null);
  assert.equal(acceleratorToWin32Chord('CommandOrControl+Alt+L', 'x'), null);
});

test('Win/Super/Command-modified chords are excluded', async () => {
  const { acceleratorToWin32Chord } = await load();
  assert.equal(acceleratorToWin32Chord('Super+Enter', 'x'), null);
  assert.equal(acceleratorToWin32Chord('Meta+H', 'x'), null);
});

test('bare keys and modifier-less accelerators are excluded', async () => {
  const { acceleratorToWin32Chord } = await load();
  assert.equal(acceleratorToWin32Chord('Enter', 'x'), null);
  assert.equal(acceleratorToWin32Chord('H', 'x'), null);
  assert.equal(acceleratorToWin32Chord('Shift+Enter', 'x'), null); // no Ctrl
});

test('non-printable completing keys are excluded', async () => {
  const { acceleratorToWin32Chord } = await load();
  assert.equal(acceleratorToWin32Chord('CommandOrControl+Up', 'chat:scrollUp'), null);
  assert.equal(acceleratorToWin32Chord('CommandOrControl+F1', 'x'), null);
  assert.equal(acceleratorToWin32Chord('CommandOrControl+Left', 'x'), null);
});

test('empty / malformed accelerators return null, never throw', async () => {
  const { acceleratorToWin32Chord } = await load();
  assert.equal(acceleratorToWin32Chord('', 'x'), null);
  assert.equal(acceleratorToWin32Chord('   ', 'x'), null);
  assert.equal(acceleratorToWin32Chord('CommandOrControl+A+B', 'x'), null); // two keys
});

test('buildChordTable keeps only global, in-subset binds', async () => {
  const { buildChordTable, MOD_CTRL } = await load();
  const table = buildChordTable([
    { id: 'a', accelerator: 'CommandOrControl+Enter', isGlobal: true },
    { id: 'b', accelerator: 'CommandOrControl+Alt+Left', isGlobal: true }, // Alt -> dropped
    { id: 'c', accelerator: 'CommandOrControl+H', isGlobal: false },       // not global -> dropped
    { id: 'd', accelerator: '', isGlobal: true },                          // empty -> dropped
    { id: 'e', accelerator: 'CommandOrControl+5', isGlobal: true },
  ]);
  assert.deepEqual(table, [
    { vk: 0x0d, mods: MOD_CTRL, id: 'a' },
    { vk: 0x35, mods: MOD_CTRL, id: 'e' },
  ]);
});
