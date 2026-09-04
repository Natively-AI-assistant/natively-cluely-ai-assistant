import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

// The Windows WH_KEYBOARD_LL hook can swallow the app's OWN global shortcuts and
// self-dispatch them, so a chord whose RegisterHotKey registration was silently
// dropped cannot leak its completing character into the foreground app while
// stealth typing is engaged. This winapi path cannot be compiled or run from
// macOS (the crate's C deps need the Windows SDK), so these source-level guards
// pin its contract. The MATCHING LOGIC itself (which chords, exact-match, the
// safe subset) is really unit-tested in native-module/src/app_chord.rs and
// electron/services/__tests__/WinChord.test.mjs.

const HOOK = 'native-module/src/keyboard_hook_windows.rs';

test('start() accepts the app-chord table and stores it before the worker installs', () => {
  const rust = read(HOOK);
  assert.match(
    rust,
    /pub fn start\([\s\S]{0,200}app_chords:\s*Vec<AppChordInput>/,
    'BUG: start() must accept the app_chords table (napi surface shared with macOS keyboard_tap).',
  );
  assert.match(
    rust,
    /\*self\.state\.app_chords\.lock\(\)[\s\S]{0,120}app_chords_from_inputs\(app_chords\)/,
    'BUG: the chord table must be published into HookState at start(), before the hook installs.',
  );
});

test('the hook swallows a matching app chord and self-dispatches it (never passes it through)', () => {
  const rust = read(HOOK);
  const inner = rust.slice(
    rust.indexOf('unsafe fn keyboard_hook_inner('),
    rust.indexOf('/// The keyboard layout of the foreground'),
  );
  assert.ok(inner.length > 0, 'keyboard_hook_inner() not found');

  // Gated to Ctrl key-downs with Win excluded. Alt is accepted only for arrow
  // chords by match_app_chord, so printable AltGr text remains ineligible.
  assert.match(
    inner,
    /if is_key_down && ctrl && !win \{/,
    'BUG: the app-chord swallow must be gated on `is_key_down && ctrl && !win`.',
  );
  assert.match(
    inner,
    /match_app_chord\(chords\.as_slice\(\), vk, mods\)/,
    'BUG: the hook must consult match_app_chord for the current vk + modifier set.',
  );
  // On a match: deliver tagged with the action id, remember the vk, and SWALLOW.
  // Checked as separate robust substrings rather than one long span.
  const matchBranch = inner.slice(inner.indexOf('if is_key_down && ctrl && !win {'));
  assert.match(matchBranch, /app_chord_id: id,/, 'BUG: a matched chord must be delivered tagged with the action id.');
  assert.match(matchBranch, /swallowed_ups[\s\S]{0,120}\.insert\(vk\)/, 'BUG: the swallowed down-vk must be recorded so its up is swallowed too.');
  assert.match(matchBranch, /return LRESULT\(1\)/, 'BUG: a matched chord key-down must be swallowed (LRESULT(1)), never passed through.');
});

test('the matching key-UP is swallowed too (no half a sequence reaches the app)', () => {
  const rust = read(HOOK);
  assert.match(
    rust,
    /if is_key_up \{[\s\S]{0,200}swallowed_ups[\s\S]{0,80}\.remove\(&vk\)[\s\S]{0,60}return LRESULT\(1\)/,
    'BUG: a completing key whose down we swallowed must have its up swallowed as well.',
  );
});

test('the swallow excludes Win combos and runs before the Ctrl/Alt pass-through', () => {
  const rust = read(HOOK);
  const swallow = rust.indexOf('if is_key_down && ctrl && !win {');
  const ctrlPass = rust.indexOf('if (ctrl || alt) && !altgr {');
  assert.ok(swallow >= 0 && ctrlPass >= 0, 'expected both markers present');
  assert.ok(
    swallow < ctrlPass,
    'BUG: app-chord swallow must run before the (ctrl||alt) pass.',
  );
});

test('Ctrl down and up are swallowed while the overlay is visible, without replay', () => {
  const rust = read(HOOK);
  assert.match(
    rust,
    /ctrl_bit\(vk,[\s\S]*ctrl_down\.fetch_or\(ctrl_mask[\s\S]*ctrl_down\.fetch_and\(!ctrl_mask[\s\S]*suppress_ctrl\.load[\s\S]*return LRESULT\(1\)[\s\S]*let ctrl = state\.ctrl_down[\s\S]*pub fn set_ctrl_suppressed[\s\S]*suppress_ctrl\.store/,
    'the native visibility switch must swallow Ctrl while tracking both Ctrl keys for app chords.',
  );
  assert.doesNotMatch(rust, /SendInput|deferred_ctrl_vk|REPLAYED_CTRL_MARKER|replay_ctrl/,
    'suppressed Ctrl must never be replayed into the foreground app.');
});

test('the generated native declaration exposes Ctrl suppression', () => {
  assert.match(read('native-module/index.d.ts'), /setCtrlSuppressed\(suppressed: boolean\): void/);
});

test('an empty chord table leaves the hook fully inert (no behaviour change)', () => {
  // match_app_chord returns None for an empty table, and a None falls through to
  // the unchanged pass-through — so shipping with [] chords == today's build.
  const rust = read('native-module/src/app_chord.rs');
  assert.match(
    rust,
    /pub fn match_app_chord[\s\S]{0,600}\.find\(\|c\| c\.vk == vk && c\.mods == mods\)/,
    'BUG: match must be exact on (vk, mods); an empty/miss table dispatches nothing.',
  );
});

test('shortcut-guard mode: hook passes ordinary typing through and installs no aux hooks', () => {
  const rust = read(HOOK);
  const inner = rust.slice(
    rust.indexOf('unsafe fn keyboard_hook_inner('),
    rust.indexOf('/// The keyboard layout of the foreground'),
  );
  // In shortcut_only the app-chord swallow is the ENTIRE job; everything else
  // passes through (no typing capture) — asserted by the early pass gate.
  assert.match(
    inner,
    /if state\.shortcut_only\.load\(Ordering::Acquire\) \{\s*return pass\(\);/,
    'BUG: shortcut-guard mode must pass all non-chord keys through (no typing swallow).',
  );
  // The gate must sit AFTER the app-chord swallow (so chords are still caught)
  // and BEFORE the typing-swallow filter.
  const gate = inner.indexOf('if state.shortcut_only.load');
  const swallow = inner.indexOf('if is_key_down && ctrl && !win {');
  const typingFilter = inner.indexOf('if (ctrl || alt) && !altgr {');
  assert.ok(swallow >= 0 && gate > swallow && gate < typingFilter,
    'BUG: shortcut-guard pass-gate must be between the app-chord swallow and the typing filter.');

  // The mouse + WinEvent auto-stop hooks are for stealth-TYPING sessions only;
  // the guard installs neither.
  assert.match(
    rust,
    /if !state\.shortcut_only\.load\(Ordering::Acquire\) \{[\s\S]{0,1200}WH_MOUSE_LL[\s\S]{0,600}SetWinEventHook/,
    'BUG: the mouse + foreground-change hooks must be skipped in shortcut-guard mode.',
  );
});

test('start() takes the shortcut_only flag and publishes it before install', () => {
  const rust = read(HOOK);
  const startSig = rust.slice(rust.indexOf('pub fn start('), rust.indexOf(') -> Result<bool> {', rust.indexOf('pub fn start(')));
  assert.match(
    startSig,
    /shortcut_only:\s*bool/,
    'BUG: start() must accept the shortcut_only mode flag (napi surface shared with macOS).',
  );
  assert.match(
    rust,
    /self\.state\.shortcut_only\.store\(shortcut_only, Ordering::Release\)/,
    'BUG: the mode must be published into HookState before the worker installs the hook.',
  );
});
